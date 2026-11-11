/**
 * The control protocol between the desktop app and the runner it spawns
 * (ADR 0036). The app starts `agentes-runner app --home <dir>` as a child
 * process; stdin carries one `ControlIn` JSON object per line, stdout one
 * `ControlOut` per line. Nothing else is ever written to stdout in this mode
 * (logs go to `<home>/logs/`). Only the parent can talk to the runner: no
 * socket, no port. The machine token never crosses this channel.
 *
 * Shared by the runner and the desktop app, so this file imports nothing but
 * types from the machine protocol.
 */
import type {
  AccountKind,
  AccountLoginState,
  RunnerAccess,
  RunnerAccountInfo,
  RunnerExecutorInfo,
  RunnerPause,
  RunnerPhone,
  RunnerTools,
} from "./machine-protocol";

/** Bumped on breaking changes; the app refuses a runner whose `hello.control` it doesn't know. */
export const CONTROL_PROTOCOL_VERSION = 1;

/** Largest line either side accepts (characters). */
export const CONTROL_MAX_LINE = 1024 * 1024;

/** An agent as the machine knows it (from the server's `agents` frame). */
export interface ControlAgent {
  id: string;
  handle: string;
  name: string;
  /** The agent's look, for drawing it with the shared engine; absent: the default look. */
  look?: { color?: string; eyes?: string; accessory?: string };
}

/**
 * What an agent's browser does now (ADR 0040), for the desktop app's tray:
 * open while its session is up, and the person's turn (a request waiting, or
 * someone in control) as the server told it (`browser.handoff`).
 */
export interface ControlBrowser {
  agentId: string;
  /** The session is up (it answered recently, or someone is watching it). */
  open: boolean;
  /** The page's host (`app.acme.example`), when known. */
  host?: string;
  /** What the agent did last, as a key the app words (`reading`, `clicking`, `filling`…). */
  doing?: ControlBrowserDoing;
  /** When the agent last ran a command in it (ISO); absent: older runner. Open isn't busy: it stays up 15 min idle. */
  actedAt?: string;
  /** Someone is watching (`watch`) or driving (`control`) its live view. */
  mode?: "watch" | "control";
  /** A request waiting for a person, or a person in control. */
  handoff?: { status: "pending" | "active"; controller?: string; request?: string; link?: string };
  /** The conversation the agent last used it for (`/org/…/c/…`), for "Ver". */
  link?: string;
}

export type ControlBrowserDoing =
  | "opening"
  | "reading"
  | "clicking"
  | "filling"
  | "choosing"
  | "typing"
  | "scrolling"
  | "waiting"
  | "uploading"
  | "capturing"
  | "tabs";

/** Where the runner stands. */
export interface ControlStatus {
  paired: boolean;
  /** Our server, e.g. `https://app.agentes.chat`. */
  server?: string;
  /**
   * `logoEtag`: the organization's logo cached on this computer (absent: none);
   * when it changes the app asks `org.logo` again.
   */
  org?: { id: string; name: string; logoEtag?: string };
  machine?: { id: string; name: string };
  /**
   * `unpaired`: no config yet; `connecting`/`online`/`offline`: the socket;
   * `refused`: the server closed it for good (`refusedReason`); `outdated`:
   * the server needs a newer runner (the app says "Atualize").
   */
  connection: "unpaired" | "connecting" | "online" | "offline" | "refused" | "outdated";
  refusedReason?: "invalid_token" | "revoked" | "replaced";
  /** The runner's version and machine protocol. */
  version: string;
  protocol: number;
  paused: RunnerPause;
  executors: { claude?: RunnerExecutorInfo; codex?: RunnerExecutorInfo };
  /** Absolute path of the workspace (the agents' folders live inside it). */
  workspace?: string;
  /** Agents of the organization that use this computer. */
  agents: ControlAgent[];
  /** Protocol 10: folders and tools allowed on this machine. */
  access?: RunnerAccess;
  /** The agents' browsers that are open or have a person's turn (absent: older runner). */
  browsers?: ControlBrowser[];
  /** The phones this computer reaches now, as the server hears them (absent: older runner, or no phones looked for). */
  phones?: RunnerPhone[];
  /** The OS user agents' commands run as here (absent: older runner). */
  user?: string;
  /**
   * Grows by one for every status the runner reports (events and `status` replies alike), from 1
   * when the process starts; the app keeps the newest and drops anything older. Absent: older runner.
   */
  seq?: number;
}

/** Something running now on behalf of an agent. */
export interface ControlJob {
  id: string;
  agent?: { id: string; name: string };
  kind: "exec" | "read" | "write" | "list" | "push" | "task" | "brain";
  /** Short, human, English-free when possible: the app shows it as is, e.g. a command or a file name. */
  summary: string;
  /** The same as words the app says in the person's language (as `ActivityEntry.said`): absent, `summary` is shown. */
  said?: ActivitySaid;
  /** Folder name it works in (last part of the cwd), when known. */
  where?: string;
  /** The command line (redacted), for `exec` and shell tasks. */
  command?: string;
  startedAt: string;
  /** A background task (survives runner restarts). */
  background?: boolean;
}

/** One line of the local activity log (`<home>/activity.jsonl`). */
export interface ActivityEntry {
  at: string;
  agent?: { id: string; name: string };
  kind: "file" | "command" | "task" | "brain" | "access" | "pause" | "pair" | "update";
  /** What happened, short (`read src/app.ts`, `bun test`, `paused until 16:24`), in English. */
  summary: string;
  /**
   * The same as words the desktop app says in the person's language (`desktop.prefs.activity.said.<key>`), with
   * their values (a path, a command, a workspace's name). Absent from older runners: the app shows `summary`.
   */
  said?: ActivitySaid;
  /** The command line with secrets redacted. */
  command?: string;
  /** Folder name it happened in. */
  where?: string;
  result?: "ok" | "failed" | "refused" | "running";
}

/** An activity line's words and their values, all text. */
export type ActivitySaid = { key: string } & Record<string, string>;

/** A folder an agent asked for, waiting for the person (protocol 10). */
export interface ControlAccessRequest {
  requestId: string;
  agent: { id: string; name: string };
  path: string;
  reason: string;
  at: string;
  expiresAt: string;
}

/** Settings the app may change (never the token, server, machine id). */
export interface ControlConfigPatch {
  name?: string;
  maxConcurrentTasks?: number;
  taskMaxSeconds?: number;
  brainIdleMinutes?: number;
  brainMaxProcesses?: number;
}

/** Settings as `config.get` returns them. */
export interface ControlConfig extends Required<ControlConfigPatch> {
  workspace: string;
  managedBy?: "desktop";
}

/**
 * What a Mac needs before agents can use an iPhone through it, as the desktop app's iPhone setup shows it: Xcode, the
 * iOS platform Xcode builds for an iPhone with, and an Apple Account in Xcode. The iPhone's own steps (plugged in,
 * trusted, Developer Mode, UI Automation, the test helper) are its reason in `ControlStatus.phones`.
 */
export interface ControlIphoneSetup {
  /** Xcode's version ("26.3"); null: no Xcode (or only the command line tools). */
  xcode: string | null;
  /** The iOS platform: installed (its version), being downloaded (`iphone.download`), missing, or a download failed. */
  platform:
    | { state: "installed"; version: string }
    | { state: "missing" }
    | { state: "downloading"; percent: number | null; done?: string; total?: string }
    | { state: "failed"; message: string };
  /** The Apple Account in Xcode › Settings › Apple Accounts, by its team (a free one is a Personal Team); null: none. */
  account: { name: string; personal: boolean } | null;
  /** With `account: null`: Xcode lists an Apple Account that shows no team yet (an older app shows it missing). */
  noTeam?: true;
  /** The iPhone SDK's version ("26.2"): an iPhone on a newer iOS needs a newer Xcode. */
  sdk?: string;
}

/** App → runner requests. Every request is answered by exactly one `reply` with the same `id`. */
export type ControlRequest =
  | { type: "status" }
  | { type: "jobs" }
  | { type: "pause"; until: string | null }
  | { type: "resume" }
  /** Newest first; `before`: an `at` from the previous page. */
  | { type: "activity"; before?: string; limit?: number; agentId?: string }
  | { type: "config.get" }
  | { type: "config.set"; patch: ControlConfigPatch }
  /**
   * Starts the device-code sign-in against `server` (ADR 0036 §5). The reply
   * comes at once; progress comes as `pair.code`, then `pair.done` or
   * `pair.failed` events.
   */
  | {
      type: "pair.start";
      server: string;
      name?: string;
      /**
       * Which coding CLIs the person chose at first run (ADR 0036 §8: off
       * unless chosen). Commands always start off from the app. Absent: both off.
       */
      tools?: { claude?: boolean; codex?: boolean };
      /**
       * A connect link's code (`agenteschat://pair`): the server asks the link's maker to let this computer in, as
       * `agentes-runner pair --link` does, and nobody confirms the device code. `pair.code` still comes first.
       */
      link?: string;
    }
  | { type: "pair.cancel" }
  /** Forgets the pairing (the token is deleted; the server side is the site's "Desconectar"). */
  | { type: "unpair" }
  | { type: "diagnostics" }
  /** The organization's logo, fetched by the runner with its token (the app never sees the token). */
  | { type: "org.logo" }
  /** Protocol 10. */
  | { type: "access.get" }
  | { type: "folders.add"; path: string; agents: string[] }
  | { type: "folders.remove"; path: string; agentId?: string }
  | { type: "folders.setAgents"; path: string; agents: string[] }
  | { type: "tools.set"; tool: keyof RunnerTools; on: boolean }
  | { type: "access.pending" }
  | { type: "access.answer"; requestId: string; decision: "granted" | "denied"; scope: "agent" | "all" }
  /**
   * Drops the connection to the server and opens it again at once (the app's
   * "Reconnect"). `reconnecting: false` when there is no connection to drop
   * (not paired, or refused). An older runner answers `bad_request`.
   */
  | { type: "reconnect" }
  /** Closes an agent's browser on this computer (the tray's "Parar"); its profile stays. */
  | { type: "browser.stop"; agentId: string }
  /**
   * ADR 0041: the computer brains' accounts on this computer. `accounts.list`
   * asks each CLI (cached). `account.begin` starts the CLI's sign-in here: it
   * opens this computer's browser and finishes by itself; poll `account.status`.
   * The server learns about the new account from the next `hello`/status.
   */
  | { type: "accounts.list" }
  | { type: "account.begin"; kind: AccountKind }
  | { type: "account.status"; loginId: string }
  | { type: "account.cancel"; loginId: string }
  | { type: "account.remove"; kind: AccountKind; accountId: string }
  /** The Mac's side of setting up an iPhone (macOS; elsewhere nothing is found). */
  | { type: "iphone.setup" }
  /** Starts downloading the iOS platform when Xcode lacks it; the reply and `iphone.setup` show its progress. */
  | { type: "iphone.download" }
  /** Opens Xcode (its Accounts are only there), or Xcode's page in the App Store. */
  | { type: "iphone.open"; app: "xcode" | "appStore" }
  /** Finish what's running briefly, then exit 0 (the app quits). */
  | { type: "shutdown" };

export type ControlIn = { id: string } & ControlRequest;

/** What each request answers with `ok: true`. */
export interface ControlReplies {
  status: ControlStatus;
  jobs: { jobs: ControlJob[] };
  pause: { paused: RunnerPause };
  resume: { paused: RunnerPause };
  activity: { entries: ActivityEntry[]; more: boolean };
  "config.get": ControlConfig;
  "config.set": ControlConfig;
  "pair.start": { started: true };
  "pair.cancel": { canceled: boolean };
  unpair: { unpaired: true };
  /** Redacted: versions, OS, recent log lines with secrets removed. Safe to paste in a support chat. */
  diagnostics: { text: string };
  /** A `data:image/png|jpeg|webp;base64,…` URL; null without a logo (the app draws the initial). */
  "org.logo": { logo: string | null };
  "access.get": RunnerAccess;
  "folders.add": RunnerAccess;
  "folders.remove": RunnerAccess;
  "folders.setAgents": RunnerAccess;
  "tools.set": RunnerAccess;
  "access.pending": { requests: ControlAccessRequest[] };
  "access.answer": { access: RunnerAccess };
  reconnect: { reconnecting: boolean };
  "browser.stop": { stopped: boolean };
  "accounts.list": { accounts: RunnerAccountInfo[] };
  /** The URL the CLI opened (shown in case the browser didn't open) and, for Codex, the code to type there. */
  "account.begin": { loginId: string; url: string; userCode?: string };
  "account.status": { state: AccountLoginState; account?: RunnerAccountInfo; error?: string };
  "account.cancel": { canceled: boolean };
  "account.remove": { removed: boolean };
  "iphone.setup": ControlIphoneSetup;
  "iphone.download": ControlIphoneSetup;
  "iphone.open": { opened: boolean };
  shutdown: { stopping: true };
}

export type ControlErrorCode =
  | "bad_request"
  | "not_paired"
  | "already_paired"
  | "not_found"
  /** A folder that doesn't exist, isn't a directory, or is a system folder we refuse (`/`, the home itself). */
  | "invalid_path"
  | "internal";

/** Something happened; the app updates its view. */
export type ControlEvent =
  | { kind: "status"; status: ControlStatus }
  | { kind: "job.started"; job: ControlJob }
  | { kind: "job.finished"; jobId: string; result: "ok" | "failed" | "refused" }
  | { kind: "activity"; entry: ActivityEntry }
  | { kind: "pair.code"; userCode: string; verificationUrl: string; expiresAt: string }
  | { kind: "pair.done"; org: { id: string; name: string }; machine: { id: string; name: string } }
  /** `link_invalid`: the link expired or was used (an older runner says `internal`). */
  | { kind: "pair.failed"; code: "expired" | "denied" | "network" | "internal" | "link_invalid"; message: string }
  | { kind: "access.requested"; request: ControlAccessRequest }
  | { kind: "access.resolved"; requestId: string; decision: "granted" | "denied" | "expired" }
  | { kind: "access.changed"; access: RunnerAccess };

/** Runner → app. */
export type ControlOut =
  /** First line after start. */
  | { type: "hello"; control: number; version: string; protocol: number; home: string }
  | { type: "reply"; id: string; ok: true; data: unknown }
  | { type: "reply"; id: string; ok: false; error: { code: ControlErrorCode; message: string } }
  | { type: "event"; event: ControlEvent };

/** Parses one stdin line; null when it isn't a request we know. */
export function parseControlIn(line: string): ControlIn | null {
  if (line.length > CONTROL_MAX_LINE) return null;
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || o.id.length > 100 || typeof o.type !== "string") return null;
  return o as unknown as ControlIn;
}
