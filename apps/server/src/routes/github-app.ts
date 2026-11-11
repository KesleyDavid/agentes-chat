import { randomBytes } from "node:crypto";
import { escapeHtml } from "@agenteschat/client/lib/text";
import { connectorOAuthApps, githubAppConfig } from "@agenteschat/config";
import { eq, schema } from "@agenteschat/db";
import {
  answerGitHubNotice,
  appOAuthRedirect,
  completeGitHubAppInstall,
  convertGitHubAppManifest,
  desktopReturnPath,
  emailLocale,
  type GitHubAppInstallDeps,
  type GitHubAppSettings,
  githubAppInstallable,
  githubAppInstallationView,
  githubAppManifest,
  githubOrgAccess,
  handleGitHubAppWebhook,
  isAgentesCloud,
  isAppReturn,
  isDesktopReturn,
  issueManifestState,
  listGitHubAppInstallations,
  listOrgRepositories,
  missingGitHubAppEvents,
  NotFoundError,
  oauthReturnTo,
  peekOAuthState,
  pinnedOwner,
  queueGitHubAppEvent,
  readManifestState,
  reconcileGitHubAppInstallations,
  removeGitHubAppInstallation,
  requirePermission,
  startGitHubAppInstall,
  validGitHubAppSignature,
} from "@agenteschat/engine";
import { serverText } from "@agenteschat/i18n";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { sessionUser } from "../auth";
import { apiError, errorResponse, isExpectedError } from "../http/errors";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  noContent,
  OrgParams,
  oauthFailedUrl,
  oauthFailure,
  requireSession,
  security,
  signInFirst,
  signInPage,
} from "./app/context";
import { readWebhookText } from "./webhook-body";

const tags = ["Connectors"];

const Installation = z
  .object({
    id: z.uuid(),
    installationId: z.number().int(),
    accountLogin: z.string(),
    accountType: z.string(),
    repositorySelection: z.string(),
    suspended: z.boolean(),
    manageUrl: z
      .string()
      .openapi({ description: "GitHub's page where that account's admins choose its repositories." }),
    createdAt: z.string(),
  })
  .openapi("GitHubAppInstallation");

const Setup = z
  .object({
    source: z.enum(["env", "settings"]).nullable().openapi({
      description: "`env`: `GITHUB_APP_*`, read-only here. `settings`: made from Settings. Null: none.",
    }),
    slug: z.string().nullable(),
    htmlUrl: z.string().nullable().openapi({ description: "The app's page on GitHub." }),
    state: z.enum(["off", "ok", "invalid"]).openapi({
      description: "`invalid`: a saved app that doesn't open on this server (another `AGENTES_SECRET`).",
    }),
    canCreate: z.boolean().openapi({ description: "No app yet: `POST /github-app/manifest` makes one." }),
    events: z
      .object({ missing: z.array(z.string()), url: z.string() })
      .optional()
      .openapi({
        description:
          "The events agents hear that the app isn't subscribed to on GitHub (an app made before them, or by hand), by GitHub's names, and its page there where they're ticked. Absent when it has them all, or GitHub didn't answer.",
      }),
  })
  .openapi("GitHubAppSetup");

/** The server's GitHub App now: env, else the one made from Settings (ADR 0156). */
export const githubAppOf = (deps: AppDeps) =>
  deps.extras?.githubApp ? deps.extras.githubApp.current() : githubAppConfig(deps.config);

/** What reaches the workspace's GitHub from the server: our app, its REST API, and the workspace's GitHub connection. */
export function githubAccess(deps: AppDeps) {
  return {
    get app() {
      return githubAppOf(deps);
    },
    http: { fetch: deps.extras?.http ?? fetch, apiUrl: "https://api.github.com" },
    connectors: {
      db: deps.db,
      keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers],
      oauthApps: connectorOAuthApps(deps.config),
      publicUrl: deps.config.PUBLIC_URL,
      http: deps.extras?.http,
    },
  };
}

export function githubAppInstallDeps(deps: AppDeps): GitHubAppInstallDeps {
  return {
    db: deps.db,
    keyWrappers: [deps.adapters.keyWrapper, ...deps.adapters.legacyKeyWrappers],
    get app() {
      return githubAppOf(deps);
    },
    oauthApps: connectorOAuthApps(deps.config),
    http: deps.extras?.http ? { fetch: deps.extras.http, apiUrl: "https://api.github.com" } : undefined,
  };
}

/** Limits starting the manifest flow, like the installation's other keys. */
const MANIFEST_STARTS = { limit: 10, windowMs: 60_000 };

const ownerOnly = "404 for everyone but the server's pinned owner (ADR 0073), and on agentes.chat itself.";

/**
 * Our public GitHub App (ADR 0033, 0156): organizations install it from the app, which binds the installation to them;
 * GitHub redirects back to `/api/app/github-app/callback` (user authorization during installation). Without
 * `GITHUB_APP_*`, the server's owner makes one from Settings with GitHub's manifest flow.
 */
export function githubAppRoutes(deps: AppDeps) {
  const app = createAppRouter(deps);
  const session = requireSession(deps.auth);
  // GitHub's returns are browser navigations: the sign-in page first where there's no session. The install return
  // started on the phone needs none: it only hands what GitHub sent back to the app.
  const navigation = signInFirst(deps.auth, deps.config.PUBLIC_URL);
  app.use("/organizations/*", session);
  app.use("/github-app/*", (c, next) => {
    if (c.req.path.endsWith("/github-app/callback")) return next();
    return /\/github-app\/manifest\/(start|callback)$/.test(c.req.path) ? navigation(c, next) : session(c, next);
  });
  const install = githubAppInstallDeps(deps);
  const base = deps.config.PUBLIC_URL.replace(/\/$/, "");
  const settings = deps.extras?.githubApp;

  /** The holder for the server's owner, off agentes.chat; null for anyone else. */
  const ownerSettings = async (userId: string): Promise<GitHubAppSettings | null> =>
    settings && !isAgentesCloud(deps.config.PUBLIC_URL) && (await pinnedOwner(deps.db)) === userId ? settings : null;
  const setupOf = async (holder: GitHubAppSettings) => {
    const view = await holder.view();
    const app = view.state === "ok" ? holder.current() : null;
    const events = app ? await missingGitHubAppEvents(app, githubAccess(deps).http) : null;
    return { ...view, canCreate: view.source === null, ...(events ? { events } : {}) };
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/github-app",
      tags,
      security,
      summary: "The GitHub App: whether it can be installed here, this organization's installations, the server's app",
      description: `Installations are checked with GitHub first, at most once a minute per organization: one uninstalled there is gone here. \`setup\`: the server's own app, for its pinned owner only (null for anyone else, and on agentes.chat). \`ownerCreates\`: the server has no app and its owner can make one in Settings, so the admins can be told who to ask (false on agentes.chat).`,
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            installable: z.boolean(),
            installations: z.array(Installation),
            setup: Setup.nullable(),
            ownerCreates: z.boolean(),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const userId = c.get("user").id;
      const { orgId } = c.req.valid("param");
      await requirePermission(deps.db, userId, orgId, "read");
      await reconcileGitHubAppInstallations(install, orgId).catch((error: unknown) =>
        deps.log?.warn("github app reconcile failed", { error }),
      );
      const rows = await listGitHubAppInstallations(deps.db, userId, orgId);
      const holder = await ownerSettings(userId);
      const ownerCreates =
        settings !== undefined && !isAgentesCloud(deps.config.PUBLIC_URL) && (await settings.view()).source === null;
      return c.json(
        {
          installable: githubAppInstallable(install.app),
          installations: rows.map(githubAppInstallationView),
          setup: holder ? await setupOf(holder) : null,
          ownerCreates,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/github-app/install",
      tags,
      security,
      summary: "Start installing the GitHub App (admins); open the returned URL",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            returnTo: z.string().max(500).optional().openapi({
              description:
                'Path to land on afterwards; "app:connectors" from the phone app (the callback hands the return back to the app, which finishes with `…/github-app/complete`).',
            }),
          }),
        ),
      },
      responses: { 200: json(z.object({ installUrl: z.string() })), ...errors },
    }),
    async (c) => {
      const { installUrl } = await startGitHubAppInstall(
        install,
        c.get("user").id,
        c.req.valid("param").orgId,
        c.req.valid("json"),
      );
      return c.json({ installUrl }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/github-app/complete",
      tags,
      security,
      summary: "Finish installing the GitHub App the phone app started (admins)",
      description:
        "The phone app opened the install link in the system browser (`returnTo: \"app:connectors\"`); the callback handed `state`, `code` and `installation_id` back to the app, which sends them here with its own session. The state must be this person's and this organization's, unused and not expired. Refusals as on the web: `github_app.not_visible`, `github_app.other_workspace` (409), `github_app.installed_outside`, `github_app.owner_required` (an organization's installation, by someone who doesn't own it on GitHub), `github_app.owner_unknown` (GitHub refused to say who owns it, a 403: most likely the server's app lacks Members: read), `oauth.other_account`, and `github_app.misconfigured` (500: GitHub refused this server's app, reported as an error).",
      request: {
        params: OrgParams,
        body: body(
          z.object({
            state: z.string().min(1).max(200),
            code: z.string().min(1).max(2000),
            installationId: z.number().int().positive(),
          }),
        ),
      },
      responses: { 200: json(z.object({ installation: Installation })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const input = c.req.valid("json");
      const started = await peekOAuthState(deps, input.state);
      // Another organization's, the web's or an unknown state reads as not found: nothing about it leaks.
      if (!started || started.orgId !== orgId || !isAppReturn(started.returnTo)) {
        throw new NotFoundError("This install link is invalid or expired", "oauth.link_expired");
      }
      const { installation } = await completeGitHubAppInstall(install, c.get("user"), input);
      return c.json({ installation: githubAppInstallationView(installation) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/github-app/installations/{installationId}",
      tags,
      security,
      summary: "Remove an installation from this organization, and uninstall the app from that GitHub account",
      description:
        "Removed here whatever GitHub answers. `uninstalled`: false when GitHub refused or didn't answer, so the person can uninstall it on GitHub. The organization's last installation ends GitHub through the app alone.",
      request: { params: OrgParams.extend({ installationId: z.uuid() }) },
      responses: { 200: json(z.object({ uninstalled: z.boolean() })), ...errors },
    }),
    async (c) => {
      const { orgId, installationId } = c.req.valid("param");
      return c.json(await removeGitHubAppInstallation(install, c.get("user").id, orgId, installationId), 200);
    },
  );

  const Repository = z.object({
    fullName: z.string(),
    owner: z.string(),
    name: z.string(),
    private: z.boolean(),
    updatedAt: z.string().nullable(),
  });
  const listing = {
    db: deps.db,
    connectors: githubAccess(deps).connectors,
    get app() {
      return githubAppOf(deps);
    },
    github: install.http,
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/github/repositories",
      tags,
      security,
      summary:
        "Repositories the organization's GitHub reaches (its connection and the app's installations), by account",
      request: { params: OrgParams },
      responses: {
        200: json(
          z
            .object({
              connected: z.boolean(),
              accounts: z.array(z.object({ login: z.string(), type: z.string(), repositories: z.array(Repository) })),
              truncated: z.boolean(),
            })
            .openapi("GitHubRepositories"),
        ),
        ...errors,
      },
    }),
    async (c) => c.json(await listOrgRepositories(listing, c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/github/access",
      tags,
      security,
      summary: "The GitHub organizations the connection reaches now, and GitHub's page to grant more (admins)",
      description:
        "GitHub's sign-in asks about organizations only the first time, so more of them are granted on `manageUrl`, null on an API key. `orgs` is null when GitHub didn't answer.",
      request: { params: OrgParams },
      responses: {
        200: json(
          z
            .object({ orgs: z.array(z.string()).nullable(), manageUrl: z.string().nullable() })
            .openapi("GitHubOrgAccess"),
        ),
        ...errors,
      },
    }),
    async (c) => c.json(await githubOrgAccess(listing, c.get("user").id, c.req.valid("param").orgId), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/github-app/callback",
      tags,
      security,
      summary: "GitHub's redirect after installing (browser navigation)",
      description:
        "Checks the state and that the person's GitHub account can see the installation, binds it to the organization (its GitHub when it had none), then redirects to the web app with `github_app=installed`, or `github_app_error=` `requested`, `cancelled`, `expired`, `used`, `other_account`, `not_visible`, `other_workspace`, `installed_outside`, `owner_required`, `owner_unknown`, `not_allowed`, `misconfigured` (GitHub refused this server's app: its client id or secret is wrong, which is logged as an error) or `failed`. A new binding needs an installation GitHub made after the state was issued (`installed_outside` otherwise, also for `setup_action=update` of one not bound here, and for `setup_action=install` without a state: installed from GitHub's own page). `setup_action=update` without a state (repositories changed on GitHub's own page) lands on the web app with nothing to finish. Started by the phone app: no session needed, it redirects to `agenteschat://connectors/oauth` with `state`, `code` and `installation_id` (or `error`).",
      request: {
        query: z.object({
          state: z.string().optional(),
          code: z.string().optional(),
          installation_id: z.coerce.number().int().positive().optional(),
          setup_action: z.string().optional(),
          error: z.string().optional(),
        }),
      },
      responses: { 302: { description: "Back to the web app, or to the phone app" }, ...errors },
    }),
    async (c) => {
      const q = c.req.valid("query");
      // Back where it started (its state's page) while the state can still be read, else the start.
      const started = q.state ? await peekOAuthState(deps, q.state) : null;
      // `request`: someone without rights on that GitHub account asked its owner to install; nothing to bind yet.
      const refused = q.setup_action === "request" ? "requested" : q.error ? "cancelled" : null;
      if (started && isAppReturn(started.returnTo)) {
        if (refused || !q.code || !q.installation_id) {
          return c.redirect(appOAuthRedirect({ error: refused ?? "failed" }), 302);
        }
        return c.redirect(appOAuthRedirect({ state: q.state, code: q.code, installationId: q.installation_id }), 302);
      }
      // Repositories changed on GitHub's own page (the app redirects on update): nothing of ours to finish or to fail.
      if (!q.state && q.setup_action === "update" && !q.error) return c.redirect(`${base}/`, 302);
      const fail = (reason: string) =>
        c.redirect(oauthFailedUrl(base, started?.returnTo ?? "/", "github_app_error", reason), 302);
      if (refused) return fail(refused);
      // Installed from GitHub's own page, or approved there from a request: no install of ours started it.
      if (!q.state && q.installation_id && q.setup_action === "install") return fail("installed_outside");
      if (!q.state || !q.code || !q.installation_id) return fail("failed");
      const user = c.get("user") ?? (await sessionUser(deps.auth, c.req.raw.headers));
      if (!user) return c.redirect(signInPage(deps.config.PUBLIC_URL, c.req.url), 302);
      try {
        const { returnTo } = await completeGitHubAppInstall(install, user, {
          state: q.state,
          code: q.code,
          installationId: q.installation_id,
          setupAction: q.setup_action,
        });
        const sep = returnTo.includes("?") ? "&" : "?";
        return c.redirect(`${base}${returnTo}${sep}github_app=installed`, 302);
      } catch (error) {
        const reason = oauthFailure(error);
        if (reason === "failed" || reason === "misconfigured") {
          const log = isExpectedError(error) ? deps.log?.warn : deps.log?.error;
          log?.("github app install failed", { error });
        }
        return fail(reason);
      }
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/messages/{messageId}/github-answer",
      tags,
      security,
      summary: "Ask the agent to answer what someone it doesn't answer wrote on GitHub, from its notice",
      description:
        "The id is the notice's (`meta.notice.kind` `github_event` with `refs.outside`). Anyone who reads the conversation and may talk to the agent, once: the notice changes in place (`message.created` with the same id, `refs.answeredBy`), and a new notice with that person behind it wakes the agent. 409 `github_event.answered` when someone already asked, `github_event.agent_not_here` when the agent was taken out of the conversation since; 403 `audience.*` when the agent doesn't answer this person.",
      request: { params: OrgParams.extend({ messageId: z.uuid() }) },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, messageId } = c.req.valid("param");
      await answerGitHubNotice({ db: deps.db, pubsub: deps.adapters.pubsub }, c.get("user").id, orgId, messageId);
      deps.wakeWorkers?.();
      return c.body(null, 204);
    },
  );

  // ── The server's own app, made with GitHub's manifest flow (ADR 0156) ──

  app.openapi(
    createRoute({
      method: "post",
      path: "/github-app/manifest",
      tags,
      security,
      summary: "Start creating this server's GitHub App on GitHub (the server's owner); open `startUrl`",
      description: `${ownerOnly} 409 \`github_app_env\` while \`GITHUB_APP_ID\` is set. \`startUrl\` is this server's page that sends the manifest to GitHub, valid for an hour and only for this person: GitHub creates the app under their account and comes back to \`/github-app/manifest/callback\`, which keeps it sealed and lands on \`returnTo\` with \`github_app=created\` or \`github_app_error=\`.`,
      request: {
        body: body(z.object({ returnTo: z.string().max(500).optional().openapi({ description: "Path to land on." }) })),
      },
      responses: {
        200: json(z.object({ startUrl: z.string() })),
        ...errors,
        429: errorResponse("Too many tries (`rate_limited`)"),
      },
    }),
    async (c) => {
      const user = c.get("user");
      const holder = await ownerSettings(user.id);
      if (!holder) throw new NotFoundError();
      if ((await holder.view()).source === "env") {
        return apiError(c, 409, "github_app_env", "The GitHub App is set in this server's settings (GITHUB_APP_ID).");
      }
      if (!(await deps.adapters.rateLimiter.consume(`github-app-manifest:${user.id}`, MANIFEST_STARTS)).allowed) {
        return apiError(c, 429, "rate_limited", "Too many tries. Wait a minute.");
      }
      const asked = oauthReturnTo(c.req.valid("json").returnTo);
      const returnTo = isDesktopReturn(asked) ? desktopReturnPath(asked) : asked.startsWith("/") ? asked : "/";
      const state = issueManifestState(deps.config.AGENTES_SECRET, { userId: user.id, returnTo });
      return c.json({ startUrl: `${base}/api/app/github-app/manifest/start?state=${encodeURIComponent(state)}` }, 200);
    },
  );

  /** A manifest state this person may still use: theirs, unexpired, and they still own the server here. */
  const manifestState = async (state: string | undefined, userId: string) => {
    const claims = state ? readManifestState(deps.config.AGENTES_SECRET, state) : null;
    if (!claims) return { refused: "expired" as const, returnTo: "/" };
    if (claims.userId !== userId) return { refused: "other_account" as const, returnTo: claims.returnTo };
    const holder = await ownerSettings(userId);
    if (!holder || (await holder.view()).source === "env") {
      return { refused: "not_allowed" as const, returnTo: claims.returnTo };
    }
    return { holder, returnTo: claims.returnTo };
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/github-app/manifest/start",
      tags,
      security,
      summary: "The page that sends this server's GitHub App manifest to GitHub (browser navigation)",
      description:
        "Posts the manifest to `https://github.com/settings/apps/new` by itself. Its state must be this person's (`POST /github-app/manifest`); otherwise back to the web app with `github_app_error=`.",
      request: { query: z.object({ state: z.string().max(1000).optional() }) },
      responses: {
        200: { description: "The page", content: { "text/html": { schema: z.string() } } },
        302: { description: "Back to the web app" },
        ...errors,
      },
    }),
    async (c) => {
      const user = c.get("user");
      const { state } = c.req.valid("query");
      const checked = await manifestState(state, user.id);
      if (checked.refused) {
        return c.redirect(oauthFailedUrl(base, checked.returnTo, "github_app_error", checked.refused), 302);
      }
      const [row] = await deps.db
        .select({ locale: schema.users.locale })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));
      const locale = emailLocale(row?.locale);
      const nonce = randomBytes(16).toString("base64");
      const target = `https://github.com/settings/apps/new?state=${encodeURIComponent(state ?? "")}`;
      const manifest = JSON.stringify(githubAppManifest(deps.config.PUBLIC_URL));
      const page = `<!doctype html>
<html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(serverText(locale, "githubApp.manifestPage.title"))}</title></head>
<body><form id="manifest" method="post" action="${escapeHtml(target)}"><input type="hidden" name="manifest" value="${escapeHtml(manifest)}"><button type="submit">${escapeHtml(serverText(locale, "githubApp.manifestPage.continue"))}</button></form>
<script nonce="${nonce}">document.getElementById("manifest").submit();</script></body></html>`;
      return c.html(page, 200, {
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'`,
        "referrer-policy": "no-referrer",
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/github-app/manifest/callback",
      tags,
      security,
      summary: "GitHub's redirect after creating this server's GitHub App (browser navigation)",
      description:
        "Same person and still the server's owner: GitHub's app for the code (`POST /app-manifests/{code}/conversions`) is kept sealed, then back to the web app with `github_app=created`, or `github_app_error=` `expired`, `other_account`, `not_allowed` or `failed`.",
      request: { query: z.object({ code: z.string().max(200).optional(), state: z.string().max(1000).optional() }) },
      responses: { 302: { description: "Back to the web app" }, ...errors },
    }),
    async (c) => {
      const user = c.get("user");
      const q = c.req.valid("query");
      const checked = await manifestState(q.state, user.id);
      const back = (returnTo: string, param: string, value: string) =>
        c.redirect(oauthFailedUrl(base, returnTo, param, value), 302);
      if (checked.refused) return back(checked.returnTo, "github_app_error", checked.refused);
      if (!q.code) return back(checked.returnTo, "github_app_error", "failed");
      try {
        const made = await convertGitHubAppManifest(
          install.http ?? { fetch, apiUrl: "https://api.github.com" },
          q.code,
        );
        await checked.holder.save(made, user.id);
        return back(checked.returnTo, "github_app", "created");
      } catch (error) {
        deps.log?.warn("github app manifest failed", { error });
        return back(checked.returnTo, "github_app_error", "failed");
      }
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/github-app/settings",
      tags,
      security,
      summary: "Remove this server's GitHub App made from Settings (the server's owner)",
      description: `${ownerOnly} 409 \`github_app_env\` while \`GITHUB_APP_ID\` is set. Every workspace stops reaching GitHub through it at once; the app stays on GitHub. Recorded in every workspace's audit log.`,
      responses: { 200: json(Setup), 401: errors[401], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const user = c.get("user");
      const holder = await ownerSettings(user.id);
      if (!holder) throw new NotFoundError();
      await holder.remove(user.id);
      return c.json(await setupOf(holder), 200);
    },
  );
  return app;
}

/**
 * `POST /api/github-app/webhook`: GitHub's events for our app (public). Nothing is read from the payload before its
 * signature (the app's webhook secret, env or made from Settings) checks out.
 */
export function registerGitHubAppWebhook(api: OpenAPIHono, deps: AppDeps) {
  api.post("/github-app/webhook", async (c) => {
    const app = githubAppOf(deps);
    const secret = app?.webhookSecret;
    if (!app || !secret) return c.json({ error: "not configured" }, 404);
    const raw = await readWebhookText(c.req.raw, 5_000_000);
    if (raw === null) return c.json({ error: "too large" }, 413);
    if (!validGitHubAppSignature(secret, raw, c.req.header("x-hub-signature-256") ?? null)) {
      return c.json({ error: "invalid signature" }, 401);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const event = c.req.header("x-github-event") ?? null;
    if (event === "installation" || event === "installation_repositories") {
      const github = { app, http: githubAccess(deps).http };
      const result = await handleGitHubAppWebhook(deps.db, event, payload, { github });
      return c.json({ ok: true, result }, 202);
    }
    // What happens on the items: queued once per delivery, so GitHub hears back at once and a redelivery adds nothing.
    const delivery = c.req.header("x-github-delivery") ?? null;
    const queued = await queueGitHubAppEvent(deps.db, { event, delivery, payload, slug: app.slug });
    if (queued) deps.wakeWorkers?.();
    return c.json({ ok: true, result: queued ? "queued" : "ignored" }, 202);
  });
}
