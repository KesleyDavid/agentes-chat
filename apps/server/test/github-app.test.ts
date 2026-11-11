import { afterEach, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createFakeErrorReporter } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import { browser, createTestServer, joinByInvitation, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer;
afterEach(() => t.close());

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const env = {
  GITHUB_APP_ID: "123",
  // base64 of the PEM file, as people paste it into a hosting panel.
  GITHUB_APP_PRIVATE_KEY: Buffer.from(PEM).toString("base64"),
  GITHUB_APP_SLUG: "agentes-chat",
  GITHUB_APP_CLIENT_ID: "Iv1.client",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_WEBHOOK_SECRET: "hook-secret",
};

/** What the fake GitHub was asked, as "METHOD url". */
const asked: string[] = [];

/**
 * The installations the person's GitHub account can see: 7, made the moment it's asked about, and 9, installed on
 * GitHub itself long ago.
 */
const SEEN = [
  { id: 7, account: { id: 70, login: "acme", type: "Organization" }, repository_selection: "all" },
  {
    id: 9,
    account: { id: 90, login: "old-co", type: "Organization" },
    repository_selection: "all",
    created_at: "2020-01-01T00:00:00Z",
  },
];

/** GitHub: the code exchange, the installations the person can see (`SEEN`), and the manifest's conversion. */
const http = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  asked.push(`${init?.method ?? "GET"} ${url}`);
  if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "ghu_person" });
  if (url.startsWith("https://api.github.com/user/installations")) return Response.json({ installations: SEEN });
  if (url.startsWith("https://api.github.com/user/memberships/orgs/")) {
    return Response.json({ state: "active", role: "admin" });
  }
  if (url === "https://api.github.com/app-manifests/made-code/conversions" && init?.method === "POST") {
    return Response.json(
      {
        id: 4242,
        slug: "agentes-chat-localhost",
        client_id: "Iv1.made",
        client_secret: "made-client-secret",
        webhook_secret: "made-hook-secret",
        pem: PEM,
        html_url: "https://github.com/apps/agentes-chat-localhost",
      },
      { status: 201 },
    );
  }
  const installation = /^https:\/\/api\.github\.com\/app\/installations\/(\d+)$/.exec(url);
  if (installation) {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const found = SEEN.find((i) => i.id === Number(installation[1]));
    return found
      ? Response.json({ created_at: new Date().toISOString(), ...found })
      : new Response("not found", { status: 404 });
  }
  return new Response("unexpected", { status: 500 });
}) as unknown as typeof fetch;

type Info = {
  installable: boolean;
  installations: { id: string; installationId: number; accountLogin: string; manageUrl: string }[];
  setup: { source: string | null; slug: string | null; canCreate: boolean } | null;
  ownerCreates: boolean;
};

const signHook = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("install from the app: state, callback binding, list, and the webhook unbinding it", async () => {
  t = await createTestServer({ http, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);

  const info = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(info).toEqual({
    installable: true,
    installations: [],
    setup: { source: "env", slug: "agentes-chat", htmlUrl: null, state: "ok", canCreate: false },
    ownerCreates: false,
  } as unknown as Info);

  const { installUrl } = (await (
    await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/conectores" } })
  ).json()) as { installUrl: string };
  const url = new URL(installUrl);
  expect(url.origin + url.pathname).toBe("https://github.com/apps/agentes-chat/installations/new");
  const state = url.searchParams.get("state") ?? "";

  // An installation the person's GitHub account can't see is refused, back where it started.
  const foreign = await owner(
    `/api/app/github-app/callback?state=${state}&code=c&installation_id=8&setup_action=install`,
  );
  expect(foreign.headers.get("location")).toBe("http://localhost:3000/conectores?github_app_error=not_visible");

  const { installUrl: second } = (await (
    await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/conectores" } })
  ).json()) as { installUrl: string };
  const state2 = new URL(second).searchParams.get("state") ?? "";
  const back = await owner(
    `/api/app/github-app/callback?state=${state2}&code=c&installation_id=7&setup_action=install`,
  );
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("http://localhost:3000/conectores?github_app=installed");
  const listed = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(listed.installations).toMatchObject([
    {
      installationId: 7,
      accountLogin: "acme",
      repositorySelection: "all",
      manageUrl: "https://github.com/organizations/acme/settings/installations/7",
    },
  ]);
  // The app alone is the workspace's GitHub now.
  const { connections } = (await (await owner(`/api/app/organizations/${orgId}/connectors`)).json()) as {
    connections: { connector: string; authType: string; accountLabel: string }[];
  };
  expect(connections).toMatchObject([{ connector: "github", authType: "github_app", accountLabel: "acme" }]);

  // Webhook: unsigned or wrongly signed → 401; signed uninstall → unbound.
  const body = JSON.stringify({ action: "deleted", installation: { id: 7 } });
  const hook = (signature?: string) =>
    t.app.request("/api/github-app/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "installation",
        "content-type": "application/json",
        ...(signature ? { "x-hub-signature-256": signature } : {}),
      },
      body,
    });
  expect((await hook()).status).toBe(401);
  expect((await hook("sha256=00")).status).toBe(401);
  const signed = await hook(signHook(body, "hook-secret"));
  expect(signed.status).toBe(202);
  expect(await signed.json()).toEqual({ ok: true, result: "removed" });
  const after = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(after.installations).toEqual([]);
  expect(
    ((await (await owner(`/api/app/organizations/${orgId}/connectors`)).json()) as { connections: [] }).connections,
  ).toEqual([]);
});

test("without the app configured: not installable, webhook not mounted, the owner may create one", async () => {
  t = await createTestServer();
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const info = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(info.installable).toBe(false);
  expect(info.setup).toMatchObject({ source: null, canCreate: true });
  // Another admin isn't told the server's app, only that its owner can make one.
  const admin = await joinByInvitation(t, owner, orgId, "admin@example.com", { role: "admin" });
  expect((await (await admin(`/api/app/organizations/${orgId}/github-app`)).json()) as Info).toMatchObject({
    setup: null,
    ownerCreates: true,
  });
  expect((await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: {} })).status).toBe(400);
  const hook = await t.app.request("/api/github-app/webhook", { method: "POST", body: "{}" });
  expect(hook.status).toBe(404);
  const doc = (await (await t.app.request("/api/openapi.json")).json()) as { paths: Record<string, unknown> };
  for (const path of [
    "/app/organizations/{orgId}/github-app",
    "/app/organizations/{orgId}/github-app/complete",
    "/app/organizations/{orgId}/github-app/installations/{installationId}",
    "/app/github-app/callback",
    "/app/github-app/manifest",
    "/app/github-app/manifest/start",
    "/app/github-app/manifest/callback",
    "/app/github-app/settings",
    "/app/organizations/{orgId}/messages/{messageId}/github-answer",
  ]) {
    expect(Object.keys(doc.paths)).toContain(path);
  }
});

test("what happens on the items is queued once per delivery; the owner is told which events the app lacks", async () => {
  // GitHub has the app subscribed to issues alone.
  const withApp = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input) === "https://api.github.com/app"
      ? Response.json({ slug: "agentes-chat", events: ["issues"], owner: { login: "acme", type: "Organization" } })
      : http(input, init)) as typeof fetch;
  t = await createTestServer({ http: withApp, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const info = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as {
    setup: { events?: { missing: string[]; url: string } };
  };
  expect(info.setup.events).toEqual({
    missing: [
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "pull_request_review_thread",
      "discussion",
      "discussion_comment",
    ],
    url: "https://github.com/organizations/acme/settings/apps/agentes-chat/permissions",
  });

  await t.db
    .insert(schema.githubAppInstallations)
    .values({ orgId, installationId: 7, accountLogin: "acme", accountType: "Organization" });
  const body = JSON.stringify({
    action: "created",
    installation: { id: 7 },
    repository: { full_name: "acme/app" },
    sender: { id: 5, login: "someone", type: "User" },
    issue: { number: 3, html_url: "https://github.com/acme/app/issues/3" },
    comment: { body: "@agentes-chat hi", html_url: "https://github.com/acme/app/issues/3#issuecomment-1" },
  });
  const hook = (event: string, delivery: string) =>
    t.app.request("/api/github-app/webhook", {
      method: "POST",
      headers: {
        "x-github-event": event,
        "x-github-delivery": delivery,
        "content-type": "application/json",
        "x-hub-signature-256": signHook(body, "hook-secret"),
      },
      body,
    });
  const first = await hook("issue_comment", "delivery-1");
  expect(first.status).toBe(202);
  expect(await first.json()).toEqual({ ok: true, result: "queued" });
  await hook("issue_comment", "delivery-1");
  expect(await (await hook("star", "delivery-2")).json()).toEqual({ ok: true, result: "ignored" });
  const jobs = await t.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "github_app.event"));
  expect(jobs).toHaveLength(1);
});

test("GitHub's return without a session in this browser: the sign-in page first, then it finishes", async () => {
  t = await createTestServer({ http, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const { installUrl } = (await (
    await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/conectores" } })
  ).json()) as { installUrl: string };
  const state = new URL(installUrl).searchParams.get("state") ?? "";
  const callback = `/api/app/github-app/callback?state=${state}&code=c&installation_id=7&setup_action=install`;
  const signedOut = await browser(t)(callback);
  expect(signedOut.status).toBe(302);
  const signIn = new URL(signedOut.headers.get("location") ?? "");
  expect(signIn.origin + signIn.pathname).toBe("http://localhost:3000/login");
  expect(signIn.searchParams.get("redirect")).toBe(callback);
  // Signed in, the same address finishes.
  expect((await owner(callback)).headers.get("location")).toBe("http://localhost:3000/conectores?github_app=installed");
});

test("GitHub's return that didn't install: why as a code where it started, never words", async () => {
  const refusing = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input) === "https://github.com/login/oauth/access_token" && String(init?.body).includes("code=bad")
      ? Response.json({ error: "bad_verification_code" })
      : http(input, init)) as unknown as typeof fetch;
  t = await createTestServer({ http: refusing, env: { ...env, ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const start = async () => {
    const res = await owner(`/api/app/organizations/${orgId}/github-app/install`, {
      json: { returnTo: "/conectores" },
    });
    return new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state") ?? "";
  };
  const back = async (who: typeof owner, query: string) =>
    (await who(`/api/app/github-app/callback?${query}`)).headers.get("location") ?? "";
  const landing = "http://localhost:3000/conectores?github_app_error=";

  // Someone without rights on that GitHub account asked its owner to install: news, not a failure.
  expect(await back(owner, `state=${await start()}&setup_action=request`)).toBe(`${landing}requested`);
  expect(await back(owner, `state=${await start()}&error=access_denied`)).toBe(`${landing}cancelled`);
  expect(await back(owner, `state=${await start()}&code=c`)).toBe(`${landing}failed`);
  expect(await back(owner, `state=${await start()}&code=bad&installation_id=7&setup_action=install`)).toBe(
    `${landing}failed`,
  );
  const other = browser(t);
  await signUp(other, "other@example.com");
  expect(await back(other, `state=${await start()}&code=c&installation_id=7&setup_action=install`)).toBe(
    `${landing}other_account`,
  );
  expect(await back(owner, "code=c&installation_id=7&setup_action=request")).toBe(
    "http://localhost:3000/?github_app_error=requested",
  );
  // Installed from GitHub's own page (or approved there from a request): no state of ours, made outside.
  expect(await back(owner, "code=c&installation_id=7&setup_action=install")).toBe(
    "http://localhost:3000/?github_app_error=installed_outside",
  );
  // Repositories changed on GitHub's own page, which comes back on its own: no failure to show.
  expect(await back(owner, "code=c&installation_id=7&setup_action=update")).toBe("http://localhost:3000/");
});

test("GitHub refusing this server's app (a wrong client secret): `misconfigured`, reported as an error", async () => {
  // GitHub's answer to a wrong client id or secret: a 200 with its code. `code=bad` is an expired code instead.
  const github = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== "https://github.com/login/oauth/access_token") return http(input, init);
    return String(init?.body).includes("code=bad")
      ? Response.json({ error: "bad_verification_code" })
      : Response.json({
          error: "incorrect_client_credentials",
          error_description: "The client_id and/or client_secret passed are incorrect.",
        });
  }) as unknown as typeof fetch;
  const errors = createFakeErrorReporter();
  t = await createTestServer({ http: github, env, errors });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const start = async (returnTo: string) => {
    const res = await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo } });
    return new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state") ?? "";
  };
  const back = async (code: string) => {
    const query = `state=${await start("/conectores")}&code=${code}&installation_id=7&setup_action=install`;
    return (await owner(`/api/app/github-app/callback?${query}`)).headers.get("location");
  };
  const logged = () => errors.reports.map((r) => r.tags.log);

  expect(await back("c")).toBe("http://localhost:3000/conectores?github_app_error=misconfigured");
  expect(logged()).toEqual(["github app install failed"]);
  expect(String(errors.reports[0]?.error)).toContain("incorrect_client_credentials");
  // A code GitHub refused can work on another try: `failed`, and only a warning.
  expect(await back("bad")).toBe("http://localhost:3000/conectores?github_app_error=failed");
  expect(logged()).toEqual(["github app install failed"]);
  // The phone's finish says it by its code, reported too.
  const phone = await owner(`/api/app/organizations/${orgId}/github-app/complete`, {
    json: { state: await start("app:connectors"), code: "c", installationId: 7 },
  });
  expect(phone.status).toBe(500);
  expect(((await phone.json()) as { error: { code: string } }).error.code).toBe("github_app.misconfigured");
  expect(logged()).toEqual(["github app install failed", "unhandled error"]);
});

test("an installation bound to another workspace comes back as other_workspace", async () => {
  t = await createTestServer({ http, env: { ...env, ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const first = await seedOrg(owner);
  // Someone else's workspace, whose admin's GitHub account sees the same installation.
  const neighbor = browser(t);
  await signUp(neighbor, "neighbor@example.com");
  const second = await seedOrg(neighbor);
  const install = async (who: typeof owner, orgId: string) => {
    const res = await who(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/c" } });
    const state = new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state");
    return (await who(`/api/app/github-app/callback?state=${state}&code=c&installation_id=7`)).headers.get("location");
  };
  expect(await install(owner, first.orgId)).toBe("http://localhost:3000/c?github_app=installed");
  expect(await install(neighbor, second.orgId)).toBe("http://localhost:3000/c?github_app_error=other_workspace");
});

test("only an installation GitHub made after the install started here binds; an update only refreshes one", async () => {
  t = await createTestServer({ http, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const start = async (returnTo: string) => {
    const res = await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo } });
    return new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state") ?? "";
  };
  const back = async (installationId: number, setupAction: string) => {
    const query = `state=${await start("/c")}&code=c&installation_id=${installationId}&setup_action=${setupAction}`;
    return (await owner(`/api/app/github-app/callback?${query}`)).headers.get("location");
  };
  // 9 was installed on GitHub itself: the person's account sees it, but nobody started it here.
  expect(await back(9, "install")).toBe("http://localhost:3000/c?github_app_error=installed_outside");
  // An update is of an installation that was already there: it never binds one.
  expect(await back(7, "update")).toBe("http://localhost:3000/c?github_app_error=installed_outside");
  expect(await back(7, "install")).toBe("http://localhost:3000/c?github_app=installed");
  expect(await back(7, "update")).toBe("http://localhost:3000/c?github_app=installed");
  // The phone's finish refuses it by the same code.
  const phone = await owner(`/api/app/organizations/${orgId}/github-app/complete`, {
    json: { state: await start("app:connectors"), code: "c", installationId: 9 },
  });
  expect(phone.status).toBe(403);
  expect(((await phone.json()) as { error: { code: string } }).error.code).toBe("github_app.installed_outside");
  const listed = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(listed.installations.map((i) => i.installationId)).toEqual([7]);
});

test("from the phone: the return goes back to the app with installation_id, which finishes it with its session", async () => {
  t = await createTestServer({ http, env: { ...env, ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const neighbor = browser(t);
  await signUp(neighbor, "neighbor@example.com");
  const other = await seedOrg(neighbor);
  const start = async (returnTo: string) => {
    const res = await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo } });
    return new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state") ?? "";
  };
  const state = await start("app:connectors");
  // The system browser has no session of ours: it only hands GitHub's answer to the app.
  const handed = await browser(t)(
    `/api/app/github-app/callback?state=${state}&code=c&installation_id=7&setup_action=install`,
  );
  expect(handed.headers.get("location")).toBe(`agenteschat://connectors/oauth?state=${state}&code=c&installation_id=7`);
  const refused = await browser(t)(`/api/app/github-app/callback?state=${state}&setup_action=request`);
  expect(refused.headers.get("location")).toBe("agenteschat://connectors/oauth?error=requested");

  const complete = (who: typeof owner, org: string, s: string) =>
    who(`/api/app/organizations/${org}/github-app/complete`, { json: { state: s, code: "c", installationId: 7 } });
  // Another workspace's, or a state the web started: not found.
  expect((await complete(owner, other.orgId, state)).status).toBe(404);
  expect((await complete(owner, orgId, await start("/conectores"))).status).toBe(404);
  // Someone else in the workspace can't finish a person's install.
  const admin = await joinByInvitation(t, owner, orgId, "admin@example.com", { role: "admin" });
  expect((await complete(admin, orgId, state)).status).toBe(403);
  // The server's own app is its owner's business alone.
  expect(((await (await admin(`/api/app/organizations/${orgId}/github-app`)).json()) as Info).setup).toBeNull();
  const done = await complete(owner, orgId, await start("app:connectors"));
  expect(done.status).toBe(200);
  expect(((await done.json()) as { installation: { accountLogin: string } }).installation.accountLogin).toBe("acme");
});

test("removing an installation uninstalls it from GitHub", async () => {
  t = await createTestServer({ http, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const res = await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/c" } });
  const state = new URL(((await res.json()) as { installUrl: string }).installUrl).searchParams.get("state");
  await owner(`/api/app/github-app/callback?state=${state}&code=c&installation_id=7`);
  const [installation] = ((await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info)
    .installations;
  const removed = await owner(`/api/app/organizations/${orgId}/github-app/installations/${installation?.id}`, {
    method: "DELETE",
  });
  expect(await removed.json()).toEqual({ uninstalled: true });
  const listed = async () =>
    ((await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info).installations;
  expect(await listed()).toEqual([]);

  // Disconnecting GitHub through the app alone removes its installations and uninstalls them too.
  const again = await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: { returnTo: "/c" } });
  const state2 = new URL(((await again.json()) as { installUrl: string }).installUrl).searchParams.get("state");
  await owner(`/api/app/github-app/callback?state=${state2}&code=c&installation_id=7`);
  const { connections } = (await (await owner(`/api/app/organizations/${orgId}/connectors`)).json()) as {
    connections: { id: string; authType: string }[];
  };
  expect(connections).toMatchObject([{ authType: "github_app" }]);
  asked.length = 0;
  const gone = await owner(`/api/app/organizations/${orgId}/connectors/${connections[0]?.id}`, { method: "DELETE" });
  expect(gone.status).toBe(204);
  expect(asked).toContain("DELETE https://api.github.com/app/installations/7");
  expect(await listed()).toEqual([]);
});

test("the server's own app: its owner creates it on GitHub with the manifest, then it installs and hears GitHub", async () => {
  t = await createTestServer({ http, env: { ALLOW_SIGNUP: "true" } });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const other = browser(t);
  await signUp(other, "other@example.com");

  // Anyone else: as if it weren't there.
  expect((await other("/api/app/github-app/manifest", { json: {} })).status).toBe(404);
  expect((await other("/api/app/github-app/settings", { method: "DELETE" })).status).toBe(404);
  const started = await owner("/api/app/github-app/manifest", { json: { returnTo: "/settings/connectors" } });
  expect(started.status).toBe(200);
  const { startUrl } = (await started.json()) as { startUrl: string };
  const start = new URL(startUrl);
  expect(start.origin + start.pathname).toBe("http://localhost:3000/api/app/github-app/manifest/start");
  const state = start.searchParams.get("state") ?? "";

  // The page posts the manifest to GitHub by itself, and nowhere else.
  const page = await owner(start.pathname + start.search);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("form-action https://github.com");
  const html = await page.text();
  expect(html).toContain(`action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}"`);
  expect(html).toContain("&#34;redirect_url&#34;:&#34;http://localhost:3000/api/app/github-app/manifest/callback&#34;");
  expect(html).not.toContain("<script>");
  // Someone else's browser with that state goes nowhere.
  expect((await other(start.pathname + start.search)).headers.get("location")).toBe(
    "http://localhost:3000/settings/connectors?github_app_error=other_account",
  );
  expect(
    (await other(`/api/app/github-app/manifest/callback?code=made-code&state=${state}`)).headers.get("location"),
  ).toBe("http://localhost:3000/settings/connectors?github_app_error=other_account");

  const back = await owner(`/api/app/github-app/manifest/callback?code=made-code&state=${encodeURIComponent(state)}`);
  expect(back.headers.get("location")).toBe("http://localhost:3000/settings/connectors?github_app=created");
  const info = (await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info;
  expect(info).toMatchObject({
    installable: true,
    setup: {
      source: "settings",
      slug: "agentes-chat-localhost",
      htmlUrl: "https://github.com/apps/agentes-chat-localhost",
      canCreate: false,
    },
  });
  const { installUrl } = (await (
    await owner(`/api/app/organizations/${orgId}/github-app/install`, { json: {} })
  ).json()) as { installUrl: string };
  expect(installUrl).toStartWith("https://github.com/apps/agentes-chat-localhost/installations/new?state=");
  // Its webhook secret is the one GitHub made.
  const body = JSON.stringify({ action: "deleted", installation: { id: 1 } });
  const hook = await t.app.request("/api/github-app/webhook", {
    method: "POST",
    headers: { "x-github-event": "installation", "x-hub-signature-256": signHook(body, "made-hook-secret") },
    body,
  });
  expect(hook.status).toBe(202);
  // Never a secret in what the server says.
  expect(JSON.stringify(info)).not.toContain("made-client-secret");

  const removed = await owner("/api/app/github-app/settings", { method: "DELETE" });
  expect(await removed.json()).toMatchObject({ source: null, canCreate: true });
  expect(((await (await owner(`/api/app/organizations/${orgId}/github-app`)).json()) as Info).installable).toBe(false);
});

test("the server's app is the environment's when set (409), and nobody's on agentes.chat (404)", async () => {
  t = await createTestServer({ http, env });
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const started = await owner("/api/app/github-app/manifest", { json: {} });
  expect(started.status).toBe(409);
  expect(((await started.json()) as { error: { code: string } }).error.code).toBe("github_app_env");
  await t.close();

  const origin = "https://app.agentes.chat";
  t = await createTestServer({ http, env: { ...env, ALLOW_SIGNUP: "true", PUBLIC_URL: origin } });
  const first = browser(t);
  const signedUp = await first("/api/auth/sign-up/email", {
    json: { email: "first@example.com", password: "correct horse battery", name: "First" },
    origin,
  });
  expect(signedUp.status).toBe(200);
  expect((await first("/api/app/github-app/manifest", { json: {}, origin })).status).toBe(404);
  const made = (await (
    await first("/api/app/organizations", { json: { name: "Acme", context: "Acme builds rockets." }, origin })
  ).json()) as { organization: { id: string } };
  const seen = await first(`/api/app/organizations/${made.organization.id}/github-app`, { origin });
  expect((await seen.json()) as Info).toMatchObject({ setup: null, ownerCreates: false });
});
