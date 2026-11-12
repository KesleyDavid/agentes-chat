import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { requestLimitIp } from "../http/client-ip";
import { apiError, errorResponse } from "../http/errors";
import { type AppDeps, json } from "./app/context";

const tags = ["Desktop app"];

/**
 * Where desktop builds live (ADR 0036 §9): GitHub Releases of a private
 * repository, read with a fine-grained token. Convention (the desktop CI
 * follows it): tag `desktop-v<semver>`; per platform a download with its
 * `.sha256` and an updater bundle with its minisign signature `.sig` (Tauri
 * updater), named as `desktopAssets` says; an optional line
 * `min-version: x.y.z` in the release body (the rest of the body is the notes).
 */
export const DESKTOP_TAG_PREFIX = "desktop-v";
const LATEST_TTL_MS = 5 * 60_000;
const GITHUB_API = "https://api.github.com";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FILE_NAME = /^[\w.-]{1,200}$/;

export interface DesktopRelease {
  version: string;
  /** The download's path here (`/api/desktop/download/…`); the routes put `PUBLIC_URL` in front. */
  url: string;
  sha256: string;
  notes: string;
  publishedAt: string;
  minVersion?: string;
  /** The Tauri updater bundle (a path too) and its signature; absent on builds made before the updater. */
  updater?: { url: string; signature: string };
  /**
   * Linux only: the AppImage as a download of its own (a path too), for a distribution that takes no deb (Arch,
   * Fedora…). It runs as it is and updates itself. Absent when the release has no AppImage or no checksum of it.
   */
  appImage?: { url: string; sha256: string };
}

interface GitHubAsset {
  name: string;
  url: string;
  size?: number;
  content_type?: string;
}

interface GitHubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  body?: string | null;
  published_at?: string | null;
  created_at?: string;
  assets?: GitHubAsset[];
}

export const dmgName = (version: string) => `agentes_${version}_universal.dmg`;
export const updaterName = (version: string) => `agentes_${version}_universal.app.tar.gz`;

/**
 * The builds the app comes in, as `/desktop/latest` and the updater ask for them (Tauri's `{{target}}` and
 * `{{arch}}`): one universal Mac build, and Windows and Linux for x64 (`windows`, `linux`) and ARM64.
 */
export type DesktopTarget = "darwin" | "windows" | "windows-arm64" | "linux" | "linux-arm64";

/**
 * A build's files in a release: what a person downloads, and what the app's updater installs. Windows'
 * installer is its own updater bundle; on Linux the deb is the download (a deb updates by downloading again)
 * and the AppImage updates itself, and is offered as a second download (`DesktopRelease.appImage`). The CI names
 * them (.github/workflows/desktop.yml).
 */
export function desktopAssets(target: DesktopTarget, version: string): { download: string; updater: string } {
  if (target === "windows" || target === "windows-arm64") {
    const installer = `agentes_${version}_${target === "windows" ? "x64" : "arm64"}-setup.exe`;
    return { download: installer, updater: installer };
  }
  if (target === "linux" || target === "linux-arm64") {
    const arch = target === "linux" ? "amd64" : "arm64";
    return { download: `agentes_${version}_${arch}.deb`, updater: `agentes_${version}_${arch}.AppImage` };
  }
  return { download: dmgName(version), updater: updaterName(version) };
}

/** Architectures, as Rust (`aarch64`, `x86_64`) and Node (`arm64`, `x64`) name them. */
const ARM64 = new Set(["aarch64", "arm64"]);
const X64 = new Set(["x86_64", "x64"]);

/** The query's build when there is one for it: the universal one on any Mac; x64 when the arch isn't said. */
export function desktopTarget(target: string | undefined, arch: string | undefined): DesktopTarget | null {
  if (target === "darwin") return !arch || ARM64.has(arch) || X64.has(arch) ? "darwin" : null;
  if (target === "windows" || target === "linux") {
    if (!arch || X64.has(arch)) return target;
    if (!ARM64.has(arch)) return null;
    return target === "windows" ? "windows-arm64" : "linux-arm64";
  }
  return null;
}

/** A deb or an AppImage: Linux, either architecture. */
const onLinux = (target: DesktopTarget) => target === "linux" || target === "linux-arm64";

/**
 * Where a release body's first-open steps start (`.github/desktop-install.md`, added by the desktop CI): they are for
 * people downloading from the release page, not the app's update notes (ADR 0036 §10).
 */
export const INSTALL_NOTES_MARK = "<!-- install -->";

/** `min-version: x.y.z` out of a release body, and the notes without that line or the first-open steps. */
export function parseReleaseBody(body: string | null | undefined): { notes: string; minVersion?: string } {
  let minVersion: string | undefined;
  const text = body ?? "";
  const cut = text.indexOf(INSTALL_NOTES_MARK);
  const lines = (cut < 0 ? text : text.slice(0, cut)).split(/\r?\n/).filter((line) => {
    const m = line.match(/^\s*min-version:\s*v?(\S+)\s*$/i);
    if (!m) return true;
    if (m[1] && SEMVER.test(m[1])) minVersion = m[1];
    return false;
  });
  return { notes: lines.join("\n").trim(), ...(minVersion ? { minVersion } : {}) };
}

/** The first 64-hex word of a `.sha256` file (`shasum -a 256` writes `<hash>  <file>`). */
export function parseSha256(text: string): string | null {
  return text.match(/\b([0-9a-f]{64})\b/i)?.[1]?.toLowerCase() ?? null;
}

interface ReleaseSource {
  token: string | undefined;
  repo: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** A release being read: its version (the tag without its prefix), its assets, and how to read a small one. */
interface ReleaseFiles {
  release: GitHubRelease;
  version: string;
  assets: GitHubAsset[];
  text: (asset: GitHubAsset) => Promise<string>;
}

/**
 * Reads one kind of release, by tag prefix (`desktop-v*`, or `v*` for the server), with the token
 * (`fetch` injectable: tests use a fake GitHub). The newest one with what `key` needs (`has`: a
 * release may lack a platform), as `read` makes it, is cached 5 minutes per process and key; the
 * release list too, once for every key.
 */
function releaseReader<T, K extends string>(
  options: ReleaseSource & {
    prefix: string;
    has?: (assets: GitHubAsset[], version: string, key: K) => boolean;
    read: (r: ReleaseFiles, key: K) => Promise<T | null>;
  },
) {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const latest = new Map<K, { at: number; value: T | null }>();
  let list: { at: number; value: GitHubRelease[] } | null = null;
  const headers = () => ({
    authorization: `Bearer ${options.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "agentes.chat",
  });

  async function getJson<R>(path: string): Promise<R | null> {
    const res = await http(`${GITHUB_API}${path}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return (await res.json()) as R;
  }

  /** An asset's bytes: GitHub redirects to a signed URL, which must not get our token. */
  async function assetResponse(asset: GitHubAsset): Promise<Response> {
    const first = await http(asset.url, {
      headers: { ...headers(), accept: "application/octet-stream" },
      redirect: "manual",
    });
    const location = first.headers.get("location");
    if (first.status >= 300 && first.status < 400 && location) return http(location, { redirect: "follow" });
    return first;
  }

  const versionOf = (tag: string) => tag.slice(options.prefix.length);
  const ours = (r: GitHubRelease) => r.tag_name.startsWith(options.prefix) && SEMVER.test(versionOf(r.tag_name));

  async function releaseList(): Promise<GitHubRelease[]> {
    if (list && now() - list.at < LATEST_TTL_MS) return list.value;
    const value = (await getJson<GitHubRelease[]>(`/repos/${options.repo}/releases?per_page=30`)) ?? [];
    list = { at: now(), value };
    return value;
  }

  async function readLatest(key: K): Promise<T | null> {
    const release = (await releaseList()).find(
      (r) =>
        !r.draft && !r.prerelease && ours(r) && (options.has?.(r.assets ?? [], versionOf(r.tag_name), key) ?? true),
    );
    if (!release) return null;
    const text = async (asset: GitHubAsset) => (await assetResponse(asset)).text();
    return options.read({ release, version: versionOf(release.tag_name), assets: release.assets ?? [], text }, key);
  }

  return {
    enabled: Boolean(options.token),

    /** The newest published release of this kind with what `key` needs, as `read` makes it; null when there is none. */
    async latest(key: K): Promise<T | null> {
      if (!options.token) return null;
      const cached = latest.get(key);
      if (cached && now() - cached.at < LATEST_TTL_MS) return cached.value;
      const value = await readLatest(key);
      latest.set(key, { at: now(), value });
      return value;
    },

    /** The bytes of one asset of the release of this kind and version; null when it isn't one. */
    async download(version: string, file: string): Promise<{ response: Response; name: string } | null> {
      if (!options.token || !SEMVER.test(version) || !FILE_NAME.test(file)) return null;
      const release = await getJson<GitHubRelease>(
        `/repos/${options.repo}/releases/tags/${encodeURIComponent(`${options.prefix}${version}`)}`,
      );
      if (!release || release.draft || !ours(release)) return null;
      const asset = (release.assets ?? []).find((a) => a.name === file);
      if (!asset) return null;
      const response = await assetResponse(asset);
      return response.ok ? { response, name: asset.name } : null;
    },
  };
}

/**
 * The newest `desktop-v*` release with a platform's download and checksum (and the updater bundle, when
 * signed): a release may lack a platform, which then keeps the newest one that has it.
 */
export function createDesktopReleases(options: ReleaseSource) {
  return releaseReader<DesktopRelease, DesktopTarget>({
    ...options,
    prefix: DESKTOP_TAG_PREFIX,
    has: (assets, version, target) => assets.some((a) => a.name === desktopAssets(target, version).download),
    read: async ({ release, version, assets, text }, target) => {
      const names = desktopAssets(target, version);
      const file = assets.find((a) => a.name === names.download);
      if (!file) return null;
      const sumAsset = assets.find((a) => a.name === `${names.download}.sha256`);
      const sha256 = sumAsset ? parseSha256(await text(sumAsset)) : null;
      if (!sha256) return null;
      const { notes, minVersion } = parseReleaseBody(release.body);
      const bundle = assets.find((a) => a.name === names.updater);
      const sigAsset = assets.find((a) => a.name === `${names.updater}.sig`);
      const signature = bundle && sigAsset ? (await text(sigAsset)).trim() : "";
      // On Linux the updater bundle is the AppImage, which is also a download when its checksum is there.
      const imageSum = onLinux(target) && bundle ? assets.find((a) => a.name === `${bundle.name}.sha256`) : undefined;
      const imageSha = imageSum ? parseSha256(await text(imageSum)) : null;
      return {
        version,
        url: `/api/desktop/download/${version}/${file.name}`,
        sha256,
        notes,
        publishedAt: release.published_at ?? release.created_at ?? "",
        ...(minVersion ? { minVersion } : {}),
        ...(bundle && signature
          ? { updater: { url: `/api/desktop/download/${version}/${bundle.name}`, signature } }
          : {}),
        ...(bundle && imageSha
          ? { appImage: { url: `/api/desktop/download/${version}/${bundle.name}`, sha256: imageSha } }
          : {}),
      };
    },
  });
}

/**
 * The server's own releases (`v<version>`) carry the native packages (ADR 0060 §2): `native.json`,
 * which names each computer's package with its SHA-256, and `native.json.sig`, its minisign
 * signature. The installer checks that signature with the key pinned in it, so this route needn't
 * be trusted.
 */
export const NATIVE_TAG_PREFIX = "v";
export const NATIVE_MANIFEST = "native.json";

export interface NativeRelease {
  version: string;
  /** `native.json`, byte for byte as published (the signature is over these bytes). */
  manifest: string;
  signature: string;
}

export function createNativeReleases(options: ReleaseSource) {
  const reader = releaseReader<NativeRelease, "native">({
    ...options,
    prefix: NATIVE_TAG_PREFIX,
    read: async ({ version, assets, text }) => {
      const manifest = assets.find((a) => a.name === NATIVE_MANIFEST);
      const signature = assets.find((a) => a.name === `${NATIVE_MANIFEST}.sig`);
      if (!manifest || !signature) return null;
      return { version, manifest: await text(manifest), signature: (await text(signature)).trim() };
    },
  });
  return { ...reader, latest: () => reader.latest("native") };
}

export type DesktopReleases = ReturnType<typeof createDesktopReleases>;
export type NativeReleases = ReturnType<typeof createNativeReleases>;

/** Light limits: the app checks every 6 hours; downloads are people clicking. */
const LATEST_LIMIT = { limit: 60, windowMs: 60_000 };
const DOWNLOAD_LIMIT = { limit: 20, windowMs: 60_000 };

const Latest = z
  .object({
    version: z.string().openapi({ example: "0.1.0" }),
    url: z.string().openapi({ description: "Our download URL for the platform's file (opens in the browser)." }),
    sha256: z.string(),
    notes: z.string(),
    publishedAt: z.string(),
    minVersion: z.string().optional().openapi({ description: 'Below this the app says "Atualize para continuar".' }),
    appImage: z
      .object({ url: z.string(), sha256: z.string() })
      .optional()
      .openapi({ description: "Linux only: the AppImage, for a distribution that takes no deb. It updates itself." }),
  })
  .openapi("DesktopRelease");

/**
 * `GET /api/desktop/latest`, `GET /api/desktop/update` (the Tauri updater) and
 * `GET /api/desktop/download/{version}/{file}` (ADR 0036 §9): public, no session;
 * 404 (204 for the updater) without `DESKTOP_RELEASES_TOKEN`.
 */
export function registerDesktopRoutes(api: OpenAPIHono, deps: AppDeps, releases: DesktopReleases) {
  const { rateLimiter } = deps.adapters;
  // Download links are on `PUBLIC_URL`, whatever address a request came in on.
  const base = deps.config.PUBLIC_URL.replace(/\/+$/, "");

  // The desktop app's web view (origin `tauri://localhost`) reads it with fetch: public data, no credentials.
  api.use("/desktop/latest", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-max-age": "86400",
      });
    }
    await next();
    c.res.headers.set("access-control-allow-origin", "*");
  });

  api.openapi(
    createRoute({
      method: "get",
      path: "/desktop/latest",
      tags,
      summary: "The newest desktop app build (notes, download link, minimum version)",
      request: {
        query: z.object({
          target: z.string().max(20).openapi({ example: "darwin", description: "darwin, windows or linux" }),
          arch: z.string().max(20).optional().openapi({ example: "arm64", description: "arm64 or x64" }),
        }),
      },
      responses: {
        200: json(Latest),
        404: errorResponse("No build for this target (or releases are not configured)"),
        429: errorResponse("Too many requests"),
      },
    }),
    async (c) => {
      const ip = requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
      const limit = await rateLimiter.consume(`desktop-latest:${ip}`, LATEST_LIMIT);
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
      const { target, arch } = c.req.valid("query");
      // One universal build for both Mac architectures (Rust and Node names alike); x64 or ARM64 elsewhere.
      const platform = desktopTarget(target, arch);
      const release = platform ? await releases.latest(platform).catch(() => null) : null;
      if (!release) return apiError(c, 404, "desktop.no_release", "No desktop build for this computer yet");
      const { updater: _, appImage, ...latest } = release;
      return c.json(
        {
          ...latest,
          url: `${base}${latest.url}`,
          ...(appImage ? { appImage: { ...appImage, url: `${base}${appImage.url}` } } : {}),
        },
        200,
      );
    },
  );

  // The app's updater (Rust, no web view): Tauri's format, 204 when there is nothing to install.
  // It installs only a newer version whose bundle matches the public key built into the app.
  api.get("/desktop/update", async (c) => {
    const ip = requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
    const limit = await rateLimiter.consume(`desktop-update:${ip}`, LATEST_LIMIT);
    if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
    const platform = desktopTarget(c.req.query("target"), c.req.query("arch"));
    // On Linux the updater bundle is the AppImage, which only an AppImage install takes in place: a deb (or an
    // app that doesn't say which it is, `bundle`) updates by downloading again, from `/desktop/latest`'s link.
    if (platform && onLinux(platform) && c.req.query("bundle") !== "appimage") return c.body(null, 204);
    const release = platform ? await releases.latest(platform).catch(() => null) : null;
    if (!release?.updater) return c.body(null, 204);
    return c.json(
      {
        version: release.version,
        notes: release.notes,
        pub_date: release.publishedAt,
        url: `${base}${release.updater.url}`,
        signature: release.updater.signature,
      },
      200,
    );
  });

  registerDownload(api, deps, "desktop", releases);
}

/** `GET /api/<kind>/download/{version}/{file}`: one asset of a release, streamed under our own headers. */
function registerDownload(
  api: OpenAPIHono,
  deps: AppDeps,
  kind: "desktop" | "native",
  releases: DesktopReleases | NativeReleases,
) {
  api.get(`/${kind}/download/:version/:file`, async (c) => {
    const ip = requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
    const limit = await deps.adapters.rateLimiter.consume(`${kind}-download:${ip}`, DOWNLOAD_LIMIT);
    if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
    const found = await releases.download(c.req.param("version"), c.req.param("file")).catch(() => null);
    if (!found) return apiError(c, 404, `${kind}.not_found`, "This build is not available");
    const upstream = found.response;
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "content-disposition": `attachment; filename="${found.name}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(upstream.body, { status: 200, headers });
  });
}

const NativeLatest = z
  .object({
    version: z.string().openapi({ example: "1.4.0" }),
    manifest: z.string().openapi({
      description:
        '`native.json` as published: `{ version, pgMajor, pglite, files: { "<os>-<arch>": { name, sha256, size } } }`.',
    }),
    signature: z.string().openapi({ description: "`native.json.sig`: its minisign signature (the updater's key)." }),
  })
  .openapi("NativeRelease");

/**
 * `GET /api/native/latest` and `GET /api/native/download/{version}/{file}` (ADR 0060 §2): the packages
 * of agentes.chat without Docker, for the installer. Public, no session; 404 without `DESKTOP_RELEASES_TOKEN`.
 */
export function registerNativeRoutes(api: OpenAPIHono, deps: AppDeps, releases: NativeReleases) {
  api.openapi(
    createRoute({
      method: "get",
      path: "/native/latest",
      tags: ["Native install"],
      summary: "The newest agentes.chat packages that run without Docker, and their signature",
      responses: {
        200: json(NativeLatest),
        404: errorResponse("No packages yet (or releases are not configured)"),
        429: errorResponse("Too many requests"),
      },
    }),
    async (c) => {
      const ip = requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
      const limit = await deps.adapters.rateLimiter.consume(`native-latest:${ip}`, LATEST_LIMIT);
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
      const release = await releases.latest().catch(() => null);
      if (!release) return apiError(c, 404, "native.no_release", "No packages of this version yet");
      return c.json(release, 200);
    },
  );
  registerDownload(api, deps, "native", releases);
}
