import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listenResumedTopic, orgTopic } from "@agenteschat/adapters";
import { schema } from "@agenteschat/db";
import { createLogger } from "../src/logger";
import {
  authorizeSubscription,
  type BrowserSocketData,
  createRealtime,
  currentSubscriptions,
  parseClientFrame,
  type SocketData,
} from "../src/realtime/ws";
import {
  browser,
  createTestServer,
  joinByInvitation,
  listen,
  ORIGIN,
  seedOrg,
  signUp,
  type TestServer,
  upgradeStatus,
} from "./harness";

describe("parseClientFrame", () => {
  test("accepts subscribe/unsubscribe with a uuid and ping; rejects the rest", () => {
    const id = "0193a2b4-0000-7000-8000-000000000000";
    expect(parseClientFrame(JSON.stringify({ type: "subscribe", channelId: id }))).toEqual({
      type: "subscribe",
      channelId: id,
    });
    expect(parseClientFrame('{"type":"ping"}')).toEqual({ type: "ping" });
    expect(parseClientFrame('{"type":"subscribe","channelId":"general"}')).toBeNull();
    expect(parseClientFrame("not json")).toBeNull();
    expect(parseClientFrame(JSON.stringify({ type: "subscribe", channelId: id, pad: "x".repeat(5000) }))).toBeNull();
  });
});

let t: TestServer;
let server: ReturnType<typeof listen>;
beforeEach(async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" }, reply: () => ({ chunks: ["Hel", "lo ", "there"] }) });
  server = listen(t);
});
afterEach(async () => {
  // Bun 1.3 never resolves stop(true) after the server itself closed a socket
  // whose client lives in the same process; don't wait on it forever.
  await Promise.race([server.stop(true), Bun.sleep(500)]);
  await t.close();
});

const wsUrl = (orgId: string) => `ws://127.0.0.1:${server.port}/api/ws?orgId=${orgId}`;

/** Opens a socket and collects frames. Resolves once `ready` arrives, rejects if refused. */
function connect(url: string, headers: Record<string, string>) {
  const frames: Record<string, unknown>[] = [];
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  const waiters: { pred: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }[] =
    [];
  ws.onmessage = (e) => {
    const frame = JSON.parse(String(e.data)) as Record<string, unknown>;
    frames.push(frame);
    for (const w of [...waiters])
      if (w.pred(frame)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(frame);
      }
  };
  const next = (pred: (f: Record<string, unknown>) => boolean, ms = 5000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const found = frames.find(pred);
      if (found) return resolve(found);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`timeout; frames: ${JSON.stringify(frames)}`)), ms);
    });
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("refused"));
    ws.onclose = (e) => reject(new Error(`closed ${e.code}`));
  });
  return { ws, frames, next, opened, send: (f: unknown) => ws.send(JSON.stringify(f)) };
}

test("upgrade requires a session, our Origin and org membership", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  expect(await upgradeStatus(wsUrl(orgId), { origin: ORIGIN })).toBe(401);
  expect(await upgradeStatus(wsUrl(orgId), { origin: "https://evil.example", cookie: owner.cookie() })).toBe(403);
  expect(await upgradeStatus(`ws://127.0.0.1:${server.port}/api/ws`, { origin: ORIGIN, cookie: owner.cookie() })).toBe(
    400,
  );
  const stranger = browser(t);
  await signUp(stranger, "stranger@example.com");
  expect(await upgradeStatus(wsUrl(orgId), { origin: ORIGIN, cookie: stranger.cookie() })).toBe(403);
});

test("revoked signed cookies cannot open a new realtime socket", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const oldCookies = owner.cookie();

  expect((await owner("/api/auth/sign-out", { json: {} })).status).toBe(200);
  expect(await upgradeStatus(wsUrl(orgId), { origin: ORIGIN, cookie: oldCookies })).toBe(401);
});

test("a revoked session closes its existing realtime socket", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const oldCookies = owner.cookie();
  const c = connect(wsUrl(orgId), { origin: ORIGIN, cookie: oldCookies });
  await c.opened;
  c.send({ type: "subscribe", channelId });
  await c.next((f) => f.type === "subscribed" && f.channelId === channelId);
  const closed = new Promise<number>((resolve) => c.ws.addEventListener("close", (e) => resolve(e.code)));

  expect((await owner("/api/auth/sign-out", { json: {} })).status).toBe(200);
  // The ordinary client pings; a revoked socket must close instead of
  // accepting another frame. The periodic check also bounds idle sockets.
  await Bun.sleep(2_100);
  c.send({ type: "ping" });
  expect(await Promise.race([closed, Bun.sleep(5_000).then(() => -1)])).toBe(4401);
});

test("subscriptions are limited to channels the person belongs to, in the connection's org", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const priv = (await (
    await owner(`/api/app/organizations/${orgId}/channels`, { json: { name: "secret", visibility: "private" } })
  ).json()) as { id: string };

  // Another person in the same org who is not in #secret.
  const { url } = (await (
    await owner(`/api/app/organizations/${orgId}/invitations`, { json: { email: "ana@example.com", role: "member" } })
  ).json()) as { url: string };
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await ana(`/api/app/invitations/${url.split("/invite/")[1]}/accept`, { json: {} });
  // And an outsider with an org of their own.
  const eve = browser(t);
  await signUp(eve, "eve@example.com");
  const eveOrg = (await (await eve("/api/app/organizations", { json: { name: "Eve Inc" } })).json()) as {
    organization: { id: string };
  };

  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  await a.opened;
  await a.next((f) => f.type === "ready");
  a.send({ type: "subscribe", channelId });
  expect(await a.next((f) => f.channelId === channelId)).toEqual({ type: "subscribed", channelId });
  a.send({ type: "subscribe", channelId: priv.id });
  expect(await a.next((f) => f.channelId === priv.id)).toEqual({
    type: "error",
    code: "forbidden",
    channelId: priv.id,
  });
  a.ws.close();

  const e = connect(wsUrl(eveOrg.organization.id), { origin: ORIGIN, cookie: eve.cookie() });
  await e.opened;
  e.send({ type: "subscribe", channelId });
  expect(await e.next((f) => f.channelId === channelId)).toEqual({ type: "error", code: "not_found", channelId });
  e.ws.close();

  expect(await authorizeSubscription(t.db, (await meId(eve)) ?? "", orgId, channelId)).toBe("forbidden");
});

async function meId(b: ReturnType<typeof browser>) {
  return ((await (await b("/api/app/me")).json()) as { user: { id: string } }).user.id;
}

test("a subscribe whose check can't run (the database is away) answers an error and closes, so the tab reconnects", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const c = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await c.opened;
  await c.next((f) => f.type === "ready");
  const closed = new Promise<number>((resolve) => c.ws.addEventListener("close", (e) => resolve(e.code)));
  const select = t.db.select;
  t.db.select = (() => {
    throw new Error("connection refused");
  }) as unknown as typeof t.db.select;
  try {
    c.send({ type: "subscribe", channelId });
    expect(await c.next((f) => f.channelId === channelId)).toEqual({ type: "error", code: "unavailable", channelId });
    expect(await closed).toBe(1011);
  } finally {
    t.db.select = select;
  }

  // The server lives on: the tab's next connection subscribes.
  const again = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await again.opened;
  again.send({ type: "subscribe", channelId });
  expect(await again.next((f) => f.channelId === channelId)).toEqual({ type: "subscribed", channelId });
  again.ws.close();
});

/** `db` whose queries settle a couple of ms later, on a timer. */
function answersLater<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, key) {
      const value = Reflect.get(obj, key) as unknown;
      if (typeof value !== "function") return value;
      if (key === "then") {
        return (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
          value.call(
            obj,
            (v: unknown) => setTimeout(() => ok(v), 2),
            (e: unknown) => setTimeout(() => fail(e), 2),
          );
      }
      return (...args: unknown[]) => {
        const out = value.apply(obj, args) as unknown;
        return out !== null && typeof out === "object" ? answersLater(out) : out;
      };
    },
  });
}

test("a channel subscribed while the periodic membership check runs stays subscribed", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  // The same server with the periodic check every few ms, so subscribes keep landing inside its query, and each
  // query answering a moment later, as over a network (PGlite answers before any frame can come in between).
  const realtime = createRealtime({
    db: answersLater(t.db),
    auth: t.auth,
    config: t.config,
    log: createLogger("error"),
    ...t.adapters,
    sessionRecheckMs: 5,
  });
  const fast = Bun.serve<SocketData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req, srv) => realtime.fetch(req, srv, (r) => t.app.fetch(r)),
    websocket: realtime.websocket,
  });
  try {
    const c = connect(`ws://127.0.0.1:${fast.port}/api/ws?orgId=${orgId}`, { origin: ORIGIN, cookie: owner.cookie() });
    await c.opened;
    await c.next((f) => f.type === "ready");
    const answers = () => c.frames.filter((f) => f.channelId === channelId);
    for (let i = 0; i < 40; i++) {
      const before = answers().length;
      c.send({ type: "subscribe", channelId });
      c.send({ type: "unsubscribe", channelId });
      const deadline = Date.now() + 5000;
      while (answers().length < before + 2 && Date.now() < deadline) await Bun.sleep(1);
    }
    c.send({ type: "subscribe", channelId });
    await Bun.sleep(100);
    // Each subscribe was `subscribed`, each unsubscribe `unsubscribed` (no reason): nothing refused or dropped.
    expect(answers().filter((f) => f.type === "error" || f.reason)).toEqual([]);
    expect(answers().at(-1)).toEqual({ type: "subscribed", channelId });
    c.ws.close();
  } finally {
    await Promise.race([fast.stop(true), Bun.sleep(500)]);
  }
}, 30_000);

test("a removal that lands while two subscribes to the channel are being checked refuses it: nothing is streamed", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const ana = await joinByInvitation(t, owner, orgId, "ana@example.com");
  const { user } = (await (await ana("/api/app/me")).json()) as { user: { id: string } };
  // The channel's membership check answers only when the test lets it: both subscribes are in flight at the removal.
  const held: (() => void)[] = [];
  const holds = <T extends object>(query: T): T =>
    new Proxy(query, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (typeof value !== "function") return value;
        if (key === "then")
          return (ok: (v: unknown) => void, fail: (e: unknown) => void) =>
            value.call(target, (rows: unknown) => held.push(() => ok(rows)), fail);
        return (...args: unknown[]) => {
          const out = value.apply(target, args) as unknown;
          return out !== null && typeof out === "object" ? holds(out) : out;
        };
      },
    });
  const db = new Proxy(t.db, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (key === "select")
        return (fields?: Record<string, unknown>) => {
          const query = (value as (f?: unknown) => object).call(target, fields);
          return fields?.channel === schema.channels ? holds(query) : query;
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  // The periodic recheck far away: only the removal's own event may refuse the channel here.
  const realtime = createRealtime({
    db,
    auth: t.auth,
    config: t.config,
    log: createLogger("error"),
    ...t.adapters,
    sessionRecheckMs: 60_000,
  });
  let data: SocketData | undefined;
  const refused = await realtime.upgrade(
    new Request(`${ORIGIN}/api/ws?orgId=${orgId}`, { headers: { origin: ORIGIN, cookie: ana.cookie() } }),
    {
      upgrade(_request: Request, options: { data: SocketData }) {
        data = options.data;
        return true;
      },
    } as unknown as Parameters<typeof realtime.upgrade>[1],
  );
  expect(refused).toBeUndefined();
  const frames: Record<string, unknown>[] = [];
  let readyState = 1;
  const socket = {
    data,
    get readyState() {
      return readyState;
    },
    send(text: string) {
      frames.push(JSON.parse(text) as Record<string, unknown>);
      return 1;
    },
    close() {
      readyState = 3;
    },
  } as unknown as Parameters<typeof realtime.websocket.open>[0];
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!done() && Date.now() < deadline) await Bun.sleep(1);
    expect(done()).toBe(true);
  };
  const pending: Promise<unknown>[] = [];
  try {
    await realtime.websocket.open(socket);
    const subscribe = JSON.stringify({ type: "subscribe", channelId });
    pending.push(Promise.resolve(realtime.websocket.message(socket, subscribe)));
    await until(() => held.length === 1);
    let answered = false;
    pending.push(Promise.resolve(realtime.websocket.message(socket, subscribe)).then(() => (answered = true)));
    await until(() => answered || held.length === 2);

    const removed = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/members/people/${user.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    for (const release of held.splice(0).reverse()) release();
    await Promise.all(pending);

    expect(frames.filter((f) => f.channelId === channelId)).toEqual([{ type: "error", code: "forbidden", channelId }]);
    const browser = data as BrowserSocketData | undefined;
    expect(browser?.subscriptions.has(channelId)).toBe(false);
    expect(browser?.pending.has(channelId)).toBe(false);
    const posted = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, {
      json: { body: "after the removal" },
    });
    expect(posted.status).toBe(201);
    expect(frames.filter((f) => f.type === "event" && f.channelId === channelId)).toEqual([]);
  } finally {
    for (const release of held.splice(0)) release();
    await Promise.allSettled(pending);
    readyState = 3;
    await realtime.websocket.close(socket, 1000);
  }
}, 30_000);

test("end to end: a subscriber sees the message, the streamed deltas and the agent's reply", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId, agentId } = await seedOrg(owner);
  const c = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await c.opened;
  c.send({ type: "subscribe", channelId });
  await c.next((f) => f.type === "subscribed");

  await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, { json: { body: "@dev hi" } });
  await t.drain();

  const done = await c.next((f) => f.type === "event" && (f.event as { type: string }).type === "message.handled");
  expect(done).toMatchObject({ channelId, event: { type: "message.handled", agentId, status: "done" } });
  // The channel's own events (the workspace's, like `agent.status`, arrive on the same socket).
  const events = c.frames
    .filter((f) => f.type === "event" && f.channelId === channelId)
    .map((f) => f.event as Record<string, unknown>);
  expect(events.map((e) => e.type)).toEqual([
    "message.created",
    "message.routed",
    "agent.thinking",
    "agent.thinking",
    "message.claimed",
    "agent.run",
    "agent.typing",
    "message.created",
    "agent.run",
    "agent.idle",
    "run.finished",
    "message.handled",
  ]);
  // The agent's presence moved with its run, for the whole workspace (ADR 0084 §11).
  const org = c.frames.filter((f) => f.type === "event" && f.scope === "org").map((f) => f.event);
  expect(org).toContainEqual(expect.objectContaining({ type: "agent.status", agentId }));
  // Its words come whole, in its message.
  expect(JSON.stringify(events.slice(0, 7))).not.toContain("Hello there");
  const reply = events[7] as {
    message: { body: string; threadId: string | null; author: { type: string; id: string } };
  };
  // Asked in the channel, answered in the channel.
  expect(reply.message).toMatchObject({
    body: "Hello there",
    threadId: null,
    author: { type: "agent", id: agentId },
  });
  expect(await t.adapters.presence.online(orgId)).toHaveLength(1);
  c.ws.close();
});

test("someone taken off a task's list loses its conversation's socket at once", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const { url } = (await (
    await owner(`/api/app/organizations/${orgId}/invitations`, { json: { email: "ana@example.com", role: "member" } })
  ).json()) as { url: string };
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await ana(`/api/app/invitations/${url.split("/invite/")[1]}/accept`, { json: {} });
  const anaId = (await meId(ana)) ?? "";
  const ownerId = (await meId(owner)) ?? "";
  const api = `/api/app/organizations/${orgId}/issues`;
  const issue = (await (
    await owner(api, { json: { title: "Plano", audience: { mode: "people", userIds: [ownerId, anaId] } } })
  ).json()) as { id: string };
  const { channelId } = (await (await ana(`${api}/${issue.id}/conversation`, { method: "POST", json: {} })).json()) as {
    channelId: string;
  };

  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  await a.opened;
  a.send({ type: "subscribe", channelId });
  await a.next((f) => f.type === "subscribed" && f.channelId === channelId);
  const changed = await owner(`${api}/${issue.id}/audience`, {
    method: "PUT",
    json: { mode: "people", userIds: [ownerId] },
  });
  expect(changed.status).toBe(200);
  expect(await a.next((f) => f.type === "unsubscribed" && f.channelId === channelId)).toEqual({
    type: "unsubscribed",
    channelId,
    reason: "revoked",
  });
  a.ws.close();
});

test("membership changes drop live subscriptions at once (channel, then organization)", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const { url } = (await (
    await owner(`/api/app/organizations/${orgId}/invitations`, { json: { email: "ana@example.com", role: "member" } })
  ).json()) as { url: string };
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await ana(`/api/app/invitations/${url.split("/invite/")[1]}/accept`, { json: {} });
  const anaId = (await meId(ana)) ?? "";
  const other = (await (
    await owner(`/api/app/organizations/${orgId}/channels`, { json: { name: "random" } })
  ).json()) as { id: string };
  await ana(`/api/app/organizations/${orgId}/channels/${other.id}/join`, { json: {} });

  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  await a.opened;
  const closed = new Promise<number>((resolve) => a.ws.addEventListener("close", (e) => resolve(e.code)));
  a.send({ type: "subscribe", channelId });
  a.send({ type: "subscribe", channelId: other.id });
  await a.next((f) => f.type === "subscribed" && f.channelId === channelId);
  await a.next((f) => f.type === "subscribed" && f.channelId === other.id);

  // Removed from #general: that subscription ends now, and its events stop.
  const removed = await owner(`/api/app/organizations/${orgId}/channels/${channelId}/members/people/${anaId}`, {
    method: "DELETE",
  });
  expect(removed.status).toBe(204);
  expect(await a.next((f) => f.type === "unsubscribed" && f.channelId === channelId)).toEqual({
    type: "unsubscribed",
    channelId,
    reason: "revoked",
  });
  await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, { json: { body: "after removal" } });
  await owner(`/api/app/organizations/${orgId}/channels/${other.id}/messages`, { json: { body: "still here" } });
  const stillHere = await a.next((f) => f.type === "event" && f.channelId === other.id);
  expect(stillHere).toMatchObject({ event: { type: "message.created" } });
  expect(a.frames.some((f) => f.type === "event" && f.channelId === channelId)).toBe(false);

  // Removed from the organization: the owner reads what it does first (their agents would pass to them), then every
  // subscription ends, the socket closes, and her app's requests are refused.
  const preview = await owner(`/api/app/organizations/${orgId}/members/${anaId}/removal`);
  expect(((await preview.json()) as { heir: { userId: string } }).heir.userId).toBe((await meId(owner)) ?? "");
  expect((await owner(`/api/app/organizations/${orgId}/members/${anaId}`, { method: "DELETE" })).status).toBe(204);
  expect(await closed).toBe(4403);
  expect(a.frames).toContainEqual({ type: "unsubscribed", channelId: other.id, reason: "revoked" });
  expect(a.frames).toContainEqual({ type: "error", code: "membership_revoked" });
  expect((await ana(`/api/app/organizations/${orgId}/channels`)).status).toBe(403);
  expect((await owner(`/api/app/organizations/${orgId}/members/${anaId}/removal`)).status).toBe(404);
  const me = (await (await ana("/api/app/me")).json()) as { organizations: { id: string }[] };
  expect(me.organizations.map((o) => o.id)).not.toContain(orgId);
});

test("leaving on one's own closes the socket without saying they were taken out", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const { url } = (await (
    await owner(`/api/app/organizations/${orgId}/invitations`, { json: { email: "ana@example.com", role: "member" } })
  ).json()) as { url: string };
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await ana(`/api/app/invitations/${url.split("/invite/")[1]}/accept`, { json: {} });
  const anaId = (await meId(ana)) ?? "";
  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  await a.opened;
  const closed = new Promise<number>((resolve) => a.ws.addEventListener("close", (e) => resolve(e.code)));
  expect((await ana(`/api/app/organizations/${orgId}/members/${anaId}`, { method: "DELETE" })).status).toBe(204);
  expect(await closed).toBe(4403);
  expect(a.frames).toContainEqual({ type: "error", code: "membership_ended" });
  expect(a.frames).not.toContainEqual({ type: "error", code: "membership_revoked" });
});

test("a missed revocation event is reconciled from durable membership", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const ana = await joinByInvitation(t, owner, orgId, "ana@example.com");
  const anaId = (await meId(ana)) ?? "";
  const publish = t.adapters.pubsub.publish.bind(t.adapters.pubsub);
  t.adapters.pubsub.publish = (topic, event) =>
    topic === orgTopic(orgId) && (event as { type?: string }).type === "membership.revoked"
      ? Promise.resolve()
      : publish(topic, event);

  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  await a.opened;
  a.send({ type: "subscribe", channelId });
  await a.next((f) => f.type === "subscribed" && f.channelId === channelId);
  expect((await currentSubscriptions(t.db, anaId, orgId, [channelId]))?.has(channelId)).toBe(true);

  expect(
    (
      await owner(`/api/app/organizations/${orgId}/channels/${channelId}/members/people/${anaId}`, {
        method: "DELETE",
      })
    ).status,
  ).toBe(204);
  expect((await currentSubscriptions(t.db, anaId, orgId, [channelId]))?.has(channelId)).toBe(false);
  expect(await a.next((f) => f.type === "unsubscribed" && f.channelId === channelId, 20_000)).toMatchObject({
    reason: "revoked",
  });
  const closed = new Promise<number>((resolve) => a.ws.addEventListener("close", (e) => resolve(e.code)));
  expect((await owner(`/api/app/organizations/${orgId}/members/${anaId}`, { method: "DELETE" })).status).toBe(204);
  expect(await Promise.race([closed, Bun.sleep(20_000).then(() => -1)])).toBe(4403);
}, 60_000);

test("a new message reaches the other members' sockets as `channel.activity` (no content), never the author's", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const ana = await joinByInvitation(t, owner, orgId, "ana@example.com");
  // Neither socket subscribes to the channel: the sidebar hears it anyway.
  const a = connect(wsUrl(orgId), { origin: ORIGIN, cookie: ana.cookie() });
  const o = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await Promise.all([a.opened, o.opened]);
  await Promise.all([a.next((f) => f.type === "ready"), o.next((f) => f.type === "ready")]);

  await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, { json: { body: "hello all" } });
  const heard = await a.next((f) => (f.event as { type?: string } | undefined)?.type === "channel.activity");
  expect(heard).toEqual({
    type: "event",
    scope: "user",
    event: { type: "channel.activity", channelId, threadId: null, dm: false },
  });
  await Bun.sleep(200);
  expect(o.frames.some((f) => (f.event as { type?: string } | undefined)?.type === "channel.activity")).toBe(false);

  // A reply in a thread Ana doesn't follow never reaches her.
  const root = (await (
    await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, { json: { body: "a topic" } })
  ).json()) as { id: string };
  await a.next((f) => (f.event as { type?: string } | undefined)?.type === "channel.activity");
  await owner(`/api/app/organizations/${orgId}/channels/${channelId}/messages`, {
    json: { body: "a reply", threadId: root.id },
  });
  await Bun.sleep(500);
  expect(a.frames.some((f) => (f.event as { threadId?: string } | undefined)?.threadId === root.id)).toBe(false);
  a.ws.close();
  o.ws.close();
});

test("a socket subscribed to no channel hears of the agents and channels the workspace makes, ids left out", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, agentId } = await seedOrg(owner);
  const c = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await c.opened;
  await c.next((f) => f.type === "ready");
  const heard = (type: string) => c.next((f) => (f.event as { type?: string } | undefined)?.type === type);

  const made = await owner(`/api/app/organizations/${orgId}/channels`, { json: { name: "vendas" } });
  expect(made.status).toBe(201);
  const channel = await heard("channels.changed");
  expect(channel).toEqual({ type: "event", scope: "org", event: { type: "channels.changed" } });

  const agent = await owner(`/api/app/organizations/${orgId}/agents/${agentId}`, {
    method: "PATCH",
    json: { appearance: { color: "violet", eyes: "round", accessory: "headset" } },
  });
  expect(agent.status).toBe(200);
  expect(await heard("agents.changed")).toEqual({ type: "event", scope: "org", event: { type: "agents.changed" } });

  c.frames.length = 0;
  const brain = await owner(`/api/app/organizations/${orgId}/agents/${agentId}/brain`, {
    method: "PUT",
    json: { fallback: false },
  });
  expect(brain.status).toBe(200);
  expect(await heard("agents.changed")).toEqual({ type: "event", scope: "org", event: { type: "agents.changed" } });

  c.frames.length = 0;
  const dm = await owner(`/api/app/organizations/${orgId}/dms`, { json: { agentId } });
  expect(dm.status).toBe(200);
  expect(await heard("channels.changed")).toEqual({
    type: "event",
    scope: "user",
    event: { type: "channels.changed" },
  });
  c.ws.close();
});

test("the server's LISTEN back after a gap: every app socket closes as a restart, so the app reconnects and reads again", async () => {
  const owner = browser(t);
  await signUp(owner, "owner@example.com");
  const { orgId, channelId } = await seedOrg(owner);
  const c = connect(wsUrl(orgId), { origin: ORIGIN, cookie: owner.cookie() });
  await c.opened;
  c.send({ type: "subscribe", channelId });
  await c.next((f) => f.type === "subscribed" && f.channelId === channelId);
  const closed = new Promise<number>((resolve) => c.ws.addEventListener("close", (e) => resolve(e.code)));
  await t.adapters.pubsub.publish(listenResumedTopic, { type: "pubsub.resumed" });
  expect(await Promise.race([closed, Bun.sleep(5000).then(() => -1)])).toBe(1012);
});

test("an event Bun drops past its backpressure limit closes the socket, so the app reconnects and reads what it missed", async () => {
  const realtime = createRealtime({
    db: t.db,
    auth: t.auth,
    config: t.config,
    log: createLogger("error"),
    ...t.adapters,
  });
  const closed: number[] = [];
  // A frozen tab: Bun's buffer for it is full, so every send is dropped (0).
  const frozen = {
    readyState: 1,
    data: { kind: "browser", connectionId: "frozen-tab", sessionValidatedAt: Date.now(), sessionCheckInFlight: null },
    send: () => 0,
    close: (code: number) => closed.push(code),
  };
  await realtime.websocket.message(frozen as unknown as Bun.ServerWebSocket<SocketData>, '{"type":"ping"}');
  expect(closed).toEqual([1013]);
});
