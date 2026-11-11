import { setTimeout as sleep } from "node:timers/promises";
import {
  ACCOUNTS_PROTOCOL,
  BROWSER_PROTOCOL,
  type BrowserHandoffInfo,
  brainTopic,
  CLAUDE_SHARED_PROTOCOL,
  type ErrorReporter,
  HEARTBEAT_MS,
  HELLO_TIMEOUT_MS,
  type MachineErrorCode,
  type MachineOp,
  type MachineReplies,
  type MachineRequest,
  type McpToolInfo,
  MIN_RUNNER_PROTOCOL,
  machineRpcReplyTopic,
  machineRpcTopic,
  PAUSE_PROTOCOL,
  PHONE_PAIRING_PROTOCOL,
  PHONES_PROTOCOL,
  type PubSub,
  parseRunnerFrame,
  type RunnerAccess,
  type RunnerFrame,
  type RunnerPause,
  type RunnerPhone,
  type ServerFrame,
  TASKS_PROTOCOL,
  type Unsubscribe,
} from "@agenteschat/adapters";
import { and, type Database, eq, inArray, lt, schema } from "@agenteschat/db";
import { getAgentCached } from "./agents";
import { type MachinePhoneRow, publishDevicesChanged, syncMachinePhones } from "./devices";
import { cutText } from "./format";
import {
  applyAccessDecided,
  storedExecutors,
  storeMachineAccess,
  storeMachineExecutors,
  storeMachineToolchains,
} from "./machine-access";
import {
  accountsToRemove,
  forgetRemovedAccount,
  type MachineAccountRef,
  storeOwnUsage,
  syncMachineAccounts,
} from "./machine-accounts";
import { onManagedMachineHello, type ReadyEmailDeps } from "./machine-provisioning";
import {
  applyTaskDone,
  applyTaskEvent,
  getTask,
  type LocalTaskStarter,
  reconcileMachineTasks,
  settleInterruptedTask,
  startMachineTask,
  TASK_OFFLINE_GRACE_MS,
  type TaskCall,
} from "./machine-tasks";
import { type WakeWhy, wantMachine } from "./machine-wake";
import {
  assertNotPaused,
  authenticateMachine,
  deletedAgentIds,
  getMachineById,
  inStandby,
  MACHINE_CONTROL_TOPIC,
  MachineDroppedError,
  MachineOfflineError,
  type MachineRow,
  machineAgents,
  machineOnline,
  machineOwnerTimezone,
  machinePause,
  publishMachineStatus,
  publishMachineUpdated,
} from "./machines";
import {
  DISK_REARM_USE,
  DISK_WARN_USE,
  notifyComputerDiskFull,
  notifyComputerNoChrome,
} from "./notification-producers";
import { enqueue } from "./outbox";
import { assertCanWork, standingRefusal } from "./standing";

const { machines, machineRpc, machineMcpCalls } = schema;

/**
 * The live side of connected computers (ADR 0025): one WebSocket per machine,
 * held by whichever replica the runner reached. Socket-agnostic (the server
 * adapts Bun's WebSocket to `MachineSocket`; tests use an in-memory one).
 *
 * - `hello` → token checked → `welcome`; the row gets `online`, this
 *   replica's id and the runner's info. A second socket for the same machine
 *   replaces the first (`refused: replaced`).
 * - `ping` every heartbeat; `last_seen_at` is written at most every
 *   40 s on `pong`, so a row is never stale while its socket lives.
 * - `call` sends a `request` and resolves on its `result`, forwarding
 *   `output`; aborting sends `cancel`. A machine held by another replica is
 *   reached through a `machine_rpc` row plus a pub/sub signal both ways.
 * - Brain turns (protocol 8, ADR 0032): `brain.turn` is a request like any
 *   other; its `brain.event` / `brain.done` frames are published on
 *   `brainTopic(runId)` (with the machine id) for the replica running the turn.
 * - Background tasks (protocol 4, `machine-tasks.ts`): this replica persists
 *   the `task.event` and `task.done` frames of the sockets it holds and acks
 *   each `task.done`; `hello` reconciles the runner's journal; a socket that
 *   closes schedules `machine.tasks_offline` after a grace.
 * - Desktop app (protocols 9 and 10, ADR 0036): the pause (`hello.paused`,
 *   `runner.state`) and the access report (`hello.access`, `access.changed`)
 *   are stored on the row and told to the org; a paused machine gets no new
 *   work (`call` refuses with `MachinePausedError`); every request's `agent`
 *   carries the agent's name; the `agents` frame goes out after `welcome`
 *   and again on `machine.agents` (any replica); `access.decided` wakes the
 *   agent that asked (`machine-access.ts`).
 */
export interface MachineSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** Close codes the runner may see. */
export const MACHINE_CLOSE = {
  badFrame: 4400,
  invalidToken: 4401,
  revoked: 4403,
  timeout: 4408,
  replaced: 4409,
  outdated: 4426,
} as const;

/** The runner answered a request with an error (`not_found`, `exec_disabled`…). */
export class MachineRequestError extends Error {
  constructor(
    readonly code: MachineErrorCode | "timeout" | "canceled",
    message: string,
  ) {
    super(message);
    this.name = "MachineRequestError";
  }
}

export interface MachineCallOptions {
  signal?: AbortSignal;
  /** Live output of an `exec` with `stream: true` (only on the replica holding the socket). */
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  timeoutMs?: number;
}

export interface MachineStatus {
  id: string;
  orgId: string;
  name: string;
  /** `managed`: the workspace's own computer (ADR 0056 §10), always on. */
  kind?: string;
  /** Who connected it; null: nobody did (the workspace's own computer). */
  pairedByUserId?: string | null;
  online: boolean;
  /** ISO: its last sign of life (null: never seen). */
  lastSeenAt?: string | null;
  execAllowed: boolean;
  os: string;
  /** The runner's protocol (from its last hello). */
  protocol: number;
  /** Coding CLIs found at its last hello (protocol 7; empty for older runners). */
  executors: schema.MachineExecutors;
  /** The owner paused it (protocol 9): `until` null = until resumed; `timezone` is the owner's, for messages. */
  paused?: { until: string | null; timezone: string | null } | null;
  /** Folders and tools the machine allows (protocol 10); null when it doesn't report them. */
  access?: RunnerAccess | null;
  /** The operator put the workspace's own computer in standby (ADR 0161): asleep, it is woken when wanted. */
  standby?: boolean;
}

/** What the machine provider needs from the hub. */
export interface MachineCaller {
  call<Op extends MachineOp>(
    machineId: string,
    request: Extract<MachineRequest, { op: Op }>,
    options?: MachineCallOptions,
  ): Promise<MachineReplies[Op]>;
  status(machineId: string): Promise<MachineStatus | null>;
  /** Something wants the computer now (`wantMachine`): one in standby is asked to wake. */
  wake?(machineId: string, why: WakeWhy): Promise<void>;
}

/** How long a run waits, still working, for a computer just gone: a runner dialing again is back within seconds. */
export const COMPUTER_BLIP_WAIT_MS = 30_000;
/** How long a run waits, still working, for a computer in standby it asked to wake. */
export const COMPUTER_WAKE_WAIT_MS = 60_000;

/**
 * Waits for a computer to come back: one gone less than the outage grace (`TASK_OFFLINE_GRACE_MS`: its runner dialing
 * again, our own restart) up to `waitMs`, unless `justGone` is false; one in standby, asked to wake, up to `wakeWaitMs`
 * however long it has slept. The run stays `running` meanwhile (its heartbeat and its job's lease go on) and nothing is
 * posted or stored. True: it is back. Null: `canceled` said so.
 */
export async function computerBackSoon(
  machines: Pick<MachineCaller, "status" | "wake"> | undefined,
  machineId: string,
  options: {
    waitMs?: number;
    wakeWaitMs?: number;
    justGone?: boolean;
    signal?: AbortSignal;
    canceled?: () => boolean | Promise<boolean>;
  } = {},
): Promise<boolean | null> {
  let until = Date.now() + (options.waitMs ?? COMPUTER_BLIP_WAIT_MS);
  let waking = false;
  for (;;) {
    const status = await machines?.status(machineId).catch(() => null);
    if (status?.online) return true;
    if (status?.standby && !waking) {
      waking = true;
      until = Date.now() + (options.wakeWaitMs ?? COMPUTER_WAKE_WAIT_MS);
      void machines?.wake?.(machineId, "run").catch(() => {});
    }
    const gone = status?.lastSeenAt ? Date.now() - Date.parse(status.lastSeenAt) : Number.POSITIVE_INFINITY;
    if (!waking && (options.justGone === false || gone >= TASK_OFFLINE_GRACE_MS)) return false;
    if (Date.now() >= until) return false;
    await sleep(Math.min(1_000, until - Date.now()), undefined, { signal: options.signal }).catch(() => {});
    if (await options.canceled?.()) return null;
  }
}

/**
 * `send`, and once more when it found the computer just gone or asleep (`computerBackSoon`): that request never left.
 * One cut midway (`MachineDroppedError`) may have run, so it is never sent again.
 */
export async function callWhenBack<T>(
  machines: Pick<MachineCaller, "status" | "wake">,
  machineId: string,
  send: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof MachineOfflineError) || error instanceof MachineDroppedError) throw error;
    const back = await computerBackSoon(machines, machineId, { signal, canceled: () => signal?.aborted === true });
    if (!back) throw error;
    return send();
  }
}

interface Pending {
  onOutput?: MachineCallOptions["onOutput"];
  /** A `brain.turn`: its run and bridge token, so its frames (events, tool calls) prove it is alive. */
  brain?: { runId: string; token: string };
  /** Restarts the request's inactivity timer (brain turns). */
  touch?(): void;
  settle(frame: Extract<RunnerFrame, { type: "result" }>): void;
  fail(error: Error): void;
}

export interface MachineConnection {
  readonly connectionId: string;
  readonly socket: MachineSocket;
  machineId: string | null;
  orgId: string | null;
  name: string;
  /** The machine's kind (from its hello): an offline error words the workspace's own computer differently. */
  kind: string | null;
  authing: boolean;
  closed: boolean;
  pending: Map<string, Pending>;
  lastPong: number;
  lastSeenWrite: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  /** The runner's protocol (from its hello). */
  protocol: number;
  /** The pause the runner last reported (protocol 9); null = not paused. */
  pause: { until: string | null } | null;
}

export interface MachineHubDeps {
  db: Database;
  pubsub: PubSub;
  /** This process (default: random): rows record which replica holds a socket. */
  replicaId?: string;
  heartbeatMs?: number;
  helloTimeoutMs?: number;
  /** Cross-replica callers read the `machine_rpc` row this often (the signal usually comes first). */
  rpcPollMs?: number;
  /** A machine offline this long has its running tasks interrupted (default `TASK_OFFLINE_GRACE_MS`). */
  taskOfflineGraceMs?: number;
  /** A repeated `mcp.call` whose first run is in another process waits this long for its answer (default 30 s). */
  mcpRepeatWaitMs?: number;
  /** A brain turn with no frame of its own (event, tool call) for this long fails (default `BRAIN_IDLE_TIMEOUT_MS`). */
  brainIdleMs?: number;
  /** A cross-replica caller checks this often that the replica it asked still holds the socket (default 5 s). */
  rpcLivenessMs?: number;
  /** The server sends email: the workspace's own computer, ready after a long wait, is emailed to its owners. */
  readyEmail?: Omit<ReadyEmailDeps, "machines"> | null;
  /** Error reports (ADR 0104): a Cloud computer without Google Chrome goes there. */
  errors?: ErrorReporter;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
}

/**
 * A brain turn that sends nothing of its own for this long has stopped (a hung
 * CLI behind a live socket): it fails instead of keeping the run "working".
 * Every `brain.event`, and every bridge call with the turn's token (a
 * permission prompt polls every few seconds while it waits for a person),
 * restarts it; a long legit turn keeps talking. A dropped socket is caught much
 * sooner: its pending requests fail when it closes, is replaced or stops
 * answering pings.
 */
export const BRAIN_IDLE_TIMEOUT_MS = 15 * 60_000;

/**
 * Default time a request may take: a command's own timeout plus slack; an upload 5.5 minutes; a pull 10.5 (the
 * runner's own limit is 10, and says why); the rest 2 minutes.
 */
export function requestTimeoutMs(request: MachineRequest) {
  if (request.op === "exec") return (request.timeoutSeconds + 30) * 1000;
  if (request.op === "push") return 330_000;
  if (request.op === "pull") return 630_000;
  // A clone of a big repository on a slow link: its own deadline plus slack.
  if (request.op === "git.sync") return (Math.max(1, request.timeoutSeconds) + 30) * 1000;
  // A brain turn may wait on a person (a command approval) for up to 30 minutes, more than once.
  if (request.op === "brain.turn") return 3 * 3600_000;
  // A Maestro flow (with its recording) runs to its own deadline, at most 10 minutes; a recording to its length; an
  // install pushes a big build over USB.
  if (request.op === "phone.flow") return (Math.min(Math.max(1, request.timeoutSeconds), 600) + 120) * 1000;
  if (request.op === "phone.record") return (Math.min(Math.max(1, request.seconds), 170) + 90) * 1000;
  if (request.op === "phone.install") return 300_000;
  if (request.op.startsWith("phone.")) return 60_000;
  return 120_000;
}

type RpcReply = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

/**
 * Requests that start something new on the machine: refused while it is
 * paused (ADR 0036 §6), its workspace isn't active or the agent is held
 * (`standing.ts`).
 * Following running work (a task's output, canceling it), cleaning up and
 * reducing access still go through.
 */
export function isNewWork(request: MachineRequest) {
  switch (request.op) {
    case "task.status":
    case "task.cancel":
    case "task.output":
    case "access.reduce":
    // A person's message for a turn already running (live steering).
    case "brain.steer":
    // The owner managing the brains' accounts (ADR 0041) isn't agent work.
    case "account":
    // Ending an agent's desktop, or asking about it (ADR 0058).
    case "desktop.session.stop":
    case "desktop.session.status":
    // Screening a person still in control after a hold or a pause began (ADR 0076).
    case "desktop.text":
    // Letting a phone go (a run ended, its owner pressed Stop).
    case "phone.release":
    // A person pairing a phone with the computer isn't agent work.
    case "phone.pair.start":
    case "phone.pair.code":
    case "phone.pair.status":
    case "phone.pair.cancel":
    // A person's guide asking the computer to look for a phone.
    case "phone.look":
      return false;
    case "secret":
      return request.action !== "discard" && request.action !== "remove" && request.action !== "activate";
    // Watching a desktop isn't (the runner starts one that isn't running, and it stays on); taking control of it
    // or a terminal is work on it.
    case "stream.open":
      return request.kind === "terminal" || request.mode === "control";
    default:
      return true;
  }
}

/** A computer whose app predates phones gets no `phone.*` op: it would answer an unknown op. */
const phonesTooOld = (name: string) =>
  new MachineRequestError("unsupported", `The computer ${name} needs an update before agents can use its phones.`);

/** The pause in force (a past `until` is over). */
const pauseActive = (pause: { until: string | null } | null, now = Date.now()) =>
  Boolean(pause && (!pause.until || Date.parse(pause.until) > now));

const pauseOf = (p: RunnerPause | undefined): { until: string | null } | null =>
  p?.paused ? { until: p.until ?? null } : null;

/** `machine_rpc` rows older than this are deleted (opportunistically). */
export const MACHINE_RPC_KEEP_MS = 60 * 60_000;

/**
 * An `mcp.call`'s answer is kept this long by its `callId` (`machine_mcp_calls`): the runner sends a call
 * cut by a reconnect again within its own timeout (6 minutes), and the copy gets the first answer.
 */
export const MCP_CALL_KEEP_MS = 10 * 60_000;

/**
 * A repeated call whose first run is in another process waits this long for its answer: a replica that stops
 * writes it before it closes (`drain`), one that crashed never does. Well inside the bridge's own 6 minutes.
 */
const MCP_REPEAT_WAIT_MS = 30_000;

const MCP_CUT_OFF =
  "This call was cut off before it finished (the server restarted or lost the connection): it may have run in part. Check before doing it again.";

type McpOutcome = { ok: true; text: string } | { ok: false; error: { code: string; message: string } };

/** After our own server stops, a computer still away this long has its running tasks interrupted. */
export const SERVER_STOP_TASK_GRACE_MS = 10 * 60_000;

/** What missions plug into the hub (ADR 0029): the `agentes` MCP calls of their tasks, and a machine coming back. */
export interface MachineMissionHooks {
  mcp?(machineId: string, frame: Extract<RunnerFrame, { type: "mcp.call" }>): Promise<McpOutcome>;
  /** `mcp.list` (protocol 8, ADR 0032): the tools of the token's run or task. */
  mcpList?(
    machineId: string,
    frame: Extract<RunnerFrame, { type: "mcp.list" }>,
  ): Promise<{ ok: true; tools: McpToolInfo[] } | { ok: false; error: { code: string; message: string } }>;
  online?(machineId: string): Promise<void>;
  /** The phones a computer reports changed (one came, went, got ready or was let go): its phones as stored now. */
  phonesChanged?(machine: { id: string; orgId: string }, phones: MachinePhoneRow[]): Promise<void>;
  /** Starts what may start in the machine's queue of mission tasks (ADR 0044; a resumed item waits there). */
  queue?(machineId: string): Promise<unknown>;
}

/**
 * What the agent browser's live view plugs into the hub (ADR 0040 §7): the
 * runner's frames of the sockets held here, never stored, and a socket
 * closing (its viewers retry).
 */
export interface MachineBrowserHooks {
  frame?(machineId: string, frame: Extract<RunnerFrame, { type: "browser.frame" }>): void;
  streamEnded?(machineId: string, frame: Extract<RunnerFrame, { type: "browser.stream.ended" }>): void;
  closed?(machineId: string): void;
  /** A runner on protocol 12+ said hello here: what it should know again (open handoffs). */
  connected?(machineId: string): void;
}

export function createMachineHub(deps: MachineHubDeps) {
  const { db, pubsub } = deps;
  const replicaId = deps.replicaId ?? crypto.randomUUID();
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const helloTimeoutMs = deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const rpcPollMs = deps.rpcPollMs ?? 500;
  const taskOfflineGraceMs = deps.taskOfflineGraceMs ?? TASK_OFFLINE_GRACE_MS;
  const mcpRepeatWaitMs = deps.mcpRepeatWaitMs ?? MCP_REPEAT_WAIT_MS;
  const brainIdleMs = deps.brainIdleMs ?? BRAIN_IDLE_TIMEOUT_MS;
  const rpcLivenessMs = deps.rpcLivenessMs ?? 5000;
  /** Sockets on this replica, by machine id. */
  const local = new Map<string, MachineConnection>();
  /** Cross-replica requests this replica is running, to cancel them. */
  const running = new Map<string, AbortController>();
  /** `mcp.call`s this process answers, by machine and `callId`: a copy sent here waits on the same answer. */
  const mcpCalls = new Map<string, Promise<McpOutcome>>();
  let lastCleanup = 0;
  /** `stop()` ran: every socket closing from now on is our own stop, not the computer's drop. */
  let stopping = false;
  const subscriptions: Unsubscribe[] = [];
  let hooks: MachineMissionHooks = {};
  let browserHooks: MachineBrowserHooks = {};

  const send = (conn: MachineConnection, frame: ServerFrame) => {
    if (conn.closed) return;
    try {
      conn.socket.send(JSON.stringify(frame));
    } catch {
      // A socket that broke is cleaned up by its close.
    }
  };

  const refuse = (
    conn: MachineConnection,
    reason: Extract<ServerFrame, { type: "refused" }>["reason"],
    message: string,
    code: number,
  ) => {
    send(conn, { type: "refused", reason, message });
    try {
      conn.socket.close(code, reason);
    } catch {}
  };

  const markOffline = async (conn: MachineConnection, serverStop: boolean) => {
    const machineId = conn.machineId as string;
    const [row] = await db
      .update(machines)
      // Its last sign of life is its last pong (`last_seen_at` is written at most every 40 s while it is up).
      .set({ online: false, connectedReplica: null, lastSeenAt: new Date(conn.lastPong), updatedAt: new Date() })
      .where(and(eq(machines.id, machineId), eq(machines.connectedReplica, replicaId)))
      .returning({ orgId: machines.orgId });
    if (!row) return false;
    await publishMachineStatus(pubsub, row.orgId ?? conn.orgId, machineId, false);
    // Its running tasks become interrupted if it isn't back after the grace (any replica's worker runs it).
    // Our own stop: the runner dials the next server by itself and its tasks run on meanwhile, so only one
    // still away after a long backstop has them interrupted; it shows as an outage after the usual grace.
    const later = (ms: number, statusOnly: boolean) =>
      enqueue(db, {
        orgId: row.orgId,
        kind: "machine.tasks_offline",
        payload: statusOnly ? { machineId, statusOnly } : { machineId },
        dedupeKey: `machine.tasks_offline:${machineId}:${statusOnly ? "status:" : ""}${Date.now()}`,
        runAt: new Date(Date.now() + ms),
      }).catch(() => undefined);
    if (serverStop) await later(taskOfflineGraceMs, true);
    await later(serverStop ? SERVER_STOP_TASK_GRACE_MS : taskOfflineGraceMs, false);
    return true;
  };

  /** Starts a task through this socket (resuming one after an interruption); not in a paused workspace or for a held agent. */
  const localStarter =
    (conn: MachineConnection): LocalTaskStarter =>
    (input) => {
      const call: TaskCall = async (_machineId, request) => {
        if (conn.orgId) await assertCanWork(db, conn.orgId, input.agent.id);
        return callLocal(conn, await withAgentName(conn.orgId, request));
      };
      return startMachineTask({ db, pubsub, call }, input);
    };

  /** `task.done`: persisted (and the conversation woken), then acknowledged so the runner stops re-sending it. */
  async function taskDone(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "task.done" }>) {
    const machineId = conn.machineId as string;
    if (frame.interrupted) {
      const row = await getTask(db, frame.taskId);
      if (row && row.machineId === machineId) {
        // A mission item's resume waits in the mission's queue (ADR 0044): walked in the background (like
        // `hooks.online`), so the ack never waits for other tasks to start.
        const queue = hooks.queue;
        const startQueued = queue
          ? async (id: string) => {
              void queue(id).catch(() => undefined);
            }
          : undefined;
        await settleInterruptedTask({ db, pubsub, start: localStarter(conn), startQueued }, row, frame);
      }
    } else {
      await applyTaskDone({ db, pubsub }, machineId, frame);
    }
    send(conn, { type: "task.ack", taskId: frame.taskId });
  }

  /**
   * A hello that fails on our side (the database away a moment) closes the socket without a refusal: a
   * `refused` frame would stop the runner for good, a plain close makes it dial again.
   */
  async function hello(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "hello" }>) {
    try {
      await accept(conn, frame);
    } catch (error) {
      deps.log?.warn("runner hello failed", { machineId: conn.machineId, error: String(error) });
      try {
        conn.socket.close(1011, "server error");
      } catch {}
      await closeConn(conn).catch(() => undefined);
    }
  }

  /**
   * ADR 0133: the computer's runner drives its own Google Chrome now and found none (one that updated itself, say),
   * so its agents' browsers fail until someone installs it. The Cloud's computers are ours to fix: an error report.
   * Elsewhere, with the browser on, the person who can install it hears it once. The agent also says so when it
   * tries.
   */
  async function chromeWentMissing(
    machine: Pick<MachineRow, "id" | "orgId" | "name" | "kind" | "pairedByUserId">,
    frame: Extract<RunnerFrame, { type: "hello" }>,
  ) {
    if (machine.kind === "managed") {
      deps.errors?.capture(new Error("Google Chrome failed an agent's browser (missing)"), {
        org_id: machine.orgId,
        machine_id: machine.id,
        os: frame.os,
        browser_failure: "missing",
        reason: "The computer's runner found no Google Chrome when it connected.",
      });
      return;
    }
    if (frame.access?.tools.browser !== true) return;
    await notifyComputerNoChrome({ db, pubsub }, machine, new Date());
  }

  async function accept(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "hello" }>) {
    if (conn.machineId || conn.authing) return;
    conn.authing = true;
    if (frame.protocol < MIN_RUNNER_PROTOCOL) {
      return refuse(conn, "outdated", "This runner is too old. Install the latest one.", MACHINE_CLOSE.outdated);
    }
    const machine = await authenticateMachine(db, frame.token);
    if (!machine) {
      return refuse(
        conn,
        "invalid_token",
        "This computer's token isn't valid. It may have been removed. Pair it again.",
        MACHINE_CLOSE.invalidToken,
      );
    }
    if (conn.closed) return;
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.helloTimer = null;
    conn.machineId = machine.id;
    conn.orgId = machine.orgId;
    conn.name = machine.name;
    conn.kind = machine.kind;
    conn.protocol = frame.protocol;
    // Protocol 9: a runner that says nothing about the pause isn't paused.
    conn.pause = frame.protocol >= PAUSE_PROTOCOL ? pauseOf(frame.paused) : null;
    const old = local.get(machine.id);
    local.set(machine.id, conn);
    if (old && old !== conn) {
      refuse(old, "replaced", "Another runner connected for this computer.", MACHINE_CLOSE.replaced);
      // Its requests end now, not when (if ever) the dead socket's close arrives: a runner that restarted
      // mid-request lost them all (its requests die with its session).
      await closeConn(old);
    }
    const now = new Date();
    // Protocol 19: the own sign-ins' usage it knows, over the last known (a runner that just started knows none).
    const ownUsage = { ...(machine.executors?.ownUsage ?? {}), ...(frame.ownUsage ?? {}) };
    // In single-user mode the agents' own code runs as the runner's user and can send any hello: system mode
    // is believed only from a computer's first hello, and from one that has said so ever since.
    const system = frame.mode === "system" && (machine.lastSeenAt === null || machine.executors?.mode === "system");
    // A runner whose self-check hasn't finished (it just started) lists neither `cli_login` nor a reason: the last
    // reason stands until a check passes, so a restart doesn't report the same failure again.
    const loginBlocked =
      frame.claudeLoginBlocked ??
      (frame.claudeLoginMethods?.includes("cli_login") ? undefined : machine.executors?.claudeLoginBlocked);
    await db
      .update(machines)
      .set({
        online: true,
        egress: null,
        connectedReplica: replicaId,
        lastSeenAt: now,
        // Awake: whatever put it in standby is over (ADR 0161).
        standbyAt: null,
        hostname: frame.hostname,
        os: frame.os,
        arch: frame.arch,
        runnerVersion: frame.version,
        protocol: frame.protocol,
        workspace: frame.workspace,
        execAllowed: frame.exec,
        // Protocol 7: which coding CLIs it has (an older runner says nothing: kept as unknown).
        // Protocol 12: whether it can run the agent browser (ADR 0040), kept with what it found; protocol 18:
        // the same for the agents' desktops and the terminal, and whether each agent is its own OS user (ADR 0058);
        // protocol 21: whether agents can use their desktops (ADR 0062); protocol 50: which Claude sign-ins for all
        // agents it can make (an older runner says nothing: `claudeLoginMethodsOf` reads that).
        ...(frame.executors ||
        frame.browser ||
        frame.desktop ||
        frame.terminal ||
        frame.desktopUse ||
        frame.claudeLoginMethods ||
        frame.toolchains
          ? {
              executors: {
                // A runner that hasn't looked yet leaves the CLIs out: the last ones stored stand.
                ...(frame.executors
                  ? { ...frame.executors, detectedAt: now.toISOString() }
                  : storedExecutors(machine.executors)),
                ...(frame.browser ? { browser: frame.browser } : {}),
                ...(frame.desktop ? { desktop: frame.desktop } : {}),
                ...(frame.terminal ? { terminal: frame.terminal } : {}),
                ...(frame.desktopUse ? { desktopUse: frame.desktopUse } : {}),
                ...(system ? { mode: "system" as const } : {}),
                ...(frame.claudeLoginMethods ? { claudeLoginMethods: frame.claudeLoginMethods } : {}),
                ...(loginBlocked ? { claudeLoginBlocked: loginBlocked } : {}),
                ...(frame.authEgressGroup ? { authEgressGroup: true as const } : {}),
                ...(Object.keys(ownUsage).length > 0 ? { ownUsage } : {}),
                // A runner whose probe hasn't finished says none: the last ones stored stand.
                ...((frame.toolchains ?? machine.executors?.toolchains)
                  ? { toolchains: { ...(frame.toolchains ?? machine.executors?.toolchains) } }
                  : {}),
              },
            }
          : {}),
        paused: conn.pause !== null,
        pausedUntil: conn.pause?.until ? new Date(conn.pause.until) : null,
        // Protocol 10: what the machine allows (an older runner reports nothing: unknown).
        access: frame.access ?? null,
        // Protocol 22: its size (an older runner says nothing: kept, unknown if it never did).
        ...(frame.size ? { size: frame.size } : {}),
        updatedAt: now,
      })
      .where(eq(machines.id, machine.id));
    // An older socket for this machine on another replica (the runner came back elsewhere) is dropped there.
    await pubsub
      .publish(MACHINE_CONTROL_TOPIC, {
        type: "machine.connected",
        machineId: machine.id,
        replicaId,
        connectionId: conn.connectionId,
      })
      .catch(() => undefined);
    // Protocol 13 (ADR 0041): the accounts of the computer brains on it (an older runner says nothing: kept).
    // Stored before `welcome`: what the runner found since `hello` comes once it is welcomed (`accounts.changed`)
    // and must land after this older list, never under it.
    const removed =
      frame.protocol >= ACCOUNTS_PROTOCOL && frame.accounts
        ? await syncMachineAccounts({ db, pubsub }, machine.orgId, machine.id, frame.accounts).catch((error) => {
            deps.log?.warn("account sync failed", { machineId: machine.id, error: String(error) });
            return [];
          })
        : [];
    conn.lastSeenWrite = Date.now();
    conn.lastPong = Date.now();
    send(conn, {
      type: "welcome",
      machineId: machine.id,
      name: machine.name,
      heartbeatMs,
      mcpOnce: true,
      observeEgress: machine.kind === "managed",
    });
    // The workspace's own computer (ADR 0056 §10): ready on its first hello, with its agents, before they are listed.
    const readyEmail = deps.readyEmail ? { ...deps.readyEmail, machines: hub } : null;
    await onManagedMachineHello({ db, pubsub, readyEmail }, machine).catch((error) =>
      deps.log?.warn("managed machine hello failed", { machineId: machine.id, error: String(error) }),
    );
    if (frame.browser?.chromeMissing && !machine.executors?.browser?.chromeMissing) {
      await chromeWentMissing(machine, frame).catch((error) =>
        deps.log?.warn("missing Chrome notice failed", { machineId: machine.id, error: String(error) }),
      );
    }
    // Claude's own login for all agents runs on whatever Claude CLI is installed: a self-check that starts failing
    // (or fails for a new reason) is how a CLI that changed shows up. Once per reason, however often it reconnects.
    if (frame.claudeLoginBlocked && frame.claudeLoginBlocked !== machine.executors?.claudeLoginBlocked) {
      deps.errors?.capture(
        new Error(`Claude's login for all agents failed the computer's self-check: ${frame.claudeLoginBlocked}`),
        {
          org_id: machine.orgId,
          machine_id: machine.id,
          machine_kind: machine.kind,
          runner_version: frame.version,
          runner_protocol: frame.protocol,
        },
      );
    }
    // Protocol 9: the agents that use this computer, for the desktop app.
    if (frame.protocol >= PAUSE_PROTOCOL) await sendAgents(conn);
    if (frame.protocol >= BROWSER_PROTOCOL) browserHooks.connected?.(machine.id);
    conn.pingTimer = setInterval(() => {
      // The runner redials after two heartbeats without a ping. Checked once a heartbeat, a pong older than
      // one and a half heartbeats means the ping sent a heartbeat ago went unanswered: both ends give up on
      // the link at about the same time, so this side stops sending work into it.
      if (Date.now() - conn.lastPong > 1.5 * heartbeatMs) {
        try {
          conn.socket.close(MACHINE_CLOSE.timeout, "no pong");
        } catch {}
        // A half-open socket may never report its close: its requests fail and the machine goes offline now.
        void closeConn(conn);
        return;
      }
      send(conn, { type: "ping", at: Date.now() });
    }, heartbeatMs);
    await publishMachineStatus(pubsub, machine.orgId, machine.id, true);
    if (frame.protocol >= PAUSE_PROTOCOL) {
      await publishMachineUpdated(pubsub, machine.orgId, machine.id, { paused: conn.pause, access: true });
    }
    removeAccounts(conn, removed);
    if (frame.protocol >= TASKS_PROTOCOL) {
      await reconcileMachineTasks({ db, pubsub, start: localStarter(conn) }, machine.id, frame.tasks ?? []).catch(
        (error) => deps.log?.warn("task reconcile failed", { machineId: machine.id, error: String(error) }),
      );
    }
    if (frame.protocol >= PHONES_PROTOCOL && frame.phones) await phonesReported(machine, frame.phones);
    // Missions on this machine: queued messages and `.agentes/` files go out now (not in this frame's path).
    if (hooks.online) {
      const online = hooks.online;
      queueMicrotask(
        () =>
          void online(machine.id).catch((error) =>
            deps.log?.warn("mission reconnect failed", { machineId: machine.id, error: String(error) }),
          ),
      );
    }
  }

  /** `hello.phones` and `phones.changed`: stored, told to the org, and to whatever waits for a phone there. */
  async function phonesReported(machine: Pick<MachineRow, "id" | "orgId" | "pairedByUserId">, reported: RunnerPhone[]) {
    const phones = await syncMachinePhones(db, machine, reported).catch((error) => {
      deps.log?.warn("phone sync failed", { machineId: machine.id, error: String(error) });
      return null;
    });
    if (!phones) return;
    await publishDevicesChanged(pubsub, machine.orgId);
    const changed = hooks.phonesChanged;
    if (!changed) return;
    queueMicrotask(
      () =>
        void changed({ id: machine.id, orgId: machine.orgId }, phones).catch((error) =>
          deps.log?.warn("phones hook failed", { machineId: machine.id, error: String(error) }),
        ),
    );
  }

  /**
   * Accounts whose row is a tombstone (removed while the computer was off, or
   * their person left) that the runner still has: signed out and deleted
   * there now, then the row goes. A failure leaves it for the next hello.
   */
  function removeAccounts(conn: MachineConnection, refs: MachineAccountRef[]) {
    const { machineId, orgId } = conn;
    if (!machineId || !orgId) return;
    for (const ref of refs) {
      void callLocal(conn, { op: "account", action: "remove", kind: ref.kind, accountId: ref.id })
        .then(() => forgetRemovedAccount(db, orgId, ref.id))
        .catch((error) => deps.log?.warn("account removal failed", { machineId, error: String(error) }));
    }
  }

  /** The `agents` frame (protocol 9): the org's agents pointed at this machine. */
  async function sendAgents(conn: MachineConnection) {
    if (!conn.machineId || !conn.orgId || conn.protocol < PAUSE_PROTOCOL) return;
    const agents = await machineAgents(db, conn.orgId, conn.machineId).catch(() => null);
    if (!agents) return;
    const deleted =
      conn.protocol >= CLAUDE_SHARED_PROTOCOL ? await deletedAgentIds(db, conn.orgId).catch(() => []) : [];
    send(conn, { type: "agents", agents, ...(deleted.length ? { deleted } : {}) });
  }

  /** `runner.state` (protocol 9): paused, resumed or a new `until`; stored and told to the org. */
  async function runnerState(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "runner.state" }>) {
    const machineId = conn.machineId as string;
    const wasPaused = pauseActive(conn.pause);
    conn.pause = pauseOf(frame.paused);
    const [row] = await db
      .update(machines)
      .set({
        paused: conn.pause !== null,
        pausedUntil: conn.pause?.until ? new Date(conn.pause.until) : null,
        updatedAt: new Date(),
      })
      .where(eq(machines.id, machineId))
      .returning({ orgId: machines.orgId });
    if (!row) return;
    await publishMachineUpdated(pubsub, row.orgId, machineId, { paused: conn.pause });
    // Resumed: what waited for this computer goes on (runs waiting for its brain, missions' queued work).
    if (wasPaused && !pauseActive(conn.pause) && hooks.online) {
      const online = hooks.online;
      queueMicrotask(
        () =>
          void online(machineId).catch((error) =>
            deps.log?.warn("resume after pause failed", { machineId, error: String(error) }),
          ),
      );
    }
  }

  /** Fills `agent.name` (protocol 9, for the machine's activity log) when a caller left it out. */
  async function withAgentName<R extends MachineRequest>(orgId: string | null, request: R): Promise<R> {
    const scope = request.agent;
    if (!scope || scope.name || !orgId) return request;
    const agent = await getAgentCached(db, orgId, scope.id).catch(() => null);
    return agent ? { ...request, agent: { ...scope, name: agent.name } } : request;
  }

  /** Bridge calls of work already on the machine stop with its workspace (`standing.ts`). */
  async function refused(conn: MachineConnection) {
    const refusal = conn.orgId ? await standingRefusal(db, conn.orgId) : null;
    return refusal ? { ok: false as const, error: { code: refusal.code, message: refusal.message } } : null;
  }

  /** `mcp.call` (protocol 5): run by the missions hook, answered with `mcp.result`; never blocks other frames. */
  function mcpCall(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "mcp.call" }>) {
    const machineId = conn.machineId as string;
    const run = async (): Promise<McpOutcome> =>
      (await refused(conn)) ??
      (hooks.mcp
        ? hooks.mcp(machineId, frame)
        : {
            ok: false as const,
            error: { code: "mission.unavailable", message: "Missions are not available on this server." },
          });
    void mcpOnce(conn, frame.callId, run)
      .catch((error: unknown) => ({
        ok: false as const,
        error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
      }))
      .then((out) =>
        send(
          conn,
          out.ok
            ? { type: "mcp.result", callId: frame.callId, ok: true, text: out.text }
            : { type: "mcp.result", callId: frame.callId, ok: false, error: out.error },
        ),
      );
  }

  /**
   * One run per `callId` (`machine_mcp_calls`): the runner sends a call cut by a reconnect again under the
   * same id, and that copy gets the first run's answer. Run here: the copy waits on it. Run by another
   * process: the copy waits a short while for its answer to land, then hears it was cut off.
   */
  function mcpOnce(conn: MachineConnection, callId: string, run: () => Promise<McpOutcome>): Promise<McpOutcome> {
    const id = `${conn.machineId}:${callId}`;
    const here = mcpCalls.get(id);
    if (here) return here;
    const out = answerOnce(conn, callId, run).finally(() => mcpCalls.delete(id));
    mcpCalls.set(id, out);
    return out;
  }

  async function answerOnce(
    conn: MachineConnection,
    callId: string,
    run: () => Promise<McpOutcome>,
  ): Promise<McpOutcome> {
    void pruneRows();
    const machineId = conn.machineId as string;
    const key = and(eq(machineMcpCalls.machineId, machineId), eq(machineMcpCalls.callId, callId));
    const [first] = await db
      .insert(machineMcpCalls)
      .values({ orgId: conn.orgId as string, machineId, callId })
      .onConflictDoNothing()
      .returning({ callId: machineMcpCalls.callId });
    if (first) {
      const out: McpOutcome = await run().catch((error: unknown) => ({
        ok: false as const,
        error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
      }));
      const kept = out.ok ? { ok: true as const, text: cutText(out.text, 50_000) } : out;
      await db
        .update(machineMcpCalls)
        .set({ result: kept })
        .where(key)
        .catch(() => undefined);
      return kept;
    }
    for (const until = Date.now() + mcpRepeatWaitMs; ; ) {
      const [row] = await db.select({ result: machineMcpCalls.result }).from(machineMcpCalls).where(key);
      if (row?.result) return row.result as McpOutcome;
      if (!row || Date.now() >= until) return { ok: false, error: { code: "bridge.cut_off", message: MCP_CUT_OFF } };
      await Bun.sleep(rpcPollMs);
    }
  }

  /** `mcp.list` (protocol 8): answered with `mcp.tools`; never blocks other frames. */
  function mcpList(conn: MachineConnection, frame: Extract<RunnerFrame, { type: "mcp.list" }>) {
    const machineId = conn.machineId as string;
    const run = async () =>
      (await refused(conn)) ??
      (hooks.mcpList
        ? hooks.mcpList(machineId, frame)
        : {
            ok: false as const,
            error: { code: "bridge.unavailable", message: "Tools are not available on this server." },
          });
    void run()
      .catch((error: unknown) => ({
        ok: false as const,
        error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
      }))
      .then((out) =>
        send(
          conn,
          out.ok
            ? { type: "mcp.tools", callId: frame.callId, ok: true, tools: out.tools }
            : { type: "mcp.tools", callId: frame.callId, ok: false, error: out.error },
        ),
      );
  }

  /**
   * A `pong`: `last_seen_at` at most every 40 s, and the day's load (protocol 22) or its agents' browsers'
   * traffic (protocol 23) whenever the runner has a new one.
   */
  async function touch(
    conn: MachineConnection,
    { load, browserTraffic, egress, networkTransition }: Extract<RunnerFrame, { type: "pong" }>,
  ) {
    conn.lastPong = Date.now();
    if (!conn.machineId) return;
    // The authenticated database kind is authoritative, including for an older or modified personal runner.
    if (conn.kind !== "managed") {
      egress = undefined;
      networkTransition = undefined;
    }
    if (
      !load &&
      !browserTraffic &&
      !egress &&
      networkTransition === undefined &&
      Date.now() - conn.lastSeenWrite < Math.min(40_000, heartbeatMs * 1.6)
    )
      return;
    conn.lastSeenWrite = Date.now();
    const now = new Date();
    const at = now.toISOString();
    const machineId = conn.machineId;
    const stored = load
      ? await db
          .select({ load: machines.load, orgId: machines.orgId, name: machines.name })
          .from(machines)
          .where(eq(machines.id, machineId))
          .then(([m]) => m ?? null)
          .catch(() => null)
      : null;
    const prev = stored?.load;
    // ADR 0115: a report without the disk's figures (a runner that just started) keeps the last ones.
    const next =
      load && load.diskUse === undefined && prev?.diskUse !== undefined
        ? {
            ...load,
            diskUse: prev.diskUse,
            ...(prev.diskFreeGb === undefined ? {} : { diskFreeGb: prev.diskFreeGb }),
            ...(prev.sharedGb === undefined ? {} : { sharedGb: prev.sharedGb }),
          }
        : load;
    const wasWarned = prev?.diskWarned === true;
    const use = next?.diskUse;
    const diskWarned = use === undefined ? wasWarned : use >= DISK_WARN_USE || (wasWarned && use >= DISK_REARM_USE);
    const changed = await db
      .update(machines)
      .set({
        lastSeenAt: now,
        online: true,
        ...(networkTransition !== undefined ? { networkTransition } : {}),
        ...(next ? { load: { ...next, ...(diskWarned ? { diskWarned } : {}), at } } : {}),
        ...(browserTraffic ? { browserTraffic: { ...browserTraffic, at } } : {}),
        ...(conn.kind !== "managed" ? { egress: null } : egress ? { egress: { ...egress, at } } : {}),
      })
      .where(and(eq(machines.id, machineId), eq(machines.connectedReplica, replicaId)))
      .returning({ id: machines.id })
      .catch(() => []);
    if (networkTransition !== undefined && changed.length && conn.orgId) {
      await publishMachineUpdated(pubsub, conn.orgId, machineId, { networkTransition });
    }
    if (egress && changed.length && conn.orgId) {
      await publishMachineUpdated(pubsub, conn.orgId, machineId, { egress: egress.ip ? { ...egress, at } : null });
    }
    if (stored && diskWarned && !wasWarned && use !== undefined) {
      await notifyComputerDiskFull(
        { db, pubsub },
        { id: machineId, orgId: stored.orgId, name: stored.name },
        { diskUse: use, ...(next?.diskFreeGb === undefined ? {} : { diskFreeGb: next.diskFreeGb }) },
        now,
      ).catch((error) => deps.log?.warn("disk warning failed", { machineId, error: String(error) }));
    }
  }

  function callLocal<Op extends MachineOp>(
    conn: MachineConnection,
    request: Extract<MachineRequest, { op: Op }>,
    options: MachineCallOptions = {},
  ): Promise<MachineReplies[Op]> {
    return new Promise((resolve, reject) => {
      const { signal } = options;
      if (signal?.aborted) return reject(new MachineRequestError("canceled", "canceled"));
      // Its socket closed while the caller awaited (`hub.call`'s checks): `closeConn` already failed what it had,
      // and this would never be sent or answered. Never sent, so offline: `callWhenBack` may send it again.
      if (conn.closed) return reject(new MachineOfflineError(conn.name, conn.kind));
      const id = crypto.randomUUID();
      const timeoutMs = options.timeoutMs ?? requestTimeoutMs(request);
      const turn = request.op === "brain.turn" ? (request as Extract<MachineRequest, { op: "brain.turn" }>) : null;
      const brain = turn ? { runId: turn.runId, token: turn.mcp.token } : undefined;
      let idle: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(idle);
        signal?.removeEventListener("abort", onAbort);
        conn.pending.delete(id);
      };
      /** A brain turn that went quiet: canceled on the machine, failed here. */
      const touch = () => {
        if (!brain) return;
        clearTimeout(idle);
        idle = setTimeout(() => {
          cleanup();
          send(conn, { type: "cancel", id });
          reject(
            new MachineRequestError(
              "timeout",
              `no news from the computer ${conn.name} for ${Math.round(brainIdleMs / 60_000)} min`,
            ),
          );
        }, brainIdleMs);
      };
      const timer = setTimeout(() => {
        cleanup();
        send(conn, { type: "cancel", id });
        reject(
          new MachineRequestError(
            "timeout",
            `the computer ${conn.name} did not answer within ${Math.round(timeoutMs / 1000)} s`,
          ),
        );
      }, timeoutMs);
      function onAbort() {
        send(conn, { type: "cancel", id });
        // A command reports how it ended (`canceled`); anything else just stops waiting.
        if (request.op !== "exec") {
          cleanup();
          reject(new MachineRequestError("canceled", "canceled"));
        }
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      touch();
      conn.pending.set(id, {
        onOutput: options.onOutput,
        ...(brain ? { brain, touch } : {}),
        settle(frame) {
          cleanup();
          if (frame.ok) resolve(frame.data as MachineReplies[Op]);
          // The agent's process there went away mid-request (its worker stopped, the runner is stopping).
          else if (frame.error.code === "dropped") {
            reject(new MachineDroppedError(conn.name, { message: frame.error.message }));
          } else reject(new MachineRequestError(frame.error.code, frame.error.message));
        },
        fail(error) {
          cleanup();
          reject(error);
        },
      });
      send(conn, { type: "request", id, ...request } as ServerFrame);
    });
  }

  /** A brain turn's own frame arrived: it is alive (restarts its inactivity timer). */
  function touchBrain(conn: MachineConnection, match: (b: NonNullable<Pending["brain"]>) => boolean) {
    for (const p of conn.pending.values()) if (p.brain && match(p.brain)) p.touch?.();
  }

  async function pruneRows() {
    if (Date.now() - lastCleanup < 10 * 60_000) return;
    lastCleanup = Date.now();
    await db
      .delete(machineRpc)
      .where(lt(machineRpc.createdAt, new Date(Date.now() - MACHINE_RPC_KEEP_MS)))
      .catch(() => undefined);
    await db
      .delete(machineMcpCalls)
      .where(lt(machineMcpCalls.createdAt, new Date(Date.now() - MCP_CALL_KEEP_MS)))
      .catch(() => undefined);
  }

  async function callRemote<Op extends MachineOp>(
    machine: { id: string; orgId: string; name: string; kind?: string; connectedReplica: string },
    request: Extract<MachineRequest, { op: Op }>,
    options: MachineCallOptions = {},
  ): Promise<MachineReplies[Op]> {
    void pruneRows();
    const [rpc] = await db
      .insert(machineRpc)
      .values({ orgId: machine.orgId, machineId: machine.id, request: request as unknown as Record<string, unknown> })
      .returning({ id: machineRpc.id });
    if (!rpc) throw new Error("machine_rpc insert returned nothing");
    let wake: (() => void) | null = null;
    const off = pubsub.subscribe(machineRpcReplyTopic(rpc.id), () => wake?.());
    const onAbort = () => {
      void pubsub
        .publish(machineRpcTopic(machine.connectedReplica), { type: "machine.rpc.cancel", rpcId: rpc.id })
        .catch(() => undefined);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const deadline = Date.now() + (options.timeoutMs ?? requestTimeoutMs(request)) + 10_000;
    let checkedAt = Date.now();
    try {
      await pubsub.publish(machineRpcTopic(machine.connectedReplica), { type: "machine.rpc", rpcId: rpc.id });
      for (;;) {
        const [row] = await db
          .select({ status: machineRpc.status, reply: machineRpc.reply })
          .from(machineRpc)
          .where(eq(machineRpc.id, rpc.id));
        if (row && (row.status === "done" || row.status === "failed")) {
          const reply = row.reply as RpcReply | null;
          if (reply?.ok) return reply.data as MachineReplies[Op];
          const error = reply && !reply.ok ? reply.error : { code: "internal", message: "no reply" };
          if (error.code === "offline") throw new MachineOfflineError(machine.name, machine.kind);
          if (error.code === "dropped" || error.code === "server_stop") {
            throw new MachineDroppedError(machine.name, {
              serverStop: error.code === "server_stop",
              message: error.message,
            });
          }
          throw new MachineRequestError(error.code as MachineErrorCode, error.message);
        }
        // The replica asked no longer holds the socket (the runner came back elsewhere, or that replica
        // died): its answer will never come, so the request ends now as offline.
        if (Date.now() - checkedAt >= rpcLivenessMs) {
          checkedAt = Date.now();
          const now = await getMachineById(db, machine.id).catch(() => undefined);
          if (
            now !== undefined &&
            (!now || now.deletedAt || !machineOnline(now) || now.connectedReplica !== machine.connectedReplica)
          ) {
            const [gone] = await db
              .update(machineRpc)
              .set({ status: "failed", repliedAt: new Date() })
              .where(and(eq(machineRpc.id, rpc.id), inArray(machineRpc.status, ["pending", "running"])))
              .returning({ id: machineRpc.id });
            // No row: the answer landed meanwhile (read on the next pass).
            if (gone) {
              onAbort();
              // Already being served there when that replica went: it may have run.
              throw row?.status === "running"
                ? new MachineDroppedError(machine.name)
                : new MachineOfflineError(machine.name, machine.kind);
            }
            continue;
          }
        }
        if (Date.now() >= deadline) {
          await db
            .update(machineRpc)
            .set({ status: "failed", repliedAt: new Date() })
            .where(and(eq(machineRpc.id, rpc.id), eq(machineRpc.status, "pending")));
          throw new MachineRequestError("timeout", `the computer ${machine.name} did not answer in time`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, Math.min(rpcPollMs, Math.max(0, deadline - Date.now())));
          function done() {
            clearTimeout(timer);
            wake = null;
            resolve();
          }
          wake = done;
        });
      }
    } finally {
      off();
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Runs a request another replica wrote for a machine whose socket is here. */
  async function serveRpc(rpcId: string) {
    const [row] = await db
      .update(machineRpc)
      .set({ status: "running" })
      .where(and(eq(machineRpc.id, rpcId), eq(machineRpc.status, "pending")))
      .returning();
    if (!row) return;
    const conn = local.get(row.machineId);
    let reply: RpcReply;
    if (!conn) reply = { ok: false, error: { code: "offline", message: "offline" } };
    else {
      const controller = new AbortController();
      running.set(rpcId, controller);
      try {
        const request = row.request as unknown as MachineRequest;
        const data = await callLocal(conn, request, { signal: controller.signal });
        reply = { ok: true, data };
      } catch (error) {
        const code =
          error instanceof MachineDroppedError
            ? error.serverStop
              ? "server_stop"
              : "dropped"
            : error instanceof MachineOfflineError
              ? "offline"
              : error instanceof MachineRequestError
                ? error.code
                : "internal";
        reply = { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } };
      } finally {
        running.delete(rpcId);
      }
    }
    await db
      .update(machineRpc)
      .set({
        status: reply.ok ? "done" : "failed",
        reply: reply as unknown as Record<string, unknown>,
        repliedAt: new Date(),
      })
      .where(eq(machineRpc.id, rpcId));
    await pubsub.publish(machineRpcReplyTopic(rpcId), { type: "machine.rpc.reply", rpcId }).catch(() => undefined);
  }

  async function closeConn(conn: MachineConnection) {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    if (conn.pingTimer) clearInterval(conn.pingTimer);
    // Sent and not answered: the runner aborts what still runs, but it may already have had effects.
    // `serverStop`: this server is stopping (a restart), not the computer or its network.
    const serverStop = stopping;
    for (const p of [...conn.pending.values()])
      p.fail(new MachineDroppedError(conn.name || "computer", { serverStop }));
    conn.pending.clear();
    if (conn.machineId && local.get(conn.machineId) === conn) {
      local.delete(conn.machineId);
      browserHooks.closed?.(conn.machineId);
      await markOffline(conn, serverStop).catch(() => undefined);
    }
  }

  subscriptions.push(
    pubsub.subscribe(machineRpcTopic(replicaId), (event) => {
      const rpcId = typeof event.rpcId === "string" ? event.rpcId : "";
      if (!rpcId) return;
      if (event.type === "machine.rpc") {
        void serveRpc(rpcId).catch((error) => deps.log?.warn("machine rpc failed", { rpcId, error: String(error) }));
      } else if (event.type === "machine.rpc.cancel") running.get(rpcId)?.abort();
    }),
    pubsub.subscribe(MACHINE_CONTROL_TOPIC, (event) => {
      if (event.type === "machine.connected" && typeof event.machineId === "string") {
        if (event.replicaId === replicaId) return;
        const conn = local.get(event.machineId);
        if (!conn || conn.connectionId === event.connectionId) return;
        // The runner came back on another replica: this socket is a stale one (outside the publisher's call stack).
        queueMicrotask(() => {
          refuse(conn, "replaced", "Another runner connected for this computer.", MACHINE_CLOSE.replaced);
          void closeConn(conn);
        });
        return;
      }
      if (event.type === "machine.accounts" && typeof event.machineId === "string") {
        // New tombstones (a person left): the runner here removes them now (outside the publisher's call stack).
        const conn = local.get(event.machineId);
        const { machineId, orgId } = conn ?? {};
        if (!conn || !machineId || !orgId || conn.protocol < ACCOUNTS_PROTOCOL) return;
        queueMicrotask(
          () =>
            void accountsToRemove(db, orgId, machineId)
              .then((refs) => removeAccounts(conn, refs))
              .catch(() => undefined),
        );
        return;
      }
      if (event.type === "machine.agents" && typeof event.orgId === "string") {
        // The org's agents changed: its machines here list them again (outside the publisher's call stack).
        for (const conn of local.values()) {
          if (conn.orgId === event.orgId) queueMicrotask(() => void sendAgents(conn).catch(() => undefined));
        }
        return;
      }
      if (event.type !== "machine.revoke" || typeof event.machineId !== "string") return;
      const conn = local.get(event.machineId);
      if (!conn) return;
      // Outside the publisher's call stack (in-memory pub/sub delivers synchronously).
      queueMicrotask(() =>
        refuse(conn, "revoked", "This computer was removed from the organization.", MACHINE_CLOSE.revoked),
      );
    }),
  );

  const hub = {
    replicaId,

    /** A socket opened on `/api/machines/connect`: it has `HELLO_TIMEOUT_MS` to say `hello`. */
    open(socket: MachineSocket): MachineConnection {
      const conn: MachineConnection = {
        connectionId: crypto.randomUUID(),
        socket,
        machineId: null,
        orgId: null,
        name: "",
        kind: null,
        authing: false,
        closed: false,
        pending: new Map(),
        lastPong: Date.now(),
        lastSeenWrite: 0,
        helloTimer: null,
        pingTimer: null,
        protocol: 0,
        pause: null,
      };
      conn.helloTimer = setTimeout(() => {
        // Not a refusal: a runner that just woke up (the Mac slept) may be slow to say hello, and the token is
        // fine. A `refused` frame would make it stop for good; a plain close makes it dial again.
        if (conn.machineId) return;
        try {
          conn.socket.close(MACHINE_CLOSE.timeout, "no hello");
        } catch {}
      }, helloTimeoutMs);
      return conn;
    },

    async message(conn: MachineConnection, raw: string | Buffer | Uint8Array) {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const frame = parseRunnerFrame(text);
      if (!frame) {
        if (!conn.machineId) refuse(conn, "invalid_token", "Send hello first.", MACHINE_CLOSE.badFrame);
        return;
      }
      if (frame.type === "hello") return hello(conn, frame);
      if (!conn.machineId) {
        if (!conn.authing) refuse(conn, "invalid_token", "Send hello first.", MACHINE_CLOSE.badFrame);
        return;
      }
      if (frame.type === "output") conn.pending.get(frame.id)?.onOutput?.(frame.stream, frame.chunk);
      else if (frame.type === "result") conn.pending.get(frame.id)?.settle(frame);
      // The agent browser's live view (ADR 0040): straight to the viewers in memory.
      else if (frame.type === "browser.frame") browserHooks.frame?.(conn.machineId, frame);
      else if (frame.type === "browser.stream.ended") browserHooks.streamEnded?.(conn.machineId, frame);
      else if (frame.type === "pong") await touch(conn, frame);
      else if (frame.type === "task.event") {
        await applyTaskEvent({ db, pubsub }, conn.machineId, frame).catch(() => undefined);
      } else if (frame.type === "mcp.call") {
        if (frame.token) touchBrain(conn, (b) => b.token === frame.token);
        mcpCall(conn, frame);
      } else if (frame.type === "mcp.list") {
        touchBrain(conn, (b) => b.token === frame.token);
        mcpList(conn, frame);
      } else if (frame.type === "brain.event" || frame.type === "brain.done") {
        touchBrain(conn, (b) => b.runId === frame.runId);
        // Brain turns (protocol 8, ADR 0032): to whichever replica runs the turn; it checks the machine.
        await pubsub
          .publish(brainTopic(frame.runId), {
            type: frame.type,
            machineId: conn.machineId,
            ...(frame.type === "brain.event" ? { event: frame.event } : {}),
          })
          .catch(() => undefined);
      } else if (frame.type === "task.done") {
        // Not acknowledged on failure: the runner sends it again after its next reconnect.
        await taskDone(conn, frame).catch((error) =>
          deps.log?.warn("task.done failed", { taskId: frame.taskId, error: String(error) }),
        );
      } else if (frame.type === "runner.state") {
        await runnerState(conn, frame).catch((error) =>
          deps.log?.warn("runner.state failed", { machineId: conn.machineId, error: String(error) }),
        );
      } else if (frame.type === "accounts.changed") {
        if (conn.machineId && conn.orgId) {
          const machineId = conn.machineId;
          const orgId = conn.orgId;
          const remove = await syncMachineAccounts({ db, pubsub }, orgId, machineId, frame.accounts).catch((error) => {
            deps.log?.warn("account sync failed", { machineId, error: String(error) });
            return [];
          });
          removeAccounts(conn, remove);
          if (frame.ownUsage) {
            await storeOwnUsage({ db, pubsub }, orgId, machineId, frame.ownUsage).catch((error) =>
              deps.log?.warn("own usage failed", { machineId, error: String(error) }),
            );
          }
        }
      } else if (frame.type === "access.changed" || frame.type === "executors.changed") {
        const machineId = conn.machineId;
        await (frame.type === "access.changed"
          ? storeMachineAccess({ db, pubsub }, machineId, frame.access)
          : storeMachineExecutors({ db, pubsub }, machineId, frame.executors)
        ).catch((error) => deps.log?.warn(`${frame.type} failed`, { machineId, error: String(error) }));
        // A tool turned on or a CLI found (Claude Code, Codex, commands): what waited for this computer goes on.
        if (hooks.online) {
          const online = hooks.online;
          queueMicrotask(
            () =>
              void online(machineId).catch((error) =>
                deps.log?.warn("resume after access change failed", { machineId, error: String(error) }),
              ),
          );
        }
      } else if (frame.type === "toolchains.changed") {
        await storeMachineToolchains({ db, pubsub }, conn.machineId, frame.toolchains).catch((error) =>
          deps.log?.warn("toolchains.changed failed", { machineId: conn.machineId, error: String(error) }),
        );
      } else if (frame.type === "phones.changed") {
        if (conn.protocol >= PHONES_PROTOCOL && conn.orgId) {
          const row = await getMachineById(db, conn.machineId).catch(() => null);
          if (row && !row.deletedAt) await phonesReported(row, frame.phones);
        }
      } else if (frame.type === "access.decided") {
        await applyAccessDecided({ db, pubsub }, conn.machineId, frame).catch((error) =>
          deps.log?.warn("access.decided failed", { requestId: frame.requestId, error: String(error) }),
        );
      }
    },

    /** The socket closed (either side): pending requests fail, and the machine goes offline unless replaced. */
    close: closeConn,

    /** Sends a request to a machine, wherever its socket is. Offline: `MachineOfflineError`. */
    async call<Op extends MachineOp>(
      machineId: string,
      request: Extract<MachineRequest, { op: Op }>,
      options: MachineCallOptions = {},
    ): Promise<MachineReplies[Op]> {
      const conn = local.get(machineId);
      const phoneOp = request.op.startsWith("phone.");
      const phonesNeed = request.op.startsWith("phone.pair.") ? PHONE_PAIRING_PROTOCOL : PHONES_PROTOCOL;
      if (conn) {
        if (phoneOp && conn.protocol < phonesNeed) throw phonesTooOld(conn.name);
        if (isNewWork(request)) {
          // A workspace on hold or suspended, or a held agent, starts nothing (`standing.ts`).
          if (conn.orgId) await assertCanWork(db, conn.orgId, request.agent?.id);
          // Paused (ADR 0036 §6): nothing new starts; the row says until when, in whose time zone.
          if (pauseActive(conn.pause)) {
            const row = await getMachineById(db, machineId);
            if (row) await assertNotPaused(db, row);
          }
        }
        return callLocal(conn, await withAgentName(conn.orgId, request), options);
      }
      const row = await getMachineById(db, machineId);
      if (!row || row.deletedAt) throw new MachineOfflineError(row?.name ?? "computer", row?.kind);
      if (!machineOnline(row) || !row.connectedReplica || row.connectedReplica === replicaId) {
        // Asleep by design: whatever asks for it wakes it (`callWhenBack` waits for that).
        if (inStandby(row)) void wantMachine(db, machineId, "call").catch(() => {});
        throw new MachineOfflineError(row.name, row.kind);
      }
      if (phoneOp && row.protocol < phonesNeed) throw phonesTooOld(row.name);
      if (isNewWork(request)) {
        await assertCanWork(db, row.orgId, request.agent?.id);
        await assertNotPaused(db, row);
      }
      const named = await withAgentName(row.orgId, request);
      return callRemote({ ...row, connectedReplica: row.connectedReplica }, named, options);
    },

    /** The machine as tools see it: online here, or online (and recently seen) on another replica. */
    async status(machineId: string): Promise<MachineStatus | null> {
      const row = await getMachineById(db, machineId);
      if (!row || row.deletedAt) return null;
      const online = local.has(machineId) || (machineOnline(row) && row.connectedReplica !== replicaId);
      const pause = machinePause(row);
      return {
        id: row.id,
        orgId: row.orgId,
        name: row.name,
        kind: row.kind,
        pairedByUserId: row.pairedByUserId,
        online,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        execAllowed: row.execAllowed,
        os: row.os,
        protocol: row.protocol,
        executors: row.executors ?? {},
        paused: pause ? { until: pause.until, timezone: await machineOwnerTimezone(db, row).catch(() => null) } : null,
        access: row.access ?? null,
        standby: inStandby(row),
      };
    },

    /** Something wants the computer now: the workspace's own one keeps when, and asks to wake from standby. */
    wake: (machineId: string, why: WakeWhy) => wantMachine(db, machineId, why),

    /** Missions plug in their MCP tools and their reconnect follow-up (set once the engine is built). */
    setMissionHooks(next: MachineMissionHooks) {
      hooks = next;
    },

    /** The agent browser's live view plugs in (set once the engine is built). */
    setBrowserHooks(next: MachineBrowserHooks) {
      browserHooks = next;
    },

    /** Whether this replica holds the machine's socket. */
    isLocal: (machineId: string) => local.has(machineId),

    /** The protocol of a computer whose socket is here; null when it isn't here. */
    localProtocol(machineId: string): number | null {
      return local.get(machineId)?.protocol ?? null;
    },

    /**
     * `browser.handoff` to a computer whose socket is here (protocol 12+), for
     * its desktop app; false when it isn't here or too old (nothing to do).
     */
    sendBrowserHandoff(machineId: string, agentId: string, handoff: BrowserHandoffInfo | null): boolean {
      const conn = local.get(machineId);
      if (!conn || conn.protocol < BROWSER_PROTOCOL) return false;
      send(conn, { type: "browser.handoff", agentId, handoff });
      return true;
    },

    /** Stops listening and closes every socket (shutdown, tests): drops of our own, not the computers'. */
    async stop() {
      stopping = true;
      for (const off of subscriptions) off();
      subscriptions.length = 0;
      for (const conn of [...local.values()]) {
        // Started before the socket's own close can run it: awaited here, its offline row and jobs are written
        // before the database closes.
        const closed = closeConn(conn);
        try {
          conn.socket.close(1001, "server stopping");
        } catch {}
        await closed;
      }
    },

    /**
     * After `stop()`: waits (at most `ms`) for the `mcp.call`s still running here, so their answers are stored
     * before the database closes and the runner's copy on the next server gets them instead of a cut-off.
     */
    async drain(ms: number) {
      if (mcpCalls.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...mcpCalls.values()]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
      ]);
      clearTimeout(timer);
    },
  };
  return hub;
}

export type MachineHub = ReturnType<typeof createMachineHub>;
