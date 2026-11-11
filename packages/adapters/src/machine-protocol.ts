import type { MergeDone } from "./command-policy";
/**
 * The wire protocol between our server and the runner on a connected
 * computer (ADR 0025). JSON text frames over one WebSocket the runner opens
 * to `/api/machines/connect`. Shared by the server and the runner bundle, so
 * this file imports nothing.
 */

/** Bumped on breaking changes; the server refuses runners older than `MIN_RUNNER_PROTOCOL`. */
export const MACHINE_PROTOCOL_VERSION = 55;
export const MIN_RUNNER_PROTOCOL = 1;
/** From this protocol on, requests carry `agent` and each agent works in its own folder. */
export const AGENT_FOLDERS_PROTOCOL = 2;
/** From this protocol on, the runner keeps secrets for each agent (`op: "secret"`, ADR 0027). */
export const SECRETS_PROTOCOL = 3;
/** Staged ciphertext and a separate activation after the server commits delivery. */
export const SECRET_ACTIVATE_PROTOCOL = 26;
/** From this protocol on, the runner runs background tasks that outlive a request (`task.*`, ADR 0029). */
export const TASKS_PROTOCOL = 4;
/**
 * From this protocol on, a task can belong to a mission: the runner gives the
 * executor the local `agentes` MCP server and relays its calls (`mcp.call` /
 * `mcp.result`, ADR 0029).
 */
export const MISSION_PROTOCOL = 5;
/**
 * From this protocol on, the runner answers `task.output` (the last human
 * lines of a task's log, ADR 0029) and reports pull requests it sees in a
 * task's output (`task.event` `prUrl`). Older runners ignore unknown ops, so
 * the server only asks runners at this protocol or later.
 */
export const TASK_OUTPUT_PROTOCOL = 6;
/**
 * From this protocol on, `hello` says which coding CLIs the machine has
 * (`executors`), and a mission task carries its permission profile
 * (`mission.mode`, `mission.branchPrefix`): Claude Code gets a generated
 * `--settings` file with what it may run without asking (ADR 0029).
 */
export const EXECUTORS_PROTOCOL = 7;
/**
 * From this protocol on, the `agentes` MCP server is a bridge (ADR 0032): a
 * mission task (or a computer-brain run) carries a server-issued token
 * (`mission.mcpToken`), the runner sends it with every `mcp.call`, and
 * `tools/list` is asked from the server (`mcp.list` / `mcp.tools`): the
 * tools are the run's Tool Gateway tools, not a fixed list.
 */
export const BRIDGE_PROTOCOL = 8;
/** Server-issued run tool tokens (ADR 0032): `agr_` + 32 random bytes in base64url. */
export const RUN_TOOL_TOKEN_PREFIX = "agr_";
export const isRunToolToken = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 100 && /^agr_[A-Za-z0-9_-]{20,96}$/.test(v);
/**
 * From this protocol on, the runner runs conversational brain turns
 * (`brain.turn`, ADR 0032): Claude Code thinks for an agent on the machine,
 * streaming `brain.event` frames, and keeps one process per thread alive.
 * `hello.executors.claude` also says whether Claude Code is logged in. The
 * server never sends `brain.turn` to an older runner.
 */
export const BRAIN_PROTOCOL = 8;
/**
 * From this protocol on (ADR 0036): requests carry the agent's display name
 * (`agent.name`, for the runner's local activity log), and the owner can
 * pause the computer. `hello.paused` and `runner.state` say whether it is
 * paused and until when; the server sends no new work to a paused machine
 * (it refuses with `machine_paused`), and the runner refuses new work with
 * `paused` too, as a guard. Work already running finishes.
 */
export const PAUSE_PROTOCOL = 9;
/**
 * From this protocol on (ADR 0036, v0.2): access lives on the machine. The
 * runner reports which folders outside the agents' own folders are allowed,
 * for which agents, and which tools are on (`hello.access`, `access.changed`).
 * Request paths may be absolute when they fall inside a folder allowed for
 * that agent. An agent asks for a folder with `access.request`; the person
 * decides on the machine and the runner sends `access.decided`. The server
 * can never widen access; it only shows it and asks the runner to reduce it
 * (`access.reduce`).
 */
export const ACCESS_PROTOCOL = 10;

/**
 * From this protocol on (ADR 0024 addendum): `git.sync` clones or updates an
 * agent's checkouts of GitHub repositories inside its own folder
 * (`repos/<owner>/<name>`), through our git proxy. The request carries our
 * short-lived proxy credential (never a GitHub token); the runner keeps it
 * outside the agent's folder and points each checkout's remote and
 * credential helper at it. The server never sends `git.sync` to an older runner.
 */
export const GIT_PROTOCOL = 11;

/**
 * From this protocol on (ADR 0040): the agent browser. The runner drives
 * `agent-browser` (pinned below), one headless session per agent with its
 * profile in the agent's folder, when the person turned `access.tools.browser`
 * on. `hello.browser` says whether it can serve. `browser.act` runs one
 * `agent-browser` command; `browser.stream.*` relays its JPEG stream as
 * `browser.frame` frames only while someone watches, and `browser.input` sends
 * a person's input back. The server never sends `browser.*` to an older runner.
 */
export const BROWSER_PROTOCOL = 12;

/**
 * From this protocol on (ADR 0041): accounts and effort for the computer
 * brains. An account is a folder in `<runner home>/accounts/<kind>/<id>`,
 * used as `CLAUDE_CONFIG_DIR` (Claude Code) or `CODEX_HOME` (Codex); the CLI
 * keeps its own sign-in there and the runner never reads it. `op: "account"`
 * starts a sign-in (`begin`), takes the Claude code sealed to the machine
 * (`code`), reports it (`status`), cancels it, lists and removes accounts.
 * `hello.accounts` lists them; `brain.turn` carries `account` and `effort`.
 * The server never sends these to an older runner.
 */
export const ACCOUNTS_PROTOCOL = 13;
/**
 * From this protocol on (ADR 0044): a mission has one worktree and one
 * branch (`mission.worktree`: `ensure` creates or checks it and copies the
 * files git ignores, `remove` takes the folder away). A task can end in a
 * commit (`TaskStart.commit`, `TaskDone.startSha` / `endSha`) and can check
 * how far the mission's base moved (`TaskStart.baseCheck`). The server never
 * starts a mission on an older runner.
 */
export const MISSION_WORKTREE_PROTOCOL = 14;
/**
 * From this protocol on (live steering): `brain.steer` hands messages to a
 * Claude Code turn in progress (stream-json user lines on its stdin, read at
 * its next tool boundary), and the turn reports which it read
 * (`brain.event` `steer_read`). Older runners would drop the unknown op: the
 * server never sends it to them (their turns read new messages at the end).
 * A Codex turn on the runner's `codex app-server` takes them too (`turn/steer`,
 * read at its next model request); one run by `codex exec` answers
 * `unsupported` (no new protocol number: the reply already says what it can).
 */
export const STEER_PROTOCOL = 15;
/**
 * From this protocol on (ADR 0053 §3): a Codex `brain.turn` honours
 * `permissions` and `keepAlive`. `plan`: a read-only sandbox without network;
 * `work`: a workspace sandbox without network where each command or file
 * approval Codex asks (`approvalPolicy: "untrusted"`) is answered by the same
 * command policy as Claude Code's permission prompt. `keepAlive: false` (a
 * background turn) leaves no app-server behind. Claude Code's `plan` turns read
 * only on our prompt tool, with no settings files. An older runner would run
 * Codex with no approvals and the network on, and its Claude Code `plan` reads
 * secrets and loads the project's settings files: the server never sends it a
 * Codex turn nor a Claude Code `plan` turn (`runner_outdated`).
 */
export const BRAIN_PROFILES_PROTOCOL = 16;
/**
 * From this protocol on (ADR 0054): `browser.batch` runs several browser
 * commands in one round trip (an action, the wait for the page to settle and
 * the look after it), and `browser.capture` returns the page as a JPEG with
 * its elements numbered and boxed. Older runners get the same commands one
 * `browser.act` at a time, and no images: targets are then found on the
 * page's text only.
 */
export const BROWSER_FAST_PROTOCOL = 17;
/**
 * From this protocol on (ADR 0058): the agent's desktop and a terminal on its
 * computer. `hello.desktop` and `hello.terminal` say whether the runner can
 * serve them; the person turns them on on the machine (`access.tools.desktop`,
 * `access.tools.terminal`). `desktop.session.*` starts, stops and reports an
 * agent's desktop. `stream.open` makes the runner dial one data socket
 * (`/api/machines/stream`) for one viewer of a desktop (raw RFB) or one
 * terminal (its bytes), so a busy screen never delays this socket. The server
 * never sends these to an older runner.
 */
export const DESKTOP_PROTOCOL = 18;

/**
 * Every agent desktop's size: viewers scale it, they never resize it. 900 tall
 * so the agent's Chrome, maximized under the panel, still shows a page about
 * 800 tall, like the headless one the screen layer was measured on (ADR 0054).
 */
export const DESKTOP_SIZE = { width: 1280, height: 900 } as const;

/** Protocol 21: the largest parts of a `desktop.act`. */
export const DESKTOP_LIMITS = {
  /** Characters typed or filled in one action. */
  text: 4000,
  /** A key combination (`ctrl+shift+t`). */
  key: 64,
  /** A path to open, or an app's desktop entry id. */
  path: 1024,
  pauseMs: 10_000,
} as const;

/** Protocol 21: where a desktop action lands: an element of the last look, or a point on the screen (pixels). */
export type DesktopPoint = { ref: string } | { x: number; y: number };

/** Protocol 21: one action on the agent's desktop. */
export type DesktopAction =
  | { kind: "click" | "double_click" | "right_click" | "hover" | "focus" | "check" | "uncheck"; at: DesktopPoint }
  | { kind: "drag"; from: DesktopPoint; to: DesktopPoint }
  /** The element's whole text: set and read back where it takes text that way, else selected and typed over. */
  | { kind: "fill"; at: DesktopPoint; text: string }
  /** Into the element (clicked first), or wherever the focus is. */
  | { kind: "type"; text: string; at?: DesktopPoint }
  /** Opens the element's list and picks the option named `value`. */
  | { kind: "select"; at: { ref: string }; value: string }
  /** Key names joined by `+`: `ctrl+s`, `Enter`, `alt+F4`. */
  | { kind: "press"; key: string }
  /** Over the element, else over the active window. */
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; pixels: number; at?: DesktopPoint }
  /** An app by its desktop entry id (`thunar.desktop`, as `desktop.apps` lists it). */
  | { kind: "launch"; app: string }
  /** A file in the agent's folder (a relative path), or an absolute one in its home or a folder allowed for it. */
  | { kind: "open_file"; path: string }
  | { kind: "pause"; ms: number };

/** Protocol 21: a part of the screen, in pixels. */
export interface DesktopRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Protocol 21: the agent's desktop as screen text (lines `observeSnapshot` reads), its refs, app and window. */
export interface DesktopLookReply {
  snapshot: string;
  refs: Record<string, { role: string; name: string }>;
  /** `desktop://<app>/<main|dialog>`: the app in front, and whether its window is a dialog. */
  address: string;
  /** The active window's title. */
  title: string;
  screen: { width: number; height: number };
}

/** Protocol 21: the attribute of the agent browser's window in a look (one line: `browser_do` drives it). */
export const DESKTOP_AGENT_BROWSER = "agent browser: use browser_do";

/** The screens of an agent that people watch and take over: one open handoff per agent and screen. */
export const SCREEN_KINDS = ["browser", "desktop"] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];
/**
 * From this protocol on: plan usage, read by the CLIs without touching any
 * token. Accounts carry `usage` (`RunnerAccountInfo.usage`); `hello` and
 * `accounts.changed` carry the computer's own sign-ins' (`ownUsage`). It comes
 * from the turns (`rate_limit_event`, Codex's `account/rateLimits/updated`)
 * and from probes `list` asks for (`fresh`). The server never sends `fresh`
 * to an older runner.
 */
export const PLAN_USAGE_PROTOCOL = 19;
/**
 * From this protocol on: coding plans as key accounts on Claude Code (ADR
 * 0059). `begin` with `provider` (a plan of `@agenteschat/providers/plans`)
 * starts no CLI: the runner makes the folder and a key the browser seals the
 * plan's key to, and `code` hands it over (kept in the folder,
 * `provider.json`, mode 600). Turns in that folder think through the
 * endpoint the runner's own copy of the plans names. Accounts say their
 * `provider` and the key's last 4 (`keyHint`); a key its maker refused reads
 * as signed out. In system mode `agents` names each agent's `account`, whose
 * folder belongs to that agent's user only while it thinks with it. The
 * server never sends `provider` to an older runner.
 */
export const PLAN_KEYS_PROTOCOL = 20;
/**
 * From this protocol on (ADR 0062): the agent uses its own desktop.
 * `desktop.look` reads what it shows as screen text, `desktop.act` does one
 * action, waits for the screen to settle and looks again, `desktop.capture`
 * returns a JPEG with the look's elements boxed, `desktop.apps` lists the apps
 * it can start. `hello.desktopUse` says whether the runner serves it: only
 * where each agent works as its own OS user. The server never sends these to
 * an older runner.
 */
export const DESKTOP_USE_PROTOCOL = 21;
/**
 * From this protocol on: how big the computer is and how busy it gets.
 * `hello.size` gives the machine's logical CPUs and memory, the disk of its
 * workspace, and `limit` when the runner may use less (a container's limits);
 * a `pong` carries `load`, the last day's summary, after each new sample (every
 * `LOAD_SAMPLE_MS`). Nothing new goes to the runner, so an older one simply
 * sends neither: its size and load are unknown.
 */
export const MACHINE_STATS_PROTOCOL = 22;

/**
 * Protocol 22: a computer's size (`hello.size`), rounded: the whole machine's, which its load is
 * measured against, and `limit` when the process may use less of it (a container's CPU or memory limit).
 */
export interface MachineSize {
  cpus: number;
  memoryGb: number;
  diskGb: number;
  limit?: { cpus: number; memoryGb: number };
}

/**
 * Protocol 22: how busy a computer got over the last day (`pong.load`): the 5-minute load average per
 * logical CPU (1 = every CPU busy) and the share of memory in use (0 to 1), average and highest over
 * `hours` of samples.
 */
export interface MachineLoad {
  loadAvg: number;
  loadPeak: number;
  memoryAvg: number;
  memoryPeak: number;
  hours: number;
  /**
   * Processes the kernel stopped for running out of memory in the agents' slices (system mode under systemd,
   * `agents.slice`'s `memory.events`) over those hours. Absent where agents have no slices, or from an older
   * runner: the server needs to know nothing new, so no protocol number.
   */
  oomKills?: number;
  /**
   * Free space on the workspace's disk (GB) and the share of it in use (0 to 1), and the shared folder's size (GB,
   * measured hourly), ADR 0115. Absent from an older runner: no protocol number, as `oomKills`.
   */
  diskFreeGb?: number;
  diskUse?: number;
  sharedGb?: number;
}

/** How often a computer's load is sampled (protocol 22). */
export const LOAD_SAMPLE_MS = 5 * 60_000;

/**
 * From this protocol on: how much data the agents' browsers send and receive.
 * A `pong` carries `browserTraffic`, the last day's sum, after each new sample
 * (every `LOAD_SAMPLE_MS`), counted from the network events of the Chromes the
 * runner started, never from the rest of the machine. Nothing new goes to the
 * runner, so an older one simply never says.
 */
export const BROWSER_TRAFFIC_PROTOCOL = 23;

/** Protocol 23: what the agents' browsers sent (`up`) and received (`down`), in bytes, over the last `hours`. */
export interface BrowserTraffic {
  up: number;
  down: number;
  hours: number;
}

/**
 * From this protocol on (ADR 0076): `desktop.text`, the text on an agent's
 * screen, read on the computer (tesseract, as the agent's own user) from a
 * capture like `desktop.capture`'s, for screening a person in control on
 * agentes.chat Cloud. The image never leaves the computer. A screen whose
 * capture didn't change since the last read answers `same`. Served where
 * desktop use is (`desktop_unavailable` without tesseract). The server never
 * sends it to an older runner.
 */
export const DESKTOP_TEXT_PROTOCOL = 25;
/** The most text one `desktop.text` answers (characters). */
export const DESKTOP_TEXT_MAX = 16_000;

/**
 * From this protocol on (ADR 0040 §11): `browser.warm` starts the agent's
 * Chrome ahead of its first command, where that command would start it, on a
 * blank page with no stream; it does nothing while a person has the agent's
 * browser, while its Chrome runs or starts, or when it would take the
 * computer's last free browser. The answers of `browser.act`, `browser.batch`
 * and `browser.warm` say what they waited on before running (`setup`). The
 * server never sends `browser.warm` to an older runner, whose answers carry
 * no `setup`.
 */
export const BROWSER_WARM_PROTOCOL = 27;

/**
 * Protocol 35 (ADR 0116): `git.sync` repos may carry `github`, a short-lived single-repository GitHub App token
 * (contents: read). The checkout then fetches straight from github.com with it and pushes through our proxy
 * (`remote.origin.pushurl`). A clone outlives its request: past `timeoutSeconds` the answer is `cloning` and the
 * download goes on (at most two at once per computer, the rest wait); a later `git.sync` of the same folder waits
 * for it again. The server gives older runners the full clone deadline, and sends `github` only from
 * `GIT_STATELESS_TOKEN_PROTOCOL` on.
 */
export const GIT_DIRECT_PROTOCOL = 35;

/**
 * Protocol 53: `git.sync`'s `github` may also be GitHub's stateless installation token (`ghs_<app id>_<JWT>`, about
 * 520 characters, with dots and dashes), the only kind GitHub mints since its rollout ended on 2026-10-02 (GitHub
 * changelog, "Stateless GitHub App installation tokens rolled out"). Runners 35 to 52 take only the old 40-character
 * kind and refuse the whole `git.sync` on any other, so the server sends them no `github`: their checkouts fetch
 * through the proxy.
 */
export const GIT_STATELESS_TOKEN_PROTOCOL = 53;
/**
 * A GitHub App installation token of either kind (GitHub's own pattern, `ghs_[A-Za-z0-9._-]{36,}`, bounded). Never a
 * person's: OAuth (`gho_`), personal (`ghp_`, `github_pat_`) and user-to-server (`ghu_`) tokens don't match.
 */
export const GITHUB_APP_TOKEN = /^ghs_[A-Za-z0-9._-]{36,4096}$/;

/**
 * Protocol 34: browser profiles (ADR 0110). Every `browser.*` op may carry `profile: { id }`: it runs in that
 * profile's session (one Chrome per profile, in `<runner home>/browser-profiles/<id>`, always headless) instead of
 * the agent's; `agent` still says who acts. `browser.profile.delete` stops its Chrome and removes its folder. Frames
 * of a profile's stream carry `agentId: "profile:<id>"`. A system-mode runner refuses profiles (phase 2).
 */
export const BROWSER_PROFILE_PROTOCOL = 34;

/**
 * From this protocol on: `brain.turn` carries `contextTokens`, the most context the agent's model reads
 * (Claude Code compacts there, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; Codex too, `model_auto_compact_token_limit`).
 * An older runner never sees it.
 */
export const CONTEXT_LIMIT_PROTOCOL = 28;

/**
 * Protocol 27: what an agent's browser request waited on before it ran, in
 * milliseconds, each only when it happened: its worker starting (system mode),
 * `agent-browser` being found or downloaded, the
 * requests ahead of it in the agent's queue, the agent's desktop starting, and
 * Chrome starting.
 */
export interface BrowserSetup {
  worker?: number;
  install?: number;
  queued?: number;
  desktop?: number;
  launch?: number;
}

/** A runner's `setup` as the server keeps it: the known steps, whole milliseconds up to an hour; null when none. */
export function browserSetupOf(v: unknown): BrowserSetup | null {
  if (typeof v !== "object" || v === null) return null;
  const out: BrowserSetup = {};
  for (const key of ["worker", "install", "queued", "desktop", "launch"] as const) {
    const ms = (v as Record<string, unknown>)[key];
    if (typeof ms === "number" && Number.isInteger(ms) && ms >= 0 && ms <= 3_600_000) out[key] = ms;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * From this protocol on (ADR 0059 §2, amended 2026-10-30): one sign-in thinks
 * for every agent its owner gives it on the computer. Accounts say so
 * (`RunnerAccountInfo.shared`): where every agent is the runner's own user,
 * all of them; where each agent is its own OS user (system mode), those made
 * for all agents (`begin` with `shared`), which root keeps and never lends: a
 * Claude sign-in there is `claude setup-token`'s token, and root hands each
 * turn what its CLI needs over the agent's worker link. The server never
 * sends `shared` to an older runner.
 */
export const SHARED_ACCOUNTS_PROTOCOL = 29;
/**
 * From this protocol on, a Codex turn's `cwd` is read in the agent's own folder. An older runner read it in a
 * folder nested there, so a turn sent into one of the agent's checkouts was refused ("The folder … doesn't
 * exist"): the server sends an older runner's Codex turns to the agent's own folder, never a checkout.
 */
export const CODEX_FOLDER_PROTOCOL = 32;

/**
 * From this protocol on (ADR 0058 §17): a desktop stream changes mode in place, on its own data socket, when its
 * person takes control or hands it back. The server sends `{"type":"mode","mode"}` there; the runner logs in to the
 * desktop again with that mode's password, sends the same frame back where the old session's bytes end, and a new
 * RFB session follows on the same sockets. The server never sends it to an older runner, whose streams close and
 * open again in the new mode.
 */
export const DESKTOP_SWITCH_PROTOCOL = 30;

/**
 * From this protocol on (ADR 0114): the Cursor brain. `brain.turn` takes `kind: "cursor"` (Cursor's CLI, `agent -p`,
 * one process per turn), `account` takes `kind: "cursor"` (a browser sign-in, or a Cursor API key sealed to the
 * machine: `begin` with `provider: "cursor"`), `hello.executors.cursor` reports the CLI with the models its sign-in
 * lists, and `access.tools.cursor` turns it on or off. The server never sends any of these to an older runner.
 */
export const CURSOR_PROTOCOL = 36;
/** `account` `begin`'s `provider` for a Cursor account made with an API key (`CURSOR_API_KEY`) instead of a sign-in. */
export const CURSOR_KEY_PROVIDER = "cursor";
/**
 * From this protocol on (ADR 0057): in system mode the agents share the computer, none with memory or CPUs of its
 * own, and `agentes-runner computer` shows who uses it. Agents are told so only from here; an older runner still caps
 * each agent and has no such command.
 */
export const SHARED_COMPUTER_PROTOCOL = 37;
/**
 * From this protocol on, in system mode a ChatGPT sign-in is made for all of its owner's agents there too (`begin`'s
 * `shared` for `codex`): root keeps its `auth.json`, hands each turn a copy and takes refreshed copies back.
 */
export const SHARED_CODEX_PROTOCOL = 38;
/**
 * From this protocol on (ADR 0132): the OpenCode brain. `brain.turn` takes `kind: "opencode"` (OpenCode's CLI,
 * `opencode run --format json`, one process per turn), `account` takes `kind: "opencode"` (only an OpenCode key sealed
 * to the machine: `begin` with `provider: "zen"`), `hello.executors.opencode` reports the CLI with the models it lists
 * (`free` on OpenCode's free tier), and `access.tools.opencode` turns it on or off. The server never sends any of these
 * to an older runner.
 */
export const OPENCODE_PROTOCOL = 39;
/**
 * From this protocol on: a Claude Code `brain.turn` takes `conversation`, what holds for its conversation only. The
 * runner leaves it out of the appended system text and puts it at the head of the session's first message (again on
 * the first turn after the CLI compacts its history), so the system text is the same in every session of the agent
 * in one folder: `system` with that folder's CLAUDE.md and AGENTS.md at its end (the first runners of this protocol
 * put those in the first message too). An older runner gets both in `system`, as before.
 */
export const CONVERSATION_PROTOCOL = 40;
/**
 * From this protocol on (ADR 0137 §4, amended 2026-11-04): every CLI's `brain.turn` takes `permissions.mode: "chat"`,
 * the team's right hand thinking on a person's plan. The CLI gets none of its own tools it can switch off, only our
 * MCP bridge, no settings files, plugins, skills or slash commands, no folder but the agent's own (Codex and Cursor:
 * an empty one), none of the agent's secrets and no permission prompt. The runner checks the tools Claude Code and
 * OpenCode list (`init`, `debug agent`) before the turn can use one, and kills any CLI at the first call of a tool
 * that isn't our bridge's (Codex and Cursor list none: their output is all there is), ending the turn with
 * `tools_not_locked`. An older runner reads any mode but `plan` as `work`: the server never sends it a `chat` turn.
 */
export const LOCKED_BRAIN_PROTOCOL = 41;

/**
 * From this protocol on, the runner sends `executors.changed` when the coding CLIs it finds change mid-session (its
 * looks run in the background, so `hello` carries the last known list). An older server ignores the frame and learns
 * the list at the next `hello`; an older runner never sends it.
 */
export const EXECUTORS_CHANGED_PROTOCOL = 42;
/** `account` `begin`'s `provider` for an OpenCode account: an OpenCode (Zen / Go) API key, its only sign-in. */
export const OPENCODE_KEY_PROVIDER = "zen";
/**
 * From this protocol on (ADR 0142): the Grok brain. `brain.turn` takes `kind: "grok"` (xAI's Grok Build CLI,
 * `grok -p --output-format streaming-messages-json`, one process per turn), `account` takes `kind: "grok"` (a
 * device-code sign-in to a SuperGrok or X Premium+ plan in the account's own `GROK_HOME`), `hello.executors.grok`
 * reports the CLI with the models it lists, and `access.tools.grok` turns it on or off. A `chat` turn is checked on
 * the CLI's `init` like Claude Code's. The server never sends any of these to an older runner.
 */
export const GROK_PROTOCOL = 43;
/**
 * From this protocol on (ADR 0143): the Antigravity brain. `brain.turn` takes `kind: "antigravity"` (Google's
 * Antigravity CLI, `agy -p --output-format stream-json`, one process per turn), `account` takes `kind: "antigravity"`
 * (a Google sign-in by a pasted code, `agy acp --login`, in the account's own home: a Google AI Pro or Ultra plan, or
 * Gemini Enterprise with `provider: "enterprise"`, `GEMINI_ENTERPRISE_PROVIDER`), `hello.executors.antigravity` reports the CLI with the models it
 * lists, and `access.tools.antigravity` turns it on or off. A `chat` turn is checked on the CLI's `init`. The server
 * never sends any of these to an older runner.
 */
export const ANTIGRAVITY_PROTOCOL = 44;
/**
 * From this protocol on (ADR 0144): the Vault. `vault.key` makes a one-use key pair in the agent's process (its
 * worker in system mode) and answers its public key; the private key lives only in that process's memory, for two
 * minutes, and goes at its first use. Sealed to it: a login's password, typed by the browser command
 * `agentes:type_vault [ref, rule, boxJson]` only into a password field of a frame the rule allows (refusals answer a
 * `code`, `VAULT_TYPE_REFUSALS`), and keys for one command (`exec`'s `vault`, never `task.start`). A `request_secret`
 * code is typed one character per field (`agentes:type_secret [ref, NAME, site, ...moreRefs]`). Site passwords from
 * `request_secret` stay in memory only, every value opened is redacted from what leaves the computer, and a page
 * that tries to send a typed password in an address is stopped. The server sends none of these to an older runner.
 */
export const VAULT_PROTOCOL = 45;
/**
 * From this protocol on (ADR 0149): `brain.turn` carries `speed`, and a Codex turn that failed at that speed before
 * anything happened goes again at standard speed, with a `speed_fallback` event right before its `done`. An older
 * runner never sees it.
 */
export const SPEED_PROTOCOL = 46;
/**
 * From this protocol on: `pull`. A file too big for a `write` is fetched by the computer itself from a one-use URL of
 * ours and lands whole or not at all. An older runner takes files up to `MAX_INLINE_FILE_BYTES` only.
 */
export const FILE_PULL_PROTOCOL = 47;
/**
 * From this protocol on (ADR 0144 §8): `vault.password` makes a password in the agent's process (its worker in system
 * mode) and answers it sealed to the one-use public key the request carries, so it reaches the Vault as a box: no
 * command line, log or relay on the way reads it. The server sends it to no older runner.
 */
export const VAULT_PASSWORD_PROTOCOL = 48;
/** What a password is made of. */
export const PASSWORD_CLASSES = ["lower", "upper", "digits", "symbols"] as const;
export type PasswordClass = (typeof PASSWORD_CLASSES)[number];
/** The shape of a password `vault.password` makes: a site's own rules, as the agent read them. */
export interface PasswordRules {
  length: number;
  classes: PasswordClass[];
}
export const PASSWORD_LENGTH = { min: 8, max: 128, default: 20 } as const;
/**
 * From this protocol on: how each account signs in. Accounts carry `authMethod` (from what the runner keeps beside
 * and in the folder, never guessed), `statusUnknown` when the last look at their status said nothing for sure, and
 * Claude's `providerOrgId` / `orgName`; `hello` says which methods a new Claude sign-in for all agents can use here
 * (`claudeLoginMethods`); `begin` may name the `method` of a Claude subscription sign-in; a turn's `error` may say
 * its `cause` and the provider's `httpStatus`. The server sends `method` to no older runner, and reads an older
 * runner's missing `claudeLoginMethods` as `claudeLoginMethodsOf` says.
 */
export const CLAUDE_AUTH_PROTOCOL = 50;
/**
 * From this protocol on: a system-mode runner may list `cli_login` in `claudeLoginMethods`. Its turns on such a sign-in
 * run in root, as the sign-in's own OS user, with no tool of the CLI's that touches files or runs code; each agent's
 * worker serves those tools over its bridge. Root and worker speak of them on their link: `bridge.token`, `turn.cancel`
 * and `turn.detach` from root, `turn.context` (`TurnContext`) and `tool.notice` (`ToolNotice`) from the worker; a
 * background task's CLI is root's too, its worker hearing `task.out` and `task.exit` and asking `task.stop`. On the
 * server's side of the wire only the `agents` frame changes: its `deleted` says which agents are gone for good, what an
 * archived or moved agent, which also leaves the list, isn't. An older runner just never lists the method.
 */
export const CLAUDE_SHARED_PROTOCOL = 51;
/**
 * From this protocol on: the page size of an agent's (or a profile's) browser. `browser.act` takes
 * `agentes:viewport [device, width?, height?]`: `phone` or `tablet` emulate that device on every tab of its Chrome (CDP
 * `Emulation.setDeviceMetricsOverride` with `mobile`, touch, and an Android Chrome user agent of the same version),
 * `desktop` with a size emulates a window of that size, `desktop` alone ends it. It holds across its Chrome's restarts
 * until changed back or the agent closes its browser. Frames carry `emulated` meanwhile, and so do `browser.act` and
 * `browser.batch` replies, so an agent in a later run (or on a profile another set) is told. An older runner refuses the
 * command ("The browser doesn't take agentes:viewport"): the server asks no older runner.
 */
export const BROWSER_VIEWPORT_PROTOCOL = 52;
/**
 * Bring your own devices: `hello.phones` and `phones.changed` (the phones this computer reaches: Android over adb, an
 * iPhone through `devicectl`, its own emulators and simulators), `hello.toolchains`, and the `phone.*` ops. Each phone
 * op names one phone and the holder it runs for; the runner keeps the phone's lock and answers `phone_busy` for
 * another holder. Older runners report no phones, so nothing asks them.
 */
export const PHONES_PROTOCOL = 54;
/**
 * A phone's screen live, a stream (`stream.open` with `kind: "phone"`): the runner sends its pictures as binary frames
 * (a PNG or a JPEG each, at most `PHONE_VIEW.window` the viewer hasn't acknowledged), and a viewer in control sends
 * `tap`, `swipe`, `text` and `key` text frames. Control takes the phone for the person (`phone.holder`); an agent
 * holding it waits until they give it back, and what it was doing on the phone stops. Older runners don't know the
 * stream: the server refuses it as `runner_outdated`.
 */
export const PHONE_SCREEN_PROTOCOL = 55;
/** Pairing an Android phone over Wi-Fi (`phone.pair.*`): the server asks no older runner. */
export const PHONE_PAIRING_PROTOCOL = 55;

export type PhonePlatform = "android" | "ios";
export type PhoneKind = "device" | "emulator" | "simulator";
/** A phone the host sees; one it doesn't see isn't reported (the server marks it offline). */
export type PhoneState = "ready" | "needs_you" | "preparing" | "unsupported";
/** Why a phone isn't ready, as a code the apps word. */
export type PhoneReason =
  /** The screen is locked (iPhone), or the phone asks to be unlocked to trust the computer. */
  | "locked"
  /** Android: USB debugging isn't allowed for this computer yet (tap Allow on the phone). */
  | "unauthorized"
  /** iPhone: the phone doesn't trust this Mac yet (tap Trust on the phone). */
  | "untrusted"
  /** iPhone: Developer Mode is off (Settings › Privacy & Security › Developer Mode). */
  | "developer_mode_off"
  /** iPhone: Settings › Developer › Enable UI Automation is off. */
  | "ui_automation_off"
  /** iPhone: no Xcode on the Mac, or its iPhone SDK is older than the phone's iOS (`xcode_too_old`). */
  | "xcode_missing"
  | "xcode_too_old"
  /** iPhone: the Mac is preparing the phone (device support download, needs internet). */
  | "device_support"
  /** iPhone: the test helper isn't built yet, or its free signature ran out (`helper_expired`). */
  | "helper_missing"
  | "helper_expired"
  /** iPhone: Xcode on the Mac is signed in to no Apple Account (Xcode › Settings › Apple Accounts), so nothing signs the helper. */
  | "apple_account_missing"
  /** iPhone: Xcode lists an Apple Account but no team yet (it shows one after its first build for an iPhone). */
  | "apple_team_missing"
  /** iPhone: the phone refused UI actions (unlocked, so its daily passcode grant or UI Automation). */
  | "ui_not_authorized"
  /** iPhone: a free Apple Account's limit (3 apps of its own per phone, 10 app ids a week) stops the helper. */
  | "team_limit"
  /** iPhone: the phone doesn't trust the helper's developer yet (Settings › General › VPN & Device Management). */
  | "helper_untrusted"
  /** An emulator or simulator still starting. */
  | "booting"
  /** Windows sees no driver for this phone (install its maker's USB driver). */
  | "no_driver"
  /** Too old an OS for the tools (`unsupported`): Android before 5, iOS before 17. */
  | "os_too_old"
  /** adb reports the phone `offline` (replug it, or it is restarting). */
  | "adb_offline";

/** Who holds a phone: the run and agent, and the person it works for. */
export interface PhoneHolder {
  runId: string | null;
  agentId: string | null;
  userId: string | null;
  /** What it is doing, in the agent's words ("Recording a test video"). */
  label?: string;
  /** ISO; when it first took the phone. */
  since: string;
}

/** One phone in `hello.phones` / `phones.changed`. */
export interface RunnerPhone {
  platform: PhonePlatform;
  /** adb's serial, or the UDID. */
  serial: string;
  kind: PhoneKind;
  /** The maker's model name ("Pixel 8", "iPhone 16"). */
  model: string;
  /** The name the phone itself carries, when it has one ("Sam's iPhone"). */
  name?: string;
  osVersion: string;
  state: PhoneState;
  reason?: PhoneReason;
  transport?: "usb" | "wifi" | "local";
  screen?: { width: number; height: number };
  abi?: string;
  power?: "ac" | "battery";
  battery?: number;
  /** Who holds it now; null or absent: free. */
  holder?: PhoneHolder | null;
}

/** `PHONES_PROTOCOL`: where pairing an Android phone over Wi-Fi (Wireless debugging) stands on its computer. */
export type PhonePairState = "waiting" | "pairing" | "connecting" | "connected" | "failed";
/** Why a Wi-Fi pairing failed, as a code the apps word. */
export type PhonePairFailure =
  /** adb's mDNS is off on the computer, so it can't find phones on the network. */
  | "mdns_off"
  /** The phone couldn't be reached (another network, or one that keeps devices apart). */
  | "same_wifi"
  /** The phone didn't take the pairing (a wrong code, or its pairing screen closed). */
  | "refused"
  /** Nothing scanned the code, or nothing answered, in 2 minutes. */
  | "timed_out"
  /** Under Android 14, or a security patch before 2026-05-01 (CVE-2026-0073): disconnected again. */
  | "outdated"
  | "adb_missing"
  | "canceled"
  | "failed";

export interface PhonePairing {
  id: string;
  way: "qr" | "code";
  state: PhonePairState;
  reason?: PhonePairFailure;
  /** Only in `phone.pair.start`'s answer: the QR text, `WIFI:T:ADB;S:<service>;P:<password>;;`. */
  qr?: string;
  /** Connected: the phone's own serial, as `phones.changed` reports it. */
  serial?: string;
  /** ISO: when it stops waiting for the phone. */
  expiresAt: string;
}

/** `192.168.1.20:37099` (or `[fe80::1]:37099`) as the phone shows it under Pair device with pairing code. */
export function pairAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(text);
  const v6 = /^\[([0-9a-fA-F:%.\w]{2,60})\]:(\d{1,5})$/.exec(text);
  const port = Number((v4 ? v4[5] : v6?.[2]) ?? 0);
  if (port < 1 || port > 65535) return null;
  if (v4?.slice(1, 5).every((o) => Number(o) <= 255)) return text;
  return v6?.[1]?.includes(":") ? text : null;
}

/** What this computer can build and drive with (versions found, best effort; absent: not found). */
export interface RunnerToolchains {
  git?: string;
  java?: string;
  /** The Android SDK's folder was found (`ANDROID_HOME`, the usual places). */
  androidSdk?: string;
  adb?: string;
  scrcpy?: string;
  maestro?: string;
  /** Xcode's version (macOS). */
  xcode?: string;
  /** The Apple Account team that signs the iPhone test helper, as Xcode names it ("Sam Rivera (Personal Team)"). */
  appleTeam?: string;
  /** What Xcode's Apple Accounts give: a team, an account with no team yet, or no account. */
  appleAccount?: "team" | "no_team" | "none";
  /** The iPhone SDK's version (`xcrun --sdk iphoneos --show-sdk-version`, "26.2"): the newest iOS it drives. */
  xcodeSdk?: string;
  node?: string;
  /** Podman's version: with the runner in system mode, the agents' containers (ADR 0169). */
  podman?: string;
}

/** The phone a `phone.*` op is for. */
export interface PhoneTarget {
  platform: PhonePlatform;
  serial: string;
  /** Whom it runs for: the call takes the phone, or renews the lock, as this holder. */
  holder: PhoneHolder;
}

/** The keys a person presses on a phone's screen from the apps. */
export const PHONE_KEYS = [
  "home",
  "back",
  "enter",
  "delete",
  "app_switch",
  "volume_up",
  "volume_down",
  "power",
] as const;
export type PhoneKey = (typeof PHONE_KEYS)[number];

/** A phone's screen live (`stream.open` with `kind: "phone"`). */
export const PHONE_VIEW = {
  /** Pictures on their way that the viewer hasn't acknowledged (`{"type":"ack"}` once it drew one). */
  window: 2,
  /** The shortest time between two pictures: about 8 a second at most. */
  frameMs: 120,
  /** How often an unchanged screen is looked at again. */
  idleMs: 400,
  /** A swipe's length, in milliseconds. */
  swipeMs: [1, 5000] as [number, number],
  /** Characters typed in one `text` frame. */
  text: 2000,
} as const;
export const BROWSER_DEVICES = ["phone", "tablet", "desktop"] as const;
export type BrowserDevice = (typeof BROWSER_DEVICES)[number];
/** A phone's and a tablet's size when none is given, in CSS pixels, and their pixel ratio. */
export const BROWSER_DEVICE_SIZES = {
  phone: { width: 390, height: 844, scale: 3 },
  tablet: { width: 820, height: 1180, scale: 2 },
} as const;
/** An exact page size's bounds, each side, in CSS pixels. */
export const BROWSER_VIEWPORT_SIDE = { min: 200, max: 3840 } as const;
export const isBrowserDevice = (v: unknown): v is BrowserDevice => BROWSER_DEVICES.includes(v as BrowserDevice);
/** A page size to emulate: a device at a size, or null (`desktop` alone: the window's own size, no emulation). */
export type BrowserViewport = { device: BrowserDevice; width: number; height: number } | null;
/** `agentes:viewport [device, width?, height?]`'s arguments, checked; undefined when they aren't. */
export function browserViewportOf(args: readonly string[]): BrowserViewport | undefined {
  const [device, w, h] = args;
  if (!isBrowserDevice(device) || (args.length !== 1 && args.length !== 3)) return undefined;
  if (args.length === 1) {
    if (device === "desktop") return null;
    const { width, height } = BROWSER_DEVICE_SIZES[device];
    return { device, width, height };
  }
  const side = (v: string | undefined) => {
    const n = /^\d{1,5}$/.test(v ?? "") ? Number(v) : Number.NaN;
    return n >= BROWSER_VIEWPORT_SIDE.min && n <= BROWSER_VIEWPORT_SIDE.max ? n : undefined;
  };
  const width = side(w);
  const height = side(h);
  return width && height ? { device, width, height } : undefined;
}
/** A reply's `emulated` (protocol 52), checked; undefined when there is none or it isn't one. */
export function emulatedOf(v: unknown): NonNullable<BrowserViewport> | undefined {
  return isObject(v)
    ? (browserViewportOf([String(v.device), String(v.width), String(v.height)]) ?? undefined)
    : undefined;
}
/**
 * Protocol 45 (ADR 0144 §6): how long a runner keeps a site's password or code from `request_secret`, in its memory
 * only, from the moment it got it (never across its own restart). The server counts a `site` delivery older than this
 * as gone too: it doesn't tell the agent it holds it, nor list it on the agent's page.
 */
export const SITE_SECRET_TTL_MS = 15 * 60_000;
/**
 * From this protocol on (ADR 0040 §7.1): an agent's browser has a live view socket of its own. Before
 * `browser.stream.start`, the server sends `browser.view.open` with a fresh `streamId`; the runner's own process (root
 * in system mode) dials a data socket for it (`/api/machines/stream`, `stream.hello` as a desktop's), and that
 * agent's frames go there as bytes (`encodeBrowserFrame`) instead of `browser.frame` on this socket: at most
 * `BROWSER_VIEW.window` unacknowledged (the server answers each with `{"type":"ack"}`), only the newest one waiting.
 * A slow link then shows the page as it is now instead of replaying the seconds it fell behind, and a picture never
 * delays a command. Without the view (it closed, or an older server) frames go as `browser.frame` as before. The
 * server sends `browser.view.open` to no older runner.
 */
export const BROWSER_VIEW_PROTOCOL = 49;
/** Live view frames (ADR 0040 §7.1), on each hop: computer → server, and server → each person watching. */
export const BROWSER_VIEW = {
  /**
   * Frames on their way unacknowledged, per hop: enough to keep a link with a long round trip busy at the control
   * rate (15 fps over ~200 ms), few enough that a slow link holds at most a fifth of a second of pictures.
   */
  window: 3,
  /**
   * Computer → server: a full window with no acknowledgement for this long means the view's socket is dead (the
   * server answers on arrival, or within `ackOwedMs` when nobody watching has room): the runner closes it and its
   * frames go on the machine socket until the server opens a new one.
   */
  stallMs: 5000,
  /** The longest the server holds a frame's acknowledgement back while no viewer has room for more. */
  ackOwedMs: 2000,
  /** Server → a viewer that draws nothing for this long (a hidden tab): it gets the newest frame anyway. */
  viewerStallMs: 5000,
  /** Frames a second a viewer may ask for (`browser.watch`'s `maxFps`), and what an app that sends no acks gets. */
  maxFps: 15,
  legacyFps: 1,
} as const;
/** What `agentes:type_vault` (and a code typed into several fields) answers in `code` when it types nothing. */
export const VAULT_TYPE_REFUSALS = [
  /** The frame that owns the field (or one around it, or the page) is on no site the login's rule allows. */
  "wrong_site",
  /**
   * The field is inside an embedded frame (the ref is the frame's element): nothing of the Vault, nor a code, is
   * typed there; a person signs in through the browser hand-off.
   */
  "in_frame",
  /** The focused element isn't a password field. */
  "not_password_field",
  /** A code's field isn't a text, number or one-time-code input. */
  "not_code_field",
  /** The field's form is sent with an explicit `get`: the password would end up in an address. */
  "get_form",
  /** The key the value was sealed to is gone from the computer (expired, used, or the runner restarted). */
  "key_expired",
  /**
   * After a typed password: the page tried to send it in an address and the runner stopped that request; the
   * answer of the action that was going on says so.
   */
  "get_blocked",
  /**
   * Before a password: the guard that stops it leaving in an address wasn't confirmed by Chrome in time, so nothing
   * was typed (the guard is armed, and acknowledged, before every fill).
   */
  "unguarded",
] as const;
export type VaultTypeRefusal = (typeof VAULT_TYPE_REFUSALS)[number];
/** Keys one `exec` may carry (`ExecVault`). */
export const VAULT_EXEC_KEYS = 10;

/**
 * Protocol 45 (ADR 0144): keys from the Vault for one command, each sealed to the agent's `vault.key` with the
 * additional data `vaultAad({ keyId, agentId, use: { kind: "env", name } })`. They go into that one command's
 * environment and its output is redacted; they are never written anywhere.
 */
export interface ExecVault {
  keyId: string;
  keys: { name: string; box: WireSecretBox }[];
}

/** Which CLI an account signs in. */
export type AccountKind = "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "claude_code",
  "codex",
  "cursor",
  "opencode",
  "grok",
  "antigravity",
];
export const isAccountKind = (v: unknown): v is AccountKind => ACCOUNT_KINDS.some((k) => k === v);
/** Account and sign-in ids: UUIDs (the server makes them; the desktop app's runner too). */
export const isAccountId = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/** How hard a computer brain thinks (Claude Code `--effort`; Codex maps `xhigh`/`max` to `high`). */
export type BrainEffort = "low" | "medium" | "high" | "xhigh" | "max";
export const BRAIN_EFFORTS: readonly BrainEffort[] = ["low", "medium", "high", "xhigh", "max"];
export const isBrainEffort = (v: unknown): v is BrainEffort =>
  typeof v === "string" && (BRAIN_EFFORTS as readonly string[]).includes(v);

/** How fast an agent answers in conversations (ADR 0149): `fast` is the provider's Fast mode. */
export type BrainSpeed = "standard" | "fast";
export const BRAIN_SPEEDS: readonly BrainSpeed[] = ["standard", "fast"];
export const isBrainSpeed = (v: unknown): v is BrainSpeed =>
  typeof v === "string" && (BRAIN_SPEEDS as readonly string[]).includes(v);

/** A `brain.turn`'s `contextTokens` the runner applies (protocol 28): a whole number of tokens in a sane range. */
export const isContextTokens = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 50_000 && v <= 10_000_000;

/**
 * How an account signs in (protocol 50). `cli_login`: the CLI's own sign-in, kept and refreshed by the CLI in the
 * folder. `setup_token`: `claude setup-token`'s long-lived token, kept by root and handed to each turn. `api_key`: a
 * pasted key (a coding plan's, Cursor's, OpenCode's).
 */
export type AuthMethod = "cli_login" | "setup_token" | "api_key";
export const AUTH_METHODS: readonly AuthMethod[] = ["cli_login", "setup_token", "api_key"];
export const isAuthMethod = (v: unknown): v is AuthMethod => AUTH_METHODS.some((m) => m === v);
/** The methods a `begin` may name (a key account names its `provider` instead). */
export type ClaudeLoginMethod = Exclude<AuthMethod, "api_key">;
export const isClaudeLoginMethod = (v: unknown): v is ClaudeLoginMethod => v === "cli_login" || v === "setup_token";
/**
 * What a new Claude sign-in for all agents can use on a computer: what its runner said (protocol 50), else what
 * runners did before saying it (`claude setup-token` in system mode, the CLI's own sign-in elsewhere).
 */
export const claudeLoginMethodsOf = (said: readonly AuthMethod[] | undefined, system: boolean): AuthMethod[] =>
  said ? [...said] : [system ? "setup_token" : "cli_login"];

/** Why a provider refused or failed a turn (protocol 50), as far as the runner could tell from the CLI. */
export type ProviderFailureCause =
  | "auth_rejected"
  | "account_disabled"
  | "quota"
  | "billing"
  | "provider_transient"
  | "network"
  | "unknown";
export const PROVIDER_FAILURE_CAUSES: readonly ProviderFailureCause[] = [
  "auth_rejected",
  "account_disabled",
  "quota",
  "billing",
  "provider_transient",
  "network",
  "unknown",
];
export const isProviderFailureCause = (v: unknown): v is ProviderFailureCause =>
  PROVIDER_FAILURE_CAUSES.some((c) => c === v);

/** Claude's organization id (`claude auth status --json` `orgId`), when it is a short word. */
export const providerOrgIdOf = (v: unknown): string | undefined =>
  typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : undefined;
/** Claude's organization name, control characters out and cut to 120. */
export const providerOrgNameOf = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const name = v
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return name || undefined;
};

/** An account on the machine, as the runner sees it (`hello.accounts`, `account` replies). No secrets. */
export interface RunnerAccountInfo {
  id: string;
  kind: AccountKind;
  /** The CLI's status command says it is signed in. */
  loggedIn: boolean;
  email?: string;
  /** `pro`, `max`, `ultra`, `team`, `enterprise`… from what the CLI says. */
  plan?: string;
  /** Protocol 19: the plan's usage limits, as last seen. */
  usage?: PlanUsage;
  /** Protocol 20: a key account's coding plan (`zai`, `kimi`…); absent for the CLI's own sign-in. */
  provider?: string;
  /** Protocol 20: the last 4 characters of a key account's key. */
  keyHint?: string;
  /** Protocol 29: it thinks for several of its owner's agents at once. */
  shared?: boolean;
  /** Protocol 50: how it signs in, when the runner knows for sure. */
  authMethod?: AuthMethod;
  /**
   * Protocol 50: the last look at its status was inconclusive (the CLI timed out, didn't start or answered nothing
   * readable); `loggedIn` is then the last conclusive answer the runner knew.
   */
  statusUnknown?: true;
  /** Protocol 50: the Claude organization it signed in to (no secret). */
  providerOrgId?: string;
  orgName?: string;
}

/** A plan's usage window: how much of it is used (0–100) and when it resets. */
export interface PlanWindow {
  kind: PlanWindowKind;
  /** `other`: what the provider calls it ("Extra usage", a model's name). */
  label?: string;
  usedPercent: number;
  resetsAt?: string;
}
export type PlanWindowKind = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "monthly" | "other";
export const PLAN_WINDOW_KINDS: readonly PlanWindowKind[] = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "monthly",
  "other",
];

/** Protocol 19: a plan's usage limits as the CLI or the provider said them (`at`), during a turn or by a probe. */
export interface PlanUsage {
  windows: PlanWindow[];
  /** The plan refused a request for its limit (cleared when it allows one again). */
  limited?: boolean;
  source: "turn" | "probe";
  at: string;
  /** Server side only: the models at a limit of their own (`PlanModelLimit`), by model id. */
  models?: Record<string, PlanModelLimit>;
  /** Server side only, on a plan whose models have their own limits: the model that last answered with this key. */
  answered?: string;
}

/**
 * A model's own limit on a plan whose models each have one (`limitsPerModel`), seen `at`: until `until` (absent: not
 * known), `region` when the model answers only once the account allows the region it needs, or `off` when the plan
 * refused it for the key (the model or the account switched off there).
 */
export interface PlanModelLimit {
  at: string;
  until?: string;
  region?: true;
  off?: true;
  /** The key's workspace has no active subscription: every model is refused alike. */
  inactive?: true;
}

/** The computer's own sign-ins' usage (protocol 19), by brain. */
export type OwnPlanUsage = Partial<Record<AccountKind, PlanUsage>>;

/** `list.fresh` ids for the computer's own sign-ins (the rest are account ids). */
export const OWN_USAGE_ID: Record<AccountKind, string> = {
  claude_code: "own:claude_code",
  codex: "own:codex",
  cursor: "own:cursor",
  opencode: "own:opencode",
  grok: "own:grok",
  antigravity: "own:antigravity",
};

export const PLAN_USAGE_LIMITS = { windows: 8, label: 40 } as const;

/** Where a sign-in is: waiting for the person, done (signed in), failed or expired (folder removed). */
export type AccountLoginState = "waiting" | "done" | "failed" | "expired";

/**
 * Why a sign-in ended without signing in (`status`'s `code`, beside `error`), for the apps to say in their own words.
 * An older runner sends none.
 */
export const ACCOUNT_LOGIN_FAILURES = [
  /** The CLI isn't installed on the computer. */
  "not_installed",
  /** The CLI found no terminal to read the pasted code from. */
  "no_tty",
  /** The CLI couldn't reach the provider. */
  "network",
  /** The provider refused the pasted code: not the page's, already used, or too old. */
  "bad_code",
  /** The CLI stopped with an error of its own (its words in `message`). */
  "cli_exit",
  /** The CLI finished, but its status says the account isn't signed in (its words in `message`). */
  "not_signed_in_after_login",
  /** The CLI finished, but its status didn't answer in time. */
  "status_unknown",
  /** `claude setup-token` finished without showing its token. */
  "no_token",
  /** It signed in, but the computer couldn't keep the sign-in. */
  "not_kept",
  /** Nobody finished it within `ACCOUNT_LOGIN_TTL_MS` (`expired`). */
  "timeout",
  /** The person canceled it. */
  "canceled",
] as const;
export type AccountLoginFailure = (typeof ACCOUNT_LOGIN_FAILURES)[number];
export const isAccountLoginFailure = (v: unknown): v is AccountLoginFailure =>
  (ACCOUNT_LOGIN_FAILURES as readonly unknown[]).includes(v);

/**
 * `op: "account"` (protocol 13, ADR 0041 §2). `begin` starts the CLI's sign-in
 * in a new folder named `loginId` (it becomes the account id). Claude Code
 * answers the URL it printed and an ephemeral public key; the browser seals the
 * code the person pastes with it (AAD `accountCodeAad`), and `code` hands it to
 * the waiting CLI. Codex answers its device URL and one-time code. A sign-in
 * expires after `ACCOUNT_LOGIN_TTL_MS`.
 */
export type AccountRequest =
  /**
   * `again`: sign in once more to the existing account `loginId` (it was signed out); its folder stays on failure.
   * `email` (Claude Code): which account to sign in to (`claude auth login --email`), only if `isLoginEmail`;
   * an older runner leaves it out. Protocol 20, `provider`: a coding plan's key account (Claude Code), no CLI.
   * Protocol 29, `shared`: one sign-in for every agent of its owner there (`SHARED_ACCOUNTS_PROTOCOL`).
   * Protocol 50, `method` (a Claude subscription sign-in only): `setup_token` in system mode for all agents, or
   * `cli_login`; a runner that can't do it refuses (`unsupported`) and never signs in another way, and `again` on an
   * account that signs in another way is refused too. Absent: as before.
   */
  | {
      action: "begin";
      kind: AccountKind;
      loginId: string;
      again?: boolean;
      email?: string;
      provider?: string;
      shared?: boolean;
      method?: ClaudeLoginMethod;
    }
  | { action: "code"; loginId: string; aad: string; box: WireSecretBox }
  | { action: "status"; loginId: string }
  | { action: "cancel"; loginId: string }
  /**
   * Protocol 19: `fresh`, accounts (ids, or `OWN_USAGE_ID`s) whose usage to look up now: the runner
   * answers at once, probes in the background and sends `accounts.changed` when it knows more.
   */
  | { action: "list"; fresh?: string[] }
  | { action: "remove"; kind: AccountKind; accountId: string };

export const ACCOUNT_LOGIN_TTL_MS = 15 * 60_000;
/** A coding plan's id as the wire carries it (the runner and the server check it against their plans). */
export const isPlanProviderWord = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9_-]{0,19}$/.test(v);

/** Accounts per machine: the runner adds no more, and a list this long is never taken as complete by the server. */
export const MAX_MACHINE_ACCOUNTS = 100;
/** The AAD that binds a sealed Claude sign-in code to its sign-in and organization. */
export const accountCodeAad = (loginId: string, orgId: string) => `${loginId}|${orgId}|account`;

/**
 * An email a sign-in may name as its account: letters, digits and `._+-` only, never first in either part.
 * On Windows the CLI starts through the shell, so an address with `&`, `%`, `"` or `(` would run commands.
 */
export const isLoginEmail = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 254 &&
  /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}@[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(v);

/** The `agent-browser` release the runner and the desktop app ship (ADR 0040 §2). */
export const AGENT_BROWSER_VERSION = "0.39.1";
/** Targets of `agent-browser`'s release assets (`agent-browser-<target>`, `.exe` on Windows). */
export type AgentBrowserTarget = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64" | "win32-x64";
/** SHA-256 (hex) of each release asset of `AGENT_BROWSER_VERSION`, checked before the binary is used. */
export const AGENT_BROWSER_SHA256: Record<AgentBrowserTarget, string> = {
  "darwin-arm64": "cc18fac41d9dc9821918340a136e643286ea05544c4dd35671b796f1a874cdef",
  "darwin-x64": "339cb9aa6dfd404856cf938df34cd3b4779c61dfd57fc257be11b14fd1a885f9",
  "linux-arm64": "9d8fdc586056df65747927ae166157c83af91b52cea287175e5544afd2591d33",
  "linux-x64": "6906d3a2a67b05809932a93d99e53d1132373f0a52a617b2d6032dbb954df6fc",
  "win32-x64": "af1ff5f2afd5c187fb50ac3bbc1e7114baadc180d67cef63f644af9031be5049",
};
/** `darwin-arm64` → `agent-browser-darwin-arm64`; `win32-x64` → `agent-browser-win32-x64.exe`. */
export const agentBrowserAsset = (target: AgentBrowserTarget) =>
  `agent-browser-${target}${target.startsWith("win32") ? ".exe" : ""}`;
/** Where the pinned release asset for `target` is downloaded from. */
export const agentBrowserUrl = (target: AgentBrowserTarget) =>
  `https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/${agentBrowserAsset(target)}`;

/** Largest pieces of browser frames. */
export const BROWSER_LIMITS = {
  /** One `browser.frame` image (base64 JPEG). */
  frameBytes: 3 * 1024 * 1024,
  /** Events in one `browser.input`. */
  inputEvents: 100,
  /** A `text` input event (pasted or typed through the app's field). */
  inputText: 10_000,
  /** A `browser.act` command name, and its arguments as JSON characters. */
  command: 64,
  args: 64 * 1024,
  /** Commands in one `browser.batch` (protocol 17). */
  batchCommands: 40,
  url: 2048,
  title: 300,
  message: 500,
} as const;

/** Where people get Google Chrome, which agents' browsers run on (ADR 0133). */
export const CHROME_DOWNLOAD_URL = "https://www.google.com/chrome/";

/** What a runner's update or install says on a computer without Google Chrome (no root to install it). */
export const CHROME_NEEDED = `The agents' browser needs Google Chrome, which this computer doesn't have: install it from ${CHROME_DOWNLOAD_URL}`;

/**
 * Linux on ARM, where Google makes no Chrome, runs the distribution's Chromium instead (ADR 0153): Debian's package
 * (`/usr/bin/chromium`), else Ubuntu's snap (`/snap/bin/chromium`), Ubuntu having no Chromium package of its own.
 */
export const CHROMIUM_LINUX = ["/usr/bin/chromium", "/snap/bin/chromium"] as const;

/** Whether this computer's agents' browser is Chromium (`CHROMIUM_LINUX`) rather than Google Chrome (ADR 0153). */
export const usesChromium = (platform: string = process.platform, arch: string = process.arch) =>
  platform === "linux" && arch === "arm64";

/** `CHROME_NEEDED` on Linux on ARM (`usesChromium`). */
export const CHROMIUM_NEEDED =
  "The agents' browser needs Chromium, which this computer doesn't have (Google makes no Chrome for Linux on ARM): install it with sudo apt install chromium (Debian) or sudo snap install chromium (Ubuntu)";

/** What a runner's update or install says on this computer without its browser (`CHROME_NEEDED`, `CHROMIUM_NEEDED`). */
export const browserNeeded = (platform: string = process.platform, arch: string = process.arch) =>
  usesChromium(platform, arch) ? CHROMIUM_NEEDED : CHROME_NEEDED;

/**
 * What the agent is told, in plain words, when the computer's Google Chrome fails it (a `browser_unavailable` error,
 * whose message starts with one of these): missing (`missingServer` where root installs it), not starting (more may
 * follow: the libraries it lacks), the agent's profile not opening, or Chrome older than the one that last opened the
 * agent's profile (by a major version: an older Chrome can't open what a newer one wrote, and the agent would seem
 * signed out). The server reports each (`chromeFailureKind`).
 */
export const CHROME_FAILURES = {
  missing: "Google Chrome isn't installed on this computer. Install it from google.com/chrome, then try again.",
  /** `missing` on Linux on ARM (`usesChromium`): the same start, so `chromeFailureKind` reads it as missing. */
  missingChromium:
    "Google Chrome isn't installed on this computer, and Google makes none for Linux on ARM: install Chromium on it (sudo apt install chromium on Debian, sudo snap install chromium on Ubuntu), then try again.",
  missingServer:
    "Google Chrome isn't installed on this computer. Its admin should run the agentes.chat installer on it again.",
  start: "Google Chrome didn't start on this computer.",
  profile: "The agent's browser profile on this computer didn't open. Try again in a minute.",
  outdated:
    "Google Chrome on this computer is older than the one the agent's browser last ran on. Update Google Chrome on it, then try again.",
} as const;

export type ChromeFailure = "missing" | "start" | "profile" | "outdated";

/** Which of `CHROME_FAILURES` a runner's message is, or null for another one (an older runner's, a busy computer). */
export function chromeFailureKind(message: string): ChromeFailure | null {
  if (message.startsWith("Google Chrome isn't installed")) return "missing";
  if (message.startsWith(CHROME_FAILURES.start)) return "start";
  if (message.startsWith(CHROME_FAILURES.profile)) return "profile";
  if (message.startsWith(CHROME_FAILURES.outdated)) return "outdated";
  return null;
}

/** `hello.browser` (protocol 12): whether this machine can run the agent browser. */
export interface RunnerBrowserInfo {
  /** The binary is there (checked). */
  available: boolean;
  /** `agent-browser`'s version. */
  version?: string;
  /** The Chrome it uses, with its version when known ("Google Chrome 156.0.8078.79"). */
  chrome?: string;
  /** Why it isn't available, for people ("Chrome's libraries are missing: run …"), in English. */
  reason?: string;
  /** The same as a code the apps word in the person's language (`machines.reasons.<code>`); absent from older runners. */
  code?: string;
  /**
   * The computer has no Google Chrome at its standard path: the server tells the person once (or reports it, on a
   * computer of the Cloud's). Absent from runners before ADR 0133, which fetched Chrome for Testing themselves.
   */
  chromeMissing?: true;
}

/** `hello.desktop` (protocol 18): whether this machine can run the agents' desktops. */
export interface RunnerDesktopInfo {
  available: boolean;
  /** Why it isn't available, for people (what to install), in English. */
  reason?: string;
  /** The same as a code the apps word (`machines.reasons.<code>`); absent from older runners. */
  code?: string;
  /** The desktops' size in pixels (both or neither). */
  width?: number;
  height?: number;
}

/** `hello.terminal` (protocol 18): whether people can open a terminal on this machine. */
export interface RunnerTerminalInfo {
  available: boolean;
  reason?: string;
  /** `reason` as a code the apps word (`machines.reasons.<code>`); absent from older runners. */
  code?: string;
}

/** `hello.desktopUse` (protocol 21): whether agents can use their desktops here; `reason` says what is missing. */
export type RunnerDesktopUseInfo = RunnerTerminalInfo;

/** Desktop and terminal streams (protocol 18): sizes, rates, caps and timeouts. */
export const STREAM_LIMITS = {
  /** The server waits this long for the runner's data socket after `stream.open`. */
  openTimeoutMs: 20_000,
  /** A data socket's `stream.hello` must come this soon. */
  helloTimeoutMs: 10_000,
  /** Both sides ping this often: an idle desktop sends nothing, and proxies drop idle sockets. */
  pingMs: 30_000,
  /** Bytes queued to a viewer before its stream closes as too slow. */
  viewerBufferedMax: 8 << 20,
  /** Bytes queued on the runner's data socket before it stops reading from the desktop. */
  runnerBufferedMax: 4 << 20,
  /** Terminal output queued beyond this is dropped, with a marker. */
  terminalBufferMax: 1 << 20,
  /** A viewer's frame, and how many bytes a second a viewer may send. */
  clientFrameMax: 1 << 20,
  clientBytesPerSecond: 512 << 10,
  viewersPerDesktop: 4,
  terminalsPerAgent: 3,
  terminalsPerMachine: 10,
  terminalIdleMs: 30 * 60_000,
  terminalMaxMs: 12 * 3_600_000,
  /** Streams a person may open in a minute. */
  opensPerMinute: 30,
  /** The server checks this often that whoever has an open stream may still have it. */
  accessRecheckMs: 30_000,
  /** A terminal's size, inclusive. */
  cols: [20, 400],
  rows: [5, 200],
} as const;

/**
 * Close codes of desktop and terminal streams (protocol 18): the viewer's
 * socket (`/api/desktop`, `/api/terminal`) and the runner's data socket
 * (`/api/machines/stream`). A stream that ends closes both sides.
 */
export const STREAM_CLOSE = {
  normal: 1000,
  /** The server restarts: open again. */
  restarting: 1001,
  internal: 1011,
  /** A side doesn't keep up: its backlog passed the limit. */
  tooSlow: 1013,
  /**
   * Protocol 49: the runner closed a browser's live view that got no acknowledgement in `BROWSER_VIEW.stallMs` (its
   * link too slow, or dead). In 3000-4999 because the standard WebSocket client (Node's) refuses to send 1013.
   */
  viewTooSlow: 4413,
  badRequest: 4400,
  /** Data socket: a bad token, or another machine's stream. */
  badToken: 4401,
  /** Viewer: not allowed, or no longer. */
  forbidden: 4403,
  /** Viewer: no such agent, or no computer (or desktop) for it. Data socket: no such stream (ended, or served already). */
  notFound: 4404,
  /** Data socket: no `stream.hello` in time. Viewer: the computer didn't open the stream in time (retry). */
  late: 4408,
  /** Viewer: someone else is in control of the desktop. */
  hidden: 4409,
  /** Viewer: control isn't this person's (any more): open again as a watcher. */
  controlEnded: 4410,
  /** Viewer: too many streams, or opened too often. */
  tooMany: 4429,
  /** Viewer: the computer refused; the reason is its error code (or `machine_paused`, `runner_outdated`). */
  refused: 4502,
  /** Viewer: the computer is offline, or its socket is on another server (retry). */
  unreachable: 4503,
} as const;

/**
 * What a stream shows: one viewer of the agent's desktop, or one terminal as the agent with its size. An older
 * server may add a desktop's `keyboard` (a layout): it is ignored, as Xvnc types what the person's own layout made
 * (ADR 0058 §16).
 */
export type StreamRequest =
  | { kind: "desktop"; mode: DesktopMode }
  | { kind: "terminal"; cols: number; rows: number }
  /** A phone's screen (`PHONES_PROTOCOL`): `stream.open` carries the phone itself as `phone`, its holder the person. */
  | { kind: "phone"; mode: DesktopMode; phoneId: string };

/** A desktop stream's mode: `watch` logs in with the view-only password, `control` with the full one. */
export type DesktopMode = "watch" | "control";

/**
 * `stream.open` (protocol 18): one viewer of the request's agent's desktop
 * (`watch` logs in with the view-only password, `control` with the full one),
 * or one terminal as the agent. `streamId` (32 random bytes, base64url) names
 * the stream on the data socket. `start` (a desktop): one that isn't running
 * starts first; without it the runner refuses `desktop_off`, as runners before
 * it did. The server leaves it out while the agent may start nothing (held).
 */
export type StreamOpenRequest = StreamRequest & { streamId: string; start?: boolean; phone?: PhoneTarget };

/**
 * A data socket's first frame (runner → server, text): the machine's token
 * and the stream it serves. The server answers `{"type":"stream.ready"}` or
 * closes the socket.
 */
export interface StreamHello {
  type: "stream.hello";
  token: string;
  streamId: string;
}

/**
 * Text frames on a stream once it is ready (binary frames are the bytes): a
 * terminal's new size (viewer → runner) and how its shell ended (runner →
 * viewer); a desktop's mode (protocol 30, `DESKTOP_SWITCH_PROTOCOL`).
 */
export type StreamControl =
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number | null }
  | { type: "mode"; mode: DesktopMode }
  /** Protocol 49: a browser view's frame arrived (server → runner), or a phone's picture was drawn (viewer → runner). */
  | { type: "ack" }
  /** A person in control of a phone's screen (viewer → runner), at fractions (0 to 1) of its width and height. */
  | { type: "tap"; x: number; y: number }
  | { type: "swipe"; x1: number; y1: number; x2: number; y2: number; ms: number }
  | { type: "text"; text: string }
  | { type: "key"; key: PhoneKey };

/**
 * A person's turn in an agent's browser (`browser.handoff`, ADR 0040 §6), as
 * the desktop app shows it: a request waiting for someone (`pending`) or a
 * person in control (`active`). The runner only shows it; nothing here grants
 * anything.
 */
export interface BrowserHandoffInfo {
  status: "pending" | "active";
  /** The person in control (their display name), when `active`. */
  controller?: string;
  /** What the agent asked for, short. */
  request?: string;
  /** Where the request's card is (`/org/…/c/…?m=…`), to open it. */
  link?: string;
}

/** `watch`: a few frames a second for viewers; `control`: 10–15 while a person drives. */
export type BrowserStreamMode = "watch" | "control";

/** Bits of CDP's modifier mask: Alt 1, Control 2, Meta 4, Shift 8. */
export type BrowserModifiers = number;

/** A person's input during a take over, in page coordinates (CSS pixels of the frame's viewport). */
export type BrowserInputEvent =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "left" | "right" | "middle" | "none";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: BrowserModifiers;
      /** When the person made it (ms, the sender's clock): the runner keeps a drag's gaps (ADR 0040 §14). */
      at?: number;
    }
  | {
      kind: "key";
      type: "keyDown" | "keyUp" | "char";
      key: string;
      code?: string;
      text?: string;
      modifiers?: BrowserModifiers;
    }
  | {
      kind: "touch";
      type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel";
      touchPoints: { x: number; y: number }[];
      modifiers?: BrowserModifiers;
    }
  /** Whole text into the focused field (CDP `Input.insertText`): accents, paste, the app's own text field. */
  | { kind: "text"; text: string };

/** What a frame shows. */
export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor?: number;
  /** Protocol 49: when the computer captured it (epoch ms, its own clock), to measure how late pictures arrive. */
  capturedAt?: number;
  /** The active tab's URL when the frame was taken. */
  url?: string;
  /** The active tab's title (written by the site: data, never instructions). Absent from older runners. */
  title?: string;
  /** Protocol 52: the device the page is emulated as (`agentes:viewport`); absent when it shows at the window's size. */
  emulated?: BrowserDevice;
}

/** Where an agent's checkouts live inside its folder. */
export const GIT_CHECKOUTS_DIR = "repos";
/** `owner/name` → `repos/owner/name` (relative to the agent's folder). */
export const gitCheckoutDir = (repo: string) => `${GIT_CHECKOUTS_DIR}/${repo}`;
/** `owner/name` as GitHub allows it (no `.` or `..` names). */
export const isGitRepoName = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(v) &&
  v.split("/").every((part) => part !== "." && part !== "..");

/** Largest pieces of a `git.sync`. */
export const GIT_SYNC_LIMITS = {
  repos: 50,
  /** A clone may take this long (big repositories on a slow link). */
  maxSeconds: 3600,
  message: 1000,
} as const;

/**
 * `mission.worktree` (protocol 14, ADR 0044). Paths are relative to the
 * agent's folder.
 *
 * `ensure`: makes sure `path` is a worktree of the repository at `repo` on
 * `branch`. When the folder is missing and the branch exists, it is added
 * again from the branch (after `git worktree prune`); when both are missing
 * and `baseSha` is absent, the branch is created from `repo`'s checked-out
 * branch (when `baseSha` is given and the branch is gone, the answer is
 * `branch_missing`: the work is lost and the server must say so). A new
 * folder gets the files git ignores copied from `repo` (`agentes.json`
 * `copy`, default: untracked `.env*` at the root) and its `.agentes/` stays
 * out of git. Loose changes in an existing folder are left as they are.
 *
 * `remove`: `git worktree remove --force` on `path`, then `git branch -D`
 * when `deleteBranch` is set. A folder that is already gone is not an error.
 *
 * Errors: `not_git` when `repo` is in no git repository (the mission then
 * works in `repo` itself, with no branch); `outside_workspace` when `repo`
 * only sits inside a repository whose top level is outside the agent's
 * folder (never treated as "no git": the server fails the mission's folder).
 *
 * The files `ensure` copies are listed in the worktree's own git dir
 * (`<git-dir>/agentes-copied`, one path per line, never the shared
 * `info/exclude`), and a task's end-of-item commit leaves them out.
 */
export type MissionWorktreeRequest =
  | { action: "ensure"; repo: string; path: string; branch: string; baseSha?: string }
  | { action: "remove"; repo: string; path: string; branch: string; deleteBranch?: boolean };

/** `mission.worktree` `ensure` answer. */
export interface MissionWorktreeEnsured {
  path: string;
  branch: string;
  /** The branch the mission started from (`repo`'s checked-out branch when it was created). */
  baseBranch: string;
  baseSha: string;
  /** The folder was (re)made now: the server runs `setupCommand` before any item. */
  created: boolean;
  /** Whether the folder has loose changes (after a crash mid-item). */
  dirty: boolean;
  /**
   * What prepares the folder: `agentes.json` `setup`, else the install for
   * the root lockfile (`bun install`, `pnpm install --frozen-lockfile`,
   * `npm ci`, `yarn install --frozen-lockfile`); null when there is nothing
   * to run. Only meaningful when `created`.
   */
  setupCommand: string | null;
  /** Files copied from `repo`, relative to the folder. */
  copied: string[];
}

/** `git.sync` (protocol 11): clone or update an agent's checkouts through our proxy. */
export interface GitSyncRequest {
  /** Our proxy for the org's GitHub connection (`…/api/git/{orgId}/{connectionId}/`) and this agent's credential there. */
  proxy: { base: string; token: string };
  /** The commit author set in each checkout ("Theo (agentes)", "theo@agents.agentes.chat"). */
  author: { name: string; email: string };
  /**
   * `clone: false`: update it only when it is already there. `dir` is relative to the agent's folder. `github`
   * (protocol 35; GitHub's stateless kind from protocol 53, `GITHUB_APP_TOKEN`): a GitHub App installation token for
   * this repository only (contents: read, 1 hour).
   */
  repos: { repo: string; dir: string; clone: boolean; github?: string }[];
  /** Also update every checkout already under `repos/` (one `owner/name` level). */
  existing?: boolean;
  /** For the whole request; each fetch stops at the deadline (a slow or offline network never blocks). */
  timeoutSeconds: number;
  /** Send git's progress as `output` frames. */
  stream?: boolean;
}

export interface GitSyncRepo {
  repo: string;
  /** Relative to the agent's folder. */
  dir: string;
  /** Absolute path on the machine. */
  path?: string;
  /**
   * `missing`: not cloned (and not asked to); `failed`: see `message` (offline, refused by the proxy…);
   * `cloning` (protocol 35): still downloading in the background, or waiting for another download (`message`).
   */
  status: "cloned" | "updated" | "missing" | "failed" | "cloning";
  /** The branch checked out now, and the remote's default branch. */
  branch?: string;
  defaultBranch?: string;
  /** Short commit id of HEAD. */
  head?: string;
  /** Why it failed, or a warning (local changes kept the default branch from moving). */
  message?: string;
}

/** No valid `hello` within this time closes the socket. */
export const HELLO_TIMEOUT_MS = 10_000;
/** The server pings this often; the runner reconnects after two missed pings. */
export const HEARTBEAT_MS = 25_000;
/** Largest text frame either side accepts (a `write` of 5 MB is about 6.7 MB in base64). */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** `read`/`write` bodies (base64 in JSON); larger files go through `push` and `pull`. */
export const MAX_INLINE_FILE_BYTES = 5 * 1024 * 1024;

export const MACHINE_TOKEN_PREFIX = "agm_";

/** Same as `SecretBox` and `SecretTarget` in `secret-box.ts` (this file imports nothing). */
export interface WireSecretBox {
  v: number;
  epk: string;
  iv: string;
  ct: string;
}
export type WireSecretTarget = { kind: "env" } | { kind: "file"; path: string } | { kind: "site"; site: string };

/**
 * Secrets of the request's agent (ADR 0027): `keypair` makes the key for a
 * request (the private key stays on the machine), `deliver` validates and stages
 * only the sealed box, `activate` opens it after the server commits delivery,
 * `discard` drops a request's key and staged box, `remove` forgets a secret.
 * A runner that keeps a site's password for its browser alone (target `site`:
 * typed on that site, never in a command's environment) says so in its
 * `keypair` answer (`sites`); the server asks an older one for an environment
 * variable instead, as before.
 */
export type SecretRequest =
  | { action: "keypair"; requestId: string }
  | { action: "deliver"; requestId: string; name: string; target: WireSecretTarget; aad: string; box: WireSecretBox }
  | { action: "activate"; requestId: string; order: string }
  | { action: "discard"; requestId: string }
  | { action: "remove"; name: string; requestIds?: string[]; throughOrder?: string };

export type MachineOs = "linux" | "darwin" | "windows" | "other";

/** What runs a background task: Claude Code, Codex, or a plain shell command. */
export type TaskExecutor = "claude" | "codex" | "shell";
export const TASK_EXECUTORS: readonly TaskExecutor[] = ["claude", "codex", "shell"];

/**
 * From this protocol on (ADR 0041 §5.1): a Claude Code or Codex `task.start` carries `account`, and the task's CLI
 * signs in with it exactly as the agent's turns do (the account's folder, or what root keeps for it), never with
 * the computer's own sign-in instead. Its credential is never written to the task's files. An older runner never
 * gets `account` and starts every task on the computer's own sign-in, as before.
 */
export const TASK_ACCOUNTS_PROTOCOL = 31;

/**
 * A background task (protocol 4): started detached on the machine, so it
 * survives the runner restarting and the socket dropping; its output goes to
 * files in `<runner home>/tasks/<taskId>/` and its state to the runner's
 * journal. The runner streams `task.event` frames and sends `task.done` once,
 * until the server acknowledges it (`task.ack`).
 */
export interface TaskStart {
  /** Chosen by the server (a UUID). */
  taskId: string;
  executor: TaskExecutor;
  /** `shell`: the command line. */
  command?: string;
  /** `claude` / `codex`: what to do. */
  prompt?: string;
  /** `claude`: the session to continue (one per conversation); the runner resumes it when it exists. */
  session?: string;
  /** `claude`: the server knows this session ran before (a hint; the runner checks on disk). */
  resume?: boolean;
  /** Relative to the agent's folder (default: the folder itself). */
  cwd?: string;
  /**
   * Work in a new git worktree on this new branch (`<agent folder>/.worktrees/<taskId>`) when `cwd` is a git
   * repository. When it isn't, a `claude`/`codex` task runs without a branch in its own subfolder
   * `<cwd>/work/<last part of the branch>/` (`shell` tasks are refused).
   */
  branch?: string;
  /** Killed (the whole process group) after this long; default and cap are the runner's. */
  maxSeconds?: number;
  /**
   * Protocol 5: the task works for a mission (an item session: it works on
   * the mission's branches; merges, pushes to other branches and deploys are
   * denied). The runner gives the executor the local `agentes` MCP server
   * (bound to this task) and the mission's rules.
   */
  mission?: {
    id: string;
    rules?: string;
    /** Protocol 7: the mission's branches start with this (`agentes/<id>/`); only these may be pushed. */
    branchPrefix?: string;
    /**
     * Commands a person allowed for the whole mission ("Aprovar sempre nesta
     * missão"), as Claude Code permission rules (`Bash(swift *)`); added to
     * a work turn's allow list (the deny list still wins).
     */
    allow?: string[];
    /**
     * Protocol 8: the server's token for this task's tools (ADR 0032). The
     * runner sends it with each `mcp.call` and `mcp.list`; the server checks
     * it is this machine's, for this task, and still live.
     */
    mcpToken?: string;
    /** Protocol 14: `plan` for a read item (ADR 0044): no edits (Claude Code's plan rules, Codex's read-only sandbox). Default `work`. */
    mode?: "plan" | "work";
  };
  /**
   * Protocol 14 (ADR 0044), for a task in a git folder: record `HEAD` when it
   * starts and, when it ends (any way: done, failed, canceled), `git add -A`
   * and commit what changed with this message (nothing when the tree is
   * clean; the runner adds " (stopped)" when the task didn't exit 0: failed,
   * canceled, timed out, interrupted). `TaskDone` then carries `startSha` and
   * `endSha`; a commit a hook refused leaves the changes and says why at the
   * end of `result`.
   */
  commit?: { message: string };
  /** Protocol 14: answer how many commits `branch` has beyond `sha` (`task.start` `baseBehind`). */
  baseCheck?: { branch: string; sha: string };
  /**
   * A person approved starting this very task (an approval card): a `shell` task's command runs even when the
   * command policy would hold it (`approval_needed`).
   */
  approved?: boolean;
  /**
   * Protocol 31 (`TASK_ACCOUNTS_PROTOCOL`), `claude` / `codex`: the agent's account its CLI signs in with
   * (`accounts/<kind>/<id>`), as `BrainTurnRequest.account`; absent: the computer's own sign-in.
   */
  account?: string;
  /**
   * `claude` on a coding plan's key: the model the agent thinks with there, as `BrainTurnRequest.model` (a runner
   * that doesn't read it runs the plan's `sonnet`).
   */
  model?: string;
}

/** A coding CLI on the machine, as `hello` reports it (protocol 7). */
export interface RunnerExecutorInfo {
  /** The first line of `<cli> --version`. */
  version: string;
  /** Protocol 8, `claude` only: `claude auth status` says it is logged in (absent: unknown). */
  loggedIn?: boolean;
  /** Protocol 8, `claude` only: how it is logged in (`claude.ai`, `api_key`…) and the plan (`pro`, `max`, `ultra`…). */
  authMethod?: string;
  plan?: string;
  /**
   * Protocol 36, `cursor`: the models its sign-in lists (`agent models`), and which its plan includes when the CLI
   * says. Protocol 39, `opencode`: the models `opencode models` lists (`provider/model`), `free` on OpenCode's free tier.
   * Protocol 43, `grok`: the models `grok models` lists. Protocol 44, `antigravity`: the models `agy models` lists.
   */
  models?: CursorModelInfo[];
}

/** A model Cursor's CLI (`agent models`) or OpenCode's (`opencode models`) lists. */
export interface CursorModelInfo {
  id: string;
  label?: string;
  /** Cursor: the CLI said the plan includes it (absent: it didn't say; other models are billed at API prices). */
  inPlan?: boolean;
  /** OpenCode (protocol 39): a model of OpenCode's free tier (no key, no cost). */
  free?: boolean;
}

/** Most models kept from `agent models`, and their longest id and label. */
export const CURSOR_MODEL_LIMITS = { models: 60, id: 80, label: 80 } as const;

/**
 * One event of a brain turn on the wire (`brain.event`), the same shape as
 * the engine's `BrainEvent` (packages/engine/src/brains/types.ts; this file
 * imports nothing).
 */
export type WireBrainEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
      executed?: { content: string; isError?: boolean };
    }
  | {
      type: "usage";
      /** Every input token the turn read (cache included); `cacheRead`/`cacheWrite` say how much of it was cache. */
      input: number;
      output: number;
      source: "api" | "plan";
      model?: string;
      cacheRead?: number;
      cacheWrite?: number;
      /** Claude Code: the API calls the turn made (`num_turns`), and the most uncached input one of them read. */
      calls?: number;
      maxUncached?: number;
    }
  | { type: "limit"; resetsAt?: string }
  | { type: "done"; text: string; session?: { id: string } }
  /**
   * `worked`: on a `plan_limit`, whether the turn used any tool before it was cut (an older runner leaves it out:
   * the engine counts that as worked).
   */
  | {
      type: "error";
      code: string;
      message: string;
      retryable?: boolean;
      worked?: boolean;
      /** Protocol 50: why the provider refused or failed it, and its HTTP status when the CLI said one. */
      cause?: ProviderFailureCause;
      httpStatus?: number;
    }
  /** Protocol 15: messages handed with `brain.steer` that the turn read (their `uuid`s). */
  | { type: "steer_read"; uuids: string[] }
  /** Protocol 46: Fast failed (`message`: the provider's words) and this turn answered at standard speed. */
  | { type: "speed_fallback"; message: string }
  /** A call the brain starts on its own (Claude Code's Read, Bash, Task): its `tool_call` follows once it ended. */
  | { type: "tool_started"; id: string; name: string };

/**
 * `brain.steer` (protocol 15): messages for the turn of `runId` in progress.
 * Each has its own `uuid` (a UUID the engine maps to its message); `urgent`
 * ("Parar e mandar") asks the CLI to read it now, moving the running tool to
 * the background. Support is what Claude Code's `system/init` says it can do
 * (`msg_lifecycle_v1` for any message, `interrupt_send_now_v1` for urgent
 * ones); a turn that can't take an urgent one answers `unsupported` (the
 * engine stops and restarts the turn instead).
 */
export interface BrainSteerRequest {
  runId: string;
  /** The turn's session (as in its `brain.turn`): with the request's agent, it names the process. */
  session: string;
  messages: Array<{ uuid: string; text: string; urgent?: boolean }>;
}

/**
 * `accepted`: written to the turn (their `uuid`s; read later, `steer_read`).
 * `unsupported`: this turn can't take messages mid-turn (an older CLI, a
 * one-shot process, Codex run as `codex exec`), or not urgent ones (no `now` on that CLI). `no_turn`: no turn of that
 * run runs now.
 */
export type BrainSteerReply =
  | { status: "accepted"; accepted: string[] }
  | { status: "unsupported" | "no_turn"; reason?: string };

/** Most messages and characters per message in one `brain.steer`. */
export const STEER_LIMITS = { messages: 20, text: 100_000 } as const;

/**
 * `brain.turn` (protocol 8, ADR 0032): one conversational turn of an agent
 * whose brain is Claude Code on this machine. The runner streams
 * `brain.event` frames (by `runId`), then `brain.done`, then the request's
 * `result` with the final event (a `done` or an `error`).
 */
export interface BrainTurnRequest {
  runId: string;
  /**
   * `cursor`: protocol 36 (`CURSOR_PROTOCOL`); `opencode`: protocol 39 (`OPENCODE_PROTOCOL`); `grok`: 43
   * (`GROK_PROTOCOL`); `antigravity`: 44 (`ANTIGRAVITY_PROTOCOL`).
   */
  kind: "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";
  /** The executor's session (a UUID, stable per thread); `resume`: the server knows it ran before (a hint). */
  session: { id: string; resume: boolean };
  /** Relative to the agent's folder ("" = the folder). */
  cwd: string;
  /** `opus`, `sonnet`, a full model id; absent: the CLI's default. */
  model?: string;
  /** The engine-built context, appended to Claude Code's system prompt when a session starts. */
  system: string;
  /** Protocol 40 (`CONVERSATION_PROTOCOL`), Claude Code: what holds for this conversation, read once per session. */
  conversation?: string;
  /** What this turn says (the new user message). */
  prompt: string;
  /**
   * The MCP bridge for this run: `token` identifies the run to the server (per run). `tools`: the names of the run's
   * tools, space-separated; a kept-alive Codex, which lists them once when its thread opens, starts again when one is new.
   */
  mcp: { token: string; url?: string; tools?: string };
  /** Keep one process per (agent, session) alive between turns (default true; false for a background turn). Codex: protocol 16. */
  keepAlive?: boolean;
  /** Also load the machine owner's own MCP servers (default false: `--strict-mcp-config`; never in a `plan` turn). */
  personalMcp?: boolean;
  /**
   * The turn's permission profile (ADR 0053 §3): `work` (default) edits and asks a person (or the server's
   * rules) for the rest; `plan` reads only. Codex honours it from `BRAIN_PROFILES_PROTOCOL` on.
   */
  permissions?: { mode?: "plan" | "work" | "chat"; branchPrefix?: string; allow?: string[] };
  /** Protocol 13: the account folder to run in (`accounts/<kind>/<id>`); absent: the machine's own sign-in. */
  account?: string;
  /** Protocol 13: how hard it thinks; absent: the CLI's default. */
  effort?: BrainEffort;
  /** Protocol 46: `fast` asks for the provider's Fast mode on this turn; absent: standard speed. */
  speed?: BrainSpeed;
  /**
   * `opencode`: no account on a computer nobody connected, so OpenCode's own free tier alone (`opencode/*` models,
   * no key from the runner's env); ADR 0132.
   */
  freeTier?: boolean;
  /** Protocol 28: the most context it reads, in tokens; absent: the model's own window. */
  contextTokens?: number;
  /**
   * A person waits on this turn (first rank of the computer's line): it may take the runner's reserved slot
   * (`PERSON_TURN_MIN_FREE_BYTES`). No protocol step: a runner that doesn't read it admits the turn like any other.
   */
  personWaiting?: boolean;
}

/** Largest strings of a `brain.event` (tool inputs and results are cut, text deltas are small). */
export const BRAIN_LIMITS = {
  delta: 16_000,
  toolText: 4000,
  toolName: 128,
  doneText: 100_000,
  message: 2000,
} as const;

/**
 * From this protocol on (ADR 0074): `brain.route`, a person's own Claude or
 * ChatGPT plan picking who answers their message nobody mentioned. Claude
 * Code or Codex answers once with every tool off, nothing of the folder or
 * its owner loaded and no session kept, in a temporary folder, as the
 * request's agent's user. A sign-in with a key is refused. While that
 * sign-in's folder has a process open (a turn, or the one kept after it) the
 * answer is `busy` at once. The server never sends it to an older runner.
 */
export const ROUTE_PROTOCOL = 24;
/** The runner kills a route's CLI after this long. */
export const ROUTE_TIMEOUT_MS = 30_000;
/** Largest `brain.route` fields (characters; the schema as JSON). */
export const ROUTE_LIMITS = { system: 8000, prompt: 32_000, schema: 8000 } as const;

/** `brain.route` (protocol 24): one answer in `schema`'s shape from the account's CLI. */
export interface BrainRouteRequest {
  kind: AccountKind;
  /** The account folder (`accounts/<kind>/<id>`); absent: the computer's own sign-in. */
  account?: string;
  system: string;
  /** Read by the CLI on its standard input. */
  prompt: string;
  /** JSON Schema of the answer. */
  schema: Record<string, unknown>;
}

/** What a route answers: the CLI's answer as a JSON object, or `busy` while that sign-in has a process open. */
export type BrainRouteReply =
  | {
      json: Record<string, unknown>;
      /** The model that answered, as the CLI reports it. */
      model: string;
      /** Every input token it read (cache included); `cacheRead` and `cacheWrite` say how much was cache. */
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
      durationMs: number;
    }
  | { busy: true };

/** A task as the runner's journal has it (in `hello` and `task.status`). */
export interface RunnerTask {
  taskId: string;
  agentId: string;
  /** `interrupted`: the process is gone without an exit (the machine slept, rebooted or killed it). */
  status: "running" | "done" | "interrupted";
  pid?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  seconds?: number;
  lastLine?: string;
  files?: string[];
}

/** `task.done`: how a task ended. Sent once per task, again after a reconnect until acknowledged. */
export interface TaskDone {
  taskId: string;
  /** Null when there is no exit code (killed by a signal, or interrupted). */
  exitCode: number | null;
  signal?: string | null;
  seconds: number;
  /** The executor's final answer (Claude Code's `result`), or the last lines of output; capped. */
  result?: string;
  lastLine?: string;
  files?: string[];
  /** Ended by `task.cancel`. */
  canceled?: boolean;
  /** Killed after `maxSeconds`. */
  timedOut?: boolean;
  /** The process vanished without an exit (the machine went down): it may be resumed. */
  interrupted?: boolean;
  /** Claude Code's session id, when it reported one. */
  session?: string;
  /**
   * Commands the executor wasn't allowed to run and nobody approved
   * (Claude Code's `permission_denials`, Codex's declined commands): the
   * task's end notice lists them ("Liberar e repetir").
   */
  denials?: TaskDenial[];
  /** Protocol 14, with `TaskStart.commit`: `HEAD` when the task started and after its commit (equal: nothing changed). */
  startSha?: string;
  endSha?: string;
}

/** One command an executor was refused. */
export interface TaskDenial {
  /** Claude Code's tool name (`Bash`, `WebFetch`…); `Bash` for Codex commands. */
  tool: string;
  /** The command line, or what the tool would touch (a URL, a path). */
  command: string;
}

/** Largest pieces of task frames (characters / entries); the runner cuts, the server cuts again. */
export const TASK_LIMITS = {
  /** Refused commands kept per task, and each one's length. */
  denials: 10,
  denial: 300,
  line: 500,
  files: 50,
  filePath: 300,
  result: 8000,
  tasks: 200,
  /** `task.output`: at most this many lines. */
  outputLines: 200,
  prUrl: 500,
} as const;

/** Protocol 33: the public address observed from an agent process, absent until measured. */
export interface MachineEgress {
  ip: string | null;
  country?: string;
}
export interface MachineNetworkTransition {
  state: "draining" | "restart_required";
  deadline: string;
  agents: string[];
}
export const EGRESS_PROTOCOL = 33;

/** An agent that uses this machine, as the `agents` frame lists it (protocol 9). */
export interface MachineAgent {
  id: string;
  handle: string;
  name: string;
  look?: { color?: string; eyes?: string; accessory?: string };
  /** Protocol 33: language of the responsible person; absent falls back to English. */
  locale?: string;
  /** Protocol 20: the account on this machine it thinks with (system mode lends its folder to the agent's user). */
  account?: string;
  /** The other accounts here it thinks with: the team's right hand on people's own plans (ADR 0137 §11). */
  accounts?: string[];
  /**
   * Its containers service may run here (ADR 0169). Absent for a brain whose shell runs in a sandbox of the CLI's own,
   * which that service, outside it, would be a way out of, and for the team's right hand, which thinks on several.
   */
  containers?: boolean;
}

/** The pause state (protocol 9). `until` null: paused until the owner resumes. */
export interface RunnerPause {
  paused: boolean;
  /** ISO time; absent or null with `paused: true` means "until resumed". */
  until?: string | null;
}

/** The tools a person turns on or off on the machine (protocol 10). */
export interface RunnerTools {
  claude: boolean;
  codex: boolean;
  /** Protocol 36: Cursor's CLI (ADR 0114). Absent = off (older runners). */
  cursor?: boolean;
  /** Protocol 39: OpenCode's CLI (ADR 0132). Absent = off (older runners). */
  opencode?: boolean;
  /** Protocol 43: Grok Build (ADR 0142). Absent = off (older runners). */
  grok?: boolean;
  /** Protocol 44: Google's Antigravity CLI (ADR 0143). Absent = off (older runners). */
  antigravity?: boolean;
  /** Shell commands (`exec`, `shell` tasks). The same as `exec` in `hello` once protocol 10 is in use. */
  commands: boolean;
  /** Protocol 12: the agent browser (ADR 0040). Absent = off (older runners). */
  browser?: boolean;
  /** Protocol 18: the agents' desktops: they use them, people watch and take control (ADR 0058). Absent = off. */
  desktop?: boolean;
  /** Protocol 18: terminals people open as an agent (ADR 0058). Absent = off. */
  terminal?: boolean;
}

/** A folder allowed on the machine beyond the agents' own folders, and which agents use it (protocol 10). */
export interface RunnerFolderGrant {
  /** Absolute, normalized path on the machine. */
  path: string;
  /** Agent ids that may use it; empty = allowed on the machine but no agent uses it yet; `ALL_AGENTS`: every agent. */
  agents: string[];
}

/** The agents of the folder grant every agent on the computer has: its shared folder (ADR 0115). */
export const ALL_AGENTS = "*";

/** Whether a folder grant is for `agentId` (by its id, or for every agent). */
export const grantedTo = (grant: Pick<RunnerFolderGrant, "agents">, agentId: string) =>
  grant.agents.includes(agentId) || grant.agents.includes(ALL_AGENTS);

/** The computer's shared folder (ADR 0115): the folder granted to every agent; null from an older runner. */
export const sharedFolderOf = (access: Pick<RunnerAccess, "folders"> | null | undefined) =>
  access?.folders.find((f) => f.agents.includes(ALL_AGENTS))?.path ?? null;

/** What the machine allows (protocol 10). */
export interface RunnerAccess {
  folders: RunnerFolderGrant[];
  tools: RunnerTools;
}

/** Largest pieces of access frames. */
export const ACCESS_LIMITS = {
  folders: 100,
  path: 1024,
  agentsPerFolder: 100,
  reason: 500,
  /** An `access.request` the person hasn't answered expires after this long. */
  requestTtlMs: 24 * 60 * 60 * 1000,
} as const;

export interface RunnerInfo {
  /** Protocol 4: the tasks in the runner's journal (running, and finished ones not yet acknowledged). */
  tasks?: RunnerTask[];
  /** The runner's own version (`0.1.0`). */
  version: string;
  protocol: number;
  os: MachineOs;
  arch: string;
  hostname: string;
  /** Absolute path of the workspace on the machine (shown to admins only). */
  workspace: string;
  /** `false` when started with `--no-exec`: files and uploads only. */
  exec: boolean;
  /** Protocol 7: the coding CLIs found on the machine's PATH (best effort, cached by the runner). */
  executors?: {
    claude?: RunnerExecutorInfo;
    codex?: RunnerExecutorInfo;
    cursor?: RunnerExecutorInfo;
    opencode?: RunnerExecutorInfo;
    grok?: RunnerExecutorInfo;
    antigravity?: RunnerExecutorInfo;
  };
  /** Protocol 9: whether the owner paused this computer. */
  paused?: RunnerPause;
  /** Protocol 10: folders and tools allowed on the machine. */
  access?: RunnerAccess;
  /** Protocol 12: whether the agent browser can run here. */
  browser?: RunnerBrowserInfo;
  /** Protocol 13: the accounts on the machine (ADR 0041). */
  accounts?: RunnerAccountInfo[];
  /** Protocol 18: whether the agents' desktops can run here (ADR 0058). */
  desktop?: RunnerDesktopInfo;
  /** Protocol 18: whether people can open a terminal here. */
  terminal?: RunnerTerminalInfo;
  /** Protocol 21: whether agents can use their own desktops here (ADR 0062). */
  desktopUse?: RunnerDesktopUseInfo;
  /**
   * Protocol 18: `system` when each agent works as its own OS user (ADR 0058 §10); absent, every agent
   * works as the runner's own user. Who may control a desktop or open a terminal follows it (§4).
   */
  mode?: "system";
  /** Protocol 19: the usage of the computer's own sign-ins (no account folder). */
  ownUsage?: OwnPlanUsage;
  /** Protocol 22: how big the computer is. */
  size?: MachineSize;
  /** `PHONES_PROTOCOL`: the phones it reaches, and what it can build with. */
  phones?: RunnerPhone[];
  toolchains?: RunnerToolchains;
  /** Protocol 50: the methods a new Claude sign-in for all agents can use here (`claudeLoginMethodsOf`). */
  claudeLoginMethods?: AuthMethod[];
  /** Why this computer doesn't list `cli_login` for all agents though it was switched on (its self-check's answer). */
  claudeLoginBlocked?: string;
  /**
   * Protocol 50 (system mode): root's Claude sign-in, status, sign-out and usage CLIs run in the `agentes-auth`
   * group, which the computer's egress rules may route apart from the rest of root.
   */
  authEgressGroup?: true;
}

export interface FileEntry {
  /** Relative to the workspace. */
  path: string;
  isDir: boolean;
  size: number;
}

/**
 * The agent a request is for (protocol 2+). The runner gives each agent its
 * own folder inside the workspace, `<handle>-<first 8 of id>`, and treats it
 * as that request's workspace; a renamed agent keeps its folder (found by id).
 */
export interface AgentScope {
  id: string;
  handle: string;
  /** Protocol 9: the agent's display name, for the machine's activity log. */
  name?: string;
}

/** What the server asks. Paths are always relative to the workspace (the agent's folder when `agent` is set). */
export type MachineRequest = (
  | {
      op: "exec";
      command: string;
      /** Relative to the workspace (default: the workspace). */
      cwd?: string;
      timeoutSeconds: number;
      /** Send `output` frames while it runs. */
      stream: boolean;
      /** A person approved this very command (an approval card): it runs even when the command policy would hold it. */
      approved?: boolean;
      /** The repositories the agent merges in without asking: a command that is only such a merge runs (`loneMerge`). */
      mergeRepos?: string[];
      /** Protocol 45: Vault keys for this command only (ADR 0144). */
      vault?: ExecVault;
    }
  | { op: "read"; path: string; maxBytes: number }
  | { op: "write"; path: string; base64: string }
  | { op: "list"; path: string; depth: number }
  | ({ op: "secret" } & SecretRequest)
  /** Protocol 13: sign-ins and accounts of the computer brains (ADR 0041). Not per agent. */
  | ({ op: "account" } & AccountRequest)
  | ({ op: "task.start" } & TaskStart)
  /** One task, or all of this agent's when `taskId` is omitted. */
  | { op: "task.status"; taskId?: string }
  | { op: "task.cancel"; taskId: string }
  /** Protocol 6: the last `tail` human lines of a task's output (redacted), as the watcher derives them. */
  | { op: "task.output"; taskId: string; tail: number }
  /** Protocol 8: one brain turn (ADR 0032); streams `brain.event` frames while it runs. */
  | ({ op: "brain.turn" } & BrainTurnRequest)
  /** Protocol 15: messages for a brain turn in progress (live steering). */
  | ({ op: "brain.steer" } & BrainSteerRequest)
  /** Protocol 24: a plan picks who answers a message (ADR 0074); the request's agent is the one it is lent to. */
  | ({ op: "brain.route" } & BrainRouteRequest)
  /** Protocol 11: clone or update the agent's checkouts through our git proxy. */
  | ({ op: "git.sync" } & GitSyncRequest)
  /** Protocol 14: the mission's worktree (ADR 0044). */
  | ({ op: "mission.worktree" } & MissionWorktreeRequest)
  /**
   * Protocol 10: the request's agent asks for a folder outside its own. The
   * runner shows it to the person and answers right away (`pending`, or
   * `granted` when that folder is already allowed for this agent); the
   * decision comes later as `access.decided`.
   */
  | { op: "access.request"; requestId: string; path: string; reason: string }
  /** Protocol 10: the site removed a folder (for everyone, or for one agent) or turned a tool off. Never widens. */
  | {
      op: "access.reduce";
      removeFolder?: { path: string; agentId?: string };
      disableTool?: keyof RunnerTools;
    }
  | {
      op: "push";
      path: string;
      /** Absolute URL of our upload endpoint (`PUT`, machine token as bearer). */
      url: string;
      uploadId: string;
      maxBytes: number;
    }
  /** Protocol 47 (`FILE_PULL_PROTOCOL`): `write`'s path rules, the bytes fetched from `url` instead of sent here. */
  | {
      op: "pull";
      path: string;
      /** Absolute URL of our file endpoint (`GET`, machine token as bearer), good for one fetch. */
      url: string;
      pullId: string;
      size: number;
      /** Hex; absent for a stored file with no recorded hash (a skill's), which is then checked by size alone. */
      sha256?: string;
    }
  /**
   * Protocol 12: one `agent-browser` command in the request's agent's session
   * (`open`, `snapshot`, `click`…; `args` as on its command line, without
   * `--session`, `--profile` or `--json`, which the runner sets). Commands run
   * one at a time per session. `allowedDomains`: the agent's site allowlist.
   */
  | {
      op: "browser.act";
      command: string;
      args: string[];
      timeoutSeconds: number;
      allowedDomains?: string[];
      /** The conversation the command is for (`/org/…/c/…`): the desktop app's "Ver" opens it. */
      link?: string;
      /**
       * Protocol 18: the agent's Chrome belongs on its desktop (ADR 0058 §7). The runner
       * starts it there (the desktop first), or moves it there or back at a command that
       * may start Chrome, never while someone watches it or a person's turn is open.
       */
      desktop?: boolean;
    }
  /** Protocol 12: close the agent's browser session (Stop, idle). */
  | { op: "browser.stop" }
  /** Protocol 12: start (or change the mode of) the agent's stream: `browser.frame` frames until `browser.stream.stop`. */
  | { op: "browser.stream.start"; mode: BrowserStreamMode }
  /**
   * Protocol 49: the live view's own socket for the agent's (or the profile's) browser: the runner dials the data
   * socket `streamId` names and answers once the server took it (`BROWSER_VIEW_PROTOCOL`).
   */
  | { op: "browser.view.open"; streamId: string }
  | { op: "browser.stream.stop" }
  /** Protocol 12: a person's input during a take over, in order. */
  | { op: "browser.input"; events: BrowserInputEvent[] }
  /**
   * Protocol 17: several `browser.act` commands in one round trip, run back to
   * back in the agent's session (nothing else in between), each with the
   * same checks. Stops at the first failure of a command without `tolerate`.
   */
  | {
      op: "browser.batch";
      commands: BrowserBatchCommand[];
      allowedDomains?: string[];
      link?: string;
      /** Protocol 18: as on `browser.act`. */
      desktop?: boolean;
    }
  /** Protocol 17: a JPEG of the page with its elements numbered and boxed (for a judge that sees images). */
  | { op: "browser.capture"; allowedDomains?: string[] }
  /** Protocol 27: start the agent's Chrome before its first command (`desktop`: as on `browser.act`). */
  | { op: "browser.warm"; desktop?: boolean }
  /** Protocol 34: stops a browser profile's Chrome and removes its folder (the profile was deleted). */
  | { op: "browser.profile.delete" }
  /** Protocol 18: starts the agent's desktop; when it runs already, only marks it used (idempotent). */
  | { op: "desktop.session.start" }
  /** Protocol 18: ends the agent's desktop, and its browser on it. */
  | { op: "desktop.session.stop" }
  | { op: "desktop.session.status" }
  /** Protocol 18: answered once the data socket for `streamId` got `stream.ready`. */
  | ({ op: "stream.open" } & StreamOpenRequest)
  /** Protocol 21: what the agent's desktop shows now (it starts when it isn't running). */
  | { op: "desktop.look" }
  /** Protocol 21: one action on the agent's desktop; with `settle`, the screen settles and the answer has a look. */
  | { op: "desktop.act"; action: DesktopAction; settle: boolean }
  /** Protocol 21: a JPEG of the screen, or of a region of it at its own size. */
  | { op: "desktop.capture"; region?: DesktopRegion }
  /** Protocol 21: the apps the agent can start. */
  | { op: "desktop.apps" }
  /** Protocol 25: the text on the agent's screen, read on the computer. */
  | { op: "desktop.text" }
  /** Protocol 45: a one-use key the request's agent's Vault values are sealed to (ADR 0144). */
  | { op: "vault.key" }
  /** `requestId` and `publicKey`: what the answer is sealed to (`madePasswordAad`). */
  | { op: "vault.password"; requestId: string; publicKey: string; rules: PasswordRules }
  /** `PHONES_PROTOCOL`: take the phone (or renew the lock) for `holder`, doing nothing else. */
  | ({ op: "phone.claim" } & PhoneTarget)
  /** Let the phone go: `holder.runId`'s lock only, or anyone's with `force` (its owner pressed Stop). */
  | ({ op: "phone.release" } & PhoneTarget & { force?: boolean })
  /** Install an app from `path` (an `.apk`, `.aab`, `.app` or `.ipa` in the agent's folder) and say its id. */
  | ({ op: "phone.install" } & PhoneTarget & { path: string })
  /** Start an installed app by its id (Android package, iOS bundle id). */
  | ({ op: "phone.launch" } & PhoneTarget & { app: string })
  /**
   * Run a Maestro flow (YAML text) on the phone, recording the screen around it with `record`. The video and the
   * log land in the agent's folder (`.agentes/phone/`).
   */
  | ({ op: "phone.flow" } & PhoneTarget & {
        flow: string;
        record?: boolean;
        timeoutSeconds: number;
        env?: Record<string, string>;
      })
  /** Record the screen for `seconds` (at most 170) into the agent's folder. */
  | ({ op: "phone.record" } & PhoneTarget & { seconds: number })
  /** A PNG of the screen into the agent's folder. */
  | ({ op: "phone.screenshot" } & PhoneTarget)
  /** The phone's log: the last `lines`, only `app`'s when given. */
  | ({ op: "phone.logs" } & PhoneTarget & { app?: string; lines: number })
  /**
   * `PHONES_PROTOCOL`: pair an Android phone over Wi-Fi. `start` answers the QR the phone scans (Wireless debugging ›
   * Pair device with QR code); `code` pairs with the six digits and the address the phone shows instead. Either goes
   * on by itself until connected, failed or 2 minutes; `status` says where it is. One at a time: a new one ends the last.
   */
  | { op: "phone.pair.start" }
  | { op: "phone.pair.code"; address: string; code: string }
  | { op: "phone.pair.status"; pairingId: string }
  | { op: "phone.pair.cancel"; pairingId: string }
  /**
   * A phone guide is open and waits for a phone: for the next minute, a Windows runner also looks for a plugged phone
   * Windows has no USB driver for (adb never lists one) and reports it as `no_driver`. Older runners answer
   * `bad_request`, which the server ignores.
   */
  | { op: "phone.look" }
) & {
  agent?: AgentScope;
  /** Protocol 34: a `browser.*` op in this browser profile's session instead of the agent's (ADR 0110). */
  profile?: { id: string };
};

/** One command of a `browser.batch` (protocol 17). */
export interface BrowserBatchCommand {
  command: string;
  args: string[];
  timeoutSeconds: number;
  /** Its failure doesn't stop the batch (a wait that may time out, a settle check). */
  tolerate?: boolean;
}

export type MachineOp = MachineRequest["op"];

export const MACHINE_OPS: readonly MachineOp[] = [
  "exec",
  "read",
  "write",
  "list",
  "push",
  "pull",
  "secret",
  "account",
  "task.start",
  "task.status",
  "task.cancel",
  "task.output",
  "brain.turn",
  "brain.steer",
  "brain.route",
  "git.sync",
  "mission.worktree",
  "access.request",
  "access.reduce",
  "browser.act",
  "browser.stop",
  "browser.stream.start",
  "browser.stream.stop",
  "browser.input",
  "browser.batch",
  "browser.capture",
  "browser.warm",
  "browser.profile.delete",
  "desktop.session.start",
  "desktop.session.stop",
  "desktop.session.status",
  "stream.open",
  "browser.view.open",
  "desktop.look",
  "desktop.act",
  "desktop.capture",
  "desktop.apps",
  "desktop.text",
  "vault.key",
  "vault.password",
  "phone.claim",
  "phone.release",
  "phone.install",
  "phone.launch",
  "phone.flow",
  "phone.record",
  "phone.screenshot",
  "phone.logs",
  "phone.pair.start",
  "phone.pair.code",
  "phone.pair.status",
  "phone.pair.cancel",
  "phone.look",
];

/** What each op answers with `ok: true`. */
export interface MachineReplies {
  exec: {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    canceled?: { killed: boolean };
    /** It ran as a merge the agent does without asking (`mergeRepos`). */
    merge?: MergeDone;
  };
  /** `base64: null`: no such file. */
  read: { base64: string | null; size: number };
  write: { size: number };
  list: { entries: FileEntry[] };
  /** What was sent: the uploaded name (`report.pdf`, or `folder.zip`), bytes and SHA-256 (hex). */
  push: { name: string; size: number; sha256: string; contentType: string };
  /** What landed at the path: its bytes and SHA-256 (hex). */
  pull: { size: number; sha256: string };
  /**
   * `keypair`: public key, and `sites` from a runner that keeps a `site` target out of its commands; `deliver`/
   * `activate`: size; an older activation may be superseded.
   */
  secret: { publicKey?: string; sites?: boolean; size?: number; superseded?: boolean };
  /**
   * `begin`: what the person needs (`url`; Claude Code: `publicKey`; Codex: `userCode`);
   * `status`: `state` and, when done, `account`; `list`: `accounts`; `code`, `cancel`, `remove`: `{}`.
   */
  account: {
    url?: string;
    userCode?: string;
    publicKey?: string;
    state?: AccountLoginState;
    account?: RunnerAccountInfo;
    accounts?: RunnerAccountInfo[];
    /** `failed`: why, for people. */
    error?: string;
    /** `failed` or `expired`: why, as a code (`ACCOUNT_LOGIN_FAILURES`). */
    code?: AccountLoginFailure;
    /** With `code`: what the CLI itself said, without tokens or the pasted code, cut at a word. */
    message?: string;
  };
  /** `cwd`: where it runs, relative to the agent's folder (`.worktrees/<taskId>` with a branch). */
  "task.start": {
    taskId: string;
    pid: number;
    startedAt: string;
    cwd: string;
    branch?: string;
    command: string;
    /** Protocol 14, with `baseCheck`: commits the base branch has beyond the mission's base (absent: unknown). */
    baseBehind?: number;
  };
  "task.status": { tasks: RunnerTask[] };
  /** `false`: it had already ended. */
  "task.cancel": { canceled: boolean };
  /** Oldest first; `truncated`: the log had more than was read. */
  "task.output": { lines: string[]; truncated: boolean };
  /** `final`: the turn's last event (`done` or `error`), also streamed. */
  "brain.turn": { runId: string; final: WireBrainEvent };
  "brain.steer": BrainSteerReply;
  "brain.route": BrainRouteReply;
  "git.sync": { repos: GitSyncRepo[] };
  /** `remove` answers `{ removed }` (`false`: the folder was already gone). */
  "mission.worktree": Partial<MissionWorktreeEnsured> & { removed?: boolean };
  "access.request": { requestId: string; status: "pending" | "granted" };
  "access.reduce": { access: RunnerAccess };
  /**
   * `agent-browser`'s own JSON answer: `success: false` with its `error` is a page-level failure (stale ref, covered
   * click). Protocol 45: `code` names a Vault refusal (`VAULT_TYPE_REFUSALS`).
   */
  "browser.act": {
    success: boolean;
    data: unknown;
    error?: string;
    code?: string;
    setup?: BrowserSetup;
    /** Protocol 52: the page size its browser emulates (`agentes:viewport`) after the command; absent at its own. */
    emulated?: NonNullable<BrowserViewport>;
  };
  /** `false`: there was no session. */
  "browser.stop": { stopped: boolean };
  "browser.stream.start": { mode: BrowserStreamMode };
  "browser.stream.stop": { stopped: boolean };
  /** Events sent to the page. */
  /**
   * `failed`: events the browser didn't confirm (absent when all went through). `nowhere`: text went to a page with
   * nothing focused that takes it.
   */
  "browser.input": { accepted: number; failed?: number; nowhere?: boolean };
  /** One answer per command run, in order: fewer than asked when one failed without `tolerate`. */
  "browser.batch": {
    answers: { success: boolean; data: unknown; error?: string; code?: string }[];
    setup?: BrowserSetup;
    /** As `browser.act`'s, after the batch. */
    emulated?: NonNullable<BrowserViewport>;
  };
  /** `false`: nothing was started (it runs or starts already, a person has the browser, or no room). */
  "browser.warm": { started: boolean; setup?: BrowserSetup };
  "browser.profile.delete": { deleted: boolean };
  /**
   * The page as a JPEG (base64), its size in pixels, the page's size in CSS
   * pixels, and its numbered elements with their boxes (CSS pixels).
   */
  "browser.capture": {
    data: string;
    width: number;
    height: number;
    viewport: { width: number; height: number };
    marks: BrowserCaptureMark[];
    url?: string;
  };
  /** `started`: it wasn't running (a fresh desktop: whatever the agent saw on it before is gone). */
  "desktop.session.start": { display: number; width: number; height: number; startedAt: string; started: boolean };
  /** `false`: it wasn't running. */
  "desktop.session.stop": { stopped: boolean };
  /** `streams`: the agent's open desktop and terminal streams. */
  "desktop.session.status": { running: boolean; startedAt?: string; lastUsedAt?: string; streams: number };
  "stream.open": { opened: true };
  "browser.view.open": { opened: true };
  "desktop.look": DesktopLookReply;
  /** `look` with `settle`; `settled: false`: the screen kept changing until the wait's cap. */
  "desktop.act": { look?: DesktopLookReply; settled?: boolean };
  /**
   * A JPEG (base64) of the screen, or of `region` at its own size; the last look's elements and their boxes,
   * in screen pixels.
   */
  "desktop.capture": {
    data: string;
    width: number;
    height: number;
    screen: { width: number; height: number };
    region: DesktopRegion | null;
    marks: BrowserCaptureMark[];
  };
  /** The apps a person could start from the menu: what `launch` takes, and their names. */
  "desktop.apps": { apps: { id: string; name: string; generic?: string }[] };
  /** The screen's text (trimmed, `DESKTOP_TEXT_MAX` at most), or `same`: the capture didn't change since the last read. */
  "desktop.text": { text: string } | { same: true };
  /** Protocol 45: the key's id, its public key (raw P-256, base64) and when it stops opening anything (ISO). */
  "vault.key": { vaultKey: { keyId: string; publicKey: string; expiresAt: string } };
  "vault.password": { box: WireSecretBox };
  "phone.claim": { holder: PhoneHolder };
  "phone.release": { released: boolean };
  /** `app`: the installed app's id, when the runner could read it. */
  "phone.install": { app?: string; output: string };
  "phone.launch": { output: string };
  /** Paths are relative to the agent's folder. `video`: with `record`, when the recording held. */
  "phone.flow": { passed: boolean; output: string; seconds: number; video?: string; log?: string };
  "phone.record": { path: string; seconds: number; bytes: number };
  "phone.screenshot": { path: string; width?: number; height?: number };
  "phone.logs": { text: string };
  "phone.pair.start": PhonePairing;
  "phone.pair.code": PhonePairing;
  "phone.pair.status": PhonePairing;
  "phone.pair.cancel": { canceled: boolean };
  "phone.look": { looking: boolean };
}

/** An element numbered on a `browser.capture` image: its ref and box (CSS pixels). */
export interface BrowserCaptureMark {
  ref: string;
  number: number;
  role: string;
  name?: string;
  box: { x: number; y: number; width: number; height: number };
}

/** Error codes the runner reports; the message is for people. */
export type MachineErrorCode =
  | "not_found"
  | "outside_workspace"
  | "exec_disabled"
  | "too_large"
  | "upload_failed"
  /** Protocol 47: a `pull` didn't land; its message says why, for people. */
  | "pull_failed"
  /**
   * `task.start` beyond the runner's concurrent tasks (`maxConcurrentTasks`); `brain.turn` while the computer
   * has no room for one more turn (ADR 0025 §5, admission). Try again later.
   */
  | "no_slot"
  /** Protocol 9: the owner paused this computer; nothing new starts until it resumes. */
  | "paused"
  /**
   * Protocol 10: the path is outside every folder this agent may use, or the tool is off on the machine. Also
   * `exec` and a `shell` task's `task.start` that the command policy never runs here, approved or not (a push our
   * git proxy refuses): the message says where to go instead (`policyRefusal`).
   */
  | "not_allowed"
  /** Protocol 12: the agent browser can't run here (no binary, no Chrome, too many sessions); the message says why. */
  | "browser_unavailable"
  /** Protocol 14: `mission.worktree` `ensure` with `baseSha` found neither the folder nor the branch. */
  | "branch_missing"
  /**
   * Protocol 14: `mission.worktree` on a folder that is in no git repository at
   * all (the mission works in it with no branch). A folder inside a repository
   * whose top level is outside the agent's folder is `outside_workspace`.
   */
  | "not_git"
  /**
   * The agent's browser isn't open (never opened, idle shutdown, Stop): a
   * stream can't start until a command opens it. Older runners say
   * `bad_request` instead.
   */
  | "browser_closed"
  /**
   * Protocol 18: desktops can't run on this computer at all; the message says what is missing. Protocol 21:
   * desktop use can't run here either, or the agent's desktop went away mid-use (it starts again on the next one).
   */
  | "desktop_unavailable"
  /** Protocol 18: the agent's desktop isn't running (a viewer never starts it). */
  | "desktop_off"
  /** Protocol 18: the computer already runs as many desktops as its memory allows. */
  | "desktop_busy"
  | "terminal_unavailable"
  /** Protocol 18: the agent's (or the computer's) streams of that kind are at their cap. */
  | "too_many_streams"
  /**
   * The agent's process on the computer went away while the request ran (its worker stopped, the runner is
   * stopping): it may have stopped partway. Older servers read it like `internal`.
   */
  | "dropped"
  /**
   * `exec` and a `shell` task's `task.start`: the command policy holds the command for a person's approval (a
   * push to the default branch, a deploy); the message says why and what the agent can do. Nothing ran.
   */
  | "approval_needed"
  /**
   * Protocol 50: this runner can't do it the way it was asked (a Claude sign-in `method` it can't use here); the
   * message says why. Older servers read it like `internal`.
   */
  | "unsupported"
  /** `PHONES_PROTOCOL`: the host doesn't see this phone now (unplugged, adb restarted). */
  | "phone_missing"
  /** Another holder has the phone; the message names it. */
  | "phone_busy"
  /** The phone needs its person first (locked, not trusted, Developer Mode off); the message says what to do. */
  | "phone_not_ready"
  /** A tool the op needs isn't on the computer and couldn't be fetched (adb, Maestro, scrcpy, Xcode); the message says which. */
  | "tool_missing"
  | "bad_request"
  | "internal";

/** Server → runner. */
export type ServerFrame =
  | {
      type: "welcome";
      machineId: string;
      name: string;
      heartbeatMs: number;
      /** Only the workspace’s managed computer observes its agents’ public route. */
      observeEgress?: boolean;
      /**
       * The server runs each `mcp.call` once per `callId` and answers a copy with the first answer: a call cut by
       * a reconnect may be sent again. Absent (older servers): sent again it would run twice.
       */
      mcpOnce?: boolean;
    }
  | ({ type: "request"; id: string } & MachineRequest)
  | { type: "cancel"; id: string }
  | { type: "ping"; at: number }
  /** The server stored this task's `task.done`: the runner stops re-sending it. */
  | { type: "task.ack"; taskId: string }
  /** Protocol 5: the answer to an `mcp.call` (the text the executor's tool call returns). */
  | { type: "mcp.result"; callId: string; ok: true; text: string }
  | { type: "mcp.result"; callId: string; ok: false; error: { code: string; message: string } }
  /** Protocol 8: the answer to an `mcp.list`: the tools this run may use (JSON Schemas simplified for the CLIs). */
  | { type: "mcp.tools"; callId: string; ok: true; tools: McpToolInfo[] }
  | { type: "mcp.tools"; callId: string; ok: false; error: { code: string; message: string } }
  /**
   * Protocol 9: the agents of the organization that use this machine (pointed
   * at it), sent after `welcome` and again whenever the list or a name/look
   * changes. The runner shows them in the desktop app.
   */
  | { type: "agents"; agents: MachineAgent[]; deleted?: string[] }
  /**
   * Protocol 12: a request for help or a person in control in an agent's
   * browser started, changed or ended (`handoff: null`); sent again on
   * reconnect for the ones still open. The desktop app shows it. Older
   * runners ignore it.
   */
  | { type: "browser.handoff"; agentId: string; handoff: BrowserHandoffInfo | null }
  /** The server closes after sending this (bad token, revoked, outdated runner). */
  | { type: "refused"; reason: "invalid_token" | "revoked" | "outdated" | "replaced"; message: string };

/** Runner → server. */
export type RunnerFrame =
  | ({ type: "hello"; token: string } & RunnerInfo)
  | { type: "output"; id: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "result"; id: string; ok: true; data: unknown }
  | { type: "result"; id: string; ok: false; error: { code: MachineErrorCode; message: string } }
  /**
   * Protocol 22: `load` after each new sample (absent until the first, and while it hasn't changed);
   * protocol 23: `browserTraffic` the same way.
   */
  | {
      type: "pong";
      at: number;
      load?: MachineLoad;
      browserTraffic?: BrowserTraffic;
      egress?: MachineEgress;
      networkTransition?: MachineNetworkTransition | null;
    }
  /** A task's progress: a human last line, files it touched, or elapsed time (throttled). */
  | {
      type: "task.event";
      taskId: string;
      kind: "line" | "files" | "progress";
      line?: string;
      files?: string[];
      seconds?: number;
      /** Protocol 6: a pull request URL seen in the task's output (`gh pr create`, a tool result). */
      prUrl?: string;
    }
  | ({ type: "task.done" } & TaskDone)
  /**
   * Protocol 5: the executor of a mission task called a tool of the local
   * `agentes` MCP server. The server checks the task belongs to this machine
   * and to a mission, runs the tool and answers `mcp.result`.
   */
  | {
      type: "mcp.call";
      callId: string;
      taskId: string;
      tool: string;
      args: Record<string, unknown>;
      /** Protocol 8: the server-issued token of the task or run (ADR 0032); without it, the legacy mission path. */
      token?: string;
    }
  /** Protocol 8: the bridge asks which tools this run may use (`tools/list`); answered with `mcp.tools`. */
  | { type: "mcp.list"; callId: string; taskId: string; token: string }
  /** Protocol 8: one event of a running `brain.turn`. */
  | { type: "brain.event"; runId: string; event: WireBrainEvent }
  /** Protocol 8: a `brain.turn` sent its last event. */
  | { type: "brain.done"; runId: string }
  /** Protocol 9: the pause state changed on the machine (paused, resumed, new `until`). */
  | { type: "runner.state"; paused: RunnerPause }
  /** Protocol 10: what the machine allows changed (the person granted, removed, or turned a tool on or off). */
  | { type: "access.changed"; access: RunnerAccess }
  /**
   * Protocol 13: the accounts on the machine changed (signed in or removed from the desktop app, a sign-in
   * done, a status changed). Protocol 19: or their usage did (`ownUsage`: the computer's own sign-ins').
   */
  | { type: "accounts.changed"; accounts: RunnerAccountInfo[]; ownUsage?: OwnPlanUsage }
  /** Protocol 41: the coding CLIs found changed since `hello` (`hello.executors`, whole). */
  | { type: "executors.changed"; executors: NonNullable<RunnerInfo["executors"]> }
  /** What `hello.toolchains` said changed (an Apple team found, Xcode updated), whole. An older server drops it. */
  | { type: "toolchains.changed"; toolchains: RunnerToolchains }
  /** `PHONES_PROTOCOL`: the phones it reaches changed (one came or went, a state or a holder changed), whole. */
  | { type: "phones.changed"; phones: RunnerPhone[] }
  /**
   * Protocol 10: the person answered an `access.request` on the machine (or it
   * expired). `granted` also comes with an `access.changed`.
   */
  | {
      type: "access.decided";
      requestId: string;
      decision: "granted" | "denied" | "expired";
      /** Granted for this agent only, or for every agent of the organization on this machine. */
      scope?: "agent" | "all";
    }
  /** Protocol 12: one image of an agent's browser while its stream is on (newest wins; the server never stores it). */
  | { type: "browser.frame"; agentId: string; seq: number; data: string; metadata: BrowserFrameMetadata }
  /** Protocol 12: an agent's stream stopped on the machine (asked, session closed, error). */
  | { type: "browser.stream.ended"; agentId: string; reason: "stopped" | "closed" | "error"; message?: string };

/** A tool as `mcp.tools` lists it (what MCP `tools/list` returns). */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** MCP's own `_meta`, passed to the CLI as is (`MCP_ALWAYS_LOAD`). */
  _meta?: Record<string, unknown>;
}

/**
 * A tool's `_meta` key Claude Code reads: listed with its schema from the first round, never behind its ToolSearch.
 * The runner sets it on the tools every run reaches for; the server on what one kind of run needs at once.
 */
export const MCP_ALWAYS_LOAD = "anthropic/alwaysLoad";

/** Most tools one `mcp.tools` frame carries. */
export const MCP_TOOLS_MAX = 200;

/**
 * Largest `mcp.call` arguments (JSON characters): a source file written whole through a connector's tool
 * (`create_or_update_file`) fits. At most 3 MB in UTF-8, so the frame stays inside `MAX_FRAME_BYTES`.
 */
export const MCP_ARGS_MAX_CHARS = 1024 * 1024;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const cut = (v: unknown, max: number) => (isString(v) ? v.slice(0, max) : undefined);
const fileList = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter(isString)
        .slice(0, TASK_LIMITS.files)
        .map((p) => p.slice(0, TASK_LIMITS.filePath))
    : undefined;
const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** A full or short git commit id (lowercase hex). */
export const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{7,64}$/.test(v);

/** What a phones report may carry: the host's own word only, so each field is bounded here. */
export const PHONE_LIMITS = { phones: 32, serial: 200, model: 100, name: 80, osVersion: 40, label: 200 };
const PHONE_STATES: readonly PhoneState[] = ["ready", "needs_you", "preparing", "unsupported"];
const PHONE_KINDS: readonly PhoneKind[] = ["device", "emulator", "simulator"];
const TOOLCHAINS: readonly (keyof RunnerToolchains)[] = [
  "git",
  "java",
  "androidSdk",
  "adb",
  "scrcpy",
  "maestro",
  "xcode",
  "appleTeam",
  "appleAccount",
  "xcodeSdk",
  "node",
  "podman",
];
const idOrNull = (v: unknown) => (isString(v) && v.length <= 64 ? v : null);

function parsePhoneHolder(v: unknown): PhoneHolder | null {
  if (!isObject(v) || !isString(v.since) || !Number.isFinite(Date.parse(v.since))) return null;
  const label = cut(v.label, PHONE_LIMITS.label);
  return {
    runId: idOrNull(v.runId),
    agentId: idOrNull(v.agentId),
    userId: idOrNull(v.userId),
    ...(label ? { label } : {}),
    since: v.since.slice(0, 40),
  };
}

/** `hello.phones` / `phones.changed`: each phone checked, the rest dropped. */
export function parsePhones(v: unknown[]): RunnerPhone[] {
  const out: RunnerPhone[] = [];
  for (const p of v.slice(0, PHONE_LIMITS.phones)) {
    if (!isObject(p) || (p.platform !== "android" && p.platform !== "ios")) continue;
    if (!isString(p.serial) || !p.serial || p.serial.length > PHONE_LIMITS.serial) continue;
    const state = PHONE_STATES.find((s) => s === p.state);
    if (!state) continue;
    const name = cut(p.name, PHONE_LIMITS.name);
    const width = finite(isObject(p.screen) ? p.screen.width : undefined);
    const height = finite(isObject(p.screen) ? p.screen.height : undefined);
    const battery = finite(p.battery);
    const transport = (["usb", "wifi", "local"] as const).find((t) => t === p.transport);
    const power = (["ac", "battery"] as const).find((t) => t === p.power);
    out.push({
      platform: p.platform,
      serial: p.serial,
      kind: PHONE_KINDS.find((k) => k === p.kind) ?? "device",
      model: cut(p.model, PHONE_LIMITS.model) ?? "",
      ...(name ? { name } : {}),
      osVersion: cut(p.osVersion, PHONE_LIMITS.osVersion) ?? "",
      state,
      ...(isString(p.reason) && /^[a-z_]{1,40}$/.test(p.reason) ? { reason: p.reason as PhoneReason } : {}),
      ...(transport ? { transport } : {}),
      ...(width !== undefined && height !== undefined ? { screen: { width, height } } : {}),
      ...(isString(p.abi) ? { abi: p.abi.slice(0, 40) } : {}),
      ...(power ? { power } : {}),
      ...(battery !== undefined && battery >= 0 && battery <= 100 ? { battery } : {}),
      holder: parsePhoneHolder(p.holder),
    });
  }
  return out;
}

/** `hello.toolchains`: known tools only, each a short version string. */
export function parseToolchains(v: Record<string, unknown>): RunnerToolchains {
  const out: RunnerToolchains = {};
  for (const key of TOOLCHAINS) {
    const value = cut(v[key], 100);
    if (value) (out as Record<string, string>)[key] = value;
  }
  if (out.appleAccount && !["team", "no_team", "none"].includes(out.appleAccount)) delete out.appleAccount;
  return out;
}

/** Protocol 14: `task.start`'s `baseBehind` (a count of commits; absent when the runner couldn't tell). */
export function parseBaseBehind(data: unknown): number | undefined {
  const n = isObject(data) ? data.baseBehind : undefined;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Protocol 14: a `mission.worktree` `ensure` answer, checked (null when it isn't one). */
export function parseMissionWorktreeEnsured(data: unknown): MissionWorktreeEnsured | null {
  if (!isObject(data) || !isString(data.path) || !isString(data.branch) || typeof data.created !== "boolean") {
    return null;
  }
  return {
    path: data.path.slice(0, 500),
    branch: data.branch.slice(0, 200),
    baseBranch: isString(data.baseBranch) ? data.baseBranch.slice(0, 200) : "",
    baseSha: isSha(data.baseSha) ? data.baseSha : "",
    created: data.created,
    dirty: data.dirty === true,
    setupCommand: isString(data.setupCommand) && data.setupCommand.trim() ? data.setupCommand.slice(0, 2000) : null,
    copied: Array.isArray(data.copied)
      ? data.copied
          .filter(isString)
          .slice(0, 100)
          .map((p) => p.slice(0, 300))
      : [],
  };
}

/** `task.done.denials`: at most `TASK_LIMITS.denials`, each cut, duplicates dropped. */
const denialList = (v: unknown): TaskDenial[] => {
  if (!Array.isArray(v)) return [];
  const out: TaskDenial[] = [];
  for (const d of v) {
    if (!isObject(d) || !isString(d.command) || !d.command.trim()) continue;
    const tool = isString(d.tool) && d.tool ? d.tool.slice(0, 64) : "Bash";
    const command = d.command.trim().slice(0, TASK_LIMITS.denial);
    if (out.some((x) => x.tool === tool && x.command === command)) continue;
    out.push({ tool, command });
    if (out.length >= TASK_LIMITS.denials) break;
  }
  return out;
};

/** `cursor`'s `models` (protocol 36), cut to `CURSOR_MODEL_LIMITS`; ids are short words only. */
export function parseCursorModels(v: unknown): CursorModelInfo[] {
  if (!Array.isArray(v)) return [];
  const out: CursorModelInfo[] = [];
  for (const m of v) {
    if (!isObject(m) || !isString(m.id) || !/^[\w.:/-]{1,80}$/.test(m.id)) continue;
    if (out.some((x) => x.id === m.id)) continue;
    const label = isString(m.label) ? m.label.replace(/\s+/g, " ").trim().slice(0, CURSOR_MODEL_LIMITS.label) : "";
    out.push({
      id: m.id,
      ...(label ? { label } : {}),
      ...(m.inPlan === true ? { inPlan: true } : {}),
      ...(m.free === true ? { free: true } : {}),
    });
    if (out.length >= CURSOR_MODEL_LIMITS.models) break;
  }
  return out;
}

/** `hello.executors`: only `claude`, `codex`, `cursor`, `opencode`, `grok` and `antigravity`, each with a short version line (and Claude Code's login). */
export function parseExecutors(v: Record<string, unknown>): NonNullable<RunnerInfo["executors"]> {
  const out: NonNullable<RunnerInfo["executors"]> = {};
  const word = (x: unknown) => (isString(x) && /^[\w.-]{1,40}$/.test(x) ? x : undefined);
  for (const name of ["claude", "codex", "cursor", "opencode", "grok", "antigravity"] as const) {
    const e = v[name];
    if (!isObject(e) || !isString(e.version)) continue;
    const authMethod = word(e.authMethod);
    const plan = word(e.plan);
    out[name] = {
      version: e.version.replace(/\s+/g, " ").trim().slice(0, 80),
      ...(typeof e.loggedIn === "boolean" ? { loggedIn: e.loggedIn } : {}),
      ...(authMethod ? { authMethod } : {}),
      ...(plan ? { plan } : {}),
    };
    const models = name === "claude" || name === "codex" ? [] : parseCursorModels(e.models);
    if (models.length) out[name] = { ...out[name], models } as RunnerExecutorInfo;
  }
  return out;
}

/** `hello.accounts` (protocol 13): at most `MAX_MACHINE_ACCOUNTS`, ids and kinds checked, short words only. */
export function parseAccounts(v: unknown[]): RunnerAccountInfo[] {
  const out: RunnerAccountInfo[] = [];
  for (const a of v.slice(0, MAX_MACHINE_ACCOUNTS)) {
    if (!isObject(a) || !isAccountId(a.id) || !isAccountKind(a.kind)) continue;
    const email = isString(a.email) && a.email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(a.email) ? a.email : undefined;
    const plan = isString(a.plan) && /^[\w.-]{1,40}$/.test(a.plan) ? a.plan : undefined;
    const usage = parsePlanUsage(a.usage);
    const provider = isPlanProviderWord(a.provider) ? a.provider : undefined;
    const keyHint = isString(a.keyHint) && /^[\x21-\x7e]{1,4}$/.test(a.keyHint) ? a.keyHint : undefined;
    const providerOrgId = providerOrgIdOf(a.providerOrgId);
    const orgName = providerOrgNameOf(a.orgName);
    out.push({
      id: a.id,
      kind: a.kind,
      loggedIn: a.loggedIn === true,
      ...(email ? { email } : {}),
      ...(plan ? { plan } : {}),
      ...(usage ? { usage } : {}),
      ...(provider ? { provider } : {}),
      ...(keyHint ? { keyHint } : {}),
      ...(a.shared === true ? { shared: true } : {}),
      ...(isAuthMethod(a.authMethod) ? { authMethod: a.authMethod } : {}),
      ...(a.statusUnknown === true ? { statusUnknown: true as const } : {}),
      ...(providerOrgId ? { providerOrgId } : {}),
      ...(orgName ? { orgName } : {}),
    });
  }
  return out;
}

const isoOf = (v: unknown) =>
  isString(v) && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined;

/** A usage snapshot (protocol 19), checked: known window kinds only, percentages 0–100, short labels. */
export function parsePlanUsage(v: unknown): PlanUsage | undefined {
  if (!isObject(v) || !Array.isArray(v.windows)) return undefined;
  const at = isoOf(v.at);
  if (!at) return undefined;
  const windows: PlanWindow[] = [];
  for (const w of v.windows.slice(0, PLAN_USAGE_LIMITS.windows)) {
    const kind = isObject(w) ? PLAN_WINDOW_KINDS.find((k) => k === w.kind) : undefined;
    const used = isObject(w) ? finite(w.usedPercent) : undefined;
    if (!isObject(w) || !kind || used === undefined) continue;
    const label = isString(w.label)
      ? w.label
          .replace(/\p{Cc}/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, PLAN_USAGE_LIMITS.label)
      : "";
    const resetsAt = isoOf(w.resetsAt);
    windows.push({
      kind,
      ...(label ? { label } : {}),
      usedPercent: Math.round(Math.min(100, Math.max(0, used))),
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return {
    windows,
    ...(v.limited === true ? { limited: true } : {}),
    source: v.source === "probe" ? "probe" : "turn",
    at,
  };
}

/** `ownUsage` (protocol 19): one snapshot per brain at most. */
export function parseOwnUsage(v: unknown): OwnPlanUsage | undefined {
  if (!isObject(v)) return undefined;
  const out: OwnPlanUsage = {};
  for (const kind of ACCOUNT_KINDS) {
    const usage = parsePlanUsage(v[kind]);
    if (usage) out[kind] = usage;
  }
  return out;
}

const cutJson = (v: unknown, max: number): unknown => {
  try {
    const text = JSON.stringify(v ?? null);
    return text.length <= max ? v : { truncated: text.slice(0, max) };
  } catch {
    return null;
  }
};

/** One `brain.event` event, checked and cut; null when it isn't one. */
export function parseBrainEvent(v: unknown): WireBrainEvent | null {
  if (!isObject(v) || !isString(v.type)) return null;
  const num = (x: unknown) => Math.max(0, Math.round(finite(x) ?? 0));
  switch (v.type) {
    case "text_delta":
      return isString(v.text) ? { type: "text_delta", text: v.text.slice(0, BRAIN_LIMITS.delta) } : null;
    case "tool_call": {
      if (!isString(v.id) || !isString(v.name)) return null;
      const ex = isObject(v.executed) && isString(v.executed.content) ? v.executed : null;
      return {
        type: "tool_call",
        id: v.id.slice(0, 128),
        name: v.name.slice(0, BRAIN_LIMITS.toolName),
        input: cutJson(v.input, BRAIN_LIMITS.toolText),
        ...(ex
          ? {
              executed: {
                content: String(ex.content).slice(0, BRAIN_LIMITS.toolText),
                ...(ex.isError === true ? { isError: true } : {}),
              },
            }
          : {}),
      };
    }
    case "usage":
      return {
        type: "usage",
        input: num(v.input),
        output: num(v.output),
        source: v.source === "api" ? "api" : "plan",
        ...(isString(v.model) ? { model: v.model.slice(0, 100) } : {}),
        ...(num(v.cacheRead) > 0 ? { cacheRead: num(v.cacheRead) } : {}),
        ...(num(v.cacheWrite) > 0 ? { cacheWrite: num(v.cacheWrite) } : {}),
        ...(num(v.calls) > 0 ? { calls: num(v.calls) } : {}),
        ...(num(v.maxUncached) > 0 ? { maxUncached: num(v.maxUncached) } : {}),
      };
    case "limit":
      return { type: "limit", ...(isString(v.resetsAt) ? { resetsAt: v.resetsAt.slice(0, 40) } : {}) };
    case "done": {
      if (!isString(v.text)) return null;
      const session = isObject(v.session) && isString(v.session.id) ? { id: v.session.id.slice(0, 64) } : undefined;
      return { type: "done", text: v.text.slice(0, BRAIN_LIMITS.doneText), ...(session ? { session } : {}) };
    }
    case "error":
      if (!isString(v.code)) return null;
      return {
        type: "error",
        code: v.code.slice(0, 64),
        message: (isString(v.message) ? v.message : "").slice(0, BRAIN_LIMITS.message),
        ...(typeof v.retryable === "boolean" ? { retryable: v.retryable } : {}),
        ...(typeof v.worked === "boolean" ? { worked: v.worked } : {}),
        ...(isProviderFailureCause(v.cause) ? { cause: v.cause } : {}),
        ...(Number.isInteger(v.httpStatus) && (v.httpStatus as number) >= 100 && (v.httpStatus as number) <= 599
          ? { httpStatus: v.httpStatus as number }
          : {}),
      };
    case "steer_read": {
      if (!Array.isArray(v.uuids)) return null;
      const uuids = v.uuids
        .filter(isString)
        .slice(0, STEER_LIMITS.messages * 4)
        .map((u) => u.slice(0, 64));
      return uuids.length ? { type: "steer_read", uuids } : null;
    }
    case "speed_fallback":
      return { type: "speed_fallback", message: (isString(v.message) ? v.message : "").slice(0, BRAIN_LIMITS.message) };
    case "tool_started":
      return isString(v.id) && isString(v.name)
        ? { type: "tool_started", id: v.id.slice(0, 128), name: v.name.slice(0, BRAIN_LIMITS.toolName) }
        : null;
    default:
      return null;
  }
}

/** A journal entry from `hello` or `task.status`; null when malformed. */
export function parseRunnerTask(v: unknown): RunnerTask | null {
  if (!isObject(v) || !isString(v.taskId) || !isString(v.agentId) || !isString(v.startedAt)) return null;
  const status = (["running", "done", "interrupted"] as const).find((s) => s === v.status);
  if (!status) return null;
  const exitCode = v.exitCode === null ? null : finite(v.exitCode);
  return {
    taskId: v.taskId.slice(0, 64),
    agentId: v.agentId.slice(0, 64),
    status,
    ...(finite(v.pid) !== undefined ? { pid: finite(v.pid) } : {}),
    startedAt: v.startedAt.slice(0, 40),
    ...(isString(v.endedAt) ? { endedAt: v.endedAt.slice(0, 40) } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(v.signal === null || isString(v.signal) ? { signal: v.signal === null ? null : v.signal.slice(0, 20) } : {}),
    ...(finite(v.seconds) !== undefined ? { seconds: finite(v.seconds) } : {}),
    ...(isString(v.lastLine) ? { lastLine: v.lastLine.slice(0, TASK_LIMITS.line) } : {}),
    ...(fileList(v.files) ? { files: fileList(v.files) } : {}),
  };
}

/** Parses a runner frame (server side); null when it isn't one. */
export function parseRunnerFrame(raw: string): RunnerFrame | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let f: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(f)) return null;
  switch (f.type) {
    case "hello": {
      if (!isString(f.token) || !isString(f.version) || typeof f.protocol !== "number") return null;
      const paused = parsePause(f.paused);
      const access = parseAccess(f.access);
      const size = parseMachineSize(f.size);
      return {
        type: "hello",
        token: f.token,
        version: f.version.slice(0, 40),
        protocol: f.protocol,
        os: (["linux", "darwin", "windows"] as const).find((o) => o === f.os) ?? "other",
        arch: isString(f.arch) ? f.arch.slice(0, 40) : "",
        hostname: isString(f.hostname) ? f.hostname.slice(0, 200) : "",
        workspace: isString(f.workspace) ? f.workspace.slice(0, 500) : "",
        exec: f.exec !== false,
        ...(isObject(f.executors) ? { executors: parseExecutors(f.executors) } : {}),
        ...(Array.isArray(f.tasks)
          ? {
              tasks: f.tasks
                .slice(0, TASK_LIMITS.tasks)
                .map(parseRunnerTask)
                .filter((t): t is RunnerTask => t !== null),
            }
          : {}),
        ...(paused ? { paused } : {}),
        ...(access ? { access } : {}),
        ...(isObject(f.browser) ? { browser: parseBrowserInfo(f.browser) } : {}),
        ...(Array.isArray(f.accounts) ? { accounts: parseAccounts(f.accounts) } : {}),
        ...(isObject(f.desktop) ? { desktop: parseDesktopInfo(f.desktop) } : {}),
        ...(isObject(f.terminal) ? { terminal: parseAvailability(f.terminal) } : {}),
        ...(isObject(f.desktopUse) ? { desktopUse: parseAvailability(f.desktopUse) } : {}),
        ...(f.mode === "system" ? { mode: "system" as const } : {}),
        ...(isObject(f.ownUsage) ? { ownUsage: parseOwnUsage(f.ownUsage) } : {}),
        ...(size ? { size } : {}),
        ...(Array.isArray(f.claudeLoginMethods)
          ? { claudeLoginMethods: AUTH_METHODS.filter((m) => (f.claudeLoginMethods as unknown[]).includes(m)) }
          : {}),
        ...(isString(f.claudeLoginBlocked) ? { claudeLoginBlocked: f.claudeLoginBlocked.slice(0, 300) } : {}),
        ...(f.authEgressGroup === true ? { authEgressGroup: true as const } : {}),
        ...(Array.isArray(f.phones) ? { phones: parsePhones(f.phones) } : {}),
        ...(isObject(f.toolchains) ? { toolchains: parseToolchains(f.toolchains) } : {}),
      };
    }
    case "phones.changed":
      return Array.isArray(f.phones) ? { type: "phones.changed", phones: parsePhones(f.phones) } : null;
    case "browser.frame": {
      if (!isString(f.agentId) || !isString(f.data) || f.data.length > BROWSER_LIMITS.frameBytes) return null;
      const seq = finite(f.seq);
      const m = isObject(f.metadata) ? f.metadata : null;
      const width = finite(m?.deviceWidth);
      const height = finite(m?.deviceHeight);
      if (seq === undefined || !m || width === undefined || height === undefined) return null;
      const scale = finite(m.pageScaleFactor);
      const capturedAt = finite(m.capturedAt);
      const url = cut(m.url, BROWSER_LIMITS.url);
      const title = cut(m.title, BROWSER_LIMITS.title);
      return {
        type: "browser.frame",
        agentId: f.agentId.slice(0, 64),
        seq,
        data: f.data,
        metadata: {
          deviceWidth: width,
          deviceHeight: height,
          ...(scale !== undefined ? { pageScaleFactor: scale } : {}),
          ...(capturedAt !== undefined ? { capturedAt } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(title ? { title } : {}),
          ...(isBrowserDevice(m.emulated) ? { emulated: m.emulated } : {}),
        },
      };
    }
    case "browser.stream.ended": {
      if (!isString(f.agentId)) return null;
      const reason = (["stopped", "closed", "error"] as const).find((r) => r === f.reason);
      if (!reason) return null;
      const message = cut(f.message, BROWSER_LIMITS.message);
      return {
        type: "browser.stream.ended",
        agentId: f.agentId.slice(0, 64),
        reason,
        ...(message !== undefined ? { message } : {}),
      };
    }
    case "runner.state": {
      const paused = parsePause(f.paused);
      return paused ? { type: "runner.state", paused } : null;
    }
    case "access.changed": {
      const access = parseAccess(f.access);
      return access ? { type: "access.changed", access } : null;
    }
    case "accounts.changed": {
      if (!Array.isArray(f.accounts)) return null;
      const ownUsage = parseOwnUsage(f.ownUsage);
      return { type: "accounts.changed", accounts: parseAccounts(f.accounts), ...(ownUsage ? { ownUsage } : {}) };
    }
    case "executors.changed":
      return isObject(f.executors) ? { type: "executors.changed", executors: parseExecutors(f.executors) } : null;
    case "toolchains.changed":
      return isObject(f.toolchains) ? { type: "toolchains.changed", toolchains: parseToolchains(f.toolchains) } : null;
    case "access.decided": {
      if (!isString(f.requestId)) return null;
      const decision = (["granted", "denied", "expired"] as const).find((d) => d === f.decision);
      if (!decision) return null;
      const scope = (["agent", "all"] as const).find((s) => s === f.scope);
      return {
        type: "access.decided",
        requestId: f.requestId.slice(0, 64),
        decision,
        ...(scope ? { scope } : {}),
      };
    }
    case "output":
      if (!isString(f.id) || !isString(f.chunk) || (f.stream !== "stdout" && f.stream !== "stderr")) return null;
      return { type: "output", id: f.id, stream: f.stream, chunk: f.chunk };
    case "result":
      if (!isString(f.id)) return null;
      if (f.ok === true) return { type: "result", id: f.id, ok: true, data: f.data };
      if (f.ok === false && isObject(f.error) && isString(f.error.code) && isString(f.error.message)) {
        return {
          type: "result",
          id: f.id,
          ok: false,
          error: { code: f.error.code as MachineErrorCode, message: f.error.message.slice(0, 2000) },
        };
      }
      return null;
    case "pong": {
      if (typeof f.at !== "number") return null;
      const rawTransition = f.networkTransition;
      const transition =
        isObject(rawTransition) &&
        (rawTransition.state === "draining" || rawTransition.state === "restart_required") &&
        typeof rawTransition.deadline === "string" &&
        Number.isFinite(Date.parse(rawTransition.deadline)) &&
        Array.isArray(rawTransition.agents) &&
        rawTransition.agents.length <= 1000 &&
        rawTransition.agents.every((id) => typeof id === "string" && id.length <= 64)
          ? {
              state: rawTransition.state as MachineNetworkTransition["state"],
              deadline: rawTransition.deadline,
              agents: rawTransition.agents as string[],
            }
          : null;
      const load = parseMachineLoad(f.load);
      const browserTraffic = parseBrowserTraffic(f.browserTraffic);
      const rawEgress = isObject(f.egress) ? f.egress : null;
      const egress =
        rawEgress &&
        (rawEgress.ip === null ||
          (typeof rawEgress.ip === "string" && rawEgress.ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(rawEgress.ip)))
          ? {
              ip: rawEgress.ip as string | null,
              ...(typeof rawEgress.country === "string" && /^[A-Z]{2}$/.test(rawEgress.country)
                ? { country: rawEgress.country }
                : {}),
            }
          : null;
      return {
        type: "pong",
        at: f.at,
        ...(load ? { load } : {}),
        ...(browserTraffic ? { browserTraffic } : {}),
        ...(egress ? { egress } : {}),
        ...(transition || rawTransition === null ? { networkTransition: transition } : {}),
      };
    }
    case "task.event": {
      if (!isString(f.taskId) || (f.kind !== "line" && f.kind !== "files" && f.kind !== "progress")) return null;
      const line = cut(f.line, TASK_LIMITS.line);
      const files = fileList(f.files);
      const seconds = finite(f.seconds);
      const prUrl = cut(f.prUrl, TASK_LIMITS.prUrl);
      return {
        type: "task.event",
        taskId: f.taskId.slice(0, 64),
        kind: f.kind,
        ...(line !== undefined ? { line } : {}),
        ...(files ? { files } : {}),
        ...(seconds !== undefined ? { seconds } : {}),
        ...(prUrl && /^https?:\/\/\S+$/i.test(prUrl) ? { prUrl } : {}),
      };
    }
    case "task.done": {
      if (!isString(f.taskId)) return null;
      const exitCode = finite(f.exitCode) ?? null;
      const result = cut(f.result, TASK_LIMITS.result);
      const lastLine = cut(f.lastLine, TASK_LIMITS.line);
      const files = fileList(f.files);
      const session = cut(f.session, 64);
      const denials = denialList(f.denials);
      // Protocol 14: both or neither.
      const shas = isSha(f.startSha) && isSha(f.endSha) ? { startSha: f.startSha, endSha: f.endSha } : {};
      return {
        type: "task.done",
        taskId: f.taskId.slice(0, 64),
        exitCode,
        signal: isString(f.signal) ? f.signal.slice(0, 20) : null,
        seconds: Math.max(0, Math.round(finite(f.seconds) ?? 0)),
        ...(result !== undefined ? { result } : {}),
        ...(lastLine !== undefined ? { lastLine } : {}),
        ...(files ? { files } : {}),
        ...(f.canceled === true ? { canceled: true } : {}),
        ...(f.timedOut === true ? { timedOut: true } : {}),
        ...(f.interrupted === true ? { interrupted: true } : {}),
        ...(session !== undefined ? { session } : {}),
        ...(denials.length ? { denials } : {}),
        ...shas,
      };
    }
    case "mcp.call": {
      if (!isString(f.callId) || !isString(f.taskId) || !isString(f.tool)) return null;
      const args = isObject(f.args) && !Array.isArray(f.args) ? f.args : {};
      if (JSON.stringify(args).length > MCP_ARGS_MAX_CHARS) return null;
      return {
        type: "mcp.call",
        callId: f.callId.slice(0, 64),
        taskId: f.taskId.slice(0, 64),
        tool: f.tool.slice(0, 64),
        args,
        ...(isRunToolToken(f.token) ? { token: f.token } : {}),
      };
    }
    case "mcp.list":
      if (!isString(f.callId) || !isString(f.taskId) || !isRunToolToken(f.token)) return null;
      return { type: "mcp.list", callId: f.callId.slice(0, 64), taskId: f.taskId.slice(0, 64), token: f.token };
    case "brain.event": {
      if (!isString(f.runId)) return null;
      const event = parseBrainEvent(f.event);
      return event ? { type: "brain.event", runId: f.runId.slice(0, 64), event } : null;
    }
    case "brain.done":
      return isString(f.runId) ? { type: "brain.done", runId: f.runId.slice(0, 64) } : null;
    default:
      return null;
  }
}

const SERVER_FRAME_TYPES = [
  "welcome",
  "request",
  "cancel",
  "ping",
  "refused",
  "task.ack",
  "mcp.result",
  "mcp.tools",
  "agents",
  "browser.handoff",
];

/** Parses a server frame (runner side); null when it isn't one. */
export function parseServerFrame(raw: string): ServerFrame | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let f: unknown;
  try {
    f = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(f) || !isString(f.type)) return null;
  if (f.type === "request") {
    if (!isString(f.id) || !isString(f.op)) return null;
    if (!MACHINE_OPS.includes(f.op as MachineOp)) return null;
  }
  if ((f.type === "cancel" || f.type === "request") && !isString(f.id)) return null;
  if (f.type === "task.ack" && !isString(f.taskId)) return null;
  if ((f.type === "mcp.result" || f.type === "mcp.tools") && !isString(f.callId)) return null;
  if (f.type === "mcp.tools" && f.ok === true && !Array.isArray(f.tools)) return null;
  if (f.type === "agents" && !Array.isArray(f.agents)) return null;
  if (f.type === "browser.handoff" && (!isString(f.agentId) || (f.handoff !== null && !isObject(f.handoff)))) {
    return null;
  }
  if (!SERVER_FRAME_TYPES.includes(f.type)) return null;
  return f as ServerFrame;
}

/** A pairing code as people type it: 8 letters/digits, dash optional, any case. */
export function normalizePairingCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * The tools of the local `agentes` MCP server a mission task's executor gets
 * (protocol 5, ADR 0029). The runner lists them (`tools/list`) and relays
 * calls; the server validates and runs them, bound to the task's mission.
 */
export interface MissionMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const RULES_START =
  "You work on an agentes.chat mission. Read the files in .agentes/ first (mission.md, decisions.md, notes.md). Use the agentes tools: keep the plan with update_plan, report milestones with report, ask decisions only with ask_decision, and ask for a review with request_review when you have something to show. Write plan items, reports, decisions and reviews in the language the people use in the thread (the language of the mission goal), short and plain.";
const RULES_END =
  "Plan items are short outcomes in the people's language; never put tool names (request_review, upload_artifact and the like) in them. When every plan item is done, call complete_mission with what you delivered and what the person should check; don't keep working. Write what you learn and the next steps in .agentes/notes.md. When a tool tells you to stop and wait, end your turn.";

/**
 * What a mission's executor is told on every task (ADR 0029) when its folder
 * is a git repository: appended to Claude Code's system prompt
 * (`--append-system-prompt`) and written in `.agentes/mission.md`. Plain
 * characters only: the runner passes it as one shell argument (`cleanRules`).
 */
export const MISSION_RULES = `${RULES_START} Never merge, deploy or roll back directly: ask with request_approval and wait. Work on the mission's own branch in the mission's folder (don't create or switch branches), commit work in progress after each step and push the branch now and then. ${RULES_END}`;

/**
 * The same rules for a mission folder that is not a git repository (images,
 * documents, files for the Drive): no branches, commits, pull requests or
 * pushes; results go to the people with upload_artifact or request_review.
 * The runner picks this one when the task's folder isn't a repository.
 */
export const MISSION_RULES_NO_GIT = `${RULES_START} Never deploy or publish anything directly: ask with request_approval and wait. This mission folder is not a git repository and doesn't need one: don't create one. Work in the mission folder (items started with start_task work there too, one that writes at a time), and deliver results with upload_artifact or request_review. ${RULES_END}`;

const PLAN_STATUSES = ["todo", "doing", "waiting_you", "done", "dropped"];

export const MISSION_MCP_TOOLS: readonly MissionMcpTool[] = [
  {
    name: "report",
    description:
      "Tell the people in the mission's thread where things stand: a milestone, what you found, what is next. One short paragraph in the language the people use in the thread; no internal details (tool names, logs). Use it at milestones, not for every step. pr_url: a pull request you opened.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 4000 },
        status: { enum: ["working", "blocked", "done"] },
        pr_url: { type: "string", maxLength: 500 },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "update_plan",
    description:
      "Replace the mission's plan: the whole checklist, every time (keep each item's id stable). Statuses: todo, doing, waiting_you (needs a person), done, dropped. Write titles and notes in the language the people use in the thread, short (a title is at most 200 characters; details go in note). Keep an item's title unless what it means changed. People see each change as one line in the thread.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 60,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 40 },
              title: { type: "string", minLength: 1, maxLength: 200 },
              status: { enum: PLAN_STATUSES },
              note: { type: "string", maxLength: 500 },
            },
            required: ["title", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_decision",
    description:
      "Ask the people a product or technical decision as a card with 2 to 4 options, in the language the people use in the thread. blocking: true when you can't go on without it (then stop and wait; you are resumed with the answer). blocking: false to go on with your recommendation as a provisional decision they review later.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1, maxLength: 500 },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        recommendation: { type: "string", maxLength: 200 },
        why: { type: "string", maxLength: 1000 },
        impact: { type: "string", maxLength: 500 },
        blocking: { type: "boolean" },
      },
      required: ["question", "options", "blocking"],
      additionalProperties: false,
    },
  },
  {
    name: "request_review",
    description:
      "Ask the people to look at something you can show (screens, files, a prototype, a PR), with the title and summary in the language the people use in the thread. paths: files in your folder to attach (uploaded to the Drive). Then stop and wait: you are resumed with their answer (approved, or the changes they want).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        summary: { type: "string", maxLength: 4000 },
        pr_url: { type: "string", maxLength: 500 },
        paths: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "request_approval",
    description:
      "Ask a person to approve a merge, a deploy or a rollback before you do it. Never merge, deploy or roll back without an approval. Then stop and wait: you are resumed with the outcome.",
    inputSchema: {
      type: "object",
      properties: {
        action: { enum: ["merge", "deploy", "rollback"] },
        target: { type: "string", minLength: 1, maxLength: 300 },
        detail: { type: "string", maxLength: 1000 },
      },
      required: ["action", "target"],
      additionalProperties: false,
    },
  },
  {
    name: "upload_artifact",
    description:
      "Send a file (or a folder, as a .zip) from your folder to the team's Drive and get its id. The bytes go straight to the Drive.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 300 },
        title: { type: "string", maxLength: 200 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "get_context",
    description:
      "Search what the organization already knows (conversations, decisions, wiki, documents) that this mission's agent may see. Short results.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 500 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "start_task",
    description:
      'Main session only: start one plan item as its own background session in the mission\'s folder (the mission\'s own copy of the project, on its branch). mode "write" (default): it may change files; write items run one at a time, in the order you start them (one started while another runs waits in a queue and starts by itself), and each ends in one commit you are told about. mode "read": research, analysis or review with no write access; read items may run in parallel. An item that finds the computer full waits in the queue too. You are told when it ends. Give it everything it needs in prompt. Small work you can just do yourself.',
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120 },
        prompt: { type: "string", minLength: 1, maxLength: 20000 },
        mode: { enum: ["write", "read"] },
      },
      required: ["title", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_mission",
    description:
      "When every plan item is done: hand the mission over to the people as a delivery card. summary: what you delivered, in the language the people use in the thread. checklist: what the person should check (short items). paths: files in your folder to attach (uploaded to the Drive). Then stop and wait: the person concludes the mission or asks for changes (you are resumed with them). Don't keep working.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 4000 },
        checklist: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
        paths: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "permission_prompt",
    description:
      "Internal: Claude Code calls this itself when a command needs a person's approval (--permission-prompt-tool). Never call it yourself.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string", maxLength: 64 },
        input: { type: "object" },
        tool_use_id: { type: "string", maxLength: 128 },
        /** The runner's follow-up: the state of a request it already made. */
        request_id: { type: "string", maxLength: 64 },
        /** Added by the runner: where the task runs and its folders (the code-side rules check paths). */
        scope: { type: "object" },
      },
    },
  },
];

/**
 * The first pull (or merge) request URL in a text: GitHub `…/pull/N`,
 * GitLab `…/-/merge_requests/N`. Shared by the runner (task output) and the
 * server (lines, results, the executor's reports).
 */
export function findPullRequestUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|[\w.-]+\/(?:[\w.-]+\/)+-\/merge_requests\/\d+)/.exec(
    text,
  );
  return m ? m[0].slice(0, TASK_LIMITS.prUrl) : null;
}

// ── Command approvals (Claude Code's permission prompts) ──────────────────────

/** Our MCP tool Claude Code asks when a command needs a person (`--permission-prompt-tool`). */
export const PERMISSION_TOOL = "permission_prompt";
/** Its name as Claude Code knows it. */
export const PERMISSION_PROMPT_TOOL = `mcp__agentes__${PERMISSION_TOOL}`;
/** How long a command waits for a person before it is denied. */
export const PERMISSION_WAIT_MS = 30 * 60_000;
/** How often the runner asks the server whether someone answered. */
export const PERMISSION_POLL_MS = 4000;
/** Told to the executor when nobody answered in time. */
export const PERMISSION_TIMEOUT_MESSAGE =
  "The person was asked and didn't answer yet; continue with other work or stop and wait.";

/** The words a command is made of: one per part of a pipeline or list (`a && b | c`). */
export function commandParts(command: string): string[] {
  return command
    .split(/\|\||&&|[;|\n]/)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/** What a tool call does, as one line for people (`git init`, `WebFetch https://…`). */
export function commandOf(toolName: string, input: Record<string, unknown> | null | undefined): string {
  const i = input ?? {};
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  if (toolName === "Bash") return s("command").trim().replace(/\s+/g, " ").slice(0, 1000);
  const what = s("url") || s("file_path") || s("path") || s("query") || s("pattern");
  return `${toolName}${what ? ` ${what}` : ""}`.slice(0, 1000);
}

const globRe = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );

/** The `Bash(...)` pattern of a rule, or null for another tool's rule. */
const bashPattern = (rule: string) => /^Bash\((.*)\)$/s.exec(rule.trim())?.[1] ?? null;

/** One part of a command against one `Bash(...)` pattern (Claude Code's `*` matches anything; `x *` also matches `x`). */
function partMatches(pattern: string, part: string) {
  if (globRe(pattern).test(part)) return true;
  return pattern.endsWith(" *") && part === pattern.slice(0, -2);
}

/**
 * Does a permission rule cover this call? `Bash(...)` rules: a deny rule
 * matches when any part of the command matches (`mode: "any"`), an allow
 * rule set covers a command when every part matches one of them (see
 * `allowedBy`). Other tools: the bare name, or `WebFetch(domain:host)`.
 */
export function ruleMatches(rule: string, toolName: string, input: Record<string, unknown> | null | undefined) {
  const pattern = bashPattern(rule);
  if (pattern !== null) {
    if (toolName !== "Bash") return false;
    return commandParts(commandOf("Bash", input)).some((part) => partMatches(pattern, part));
  }
  const r = rule.trim();
  if (r === toolName) return true;
  const domain = /^WebFetch\(domain:(.+)\)$/.exec(r)?.[1];
  if (domain && toolName === "WebFetch") {
    try {
      return new URL(String(input?.url ?? "")).hostname === domain;
    } catch {
      return false;
    }
  }
  return false;
}

/** Every part of the call is covered by one of these allow rules. */
export function allowedBy(
  rules: readonly string[],
  toolName: string,
  input: Record<string, unknown> | null | undefined,
) {
  if (toolName !== "Bash") return rules.some((r) => ruleMatches(r, toolName, input));
  const parts = commandParts(commandOf("Bash", input));
  if (parts.length === 0) return false;
  return parts.every((part) =>
    rules.some((r) => {
      const pattern = bashPattern(r);
      return pattern !== null && partMatches(pattern, part);
    }),
  );
}

/** Tools whose rules keep two words (`git init`, `npm run`): the rest keep one (`swift`, `python3`). */
const TWO_WORD_COMMANDS = new Set([
  "git",
  "gh",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "cargo",
  "go",
  "docker",
  "kubectl",
  "brew",
  "pip",
  "pip3",
  "uv",
  "xcrun",
  "swift",
  "eas",
  "npx",
]);

/**
 * "Aprovar sempre nesta missão": the rules that allow this call from now on,
 * from the first word (or two) of each part (`swift build -c release` →
 * `Bash(swift build *)`; `sips -Z 800 a.png` → `Bash(sips *)`); another
 * tool: its name (WebFetch: its domain). At most 5.
 */
export function rulesFor(toolName: string, input: Record<string, unknown> | null | undefined): string[] {
  if (toolName === "Bash") {
    const out: string[] = [];
    for (const part of commandParts(commandOf("Bash", input))) {
      const words = part.split(" ").filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w));
      const first = words[0];
      if (!first) continue;
      const second = words[1];
      const head = TWO_WORD_COMMANDS.has(first) && second && !second.startsWith("-") ? `${first} ${second}` : first;
      const rule = `Bash(${head.replace(/[()*]/g, "")} *)`;
      if (!out.includes(rule)) out.push(rule);
      if (out.length >= 5) break;
    }
    return out;
  }
  if (toolName === "WebFetch") {
    try {
      return [`WebFetch(domain:${new URL(String(input?.url ?? "")).hostname})`];
    } catch {
      return ["WebFetch"];
    }
  }
  return /^[A-Za-z_][\w]*$/.test(toolName) ? [toolName] : [];
}

/** A rule we accept from the server for a task's settings (no wildcards for whole tools, no odd characters). */
export const isSafeRule = (rule: string) =>
  /^Bash\([^()\n]{1,200}\)$/.test(rule) ||
  /^WebFetch\(domain:[\w.-]{1,200}\)$/.test(rule) ||
  /^(WebFetch|WebSearch)$/.test(rule);

/** `hello.paused` / `runner.state.paused`, checked. */
export function parsePause(v: unknown): RunnerPause | undefined {
  if (!isObject(v) || typeof v.paused !== "boolean") return undefined;
  const until = isString(v.until) && !Number.isNaN(Date.parse(v.until)) ? new Date(v.until).toISOString() : null;
  return v.paused ? { paused: true, until } : { paused: false };
}

/** `hello.access` / `access.changed.access`, checked and cut. */
export function parseAccess(v: unknown): RunnerAccess | undefined {
  if (!isObject(v) || !isObject(v.tools) || !Array.isArray(v.folders)) return undefined;
  const t = v.tools;
  const folders: RunnerFolderGrant[] = [];
  for (const f of v.folders.slice(0, ACCESS_LIMITS.folders)) {
    if (!isObject(f) || !isString(f.path) || !f.path) continue;
    const agents = Array.isArray(f.agents)
      ? f.agents
          .filter(isString)
          .slice(0, ACCESS_LIMITS.agentsPerFolder)
          .map((a) => a.slice(0, 64))
      : [];
    folders.push({ path: f.path.slice(0, ACCESS_LIMITS.path), agents });
  }
  return {
    folders,
    tools: {
      claude: t.claude === true,
      codex: t.codex === true,
      // Kept off too: absent means a runner before Cursor's switch, where Cursor follows Codex.
      ...(typeof t.cursor === "boolean" ? { cursor: t.cursor } : {}),
      // Absent: a runner before OpenCode's switch, where OpenCode follows Codex.
      ...(typeof t.opencode === "boolean" ? { opencode: t.opencode } : {}),
      // Absent: a runner before Grok's switch (protocol 43), where Grok is off.
      ...(typeof t.grok === "boolean" ? { grok: t.grok } : {}),
      // Absent: a runner before the Antigravity CLI's switch (protocol 44), where it is off.
      ...(typeof t.antigravity === "boolean" ? { antigravity: t.antigravity } : {}),
      commands: t.commands === true,
      ...(t.browser === true ? { browser: true } : {}),
      ...(t.desktop === true ? { desktop: true } : {}),
      ...(t.terminal === true ? { terminal: true } : {}),
    },
  };
}

/** `hello.browser` (protocol 12), cut. */
export function parseBrowserInfo(v: Record<string, unknown>): RunnerBrowserInfo {
  const version = cut(v.version, 40);
  const chrome = cut(v.chrome, 120);
  const reason = cut(v.reason, BROWSER_LIMITS.message);
  const code = reasonCode(v.code);
  return {
    available: v.available === true,
    ...(version !== undefined ? { version } : {}),
    ...(chrome !== undefined ? { chrome } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(v.chromeMissing === true ? { chromeMissing: true as const } : {}),
  };
}

/** A whole number from `min` to `max`. */
export const inRange = (v: unknown, [min, max]: readonly [number, number]): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** A small JSON text frame, parsed; null when it is too long or not JSON. */
const smallJson = (raw: string, max: number): unknown => {
  if (raw.length > max) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** `hello.terminal` (protocol 18), `hello.desktopUse` (21) and the part `hello.desktop` shares with them, cut. */
export function parseAvailability(v: Record<string, unknown>): RunnerTerminalInfo {
  const reason = cut(v.reason, BROWSER_LIMITS.message);
  const code = reasonCode(v.code);
  return {
    available: v.available === true,
    ...(reason !== undefined ? { reason } : {}),
    ...(code !== undefined ? { code } : {}),
  };
}

/** A reason's code (`browser_download`): a short word, else none. */
const reasonCode = (v: unknown) => (typeof v === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(v) ? v : undefined);

const between = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** `hello.size` (protocol 22): sane numbers, else none; a `limit` that isn't sane is left out. */
export function parseMachineSize(v: unknown): MachineSize | null {
  if (!isObject(v) || !inRange(v.cpus, [1, 4096])) return null;
  if (!between(v.memoryGb, 0, 1 << 16) || !between(v.diskGb, 0, 1 << 24)) return null;
  const l = v.limit;
  const limit =
    isObject(l) && inRange(l.cpus, [1, v.cpus]) && between(l.memoryGb, 0, v.memoryGb)
      ? { limit: { cpus: l.cpus, memoryGb: l.memoryGb } }
      : {};
  return { cpus: v.cpus, memoryGb: v.memoryGb, diskGb: v.diskGb, ...limit };
}

/** `pong.load` (protocol 22): sane numbers, else none. */
export function parseMachineLoad(v: unknown): MachineLoad | null {
  if (!isObject(v) || !between(v.loadAvg, 0, 1000) || !between(v.loadPeak, 0, 1000)) return null;
  if (!between(v.memoryAvg, 0, 1) || !between(v.memoryPeak, 0, 1) || !between(v.hours, 0, 24)) return null;
  return {
    loadAvg: v.loadAvg,
    loadPeak: v.loadPeak,
    memoryAvg: v.memoryAvg,
    memoryPeak: v.memoryPeak,
    hours: v.hours,
    ...(inRange(v.oomKills, [0, 1e9]) ? { oomKills: v.oomKills } : {}),
    ...(between(v.diskFreeGb, 0, 1e6) ? { diskFreeGb: v.diskFreeGb } : {}),
    ...(between(v.diskUse, 0, 1) ? { diskUse: v.diskUse } : {}),
    ...(between(v.sharedGb, 0, 1e6) ? { sharedGb: v.sharedGb } : {}),
  };
}

/** `pong.browserTraffic` (protocol 23): whole bytes up to 1e15 and at most 24 hours, else none. */
export function parseBrowserTraffic(v: unknown): BrowserTraffic | null {
  if (!isObject(v) || !inRange(v.up, [0, 1e15]) || !inRange(v.down, [0, 1e15]) || !between(v.hours, 0, 24)) {
    return null;
  }
  return { up: v.up, down: v.down, hours: v.hours };
}

/** `hello.desktop` (protocol 18), cut; a size only when both sides are sane. */
export function parseDesktopInfo(v: Record<string, unknown>): RunnerDesktopInfo {
  const size = inRange(v.width, [1, 8192]) && inRange(v.height, [1, 8192]) ? { width: v.width, height: v.height } : {};
  return { ...parseAvailability(v), ...size };
}

/** A stream's id as `stream.open` and `stream.hello` carry it: 32 random bytes in base64url. */
export const isStreamId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

/** A data socket's `stream.hello` (server side); null when it isn't one. The token is checked by the caller. */
export function parseStreamHello(raw: string): StreamHello | null {
  const f = smallJson(raw, 512);
  if (!isObject(f) || f.type !== "stream.hello" || !isStreamId(f.streamId)) return null;
  if (!isString(f.token) || !f.token.startsWith(MACHINE_TOKEN_PREFIX) || f.token.length > 200) return null;
  return { type: "stream.hello", token: f.token, streamId: f.streamId };
}

/** A terminal's size within `STREAM_LIMITS` (whole columns and rows). */
export const isTerminalSize = (cols: unknown, rows: unknown) =>
  inRange(cols, STREAM_LIMITS.cols) && inRange(rows, STREAM_LIMITS.rows);

/** A text frame on a ready stream (either side); null when it isn't one or a size is out of bounds. */
export function parseStreamControl(raw: string): StreamControl | null {
  // A phone's `text` may carry a pasted line (JSON escapes take up to 6 characters each); every other frame is short.
  const f = smallJson(raw, PHONE_VIEW.text * 6 + 100);
  if (!isObject(f) || (f.type !== "text" && raw.length > 200)) return null;
  const share = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  if (f.type === "tap") return share(f.x) && share(f.y) ? { type: "tap", x: f.x, y: f.y } : null;
  if (f.type === "swipe") {
    const { x1, y1, x2, y2, ms } = f;
    if (!share(x1) || !share(y1) || !share(x2) || !share(y2) || !inRange(ms, PHONE_VIEW.swipeMs)) return null;
    return { type: "swipe", x1, y1, x2, y2, ms };
  }
  if (f.type === "text") {
    return isString(f.text) && f.text !== "" && f.text.length <= PHONE_VIEW.text
      ? { type: "text", text: f.text }
      : null;
  }
  if (f.type === "key") return PHONE_KEYS.includes(f.key as PhoneKey) ? { type: "key", key: f.key as PhoneKey } : null;
  if (f.type === "resize") {
    return isTerminalSize(f.cols, f.rows) ? { type: "resize", cols: f.cols as number, rows: f.rows as number } : null;
  }
  if (f.type === "exit" && (f.code === null || Number.isInteger(f.code))) {
    return { type: "exit", code: f.code as number | null };
  }
  if (f.type === "mode" && (f.mode === "watch" || f.mode === "control")) return { type: "mode", mode: f.mode };
  if (f.type === "ack") return { type: "ack" };
  return null;
}

/** A live view frame's header as bytes carry it: what `browser.frame` says besides the picture. */
export interface BrowserFrameHeader {
  seq: number;
  metadata: BrowserFrameMetadata;
}

const BROWSER_FRAME_VERSION = 1;
/** A frame's header is a few hundred bytes (an address and a title at most). */
const BROWSER_FRAME_HEADER_MAX = 16 * 1024;

/**
 * A live view frame as bytes (protocol 49, ADR 0040 §7.1): a version byte (1), the header's length (4 bytes, big
 * endian), the header as UTF-8 JSON, then the JPEG. The runner sends it on its view's data socket and the server
 * passes the same bytes on to each person's frame socket; the apps read it with their own copy of this layout
 * (`packages/client/src/browser/frame-bytes.ts`).
 */
export function encodeBrowserFrame(header: BrowserFrameHeader, jpeg: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify({ seq: header.seq, metadata: header.metadata }));
  const out = new Uint8Array(5 + head.byteLength + jpeg.byteLength);
  out[0] = BROWSER_FRAME_VERSION;
  new DataView(out.buffer).setUint32(1, head.byteLength);
  out.set(head, 5);
  out.set(jpeg, 5 + head.byteLength);
  return out;
}

/** A frame's bytes (`encodeBrowserFrame`), checked like a `browser.frame`; null when they aren't one. */
export function decodeBrowserFrame(bytes: Uint8Array): (BrowserFrameHeader & { jpeg: Uint8Array }) | null {
  if (bytes.byteLength < 6 || bytes[0] !== BROWSER_FRAME_VERSION) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  if (length > BROWSER_FRAME_HEADER_MAX || 5 + length >= bytes.byteLength) return null;
  const jpeg = bytes.subarray(5 + length);
  // The same picture as a `browser.frame` may carry (its limit counts base64, a third larger).
  if (jpeg.byteLength > (BROWSER_LIMITS.frameBytes / 4) * 3) return null;
  let f: unknown;
  try {
    f = JSON.parse(new TextDecoder().decode(bytes.subarray(5, 5 + length)));
  } catch {
    return null;
  }
  if (!isObject(f)) return null;
  const seq = finite(f.seq);
  const m = isObject(f.metadata) ? f.metadata : null;
  const width = finite(m?.deviceWidth);
  const height = finite(m?.deviceHeight);
  if (seq === undefined || !m || width === undefined || height === undefined) return null;
  const scale = finite(m.pageScaleFactor);
  const capturedAt = finite(m.capturedAt);
  const url = cut(m.url, BROWSER_LIMITS.url);
  const title = cut(m.title, BROWSER_LIMITS.title);
  return {
    seq,
    metadata: {
      deviceWidth: width,
      deviceHeight: height,
      ...(scale !== undefined ? { pageScaleFactor: scale } : {}),
      ...(capturedAt !== undefined ? { capturedAt } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(title ? { title } : {}),
      ...(isBrowserDevice(m.emulated) ? { emulated: m.emulated } : {}),
    },
    jpeg,
  };
}

const BROWSER_MODIFIERS_MAX = 15;
const coord = (v: unknown) => {
  const n = finite(v);
  return n !== undefined && Math.abs(n) <= 100_000 ? n : undefined;
};

/** One `browser.input` event, checked and cut; null when it isn't one (runner side). */
export function parseBrowserInputEvent(v: unknown): BrowserInputEvent | null {
  if (!isObject(v)) return null;
  const m = finite(v.modifiers);
  const modifiers =
    m !== undefined && Number.isInteger(m) && m >= 0 && m <= BROWSER_MODIFIERS_MAX ? { modifiers: m } : {};
  switch (v.kind) {
    case "mouse": {
      const type = (["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"] as const).find((t) => t === v.type);
      const x = coord(v.x);
      const y = coord(v.y);
      if (!type || x === undefined || y === undefined) return null;
      const button = (["left", "right", "middle", "none"] as const).find((b) => b === v.button);
      const clickCount = finite(v.clickCount);
      const deltaX = coord(v.deltaX);
      const deltaY = coord(v.deltaY);
      const at = finite(v.at);
      return {
        kind: "mouse",
        type,
        x,
        y,
        ...(button ? { button } : {}),
        ...(clickCount !== undefined ? { clickCount: Math.max(0, Math.min(3, Math.round(clickCount))) } : {}),
        ...(deltaX !== undefined ? { deltaX } : {}),
        ...(deltaY !== undefined ? { deltaY } : {}),
        ...modifiers,
        ...(at !== undefined && at >= 0 ? { at } : {}),
      };
    }
    case "key": {
      const type = (["keyDown", "keyUp", "char"] as const).find((t) => t === v.type);
      if (!type || !isString(v.key) || !v.key || v.key.length > 32) return null;
      const code = cut(v.code, 32);
      const text = cut(v.text, 8);
      return {
        kind: "key",
        type,
        key: v.key,
        ...(code !== undefined ? { code } : {}),
        ...(text !== undefined ? { text } : {}),
        ...modifiers,
      };
    }
    case "touch": {
      const type = (["touchStart", "touchMove", "touchEnd", "touchCancel"] as const).find((t) => t === v.type);
      if (!type || !Array.isArray(v.touchPoints)) return null;
      const touchPoints: { x: number; y: number }[] = [];
      for (const p of v.touchPoints.slice(0, 10)) {
        const x = isObject(p) ? coord(p.x) : undefined;
        const y = isObject(p) ? coord(p.y) : undefined;
        if (x === undefined || y === undefined) return null;
        touchPoints.push({ x, y });
      }
      return { kind: "touch", type, touchPoints, ...modifiers };
    }
    case "text":
      return isString(v.text) && v.text.length <= BROWSER_LIMITS.inputText ? { kind: "text", text: v.text } : null;
    default:
      return null;
  }
}

/** What a worker answers about a turn its root hosts: where it runs, as the agent's own user resolved it. */
export interface TurnContext {
  /** The agent's folder. */
  folder: string;
  cwd: string;
  /** The folder's CLAUDE.md and AGENTS.md, and its git state: root reads nothing of the agent's. */
  text?: string;
}

const TURN_TEXT_MAX = 64_000;
const absolutePath = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("/") && v.length <= 4096 && !v.includes("\0");

/** A worker's `turn.context`. It runs as the uid the agent's code runs as: only what fits goes on. */
export function parseTurnContext(f: Record<string, unknown>): TurnContext | null {
  if (!absolutePath(f.folder) || !absolutePath(f.cwd)) return null;
  return {
    folder: f.folder,
    cwd: f.cwd,
    ...(typeof f.text === "string" ? { text: f.text.slice(0, TURN_TEXT_MAX) } : {}),
  };
}

/** A delegated session's background shell started or ended (`tool.notice`), for the CLI on that session. */
export interface ToolNotice {
  session: string;
  shellId: string;
  status: "running" | "completed" | "failed" | "killed";
  exitCode?: number;
  /** The call's description, or its command. */
  summary: string;
  outputFile: string;
  /** Running since a call was moved to the background: its turn waits for it, as for Claude Code's own. */
  moved?: true;
}

/** A worker's `tool.notice`, clipped. Its text reaches the model as the session's own tool did. */
export function parseToolNotice(f: Record<string, unknown>): ToolNotice | null {
  const { session, shellId, status, exitCode, summary, outputFile, moved } = f;
  if (typeof session !== "string" || !session || session.length > 64) return null;
  if (typeof shellId !== "string" || !/^[\w-]{1,64}$/.test(shellId)) return null;
  if (status !== "running" && status !== "completed" && status !== "failed" && status !== "killed") return null;
  if (typeof summary !== "string" || !absolutePath(outputFile)) return null;
  return {
    session,
    shellId,
    status,
    ...(Number.isInteger(exitCode) ? { exitCode: exitCode as number } : {}),
    summary: summary.slice(0, 200),
    outputFile,
    ...(moved === true ? { moved } : {}),
  };
}
