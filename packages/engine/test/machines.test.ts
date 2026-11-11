import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createFakeErrorReporter,
  MACHINE_PROTOCOL_VERSION,
  orgTopic,
  type ServerFrame,
  sealSecret,
  secretAad,
} from "@agenteschat/adapters";
import { and, eq, isNull, schema } from "@agenteschat/db";
import { systemText } from "@agenteschat/providers";
import {
  authenticateMachine,
  cancelRun,
  createAgent,
  createMachineHub,
  declineSecret,
  deleteMachine,
  deliverSecret,
  drainOutbox,
  executeRun,
  expireSecretRequests,
  ForbiddenError,
  getAgentComputer,
  grantScopes,
  listAgentSecrets,
  listMachines,
  listNotifications,
  MACHINE_CONTROL_TOPIC,
  MachineDroppedError,
  type MachineHub,
  MachineOfflineError,
  MachineRequestError,
  machineAgents,
  NotFoundError,
  postPersonMessage,
  receiveMachineUpload,
  registerPushDevice,
  removeAgentSecret,
  removeMember,
  renameMachine,
  renderPush,
  SERVER_STOP_TASK_GRACE_MS,
  type SecretRequestView,
  secretSite,
  setAgentComputerTarget,
  setMyLocale,
  TASK_OFFLINE_GRACE_MS,
  type ToolContext,
} from "../src";
import { addMember, type Fixture, setup } from "./fixtures";
import { type FakeRunnerOptions, fakeRunner, pairMachine, RUNNER } from "./machine-fixtures";
import { until } from "./stream-fixtures";

let f: Fixture;
const hubs: MachineHub[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.stop();
  await f?.machineHub?.stop();
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub, publicUrl: "https://agentes.chat" });

function pair(actorId = f.owner.id, name = "Build box", exec = true) {
  return pairMachine(deps(), actorId, f.org.id, { name, ...RUNNER, exec });
}

type Request = Extract<ServerFrame, { type: "request" }>;

/** A `brain.turn` request (the fake runner never answers it by itself). */
const brainTurn = (runId = crypto.randomUUID()) => ({
  op: "brain.turn" as const,
  runId,
  kind: "claude_code" as const,
  session: { id: crypto.randomUUID(), resume: true },
  cwd: "",
  system: "",
  prompt: "oi",
  mcp: { token: `agr_${"x".repeat(32)}` },
});

/** Settles to "pending" when the promise is still open after `ms`. */
const within = <T>(p: Promise<T>, ms = 200) =>
  Promise.race([
    p.then(
      () => "resolved" as const,
      (e: unknown) => e,
    ),
    Bun.sleep(ms).then(() => "pending" as const),
  ]);

describe("a runner that dies mid-request (brain turns never stay working)", () => {
  test("a new socket for the same machine fails the old one's requests at once, even if its close never comes", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const old = fakeRunner(hub, { dead: true });
    await old.hello(paired.token);
    const turn = hub.call(paired.machineId, brainTurn());
    await Bun.sleep(5);
    expect(old.sent.some((s) => s.type === "request" && s.op === "brain.turn")).toBe(true);

    // The desktop app was reinstalled: the runner was killed mid-turn and a new one says hello.
    const fresh = fakeRunner(hub);
    await fresh.hello(paired.token);
    expect(await within(turn)).toBeInstanceOf(MachineOfflineError);
    expect(old.closed()).toMatchObject({ code: 4409 });
    expect((await hub.status(paired.machineId))?.online).toBe(true);
  });

  test("the caller on another replica learns it too: same replica replaced, or the runner back on another replica", async () => {
    f = await setup({ machines: true });
    const hubA = f.machineHub as MachineHub;
    const hubB = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-b", rpcPollMs: 10 });
    hubs.push(hubB);
    const paired = await pair();

    // Socket on A, turn asked from B (machine_rpc); the runner comes back on A.
    const first = fakeRunner(hubA, { dead: true });
    await first.hello(paired.token);
    const viaRpc = hubB.call(paired.machineId, brainTurn());
    await Bun.sleep(40);
    expect(first.sent.some((s) => s.type === "request" && s.op === "brain.turn")).toBe(true);
    const second = fakeRunner(hubA, { dead: true });
    await second.hello(paired.token);
    expect(await within(viaRpc, 300)).toBeInstanceOf(MachineOfflineError);

    // Socket on A, turn asked from B; the runner comes back on B: A drops its stale socket.
    const turn2 = hubB.call(paired.machineId, brainTurn());
    await Bun.sleep(40);
    expect(second.sent.some((s) => s.type === "request" && s.op === "brain.turn")).toBe(true);
    const third = fakeRunner(hubB);
    await third.hello(paired.token);
    expect(await within(turn2, 300)).toBeInstanceOf(MachineOfflineError);
    expect(second.closed()).toMatchObject({ code: 4409 });
    expect(hubA.isLocal(paired.machineId)).toBe(false);
    expect(hubB.isLocal(paired.machineId)).toBe(true);
  });

  test("a replica that holds the socket and dies: the caller stops waiting once the row says so", async () => {
    f = await setup({ machines: true });
    const hubB = createMachineHub({
      db: f.db,
      pubsub: f.pubsub,
      replicaId: "replica-b",
      rpcPollMs: 10,
      rpcLivenessMs: 20,
    });
    hubs.push(hubB);
    const paired = await pair();
    // A replica that never serves its machine_rpc rows (it is gone), still on the row.
    await f.db
      .update(schema.machines)
      .set({ online: true, connectedReplica: "gone", lastSeenAt: new Date(), protocol: MACHINE_PROTOCOL_VERSION })
      .where(eq(schema.machines.id, paired.machineId));
    const turn = hubB.call(paired.machineId, brainTurn());
    await Bun.sleep(40);
    expect(await within(turn, 20)).toBe("pending");
    // The runner reconnected to another replica.
    await f.db
      .update(schema.machines)
      .set({ connectedReplica: "replica-c" })
      .where(eq(schema.machines.id, paired.machineId));
    expect(await within(turn, 300)).toBeInstanceOf(MachineOfflineError);
    const [rpc] = await f.db.select().from(schema.machineRpc);
    expect(rpc?.status).toBe("failed");
  });

  test("no pong: the socket's requests fail and the machine goes offline even if its close never comes", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-p", heartbeatMs: 20 });
    hubs.push(hub);
    const paired = await pair();
    const runner = fakeRunner(hub, { dead: true });
    await runner.hello(paired.token);
    const turn = hub.call(paired.machineId, brainTurn());
    expect(await within(turn, 400)).toBeInstanceOf(MachineOfflineError);
    expect(runner.closed()).toMatchObject({ code: 4408 });
    const [row] = await f.db.select().from(schema.machines);
    expect(row).toMatchObject({ online: false, connectedReplica: null });
  });

  test("a silent runner is dropped two heartbeats after its last pong, as the runner drops a silent server", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-s", heartbeatMs: 100 });
    hubs.push(hub);
    const paired = await pair();
    const runner = fakeRunner(hub, { dead: true });
    await runner.hello(paired.token);
    const turn = hub.call(paired.machineId, brainTurn());
    // Gone at the second heartbeat (200 ms), not the fourth.
    expect(await within(turn, 300)).toBeInstanceOf(MachineDroppedError);
    expect(runner.closed()).toMatchObject({ code: 4408 });
  });

  test("a request cut by its socket closing fails as dropped (it may have run); our own stop says it is ours", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-d" });
    hubs.push(hub);
    const paired = await pair();
    const exec = { op: "exec" as const, command: "make deploy", timeoutSeconds: 60, stream: false };
    const runner = fakeRunner(hub, { exec: () => "hang" });
    await runner.hello(paired.token);
    const cut = hub.call(paired.machineId, exec);
    await Bun.sleep(5);
    await runner.disconnect();
    const error = await within(cut);
    expect(error).toBeInstanceOf(MachineDroppedError);
    expect(error).toMatchObject({ serverStop: false });
    expect((error as Error).message).toContain("may have had effects");
    // Nothing is sent to a computer that is away: offline, in the plain words.
    const away = await hub.call(paired.machineId, exec).catch((e: unknown) => e);
    expect(away).toBeInstanceOf(MachineOfflineError);
    expect(away).not.toBeInstanceOf(MachineDroppedError);

    // Our own stop: the same, marked as ours; its tasks get a long backstop instead of the usual grace, and
    // the apps hear after the usual grace that it is still away (an outage then).
    const again = fakeRunner(hub, { exec: () => "hang" });
    await again.hello(paired.token);
    const stopped = hub.call(paired.machineId, exec);
    await Bun.sleep(5);
    await hub.stop();
    expect(await within(stopped)).toMatchObject({ serverStop: true });
    const jobs = () => f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "machine.tasks_offline"));
    await until(async () => (await jobs()).length === 3, "the stop's offline jobs");
    const graces = (await jobs())
      .map((j) => ({ ms: j.nextAttemptAt.getTime() - j.createdAt.getTime(), payload: j.payload }))
      .sort((a, b) => a.ms - b.ms);
    expect(graces[0]?.ms).toBeLessThan(TASK_OFFLINE_GRACE_MS + 5000);
    expect(graces[1]?.ms).toBeLessThan(TASK_OFFLINE_GRACE_MS + 5000);
    expect(graces.slice(0, 2).map((g) => g.payload)).toContainEqual({
      machineId: paired.machineId,
      statusOnly: true,
    });
    expect(graces[2]?.payload).toEqual({ machineId: paired.machineId });
    expect(graces[2]?.ms).toBeGreaterThan(SERVER_STOP_TASK_GRACE_MS - 5000);
  });

  test("the agent's process gone mid-request (`dropped` from the runner) is a drop, in the runner's words", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);
    const turn = hub.call(paired.machineId, brainTurn());
    await Bun.sleep(5);
    const req = runner.sent.find((s) => s.type === "request" && s.op === "brain.turn") as Request;
    const message = "The agent's worker on this computer stopped while this ran.";
    await runner.frame({ type: "result", id: req.id, ok: false, error: { code: "dropped", message } });
    const error = await within(turn);
    expect(error).toBeInstanceOf(MachineDroppedError);
    expect((error as Error).message).toBe(message);
  });

  test("a hello that fails on our side closes the socket without a refusal, so the runner dials again", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub);
    // The database is away for a moment while the runner says hello.
    const db = f.db as unknown as Record<string, unknown>;
    db.select = () => {
      throw new Error("database away");
    };
    try {
      await runner.hello(paired.token);
    } finally {
      delete db.select;
    }
    expect(runner.sent).toEqual([]);
    expect(runner.closed()).toMatchObject({ code: 1011 });
    const back = fakeRunner(hub);
    await back.hello(paired.token);
    expect(back.sent[0]).toMatchObject({ type: "welcome", machineId: paired.machineId });
  });

  test("an mcp.call sent again under its callId runs once: the copy waits for the first answer", async () => {
    f = await setup({ machines: true });
    // The first run is in this process: the copy waits on it, however long it takes.
    const hub = createMachineHub({
      db: f.db,
      pubsub: f.pubsub,
      replicaId: "replica-m",
      rpcPollMs: 10,
      mcpRepeatWaitMs: 5,
    });
    hubs.push(hub);
    let runs = 0;
    let finish = () => {};
    hub.setMissionHooks({
      mcp: async (_machineId, frame) => {
        runs++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { ok: true, text: `posted: ${String(frame.args.text)}` };
      },
    });
    const paired = await pair();
    const call = { type: "mcp.call", callId: "call-1", taskId: "t", tool: "post_message", args: { text: "oi" } };
    const first = fakeRunner(hub);
    await first.hello(paired.token);
    await first.frame(call);
    await until(() => runs === 1, "the first run");
    // The link drops while it runs; the runner sends the call again on its new socket.
    const second = fakeRunner(hub);
    await second.hello(paired.token);
    await second.frame(call);
    await Bun.sleep(30);
    finish();
    await until(() => second.sent.some((s) => s.type === "mcp.result"), "the copy's answer");
    expect(runs).toBe(1);
    expect(second.sent.find((s) => s.type === "mcp.result")).toEqual({
      type: "mcp.result",
      callId: "call-1",
      ok: true,
      text: "posted: oi",
    });
    // Later copies get the same answer at once.
    await second.frame(call);
    await until(() => second.sent.filter((s) => s.type === "mcp.result").length === 2, "a later copy's answer");
    expect(runs).toBe(1);
  });

  test("a copy whose first run died with its server hears soon that it was cut off, and nothing runs again", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({
      db: f.db,
      pubsub: f.pubsub,
      replicaId: "replica-c",
      rpcPollMs: 5,
      mcpRepeatWaitMs: 50,
    });
    hubs.push(hub);
    let runs = 0;
    hub.setMissionHooks({
      mcp: async () => {
        runs++;
        return { ok: true, text: "posted" };
      },
    });
    const paired = await pair();
    // What a server that crashed mid-call leaves: the call taken, no answer.
    await f.db
      .insert(schema.machineMcpCalls)
      .values({ orgId: f.org.id, machineId: paired.machineId, callId: "call-9" });
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);
    const at = Date.now();
    await runner.frame({ type: "mcp.call", callId: "call-9", taskId: "t", tool: "post_message", args: { text: "oi" } });
    await until(() => runner.sent.some((s) => s.type === "mcp.result"), "the copy's answer");
    expect(Date.now() - at).toBeLessThan(2000);
    expect(runner.sent.find((s) => s.type === "mcp.result")).toMatchObject({
      callId: "call-9",
      ok: false,
      error: { code: "bridge.cut_off", message: expect.stringContaining("it may have run in part") },
    });
    expect(runs).toBe(0);
  });

  test("our own stop lets a task's call in flight store its answer: the copy on the next server gets it", async () => {
    f = await setup({ machines: true });
    let runs = 0;
    const mcp = async () => {
      runs++;
      await Bun.sleep(50);
      return { ok: true as const, text: "posted" };
    };
    const old = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-old" });
    old.setMissionHooks({ mcp });
    const paired = await pair();
    const call = { type: "mcp.call", callId: "call-5", taskId: "t", tool: "post_message", args: { text: "oi" } };
    const runner = fakeRunner(old);
    await runner.hello(paired.token);
    await runner.frame(call);
    await until(() => runs === 1, "the first run");
    await old.stop();
    await old.drain(2000);
    const [row] = await f.db.select().from(schema.machineMcpCalls).where(eq(schema.machineMcpCalls.callId, "call-5"));
    expect(row?.result).toEqual({ ok: true, text: "posted" });

    const next = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-new", mcpRepeatWaitMs: 5 });
    hubs.push(next);
    next.setMissionHooks({ mcp });
    const back = fakeRunner(next);
    await back.hello(paired.token);
    await back.frame(call);
    await until(() => back.sent.some((s) => s.type === "mcp.result"), "the copy's answer");
    expect(back.sent.find((s) => s.type === "mcp.result")).toEqual({
      type: "mcp.result",
      callId: "call-5",
      ok: true,
      text: "posted",
    });
    expect(runs).toBe(1);
  });

  test("a pong's browser traffic is stored with when it came, with or without a load (protocol 23)", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);
    const row = async () =>
      (await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId)))[0];
    const browserTraffic = { up: 4096, down: 1_250_000, hours: 0.2 };
    const before = Date.now();
    await runner.frame({ type: "pong", at: 1, browserTraffic });
    const stored = await row();
    expect(stored?.browserTraffic).toEqual({ ...browserTraffic, at: expect.any(String) });
    expect(Date.parse(stored?.browserTraffic?.at ?? "")).toBeGreaterThanOrEqual(before - 1000);
    expect(stored?.load).toBeNull();

    const load = { loadAvg: 0.1, loadPeak: 0.5, memoryAvg: 0.3, memoryPeak: 0.4, hours: 0.2 };
    const more = { up: 8192, down: 2_000_000, hours: 0.3 };
    await runner.frame({ type: "pong", at: 2, load, browserTraffic: more });
    expect(await row()).toMatchObject({ load: { ...load, at: expect.any(String) }, browserTraffic: more });
    // A pong without either keeps what the last one said; one out of bounds says nothing.
    await runner.frame({ type: "pong", at: 3, browserTraffic: { ...more, up: -5 } });
    expect((await row())?.browserTraffic).toMatchObject(more);
  });

  test("a disk past 85% tells the admins once each time it crosses; the page shows the disk and the shared folder", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);
    const base = { loadAvg: 0.1, loadPeak: 0.5, memoryAvg: 0.3, memoryPeak: 0.4, hours: 0.2 };
    const warnings = async () =>
      (await listNotifications({ db: f.db }, f.owner.id, f.org.id, { limit: 50 })).items.filter(
        (n) => n.kind === "computer_disk_full",
      );
    await runner.frame({ type: "pong", at: 1, load: { ...base, diskFreeGb: 40, diskUse: 0.6, sharedGb: 2.5 } });
    expect(await warnings()).toEqual([]);
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.disk).toEqual({ freeGb: 40, use: 0.6, sharedGb: 2.5 });

    await runner.frame({ type: "pong", at: 2, load: { ...base, diskFreeGb: 9, diskUse: 0.91, sharedGb: 30 } });
    await runner.frame({ type: "pong", at: 3, load: { ...base, diskFreeGb: 8, diskUse: 0.92, sharedGb: 31 } });
    const [warned] = await warnings();
    expect(await warnings()).toHaveLength(1);
    expect(warned?.source).toMatchObject({ machineId: paired.machineId, label: "Build box" });
    expect(warned?.latest).toMatchObject({ diskUse: 0.91, diskFreeGb: 9 });

    // A runner that restarts reports once without the disk: the page keeps it and nobody hears it again.
    await runner.frame({ type: "pong", at: 4, load: base });
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.disk).toEqual({ freeGb: 8, use: 0.92, sharedGb: 31 });
    await runner.frame({ type: "pong", at: 5, load: { ...base, diskFreeGb: 8, diskUse: 0.92 } });
    // Hovering at the line: under 85% but not under 80% doesn't arm it again.
    await runner.frame({ type: "pong", at: 6, load: { ...base, diskFreeGb: 14, diskUse: 0.83 } });
    await runner.frame({ type: "pong", at: 7, load: { ...base, diskFreeGb: 9, diskUse: 0.86 } });
    expect(await warnings()).toHaveLength(1);

    // Back under 80%, then over the line again: a new notice.
    await runner.frame({ type: "pong", at: 8, load: { ...base, diskFreeGb: 30, diskUse: 0.7 } });
    await runner.frame({ type: "pong", at: 9, load: { ...base, diskFreeGb: 5, diskUse: 0.95 } });
    expect(await warnings()).toHaveLength(2);
  });

  test("a computer without Google Chrome tells who connected it once each time it goes missing; the Cloud's is reported", async () => {
    f = await setup();
    const errors = createFakeErrorReporter();
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, errors });
    hubs.push(hub);
    const paired = await pair();
    const notices = async () =>
      (await listNotifications({ db: f.db }, f.owner.id, f.org.id, { limit: 50 })).items.filter(
        (n) => n.kind === "computer_no_chrome",
      );
    const browserOn = { folders: [], tools: { claude: true, codex: false, commands: true, browser: true } };
    const missing = { available: true, version: "0.39.1", chromeMissing: true };
    const hello = async (extra: Record<string, unknown>) => {
      const runner = fakeRunner(hub);
      await runner.hello(paired.token, extra);
      runner.disconnect();
    };

    // The browser switched off here: nobody needs Chrome yet.
    await hello({ browser: missing, access: { ...browserOn, tools: { ...browserOn.tools, browser: false } } });
    expect(await notices()).toEqual([]);
    await hello({ browser: { available: true, chrome: "Google Chrome 156.0.8078.79" }, access: browserOn });
    expect(await notices()).toEqual([]);

    // A runner that updated itself and found no Chrome: once, however often it connects again.
    await hello({ browser: missing, access: browserOn });
    await hello({ browser: missing, access: browserOn });
    const [notice] = await notices();
    expect(await notices()).toHaveLength(1);
    expect(notice?.source).toMatchObject({ machineId: paired.machineId, label: "Build box" });
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.browser).toMatchObject({
      available: true,
      chrome: null,
    });
    // Installed, then gone again: a new notice.
    await hello({ browser: { available: true, chrome: "Google Chrome 156.0.8078.79" }, access: browserOn });
    await hello({ browser: missing, access: browserOn });
    expect(await notices()).toHaveLength(2);
    expect(errors.reports).toEqual([]);

    // The Cloud's computers are the operators' to fix: an error report, nobody in the workspace told.
    await f.db.update(schema.machines).set({ kind: "managed" }).where(eq(schema.machines.id, paired.machineId));
    await hello({ browser: { available: true, chrome: "Google Chrome 156.0.8078.79" }, access: browserOn });
    await hello({ browser: missing, access: browserOn });
    expect(await notices()).toHaveLength(2);
    expect(errors.reports).toHaveLength(1);
    expect(String(errors.reports[0]?.error)).toContain("Google Chrome failed an agent's browser (missing)");
    expect(errors.reports[0]?.tags).toMatchObject({
      org_id: f.org.id,
      machine_id: paired.machineId,
      os: "linux",
      browser_failure: "missing",
    });
  });

  test("a Claude login self-check that fails is reported once per reason, with the computer's tags", async () => {
    f = await setup();
    const errors = createFakeErrorReporter();
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, errors });
    hubs.push(hub);
    const paired = await pair();
    // No reason and no `cli_login`: a runner that just started, its self-check still running.
    const hello = async (claudeLoginBlocked?: string, passed = false) => {
      const runner = fakeRunner(hub);
      await runner.hello(paired.token, {
        claudeLoginMethods: passed ? ["setup_token", "cli_login"] : ["setup_token"],
        ...(claudeLoginBlocked ? { claudeLoginBlocked } : {}),
      });
      runner.disconnect();
    };
    const tools = "The Claude CLI kept a tool of its own (Bash) (Claude CLI 2.1.330)";

    await hello();
    await hello(tools);
    await hello(tools);
    // A restart: the check hasn't finished on its first hello, then fails again for the same reason.
    await hello();
    await hello(tools);
    expect(errors.reports).toHaveLength(1);
    expect(String(errors.reports[0]?.error)).toContain(tools);
    expect(errors.reports[0]?.tags).toMatchObject({
      org_id: f.org.id,
      machine_id: paired.machineId,
      runner_version: RUNNER.version,
    });
    // A new reason is news; passing, then failing again for the old one, is too.
    await hello("It needs systemd");
    await hello(undefined, true);
    await hello(tools);
    expect(errors.reports.map((r) => String(r.error))).toEqual([
      expect.stringContaining(tools),
      expect.stringContaining("It needs systemd"),
      expect.stringContaining(tools),
    ]);
  });

  test("a tool switched on the machine holds now (exec on the row) and wakes what waited for it", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const woke: string[] = [];
    hub.setMissionHooks({ online: async (id) => void woke.push(id) });
    const paired = await pair();
    const runner = fakeRunner(hub, { execAllowed: false });
    await runner.hello(paired.token);
    await Bun.sleep(5);
    woke.length = 0;
    expect((await hub.status(paired.machineId))?.execAllowed).toBe(false);
    await runner.frame({
      type: "access.changed",
      access: { folders: [], tools: { claude: true, codex: false, commands: true } },
    });
    await Bun.sleep(5);
    expect(await hub.status(paired.machineId)).toMatchObject({
      execAllowed: true,
      access: { tools: { claude: true, commands: true } },
    });
    expect(woke).toEqual([paired.machineId]);
  });

  test("CLIs found mid-session replace the hello's (the browser and the rest stay) and wake what waited", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const woke: string[] = [];
    hub.setMissionHooks({ online: async (id) => void woke.push(id) });
    const paired = await pair();
    const runner = fakeRunner(hub);
    const row = async () =>
      (await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId)))[0]?.executors;
    // The look timed out before this hello: it carried nothing for Claude Code.
    await runner.hello(paired.token, {
      executors: { codex: { version: "codex-cli 0.80.0" } },
      browser: { available: true, chrome: "Google Chrome 156.0.8078.79" },
    });
    await Bun.sleep(5);
    woke.length = 0;
    await runner.frame({
      type: "executors.changed",
      executors: { claude: { version: "2.1.300", loggedIn: true, email: "never@stored" }, bogus: { version: "x" } },
    });
    await Bun.sleep(5);
    const executors = await row();
    expect(executors).toMatchObject({
      claude: { version: "2.1.300", loggedIn: true },
      browser: { available: true },
    });
    expect(executors?.codex).toBeUndefined();
    expect(JSON.stringify(executors)).not.toContain("never@stored");
    expect(JSON.stringify(executors)).not.toContain("bogus");
    expect(woke).toEqual([paired.machineId]);
    // Not an object: dropped, the row stays.
    await runner.frame({ type: "executors.changed", executors: "nope" });
    await Bun.sleep(5);
    expect((await row())?.claude).toMatchObject({ version: "2.1.300" });
    // A hello from a runner that hasn't looked yet leaves the CLIs out: the stored ones stand.
    const detectedAt = (await row())?.detectedAt;
    await fakeRunner(hub).hello(paired.token, { browser: { available: false } });
    await Bun.sleep(5);
    expect(await row()).toMatchObject({ claude: { version: "2.1.300" }, browser: { available: false }, detectedAt });
  });

  test("toolchains found mid-session replace the hello's (the rest stays) and tell the org", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub);
    const row = async () =>
      (await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId)))[0]?.executors;
    await runner.hello(paired.token, {
      browser: { available: true, chrome: "Google Chrome 156.0.8078.79" },
      toolchains: { xcode: "27.0", appleAccount: "no_team" },
    });
    await Bun.sleep(5);
    const events: Record<string, unknown>[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => events.push((e as { event?: Record<string, unknown> }).event ?? {}));
    const toolchains = {
      xcode: "27.0",
      xcodeSdk: "27.0",
      appleTeam: "Sam Rivera (Personal Team)",
      appleAccount: "team",
    };
    await runner.frame({ type: "toolchains.changed", toolchains });
    await Bun.sleep(5);
    expect(await row()).toMatchObject({ browser: { available: true }, toolchains });
    expect(events).toContainEqual({ type: "machine.updated", machineId: paired.machineId, toolchains: true });
  });

  test("a brain turn that goes quiet fails; its own events and bridge calls keep a long one alive", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-i", brainIdleMs: 200 });
    hubs.push(hub);
    const paired = await pair();
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);

    const quiet = hub.call(paired.machineId, brainTurn());
    const error = await within(quiet, 1000);
    expect(error).toBeInstanceOf(MachineRequestError);
    expect((error as MachineRequestError).code).toBe("timeout");
    expect(runner.sent.some((s) => s.type === "cancel")).toBe(true);

    const runId = crypto.randomUUID();
    const alive = hub.call(paired.machineId, brainTurn(runId));
    await Bun.sleep(5);
    const req = [...runner.sent].reverse().find((s) => s.type === "request" && s.op === "brain.turn") as Request;
    // Frames 60ms apart for 480ms: each well inside the 200ms idle window (a busy CI runner adds tens of ms), the
    // whole turn more than twice past it.
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(60);
      await runner.frame({ type: "brain.event", runId, event: { type: "text_delta", text: "." } });
      await Bun.sleep(60);
      // A permission prompt waiting for a person polls the bridge with the turn's token.
      await runner.frame({
        type: "mcp.call",
        callId: `c${i}`,
        taskId: "t",
        tool: "x",
        args: {},
        token: req.op === "brain.turn" ? req.mcp.token : "",
      });
    }
    await runner.frame({
      type: "result",
      id: req.id,
      ok: true,
      data: { runId, final: { type: "done", text: "ok" } },
    });
    expect(await alive).toMatchObject({ final: { type: "done" } });
  });
});

// Connecting a computer (the device-code flow) is covered in desktop.test.ts.
describe("pairing", () => {
  test("authenticateMachine: valid token only; deleting the machine revokes it", async () => {
    f = await setup();
    const paired = await pair();
    expect((await authenticateMachine(f.db, paired.token))?.id).toBe(paired.machineId);
    expect(await authenticateMachine(f.db, `${paired.token}x`)).toBeNull();
    expect(await authenticateMachine(f.db, "not-a-token")).toBeNull();
    await deleteMachine(deps(), f.owner.id, f.org.id, paired.machineId);
    expect(await authenticateMachine(f.db, paired.token)).toBeNull();
  });
});

describe("machines and targets", () => {
  test("a computer lists its agents in the order they came, as the agents' own list does", async () => {
    f = await setup();
    const qa = await createAgent(
      f.db,
      f.owner.id,
      f.org.id,
      { name: "QA", handle: "qa" },
      { model: "claude-sonnet-5-5" },
    );
    const box = await pair();
    // The newer agent moves there first: the order its rows were written in isn't the one people see.
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, qa.id, box.machineId);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, box.machineId);
    const [machine] = await listMachines(f.db, f.owner.id, f.org.id);
    expect(machine?.agents.map((a) => a.handle)).toEqual(["dev", "qa"]);
  });

  test("list, rename and delete: every member sees them, only the pairer or an admin changes them", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const carl = await addMember(f.db, f.org.id, "member", "carl");
    const mine = await pair(bia.id, "Bia's laptop");
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, mine.machineId);
    const seenByCarl = await listMachines(f.db, carl.id, f.org.id);
    expect(seenByCarl).toHaveLength(1);
    expect(seenByCarl[0]).toMatchObject({
      name: "Bia's laptop",
      online: false,
      os: "linux",
      execAllowed: true,
      pairedBy: { id: bia.id, name: "bia" },
      agents: [{ id: f.agent.id, handle: "dev" }],
      workspace: null,
      canManage: false,
      mode: "single",
    });
    expect((await listMachines(f.db, bia.id, f.org.id))[0]).toMatchObject({
      workspace: RUNNER.workspace,
      canManage: true,
    });
    // A runner in system mode (ADR 0057) says so at hello: each agent its own user, not the pairing folder.
    await f.db
      .update(schema.machines)
      .set({ executors: { mode: "system" } })
      .where(eq(schema.machines.id, mine.machineId));
    expect((await listMachines(f.db, carl.id, f.org.id))[0]?.mode).toBe("system");

    await expect(renameMachine(deps(), carl.id, f.org.id, mine.machineId, { name: "x" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await renameMachine(deps(), bia.id, f.org.id, mine.machineId, { name: "Laptop" })).toMatchObject({
      name: "Laptop",
    });
    await expect(deleteMachine(deps(), carl.id, f.org.id, mine.machineId)).rejects.toThrow(ForbiddenError);
    await deleteMachine(deps(), f.owner.id, f.org.id, mine.machineId);
    expect(await listMachines(f.db, bia.id, f.org.id)).toEqual([]);
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
    expect(agent?.machineId).toBeNull();
    await expect(deleteMachine(deps(), f.owner.id, f.org.id, mine.machineId)).rejects.toThrow(NotFoundError);
  });

  test("whoever leaves or is removed takes the computers they connected, a server too; one marked the workspace's stays, nobody's now, and their AI accounts leave it", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "admin", "bia");
    const cy = await addMember(f.db, f.org.id, "member", "cy");
    const laptop = (await pair(bia.id, "Bia's laptop")).machineId;
    const server = (await pair(bia.id, "Team server")).machineId;
    await f.db
      .update(schema.machines)
      .set({ executors: { mode: "system" }, belongsToWorkspace: true })
      .where(eq(schema.machines.id, server));
    const cyLaptop = (await pair(cy.id, "Cy's laptop")).machineId;
    const cyServer = (await pair(cy.id, "Cy's server")).machineId;
    await f.db
      .update(schema.machines)
      .set({ executors: { mode: "system" } })
      .where(eq(schema.machines.id, cyServer));
    await f.db.insert(schema.machineAccounts).values({
      id: crypto.randomUUID(),
      orgId: f.org.id,
      machineId: server,
      kind: "claude_code",
      label: "Claude Max",
      status: "active",
      createdBy: bia.id,
    });
    await f.db.update(schema.agents).set({ machineId: laptop }).where(eq(schema.agents.id, f.agent.id));
    const signals: unknown[] = [];
    f.pubsub.subscribe(MACHINE_CONTROL_TOPIC, (e) => signals.push(e));

    await removeMember(f.db, bia.id, f.org.id, bia.id, { pubsub: f.pubsub });
    await removeMember(f.db, f.owner.id, f.org.id, cy.id, { pubsub: f.pubsub });
    const rows = await f.db.select().from(schema.machines).orderBy(schema.machines.createdAt);
    expect(rows.map((m) => [m.name, m.deletedAt !== null, m.pairedByUserId])).toEqual([
      ["Bia's laptop", true, bia.id],
      ["Team server", false, null],
      ["Cy's laptop", true, cy.id],
      ["Cy's server", true, cy.id],
    ]);
    expect(signals).toEqual(
      expect.arrayContaining([
        { type: "machine.accounts", machineId: server },
        { type: "machine.revoke", machineId: laptop },
        { type: "machine.revoke", machineId: cyLaptop },
      ]),
    );
    expect(signals).not.toContainEqual({ type: "machine.revoke", machineId: server });
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
    expect(agent?.machineId).toBeNull();
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "machine.deleted"));
    expect(audit.map((a) => [a.targetId, a.actorId])).toEqual([
      [laptop, bia.id],
      [cyLaptop, f.owner.id],
      [cyServer, f.owner.id],
    ]);
    const accounts = await f.db.select().from(schema.machineAccounts);
    expect(accounts).toMatchObject([{ machineId: server, status: "removing" }]);
  });

  test("target: admins, or the agent's owner with a machine they paired; announced as agent.computer", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const carl = await addMember(f.db, f.org.id, "member", "carl");
    await f.db.update(schema.agents).set({ ownerUserId: bia.id }).where(eq(schema.agents.id, f.agent.id));
    const biaBox = await pair(bia.id, "Bia's box");
    const anaBox = await pair(f.owner.id, "Ana's box");
    const events: Record<string, unknown>[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => events.push((e as { event?: Record<string, unknown> }).event ?? {}));

    await expect(setAgentComputerTarget(deps(), carl.id, f.org.id, f.agent.id, biaBox.machineId)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(setAgentComputerTarget(deps(), bia.id, f.org.id, f.agent.id, anaBox.machineId)).rejects.toThrow(
      ForbiddenError,
    );
    expect(await setAgentComputerTarget(deps(), bia.id, f.org.id, f.agent.id, biaBox.machineId)).toEqual({
      kind: "machine",
      machineId: biaBox.machineId,
      name: "Bia's box",
      online: false,
    });
    expect(events.at(-1)).toMatchObject({ type: "agent.computer", agentId: f.agent.id, target: { kind: "machine" } });
    expect(await setAgentComputerTarget(deps(), bia.id, f.org.id, f.agent.id, null)).toEqual({ kind: "none" });
    expect(await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, anaBox.machineId)).toMatchObject({
      kind: "machine",
    });
    await expect(setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, crypto.randomUUID())).rejects.toThrow(
      NotFoundError,
    );
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "agent.computer_target"));
    expect(audit).toHaveLength(3);

    // The computer API says which.
    expect(await getAgentComputer(f.db, f.owner.id, f.org.id, f.agent.id)).toMatchObject({
      target: { kind: "machine", name: "Ana's box" },
    });
  });
});

describe("hub", () => {
  test("no hello in time: the socket closes without a refusal, so the runner dials again", async () => {
    f = await setup({ machines: true });
    const hub = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-h", helloTimeoutMs: 20 });
    hubs.push(hub);
    const slow = fakeRunner(hub);
    await Bun.sleep(60);
    expect(slow.sent).toEqual([]);
    expect(slow.closed()).toMatchObject({ code: 4408 });
  });

  test("hello → welcome and online; bad token and outdated runners are refused", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const statuses: unknown[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => statuses.push((e as { event?: { type: string } }).event));

    const bad = fakeRunner(hub);
    await bad.hello("agm_wrong");
    expect(bad.sent).toEqual([{ type: "refused", reason: "invalid_token", message: expect.any(String) }]);
    expect(bad.closed()).toMatchObject({ code: 4401 });
    const old = fakeRunner(hub);
    await old.hello(paired.token, { protocol: 0 });
    expect(old.sent[0]).toMatchObject({ type: "refused", reason: "outdated" });

    const runner = fakeRunner(hub);
    await runner.hello(paired.token, { hostname: "new-host", exec: false });
    expect(runner.sent[0]).toEqual({
      type: "welcome",
      machineId: paired.machineId,
      name: "Build box",
      heartbeatMs: 25_000,
      mcpOnce: true,
      observeEgress: false,
    });
    const [row] = await f.db.select().from(schema.machines);
    expect(row).toMatchObject({
      online: true,
      connectedReplica: "replica-a",
      hostname: "new-host",
      execAllowed: false,
    });
    expect(statuses).toContainEqual({ type: "machine.status", machineId: paired.machineId, online: true });
    expect(await hub.status(paired.machineId)).toMatchObject({ online: true, execAllowed: false });

    await runner.disconnect();
    const [after] = await f.db.select().from(schema.machines);
    expect(after).toMatchObject({ online: false, connectedReplica: null });
    expect(statuses).toContainEqual({ type: "machine.status", machineId: paired.machineId, online: false });
    await expect(hub.call(paired.machineId, { op: "list", path: "", depth: 1 })).rejects.toThrow(MachineOfflineError);
  });

  test("requests, live output, cancel, errors; a second runner replaces the first; delete closes it", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    const runner = fakeRunner(hub, {
      exec(req, out) {
        if (req.command === "sleep") return "hang";
        out("stdout", "half ");
        out("stdout", "done");
        return { exitCode: 0, stdout: "half done", stderr: "" };
      },
    });
    await runner.hello(paired.token);
    const chunks: string[] = [];
    const r = await hub.call(
      paired.machineId,
      { op: "exec", command: "echo", timeoutSeconds: 5, stream: true },
      { onOutput: (_s, c) => chunks.push(c) },
    );
    expect(r).toMatchObject({ exitCode: 0, stdout: "half done" });
    expect(chunks.join("")).toBe("half done");

    const controller = new AbortController();
    const pending = hub.call(
      paired.machineId,
      { op: "exec", command: "sleep", timeoutSeconds: 60, stream: false },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ exitCode: 130, canceled: { killed: true } });
    expect(runner.sent.some((s) => s.type === "cancel")).toBe(true);

    await expect(
      hub.call(paired.machineId, { op: "push", path: "nope", url: "u", uploadId: "x", maxBytes: 1 }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      hub.call(paired.machineId, { op: "exec", command: "sleep", timeoutSeconds: 1, stream: false }, { timeoutMs: 30 }),
    ).rejects.toThrow(MachineRequestError);

    const second = fakeRunner(hub);
    await second.hello(paired.token);
    expect(runner.sent.at(-1)).toMatchObject({ type: "refused", reason: "replaced" });
    expect(runner.closed()).toMatchObject({ code: 4409 });
    // The old socket closing doesn't mark it offline: the new one holds it.
    expect((await hub.status(paired.machineId))?.online).toBe(true);

    await deleteMachine(deps(), f.owner.id, f.org.id, paired.machineId);
    await Bun.sleep(5);
    expect(second.sent.at(-1)).toMatchObject({ type: "refused", reason: "revoked" });
    expect(second.closed()).toMatchObject({ code: 4403 });
  });

  test("another replica reaches the machine through machine_rpc and pub/sub", async () => {
    f = await setup({ machines: true });
    const hubA = f.machineHub as MachineHub;
    const hubB = createMachineHub({ db: f.db, pubsub: f.pubsub, replicaId: "replica-b", rpcPollMs: 20 });
    hubs.push(hubB);
    const paired = await pair();
    const runner = fakeRunner(hubA);
    await runner.hello(paired.token);
    runner.files.set("notes.txt", new TextEncoder().encode("hi"));

    expect(await hubB.status(paired.machineId)).toMatchObject({ online: true });
    const read = await hubB.call(paired.machineId, { op: "read", path: "notes.txt", maxBytes: 100 });
    expect(Buffer.from(read.base64 ?? "", "base64").toString()).toBe("hi");
    const exec = await hubB.call(paired.machineId, { op: "exec", command: "uname", timeoutSeconds: 5, stream: true });
    expect(exec).toMatchObject({ exitCode: 0, stdout: "ran: uname" });
    await expect(hubB.call(paired.machineId, { op: "read", path: "../x", maxBytes: 1 })).resolves.toMatchObject({
      base64: null,
    });
    const rows = await f.db.select().from(schema.machineRpc);
    expect(rows.every((r) => r.status === "done" && r.orgId === f.org.id)).toBe(true);
    expect(rows).toHaveLength(3);

    await runner.disconnect();
    await expect(hubB.call(paired.machineId, { op: "list", path: "", depth: 1 })).rejects.toThrow(MachineOfflineError);
  });

  test("a row left online by a replica that died is offline once stale", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    await f.db
      .update(schema.machines)
      .set({ online: true, connectedReplica: "dead", lastSeenAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.machines.id, paired.machineId));
    expect((await hub.status(paired.machineId))?.online).toBe(false);
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.online).toBe(false);
    await expect(hub.call(paired.machineId, { op: "list", path: "", depth: 1 })).rejects.toThrow(MachineOfflineError);
  });

  test("the status says who connected the computer, and nobody for the workspace's own (its own sign-in is nobody's)", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pair();
    expect((await hub.status(paired.machineId))?.pairedByUserId).toBe(f.owner.id);
    await f.db
      .update(schema.machines)
      .set({ kind: "managed", pairedByUserId: null })
      .where(eq(schema.machines.id, paired.machineId));
    expect((await hub.status(paired.machineId))?.pairedByUserId).toBeNull();
  });
});

describe("tools on a connected machine", () => {
  const SANDBOX = [{ connectionId: null, scope: "sandbox:run" }];

  async function runCtx(): Promise<ToolContext> {
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev oi",
    });
    await drainOutbox(f.db, f.handlers);
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, msg.id));
    if (!run) throw new Error("no run");
    return {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run.id,
      channelId: f.general.id,
      threadRootId: run.threadRootId,
      triggerMessageId: msg.id,
    };
  }
  const call = async (ctx: ToolContext, name: string, input: Record<string, unknown>) => {
    const outcome = await f.tools?.invoke(ctx, { toolUseId: crypto.randomUUID(), name, input });
    if (outcome?.type !== "result") throw new Error(`expected a result, got ${outcome?.type}`);
    return outcome.output;
  };

  test("run_code, files and upload_file go to the machine; offline is explained", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    const hub = f.machineHub as MachineHub;
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const commands: string[] = [];
    const runner = fakeRunner(hub, {
      exec(req) {
        commands.push(req.command);
        return { exitCode: 0, stdout: "42\n", stderr: "" };
      },
      async push(req, bytes, name) {
        await receiveMachineUpload(
          { db: f.db, artifacts: f.artifactDeps, pubsub: f.pubsub },
          {
            uploadId: req.uploadId,
            machineId: paired.machineId,
            name,
            contentType: "application/pdf",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            body: bytes,
          },
        );
      },
    });
    await runner.hello(paired.token);
    const ctx = await runCtx();

    // Without a machine: a clear refusal.
    const none = await call(ctx, "run_code", { language: "python", code: "print(42)" });
    expect(none).toMatchObject({ isError: true });
    expect(none.content).toContain("You have no computer");

    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const listed = await f.tools?.list(ctx);
    const runCode = listed?.find((t) => t.name === "run_code");
    expect(runCode?.description).toContain('connected computer "Build box"');
    // Claude Code keeps one session per conversation, and connected computers allow an hour.
    expect(runCode?.description).toContain(`claude -p --session-id ${ctx.threadRootId}`);
    expect(runCode?.description).toContain(`claude -p --resume ${ctx.threadRootId}`);
    expect(runCode?.description).toContain("at most 3600 s");
    expect(runCode?.inputSchema).toMatchObject({ properties: { timeout_seconds: { maximum: 3600 } } });

    const out = await call(ctx, "run_code", { language: "python", code: "print(42)" });
    expect(out.isError).toBeFalsy();
    expect(out.content).toContain("exit code 0");
    expect(commands.at(-1)).toMatch(/^python3 \.agentes\/run-\d+\.py$/);
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "machine.exec"));
    expect(audit[0]?.details).toMatchObject({ command: "python: print(42)", exitCode: 0 });

    expect((await call(ctx, "write_file", { path: "out/r.pdf", content: "%PDF-1.4 fake" })).isError).toBeFalsy();
    expect((await call(ctx, "read_file", { path: "out/r.pdf" })).content).toContain("%PDF-1.4 fake");
    const up = await call(ctx, "upload_file", { path: "out/r.pdf", title: "Relatório" });
    expect(up.isError).toBeFalsy();
    expect(up.content).toContain('as "Relatório" (file');
    const [row] = await f.db.select().from(schema.artifactUploads);
    expect(row).toMatchObject({ status: "done", machineId: paired.machineId, computer: `machine:${paired.machineId}` });
    expect(runner.sent.find((s) => s.type === "request" && s.op === "push")).toMatchObject({
      url: `http://localhost:3000/api/machines/uploads/${row?.id}`,
    });
    // Every request says which agent it's for (the runner keeps each agent in its own folder) and its name (protocol 9).
    const requests = runner.sent.filter((s) => s.type === "request");
    expect(requests.length).toBeGreaterThan(3);
    for (const r of requests) expect(r.agent).toEqual({ id: f.agent.id, handle: "dev", name: "Dev" });

    const status = await call(ctx, "computer_status", {});
    expect(status.content).toContain('connected computer "Build box" (Linux), online');
    expect(status.content).not.toContain(RUNNER.workspace);
    // No tool turns a computer on or off (ADR 0077): only computer_status.
    expect(listed?.filter((t) => t.name.startsWith("computer_")).map((t) => t.name)).toEqual(["computer_status"]);

    // The workspace's own computer is always on.
    const kind = (k: "managed" | "connected") =>
      f.db.update(schema.machines).set({ kind: k }).where(eq(schema.machines.id, paired.machineId));
    await kind("managed");
    expect((await call(ctx, "computer_status", {})).content).toContain(
      `You are on "Build box", this workspace's own computer (Linux), always on: answering now.`,
    );
    const ownRunCode = (await f.tools?.list(ctx))?.find((t) => t.name === "run_code");
    expect(ownRunCode?.description).toContain(`Runs on "Build box" (Linux), this workspace's own computer, always on`);
    await kind("connected");

    await runner.disconnect();
    const offline = await call(ctx, "run_code", { language: "bash", code: "ls" });
    expect(offline).toMatchObject({ isError: true });
    expect(offline.content).toContain("The computer Build box is offline. Ask its owner to start the runner.");
    // The workspace's own computer has no runner for anyone to start: it comes back by itself.
    await kind("managed");
    const away = await call(ctx, "run_code", { language: "bash", code: "ls" });
    expect(away.content).toContain(
      "The computer Build box isn't answering right now. It usually comes back within minutes.",
    );
    expect(away.content).not.toContain("runner");
    const folder = await call(ctx, "request_folder_access", { path: "/srv/site", reason: "the site" });
    expect(folder.content).toContain("Nobody can allow folders on Build box");
    expect(folder.content).not.toContain("runner");
  });

  test("commands turned off on the machine are explained", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair(f.owner.id, "Files only", false);
    const runner = fakeRunner(f.machineHub as MachineHub, { execAllowed: false });
    await runner.hello(paired.token);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const ctx = await runCtx();
    const out = await call(ctx, "run_code", { language: "bash", code: "ls" });
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain("Commands are turned off on the computer Files only");
    // A runner that reports no access has only its start flag.
    expect(out.content).toContain("--no-exec");
    const listed = await f.tools?.list(ctx);
    expect(listed?.find((t) => t.name === "run_code")?.description).not.toContain("claude -p");
    // Files still work.
    expect((await call(ctx, "write_file", { path: "a.txt", content: "x" })).isError).toBeFalsy();
  });

  test("commands switched off in the app on a Mac point to the app, on Linux to the runner's command", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair(f.owner.id, "Ana's Mac", false);
    const runner = fakeRunner(f.machineHub as MachineHub, { execAllowed: false });
    const access = { folders: [], tools: { claude: false, codex: false, commands: false } };
    await runner.hello(paired.token, { os: "darwin", access });
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const ctx = await runCtx();
    const out = await call(ctx, "run_code", { language: "bash", code: "ls" });
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain(
      "Commands are turned off on the computer Ana's Mac: you can only read, write, list and upload files there. Tell the people: only the person at Ana's Mac can turn commands on, in the agentes.chat app there (Preferences › Tools, Commands).",
    );
    expect(out.content).not.toContain("--no-exec");
    await f.db.update(schema.machines).set({ os: "linux" }).where(eq(schema.machines.id, paired.machineId));
    const linux = await call(ctx, "run_code", { language: "bash", code: "ls" });
    expect(linux.content).toContain("can turn commands on, with `agentes-runner tools enable commands` there.");
    expect(linux.content).not.toContain("--no-exec");
  });

  test("a runner too old for agent folders is refused instead of sharing one folder", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const runner = fakeRunner(f.machineHub as MachineHub);
    await runner.hello(paired.token, { protocol: 1 });
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const ctx = await runCtx();
    const out = await call(ctx, "write_file", { path: "a.txt", content: "x" });
    expect(out).toMatchObject({ isError: true });
    expect(out.content).toContain("agentes-runner update");
    expect(runner.sent.filter((s) => s.type === "request")).toEqual([]);
  });
});

describe("secrets for a connected machine (ADR 0027)", () => {
  const SANDBOX = [{ connectionId: null, scope: "sandbox:run" }];
  const VALUE = "npm_s3cr3t_value_0123456789";

  /** An agent that asks for NPM_TOKEN when told "publica", then says what it got (`before`: ahead of the ask). */
  async function asking(
    target: ({ target?: "env" } | { target: "file"; path: string }) & { site?: string } = { target: "env" },
    runnerOptions: FakeRunnerOptions = {},
    before?: () => Promise<unknown>,
  ) {
    f = await setup({
      machines: true,
      reply: (req) => {
        const last = JSON.stringify(req.messages.at(-1)?.content);
        if (last.includes("tool_result")) return { chunks: ["Pronto."] };
        if (last.includes("publica")) {
          return {
            chunks: ["Preciso do token do npm."],
            toolUses: [
              { name: "request_secret", input: { name: "NPM_TOKEN", purpose: "publicar o pacote no npm", ...target } },
            ],
          };
        }
        return { chunks: ["ok"] };
      },
    });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const runner = fakeRunner(f.machineHub as MachineHub, runnerOptions);
    await runner.hello(paired.token);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    await before?.();
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev publica o pacote",
    });
    await drainOutbox(f.db, f.handlers);
    const [row] = await f.db.select().from(schema.secretRequests);
    if (!row) throw new Error("no secret request");
    return { paired, runner, row };
  }

  const seal = async (view: {
    id: string;
    publicKey: string | null;
    name: string;
    target: SecretRequestView["target"];
  }) =>
    sealSecret(
      view.publicKey as string,
      VALUE,
      secretAad({ requestId: view.id, orgId: f.org.id, name: view.name, target: view.target }),
    );

  test("a secret's file written in full in the agent's folder is kept as the path it is there", async () => {
    const id8 = () => f.agent.id.replace(/-/g, "").slice(0, 8);
    const { row } = await asking({
      target: "file",
      get path() {
        return `/home/ag-${id8()}/dev-${id8()}/.npmrc`;
      },
    });
    expect(row.targetPath).toBe(".npmrc");
  });

  test("the run waits on a card; only the person asked delivers; the value reaches the machine and nothing else", async () => {
    const { runner, row, paired } = await asking();
    const [run] = await f.db.select().from(schema.agentRuns);
    expect(run?.status).toBe("waiting_input");
    expect(row).toMatchObject({
      status: "pending",
      name: "NPM_TOKEN",
      requestedForUserId: f.owner.id,
      machineId: paired.machineId,
    });
    // The key was made on the machine, for this agent.
    expect(runner.sent.find((x) => x.type === "request" && x.op === "secret")).toMatchObject({
      action: "keypair",
      requestId: row.id,
      agent: { id: f.agent.id, handle: "dev" },
    });
    const [card] = await f.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, row.messageId as string));
    expect((card?.meta as { secretRequest?: SecretRequestView } | undefined)?.secretRequest).toMatchObject({
      status: "pending",
      name: "NPM_TOKEN",
      purpose: "publicar o pacote no npm",
      publicKey: row.publicKey,
    });
    // Its text is for previews and notifications, a sentence that names who asked (the card names the key).
    expect(card?.body).toBe(`${f.agent.name} asked for a key: Npm token`);
    expect((card?.meta as { bodyParams?: unknown } | undefined)?.bodyParams).toEqual({
      agent: f.agent.name,
      name: "Npm token",
    });

    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    // Someone else in the channel: the request doesn't exist for them.
    const bia = await addMember(f.db, f.org.id, "admin", "bia");
    await expect(deliverSecret(sandbox, bia.id, f.org.id, row.id, await seal(view))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A box sealed for another request doesn't open on the machine.
    const wrong = await sealSecret(row.publicKey, VALUE, "agentes-secret|v1|other|org|NPM_TOKEN|env");
    await expect(deliverSecret(sandbox, f.owner.id, f.org.id, row.id, wrong)).rejects.toThrow("couldn't be opened");

    const delivered = await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    expect(delivered).toMatchObject({ status: "delivered", publicKey: null });
    expect(runner.secrets.get("NPM_TOKEN")).toBe(VALUE);
    await expect(deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view))).rejects.toThrow(
      "already answered",
    );

    await drainOutbox(f.db, f.handlers);
    const [done] = await f.db.select().from(schema.agentRuns);
    expect(done?.status).toBe("done");
    const steps = await f.db.select().from(schema.agentRunSteps);
    const result = steps.find((x) => x.kind === "tool_result")?.data as { content: string };
    expect(result.content).toContain("NPM_TOKEN was delivered to your computer");

    // Nowhere in our database: messages, steps, transcript, audit, outbox.
    const everything = JSON.stringify([
      await f.db.select().from(schema.messages),
      steps,
      await f.db.select().from(schema.agentRuns),
      await f.db.select().from(schema.auditLog),
      await f.db.select().from(schema.outbox),
      await f.db.select().from(schema.secretRequests),
    ]);
    expect(everything).not.toContain(VALUE);
    const actions = (await f.db.select().from(schema.auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["secret.requested", "secret.delivered"]));

    // Listed by name for the owner; removed from the machine on request.
    expect(await listAgentSecrets(f.db, f.owner.id, f.org.id, f.agent.id)).toEqual([
      expect.objectContaining({ name: "NPM_TOKEN", target: { kind: "env" }, machineId: paired.machineId }),
    ]);
    await removeAgentSecret(
      f.sandboxDeps as NonNullable<typeof f.sandboxDeps>,
      f.owner.id,
      f.org.id,
      f.agent.id,
      "NPM_TOKEN",
      paired.machineId,
    );
    expect(runner.secrets.has("NPM_TOKEN")).toBe(false);
    expect(await listAgentSecrets(f.db, f.owner.id, f.org.id, f.agent.id)).toEqual([]);
  });

  test("a refused key is asked for again under the same name, by its giver or the owner, once: the card says it replaces the held one, and none of it reaches the model", async () => {
    const OLD = "tsk_old_key_value_000000000";
    const NEW = "tsk_new_key_value_111111111";
    const asks: Record<string, unknown>[] = [];
    let api: "401" | "200" = "401";
    f = await setup({
      machines: true,
      reply: (req) => {
        const last = JSON.stringify(req.messages.at(-1)?.content);
        const ask = (purpose: string) => {
          const input = { name: "TYPESAFE_API_KEY", purpose, target: "env" };
          asks.push(input);
          return { chunks: [""], toolUses: [{ name: "request_secret", input }] };
        };
        const list = () => ({
          chunks: [""],
          toolUses: [
            {
              name: "run_code",
              input: {
                language: "bash",
                code: 'curl -s -H "Authorization: Bearer $TYPESAFE_API_KEY" https://api.typesafe.example/v1/items',
              },
            },
          ],
        });
        if (last.includes("401 Unauthorized"))
          return ask("A chave TYPESAFE_API_KEY foi recusada (401). Manda uma nova?");
        // The replacement arrived: try the call again.
        if (last.includes("replacing the one you had")) return list();
        if (last.includes("tool_result")) return { chunks: ["Pronto."] };
        if (last.includes("conecta")) return ask("acessar a API do Typesafe");
        if (last.includes("lista")) return list();
        return { chunks: ["ok"] };
      },
    });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const runner = fakeRunner(f.machineHub as MachineHub, {
      // Like the real runner: the value is in the command's env, its output comes back redacted.
      exec: () =>
        api === "401"
          ? { exitCode: 22, stdout: "", stderr: "401 Unauthorized: invalid api key [secret:TYPESAFE_API_KEY]" }
          : { exitCode: 0, stdout: '{"items":[]}', stderr: "" },
    });
    await runner.hello(paired.token);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const say = async (body: string, by = f.owner.id) => {
      await postPersonMessage({ db: f.db, pubsub: f.pubsub }, by, f.org.id, f.general.id, { body });
      await drainOutbox(f.db, f.handlers);
    };
    const give = async (value: string) => {
      const [row] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.status, "pending"));
      if (!row) throw new Error("no pending secret request");
      const box = await sealSecret(
        row.publicKey,
        value,
        secretAad({ requestId: row.id, orgId: f.org.id, name: row.name, target: { kind: "env" } }),
      );
      await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, box);
      await drainOutbox(f.db, f.handlers);
      return row;
    };

    await say("@dev conecta no Typesafe");
    const first = await give(OLD);
    expect(first.replaces).toBe(false);
    // The model is told how a refused key gets replaced, in its rules and in the tool.
    const request = f.provider.calls.at(-1)?.request;
    expect(systemText(request?.system ?? "")).toContain("When a key you were given is refused");
    expect(request?.tools?.find((t) => t.name === "request_secret")?.description).toContain(
      "ask once for a new one under the same `name`",
    );
    const toolResults = async () =>
      (await f.db.select().from(schema.agentRunSteps))
        .filter((x) => x.kind === "tool_result")
        .map((x) => (x.data as { content: string }).content);

    // The key works: nothing is asked. The agent knows the key by name from then on (never its value).
    api = "200";
    await say("@dev lista os itens");
    expect(asks).toHaveLength(1);
    expect(systemText(f.provider.calls.at(-1)?.request.system ?? "")).toContain(
      "- TYPESAFE_API_KEY: an environment variable in your commands",
    );

    // Refused while a member who didn't give it asked: the owner's key isn't swapped for the member's.
    api = "401";
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    await f.db.insert(schema.channelMembers).values({ orgId: f.org.id, channelId: f.general.id, userId: bia.id });
    await say("@dev lista os itens de novo", bia.id);
    expect(asks).toHaveLength(2);
    expect(await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.status, "pending"))).toEqual(
      [],
    );
    expect(await toolResults()).toContainEqual(
      expect.stringContaining(
        `TYPESAFE_API_KEY was given by ${f.owner.name}; only ${f.owner.name}, your owner or an admin can replace it.`,
      ),
    );

    // Refused while its giver asked: the agent asks once, under the same name, saying what failed.
    await say("@dev lista os itens de novo");
    expect(asks).toHaveLength(3);
    const [again] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.status, "pending"));
    expect(again).toMatchObject({ name: "TYPESAFE_API_KEY", replaces: true });
    const [card] = await f.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, again?.messageId as string));
    expect((card?.meta as { secretRequest?: SecretRequestView } | undefined)?.secretRequest).toMatchObject({
      name: "TYPESAFE_API_KEY",
      purpose: "A chave Typesafe api key foi recusada (401). Manda uma nova?",
      replaces: true,
    });

    // The new one replaces the old on the computer; the agent hears it did and calls again.
    await give(NEW);
    expect(runner.secrets.get("TYPESAFE_API_KEY")).toBe(NEW);
    const [old] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, first.id));
    expect(old?.removedAt).not.toBeNull();
    const results = await toolResults();
    expect(
      results.some((r) => r.includes("TYPESAFE_API_KEY was delivered to your computer, replacing the one you had")),
    ).toBe(true);
    // The new one is refused too: a third ask in that run is refused, so the agent stops instead of looping.
    expect(asks).toHaveLength(4);
    expect(await f.db.select().from(schema.secretRequests)).toHaveLength(2);
    expect(results).toContainEqual(
      expect.stringContaining("The TYPESAFE_API_KEY you were just given was refused too. Don't ask for it again"),
    );

    // Neither value ever reached the model or our database.
    const everything = JSON.stringify([
      f.provider.calls.map((c) => c.request),
      await f.db.select().from(schema.messages),
      await f.db.select().from(schema.agentRunSteps),
      await f.db.select().from(schema.auditLog),
      await f.db.select().from(schema.outbox),
      await f.db.select().from(schema.secretRequests),
    ]);
    expect(everything).not.toContain(OLD);
    expect(everything).not.toContain(NEW);
  });

  test("a `path` with no `target` is a file, so what a person types lands where it was asked for", async () => {
    const { row } = await asking({ path: ".npmrc" } as never);
    expect(row).toMatchObject({ name: "NPM_TOKEN", targetKind: "file", targetPath: ".npmrc" });
  });

  test("`target` is env unless it says file; anything else is refused with the values", async () => {
    const { row } = await asking({});
    expect(row).toMatchObject({ name: "NPM_TOKEN", targetPath: null });
    const [run] = await f.db.select().from(schema.agentRuns);
    const ctx: ToolContext = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id as string,
      channelId: f.general.id,
      threadRootId: run?.threadRootId as string,
      triggerMessageId: run?.triggerMessageId as string,
    };
    const input = { name: "OTHER_TOKEN", purpose: "outro pacote", target: "my home folder" };
    const refused = await f.tools?.invoke(ctx, { toolUseId: "t1", name: "request_secret", input });
    expect(refused).toMatchObject({ type: "result", output: { isError: true } });
    expect(refused?.type === "result" ? refused.output.content : "").toContain('must be one of "env", "file"');
    expect(await f.db.select().from(schema.secretRequests)).toHaveLength(1);
  });

  test("one run asks once per key: a second ask waits on the open card, and once given it isn't asked again until tried", async () => {
    const ask = { name: "NPM_TOKEN", purpose: "publicar o pacote no npm", target: "env" };
    f = await setup({
      machines: true,
      reply: (req) => {
        const last = JSON.stringify(req.messages.at(-1)?.content);
        if (last.includes("tool_result")) return { chunks: ["Pronto."] };
        // Asked twice in one turn, as an agent did when the person wrote while it waited.
        if (last.includes("publica"))
          return {
            chunks: [""],
            toolUses: [
              { name: "request_secret", input: ask },
              { name: "request_secret", input: ask },
            ],
          };
        return { chunks: ["ok"] };
      },
    });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const runner = fakeRunner(f.machineHub as MachineHub);
    await runner.hello(paired.token);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev publica o pacote",
    });
    await drainOutbox(f.db, f.handlers);
    const requests = () => f.db.select().from(schema.secretRequests);
    const cards = async () =>
      (await f.db.select().from(schema.messages)).filter(
        (m) => (m.meta as { secretRequestId?: string }).secretRequestId,
      );
    const [row] = await requests();
    if (!row) throw new Error("no secret request");
    expect(await requests()).toHaveLength(1);
    expect(await cards()).toHaveLength(1);

    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, msg.id));
    const ctx: ToolContext = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id as string,
      channelId: f.general.id,
      threadRootId: run?.threadRootId as string,
      triggerMessageId: msg.id,
    };
    // Asked again while the card is open: the same request is waited on, no new one.
    const again = await f.tools?.invoke(ctx, { toolUseId: "t9", name: "request_secret", input: ask });
    expect(again).toEqual({ type: "secret", requestId: row.id });
    expect(await requests()).toHaveLength(1);

    const box = await sealSecret(
      row.publicKey,
      VALUE,
      secretAad({ requestId: row.id, orgId: f.org.id, name: row.name, target: { kind: "env" } }),
    );
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, box);
    await drainOutbox(f.db, f.handlers);
    const results = (await f.db.select().from(schema.agentRunSteps))
      .filter((x) => x.kind === "tool_result")
      .map((x) => (x.data as { content: string }).content);
    expect(results.filter((r) => r.includes("NPM_TOKEN was delivered to your computer"))).toHaveLength(2);

    // Given in this run and not tried yet: the agent is told it has it, and nobody is asked.
    const given = await f.tools?.invoke(ctx, { toolUseId: "t10", name: "request_secret", input: ask });
    expect(given?.type === "result" && given.output.content).toContain("NPM_TOKEN was already delivered");
    expect(await requests()).toHaveLength(1);
    expect(await cards()).toHaveLength(1);

    // Tried since (a command ran): asking again is a refused key's replacement, as before.
    await f.tools?.invoke(ctx, {
      toolUseId: "t11",
      name: "run_code",
      input: { language: "bash", code: "npm publish" },
    });
    const replaced = await f.tools?.invoke(ctx, { toolUseId: "t12", name: "request_secret", input: ask });
    expect(replaced?.type).toBe("secret");
    const pending = (await requests()).filter((r) => r.status === "pending");
    expect(pending).toMatchObject([{ name: "NPM_TOKEN", replaces: true }]);

    // An open one past its deadline (not swept yet) isn't waited on: a new request is.
    await f.db
      .update(schema.secretRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.secretRequests.id, pending[0]?.id as string));
    const late = await f.tools?.invoke(ctx, { toolUseId: "t13", name: "request_secret", input: ask });
    expect(late?.type).toBe("secret");
    expect(late?.type === "secret" && late.requestId).not.toBe(pending[0]?.id);
  });

  test("a decline during staging prevents activation and leaves no live secret", async () => {
    let stagedWhilePending = false;
    const { runner, row } = await asking(
      { target: "env" },
      {
        onSecretStaged: async (requestId) => {
          const [current] = await f.db
            .select()
            .from(schema.secretRequests)
            .where(eq(schema.secretRequests.id, requestId));
          stagedWhilePending = current?.status === "pending";
          await declineSecret({ db: f.db, pubsub: f.pubsub, sandbox: f.sandboxDeps }, f.owner.id, f.org.id, requestId);
        },
      },
    );
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    await expect(deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view))).rejects.toMatchObject({
      code: "secret.closed",
      params: { status: "declined", endReason: null },
    });
    expect(stagedWhilePending).toBe(true);
    expect(runner.secrets.has("NPM_TOKEN")).toBe(false);
    expect(runner.staged.has(row.id)).toBe(false);
    const [closed] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, row.id));
    expect(closed?.status).toBe("declined");
  });

  test("a request expiring during staging cannot commit delivery", async () => {
    const { runner, row } = await asking(
      { target: "env" },
      {
        onSecretStaged: async (requestId) => {
          await f.db
            .update(schema.secretRequests)
            .set({ expiresAt: new Date(Date.now() - 1000) })
            .where(eq(schema.secretRequests.id, requestId));
        },
      },
    );
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    await expect(deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view))).rejects.toMatchObject({
      code: "secret.closed",
      params: { status: "expired" },
    });
    const [closed] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, row.id));
    expect(closed?.status).toBe("pending");
    expect(closed?.deliveredAt).toBeNull();
    expect(runner.secrets.has(row.name)).toBe(false);
    // A pending row may reflect an uncertain concurrent commit; wait for a terminal decision.
    expect(runner.staged.has(row.id)).toBe(true);
    expect(await expireSecretRequests({ db: f.db, pubsub: f.pubsub })).toBe(1);
    await drainOutbox(f.db, f.handlers);
    expect(runner.staged.has(row.id)).toBe(false);
    expect(runner.keys.has(row.id)).toBe(false);
  }, 60_000);

  test("canceling a waiting run queues removal of its unused runner key", async () => {
    const { runner, row } = await asking();
    expect(runner.keys.has(row.id)).toBe(true);
    await cancelRun({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, row.runId);
    const [job] = await f.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.dedupeKey, `secret.discard:${row.id}`));
    expect(job?.status).toBe("pending");
    await drainOutbox(f.db, f.handlers);
    expect(runner.keys.has(row.id)).toBe(false);
  }, 60_000);

  test("identical concurrent deliveries keep the winning staged box until activation", async () => {
    const gate = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const firstStaged = gate();
    const secondStaged = gate();
    const firstCommit = gate();
    const secondCommit = gate();
    const firstActivation = gate();
    const firstActivationReply = gate();
    let stages = 0;
    let activations = 0;
    const { runner, row } = await asking(
      { target: "env" },
      {
        onSecretStaged: async () => {
          (stages++ === 0 ? firstStaged : secondStaged).release();
        },
        onSecretActivate: async () => {
          if (activations++ === 0) {
            firstActivation.release();
            await firstActivationReply.promise;
          }
        },
      },
    );
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const waitBeforeCommit = (until: Promise<void>) =>
      new Proxy(f.db, {
        get(target, property, receiver) {
          if (property === "transaction") {
            return async (callback: Parameters<typeof f.db.transaction>[0]) => {
              await until;
              return target.transaction(callback);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const box = await seal(view);
    const first = deliverSecret(
      { ...sandbox, db: waitBeforeCommit(firstCommit.promise) },
      f.owner.id,
      f.org.id,
      row.id,
      box,
    );
    await firstStaged.promise;
    const second = deliverSecret(
      { ...sandbox, db: waitBeforeCommit(secondCommit.promise) },
      f.owner.id,
      f.org.id,
      row.id,
      box,
    );
    try {
      await secondStaged.promise;
      firstCommit.release();
      await firstActivation.promise; // The first delivery committed, but the runner has not activated it.
      secondCommit.release();
      expect((await second).status).toBe("delivered");
      expect(runner.secrets.get(row.name)).toBe(VALUE);
      firstActivationReply.release();
      expect((await first).status).toBe("delivered");
      expect(runner.staged.has(row.id)).toBe(false);
      const [committed] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, row.id));
      expect(committed?.status).toBe("delivered");
    } finally {
      firstCommit.release();
      secondCommit.release();
      firstActivationReply.release();
      await Promise.allSettled([first, second]);
    }
  });

  test("a lost commit reply recovers the committed delivery instead of discarding its box", async () => {
    const { runner, row } = await asking();
    let loseReply = true;
    const uncertainDb = new Proxy(f.db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (callback: Parameters<typeof f.db.transaction>[0]) => {
            const result = await target.transaction(callback);
            if (loseReply) {
              loseReply = false;
              throw new Error("commit reply lost");
            }
            return result;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), db: uncertainDb, pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const delivered = await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    expect(delivered.status).toBe("delivered");
    expect(loseReply).toBe(false);
    expect(runner.secrets.get(row.name)).toBe(VALUE);
    expect(runner.staged.has(row.id)).toBe(false);
  });

  test("an unreadable or still-pending commit result preserves staged ciphertext for a safe retry", async () => {
    const { runner, row } = await asking();
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const box = await seal(view);
    let failed = false;
    const unreadableDb = new Proxy(f.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return async () => {
            failed = true;
            throw new Error("commit outcome unknown");
          };
        if (property === "select" && failed)
          return () => {
            throw new Error("database read unavailable");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(deliverSecret({ ...sandbox, db: unreadableDb }, f.owner.id, f.org.id, row.id, box)).rejects.toThrow(
      "commit outcome unknown",
    );
    expect(runner.staged.has(row.id)).toBe(true);
    expect(runner.keys.has(row.id)).toBe(true);

    const pendingDb = new Proxy(f.db, {
      get(target, property, receiver) {
        if (property === "transaction")
          return async () => {
            throw new Error("commit did not start");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(deliverSecret({ ...sandbox, db: pendingDb }, f.owner.id, f.org.id, row.id, box)).rejects.toThrow(
      "commit did not start",
    );
    expect(runner.staged.has(row.id)).toBe(true);
    expect(runner.keys.has(row.id)).toBe(true);

    expect((await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, box)).status).toBe("delivered");
    expect(runner.secrets.get(row.name)).toBe(VALUE);
  }, 60_000);

  test("a delivered request cannot wake its run before activation", async () => {
    const { row } = await asking();
    await f.db
      .update(schema.secretRequests)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(schema.secretRequests.id, row.id));
    await executeRun(f.jobDeps, row.runId, { finalAttempt: true });
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, row.runId));
    expect(run?.status).toBe("waiting_input");
  });

  test("a pause after staging still allows committed activation but blocks new keys", async () => {
    let pauseRunner!: ReturnType<typeof fakeRunner>;
    const { runner, row, paired } = await asking(
      { target: "env" },
      {
        onSecretStaged: async () => {
          await pauseRunner.frame({ type: "runner.state", paused: { paused: true, until: null } });
        },
      },
    );
    pauseRunner = runner;
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const delivered = await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    expect(delivered.status).toBe("delivered");
    expect(runner.secrets.has(row.name)).toBe(true);
    const hub = f.machineHub as MachineHub;
    await expect(
      hub.call(paired.machineId, {
        agent: { id: f.agent.id, handle: "dev" },
        op: "secret",
        action: "keypair",
        requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/paused/i);
    await removeAgentSecret(sandbox, f.owner.id, f.org.id, f.agent.id, row.name, row.machineId);
    expect(runner.secrets.has(row.name)).toBe(false);
  });

  test("delivery generation stays monotonic after a previous replica clock ran ahead", async () => {
    const { row } = await asking();
    const ahead = new Date(Date.now() + 60_000);
    await f.db.insert(schema.secretRequests).values({
      ...row,
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      toolUseId: "prior-clock-delivery",
      messageId: null,
      status: "delivered",
      deliveredAt: ahead,
      removedAt: new Date(),
    });
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const result = await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    expect(result.deliveredAt && new Date(result.deliveredAt).getTime()).toBeGreaterThan(ahead.getTime());
  });

  test("a delayed older activation cannot overwrite a newer secret of the same name", async () => {
    let releaseOlder!: () => void;
    let reachedOlder!: () => void;
    const holdOlder = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const olderReached = new Promise<void>((resolve) => {
      reachedOlder = resolve;
    });
    let olderId = "";
    const {
      runner,
      row: older,
      paired,
    } = await asking(
      { target: "env" },
      {
        onSecretActivate: async (id) => {
          if (id === olderId) {
            reachedOlder();
            await holdOlder;
          }
        },
      },
    );
    olderId = older.id;
    const newerId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const hub = f.machineHub as MachineHub;
    const key = (await hub.call(paired.machineId, {
      agent: { id: f.agent.id, handle: "dev" },
      op: "secret",
      action: "keypair",
      requestId: newerId,
    })) as { publicKey: string };
    await f.db.insert(schema.secretRequests).values({
      ...older,
      id: newerId,
      toolUseId: "second-secret",
      messageId: null,
      publicKey: key.publicKey,
      status: "pending",
      deliveredAt: null,
      deliveredSize: null,
      removedAt: null,
    });
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const aad = (id: string) =>
      secretAad({ requestId: id, orgId: f.org.id, name: "NPM_TOKEN", target: { kind: "env" } });
    const olderValue = "older-secret-value";
    const newerValue = "newer-secret-value";
    const olderDelivery = deliverSecret(
      sandbox,
      f.owner.id,
      f.org.id,
      older.id,
      await sealSecret(older.publicKey, olderValue, aad(older.id)),
    );
    await olderReached;
    const newerView = await deliverSecret(
      sandbox,
      f.owner.id,
      f.org.id,
      newerId,
      await sealSecret(key.publicKey, newerValue, aad(newerId)),
    );
    expect(newerView.removed).toBe(false);
    expect(runner.secrets.get("NPM_TOKEN")).toBe(newerValue);
    releaseOlder();
    const olderView = await olderDelivery;
    expect(olderView.removed).toBe(true);
    expect(runner.secrets.get("NPM_TOKEN")).toBe(newerValue);
    const [newerRow] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, newerId));
    expect(newerRow?.removedAt).toBeNull();
  });

  test("removing a delivered request before activation cancels its runner value and resumes absent", async () => {
    let release!: () => void;
    let reached!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atActivation = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let targetId = "";
    const { runner, row } = await asking(
      { target: "env" },
      {
        onSecretActivate: async (id) => {
          if (id === targetId) {
            reached();
            await hold;
          }
        },
      },
    );
    targetId = row.id;
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const delivery = deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    await atActivation;
    await removeAgentSecret(sandbox, f.owner.id, f.org.id, f.agent.id, row.name, row.machineId);
    release();
    const result = await delivery;
    expect(result.removed).toBe(true);
    expect(runner.secrets.has(row.name)).toBe(false);
    const [resume] = await f.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.dedupeKey, `agent_run.execute:${row.runId}:secret:${row.id}`));
    expect(resume).toBeDefined();
  });

  test("removal after runner activation wins before a delayed DB finalization", async () => {
    let release!: () => void;
    let reached!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const activated = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let targetId = "";
    const { runner, row } = await asking(
      { target: "env" },
      {
        onSecretActivated: async (id) => {
          if (id === targetId) {
            reached();
            await hold;
          }
        },
      },
    );
    targetId = row.id;
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    const delivery = deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    await activated;
    expect(runner.secrets.has(row.name)).toBe(true);
    await removeAgentSecret(sandbox, f.owner.id, f.org.id, f.agent.id, row.name, row.machineId);
    release();
    expect((await delivery).removed).toBe(true);
    expect(runner.secrets.has(row.name)).toBe(false);
    const [resume] = await f.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.dedupeKey, `agent_run.execute:${row.runId}:secret:${row.id}`));
    expect(resume).toBeDefined();
  });

  test("declined or expired: the run goes on without it, and the machine drops the key", async () => {
    const { runner, row } = await asking();
    await declineSecret({ db: f.db, pubsub: f.pubsub, sandbox: f.sandboxDeps }, f.owner.id, f.org.id, row.id);
    expect(runner.keys.has(row.id)).toBe(false);
    await drainOutbox(f.db, f.handlers);
    const steps = await f.db.select().from(schema.agentRunSteps);
    expect((steps.find((x) => x.kind === "tool_result")?.data as { content: string } | undefined)?.content).toContain(
      "declined",
    );

    // A second request nobody answers: closed after 15 minutes.
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev publica de novo",
    });
    await drainOutbox(f.db, f.handlers);
    expect(await expireSecretRequests({ db: f.db, pubsub: f.pubsub }, new Date(Date.now() + 16 * 60_000))).toBe(1);
    await drainOutbox(f.db, f.handlers);
    const runs = await f.db.select().from(schema.agentRuns);
    expect(runs.every((r) => r.status === "done")).toBe(true);
  });

  test("a browser password names its site: kept as the origin, shown to the person in the purpose", async () => {
    const { row } = await asking({ target: "env", site: "dashboard.stripe.com/login" });
    expect(row.site).toBe("https://dashboard.stripe.com");
    // A runner from before keeps every secret in its commands' environment: so does the request (and its card).
    expect(row.targetKind).toBe("env");
    expect(row.purpose).toBe("publicar o pacote no npm (dashboard.stripe.com)");
    expect(secretSite("https://a.example:8443/x")).toBe("https://a.example:8443");
    expect(secretSite("file:///etc/passwd")).toBeNull();
    expect(secretSite("not a site")).toBeNull();
  });

  test("a site's password is the browser's alone where the runner keeps it so: its card, its box and the agent say so", async () => {
    const SITE = "https://dashboard.stripe.com";
    const { runner, row } = await asking({ site: "dashboard.stripe.com/login" }, { sites: true });
    expect(row).toMatchObject({ targetKind: "site", site: SITE });
    const [card] = await f.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, row.messageId as string));
    const target = { kind: "site" as const, site: SITE };
    expect((card?.meta as { secretRequest?: SecretRequestView } | undefined)?.secretRequest?.target).toEqual(target);
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target };
    // Sealed to its site: a box made for a variable doesn't open.
    await expect(
      deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal({ ...view, target: { kind: "env" } })),
    ).rejects.toThrow("couldn't be opened");
    await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    expect(runner.sent.find((x) => x.type === "request" && x.op === "secret" && x.action === "deliver")).toMatchObject({
      target,
    });
    expect(runner.secrets.get("NPM_TOKEN")).toBe(VALUE);
    await drainOutbox(f.db, f.handlers);
    const steps = await f.db.select().from(schema.agentRunSteps);
    const result = (steps.find((x) => x.kind === "tool_result")?.data as { content?: string } | undefined)?.content;
    expect(result).toContain("your browser types it there (browser_type_secret");
    expect(result).toContain("It isn't in your commands' environment");
    expect(await listAgentSecrets(f.db, f.owner.id, f.org.id, f.agent.id)).toEqual([
      expect.objectContaining({ name: "NPM_TOKEN", target }),
    ]);
  });

  test("the person asked hears it where they wait, with a push, until it is answered", async () => {
    const { row } = await asking({ target: "env" }, {}, () =>
      registerPushDevice(f.db, f.owner.id, {
        token: "ExponentPushToken[secret-card-0001]",
        platform: "ios",
        locale: "en",
      }),
    );
    const notice = async () =>
      (
        await f.db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.groupKey, `secret_request:${row.id}`))
      )[0];
    const n = await notice();
    expect(n).toMatchObject({ userId: f.owner.id, kind: "secret_request", waiting: true, doneAt: null });
    expect(n?.latest).toMatchObject({
      title: "Npm token",
      text: "publicar o pacote no npm",
      expiresAt: row.expiresAt.toISOString(),
    });
    expect(n?.source).toMatchObject({ channelId: f.general.id, messageId: row.messageId, label: "general" });
    const pushes = await f.db.select().from(schema.outbox).where(eq(schema.outbox.kind, "push.send"));
    expect(pushes.map((p) => p.payload)).toContainEqual({ notificationId: n?.id });
    const latest = n?.latest as { text?: string } | undefined;
    expect(renderPush("en", { kind: "secret_request", waiting: true, actorName: "Dev", text: latest?.text })).toEqual({
      title: "Dev needs a secret from you",
      body: "publicar o pacote no npm",
    });
    expect(renderPush("pt-BR", { kind: "secret_request", waiting: true, actorName: "Dev" })).toEqual({
      title: "Dev precisa de um segredo seu",
      body: "Toque para enviar com segurança.",
    });

    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal({ ...row, target: { kind: "env" } }));
    expect((await notice())?.doneAt).not.toBeNull();

    // Declined, or nobody answered in time: out of the inbox too.
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev publica de novo",
    });
    await drainOutbox(f.db, f.handlers);
    const open = async () =>
      f.db
        .select()
        .from(schema.notifications)
        .where(and(eq(schema.notifications.kind, "secret_request"), isNull(schema.notifications.doneAt)));
    const [second] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.status, "pending"));
    expect(await open()).toHaveLength(1);
    await declineSecret({ db: f.db, pubsub: f.pubsub, sandbox: f.sandboxDeps }, f.owner.id, f.org.id, second?.id ?? "");
    expect(await open()).toHaveLength(0);
    await drainOutbox(f.db, f.handlers);
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev publica outra vez",
    });
    await drainOutbox(f.db, f.handlers);
    expect(await open()).toHaveLength(1);
    expect(await expireSecretRequests({ db: f.db, pubsub: f.pubsub }, new Date(Date.now() + 16 * 60_000))).toBe(1);
    expect(await open()).toHaveLength(0);
  });

  test("owner removes a mixed browser and command secret from its original machine after code is disabled", async () => {
    const { runner, row } = await asking({ target: "env", site: "dashboard.stripe.com/login" });
    const sandbox = { ...(f.sandboxDeps as NonNullable<typeof f.sandboxDeps>), pubsub: f.pubsub };
    const view = { id: row.id, publicKey: row.publicKey, name: row.name, target: { kind: "env" as const } };
    await deliverSecret(sandbox, f.owner.id, f.org.id, row.id, await seal(view));
    const [delivered] = await f.db.select().from(schema.secretRequests).where(eq(schema.secretRequests.id, row.id));
    if (!delivered) throw new Error("missing delivered request");
    await f.db.insert(schema.secretRequests).values({
      ...delivered,
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      toolUseId: "mixed-command-secret",
      messageId: null,
      site: null,
      deliveredAt: new Date((delivered.deliveredAt?.getTime() ?? 0) + 1),
    });
    await f.db
      .insert(schema.orgSandboxSettings)
      .values({ orgId: f.org.id, enabled: false })
      .onConflictDoUpdate({ target: schema.orgSandboxSettings.orgId, set: { enabled: false } });
    await removeAgentSecret(sandbox, f.owner.id, f.org.id, f.agent.id, row.name, row.machineId);
    expect(runner.secrets.has(row.name)).toBe(false);
    expect(await listAgentSecrets(f.db, f.owner.id, f.org.id, f.agent.id)).toEqual([]);
  });

  test("a runner older than protocol 3 is told to update", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    const paired = await pair();
    const runner = fakeRunner(f.machineHub as MachineHub);
    await runner.hello(paired.token, { protocol: 2 });
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const msg = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev oi",
    });
    await drainOutbox(f.db, f.handlers);
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, msg.id));
    const ctx: ToolContext = {
      db: f.db,
      orgId: f.org.id,
      agentId: f.agent.id,
      runId: run?.id as string,
      channelId: f.general.id,
      threadRootId: run?.threadRootId as string,
      triggerMessageId: msg.id,
    };
    const ask = { name: "NPM_TOKEN", purpose: "publicar", target: "env" };
    const old = await f.tools?.invoke(ctx, { toolUseId: "t1", name: "request_secret", input: ask });
    expect(old).toMatchObject({ type: "result", output: { isError: true } });
    expect(old?.type === "result" && old.output.content).toContain("agentes-runner update");
  });
});

test("measured egress is stored, updated, cleared and hidden while a computer is offline", async () => {
  f = await setup({ machines: true });
  const hub = f.machineHub as MachineHub;
  const paired = await pair();
  await f.db.update(schema.machines).set({ kind: "managed" }).where(eq(schema.machines.id, paired.machineId));
  const runner = fakeRunner(hub);
  await runner.hello(paired.token);
  await runner.frame({ type: "pong", at: 1, egress: { ip: "8.8.8.8", country: "US" } });
  const listed = () => listMachines(f.db, f.owner.id, f.org.id);
  expect((await listed())[0]?.egress).toEqual({ ip: "8.8.8.8", country: "US", at: expect.any(String) });
  await runner.frame({ type: "pong", at: 2, egress: { ip: "1.1.1.1" } });
  expect((await listed())[0]?.egress?.ip).toBe("1.1.1.1");
  await runner.frame({ type: "pong", at: 3, egress: { ip: null } });
  expect((await listed())[0]?.egress).toBeNull();
  await runner.frame({ type: "pong", at: 4, egress: { ip: "8.8.8.8" } });
  await runner.disconnect();
  expect((await listed())[0]?.egress).toBeNull();
});

test("the start-page language follows the responsible person and changes reach the runner", async () => {
  f = await setup({ machines: true });
  const paired = await pair();
  const agent = await createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    { name: "Ada", handle: "ada-page" },
    { model: "claude-sonnet-5-5" },
  );
  await setAgentComputerTarget(deps(), f.owner.id, f.org.id, agent.id, paired.machineId);
  const signals: unknown[] = [];
  f.pubsub.subscribe(MACHINE_CONTROL_TOPIC, (e) => signals.push(e));
  await setMyLocale(f.db, f.owner.id, "pt-BR", false, f.pubsub);
  expect((await machineAgents(f.db, f.org.id, paired.machineId)).find((a) => a.id === agent.id)?.locale).toBe("pt-BR");
  expect(signals).toContainEqual({ type: "machine.agents", orgId: f.org.id });
  await setMyLocale(f.db, f.owner.id, "en", false, f.pubsub);
  expect((await machineAgents(f.db, f.org.id, paired.machineId)).find((a) => a.id === agent.id)?.locale).toBe("en");
});

test("an agent whose brain's shell runs in its CLI's own sandbox has no containers service (ADR 0169)", async () => {
  f = await setup({ machines: true });
  const paired = await pair();
  const agent = await createAgent(
    f.db,
    f.owner.id,
    f.org.id,
    { name: "Ada", handle: "ada-ctr" },
    { model: "claude-sonnet-5-5" },
  );
  await setAgentComputerTarget(deps(), f.owner.id, f.org.id, agent.id, paired.machineId);
  const containers = async (brain: string) => {
    await f.db.update(schema.agents).set({ brain }).where(eq(schema.agents.id, agent.id));
    return (await machineAgents(f.db, f.org.id, paired.machineId)).find((a) => a.id === agent.id)?.containers;
  };
  for (const brain of ["model", "claude_code", "opencode"]) expect(await containers(brain)).toBe(true);
  for (const brain of ["codex", "cursor", "grok", "antigravity"]) expect(await containers(brain)).toBeUndefined();
});

test("personal computer IPs are neither stored nor broadcast to workspace readers", async () => {
  f = await setup({ machines: true });
  const hub = f.machineHub as MachineHub;
  const guest = await addMember(f.db, f.org.id, "member", "Guest");
  const paired = await pair();
  const runner = fakeRunner(hub);
  await runner.hello(paired.token);
  expect(runner.sent.find((frame) => frame.type === "welcome")).toMatchObject({ observeEgress: false });
  const events: unknown[] = [];
  f.pubsub.subscribe(orgTopic(f.org.id), (event) => events.push(event));
  await runner.frame({ type: "pong", at: 1, egress: { ip: "8.8.8.8", country: "US" } });
  const [stored] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
  expect(stored?.egress).toBeNull();
  expect(JSON.stringify(events)).not.toContain("8.8.8.8");
  // Hide legacy data as well: no viewer, including the pairer, receives a personal machine's address.
  await f.db
    .update(schema.machines)
    .set({ egress: { ip: "8.8.8.8", at: new Date().toISOString() } })
    .where(eq(schema.machines.id, paired.machineId));
  for (const actor of [f.owner, guest]) expect((await listMachines(f.db, actor.id, f.org.id))[0]?.egress).toBeNull();
});
