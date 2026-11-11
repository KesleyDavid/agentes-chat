import { mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cgroupCounters,
  diskFigures,
  diskSpace,
  LoadWindow,
  machineSize,
  sampleLoad,
  TrafficWindow,
} from "@agenteschat/adapters/host-stats";
import {
  type AccountKind,
  type AgentScope,
  ALL_AGENTS,
  isAccountId,
  isAccountKind,
  LOAD_SAMPLE_MS,
  MACHINE_PROTOCOL_VERSION,
  type MachineAgent,
  type MachineOs,
  type MachineReplies,
  type MachineRequest,
  OWN_USAGE_ID,
  type RunnerAccess,
  type RunnerFrame,
  type RunnerInfo,
  type RunnerPause,
  type RunnerToolchains,
  type RunnerTools,
} from "@agenteschat/adapters/machine-protocol";
import { redactCommon } from "@agenteschat/adapters/redact";
import {
  type ActivityEntry,
  type ActivitySaid,
  CONTROL_PROTOCOL_VERSION,
  type ControlAccessRequest,
  type ControlConfig,
  type ControlConfigPatch,
  type ControlEvent,
  type ControlJob,
  type ControlReplies,
  type ControlStatus,
} from "@agenteschat/adapters/runner-control";
import {
  AccessRequests,
  addFolder,
  allowedFor,
  ControlError,
  checkFolder,
  parseAgents,
  readAgents,
  realFoldersFor,
  reduceAccess,
  removeFolder,
  setFolderAgents,
  setTool,
  TOOL_NAMES,
  writeAgents,
} from "./access";
import { AccountBrains } from "./account-brains";
import { accountSelfCheck, SELF_CHECK_EVERY_MS, SELF_CHECK_RETRY_MS } from "./account-check";
import { AccountManager, lchownTree, SYSTEM_ACCOUNTS_ROOT } from "./accounts";
import { ActivityLog } from "./activity";
import {
  AccountUsers,
  type AgentUser,
  AgentUsers,
  agentGid,
  authEgressPrefix,
  denySchedulers,
  ensureGitCacheUser,
  GIT_CACHE_DIR,
  grantGitCache,
  keepContainers,
  readAgentUsers,
  rootlessContainers,
  stopContainers,
  systemLauncher,
  trustedNetworkLauncher,
} from "./agent-users";
import { BrainManager } from "./brain";
import { CodexAppServers } from "./brain-codex-app";
import { BrowserManager } from "./browser";
import { ensureBrowserBindPolicy, prepareAgents } from "./browser-bind-policy";
import { BrowserViews } from "./browser-views";
import {
  accessToStore,
  configPath,
  connectUrl,
  DEFAULT_AGENT_UID_RANGE,
  effectiveAccess,
  expandHome,
  normalizeServerUrl,
  normalizeStored,
  pairedConfig,
  pauseOf,
  type RunnerConfig,
  readStoredConfig,
  type StoredConfig,
  watchConfig,
  writeConfig,
} from "./config";
import { type ConnectionOutcome, type Dial, RunnerConnection } from "./connection";
import { DesktopManager } from "./desktop";
import { DesktopSessions, type DesktopUser, runnerUser, systemDesktopUser } from "./desktop-session";
import { EgressObservation, probeEgress } from "./egress";
import { NetworkChangingError, RUNNER_VERSION, RunnerError } from "./errors";
import { cachedExecutors, EXECUTORS_TTL_MS, type ExecutorRun } from "./executors";
import { systemGitCache } from "./git";
import type { HandlerContext, RequestObserver, RequestOutcome } from "./handlers";
import { IphoneSetup, type IphoneSetupOptions } from "./iphone-setup";
import { currentProcess, isCompiled, selfCommand } from "./launch";
import { tailLines } from "./logfile";
import { LoopbackGuard, loopbackEndpoints, runnerEndpoints } from "./loopback-guard";
import { McpBridge, type McpTaskInfo, mcpSocketPath } from "./mcp";
import {
  AgentNetworks,
  desktopUsesHostNetwork,
  type NetworkConfig,
  NetworkDrain,
  type NetworkProcess,
  networkConfig,
  networkKey,
  readNetworkPins,
  readNetworkProcesses,
  readNetworkTransitions,
  uidHasOtherProcesses,
  writeNetworkState,
} from "./network-state";
import { type CachedLogo, logoDataUrl, readCachedLogo, removeCachedLogo, syncOrgLogo } from "./org-logo";
import { type DeviceGrant, devicePair, type FetchFn, LINK_CODE, PairingError, uniqueWorkspace } from "./pairing";
import { agentId8, agentWorkspace } from "./paths";
import { PhoneManager, type PhoneManagerOptions } from "./phones";
import { agentSecrets, dropStoredSiteSecrets, secretValue } from "./secrets";
import { AGENTS_CGROUP } from "./service";
import {
  ensureSingleShared,
  ensureSystemShared,
  SHARED_SIZE_MS,
  type SharedSpec,
  sharedSizeGb,
  systemShared,
  withShared,
} from "./shared-folder";
import { prepareSystemStartPage } from "./start-page";
import { DataSockets, RELAYED_FILE, RelayCount } from "./streams";
import {
  launchWorker,
  Supervisor,
  type SupervisorOptions,
  type WorkerDesktop,
  type WorkerDesktopUse,
  type WorkerState,
} from "./supervisor";
import { type SettledTask, TaskManager } from "./tasks";
import { runnerTerminalUser, systemTerminalUser, Terminals, type TerminalUser } from "./terminal";
import { appleToolchains, cachedToolchains, TOOLCHAINS_FILE } from "./toolchains";

/**
 * The runner's long-lived core, shared by `agentes-runner start` (terminal,
 * OS service) and `agentes-runner app` (the desktop app's child, ADR 0036):
 *
 * - `config.json` is the single source of settings. It is watched; a change
 *   from the app, a terminal command or an editor is applied at once (pause,
 *   access, limits), and a new pairing reconnects.
 * - One session per pairing: the task journal, brain processes, the local
 *   MCP endpoint and the connection to the server. Background tasks outlive
 *   sessions and the runner (ADR 0029).
 * - Pause (protocol 9) and access (protocol 10) live in the config; changes
 *   go to the server (`runner.state`, `access.changed`) and to the app.
 * - Every request becomes a job for the app's "now" and a line in the local
 *   activity log (secrets masked).
 */

export const DEFAULT_LIMITS = {
  maxConcurrentTasks: 3,
  taskMaxSeconds: 4 * 3600,
  brainIdleMinutes: 3,
  brainMaxProcesses: 1,
} as const;

/** Bounds for `config.set` (the app's Preferences). */
const LIMIT_BOUNDS: Record<keyof typeof DEFAULT_LIMITS, [number, number]> = {
  maxConcurrentTasks: [1, 20],
  taskMaxSeconds: [60, 24 * 3600],
  brainIdleMinutes: [1, 24 * 60],
  brainMaxProcesses: [1, 10],
};

/** Error codes that mean "refused here" in the activity log (not "it broke"). */
const REFUSED = new Set(["paused", "not_allowed", "exec_disabled", "outside_workspace"]);

/** How often the agents' browsers are looked at again for the app (one left idle stops counting as open). */
const BROWSER_STATE_POLL_MS = 5000;

export function machineOs(): MachineOs {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

/** The workspace folder, created, as a real path. */
export function prepareWorkspace(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

/**
 * The config after a device-code pairing. Limits of an earlier pairing of
 * this home stay; access starts from `tools` with no folders, except when
 * the server gave back the same machine (a reconnect, or a workspace's computer
 * moved to new hardware with its files): its folders, tools, allowed services
 * and pause stay.
 * The mode always stays: a system home paired again must never become a
 * root runner that does agents' work itself.
 */
export function configFromGrant(
  prev: StoredConfig | null,
  input: { server: string; grant: DeviceGrant; workspace: string; name?: string; tools: RunnerTools; desktop: boolean },
): StoredConfig {
  const { grant, tools } = input;
  const same = prev?.machineId === grant.machineId && prev?.server === input.server;
  return {
    ...(prev?.mode ? { mode: prev.mode } : {}),
    ...(prev?.agentUidRange ? { agentUidRange: prev.agentUidRange } : {}),
    ...(prev?.networkLauncher ? { networkLauncher: prev.networkLauncher } : {}),
    ...(prev?.networkMark ? { networkMark: prev.networkMark } : {}),
    ...(prev?.networkDrainSeconds ? { networkDrainSeconds: prev.networkDrainSeconds } : {}),
    ...(prev?.networkRevision !== undefined ? { networkRevision: prev.networkRevision } : {}),
    ...(prev?.networkAuthRoute ? { networkAuthRoute: prev.networkAuthRoute } : {}),
    ...(prev?.claudeSharedLogin ? { claudeSharedLogin: prev.claudeSharedLogin } : {}),
    ...(prev?.maxConcurrentTasks ? { maxConcurrentTasks: prev.maxConcurrentTasks } : {}),
    ...(prev?.taskMaxSeconds ? { taskMaxSeconds: prev.taskMaxSeconds } : {}),
    ...(prev?.brainIdleMinutes ? { brainIdleMinutes: prev.brainIdleMinutes } : {}),
    ...(prev?.brainMaxProcesses ? { brainMaxProcesses: prev.brainMaxProcesses } : {}),
    ...(input.desktop || prev?.managedBy === "desktop" ? { managedBy: "desktop" as const } : {}),
    server: input.server,
    machineId: grant.machineId,
    name: grant.name || input.name || os.hostname(),
    token: grant.token,
    workspace: input.workspace,
    exec: tools.commands,
    ...(grant.org.id ? { orgId: grant.org.id } : {}),
    ...(grant.org.name ? { orgName: grant.org.name } : {}),
    access: same && prev?.access ? prev.access : { folders: [], tools },
    ...(same && prev?.services?.length ? { services: prev.services } : {}),
    ...(same && prev?.paused ? { paused: prev.paused } : {}),
  };
}

/**
 * The machine this home was on `server`, to reconnect it instead of making a
 * new one (the id stays in the config after a refusal and after "leave"),
 * with the token it had there: the server reconnects a machine only for a
 * computer that proves it held that machine's token (ADR 0036 §5).
 * Undefined for another server, a home never paired, or no token kept.
 */
export function previousMachineFor(
  prev: StoredConfig | null,
  server: string,
): { machineId: string; token: string } | undefined {
  const token = prev?.token ?? prev?.previousToken;
  return prev?.machineId && prev.server === server && token ? { machineId: prev.machineId, token } : undefined;
}

/** What `POST /api/machines/device` is told about this computer. */
export function deviceInfo(name?: string, previous?: { machineId: string; token: string }) {
  return {
    ...(name ? { name } : {}),
    os: machineOs(),
    arch: os.arch(),
    hostname: os.hostname(),
    version: RUNNER_VERSION,
    ...(previous ? { previousMachineId: previous.machineId, previousToken: previous.token } : {}),
  };
}

/** `16:24`, or `Oct 18 16:24` when not today (local time; the person's own computer). */
export function shortTime(iso: string, now = Date.now()) {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hm;
  return `${d.toLocaleString("en", { month: "short" })} ${d.getDate()} ${hm}`;
}

/** Who agents' commands run as on this computer (`os.userInfo` throws for a uid with no passwd entry). */
const OS_USER = (() => {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
})();

const firstLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

interface Session {
  config: RunnerConfig;
  network: NetworkConfig;
  changeNetwork(value: NetworkConfig): boolean;
  workspaceReal: string;
  tasks: TaskManager;
  brains: BrainManager;
  /** System mode: the CLIs of Claude sign-ins several agents share, run by root. */
  accountBrains: AccountBrains | null;
  codexApp: CodexAppServers;
  mcp: McpBridge;
  browser: BrowserManager;
  /** Desktop and terminal streams (ADR 0058): they end with the session. */
  streams: DataSockets;
  /** The agents' use of their desktops (ADR 0062): its helpers end with the session, the desktops don't. */
  desktopUse: DesktopManager;
  connection: RunnerConnection;
  /** System mode: the agents' workers, where all their work runs. */
  supervisor: Supervisor | null;
  /** System mode: each agent's OS user, made on its first request. */
  agentUser: ((agent: AgentScope) => AgentUser) | null;
}

export interface DaemonOptions {
  home: string;
  mode: "start" | "app";
  log: (line: string) => void;
  /** App mode: events for the desktop app. */
  onEvent?: (event: ControlEvent) => void;
  /** Terminal mode: lines for the person (a folder request and the command that allows it). */
  print?: (line: string) => void;
  /** App mode: the runner's log file (diagnostics read its end). */
  logFile?: string;
  /** Where new app-mode workspaces go (default `~/agentes`). */
  workspaceBase?: string;
  /** How this runner starts itself (default: this process; compiled or runtime + script). */
  self?: { command: string[]; compiled: boolean };
  /** Tests. */
  dial?: Dial;
  fetch?: FetchFn;
  /** Tests: an address observation without network or a real agent process. */
  probeEgress?: typeof probeEgress;
  executors?: () => RunnerInfo["executors"];
  /** Tests: how the coding CLIs' looks run (the background cache stays real). */
  executorRun?: ExecutorRun;
  /** How the accounts' CLIs start (default `claude` / `codex`). */
  accountCommands?: Partial<Record<AccountKind, string[]>>;
  now?: () => number;
  watch?: boolean;
  caffeinate?: boolean;
  pairSleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Tests (system mode): how agents' users are found and their workers started. */
  workers?: Pick<SupervisorOptions, "user" | "start">;
  /**
   * Tests (system mode): where the account folders are, how one is handed to an agent's user, and what goes before
   * root's Claude CLIs (none when left out).
   */
  systemAccounts?: {
    root: string;
    chown: (file: string, uid: number, gid: number) => Promise<void>;
    authEgress?: () => string[] | null;
  };
  /** Tests (system mode): the sign-ins' users, and the self-check that opens Claude's own login for all agents. */
  accountUsers?: Pick<
    AccountUsers,
    "sweep" | "stopScopes" | "sweepAgent" | "launcher" | "remove" | "ensure" | "room" | "bridge" | "carry"
  >;
  selfCheck?: () => Promise<string | null>;
  /** Tests: how soon a failed self-check runs again (`SELF_CHECK_RETRY_MS`). */
  selfCheckRetryMs?: number;
  /** Tests: what `hello.toolchains` says instead of a look at the computer's tools. */
  toolchains?: () => RunnerToolchains | undefined;
  /** Tests: the phones' tools and folders, or `false` for none (a single-user runner looks for phones). */
  phones?: Partial<PhoneManagerOptions> | false;
  /** Tests: the iPhone setup's tools and folders. */
  iphone?: Partial<IphoneSetupOptions>;
}

/** What a task is in its activity words: a shell task's command, or the CLI that works it (the app names it). */
const taskWhat = (job: Pick<ControlJob, "summary" | "said">): Record<string, string> =>
  job.said?.executor ? { executor: job.said.executor } : { what: job.summary };

export class RunnerDaemon implements RequestObserver {
  private stored: StoredConfig | null = null;
  private config: RunnerConfig | null = null;
  /** The config text last read or written (the watcher skips our own writes). */
  private lastText: string | null = null;
  private session: Session | null = null;
  private reconciling: Promise<void> = Promise.resolve();
  /** A session that ended on its own, still closing (its MCP socket must be gone before the next listens). */
  private closing: Promise<void> = Promise.resolve();
  private connState: ControlStatus["connection"] = "unpaired";
  private refused: { token: string; reason: ConnectionOutcome["reason"] } | null = null;
  private agents: MachineAgent[] = [];
  private egress = new EgressObservation();
  private probingEgress = false;
  private observeEgress = false;
  private refusedNetworkKey: string | null = null;
  private networkWriteFailed = false;
  private egressGeneration = 0;
  private readonly uidNetworks: AgentNetworks;
  private readonly networkUsers = new Map<number, AgentUser>();
  private writtenNetworkPins = "";
  private readonly networkDrain: NetworkDrain;
  private sentNetworkTransition = "";
  private readonly retiredNetworkAgents = new Set<string>();
  private readonly networkRetirementWarnings = new Set<string>();
  private networkProcesses: NetworkProcess[] | null = null;
  private readonly jobs = new Map<string, ControlJob>();
  readonly activity: ActivityLog;
  private readonly requests: AccessRequests;
  private pairing: AbortController | null = null;
  private stopWatch: (() => void) | null = null;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  /** Protocol 22: how busy this computer got over the last day (rides on `pong`). */
  private readonly load = new LoadWindow();
  /** The agents' browsers' last day of traffic (protocol 23). */
  private readonly traffic = new TrafficWindow();
  /** The computer's shared folder (ADR 0115) once the session made it, and its last measured size. */
  private shared: string | null = null;
  private sharedGb: number | undefined;
  /** System mode: what this process relayed to the server, per stream (`relayed.json`). */
  private readonly relayed = new RelayCount();
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private stopping = false;
  private booted = false;
  private firstSession = true;
  private startWaiter: ((o: ConnectionOutcome) => void) | null = null;
  /** Job and activity events, in order (redaction is async). */
  private chain: Promise<void> = Promise.resolve();
  private statusQueued = false;
  /** Stamps every status (events and replies) so the app can tell the newest (`ControlStatus.seq`). */
  private statusSeq = 0;
  private lastExecutors = "";
  /** The browsers last reported to the app (JSON), so a status goes out only when they change. */
  private lastBrowsers = "[]";
  /** The organization's logo cached in `<home>/org-logo.json` (app mode, refreshed on each `welcome`). */
  private logo: CachedLogo | null = null;
  private logoSync: Promise<void> | null = null;
  private readonly self: { command: string[]; compiled: boolean };
  private readonly executors: () => NonNullable<RunnerInfo["executors"]>;
  /** False until the first look on a new install: `hello` then leaves the CLIs out, so the server keeps "unknown". */
  private readonly executorsKnown: () => boolean;
  private readonly now: () => number;
  /** The computer brains' accounts (ADR 0041): machine-wide, kept across pairings and sessions. */
  readonly accounts: AccountManager;
  /** System mode: each Claude login for all agents has its own OS user. */
  private readonly accountUsers: NonNullable<DaemonOptions["accountUsers"]> | null;
  /** The self-check's last answer: null passed, a string why not. Undefined until it ran; only with the switch on. */
  private sharedLoginBlocked: string | null | undefined;
  private sharedLoginRetry: ReturnType<typeof setTimeout> | null = null;
  /** Deleted agents cleared from the sign-ins by this process: each frame lists them all again. */
  private readonly swept = new Set<string>();
  /** The agents' desktops (ADR 0058): they outlive sessions and this process. */
  readonly desktops: DesktopSessions;
  /** Terminals people open as an agent (ADR 0058 §6). */
  readonly terminals: Terminals;
  /** The refs each agent's desktop use gave out, across sessions: a number never comes back for another element. */
  private readonly desktopRefsGiven = new Map<string, { last: number }>();
  /** The phones this computer reaches (single-user runners): their locks outlive a reconnect. */
  private phones: PhoneManager | null = null;
  /** The phones the last `hello` carried (JSON). */
  private toldPhones = "[]";
  /** What this computer builds with, cached (`hello.toolchains`); looked at from the first session on. */
  private toolchains: { get(): RunnerToolchains | undefined; stop(): void } | null = null;
  /** The Mac's side of an iPhone's setup (the desktop app asks), made on its first request. */
  private iphone: IphoneSetup | null = null;

  constructor(private readonly opts: DaemonOptions) {
    this.uidNetworks = new AgentNetworks({}, readNetworkPins(opts.home));
    this.networkDrain = new NetworkDrain(readNetworkTransitions(opts.home));
    this.activity = new ActivityLog(opts.home);
    this.now = opts.now ?? Date.now;
    this.requests = new AccessRequests(opts.home, this.now);
    const proc = currentProcess();
    this.self = opts.self ?? { command: selfCommand(proc), compiled: isCompiled(proc) };
    const exec =
      opts.executors ??
      cachedExecutors({
        file: path.join(opts.home, "executors.json"),
        ...(opts.executorRun ? { run: opts.executorRun } : {}),
        onChange: () => this.executorsChanged(),
      });
    this.executors = () => exec() ?? {};
    this.executorsKnown = () => !("known" in exec) || exec.known === true;
    // System mode is set at install and kept through pairings: account folders are lent to agents' users.
    let system = false;
    try {
      system = readStoredConfig(opts.home)?.mode === "system";
    } catch {
      // an unreadable config starts unpaired
    }
    const lent = system
      ? (opts.systemAccounts ?? { root: SYSTEM_ACCOUNTS_ROOT, chown: lchownTree, authEgress: () => authEgressPrefix() })
      : null;
    const accountUsers = system ? (opts.accountUsers ?? new AccountUsers({ home: opts.home, log: opts.log })) : null;
    this.accountUsers = accountUsers;
    this.accounts = new AccountManager({
      root: lent?.root ?? path.join(opts.home, "accounts"),
      ...(lent ? { lending: { chown: lent.chown } } : {}),
      ...(lent?.authEgress ? { authEgress: lent.authEgress } : {}),
      ...(accountUsers
        ? {
            sharedLogin: {
              ready: () => this.sharedLoginReady,
              launcher: (id: string) => accountUsers.launcher(id),
              remove: (id: string) => accountUsers.remove(id),
            },
          }
        : {}),
      orgId: () => this.config?.orgId,
      log: opts.log,
      ...(opts.accountCommands ? { commands: opts.accountCommands } : {}),
      onChange: () => {
        this.queueStatus();
        // The server learns at once (a sign-in or removal from the desktop app, a status or usage that changed).
        const accounts = this.accounts.snapshot();
        if (accounts) this.send({ type: "accounts.changed", accounts, ...this.ownUsage() });
        // One removed: its agents' workers close what still runs with it.
        this.session?.supervisor?.stateChanged();
      },
    });
    const daemon = this;
    this.desktops = new DesktopSessions({
      home: opts.home,
      log: opts.log,
      user: (agent) => this.desktopUser(agent),
      // System mode: the agents' Chromes are their workers'.
      inUse: (agentId) => (this.session?.supervisor ?? this.session?.browser)?.onDesktopInUse(agentId) ?? false,
      onViewers: () => this.session?.supervisor?.stateChanged(),
      openBrowser: (agent, installing) => this.openBrowser(agent, installing),
      runner: this.self.command,
      shared: () => this.shared,
      get agentUsers() {
        return daemon.session?.agentUser != null;
      },
    });
    this.terminals = new Terminals({
      log: opts.log,
      user: (agent) => this.terminalUser(agent),
      get agentUsers() {
        return daemon.session?.agentUser != null;
      },
    });
  }

  /** As whom the agent's desktop runs: the runner's own user, or in system mode the agent's own (its launcher). */
  private async desktopUser(agent: AgentScope): Promise<DesktopUser> {
    const agentUser = this.session?.agentUser;
    if (!agentUser) return runnerUser(this.opts.home, await this.agentFolder(agent), agent);
    const u = agentUser(agent);
    this.startContainers(u);
    return systemDesktopUser(systemLauncher(u), { uid: u.uid, gid: agentGid(u.user) });
  }

  /** Its containers service (ADR 0169), as before its worker: a desktop's or a terminal's docker finds it. */
  private startContainers(u: AgentUser) {
    if (this.opts.workers || !rootlessContainers()) return;
    const problem = keepContainers(u, this.containersAllowed(u.id));
    if (problem) this.opts.log(`[${u.user}] containers unavailable: ${problem}`);
  }

  /** The agents frame lets it have a containers service (`MachineAgent.containers`). */
  private containersAllowed(agentId: string) {
    return this.agents.find((a) => a.id === agentId)?.containers === true;
  }

  /** Its switch is on, and the last check made under that switch passed. */
  private get sharedLoginReady() {
    return this.sharedLoginBlocked === null && this.stored?.claudeSharedLogin !== undefined;
  }

  /** Who stays on which sign-in: nobody while that login may not run, so no idle CLI is left on its store. */
  private keepHosted(agents: readonly MachineAgent[]) {
    const ready = this.sharedLoginReady;
    const hosted = this.session?.accountBrains?.brains;
    for (const a of agents) hosted?.keepAccount(ready ? (a.account ?? null) : null, ready ? a.accounts : [], a.id);
  }

  /**
   * Claude's own login for all agents is offered only while this says so. `hello` carries the answer, so a new one
   * reaches the server with a new connection; with the switch on it changes rarely, and turns resume from there.
   */
  private async checkSharedLogin() {
    const users = this.accountUsers;
    const config = this.stored;
    if (!users || !config?.claudeSharedLogin) return;
    const verdict = await (
      this.opts.selfCheck?.() ?? accountSelfCheck({ config, users, home: this.opts.home, relay: this.self.command })
    ).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
    // A pass holds for what it checked; the config that replaced this one asked again (`applyStored`).
    if (JSON.stringify(this.stored?.claudeSharedLogin) !== JSON.stringify(config.claudeSharedLogin)) return;
    const before = this.sharedLoginBlocked;
    this.sharedLoginBlocked = verdict;
    if (this.sharedLoginRetry) clearTimeout(this.sharedLoginRetry);
    this.sharedLoginRetry = null;
    // A failure can be the machine's own moment (a busy boot, a relay starting): waiting for the next 6-hourly run
    // would withhold the method that long.
    if (verdict && !this.stopped) {
      this.sharedLoginRetry = setTimeout(
        () => void this.checkSharedLogin(),
        this.opts.selfCheckRetryMs ?? SELF_CHECK_RETRY_MS,
      );
      this.sharedLoginRetry.unref?.();
    }
    if (verdict) this.opts.log(`Claude's own login for all agents: ${verdict}`);
    this.keepHosted(this.agents);
    if (verdict !== before) {
      // A look taken before this answer couldn't ask the sign-ins' CLIs (status unknown) and would stand for the
      // list's whole TTL.
      this.accounts.invalidate();
      this.session?.connection.reconnect();
    }
  }

  /**
   * System mode: the agent's desktop for its worker, which asks only while serving a request that uses it,
   * behind the same switches the worker checks: desktop use needs the commands switch, its Chrome there the
   * browser's.
   */
  private async workerDesktop(agent: AgentScope, use: WorkerDesktopUse): Promise<WorkerDesktop> {
    const { tools } = this.access();
    if (tools.desktop !== true || tools[use === "desktop" ? "commands" : "browser"] !== true) {
      throw new RunnerError(
        "not_allowed",
        use === "desktop"
          ? "Desktop use needs this computer's desktop and commands switches on"
          : "The browser on the agent's desktop needs this computer's desktop and browser switches on",
      );
    }
    const started = await this.desktops.ensure(agent, { chrome: use === "browser" });
    const s = this.desktops.session(agent.id);
    if (!s) throw new RunnerError("desktop_unavailable", "The agent's desktop stopped. Try again.");
    return { ...started, xauthority: s.xauthority, home: s.home };
  }

  /**
   * Browser on the agent's desktop (`desktop-browser.ts`): its own Chrome there, behind the switches that put it
   * there (ADR 0058 §7), on a computer that isn't paused; in system mode its worker's (`Supervisor.showBrowser`).
   */
  async openBrowser(agent: AgentScope, installing: () => void): Promise<void> {
    const session = this.session;
    if (!session) {
      throw new RunnerError(
        "internal",
        "This computer isn't connected to agentes.chat right now. Try again in a minute.",
      );
    }
    const { tools } = this.access();
    if (tools.browser !== true || tools.desktop !== true) {
      throw new RunnerError("not_allowed", "The browser is turned off on this computer");
    }
    if (this.pauseState().paused) {
      throw new RunnerError("paused", "This computer is paused. Open the browser again once it resumes.");
    }
    if (session.supervisor) return session.supervisor.showBrowser(agent, installing);
    return session.browser.show(agent, await this.agentFolder(agent), installing);
  }

  /** As whom a terminal on the agent's computer runs, like its desktop. */
  private async terminalUser(agent: AgentScope): Promise<TerminalUser> {
    const agentUser = this.session?.agentUser;
    if (!agentUser) return runnerTerminalUser(await this.agentFolder(agent));
    const u = agentUser(agent);
    this.startContainers(u);
    return systemTerminalUser(systemLauncher(u), agent);
  }

  /** The agent's folder in the connected workspace. */
  private async agentFolder(agent: AgentScope) {
    const workspace = this.session?.workspaceReal;
    if (!workspace) throw new RunnerError("internal", "This runner isn't connected to a workspace");
    return agentWorkspace(workspace, agent);
  }

  get home() {
    return this.opts.home;
  }

  get paired() {
    return this.config !== null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Loads the config, starts watching it, connects when paired. */
  start() {
    if (this.booted) return;
    this.booted = true;
    this.agents = readAgents(this.opts.home);
    this.logo = readCachedLogo(this.opts.home);
    this.desktops.restore();
    let stored: StoredConfig | null = null;
    try {
      stored = readStoredConfig(this.opts.home);
    } catch (err) {
      this.opts.log(`config.json can't be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.applyStored(stored, null, true);
    if (this.accountUsers) {
      this.accountUsers.sweep();
      void this.checkSharedLogin();
      const check = setInterval(() => void this.checkSharedLogin(), SELF_CHECK_EVERY_MS);
      check.unref?.();
      this.timers.push(check);
    }
    if (this.opts.watch !== false) {
      this.stopWatch = watchConfig(this.opts.home, (text) => this.onConfigFile(text));
      const expiry = setInterval(() => this.expireRequests(), 60_000);
      expiry.unref?.();
      this.timers.push(expiry);
    }
    // A browser left idle closes by itself: the tray learns within a few seconds.
    const browsers = setInterval(() => this.browsersChanged(), BROWSER_STATE_POLL_MS);
    browsers.unref?.();
    this.timers.push(browsers);
    // A CLI installed while the runner stays up: with no app asking for the status, nothing else looks again.
    const clis = setInterval(() => this.executors(), EXECUTORS_TTL_MS);
    clis.unref?.();
    this.timers.push(clis);
    const sample = () => {
      const s = this.session;
      this.traffic.add((s?.supervisor ?? s?.browser)?.takeTraffic() ?? { up: 0, down: 0 });
      void sampleLoad()
        .then((l) => {
          const oomKills = cgroupCounters(path.join(AGENTS_CGROUP, "memory.events"))?.oom_kill;
          const workspace = this.session?.workspaceReal;
          return (workspace ? diskSpace(workspace) : Promise.resolve(null)).then((d) =>
            this.load.add(l && oomKills !== undefined ? { ...l, oomKills } : l, undefined, {
              ...diskFigures(d),
              ...(this.sharedGb === undefined ? {} : { sharedGb: this.sharedGb }),
            }),
          );
        })
        .catch(() => undefined);
    };
    sample();
    const load = setInterval(sample, LOAD_SAMPLE_MS);
    load.unref?.();
    this.timers.push(load);
    const egress = setInterval(() => void this.sampleEgress(), 30_000);
    egress.unref?.();
    this.timers.push(egress);
    const network = setInterval(() => {
      this.observeNetwork();
      if (this.session && this.config && networkKey(this.session.network) !== networkKey(this.config))
        void this.reconcile();
    }, 2000);
    network.unref?.();
    this.timers.push(network);
    const sizes = setInterval(() => this.measureShared(), SHARED_SIZE_MS);
    sizes.unref?.();
    this.timers.push(sizes);
    // System mode: for an operator's network guard, at most once a minute.
    const relayed = setInterval(() => {
      if (!this.session?.supervisor) return;
      try {
        this.relayed.save(path.join(this.opts.home, RELAYED_FILE));
      } catch (err) {
        this.opts.log(`${RELAYED_FILE}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 60_000);
    relayed.unref?.();
    this.timers.push(relayed);
    this.expireRequests();
  }

  /**
   * Terminal mode: runs until the server refuses this runner for good (or
   * `stop()`). Throws when the first session can't start (a workspace that
   * can't be created).
   */
  async runStart(): Promise<ConnectionOutcome> {
    const outcome = new Promise<ConnectionOutcome>((resolve) => {
      this.startWaiter = resolve;
    });
    this.start();
    await this.reconciling;
    return outcome;
  }

  /** Stops everything; background tasks go on (ADR 0029). */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopWatch?.();
    for (const t of this.timers) clearInterval(t);
    if (this.sharedLoginRetry) clearTimeout(this.sharedLoginRetry);
    this.desktops.close();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.pairing?.abort();
    this.pairing = null;
    const s = this.session;
    this.session = null;
    if (s) await this.closeSession(s);
    await this.phones?.stop();
    this.iphone?.stop();
    this.toolchains?.stop();
    await this.accounts.close().catch(() => undefined);
    await this.chain.catch(() => undefined);
    this.startWaiter?.({ exitCode: 0, reason: "stopped", message: "stopped" });
    this.startWaiter = null;
  }

  /** The app quits: no new work, what runs gets up to `graceMs` to finish, then everything stops. */
  async shutdown(graceMs = 5000) {
    this.stopping = true;
    const deadline = this.now() + graceMs;
    while ([...this.jobs.values()].some((j) => !j.background) && this.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.stop();
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  private onConfigFile(text: string | null) {
    if (this.stopped || text === this.lastText) return;
    if (text === null) {
      this.opts.log("config.json was removed");
      this.applyStored(null, null, false);
      return;
    }
    let next: StoredConfig;
    try {
      next = normalizeStored(JSON.parse(text) as Record<string, unknown>);
    } catch {
      this.opts.log("config.json changed but isn't valid JSON; keeping the last good settings");
      this.lastText = text;
      return;
    }
    this.opts.log("config.json changed; applying it");
    this.applyStored(next, text, false);
  }

  /** Writes the config (mode 600, atomic) and applies it right away. */
  private write(next: StoredConfig) {
    const text = writeConfig(next, this.opts.home);
    this.applyStored(next, text, false);
  }

  private writeAccess(next: RunnerAccess) {
    // The shared folder's grant is the session's (`access()`), never the config's.
    const access = {
      ...next,
      folders: next.folders.filter((f) => f.path !== this.shared && !f.agents.includes(ALL_AGENTS)),
    };
    this.write({ ...(this.stored ?? {}), access: accessToStore(this.stored, access), exec: next.tools.commands });
  }

  private applyStored(next: StoredConfig | null, text: string | null, initial: boolean) {
    const prev = this.stored;
    const loginMethods = this.accounts.claudeLoginMethods();
    this.stored = next;
    this.lastText = text;
    let paired: RunnerConfig | null = null;
    try {
      paired = next ? pairedConfig(next, configPath(this.opts.home)) : null;
    } catch (err) {
      this.opts.log(err instanceof Error ? err.message : String(err));
    }
    this.config = paired;
    if (!paired && this.connState !== "unpaired") this.connState = "unpaired";
    if (paired && this.connState === "unpaired") this.connState = "connecting";

    // The stored field, not the effective state: an `until` that just passed is still news (auto-resume).
    const nextPause = pauseOf(next, this.now());
    if (!initial && JSON.stringify(prev?.paused ?? null) !== JSON.stringify(next?.paused ?? null)) {
      this.send({ type: "runner.state", paused: nextPause });
      if (nextPause.paused) this.stopHosted("This computer was paused.");
      this.record({
        kind: "pause",
        summary: nextPause.paused
          ? nextPause.until
            ? `paused until ${shortTime(nextPause.until, this.now())}`
            : "paused"
          : "resumed",
        said: !nextPause.paused
          ? { key: "resumed" }
          : nextPause.until
            ? { key: "pausedUntil", until: nextPause.until }
            : { key: "paused" },
        result: "ok",
      });
    }
    this.armResume();
    // The switch goes with its route, so a CLI left running would go out directly.
    if (!initial && prev?.claudeSharedLogin && !next?.claudeSharedLogin) {
      this.stopHosted("This computer's Claude login for all agents was turned off.");
    }
    if (!initial && JSON.stringify(prev?.claudeSharedLogin) !== JSON.stringify(next?.claudeSharedLogin)) {
      this.sharedLoginBlocked = undefined;
      this.keepHosted(this.agents);
      const methods = this.accounts.claudeLoginMethods();
      if (JSON.stringify(methods) !== JSON.stringify(loginMethods)) this.session?.connection.reconnect();
      void this.checkSharedLogin();
    }

    const prevAccess = withShared(effectiveAccess(prev), this.shared);
    const nextAccess = withShared(effectiveAccess(next), this.shared);
    if (!initial && JSON.stringify(prevAccess) !== JSON.stringify(nextAccess)) {
      this.send({ type: "access.changed", access: nextAccess });
      this.emit({ kind: "access.changed", access: nextAccess });
      for (const { summary, said } of this.describeAccessChange(prevAccess, nextAccess)) {
        this.record({ kind: "access", summary, said, result: "ok" });
      }
      this.resolveSatisfied(nextAccess);
      // The browser (or desktop) switch went off: the agents' browsers (or desktops) close now, not when next used.
      if (prevAccess.tools.browser === true && nextAccess.tools.browser !== true) {
        void this.session?.browser.closeAll();
      }
      // On: what the first command would install is installed now (system mode's comes with its installer).
      if (prevAccess.tools.browser !== true && nextAccess.tools.browser === true && !this.session?.supervisor) {
        void this.session?.browser.prepareInBackground();
      }
      if (prevAccess.tools.desktop === true && nextAccess.tools.desktop !== true) void this.desktops.stopAll();
      if (prevAccess.tools.terminal === true && nextAccess.tools.terminal !== true) this.terminals.closeAll();
      // Desktop use needs both: its helpers stop with either.
      const use = (a: RunnerAccess) => a.tools.desktop === true && a.tools.commands;
      if (use(prevAccess) && !use(nextAccess)) this.session?.desktopUse.stopAll();
    }

    if (this.session && paired) {
      this.session.tasks.setLimits({
        maxConcurrent: paired.maxConcurrentTasks ?? DEFAULT_LIMITS.maxConcurrentTasks,
        defaultMaxSeconds: paired.taskMaxSeconds ?? DEFAULT_LIMITS.taskMaxSeconds,
      });
      const brainLimits = {
        idleMs: (paired.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes) * 60_000,
        maxProcesses: paired.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
      };
      this.session.brains.setLimits(brainLimits);
      this.session.accountBrains?.brains.setLimits(brainLimits);
      this.session.codexApp.setLimits(brainLimits);
      this.session.supervisor?.stateChanged();
    }
    this.queueStatus();
    void this.reconcile();
  }

  /** Every CLI root hosts stops, its turn first. */
  private stopHosted(why: string) {
    this.session?.accountBrains?.dropTurns(new RunnerError("dropped", why));
    for (const u of readAgentUsers(this.opts.home)) this.accountUsers?.stopScopes(u.uid);
  }

  /** System mode: what each agent's worker must know about this computer. */
  private workerState(): WorkerState {
    const c = this.config;
    return {
      access: this.access(),
      paused: this.pauseState(),
      privateNetwork: Boolean(
        (this.session?.network ?? c)?.networkLauncher || (this.session?.network ?? c)?.networkMark,
      ),
      ...(c ? { commitHost: new URL(c.server).hostname } : {}),
      limits: {
        maxConcurrentTasks: c?.maxConcurrentTasks ?? DEFAULT_LIMITS.maxConcurrentTasks,
        taskMaxSeconds: c?.taskMaxSeconds ?? DEFAULT_LIMITS.taskMaxSeconds,
        brainIdleMinutes: c?.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes,
        brainMaxProcesses: c?.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
      },
    };
  }

  /** Resumes on its own when `until` passes (also after a restart). */
  private armResume() {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    const until = this.stored?.paused?.until;
    if (!until || this.stopped) return;
    const ms = Date.parse(until) - this.now();
    if (ms <= 0) {
      // Already past: written once, so the file says the truth too.
      queueMicrotask(() => {
        if (this.stored?.paused?.until === until) this.writeResume();
      });
      return;
    }
    this.resumeTimer = setTimeout(() => this.armResume(), Math.min(ms, 2 ** 31 - 1));
    this.resumeTimer.unref?.();
  }

  private writeResume() {
    if (!this.stored?.paused) return;
    const { paused: _paused, ...rest } = this.stored;
    this.write(rest);
  }

  private describeAccessChange(a: RunnerAccess, b: RunnerAccess): { summary: string; said: ActivitySaid }[] {
    const out: { summary: string; said: ActivitySaid }[] = [];
    const label: Record<keyof RunnerTools, string> = {
      claude: "Claude Code",
      codex: "Codex",
      cursor: "Cursor",
      opencode: "OpenCode",
      grok: "Grok Build",
      antigravity: "Antigravity CLI",
      commands: "commands",
      browser: "the browser",
      desktop: "the agents' desktops",
      terminal: "the terminal",
    };
    for (const t of TOOL_NAMES)
      if ((a.tools[t] === true) !== (b.tools[t] === true)) {
        const on = b.tools[t] === true;
        out.push({
          summary: `${label[t]} turned ${on ? "on" : "off"}`,
          // A product's name stays its name; the app words the rest (`tools.<tool>`).
          said: { key: on ? "toolOn" : "toolOff", tool: t, name: label[t] },
        });
      }
    // Names only: "no agent" is the app's to say (an empty `agents`).
    const named = (ids: string[]) =>
      ids.map((id) => this.agents.find((x) => x.id === id)?.name ?? id.slice(0, 8)).join(", ");
    const names = (ids: string[]) => named(ids) || "no agent";
    for (const f of b.folders) {
      const old = a.folders.find((x) => x.path === f.path);
      const agents = named(f.agents);
      if (!old)
        out.push({
          summary: `allowed ${f.path} for ${names(f.agents)}`,
          said: { key: "folderAllowed", path: f.path, agents },
        });
      else if (JSON.stringify(old.agents) !== JSON.stringify(f.agents))
        out.push({
          summary: `${f.path} now for ${names(f.agents)}`,
          said: { key: "folderAgents", path: f.path, agents },
        });
    }
    for (const f of a.folders)
      if (!b.folders.some((x) => x.path === f.path))
        out.push({ summary: `removed ${f.path}`, said: { key: "folderRemoved", path: f.path } });
    return out;
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  private reconcile(): Promise<void> {
    const run = this.reconciling.catch(() => undefined).then(() => this.reconcileNow());
    this.reconciling = run.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`couldn't start: ${message}`);
      // Terminal mode: a first start that fails ends the process (`runStart` rejects); later ones wait for a fix.
      if (this.opts.mode === "start" && this.firstSession) throw err;
    });
    return this.reconciling;
  }

  private async reconcileNow() {
    if (this.stopped) return;
    await this.closing;
    const want = this.config;
    const s = this.session;
    if (
      s &&
      want &&
      s.config.token === want.token &&
      s.config.server === want.server &&
      s.config.machineId === want.machineId &&
      s.config.workspace === want.workspace
    ) {
      if (s.supervisor && networkKey(s.network) !== networkKey(want)) {
        const next = networkConfig(want);
        if (!this.opts.workers && next.networkLauncher) trustedNetworkLauncher(next.networkLauncher);
        if (!s.changeNetwork(next)) {
          if (this.refusedNetworkKey !== networkKey(next))
            this.opts.log("Network settings are waiting for the local guard");
          this.refusedNetworkKey = networkKey(next);
          return;
        }
        this.refusedNetworkKey = null;
        this.egressGeneration++;
        this.egress.clear();
        s.connection.send({ type: "pong", at: this.now(), egress: { ip: null } });
        s.supervisor.setNetwork(next);
        s.supervisor.stateChanged();
        this.observeNetwork();
        void this.sampleEgress();
      }
      return;
    }
    if (s) {
      this.session = null;
      await this.closeSession(s);
    }
    if (!want) {
      this.queueStatus();
      return;
    }
    // Refused by the server with this token: nothing to retry until it is paired again.
    if (this.refused?.token === want.token) return;
    this.refused = null;
    await this.startSession(want);
    this.firstSession = false;
  }

  private async startSession(config: RunnerConfig) {
    const home = this.opts.home;
    const log = this.opts.log;
    const workspaceReal = prepareWorkspace(config.workspace);
    const network = networkConfig(config);
    this.uidNetworks.set(network);
    this.refreshNetworkProcesses();
    const prepared = new Map<number, string>();
    let guard: LoopbackGuard | undefined;
    // Tests of system mode (`workers`) never touch the computer's groups.
    const sharedSpec =
      config.mode === "system"
        ? this.opts.workers
          ? undefined
          : systemShared(config.managedBy === "host" ? agentId8(config.machineId) : undefined)
        : null;
    this.shared = this.prepareShared(workspaceReal, sharedSpec);
    this.measureShared();
    const secretsDir = path.join(home, "secrets");
    // Site passwords live in memory now (ADR 0144): one an older runner kept on disk goes.
    void dropStoredSiteSecrets(secretsDir);
    const socketPath = mcpSocketPath(home);
    const mcpCommand = { socketPath, command: this.self.command };
    const tasks = new TaskManager({
      mcp: mcpCommand,
      root: path.join(home, "tasks"),
      workspaceReal,
      maxConcurrent: config.maxConcurrentTasks ?? DEFAULT_LIMITS.maxConcurrentTasks,
      defaultMaxSeconds: config.taskMaxSeconds ?? DEFAULT_LIMITS.taskMaxSeconds,
      log,
      agentFolder: (agent) => agentWorkspace(workspaceReal, agent),
      secrets: (agent) => agentSecrets(secretsDir, agent),
      accounts: this.accounts,
      ...(this.self.compiled ? { wrapperCommand: [...this.self.command, "task-wrapper"] } : {}),
      onSettled: (t) => this.taskSettled(t),
      commitHost: () => this.workerState().commitHost,
      ...(this.opts.caffeinate !== undefined ? { caffeinate: this.opts.caffeinate } : {}),
    });
    await tasks.init();
    const brains = new BrainManager({
      root: path.join(home, "brains"),
      mcp: mcpCommand,
      runnerHome: home,
      idleMs: (config.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes) * 60_000,
      maxProcesses: config.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
      accounts: this.accounts,
      log,
    });
    const codexRuns = new Map<string, McpTaskInfo>();
    // Codex turns on long-lived app-servers (live steering); `codex exec` where they can't run.
    const codexApp = new CodexAppServers({
      runs: codexRuns,
      idleMs: (config.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes) * 60_000,
      maxProcesses: config.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
      onRateLimits: (account, rateLimits) =>
        this.accounts.noteCodexRateLimits(account ?? OWN_USAGE_ID.codex, rateLimits),
      log,
    });
    const mcp = new McpBridge({
      socketPath,
      task: (taskId) => tasks.mcpTask(taskId) ?? brains.mcpTask(taskId) ?? codexRuns.get(taskId) ?? null,
      log,
    });
    await mcp
      .listen()
      .catch((err: unknown) => log(`mission tools unavailable: ${err instanceof Error ? err.message : String(err)}`));
    const daemon = this;
    // Frames go out on whatever connection this session has at the time (it reconnects by itself).
    let live: RunnerConnection | null = null;
    // The live views of the agents' browsers (ADR 0040 §7.1): a viewed agent's frames go on a socket of their own.
    const views = new BrowserViews({
      dial: (streamId) => streams.dial(streamId, "browserView"),
      fallback: (frame) => void live?.send(frame),
      log,
    });
    const toServer = (frame: RunnerFrame): boolean => {
      if (frame.type === "browser.frame" && views.push(frame)) return true;
      if (frame.type === "browser.stream.ended") views.end(frame.agentId);
      return live?.send(frame) ?? false;
    };
    const browser = new BrowserManager({
      home,
      log,
      send: toServer,
      // Chrome's next picture comes once this one's view has room (`pacing=ack`).
      frameRoom: (agentId) => views.room(agentId),
      secret: (agent, name) => secretValue(secretsDir, agent, name),
      onChange: () => queueMicrotask(() => this.browsersChanged()),
      desktops: this.desktops,
      startPageData: (agent) => ({
        locale: this.agents.find((a) => a.id === agent.id)?.locale,
        egress: this.egress.current,
      }),
    });
    // Browsers a previous run of this runner left open (a crash, a kill) close now.
    void browser.closeAll();
    // Single-user: every agent works as this runner's own user, so no `uids` and desktop use stays off (ADR 0062
    // §3). System mode: each agent's worker serves it as the agent's own user.
    const desktopUse = new DesktopManager({
      desktops: this.desktops,
      workers: config.mode === "system",
      secrets: (agent) => agentSecrets(secretsDir, agent),
      browserPid: (agentId) => browser.chromePid(agentId),
      numbered: this.desktopRefsGiven,
      log,
    });
    const streams = new DataSockets({
      url: connectUrl(config.server, "stream"),
      token: config.token,
      relayed: this.relayed,
    });
    let supervisor: Supervisor | null = null;
    let agentUser: Session["agentUser"] = null;
    let accountBrains: AccountBrains | null = null;
    if (config.mode === "system") {
      const range = config.agentUidRange ?? DEFAULT_AGENT_UID_RANGE;
      const users = new AgentUsers({ home, range, log, ...(sharedSpec && this.shared ? { shared: sharedSpec } : {}) });
      for (const user of readAgentUsers(home)) {
        this.networkUsers.set(user.uid, user);
        // Keep already-running users out of cron/at even when their network must drain before preparation.
        if (!this.opts.workers) denySchedulers(user.user);
      }
      const resolveNetwork = (user: AgentUser): NetworkConfig => {
        this.networkUsers.set(user.uid, user);
        const running = supervisor?.runningNetwork(user.id) != null;
        if (!running) this.refreshNetworkProcesses();
        if (
          !this.uidNetworks.has(user.uid) &&
          this.networkProcesses === null &&
          process.platform === "linux" &&
          process.getuid?.() === 0 &&
          !this.opts.workers
        )
          throw new Error(
            "Cannot determine the agent's existing network context; retry once process inspection is available",
          );
        const desktop = this.desktops.processId(user.id);
        const previous = this.networkProcesses?.filter((proc) => proc.uids.includes(user.uid)) ?? [];
        if (!this.uidNetworks.has(user.uid) && (desktop !== null || previous.length > 0)) {
          if (
            (desktop !== null && !desktopUsesHostNetwork(desktop)) ||
            previous.some((proc) => !desktopUsesHostNetwork(proc.pid))
          )
            throw new Error(
              "The agent's existing processes have no trusted network context; stop that agent's old processes before starting new work",
            );
          this.uidNetworks.seed(user.uid, {});
        }
        const effective = this.uidNetworks.resolve(
          user.uid,
          running || this.networkScopesBusy(user.id) || this.networkProcessesBusy(user),
        );
        // Save the pin before any child can outlive this daemon, including a desktop still starting.
        this.uidNetworks.pending((uid) => uid === user.uid || this.networkUidBusy(uid));
        this.persistNetworkPins(network);
        if (this.config?.networkDrainSeconds && networkKey(effective) !== networkKey(network)) {
          throw new NetworkChangingError(this.config.networkDrainSeconds);
        }
        return effective;
      };
      const policy = {
        uidRange: config.managedBy === "host" ? DEFAULT_AGENT_UID_RANGE : range,
        refresh: () => void guard?.reconcile(),
      };
      const prepare = (user: AgentUser, effective = resolveNetwork(user)) => {
        if (this.opts.workers || prepared.get(user.uid) === networkKey(effective)) return;
        denySchedulers(user.user);
        ensureBrowserBindPolicy({ ...user, ...effective }, this.self.command, policy);
        const known = this.agents.find((agent) => agent.id === user.id);
        prepareSystemStartPage(user, known ?? { name: user.user, handle: user.user }, {
          locale: known?.locale,
          egress: this.egress.current,
        });
        prepared.set(user.uid, networkKey(effective));
      };
      // All root children and the worker use one effective UID context, including while a desktop starts.
      agentUser = (agent) => {
        const user = this.opts.workers?.user(agent) ?? users.ensure(agent);
        const effective = resolveNetwork(user);
        prepare(user, effective);
        if (!this.opts.workers)
          prepareSystemStartPage(user, agent, {
            locale: this.agents.find((a) => a.id === agent.id)?.locale,
            egress: this.egress.current,
          });
        return { id: user.id, user: user.user, uid: user.uid, ...effective };
      };
      // Tests inject `workers`; a real guard (nft as root) belongs only to the real supervisor. On the
      // server's own computer one guard covers every organization's agents (`host.ts`): a guard per runner
      // would replace the others' rules with its own.
      guard =
        this.opts.workers || config.managedBy === "host"
          ? undefined
          : new LoopbackGuard({
              home,
              agentUids: () => readAgentUsers(home).map((u) => u.uid),
              uidRange: config.agentUidRange ?? DEFAULT_AGENT_UID_RANGE,
              networkMark: config.networkMark,
              services: () => [
                ...(readStoredConfig(home)?.services ?? []),
                ...runnerEndpoints(),
                ...loopbackEndpoints([config.server]),
              ],
              log,
            });
      supervisor = new Supervisor({
        home,
        requireRootBroker: !this.opts.workers,
        network,
        resolveNetwork: (user) => {
          const effective = resolveNetwork(user);
          prepare(user, effective);
          return effective;
        },
        networkBusy: (agentId) => {
          const user = [...this.networkUsers.values()].find((u) => u.id === agentId);
          return this.networkScopesBusy(agentId) || (!!user && this.networkProcessesBusy(user));
        },
        user: agentUser,
        start: launchWorker(this.self.command, policy, undefined, log, (id) => this.containersAllowed(id)),
        ...(this.opts.workers || config.managedBy === "host"
          ? {}
          : {
              prepareExisting: (existing: AgentUser[]) => prepareAgents(existing, prepare, policy, log),
            }),
        stopAccountScopes: (uid) => this.accountUsers?.stopScopes(uid),
        ...(this.opts.workers || !rootlessContainers()
          ? {}
          : { stopContainers: (uid: number) => void stopContainers(uid) }),
        toolNotice: (agentId, notice) => accountBrains?.toolNotice(agentId, notice),
        taskStop: (agentId, taskId) => accountBrains?.stopTask(agentId, taskId),
        lend: (kind, accountId, uid) => this.accounts.lendTo(kind, accountId, uid),
        grant: (kind, accountId) => this.accounts.grant(kind, accountId),
        usage: (kind, accountId, info) =>
          kind === "codex"
            ? this.accounts.noteCodexRateLimits(accountId, info)
            : this.accounts.noteRateLimit(accountId, info),
        codexAuth: (accountId, auth) => this.accounts.keepCodexAuth(accountId, auth),
        desktop: (agent, use) => this.workerDesktop(agent, use),
        desktopViewers: (agentId) => this.desktops.status({ id: agentId }).streams,
        account: (agentId) => this.agentAccount(agentId),
        accounts: (agentId) => this.agentAccounts(agentId),
        ...(this.opts.workers ? { start: this.opts.workers.start } : { gitCache: rootGitCache() }),
        ...(guard ? { guard } : {}),
        token: config.token,
        server: config.server,
        send: (frame) => live?.send(frame) ?? false,
        views,
        state: () => this.workerState(),
        relayed: this.relayed,
        log,
      });
      if (this.accountUsers) {
        accountBrains = new AccountBrains({
          root: path.join(home, "account-brains"),
          accounts: this.accounts,
          users: this.accountUsers,
          workers: supervisor,
          grants: (agentId) => realFoldersFor(this.access(), agentId),
          relay: this.self.command,
          shared: () => this.stored?.claudeSharedLogin,
          idleMs: (config.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes) * 60_000,
          maxProcesses: config.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
          log,
        });
      }
    }
    // A view with room again, or ended: the agent's stream sends its next frame, here or from its worker.
    views.onRoom = (agentId) => {
      browser.room(agentId);
      supervisor?.browserRoom(agentId);
    };
    // Agents working as this runner's user: what their browsers' first command would install is installed now (in
    // system mode, the installer shares it with every agent).
    if (!supervisor && this.access().tools.browser === true) void browser.prepareInBackground();
    this.toolchains ??= this.opts.toolchains
      ? { get: this.opts.toolchains, stop: () => {} }
      : cachedToolchains(
          path.join(home, TOOLCHAINS_FILE),
          undefined,
          process.platform === "darwin"
            ? {
                look: () => appleToolchains(),
                // An older server drops the frame: its next hello carries the same.
                onChange: (toolchains) => this.send({ type: "toolchains.changed", toolchains }),
              }
            : null,
        );
    // Phones are reached as the person (adb's key, the Mac's pairing with the iPhone): a system-mode runner has none.
    if (!this.phones && config.mode !== "system" && this.opts.phones !== false) {
      this.phones = new PhoneManager({
        log,
        onChange: (phones) => {
          this.send({ type: "phones.changed", phones });
          this.queueStatus();
        },
        ...(this.opts.caffeinate !== undefined ? { caffeinate: this.opts.caffeinate } : {}),
        ...this.opts.phones,
      });
      this.phones.start();
    }
    const context: HandlerContext = {
      workspaceReal,
      get exec() {
        return daemon.access().tools.commands;
      },
      token: config.token,
      server: config.server,
      secretsDir,
      gitDir: path.join(home, "git"),
      // Agents here share the runner's user, so they share one cache (system mode: root's, through each worker).
      gitCache: path.join(home, "git-cache"),
      tasks,
      brains,
      ...(accountBrains ? { accountBrains } : {}),
      // System mode: root runs only the CLIs of sign-ins several agents share; the others are their workers'.
      reclaimBrains: supervisor
        ? (spare) => accountBrains?.reclaim(spare) ?? supervisor.reclaimBrains(spare)
        : (spare) => brains.reclaimIdle(spare),
      warmBrain: supervisor
        ? async (spare) => accountBrains?.warm(spare) || supervisor.warmBrain(spare)
        : async (spare) => brains.warm(spare),
      codex: { runnerHome: home, mcp: mcpCommand, runs: codexRuns, app: codexApp },
      paused: () => this.stopping || this.pauseState().paused,
      // A config written later without the mode never turns a system session back into one that does agents' work.
      systemMode: () => config.mode === "system" || this.stored?.mode === "system",
      ...(supervisor ? { workers: supervisor } : {}),
      access: () => this.access(),
      accessOps: {
        request: (agent, req) => this.accessRequest(agent, req),
        reduce: (req) => this.accessReduce(req),
      },
      browser,
      accounts: this.accounts,
      desktops: this.desktops,
      terminals: this.terminals,
      streams,
      browserViews: views,
      desktopUse,
      desktopTaken: (agentId) => {
        if (supervisor) supervisor.desktopTaken(agentId);
        else {
          desktopUse.stopInput(agentId);
          browser.stopInput(agentId);
        }
      },
      ...(this.phones ? { phones: this.phones } : {}),
    };
    // `hello` lists the accounts it already knows; a fresh look (each runs its CLI) never delays connecting:
    // it lands in `hello` if it finishes first, else comes after as `accounts.changed`. Nothing reaches the
    // server between `hello` and `welcome`, so what changed in that gap goes out with `welcome`.
    this.accounts.refresh(true).catch(() => undefined);
    /** The accounts and usage the last `hello` carried (JSON). */
    let told: string | undefined;
    const connection = new RunnerConnection({
      url: connectUrl(config.server),
      token: config.token,
      info: () => {
        const accounts = this.accounts.snapshot();
        const usage = this.ownUsage();
        told = JSON.stringify([accounts, usage]);
        const phones = this.phones?.list();
        if (phones) this.toldPhones = JSON.stringify(phones);
        const toolchains = this.toolchains?.get();
        return {
          ...(phones ? { phones } : {}),
          ...(toolchains ? { toolchains } : {}),
          ...this.info(workspaceReal),
          browser: browser.info(),
          desktop: this.desktops.info(),
          terminal: this.terminals.info(),
          desktopUse: desktopUse.info(),
          ...(accounts ? { accounts } : {}),
          ...usage,
          // Who may control a desktop or open a terminal follows it (ADR 0058 §4).
          ...(agentUser ? { mode: "system" as const } : {}),
        };
      },
      executors: () => this.helloExecutors(),
      load: () => this.load.summary(),
      browserTraffic: () => this.traffic.summary(),
      egress: () => this.egress.current,
      context,
      // System mode: the agents' tasks and MCP calls are their workers'.
      ...(supervisor ? { tasks: supervisor, mcp: supervisor.mcp } : { mcp }),
      log,
      observer: this,
      onAgents: (raw, deleted) => this.setAgents(raw, deleted),
      onBrowserHandoff: (frame) =>
        supervisor ? supervisor.handoff(frame) : browser.setHandoff(frame.agentId, frame.handoff),
      onState: (state) => {
        // Offline: frames have nowhere to go; the server starts the live view again when it is back.
        if (state !== "online") {
          this.observeEgress = false;
          browser.stopStreams();
          views.closeAll();
          // What it said about people's turns is stale; it says again on reconnect.
          browser.clearHandoffs();
        }
        this.setConnState(state);
      },
      onWelcome: (welcome) => {
        this.observeEgress = welcome.observeEgress;
        this.sentNetworkTransition = "";
        this.observeNetwork();
        this.egressGeneration++;
        this.egress.reset();
        this.updateStartPages();
        void this.sampleEgress();
        this.flushDecisions();
        this.syncLogo(config);
        this.executorsChanged();
        const accounts = this.accounts.snapshot();
        const usage = this.ownUsage();
        if (accounts && JSON.stringify([accounts, usage]) !== told) {
          this.send({ type: "accounts.changed", accounts, ...usage });
        }
        const phones = this.phones?.list();
        if (phones && JSON.stringify(phones) !== this.toldPhones) this.send({ type: "phones.changed", phones });
      },
      ...(this.opts.dial ? { dial: this.opts.dial } : {}),
    });
    live = connection;
    const session: Session = {
      config,
      network,
      changeNetwork: (value) => {
        if (config.managedBy === "host" && value.networkMark !== network.networkMark) return false;
        if (guard && !guard.setNetworkMark(value.networkMark)) return false;
        delete network.networkLauncher;
        delete network.networkMark;
        delete network.networkRevision;
        Object.assign(network, value);
        this.uidNetworks.set(value);
        this.refreshNetworkProcesses();
        this.uidNetworks.pending((uid) => this.networkUidBusy(uid));
        prepared.clear();
        return true;
      },
      workspaceReal,
      tasks,
      brains,
      accountBrains,
      codexApp,
      mcp,
      browser,
      streams,
      desktopUse,
      connection,
      supervisor,
      agentUser,
    };
    this.session = session;
    supervisor?.boot();
    this.observeNetwork();
    log(
      `agentes-runner ${RUNNER_VERSION}: connecting to ${config.server} (workspace ${workspaceReal}${this.access().tools.commands ? "" : ", commands off"})`,
    );
    void connection.run().then((outcome) => this.sessionEnded(session, outcome));
  }

  private networkScopesBusy(agentId: string): boolean {
    return this.desktops.hasActivity(agentId) || this.terminals.count(agentId) > 0;
  }

  private networkUidBusy(uid: number): boolean {
    const user = this.networkUsers.get(uid);
    return (
      !!user &&
      (this.session?.supervisor?.runningNetwork(user.id) != null ||
        this.networkScopesBusy(user.id) ||
        this.networkProcessesBusy(user))
    );
  }

  private refreshNetworkProcesses() {
    const configured =
      this.config?.networkLauncher ||
      this.config?.networkMark ||
      this.config?.networkRevision ||
      this.uidNetworks.snapshot().some((pin) => pin.networkLauncher || pin.networkMark || pin.networkRevision);
    if (!configured) {
      this.networkProcesses = [];
      return;
    }
    if (process.platform === "linux" && process.getuid?.() === 0 && !this.opts.workers)
      this.networkProcesses = readNetworkProcesses();
  }

  private networkProcessesBusy(user: AgentUser): boolean {
    if (process.platform !== "linux" || process.getuid?.() !== 0 || this.opts.workers) return false;
    return uidHasOtherProcesses(this.networkProcesses, user.uid, this.session?.supervisor?.runningPid(user.id));
  }

  private persistNetworkPins(network: NetworkConfig, pending?: number[]) {
    const pins = this.uidNetworks.snapshot();
    if (
      !this.writtenNetworkPins &&
      !network.networkLauncher &&
      !network.networkMark &&
      !network.networkRevision &&
      !pins.some((p) => p.networkLauncher || p.networkMark || p.networkRevision)
    )
      return;
    const pendingUids = pending ?? pins.filter((row) => networkKey(row) !== networkKey(network)).map((row) => row.uid);
    const transitions = this.networkDrain.snapshot();
    const key = JSON.stringify([networkKey(network), pins, pendingUids, transitions]);
    if (key === this.writtenNetworkPins) return;
    writeNetworkState(this.opts.home, network, pendingUids, pins, transitions);
    this.writtenNetworkPins = key;
  }

  private observeNetwork() {
    const session = this.session;
    if (!session?.supervisor || this.stopped) return;
    this.refreshNetworkProcesses();
    const pending = new Set(session.supervisor.drainNetwork());
    for (const uid of this.uidNetworks.pending((uid) => this.networkUidBusy(uid))) pending.add(uid);
    const transitions = this.networkDrain.update(
      [...pending].flatMap((uid) => {
        const user = this.networkUsers.get(uid);
        return user ? [{ uid, agentId: user.id }] : [];
      }),
      networkKey(session.network),
      this.config?.networkDrainSeconds,
      this.now(),
    );
    const active = new Set(transitions.map((t) => t.agentId));
    for (const id of this.retiredNetworkAgents) if (!active.has(id)) this.retiredNetworkAgents.delete(id);
    for (const id of this.networkRetirementWarnings) if (!active.has(id)) this.networkRetirementWarnings.delete(id);
    const summary = transitions.length
      ? {
          state: transitions.some((t) => t.state === "restart_required")
            ? ("restart_required" as const)
            : ("draining" as const),
          deadline: transitions.map((t) => t.deadline).sort()[0] as string,
          agents: transitions.map((t) => t.agentId),
        }
      : null;
    const summaryKey = JSON.stringify(summary);
    if (
      this.observeEgress &&
      summaryKey !== this.sentNetworkTransition &&
      session.connection.send({ type: "pong", at: this.now(), networkTransition: summary })
    ) {
      this.sentNetworkTransition = summaryKey;
    }
    try {
      this.persistNetworkPins(
        session.network,
        [...pending].sort((a, b) => a - b),
      );
      this.networkWriteFailed = false;
      // Persist and announce the deadline before ending only sessions this runner owns. The routing integrator
      // blocks any leftover stale process at that deadline; it must never infer completion from these closures.
      for (const transition of transitions) {
        if (transition.state !== "restart_required" || this.retiredNetworkAgents.has(transition.agentId)) continue;
        this.retiredNetworkAgents.add(transition.agentId);
        const why = "Network settings changed; this computer session is restarting";
        if (!this.networkRetirementWarnings.has(transition.agentId)) this.opts.log(`[${transition.agentId}] ${why}`);
        const failed = (error: unknown) => {
          this.retiredNetworkAgents.delete(transition.agentId);
          if (!this.networkRetirementWarnings.has(transition.agentId)) {
            this.networkRetirementWarnings.add(transition.agentId);
            this.opts.log(
              `[${transition.agentId}] Could not restart its computer sessions: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        try {
          session.supervisor.retireNetworkAgent(transition.agentId, why);
          this.terminals.closeAgent(transition.agentId, why);
          // Ownership comes from the restored desktop registry, even when the current agent roster is missing.
          void this.desktops.stop({ id: transition.agentId }).catch(failed);
        } catch (error) {
          failed(error);
        }
      }
    } catch {
      if (!this.networkWriteFailed) this.opts.log("Could not write the active network settings");
      this.networkWriteFailed = true;
    }
  }

  private async sampleEgress() {
    const session = this.session;
    if (!session || !this.observeEgress || !session.agentUser || this.probingEgress || this.stopped) return;
    // Observe an existing agent context only: periodic probes must never create a user or prepare a desktop.
    const known = new Map(readAgentUsers(this.opts.home).map((user) => [user.id, user]));
    const pins = new Map(this.uidNetworks.snapshot().map((pin) => [pin.uid, pin]));
    const retiring = new Set(
      this.networkDrain
        .snapshot()
        .filter((item) => item.state === "restart_required")
        .map((item) => item.uid),
    );
    let user: AgentUser | undefined;
    for (const agent of this.agents) {
      const existing = this.opts.workers?.user(agent) ?? known.get(agent.id);
      if (!existing || retiring.has(existing.uid)) continue;
      const pin = pins.get(existing.uid);
      if (!pin && !this.opts.workers) continue;
      user = { ...existing, ...networkConfig(pin ?? session.network) };
      break;
    }
    this.probingEgress = true;
    const before = this.egress.current;
    const generation = this.egressGeneration;
    try {
      // Idle contexts are not kept alive for observations. Three skipped samples expire the last address too.
      const result = user ? await (this.opts.probeEgress ?? probeEgress)(session.config.server, user) : null;
      if (this.session === session && generation === this.egressGeneration) this.egress.record(result);
    } catch {
      if (this.session === session && generation === this.egressGeneration) this.egress.record(null);
    } finally {
      this.probingEgress = false;
      if (this.session === session && generation === this.egressGeneration) {
        const egress = this.egress.current;
        if (egress && egress !== before) session.connection.send({ type: "pong", at: this.now(), egress });
        this.updateStartPages();
      } else if (this.session && !this.stopped) void this.sampleEgress();
    }
  }

  private updateStartPages() {
    if (!this.session) return;
    try {
      if (this.session.agentUser && !this.opts.workers) {
        for (const user of readAgentUsers(this.opts.home)) {
          const agent = this.agents.find((a) => a.id === user.id);
          if (agent) prepareSystemStartPage(user, agent, { locale: agent.locale, egress: this.egress.current });
        }
      } else this.session.browser.updateStartPages();
    } catch {
      this.opts.log("Could not update the browser start page");
    }
  }

  private async closeSession(s: Session) {
    this.egressGeneration++;
    this.egress.reset();
    s.connection.stop();
    s.streams.closeAll();
    s.desktopUse.stopAll();
    await s.supervisor?.close();
    s.tasks.close();
    s.brains.close();
    s.accountBrains?.brains.close();
    s.codexApp.close();
    await s.browser.close().catch(() => undefined);
    await s.mcp.close().catch(() => undefined);
  }

  private sessionEnded(session: Session, outcome: ConnectionOutcome) {
    if (this.session !== session) return; // replaced or stopped on purpose
    this.session = null;
    this.closing = this.closeSession(session);
    if (outcome.reason === "stopped") return;
    this.refused = { token: session.config.token, reason: outcome.reason };
    this.connState = outcome.reason === "outdated" ? "outdated" : "refused";
    this.opts.log(outcome.message);
    this.queueStatus();
    if (this.opts.mode === "start") {
      this.startWaiter?.(outcome);
      this.startWaiter = null;
    }
  }

  private setConnState(state: "connecting" | "online" | "offline") {
    if (!this.config || state === this.connState) return;
    this.connState = state;
    this.queueStatus();
  }

  /** The shared folder's size, for the next load report (`du` in the background). */
  private measureShared() {
    const dir = this.shared;
    if (!dir) return;
    void sharedSizeGb(dir).then((gb) => {
      if (gb !== null && this.shared === dir) this.sharedGb = gb;
    });
  }

  /**
   * The shared folder (ADR 0115), made where missing: system mode's (`spec`) or single-user mode's in the
   * workspace (`null`); `undefined`: none. Null when it couldn't be made: the agents work on in their own folders.
   */
  private prepareShared(workspaceReal: string, spec: Required<SharedSpec> | null | undefined): string | null {
    if (spec === undefined) return null;
    try {
      if (spec === null) return ensureSingleShared(workspaceReal);
      for (const p of ensureSystemShared(spec)) this.opts.log(`shared folder: ${p}`);
      return realpathSync(spec.path);
    } catch (err) {
      this.opts.log(`no shared folder: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** What `hello` says (asked again on each connection). */
  private info(workspaceReal: string): RunnerInfo {
    const access = this.access();
    return {
      version: RUNNER_VERSION,
      protocol: MACHINE_PROTOCOL_VERSION,
      os: machineOs(),
      arch: os.arch(),
      hostname: os.hostname(),
      workspace: workspaceReal,
      exec: access.tools.commands,
      paused: this.pauseState(),
      access,
      size: machineSize(workspaceReal),
      claudeLoginMethods: this.accounts.claudeLoginMethods(),
      ...(this.sharedLoginBlocked && this.stored?.claudeSharedLogin
        ? { claudeLoginBlocked: this.sharedLoginBlocked }
        : {}),
      ...(this.accounts.authEgressGroup() ? { authEgressGroup: true as const } : {}),
    };
  }

  /** The computer's own sign-ins' usage, when anything is known (`hello`, `accounts.changed`). */
  private ownUsage(): Pick<RunnerInfo, "ownUsage"> {
    const own = this.accounts.ownUsage();
    return Object.keys(own).length > 0 ? { ownUsage: own } : {};
  }

  /** The coding CLIs for `hello`: the ones installed (whether each may run is `access.tools`). */
  private helloExecutors(): RunnerInfo["executors"] {
    // Asked first: asking is what starts a look, and a runner with no app has no other first one.
    const found = this.executors();
    if (!this.executorsKnown()) return undefined;
    // Claude Code installed or logged in since the last look: the app shows it.
    const seen = JSON.stringify(found);
    if (seen !== this.lastExecutors) {
      this.lastExecutors = seen;
      this.queueStatus();
    }
    // Not filtered by the tools turned on: those reach the server on every change (`access.changed`),
    // while `hello` only goes out on connect, so a tool turned on later looked "not installed".
    return found;
  }

  /**
   * A look found other CLIs than the server last heard of (`lastExecutors`): it hears now, or with `welcome` when the
   * look ended between `hello` and `welcome`, or with the next `hello` when offline.
   */
  private executorsChanged() {
    this.queueStatus();
    if (!this.executorsKnown()) return;
    const executors = this.executors();
    const seen = JSON.stringify(executors);
    if (seen !== this.lastExecutors && this.send({ type: "executors.changed", executors })) this.lastExecutors = seen;
  }

  private send(frame: RunnerFrame) {
    try {
      return this.session?.connection.send(frame) ?? false;
    } catch {
      return false;
    }
  }

  private emit(event: ControlEvent) {
    try {
      this.opts.onEvent?.(event);
    } catch {
      // the app went away; stdin closing stops us
    }
  }

  /** The agents' browsers changed (or may have: the periodic check): the app hears it only on a real change. */
  private browsersChanged() {
    const now = JSON.stringify(this.session?.browser.states() ?? []);
    if (now === this.lastBrowsers) return;
    this.lastBrowsers = now;
    this.queueStatus();
  }

  private queueStatus() {
    if (this.statusQueued || !this.opts.onEvent) return;
    this.statusQueued = true;
    queueMicrotask(() => {
      this.statusQueued = false;
      if (!this.stopped) this.emit({ kind: "status", status: this.status() });
    });
  }

  /** App mode: refreshes the cached organization logo; a change reaches the app as `status` (`org.logoEtag`). */
  private syncLogo(config: RunnerConfig) {
    if (this.opts.mode !== "app" || this.logoSync) return;
    const before = this.logo;
    let stale = false;
    this.logoSync = syncOrgLogo({
      home: this.opts.home,
      server: config.server,
      token: config.token,
      cached: before,
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    })
      .then((logo) => {
        if (this.stopped) return;
        // Unpaired or paired elsewhere meanwhile: not this pairing's logo any more.
        if (this.config?.token !== config.token) {
          if (logo !== before) removeCachedLogo(this.opts.home);
          stale = true;
          return;
        }
        this.logo = logo;
        if (logo?.etag !== before?.etag) this.queueStatus();
      })
      .catch((err: unknown) => this.opts.log(`org logo: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.logoSync = null;
        // A new pairing connected while this ran: its own logo.
        if (stale && this.config && this.connState === "online") this.syncLogo(this.config);
      });
  }

  /** The organization's logo as a `data:` URL for the app (`org.logo`), or null. */
  orgLogo(): { logo: string | null } {
    return { logo: this.config ? logoDataUrl(this.logo) : null };
  }

  private setAgents(raw: unknown, deletedIds?: unknown) {
    const list = parseAgents(raw);
    // System mode: an account folder stays with an agent's user only while that agent thinks with it.
    if (this.stored?.mode === "system") {
      const users = readAgentUsers(this.opts.home);
      const uids = new Map(users.map((u) => [u.id, u.uid]));
      const lent = new Map<string, number>();
      for (const a of list) {
        const uid = uids.get(a.id);
        if (!uid) continue;
        for (const id of [a.account, ...(a.accounts ?? [])]) if (id) lent.set(id, uid);
      }
      void this.accounts.keepLent(lent).catch(() => undefined);
      const here = new Set(list.map((a) => a.id));
      const gone = this.agents.filter((a) => !here.has(a.id)).map((a) => a.id);
      const deleted = new Set(Array.isArray(deletedIds) ? deletedIds : []);
      const hosted = this.session?.accountBrains;
      this.keepHosted(list);
      for (const id of gone) hosted?.brains.keepAccount(null, [], id);
      for (const u of users) {
        const clear = deleted.has(u.id) && !here.has(u.id) && !this.swept.has(u.id);
        if (!clear && !gone.includes(u.id)) continue;
        hosted?.dropTurns(new RunnerError("dropped", "The agent left this computer."), u.id);
        // Its containers stop with it; back, its `restart: always` ones start again with its containers service.
        if (!this.opts.workers && rootlessContainers()) stopContainers(u.uid);
        // Archived or moved, it may come back: what the sign-ins hold for it stays until it is deleted.
        if (!clear) {
          this.accountUsers?.stopScopes(u.uid);
          continue;
        }
        this.swept.add(u.id);
        try {
          this.accountUsers?.sweepAgent(u);
        } catch (err) {
          this.opts.log(`${u.user}: couldn't clear it from its sign-ins (${err instanceof Error ? err.message : err})`);
        }
      }
      // Its brain changed (ADR 0169): a sandboxed one's containers service stops before its next turn; one let have it
      // again gets it now while its worker runs, else with its worker's next start.
      if (!this.opts.workers && rootlessContainers()) {
        const had = new Set(this.agents.filter((a) => a.containers).map((a) => a.id));
        for (const a of list) {
          const uid = uids.get(a.id);
          if (uid === undefined || Boolean(a.containers) === had.has(a.id)) continue;
          const agentUser = this.session?.agentUser;
          if (!a.containers) stopContainers(uid);
          else if (agentUser && this.session?.supervisor?.runningPid(a.id) !== undefined) {
            try {
              const u = agentUser(a);
              const problem = keepContainers(u, true);
              if (problem) this.opts.log(`[${u.user}] containers unavailable: ${problem}`);
            } catch (err) {
              // Its network is switching, say: its worker's next start brings the service.
              this.opts.log(`${a.handle}: its containers service waits (${err instanceof Error ? err.message : err})`);
            }
          }
        }
      }
    }
    // Desktops stay on, so one whose agent left (archived, moved) would hold its display and memory for good; the
    // others take their agent's current name and handle.
    void this.desktops.serve(list).catch(() => undefined);
    if (JSON.stringify(list) === JSON.stringify(this.agents)) return;
    const routeChanged = this.agents[0]?.id !== list[0]?.id;
    this.agents = list;
    if (routeChanged) {
      this.egressGeneration++;
      this.egress.clear();
      this.session?.connection.send({ type: "pong", at: this.now(), egress: { ip: null } });
      void this.sampleEgress();
    }
    this.updateStartPages();
    try {
      writeAgents(this.opts.home, list);
    } catch {
      // kept in memory
    }
    // System mode: each agent's worker closes what runs with an account it no longer thinks with.
    this.session?.supervisor?.stateChanged();
    this.queueStatus();
  }

  /** The account an agent thinks with, as the agents frame says, while that account is still here. */
  private agentAccount(agentId: string): string | null {
    const id = this.agents.find((a) => a.id === agentId)?.account;
    return id && this.accounts.has(id) ? id : null;
  }

  /** The other accounts it thinks with (`MachineAgent.accounts`), while still here. */
  private agentAccounts(agentId: string): string[] {
    return (this.agents.find((a) => a.id === agentId)?.accounts ?? []).filter((id) => this.accounts.has(id));
  }

  // ── State ──────────────────────────────────────────────────────────────────

  access(): RunnerAccess {
    return withShared(effectiveAccess(this.stored), this.shared);
  }

  pauseState(): RunnerPause {
    return pauseOf(this.stored, this.now());
  }

  status(): ControlStatus {
    const c = this.config;
    const s = this.stored;
    const browsers = this.session?.browser.states() ?? [];
    this.lastBrowsers = JSON.stringify(browsers);
    return {
      paired: c !== null,
      ...(s?.server ? { server: s.server } : {}),
      ...(c?.orgId
        ? { org: { id: c.orgId, name: c.orgName ?? "", ...(this.logo ? { logoEtag: this.logo.etag } : {}) } }
        : {}),
      ...(c ? { machine: { id: c.machineId, name: c.name } } : {}),
      connection: c ? this.connState : "unpaired",
      ...(c && this.connState === "refused" && this.refused && this.refused.reason !== "outdated"
        ? { refusedReason: this.refused.reason as "invalid_token" | "revoked" | "replaced" }
        : {}),
      version: RUNNER_VERSION,
      protocol: MACHINE_PROTOCOL_VERSION,
      paused: this.pauseState(),
      executors: this.executors(),
      ...(c ? { workspace: this.session?.workspaceReal ?? c.workspace } : {}),
      agents: this.agents.map((a) => ({ ...a })),
      access: this.access(),
      browsers,
      ...(this.phones ? { phones: this.phones.list() } : {}),
      // In system mode each agent runs as a user of its own, not as the runner's.
      ...(OS_USER && c?.mode !== "system" && s?.mode !== "system" ? { user: OS_USER } : {}),
      seq: ++this.statusSeq,
    };
  }

  jobList(): ControlJob[] {
    const out = [...this.jobs.values()];
    for (const t of this.session?.tasks.runningTasks() ?? []) {
      if (!this.jobs.has(t.taskId)) out.push(this.taskJob(t));
    }
    return out;
  }

  private requirePaired(): RunnerConfig {
    if (!this.config) throw new ControlError("not_paired", "This computer isn't connected yet");
    return this.config;
  }

  /**
   * The app's "Reconnect": the socket is dropped and dialed again at once. After a refusal (no session left)
   * it tries again with the same token: a token that is really gone is refused the same way, anything else
   * gets back online instead of staying off until the app restarts.
   */
  reconnect(): { reconnecting: boolean } {
    this.requirePaired();
    const s = this.session;
    if (!s) {
      if (!this.refused || this.refused.reason === "outdated") return { reconnecting: false };
      this.opts.log("reconnect asked by the app (after a refusal)");
      this.refused = null;
      void this.reconcile();
      return { reconnecting: true };
    }
    this.opts.log("reconnect asked by the app");
    s.connection.reconnect();
    return { reconnecting: true };
  }

  /**
   * The tray's "Parar": the agent's browser closes on this computer (its
   * profile and logins stay). A live view watching it is told it ended.
   */
  async browserStop(agentId: string): Promise<{ stopped: boolean }> {
    this.requirePaired();
    const s = this.session;
    if (!s || !agentId) return { stopped: false };
    const agent = this.agents.find((a) => a.id === agentId);
    this.opts.log(`browser of ${agent?.handle ?? agentId} closed from the app`);
    const out = await s.browser.stop({ id: agentId, handle: agent?.handle ?? "agent" });
    this.browsersChanged();
    return out;
  }

  /** The desktop app's iPhone setup: what the Mac has, a download of the iOS platform, Xcode opened. */
  iphoneSetup(): IphoneSetup {
    this.iphone ??= new IphoneSetup({ log: this.opts.log, ...this.opts.iphone });
    return this.iphone;
  }

  // ── Accounts (ADR 0041) ────────────────────────────────────────────────────

  /** The app's account list: every account on this computer with its CLI's status. */
  async accountsList(): Promise<ControlReplies["accounts.list"]> {
    return { accounts: await this.accounts.list() };
  }

  /**
   * The app's "Adicionar conta": the CLI's sign-in starts here, opens this
   * computer's browser and finishes by itself; the app polls `account.status`.
   */
  async accountBegin(kind: AccountKind): Promise<ControlReplies["account.begin"]> {
    if (!isAccountKind(kind)) throw new ControlError("bad_request", "Unknown account kind");
    const loginId = crypto.randomUUID();
    const r = await this.accounts.begin(kind, loginId);
    return { loginId, url: r.url ?? "", ...(r.userCode ? { userCode: r.userCode } : {}) };
  }

  accountStatus(loginId: string): ControlReplies["account.status"] {
    if (!isAccountId(loginId)) throw new ControlError("bad_request", "Invalid sign-in id");
    const r = this.accounts.status(loginId);
    return {
      state: r.state ?? "failed",
      ...(r.account ? { account: r.account } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
  }

  async accountCancel(loginId: string): Promise<ControlReplies["account.cancel"]> {
    return { canceled: await this.accounts.cancel(loginId) };
  }

  async accountRemove(kind: AccountKind, accountId: string): Promise<ControlReplies["account.remove"]> {
    return { removed: await this.accounts.remove(kind, accountId) };
  }

  // ── Pause ──────────────────────────────────────────────────────────────────

  pause(until: string | null): RunnerPause {
    this.requirePaired();
    let value: string | null = null;
    if (until !== null && until !== undefined) {
      const t = typeof until === "string" ? Date.parse(until) : Number.NaN;
      if (Number.isNaN(t)) throw new ControlError("bad_request", "until must be an ISO time or null");
      if (t <= this.now()) throw new ControlError("bad_request", "until is in the past");
      value = new Date(t).toISOString();
    }
    this.write({ ...(this.stored ?? {}), paused: { until: value } });
    return this.pauseState();
  }

  resume(): RunnerPause {
    this.requirePaired();
    this.writeResume();
    return this.pauseState();
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  configGet(): ControlConfig {
    const c = this.requirePaired();
    return {
      name: c.name,
      maxConcurrentTasks: c.maxConcurrentTasks ?? DEFAULT_LIMITS.maxConcurrentTasks,
      taskMaxSeconds: c.taskMaxSeconds ?? DEFAULT_LIMITS.taskMaxSeconds,
      brainIdleMinutes: c.brainIdleMinutes ?? DEFAULT_LIMITS.brainIdleMinutes,
      brainMaxProcesses: c.brainMaxProcesses ?? DEFAULT_LIMITS.brainMaxProcesses,
      workspace: this.session?.workspaceReal ?? c.workspace,
      ...(c.managedBy === "desktop" ? { managedBy: c.managedBy } : {}),
    };
  }

  configSet(patch: ControlConfigPatch): ControlConfig {
    this.requirePaired();
    if (typeof patch !== "object" || patch === null) throw new ControlError("bad_request", "patch must be an object");
    const next: StoredConfig = { ...(this.stored ?? {}) };
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 100) {
        throw new ControlError("bad_request", "name must have 1 to 100 characters");
      }
      next.name = patch.name.trim();
    }
    for (const key of Object.keys(LIMIT_BOUNDS) as (keyof typeof LIMIT_BOUNDS)[]) {
      const v = patch[key];
      if (v === undefined) continue;
      const [min, max] = LIMIT_BOUNDS[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
        throw new ControlError("bad_request", `${key} must be a whole number from ${min} to ${max}`);
      }
      next[key] = v;
    }
    this.write(next);
    return this.configGet();
  }

  // ── Pairing ────────────────────────────────────────────────────────────────

  /**
   * App mode: the device-code sign-in; progress comes as events. Also
   * "Reconectar este Mac" on a home the server refused: the same server's
   * previous machine id goes along, so the site brings that machine back.
   */
  pairStart(
    server: string,
    name?: string,
    tools?: { claude?: boolean; codex?: boolean },
    link?: string,
  ): { started: true } {
    if (this.config && this.connState !== "refused")
      throw new ControlError("already_paired", "This computer is already connected. Disconnect it first.");
    if (link !== undefined && !LINK_CODE.test(link)) throw new ControlError("bad_request", "Not a connect link's code");
    let url: string;
    try {
      url = normalizeServerUrl(String(server ?? ""));
    } catch (err) {
      throw new ControlError("bad_request", err instanceof Error ? err.message : String(err));
    }
    const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : undefined;
    this.pairing?.abort();
    const ac = new AbortController();
    this.pairing = ac;
    void devicePair(
      url,
      { ...deviceInfo(label, previousMachineFor(this.stored, url)), ...(link ? { link } : {}) },
      (code) =>
        this.emit({
          kind: "pair.code",
          userCode: code.userCode,
          verificationUrl: code.verificationUrl,
          expiresAt: new Date(this.now() + code.expiresIn * 1000).toISOString(),
        }),
      {
        signal: ac.signal,
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        ...(this.opts.pairSleep ? { sleep: this.opts.pairSleep } : {}),
        now: this.now,
      },
    ).then(
      (grant) => {
        if (this.pairing !== ac) return;
        this.pairing = null;
        try {
          const prev = this.stored;
          const base = this.opts.workspaceBase ?? expandHome("~/agentes");
          const workspace = prepareWorkspace(prev?.workspace ?? uniqueWorkspace(base, grant.org.name || grant.name));
          this.write(
            configFromGrant(prev, {
              server: url,
              grant,
              workspace,
              ...(label ? { name: label } : {}),
              tools: { claude: tools?.claude === true, codex: tools?.codex === true, commands: false },
              desktop: true,
            }),
          );
          const org = grant.org.name || url;
          this.record({ kind: "pair", summary: `connected to ${org}`, said: { key: "connected", org }, result: "ok" });
          const c = this.requirePaired();
          this.emit({
            kind: "pair.done",
            org: { id: grant.org.id, name: grant.org.name },
            machine: { id: c.machineId, name: c.name },
          });
        } catch (err) {
          this.emit({
            kind: "pair.failed",
            code: "internal",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
      (err: unknown) => {
        if (this.pairing === ac) this.pairing = null;
        const code = err instanceof PairingError ? err.code : "internal";
        if (code === "canceled") return;
        this.emit({ kind: "pair.failed", code, message: err instanceof Error ? err.message : String(err) });
      },
    );
    return { started: true };
  }

  pairCancel(): { canceled: boolean } {
    const had = this.pairing !== null;
    this.pairing?.abort();
    this.pairing = null;
    return { canceled: had };
  }

  /**
   * Forgets the pairing: the token goes (nothing connects with it); settings
   * that aren't the organization's stay. `machineId` stays too, with the token
   * as `previousToken` (its only use is the proof), so pairing again with the
   * same server can bring that machine back (`previousMachineFor`).
   */
  unpair(): { unpaired: true } {
    const s = this.stored;
    if (!s?.token) return { unpaired: true };
    const { token, orgId: _orgId, orgName, name: _name, paused: _paused, access, ...rest } = s;
    this.agents = [];
    try {
      writeAgents(this.opts.home, []);
    } catch {}
    this.logo = null;
    try {
      removeCachedLogo(this.opts.home);
    } catch {}
    this.refused = null;
    this.write({
      ...rest,
      previousToken: token,
      ...(access ? { access: { folders: [], tools: access.tools } } : {}),
    });
    this.record({
      kind: "pair",
      summary: `disconnected${orgName ? ` from ${orgName}` : ""}`,
      said: orgName ? { key: "disconnectedFrom", org: orgName } : { key: "disconnected" },
      result: "ok",
    });
    return { unpaired: true };
  }

  // ── Access (protocol 10) ───────────────────────────────────────────────────

  private checkOpts() {
    return {
      runnerHome: this.opts.home,
      ...(this.config ? { workspace: this.session?.workspaceReal ?? this.config.workspace } : {}),
    };
  }

  private findFolder(given: string): string {
    const access = this.access();
    const abs = expandHome(String(given ?? ""));
    let real = abs;
    try {
      real = realpathSync(abs);
    } catch {}
    const f = access.folders.find((x) => x.path === abs || x.path === real || x.path === given);
    if (!f) throw new ControlError("not_found", `${given} is not an allowed folder`);
    return f.path;
  }

  private agentIds(v: unknown): string[] {
    if (!Array.isArray(v)) throw new ControlError("bad_request", "agents must be a list of agent ids");
    return v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64);
  }

  foldersAdd(folder: string, agents: string[]): RunnerAccess {
    this.requirePaired();
    const real = checkFolder(folder, this.checkOpts());
    this.writeAccess(addFolder(this.access(), real, this.agentIds(agents)));
    return this.access();
  }

  foldersRemove(folder: string, agentId?: string): RunnerAccess {
    this.requirePaired();
    this.writeAccess(removeFolder(this.access(), this.findFolder(folder), agentId || undefined));
    return this.access();
  }

  foldersSetAgents(folder: string, agents: string[]): RunnerAccess {
    this.requirePaired();
    this.writeAccess(setFolderAgents(this.access(), this.findFolder(folder), this.agentIds(agents)));
    return this.access();
  }

  toolsSet(tool: keyof RunnerTools, on: boolean): RunnerAccess {
    this.requirePaired();
    if (typeof on !== "boolean") throw new ControlError("bad_request", "on must be true or false");
    this.writeAccess(setTool(this.access(), tool, on));
    return this.access();
  }

  accessPending(): ControlAccessRequest[] {
    this.expireRequests();
    return this.requests.list().map(({ agentHandle: _h, ...r }) => r);
  }

  /** The person's answer on the machine (the only way access widens). */
  accessAnswer(requestId: string, decision: "granted" | "denied", scope: "agent" | "all"): { access: RunnerAccess } {
    this.requirePaired();
    this.expireRequests();
    const r = this.requests.get(String(requestId ?? ""));
    if (!r) throw new ControlError("not_found", "That request is gone (answered or expired)");
    if (decision !== "granted" && decision !== "denied")
      throw new ControlError("bad_request", "decision must be granted or denied");
    const all = scope === "all";
    if (decision === "granted") {
      const real = checkFolder(r.path, this.checkOpts());
      const ids = all ? [...new Set([r.agent.id, ...this.agents.map((a) => a.id)])] : [r.agent.id];
      // Taken out first: the access change that follows must not resolve it again as "agent".
      this.requests.resolve(r.requestId, "granted", all ? "all" : "agent");
      this.writeAccess(addFolder(this.access(), real, ids));
    } else {
      this.requests.resolve(r.requestId, "denied");
      this.record({
        agent: r.agent,
        kind: "access",
        summary: `not now: ${r.path}`,
        said: { key: "accessNotNow", path: r.path },
        result: "refused",
      });
    }
    this.emit({ kind: "access.resolved", requestId: r.requestId, decision });
    this.flushDecisions();
    return { access: this.access() };
  }

  /** `access.request` from the server: the agent asks for a folder; the person decides here. */
  async accessRequest(
    agent: AgentScope,
    req: Extract<MachineRequest, { op: "access.request" }>,
  ): Promise<MachineReplies["access.request"]> {
    if (!AccessRequests.validId(req.requestId)) throw new RunnerError("bad_request", "Invalid request id");
    if (typeof req.path !== "string" || !req.path.trim() || req.path.length > 1024) {
      throw new RunnerError("bad_request", "path must be a folder on this computer");
    }
    const given = req.path.trim();
    if (!given.startsWith("~") && !path.isAbsolute(given)) {
      throw new RunnerError("bad_request", "path must be absolute (a folder on this computer, like ~/Projects/app)");
    }
    const abs = expandHome(given);
    const id = String(agent.id);
    if (allowedFor(this.access(), id, abs)) return { requestId: req.requestId, status: "granted" };
    const handle = String(agent.handle ?? "");
    const name = this.agentName(agent);
    const existing = this.requests.get(req.requestId);
    const stored = this.requests.add({
      requestId: req.requestId,
      agent: { id, name, handle },
      path: abs,
      reason: typeof req.reason === "string" ? req.reason : "",
    });
    if (!existing) {
      const { agentHandle: _h, ...request } = stored;
      this.emit({ kind: "access.requested", request });
      this.record({
        agent: { id, name },
        kind: "access",
        summary: `asked for ${abs}`,
        said: { key: "accessAsked", path: abs },
        result: "running",
      });
      this.opts.print?.(
        `${name} asks for the folder ${abs}${stored.reason ? ` (${firstLine(stored.reason)})` : ""}. To allow it: agentes-runner folders allow ${shellWord(abs)} --agent ${handle}`,
      );
    }
    return { requestId: req.requestId, status: "pending" };
  }

  /** `access.reduce` from the site: removes, never widens. */
  async accessReduce(req: Extract<MachineRequest, { op: "access.reduce" }>): Promise<MachineReplies["access.reduce"]> {
    const before = this.access();
    const next = reduceAccess(before, req);
    if (JSON.stringify(next) !== JSON.stringify(before)) this.writeAccess(next);
    return { access: this.access() };
  }

  /** Pending requests that a new grant now covers (a terminal `folders allow`, a config edit) are granted. */
  private resolveSatisfied(access: RunnerAccess) {
    let any = false;
    for (const r of this.requests.list()) {
      if (!allowedFor(access, r.agent.id, r.path)) continue;
      this.requests.resolve(r.requestId, "granted", "agent");
      this.emit({ kind: "access.resolved", requestId: r.requestId, decision: "granted" });
      any = true;
    }
    if (any) this.flushDecisions();
  }

  private expireRequests() {
    const gone = this.requests.expire();
    for (const r of gone) {
      this.emit({ kind: "access.resolved", requestId: r.requestId, decision: "expired" });
      this.record({
        agent: r.agent,
        kind: "access",
        summary: `request expired: ${r.path}`,
        said: { key: "accessExpired", path: r.path },
        result: "refused",
      });
    }
    if (gone.length) this.flushDecisions();
  }

  /** Decisions the server hasn't had yet (after each `welcome`, and right after a decision). */
  private flushDecisions() {
    const sent: string[] = [];
    for (const d of this.requests.undelivered()) {
      if (
        !this.send({
          type: "access.decided",
          requestId: d.requestId,
          decision: d.decision,
          ...(d.scope ? { scope: d.scope } : {}),
        })
      )
        break;
      sent.push(d.requestId);
    }
    this.requests.delivered(sent);
  }

  // ── Jobs and the activity log ──────────────────────────────────────────────

  private agentName(agent: AgentScope | undefined): string {
    if (!agent) return "";
    const given = (agent as { name?: unknown }).name;
    if (typeof given === "string" && given.trim()) return given.trim().slice(0, 100);
    return this.agents.find((a) => a.id === agent.id)?.name ?? String(agent.handle ?? "");
  }

  private agentRef(agent: AgentScope | undefined) {
    return agent ? { id: String(agent.id), name: this.agentName(agent) } : undefined;
  }

  /** Appends to the activity log and tells the app (in order with the job events). */
  private record(entry: Omit<ActivityEntry, "at">, redact?: (text: string) => string) {
    const written = this.activity.append(entry, redact);
    this.emit({ kind: "activity", entry: written });
  }

  private redactor(agent: AgentScope | undefined): Promise<((t: string) => string) | undefined> {
    const dir = path.join(this.opts.home, "secrets");
    return agentSecrets(dir, agent)
      .then((s) => s?.redact)
      .catch(() => undefined);
  }

  private queue(fn: () => Promise<void> | void) {
    this.chain = this.chain.then(fn).catch((err: unknown) => {
      this.opts.log(`activity: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** What a request is, for the app: null for ops that aren't work (status, output, secrets…). */
  private describe(req: MachineRequest): Pick<ControlJob, "kind" | "summary" | "said" | "where" | "command"> | null {
    const p = (v: unknown) => String(v ?? "") || ".";
    switch (req.op) {
      case "read":
        return { kind: "read", summary: `read ${p(req.path)}`, said: { key: "read", path: p(req.path) } };
      case "write":
      case "pull":
        return { kind: "write", summary: `wrote ${p(req.path)}`, said: { key: "wrote", path: p(req.path) } };
      case "list":
        return { kind: "list", summary: `looked at ${p(req.path)}`, said: { key: "looked", path: p(req.path) } };
      case "push":
        return { kind: "push", summary: `sent ${p(req.path)}`, said: { key: "sent", path: p(req.path) } };
      case "exec": {
        const command = String(req.command ?? "");
        return {
          kind: "exec",
          summary: firstLine(command, 80),
          command,
          ...(typeof req.cwd === "string" && req.cwd.trim() ? { where: path.basename(req.cwd.trim()) } : {}),
        };
      }
      case "brain.turn": {
        const brain = req.kind === "codex" ? "Codex" : "Claude Code";
        return { kind: "brain", summary: `thinking with ${brain}`, said: { key: "thinking", brain } };
      }
      case "git.sync": {
        // Clones are work people see; the quick update before each turn is not.
        const clones = Array.isArray(req.repos) ? req.repos.filter((r) => r?.clone === true) : [];
        if (clones.length === 0) return null;
        const repos = clones.map((r) => String(r.repo ?? "")).join(", ");
        return { kind: "exec", summary: `git clone ${repos}`, command: `git clone ${repos}` };
      }
      default:
        return null;
    }
  }

  started(id: string, req: MachineRequest) {
    const d = this.describe(req);
    if (!d) return;
    const agent = this.agentRef(req.agent);
    const startedAt = new Date(this.now()).toISOString();
    this.queue(async () => {
      const redact = d.command ? await this.redactor(req.agent) : undefined;
      const clean = (s: string) => redactCommon(redact ? redact(s) : s);
      const job: ControlJob = {
        id,
        ...(agent ? { agent } : {}),
        kind: d.kind,
        summary: clean(d.summary),
        ...(d.said ? { said: d.said } : {}),
        ...(d.where ? { where: d.where } : {}),
        ...(d.command ? { command: clean(d.command).slice(0, 2000) } : {}),
        startedAt,
      };
      this.jobs.set(id, job);
      this.emit({ kind: "job.started", job });
    });
  }

  finished(id: string, req: MachineRequest, outcome: RequestOutcome) {
    const result = outcomeResult(req, outcome);
    if (req.op === "task.start") {
      this.queue(() => this.taskStarted(req, outcome, result));
      return;
    }
    const d = this.describe(req);
    if (!d) return;
    const agent = this.agentRef(req.agent);
    this.queue(async () => {
      const job = this.jobs.get(id);
      this.jobs.delete(id);
      if (job) this.emit({ kind: "job.finished", jobId: id, result });
      const redact = d.command ? await this.redactor(req.agent) : undefined;
      const kind = d.kind === "exec" ? "command" : d.kind === "brain" ? "brain" : "file";
      this.record(
        {
          ...(agent ? { agent } : {}),
          kind,
          summary:
            result === "refused" && !outcome.ok
              ? `${d.summary} (refused: ${firstLine(outcome.error.message, 80)})`
              : d.summary,
          // Refused: the line's mark says so, in the person's language.
          ...(d.said ? { said: d.said } : {}),
          ...(d.command ? { command: d.command } : {}),
          ...(d.where ? { where: d.where } : {}),
          result,
        },
        redact,
      );
    });
  }

  private taskJob(t: SettledTask): ControlJob {
    const agent = this.agents.find((a) => a.id === t.agentId);
    return {
      id: t.taskId,
      agent: { id: t.agentId, name: agent?.name ?? t.agentHandle },
      kind: "task",
      summary:
        t.executor === "shell" ? firstLine(t.command, 80) : t.executor === "codex" ? "Codex task" : "Claude Code task",
      // A shell task's line is its command; a CLI's, words the app says.
      ...(t.executor === "shell" ? {} : { said: { key: "task", executor: t.executor } }),
      where: path.basename(t.cwd),
      ...(t.executor === "shell" ? { command: t.command } : {}),
      startedAt: t.startedAt,
      background: true,
    };
  }

  private async taskStarted(
    req: Extract<MachineRequest, { op: "task.start" }>,
    outcome: RequestOutcome,
    result: "ok" | "failed" | "refused",
  ) {
    const agent = this.agentRef(req.agent);
    const redact = await this.redactor(req.agent);
    const clean = (s: string) => redactCommon(redact ? redact(s) : s);
    const executor = req.executor === "claude" || req.executor === "codex" ? req.executor : "shell";
    if (!outcome.ok) {
      this.record(
        {
          ...(agent ? { agent } : {}),
          kind: "task",
          summary: `${executor === "shell" ? firstLine(String(req.command ?? ""), 80) : executor === "codex" ? "Codex task" : "Claude Code task"} didn't start: ${firstLine(outcome.error.message, 80)}`,
          said: {
            key: "taskNotStarted",
            ...(executor === "shell" ? { what: firstLine(String(req.command ?? ""), 80) } : { executor }),
          },
          result,
        },
        redact,
      );
      return;
    }
    const data = outcome.data as MachineReplies["task.start"];
    const running = this.session?.tasks.runningTasks().find((t) => t.taskId === data.taskId);
    const job = running
      ? this.taskJob(running)
      : this.taskJob({
          taskId: data.taskId,
          agentId: String(req.agent?.id ?? ""),
          agentHandle: String(req.agent?.handle ?? ""),
          executor,
          command: data.command,
          cwd: data.cwd,
          startedAt: data.startedAt,
        });
    if (agent) job.agent = agent;
    job.summary = clean(job.summary);
    if (job.command) job.command = clean(job.command).slice(0, 2000);
    this.jobs.set(job.id, job);
    this.emit({ kind: "job.started", job });
    this.record({
      ...(job.agent ? { agent: job.agent } : {}),
      kind: "task",
      summary: `started: ${job.summary}`,
      said: { key: "taskStarted", ...taskWhat(job) },
      ...(job.command ? { command: job.command } : {}),
      ...(job.where ? { where: job.where } : {}),
      result: "running",
    });
  }

  private taskSettled(t: SettledTask) {
    this.queue(async () => {
      const job = this.jobs.get(t.taskId) ?? this.taskJob(t);
      this.jobs.delete(t.taskId);
      const done = t.done;
      const ok = done ? done.exitCode === 0 && !done.canceled && !done.interrupted && !done.timedOut : false;
      const result = done?.canceled ? "refused" : ok ? "ok" : "failed";
      this.emit({ kind: "job.finished", jobId: t.taskId, result });
      const redact = await this.redactor({ id: t.agentId, handle: t.agentHandle });
      const how = done?.canceled
        ? "canceled"
        : done?.interrupted
          ? "interrupted"
          : done?.timedOut
            ? "stopped (time limit)"
            : ok
              ? "finished"
              : `failed (exit ${done?.exitCode ?? "?"})`;
      const said: ActivitySaid = done?.canceled
        ? { key: "taskCanceled", ...taskWhat(job) }
        : done?.interrupted
          ? { key: "taskInterrupted", ...taskWhat(job) }
          : done?.timedOut
            ? { key: "taskTimedOut", ...taskWhat(job) }
            : ok
              ? { key: "taskFinished", ...taskWhat(job) }
              : { key: "taskFailed", exit: String(done?.exitCode ?? "?"), ...taskWhat(job) };
      this.record(
        {
          ...(job.agent ? { agent: job.agent } : {}),
          kind: "task",
          summary: `${how}: ${job.summary}`,
          said,
          ...(job.command ? { command: job.command } : {}),
          ...(job.where ? { where: job.where } : {}),
          result,
        },
        redact,
      );
    });
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  diagnostics(): string {
    const c = this.config;
    const access = this.access();
    const ex = this.executors();
    const bun = (process.versions as { bun?: string }).bun;
    const lines = [
      `agentes runner ${RUNNER_VERSION} (machine protocol ${MACHINE_PROTOCOL_VERSION}, control ${CONTROL_PROTOCOL_VERSION})`,
      `Runtime: ${bun ? `bun ${bun}` : `node ${process.version}`}${this.self.compiled ? " (compiled)" : ""}`,
      `OS: ${os.type()} ${os.release()} (${process.platform} ${os.arch()})`,
      `Home: ${this.opts.home}`,
      `Config: ${configPath(this.opts.home)}`,
      ...(this.opts.logFile ? [`Log: ${this.opts.logFile}`] : []),
      `Workspace: ${c ? (this.session?.workspaceReal ?? c.workspace) : "-"}`,
      `Server: ${this.stored?.server ?? "-"}`,
      `Machine: ${c ? `${c.name} (${c.machineId})` : "not connected"}`,
      `Organization: ${c?.orgName ? `${c.orgName} (${c.orgId ?? ""})` : "-"}`,
      `Managed by: ${c?.managedBy ?? "terminal"}`,
      `Connection: ${c ? this.connState : "unpaired"}`,
      `Paused: ${this.pauseState().paused ? (this.pauseState().until ?? "until resumed") : "no"}`,
      `Tools: ${TOOL_NAMES.map((t) => `${t} ${access.tools[t] ? "on" : "off"}`).join(", ")}`,
      `Allowed folders: ${access.folders.length}`,
      `Claude Code: ${ex.claude ? `${ex.claude.version}${ex.claude.loggedIn === false ? " (not logged in)" : ""}` : "not found"}`,
      `Codex: ${ex.codex ? ex.codex.version : "not found"}`,
      `Agents: ${this.agents.length}`,
      `Running now: ${this.jobList().length}`,
      "",
      "Recent log:",
      ...(this.opts.logFile ? tailLines(this.opts.logFile, 200) : []),
    ];
    let text = lines.join("\n");
    if (c?.token) text = text.split(c.token).join("agm_***");
    return redactCommon(text);
  }
}

/** ok / failed / refused for one request. */
function outcomeResult(req: MachineRequest, outcome: RequestOutcome): "ok" | "failed" | "refused" {
  if (!outcome.ok) return REFUSED.has(outcome.error.code) ? "refused" : "failed";
  if (req.op === "exec") {
    const d = outcome.data as { exitCode?: number } | null;
    return d && d.exitCode === 0 ? "ok" : "failed";
  }
  if (req.op === "brain.turn") {
    const d = outcome.data as { final?: { type?: string } } | null;
    return d?.final?.type === "error" ? "failed" : "ok";
  }
  return "ok";
}

/** A path as one word for a shell command line people copy. */
function shellWord(p: string) {
  return /^[\w./~:-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/** Root's shared git cache on a system-mode computer (ADR 0116 §4); its owner is made on the first clone. */
function rootGitCache() {
  let owner: { uid: number; gid: number } | null = null;
  return systemGitCache({
    root: GIT_CACHE_DIR,
    owner: () => {
      owner ??= ensureGitCacheUser();
      return owner;
    },
    grant: (dir, uid) => grantGitCache(dir, uid),
  });
}
