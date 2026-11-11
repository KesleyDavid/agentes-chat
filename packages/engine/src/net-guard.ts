import { lookup } from "node:dns/promises";
import type { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { OutboundAddressError } from "@agenteschat/adapters";
import { ValidationError } from "./errors";

/** Resolves a host name to its addresses (injected in tests). */
export type ResolveHost = (host: string) => Promise<string[]>;

export const resolveHostDns: ResolveHost = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

function ipv4Parts(ip: string) {
  return ip.split(".").map((p) => Number(p));
}

/**
 * The eight 16-bit groups of a valid IPv6 literal, in any notation: compressed
 * (`::`), full, or with an embedded dotted IPv4 tail. Classifying the groups (not
 * a prefix string) is what keeps the range checks from being fooled by an
 * alternate spelling of the same address, such as a hex IPv4-mapped form.
 */
type Ipv6Groups = [number, number, number, number, number, number, number, number];

function ipv6Groups(ip: string): Ipv6Groups | null {
  let s = ip;
  const dotted = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = dotted.slice(1, 5).map(Number);
    if ([b0, b1, b2, b3].some((n) => n > 255)) return null;
    s = `${s.slice(0, dotted.index + 1)}${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((x) => Number.parseInt(x, 16)));
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const groups = halves.length === 2 ? [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail] : head;
  if (groups.length !== 8 || groups.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return groups as Ipv6Groups;
}

/** Private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved addresses. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true; // can't be classified → treat as internal
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d), in any notation,
    // carry an IPv4 address the socket connects to: check it under the IPv4 rules.
    // This also catches ::1 and :: (as 0.0.0.1 and 0.0.0.0, both blocked below).
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0 || g[5] === 0xffff)) {
      return isBlockedAddress(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (incl. fd00:ec2::254)
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    return false;
  }
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ipv4Parts(ip);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return a >= 224; // multicast and reserved
  }
  return true; // not an IP at all
}

/**
 * Checks a URL a person typed for an outbound connection (custom MCP
 * servers, an org's own storage endpoint): https only, no credentials in
 * it, and neither the host nor any address it resolves to may be private,
 * loopback, link-local or a cloud metadata address (SSRF). DNS can change
 * between this check and the request; the check still stops the obvious
 * cases and every typed-in internal name.
 */
export async function assertPublicHttpsUrl(raw: string, resolve: ResolveHost = resolveHostDns): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Invalid address", "url.invalid");
  }
  if (url.protocol !== "https:") throw new ValidationError("Use an https:// address", "url.https_required");
  if (url.username || url.password)
    throw new ValidationError("The address can't have a user or password", "url.credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ValidationError("This address points to an internal network", "url.internal");
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ValidationError("This address points to an internal network", "url.internal");
    return url;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new ValidationError(`Couldn't find ${host}`, "url.not_found", { host });
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new ValidationError("This address points to an internal network", "url.internal");
  }
  return url;
}

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Name suffixes that never leave a local network: loopback, mDNS, private use and the special-use ones. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".test", ".example", ".invalid"];

/**
 * Whether a host is a public DNS name, from the name alone (nothing is resolved): dotted, not an IP
 * address, not `localhost` and under no local-only suffix. For a name others read as this server's own
 * (a Web Push contact), never as a check before connecting (`publicHostAddress` resolves).
 */
export function isPublicHostName(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (isIP(h) || !HOST_NAME.test(h)) return false;
  return !LOCAL_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * A host a person typed for a direct connection (a database): an address
 * to connect to that is not private, loopback, link-local or metadata.
 * Resolved on every new connection (DNS rebinding); the caller connects to
 * the returned address, never to the name again.
 */
export async function publicHostAddress(
  host: string,
  resolve: ResolveHost = resolveHostDns,
): Promise<{ ok: true; address: string } | { ok: false; reason: "blocked" | "unreachable" }> {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
    return { ok: false, reason: "blocked" };
  if (isIP(h)) return isBlockedAddress(h) ? { ok: false, reason: "blocked" } : { ok: true, address: h };
  if (!HOST_NAME.test(h)) return { ok: false, reason: "blocked" };
  let addresses: string[];
  try {
    addresses = await resolve(h);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const first = addresses[0];
  if (!first) return { ok: false, reason: "unreachable" };
  if (addresses.some(isBlockedAddress)) return { ok: false, reason: "blocked" };
  return { ok: true, address: first };
}

/** What `fetchPublicJson` hands back: the body and its content type, never a redirect. */
export interface PublicDocument {
  body: Buffer;
  contentType: string | undefined;
}

/**
 * The `lookup` an https request connects through: always the one address checked before. Bun's client asks with
 * `all: true` and sorts what comes back, so that form gets an array; the three-argument form throws
 * "results.sort is not a function" there and fails every fetch.
 */
export function pinnedLookup(address: string, family: number) {
  return (
    _host: string,
    options: { all?: boolean } | undefined,
    callback: (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * GETs a document from a public https address someone else named (an OAuth app's metadata document): every
 * address the name resolves to must be public, the socket connects to one of them (IPv4 first: one address is
 * pinned with no fallback, and a server without IPv6 would hang on an AAAA one), no redirect is followed, and the
 * time and the size are capped. Throws an Error whose message is a short reason.
 */
export async function fetchPublicDocument(
  url: URL,
  options: {
    maxBytes: number;
    timeoutMs: number;
    resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
  },
): Promise<PublicDocument> {
  const { request } = await import("node:https");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("not_https");
  const host = url.hostname.toLowerCase();
  if (!isPublicHostName(host)) throw new Error("host_forbidden");
  const resolve = options.resolve ?? ((h: string) => lookup(h, { all: true, verbatim: true }));
  const addresses = await resolve(host);
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address)))
    throw new Error("address_forbidden");
  const pinned = addresses.find((a) => a.family === 4) ?? (addresses[0] as { address: string; family: number });
  return new Promise<PublicDocument>((resolveDoc, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const req = request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: host,
        headers: { accept: "application/json", "user-agent": "agentes.chat" },
        lookup: pinnedLookup(pinned.address, pinned.family) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          req.destroy(new Error(status >= 300 && status < 400 ? "redirect_forbidden" : "fetch_failed"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) req.destroy(new Error("too_large"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const type = res.headers["content-type"];
          resolveDoc({ body: Buffer.concat(chunks), contentType: Array.isArray(type) ? type[0] : type });
        });
        res.on("error", fail);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), options.timeoutMs);
    req.on("error", fail);
    req.end();
  });
}

/** Every address a host resolves to, with its family (injected in tests). */
export type ResolveAddresses = (host: string) => Promise<{ address: string; family: number }[]>;

const resolveAddresses: ResolveAddresses = (host) => lookup(host, { all: true, verbatim: true });

/** Names that never leave the local network, refused without being resolved (as `assertPublicHttpsUrl` does). */
const internalName = (host: string) =>
  host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");

/** A request's body as bytes: what the guarded fetch sends (strings, bytes and form parameters). */
function bodyBytes(body: RequestInit["body"]): Uint8Array | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new TypeError("This request body isn't supported here");
}

/**
 * A `fetch` for hosts people type (a self-hosted password manager's server, ADR 0144), with `assertPublicHttpsUrl`'s
 * checks made on every request, at connect time: https only, no user or password in the address, no internal name,
 * and every address the host resolves to public (not private, loopback, link-local, metadata, CGNAT or reserved). The
 * socket connects to one of those addresses (IPv4 first, `pinnedLookup`), never to the name resolved again, so a
 * name that changes after the check (DNS rebinding) can't move it. A redirect is never followed: it fails as with
 * `redirect: "error"`, or comes back as the 3xx answer itself with `redirect: "manual"`. A refused address throws
 * `OutboundAddressError`, which callers tell from a network failure (a `TypeError`, as `fetch` throws); `signal`
 * aborts the request. Bodies: strings, bytes and form parameters.
 */
export function publicHttpsFetch(
  options: { resolve?: ResolveAddresses; request?: typeof httpsRequest } = {},
): typeof fetch {
  const resolve = options.resolve ?? resolveAddresses;
  const guarded = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new OutboundAddressError("Only https:// addresses without a user or password");
    }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (internalName(host)) throw new OutboundAddressError();
    let pinned: { address: string; family: number };
    const family = isIP(host);
    if (family) {
      if (isBlockedAddress(host)) throw new OutboundAddressError();
      pinned = { address: host, family };
    } else {
      let addresses: { address: string; family: number }[];
      try {
        addresses = await resolve(host);
      } catch {
        throw new TypeError(`Couldn't find ${host}`);
      }
      if (addresses.length === 0) throw new TypeError(`Couldn't find ${host}`);
      if (addresses.some((a) => isBlockedAddress(a.address))) throw new OutboundAddressError();
      pinned = addresses.find((a) => a.family === 4) ?? (addresses[0] as { address: string; family: number });
    }
    const body = bodyBytes(init.body);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    if (body) headers["content-length"] = String(body.byteLength);
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    const send = options.request ?? (await import("node:https")).request;
    return new Promise<Response>((resolveResponse, reject) => {
      const req = send(
        {
          protocol: "https:",
          hostname: host,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: (init.method ?? "GET").toUpperCase(),
          // The name the certificate is checked against, though the socket goes to the pinned address.
          ...(family ? {} : { servername: host }),
          headers,
          lookup: pinnedLookup(pinned.address, pinned.family) as never,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && init.redirect !== "manual") {
            res.resume();
            req.destroy();
            reject(new TypeError("A redirect isn't followed for this address"));
            return;
          }
          const out = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const v of Array.isArray(value) ? value : [value]) out.append(name, v);
          }
          // Pulled as the reader reads: a caller that stops reading (a capped body) stops the socket too.
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              res.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
                if ((controller.desiredSize ?? 0) <= 0) res.pause();
              });
              res.on("end", () => controller.close());
              res.on("error", (error) => controller.error(error));
            },
            pull() {
              res.resume();
            },
            cancel() {
              res.destroy();
            },
          });
          const empty = status === 204 || status === 205 || status === 304;
          resolveResponse(new Response(empty ? null : stream, { status, headers: out }));
        },
      );
      const onAbort = () => req.destroy(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal?.removeEventListener("abort", onAbort));
      req.on("error", (error) =>
        reject(error instanceof DOMException || error?.name === "AbortError" ? error : new TypeError(error.message)),
      );
      req.end(body ?? undefined);
    });
  };
  return guarded as typeof fetch;
}

let privateOutbound = false;

/**
 * Lets addresses a workspace names be fetched with plain `fetch`. Off unless the server turns it on at boot, where
 * its operator lets workspaces reach its own network (`allowsPrivateEndpoints`: self-hosted and closed to sign-up, or
 * `MODEL_ENDPOINTS_PRIVATE=true`).
 */
export function allowPrivateOutbound(on = true) {
  privateOutbound = on;
}

const MAX_OWN_REDIRECTS = 3;

/**
 * The `fetch` for an address a workspace's people, agents or connected servers named (a custom MCP server and its
 * token endpoint, the workspace's own bucket, a page an agent reads), never for one the operator set by env:
 * `publicHttpsFetch`, so the address is checked and pinned at every request, not only when it was saved, unless
 * `allowPrivateOutbound` is on. `ownRedirects` follows a 307 or 308 that stays on the same origin (a trailing slash,
 * a moved path), each hop checked and pinned again: what the request carries never leaves the host it was meant for.
 */
export function outboundFetch(
  options: { resolveHost?: ResolveHost; ownRedirects?: boolean; request?: typeof httpsRequest } = {},
): typeof fetch {
  if (privateOutbound) return fetch;
  const { resolveHost } = options;
  const pinned = publicHttpsFetch({
    request: options.request,
    ...(resolveHost
      ? { resolve: async (host) => (await resolveHost(host)).map((address) => ({ address, family: isIP(address) })) }
      : {}),
  });
  if (!options.ownRedirects) return pinned;
  const following = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    let at = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    for (let hop = 0; ; hop++) {
      const res = await pinned(at, { ...init, redirect: "manual" });
      const location = res.headers.get("location");
      if ((res.status !== 307 && res.status !== 308) || !location || hop >= MAX_OWN_REDIRECTS) return res;
      const next = new URL(location, at);
      if (next.origin !== at.origin) return res;
      await res.body?.cancel();
      at = next;
    }
  };
  return following as typeof fetch;
}
