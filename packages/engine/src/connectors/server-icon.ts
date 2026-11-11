import { createHash } from "node:crypto";
import { type BlobStore, readCapped } from "@agenteschat/adapters";
import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { sniffImage, stripImageMetadata } from "../avatars";
import { caches } from "../cache";
import { NotFoundError } from "../errors";
import { assertPublicHttpsUrl, outboundFetch, type ResolveHost } from "../net-guard";
import { requirePermission } from "../organizations";
import type { ConnectorConnection } from "./connections";

const { connectorConnections } = schema;

/** An icon as an MCP server lists it (`serverInfo.icons`, MCP 2025-11-25). Untrusted: any field may be missing or wrong. */
export interface McpIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: string;
}

/** Who the server says it is in the `initialize` answer (`serverInfo`). */
export interface McpServerInfo {
  name?: string;
  title?: string;
  websiteUrl?: string;
  icons?: McpIcon[];
}

/**
 * Small on purpose: an icon is drawn at 40-56 px. The side limit guards the
 * browser against images that decode huge from a few bytes.
 */
export const SERVER_ICON_LIMITS = { maxBytes: 256 * 1024, maxSide: 1024, maxTries: 3, timeoutMs: 5_000 };

type IconType = "image/jpeg" | "image/png" | "image/webp";
const EXT: Record<IconType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ALIASES: Record<string, IconType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

export interface ServerIconDeps {
  db: Database;
  /** Where icons are kept (the platform bucket). None: no icons. */
  blobs?: BlobStore;
  http?: typeof fetch;
  resolveHost?: ResolveHost;
}

/** The smallest side a server declares for an icon (`"48x48"`), or null (`"any"`, none). */
function declaredSide(icon: McpIcon) {
  let side: number | null = null;
  for (const s of icon.sizes ?? []) {
    const m = /^(\d{1,5})x(\d{1,5})$/i.exec(String(s).trim());
    if (m) side = Math.max(side ?? 0, Math.min(Number(m[1]), Number(m[2])));
  }
  return side;
}

/**
 * The icons worth trying, best first: PNG, JPEG or WebP (SVG may carry
 * scripts and the phone app can't draw it), from a `data:` URI or an https
 * URL on the server's own origin (the MCP spec's rule: nothing about the
 * org leaks to a third party). Sizes of 64 px or more first, nearest 128.
 */
export function iconCandidates(serverUrl: string, icons: unknown): McpIcon[] {
  if (!Array.isArray(icons)) return [];
  let origin: string;
  try {
    origin = new URL(serverUrl).origin;
  } catch {
    return [];
  }
  const usable = icons.filter((i): i is McpIcon => {
    if (!i || typeof i !== "object" || typeof (i as McpIcon).src !== "string") return false;
    const icon = i as McpIcon;
    if (icon.mimeType !== undefined && !ALIASES[String(icon.mimeType).toLowerCase()]) return false;
    if (icon.src.startsWith("data:")) return /^data:image\/(png|jpe?g|webp);base64,/i.test(icon.src);
    try {
      const u = new URL(icon.src);
      return u.protocol === "https:" && u.origin === origin && !/\.svgz?$/i.test(u.pathname);
    } catch {
      return false;
    }
  });
  const score = (i: McpIcon) => {
    const side = declaredSide(i);
    if (side === null) return 1_000;
    return (side >= 64 ? 0 : 2_000) + Math.abs(side - 128);
  };
  return usable
    .map((icon, at) => ({ icon, at }))
    .sort((a, b) => score(a.icon) - score(b.icon) || a.at - b.at)
    .map((x) => x.icon);
}

/**
 * An icon's bytes. An https one passes the SSRF guard, is fetched without
 * credentials or redirects (a redirect could leave the server's origin)
 * and with a timeout.
 */
async function iconBytes(deps: ServerIconDeps, icon: McpIcon): Promise<Uint8Array | null> {
  const max = SERVER_ICON_LIMITS.maxBytes;
  if (icon.src.startsWith("data:")) {
    const data = icon.src.slice(icon.src.indexOf(",") + 1).replace(/\s+/g, "");
    if (data.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
    return new Uint8Array(Buffer.from(data, "base64"));
  }
  try {
    const url = await assertPublicHttpsUrl(icon.src, deps.resolveHost);
    const res = await (deps.http ?? outboundFetch({ resolveHost: deps.resolveHost }))(url.toString(), {
      headers: { accept: "image/png, image/jpeg, image/webp" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(SERVER_ICON_LIMITS.timeoutMs),
    });
    if (!res.ok) return null;
    return await readCapped(res, max);
  } catch {
    return null;
  }
}

/** Width and height from the image's header, or null when it can't be read. */
export function imageDimensions(b: Uint8Array, type: IconType): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (type === "image/png") {
    if (b.length < 24 || ascii(12, 16) !== "IHDR") return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1] as number;
      // Start of frame (baseline, progressive, lossless…), not DHT (C4), JPG (C8) or DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      if (marker === 0xda) return null;
      i += 2 + view.getUint16(i + 2);
    }
    return null;
  }
  if (b.length < 30) return null;
  const chunk = ascii(12, 16);
  if (chunk === "VP8X") {
    const u24 = (at: number) => (b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Checks bytes as an icon: the type comes from the bytes (the declared one
 * is advisory and must agree when given), and the size is bounded.
 */
export function readIcon(bytes: Uint8Array, declared?: string): { body: Uint8Array; type: IconType } | null {
  if (bytes.length === 0 || bytes.length > SERVER_ICON_LIMITS.maxBytes) return null;
  const type = sniffImage(bytes);
  if (!type) return null;
  if (declared !== undefined && ALIASES[declared.toLowerCase()] !== type) return null;
  const size = imageDimensions(bytes, type);
  if (!size || size.width < 1 || size.height < 1) return null;
  if (size.width > SERVER_ICON_LIMITS.maxSide || size.height > SERVER_ICON_LIMITS.maxSide) return null;
  return { body: stripImageMetadata(bytes, type), type };
}

const ICON_FILE = /^[0-9a-f]{16}\.(jpg|png|webp)$/;
const ICON_PATH = /^\/api\/app\/connector-icons\/[^/]+\/[^/]+\/([0-9a-f]{16}\.(jpg|png|webp))$/;
/**
 * Under the org's own prefix, so every platform store takes it: S3, a folder
 * (`FILES_DIR`) or Postgres, whose row then carries the org and goes with it.
 */
const blobKey = (orgId: string, connectionId: string, file: string) =>
  `orgs/${orgId}/connector-icons/${connectionId}/${file}`;

/**
 * Keeps a custom server's own icon (`serverInfo.icons` from `initialize`)
 * after each listing. Stored in the platform store, named by a hash of its
 * content, and served to the org's members by
 * `GET /api/app/connector-icons/{orgId}/{connectionId}/{file}`, so no
 * browser ever loads it from the server. A server that stops listing icons
 * loses its icon; one whose icons all fail keeps the last good one (the
 * failure may be passing).
 */
export async function refreshServerIcon(deps: ServerIconDeps, c: ConnectorConnection, info: McpServerInfo | null) {
  const blobs = deps.blobs;
  if (!blobs) return;
  const listed: unknown[] = info && Array.isArray(info.icons) ? info.icons : [];
  let next: { body: Uint8Array; type: IconType } | null = null;
  for (const icon of iconCandidates(c.serverUrl, listed).slice(0, SERVER_ICON_LIMITS.maxTries)) {
    const bytes = await iconBytes(deps, icon);
    const declared = icon.mimeType ?? /^data:([^;,]+)/.exec(icon.src)?.[1];
    next = bytes && readIcon(bytes, declared);
    if (next) break;
  }
  if (!next && listed.length > 0) return;
  const before = c.icon ? ICON_PATH.exec(c.icon)?.[1] : undefined;
  const file = next ? `${createHash("sha256").update(next.body).digest("hex").slice(0, 16)}.${EXT[next.type]}` : null;
  if (next && file === before) return;
  let icon: string | null = null;
  if (next && file) {
    await blobs.put(blobKey(c.orgId, c.id, file), next.body, { contentType: next.type });
    icon = `/api/app/connector-icons/${encodeURIComponent(c.orgId)}/${encodeURIComponent(c.id)}/${file}`;
  } else if (!c.icon) {
    return;
  }
  // Replace only the icon this refresh read: a concurrent refresh that already changed it wins, and we drop the
  // blob we just wrote instead of leaving it orphaned. Each refresh deletes exactly its own old or losing copy.
  const [updated] = await deps.db
    .update(connectorConnections)
    .set({ icon })
    .where(
      and(
        eq(connectorConnections.id, c.id),
        eq(connectorConnections.orgId, c.orgId),
        c.icon ? eq(connectorConnections.icon, c.icon) : isNull(connectorConnections.icon),
      ),
    )
    .returning({ id: connectorConnections.id });
  if (!updated) {
    if (file) await blobs.delete(blobKey(c.orgId, c.id, file)).catch(() => undefined);
    return;
  }
  caches.connections.delete(`${c.orgId}:active`);
  if (before) await blobs.delete(blobKey(c.orgId, c.id, before)).catch(() => undefined);
}

/** A stored icon for `GET /api/app/connector-icons/{orgId}/{connectionId}/{file}`: only for the org's members. */
export async function connectorIconFile(
  deps: { db: Database; blobs: BlobStore },
  viewerId: string,
  orgId: string,
  connectionId: string,
  file: string,
) {
  if (!ICON_FILE.test(file) || !/^[0-9a-f-]{36}$/.test(connectionId)) throw new NotFoundError("Not found");
  await requirePermission(deps.db, viewerId, orgId, "read").catch(() => {
    throw new NotFoundError("Not found");
  });
  const object = await deps.blobs.get(blobKey(orgId, connectionId, file));
  if (!object) throw new NotFoundError("Not found");
  return object;
}
