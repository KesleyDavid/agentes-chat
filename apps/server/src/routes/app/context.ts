import type { Adapters } from "@agenteschat/adapters";
import { type Config, connectorOAuthApps } from "@agenteschat/config";
import type { Database } from "@agenteschat/db";
import {
  type AiStatusDeps,
  type ConnectorTriggerDeps,
  composioConnectorsOf,
  connectOverHttp,
  ForbiddenError,
  MisconfiguredError,
  type RoutineHookConfig,
  type RoutineHookDeps,
  requireAgentDetails,
  withComposio,
} from "@agenteschat/engine";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { type Auth, type SessionUser, sessionUser, signInPageUrl } from "../../auth";
import { apiError, errorResponse, validationHook } from "../../http/errors";
import type { Logger } from "../../logger";
import type { AppExtras } from "./extras";

export interface AppDeps {
  db: Database;
  auth: Auth;
  config: Config;
  adapters: Adapters;
  /** Wakes the in-process workers after something was enqueued (lower latency than the poll interval). */
  wakeWorkers?: () => void;
  /** Backend services (see `extras.ts`). */
  extras?: AppExtras;
  log?: Logger;
}

export type AppEnv = { Variables: { user: SessionUser } };

/** Where webhook routines' addresses point and the secret their tokens derive from (ADR 0106). */
export const hookConfig = (config: Config): RoutineHookConfig => ({
  publicUrl: config.PUBLIC_URL,
  secret: config.AGENTES_SECRET,
});

/** What a webhook routine's address needs: the keys that seal its signing secret and the rate limiter too. */
export const routineHookDeps = (deps: AppDeps): RoutineHookDeps => ({
  db: deps.db,
  hooks: hookConfig(deps.config),
  keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers],
  rateLimiter: deps.adapters.rateLimiter,
  pubsub: deps.adapters.pubsub,
});

/** How routines reach a connection's service to register their connector events (ADR 0130), as connectors do. */
export const routineConnectorDeps = (deps: AppDeps): ConnectorTriggerDeps => {
  const composio = composioConnectorsOf(deps.adapters.mail);
  return {
    db: deps.db,
    keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers],
    oauthApps: connectorOAuthApps(deps.config),
    publicUrl: deps.config.PUBLIC_URL,
    http: deps.extras?.http,
    resolveHost: deps.extras?.resolveHost,
    connect: withComposio(deps.extras?.mcpConnect ?? connectOverHttp, composio),
    composio,
  };
};

/** Allowed browser origins for state-changing requests and WebSocket upgrades. */
export function allowedOrigins(config: Config): Set<string> {
  return new Set([
    new URL(config.PUBLIC_URL).origin,
    ...(config.NODE_ENV === "development" ? ["http://localhost:5173"] : []),
  ]);
}

/**
 * Header the phone app sends instead of an `Origin` (ADR 0035). A browser
 * can't send it cross-site without a CORS preflight, and no CORS rule allows it
 * (the waiting list's allows `content-type` and the bot check; the AI apps'
 * endpoints, `/mcp`, `/api/oauth/*` and their discovery, allow the MCP and
 * OAuth headers with no credentials), so it can't be forged by a web page.
 */
export const APP_CLIENT_HEADER = "x-agentes-client";
export const MOBILE_CLIENT = "mobile";

/**
 * CSRF rule for state-changing requests and WebSocket upgrades: with an
 * `Origin`, it must be one of ours; without one, only the phone app
 * (`X-Agentes-Client: mobile`) gets through. Either way the session still
 * comes from the cookie.
 */
export function requestOriginAllowed(origins: Set<string>, headers: Headers): boolean {
  const origin = headers.get("origin");
  if (origin) return origins.has(origin);
  return headers.get(APP_CLIENT_HEADER) === MOBILE_CLIENT;
}

/**
 * The app API (`/api/app/*`) is private to our own web and phone apps:
 * cookie session, CSRF protection, free to change between versions.
 * Documented in the OpenAPI document so the apps can generate a typed client.
 */
/**
 * POSTs to these paths may also be `multipart/form-data` (file uploads); the origin check still applies.
 * One list for every app router: each router's middleware runs for every `/api/app/*` request.
 */
export const MULTIPART_PATHS = [
  /\/organizations\/[^/]+\/artifacts(\/[^/]+)?\/files$/,
  /\/organizations\/[^/]+\/imports\/files$/,
  /\/organizations\/[^/]+\/channels\/[^/]+\/voice$/,
  /\/feedback\/files$/,
];
/** Multipart overhead allowed on top of an uploaded file itself. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;

export function createAppRouter(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook<AppEnv>() });
  const origins = allowedOrigins(deps.config);

  // CSRF: cookies ride along on cross-site requests, so every state-changing
  // request must come from our own origin (or the phone app, see
  // `requestOriginAllowed`) and be JSON (a plain HTML form can't send it).
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    if (!requestOriginAllowed(origins, c.req.raw.headers)) {
      return apiError(c, 403, "bad_origin", "Cross-origin request refused");
    }
    const type = c.req.header("content-type") ?? "";
    const upload =
      c.req.method === "POST" &&
      type.startsWith("multipart/form-data") &&
      MULTIPART_PATHS.some((p) => p.test(c.req.path));
    if (c.req.method !== "DELETE" && !type.startsWith("application/json") && !upload) {
      return apiError(c, 415, "unsupported_media_type", "Send JSON");
    }
    return next();
  });
  return app;
}

/** Requires a signed-in person; exposes it as `c.get("user")`. */
export function requireSession(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.get("user")) return next();
    const user = await sessionUser(auth, c.req.raw.headers);
    if (!user) return apiError(c, 401, "unauthorized", "Sign in to continue");
    c.set("user", user);
    await next();
  });
}

/** What an agent's page reads about how it works, under `/organizations/{orgId}/agents/{agentId}/{part}`. */
const AGENT_DETAIL_READS = new Set([
  "access",
  "approval-rules",
  "browser",
  "databases",
  "learned-skills",
  "mail",
  "memories",
  "merge-repositories",
  "repositories",
  "scopes",
  "skills",
  "usage",
]);

/**
 * Before the routes that read how an agent works: only who sees its details (`requireAgentDetails`) gets them,
 * whichever route answers. `memories?about=me` stays open: what it learned from the viewer is theirs to see.
 */
export function agentDetailsGate(deps: Pick<AppDeps, "auth" | "db">) {
  const session = requireSession(deps.auth);
  return createMiddleware<AppEnv>(async (c, next) => {
    const orgId = c.req.param("orgId");
    const agentId = c.req.param("agentId");
    const part = c.req.param("part");
    if (
      c.req.method !== "GET" ||
      !orgId ||
      !part ||
      !AGENT_DETAIL_READS.has(part) ||
      !z.uuid().safeParse(agentId).success ||
      (part === "memories" && c.req.query("about") === "me")
    ) {
      return next();
    }
    return session(c, async () => {
      await requireAgentDetails(deps.db, c.get("user").id, orgId, agentId as string);
      await next();
    });
  });
}

/** The sign-in page, coming back to this request's address once signed in. */
export function signInPage(publicUrl: string, requestUrl: string) {
  const { pathname, search } = new URL(requestUrl);
  return signInPageUrl(publicUrl, { redirect: pathname + search });
}

/**
 * Before `requireSession` on a browser navigation that needs a session (a provider's return from installing or
 * connecting): with none in this browser, the sign-in page first, and the return finishes once signed in. Never the
 * API's JSON 401 on screen.
 */
export function signInFirst(auth: Auth, publicUrl: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user") ?? (await sessionUser(auth, c.req.raw.headers));
    if (!user) return c.redirect(signInPage(publicUrl, c.req.url), 302);
    c.set("user", user);
    await next();
  });
}

/**
 * Why a provider's return (`?connector_error=`, `?github_app_error=`) failed, as a code the app says
 * (`oauthReturnText`): never the error's own message. `refusals`: codes that go back as they are. "misconfigured":
 * the provider refused this server's own OAuth app, which no retry fixes. "failed" is anything else.
 */
export function oauthFailure(error: unknown, refusals: readonly string[] = []): string {
  if (error instanceof MisconfiguredError) return "misconfigured";
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && refusals.includes(code)) return code;
  if (code === "oauth.link_expired") return "expired";
  if (code === "oauth.link_used") return "used";
  if (code === "oauth.other_account") return "other_account";
  if (code === "github_app.not_visible") return "not_visible";
  if (code === "github_app.other_workspace") return "other_workspace";
  if (code === "github_app.installed_outside") return "installed_outside";
  if (code === "github_app.owner_required") return "owner_required";
  if (code === "github_app.owner_unknown") return "owner_unknown";
  return error instanceof ForbiddenError ? "not_allowed" : "failed";
}

/** Back to `landing` on our site (`base`, the OAuth state's `returnTo` else "/") with why the return failed. */
export const oauthFailedUrl = (base: string, landing: string, param: string, reason: string) =>
  `${base}${landing}${landing.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(reason)}`;

// ── Shared OpenAPI pieces ─────────────────────────────────────────────────────

export const security = [{ session: [] }];
export const errors = {
  400: errorResponse("Invalid request"),
  401: errorResponse("Not signed in"),
  403: errorResponse("Not allowed"),
  404: errorResponse("Not found"),
  409: errorResponse("Conflict"),
};
export const json = <T extends z.ZodType>(schema: T, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
export const OrgParams = z.object({ orgId: z.uuid().openapi({ param: { name: "orgId", in: "path" } }) });
export const noContent = { 204: { description: "Done" } };

export const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A person's key tests per hour: more than any real setup, too few to sort a list of stolen keys into live and dead. */
const KEY_TESTS = { limit: 30, windowMs: 60 * 60_000 };

/** The gateway that tests a key for this person now; none past `KEY_TESTS`, and the key then saves unchecked. */
export async function keyTester(deps: AppDeps, userId: string) {
  const gateway = deps.extras?.context?.gateway;
  if (!gateway) return undefined;
  return (await deps.adapters.rateLimiter.consume(`key-test:${userId}`, KEY_TESTS)).allowed ? gateway : undefined;
}

/** What the AI status reads (`ai-status.ts`): the gateway's key check and the computers' status. */
export function aiStatusDeps(deps: AppDeps): AiStatusDeps {
  const gateway = deps.extras?.context?.gateway;
  if (!gateway) throw new Error("The model gateway isn't configured on this server");
  return { db: deps.db, gateway, machines: deps.extras?.sandbox?.machines?.hub ?? null };
}
