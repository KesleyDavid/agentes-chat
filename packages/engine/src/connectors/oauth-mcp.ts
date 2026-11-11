import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { openSecret, sealSecret } from "../crypto";
import { ValidationError } from "../errors";
import { oneLine } from "../mail/text";
import { assertPublicHttpsUrl, outboundFetch, type ResolveHost } from "../net-guard";
import type { ConnectorDeps } from "./connections";

const { oauthClients, connectorConnections } = schema;

/**
 * MCP-native OAuth (MCP authorization spec): discovery from the server's
 * `401` (`WWW-Authenticate: Bearer resource_metadata=…`) or its
 * `/.well-known/oauth-protected-resource`, the authorization server's
 * metadata (RFC 8414, then OpenID discovery), Dynamic Client Registration
 * (RFC 7591), and PKCE S256 with the `resource` indicator (RFC 8707). Every
 * URL we fetch passes the SSRF guard.
 */
export interface McpOAuthDeps extends ConnectorDeps {
  resolveHost?: ResolveHost;
}

export type ServerProbe =
  /** Answered without credentials: no auth needed. */
  | { kind: "open" }
  /** Needs OAuth, and we know where. */
  | { kind: "oauth"; resource: string; issuer: string; scopes: string[] }
  /** Needs credentials we can't get by OAuth (or doesn't say): ask for an API key. */
  | { kind: "needs_key" };

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

const AUTH_METHODS: readonly string[] = ["none", "client_secret_post", "client_secret_basic"];

/** Every address here is one a server's own answers named: checked and pinned as each request connects. */
const http = (deps: McpOAuthDeps) => deps.http ?? outboundFetch({ resolveHost: deps.resolveHost });
/** The pinned fetch has no time limit of its own: a server that never answers ends the discovery here. */
const waitMs = () => AbortSignal.timeout(15_000);

async function getJson(deps: McpOAuthDeps, url: string): Promise<Record<string, unknown> | null> {
  await assertPublicHttpsUrl(url, deps.resolveHost);
  try {
    const res = await http(deps)(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: waitMs(),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The scopes a metadata document lists (`scopes_supported`; servers send anything). */
const scopesOf = (meta: { scopes_supported?: unknown } | null) => {
  const listed = meta?.scopes_supported;
  return Array.isArray(listed) ? listed.filter((x): x is string => typeof x === "string") : [];
};

/** The canonical resource URI of an MCP server (RFC 8707): no fragment, no trailing slash. */
export function canonicalResource(serverUrl: string) {
  const u = new URL(serverUrl);
  u.hash = "";
  return u.toString().replace(/\/$/, "");
}

/** One MCP address however it was typed: no trailing slash, any case (mirrors the apps' `sameServer`). */
export const serverKey = (serverUrl: string) => serverUrl.replace(/\/+$/, "").toLowerCase();

/** Asks the server who it is without credentials and reads where its OAuth lives. */
export async function probeMcpServer(deps: McpOAuthDeps, serverUrl: string): Promise<ServerProbe> {
  await assertPublicHttpsUrl(serverUrl, deps.resolveHost);
  let res: Response;
  try {
    res = await http(deps)(serverUrl, {
      method: "POST",
      redirect: "error",
      signal: waitMs(),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agentes.chat", version: "1" } },
      }),
    });
  } catch {
    throw new ValidationError("Couldn't connect to the MCP server", "connector.mcp_unreachable");
  }
  if (res.status !== 401 && res.status !== 403) {
    if (res.ok) return { kind: "open" };
    throw new ValidationError(`The MCP server answered ${res.status}`, "connector.mcp_status", { status: res.status });
  }
  const header = res.headers.get("www-authenticate") ?? "";
  const fromHeader = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  const base = new URL(serverUrl);
  const path = base.pathname.replace(/\/$/, "");
  const root = `${base.origin}/.well-known/oauth-protected-resource`;
  const candidates = [...(fromHeader ? [fromHeader] : []), `${root}${path}`, root];
  for (const url of candidates) {
    const meta = await getJson(deps, url).catch(() => null);
    const servers = meta?.authorization_servers;
    if (Array.isArray(servers) && typeof servers[0] === "string") {
      let scopes = scopesOf(meta);
      // Square lists its scopes only at the root, and refuses an authorization that asks for none.
      if (scopes.length === 0 && url !== root) {
        const top = await getJson(deps, root).catch(() => null);
        if (Array.isArray(top?.authorization_servers) && top.authorization_servers[0] === servers[0]) {
          scopes = scopesOf(top);
        }
      }
      const resource = typeof meta?.resource === "string" ? meta.resource : canonicalResource(serverUrl);
      return { kind: "oauth", resource, issuer: servers[0], scopes };
    }
  }
  // No protected-resource metadata (older servers, e.g. Atlassian or Zapier): the MCP spec's fallback
  // is an authorization server at the server's own origin.
  if (/^bearer\b/i.test(header)) {
    const meta = await authServerMetadata(deps, base.origin).catch(() => null);
    if (meta?.registration_endpoint) {
      return { kind: "oauth", resource: canonicalResource(serverUrl), issuer: base.origin, scopes: [] };
    }
  }
  return { kind: "needs_key" };
}

/** Authorization server metadata: RFC 8414 (with path insertion), then OpenID discovery. */
export async function authServerMetadata(deps: McpOAuthDeps, issuer: string): Promise<AuthServerMetadata | null> {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/$/, "");
  const candidates = [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    ...(path ? [`${u.origin}${path}/.well-known/openid-configuration`] : []),
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}/.well-known/oauth-authorization-server`,
  ];
  for (const url of candidates) {
    const meta = await getJson(deps, url).catch(() => null);
    if (meta && typeof meta.authorization_endpoint === "string" && typeof meta.token_endpoint === "string") {
      await assertPublicHttpsUrl(meta.authorization_endpoint, deps.resolveHost);
      await assertPublicHttpsUrl(meta.token_endpoint, deps.resolveHost);
      return meta as unknown as AuthServerMetadata;
    }
  }
  return null;
}

const clientAad = (orgId: string, id: string) => `oauth-client|${orgId}|${id}`;

/** It has OAuth but only takes clients it approved; `detail`: how it refused our registration, in its words. */
export interface NotApproved {
  notApproved: true;
  detail?: string;
}

/**
 * A refused registration's own words for the admin (RFC 7591 §3.2.2): its `error` and `error_description`, on one
 * line and short. Only those two fields: anything else it sends back stays out.
 */
function refusalDetail(text: string): Pick<NotApproved, "detail"> {
  let body: { error?: unknown; error_description?: unknown } | null;
  try {
    body = JSON.parse(text);
  } catch {
    return {};
  }
  const detail = oneLine(
    [body?.error, body?.error_description]
      .map((x) => (typeof x === "string" ? x.replace(/\p{Cc}/gu, " ").trim() : ""))
      .filter(Boolean)
      .join(": "),
  );
  return detail ? { detail } : {};
}

/**
 * The scope to ask for: the protected resource's, with offline_access when the authorization server lists it
 * (Vercel gives a refresh token only for it). Never offline_access alone: no scope gets the server's defaults, and
 * offline_access alone would replace them.
 */
export function oauthScope(meta: AuthServerMetadata, scopes: string[]): string | null {
  const offline = scopes.length > 0 && scopesOf(meta).includes("offline_access");
  return (offline ? [...new Set([...scopes, "offline_access"])] : scopes).join(" ") || null;
}

/**
 * The client agentes.chat registered with this issuer for this org, or a new
 * one (Dynamic Client Registration). A registration is reused only while an
 * active connection uses it: once every connection to that server is gone,
 * the server may have dropped the client (Supabase answered "Unrecognized
 * client_id"), so we register again and replace the row. Null when the server
 * doesn't offer PKCE S256 or the registration fails; `NotApproved` when it
 * has OAuth but only takes clients it approved (no registration for us, or a
 * refused one).
 */
export async function ensureOAuthClient(
  deps: McpOAuthDeps,
  orgId: string,
  issuer: string,
  meta: AuthServerMetadata,
  input: { redirectUri: string; scope: string | null },
): Promise<OAuthClientRow | NotApproved | null> {
  const [existing] = await deps.db
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.orgId, orgId), eq(oauthClients.issuer, issuer)));
  if (existing) {
    const [inUse] = await deps.db
      .select({ id: connectorConnections.id })
      .from(connectorConnections)
      .where(and(eq(connectorConnections.oauthClientId, existing.id), isNull(connectorConnections.revokedAt)))
      .limit(1);
    if (inUse) return existing;
  }
  const methods = meta.code_challenge_methods_supported;
  if (methods && !methods.includes("S256")) return null;
  const endpoint = meta.registration_endpoint;
  if (!endpoint) return { notApproved: true };
  await assertPublicHttpsUrl(endpoint, deps.resolveHost);
  const { scope } = input;
  // A public client with PKCE where it takes one (or doesn't say), else one with the secret it gives us.
  const supported = meta.token_endpoint_auth_methods_supported;
  const method =
    !Array.isArray(supported) || supported.length === 0 || supported.includes("none")
      ? "none"
      : supported.includes("client_secret_post")
        ? "client_secret_post"
        : "client_secret_basic";
  const register = async (clientName: string) => {
    const res = await http(deps)(endpoint, {
      method: "POST",
      redirect: "error",
      signal: waitMs(),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [input.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        ...(scope ? { scope } : {}),
      }),
    }).catch(() => null);
    return { res, refusal: res && !res.ok ? await res.text().catch(() => "") : "" };
  };
  let { res, refusal } = await register("agentes.chat");
  // Calendly takes only letters, digits, hyphens and spaces in a client's name. The others keep the brand's,
  // the name people see on the consent screen.
  if (res?.status === 400 && /\b(client_)?name\b/i.test(refusal)) ({ res, refusal } = await register("agentes chat"));
  // RFC 7591: 400 for a redirect URI or metadata it won't take, 401 or 403 for a registration closed to us.
  if (res && [400, 401, 403].includes(res.status)) return { notApproved: true, ...refusalDetail(refusal) };
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => ({}))) as {
    client_id?: string;
    client_secret?: string;
    token_endpoint_auth_method?: string;
  };
  if (!body.client_id) return null;
  // It may register another method than the one asked for (RFC 7591 §3.2.1): its answer is the one it checks. A
  // secret it gives for `none` without naming a method still goes, in the form, as for a client with no method stored.
  const answered = AUTH_METHODS.find((m) => m === body.token_endpoint_auth_method);
  const tokenAuthMethod = answered ?? (method === "none" && body.client_secret ? "client_secret_post" : method);
  // A new registration replaces the old one in place (same row id: old states and connections stay valid references).
  const id = existing?.id ?? crypto.randomUUID();
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const sealed = body.client_secret ? await sealSecret(wrapper, body.client_secret, clientAad(orgId, id)) : null;
  if (existing) {
    const [updated] = await deps.db
      .update(oauthClients)
      .set({
        authorizationEndpoint: meta.authorization_endpoint,
        tokenEndpoint: meta.token_endpoint,
        clientId: body.client_id,
        secretCiphertext: sealed?.ciphertext ?? null,
        wrappedDataKey: sealed?.wrappedDataKey ?? null,
        kekId: sealed?.kekId ?? null,
        scope,
        tokenAuthMethod,
      })
      .where(eq(oauthClients.id, existing.id))
      .returning();
    return updated ?? null;
  }
  const [row] = await deps.db
    .insert(oauthClients)
    .values({
      id,
      orgId,
      issuer,
      authorizationEndpoint: meta.authorization_endpoint,
      tokenEndpoint: meta.token_endpoint,
      clientId: body.client_id,
      secretCiphertext: sealed?.ciphertext ?? null,
      wrappedDataKey: sealed?.wrappedDataKey ?? null,
      kekId: sealed?.kekId ?? null,
      scope,
      tokenAuthMethod,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [raced] = await deps.db
    .select()
    .from(oauthClients)
    .where(and(eq(oauthClients.orgId, orgId), eq(oauthClients.issuer, issuer)));
  return raced ?? null;
}

export type OAuthClientRow = typeof oauthClients.$inferSelect;

/**
 * How the token endpoint knows us, by the client's method (RFC 6749 §2.3.1): the form fields and headers to add.
 * Its id alone (`none`), with the secret in the form (`client_secret_post`), or the two by HTTP Basic.
 */
export async function clientAuth(
  keyWrappers: ConnectorDeps["keyWrappers"],
  c: OAuthClientRow,
): Promise<{ form: Record<string, string>; headers: Record<string, string> }> {
  const secret =
    c.secretCiphertext && c.wrappedDataKey && c.kekId && c.tokenAuthMethod !== "none"
      ? await openSecret(
          keyWrappers,
          { ciphertext: c.secretCiphertext, wrappedDataKey: c.wrappedDataKey, kekId: c.kekId },
          clientAad(c.orgId, c.id),
        )
      : null;
  if (secret && c.tokenAuthMethod === "client_secret_basic") {
    // Each part form-encoded first (RFC 6749 §2.3.1): a server that decodes them would refuse a raw `+`, `%` or `:`.
    const [id, pass] = [c.clientId, secret].map((v) => encodeURIComponent(v).replace(/%20/g, "+"));
    return { form: {}, headers: { authorization: `Basic ${Buffer.from(`${id}:${pass}`).toString("base64")}` } };
  }
  return { form: { client_id: c.clientId, ...(secret ? { client_secret: secret } : {}) }, headers: {} };
}

export async function getOAuthClient(db: Database, id: string) {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return row ?? null;
}
