import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import type { ControlIphoneSetup } from "@agenteschat/adapters/runner-control";
import { killTree } from "./exec";
import { extraToolDirs, runTool, which } from "./phones";
import { type AppleLook, appleLook } from "./wda";

/**
 * The Mac's side of setting up an iPhone (the desktop app's iPhone setup, `iphone.*` control requests): Xcode's
 * version, the iOS platform Xcode builds for a real iPhone with (downloaded here with `xcodebuild -downloadPlatform
 * iOS`, about 8 GB), the Apple Account in Xcode's Apple Accounts, and opening Xcode or its App Store page. Only one
 * download at a time; it outlives the request that started it and ends with the runner.
 */

/** Xcode in the Mac App Store. */
export const XCODE_APP_STORE = "macappstore://apps.apple.com/app/id497799835";

type Platform = ControlIphoneSetup["platform"];

/** "Xcode 26.3\nBuild version 17C529" → "26.3". */
export function parseXcodeVersion(out: string): string | null {
  return /^Xcode (\d+(?:\.\d+)*)/m.exec(out)?.[1] ?? null;
}

const versionKey = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
const newer = (a: string, b: string) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};

/** `xcrun simctl list runtimes -j`: the newest iOS platform ready to use, or null. */
export function parseIosRuntime(json: unknown): string | null {
  const list = (json as { runtimes?: unknown })?.runtimes;
  if (!Array.isArray(list)) return null;
  let best: string | null = null;
  for (const r of list as Record<string, unknown>[]) {
    const ios = r.platform === "iOS" || (typeof r.identifier === "string" && r.identifier.includes(".iOS-"));
    if (!ios || r.isAvailable === false || typeof r.version !== "string") continue;
    if (!best || newer(r.version, best)) best = r.version;
  }
  return best;
}

/** The setup's account step from the look: its first team (the Personal Team first), named after its person. */
export function accountOf(look: AppleLook): Pick<ControlIphoneSetup, "account" | "noTeam"> {
  const team = look.teams[0];
  if (team) return { account: { name: team.name, personal: team.free } };
  return look.account === "no_team" ? { account: null, noTeam: true } : { account: null };
}

/** One line of `xcodebuild -downloadPlatform`: "Downloading iOS 26.1 Simulator (23B80): 12.3% (1.04 GB of 8.43 GB)". */
export function parseDownloadLine(line: string): Extract<Platform, { state: "downloading" }> | null {
  const percent = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(line);
  const sizes = /\(([\d.,]+\s?[KMGT]?B)\s+of\s+([\d.,]+\s?[KMGT]?B)\)/i.exec(line);
  if (!percent && !sizes) return null;
  return {
    state: "downloading",
    percent: percent ? Math.min(100, Number.parseFloat(percent[1] ?? "0")) : null,
    ...(sizes?.[1] && sizes[2] ? { done: sizes[1], total: sizes[2] } : {}),
  };
}

export interface IphoneSetupOptions {
  log: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  /** Tool folders after the PATH (default `extraToolDirs`). */
  dirs?: string[];
}

const CHECK_MS = 15_000;
/** The window asks every 2 s: the Apple look (up to a dozen tool runs) is kept this long. */
const LOOK_MS = 5000;

export class IphoneSetup {
  /** The download running now, or how the last one failed (cleared when one starts again). */
  private download: Platform | null = null;
  private child: ChildProcess | null = null;
  private look: { at: number; value: Promise<AppleLook> } | null = null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly dirs: string[];

  constructor(private readonly opts: IphoneSetupOptions) {
    this.env = opts.env ?? process.env;
    this.platform = opts.platform ?? process.platform;
    this.dirs = [
      ...(this.env.PATH ?? "").split(path.delimiter),
      ...(opts.dirs ?? extraToolDirs(opts.home ?? os.homedir())),
    ];
  }

  private find(name: string) {
    return which(name, this.dirs, this.platform);
  }

  private async out(name: string, args: string[]) {
    const bin = this.find(name);
    if (!bin) return null;
    const r = await runTool(bin, args, { timeoutMs: CHECK_MS, env: this.env });
    return r.code === 0 ? r.stdout.toString("utf8") : null;
  }

  async check(): Promise<ControlIphoneSetup> {
    if (this.platform !== "darwin") return { xcode: null, platform: { state: "missing" }, account: null };
    const [xcode, account] = await Promise.all([this.xcode(), this.account()]);
    if (!xcode) return { xcode, platform: { state: "missing" }, ...account };
    const sdkOut = (await this.out("xcrun", ["--sdk", "iphoneos", "--show-sdk-version"]))?.trim() ?? "";
    const step = { ...account, ...(/^\d+(\.\d+)+$/.test(sdkOut) ? { sdk: sdkOut } : {}) };
    if (this.download?.state === "downloading") return { xcode, platform: this.download, ...step };
    const runtimes = await this.out("xcrun", ["simctl", "list", "runtimes", "-j"]);
    let version: string | null = null;
    try {
      version = runtimes ? parseIosRuntime(JSON.parse(runtimes)) : null;
    } catch {
      // not JSON: an Xcode mid-update
    }
    const platform: Platform = version ? { state: "installed", version } : (this.download ?? { state: "missing" });
    return { xcode, platform, ...step };
  }

  /** Without the developer tools, macOS answers xcodebuild with an install dialog: xcode-select is asked first. */
  private async xcode() {
    if ((await this.out("xcode-select", ["-p"])) === null) return null;
    return parseXcodeVersion((await this.out("xcodebuild", ["-version"])) ?? "");
  }

  private async account() {
    if (!this.look || Date.now() - this.look.at > LOOK_MS) {
      const value = appleLook({ env: this.env, log: this.opts.log, bin: (name) => this.find(name) }).catch(
        (): AppleLook => ({ teams: [], account: "none" }),
      );
      this.look = { at: Date.now(), value };
    }
    return accountOf(await this.look.value);
  }

  /** Starts the iOS platform's download when Xcode is here and lacks it; answers where it stands. */
  async start(): Promise<ControlIphoneSetup> {
    const now = await this.check();
    const xcodebuild = this.find("xcodebuild");
    if (!now.xcode || !xcodebuild || now.platform.state === "installed" || now.platform.state === "downloading")
      return now;
    this.download = { state: "downloading", percent: null };
    let last = "";
    let child: ChildProcess;
    try {
      child = spawn(xcodebuild, ["-downloadPlatform", "iOS"], {
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      this.download = { state: "failed", message: err instanceof Error ? err.message : String(err) };
      return { ...now, platform: this.download };
    }
    this.child = child;
    const read = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        last = line.trim().slice(0, 300);
        const step = parseDownloadLine(line);
        if (step && this.download?.state === "downloading") this.download = step;
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    const events = child as unknown as EventEmitter;
    const end = (code: number | null) => {
      if (this.child !== child) return;
      this.child = null;
      this.download = code === 0 ? null : { state: "failed", message: last || "The download stopped" };
      this.opts.log(`iphone: iOS platform download ${code === 0 ? "done" : `failed: ${last}`}`);
    };
    events.on("error", (err: Error) => {
      last = err.message;
      end(null);
    });
    events.on("close", end);
    this.opts.log("iphone: downloading the iOS platform");
    return { ...now, platform: this.download };
  }

  /** Xcode itself (only it adds an Apple Account), or its page in the App Store. */
  async open(app: "xcode" | "appStore"): Promise<{ opened: boolean }> {
    if (this.platform !== "darwin") return { opened: false };
    const args = app === "xcode" ? ["-a", "Xcode"] : [XCODE_APP_STORE];
    return { opened: (await this.out("open", args)) !== null };
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child) killTree(child, "SIGTERM");
  }
}
