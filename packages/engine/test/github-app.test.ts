import { afterEach, describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { and, type Database, eq, isNull, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import {
  appRepoToken,
  appTokenForRepo,
  botIdentity,
  completeGitHubAppInstall,
  createApiKeyConnection,
  createLocalKeyWrapper,
  createOrganization,
  type GitHubAppConfig,
  type GitHubAppInstallDeps,
  handleGitHubAppWebhook,
  installationToken,
  listGitHubAppInstallations,
  MisconfiguredError,
  reconcileGitHubAppInstallations,
  removeGitHubAppInstallation,
  startGitHubAppInstall,
  ValidationError,
  validGitHubAppSignature,
} from "../src";
import { addMember, addUser, SECRET } from "./fixtures";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APP: GitHubAppConfig = {
  appId: "123",
  privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  slug: "agentes-chat",
  clientId: "Iv1.client",
  clientSecret: "client-secret",
  webhookSecret: "hook-secret",
};
const API = "https://api.github.test";
const WEB = "https://github.test";

/**
 * Fake GitHub: `repos` maps "owner/repo" → installation id; `visible` maps a user token → installation ids that user
 * can see; codes → user tokens. `lacks` lists permissions an installation wasn't granted (asking for one is a 422);
 * `gone` installations answer 404; `uninstall` is the status `DELETE /app/installations/{id}` answers. `personal` maps
 * an installation on a personal account → that account's GitHub id; `ids` maps a user token → its GitHub id. `made`
 * is when GitHub made an installation (else the moment it's asked); `moved` the account id the app sees it on, when
 * not the one people see. `roles` maps a user token → what GitHub says of it in any organization: a role (an owner's
 * `admin` when unset), `pending` (an owner who hasn't accepted yet), `none` (not a member: 404) or `refused` (the app lacks Members: read: 403).
 */
function fakeGitHub(state: {
  repos: Record<string, number>;
  visible: Record<string, number[]>;
  personal?: Record<number, number>;
  ids?: Record<string, number>;
  lacks?: string[];
  gone?: number[];
  uninstall?: number;
  bot?: number | null;
  accounts?: Record<number, { login: string; selection: string; suspended?: string }>;
  made?: Record<number, string>;
  moved?: Record<number, number>;
  roles?: Record<string, string>;
}) {
  const calls: string[] = [];
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const accountOf = (id: number) =>
    state.personal?.[id] === undefined
      ? { id: 1000 + id, login: `acct${id}`, type: "Organization" }
      : { id: state.personal[id], login: `acct${id}`, type: "User" };
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url === `${WEB}/login/oauth/access_token`) {
      const code = new URLSearchParams(String(init?.body)).get("code") ?? "";
      return code.startsWith("code-")
        ? Response.json({ access_token: `user-${code.slice(5)}` })
        : Response.json({ error: "bad_verification_code" });
    }
    const repo = /\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url);
    if (repo) {
      const id = state.repos[repo[1] as string];
      return id ? Response.json({ id }) : new Response("not found", { status: 404 });
    }
    const token = /\/app\/installations\/(\d+)\/access_tokens$/.exec(url);
    if (token) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { permissions?: Record<string, string> };
      bodies.push({ url, body });
      if (Object.keys(body.permissions ?? {}).some((p) => state.lacks?.includes(p))) {
        return Response.json(
          { message: "The permissions requested are not granted to this installation." },
          { status: 422 },
        );
      }
      return Response.json(
        { token: `ghs_${token[1]}_${calls.length}`, expires_at: new Date(Date.now() + 3600_000).toISOString() },
        { status: 201 },
      );
    }
    const installation = /\/app\/installations\/(\d+)$/.exec(url);
    if (installation) {
      const id = Number(installation[1]);
      if (method === "DELETE") return new Response(null, { status: state.uninstall ?? 204 });
      if (state.gone?.includes(id)) return new Response("not found", { status: 404 });
      const account = state.accounts?.[id] ?? { login: `acct${id}`, selection: "selected" };
      const owner = accountOf(id);
      return Response.json({
        id,
        account: { ...owner, id: state.moved?.[id] ?? owner.id, login: account.login },
        repository_selection: account.selection,
        suspended_at: account.suspended ?? null,
        created_at: state.made?.[id] ?? new Date().toISOString(),
      });
    }
    if (/\/users\/[^/]+%5Bbot%5D$/.test(url)) {
      return state.bot === null ? new Response("down", { status: 502 }) : Response.json({ id: state.bot ?? 4242 });
    }
    const auth = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
    if (url.startsWith(`${API}/user/installations`)) {
      const ids = state.visible[auth] ?? [];
      return Response.json({
        installations: ids.map((id) => ({
          id,
          account: accountOf(id),
          repository_selection: "selected",
          suspended_at: null,
        })),
      });
    }
    if (url.startsWith(`${API}/user/memberships/orgs/`)) {
      const role = state.roles?.[auth] ?? "admin";
      if (role === "none") return new Response("not found", { status: 404 });
      if (role === "refused") return new Response("Resource not accessible by integration", { status: 403 });
      if (role === "down") return new Response("down", { status: 502 });
      // An owner invited but not yet in: `pending`.
      return role === "pending"
        ? Response.json({ state: "pending", role: "admin" })
        : Response.json({ state: "active", role });
    }
    if (url === `${API}/user`) {
      const id = state.ids?.[auth];
      return id ? Response.json({ id, login: `u${id}` }) : new Response("bad credentials", { status: 401 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetch: fakeFetch, calls, bodies };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function world() {
  const t = await createTestDatabase();
  close = t.close;
  const db: Database = t.db;
  const ana = await addUser(db, "ana");
  const bia = await addUser(db, "bia");
  const { organization: orgA } = await createOrganization(db, ana.id, { name: "A" });
  const { organization: orgB } = await createOrganization(db, bia.id, { name: "B" });
  const gh = {
    repos: { "a/app": 1, "b/secret": 2, "a/tools": 1, "c/lib": 3 } as Record<string, number>,
    visible: {} as Record<string, number[]>,
    personal: {} as Record<number, number>,
    ids: {} as Record<string, number>,
    lacks: [] as string[],
    gone: [] as number[],
    uninstall: 204,
    bot: 4242 as number | null,
    accounts: {} as Record<number, { login: string; selection: string; suspended?: string }>,
    made: {} as Record<number, string>,
    moved: {} as Record<number, number>,
    roles: {} as Record<string, string>,
  };
  const fake = fakeGitHub(gh);
  let clock = Date.now();
  const deps: GitHubAppInstallDeps = {
    db,
    keyWrappers: [createLocalKeyWrapper(SECRET)],
    app: APP,
    http: { fetch: fake.fetch, apiUrl: API, webUrl: WEB },
    now: () => new Date(clock),
  };
  /** Installs `installationId` for `org` as `user` (their GitHub user can see `visible`). */
  const install = async (
    user: { id: string },
    orgId: string,
    installationId: number,
    visible = [installationId],
    setupAction?: string,
  ) => {
    const { state, installUrl } = await startGitHubAppInstall(deps, user.id, orgId, { returnTo: "/conectores" });
    expect(installUrl).toBe(`${WEB}/apps/agentes-chat/installations/new?state=${encodeURIComponent(state)}`);
    gh.visible[`user-${user.id}`] = visible;
    return completeGitHubAppInstall(deps, user, { state, code: `code-${user.id}`, installationId, setupAction });
  };
  const github = async (orgId: string) => {
    const rows = await db
      .select()
      .from(schema.connectorConnections)
      .where(and(eq(schema.connectorConnections.orgId, orgId), eq(schema.connectorConnections.connector, "github")));
    return { live: rows.filter((r) => !r.revokedAt), all: rows };
  };
  const grantsOf = (connectionId: string) =>
    db.select().from(schema.agentScopes).where(eq(schema.agentScopes.connectionId, connectionId));
  const tick = (ms: number) => {
    clock += ms;
  };
  return { db, ana, bia, orgA, orgB, gh, fake, deps, install, github, grantsOf, tick };
}

const http = (w: Awaited<ReturnType<typeof world>>) => ({ fetch: w.fake.fetch, apiUrl: API });

describe("GitHub App installations are bound to one organization", () => {
  test("tokens only for the installation the organization installed", async () => {
    const w = await world();
    const done = await w.install(w.ana, w.orgA.id, 1);
    expect(done.returnTo).toBe("/conectores");
    expect(done.installation).toMatchObject({ orgId: w.orgA.id, installationId: 1, accountLogin: "acct1" });
    await w.install(w.bia, w.orgB.id, 2);

    const read = { contents: "read" } as const;
    expect(await appTokenForRepo(APP, http(w), { db: w.db, orgId: w.orgA.id }, "a", "app", read)).toStartWith("ghs_1_");
    // Org A asking for org B's private repository: B's installation, not A's → no token.
    expect(await appTokenForRepo(APP, http(w), { db: w.db, orgId: w.orgA.id }, "b", "secret", read)).toBeNull();
    expect(await appTokenForRepo(APP, http(w), { db: w.db, orgId: w.orgB.id }, "a", "app", read)).toBeNull();
    // Installed on GitHub but bound to nobody (installed outside our flow): no token for anyone.
    w.gh.repos["c/other"] = 3;
    expect(await appTokenForRepo(APP, http(w), { db: w.db, orgId: w.orgA.id }, "c", "other", read)).toBeNull();
    expect(w.fake.calls.filter((c) => c.includes("/access_tokens"))).toHaveLength(1);
  });

  test("a workspace with nothing installed asks GitHub nothing, on any call", async () => {
    const w = await world();
    const tenant = { db: w.db, orgId: w.orgA.id };
    expect(await appRepoToken(APP, http(w), tenant, "a", "app", { contents: "read" })).toEqual({
      miss: "not_installed",
    });
    expect(w.fake.calls).toEqual([]);
  });

  test("a cached token stops when the binding goes away", async () => {
    const w = await world();
    const { installation } = await w.install(w.ana, w.orgA.id, 1);
    const tenant = { db: w.db, orgId: w.orgA.id };
    const perms = { contents: "write" } as const;
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", perms)).not.toBeNull();
    await removeGitHubAppInstallation(w.deps, w.ana.id, w.orgA.id, installation.id);
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", perms)).toBeNull();
  });

  test("the installation must be visible to the person's GitHub account", async () => {
    const w = await world();
    // Ana tries to claim installation 2 (org B's GitHub) by its id: her GitHub user can't see it.
    await expect(w.install(w.ana, w.orgA.id, 2, [1])).rejects.toMatchObject({ code: "github_app.not_visible" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toHaveLength(0);
  });

  test("a personal account's installation only by that account: a collaborator who sees it can't link it", async () => {
    const w = await world();
    w.gh.personal[5] = 900;
    w.gh.ids[`user-${w.ana.id}`] = 901;
    await expect(w.install(w.ana, w.orgA.id, 5)).rejects.toMatchObject({ code: "github_app.not_visible" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toHaveLength(0);
    w.gh.ids[`user-${w.ana.id}`] = 900;
    expect((await w.install(w.ana, w.orgA.id, 5)).installation).toMatchObject({
      installationId: 5,
      accountType: "User",
    });
  });

  test("an installation bound to another organization is refused as other_workspace", async () => {
    const w = await world();
    await w.install(w.bia, w.orgB.id, 2);
    await expect(w.install(w.ana, w.orgA.id, 2)).rejects.toMatchObject({ code: "github_app.other_workspace" });
    const [row] = await w.db
      .select()
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.installationId, 2));
    expect(row?.orgId).toBe(w.orgB.id);
    expect((await w.github(w.orgA.id)).all).toEqual([]);
  });

  test("state: unknown, someone else's, reused, or started by a non-admin", async () => {
    const w = await world();
    const code = `code-${w.ana.id}`;
    w.gh.visible[`user-${w.ana.id}`] = [1];
    await expect(completeGitHubAppInstall(w.deps, w.ana, { state: "forged", code, installationId: 1 })).rejects.toThrow(
      "invalid or expired",
    );

    const { state } = await startGitHubAppInstall(w.deps, w.ana.id, w.orgA.id);
    await expect(completeGitHubAppInstall(w.deps, w.bia, { state, code, installationId: 1 })).rejects.toThrow(
      "account that started it",
    );
    await completeGitHubAppInstall(w.deps, w.ana, { state, code, installationId: 1 });
    await expect(completeGitHubAppInstall(w.deps, w.ana, { state, code, installationId: 1 })).rejects.toMatchObject({
      code: "oauth.link_used",
    });

    const member = await addMember(w.db, w.orgA.id, "member", "caio");
    await expect(startGitHubAppInstall(w.deps, member.id, w.orgA.id)).rejects.toThrow();
  });

  test("returnTo: a path, the phone app's marker, or the desktop window's path; never another site", async () => {
    const w = await world();
    const landing = async (returnTo: string) => {
      await startGitHubAppInstall(w.deps, w.ana.id, w.orgA.id, { returnTo });
      const [row] = await w.db.select().from(schema.oauthStates).where(isNull(schema.oauthStates.usedAt));
      await w.db.delete(schema.oauthStates);
      return row?.returnTo;
    };
    expect(await landing("app:connectors")).toBe("app:connectors");
    expect(await landing("desktop:/org/x/settings/connectors")).toBe("/org/x/settings/connectors");
    expect(await landing("https://evil.example")).toBe("/");
    expect(await landing("//evil.example")).toBe("/");
  });

  test("not configured: no install link", async () => {
    const w = await world();
    await expect(startGitHubAppInstall({ ...w.deps, app: null }, w.ana.id, w.orgA.id)).rejects.toThrow(
      "not configured",
    );
  });

  test("GitHub refusing this server's client id or secret: misconfigured; a code it refused stays a refusal", async () => {
    const w = await world();
    const wrongSecret = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input) === `${WEB}/login/oauth/access_token`
        ? Response.json({
            error: "incorrect_client_credentials",
            error_description: "The client_id and/or client_secret passed are incorrect.",
          })
        : w.fake.fetch(input, init)) as typeof fetch;
    const deps = { ...w.deps, http: { fetch: wrongSecret, apiUrl: API, webUrl: WEB } };
    const { state } = await startGitHubAppInstall(deps, w.ana.id, w.orgA.id);
    const failed = await completeGitHubAppInstall(deps, w.ana, { state, code: `code-${w.ana.id}`, installationId: 1 })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(MisconfiguredError);
    expect(failed).toMatchObject({ code: "github_app.misconfigured" });
    // An expired code: GitHub's own refusal of it, which another install gets past.
    const again = await startGitHubAppInstall(w.deps, w.ana.id, w.orgA.id);
    const refused = await completeGitHubAppInstall(w.deps, w.ana, {
      state: again.state,
      code: "old",
      installationId: 1,
    })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ValidationError);
    expect(refused).not.toBeInstanceOf(MisconfiguredError);
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
  });
});

describe("an organization's installation links only for one of its owners on GitHub", () => {
  test("a member or an outside collaborator who sees a fresh installation can't link it, nor get its tokens", async () => {
    const w = await world();
    const bia = `user-${w.bia.id}`;
    // Installation 1 was just made on GitHub and shows to everyone who reads one of its repositories.
    for (const role of ["member", "none", "billing_manager", "pending"]) {
      w.gh.roles[bia] = role;
      await expect(w.install(w.bia, w.orgB.id, 1)).rejects.toMatchObject({
        code: "github_app.owner_required",
        params: { account: "acct1" },
      });
    }
    expect(w.fake.calls).toContain(`GET ${API}/user/memberships/orgs/acct1`);
    expect(await listGitHubAppInstallations(w.db, w.bia.id, w.orgB.id)).toEqual([]);
    expect((await w.github(w.orgB.id)).all).toEqual([]);
    const write = { contents: "write" } as const;
    expect(await appTokenForRepo(APP, http(w), { db: w.db, orgId: w.orgB.id }, "a", "app", write)).toBeNull();
    // Its owner still links it to their own workspace.
    expect((await w.install(w.ana, w.orgA.id, 1)).installation).toMatchObject({ orgId: w.orgA.id, installationId: 1 });
  });

  test("GitHub not saying who owns it links nothing", async () => {
    const w = await world();
    w.gh.roles[`user-${w.ana.id}`] = "refused";
    await expect(w.install(w.ana, w.orgA.id, 1)).rejects.toMatchObject({ code: "github_app.owner_unknown" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
  });

  test("GitHub failing to answer is a failure to try again, not a missing permission", async () => {
    const w = await world();
    w.gh.roles[`user-${w.ana.id}`] = "down";
    const failed = await w.install(w.ana, w.orgA.id, 1).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ValidationError);
    expect(failed).not.toMatchObject({ code: "github_app.owner_unknown" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
  });

  test("refreshing an installation already linked here asks no owner", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    for (const role of ["refused", "member"]) {
      w.gh.roles[`user-${w.ana.id}`] = role;
      expect((await w.install(w.ana, w.orgA.id, 1, [1], "update")).installation).toMatchObject({
        orgId: w.orgA.id,
        installationId: 1,
      });
    }
    // Linked to one workspace gives no way into another.
    w.gh.roles[`user-${w.bia.id}`] = "member";
    await expect(w.install(w.bia, w.orgB.id, 1, [1], "update")).rejects.toMatchObject({
      code: "github_app.owner_required",
    });
  });

  test("a personal account's installation asks nothing about organizations", async () => {
    const w = await world();
    w.gh.personal[5] = 900;
    w.gh.ids[`user-${w.ana.id}`] = 900;
    w.gh.roles[`user-${w.ana.id}`] = "none";
    await w.install(w.ana, w.orgA.id, 5);
    expect(w.fake.calls.some((c) => c.includes("/user/memberships/"))).toBe(false);
  });
});

describe("only an installation made from an install started here links (ADR 0156)", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

  test("made on GitHub before the install started: refused, whoever sees it; made after, or a minute off, links", async () => {
    const w = await world();
    // Installed on GitHub itself: every member who reads one of its repositories sees it.
    w.gh.made[1] = minutesAgo(3);
    await expect(w.install(w.ana, w.orgA.id, 1)).rejects.toMatchObject({ code: "github_app.installed_outside" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
    expect((await w.github(w.orgA.id)).all).toEqual([]);
    // GitHub's clock a minute behind ours.
    w.gh.made[3] = minutesAgo(1);
    expect((await w.install(w.ana, w.orgA.id, 3)).installation).toMatchObject({ orgId: w.orgA.id, installationId: 3 });
    expect((await w.install(w.bia, w.orgB.id, 2)).installation).toMatchObject({ orgId: w.orgB.id, installationId: 2 });
  });

  test("GitHub must answer, on the account the person sees it on", async () => {
    const w = await world();
    w.gh.moved[1] = 4242;
    await expect(w.install(w.ana, w.orgA.id, 1)).rejects.toMatchObject({ code: "github_app.not_visible" });
    w.gh.gone.push(3);
    await expect(w.install(w.ana, w.orgA.id, 3)).rejects.toMatchObject({ code: "github_app.not_visible" });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
  });

  test("an update refreshes an installation linked to this workspace, never links one", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    w.gh.made[1] = minutesAgo(60);
    const { installation } = await w.install(w.ana, w.orgA.id, 1, [1], "update");
    expect(installation).toMatchObject({ orgId: w.orgA.id, installationId: 1 });
    const audit = await w.db.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, w.orgA.id));
    expect(audit.filter((a) => a.action === "github_app.updated")).toHaveLength(1);
    // Another workspace's update of it: still the one it is linked to.
    await expect(w.install(w.bia, w.orgB.id, 1, [1], "update")).rejects.toMatchObject({
      code: "github_app.other_workspace",
    });
    // Linked nowhere, even made a moment ago: an update is of an installation that was already there.
    await expect(w.install(w.bia, w.orgB.id, 2, [2], "update")).rejects.toMatchObject({
      code: "github_app.installed_outside",
    });
    expect(await listGitHubAppInstallations(w.db, w.bia.id, w.orgB.id)).toEqual([]);
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toHaveLength(1);
  });
});

describe("the app's installation is the workspace's GitHub (ADR 0156)", () => {
  test("a first installation without a GitHub connection is one: every agent's, its accounts as the account", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    const [row] = (await w.github(w.orgA.id)).live;
    expect(row).toMatchObject({
      authType: "github_app",
      accountLabel: "acct1",
      secretCiphertext: null,
      label: "GitHub",
    });
    const agents = await w.db.select().from(schema.agents).where(eq(schema.agents.orgId, w.orgA.id));
    expect((await w.grantsOf(row?.id ?? "")).map((g) => g.scope)).toEqual(agents.map(() => "connector:*"));

    // A second account names both; GitHub stays one connection with the same grants.
    w.gh.visible[`user-${w.ana.id}`] = [1, 3];
    const { state } = await startGitHubAppInstall(w.deps, w.ana.id, w.orgA.id);
    await completeGitHubAppInstall(w.deps, w.ana, { state, code: `code-${w.ana.id}`, installationId: 3 });
    const live = (await w.github(w.orgA.id)).live;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: row?.id, accountLabel: "acct1, acct3" });
  });

  test("an account's connection stays as it is", async () => {
    const w = await world();
    const account = await createApiKeyConnection(
      { db: w.db, keyWrappers: w.deps.keyWrappers, publicUrl: "https://chat.example.com" },
      w.ana.id,
      w.orgA.id,
      { connector: "github", apiKey: "ghp_secret_123456" },
    );
    await w.install(w.ana, w.orgA.id, 1);
    expect((await w.github(w.orgA.id)).live).toMatchObject([{ id: account.id, authType: "api_key" }]);
  });

  test("removing uninstalls it from GitHub; the last one ends GitHub through the app alone", async () => {
    const w = await world();
    const { installation } = await w.install(w.ana, w.orgA.id, 1);
    const [row] = (await w.github(w.orgA.id)).live;
    expect(await removeGitHubAppInstallation(w.deps, w.ana.id, w.orgA.id, installation.id)).toEqual({
      uninstalled: true,
    });
    expect(w.fake.calls).toContain(`DELETE ${API}/app/installations/1`);
    expect((await w.github(w.orgA.id)).live).toEqual([]);
    expect(await w.grantsOf(row?.id ?? "")).toEqual([]);
    const audit = await w.db.select().from(schema.auditLog).where(eq(schema.auditLog.orgId, w.orgA.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["github_app.removed", "connector.disconnected"]),
    );
  });

  test("GitHub refusing the uninstall still removes it here, and says so; what stays there doesn't link again", async () => {
    const w = await world();
    const { installation } = await w.install(w.ana, w.orgA.id, 1);
    w.gh.uninstall = 500;
    expect(await removeGitHubAppInstallation(w.deps, w.ana.id, w.orgA.id, installation.id)).toEqual({
      uninstalled: false,
    });
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
    // Still on GitHub, made before any install started since: Bia's workspace sees it too, and can't link it.
    w.gh.made[1] = new Date(Date.now() - 10 * 60_000).toISOString();
    await expect(w.install(w.bia, w.orgB.id, 1)).rejects.toMatchObject({ code: "github_app.installed_outside" });
    // Already uninstalled there (404) is done.
    const again = await w.install(w.ana, w.orgA.id, 3);
    w.gh.uninstall = 404;
    expect(await removeGitHubAppInstallation(w.deps, w.ana.id, w.orgA.id, again.installation.id)).toEqual({
      uninstalled: true,
    });
  });

  test("reading the panel reconciles: gone on GitHub unbinds, the rest is refreshed, once a minute", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    w.gh.visible[`user-${w.ana.id}`] = [3];
    const { state } = await startGitHubAppInstall(w.deps, w.ana.id, w.orgA.id);
    await completeGitHubAppInstall(w.deps, w.ana, { state, code: `code-${w.ana.id}`, installationId: 3 });

    w.gh.gone = [1];
    w.gh.accounts[3] = { login: "renamed", selection: "all", suspended: new Date().toISOString() };
    await reconcileGitHubAppInstallations(w.deps, w.orgA.id);
    const rows = await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id);
    expect(rows).toMatchObject([{ installationId: 3, accountLogin: "renamed", repositorySelection: "all" }]);
    expect(rows[0]?.suspendedAt).not.toBeNull();
    expect((await w.github(w.orgA.id)).live).toMatchObject([{ authType: "github_app", accountLabel: "renamed" }]);

    // Within the minute nothing is asked again; after it, the last one gone ends GitHub here.
    w.gh.gone = [1, 3];
    const asked = w.fake.calls.length;
    await reconcileGitHubAppInstallations(w.deps, w.orgA.id);
    expect(w.fake.calls.length).toBe(asked);
    w.tick(61_000);
    await reconcileGitHubAppInstallations(w.deps, w.orgA.id);
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toEqual([]);
    expect((await w.github(w.orgA.id)).live).toEqual([]);
  });
});

describe("installation tokens (ADR 0156)", () => {
  test("the first permission set the installation grants: workflows when it has them, contents alone when not", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    const tenant = { db: w.db, orgId: w.orgA.id };
    const sets = [{ contents: "write", workflows: "write" }, { contents: "write" }] as const;
    expect(await appRepoToken(APP, http(w), tenant, "a", "app", [...sets])).toMatchObject({
      token: expect.any(String),
    });
    expect(w.fake.bodies.at(-1)?.body).toEqual({ repositories: ["app"], permissions: sets[0] });

    w.gh.lacks = ["workflows"];
    expect(await appRepoToken(APP, http(w), tenant, "a", "tools", [...sets])).toMatchObject({
      token: expect.any(String),
    });
    expect(w.fake.bodies.at(-1)?.body).toEqual({ repositories: ["tools"], permissions: sets[1] });
    // A permission it never has: refused, which isn't "not installed".
    w.gh.lacks = ["actions"];
    expect(await appRepoToken(APP, http(w), tenant, "a", "app", { actions: "write" })).toEqual({ miss: "refused" });
    expect(await appRepoToken(APP, http(w), tenant, "z", "none", { contents: "read" })).toEqual({
      miss: "not_installed",
    });
  });

  test("a whole installation's token, only for the organization it is bound to", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    const token = await installationToken(APP, http(w), { db: w.db, orgId: w.orgA.id }, 1, { issues: "write" });
    expect(token).toStartWith("ghs_1_");
    expect(w.fake.bodies.at(-1)?.body).toEqual({ permissions: { issues: "write" } });
    // Cached: asked once.
    expect(await installationToken(APP, http(w), { db: w.db, orgId: w.orgA.id }, 1, { issues: "write" })).toBe(token);
    expect(await installationToken(APP, http(w), { db: w.db, orgId: w.orgB.id }, 1, { issues: "write" })).toBeNull();
  });

  test("the bot's commit email, asked once; nothing guessed when GitHub doesn't say", async () => {
    const w = await world();
    const app = { ...APP, slug: "bot-test-app" };
    const bots = () => w.fake.calls.filter((c) => c.includes("/users/")).length;
    w.gh.bot = null;
    expect(await botIdentity(app, http(w))).toBeNull();
    // A miss is asked again only a minute later.
    w.gh.bot = 99;
    expect(await botIdentity(app, http(w))).toBeNull();
    expect(bots()).toBe(1);
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(await botIdentity(app, http(w))).toEqual({
        login: "bot-test-app[bot]",
        email: "99+bot-test-app[bot]@users.noreply.github.com",
      });
      expect(await botIdentity(app, http(w))).toMatchObject({ login: "bot-test-app[bot]" });
      expect(bots()).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("GitHub App webhook", () => {
  const sign = (body: string, secret = "hook-secret") =>
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  test("signature over the raw body", () => {
    const body = JSON.stringify({ action: "deleted" });
    expect(validGitHubAppSignature("hook-secret", body, sign(body))).toBe(true);
    expect(validGitHubAppSignature("hook-secret", body, sign(body, "other"))).toBe(false);
    expect(validGitHubAppSignature("hook-secret", `${body} `, sign(body))).toBe(false);
    expect(validGitHubAppSignature("hook-secret", body, null)).toBe(false);
  });

  test("suspend, unsuspend, repository changes and uninstall (which ends GitHub through the app alone)", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    const tenant = { db: w.db, orgId: w.orgA.id };
    const read = { contents: "read" } as const;

    expect(await handleGitHubAppWebhook(w.db, "installation", { action: "suspend", installation: { id: 1 } })).toBe(
      "suspended",
    );
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", read)).toBeNull();
    expect(await handleGitHubAppWebhook(w.db, "installation", { action: "unsuspend", installation: { id: 1 } })).toBe(
      "unsuspended",
    );
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", read)).not.toBeNull();

    expect(
      await handleGitHubAppWebhook(w.db, "installation_repositories", {
        action: "added",
        installation: { id: 1, repository_selection: "all" },
      }),
    ).toBe("updated");
    const [row] = await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id);
    expect(row?.repositorySelection).toBe("all");

    // Not ours to bind: an installation made outside the flow stays ignored.
    expect(await handleGitHubAppWebhook(w.db, "installation", { action: "created", installation: { id: 9 } })).toBe(
      "ignored",
    );
    expect((await w.github(w.orgA.id)).live).toHaveLength(1);
    expect(await handleGitHubAppWebhook(w.db, "installation", { action: "deleted", installation: { id: 1 } })).toBe(
      "removed",
    );
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toHaveLength(0);
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", read)).toBeNull();
    expect((await w.github(w.orgA.id)).live).toEqual([]);
  });

  test("a suspension sent again later changes nothing: what GitHub says now wins", async () => {
    const w = await world();
    await w.install(w.ana, w.orgA.id, 1);
    const tenant = { db: w.db, orgId: w.orgA.id };
    const github = { app: APP, http: http(w) };
    const suspend = { action: "suspend", installation: { id: 1 } };
    // Redelivered after the account lifted it: GitHub has it running, so it keeps working.
    expect(await handleGitHubAppWebhook(w.db, "installation", suspend, { github })).toBe("unsuspended");
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", { contents: "read" })).not.toBeNull();
    w.gh.accounts[1] = { login: "acct1", selection: "selected", suspended: new Date().toISOString() };
    expect(await handleGitHubAppWebhook(w.db, "installation", suspend, { github })).toBe("suspended");
    expect(await appTokenForRepo(APP, http(w), tenant, "a", "app", { contents: "read" })).toBeNull();
    const audits = await w.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, w.orgA.id));
    expect(audits.filter((a) => a.action === "github_app.suspended")).toHaveLength(1);
    // Uninstalled there meanwhile: gone here too.
    w.gh.gone.push(1);
    expect(await handleGitHubAppWebhook(w.db, "installation", { ...suspend, action: "unsuspend" }, { github })).toBe(
      "removed",
    );
    expect(await listGitHubAppInstallations(w.db, w.ana.id, w.orgA.id)).toHaveLength(0);
  });
});
