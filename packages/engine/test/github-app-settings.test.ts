import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { eq, schema } from "@agenteschat/db";
import {
  appTokenForRepo,
  completeGitHubAppInstall,
  convertGitHubAppManifest,
  createGitHubAppSettings,
  createLocalKeyWrapper,
  type GitHubAppConfig,
  githubAppManifest,
  issueManifestState,
  missingGitHubAppEvents,
  readManifestState,
  startGitHubAppInstall,
} from "../src";
import { type Fixture, SECRET, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  // The manifest tests use no database: close each fixture once.
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const SLUG = "agentes-chat-example";
const PAGE = "https://github.com/apps/agentes-chat-example";
const MADE: GitHubAppConfig = {
  appId: "777",
  privateKey: PEM,
  slug: SLUG,
  clientId: "Iv1.made",
  clientSecret: "made-client-secret-value",
  webhookSecret: "made-hook-secret-value",
  htmlUrl: PAGE,
};
const API = "https://api.github.test";

const settingsOf = (fx: Fixture, extra: { env?: GitHubAppConfig | null; now?: () => number } = {}) =>
  createGitHubAppSettings({
    db: fx.db,
    keyWrapper: createLocalKeyWrapper(SECRET),
    keyWrappers: [createLocalKeyWrapper(SECRET)],
    env: extra.env ?? null,
    now: extra.now,
  });

describe("the server's GitHub App (ADR 0156)", () => {
  test("env wins: it is the app, and nothing is saved over it", async () => {
    f = await setup();
    const env = { ...MADE, appId: "1", slug: "env-app" };
    const settings = settingsOf(f, { env });
    await settings.ready();
    expect(settings.current()).toBe(env);
    expect(await settings.view()).toEqual({ source: "env", slug: "env-app", htmlUrl: PAGE, state: "ok" });
    await expect(settings.save(MADE, f.owner.id)).rejects.toMatchObject({ code: "github_app_env" });
    await expect(settings.remove(f.owner.id)).rejects.toMatchObject({ code: "github_app_env" });
    expect(await f.db.select().from(schema.instanceSecrets)).toEqual([]);
  });

  test("an app made from Settings is sealed, only its slug and page show, and every workspace's log has it", async () => {
    f = await setup();
    const settings = settingsOf(f);
    await settings.ready();
    expect(settings.current()).toBeNull();
    expect(await settings.view()).toEqual({ source: null, slug: null, htmlUrl: null, state: "off" });
    const view = await settings.save(MADE, f.owner.id);
    expect(view).toEqual({ source: "settings", slug: SLUG, htmlUrl: PAGE, state: "ok" });
    expect(settings.current()).toEqual(MADE);
    const raw = JSON.stringify(await f.db.select().from(schema.instanceSecrets));
    for (const secret of [PEM.slice(40, 80), MADE.clientSecret, MADE.webhookSecret]) expect(raw).not.toContain(secret);
    expect(JSON.stringify(view)).not.toContain(MADE.clientSecret);
    const saved = await f.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "github_app.settings_saved"));
    expect(saved.map((a) => a.details)).toEqual([{ slug: MADE.slug }]);

    expect(await settings.remove(f.owner.id)).toEqual({ source: null, slug: null, htmlUrl: null, state: "off" });
    expect(settings.current()).toBeNull();
    expect(await f.db.select().from(schema.instanceSecrets)).toEqual([]);
  });

  test("another server sees a save within its next read, a minute later; one that can't open it says so", async () => {
    f = await setup();
    let now = 1_000_000;
    const other = settingsOf(f, { now: () => now });
    await other.ready();
    await settingsOf(f).save(MADE, f.owner.id);
    expect(other.current()).toBeNull();
    now += 61_000;
    await other.view();
    expect(other.current()).toEqual(MADE);

    const elsewhere = createGitHubAppSettings({
      db: f.db,
      keyWrapper: createLocalKeyWrapper("another-secret".padEnd(48, "y")),
      keyWrappers: [createLocalKeyWrapper("another-secret".padEnd(48, "y"))],
      env: null,
    });
    expect(await elsewhere.view()).toMatchObject({ source: "settings", slug: MADE.slug, state: "invalid" });
    expect(elsewhere.current()).toBeNull();
  });

  test("a changed app forgets the tokens the last one minted", async () => {
    f = await setup();
    let minted = 0;
    const github = {
      apiUrl: API,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        const acme = { id: 50, login: "acme", type: "Organization" };
        if (url.endsWith("/user/installations?per_page=100&page=1")) {
          return Response.json({ installations: [{ id: 5, account: acme }] });
        }
        if (url.endsWith("/user/memberships/orgs/acme")) return Response.json({ state: "active", role: "admin" });
        if (url.endsWith("/app/installations/5")) {
          return Response.json({ id: 5, account: acme, created_at: new Date().toISOString() });
        }
        if (url.endsWith("/login/oauth/access_token")) return Response.json({ access_token: "user-token" });
        if (url.endsWith("/repos/acme/app/installation")) return Response.json({ id: 5 });
        if (url.endsWith("/access_tokens")) {
          minted++;
          return Response.json({ token: `ghs_${minted}`, expires_at: new Date(Date.now() + 3600_000).toISOString() });
        }
        return new Response("unexpected", { status: 500 });
      }) as typeof fetch,
    };
    const settings = settingsOf(f);
    await settings.save(MADE, f.owner.id);
    const deps = {
      db: f.db,
      keyWrappers: [createLocalKeyWrapper(SECRET)],
      app: MADE,
      http: { ...github, webUrl: "https://github.test" },
    };
    const { state } = await startGitHubAppInstall(deps, f.owner.id, f.org.id);
    await completeGitHubAppInstall(deps, f.owner, { state, code: "c", installationId: 5 });
    const tenant = { db: f.db, orgId: f.org.id };
    expect(await appTokenForRepo(MADE, github, tenant, "acme", "app", { contents: "read" })).toBe("ghs_1");
    expect(await appTokenForRepo(MADE, github, tenant, "acme", "app", { contents: "read" })).toBe("ghs_1");
    await settings.save({ ...MADE, appId: "778" }, f.owner.id);
    expect(await appTokenForRepo(MADE, github, tenant, "acme", "app", { contents: "read" })).toBe("ghs_2");
  });
});

describe("GitHub's manifest flow", () => {
  test("the manifest asks what agentes.chat's own app has, at this server's addresses", () => {
    const manifest = githubAppManifest("https://chat.example.com/");
    expect(manifest).toMatchObject({
      name: "agentes.chat (chat.example.com)",
      url: "https://chat.example.com",
      redirect_url: "https://chat.example.com/api/app/github-app/manifest/callback",
      callback_urls: ["https://chat.example.com/api/app/github-app/callback"],
      request_oauth_on_install: true,
      public: true,
      hook_attributes: { url: "https://chat.example.com/api/github-app/webhook", active: true },
    });
    // Exactly agentes.chat's own app, by GitHub's manifest names: write on the repository permissions agents use,
    // metadata read; an organization's members read and Projects write. Never Codespaces, nor an organization's
    // administration, secrets, variables, runners or webhooks.
    expect(manifest.default_permissions).toEqual({
      actions: "write",
      administration: "write",
      attestations: "write",
      checks: "write",
      security_events: "write",
      statuses: "write",
      contents: "write",
      repository_custom_properties: "write",
      vulnerability_alerts: "write",
      dependabot_secrets: "write",
      deployments: "write",
      discussions: "write",
      environments: "write",
      issues: "write",
      merge_queues: "write",
      packages: "write",
      pages: "write",
      repository_projects: "write",
      pull_requests: "write",
      repository_advisories: "write",
      secret_scanning_alerts: "write",
      secrets: "write",
      actions_variables: "write",
      repository_hooks: "write",
      workflows: "write",
      metadata: "read",
      members: "read",
      organization_projects: "write",
    });
    // What agents hear on GitHub: comments, reviews and items on what they worked on, or naming the app.
    expect(manifest.default_events).toEqual([
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "pull_request_review_thread",
      "discussion",
      "discussion_comment",
    ]);
    // GitHub can't deliver to plain http; a long host keeps the name within GitHub's 34 characters.
    expect(githubAppManifest("http://192.168.0.10:3000").hook_attributes.active).toBe(false);
    expect(githubAppManifest("https://agents.a-very-long-company-name.example").name.length).toBeLessThanOrEqual(34);
  });

  test("an app made without the events agents hear says which to tick, and where on GitHub", async () => {
    const answers = (events: string[], owner = { login: "acme", type: "Organization" }) => ({
      fetch: (async () => Response.json({ slug: SLUG, events, owner })) as unknown as typeof fetch,
      apiUrl: API,
    });
    const all = githubAppManifest("https://chat.example.com").default_events;
    expect(await missingGitHubAppEvents(MADE, answers([]))).toEqual({
      missing: all,
      url: `https://github.com/organizations/acme/settings/apps/${SLUG}/permissions`,
    });
    expect(await missingGitHubAppEvents(MADE, answers([...all, "push"]))).toBeNull();
    const personal = await missingGitHubAppEvents(MADE, answers(["issues"], { login: "ana-gh", type: "User" }));
    expect(personal).toEqual({
      missing: all.filter((e) => e !== "issues"),
      url: `https://github.com/settings/apps/${SLUG}/permissions`,
    });
    // GitHub didn't answer: nothing to say.
    const down = { fetch: (async () => new Response("down", { status: 502 })) as unknown as typeof fetch, apiUrl: API };
    expect(await missingGitHubAppEvents(MADE, down)).toBeNull();
  });

  test("its state: the person and the landing, signed, for an hour", () => {
    const now = Date.now();
    const state = issueManifestState(SECRET, { userId: "u1", returnTo: "/settings/connectors" }, now);
    expect(readManifestState(SECRET, state, now)).toEqual({ userId: "u1", returnTo: "/settings/connectors" });
    expect(readManifestState(SECRET, state, now + 3601_000)).toBeNull();
    expect(readManifestState("another-secret".padEnd(48, "z"), state, now)).toBeNull();
    const [body = "", mac = ""] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u2", r: "/", e: now / 1000 + 60 })).toString("base64url");
    expect(readManifestState(SECRET, `${forged}.${mac}`, now)).toBeNull();
    expect(readManifestState(SECRET, `${body}.`, now)).toBeNull();
    expect(readManifestState(SECRET, "garbage", now)).toBeNull();
  });

  test("GitHub's conversion gives the app; a refused code is a clear failure", async () => {
    const answer = {
      id: 777,
      slug: MADE.slug,
      client_id: MADE.clientId,
      client_secret: MADE.clientSecret,
      webhook_secret: MADE.webhookSecret,
      pem: PEM,
      html_url: MADE.htmlUrl,
    };
    const calls: string[] = [];
    const http = {
      apiUrl: API,
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(input)}`);
        return String(input).includes("/good/")
          ? Response.json(answer, { status: 201 })
          : Response.json({ message: "Not Found" }, { status: 404 });
      }) as typeof fetch,
    };
    expect(await convertGitHubAppManifest(http, "good")).toEqual(MADE);
    expect(calls).toEqual([`POST ${API}/app-manifests/good/conversions`]);
    await expect(convertGitHubAppManifest(http, "used")).rejects.toMatchObject({ code: "github_app.manifest_failed" });
  });
});
