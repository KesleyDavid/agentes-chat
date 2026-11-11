import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MACHINE_PROTOCOL_VERSION, orgTopic, parseRunnerFrame, type ServerFrame } from "@agenteschat/adapters";
import { and, eq, schema } from "@agenteschat/db";
import {
  accessNotice,
  authenticateMachine,
  type Brain,
  type BrainEvent,
  claudeCodeAvailability,
  computerBrainUnavailable,
  confirmDeviceCode,
  containersText,
  createJobHandlers,
  createOrganization,
  DEVICE_MAX_PENDING_PER_IP,
  DeviceCodeLimitError,
  denyDeviceCode,
  devicesText,
  drainOutbox,
  ForbiddenError,
  formatUserCode,
  fullMachinePath,
  getDeviceCode,
  grantScopes,
  listMachines,
  listMessages,
  type MachineHub,
  MachinePausedError,
  type MachineStatus,
  machineAccessText,
  machinePause,
  NotFoundError,
  notAllowedMessage,
  pathInOwnFolder,
  pausedMessage,
  pollDeviceToken,
  postPersonMessage,
  publishMachineAgentsChanged,
  reduceMachineAccess,
  setAgentComputerTarget,
  sharedFolderText,
  sharingText,
  startDeviceCode,
  type ToolContext,
  UNAVAILABLE_CODES,
  ValidationError,
} from "../src";
import { addMember, addUser, type Fixture, setup } from "./fixtures";
import { pairMachine } from "./machine-fixtures";

/**
 * The server side of the desktop app (ADR 0036): connecting a computer with
 * a device code, the pause (protocol 9), the `agents` frame, and folders and
 * tools that live on the machine (protocol 10).
 */

let f: Fixture;
afterEach(async () => {
  await f?.machineHub?.stop();
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const deps = () => ({ db: f.db, pubsub: f.pubsub });
const PUBLIC_URL = "https://agentes.chat";
const RUNNER = {
  hostname: "mac",
  os: "darwin",
  arch: "arm64",
  version: "0.9.0",
  protocol: MACHINE_PROTOCOL_VERSION,
  workspace: "/Users/ana/agentes",
};
const COMPUTER = { name: "MacBook", ...RUNNER, exec: true };
const SANDBOX = [{ connectionId: null, scope: "sandbox:run" }];

type Request = Extract<ServerFrame, { type: "request" }>;
type Answer = { ok: true; data: unknown } | { ok: false; code: string; message: string };

/** A runner over an in-memory socket; `answer` decides each request (defaults: harmless successes). */
function fakeRunner(hub: MachineHub, answer: (req: Request) => Answer | undefined = () => undefined) {
  const sent: ServerFrame[] = [];
  const reply = (frame: unknown) => hub.message(conn, JSON.stringify(frame));
  const fallback = (req: Request): Answer => {
    switch (req.op) {
      case "exec":
        return { ok: true, data: { exitCode: 0, stdout: "ok", stderr: "", timedOut: false } };
      case "task.output":
        return { ok: true, data: { lines: [], truncated: false } };
      case "read":
        return { ok: true, data: { base64: null, size: 0 } };
      case "list":
        return { ok: true, data: { entries: [] } };
      default:
        return { ok: true, data: {} };
    }
  };
  const conn = hub.open({
    send(text: string) {
      const frame = JSON.parse(text) as ServerFrame;
      sent.push(frame);
      if (frame.type !== "request") return;
      setTimeout(() => {
        const a = answer(frame) ?? fallback(frame);
        void reply(
          a.ok
            ? { type: "result", id: frame.id, ok: true, data: a.data }
            : { type: "result", id: frame.id, ok: false, error: { code: a.code, message: a.message } },
        );
      }, 1);
    },
    close() {
      void hub.close(conn);
    },
  });
  return {
    sent,
    requests: () => sent.filter((s): s is Request => s.type === "request"),
    agentsFrames: () => sent.filter((s) => s.type === "agents") as Extract<ServerFrame, { type: "agents" }>[],
    send: (frame: Record<string, unknown>) => reply(frame),
    hello: (token: string, extra: Record<string, unknown> = {}) =>
      reply({ type: "hello", token, ...RUNNER, exec: true, ...extra }),
  };
}

const start = (ip = "203.0.113.5", now?: () => Date) =>
  startDeviceCode({ db: f.db, publicUrl: PUBLIC_URL, ...(now ? { now } : {}) }, COMPUTER, { ip });

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

const invoke = async (ctx: ToolContext, name: string, input: Record<string, unknown>) => {
  const outcome = await f.tools?.invoke(ctx, { toolUseId: crypto.randomUUID(), name, input });
  if (outcome?.type !== "result") throw new Error(`expected a result, got ${outcome?.type}`);
  return outcome.output;
};

describe("connecting a computer (device code)", () => {
  test("start → pending → slow_down → confirm → the token once → expired", async () => {
    f = await setup();
    let clock = Date.now();
    const now = () => new Date(clock);
    const s = await start("203.0.113.5", now);
    expect(s.userCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(s.verificationUrl).toBe(`${PUBLIC_URL}/conectar?code=${s.userCode}`);
    expect(s).toMatchObject({ expiresIn: 600, interval: 3 });
    expect(s.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await f.db.select().from(schema.machineDeviceCodes);
    expect(row).toMatchObject({
      deviceCodeHash: sha(s.deviceCode),
      status: "pending",
      orgId: null,
      requesterIp: "203.0.113.5",
    });
    expect(JSON.stringify(row)).not.toContain(s.deviceCode);

    const poll = () => pollDeviceToken({ ...deps(), now }, s.deviceCode);
    expect(await poll()).toEqual({ ok: false, error: "authorization_pending" });
    clock += 1000;
    expect(await poll()).toEqual({ ok: false, error: "slow_down" });
    clock += 3000;
    expect(await poll()).toEqual({ ok: false, error: "authorization_pending" });

    // The confirm page: typed loosely, shown as K7Q·4ZP.
    expect(formatUserCode("K7Q4ZP")).toBe("K7Q·4ZP");
    expect(await getDeviceCode({ ...deps(), now }, formatUserCode(s.userCode).toLowerCase())).toMatchObject({
      userCode: s.userCode,
      name: "MacBook",
      os: "darwin",
      arch: "arm64",
      hostname: "mac",
      version: "0.9.0",
      approxLocation: null,
    });

    // Someone outside the organization (with an organization of their own) can't connect it here.
    const zed = await addUser(f.db, "zed");
    await createOrganization(f.db, zed.id, { name: "Other" });
    await expect(confirmDeviceCode({ ...deps(), now }, zed.id, f.org.id, s.userCode, {})).rejects.toThrow(
      ForbiddenError,
    );

    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const view = await confirmDeviceCode({ ...deps(), now }, bia.id, f.org.id, s.userCode, { name: "Mac da Bia" });
    expect(view).toMatchObject({
      name: "Mac da Bia",
      online: false,
      protocol: MACHINE_PROTOCOL_VERSION,
      paused: null,
      access: null,
      pairedBy: { id: bia.id },
      agents: [],
      workspace: RUNNER.workspace,
      canManage: true,
    });
    // Single use.
    await expect(confirmDeviceCode({ ...deps(), now }, bia.id, f.org.id, s.userCode, {})).rejects.toThrow(
      NotFoundError,
    );

    clock += 3000;
    const token = await poll();
    if (!token.ok) throw new Error(token.error);
    expect(token).toMatchObject({ machineId: view.id, name: "Mac da Bia", org: { id: f.org.id, name: f.org.name } });
    // Who may use it as it joined (a person's computer: its owner), named for the computer to say so.
    expect(token).toMatchObject({ audience: "owner", owner: "bia" });
    expect(token.token).toMatch(/^agm_[A-Za-z0-9_-]{43}$/);
    const [machine] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, view.id));
    expect(machine).toMatchObject({
      orgId: f.org.id,
      tokenHash: sha(token.token),
      pairedByUserId: bia.id,
      protocol: MACHINE_PROTOCOL_VERSION,
      workspace: RUNNER.workspace,
      execAllowed: true,
    });
    expect((await authenticateMachine(f.db, token.token))?.id).toBe(view.id);
    // Once only.
    clock += 3000;
    expect(await poll()).toEqual({ ok: false, error: "expired_token" });
    for (const action of ["machine.connected", "machine.paired"]) {
      const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
      expect(audit).toHaveLength(1);
    }
    // A new computer gets no agents until someone points one at it.
    const [agent] = await f.db.select().from(schema.agents).where(eq(schema.agents.id, f.agent.id));
    expect(agent?.machineId).toBeNull();
  });

  test('"it wasn\'t me", expiry, and a confirmed code the computer never collected', async () => {
    f = await setup();
    const denied = await start();
    await denyDeviceCode(deps(), f.owner.id, denied.userCode);
    expect(await pollDeviceToken(deps(), denied.deviceCode)).toEqual({ ok: false, error: "access_denied" });
    await expect(getDeviceCode(deps(), denied.userCode)).rejects.toThrow(NotFoundError);
    await expect(denyDeviceCode(deps(), f.owner.id, denied.userCode)).rejects.toThrow(NotFoundError);

    const late = () => new Date(Date.now() + 11 * 60_000);
    const old = await start();
    expect(await pollDeviceToken({ ...deps(), now: late }, old.deviceCode)).toEqual({
      ok: false,
      error: "expired_token",
    });
    await expect(confirmDeviceCode({ ...deps(), now: late }, f.owner.id, f.org.id, old.userCode, {})).rejects.toThrow(
      NotFoundError,
    );
    expect(await pollDeviceToken(deps(), "not-a-code")).toEqual({ ok: false, error: "expired_token" });

    const forgotten = await start();
    const machine = await confirmDeviceCode(deps(), f.owner.id, f.org.id, forgotten.userCode, {});
    expect(await listMachines(f.db, f.owner.id, f.org.id)).toHaveLength(1);
    expect(await pollDeviceToken({ ...deps(), now: late }, forgotten.deviceCode)).toEqual({
      ok: false,
      error: "expired_token",
    });
    // Its machine could never connect: it is gone.
    const [row] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, machine.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(await listMachines(f.db, f.owner.id, f.org.id)).toEqual([]);
  });

  test("at most 10 pending codes per address; other addresses are not affected", async () => {
    f = await setup();
    const codes = [];
    for (let i = 0; i < DEVICE_MAX_PENDING_PER_IP; i++) codes.push(await start("198.51.100.9"));
    await expect(start("198.51.100.9")).rejects.toThrow(DeviceCodeLimitError);
    expect((await start("198.51.100.10")).userCode).toHaveLength(6);
    // One answered: room for another.
    await denyDeviceCode(deps(), f.owner.id, codes[0]?.userCode ?? "");
    expect((await start("198.51.100.9")).userCode).toHaveLength(6);
  });

  test("admins hear about every new computer; the person who connected it doesn't", async () => {
    f = await setup();
    const bia = await addMember(f.db, f.org.id, "admin", "bia");
    const carl = await addMember(f.db, f.org.id, "member", "carl");
    const s = await start();
    const machine = await confirmDeviceCode(deps(), carl.id, f.org.id, s.userCode, { name: "Carl's PC" });
    const rows = await f.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "machine_connected"));
    expect(rows.map((r) => r.userId).sort()).toEqual([bia.id, f.owner.id].sort());
    expect(rows[0]).toMatchObject({
      orgId: f.org.id,
      actors: [{ type: "user", id: carl.id }],
      source: { machineId: machine.id, label: "Carl's PC" },
      latest: { title: "Carl's PC", text: "mac" },
    });
  });
});

describe("pause (protocol 9)", () => {
  test("hello and runner.state store it; new work is refused (machine_paused); running work goes on", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    const events: Record<string, unknown>[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => events.push((e as { event?: Record<string, unknown> }).event ?? {}));
    const runner = fakeRunner(hub);
    const until = new Date(Date.now() + 3600_000).toISOString();
    await runner.hello(paired.token, { paused: { paused: true, until } });

    const [row] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(row).toMatchObject({ paused: true, pausedUntil: new Date(until) });
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.paused).toEqual({ until });
    expect((await hub.status(paired.machineId))?.paused).toEqual({ until, timezone: null });
    expect(events).toContainEqual(expect.objectContaining({ type: "machine.updated", paused: { until } }));

    const refused = hub.call(paired.machineId, { op: "exec", command: "ls", timeoutSeconds: 5, stream: false });
    await expect(refused).rejects.toThrow(MachinePausedError);
    await expect(
      hub.call(paired.machineId, { op: "exec", command: "ls", timeoutSeconds: 5, stream: false }),
    ).rejects.toMatchObject({ code: "machine_paused", until });
    expect(runner.requests().some((r) => r.op === "exec")).toBe(false);
    // Following work that already runs still goes through.
    expect(await hub.call(paired.machineId, { op: "task.output", taskId: crypto.randomUUID(), tail: 10 })).toEqual({
      lines: [],
      truncated: false,
    });

    await runner.send({ type: "runner.state", paused: { paused: false } });
    const [resumed] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(resumed).toMatchObject({ paused: false, pausedUntil: null });
    expect(events.at(-1)).toMatchObject({ type: "machine.updated", machineId: paired.machineId, paused: null });
    const ls = await hub.call(paired.machineId, { op: "exec", command: "ls", timeoutSeconds: 5, stream: false });
    expect(ls).toMatchObject({ exitCode: 0 });

    // Until resumed (no end), then a pause whose end passed counts as over.
    await runner.send({ type: "runner.state", paused: { paused: true } });
    await expect(hub.call(paired.machineId, { op: "list", path: "", depth: 1 })).rejects.toThrow(MachinePausedError);
    expect(machinePause({ paused: true, pausedUntil: new Date(Date.now() - 1000) })).toBeNull();
    expect(machinePause({ paused: true, pausedUntil: null })).toEqual({ until: null });
  });

  test("the message the agent relays, in the owner's time zone", () => {
    const now = new Date("2026-10-17T18:00:00Z");
    expect(pausedMessage("MacBook", "2026-10-17T19:24:00Z", "America/Sao_Paulo", now)).toContain(
      "paused the computer MacBook until 16:24.",
    );
    expect(pausedMessage("MacBook", "2026-10-17T19:24:00Z", null, now)).toContain("until 19:24 UTC.");
    expect(pausedMessage("MacBook", null)).toContain("until they resume it");
  });

  test("tools on a paused computer say so; nothing reaches the machine", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["ok"] }) });
    const hub = f.machineHub as MachineHub;
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const runner = fakeRunner(hub);
    await runner.hello(paired.token, { paused: { paused: true, until: null } });
    const ctx = await runCtx();
    const out = await invoke(ctx, "run_code", { language: "bash", code: "ls" });
    expect(out.isError).toBe(true);
    expect(out.content).toContain("The owner paused the computer MacBook");
    expect(runner.requests()).toEqual([]);
    const listed = await f.tools?.list(ctx);
    expect(listed?.find((t) => t.name === "run_code")?.description).toContain("The owner paused the computer MacBook");
  });

  test("a computer brain treats a paused computer like an offline one; with fallback on, the API answers", async () => {
    const until = new Date(Date.now() + 3600_000).toISOString();
    const status = (over: Partial<MachineStatus> = {}): MachineStatus => ({
      id: "m1",
      orgId: "org",
      name: "MacBook",
      online: true,
      execAllowed: true,
      os: "darwin",
      protocol: MACHINE_PROTOCOL_VERSION,
      executors: {
        claude: { version: "2.1.300", loggedIn: true },
        codex: { version: "codex-cli 0.170.0" },
        detectedAt: new Date().toISOString(),
      },
      paused: { until, timezone: null },
      ...over,
    });
    expect(UNAVAILABLE_CODES.has("machine_paused")).toBe(true);
    expect(claudeCodeAvailability(status())).toMatchObject({ type: "error", code: "machine_paused", retryable: true });
    const paused = { code: "machine_paused", resetsAt: until };
    expect(computerBrainUnavailable("claude_code", "m1", status())).toMatchObject(paused);
    expect(computerBrainUnavailable("codex", "m1", status())).toMatchObject(paused);
    expect(computerBrainUnavailable("claude_code", "m1", status({ paused: null }))).toBeNull();

    f = await setup({ reply: () => ({ chunks: ["Respondi pela API."] }) });
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    await f.db
      .update(schema.agents)
      .set({ machineId: paired.machineId, brain: "claude_code" })
      .where(eq(schema.agents.id, f.agent.id));
    const seen: unknown[] = [];
    const brain: Brain = {
      kind: "claude_code",
      async *run(turn): AsyncIterable<BrainEvent> {
        seen.push(turn.runId);
        yield { type: "done", text: "from the computer" };
      },
    };
    const handlers = createJobHandlers({
      ...f.jobDeps,
      brains: { claude_code: () => brain },
      machines: { status: async (id) => status({ id, orgId: f.org.id }) },
    });
    await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev oi",
    });
    await drainOutbox(f.db, handlers);
    expect(seen).toEqual([]);
    const timeline = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    expect(timeline.at(-1)?.body).toBe("Respondi pela API.");
    expect(timeline.at(-1)?.meta.brainFallback).toMatchObject({ from: "claude_code", code: "machine_paused" });

    // Fallback off: the agent says the computer is paused and waits (until the pause ends, or it resumes).
    await f.db.update(schema.agents).set({ brainFallback: false }).where(eq(schema.agents.id, f.agent.id));
    const again = await postPersonMessage({ db: f.db, pubsub: f.pubsub }, f.owner.id, f.org.id, f.general.id, {
      body: "@dev e agora?",
    });
    await drainOutbox(f.db, handlers);
    const [run] = await f.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, again.id));
    expect(run).toMatchObject({ status: "waiting_input", waitingMachineId: paired.machineId });
    const waiting = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    expect(waiting.at(-1)?.meta).toMatchObject({ brainUnavailable: { code: "machine_paused", resetsAt: until } });
    expect(waiting.at(-1)?.body).toContain("paused");
  });
});

describe("the agents frame (protocol 9)", () => {
  test("sent after welcome and again when an agent is pointed at or away, renamed or re-styled", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    await f.db
      .update(schema.agents)
      .set({ appearance: { color: "rose", eyes: "happy", accessory: "crown" } })
      .where(eq(schema.agents.id, f.agent.id));
    const runner = fakeRunner(hub);
    await runner.hello(paired.token);
    expect(runner.sent[0]).toMatchObject({ type: "welcome" });
    expect(runner.sent[1]).toEqual({ type: "agents", agents: [] });

    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    await Bun.sleep(20);
    expect(runner.agentsFrames().at(-1)).toEqual({
      type: "agents",
      agents: [
        {
          id: f.agent.id,
          handle: "dev",
          name: "Dev",
          locale: "pt-BR",
          look: { color: "rose", eyes: "happy", accessory: "crown" },
          // On a model, its shell has no sandbox of its own: its containers service may run (ADR 0169).
          containers: true,
        },
      ],
    });

    await f.db.update(schema.agents).set({ name: "Devin" }).where(eq(schema.agents.id, f.agent.id));
    await publishMachineAgentsChanged(f.pubsub, f.org.id);
    await Bun.sleep(20);
    expect(runner.agentsFrames().at(-1)?.agents[0]?.name).toBe("Devin");

    // Another organization's change sends nothing here.
    const count = runner.agentsFrames().length;
    await publishMachineAgentsChanged(f.pubsub, crypto.randomUUID());
    await Bun.sleep(20);
    expect(runner.agentsFrames()).toHaveLength(count);

    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, null);
    await Bun.sleep(20);
    expect(runner.agentsFrames().at(-1)).toEqual({ type: "agents", agents: [] });

    // A runner older than protocol 9 gets no agents frame.
    const old = fakeRunner(hub);
    await old.hello(paired.token, { protocol: 8 });
    expect(old.agentsFrames()).toEqual([]);
  });
});

describe("folders and tools on the machine (protocol 10)", () => {
  const ACCESS = {
    folders: [{ path: "/Users/bia/Projects", agents: [] as string[] }],
    tools: { claude: true, codex: false, commands: false },
  };

  test("hello.access and access.changed are stored; only admins and the pairer see them", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const carl = await addMember(f.db, f.org.id, "member", "carl");
    const paired = await pairMachine(deps(), bia.id, f.org.id, COMPUTER);
    const events: Record<string, unknown>[] = [];
    f.pubsub.subscribe(orgTopic(f.org.id), (e) => events.push((e as { event?: Record<string, unknown> }).event ?? {}));
    const runner = fakeRunner(hub);
    const access = { ...ACCESS, folders: [{ path: "/Users/bia/Projects", agents: [f.agent.id] }] };
    await runner.hello(paired.token, { access });
    const [row] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(row?.access).toEqual(access);
    expect((await listMachines(f.db, bia.id, f.org.id))[0]?.access).toEqual(access);
    expect((await listMachines(f.db, f.owner.id, f.org.id))[0]?.access).toEqual(access);
    expect((await listMachines(f.db, carl.id, f.org.id))[0]?.access).toBeNull();

    const changed = { folders: [], tools: { claude: true, codex: true, commands: true } };
    await runner.send({ type: "access.changed", access: changed });
    const [after] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(after?.access).toEqual(changed);
    // Members are told something changed, never what.
    expect(events.at(-1)).toEqual({ type: "machine.updated", machineId: paired.machineId, access: true });
    // A malformed report changes nothing.
    await runner.send({ type: "access.changed", access: { folders: "nope" } });
    const [same] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(same?.access).toEqual(changed);
  });

  test("reduce asks the machine to remove or turn off and keeps its answer; admins or the pairer only", async () => {
    f = await setup({ machines: true });
    const hub = f.machineHub as MachineHub;
    const bia = await addMember(f.db, f.org.id, "member", "bia");
    const carl = await addMember(f.db, f.org.id, "member", "carl");
    const paired = await pairMachine(deps(), bia.id, f.org.id, COMPUTER);
    const current = structuredClone(ACCESS);
    const runner = fakeRunner(hub, (req) => {
      if (req.op !== "access.reduce") return undefined;
      if (req.removeFolder) current.folders = current.folders.filter((x) => x.path !== req.removeFolder?.path);
      if (req.disableTool) current.tools = { ...current.tools, [req.disableTool]: false };
      return { ok: true, data: { access: current } };
    });
    await runner.hello(paired.token, { access: ACCESS });
    const reduceDeps = { ...deps(), hub };

    await expect(
      reduceMachineAccess(reduceDeps, carl.id, f.org.id, paired.machineId, { disableTool: "claude" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(reduceMachineAccess(reduceDeps, bia.id, f.org.id, paired.machineId, {})).rejects.toThrow(
      ValidationError,
    );
    const next = await reduceMachineAccess(reduceDeps, bia.id, f.org.id, paired.machineId, {
      removeFolder: { path: "/Users/bia/Projects" },
    });
    expect(next.folders).toEqual([]);
    const off = await reduceMachineAccess(reduceDeps, f.owner.id, f.org.id, paired.machineId, {
      disableTool: "claude",
    });
    expect(off.tools.claude).toBe(false);
    const [row] = await f.db.select().from(schema.machines).where(eq(schema.machines.id, paired.machineId));
    expect(row?.access).toEqual(current);
    // Only reductions ever go out.
    for (const r of runner.requests().filter((x) => x.op === "access.reduce")) {
      expect(Object.keys(r).every((k) => ["type", "id", "op", "removeFolder", "disableTool"].includes(k))).toBe(true);
    }
    const audit = await f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "machine.access_reduced"));
    expect(audit).toHaveLength(2);

    // A runner without access on the machine (protocol 9) can't be reduced from here.
    await f.db.update(schema.machines).set({ protocol: 9 }).where(eq(schema.machines.id, paired.machineId));
    await expect(
      reduceMachineAccess(reduceDeps, bia.id, f.org.id, paired.machineId, { disableTool: "codex" }),
    ).rejects.toMatchObject({ code: "machine.access_outdated" });
  });

  test("request_folder_access: granted at once, or pending; the decision wakes the agent where it was asked", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["Ok"] }) });
    const hub = f.machineHub as MachineHub;
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const runner = fakeRunner(hub, (req) => {
      if (req.op === "access.request") {
        const status = req.path === "/Users/ana/Projects" ? "granted" : "pending";
        return { ok: true, data: { requestId: req.requestId, status } };
      }
      if (req.op === "read") return { ok: false, code: "not_allowed", message: "Not allowed" };
      return undefined;
    });
    await runner.hello(paired.token, {
      access: { folders: [{ path: "/Users/ana/Projects", agents: [f.agent.id] }], tools: ACCESS.tools },
    });
    const ctx = await runCtx();
    const listed = await f.tools?.list(ctx);
    expect(listed?.some((t) => t.name === "request_folder_access")).toBe(true);
    expect(listed?.find((t) => t.name === "run_code")?.description).toContain("/Users/ana/Projects");

    const granted = await invoke(ctx, "request_folder_access", { path: "/Users/ana/Projects", reason: "o site" });
    expect(granted.content).toContain("already allowed");
    const pending = await invoke(ctx, "request_folder_access", {
      path: "/Users/ana/Documents",
      reason: "ler os contratos",
    });
    expect(pending.isError).toBeFalsy();
    expect(pending.content).toContain("You will be woken in this conversation");
    const rows = await f.db.select().from(schema.machineAccessRequests);
    const asked = rows.find((r) => r.path === "/Users/ana/Documents");
    expect(rows.find((r) => r.path === "/Users/ana/Projects")).toMatchObject({ status: "granted" });
    expect(asked).toMatchObject({
      orgId: f.org.id,
      agentId: f.agent.id,
      machineId: paired.machineId,
      channelId: f.general.id,
      threadRootId: null, // asked in the channel: the notes land there
      runId: ctx.runId,
      requestedByUserId: f.owner.id,
      status: "pending",
      reason: "ler os contratos",
    });
    const sentRequest = runner.requests().find((r) => r.op === "access.request" && r.path === "/Users/ana/Documents");
    expect(sentRequest).toMatchObject({
      requestId: asked?.id,
      reason: "ler os contratos",
      agent: { id: f.agent.id, handle: "dev", name: "Dev" },
    });
    expect((await invoke(ctx, "request_folder_access", { path: "Documents", reason: "x" })).isError).toBe(true);

    // A request the runner refuses explains how to ask.
    const read = await invoke(ctx, "read_file", { path: "/Users/ana/Desktop/x.txt" });
    expect(read.isError).toBe(true);
    expect(read.content).toContain("request_folder_access");

    // Another machine can't answer for this one.
    const other = await pairMachine(deps(), f.owner.id, f.org.id, { ...COMPUTER, name: "Other" });
    const intruder = fakeRunner(hub);
    await intruder.hello(other.token);
    await intruder.send({ type: "access.decided", requestId: asked?.id, decision: "granted", scope: "all" });
    const [still] = await f.db
      .select()
      .from(schema.machineAccessRequests)
      .where(eq(schema.machineAccessRequests.id, asked?.id ?? ""));
    expect(still?.status).toBe("pending");

    const runsBefore = (await f.db.select().from(schema.agentRuns)).length;
    await runner.send({ type: "access.decided", requestId: asked?.id, decision: "granted", scope: "agent" });
    await runner.send({ type: "access.decided", requestId: asked?.id, decision: "denied" });
    const [decided] = await f.db
      .select()
      .from(schema.machineAccessRequests)
      .where(eq(schema.machineAccessRequests.id, asked?.id ?? ""));
    expect(decided).toMatchObject({ status: "granted", scope: "agent" });
    const jobs = await f.db
      .select()
      .from(schema.outbox)
      .where(and(eq(schema.outbox.kind, "machine.access_decided"), eq(schema.outbox.orgId, f.org.id)));
    expect(jobs).toHaveLength(1);
    await drainOutbox(f.db, f.handlers);
    const timeline = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    const requested = timeline.find((m) => m.meta.bodyCode === "machine_access_requested");
    expect(requested).toMatchObject({
      author: { type: "agent", id: f.agent.id },
      meta: {
        bodyParams: {
          path: "/Users/ana/Documents",
          computer: "MacBook",
          command: "agentes-runner folders allow /Users/ana/Documents --agent dev",
        },
        machineAccess: { requestId: asked?.id, decision: "pending" },
      },
    });
    const note = timeline.find((m) => m.meta.bodyCode === "machine_access_granted");
    expect(note).toMatchObject({
      author: { type: "agent", id: f.agent.id },
      body: "The owner allowed /Users/ana/Documents on MacBook.",
      meta: {
        bodyCode: "machine_access_granted",
        bodyParams: { path: "/Users/ana/Documents", computer: "MacBook" },
        machineAccess: { requestId: asked?.id, decision: "granted", scope: "agent" },
      },
    });
    // The agent woke on it.
    const runsAfter = await f.db.select().from(schema.agentRuns);
    expect(runsAfter.length).toBe(runsBefore + 1);
    expect(runsAfter.some((r) => r.triggerMessageId === note?.id)).toBe(true);

    // Expired: a note too.
    await invoke(ctx, "request_folder_access", { path: "/Users/ana/Music", reason: "playlist" });
    const [music] = await f.db
      .select()
      .from(schema.machineAccessRequests)
      .where(eq(schema.machineAccessRequests.path, "/Users/ana/Music"));
    await runner.send({ type: "access.decided", requestId: music?.id, decision: "expired" });
    await drainOutbox(f.db, f.handlers);
    const later = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    expect(later.some((m) => m.meta.bodyCode === "machine_access_expired")).toBe(true);
  });

  test("the workspace's own computer: nobody to ask, and every refusal says what the agent can do", async () => {
    f = await setup({ machines: true, reply: () => ({ chunks: ["Ok"] }) });
    const hub = f.machineHub as MachineHub;
    const paired = await pairMachine(deps(), f.owner.id, f.org.id, COMPUTER);
    await f.db.update(schema.machines).set({ kind: "managed" }).where(eq(schema.machines.id, paired.machineId));
    await grantScopes(f.db, f.org.id, f.agent.id, SANDBOX);
    await setAgentComputerTarget(deps(), f.owner.id, f.org.id, f.agent.id, paired.machineId);
    const answers: Record<string, { ok: false; code: string; message: string }> = {
      "/etc/hosts": {
        ok: false,
        code: "not_allowed",
        message:
          "/etc/hosts is outside your folder and outside every folder allowed for you on this computer (ask for it with request_folder_access)",
      },
      "/home/ag-x/.ssh/id_rsa": { ok: false, code: "outside_workspace", message: "/home/ag-x/.ssh/id_rsa is hidden." },
      "/home/ag-x/clips/take.mp4": {
        ok: false,
        code: "not_found",
        message: "/home/ag-x/clips/take.mp4 doesn't exist. Your folder has clips/take.mp4: use that path.",
      },
      "big.mp4": { ok: false, code: "too_large", message: "The file has 90000000 bytes (max 52428800)" },
      "gone.mp4": { ok: false, code: "upload_failed", message: "The upload failed: socket closed" },
    };
    const runner = fakeRunner(hub, (req) =>
      req.op === "read" || req.op === "push" ? answers[String(req.path)] : undefined,
    );
    await runner.hello(paired.token, { access: { folders: [], tools: ACCESS.tools } });
    const ctx = await runCtx();

    const tools = await f.tools?.list(ctx);
    expect(tools?.find((t) => t.name === "run_code")?.description).not.toContain("request_folder_access");
    expect(tools?.find((t) => t.name === "request_folder_access")?.description).toContain("Nobody can allow folders");

    const asked = await invoke(ctx, "request_folder_access", { path: "/srv/site", reason: "the site" });
    expect(asked.isError).toBeFalsy();
    expect(asked.content).toBe(
      `Nobody can allow folders on ${COMPUTER.name}, the workspace's own computer: work in your folder, read from your home, or copy what you need into your folder with a command.`,
    );
    expect(runner.requests().filter((r) => r.op === "access.request")).toEqual([]);
    expect(await f.db.select().from(schema.machineAccessRequests)).toEqual([]);
    const notes = await listMessages(f.db, f.owner.id, f.org.id, f.general.id);
    expect(notes.some((m) => m.meta.bodyCode === "machine_access_requested")).toBe(false);

    // An older runner's words point at the request: gone here, with what the agent can do instead.
    const refused = await invoke(ctx, "read_file", { path: "/etc/hosts" });
    expect(refused.content).not.toContain("request_folder_access");
    expect(refused.content).toContain("Nobody can allow folders");
    const hidden = await invoke(ctx, "read_file", { path: "/home/ag-x/.ssh/id_rsa" });
    expect(hidden.content).toBe("Failed: /home/ag-x/.ssh/id_rsa is hidden.");
    const elsewhere = await invoke(ctx, "read_file", { path: "/home/ag-x/clips/take.mp4" });
    expect(elsewhere.content).toContain("Your folder has clips/take.mp4: use that path.");

    const big = await invoke(ctx, "upload_file", { path: "big.mp4" });
    expect(big.isError).toBe(true);
    expect(big.content).toContain("big.mp4 is over the 50 MB the Drive takes per file");
    expect(big.content).toContain("in parts under 50 MB");
    expect(big.content).not.toContain("use upload_file");
    const gone = await invoke(ctx, "upload_file", { path: "gone.mp4" });
    expect(gone.content).toBe("Failed: gone.mp4 didn't reach the Drive. The upload failed: socket closed");
  });

  test("a secret's file is held back however its path is written", () => {
    const id = "0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000";
    expect(pathInOwnFolder("/home/ag-0193aaaa/dev-0193aaaa/.env", id)).toBe(".env");
    expect(pathInOwnFolder("~/dev-0193aaaa/./keys/a.pem", id)).toBe("keys/a.pem");
    expect(pathInOwnFolder("/home/ag-0193aaaa/dev-0193aaaa", id)).toBe("");
    expect(pathInOwnFolder("keys/a.pem", id)).toBe("keys/a.pem");
    expect(pathInOwnFolder("/srv/site/.env", id)).toBe("/srv/site/.env");
    // The home is named like the folder, and its files are not the folder's.
    expect(pathInOwnFolder("/home/ag-0193aaaa/notes.txt", id)).toBe("/home/ag-0193aaaa/notes.txt");
    expect(pathInOwnFolder("/home/ag-0193aaaa/ag-0193aaaa/notes.txt", id)).toBe("notes.txt");
  });

  test("a path written in full goes to the runner; /workspace and anything relative don't", () => {
    expect(fullMachinePath(" /home/ag-x/a.png ")).toBe("/home/ag-x/a.png");
    expect(fullMachinePath("~/a.png")).toBe("~/a.png");
    expect(fullMachinePath("/workspace/a.png")).toBeNull();
    expect(fullMachinePath("a.png")).toBeNull();
    expect(() => fullMachinePath("/home/ag-x/../ag-y/a.png")).toThrow("invalid path");
  });

  test("the workspace's own computer: a folder refusal with no path at hand still says what the agent can do", () => {
    const detail = "/srv is outside your folder (ask for it with request_folder_access)";
    expect(notAllowedMessage("Box", detail, undefined, true)).toBe(
      "/srv is outside your folder. Nobody can allow folders on Box, the workspace's own computer: work in your folder, read from your home, or copy what you need into your folder with a command.",
    );
    expect(notAllowedMessage("Box", "Grok is turned off", "/srv", true)).toBe("Grok is turned off. Tell the people.");
  });

  test("a person's computer used as a device: folders and tools are that person's to allow, never request_folder_access", () => {
    const detail = "/Users/sam/Projects is outside your folder (ask for it with request_folder_access)";
    const mac = { os: "darwin", executors: {} };
    expect(notAllowedMessage("Sam's Mac", detail, "/Users/sam/Projects", false, mac)).toBe(
      "/Users/sam/Projects is outside your folder. Only the person at Sam's Mac can allow /Users/sam/Projects, in the agentes.chat app there (Preferences › Folders): tell them, or work inside your own folder.",
    );
    expect(notAllowedMessage("Box", detail, "/srv", false, { os: "linux", executors: {} })).toContain(
      "with `agentes-runner folders allow /srv` there",
    );
    expect(notAllowedMessage("Sam's Mac", "Cursor is turned off on this computer", undefined, false, mac)).toBe(
      "Cursor is turned off on this computer. On Sam's Mac, only the person at it can allow folders or turn tools on: tell them.",
    );
  });

  test("a person's Mac among the devices: a screenshot is screencapture through commands, Screen Recording in the app", () => {
    const phones: { name: string; platform: string }[] = [];
    const mac = devicesText({ computers: [{ name: "Sam's Mac", os: "darwin" }], phones });
    expect(mac).toContain("`screencapture -x screen.png`");
    expect(mac).toContain("Screen Recording in the agentes.chat app there (Preferences › General › Permissions)");
    // macOS refuses a protected folder with EPERM: a shell says "Operation not permitted", the runner's file tools
    // "Permission denied".
    expect(mac).toContain('refused with "Operation not permitted" or "Permission denied" needs Full Disk Access');
    expect(devicesText({ computers: [{ name: "Box", os: "linux" }], phones })).not.toContain("screencapture");
  });

  test("what the agent reads: its folders, the tools that are off, and the outcome of a request", () => {
    const text = machineAccessText({
      name: "MacBook",
      folders: ["/Users/ana/Projects"],
      tools: { claude: true, codex: false, commands: false },
    });
    expect(text).toContain('# Your folders on the computer "MacBook"');
    expect(text).toContain("- /Users/ana/Projects");
    expect(text).toContain("Turned off on that computer: shell commands, Codex.");
    expect(text).toContain("request_folder_access");
    const own = { name: "Nuvem", managed: true, folders: [] };
    const cloud = machineAccessText({ ...own, tools: { claude: true, codex: true, commands: true } });
    expect(cloud).toContain("read and upload from your home");
    expect(cloud).not.toContain("request_folder_access");
    expect(cloud.length).toBeLessThan(
      machineAccessText({ ...own, managed: false, tools: { claude: true, codex: true, commands: true } }).length,
    );
    const noCommands = machineAccessText({ ...own, tools: { claude: true, codex: true, commands: false } });
    expect(noCommands).not.toContain("your home");
    const note = {
      body: "The owner allowed /x on MacBook.",
      meta: { machineAccess: { decision: "granted", path: "/x" } },
    };
    expect(accessNotice(note, true)).toContain("Use /x now");
    expect(accessNotice({ body: "hi", meta: {} })).toBeNull();
  });

  test("the shared folder's block: look there first, share there, tools in bin, no credentials (ADR 0115)", () => {
    const system = sharedFolderText("Build box", { dir: "/srv/agentes/shared", system: true });
    expect(system).toStartWith('# Shared folder on "Build box"\n/srv/agentes/shared is shared by every agent');
    expect(system).toContain("~/shared");
    expect(system).toContain("look there first");
    // Every agent can write the shared bin/: a tool there is read first and run by its full path, never by name.
    expect(system).toContain("/srv/agentes/shared/bin is not on your PATH");
    expect(system).toContain("read it first, then run it by its full path, like /srv/agentes/shared/bin/<tool>");
    expect(system).not.toContain("on your PATH there");
    // A plain cp keeps the source's mode, which the default ACL then caps the group to: the others couldn't write.
    expect(system).toContain("cp -r --no-preserve=mode");
    expect(system).toContain("mv or a plain cp keeps it private or read-only to the others");
    expect(system).toContain("chgrp -R --reference=/srv/agentes/shared");
    // A runner's clone borrows from a cache only its agent reads; another agent's repository is "dubious" to git.
    expect(system).toContain("git repack -a -d && rm -f .git/objects/info/alternates");
    expect(system).toContain("git -c safe.directory=<its path>");
    expect(system).toContain("flock /srv/agentes/shared/.lock");
    expect(system).toContain("Never put credentials there");
    expect(system).toContain("df -h");
    // One person's own computer: every agent is the same user, so no group, no ~/shared, no PATH.
    const single = sharedFolderText("MacBook", { dir: "/Users/ana/agentes/shared", system: false });
    expect(single).not.toContain("~/shared");
    expect(single).not.toContain("chgrp");
    expect(single).not.toContain("safe.directory");
    expect(single).not.toContain("PATH");
    expect(single).toContain("/Users/ana/agentes/shared/bin");
    // A Mac has no flock, Windows neither flock nor df: a lock and a space check they can do.
    expect(single).not.toContain("flock");
    expect(single).toContain("/Users/ana/agentes/shared/<name>.lock folder made with mkdir");
    expect(single).toContain("df -h");
    const windows = sharedFolderText("PC", { dir: "C:\\agentes\\shared", system: false, os: "windows" });
    expect(windows).not.toContain("flock");
    expect(windows).not.toContain("df -h");
    expect(windows).toContain("Check the disk's free space");
    expect(sharedFolderText("Box", { dir: "/home/me/agentes/shared", system: false, os: "linux" })).toContain(
      "flock /home/me/agentes/shared/.lock",
    );
  });

  test("the containers block: Docker's commands, the agent's own containers, ports above 1024 (ADR 0169)", () => {
    const text = containersText("Build box");
    expect(text).toStartWith('# Containers on "Build box"\ndocker, docker compose and podman work there');
    expect(text).toContain("never another agent's containers or files");
    expect(text).toContain("-p 8080:80");
    expect(text).toContain("restart: always come back");
  });

  test("the sharing block: the agents share the computer, look before something heavy, tell the person (ADR 0057)", () => {
    const text = sharingText("Build box", { cpus: 4, memoryGb: 8 });
    // Most of the memory, not all: the agents together stop where the computer keeps the rest for itself.
    expect(text).toStartWith(
      '# Sharing "Build box"\nAll the agents on "Build box" share its 4 CPUs and most of its 8 GB of memory',
    );
    expect(text).toContain("run agentes-runner computer");
    expect(text).toContain("tell the person which agent is using the computer");
    expect(text).toContain('exit code 137, "Killed"');
    // A finished build's daemons hold their memory for hours unless stopped.
    expect(text).toContain("./gradlew --stop");
    // A size the runner never reported: no numbers.
    expect(sharingText("Build box", null)).toContain("share its CPUs and memory, with no part");
  });

  test("the runner's new frames are parsed and cut", () => {
    const state = parseRunnerFrame(JSON.stringify({ type: "runner.state", paused: { paused: true, until: "nope" } }));
    expect(state).toEqual({ type: "runner.state", paused: { paused: true, until: null } });
    expect(parseRunnerFrame(JSON.stringify({ type: "access.decided", requestId: "r1", decision: "maybe" }))).toBeNull();
    expect(
      parseRunnerFrame(JSON.stringify({ type: "access.decided", requestId: "r1", decision: "granted", scope: "all" })),
    ).toEqual({ type: "access.decided", requestId: "r1", decision: "granted", scope: "all" });
    const hello = parseRunnerFrame(
      JSON.stringify({
        type: "hello",
        token: "agm_x",
        version: "1",
        protocol: 10,
        paused: { paused: false },
        access: { folders: [{ path: "/a", agents: ["x", 3] }], tools: { claude: true } },
      }),
    );
    expect(hello).toMatchObject({
      paused: { paused: false },
      access: { folders: [{ path: "/a", agents: ["x"] }], tools: { claude: true, codex: false, commands: false } },
    });
  });
});
