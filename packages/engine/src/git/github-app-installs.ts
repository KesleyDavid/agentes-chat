import { createHmac, timingSafeEqual } from "node:crypto";
import type { KeyWrapper } from "@agenteschat/adapters";
import { and, asc, type Database, eq, isNull, schema } from "@agenteschat/db";
import { type AuditEntry, recordAudit } from "../audit";
import { clientRefused, OAUTH_STATE_TTL_MS, type OAuthApps, syncGitHubAppConnection } from "../connectors/connections";
import { desktopReturnPath, isDesktopReturn, oauthReturnTo } from "../connectors/oauth-return";
import { randomToken, sealSecret, sha256 } from "../crypto";
import { ConflictError, ForbiddenError, MisconfiguredError, NotFoundError, ValidationError } from "../errors";
import { requirePermission } from "../organizations";
import {
  forgetInstallationTokens,
  type GitHubAppConfig,
  type GitHubHttp,
  installationOrigin,
  installationStatus,
  uninstallInstallation,
} from "./github-app";
import { forgetOrgRepositories } from "./repo-listing";

const { githubAppInstallations, oauthStates } = schema;

/** `oauth_states.connector` of the install flow (no PKCE: the install link carries none). */
export const GITHUB_APP_STATE = "github_app";

export type GitHubAppInstallation = typeof githubAppInstallations.$inferSelect;

export interface GitHubAppInstallDeps {
  db: Database;
  keyWrappers: KeyWrapper[];
  /** The server's GitHub App now (env or Settings), read on every call. */
  app: GitHubAppConfig | null;
  /** The connectors' OAuth apps: a first installation's GitHub connection takes the catalog's tool names. */
  oauthApps?: OAuthApps;
  /** GitHub's REST API; the OAuth code exchange goes to `webUrl` (tests: fakes). */
  http?: GitHubHttp & { webUrl?: string };
  now?: () => Date;
}

/** GitHub's page of an installation, where its account's admins pick the repositories it reaches. */
export const installationManageUrl = (
  i: Pick<GitHubAppInstallation, "installationId" | "accountLogin" | "accountType">,
) =>
  i.accountType === "Organization"
    ? `https://github.com/organizations/${encodeURIComponent(i.accountLogin)}/settings/installations/${i.installationId}`
    : `https://github.com/settings/installations/${i.installationId}`;

/** Public view of a binding. */
export const githubAppInstallationView = (i: GitHubAppInstallation) => ({
  id: i.id,
  installationId: i.installationId,
  accountLogin: i.accountLogin,
  accountType: i.accountType,
  repositorySelection: i.repositorySelection,
  suspended: i.suspendedAt !== null,
  manageUrl: installationManageUrl(i),
  createdAt: i.createdAt.toISOString(),
});

const http = (deps: GitHubAppInstallDeps) => ({
  fetch: deps.http?.fetch ?? fetch,
  apiUrl: deps.http?.apiUrl ?? "https://api.github.com",
  webUrl: deps.http?.webUrl ?? "https://github.com",
});

export function githubAppInstallable(app: GitHubAppConfig | null): app is GitHubAppConfig & {
  slug: string;
  clientId: string;
  clientSecret: string;
} {
  return Boolean(app?.slug && app.clientId && app.clientSecret);
}

const notConfigured = () =>
  new ValidationError("The GitHub App is not configured on this server", "github_app.not_configured");

/**
 * Starts installing the GitHub App for an organization (admins). Returns GitHub's install URL; its `state` is random,
 * single use, 10 minutes, bound to this person and organization (only its hash is stored). `returnTo`: a path on our
 * site, or the phone app's `app:connectors` (the callback then hands the return to the app). The desktop app's window
 * finishes in the browser, as it always did.
 */
export async function startGitHubAppInstall(
  deps: GitHubAppInstallDeps,
  actorId: string,
  orgId: string,
  options: { returnTo?: string } = {},
): Promise<{ installUrl: string; state: string }> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const app = deps.app;
  if (!githubAppInstallable(app)) throw notConfigured();
  const asked = oauthReturnTo(options.returnTo);
  const returnTo = isDesktopReturn(asked) ? desktopReturnPath(asked) : asked;
  const state = randomToken(32);
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  // `oauth_states` requires a sealed verifier; this flow has none, so a random one stands in.
  const sealed = await sealSecret(wrapper, randomToken(16), `oauth-state|${orgId}|${id}`);
  const at = deps.now?.() ?? new Date();
  await deps.db.insert(oauthStates).values({
    id,
    orgId,
    connector: GITHUB_APP_STATE,
    userId: actorId,
    stateHash: sha256(state),
    verifierCiphertext: sealed.ciphertext,
    wrappedDataKey: sealed.wrappedDataKey,
    kekId: sealed.kekId,
    returnTo,
    createdAt: at,
    expiresAt: new Date(at.getTime() + OAUTH_STATE_TTL_MS),
  });
  const url = new URL(`${http(deps).webUrl}/apps/${encodeURIComponent(app.slug)}/installations/new`);
  url.searchParams.set("state", state);
  return { installUrl: url.toString(), state };
}

interface UserInstallation {
  id: number;
  account?: { id?: number; login?: string; type?: string } | null;
  repository_selection?: string;
  suspended_at?: string | null;
}

const userHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "agentes.chat",
});

/** Installations of our app the person can see on GitHub (their user token). */
async function userInstallations(h: ReturnType<typeof http>, token: string): Promise<UserInstallation[]> {
  const found: UserInstallation[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await h.fetch(`${h.apiUrl}/user/installations?per_page=100&page=${page}`, {
      headers: userHeaders(token),
    });
    if (!res.ok) throw new ValidationError(`GitHub refused to list installations (${res.status})`);
    const body = (await res.json()) as { installations?: UserInstallation[] };
    const list = body.installations ?? [];
    found.push(...list);
    if (list.length < 100) break;
  }
  return found;
}

/**
 * Whether the person behind `token` owns that GitHub organization (`GET /user/memberships/orgs/{org}`). Null when
 * GitHub refuses the app the answer (403): most likely it lacks the organization permission Members: read, or the
 * organization blocked it.
 */
async function ownsOrganization(h: ReturnType<typeof http>, token: string, login: string): Promise<boolean | null> {
  const res = await h.fetch(`${h.apiUrl}/user/memberships/orgs/${encodeURIComponent(login)}`, {
    headers: userHeaders(token),
  });
  // Not affiliated with it: an outside collaborator on its repositories.
  if (res.status === 404) return false;
  if (res.status === 403) return null;
  if (!res.ok) throw new ValidationError(`GitHub didn't say who owns ${login} (${res.status})`);
  const { state: membership, role } = (await res.json().catch(() => ({}))) as { state?: unknown; role?: unknown };
  return membership === "active" && role === "admin";
}

/** GitHub's clock and ours may disagree by this much (and its `created_at` drops the milliseconds). */
const CLOCK_SKEW_MS = 2 * 60_000;

/**
 * GitHub's redirect after installing (user authorization during installation on): checks the state (exists, unused,
 * not expired, same person, still an admin), exchanges the code for the person's token and requires the installation
 * to be one they can see, a personal account's to be theirs and an organization's to be one they own — so nobody can
 * claim another account's installation by its id, or one they only read (`github_app.owner_required`;
 * `github_app.owner_unknown` when GitHub wouldn't say who owns it). Refreshing one already bound to this organization
 * links nothing new and asks no owner. Then binds it to the organization, whose GitHub it becomes when it has no
 * connection yet (ADR 0156); an installation bound to another organization is refused
 * (`github_app.other_workspace`). A new binding needs an installation GitHub made after this state was issued: one
 * made on GitHub itself, or kept there when its uninstall was refused, shows to every member of its account who reads
 * one of its repositories, so seeing it gives no right to link it (`github_app.installed_outside`). `setupAction` is
 * GitHub's `setup_action`: an `update` (an existing installation whose repositories changed) only refreshes one
 * already bound here.
 */
export async function completeGitHubAppInstall(
  deps: GitHubAppInstallDeps,
  user: { id: string },
  input: { state: string; code: string; installationId: number; setupAction?: string },
): Promise<{ installation: GitHubAppInstallation; returnTo: string }> {
  const app = deps.app;
  if (!githubAppInstallable(app)) throw notConfigured();
  const at = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select()
    .from(oauthStates)
    .where(and(eq(oauthStates.stateHash, sha256(input.state)), eq(oauthStates.connector, GITHUB_APP_STATE)));
  if (row?.usedAt) throw new ConflictError("This install link was already used", "oauth.link_used");
  if (!row || row.expiresAt <= at)
    throw new ConflictError("This install link is invalid or expired", "oauth.link_expired");
  if (row.userId !== user.id)
    throw new ForbiddenError("Finish installing with the account that started it", "oauth.other_account");
  const claimed = await deps.db
    .update(oauthStates)
    .set({ usedAt: at })
    .where(and(eq(oauthStates.id, row.id), isNull(oauthStates.usedAt)))
    .returning({ id: oauthStates.id });
  if (claimed.length === 0) throw new ConflictError("This install link was already used", "oauth.link_used");
  await requirePermission(deps.db, user.id, row.orgId, "manage_connectors");

  const h = http(deps);
  const res = await h.fetch(`${h.webUrl}/login/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: input.code,
    }).toString(),
  });
  const token = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (clientRefused(token.error)) {
    throw new MisconfiguredError(
      `GitHub refused this server's GitHub App (a wrong client id or secret): ${token.error}`,
      "github_app.misconfigured",
    );
  }
  if (!res.ok || !token.access_token) {
    throw new ValidationError(`GitHub refused the authorization: ${token.error ?? res.status}`);
  }
  const [bound] = await deps.db
    .select({ orgId: githubAppInstallations.orgId })
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.installationId, input.installationId));
  const boundHere = bound?.orgId === row.orgId;
  const seen = (await userInstallations(h, token.access_token)).find((i) => i.id === input.installationId);
  const notVisible = () =>
    new ForbiddenError("This installation isn't visible to your GitHub account", "github_app.not_visible");
  if (!seen) throw notVisible();
  // A personal account's installation shows to collaborators on its repositories too: only that account may link it.
  if (seen.account?.type === "User") {
    const me = await h.fetch(`${h.apiUrl}/user`, { headers: userHeaders(token.access_token) });
    if (!me.ok) throw new ValidationError(`GitHub didn't say who authorized (${me.status})`);
    const { id } = (await me.json()) as { id?: unknown };
    if (typeof id !== "number" || id !== seen.account.id) throw notVisible();
  } else if (!boundHere) {
    // An organization's installation shows to everyone who reads one of its repositories: only its owners link it.
    const account = seen.account?.login;
    if (!account) throw notVisible();
    const owns = await ownsOrganization(h, token.access_token, account);
    if (owns === null) {
      throw new ForbiddenError(
        "GitHub didn't say who owns that organization: this server's GitHub App needs the organization permission Members (read)",
        "github_app.owner_unknown",
        { account },
      );
    }
    if (!owns) {
      throw new ForbiddenError(`Only an owner of ${account} on GitHub can connect it`, "github_app.owner_required", {
        account,
      });
    }
  }
  const origin = await installationOrigin(app, h, input.installationId);
  if (origin === "gone") throw notVisible();
  if (!origin) throw new ValidationError("GitHub didn't say when that installation was made");
  if (origin.accountId !== seen.account?.id) throw notVisible();

  const values = {
    accountLogin: seen.account?.login ?? "",
    accountType: seen.account?.type ?? "User",
    repositorySelection: seen.repository_selection ?? "selected",
    suspendedAt: seen.suspended_at ? new Date(seen.suspended_at) : null,
    updatedAt: at,
  };
  const actor = { type: "person" as const, id: user.id };
  const installation = await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(githubAppInstallations)
      .where(eq(githubAppInstallations.installationId, input.installationId))
      .for("update");
    if (existing && existing.orgId !== row.orgId) {
      throw new ConflictError(
        "This GitHub installation is already connected to another organization",
        "github_app.other_workspace",
      );
    }
    // Unbound since it was read above: its owner was never asked.
    if (!existing && boundHere) throw new ValidationError("This installation changed meanwhile: install it again");
    const madeHere = origin.createdAt.getTime() >= row.createdAt.getTime() - CLOCK_SKEW_MS;
    if (!existing && (input.setupAction === "update" || !madeHere)) {
      throw new ForbiddenError("This installation was made outside agentes.chat", "github_app.installed_outside");
    }
    const [saved] = existing
      ? await tx
          .update(githubAppInstallations)
          .set(values)
          .where(eq(githubAppInstallations.id, existing.id))
          .returning()
      : await tx
          .insert(githubAppInstallations)
          .values({ ...values, orgId: row.orgId, installationId: input.installationId, createdByUserId: user.id })
          .returning();
    if (!saved) throw new Error("installation not saved");
    await recordAudit(tx, {
      orgId: row.orgId,
      actor,
      action: existing ? "github_app.updated" : "github_app.installed",
      target: { type: "github_app_installation", id: saved.id },
      details: { installationId: input.installationId, account: values.accountLogin },
    });
    await syncGitHubAppConnection(tx, row.orgId, actor, deps.oauthApps);
    return saved;
  });
  forgetInstallationTokens(input.installationId);
  forgetOrgRepositories(row.orgId);
  return { installation, returnTo: row.returnTo };
}

export async function listGitHubAppInstallations(db: Database, actorId: string, orgId: string) {
  await requirePermission(db, actorId, orgId, "read");
  return db
    .select()
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.orgId, orgId))
    .orderBy(asc(githubAppInstallations.createdAt));
}

/**
 * Unbinds an installation (removed here, uninstalled on GitHub, or gone when reconciled); GitHub through the app alone
 * ends with its workspace's last one. Its tokens and the workspace's repository listing are forgotten.
 */
async function unbind(db: Database, row: GitHubAppInstallation, actor: AuditEntry["actor"], action: string) {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(githubAppInstallations)
      .where(eq(githubAppInstallations.id, row.id))
      .returning({ id: githubAppInstallations.id });
    if (!gone) return;
    await recordAudit(tx, {
      orgId: row.orgId,
      actor,
      action,
      target: { type: "github_app_installation", id: row.id },
      details: { installationId: row.installationId, account: row.accountLogin },
    });
    await syncGitHubAppConnection(tx, row.orgId, actor);
  });
  forgetInstallationTokens(row.installationId);
  forgetOrgRepositories(row.orgId);
}

/**
 * Removes an installation from the organization (admins), and uninstalls the app from that GitHub account (ADR 0156,
 * best effort: it is unbound here whatever GitHub answers). `uninstalled`: false when GitHub refused or didn't answer,
 * so the person can uninstall it there.
 */
export async function removeGitHubAppInstallation(
  deps: GitHubAppInstallDeps,
  actorId: string,
  orgId: string,
  id: string,
): Promise<{ uninstalled: boolean }> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const [row] = await deps.db
    .select()
    .from(githubAppInstallations)
    .where(and(eq(githubAppInstallations.id, id), eq(githubAppInstallations.orgId, orgId)));
  if (!row) throw new NotFoundError("Installation not found");
  const app = deps.app;
  const outcome = app ? await uninstallInstallation(app, http(deps), row.installationId) : "refused";
  await unbind(deps.db, row, { type: "person", id: actorId }, "github_app.removed");
  return { uninstalled: outcome !== "refused" };
}

const reconciled = new Map<string, number>();
const RECONCILE_MS = 60_000;

/**
 * Keeps an organization's bindings in step with GitHub without a webhook (ADR 0156): each installation is asked of
 * GitHub, at most once a minute per organization. Uninstalled there: unbound, as `installation.deleted` does;
 * otherwise its account, repository selection and suspension are refreshed. No answer leaves it as it is.
 */
export async function reconcileGitHubAppInstallations(deps: GitHubAppInstallDeps, orgId: string) {
  const app = deps.app;
  const now = (deps.now?.() ?? new Date()).getTime();
  if (!app || now - (reconciled.get(orgId) ?? Number.NEGATIVE_INFINITY) < RECONCILE_MS) return;
  reconciled.set(orgId, now);
  const rows = await deps.db.select().from(githubAppInstallations).where(eq(githubAppInstallations.orgId, orgId));
  const system = { type: "system" as const, id: null };
  for (const row of rows) {
    const facts = await installationStatus(app, http(deps), row.installationId);
    if (facts === "gone") {
      await unbind(deps.db, row, system, "github_app.uninstalled");
      continue;
    }
    if (
      !facts ||
      (facts.accountLogin === row.accountLogin &&
        facts.accountType === row.accountType &&
        facts.repositorySelection === row.repositorySelection &&
        (facts.suspendedAt === null) === (row.suspendedAt === null))
    )
      continue;
    await deps.db.transaction(async (tx) => {
      await tx
        .update(githubAppInstallations)
        .set({ ...facts, updatedAt: new Date(now) })
        .where(eq(githubAppInstallations.id, row.id));
      await syncGitHubAppConnection(tx, orgId, system);
    });
    forgetInstallationTokens(row.installationId);
    forgetOrgRepositories(orgId);
  }
}

// ── Webhook (`POST /api/github-app/webhook`) ────────────────────────────────

/** `X-Hub-Signature-256: sha256=<hmac>` over the raw body, compared in constant time. */
export function validGitHubAppSignature(secret: string, body: string, given: string | null) {
  if (!given) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`);
  const actual = Buffer.from(given.trim());
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Keeps bindings in step with GitHub: `installation` deleted → unbound (and GitHub through the app alone with its
 * last one); suspend/unsuspend → `suspended_at`, as GitHub has it now when `github` can ask (a delivery sent again
 * later, as GitHub's Redeliver does, changes nothing); `installation_repositories` → repository selection.
 * Installations nobody bound are ignored (they only bind through the install flow). Returns what changed, for the
 * response.
 */
export async function handleGitHubAppWebhook(
  db: Database,
  event: string | null,
  payload: Record<string, unknown>,
  options: { now?: Date; github?: { app: GitHubAppConfig; http: GitHubHttp } } = {},
): Promise<"removed" | "suspended" | "unsuspended" | "updated" | "ignored"> {
  const now = options.now ?? new Date();
  const installation = payload.installation as { id?: unknown; repository_selection?: unknown } | undefined;
  const id = typeof installation?.id === "number" ? installation.id : null;
  if (id === null) return "ignored";
  const [bound] = await db.select().from(githubAppInstallations).where(eq(githubAppInstallations.installationId, id));
  if (!bound) return "ignored";
  const action = payload.action;
  const where = eq(githubAppInstallations.id, bound.id);
  const system = { type: "system" as const, id: null };
  const audit = (what: string) =>
    recordAudit(db, {
      orgId: bound.orgId,
      actor: system,
      action: `github_app.${what}`,
      target: { type: "github_app_installation", id: bound.id },
      details: { installationId: id, account: bound.accountLogin },
    });

  if (event === "installation" && action === "deleted") {
    await unbind(db, bound, system, "github_app.uninstalled");
    return "removed";
  }
  if (event === "installation" && (action === "suspend" || action === "unsuspend")) {
    const facts = options.github ? await installationStatus(options.github.app, options.github.http, id) : null;
    if (facts === "gone") {
      await unbind(db, bound, system, "github_app.uninstalled");
      return "removed";
    }
    const suspended = facts ? facts.suspendedAt !== null : action === "suspend";
    const said = suspended ? "suspended" : "unsuspended";
    if (suspended === (bound.suspendedAt !== null)) return said;
    await db
      .update(githubAppInstallations)
      .set({ suspendedAt: suspended ? (facts?.suspendedAt ?? now) : null, updatedAt: now })
      .where(where);
    forgetInstallationTokens(id);
    forgetOrgRepositories(bound.orgId);
    await audit(said);
    return said;
  }
  if (event === "installation_repositories" || (event === "installation" && action === "new_permissions_accepted")) {
    const selection = installation?.repository_selection;
    if (typeof selection === "string") {
      await db.update(githubAppInstallations).set({ repositorySelection: selection, updatedAt: now }).where(where);
    }
    forgetInstallationTokens(id);
    forgetOrgRepositories(bound.orgId);
    return "updated";
  }
  return "ignored";
}
