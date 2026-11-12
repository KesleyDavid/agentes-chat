import {
  APP_SCOPES,
  appPrincipal,
  appsUrls,
  authenticateAppBearer,
  createAppsMcpHandler,
  exchangeCode,
  type FetchAppDocument,
  mcpRequestHeaders,
  type OauthDeps,
  refreshTokens,
  registerApp,
  revokeToken,
  startAuthorization,
  touchGrant,
} from "@agenteschat/engine";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { requestLimitIp } from "../http/client-ip";
import type { AppDeps } from "./app/context";

/**
 * agentes.chat as a remote MCP server for AI apps (ADR 0119): the discovery documents, this server's own OAuth 2.1
 * authorization server (`/api/oauth/*`) and the MCP endpoint (`/mcp`). One origin for all of them: Claude drops
 * `Authorization` on a cross-host redirect.
 */

/** The largest MCP request body. */
export const MCP_MAX_BODY = 128 * 1024;
const REGISTER_MAX_BODY = 16 * 1024;
/** A token or revocation form: a few short fields, read before anything says who is asking. */
const FORM_MAX_BODY = 64 * 1024;
const formLimit = bodyLimit({
  maxSize: FORM_MAX_BODY,
  onError: (c) => oauthError(c, 413, "invalid_request", "Body too large"),
});

const LIMITS = {
  authorize: { limit: 30, windowMs: 60_000 },
  registerIp: { limit: 60, windowMs: 3600_000 },
  registerTotal: { limit: 2000, windowMs: 3600_000 },
  tokenFailures: { limit: 30, windowMs: 60_000 },
  refreshes: { limit: 60, windowMs: 3600_000 },
  mcpMinute: { limit: 120, windowMs: 60_000 },
  mcpDay: { limit: 5000, windowMs: 86_400_000 },
};

/** Open to any origin, without credentials: MCP Inspector and vscode.dev call from a browser. `x-agentes-client` is never allowed. */
const publicCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: [
    "Authorization",
    "Content-Type",
    "Mcp-Protocol-Version",
    "Mcp-Session-Id",
    "Mcp-Method",
    "Mcp-Name",
    "Last-Event-ID",
  ],
  exposeHeaders: ["WWW-Authenticate", "Retry-After"],
  maxAge: 600,
});

export interface AppsRouteOptions {
  version: string;
  /** Fetches an app's metadata document (CIMD); swapped in tests. */
  fetchDocument?: FetchAppDocument;
}

const oauthDeps = (deps: AppDeps, options: AppsRouteOptions): OauthDeps => ({
  db: deps.db,
  publicUrl: deps.config.PUBLIC_URL,
  fetchDocument: options.fetchDocument,
  admitRefresh: async (grantId) =>
    (await deps.adapters.rateLimiter.consume(`oauth:refresh:${grantId}`, LIMITS.refreshes)).allowed,
});

const noStore = { "cache-control": "no-store", pragma: "no-cache" };

const oauthError = (c: Context, status: 400 | 401 | 413 | 415 | 429 | 500, error: string, description?: string) =>
  c.json({ error, ...(description ? { error_description: description } : {}) }, status, noStore);

/** The discovery documents and the MCP endpoint, on the root app (before the web app's fallback). */
export function registerAppsRoot(app: OpenAPIHono, deps: AppDeps, options: AppsRouteOptions) {
  const urls = appsUrls(deps.config.PUBLIC_URL);
  const protectedResource = {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...APP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "agentes.chat",
    resource_documentation: urls.docs,
  };
  const authorizationServer = {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    revocation_endpoint: urls.revoke,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...APP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
  const cached = { "cache-control": "public, max-age=3600" };
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    app.use(path, publicCors);
    const body = path.includes("protected-resource") ? protectedResource : authorizationServer;
    app.get(path, (c) => c.json(body, 200, cached));
  }

  const challenge = `Bearer resource_metadata="${urls.resourceMetadata}", scope="${APP_SCOPES.join(" ")}"`;
  const serve = mcpHandler(deps, options.version);

  // With and without the trailing slash people paste: the resource matching accepts both.
  for (const path of ["/mcp", "/mcp/"]) {
    app.use(path, publicCors);
    app.on(["GET", "DELETE", "PUT", "PATCH"], path, (c) =>
      c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed." } }, 405, {
        allow: "POST",
      }),
    );
    app.post(
      path,
      bodyLimit({
        maxSize: MCP_MAX_BODY,
        onError: (c) =>
          c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }, 413),
      }),
      async (c) => {
        const text = await c.req.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        // MCP dropped JSON-RPC batches in 2025-06-18, and one request has to be one call for the rate limits.
        if (Array.isArray(parsed))
          return c.json(
            { jsonrpc: "2.0", id: null, error: { code: -32600, message: "JSON-RPC batches are not supported" } },
            400,
          );
        const id = parsed && typeof parsed === "object" ? ((parsed as { id?: unknown }).id ?? null) : null;
        const row = await authenticateAppBearer(deps.db, c.req.header("authorization"));
        const unauthorized = () =>
          c.json(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32010,
                message: "Authorization required",
                data: { www_authenticate: challenge },
                _meta: { "mcp/www_authenticate": challenge },
              },
            },
            401,
            { "www-authenticate": challenge },
          );
        if (!row) return unauthorized();
        for (const [suffix, rule] of [
          ["m", LIMITS.mcpMinute],
          ["d", LIMITS.mcpDay],
        ] as const) {
          const r = await deps.adapters.rateLimiter.consume(`mcp:${suffix}:${row.grant.id}`, rule);
          if (!r.allowed) {
            const retry = Math.max(1, Math.ceil((r.resetAt.getTime() - Date.now()) / 1000));
            return c.json(
              {
                jsonrpc: "2.0",
                id,
                error: { code: -32013, message: "Too many requests", data: { retry_after: retry } },
              },
              429,
              { "retry-after": String(retry) },
            );
          }
        }
        const principal = await appPrincipal(deps.db, row);
        if (!principal) return unauthorized();
        const request = new Request(c.req.url, {
          method: "POST",
          headers: mcpRequestHeaders(c.req.raw.headers, parsed),
          body: text,
          signal: c.req.raw.signal,
        });
        const res = await serve(request, principal);
        await touchGrant(deps.db, principal.grantId);
        // Buffered: ChatGPT refuses a chunked JSON answer, so it goes with a Content-Length.
        const body = await res.arrayBuffer();
        const headers = new Headers(res.headers);
        headers.delete("transfer-encoding");
        headers.set("content-length", String(body.byteLength));
        return new Response(body, { status: res.status, headers });
      },
    );
  }
}

/** The MCP handler's dependencies, from the app's. */
function mcpHandler(deps: AppDeps, version: string) {
  return createAppsMcpHandler(
    {
      db: deps.db,
      pubsub: deps.adapters.pubsub,
      rateLimiter: deps.adapters.rateLimiter,
      publicUrl: deps.config.PUBLIC_URL,
      judge: deps.extras?.context?.judge,
      talker: deps.extras?.talker,
      gifs: deps.adapters.gifs,
      context: deps.extras?.context,
      blobs: deps.extras?.artifacts?.blobs,
      wakeWorkers: deps.wakeWorkers,
      report: (error, context) => deps.log?.error("mcp tool failed", { ...context, error }),
      onRefused: (error) => deps.log?.warn("mcp request refused", { error }),
    },
    { version, maxBodyBytes: MCP_MAX_BODY },
  );
}

/** `/api/oauth/*`: authorize, token, register, revoke. Errors are always OAuth JSON, never an HTML 500. */
export function registerOauthRoutes(api: OpenAPIHono, deps: AppDeps, options: AppsRouteOptions) {
  const { rateLimiter } = deps.adapters;
  const ipOf = (c: Context) => requestLimitIp(c.req.raw.headers, deps.config.TRUSTED_PROXIES);
  const consentPage = appsUrls(deps.config.PUBLIC_URL).consentPage;
  for (const path of ["/oauth/token", "/oauth/register", "/oauth/revoke"]) api.use(path, publicCors);
  api.use("/oauth/*", async (c, next) => {
    try {
      await next();
    } catch (error) {
      deps.log?.error("oauth request failed", { path: c.req.path, error });
      c.res = oauthError(c, 500, "server_error");
    }
    if (c.error) {
      deps.log?.error("oauth request failed", { path: c.req.path, error: c.error });
      c.error = undefined;
      c.res = oauthError(c, 500, "server_error");
    }
  });

  api.get("/oauth/authorize", async (c) => {
    const limit = await rateLimiter.consume(`oauth:authorize:${ipOf(c)}`, LIMITS.authorize);
    if (!limit.allowed) return c.redirect(`${consentPage}?erro=muitas_tentativas`, 302);
    return c.redirect(await startAuthorization(oauthDeps(deps, options), c.req.query()), 302);
  });

  api.post("/oauth/token", formLimit, async (c) => {
    if (!(c.req.header("content-type") ?? "").startsWith("application/x-www-form-urlencoded"))
      return oauthError(c, 400, "invalid_request", "Send application/x-www-form-urlencoded");
    const form = Object.fromEntries(new URLSearchParams(await c.req.text()));
    const grantType = form.grant_type;
    const result =
      grantType === "authorization_code"
        ? await exchangeCode(oauthDeps(deps, options), form)
        : grantType === "refresh_token"
          ? await refreshTokens(oauthDeps(deps, options), form)
          : ({ ok: false, status: 400, error: "unsupported_grant_type", description: undefined } as const);
    if (result.ok) return c.json(result.body, 200, noStore);
    if (result.status !== 429) {
      const failures = await rateLimiter.consume(`oauth:token-fail:${ipOf(c)}`, LIMITS.tokenFailures);
      if (!failures.allowed) return oauthError(c, 429, "temporarily_unavailable", "Too many failed requests");
    }
    return oauthError(c, result.status, result.error, result.description);
  });

  api.post(
    "/oauth/register",
    bodyLimit({
      maxSize: REGISTER_MAX_BODY,
      onError: (c) => oauthError(c, 413, "invalid_client_metadata", "Body too large"),
    }),
    async (c) => {
      if (!(c.req.header("content-type") ?? "").startsWith("application/json"))
        return oauthError(c, 400, "invalid_client_metadata", "Send JSON");
      const limit = await rateLimiter.consume(`oauth:register:${ipOf(c)}`, LIMITS.registerIp);
      if (!limit.allowed) return oauthError(c, 429, "temporarily_unavailable", "Too many registrations");
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return oauthError(c, 400, "invalid_client_metadata", "Send a JSON object");
      }
      const result = await registerApp(
        deps.db,
        body,
        async () => (await rateLimiter.consume("oauth:register:total", LIMITS.registerTotal)).allowed,
      );
      if (result.ok) return c.json(result.client, 201, noStore);
      if (result.error === "rate_limited") return oauthError(c, 429, "temporarily_unavailable", result.description);
      return oauthError(c, 400, result.error, result.description);
    },
  );

  api.post("/oauth/revoke", formLimit, async (c) => {
    const type = c.req.header("content-type") ?? "";
    const form = type.startsWith("application/json")
      ? ((await c.req.json().catch(() => ({}))) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(await c.req.text()));
    await revokeToken(deps.db, typeof form.token === "string" ? form.token : "");
    return c.body(null, 200, noStore);
  });
}
