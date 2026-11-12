import { createFcmPushSender } from "@agenteschat/adapters";
import { MisconfiguredError, requestLocale } from "@agenteschat/engine";
import { helpDocsUrl } from "@agenteschat/i18n/help";
import { appLocale } from "@agenteschat/i18n/locale";
import type { AgentesModule, Edition, ModuleContext } from "@agenteschat/modules";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { serveStatic } from "hono/bun";
import { requestId } from "hono/request-id";
import composeFile from "../../../docker-compose.yml" with { type: "text" };
import installScript from "../../../install.sh" with { type: "text" };
import { registerAppLinks } from "./app-links";
import { authHandler, signInPageUrl } from "./auth";
import { apiBodyLimit } from "./http/body-limit";
import { errorPages } from "./http/error-page";
import { apiError, domainErrorResponse, routeOf, validationHook } from "./http/errors";
import { createLogger, type Logger, loggedPath } from "./logger";
import { accessRoutes } from "./routes/app/access";
import { accountRoutes } from "./routes/app/account";
import { actionRoutes } from "./routes/app/actions";
import { agentImportRoutes } from "./routes/app/agent-imports";
import { agentRoutes } from "./routes/app/agents";
import { approvalRoutes } from "./routes/app/approvals";
import { appRoutes } from "./routes/app/apps";
import { artifactRoutes } from "./routes/app/artifacts";
import { auditRoutes } from "./routes/app/audit";
import { billingRoutes } from "./routes/app/billing";
import { browserRoutes } from "./routes/app/browser";
import { browserProfileRoutes } from "./routes/app/browser-profiles";
import { calendarRoutes } from "./routes/app/calendar";
import { channelRoutes } from "./routes/app/channels";
import { chatRoutes } from "./routes/app/chat";
import { connectorRoutes } from "./routes/app/connectors";
import { customConnectorRoutes } from "./routes/app/connectors-custom";
import { type AppDeps, agentDetailsGate } from "./routes/app/context";
import { dashboardRoutes } from "./routes/app/dashboards";
import { databaseRoutes } from "./routes/app/databases";
import { desktopRoutes } from "./routes/app/desktop";
import { deviceWaitRoutes } from "./routes/app/device-waits";
import { dmRoutes } from "./routes/app/dms";
import { feedbackRoutes, registerFeedbackFiles } from "./routes/app/feedback";
import { gifKeyRoutes } from "./routes/app/gif-key";
import { gifRoutes } from "./routes/app/gifs";
import { inviteRoutes } from "./routes/app/invites";
import { issueRoutes } from "./routes/app/issues";
import { jevRoutes } from "./routes/app/jev";
import { knowledgeRoutes } from "./routes/app/knowledge";
import { machineAccountRoutes } from "./routes/app/machine-accounts";
import { mailRoutes } from "./routes/app/mail";
import { managementRoutes } from "./routes/app/management";
import { memoryRoutes } from "./routes/app/memory";
import { missionRoutes } from "./routes/app/missions";
import { notificationRoutes } from "./routes/app/notifications";
import { personUsageRoutes } from "./routes/app/person-usage";
import { planUsageRoutes } from "./routes/app/plan-usage";
import { pushRoutes } from "./routes/app/push";
import { questionRoutes } from "./routes/app/questions";
import { roleRoutes } from "./routes/app/roles";
import { routineRoutes } from "./routes/app/routines";
import { sandboxRoutes } from "./routes/app/sandboxes";
import { secretRoutes } from "./routes/app/secrets";
import { skillRoutes } from "./routes/app/skills";
import { storageRoutes } from "./routes/app/storage";
import { teamWeekRoutes } from "./routes/app/team-week";
import { telemetryRoutes } from "./routes/app/telemetry";
import { threadRoutes } from "./routes/app/threads";
import { vaultRoutes } from "./routes/app/vault";
import { speechKeyRoutes, voiceRoutes } from "./routes/app/voice";
import { wikiRoutes } from "./routes/app/wiki";
import {
  createDesktopReleases,
  createNativeReleases,
  registerDesktopRoutes,
  registerNativeRoutes,
} from "./routes/desktop";
import { deviceAppRoutes, registerConnectLinkInfo, registerConnectScripts } from "./routes/devices";
import { registerGitProxy } from "./routes/git";
import { githubAppRoutes, registerGitHubAppWebhook } from "./routes/github-app";
import { registerHealth } from "./routes/health";
import { registerInstance } from "./routes/instance";
import { machineAppRoutes, registerMachinePublicRoutes } from "./routes/machines";
import { type AppsRouteOptions, registerAppsRoot, registerOauthRoutes } from "./routes/oauth";
import { pushRelayRoutes } from "./routes/push-relay";
import { registerWaitlist } from "./routes/waitlist";
import { registerRoutineHooks, registerWebhookReceiver, webhookAdminRoutes } from "./routes/webhooks";

export interface AppOptions {
  edition: Edition;
  /** The package's version; the config's `APP_VERSION` (the deploy's) takes its place when set. */
  version: string;
  modules: AgentesModule[];
  pingDatabase: () => Promise<void>;
  /** True once the server is shutting down: `/api/health` answers 503. */
  draining?: () => boolean;
  /** Needed when modules register routes. */
  moduleContext?: ModuleContext;
  /** Database, auth and adapters. Without them only system routes are mounted (some tests). */
  services?: AppDeps;
  /** AI apps (ADR 0119): how an app's metadata document is fetched; swapped in tests. */
  appsFetchDocument?: AppsRouteOptions["fetchDocument"];
  /** Directory with the built web app (Vite SPA). Skipped when absent. */
  webDir?: string;
  log?: Logger;
}

/**
 * Builds the HTTP app without starting a server, so tests can call
 * `app.request(...)` directly. The WebSocket endpoint lives next to it in
 * `Bun.serve` (see `start.ts` and `realtime/ws.ts`).
 *
 * Layout:
 * - `/api/health`         health probe
 * - `/api/instance`       public: what this server is, for the phone and desktop apps choosing a server
 * - `/api/auth/*`         Better Auth (sign-up, sign-in, sessions, OAuth callbacks)
 * - `/api/app/*`          private API of the web and phone apps (cookie session + CSRF, ADR 0035)
 * - `/api/webhooks/*`     incoming webhooks (GitHub, Sentry), signature-checked
 * - `/api/github-app/webhook` our GitHub App's events (installs, suspensions), signature-checked
 * - `/api/git/*`          git proxy for agents' computers (their own credential, ADR 0024)
 * - `/api/machines/*`     connected computers' runner: device-code connection, uploads, install.sh, a connect link's info (ADR 0025, 0036)
 * - `/api/desktop/*`      public: the desktop app's latest build and its download (ADR 0036)
 * - `/api/native/*`       public: the packages that run agentes.chat without Docker, for the installer (ADR 0060)
 * - `/api/hooks/*`        public: a webhook routine's own address (its chosen methods, ADR 0106)
 * - `/api/waitlist`       public: join the waiting list and confirm the email (the landing page, only with LANDING_URL)
 * - `/api/oauth/*`        public: the OAuth 2.1 authorization server for AI apps (ADR 0119)
 * - `/api/push-relay/v1/*` other installations' Android pushes, server to server (only with PUSH_RELAY_SERVE, ADR 0152)
 * - `/mcp`                AI apps' MCP endpoint, bearer tokens only (ADR 0119); `/.well-known/oauth-*` its discovery
 * - `/api/ws`             WebSocket (real-time)
 * - `/api/openapi.json`   OpenAPI 3.1 document; `/api/reference` interactive docs
 * - `/install`            the self-host installer, `install.sh` (`curl -fsSL <server>/install | sh`)
 * - `/i/<code>`           a new computer's installer with a connect link baked in (`/i/<code>/ps` for Windows)
 * - `/install/docker-compose.yml` the compose file of this release, which the setup downloads
 * - `/sw.js`              the web app's service worker (browser push, ADR 0071)
 * - everything else       web app (single-page app), when built
 */
const APP_CSP =
  "frame-ancestors 'none'; base-uri 'self'; frame-src 'self' blob: data: https://challenges.cloudflare.com";

export function createApp(options: AppOptions) {
  const log = options.log ?? createLogger("warn");
  const version = options.services?.config.APP_VERSION ?? options.version;
  const api = new OpenAPIHono({ defaultHook: validationHook() });
  api.openAPIRegistry.registerComponent("securitySchemes", "session", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Session cookie set by `/api/auth/sign-in/*`.",
  });

  registerHealth(api, {
    version,
    edition: options.edition,
    modules: options.modules.map((m) => m.name),
    pingDatabase: options.pingDatabase,
    draining: options.draining,
  });

  if (options.services) {
    const { auth, config, db } = options.services;
    const handleAuth = authHandler(auth, db);
    const serverError = signInPageUrl(config.PUBLIC_URL, { error: "server_error" });
    api.on(["GET", "POST"], "/auth/*", async (c) => {
      const res = await handleAuth(c.req.raw);
      // A browser's own navigation that failed on our side (an OAuth callback): the sign-in page says so, never an
      // empty 500. A request the app made itself keeps its answer.
      if (res.status >= 500 && c.req.method === "GET" && c.req.header("sec-fetch-mode") === "navigate") {
        return c.redirect(serverError, 302);
      }
      return res;
    });
    const deps: AppDeps = { log, ...options.services };
    registerInstance(api, deps, version);
    registerFeedbackFiles(api, deps);
    api.use("/app/organizations/:orgId/agents/:agentId/:part", agentDetailsGate(deps));
    api.route("/app", accountRoutes(deps));
    api.route("/app", accessRoutes(deps));
    api.route("/app", agentRoutes(deps));
    api.route("/app", chatRoutes(deps));
    api.route("/app", gifRoutes(deps));
    api.route("/app", actionRoutes(deps));
    api.route("/app", channelRoutes(deps));
    api.route("/app", approvalRoutes(deps));
    api.route("/app", appRoutes(deps));
    api.route("/app", auditRoutes(deps));
    api.route("/app", customConnectorRoutes(deps));
    api.route("/app", connectorRoutes(deps));
    api.route("/app", mailRoutes(deps, log));
    api.route("/app", databaseRoutes(deps));
    api.route("/app", managementRoutes(deps));
    api.route("/app", knowledgeRoutes(deps));
    api.route("/app", memoryRoutes(deps));
    api.route("/app", dmRoutes(deps));
    api.route("/app", questionRoutes(deps));
    api.route("/app", browserRoutes(deps));
    api.route("/app", browserProfileRoutes(deps));
    api.route("/app", desktopRoutes(deps));
    api.route("/app", notificationRoutes(deps));
    api.route("/app", pushRoutes(deps));
    api.route("/app", secretRoutes(deps));
    api.route("/app", vaultRoutes(deps));
    api.route("/app", inviteRoutes(deps));
    api.route("/app", roleRoutes(deps));
    api.route("/app", storageRoutes(deps));
    api.route("/app", billingRoutes(deps));
    api.route("/app", artifactRoutes(deps));
    api.route("/app", issueRoutes(deps));
    api.route("/app", threadRoutes(deps));
    api.route("/app", missionRoutes(deps));
    api.route("/app", wikiRoutes(deps));
    api.route("/app", routineRoutes(deps));
    api.route("/app", calendarRoutes(deps));
    api.route("/app", skillRoutes(deps));
    api.route("/app", agentImportRoutes(deps));
    api.route("/app", sandboxRoutes(deps));
    api.route("/app", machineAppRoutes(deps));
    api.route("/app", deviceWaitRoutes(deps));
    api.route("/app", deviceAppRoutes(deps));
    api.route("/app", machineAccountRoutes(deps));
    api.route("/app", planUsageRoutes(deps));
    api.route("/app", personUsageRoutes(deps));
    api.route("/app", teamWeekRoutes(deps));
    api.route("/app", dashboardRoutes(deps));
    api.route("/app", telemetryRoutes(deps));
    api.route("/app", jevRoutes(deps));
    api.route("/app", feedbackRoutes(deps));
    api.route("/app", gifKeyRoutes(deps));
    api.route("/app", speechKeyRoutes(deps));
    api.route("/app", voiceRoutes(deps));
    api.route("/app", webhookAdminRoutes(deps));
    api.route("/app", githubAppRoutes(deps));
    registerOauthRoutes(api, deps, { version, fetchDocument: options.appsFetchDocument });
    registerWebhookReceiver(api, deps);
    registerRoutineHooks(api, deps);
    registerGitHubAppWebhook(api, deps);
    registerMachinePublicRoutes(api, deps);
    registerConnectLinkInfo(api, deps);
    registerDesktopRoutes(
      api,
      deps,
      createDesktopReleases({
        token: deps.config.DESKTOP_RELEASES_TOKEN,
        repo: deps.config.DESKTOP_RELEASES_REPO,
        fetch: deps.extras?.desktopFetch,
      }),
    );
    registerNativeRoutes(
      api,
      deps,
      createNativeReleases({
        token: deps.config.DESKTOP_RELEASES_TOKEN,
        repo: deps.config.DESKTOP_RELEASES_REPO,
        fetch: deps.extras?.desktopFetch,
      }),
    );
    if (deps.config.LANDING_URL) registerWaitlist(api, deps);
    // The push relay for other installations' Android pushes (ADR 0152), with this server's Firebase account.
    if (deps.config.PUSH_RELAY_SERVE === "on") {
      const account = deps.config.FIREBASE_SERVICE_ACCOUNT;
      const fcm = account ? createFcmPushSender({ serviceAccount: account }) : null;
      const override = deps.extras?.pushRelaySender;
      const sender = override === undefined ? fcm : override;
      if (sender) {
        api.route(
          "/push-relay/v1",
          pushRelayRoutes({
            db: deps.db,
            sender,
            rateLimiter: deps.adapters.rateLimiter,
            trustedProxies: deps.config.TRUSTED_PROXIES,
            log,
          }),
        );
      }
    }
    if (deps.extras?.gitProxy) registerGitProxy(api, deps.extras.gitProxy);
  }

  for (const module of options.modules) {
    if (!module.registerRoutes) continue;
    if (!options.moduleContext) throw new Error(`module ${module.name} needs a moduleContext`);
    module.registerRoutes(api, options.moduleContext);
  }

  api.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "agentes.chat API",
      version,
      description: "Workspace where people and AI agents work together.",
    },
  });
  // The interactive explorer loads its bundle from a CDN; keep it off the production origin, where a
  // compromised CDN would run on the session's origin. The OpenAPI document itself stays available everywhere.
  if (options.services?.config.NODE_ENV !== "production") {
    api.get("/reference", Scalar({ url: "/api/openapi.json", pageTitle: "agentes.chat API" }));
  }

  const app = new OpenAPIHono();
  app.onError((error, c) => {
    const mapped = domainErrorResponse(error, c);
    if (mapped) return mapped;
    log.error("unhandled error", {
      method: c.req.method,
      path: loggedPath(c.req.path),
      route: routeOf(c),
      status: 500,
      requestId: c.get("requestId"),
      orgId: c.req.param("orgId"),
      userId: (c.var as { user?: { id: string } }).user?.id,
      error,
      stack: error.stack,
    });
    // Reported like any failure, but the apps can say what's wrong and who fixes it.
    if (error instanceof MisconfiguredError) return apiError(c, 500, error.code, error.message, error.params);
    return apiError(c, 500, "internal_error", "Something went wrong on our side");
  });
  // Ties a request's failure in the log to its report, and to what the client saw (`X-Request-Id`).
  app.use("/api/*", requestId());
  app.use("/api/*", apiBodyLimit);
  // Security headers on every response: the app may not be framed (clickjacking of approval, merge and deploy
  // cards), <base> is pinned to our own origin, and HSTS is sent where the instance is served over TLS. `frame-src`
  // keeps a frame on our pages from navigating itself to another site with what it holds: an agent's page has no
  // other way out (ADR 0019), and no policy inside the page can stop that. Frames are our own blobs (pages, PDFs)
  // and the bot check.
  const httpsPublicUrl = options.services?.config.PUBLIC_URL?.startsWith("https:") ?? false;
  app.use("*", async (c, next) => {
    await next();
    const h = c.res.headers;
    if (!h.has("x-frame-options")) h.set("x-frame-options", "DENY");
    if (!h.has("content-security-policy")) h.set("content-security-policy", APP_CSP);
    if (httpsPublicUrl && !h.has("strict-transport-security")) h.set("strict-transport-security", "max-age=63072000");
  });
  // A CDN in front may cache by the path's extension, whatever the type: without this, a private
  // answer at a path that ends like a file (a skill's `data.csv`) would be served to anyone asking.
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
  });
  // A link a person opens in a browser that the API refuses: our page, never the JSON on screen (ADR 0157).
  app.use("/api/*", errorPages(options.services?.config.PUBLIC_URL));
  app.route("/api", api);
  if (options.services) {
    registerConnectScripts(app, { log, ...options.services });
    registerAppLinks(app, options.services.config);
    registerAppsRoot(app, { log, ...options.services }, { version, fetchDocument: options.appsFetchDocument });
  }
  app.notFound((c) =>
    c.req.path.startsWith("/api/") ? apiError(c, 404, "not_found", "Route not found") : c.text("Not found", 404),
  );
  for (const path of ["/install", "/install.sh"]) {
    app.get(path, (c) =>
      c.body(installScript, 200, { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" }),
    );
  }
  // The help pages moved to the public docs site: old links (`?lang=` or the browser's language) land on the same
  // page there; the browser keeps the #section across the redirect. Vary: a 301 is cached, by browsers and by a CDN
  // in front, and without `?lang=` the target is the browser's language.
  for (const path of ["/help", "/help/", "/help/:slug"]) {
    app.get(path, (c) => {
      c.header("vary", "accept-language");
      const locale = appLocale([c.req.query("lang")], true) ?? requestLocale(c.req.header("accept-language")) ?? "en";
      return c.redirect(helpDocsUrl(c.req.param("slug"), locale), 301);
    });
  }
  // The setup downloads it into a folder that has none: this build's, from any instance.
  app.get("/install/docker-compose.yml", (c) =>
    c.body(composeFile, 200, { "content-type": "application/yaml; charset=utf-8", "cache-control": "no-store" }),
  );

  if (options.webDir) {
    const assets = serveStatic({ root: options.webDir });
    // Client-side routing: unknown non-API paths render the web app.
    const spa = serveStatic({ root: options.webDir, path: "index.html" });
    const isApi = (path: string) => path.startsWith("/api/");
    // The runner bundle (ADR 0025): always revalidated, JavaScript, and never the SPA when missing.
    app.get("/runner/*", async (c) => {
      const res = await assets(c, async () => {});
      if (!res) return c.text("Not found", 404);
      res.headers.set("cache-control", "no-cache");
      if (c.req.path.endsWith(".mjs")) res.headers.set("content-type", "text/javascript; charset=utf-8");
      return res;
    });
    // The service worker (browser push, ADR 0071): at the root so it controls the whole app, always
    // revalidated so a new deploy's worker takes over, JavaScript, and never the SPA when missing.
    app.get("/sw.js", async (c) => {
      const res = await assets(c, async () => {});
      if (!res) return c.text("Not found", 404);
      res.headers.set("cache-control", "no-cache");
      res.headers.set("content-type", "text/javascript; charset=utf-8");
      return res;
    });
    // Emails' pictures and font: fetched by mail clients and Gmail's image proxy, so readable without a
    // session and from any origin; never the SPA when missing. A changed picture gets a new name.
    app.get("/email/*", async (c) => {
      const res = await assets(c, async () => {});
      if (!res) return c.text("Not found", 404);
      res.headers.set("cache-control", "public, max-age=31536000, immutable");
      res.headers.set("access-control-allow-origin", "*");
      return res;
    });
    // Hashed build files never change: the browser (and the Mac app's window) opens them from disk.
    // index.html is always revalidated, so a new deploy shows on the next open.
    app.use("/*", async (c, next) => {
      await next();
      if (isApi(c.req.path) || !c.res.ok || c.res.headers.has("cache-control")) return;
      if (c.res.headers.get("content-type")?.startsWith("text/html")) c.res.headers.set("cache-control", "no-cache");
      else if (c.req.path.startsWith("/assets/"))
        c.res.headers.set("cache-control", "public, max-age=31536000, immutable");
    });
    app.use("/*", (c, next) => (isApi(c.req.path) ? next() : assets(c, next)));
    // A build file that isn't here (asked by a page from before a deploy) is a 404, never index.html: the boot fallback
    // and `vite:preloadError` then load the new version. No CDN keeps the 404.
    app.get("/assets/*", (c) => c.text("Not found", 404, { "cache-control": "no-store" }));
    app.get("/*", (c, next) => (isApi(c.req.path) ? next() : spa(c, next)));
  }

  return app;
}
