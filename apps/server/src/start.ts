import { existsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { join, resolve } from "node:path";
import {
  type Adapters,
  createBitwardenSource,
  createComposioClient,
  createComposioMailConnector,
  createDiskBlobStore,
  createErrorReporter,
  createExpoPushSender,
  createFcmPushSender,
  createGiphyGifs,
  createImapConnectionTester,
  createImapMailConnector,
  createImapPoller,
  createKeyedGifs,
  createLogEmailSender,
  createMemoryPresence,
  createMemoryPubSub,
  createMemoryRateLimiter,
  createMillionSendSender,
  createOnePasswordSource,
  createPhonePushSender,
  createPostgresBlobStore,
  createPostgresDatabaseDriver,
  createPostgresPubSub,
  createPostgresSearchResolver,
  createRelayPushSender,
  createS3BlobStore,
  createSmtpEmailSender,
  createTurnstileCheck,
  createWebPushSender,
  type EmailSender,
  type ErrorReporter,
  envPlatformCredentials,
  type GifProvider,
  type KeyWrapper,
  MAIL_PRESETS,
  type MailAdapters,
  type PushSender,
  postgresJsNotifier,
  type WebPushSender,
} from "@agenteschat/adapters";
import { type Config, ConfigError, composioAuthConfigs, loadConfig, redactConfig } from "@agenteschat/config";
import {
  createDatabase,
  type Database,
  type DatabaseHandle,
  ensureMessagePartitions,
  MigrationMismatchError,
} from "@agenteschat/db";
import {
  APP_JOB_KINDS,
  adoptRestoredOperatorEvents,
  allowPrivateOutbound,
  allowsPrivateEndpoints,
  backfillMemoryTrust,
  composioUsageHook,
  createGifKey,
  createLocalKeyWrapper,
  defaultEmailFrom,
  drainLocalRuns,
  EMAIL_PICTURES,
  emailArtFor,
  enableAccountContacts,
  enableCaches,
  enableOperatorEvents,
  ensureRightHands,
  type GifKey,
  isAgentesCloud,
  isBlockedAddress,
  laneLimits,
  memoryBudget,
  meterComposio,
  moveIssueComments,
  publicHttpsFetch,
  queueEmbeddingBackfill,
  relayCredentials,
  resolveHostDns,
  retireHostTokens,
  retireMillionSendMailboxes,
  setMessageLinkBase,
  setRestrictionNotices,
  setWorkspaceComputers,
  shareCacheInvalidations,
  surfaceRoomFiles,
  vapidKeys,
  vapidSubject,
  widenDmHowTos,
} from "@agenteschat/engine";

import { type AgentesModule, type Edition, type ModuleContext, resolveAdapters } from "@agenteschat/modules";
import { createModelProviders, enableOpenRouterModels } from "@agenteschat/providers";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { buildEngine } from "./engine";
import { startFreezeWatch } from "./freeze-watch";
import { checkHumanCheckAtBoot } from "./http/human-check";
import { createLogger, type Logger } from "./logger";
import { OPERATOR_API_PREFIX, serveOperatorApi } from "./operator/app";
import { createMachineSockets } from "./realtime/machines";
import { createStreamSockets } from "./realtime/streams";
import { createRealtime, type SocketData } from "./realtime/ws";
import { workerHealth } from "./routes/health";
import { startTelemetry } from "./telemetry";
import { releaseOf, version } from "./version";
import { startWorkers } from "./workers";

/** On SIGTERM, how long runs in progress get to finish before they are handed to the next instance. */
const RUN_DRAIN_MS = 20_000;
/** How long the other jobs running here get at least (as long as the runs take, if longer) before they go back. */
const JOB_DRAIN_MS = 5_000;

/** How long the `agentes` tool calls of computers' tasks still running here get at least to store their answers. */
const MCP_DRAIN_MS = 5_000;

/** How long error reports still on their way get before the process exits. */
const EXIT_FLUSH_MS = 2_000;

export interface StartOptions {
  edition: Edition;
  modules?: AgentesModule[];
  /**
   * Answer only requests addressed to this server's own names (`127.0.0.1:<PORT>`, `localhost:<PORT>`
   * and `PUBLIC_URL`'s host), with a 421 for any other: native mode listens on loopback, where a web
   * page that points a name of its own at 127.0.0.1 (DNS rebinding) would otherwise reach it.
   */
  ownHostsOnly?: boolean;
}

/**
 * The engine's process-wide switches this config sets, every one of them here: `startServer` sets them at boot, and a
 * test that boots like a given setup (the Cloud) sets them the same way.
 */
export function applyBootSwitches(config: Config) {
  // On agentes.chat Cloud a restriction names its kind and how to contest it, elsewhere it reads as before.
  setRestrictionNotices(config.PUBLIC_URL);
  // The links to messages that agents write and their tools return.
  setMessageLinkBase(config.PUBLIC_URL);
  // The operator API's events feed records only while that API is on (ADR 0056).
  enableOperatorEvents(Boolean(config.OPERATOR_API_TOKEN));
  // Where each workspace gets its own computer, the computers people bring are targets, never agents' homes.
  setWorkspaceComputers(config.MACHINE_PROVISIONING === "external");
}

/**
 * Boots an agentes.chat server: config → database → migrations → adapters
 * (core defaults, then module overrides) → HTTP + WebSocket → workers.
 * Shared by the self-hosted entrypoint (`src/main.ts`) and any entrypoint
 * that adds public modules (ADR 0002); only `modules` differ.
 */
export async function startServer(options: StartOptions) {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`${error.message}\n\nCopy .env.example to .env and fill in the required values.`);
      process.exit(1);
    }
    throw error;
  }

  const release = releaseOf(config);
  const errors = await createErrorReporter({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    release,
    runtime: { name: "bun", version: Bun.version },
  });
  const log = createLogger(config.LOG_LEVEL, errors);
  try {
    const started = await boot(options, config, log, release, errors);
    // Once it serves: a boot's own long steps (migrations, the built-in database's start) aren't what it is for.
    startFreezeWatch(
      {
        logLevel: config.LOG_LEVEL,
        ...(config.SENTRY_DSN
          ? { reports: { dsn: config.SENTRY_DSN, environment: config.SENTRY_ENVIRONMENT, release } }
          : {}),
      },
      log,
    );
    return started;
  } catch (error) {
    log.error("startup failed", { error, unhandled: true });
    await log.flush(EXIT_FLUSH_MS);
    throw error;
  }
}

/** Everything of the boot after the config, so `startServer` can report what fails in it. */
async function boot(
  { edition, modules = [], ownHostsOnly = false }: StartOptions,
  config: Config,
  log: Logger,
  release: string,
  errors: ErrorReporter,
) {
  log.info("starting agentes.chat", { version: release, edition, config: redactConfig(config) });
  log.info(
    "error reports",
    config.SENTRY_DSN
      ? { to: new URL(config.SENTRY_DSN).host, environment: config.SENTRY_ENVIRONMENT, release }
      : { reports: "off" },
  );
  if (config.NODE_ENV === "production" && config.PUBLIC_URL === "http://localhost:3000") {
    log.warn(
      "PUBLIC_URL is http://localhost:3000 (the default): only a browser on this machine, at exactly that address, can sign in and save. Set PUBLIC_URL to the address people open (e.g. https://chat.example.com): sign-in cookies, the browser origin allowed to make changes (CSRF) and the links in emails all come from it, so from any other address sign-in and saving fail with bad_origin.",
    );
  }

  const database = createDatabase({ url: config.DATABASE_URL, poolMax: config.DATABASE_POOL_MAX });
  await prepareDatabase(database, log, config.RUN_MIGRATIONS_ON_BOOT);
  // Best effort: a replica that boots before the migrations ran (RUN_MIGRATIONS_ON_BOOT=false) still starts.
  await retireHostTokens(database.db, config.HOST_COMPUTER_TOKEN).then(
    (retired) =>
      retired > 0 && log.info("this server's computer: tokens of an earlier HOST_COMPUTER_TOKEN retired", { retired }),
    (error: unknown) => log.warn("couldn't check this server's computer's tokens", { error: String(error) }),
  );

  // Browser push's VAPID key is sealed with the installation's key wrappers, read once modules had their
  // say (`resolved`, ADR 0071).
  const localKeyWrapper = createLocalKeyWrapper(config.AGENTES_SECRET);
  let resolved: Adapters | null = null;
  // The push relay's credentials are sealed the same way (ADR 0152).
  const keyWrappers = () => [resolved?.keyWrapper ?? localKeyWrapper, ...(resolved?.legacyKeyWrappers ?? [])];
  // Android pushes straight to Firebase and the push relay this server may run share one sender, so one access
  // token (ADR 0152).
  const account = config.FIREBASE_SERVICE_ACCOUNT;
  const fcm = account ? createFcmPushSender({ serviceAccount: account }) : null;
  // The GIPHY key its owner may add in Settings (ADR 0091, amended 2026-10-31), made below once modules had their
  // say on the key wrappers; the GIF provider asks it on every call.
  let gifKey: GifKey | null = null;
  const defaults: Adapters = {
    search: createPostgresSearchResolver(database.db),
    // PGlite (native mode) is one process: nothing to tell other replicas.
    pubsub: database.client ? await createPostgresPubSub(postgresJsNotifier(database.client)) : createMemoryPubSub(),
    presence: createMemoryPresence(),
    rateLimiter: createMemoryRateLimiter(),
    keyWrapper: localKeyWrapper,
    legacyKeyWrappers: [],
    email: emailSender(config, log),
    platformCredentials: envPlatformCredentials({
      anthropic: { apiKey: config.PLATFORM_ANTHROPIC_API_KEY, workspaceId: config.PLATFORM_ANTHROPIC_WORKSPACE_ID },
    }),
    platformBlobs: platformBlobStore(config, database.db),
    // Phone app push (ADR 0035, ADR 0152): only devices that registered get anything. Android straight to
    // Firebase or through the push relay (`PUSH_SENDER`); iPhones through Expo.
    push: createPhonePushSender({
      android: androidPushSender(config, fcm, database.db, keyWrappers, release),
      ios: createExpoPushSender({ accessToken: config.EXPO_ACCESS_TOKEN }),
    }),
    // Browser push (ADR 0071): the installation's own VAPID pair, made on first use.
    webPush: webPushSender(config, database.db, keyWrappers, log),
    // Each Composio call counts for its workspace before it is made (ADR 0107 §7).
    mail: mailAdapters(
      config,
      database.db,
      meterComposio({ db: database.db, cap: config.COMPOSIO_CALLS_PER_MONTH, pubsub: () => resolved?.pubsub }),
    ),
    // People's Postgres databases for agents (ADR 0039): always on; every connection is checked and read-only.
    databases: createPostgresDatabaseDriver(),
    // agentes.chat Cloud's bot check (ADR 0075), only with both keys: without them nothing reaches Cloudflare.
    humanCheck:
      config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY
        ? createTurnstileCheck({
            siteKey: config.TURNSTILE_SITE_KEY,
            secretKey: config.TURNSTILE_SECRET_KEY,
            hostnames: [new URL(config.PUBLIC_URL).hostname],
            log,
          })
        : null,
    // GIFs in chat (ADR 0091), only with a key: without one nothing reaches GIPHY and the app shows no GIFs.
    gifs: gifProvider(config, () => gifKey?.key() ?? null),
    // The Vault's external sources (ADR 0144): nothing reaches them until a person connects one. A self-hosted
    // Bitwarden's address is typed by a person, so its requests go only to public addresses, pinned at connect time.
    vaultSources: Object.fromEntries(
      [createOnePasswordSource(), createBitwardenSource({ fetch: publicHttpsFetch() })].map((source) => [
        source.kind,
        source,
      ]),
    ),
  };
  log.info("platform file storage", { kind: defaults.platformBlobs.kind });
  log.info("transactional email", { sender: defaults.email.id });
  log.info("mail for agents", {
    composio: Boolean(defaults.mail?.composio),
    imap: Boolean(defaults.mail?.imap),
  });
  log.info("browser push", defaults.webPush ? { webPush: "on", contact: vapidSubject(config) } : { webPush: "off" });
  const androidPush = androidPushMode(config);
  log.info("phone push", { android: androidPush, ios: "expo" });
  if (androidPush === "relay") {
    // Said at every boot, so whoever runs the server knows what leaves it and how to stop it (ADR 0152).
    log.info(
      "Android pushes go through the push relay: each one's phone token, title, text and ids pass through it, which keeps none of them. PUSH_SENDER=off turns them off; FIREBASE_SERVICE_ACCOUNT sends them straight to Firebase.",
      { relay: new URL(config.PUSH_RELAY_URL).host },
    );
  }
  if (config.PUSH_SENDER === "direct" && !config.FIREBASE_SERVICE_ACCOUNT) {
    log.warn("PUSH_SENDER=direct without FIREBASE_SERVICE_ACCOUNT: Android phones get no push");
  }
  if (config.PUSH_RELAY_SERVE === "on") {
    const serving = config.FIREBASE_SERVICE_ACCOUNT ? "/api/push-relay/v1" : "nothing (no FIREBASE_SERVICE_ACCOUNT)";
    log.info("push relay", { serving });
  }
  const base = { config, db: database.db, edition, version: release };
  const { adapters, modelProviders, overridden } = await resolveAdapters(
    modules,
    base,
    defaults,
    // A workspace's own model endpoint (ADR 0146): on agentes.chat Cloud every call connects only to public addresses.
    createModelProviders({
      endpointFetch: allowsPrivateEndpoints(config) ? undefined : publicHttpsFetch(),
      version: release,
    }),
  );
  if (overridden.length > 0) log.info("adapters overridden by modules", { overridden });
  resolved = adapters;
  if (!isAgentesCloud(config.PUBLIC_URL)) {
    // Sealed with the installation's key wrappers, like the Jev key (ADR 0073), and read before anything serves.
    gifKey = createGifKey({
      db: database.db,
      keyWrapper: adapters.keyWrapper,
      keyWrappers: [adapters.keyWrapper, ...adapters.legacyKeyWrappers],
      envKey: config.GIPHY_API_KEY,
    });
    await gifKey.ready();
  }
  log.info("GIFs in chat", { provider: adapters.gifs?.name ?? "off", available: adapters.gifs?.available() ?? false });
  try {
    await checkHumanCheckAtBoot(adapters.humanCheck, log);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const ctx: ModuleContext = { ...base, adapters };

  // Addresses a workspace names (custom MCP servers, its own bucket, pages agents read) are pinned to public ones at
  // every request, except where the operator lets workspaces reach this server's network.
  allowPrivateOutbound(allowsPrivateEndpoints(config));
  // Per-process caches for agent/org/channel config, scopes, connections, credential rows (30 s TTL).
  enableCaches();
  // A write in any process (the app, a worker) clears what every process cached of it.
  shareCacheInvalidations(adapters.pubsub);
  // OpenRouter's public model list (ADR 0087): read only while a workspace has an OpenRouter key.
  enableOpenRouterModels(fetch);
  applyBootSwitches(config);
  enableAccountContacts(config.PUBLIC_URL, adapters.email);
  if (config.OPERATOR_API_TOKEN) {
    // Before the API serves a page: a caller restarting after a restore must find these rows first.
    const adopted = await adoptRestoredOperatorEvents(database.db);
    if (adopted > 0) log.info("operator events from a restored dump moved to the front of the feed", { adopted });
  }
  const webDir = resolve(config.WEB_DIR);
  const emailArt = await emailArtFor(config.PUBLIC_URL, existsSync(webDir) ? webDir : undefined, config.EMAIL_ART);
  const because = {
    attach: "EMAIL_ART=attach",
    blocked: "PUBLIC_URL's host is private",
    unreachable: "PUBLIC_URL's host didn't resolve, until a restart",
  };
  const pictures = {
    from: emailArt.base ?? "attached to each message",
    ...(emailArt.attached && { because: because[emailArt.attached] }),
  };
  // A failed lookup attaches them for the whole run, though the host may well be public.
  if (emailArt.attached === "unreachable") log.warn("email pictures", pictures);
  else log.info("email pictures", pictures);
  // One missing picture leaves them all linked, even where they should go attached (`emailArtFor`).
  const missing = EMAIL_PICTURES.filter((f) => !existsSync(join(webDir, "email", f)));
  if (missing.length > 0) {
    log.warn("emails' pictures not found: they won't show", { dir: join(webDir, "email"), missing });
  }
  const engine = buildEngine({
    db: database.db,
    config,
    adapters,
    modelProviders,
    onTiming: (name, ms, attrs) => log.info("latency", { metric: name, ms, ...attrs }),
    onRunProfile: (p) => log.debug("run profile", p),
    emailArt,
    log,
    errors,
  });
  // The saved Jev key, before anything calls Jev (vision reads it synchronously); the saved GitHub App likewise.
  await engine.jevKey.ready();
  await engine.githubApp.ready();
  await engine.speech.ready();
  log.info("voice messages", { engines: engine.speech.chain().map((e) => e.id) });
  // Off the boot path: it calls MillionSend once per mailbox left from the withdrawn path (ADR 0102).
  void retireMillionSendMailboxes({ db: database.db, keyWrappers: engine.mail.keyWrappers })
    .then((r) => {
      if (r.checked > 0)
        log.info("MillionSend mailboxes disconnected", { checked: r.checked, webhooksLeft: r.webhooksLeft });
    })
    .catch((error: unknown) => log.warn("MillionSend mailboxes cleanup failed", { error: String(error) }));
  // Off the boot path: every workspace made before the right hand gets one (ADR 0137); one query once they all have it.
  void ensureRightHands(database.db)
    .then((made) => {
      if (made > 0) log.info("right hands created", { made });
    })
    .catch((error: unknown) => log.warn("right hands backfill failed", { error: String(error) }));
  // Off the boot path, once (ADR 0167): untrusted memories saved from a person's own words are trusted again, and
  // how-tos agents worked out between themselves that name nobody reach their other work.
  void backfillMemoryTrust(database.db)
    .then(async (r) => {
      if (Object.keys(r.changed).length > 0) log.info("memory trust re-derived", { ...r });
      const widened = await widenDmHowTos(database.db);
      if (widened > 0) log.info("how-tos out of agents' DMs", { widened });
    })
    .catch((error: unknown) => log.warn("memory backfill failed", { error: String(error) }));
  // Off the boot path (ADR 0167): what this model hasn't embedded yet gets its vectors, a reindex per workspace.
  const vectors = engine.embeddings;
  if (config.EMBEDDINGS_PROVIDER !== "none" && !vectors) {
    const missing = config.EMBEDDINGS_PROVIDER === "voyage" ? "VOYAGE_API_KEY" : "EMBEDDINGS_URL";
    log.warn("search goes on words alone", {
      because: `EMBEDDINGS_PROVIDER=${config.EMBEDDINGS_PROVIDER} needs ${missing}`,
    });
  }
  if (vectors?.kinds) {
    void queueEmbeddingBackfill(database.db, { model: vectors.provider.model, kinds: vectors.kinds })
      .then((queued) => {
        if (queued > 0) log.info("embeddings backfill queued", { workspaces: queued, model: vectors.provider.model });
      })
      .catch((error: unknown) => log.warn("embeddings backfill failed", { error: String(error) }));
  }
  // Off the boot path: tasks' comments from before their conversations move into them once (ADR 0145).
  void moveIssueComments(database.db)
    .then((moved) => {
      if (moved > 0) log.info("task comments moved to conversations", { moved });
    })
    .catch((error: unknown) => log.warn("task comments move failed", { error: String(error) }));
  // Off the boot path: files agents saved in rooms no person reads go to the person they worked for (ADR 0111).
  void surfaceRoomFiles(database.db)
    .then((moved) => {
      if (moved > 0) log.info("files moved out of agent rooms", { moved });
    })
    .catch((error: unknown) => log.warn("files move out of agent rooms failed", { error: String(error) }));
  // A worker (`SERVER_ROLE=worker`) runs jobs only: no app, API, sockets or usage report, its health check alone. Its
  // runs reach computers through the process that holds their socket (`machine_rpc`).
  const worker = config.SERVER_ROLE === "worker";
  const slots = { quick: config.OUTBOX_QUICK_SLOTS, long: config.OUTBOX_MAX_IN_FLIGHT - config.OUTBOX_QUICK_SLOTS };
  const memoryBytes = memoryBudget({
    limitBytes: process.constrainedMemory() || totalmem(),
    rssBytes: process.memoryUsage().rss,
    freeBytes: freemem(),
  });
  const outbox = {
    maxInFlight: config.OUTBOX_MAX_IN_FLIGHT,
    quickSlots: config.OUTBOX_QUICK_SLOTS,
    ...(worker && { skipKinds: APP_JOB_KINDS }),
    // The built-in database is one process's, on one computer: its slots stay where they start.
    ...(database.client && {
      limits: laneLimits(
        slots,
        { memoryBytes, rssBytes: process.memoryUsage().rss, dbConnections: config.DATABASE_POOL_MAX },
        config.OUTBOX_MAX_IN_FLIGHT_CEILING,
      ),
      memoryBytes,
    }),
  };
  log.info("job slots", { start: slots, upTo: outbox.limits ?? "fixed", memoryBytes, role: config.SERVER_ROLE });
  const workers = startWorkers({
    db: database.db,
    handlers: engine.handlers,
    pubsub: adapters.pubsub,
    context: engine.context,
    artifacts: engine.artifacts,
    feedbackFiles: { db: database.db, blobs: adapters.platformBlobs },
    voice: engine.voice,
    approvalDigest: { publicUrl: config.PUBLIC_URL, afterHours: config.APPROVAL_REMINDER_HOURS },
    mail: { deps: engine.mail, pollSeconds: config.MAIL_POLL_SECONDS },
    browserLive: engine.browserLive,
    desktops: engine.desktops,
    ...(config.OPS_REPORT_EMAIL?.length
      ? { opsReport: { to: config.OPS_REPORT_EMAIL, publicUrl: config.PUBLIC_URL } }
      : {}),
    outbox,
    builtInDatabase: !database.client,
    log,
  });
  const telemetry = worker ? null : startTelemetry({ db: database.db, config, log });

  const auth = createAuth({
    db: database.db,
    config,
    log,
    emailDelivers: adapters.email.delivers,
    rateLimiter: adapters.rateLimiter,
    humanCheck: adapters.humanCheck,
    pubsub: adapters.pubsub,
  });
  let stopping = false;
  const app = createApp({
    edition,
    version,
    modules,
    draining: () => stopping,
    moduleContext: ctx,
    services: {
      db: database.db,
      auth,
      config,
      adapters,
      wakeWorkers: workers.wakeAll,
      extras: {
        embed: engine.gateway.embed,
        storage: engine.storage,
        artifacts: engine.artifacts,
        context: engine.context,
        sandbox: engine.sandbox,
        browserLive: engine.browserLive,
        streams: engine.streams,
        talker: engine.talker,
        router: engine.router,
        jevKey: engine.jevKey,
        gifKey: gifKey ?? undefined,
        githubApp: engine.githubApp,
        speech: engine.speech,
        voice: engine.voice,
        gitProxy: engine.gitProxy,
        pushRelaySender: fcm,
      },
    },
    log,
    pingDatabase: database.ping,
    webDir: existsSync(webDir) ? webDir : undefined,
  });
  if (!worker && !existsSync(webDir)) log.warn("web app not found; serving API only", { webDir });

  const realtime = createRealtime({
    db: database.db,
    auth,
    config,
    log,
    ...adapters,
    machines: createMachineSockets(engine.machineHub),
    browserLive: engine.browserLive,
    streams: createStreamSockets({ db: database.db, auth, config, broker: engine.streams }),
  });
  const publicUrl = new URL(config.PUBLIC_URL);
  const ownHosts = ownHostsOnly
    ? new Set([`127.0.0.1:${config.PORT}`, `localhost:${config.PORT}`, publicUrl.host])
    : null;
  /**
   * A 421 for a name not its own; and a page opened at another of its own names goes to `PUBLIC_URL`,
   * the only origin that sign-in and saving accept. Temporary: `PUBLIC_URL` changes with Tailscale.
   */
  const ownHostAnswer = (req: Request) => {
    const host = req.headers.get("host") ?? "";
    if (!ownHosts || host === publicUrl.host) return null;
    if (!ownHosts.has(host)) return new Response("This server answers only at its own address.\n", { status: 421 });
    if (req.method !== "GET" || !req.headers.get("accept")?.includes("text/html")) return null;
    const { pathname, search } = new URL(req.url);
    return Response.redirect(new URL(pathname + search, publicUrl).href, 302);
  };
  // A worker answers its health check alone: the image's check reads it, and a deploy waits for it.
  const server = worker
    ? Bun.serve({
        hostname: config.HOST,
        port: config.PORT,
        fetch: workerHealth({
          version,
          edition,
          modules: modules.map((m) => m.name),
          pingDatabase: database.ping,
          draining: () => stopping,
        }),
      })
    : Bun.serve<SocketData>({
        hostname: config.HOST,
        port: config.PORT,
        // Bun's default (10 s) cuts a request still waiting on its answer: opening a site in an agent's
        // browser waits for the page, and a closed browser starts first (up to 90 s on the computer).
        idleTimeout: 120,
        fetch: (req, srv) => ownHostAnswer(req) ?? realtime.fetch(req, srv, (r) => app.fetch(r)),
        websocket: realtime.websocket,
        // What the HTTP app doesn't answer itself: a WebSocket upgrade that failed before the socket opened.
        error(error) {
          log.error("request failed", { error, stack: error.stack });
          return new Response("Something went wrong on our side\n", { status: 500 });
        },
      });
  log.info(worker ? "running jobs only, answering /api/health alone (SERVER_ROLE=worker)" : "listening", {
    url: `http://${config.HOST}:${config.PORT}`,
  });
  const operator = worker
    ? null
    : serveOperatorApi({
        db: database.db,
        config,
        version: release,
        log,
        pubsub: adapters.pubsub,
        hub: engine.machineHub,
        emails: adapters.email.delivers,
        humanCheck: adapters.humanCheck,
        sessions: engine.sessions,
      });
  if (operator) {
    log.info("operator API listening", { url: `http://${config.HOST}:${operator.port}${OPERATOR_API_PREFIX}` });
  }
  if (engine.sessions) log.info("session screening on: screens are read while people are in control (ADR 0076)");

  for (const module of modules) await module.onStart?.(ctx);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    // No new jobs, from now on: one started during the delay below would be cut by the drain.
    workers.stop();
    // The switch is the process's: a server started after this one sets its own.
    allowPrivateOutbound(false);
    // `/api/health` answers 503 from now on: the proxy's health check takes this instance out before it stops
    // listening, and holds new requests for the next one instead of failing them.
    if (config.SHUTDOWN_DELAY_MS > 0) await Bun.sleep(config.SHUTDOWN_DELAY_MS);
    // HTTP stops taking requests (the new deploy serves them). Not awaited: the
    // promise resolves only once every socket is closed, and browser tabs never close theirs.
    telemetry?.stop();
    void server?.stop();
    void operator?.stop();
    // Runners reconnect to the next instance, and people's desktops and terminals open again there.
    await engine.machineHub.stop();
    engine.streams.stop();
    // Runs in progress get up to 20 s to finish; the rest are checkpointed and resume on the next instance. The other
    // jobs running here get as long, 5 s at least, then go back to the queue, due at once, instead of waiting out
    // their lease. A task's call cut by the stop is sent again to the next instance, which answers it from what is
    // stored: the calls still running here get as long too, 5 s at least, to store their answers. All at once, so the
    // whole stop fits the container's stop grace (40 s in docker-compose.yml).
    const runs = drainLocalRuns(RUN_DRAIN_MS);
    const [interrupted, handed] = await Promise.all([
      runs,
      workers.drain(Promise.all([runs, Bun.sleep(JOB_DRAIN_MS)])).catch((error: unknown) => {
        log.warn("couldn't hand this instance's jobs back: they come back when their lease ends", {
          error: String(error),
        });
        return 0;
      }),
      engine.machineHub.drain(MCP_DRAIN_MS),
    ]);
    if (interrupted.length > 0) log.info("runs handed back for the next instance", { runs: interrupted });
    if (handed > 0) log.info("jobs handed back for the next instance", { jobs: handed });
    // Browser tabs, left open so they saw those runs finish, reconnect to the next instance.
    await server?.stop(true);
    for (const module of modules) await module.onStop?.();
    await adapters.pubsub.close?.();
    await database.close();
    await log.flush(EXIT_FLUSH_MS);
    process.exit(0);
  };
  const stop = (signal: string) =>
    void shutdown(signal).catch(async (error: unknown) => {
      log.error("shutdown failed", { error });
      await log.flush(EXIT_FLUSH_MS);
      process.exit(1);
    });
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  // Once it serves, a stray rejection or exception (a database blip under a callback nobody awaits) is logged
  // instead of ending the process with every run in progress. Not before: a failed boot must still exit, and a
  // rejected top-level `await startServer()` would come here and leave the process hanging.
  process.on("unhandledRejection", (reason) =>
    log.error("unhandled rejection", { error: reason, stack: (reason as Error | null)?.stack, unhandled: true }),
  );
  process.on("uncaughtException", (error) =>
    log.error("uncaught exception", { error, stack: error.stack, unhandled: true }),
  );

  return { server, config };
}

/**
 * The database steps of boot, shared with `main.ts migrate`: pending
 * migrations (unless `migrate` is false), then the upcoming `messages`
 * partitions. Exits 1 when the database's migrations don't match this build.
 */
export async function prepareDatabase(database: DatabaseHandle, log: Logger, migrate = true) {
  if (migrate) {
    log.info("applying database migrations");
    try {
      await database.migrate();
    } catch (error) {
      if (error instanceof MigrationMismatchError) {
        // Never re-run or skip a changed migration against a real database.
        log.error("refusing to migrate: the database's migrations don't match this build", {
          reason: error.message,
          error,
        });
        await log.flush(EXIT_FLUSH_MS);
        process.exit(1);
      }
      throw error;
    }
  }
  await ensureMessagePartitions(database.db);
}

/** MillionSend (or another Resend-compatible API) when keyed, else SMTP when `SMTP_URL` is set, else only the log. */
function emailSender(config: Config, log: Logger): EmailSender {
  const from = config.EMAIL_FROM ?? defaultEmailFrom(config.PUBLIC_URL);
  const replyTo = config.EMAIL_REPLY_TO;
  if (config.MILLIONSEND_API_KEY) {
    return createMillionSendSender({
      apiKey: config.MILLIONSEND_API_KEY,
      baseURL: config.MILLIONSEND_API_URL,
      from,
      replyTo,
    });
  }
  if (config.SMTP_URL) return createSmtpEmailSender({ url: config.SMTP_URL, from, replyTo });
  return createLogEmailSender((line, data) => log.info(line, data));
}

/** Our bucket (S3_*) when configured, else a folder on this server (FILES_DIR), else Postgres. */
function platformBlobStore(config: Config, db: Database) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return config.FILES_DIR ? createDiskBlobStore(config.FILES_DIR) : createPostgresBlobStore(db);
  }
  return createS3BlobStore({
    endpoint: S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    pathStyle: config.S3_PATH_STYLE,
  });
}

/** How this server sends Android pushes (ADR 0152): `PUSH_SENDER`, with `auto` resolved. */
function androidPushMode(config: Config): "direct" | "relay" | "off" {
  if (config.PUSH_SENDER !== "auto") return config.PUSH_SENDER;
  return config.FIREBASE_SERVICE_ACCOUNT ? "direct" : "relay";
}

/**
 * Android pushes (ADR 0152): straight to Firebase with this server's service account (`fcm`), or through the
 * push relay, which registers this installation on its first push and keeps its credentials sealed with
 * `wrappers()`; null when off or `direct` has no account.
 */
function androidPushSender(
  config: Config,
  fcm: PushSender | null,
  db: Database,
  wrappers: () => KeyWrapper[],
  version: string,
): PushSender | null {
  const mode = androidPushMode(config);
  if (mode === "off") return null;
  if (mode === "direct") return fcm;
  return createRelayPushSender({
    url: config.PUSH_RELAY_URL,
    credentials: relayCredentials(db, wrappers, config.PUSH_RELAY_URL),
    version,
  });
}

/** At most one log line this often about push services refusing this server's signature. */
const WEB_PUSH_REFUSED_LOG_MS = 10 * 60_000;

/**
 * Browser push, unless `WEB_PUSH=off`. Endpoints come from browsers, so hosts on our own network are refused;
 * a DNS that doesn't answer is a failure to retry (`resolveHostDns` throws), never a refused host.
 */
function webPushSender(config: Config, db: Database, wrappers: () => KeyWrapper[], log: Logger): WebPushSender | null {
  if (config.WEB_PUSH === "off") return null;
  const sender = createWebPushSender({
    vapid: () => vapidKeys(db, wrappers(), config),
    checkHost: async (host) => {
      const addresses = await resolveHostDns(host);
      if (addresses.length === 0) throw new Error(`no address for ${host}`);
      return !addresses.some(isBlockedAddress);
    },
  });
  // A push service refusing the signature (401/403) keeps the subscription (ADR 0071) and is the operator's to
  // see: for a while after the key changed it's expected, all the time it's this server's key or contact.
  let loggedAt = 0;
  return {
    id: sender.id,
    async send(message) {
      const result = await sender.send(message);
      if (result.unauthorized && Date.now() - loggedAt > WEB_PUSH_REFUSED_LOG_MS) {
        loggedAt = Date.now();
        log.warn("a browser's push service refused this server's Web Push signature", {
          pushService: new URL(message.endpoint).host,
          error: result.error,
          contact: vapidSubject(config),
        });
      }
      return result;
    },
  };
}

/**
 * GIF search (ADR 0091): on agentes.chat's own servers GIPHY only with `GIPHY_API_KEY`; elsewhere a provider that
 * follows the installation's key (`GIPHY_API_KEY`, or the one its owner adds in Settings), there while it has one.
 */
function gifProvider(config: Config, key: () => string | null): GifProvider | null {
  if (!isAgentesCloud(config.PUBLIC_URL)) return createKeyedGifs({ key });
  return config.GIPHY_API_KEY ? createGiphyGifs({ apiKey: config.GIPHY_API_KEY }) : null;
}

/**
 * People's mailboxes for agents (ADR 0038): Gmail/Outlook through Composio when keyed, IMAP unless turned off. The same
 * Composio client serves the connectors that go through it (ADR 0107).
 */
function mailAdapters(
  config: Config,
  db: Database,
  beforeToolCall: (call: { slug: string; userId: string }) => Promise<void>,
): MailAdapters {
  const composio = config.COMPOSIO_API_KEY
    ? createComposioClient({
        apiKey: config.COMPOSIO_API_KEY,
        webhookSecret: config.COMPOSIO_WEBHOOK_SECRET,
        gmailAuthConfigId: config.COMPOSIO_GMAIL_AUTH_CONFIG_ID,
        outlookAuthConfigId: config.COMPOSIO_OUTLOOK_AUTH_CONFIG_ID,
        // What Composio bills, counted per workspace (ADR 0103): it has no usage API to read back.
        onExecute: composioUsageHook(db),
        authConfigs: composioAuthConfigs(config),
        beforeToolCall,
      })
    : null;
  // A mail server named by a person never resolves to our network (private, loopback, metadata).
  const checkHost = async (host: string) => {
    const addresses = await resolveHostDns(host);
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new Error("blocked host");
  };
  const imapOptions = { checkHost };
  return {
    composio: composio ? { client: composio, connector: createComposioMailConnector(composio) } : null,
    imap: config.MAIL_IMAP_ENABLED
      ? {
          connector: createImapMailConnector(imapOptions),
          poller: createImapPoller(imapOptions),
          tester: createImapConnectionTester(imapOptions),
          presets: MAIL_PRESETS,
        }
      : null,
  };
}
