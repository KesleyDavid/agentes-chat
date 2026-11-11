import { randomBytes } from "node:crypto";
import {
  BROWSER_VIEW,
  channelTopic,
  chatActivityTopic,
  listenResumedTopic,
  MAX_FRAME_BYTES,
  orgTopic,
  type Presence,
  type PubSub,
  type RateLimiter,
  STREAM_LIMITS,
  typingTopic,
  type Unsubscribe,
  userTopic,
} from "@agenteschat/adapters";
import type { Config } from "@agenteschat/config";
import { and, type Database, eq, inArray, isNotNull, isNull, or, schema, sql } from "@agenteschat/db";
import {
  activityAudience,
  adminChannelSql,
  announcePresence,
  type BrowserFrameMessage,
  type BrowserLive,
  browserFrameBase64,
  browserFrameBytes,
  closedRefusal,
  closesWorkspace,
  ForbiddenError,
  getMembership,
  isConnected,
  type LiveWatch,
  NotFoundError,
  type OrgEvent,
  profileIdOfKey,
  requireBrowserAccess,
  requireChannelAccess,
  requireProfileWatcher,
  taskReaderSql,
  touchLastSeen,
} from "@agenteschat/engine";
import type { Auth, SessionUser } from "../auth";
import type { Logger } from "../logger";
import { allowedOrigins, requestOriginAllowed } from "../routes/app/context";
import {
  BROWSER_FRAMES_PATH,
  BROWSER_INPUT_PER_SECOND,
  type BrowserClientFrame,
  createViewerPacer,
  FRAME_RENEW_MS,
  FRAME_TICKET_MS,
  fpsInterval,
  LEGACY_INTERVAL_MS,
  MAX_FRAME_BACKLOG,
  MAX_WATCHED_BROWSERS,
  parseBrowserClientFrame,
  parseFrameSocketMessage,
  type ViewerPacer,
} from "./browser";
import type { MachineSocketData, MachineSockets } from "./machines";
import type { StreamSocketData, StreamSockets } from "./streams";

/**
 * WebSocket endpoint `GET /api/ws?orgId=<uuid>` (docs/adr/0010-realtime.md).
 *
 * - The upgrade requires a session cookie, an allowed `Origin` (cross-site
 *   WebSocket hijacking), and membership of `orgId`.
 * - Clients then send `{"type":"subscribe","channelId":"…"}`; the server
 *   checks the channel belongs to that org and the person is a member of it
 *   (`requireChannelAccess`, the same check as the HTTP API) before
 *   forwarding the channel's events.
 * - `{"type":"typing","channelId","threadId"?}` (throttled by the client; the
 *   server keeps at most two every 2 s) fans out `user.typing` to the channel,
 *   valid for `ttlMs` (5 s).
 * - Server → client frames: `ready`, `subscribed`, `unsubscribed` (with a
 *   `reason` when the server dropped it: `revoked`, `archived`), `error`, and
 *   channel events (`message.created`, `agent.run`, `agent.typing`,
 *   `approval.*`) wrapped as `{"type":"event","channelId":…,"event":{…}}`.
 *   Events for this person only (approvals waiting for them, DMs) arrive as
 *   `{"type":"event","scope":"user","event":{…}}`.
 * - Membership changes normally take effect through pub/sub at once. A
 *   periodic database check also drops subscriptions or closes the socket if
 *   that notification was lost.
 * - A revoked session closes its socket on the next frame or periodic check.
 */
export interface RealtimeDeps {
  db: Database;
  auth: Auth;
  config: Config;
  pubsub: PubSub;
  presence: Presence;
  rateLimiter: RateLimiter;
  log: Logger;
  /** Connected computers' runners (`/api/machines/connect`, ADR 0025): same server, own handlers. */
  machines?: MachineSockets;
  /** The agent browser's live view (ADR 0040, `browser.*` frames); absent = not offered. */
  browserLive?: BrowserLive;
  /** Agents' desktops and terminals (ADR 0058): people's stream sockets and the runners' data sockets. */
  streams?: StreamSockets;
  /** How often an open socket checks its session and channels again (`SESSION_RECHECK_MS`; tests go faster). */
  sessionRecheckMs?: number;
}

/** A browser tab of the web app. */
export interface BrowserSocketData {
  kind: "browser";
  connectionId: string;
  user: SessionUser;
  sessionToken: string;
  sessionValidatedAt: number;
  sessionCheckInFlight: Promise<boolean> | null;
  sessionTimer: ReturnType<typeof setInterval> | null;
  orgId: string;
  subscriptions: Map<string, Unsubscribe>;
  /** Org and user topic listeners. */
  system: Unsubscribe[];
  /** Channels being authorized right now; a revocation during the check marks them. */
  pending: Map<string, { revoked: boolean }>;
  /** Agents' browsers this socket watches (ADR 0040), by agent id: the stop function. */
  browsers: Map<string, () => void>;
  /** Their frame windows, for clients that answer each frame (`browser.ack`, ADR 0040 §7.1). */
  browserPacers: Map<string, ViewerPacer>;
  /** Their frame sockets (`/api/browser/frames`), where the pictures go as bytes instead of on this socket. */
  frameSockets: Map<string, Bun.ServerWebSocket<FrameSocketData>>;
  /** The live view's frames from this socket, numbered as they came (a watch awaits its checks, a rate doesn't). */
  browserOrder: number;
  /** Each agent's newest `browser.fps` and its number: a watch still in its checks when it came takes that rate. */
  browserFps: Map<string, { maxFps: number; order: number }>;
}

/**
 * A frame socket of one watched browser (ADR 0040 §7.1): opened with a ticket the person's realtime socket got, it
 * carries that view's pictures as bytes, and the person's `{"type":"ack"}` for each one drawn.
 */
export interface FrameSocketData {
  kind: "browser.frames";
  owner: Bun.ServerWebSocket<BrowserSocketData>;
  agentId: string;
  /**
   * The window its acks count for: the view's ticket named it, and a watch again of the same agent on the same
   * realtime socket points it to the new view's (the socket stays open across watches).
   */
  pacer: ViewerPacer;
  /** An idle page sends nothing: pings keep proxies from dropping the socket. */
  pinger?: ReturnType<typeof setInterval>;
}

/** Every socket of the server: browsers (`/api/ws`), runners (`/api/machines/connect`) and streams (ADR 0058). */
export type SocketData = BrowserSocketData | MachineSocketData | StreamSocketData | FrameSocketData;

type BrowserSocket = Bun.ServerWebSocket<BrowserSocketData>;
type MachineSocket = Bun.ServerWebSocket<MachineSocketData>;
type StreamSocket = Bun.ServerWebSocket<StreamSocketData>;
const isMachine = (ws: Bun.ServerWebSocket<SocketData>): ws is MachineSocket => ws.data.kind === "machine";
const isFrames = (ws: Bun.ServerWebSocket<SocketData>): ws is Bun.ServerWebSocket<FrameSocketData> =>
  ws.data.kind === "browser.frames";
const isStream = (ws: Bun.ServerWebSocket<SocketData>): ws is StreamSocket =>
  ws.data.kind === "stream.viewer" || ws.data.kind === "stream.data";

export type ClientFrame =
  | { type: "subscribe" | "unsubscribe"; channelId: string }
  | { type: "typing"; channelId: string; threadId: string | null }
  | { type: "ping" };

/** How long a typing indicator lasts without a new `typing` frame. */
export const TYPING_TTL_MS = 5000;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SUBSCRIPTIONS = 200;
/** Bound the lifetime of an idle socket after its session is revoked. */
export const SESSION_RECHECK_MS = 15_000;
/** Incoming frames recheck at most once this often, to avoid a database query per mouse event. */
const SESSION_FRAME_RECHECK_MS = 2_000;
const MEMBERSHIP_CHECK_TIMEOUT_MS = 5_000;

/**
 * The checks before a person's socket opens (`/api/ws`, and the desktop and
 * terminal streams): our Origin, or the phone app without one (cross-site
 * WebSocket hijacking); a session from the cookie; membership of `orgId`,
 * a workspace that isn't closed (`closedRefusal`). The person, or the refusal.
 */
export async function personUpgrade(
  deps: Pick<RealtimeDeps, "auth" | "db">,
  origins: Set<string>,
  req: Request,
  orgId: string,
): Promise<(SessionUser & { sessionToken: string }) | Response> {
  if (!requestOriginAllowed(origins, req.headers)) {
    return new Response("Cross-origin WebSocket refused", { status: 403 });
  }
  if (!UUID.test(orgId)) return new Response("orgId is required", { status: 400 });
  // An upgrade is a new long-lived capability: resolve the session against the
  // database instead of accepting a signed cookie that outlived its DB row.
  const session = await deps.auth.api.getSession({ headers: req.headers, query: { disableCookieCache: true } });
  if (!session) return new Response("Sign in to continue", { status: 401 });
  const user = session.user as SessionUser;
  const membership = await getMembership(deps.db, user.id, orgId);
  if (!membership || closedRefusal(membership.standing)) {
    return new Response("Not a member of this organization", { status: 403 });
  }
  return { ...user, sessionToken: session.session.token };
}

export function parseClientFrame(raw: string | Buffer): ClientFrame | null {
  if (raw.length > 4096) return null;
  try {
    const frame = JSON.parse(String(raw)) as { type?: unknown; channelId?: unknown; threadId?: unknown };
    if (frame.type === "ping") return { type: "ping" };
    if (frame.type === "typing" && typeof frame.channelId === "string" && UUID.test(frame.channelId)) {
      const threadId = typeof frame.threadId === "string" && UUID.test(frame.threadId) ? frame.threadId : null;
      return { type: "typing", channelId: frame.channelId, threadId };
    }
    if (
      (frame.type === "subscribe" || frame.type === "unsubscribe") &&
      typeof frame.channelId === "string" &&
      UUID.test(frame.channelId)
    ) {
      return { type: frame.type, channelId: frame.channelId };
    }
  } catch {}
  return null;
}

/**
 * Whether this person may receive a channel's events through a connection
 * opened for `orgId`. Returns null when allowed, or a short reason.
 */
export async function authorizeSubscription(
  db: Database,
  userId: string,
  orgId: string,
  channelId: string,
): Promise<string | null> {
  try {
    await requireChannelAccess(db, userId, orgId, channelId);
    return null;
  } catch (error) {
    if (error instanceof ForbiddenError) return "forbidden";
    if (error instanceof NotFoundError) return "not_found";
    throw error;
  }
}

/** Reconcile an existing socket against durable membership when a revocation event was lost. */
export async function currentSubscriptions(
  db: Database,
  userId: string,
  orgId: string,
  channelIds: string[],
): Promise<Set<string> | null> {
  const member = await getMembership(db, userId, orgId);
  if (!member || closedRefusal(member.standing)) return null;
  if (channelIds.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .leftJoin(
      schema.channelMembers,
      and(
        eq(schema.channelMembers.orgId, orgId),
        eq(schema.channelMembers.channelId, schema.channels.id),
        eq(schema.channelMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.channels.orgId, orgId),
        inArray(schema.channels.id, channelIds),
        isNull(schema.channels.archivedAt),
        or(
          isNotNull(schema.channelMembers.id),
          // A task's conversation: whoever sees the task (ADR 0145).
          and(eq(schema.channels.kind, "task"), taskReaderSql(sql`${schema.channels.id}`, sql`${userId}::text`)),
          adminChannelSql(sql`${orgId}::uuid`, sql`${userId}::text`),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export function createRealtime(deps: RealtimeDeps) {
  const origins = allowedOrigins(deps.config);
  const send = (ws: BrowserSocket, frame: unknown): void => {
    // 0: Bun dropped it, past its backpressure limit (a frozen tab that stopped reading). The app would never learn
    // what it missed; closed, it reconnects and reads it.
    if (ws.send(JSON.stringify(frame)) === 0 && ws.readyState === 1) ws.close(1013, "too far behind");
  };
  // A new message reaches its members' sockets on this replica as `channel.activity` (no content): their lists
  // count it as unread without subscribing to every channel. The author's own sockets never hear it.
  // ponytail: one audience query per message per replica with sockets; a per-channel member cache if that shows up.
  const browsers = new Set<BrowserSocket>();
  deps.pubsub.subscribe(chatActivityTopic, (raw) => {
    if (browsers.size === 0) return;
    const { channelId, threadId, authorUserId, mentionedUserIds } = raw as {
      channelId?: unknown;
      threadId?: unknown;
      authorUserId?: unknown;
      mentionedUserIds?: unknown;
    };
    if (typeof channelId !== "string" || !UUID.test(channelId)) return;
    const thread = typeof threadId === "string" && UUID.test(threadId) ? threadId : null;
    const mentioned = Array.isArray(mentionedUserIds)
      ? mentionedUserIds.filter((id): id is string => typeof id === "string")
      : [];
    void activityAudience(deps.db, channelId, thread, mentioned)
      .then(({ orgId, dm, userIds }) => {
        const event = { type: "channel.activity", channelId, threadId: thread, dm };
        for (const ws of browsers)
          if (
            ws.readyState === 1 &&
            ws.data.orgId === orgId &&
            ws.data.user.id !== authorUserId &&
            userIds.has(ws.data.user.id)
          )
            send(ws, { type: "event", scope: "user", event });
      })
      .catch(() => {});
  });
  // This replica's LISTEN came back after a gap: its sockets stayed open while what was said meanwhile never reached
  // them. Closed as a service restart, their apps reconnect, which subscribes again and reads what they missed.
  deps.pubsub.subscribe(listenResumedTopic, () => {
    for (const ws of browsers) if (ws.readyState === 1) ws.close(1012, "events were missed");
  });

  async function liveSession(ws: BrowserSocket, force = false): Promise<boolean> {
    if (ws.readyState !== 1) return false;
    if (!force && Date.now() - ws.data.sessionValidatedAt < SESSION_FRAME_RECHECK_MS) return true;
    if (ws.data.sessionCheckInFlight) return ws.data.sessionCheckInFlight;
    const check = (async () => {
      try {
        const { internalAdapter } = await deps.auth.$context;
        const found = await internalAdapter.findSession(ws.data.sessionToken);
        if (!found || found.session.userId !== ws.data.user.id || found.session.expiresAt <= new Date()) {
          if (ws.readyState === 1) ws.close(4401, "session revoked");
          return false;
        }
        ws.data.sessionValidatedAt = Date.now();
        return true;
      } catch {
        // If the session store cannot be checked, stop forwarding private events.
        if (ws.readyState === 1) ws.close(1011, "session unavailable");
        return false;
      }
    })();
    ws.data.sessionCheckInFlight = check;
    try {
      return await check;
    } finally {
      ws.data.sessionCheckInFlight = null;
    }
  }

  /** Each socket's last input frame on its way into the live view (`browserInput`). */
  const inputLanes = new WeakMap<BrowserSocket, Promise<unknown>>();

  /**
   * A person's input frame. Frames of one socket enter the live view strictly in the order they came, one after
   * another: the checks on the way await (the session, the rate limiter), and a later frame whose await ended first
   * would otherwise overtake, reordering typed text or putting a click before the moves that lead to it. Only
   * entering is in line: the answer is awaited outside it, so frames keep coming while a batch is on its way.
   */
  function browserInput(ws: BrowserSocket, frame: Extract<BrowserClientFrame, { type: "browser.input" }>) {
    const live = deps.browserLive;
    if (!live) return;
    const { agentId } = frame;
    const { orgId, user } = ws.data;
    const entered = (inputLanes.get(ws) ?? Promise.resolve()).then(async () => {
      if (!(await liveSession(ws))) return null;
      const t = await deps.rateLimiter.consume(`ws-browser:${ws.data.connectionId}`, {
        limit: BROWSER_INPUT_PER_SECOND,
        windowMs: 1000,
      });
      if (!t.allowed) return void send(ws, { type: "error", code: "rate_limited", agentId });
      if (!ws.data.browsers.has(agentId)) return void send(ws, { type: "error", code: "not_in_control", agentId });
      // Wrapped: a bare promise returned here would hold the line until the computer answers.
      return { sent: live.input(user.id, orgId, agentId, frame.events) };
    });
    const settled = entered.catch(() => {
      if (ws.readyState === 1) send(ws, { type: "browser.unavailable", agentId, reason: "unavailable" });
      return null;
    });
    inputLanes.set(ws, settled);
    return settled.then(async (step) => {
      if (!step) return;
      try {
        const sent = await step.sent;
        if (sent.refused) send(ws, { type: "error", code: "not_in_control", agentId });
        else if (sent.failed) send(ws, { type: "error", code: "input_failed", agentId });
        else if (sent.nowhere) send(ws, { type: "error", code: "no_field", agentId });
      } catch (error) {
        if (ws.readyState === 1) {
          send(ws, { type: "browser.unavailable", agentId, reason: "unavailable", message: String(error) });
        }
      }
    });
  }

  /** Placeholders of browser views still starting (`browser.watch` in flight). */
  const startingBrowsers = new WeakSet<() => void>();
  /** Frame socket tickets (ADR 0040 §7.1): each opens one socket, once, for the view it was given to. */
  const frameTickets = new Map<
    string,
    { owner: BrowserSocket; agentId: string; pacer: ViewerPacer; expires: number }
  >();
  /** Views that stream here and asked for a frame socket: only they get one again (`browser.frames.renew`). */
  const frameViews = new WeakSet<ViewerPacer>();
  /** When each view last got a ticket on `browser.frames.renew`. */
  const renewedAt = new WeakMap<ViewerPacer, number>();

  /** The view's frame socket, while it is open. */
  const openFrameSocket = (ws: BrowserSocket, agentId: string) => {
    const frames = ws.data.frameSockets.get(agentId);
    return frames?.readyState === 1 ? frames : null;
  };

  /** The view's frame socket goes: the view ended for good (unwatched, refused, its realtime socket closed). */
  const closeFrameSocket = (ws: BrowserSocket, agentId: string) => {
    const frames = ws.data.frameSockets.get(agentId);
    ws.data.frameSockets.delete(agentId);
    frames?.close(1000, "the view ended");
  };

  /** A ticket for the view's frame socket; one that view had before stops working. */
  function sendFrameTicket(ws: BrowserSocket, agentId: string, pacer: ViewerPacer) {
    const ticket = randomBytes(24).toString("base64url");
    const now = Date.now();
    for (const [old, t] of frameTickets) {
      if (t.expires <= now || (t.owner === ws && t.agentId === agentId)) frameTickets.delete(old);
    }
    frameTickets.set(ticket, { owner: ws, agentId, pacer, expires: now + FRAME_TICKET_MS });
    send(ws, { type: "browser.frames", agentId, ticket });
  }

  /**
   * `browser.frames.renew`: the view's frame socket closed (a network change, a proxy) while the view goes on. A new
   * ticket for the same view, without watching again (which would restart it); one a second at most. Even while one
   * still looks open here: a socket left half-open is only noticed at the idle timeout, and until then every picture
   * would go into it. The client asks only once its own closed, and the new socket replaces the old (`open`).
   */
  function renewFrames(ws: BrowserSocket, agentId: string) {
    const pacer = ws.data.browserPacers.get(agentId);
    if (!pacer || !frameViews.has(pacer)) return;
    const now = Date.now();
    if (now - (renewedAt.get(pacer) ?? 0) < FRAME_RENEW_MS) return;
    renewedAt.set(pacer, now);
    sendFrameTicket(ws, agentId, pacer);
  }

  /**
   * `GET /api/browser/frames?ticket=`: a watched browser's frame socket. The ticket is the whole check: only the
   * person's own realtime socket got it, for one view, for `FRAME_TICKET_MS`; a view that ended takes no socket.
   */
  function upgradeFrames(req: Request, server: Bun.Server<SocketData>): Response | undefined {
    const ticket = new URL(req.url).searchParams.get("ticket") ?? "";
    const held = frameTickets.get(ticket);
    frameTickets.delete(ticket);
    if (!held || held.expires <= Date.now()) return new Response("Unknown or expired ticket", { status: 403 });
    const { owner, agentId, pacer } = held;
    if (owner.readyState !== 1 || owner.data.browserPacers.get(agentId) !== pacer) {
      return new Response("That view ended", { status: 410 });
    }
    const data: FrameSocketData = { kind: "browser.frames", owner, agentId, pacer };
    return server.upgrade(req, { data }) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
  }

  const frameSocket = {
    open(socket: Bun.ServerWebSocket<FrameSocketData>) {
      const { owner, agentId, pacer } = socket.data;
      // The view ended, or a newer watch replaced it, while it opened.
      if (owner.readyState !== 1 || owner.data.browserPacers.get(agentId) !== pacer) {
        return socket.close(1000, "the view ended");
      }
      const old = owner.data.frameSockets.get(agentId);
      owner.data.frameSockets.set(agentId, socket);
      socket.data.pinger = setInterval(() => socket.ping(), STREAM_LIMITS.pingMs);
      if (old) {
        old.close(1000, "replaced");
        // The frames on their way there are never acked here: the window starts again.
        pacer.reset();
      }
    },
    message(socket: Bun.ServerWebSocket<FrameSocketData>, raw: string | Buffer) {
      const { owner, agentId } = socket.data;
      if (owner.data.frameSockets.get(agentId) !== socket) return;
      // Its own view's window: after a watch again, the new view's.
      if (parseFrameSocketMessage(raw)?.type === "ack") socket.data.pacer.ack();
    },
    close(socket: Bun.ServerWebSocket<FrameSocketData>) {
      clearInterval(socket.data.pinger);
      const { owner, agentId } = socket.data;
      if (owner.data.frameSockets.get(agentId) !== socket) return;
      owner.data.frameSockets.delete(agentId);
      // Its pictures go on the realtime socket again; the ones it never acked don't hold the window shut.
      socket.data.pacer.reset();
    },
  };

  /** Rates (`browser.fps`) one socket keeps for watches still starting: a few more than the browsers it may watch. */
  const MAX_KEPT_RATES = MAX_WATCHED_BROWSERS * 4;

  /**
   * `browser.fps`: the view's rate, changed at once. Kept with its number too: a watch of the same agent that came
   * before it may still be in its checks (they await), and creates its window after this; it takes this rate then.
   */
  function browserRate(ws: BrowserSocket, agentId: string, maxFps: number, order: number) {
    const rates = ws.data.browserFps;
    if (rates.has(agentId) || rates.size < MAX_KEPT_RATES) rates.set(agentId, { maxFps, order });
    ws.data.browserPacers.get(agentId)?.setMinInterval(fpsInterval(maxFps));
  }

  /**
   * An agent's browser on this socket (ADR 0040): watch, stop watching. `order`: the frame's number on this socket,
   * given as it came, before any check awaited.
   */
  async function browserMessage(ws: BrowserSocket, frame: BrowserClientFrame, order: number): Promise<void> {
    const live = deps.browserLive;
    if (!live) return;
    const { agentId } = frame;
    const { orgId, user } = ws.data;
    if (frame.type === "browser.unwatch") {
      ws.data.browsers.get(agentId)?.();
      ws.data.browsers.delete(agentId);
      // Its rate goes too, unless one came after the unwatch (for a watch again behind it).
      if ((ws.data.browserFps.get(agentId)?.order ?? order) < order) ws.data.browserFps.delete(agentId);
      // Unwatched for good: its frame socket goes too (a watch again keeps it).
      closeFrameSocket(ws, agentId);
      return;
    }
    if (frame.type !== "browser.watch") return;
    const limit = await deps.rateLimiter.consume(`ws:${ws.data.connectionId}`, { limit: 60, windowMs: 10_000 });
    if (!limit.allowed) return send(ws, { type: "error", code: "rate_limited", agentId });
    const previous = ws.data.browsers.get(agentId);
    // Still starting: a second `browser.watch` meanwhile only changes the rate (the client sends no `browser.fps`
    // for it: a card opened while a thumbnail's watch starts asks the top rate this way).
    if (previous && startingBrowsers.has(previous)) {
      if (frame.acks === true) browserRate(ws, agentId, frame.maxFps ?? BROWSER_VIEW.maxFps, order);
      return;
    }
    // Already here: watching again is the client's retry (after reconnecting, offline, an ended
    // stream or a lost permission), so the old view goes and a fresh one starts.
    if (previous) {
      previous();
      ws.data.browsers.delete(agentId);
    }
    if (ws.data.browsers.size >= MAX_WATCHED_BROWSERS) {
      return send(ws, { type: "error", code: "too_many_browsers", agentId });
    }
    // Held while it starts, so a second `browser.watch` meanwhile is a no-op and an unwatch cancels it.
    const starting = () => {};
    startingBrowsers.add(starting);
    ws.data.browsers.set(agentId, starting);
    // A client that answers frames (`acks`): a window, its own rate, and a frame socket when it asks for one.
    const paced = frame.acks === true;
    /** Where the pictures go is backed up past `MAX_FRAME_BACKLOG` (a slow phone link, a client that never reads). */
    const backedUp = () => (openFrameSocket(ws, agentId) ?? ws).getBufferedAmount() > MAX_FRAME_BACKLOG;
    const deliver = (message: { type: string }): boolean => {
      if (ws.readyState !== 1) return false;
      if (message.type !== "browser.frame") {
        send(ws, message);
        return true;
      }
      // The same frame object every viewer got (ADR 0040 §7.1): its bytes and base64 are made once, for all of them.
      const picture = message as BrowserFrameMessage;
      const frames = paced ? openFrameSocket(ws, agentId) : null;
      // Bun's send answers 0 when it dropped the message (closing, or past its own limit): sent nothing, so it takes
      // no room in the window, which no ack would ever free. -1 is queued: on its way.
      if (frames) {
        // Backed up (a client that acks what it never read): skipped, the newest goes next.
        if (frames.getBufferedAmount() > MAX_FRAME_BACKLOG) return false;
        return frames.send(browserFrameBytes(picture)) !== 0;
      }
      // Backed up: not sent now; the pacer keeps it (newest wins) and tries again, so an idle page's last one shows.
      if (ws.getBufferedAmount() > MAX_FRAME_BACKLOG) return false;
      // This socket takes it as base64, never with the bytes; `ack`: answer it once drawn.
      const { bytes: _bytes, jpeg: _jpeg, data: _data, ...rest } = picture;
      const json = { ...rest, data: browserFrameBase64(picture), ...(paced ? { ack: true } : {}) };
      return ws.send(JSON.stringify(json)) !== 0;
    };
    // Before the watch: it sends the status and the newest frame at once. Apps that answer no frames get what they
    // always got: the newest frame once a second while watching, the stream's own rate while this person drives it.
    const legacyPacer = (inner: ViewerPacer): ViewerPacer => ({
      ...inner,
      send(message) {
        if (message.type === "browser.status") {
          const status = message as { mode?: unknown; controllerUserId?: unknown; hidden?: unknown };
          const driving = status.mode === "control" && status.controllerUserId === user.id && status.hidden !== true;
          inner.setMinInterval(driving ? 0 : LEGACY_INTERVAL_MS);
        }
        inner.send(message);
      },
    });
    ws.data.browserPacers.get(agentId)?.close();
    // A `browser.fps` that came after this watch, while its checks awaited, is the rate the client wants now.
    const rate = ws.data.browserFps.get(agentId);
    const maxFps = rate && rate.order > order ? rate.maxFps : frame.maxFps;
    const pacer = paced
      ? createViewerPacer(deliver, {
          minIntervalMs: maxFps ? fpsInterval(maxFps) : 0,
          onRoom: () => live.viewerReady(agentId),
        })
      : legacyPacer(
          createViewerPacer(deliver, { window: Number.POSITIVE_INFINITY, minIntervalMs: LEGACY_INTERVAL_MS }),
        );
    if (paced) {
      ws.data.browserPacers.set(agentId, pacer);
      // A frame socket open from an earlier watch stays: its acks count for this view now.
      const frames = ws.data.frameSockets.get(agentId);
      if (frames) frames.data.pacer = pacer;
    } else {
      ws.data.browserPacers.delete(agentId);
      // Nobody answers frames there any more.
      closeFrameSocket(ws, agentId);
    }
    const ended = () => {
      pacer.close();
      if (ws.data.browserPacers.get(agentId) === pacer) ws.data.browserPacers.delete(agentId);
    };
    let watch: LiveWatch;
    try {
      const profileId = profileIdOfKey(agentId);
      if (profileId) await requireProfileWatcher(deps.db, user.id, orgId, profileId);
      else await requireBrowserAccess(deps.db, user.id, orgId, agentId);
      watch = await live.watch(
        {
          userId: user.id,
          // Backed up (a slow phone link): the pacer holds the newest frame until it drains (`deliver`), never skips.
          send: (message) => pacer.send(message),
          // The computer sends the next frame only while some viewer has room for it (ADR 0040 §7.1); a backed-up
          // socket has none, it would only wait. Nothing tells when it drains: the owed ack goes within
          // `BROWSER_VIEW.ackOwedMs` anyway.
          ...(paced ? { room: () => pacer.room() && !backedUp() } : {}),
        },
        orgId,
        agentId,
      );
    } catch (error) {
      ended();
      startingBrowsers.delete(starting);
      // Whatever failed, the placeholder goes: a later `browser.watch` tries again.
      if (ws.data.browsers.get(agentId) === starting) {
        ws.data.browsers.delete(agentId);
        // Refused or failed: no socket of its own stays open for it.
        closeFrameSocket(ws, agentId);
      }
      const code = error instanceof NotFoundError ? "not_found" : error instanceof ForbiddenError ? "forbidden" : "";
      if (code) return send(ws, { type: "error", code, agentId });
      return send(ws, { type: "browser.unavailable", agentId, reason: "unavailable", message: "try again" });
    }
    startingBrowsers.delete(starting);
    const { stop: unwatch, streaming } = watch;
    const stop = () => {
      unwatch();
      ended();
    };
    // Closed or unwatched while it was starting: stop at once (an unwatch closed its frame socket).
    if (ws.readyState !== 1 || ws.data.browsers.get(agentId) !== starting) return stop();
    ws.data.browsers.set(agentId, stop);
    // A client that answers frames takes them on a socket of their own (ADR 0040 §7.1), opened with a ticket: only
    // while its frames come to this server, and only when none is open for this view already.
    if (!paced || !frame.frames || !streaming) return;
    frameViews.add(pacer);
    if (!openFrameSocket(ws, agentId)) sendFrameTicket(ws, agentId, pacer);
  }

  const realtime = {
    path: "/api/ws",

    /** Called from `Bun.serve`'s fetch for `/api/ws`. Returns a Response on refusal, undefined once upgraded. */
    /**
     * `Bun.serve`'s fetch: upgrades `/api/ws` and `/api/machines/connect`,
     * and hands everything else to `next` (the HTTP app).
     */
    fetch(
      req: Request,
      server: Bun.Server<SocketData>,
      next: (req: Request) => Response | Promise<Response>,
    ): Response | Promise<Response | undefined> | undefined {
      const path = new URL(req.url).pathname;
      if (path === realtime.path) return realtime.upgrade(req, server);
      if (path === BROWSER_FRAMES_PATH && deps.browserLive) return upgradeFrames(req, server);
      if (deps.machines && path === deps.machines.path) {
        return deps.machines.upgrade(req, server as unknown as Bun.Server<MachineSocketData>);
      }
      if (deps.streams?.paths.has(path)) {
        return deps.streams.upgrade(req, server as unknown as Bun.Server<StreamSocketData>);
      }
      return next(req);
    },

    async upgrade(req: Request, server: Bun.Server<SocketData>): Promise<Response | undefined> {
      const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
      const user = await personUpgrade(deps, origins, req, orgId);
      if (user instanceof Response) return user;
      const { sessionToken, ...person } = user;
      const data: BrowserSocketData = {
        kind: "browser",
        connectionId: crypto.randomUUID(),
        user: person,
        sessionToken,
        sessionValidatedAt: 0,
        sessionCheckInFlight: null,
        sessionTimer: null,
        orgId,
        subscriptions: new Map(),
        system: [],
        pending: new Map(),
        browsers: new Map(),
        browserPacers: new Map(),
        frameSockets: new Map(),
        browserOrder: 0,
        browserFps: new Map(),
      };
      return server.upgrade(req, { data }) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    },

    websocket: {
      // Runners send files inline (up to MAX_FRAME_BYTES); browser frames are still capped at 4096 by `parseClientFrame`.
      maxPayloadLength: MAX_FRAME_BYTES,
      idleTimeout: 120,
      async open(socket: Bun.ServerWebSocket<SocketData>) {
        if (isFrames(socket)) return frameSocket.open(socket);
        if (isMachine(socket)) return deps.machines?.open(socket);
        if (isStream(socket)) return deps.streams?.open(socket);
        const ws = socket as BrowserSocket;
        if (!(await liveSession(ws, true))) return;
        browsers.add(ws);
        const { orgId, user } = ws.data;
        const drop = (channelId: string, reason: string) => {
          const pending = ws.data.pending.get(channelId);
          if (pending) pending.revoked = true;
          const off = ws.data.subscriptions.get(channelId);
          if (!off) return;
          off();
          ws.data.subscriptions.delete(channelId);
          if (ws.readyState === 1) send(ws, { type: "unsubscribed", channelId, reason });
        };
        let rechecking = false;
        ws.data.sessionTimer = setInterval(() => {
          if (rechecking || ws.readyState !== 1) return;
          rechecking = true;
          void (async () => {
            try {
              if (!(await liveSession(ws, true))) return;
              let timeout: ReturnType<typeof setTimeout> | undefined;
              const deadline = new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error("membership check timed out")),
                  MEMBERSHIP_CHECK_TIMEOUT_MS,
                );
                timeout.unref?.();
              });
              // Only these are judged: a channel subscribed while the query runs passed its own check, and isn't in
              // `allowed` only because nobody asked about it.
              const checked = [...ws.data.subscriptions.keys(), ...ws.data.pending.keys()];
              let allowed: Set<string> | null;
              try {
                allowed = await Promise.race([currentSubscriptions(deps.db, user.id, orgId, checked), deadline]);
              } finally {
                if (timeout) clearTimeout(timeout);
              }
              if (ws.readyState !== 1) return;
              if (!allowed) {
                ws.close(4403, "membership revoked");
                return;
              }
              for (const channelId of checked) if (!allowed.has(channelId)) drop(channelId, "revoked");
            } catch {
              // A failed durable check must not leave a private subscription open.
              if (ws.readyState === 1) ws.close(1011, "membership unavailable");
            } finally {
              rechecking = false;
            }
          })();
        }, deps.sessionRecheckMs ?? SESSION_RECHECK_MS);
        ws.data.system.push(
          deps.pubsub.subscribe(orgTopic(orgId), (raw) => {
            const event = raw as unknown as OrgEvent;
            if (event.type === "channel.archived") return drop(event.channelId, "archived");
            if (event.type === "org.broadcast") {
              if (ws.readyState === 1) send(ws, { type: "event", scope: "org", event: event.event });
              if (closesWorkspace(event.event) && ws.readyState === 1) ws.close(4403, "organization closed");
              return;
            }
            if (event.type !== "membership.revoked" || event.userId !== user.id) return;
            if (event.channelId) return drop(event.channelId, "revoked");
            for (const channelId of [...ws.data.subscriptions.keys(), ...ws.data.pending.keys()])
              drop(channelId, "revoked");
            if (ws.readyState === 1) {
              send(ws, { type: "error", code: event.quiet ? "membership_ended" : "membership_revoked" });
              // Closed outside the publisher's call stack (in-memory pub/sub delivers synchronously).
              ws.close(4403, "membership revoked");
            }
          }),
          deps.pubsub.subscribe(userTopic(orgId, user.id), (event) => {
            if (ws.readyState === 1) send(ws, { type: "event", scope: "user", event });
          }),
        );
        const wasConnected = await isConnected(deps.presence, orgId, user.id);
        await deps.presence.connect(ws.data.orgId, ws.data.user.id, ws.data.connectionId);
        await touchLastSeen(deps.db, orgId, user.id).catch(() => {});
        if (!wasConnected) await announcePresence(deps, orgId, user.id).catch(() => {});
        send(ws, { type: "ready", orgId: ws.data.orgId, userId: ws.data.user.id });
      },
      async message(socket: Bun.ServerWebSocket<SocketData>, raw: string | Buffer): Promise<void> {
        if (isFrames(socket)) return frameSocket.message(socket, raw);
        if (isMachine(socket)) return deps.machines?.message(socket, raw);
        if (isStream(socket)) return deps.streams?.message(socket, raw);
        const ws = socket as BrowserSocket;
        const browserFrame = deps.browserLive ? parseBrowserClientFrame(raw) : null;
        // Numbered as it came, before anything awaits: a rate sent after a watch must win over it (`browserRate`).
        const order = browserFrame ? ++ws.data.browserOrder : 0;
        if (browserFrame?.type === "browser.input") return browserInput(ws, browserFrame);
        // A frame drawn: nothing to check, it only lets the next frame of a view this socket already has go.
        if (browserFrame?.type === "browser.ack") return void ws.data.browserPacers.get(browserFrame.agentId)?.ack();
        // A view this socket has or is starting, at another rate (a card opened or closed): nothing to check either.
        if (browserFrame?.type === "browser.fps") {
          return browserRate(ws, browserFrame.agentId, browserFrame.maxFps, order);
        }
        if (!(await liveSession(ws))) return;
        if (browserFrame?.type === "browser.frames.renew") return renewFrames(ws, browserFrame.agentId);
        if (browserFrame) {
          return browserMessage(ws, browserFrame, order).catch(() => {
            if (ws.readyState === 1) {
              send(ws, { type: "browser.unavailable", agentId: browserFrame.agentId, reason: "unavailable" });
            }
          });
        }
        const limit = await deps.rateLimiter.consume(`ws:${ws.data.connectionId}`, { limit: 60, windowMs: 10_000 });
        if (!limit.allowed) return send(ws, { type: "error", code: "rate_limited" });
        const frame = parseClientFrame(raw);
        if (!frame) return send(ws, { type: "error", code: "bad_frame" });
        if (frame.type === "ping") return send(ws, { type: "pong" });

        const { channelId } = frame;
        if (frame.type === "typing") {
          // Only into channels this connection is subscribed to (already authorized); at most two every 2 s (the apps
          // send one every 3 s, and one more when a new message starts).
          if (!ws.data.subscriptions.has(channelId)) return;
          const t = await deps.rateLimiter.consume(`typing:${ws.data.connectionId}:${channelId}`, {
            limit: 2,
            windowMs: 2000,
          });
          if (!t.allowed) return;
          const typing = {
            type: "user.typing",
            channelId,
            threadId: frame.threadId,
            userId: ws.data.user.id,
            ttlMs: TYPING_TTL_MS,
          };
          await Promise.all(
            [channelTopic(channelId), typingTopic].map((topic) => deps.pubsub.publish(topic, typing).catch(() => {})),
          );
          return;
        }
        if (frame.type === "unsubscribe") {
          ws.data.subscriptions.get(channelId)?.();
          ws.data.subscriptions.delete(channelId);
          return send(ws, { type: "unsubscribed", channelId });
        }
        if (ws.data.subscriptions.has(channelId)) return send(ws, { type: "subscribed", channelId });
        // One check per channel at a time: a second would take the first's place in `pending`, and a removal that
        // lands meanwhile would mark only one of them. The check in flight answers for both.
        if (ws.data.pending.has(channelId)) return;
        if (ws.data.subscriptions.size >= MAX_SUBSCRIPTIONS)
          return send(ws, { type: "error", code: "too_many_subscriptions", channelId });
        const check = { revoked: false };
        ws.data.pending.set(channelId, check);
        let denied: string | null;
        try {
          denied = await authorizeSubscription(deps.db, ws.data.user.id, ws.data.orgId, channelId);
        } catch (error) {
          // The check couldn't run (the database is away): the tab reconnects, which subscribes again and
          // catches up on what it missed.
          deps.log.warn("channel subscription check failed", { error: String(error) });
          send(ws, { type: "error", code: "unavailable", channelId });
          ws.close(1011, "try again");
          return;
        } finally {
          if (ws.data.pending.get(channelId) === check) ws.data.pending.delete(channelId);
        }
        // A revocation that arrived while we were checking wins over a stale "allowed".
        if (!denied && check.revoked) denied = "forbidden";
        if (denied) return send(ws, { type: "error", code: denied, channelId });
        if (ws.data.subscriptions.has(channelId)) return send(ws, { type: "subscribed", channelId });
        const off = deps.pubsub.subscribe(channelTopic(channelId), (event) => {
          if (ws.readyState === 1) send(ws, { type: "event", channelId, event });
        });
        ws.data.subscriptions.set(channelId, off);
        send(ws, { type: "subscribed", channelId });
      },
      async close(socket: Bun.ServerWebSocket<SocketData>, code: number) {
        if (isFrames(socket)) return frameSocket.close(socket);
        if (isMachine(socket)) return deps.machines?.close(socket);
        if (isStream(socket)) return deps.streams?.close(socket, code);
        const ws = socket as BrowserSocket;
        browsers.delete(ws);
        if (ws.data.sessionTimer) clearInterval(ws.data.sessionTimer);
        ws.data.sessionTimer = null;
        for (const off of ws.data.subscriptions.values()) off();
        ws.data.subscriptions.clear();
        for (const stop of ws.data.browsers.values()) stop();
        ws.data.browsers.clear();
        for (const agentId of [...ws.data.frameSockets.keys()]) closeFrameSocket(ws, agentId);
        ws.data.browserFps.clear();
        for (const off of ws.data.system) off();
        ws.data.system = [];
        await deps.presence.disconnect(ws.data.orgId, ws.data.user.id, ws.data.connectionId);
        await touchLastSeen(deps.db, ws.data.orgId, ws.data.user.id).catch(() => {});
        if (!(await isConnected(deps.presence, ws.data.orgId, ws.data.user.id))) {
          await announcePresence(deps, ws.data.orgId, ws.data.user.id).catch(() => {});
        }
      },
    },
  };

  /** A handler that fails is logged (so reported) with whose socket it was, not left to reach the process. */
  const guarded =
    <A extends unknown[]>(handler: string, run: (socket: Bun.ServerWebSocket<SocketData>, ...args: A) => unknown) =>
    async (socket: Bun.ServerWebSocket<SocketData>, ...args: A) => {
      try {
        await run(socket, ...args);
      } catch (error) {
        deps.log.error("socket handler failed", {
          socket: socket.data.kind,
          handler,
          ...socketIds(socket.data),
          error,
          stack: (error as Error | null)?.stack,
        });
      }
    };
  const { open, message, close } = realtime.websocket;
  return {
    ...realtime,
    websocket: {
      ...realtime.websocket,
      open: guarded("open", open),
      message: guarded("message", message),
      close: guarded("close", close),
    },
  };
}

/** Whose socket it is, by internal ids. */
function socketIds(data: SocketData) {
  if (data.kind === "browser") return { orgId: data.orgId, userId: data.user.id };
  if (data.kind === "machine")
    return { orgId: data.conn?.orgId ?? undefined, machineId: data.conn?.machineId ?? undefined };
  if (data.kind === "stream.viewer")
    return { orgId: data.input.orgId, userId: data.input.userId, agentId: data.input.agentId };
  return {};
}

export type Realtime = ReturnType<typeof createRealtime>;
