import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { lchown, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type DesktopMode,
  type MachineReplies,
  type MachineRequest,
  PHONE_VIEW,
  type PhoneHolder,
  type PhoneKey,
  type PhoneReason,
  type PhoneTarget,
  type RunnerPhone,
  STREAM_CLOSE,
  STREAM_LIMITS,
  type StreamControl,
} from "@agenteschat/adapters/machine-protocol";
import {
  ANDROID_APP,
  adbStateOf,
  androidKind,
  androidTransport,
  driverlessPhones,
  FACTS_SHELL,
  findAdb,
  KEYGUARD_SHELL,
  keyguardShowing,
  PNP_SHELL,
  parseAdbDevices,
  parseAndroidFacts,
  pngFrom,
  pngSize,
  runningAdbServer,
  WAKE_SHELL,
} from "./adb";
import {
  APPLE_APP,
  appleNeedsYou,
  IOS_MIN,
  needsUsbList,
  parseDevicectl,
  parseLockState,
  parseSimctl,
  sdkTooOld,
} from "./apple-devices";
import { jpegSize } from "./browser";
import { RunnerError } from "./errors";
import { killTree } from "./exec";
import { isExecutable } from "./executors";
import { parseIosFlow, runIosFlow } from "./ios-flow";
import { readJson, writeJson } from "./json-file";
import { acquireLock, pidAlive, readLock } from "./lock";
import { usualDirs } from "./login-path";
import { isInside } from "./paths";
import type { DataSocket } from "./streams";
import { USBMUXD_SOCKET, usbmuxPlugged } from "./usbmux";
import { IosHelper, recoveringScreen, wdaScreenDriver } from "./wda";
import { type PairRequest, parseMdnsServices, serialOfMdnsName, WifiPairer, wifiOutdated } from "./wifi-pair";

/**
 * The phones this computer reaches (bring your own devices): Android over the adb server already running (USB,
 * Wi-Fi paired here or in Android Studio, emulators), iPhones and booted simulators on a Mac. A phone over Wi-Fi goes
 * by its own serial (`ro.serialno`, as over a cable): adb's serial for it changes with the port. One paired here over
 * Wi-Fi is connected again when it shows up on the network. It looks every `POLL_MS`,
 * reports the whole list when anything changed (`phones.changed`), keeps each phone's lock in memory (one holder
 * at a time, renewed by each call, let go on `phone.release`, after `IDLE_MS` without a call, or when the phone
 * goes), and runs the `phone.*` ops. A lock file in the OS user's runner home keeps a second runner of the same
 * user (another workspace) off a phone this one drives.
 */

export const POLL_MS = 3_000;
/** iPhones and simulators are looked at every this many polls (`devicectl` costs about a second). */
export const APPLE_EVERY = 2;
/** Apple looks in a row devicectl may fail (a busy Mac) before the iPhones it last listed are taken as gone. */
export const APPLE_MISSES_KEPT = 2;
export const IDLE_MS = 5 * 60_000;
/** A phone's facts (model, screen, battery) are read again after this long. */
export const FACTS_TTL_MS = 5 * 60_000;
const TOOLS_TTL_MS = 30_000;
/** How long a phone guide's `phone.look` keeps a Windows computer looking for phones it has no driver for. */
export const LOOK_MS = 60_000;
/** How often it looks meanwhile (PowerShell's PnP list takes a second or two). */
export const DRIVERLESS_EVERY_MS = 9_000;
/** How often a known Wi-Fi phone that isn't connected is looked for on the network. */
export const RECONNECT_MS = 15_000;
/** The longest screen recording, whatever records it: about 45 MB at 2 Mbps, under the 50 MB file limit. */
export const RECORD_MAX_SECONDS = 170;
export const IPHONE_LOG_MS = 5000;
const FLOW_MAX_BYTES = 256 * 1024;
const LOG_MAX_CHARS = 200_000;

// ── Running the tools ─────────────────────────────────────────────────────────

export interface ToolResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

export interface ToolOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const MAX_STDOUT = 64 * 1024 * 1024;
const winQuote = (a: string) => `"${a.replace(/"/g, '""')}"`;

/** Starts `bin` with `args` (no shell; a Windows `.cmd`/`.bat` through cmd.exe, quoted); never throws. */
export function startTool(
  bin: string,
  args: string[],
  opts: ToolOptions = {},
): { child: ChildProcess | null; done: Promise<ToolResult> } {
  const viaCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  let child: ChildProcess;
  try {
    child = spawn(
      viaCmd ? process.env.ComSpec || "cmd.exe" : bin,
      viaCmd ? ["/d", "/s", "/c", `"${[bin, ...args].map(winQuote).join(" ")}"`] : args,
      {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: viaCmd,
        // Its own process group, so a timeout takes what it started too (Maestro's Java).
        detached: process.platform !== "win32",
      },
    );
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    return { child: null, done: Promise.resolve({ stdout: Buffer.alloc(0), stderr, code: null, timedOut: false }) };
  }
  const done = new Promise<ToolResult>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let timedOut = false;
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout: Buffer.concat(chunks), stderr, code, timedOut });
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child, "SIGKILL");
        }, opts.timeoutMs)
      : null;
    const onAbort = () => killTree(child, "SIGKILL");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size <= MAX_STDOUT) chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    const events = child as unknown as EventEmitter;
    events.on("error", (err: Error) => {
      stderr += err.message;
      finish(null);
    });
    events.on("close", (code: number | null) => finish(code));
  });
  return { child, done };
}

export const runTool = (bin: string, args: string[], opts?: ToolOptions) => startTool(bin, args, opts).done;

/** `name` on `dirs` (with Windows' extensions), or null. */
export function which(name: string, dirs: readonly string[], platform: NodeJS.Platform = process.platform) {
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (existsSync(file) && (platform === "win32" || isExecutable(file))) return file;
    }
  }
  return null;
}

/** Where tools are looked for after the PATH: the usual install folders (a service's PATH is bare) and Maestro's. */
export const extraToolDirs = (home: string) => [...usualDirs(home), path.join(home, ".maestro", "bin")];

// ── Words ─────────────────────────────────────────────────────────────────────

/** No driver for the phone: Windows wants its maker's USB driver, Linux udev rules. */
export const noDriverWords = (platform: NodeJS.Platform) =>
  platform === "win32"
    ? "Windows has no USB driver for the phone. Install its maker's (Google's for a Pixel, Samsung's for a Galaxy), then plug it in again."
    : "This computer can't open the phone. Add udev rules for it (developer.android.com/studio/run/device), then plug it in again.";

export const REASON_WORDS: Partial<Record<PhoneReason, string>> = {
  unauthorized: "Tap Allow on the phone (check Always allow from this computer first).",
  adb_offline: "The phone shows as offline. Unplug it and plug it back in.",
  no_driver: noDriverWords(process.platform),
  untrusted: "Tap Trust on the iPhone and enter its passcode.",
  developer_mode_off:
    "Turn on Developer Mode: Settings › Privacy & Security › Developer Mode, then restart the iPhone.",
  locked: "Unlock it and try again.",
  booting: "It's still starting.",
  os_too_old: "Its Android version is too old for these tools.",
  helper_missing: "Its test helper is still being set up on this Mac (a few minutes the first time).",
  helper_expired: "Its test helper is being renewed on this Mac.",
  team_limit:
    "The free Apple Account has reached its limit of apps on this iPhone. Remove an app you built yourself from it, then try again.",
  apple_account_missing:
    "Xcode on this Mac isn't signed in to an Apple Account: Xcode › Settings › Apple Accounts, then add one (a free one is enough).",
  apple_team_missing:
    "Xcode is signed in but shows no team yet. In Xcode, make any iOS app, pick your team under Signing & Capabilities and run it on the iPhone once.",
  ui_not_authorized:
    "The iPhone refused the test helper's taps. Unlock it and enter its passcode if it asks. If it keeps happening, turn Settings › Developer › Enable UI Automation off and on.",
  helper_untrusted:
    "The iPhone doesn't trust the test helper yet: on the iPhone, Settings › General › VPN & Device Management, tap the developer, then Trust.",
  ui_automation_off: "Turn on UI Automation on the iPhone: Settings › Developer › Enable UI Automation.",
  xcode_too_old:
    "This iPhone's iOS is newer than Xcode on this Mac. Install the Xcode matching the iPhone's iOS (27 for iOS 27), then run `xcrun devicectl manage ddis update`.",
  device_support: "Xcode is still preparing the iPhone. Try again in a few minutes.",
};

/** Helper failures an Xcode older than the iPhone's iOS explains (its device support or test daemon too old). */
const OLD_XCODE_SIGNS = new Set<PhoneReason>(["device_support", "ui_not_authorized"]);

/** Reasons only the test helper has: an iPhone still installs, opens apps and reads its log meanwhile. */
const HELPER_REASONS = new Set<PhoneReason>([
  "helper_missing",
  "helper_expired",
  "apple_account_missing",
  "team_limit",
  "helper_untrusted",
  "ui_automation_off",
  "apple_team_missing",
  "ui_not_authorized",
  // devicectl installs and opens apps on an iOS newer than the Mac's SDK: only the helper needs the matching Xcode.
  "xcode_too_old",
]);
const NEEDS_HELPER = new Set(["phone.screenshot", "phone.record", "phone.flow"]);

export const TOOL_HELP = {
  adb: "Install Android platform-tools (or Android Studio), then try again.",
  maestro: "Install Maestro: curl -fsSL https://get.maestro.mobile.dev | bash",
  java: "Maestro needs Java 17 or newer. Install a JDK (on a Mac: brew install openjdk@17).",
  bundletool: "Installing an .aab needs bundletool (brew install bundletool). An .apk installs without it.",
  syslog: "Reading a real iPhone's log needs libimobiledevice: brew install libimobiledevice",
  helper: (what: string) => `${what} a real iPhone needs the test helper, which isn't set up on this Mac yet.`,
} as const;

export const labelOf = (p: Pick<Phone, "name" | "model">) => p.name ?? p.model;

/** Why a phone can't be used now, as the phone ops and `doctor` word it; null when it's ready. */
export function phoneNotReady(p: Phone): { title: string; fix: string } | null {
  if (p.state === "ready") return null;
  const fix =
    p.platform === "ios" && p.reason === "os_too_old"
      ? `It runs iOS ${p.osVersion || "16 or older"}, and agents need iOS ${IOS_MIN} or newer.`
      : ((p.reason && REASON_WORDS[p.reason]) ?? "Try again in a moment.");
  return { title: `${labelOf(p)} ${p.state === "unsupported" ? "can't be used" : "isn't ready"}`, fix };
}

// ── The manager ───────────────────────────────────────────────────────────────

type Phone = Omit<RunnerPhone, "holder">;
type PhoneOp = "phone.claim" | "phone.release" | "phone.install" | "phone.launch" | "phone.flow" | "phone.record";
export type PhoneRequest = Extract<MachineRequest, { op: PhoneOp | "phone.screenshot" | "phone.logs" }>;

/** Where a phone op's files go and come from. */
export interface PhoneIo {
  /** The request's agent's folder (real path); null when the request has no agent. */
  folder: string | null;
  /** A path the agent may read, absolute; throws when it can't. */
  resolve(input: string): Promise<string>;
  signal: AbortSignal;
}

interface Hold {
  holder: PhoneHolder;
  lastUsed: number;
  /** Ops running for it now: it isn't idle while one runs (a 10-minute flow). */
  busy: number;
  releaseFile: () => void;
  /** Puts back what the session changed on the phone (stay awake). */
  restore: (() => Promise<unknown>) | null;
  /** Stops what runs for this holder: an agent's ops when a person takes control, a person's view when they lose it. */
  abort: AbortController;
  /** A person in control of the screen (`view`): `busy` counts their views, `paused` is the agent's hold they took. */
  controls?: true;
  paused?: Hold | null;
}

interface Tools {
  adb: string | null;
  xcrun: string | null;
  scrcpy: string | null;
  maestro: string | null;
  bundletool: string | null;
  syslog: string | null;
  plutil: string | null;
  ffmpeg: string | null;
  /** The Mac's iPhone SDK ("26.2"): the newest iOS its Xcode drives. */
  sdk: string | null;
}

export interface PhoneManagerOptions {
  log: (line: string) => void;
  /** The list changed: a phone came or went, a state or a holder changed. */
  onChange: (phones: RunnerPhone[]) => void;
  /** Shared by every runner of this OS user (default `~/.agentes-runner/phone-locks`). */
  lockDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** The OS user's home (the Android SDK's default folder, the usual tool folders). */
  home?: string;
  /** Tool folders after the PATH (default `extraToolDirs`). */
  dirs?: string[];
  /** The running adb server's binary (default: asked on port 5037). */
  adbServer?: () => Promise<string | null>;
  now?: () => number;
  idleMs?: number;
  /** How long a screen takes to wake or a recorder to start, before going on. */
  settleMs?: number;
  /** macOS: keep the computer awake while a phone is attached (default on a Mac). */
  caffeinate?: boolean;
  /** How long a real iPhone's live log is read for (`IPHONE_LOG_MS`). */
  liveLogMs?: number;
  /** Only looks: changes no setting on a phone (`doctor`). */
  readOnly?: boolean;
  /** How long a phone's screen may take to open (the server's wait, `STREAM_LIMITS.openTimeoutMs`). */
  openMs?: number;
  /** The iPhone test helper (default: one of this OS user's, on a Mac). */
  ios?: IosHelper | null;
  /** What shows and controls an iPhone's screen (default: the test helper's, `ios`). */
  iosScreen?: IosScreenDriverFactory | null;
  /** How often a Wi-Fi pairing looks at the network (`PAIR_POLL_MS`). */
  pairPollMs?: number;
  /** usbmuxd's socket (`USBMUXD_SOCKET`): which iPhones too old for devicectl are plugged in. */
  usbmuxSocket?: string;
  /** Windows: `PNP_SHELL`'s output (default: PowerShell runs it); null when it couldn't. */
  pnp?: () => Promise<string | null>;
}

const keyOf = (p: { platform: string; serial: string }) => `${p.platform}:${p.serial}`;
const lockFileOf = (key: string) => `${key.replace(/[^\w.-]/g, "_")}.lock`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, v));
};
const tail = (text: string, max: number) => (text.length > max ? `[…]\n${text.slice(-max)}` : text);
const firstLine = (text: string) =>
  (text.split("\n").find((l) => /error|fail/i.test(l)) ?? text.trim().split("\n")[0] ?? "").trim().slice(0, 300);

/** `adb -s serial args…`, its stdout; a failure in words (`what` failed), the phone gone as `phone_missing`. */
async function adbRun(
  adb: string,
  serial: string,
  args: string[],
  what: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<Buffer> {
  const r = await runTool(adb, ["-s", serial, ...args], { ...opts, timeoutMs: opts.timeoutMs ?? 30_000 });
  if (r.code === 0 && !r.timedOut) return r.stdout;
  const said = `${r.stderr}\n${r.stdout.toString("utf8")}`;
  if (/device '.*' not found|no devices\/emulators found|device not found/i.test(said)) {
    throw new RunnerError("phone_missing", "The phone went away (unplugged, or adb restarted).");
  }
  if (/device offline|unauthorized/i.test(said)) {
    throw new RunnerError("phone_not_ready", "The phone stopped answering. Unplug it and plug it back in.");
  }
  if (r.timedOut) throw new RunnerError("internal", `${what} didn't answer in time.`);
  throw new RunnerError("internal", `${what} failed: ${firstLine(said)}`);
}

const sameHolder = (a: PhoneHolder, b: PhoneHolder) =>
  a.runId !== null || b.runId !== null ? a.runId === b.runId : a.agentId === b.agentId && a.userId === b.userId;

function holderOf(v: unknown, now: number): PhoneHolder {
  const h = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const id = (x: unknown) => (typeof x === "string" && x !== "" && x.length <= 200 ? x : null);
  const label = typeof h.label === "string" && h.label.trim() ? h.label.trim().slice(0, 200) : undefined;
  return {
    runId: id(h.runId),
    agentId: id(h.agentId),
    userId: id(h.userId),
    ...(label ? { label } : {}),
    since: new Date(now).toISOString(),
  };
}

/** `20261109-041205123`: a file name that sorts by time. */
const stamp = (now: number) =>
  new Date(now)
    .toISOString()
    .replace(/[-:.Z]/g, "")
    .replace("T", "-");

interface Recorder {
  /** Resolves when it stopped by itself (its time limit) and the file is final. */
  done: Promise<void>;
  /** Stops it now; resolves when the file is final. */
  stop(): Promise<void>;
}

/**
 * Under root (a system-mode runner), the phone files an op wrote go to the agent's OS user, who owns its folder, so
 * the agent can read and clear them.
 * ponytail: re-owns the whole `.agentes/phone` folder after each op; track the op's own files if it grows large.
 */
async function giveBack(folder: string | null) {
  if (!folder || process.getuid?.() !== 0) return;
  const owner = await stat(folder).catch(() => null);
  if (!owner || owner.uid === 0) return;
  const dir = path.join(folder, ".agentes", "phone");
  const names = await readdir(dir).catch(() => [] as string[]);
  const paths = [dir, ...names.map((n) => path.join(dir, n))];
  await Promise.all(paths.map((p) => lchown(p, owner.uid, owner.gid).catch(() => undefined)));
}

export class PhoneManager {
  private seen = new Map<string, Phone>();
  private readonly holds = new Map<string, Hold>();
  private readonly facts = new Map<string, { at: number; facts: ReturnType<typeof parseAndroidFacts> }>();
  /** Phones an op found behind a lock screen: polls look again until it's gone. */
  private readonly locked = new Set<string>();
  /** Android phones whose authorization timeout was turned off (this process, once each). */
  private readonly prepared = new Set<string>();
  private controlling: Promise<unknown> = Promise.resolve();
  /** adb's serial for each phone found by its own serial (a Wi-Fi one), by key. */
  private adbNames = new Map<string, string>();
  /** The own serial of Wi-Fi phones adb named (`192.168.1.20:41235`), for when it can't be read (offline). */
  private readonly ownSerial = new Map<string, string>();
  /** Phones paired here over Wi-Fi, by own serial (kept in `wifiFile`). */
  private readonly wifiKnown: Set<string>;
  /** Phones refused at pairing as open to CVE-2026-0073, by own serial, while they stay unpatched. */
  private readonly wifiRefused = new Set<string>();
  private lastReconnect = 0;
  private reconnecting: Promise<void> | null = null;
  private readonly pairer: WifiPairer;
  private appleSeen: Phone[] | null = null;
  private appleMisses = 0;
  /** Until when a phone guide asked to look for phones Windows has no driver for (`phone.look`). */
  private lookUntil = 0;
  private driverless: { at: number; phones: Phone[] } | null = null;
  private tick = 0;
  private polling: Promise<void> | null = null;
  private first: Promise<void> | null = null;
  private cachedTools: { at: number; tools: Tools } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastJson = "[]";
  private awake: ChildProcess | null = null;
  private stopped = false;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly home: string;
  private readonly now: () => number;
  private readonly ios: IosHelper | null;
  private readonly iosScreen: IosScreenDriverFactory | null;
  private readonly openMs: number;

  constructor(private readonly opts: PhoneManagerOptions) {
    this.env = opts.env ?? process.env;
    this.platform = opts.platform ?? process.platform;
    this.home = opts.home ?? os.homedir();
    this.now = opts.now ?? Date.now;
    this.openMs = opts.openMs ?? STREAM_LIMITS.openTimeoutMs;
    this.ios =
      opts.ios !== undefined
        ? opts.ios
        : this.platform === "darwin"
          ? new IosHelper({ home: this.home, env: this.env, log: opts.log, now: this.now, phoneLocks: opts.lockDir })
          : null;
    const ios = this.ios;
    this.iosScreen =
      opts.iosScreen !== undefined
        ? opts.iosScreen
        : ios
          ? (phone, tools) =>
              tools.xcrun && phone.platform === "ios" ? wdaScreenDriver(ios, phone, tools.xcrun) : null
          : null;
    const known = readJson<unknown>(this.wifiFile());
    this.wifiKnown = new Set(Array.isArray(known) ? known.filter((s): s is string => typeof s === "string") : []);
    this.pairer = new WifiPairer({
      adb: async () => (await this.tools()).adb,
      run: runTool,
      connected: async (serial, adbSerial) => {
        this.wifiRefused.delete(serial);
        this.ownSerial.set(adbSerial, serial);
        this.knowWifi(serial);
        // A look already under way may have left it out: one after it.
        await this.polling;
        await this.poll();
      },
      refused: (serial) => this.wifiRefused.add(serial),
      log: opts.log,
      env: this.env,
      now: this.now,
      ...(opts.pairPollMs !== undefined ? { pollMs: opts.pairPollMs } : {}),
    });
  }

  /** `phone.look`: a phone guide waits for a phone. True when this computer looks for driverless ones (Windows). */
  look(): boolean {
    if (this.platform !== "win32") return false;
    this.lookUntil = this.now() + LOOK_MS;
    void this.poll();
    return true;
  }

  /**
   * Phones plugged in that Windows has no USB driver for, as `no_driver`: only while a guide asked, and only when adb
   * lists no phone by cable (one it lists has a driver). Looked at every `DRIVERLESS_EVERY_MS` meanwhile.
   */
  private async scanDriverless(found: readonly Phone[]): Promise<Phone[]> {
    const now = this.now();
    if (this.platform !== "win32" || now >= this.lookUntil) {
      this.driverless = null;
      return [];
    }
    if (found.some((p) => p.platform === "android" && p.transport === "usb")) return [];
    if (!this.driverless || now - this.driverless.at >= DRIVERLESS_EVERY_MS) {
      const out = await (this.opts.pnp ?? (() => this.pnp()))();
      const phones = driverlessPhones(out ?? "").map(
        (d): Phone => ({
          platform: "android",
          serial: d.serial,
          kind: "device",
          model: d.model,
          osVersion: "",
          transport: "usb",
          state: "needs_you",
          reason: "no_driver",
        }),
      );
      this.driverless = { at: now, phones };
    }
    return this.driverless.phones;
  }

  private async pnp() {
    const shell = path.join(
      this.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const r = await runTool(shell, ["-NoProfile", "-NonInteractive", "-Command", PNP_SHELL], {
      timeoutMs: 8_000,
      env: this.env,
    });
    return r.code === 0 && !r.timedOut ? r.stdout.toString("utf8") : null;
  }

  /** `phone.pair.*`: pairing an Android phone over Wi-Fi with this computer's adb. */
  pair(req: PairRequest) {
    return this.pairer.handle(req);
  }

  private wifiFile() {
    const lockDir = this.opts.lockDir ?? path.join(this.home, ".agentes-runner", "phone-locks");
    return path.join(path.dirname(lockDir), "wifi-phones.json");
  }

  private knowWifi(serial: string) {
    if (this.wifiKnown.has(serial)) return;
    this.wifiKnown.add(serial);
    try {
      mkdirSync(path.dirname(this.wifiFile()), { recursive: true });
      writeJson(this.wifiFile(), [...this.wifiKnown]);
    } catch {
      // kept in memory only: an unwritable home
    }
  }

  /** What adb calls this phone now (its own serial over a cable, `host:port` or an mDNS name over Wi-Fi). */
  private at(p: Pick<Phone, "platform" | "serial">) {
    return this.adbNames.get(keyOf(p)) ?? p.serial;
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
    void this.poll();
  }

  async stop() {
    this.stopped = true;
    this.pairer.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.holds.keys()].map((key) => this.drop(key, true)));
    this.ios?.stopAll();
    this.keepAwake(false);
  }

  private get lockDir() {
    return this.opts.lockDir ?? path.join(this.home, ".agentes-runner", "phone-locks");
  }

  /** Since when another process of this OS user (a runner of another workspace, or `start`) holds it; null if none. */
  heldElsewhere(p: { platform: string; serial: string }): string | null {
    const lock = readLock(this.lockDir, lockFileOf(keyOf(p)));
    return lock && lock.pid !== process.pid && pidAlive(lock.pid) ? lock.startedAt || null : null;
  }

  /** What `hello` and `phones.changed` say. */
  list(): RunnerPhone[] {
    return [...this.seen.values()]
      .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1))
      .map((p) => {
        const hold = this.holds.get(keyOf(p));
        return hold ? { ...p, holder: hold.holder } : p;
      });
  }

  /** One look at the phones (concurrent calls share it). */
  poll(): Promise<void> {
    this.polling ??= this.scan()
      .catch((err: unknown) => this.opts.log(`phones: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.polling = null;
      });
    return this.polling;
  }

  private async scan() {
    const tools = await this.tools();
    const found: Phone[] = [];
    const reach = new Map<string, string>();
    if (tools.adb) found.push(...(await this.scanAndroid(tools.adb, reach)));
    found.push(...(await this.scanDriverless(found)));
    if (tools.xcrun) {
      if (this.appleSeen === null || this.tick % APPLE_EVERY === 0) this.appleSeen = await this.scanApple(tools);
      found.push(...this.appleSeen);
    } else this.appleSeen = null;
    this.tick++;
    if (this.stopped) return;
    this.seen = new Map(found.map((p) => [keyOf(p), p]));
    this.adbNames = reach;
    const now = this.now();
    if (tools.adb) this.reconnect(tools.adb, now);
    for (const [key, hold] of [...this.holds]) {
      // An op under way finds out by itself when its phone went: one missed look doesn't end it.
      if (!this.seen.has(key) && hold.busy === 0) await this.drop(key, false);
      else if (hold.busy === 0 && now - hold.lastUsed >= (this.opts.idleMs ?? IDLE_MS)) await this.drop(key, true);
    }
    this.ios?.reap(new Set([...this.holds.keys()].filter((k) => k.startsWith("ios:")).map((k) => k.slice(4))));
    this.changed();
  }

  private async tools(): Promise<Tools> {
    const cached = this.cachedTools;
    if (cached && this.now() - cached.at < TOOLS_TTL_MS) return cached.tools;
    const dirs = [...(this.env.PATH ?? "").split(path.delimiter), ...(this.opts.dirs ?? extraToolDirs(this.home))];
    const find = (name: string) => which(name, dirs, this.platform);
    const running = await (this.opts.adbServer ?? (() => runningAdbServer()))();
    const adb = running && existsSync(running) ? running : findAdb(this.env, this.platform, this.home, dirs);
    let xcrun = this.platform === "darwin" ? find("xcrun") : null;
    // Without the developer tools, macOS answers xcrun with a dialog offering to install them: asked first.
    const select = xcrun ? find("xcode-select") : null;
    if (xcrun && (!select || (await runTool(select, ["-p"], { timeoutMs: 5000, env: this.env })).code !== 0)) {
      xcrun = null;
    }
    const sdk = xcrun
      ? await runTool(xcrun, ["--sdk", "iphoneos", "--show-sdk-version"], { timeoutMs: 10_000, env: this.env })
      : null;
    const sdkVersion = sdk?.code === 0 ? sdk.stdout.toString("utf8").trim() : "";
    const tools: Tools = {
      adb,
      xcrun,
      sdk: /^\d+(\.\d+)*$/.test(sdkVersion) ? sdkVersion : null,
      scrcpy: find("scrcpy"),
      maestro: find("maestro"),
      bundletool: find("bundletool"),
      syslog: find("idevicesyslog"),
      plutil: this.platform === "darwin" ? find("plutil") : null,
      ffmpeg: this.platform === "darwin" ? find("ffmpeg") : null,
    };
    this.cachedTools = { at: this.now(), tools };
    return tools;
  }

  private async scanAndroid(adb: string, reach: Map<string, string>): Promise<Phone[]> {
    const r = await runTool(adb, ["devices", "-l"], { timeoutMs: 10_000, env: this.env });
    if (r.code !== 0) return [];
    const out = new Map<string, Phone>();
    /** One phone over a cable and Wi-Fi at once, or a stale Wi-Fi entry beside a new one: the ready one, a cable first. */
    const keep = (phone: Phone, adbSerial: string) => {
      const key = keyOf(phone);
      const rank = (p: Phone) => (p.state === "ready" ? 2 : 0) + (p.transport === "usb" ? 1 : 0);
      const had = out.get(key);
      if (had && rank(had) >= rank(phone)) return;
      out.set(key, phone);
      if (adbSerial !== phone.serial) reach.set(key, adbSerial);
      else reach.delete(key);
    };
    for (const e of parseAdbDevices(r.stdout.toString("utf8"))) {
      if (this.pairer.hides(e.serial)) continue;
      const transport = androidTransport(e.serial);
      const phone: Phone = {
        platform: "android",
        serial: e.serial,
        kind: androidKind(e.serial),
        model: e.model ?? "Android phone",
        osVersion: "",
        transport,
        ...adbStateOf(e.state),
      };
      if (e.state !== "device") {
        this.facts.delete(`android:${e.serial}`);
        if (transport === "wifi") phone.serial = this.ownSerial.get(e.serial) ?? serialOfMdnsName(e.serial) ?? e.serial;
        keep(phone, e.serial);
        continue;
      }
      const facts = await this.androidFacts(adb, e.serial);
      if (facts) {
        Object.assign(phone, {
          model: facts.model,
          osVersion: facts.osVersion,
          kind: facts.emulator ? "emulator" : phone.kind,
          ...(facts.name ? { name: facts.name } : {}),
          ...(facts.abi ? { abi: facts.abi } : {}),
          ...(facts.screen ? { screen: facts.screen } : {}),
          ...(facts.power ? { power: facts.power } : {}),
          ...(facts.battery !== undefined ? { battery: facts.battery } : {}),
        });
        if (!facts.booted) Object.assign(phone, { state: "preparing", reason: "booting" });
        else if (facts.sdk > 0 && facts.sdk < 21) Object.assign(phone, { state: "unsupported", reason: "os_too_old" });
      }
      if (transport === "wifi" && phone.kind === "device") {
        const own = facts?.serialno ?? serialOfMdnsName(e.serial);
        if (own) {
          phone.serial = own;
          this.ownSerial.set(e.serial, own);
        }
        if (own && this.wifiRefused.has(own)) {
          if (facts && wifiOutdated(facts)) {
            void runTool(adb, ["disconnect", e.serial], { timeoutMs: 10_000, env: this.env });
            continue;
          }
          this.wifiRefused.delete(own);
        }
      }
      const key = keyOf(phone);
      if (phone.state === "ready" && this.locked.has(key)) {
        const lock = await this.shell(adb, e.serial, KEYGUARD_SHELL).catch(() => "");
        if (keyguardShowing(lock)) Object.assign(phone, { state: "needs_you", reason: "locked" });
        else this.locked.delete(key);
      }
      if (phone.state === "ready" && phone.kind === "device" && !this.opts.readOnly && !this.prepared.has(key)) {
        this.prepared.add(key);
        // An authorization lapses after 7 days without a connection (Android 11+) unless this is off.
        void this.shell(adb, e.serial, "settings put global adb_allowed_connection_time 0").catch(() => undefined);
      }
      keep(phone, e.serial);
    }
    return [...out.values()];
  }

  /**
   * Connects again, in the background, a phone paired here over Wi-Fi that isn't ready now, once its connect
   * service shows up on the network (Wireless debugging back on, the phone back in range, on a new port). adb does it
   * by itself when its mDNS works; this covers when it doesn't. Never while a pairing runs.
   */
  private reconnect(adb: string, now: number) {
    if (this.reconnecting || this.pairer.busy || now - this.lastReconnect < RECONNECT_MS) return;
    const missing = [...this.wifiKnown].filter((s) => this.seen.get(`android:${s}`)?.state !== "ready");
    if (missing.length === 0) return;
    this.lastReconnect = now;
    this.reconnecting = (async () => {
      const r = await runTool(adb, ["mdns", "services"], { timeoutMs: 10_000, env: this.env });
      for (const s of parseMdnsServices(r.stdout.toString("utf8"))) {
        const own = s.kind === "connect" ? serialOfMdnsName(s.name) : null;
        if (!own || !missing.includes(own)) continue;
        const done = await runTool(adb, ["connect", s.address], { timeoutMs: 15_000, env: this.env });
        this.opts.log(`phones: Wi-Fi ${s.address}: ${done.stdout.toString("utf8").trim().slice(0, 200)}`);
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        this.reconnecting = null;
      });
  }

  private async androidFacts(adb: string, serial: string) {
    const key = `android:${serial}`;
    const cached = this.facts.get(key);
    if (cached?.facts.booted && this.now() - cached.at < FACTS_TTL_MS) return cached.facts;
    try {
      const facts = parseAndroidFacts(await this.shell(adb, serial, FACTS_SHELL));
      this.facts.set(key, { at: this.now(), facts });
      return facts;
    } catch {
      return cached?.facts ?? null;
    }
  }

  private async scanApple(tools: Tools): Promise<Phone[]> {
    const xcrun = tools.xcrun as string;
    const out: Phone[] = [];
    const sims = await runTool(xcrun, ["simctl", "list", "devices", "booted", "-j"], {
      timeoutMs: 15_000,
      env: this.env,
    });
    try {
      if (sims.code === 0) out.push(...parseSimctl(JSON.parse(sims.stdout.toString("utf8"))));
    } catch {
      // not JSON: an Xcode mid-update
    }
    const devices = await this.devicectlJson(xcrun, ["list", "devices"]);
    // devicectl failing or slow for a look or two (a busy Mac) isn't every iPhone unplugged: the last ones stand.
    if (devices === null) {
      if (++this.appleMisses > APPLE_MISSES_KEPT) return out;
      return [...out, ...(this.appleSeen ?? []).filter((p) => p.kind === "device")];
    }
    this.appleMisses = 0;
    const usb = needsUsbList(devices)
      ? new Set((await usbmuxPlugged(this.opts.usbmuxSocket ?? USBMUXD_SOCKET).catch(() => new Map())).keys())
      : undefined;
    for (const phone of parseDevicectl(devices, usb)) {
      const key = keyOf(phone);
      if (phone.state === "ready" && this.locked.has(key)) {
        const lock = parseLockState(
          await this.devicectlJson(xcrun, ["device", "info", "lockState", "--device", phone.serial]),
        );
        if (lock) {
          out.push({ ...phone, state: "needs_you", reason: "locked" });
          continue;
        }
        this.locked.delete(key);
      }
      // Ready to the Mac, the iPhone still waits for its test helper: built, renewed and checked by itself.
      // Read-only (`doctor`) says the helper's state and builds nothing (`need` without xcrun only looks).
      const need =
        phone.state === "ready" && this.ios ? this.ios.need(phone.serial, this.opts.readOnly ? null : xcrun) : null;
      // An iOS newer than this Mac's iPhone SDK often still works (apps open, screenshots), so the version alone
      // turns nothing away: it names the likely cause once the helper itself is stuck.
      // device_support is only "preparing" to the helper, but with an older SDK the person has the way out.
      const oldXcode = !!need && OLD_XCODE_SIGNS.has(need.reason) && sdkTooOld(phone.osVersion, tools.sdk);
      const named = oldXcode ? { state: "needs_you" as const, reason: "xcode_too_old" as const } : {};
      out.push(need ? { ...phone, ...need, ...named } : phone);
    }
    return out;
  }

  /** `xcrun devicectl <args> --quiet --json-output`, read; null when it failed (no devicectl before Xcode 15). */
  private async devicectlJson(xcrun: string, args: string[]): Promise<unknown> {
    const file = path.join(os.tmpdir(), `agentes-devicectl-${process.pid}-${this.tick}-${args[0]}.json`);
    try {
      const r = await runTool(xcrun, ["devicectl", ...args, "--quiet", "--json-output", file], {
        timeoutMs: 20_000,
        env: this.env,
      });
      return r.code === 0 && !r.timedOut ? JSON.parse(await readFile(file, "utf8")) : null;
    } catch {
      return null;
    } finally {
      await rm(file, { force: true });
    }
  }

  /** Sends the list if it changed since the last one sent. */
  private changed() {
    const list = this.list();
    const json = JSON.stringify(list);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.keepAwake(list.length > 0);
    this.opts.onChange(list);
  }

  /** macOS: no system sleep on power while a phone is attached (`caffeinate` ends with this process). */
  private keepAwake(on: boolean) {
    if (!(this.opts.caffeinate ?? this.platform === "darwin")) return;
    if (on && !this.awake && !this.stopped) {
      try {
        const child = spawn("caffeinate", ["-s", "-w", String(process.pid)], { stdio: "ignore" });
        (child as unknown as EventEmitter).on("error", () => {
          if (this.awake === child) this.awake = null;
        });
        this.awake = child;
      } catch {
        this.awake = null;
      }
    } else if (!on && this.awake) {
      this.awake.kill();
      this.awake = null;
    }
  }

  // ── Locks ───────────────────────────────────────────────────────────────────

  private async take(key: string, phone: Phone, holder: PhoneHolder, tools: Tools): Promise<Hold> {
    const held = this.holds.get(key);
    if (held) {
      if (!sameHolder(held.holder, holder)) {
        if (held.controls) throw new RunnerError("phone_busy", `A person is in control of ${labelOf(phone)}.`);
        const what = held.holder.label ? ` (${held.holder.label})` : "";
        throw new RunnerError("phone_busy", `Another agent is using ${labelOf(phone)}${what}.`);
      }
      held.lastUsed = this.now();
      if (holder.label && holder.label !== held.holder.label) {
        held.holder = { ...held.holder, label: holder.label };
        this.changed();
      }
      return held;
    }
    const file = acquireLock(this.lockDir, "phone", { file: lockFileOf(key) });
    if (!file.ok) {
      throw new RunnerError(
        "phone_busy",
        `Another workspace's connection on this computer is using ${labelOf(phone)}.`,
      );
    }
    const hold: Hold = {
      holder,
      lastUsed: this.now(),
      busy: 0,
      releaseFile: file.release,
      restore: null,
      abort: new AbortController(),
    };
    this.holds.set(key, hold);
    if (phone.platform === "android" && tools.adb) hold.restore = await this.stayOn(tools.adb, phone);
    this.changed();
    return hold;
  }

  /**
   * A person takes the phone to control its screen. An agent holding it is set aside until they give it back: what
   * it runs on the phone stops, and its calls answer `phone_busy` meanwhile. Another person in control keeps it; the
   * same person's second view shares their control.
   */
  private takeControl(key: string, phone: Phone, person: PhoneHolder, tools: Tools): Promise<Hold> {
    // One at a time: two views opening at once would each set the other's control aside, one left without a hold.
    const taken = this.controlling.then(() => this.takeControlNow(key, phone, person, tools));
    this.controlling = taken.catch(() => undefined);
    return taken;
  }

  private async takeControlNow(key: string, phone: Phone, person: PhoneHolder, tools: Tools): Promise<Hold> {
    const held = this.holds.get(key);
    if (held?.controls) {
      if (!sameHolder(held.holder, person)) {
        throw new RunnerError("phone_busy", `Someone else is in control of ${labelOf(phone)}.`);
      }
      held.busy++;
      return held;
    }
    const control: Hold = held
      ? { ...held, holder: person, busy: 1, abort: new AbortController(), controls: true, paused: held }
      : { ...(await this.take(key, phone, person, tools)), busy: 1, controls: true, paused: null };
    held?.abort.abort();
    this.holds.set(key, control);
    this.changed();
    return control;
  }

  /** The person's view ended: the last one gives the phone back to the agent it was taken from, or lets it go. */
  private async endControl(key: string, control: Hold) {
    control.busy--;
    if (control.busy > 0 || this.holds.get(key) !== control) return;
    const paused = control.paused;
    if (!paused || !this.seen.has(key)) {
      await this.drop(key, true);
      return;
    }
    paused.lastUsed = this.now();
    paused.abort = new AbortController();
    this.holds.set(key, paused);
    this.changed();
  }

  /** The screen stays on while the session lasts (Developer options › Stay awake), then the person's setting is back. */
  private async stayOn(adb: string, phone: Phone): Promise<(() => Promise<unknown>) | null> {
    try {
      const before = (await this.shell(adb, this.at(phone), "settings get global stay_on_while_plugged_in")).trim();
      await this.shell(adb, this.at(phone), `svc power stayon ${phone.transport === "usb" ? "usb" : "true"}`);
      const value = /^\d+$/.test(before) ? before : "0";
      return () => this.shell(adb, this.at(phone), `settings put global stay_on_while_plugged_in ${value}`);
    } catch {
      return null;
    }
  }

  private async drop(key: string, restore: boolean) {
    const hold = this.holds.get(key);
    if (!hold) return false;
    this.holds.delete(key);
    // A person's control ends with it (Stop, the phone gone): their view closes.
    if (hold.controls) hold.abort.abort();
    hold.releaseFile();
    if (key.startsWith("ios:")) this.ios?.stop(key.slice(4));
    if (restore && hold.restore) await hold.restore().catch(() => undefined);
    this.changed();
    return true;
  }

  // ── Ops ─────────────────────────────────────────────────────────────────────

  async handle(req: PhoneRequest, io: PhoneIo): Promise<unknown> {
    const platform = req.platform === "android" || req.platform === "ios" ? req.platform : null;
    if (!platform || typeof req.serial !== "string" || req.serial === "" || req.serial.length > 200) {
      throw new RunnerError("bad_request", "A phone op names its phone (platform and serial)");
    }
    const key = `${platform}:${req.serial}`;
    const holder = holderOf(req.holder, this.now());
    if (req.op === "phone.release") {
      const hold = this.holds.get(key);
      // A run ending while a person controls its phone: the phone goes free when they give it back.
      if (hold?.paused && req.force !== true && sameHolder(hold.paused.holder, holder)) {
        hold.paused = null;
        return { released: true } satisfies MachineReplies["phone.release"];
      }
      const mine = hold && (req.force === true || sameHolder(hold.holder, holder));
      return { released: mine ? await this.drop(key, true) : false } satisfies MachineReplies["phone.release"];
    }
    const phone = await this.reach(key, { op: req.op });
    const tools = await this.tools();
    const hold = await this.take(key, phone, holder, tools);
    if (req.op === "phone.claim") return { holder: hold.holder } satisfies MachineReplies["phone.claim"];
    hold.busy++;
    const taken = hold.abort.signal;
    const run: PhoneIo = { ...io, signal: AbortSignal.any([io.signal, taken]) };
    // What a person taking control cut short, even what still answered: a recording stopped early isn't the one asked.
    const takenOver = () => taken.aborted && !io.signal.aborted;
    const busy = () => new RunnerError("phone_busy", `A person took control of ${labelOf(phone)}, so this stopped.`);
    try {
      const out =
        platform === "android"
          ? await this.android(req, key, phone, tools, run)
          : await this.apple(req, phone, tools, run);
      if (takenOver()) throw busy();
      return out;
    } catch (err) {
      throw takenOver() ? busy() : err;
    } finally {
      hold.busy--;
      hold.lastUsed = this.now();
      await giveBack(io.folder);
    }
  }

  /**
   * The phone `key` names, seen now and ready; a locked one too when `locked` (its screen shows the lock screen). An
   * iPhone still waiting for its test helper takes the ops that don't need it (`op`).
   */
  private async reach(key: string, opts: { locked?: boolean; op?: string } = {}): Promise<Phone> {
    this.first ??= this.poll();
    await this.first;
    if (!this.seen.has(key)) await this.poll();
    const phone = this.seen.get(key);
    if (!phone) throw new RunnerError("phone_missing", "This phone isn't connected to this computer right now.");
    if (opts.locked && phone.reason === "locked") return phone;
    const helper = phone.reason !== undefined && HELPER_REASONS.has(phone.reason);
    const problem = helper && opts.op !== undefined && !NEEDS_HELPER.has(opts.op) ? null : phoneNotReady(phone);
    if (problem) {
      const broken = helper ? this.ios?.unknownFailure(phone.serial) : null;
      if (broken) throw new RunnerError("internal", `The iPhone test helper couldn't be set up on this Mac: ${broken}`);
      throw new RunnerError(
        phone.state === "unsupported" ? "unsupported" : "phone_not_ready",
        `${problem.title}. ${problem.fix}`,
      );
    }
    return phone;
  }

  /**
   * A phone's screen live, for one viewer on the data socket `dial` opens (`stream.open` with `kind: "phone"`):
   * pictures as binary frames, at most `PHONE_VIEW.window` the viewer hasn't acknowledged, an unchanged one not sent
   * again. In control (`takeControl`) its taps, swipes, text and keys go to the phone. Answers once the socket is
   * ready, with the first picture already taken (a phone that can't show refuses the stream instead).
   */
  async view(target: PhoneTarget | undefined, mode: DesktopMode, dial: () => Promise<DataSocket>): Promise<void> {
    const platform = target?.platform === "android" || target?.platform === "ios" ? target.platform : null;
    const serial = target?.serial;
    if (!platform || typeof serial !== "string" || serial === "" || serial.length > 200) {
      throw new RunnerError("bad_request", "A phone's screen names its phone (platform and serial)");
    }
    if (mode !== "watch" && mode !== "control") throw new RunnerError("bad_request", "watch or control");
    const key = `${platform}:${serial}`;
    const phone = await this.reach(key, { locked: true });
    const tools = await this.tools();
    // adb reaches a phone over Wi-Fi at its address, not its own serial.
    const driver = screenDriverFor(
      { ...phone, serial: this.at(phone) },
      { adb: tools.adb, xcrun: tools.xcrun, env: this.env },
      mode,
      this.iosScreen,
    );
    if (mode === "control" && driver instanceof SimulatorScreen) throw new RunnerError("unsupported", NO_IOS_CONTROL);
    const stop = new AbortController();
    const control =
      mode === "control" ? await this.takeControl(key, phone, holderOf(target?.holder, this.now()), tools) : null;
    let frame: ScreenFrame;
    let socket: DataSocket;
    // Past the server's wait for the data socket the stream is gone there (an iPhone's first test helper build takes
    // longer): the phone goes back, and the build goes on for the next try.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stop.abort();
        reject(new RunnerError("phone_not_ready", OPENING_LATE));
      }, this.openMs);
    });
    late.catch(() => {});
    try {
      // Someone taking control means to use it: a dark screen lights up (and a lock screen without a PIN lifts).
      if (control && platform === "android" && tools.adb) {
        await this.shell(tools.adb, this.at(phone), WAKE_SHELL, 10_000).catch(() => "");
      }
      frame = await Promise.race([driver.frame(stop.signal), late]);
      socket = await Promise.race([dial(), late]);
    } catch (err) {
      stop.abort();
      if (control) await this.endControl(key, control);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let unacked = 0;
    let last: Buffer | null = null;
    // Big pictures go one at a time: two could pass what the server queues for a slow viewer (`viewerBufferedMax`).
    const full = () => unacked >= (last && last.byteLength > BIG_PICTURE ? 1 : PHONE_VIEW.window);
    let closed = false;
    let wake: (() => void) | null = null;
    const nudge = () => {
      const w = wake;
      wake = null;
      w?.();
    };
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    const end = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      stop.abort();
      nudge();
      socket.close(code, reason);
    };
    control?.abort.signal.addEventListener("abort", () => end(STREAM_CLOSE.controlEnded, "control ended"), {
      once: true,
    });
    const inputs: PhoneInput[] = [];
    let typing = false;
    const drain = async () => {
      if (typing) return;
      typing = true;
      try {
        for (let f = inputs.shift(); f && !closed; f = inputs.shift()) {
          // Typed while the last text went in: one call for all of it.
          while (f.type === "text" && inputs[0]?.type === "text") {
            f = { type: "text", text: f.text + (inputs.shift() as { text: string }).text };
          }
          await applyInput(driver, f, frame);
          nudge();
        }
      } catch (err) {
        inputs.length = 0;
        this.opts.log(`phone screen: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        typing = false;
      }
    };
    socket.listen({
      bytes: () => undefined,
      control: (f) => {
        if (f.type === "ack") {
          // Only a full window waits on it: the pictures' own pace stays.
          const waiting = full();
          unacked = Math.max(0, unacked - 1);
          if (waiting) nudge();
        } else if (control && (f.type === "tap" || f.type === "swipe" || f.type === "text" || f.type === "key")) {
          inputs.push(f);
          void drain();
        }
      },
      closed: () => {
        closed = true;
        stop.abort();
        nudge();
        if (control) void this.endControl(key, control);
      },
    });
    // Stopped (or the phone gone) while the screen opened.
    if (control?.abort.signal.aborted) return end(STREAM_CLOSE.controlEnded, "control ended");
    void (async () => {
      let failures = 0;
      let took = this.now();
      for (;;) {
        const bytes = Buffer.from(frame.jpeg ?? frame.png ?? new Uint8Array());
        const changed = last === null || !bytes.equals(last);
        if (changed && bytes.byteLength > 0) {
          socket.send(bytes);
          unacked++;
          last = bytes;
        }
        // An unchanged screen is looked at less often; the person's input looks again at once.
        await pause(Math.max(0, (changed ? PHONE_VIEW.frameMs : PHONE_VIEW.idleMs) - (this.now() - took)));
        while (!closed && full()) await pause(PHONE_VIEW.idleMs);
        if (closed) return;
        took = this.now();
        try {
          frame = await driver.frame(stop.signal);
          failures = 0;
        } catch (err) {
          if (closed) return;
          if (++failures >= 3) {
            const gone = err instanceof RunnerError && err.code === "phone_missing";
            return end(gone ? STREAM_CLOSE.notFound : STREAM_CLOSE.internal, gone ? "phone_missing" : "no picture");
          }
          await pause(PHONE_VIEW.idleMs);
        }
      }
    })();
  }

  private shell(adb: string, serial: string, command: string, timeoutMs = 30_000, signal?: AbortSignal) {
    return this.adb(adb, serial, ["shell", command], "The phone", timeoutMs, signal).then((b) =>
      b.toString("utf8").replace(/\r\n/g, "\n"),
    );
  }

  /** `adb -s serial args…`, its stdout; a failure in words (`what` failed), the phone gone as `phone_missing`. */
  private adb(
    adb: string,
    serial: string,
    args: string[],
    what: string,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return adbRun(adb, serial, args, what, { timeoutMs, signal, env: this.env });
  }

  /** The agent's folder for phone files (`.agentes/phone/`), and a new file's absolute and relative path. */
  private async outFile(io: PhoneIo, what: string, ext: string) {
    if (!io.folder) throw new RunnerError("bad_request", "A phone's files go to an agent's folder");
    const dir = path.join(io.folder, ".agentes", "phone");
    await mkdir(dir, { recursive: true });
    if (!isInside(io.folder, await realpath(dir))) {
      throw new RunnerError("outside_workspace", ".agentes/phone points outside the agent's folder");
    }
    const name = `${stamp(this.now())}-${what}.${ext}`;
    return { abs: path.join(dir, name), rel: `.agentes/phone/${name}` };
  }

  /** Wakes an Android screen and lifts a lock screen without a PIN; one with a PIN waits for the person. */
  private async unlock(adb: string, key: string, phone: Phone, signal: AbortSignal) {
    await this.shell(adb, this.at(phone), WAKE_SHELL, 10_000, signal).catch(() => "");
    await sleep(this.opts.settleMs ?? 700);
    const out = await this.shell(adb, this.at(phone), KEYGUARD_SHELL, 10_000, signal).catch(() => "");
    if (!keyguardShowing(out)) return;
    this.locked.add(key);
    this.seen.set(key, { ...phone, state: "needs_you", reason: "locked" });
    this.changed();
    throw new RunnerError("phone_not_ready", `${labelOf(phone)} is locked. Unlock it and try again.`);
  }

  private async android(req: PhoneRequest, key: string, phone: Phone, tools: Tools, io: PhoneIo): Promise<unknown> {
    const adb = tools.adb;
    if (!adb) throw new RunnerError("tool_missing", TOOL_HELP.adb);
    const serial = this.at(phone);
    switch (req.op) {
      case "phone.install": {
        const file = await io.resolve(String(req.path ?? ""));
        const ext = path.extname(file).toLowerCase();
        if (ext === ".apk") {
          const out = (
            await this.adb(adb, serial, ["install", "-r", "-t", file], "Installing the app", 300_000, io.signal)
          ).toString("utf8");
          return { output: out.trim() } satisfies MachineReplies["phone.install"];
        }
        if (ext !== ".aab") throw new RunnerError("bad_request", "An Android phone installs an .apk or an .aab.");
        if (!tools.bundletool) throw new RunnerError("tool_missing", TOOL_HELP.bundletool);
        const apks = path.join(os.tmpdir(), `agentes-${stamp(this.now())}.apks`);
        try {
          const args = [`--device-id=${serial}`, `--adb=${adb}`];
          for (const step of [
            ["build-apks", `--bundle=${file}`, `--output=${apks}`, "--connected-device", "--overwrite", ...args],
            ["install-apks", `--apks=${apks}`, ...args],
          ]) {
            const r = await runTool(tools.bundletool, step, { timeoutMs: 300_000, signal: io.signal, env: this.env });
            if (r.code !== 0) {
              throw new RunnerError("internal", `Installing the app failed: ${firstLine(`${r.stderr}\n${r.stdout}`)}`);
            }
          }
        } finally {
          await rm(apks, { force: true });
        }
        return { output: "Installed" } satisfies MachineReplies["phone.install"];
      }
      case "phone.launch": {
        const app = String(req.app ?? "");
        if (!ANDROID_APP.test(app))
          throw new RunnerError("bad_request", `${app} isn't an Android app id (com.acme.app)`);
        await this.unlock(adb, key, phone, io.signal);
        const out = await this.shell(
          adb,
          serial,
          app.includes("/") ? `am start -n ${app}` : `monkey -p ${app} -c android.intent.category.LAUNCHER 1`,
          30_000,
          io.signal,
        );
        if (/No activities found|does not exist|^Error:/im.test(out)) {
          throw new RunnerError("not_found", `${app} isn't installed on ${labelOf(phone)}.`);
        }
        return { output: out.trim() } satisfies MachineReplies["phone.launch"];
      }
      case "phone.screenshot": {
        const raw = await this.adb(adb, serial, ["exec-out", "screencap", "-p"], "The screenshot", 30_000, io.signal);
        // A phone with more than one display (a foldable, an external screen) prints a warning before the picture.
        const data = pngFrom(raw);
        const size = pngSize(data);
        if (!size) throw new RunnerError("internal", "The phone didn't send a picture.");
        const out = await this.outFile(io, "screenshot", "png");
        await writeFile(out.abs, data);
        return { path: out.rel, ...size } satisfies MachineReplies["phone.screenshot"];
      }
      case "phone.record": {
        const seconds = clampInt(req.seconds, 1, RECORD_MAX_SECONDS, 30);
        await this.unlock(adb, key, phone, io.signal);
        const out = await this.outFile(io, "recording", "mp4");
        const started = this.now();
        await this.record(tools, phone, out.abs, seconds, io.signal).done;
        let bytes = await sizeOf(out.abs);
        if (bytes === 0 && tools.scrcpy) {
          // scrcpy couldn't (an old one, a phone it doesn't take): the phone's own recorder.
          await this.record({ ...tools, scrcpy: null }, phone, out.abs, seconds, io.signal).done;
          bytes = await sizeOf(out.abs);
        }
        if (bytes === 0) throw new RunnerError("internal", "The recording came out empty.");
        return {
          path: out.rel,
          seconds: Math.round((this.now() - started) / 1000),
          bytes,
        } satisfies MachineReplies["phone.record"];
      }
      case "phone.flow":
        await this.unlock(adb, key, phone, io.signal);
        return this.flow(req, phone, tools, io);
      case "phone.logs": {
        const lines = clampInt(req.lines, 1, 5000, 200);
        const args = ["logcat", "-d", "-t", String(lines)];
        let note = "";
        if (req.app) {
          const app = String(req.app);
          if (!ANDROID_APP.test(app) || app.includes("/")) {
            throw new RunnerError("bad_request", `${app} isn't an Android app id (com.acme.app)`);
          }
          const pid = (await this.shell(adb, serial, `pidof ${app}`, 10_000, io.signal).catch(() => ""))
            .trim()
            .split(/\s+/)[0];
          if (pid && /^\d+$/.test(pid)) args.push(`--pid=${pid}`);
          else note = `${app} isn't running, so this is the phone's whole log.\n`;
        }
        const text = (await this.adb(adb, serial, args, "Reading the log", 30_000, io.signal)).toString("utf8");
        return { text: note + tail(text, LOG_MAX_CHARS) } satisfies MachineReplies["phone.logs"];
      }
      default:
        throw new RunnerError("bad_request", `Unknown op ${(req as { op: string }).op}`);
    }
  }

  private async apple(req: PhoneRequest, phone: Phone, tools: Tools, io: PhoneIo): Promise<unknown> {
    const xcrun = tools.xcrun;
    if (!xcrun) throw new RunnerError("tool_missing", "iPhones need Xcode on this Mac.");
    const udid = phone.serial;
    const sim = phone.kind === "simulator";
    const ok = async (args: string[], what: string, timeoutMs = 120_000) => {
      const r = await runTool(xcrun, args, { timeoutMs, signal: io.signal, env: this.env });
      if (r.code === 0 && !r.timedOut) return r.stdout.toString("utf8");
      const said = `${r.stderr}\n${r.stdout.toString("utf8")}`;
      const needs = appleNeedsYou(said);
      if (needs) throw new RunnerError("phone_not_ready", needs);
      throw new RunnerError(
        "internal",
        r.timedOut ? `${what} didn't answer in time.` : `${what} failed: ${firstLine(said)}`,
      );
    };
    switch (req.op) {
      case "phone.install": {
        const file = await io.resolve(String(req.path ?? ""));
        const ext = path.extname(file).toLowerCase();
        if (sim) {
          if (ext !== ".app") throw new RunnerError("bad_request", "A simulator installs a simulator build (.app).");
          await ok(["simctl", "install", udid, file], "Installing the app", 300_000);
          const app = await this.plist(tools, path.join(file, "Info.plist"), "CFBundleIdentifier");
          return { ...(app ? { app } : {}), output: "Installed" } satisfies MachineReplies["phone.install"];
        }
        if (ext !== ".app" && ext !== ".ipa")
          throw new RunnerError("bad_request", "An iPhone installs an .ipa or an .app.");
        const json = path.join(os.tmpdir(), `agentes-install-${stamp(this.now())}.json`);
        try {
          await ok(
            ["devicectl", "device", "install", "app", "--device", udid, file, "--quiet", "--json-output", json],
            "Installing the app",
            300_000,
          );
          const result = JSON.parse(await readFile(json, "utf8").catch(() => "{}")) as {
            result?: { installedApplications?: { bundleID?: unknown }[] };
          };
          const app = result.result?.installedApplications?.[0]?.bundleID;
          return {
            ...(typeof app === "string" ? { app } : {}),
            output: "Installed",
          } satisfies MachineReplies["phone.install"];
        } finally {
          await rm(json, { force: true });
        }
      }
      case "phone.launch": {
        const app = String(req.app ?? "");
        if (!APPLE_APP.test(app))
          throw new RunnerError("bad_request", `${app} isn't an app's bundle id (com.acme.app)`);
        const out = sim
          ? await ok(["simctl", "launch", udid, app], "Opening the app")
          : await ok(
              ["devicectl", "device", "process", "launch", "--device", udid, "--terminate-existing", app],
              "Opening the app",
            );
        return { output: out.trim() } satisfies MachineReplies["phone.launch"];
      }
      case "phone.screenshot": {
        const out = await this.outFile(io, "screenshot", "png");
        if (sim) await ok(["simctl", "io", udid, "screenshot", "--type=png", out.abs], "The screenshot");
        else await writeFile(out.abs, await (await this.helper(phone, tools)).client.screenshot());
        const size = pngSize(await readFile(out.abs));
        return { path: out.rel, ...(size ?? {}) } satisfies MachineReplies["phone.screenshot"];
      }
      case "phone.record": {
        const seconds = clampInt(req.seconds, 1, RECORD_MAX_SECONDS, 30);
        const out = await this.outFile(io, "recording", "mp4");
        const started = this.now();
        await (sim
          ? this.record(tools, phone, out.abs, seconds, io.signal)
          : await this.iphoneRecorder(tools, phone, out.abs, seconds, io.signal)
        ).done;
        const bytes = await sizeOf(out.abs);
        if (bytes === 0) throw new RunnerError("internal", "The recording came out empty.");
        return {
          path: out.rel,
          seconds: Math.round((this.now() - started) / 1000),
          bytes,
        } satisfies MachineReplies["phone.record"];
      }
      case "phone.flow":
        // Maestro drives simulators; it dropped real iPhones (2.11.0), which run the flow through the test helper.
        return sim && tools.maestro ? this.flow(req, phone, tools, io) : this.iosFlow(req, phone, tools, io);
      case "phone.logs": {
        const lines = clampInt(req.lines, 1, 5000, 200);
        const app = req.app ? String(req.app) : null;
        if (app !== null && !APPLE_APP.test(app)) {
          throw new RunnerError("bad_request", `${app} isn't an app's bundle id (com.acme.app)`);
        }
        if (!sim) return { text: await this.iphoneLog(tools, udid, app, lines, io.signal) };
        const args = ["simctl", "spawn", udid, "log", "show", "--last", "10m", "--style", "compact"];
        if (app) {
          const container = (await ok(["simctl", "get_app_container", udid, app, "app"], "Finding the app")).trim();
          const exe = await this.plist(tools, path.join(container, "Info.plist"), "CFBundleExecutable");
          if (exe && /^[\w .+-]+$/.test(exe)) args.push("--predicate", `process == "${exe}"`);
        }
        const text = await ok(args, "Reading the log");
        return {
          text: tail(text.split("\n").slice(-lines).join("\n"), LOG_MAX_CHARS),
        } satisfies MachineReplies["phone.logs"];
      }
      default:
        throw new RunnerError("bad_request", `Unknown op ${(req as { op: string }).op}`);
    }
  }

  /** A key of an app's Info.plist (`plutil`), or null. */
  private async plist(tools: Tools, file: string, key: string) {
    if (!tools.plutil) return null;
    const r = await runTool(tools.plutil, ["-extract", key, "raw", "-o", "-", file], {
      timeoutMs: 10_000,
      env: this.env,
    });
    const value = r.code === 0 ? r.stdout.toString("utf8").trim() : "";
    return value || null;
  }

  /** A real iPhone keeps no log a Mac can read back: a few seconds of its live log (libimobiledevice). */
  private async iphoneLog(tools: Tools, udid: string, app: string | null, lines: number, signal: AbortSignal) {
    if (!tools.syslog) throw new RunnerError("tool_missing", TOOL_HELP.syslog);
    const run = startTool(tools.syslog, ["-u", udid, "--no-colors"], { timeoutMs: 30_000, signal, env: this.env });
    await sleep(this.opts.liveLogMs ?? IPHONE_LOG_MS);
    run.child?.kill("SIGINT");
    const all = (await run.done).stdout.toString("utf8").split("\n");
    const name = app?.split(".").pop()?.toLowerCase() ?? "";
    const mine = app ? all.filter((l) => l.includes(app) || (name !== "" && l.toLowerCase().includes(name))) : all;
    const note = app && mine.length === 0 ? `Nothing from ${app} in a few seconds of the iPhone's live log:\n` : "";
    return note + tail((mine.length > 0 ? mine : all).slice(-lines).join("\n"), LOG_MAX_CHARS);
  }

  /** The phone's test helper running (an iPhone's or a simulator's), for an op that needs it. */
  private helper(phone: Phone, tools: Tools) {
    if (!this.ios || !tools.xcrun) throw new RunnerError("tool_missing", "iPhones need Xcode on this Mac.");
    return this.ios.run(phone.kind, phone.serial, tools.xcrun);
  }

  /** A real iPhone's screen into `file`: the test helper's stream through ffmpeg (fetched on first use). */
  private async iphoneRecorder(tools: Tools, phone: Phone, file: string, limit: number, signal: AbortSignal) {
    const run = await this.helper(phone, tools);
    const ios = this.ios as IosHelper;
    return ios.record(run, await ios.ffmpeg(tools.ffmpeg), file, limit, signal);
  }

  /** A flow's YAML, variables and time limit, checked. */
  private flowInput(req: Extract<PhoneRequest, { op: "phone.flow" }>) {
    const flow = typeof req.flow === "string" ? req.flow : "";
    if (!flow.trim()) throw new RunnerError("bad_request", "The flow is empty");
    if (Buffer.byteLength(flow) > FLOW_MAX_BYTES) throw new RunnerError("too_large", "The flow is too long");
    const vars = Object.entries(req.env ?? {});
    for (const [k, v] of vars) {
      if (!/^[A-Za-z_]\w{0,63}$/.test(k) || typeof v !== "string") {
        throw new RunnerError("bad_request", `${k} isn't a variable name a flow takes`);
      }
    }
    return { flow, vars, timeoutSeconds: clampInt(req.timeoutSeconds, 10, 20 * 60, 10 * 60) };
  }

  /**
   * A flow through the test helper (a real iPhone, or a simulator without Maestro), recorded around when asked: its
   * YAML, log, screenshots and video land in `.agentes/phone/`.
   */
  private async iosFlow(req: Extract<PhoneRequest, { op: "phone.flow" }>, phone: Phone, tools: Tools, io: PhoneIo) {
    const { flow, vars, timeoutSeconds } = this.flowInput(req);
    // A flow that isn't one is refused before the helper starts and a recording begins.
    parseIosFlow(flow);
    const yaml = await this.outFile(io, "flow", "yaml");
    await writeFile(yaml.abs, flow);
    const run = await this.helper(phone, tools);
    if (phone.kind === "device" && (await run.client.locked().catch(() => false))) {
      // Polls look again (devicectl's lock state) until it's unlocked.
      const key = keyOf(phone);
      this.locked.add(key);
      const lockedNow = (p: Phone): Phone => (keyOf(p) === key ? { ...p, state: "needs_you", reason: "locked" } : p);
      this.appleSeen = this.appleSeen?.map(lockedNow) ?? null;
      const seen = this.seen.get(key);
      if (seen) this.seen.set(key, lockedNow(seen));
      this.changed();
      throw new RunnerError("phone_not_ready", `${labelOf(phone)} is locked. ${REASON_WORDS.locked}`);
    }
    const video = req.record === true ? await this.outFile(io, "flow", "mp4") : null;
    const recorder = video
      ? phone.kind === "simulator"
        ? this.record(tools, phone, video.abs, RECORD_MAX_SECONDS, io.signal)
        : await this.iphoneRecorder(tools, phone, video.abs, RECORD_MAX_SECONDS, io.signal)
      : null;
    if (recorder) await sleep(this.opts.settleMs ?? 1500);
    const started = this.now();
    // Each step reaches the helper running now: one that died mid-flow is started again, once.
    const screen = recoveringScreen(async () => (await this.helper(phone, tools)).client.scoped(io.signal));
    const result = await runIosFlow(flow, screen, {
      env: Object.fromEntries(vars),
      signal: io.signal,
      deadline: Date.now() + timeoutSeconds * 1000,
      save: async (name, png) => {
        const shot = await this.outFile(io, name, "png");
        await writeFile(shot.abs, png);
        return shot.rel;
      },
    }).catch((err: unknown) => ({
      passed: false,
      output: `FAILED  ${err instanceof Error ? err.message : String(err)}`,
      screenshots: [],
    }));
    const seconds = Math.round((this.now() - started) / 1000);
    await recorder?.stop();
    const log = yaml.rel.replace(/\.yaml$/, ".log");
    const output = [result.output, ...result.screenshots.map((p) => `Screenshot: ${p}`)].join("\n");
    await writeFile(yaml.abs.replace(/\.yaml$/, ".log"), output);
    const kept = video && (await sizeOf(video.abs)) > 0;
    return {
      passed: result.passed,
      output: tail(output, 8000),
      seconds,
      ...(kept && video ? { video: video.rel } : {}),
      log,
    } satisfies MachineReplies["phone.flow"];
  }

  /** A Maestro flow, recorded around when asked. Its YAML, log and video land in `.agentes/phone/`. */
  private async flow(req: Extract<PhoneRequest, { op: "phone.flow" }>, phone: Phone, tools: Tools, io: PhoneIo) {
    if (!tools.maestro) throw new RunnerError("tool_missing", TOOL_HELP.maestro);
    const { flow, vars, timeoutSeconds } = this.flowInput(req);
    const yaml = await this.outFile(io, "flow", "yaml");
    await writeFile(yaml.abs, flow);
    const video = req.record === true ? await this.outFile(io, "flow", "mp4") : null;
    const recorder = video ? this.record(tools, phone, video.abs, RECORD_MAX_SECONDS, io.signal) : null;
    if (recorder) await sleep(this.opts.settleMs ?? 1500);
    const started = this.now();
    const r = await runTool(
      tools.maestro,
      ["--device", this.at(phone), "test", ...vars.flatMap(([k, v]) => ["-e", `${k}=${v}`]), yaml.abs],
      {
        timeoutMs: timeoutSeconds * 1000,
        signal: io.signal,
        cwd: path.dirname(yaml.abs),
        env: {
          ...this.env,
          MAESTRO_CLI_NO_ANALYTICS: "1",
          MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
          ...(phone.platform === "android" ? { ANDROID_SERIAL: this.at(phone) } : {}),
        },
      },
    );
    const seconds = Math.round((this.now() - started) / 1000);
    await recorder?.stop();
    const output = `${r.stdout.toString("utf8")}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
    const log = yaml.rel.replace(/\.yaml$/, ".log");
    await writeFile(yaml.abs.replace(/\.yaml$/, ".log"), output);
    if (r.code !== 0 && /JAVA_HOME|no 'java' command|Unable to locate a Java Runtime/i.test(output)) {
      throw new RunnerError("tool_missing", TOOL_HELP.java);
    }
    const kept = video && (await sizeOf(video.abs)) > 0;
    return {
      passed: r.code === 0 && !r.timedOut,
      output: tail(output, 8000) + (r.timedOut ? `\nStopped after ${timeoutSeconds} s.` : ""),
      seconds,
      ...(kept && video ? { video: video.rel } : {}),
      log,
    } satisfies MachineReplies["phone.flow"];
  }

  /**
   * Records the screen into `file` for at most `limit` seconds: a simulator with `simctl io recordVideo`, an Android
   * phone with scrcpy where it's installed (its window off), else the phone's own `screenrecord`, pulled after.
   * scrcpy and simctl finish their file on SIGINT, which Windows can't send: there the phone's own recorder.
   */
  private record(tools: Tools, phone: Phone, file: string, limit: number, signal: AbortSignal): Recorder {
    const grace = { timeoutMs: (limit + 60) * 1000, signal, env: this.env };
    if (phone.platform === "ios") {
      const run = startTool(
        tools.xcrun ?? "xcrun",
        ["simctl", "io", phone.serial, "recordVideo", "--codec=h264", "--force", file],
        grace,
      );
      const timer = setTimeout(() => run.child?.kill("SIGINT"), limit * 1000);
      const done = run.done.then(() => clearTimeout(timer));
      return {
        done,
        stop: async () => {
          clearTimeout(timer);
          run.child?.kill("SIGINT");
          await done;
        },
      };
    }
    const adb = tools.adb as string;
    if (tools.scrcpy && process.platform !== "win32") {
      const run = startTool(
        tools.scrcpy,
        [
          `--serial=${this.at(phone)}`,
          "--no-playback",
          "--no-window",
          "--no-audio",
          `--record=${file}`,
          "--record-format=mp4",
          "--video-bit-rate=2M",
          "--max-size=1280",
          `--time-limit=${limit}`,
        ],
        // scrcpy uses this adb (the running server's), never its own.
        { ...grace, env: { ...this.env, ADB: adb } },
      );
      const done = run.done.then(() => undefined);
      return {
        done,
        stop: async () => {
          run.child?.kill("SIGINT");
          await done;
        },
      };
    }
    const remote = `/data/local/tmp/agentes-${stamp(this.now())}.mp4`;
    const run = startTool(
      adb,
      ["-s", this.at(phone), "shell", `screenrecord --time-limit ${Math.min(limit, 180)} --bit-rate 2000000 ${remote}`],
      grace,
    );
    let final: Promise<void> | null = null;
    const finish = () =>
      (final ??= run.done.then(async () => {
        await runTool(adb, ["-s", this.at(phone), "pull", remote, file], { timeoutMs: 120_000, env: this.env });
        await runTool(adb, ["-s", this.at(phone), "shell", `rm -f ${remote}`], { timeoutMs: 10_000, env: this.env });
      }));
    return {
      done: finish(),
      stop: async () => {
        await runTool(adb, ["-s", this.at(phone), "shell", "pkill -INT screenrecord"], {
          timeoutMs: 10_000,
          env: this.env,
        });
        await finish();
      },
    };
  }
}

const sizeOf = (file: string) =>
  stat(file).then(
    (s) => s.size,
    () => 0,
  );

// ── The screen live ───────────────────────────────────────────────────────────

/** One picture of a phone's screen, and the size its input is given in (the picture's own, for Android). */
export interface ScreenFrame {
  jpeg?: Uint8Array;
  png?: Uint8Array;
  width: number;
  height: number;
}

/**
 * A phone's screen as a person sees and drives it from the apps (`PhoneManager.view`). Input comes in the space of
 * the last `frame`'s `width` and `height`: the view maps the person's point there.
 */
export interface PhoneScreenDriver {
  frame(signal: AbortSignal): Promise<{ jpeg?: Uint8Array; png?: Uint8Array; width: number; height: number }>;
  tap(x: number, y: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void>;
  text(s: string): Promise<void>;
  key(k: "home" | "back" | "enter" | "delete" | "app_switch" | "volume_up" | "volume_down" | "power"): Promise<void>;
}

/** What a screen driver runs: the tools found on this computer, and their environment. */
export interface ScreenTools {
  adb: string | null;
  xcrun: string | null;
  env: NodeJS.ProcessEnv;
}

/** Makes an iPhone's (or a simulator's) driver; null leaves that phone to the built-in one. */
export type IosScreenDriverFactory = (phone: RunnerPhone, tools: ScreenTools) => PhoneScreenDriver | null;

/** A picture this big (a full-size PNG of a busy screen) waits for the last one's acknowledgement first. */
const BIG_PICTURE = 2 << 20;

export const OPENING_LATE =
  "The phone's screen didn't open in time. An iPhone's test helper takes about a minute to build the first time: try again then.";

export const NO_IOS_CONTROL =
  "Controlling an iPhone from here needs the test helper, which isn't set up on this Mac yet. You can still watch it.";

/**
 * The driver for a phone's screen: adb for Android; for an iPhone the test helper's (`ios`), else a simulator's
 * pictures only (`SimulatorScreen`). A real iPhone shows nothing without the test helper.
 */
export function screenDriverFor(
  phone: RunnerPhone,
  tools: ScreenTools,
  mode: DesktopMode = "control",
  ios: IosScreenDriverFactory | null = null,
): PhoneScreenDriver {
  if (phone.platform === "android") {
    if (!tools.adb) throw new RunnerError("tool_missing", TOOL_HELP.adb);
    return new AndroidScreen(tools.adb, phone.serial, tools.env);
  }
  // Watching a simulator needs no test helper (its first build takes a while): simctl's pictures show it at once.
  if (mode === "watch" && phone.kind === "simulator" && tools.xcrun) {
    return new SimulatorScreen(tools.xcrun, phone.serial, tools.env);
  }
  const helper = ios?.(phone, tools) ?? null;
  if (helper) return helper;
  if (!tools.xcrun) throw new RunnerError("tool_missing", "iPhones need Xcode on this Mac.");
  if (phone.kind !== "simulator") throw new RunnerError("tool_missing", TOOL_HELP.helper("Showing the screen of"));
  return new SimulatorScreen(tools.xcrun, phone.serial, tools.env);
}

/** Android's key codes for the keys the apps press. */
export const ANDROID_KEYCODES: Record<PhoneKey, number> = {
  home: 3,
  back: 4,
  enter: 66,
  delete: 67,
  app_switch: 187,
  volume_up: 24,
  volume_down: 25,
  power: 26,
};

/**
 * Text for `adb shell input text`, as one word of the phone's shell: single-quoted, so nothing in it runs. `input`
 * reads `%s` as a space, so a space goes as one; a literal `%s` can't be typed this way.
 */
export const androidText = (s: string) => `'${s.replace(/ /g, "%s").replace(/'/g, "'\\''")}'`;

/**
 * Android over adb: `screencap -p` pictures (about 7 a second on an emulator), `input` for the rest.
 * ponytail: a full-size PNG per changed picture (0.2 to 3 MB); scrcpy's H.264 stream when relay bandwidth matters.
 */
export class AndroidScreen implements PhoneScreenDriver {
  constructor(
    private readonly adb: string,
    private readonly serial: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  private input(args: string, what: string) {
    return adbRun(this.adb, this.serial, ["shell", `input ${args}`], what, { timeoutMs: 15_000, env: this.env }).then(
      () => undefined,
    );
  }

  async frame(signal: AbortSignal): Promise<ScreenFrame> {
    const raw = await adbRun(this.adb, this.serial, ["exec-out", "screencap", "-p"], "The screen", {
      timeoutMs: 15_000,
      signal,
      env: this.env,
    });
    // A phone with more than one display prints a warning before the picture.
    const png = pngFrom(raw);
    const size = pngSize(png);
    if (!size) throw new RunnerError("internal", "The phone didn't send a picture.");
    return { png, ...size };
  }

  tap(x: number, y: number) {
    return this.input(`tap ${Math.round(x)} ${Math.round(y)}`, "The tap");
  }

  swipe(x1: number, y1: number, x2: number, y2: number, ms: number) {
    const at = [x1, y1, x2, y2].map((n) => Math.round(n)).join(" ");
    return this.input(`swipe ${at} ${Math.round(ms)}`, "The swipe");
  }

  text(s: string) {
    return this.input(`text ${androidText(s)}`, "Typing");
  }

  key(k: PhoneKey) {
    return this.input(`keyevent ${ANDROID_KEYCODES[k]}`, "The key");
  }
}

/** A simulator's pictures only (`simctl io screenshot`): pressing anything on it needs the test helper. */
export class SimulatorScreen implements PhoneScreenDriver {
  constructor(
    private readonly xcrun: string,
    private readonly udid: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async frame(signal: AbortSignal): Promise<ScreenFrame> {
    const r = await runTool(this.xcrun, ["simctl", "io", this.udid, "screenshot", "--type=jpeg", "-"], {
      timeoutMs: 15_000,
      signal,
      env: this.env,
    });
    const jpeg = r.stdout;
    const size = r.code === 0 ? jpegSize(jpeg) : null;
    if (!size) {
      const said = `${r.stderr}\n${jpeg.subarray(0, 200).toString("utf8")}`;
      if (/Invalid device|not booted|No devices are booted/i.test(said)) {
        throw new RunnerError("phone_missing", "The simulator isn't running.");
      }
      throw new RunnerError("internal", `The screen failed: ${firstLine(said)}`);
    }
    return { jpeg, ...size };
  }

  private refuse(): Promise<void> {
    return Promise.reject(new RunnerError("unsupported", NO_IOS_CONTROL));
  }
  tap() {
    return this.refuse();
  }
  swipe() {
    return this.refuse();
  }
  text() {
    return this.refuse();
  }
  key() {
    return this.refuse();
  }
}

type PhoneInput = Extract<StreamControl, { type: "tap" | "swipe" | "text" | "key" }>;

/** A person's input on the screen, from fractions of it to the driver's space (the last picture's size). */
export function applyInput(driver: PhoneScreenDriver, f: PhoneInput, size: { width: number; height: number }) {
  const x = (v: number) => Math.min(size.width - 1, Math.max(0, Math.round(v * size.width)));
  const y = (v: number) => Math.min(size.height - 1, Math.max(0, Math.round(v * size.height)));
  switch (f.type) {
    case "tap":
      return driver.tap(x(f.x), y(f.y));
    case "swipe":
      return driver.swipe(x(f.x1), y(f.y1), x(f.x2), y(f.y2), f.ms);
    case "text":
      return driver.text(f.text);
    case "key":
      return driver.key(f.key);
  }
}
