import {
  type Adapters,
  checkGiphyKey,
  createFakeEmailSender,
  createFakeGifs,
  createFakePushSender,
  createFakeWebPushSender,
  createKeyedGifs,
  createMemoryBlobStore,
  createMemoryPresence,
  createMemoryPubSub,
  createMemoryRateLimiter,
  createPostgresSearchResolver,
  type DatabaseDriver,
  type ErrorReporter,
  type GifProvider,
  type HumanCheck,
  type MailAdapters,
  noPlatformCredentials,
  type S3Fetch,
  type WebPushSender,
} from "@agenteschat/adapters";
import { testConfig } from "@agenteschat/config";
import { eq, isNotNull, like, schema } from "@agenteschat/db";
import { createTestDatabase } from "@agenteschat/db/testing";
import {
  createFakeJudge,
  createFakeScheduleReader,
  createGifKey,
  createLocalKeyWrapper,
  drainOutbox,
  type EmailArt,
  type FakeScheduleAnswers,
  type FetchAppDocument,
  type McpConnect,
  type ResolveHost,
  type ToolSource,
} from "@agenteschat/engine";
import { PROVIDER_IDS } from "@agenteschat/providers";
import { createFakeEmbeddings, createFakeProvider } from "@agenteschat/providers/testing";
import { createApp } from "../src/app";
import { type AppleTokenRevoker, createAuth } from "../src/auth";
import { buildEngine } from "../src/engine";
import { createLogger } from "../src/logger";
import { createMachineSockets } from "../src/realtime/machines";
import { createStreamSockets } from "../src/realtime/streams";
import { createRealtime, type SocketData } from "../src/realtime/ws";

export const ORIGIN = "http://localhost:3000";

const WORKDAYS = ["MO", "TU", "WE", "TH", "FR"];
/** What the fake schedule reader answers for the phrases these tests write (a lookup table, not a parser). */
export const TEST_SCHEDULES: FakeScheduleAnswers = {
  "dias úteis às 9h": { rule: { freq: "weekly", byWeekday: WORKDAYS, times: ["09:00"] } },
  "a cada 2 semanas na segunda e quarta às 9h": {
    rule: { freq: "weekly", interval: 2, byWeekday: ["MO", "WE"], times: ["09:00"] },
  },
};

/**
 * The whole server wired like `start.ts`, but on PGlite, in-memory adapters
 * and the fake model provider. No `.env`, no network.
 */
export async function createTestServer(
  options: {
    env?: Record<string, string>;
    reply?: Parameters<typeof createFakeProvider>[0];
    toolSources?: ToolSource[];
    /** In-process MCP servers for the connector tool source. */
    mcpConnect?: McpConnect;
    /** Fake outbound HTTP (OAuth token endpoints). */
    http?: typeof fetch;
    /** Use fake embeddings (hybrid search). Off by default: full-text only, and no embedding usage rows. */
    embeddings?: boolean;
    /** Fake S3 server and DNS for org buckets. */
    s3Fetch?: S3Fetch;
    resolveHost?: ResolveHost;
    /** Fake GitHub (git smart HTTP and REST) for the git proxy. */
    github?: { gitUrl: string; apiUrl: string; fetch: typeof fetch };
    /** Answers of the fake judge (judge.ts). Default: every Noul 0, but an agent's mention needs nothing. */
    judge?: Parameters<typeof createFakeJudge>[0];
    /** The fake schedule reader's table (phrase → answer), on top of `TEST_SCHEDULES`. */
    schedules?: FakeScheduleAnswers;
    /** Fake Apple token revocation (account deletion). */
    appleRevoke?: AppleTokenRevoker;
    /** Fake GitHub for the desktop app's releases. */
    desktopFetch?: typeof fetch;
    /** Fake mail adapters (Composio, IMAP); absent = no email connectors. */
    mail?: MailAdapters;
    /** Fake database driver (ADR 0039); absent = no database connector. */
    databases?: DatabaseDriver;
    /** Where emails get their pictures; absent = linked from `PUBLIC_URL`. */
    emailArt?: EmailArt;
    /** Fake TypeSafe (checks of the Jev key). */
    jevFetch?: typeof fetch;
    /** The bot check (Turnstile with a fake `fetch`); absent = none, as without its keys. */
    humanCheck?: HumanCheck;
    /** The server's own file store's kind (`disk`, `postgres`, `s3`); it keeps files in memory either way. */
    platformKind?: string;
    /** Browser push (ADR 0071); absent = a fake that records, null = off. */
    webPush?: WebPushSender | null;
    /** Where error lines are reported (`createFakeErrorReporter`); absent = nowhere. */
    errors?: ErrorReporter;
    /** GIF search (ADR 0091); absent = the fake provider (`createFakeGifs`), null = none, as without its key. */
    gifs?: GifProvider | null;
    /**
     * A fake GIPHY: GIFs then come, as on a server that isn't agentes.chat's own, from the provider that follows the
     * installation's key (`GIPHY_API_KEY` or the one saved in Settings), and it answers a key's check before a save.
     * Absent: `gifs` serves them, and a saved key is kept unchecked (tests never reach the network).
     */
    giphyFetch?: typeof fetch;
    /** `false`: a store with no signed links, as on disk or in Postgres, so the server sends files itself. */
    signedBlobs?: boolean;
    /** Fake speech providers (ADR 0100), for an engine set through `env`. */
    speechFetch?: typeof fetch;
    /** AI apps (ADR 0119): a fake fetch of apps' metadata documents (CIMD); absent = none answers. */
    appsFetchDocument?: FetchAppDocument;
  } = {},
) {
  const { db, close } = await createTestDatabase();
  const config = testConfig({
    PUBLIC_URL: ORIGIN,
    AGENT_MAX_OUTPUT_TOKENS: "1000",
    ...options.env,
  });
  const log = createLogger("error", options.errors);
  const email = createFakeEmailSender();
  const push = createFakePushSender();
  const webPush = options.webPush === undefined ? createFakeWebPushSender() : options.webPush;
  const platformBlobs = createMemoryBlobStore({ kind: options.platformKind, sign: options.signedBlobs });
  const keyWrapper = createLocalKeyWrapper(config.AGENTES_SECRET);
  const { giphyFetch } = options;
  // The installation's GIPHY key, as `start.ts` makes it off agentes.chat (ADR 0091, amended 2026-10-31).
  const gifKey = createGifKey({
    db,
    keyWrapper,
    keyWrappers: [keyWrapper],
    envKey: config.GIPHY_API_KEY,
    check: async (apiKey) => (giphyFetch ? checkGiphyKey(apiKey, { fetch: giphyFetch }) : "unknown"),
  });
  let gifs: GifProvider | null = options.gifs === undefined ? createFakeGifs() : options.gifs;
  if (giphyFetch) gifs = createKeyedGifs({ key: () => gifKey.key(), fetch: giphyFetch });
  const adapters: Adapters = {
    search: createPostgresSearchResolver(db),
    pubsub: createMemoryPubSub(),
    presence: createMemoryPresence(),
    rateLimiter: createMemoryRateLimiter(),
    keyWrapper,
    legacyKeyWrappers: [],
    platformCredentials: noPlatformCredentials,
    email,
    platformBlobs,
    push,
    webPush,
    ...(options.mail ? { mail: options.mail } : {}),
    databases: options.databases ?? null,
    humanCheck: options.humanCheck ?? null,
    gifs,
  };
  const provider = createFakeProvider(options.reply);
  const embeddings = createFakeEmbeddings();
  const engine = buildEngine({
    db,
    config,
    adapters,
    modelProviders: Object.fromEntries(PROVIDER_IDS.map((id) => [id, provider])),
    toolSources: options.toolSources,
    appleRevoke: options.appleRevoke,
    mcpConnect: options.mcpConnect,
    http: options.http,
    embeddings: options.embeddings ? { provider: embeddings, apiKey: "test" } : undefined,
    s3Fetch: options.s3Fetch,
    speechFetch: options.speechFetch,
    resolveHost: options.resolveHost,
    github: options.github,
    judge: createFakeJudge(options.judge),
    schedules: createFakeScheduleReader({ ...TEST_SCHEDULES, ...options.schedules }),
    toolsOnDemand: false,
    emailArt: options.emailArt,
    jevFetch: options.jevFetch,
    routerQuietMs: 0,
  });
  // As at boot: the saved Jev and GIPHY keys and GitHub App are read before anything serves.
  await engine.jevKey.ready();
  await gifKey.ready();
  await engine.githubApp.ready();
  const { handlers } = engine;
  const auth = createAuth({
    db,
    config,
    log,
    emailDelivers: true,
    rateLimiter: adapters.rateLimiter,
    humanCheck: adapters.humanCheck,
    pubsub: adapters.pubsub,
  });
  const app = createApp({
    edition: "selfhost",
    version: "test",
    modules: [],
    pingDatabase: async () => {},
    appsFetchDocument:
      options.appsFetchDocument ??
      (async () => {
        throw new Error("no network in tests");
      }),
    services: {
      db,
      auth,
      config,
      adapters,
      extras: {
        http: options.http,
        mcpConnect: options.mcpConnect,
        resolveHost: options.resolveHost,
        embed: engine.gateway.embed,
        storage: engine.storage,
        artifacts: engine.artifacts,
        context: engine.context,
        sandbox: engine.sandbox,
        gitProxy: engine.gitProxy,
        desktopFetch: options.desktopFetch,
        browserLive: engine.browserLive,
        router: engine.router,
        streams: engine.streams,
        jevKey: engine.jevKey,
        gifKey,
        githubApp: engine.githubApp,
        speech: engine.speech,
        voice: engine.voice,
      },
    },
    log,
  });
  const realtime = createRealtime({
    db,
    auth,
    config,
    log,
    ...adapters,
    machines: createMachineSockets(engine.machineHub),
    browserLive: engine.browserLive,
    streams: createStreamSockets({ db, auth, config, broker: engine.streams }),
  });
  return {
    db,
    close: async () => {
      await engine.machineHub.stop();
      engine.streams.stop();
      await close();
    },
    config,
    adapters,
    provider,
    embeddings,
    email,
    push,
    webPush,
    platformBlobs,
    engine,
    /** The installation's GIPHY key (ADR 0091), as its owner's routes change it. */
    gifKey,
    app,
    auth,
    realtime,
    drain: () => drainOutbox(db, handlers),
  };
}

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

/** Starts a real Bun server on a random port (needed for WebSocket tests). */
export function listen(t: TestServer) {
  return Bun.serve<SocketData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => t.realtime.fetch(req, srv, (r) => t.app.fetch(r)),
    websocket: t.realtime.websocket,
  });
}

/** A WebSocket upgrade's HTTP status, for refused connections (a plain request with the upgrade headers). */
export async function upgradeStatus(url: string, headers: Record<string, string>) {
  const res = await fetch(url.replace("ws://", "http://"), {
    headers: {
      ...headers,
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  });
  return res.status;
}

/** Minimal browser over `app.request`: keeps cookies and sends our Origin. */
export function browser(t: TestServer) {
  let cookie = "";
  const request = async (
    path: string,
    init: {
      method?: string;
      json?: unknown;
      body?: RequestInit["body"];
      origin?: string | null;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const headers = new Headers(init.headers);
    // The tests' people read Portuguese, as before English became the default (a browser that says none reads English).
    if (!headers.has("accept-language")) headers.set("accept-language", "pt-BR");
    if (cookie) headers.set("cookie", cookie);
    if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const res = await t.app.request(path, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      if (!pair) continue;
      const [name] = pair.split("=");
      const rest = cookie
        .split("; ")
        .filter((p) => p && !p.startsWith(`${name}=`))
        .join("; ");
      cookie = [rest, pair].filter(Boolean).join("; ");
    }
    return res;
  };
  return Object.assign(request, { cookie: () => cookie });
}

export type Browser = ReturnType<typeof browser>;

/** The Google app `googleSignIn` expects the server to have. */
export const GOOGLE_ENV = { GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret" };

/** Google's token endpoint answering an ID token for `email`, which Google verified or not. Nothing else is reached. */
export function fakeGoogle(email: string, verified = true): typeof fetch {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = { iss: "https://accounts.google.com", aud: GOOGLE_ENV.GOOGLE_CLIENT_ID, sub: `g-${email}`, email };
  const idToken = `${part({ alg: "RS256", kid: "k" })}.${part({ ...claims, email_verified: verified, name: "Ana" })}.sig`;
  return (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://oauth2.googleapis.com/token") throw new Error(`unexpected fetch: ${url}`);
    return Response.json({ access_token: "ya29.test", id_token: idToken, token_type: "Bearer", expires_in: 3600 });
  }) as typeof fetch;
}

/** Where each app's Google sign-in comes back to: the web's page, the Mac app's browser page, the phone app. */
export const GOOGLE_BACK = {
  web: "/",
  desktop: `/desktop/sign-in?provider=google&request=${"r".repeat(43)}&done=1`,
  phone: "agenteschat:///",
} as const;

/**
 * A Google sign-in as `email`, started the way `app` starts it, back through its callback: where the browser lands, and
 * that browser. The web and the Mac app's browser page (apps/web better-auth.ts) name `/login` for a refusal; the phone
 * goes through the Expo plugin, then its system browser. `earlyAccess` rides in the state as every app sends it.
 */
export async function googleSignIn(
  t: TestServer,
  app: keyof typeof GOOGLE_BACK,
  email: string,
  options: { earlyAccess?: string; verified?: boolean } = {},
) {
  const body = {
    provider: "google",
    callbackURL: GOOGLE_BACK[app],
    ...(app === "phone" ? {} : { errorCallbackURL: "/login" }),
    ...(options.earlyAccess ? { additionalData: { earlyAccess: options.earlyAccess } } : {}),
  };
  const starter = browser(t);
  const phone = { origin: null, headers: { "expo-origin": "agenteschat://", "x-agentes-client": "mobile" } };
  const start = await starter("/api/auth/sign-in/social", { json: body, ...(app === "phone" ? phone : {}) });
  if (start.status !== 200) throw new Error(`sign-in start: ${start.status} ${await start.text()}`);
  const authorizationURL = ((await start.json()) as { url: string }).url;
  const at = app === "phone" ? browser(t) : starter;
  if (app === "phone") {
    const proxy = await at(`/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`, {
      origin: null,
    });
    if (proxy.status !== 302) throw new Error(`expo proxy: ${proxy.status}`);
  }
  const state = new URL(authorizationURL).searchParams.get("state") ?? "";
  const real = globalThis.fetch;
  globalThis.fetch = fakeGoogle(email, options.verified ?? true);
  try {
    const back = await at(`/api/auth/callback/google?code=c0de&state=${state}`, { origin: null });
    return { location: back.headers.get("location") ?? "", browser: at };
  } finally {
    globalThis.fetch = real;
  }
}

/** The code the last code email carries (its subject starts with it). */
export const lastCode = (t: TestServer) =>
  t.email.sent.flatMap((m) => /^(\d{6}) /.exec(m.subject)?.[1] ?? []).at(-1) ?? "";

/**
 * The code that deletes `orgId` (the account when null), emailed and read back as the person does (ADR 0088 §2). The
 * last one is taken to have gone out a while ago, so a test asks for one after another without waiting their minute.
 */
export async function deletionCode(t: TestServer, b: Browser, orgId: string | null) {
  await t.db
    .update(schema.verifications)
    .set({ createdAt: new Date(Date.now() - 120_000) })
    .where(like(schema.verifications.identifier, "deletion-code:%"));
  const path = orgId ? `/api/app/organizations/${orgId}/deletion/code` : "/api/app/account/deletion/code";
  const sent = await b(path, { json: {} });
  if (sent.status !== 202) throw new Error(`deletion code: ${sent.status} ${await sent.text()}`);
  await t.drain();
  return lastCode(t);
}

/** The 7 days pass: every account waiting for its deletion goes, by its job. */
export async function deletionsDue(t: TestServer) {
  await t.db
    .update(schema.users)
    .set({ deletionDueAt: new Date(Date.now() - 60_000) })
    .where(isNotNull(schema.users.deletionDueAt));
  await t.db
    .update(schema.outbox)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(schema.outbox.kind, "account.delete"));
  await t.drain();
}

export async function signUp(b: Browser, email: string) {
  const res = await b("/api/auth/sign-up/email", {
    json: { email, password: "correct horse battery", name: email.split("@")[0] },
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  return res;
}

/**
 * Someone joins `orgId` the way people do (ADR 0068): `admin` invites the address by email, a new browser signs
 * up with it (the invitation opens sign-up on this closed server) and accepts. `as`: an account already signed in
 * with that address accepts instead.
 */
export async function joinByInvitation(
  t: TestServer,
  admin: Browser,
  orgId: string,
  email: string,
  options: { role?: "member" | "admin"; as?: Browser } = {},
) {
  // `admin`: invited with the workspace's role that holds `administrator` (its "Admin", ADR 0085).
  let roleIds: string[] = [];
  if (options.role === "admin") {
    const res = await admin(`/api/app/organizations/${orgId}/roles`);
    const { roles } = (await res.json()) as { roles: { id: string; permissions: string[] }[] };
    roleIds = roles
      .filter((r) => r.permissions.includes("administrator"))
      .map((r) => r.id)
      .slice(0, 1);
  }
  const invited = await admin(`/api/app/organizations/${orgId}/invitations`, {
    json: { email, roleIds },
  });
  if (invited.status !== 201) throw new Error(`invite failed: ${invited.status} ${await invited.text()}`);
  const token = ((await invited.json()) as { url: string }).url.split("/invite/")[1] ?? "";
  const b = options.as ?? browser(t);
  if (!options.as) await signUp(b, email);
  const accepted = await b(`/api/app/invitations/${token}/accept`, { json: {} });
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status} ${await accepted.text()}`);
  return b;
}

/**
 * Connects a computer over HTTP the way the runner and the site do (ADR 0036
 * §5): the computer asks for a code, a member confirms it through `orgApi`
 * (their `/api/app/organizations/{orgId}` calls), the computer polls for
 * its token.
 */
export async function pairComputer(
  t: TestServer,
  orgApi: (path: string, init?: Parameters<Browser>[1]) => Promise<Response>,
  computer: Record<string, unknown>,
  options: { name?: string; ip?: string } = {},
) {
  const runner = (path: string, body: unknown) =>
    t.app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": options.ip ?? "203.0.113.9" },
      body: JSON.stringify(body),
    });
  const started = await runner("/api/machines/device", { name: options.name ?? "MacBook", ...computer });
  if (started.status !== 200) throw new Error(`device start failed: ${started.status} ${await started.text()}`);
  const { deviceCode, userCode } = (await started.json()) as { deviceCode: string; userCode: string };
  const confirmed = await orgApi(`/machines/device/${userCode}/confirm`, {
    json: options.name ? { name: options.name } : {},
  });
  if (confirmed.status !== 201) throw new Error(`confirm failed: ${confirmed.status} ${await confirmed.text()}`);
  const token = await runner("/api/machines/device/token", { deviceCode });
  if (token.status !== 200) throw new Error(`token failed: ${token.status} ${await token.text()}`);
  return (await token.json()) as { machineId: string; token: string; name: string; org: { id: string; name: string } };
}

/** Owner with an organization, a credential and an agent `@dev` in #general (a fixed model, not Automático). */
export async function seedOrg(b: Browser) {
  const created = (await (
    await b("/api/app/organizations", { json: { name: "Acme", context: "Acme builds rockets." } })
  ).json()) as {
    organization: { id: string };
    generalChannelId: string;
  };
  const orgId = created.organization.id;
  const credential = (await (
    await b(`/api/app/organizations/${orgId}/credentials`, {
      json: { provider: "anthropic", label: "main", apiKey: "sk-ant-api-secret-9876" },
    })
  ).json()) as { id: string };
  const agent = (await (
    await b(`/api/app/organizations/${orgId}/agents`, {
      json: {
        name: "Dev",
        handle: "dev",
        model: "claude-sonnet-5-5",
        credentialId: credential.id,
        monthlyBudgetUsd: 50,
      },
    })
  ).json()) as { id: string };
  await b(`/api/app/organizations/${orgId}/channels/${created.generalChannelId}/members`, {
    json: { agentId: agent.id },
  });
  return { orgId, channelId: created.generalChannelId, credentialId: credential.id, agentId: agent.id };
}
