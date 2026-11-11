import os from "node:os";
import path from "node:path";
import type { RunnerToolchains } from "@agenteschat/adapters/machine-protocol";
import { findAdb, findSdk } from "./adb";
import { readJson, writeJson } from "./json-file";
import { extraToolDirs, runTool, which } from "./phones";
import { type AppleLook, type AppleTeam, appleLook, appleLookOf, teamLabel } from "./wda";

/**
 * What this computer can build and drive phones with (`hello.toolchains`): versions found, best effort. A look runs
 * each tool's version command (Maestro's starts a JVM, about 2 s), so it is cached in `<home>/toolchains.json`:
 * `hello` carries the last look, and a new one runs in the background at start and every `TOOLCHAINS_TTL_MS`. On a
 * Mac, Xcode's part (its version, its iPhone SDK, the Apple team) is looked at every `APPLE_LOOK_MS`: a person
 * setting up an iPhone signs in to Xcode and waits for the step to turn done.
 */
export const TOOLCHAINS_TTL_MS = 6 * 3600_000;
export const APPLE_LOOK_MS = 60_000;
export const TOOLCHAINS_FILE = "toolchains.json";

export interface ToolchainsProbe {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
  dirs?: string[];
  /** Tests: the teams of Xcode's Apple Accounts, or the whole look (default `appleLook`). */
  teams?: () => Promise<AppleTeam[] | AppleLook>;
}

type AppleKeys = Pick<RunnerToolchains, "xcode" | "xcodeSdk" | "appleTeam" | "appleAccount">;

/** The first version-looking word after `prefix` in `text`. */
const version = (text: string, prefix: RegExp) =>
  new RegExp(`${prefix.source}\\s*v?(\\d+(?:\\.\\d+)+)`, prefix.flags).exec(text)?.[1];

function finder(opts: ToolchainsProbe) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  const dirs = [...(env.PATH ?? "").split(path.delimiter), ...(opts.dirs ?? extraToolDirs(home))];
  const find = (name: string) => which(name, dirs, platform);
  const say = async (bin: string | null, args: string[]) => {
    if (!bin) return "";
    const r = await runTool(bin, args, { timeoutMs: 20_000, env: { ...env, MAESTRO_CLI_NO_ANALYTICS: "1" } });
    return r.code === 0 ? `${r.stdout.toString("utf8")}\n${r.stderr}` : "";
  };
  return { env, platform, home, dirs, find, say };
}

/** Xcode's part, on a Mac with the developer tools (`devTools`): its version, iPhone SDK and Apple team. */
async function appleKeys(opts: ToolchainsProbe, devTools?: boolean): Promise<AppleKeys> {
  const { env, platform, find, say } = finder(opts);
  if (platform !== "darwin") return {};
  // macOS's /usr/bin xcodebuild and xcrun are stubs that open an install dialog when the tools aren't there.
  if (!(devTools ?? (await say(find("xcode-select"), ["-p"])) !== "")) return {};
  const [xcodeV, sdkV, found] = await Promise.all([
    say(find("xcodebuild"), ["-version"]),
    say(find("xcrun"), ["--sdk", "iphoneos", "--show-sdk-version"]),
    (opts.teams ?? (() => appleLook({ env })))(),
  ]);
  const look = Array.isArray(found) ? appleLookOf(found, 0) : found;
  const sdk = /^\s*(\d+(?:\.\d+)+)\s*$/.exec(sdkV)?.[1];
  return {
    xcode: version(xcodeV, /Xcode/),
    xcodeSdk: sdk,
    appleTeam: look.teams[0] ? teamLabel(look.teams[0]) : undefined,
    appleAccount: look.account,
  };
}

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export async function probeToolchains(opts: ToolchainsProbe = {}): Promise<RunnerToolchains> {
  const { env, platform, home, dirs, find, say } = finder(opts);
  // macOS's /usr/bin git and java are stubs that open an install dialog when the tools aren't there.
  const devTools = platform !== "darwin" || (await say(find("xcode-select"), ["-p"])) !== "";
  const stub = (bin: string | null) => platform === "darwin" && bin?.startsWith("/usr/bin/");
  const git = find("git");
  const java = find("java");
  const hasJava = !stub(java) || (await say("/usr/libexec/java_home", [])) !== "";
  const [gitV, javaV, adbV, scrcpyV, maestroV, nodeV, podmanV, apple] = await Promise.all([
    stub(git) && !devTools ? "" : say(git, ["--version"]),
    hasJava ? say(java, ["-version"]) : "",
    say(findAdb(env, platform, home, dirs), ["version"]),
    say(find("scrcpy"), ["--version"]),
    say(find("maestro"), ["--version"]),
    say(find("node"), ["--version"]),
    say(find("podman"), ["--version"]),
    appleKeys(opts, devTools),
  ]);
  const sdk = findSdk(env, platform, home);
  return defined<RunnerToolchains>({
    git: version(gitV, /git version/),
    java: /version "([^"]+)"/.exec(javaV)?.[1],
    ...(sdk ? { androidSdk: sdk } : {}),
    adb: version(adbV, /^Version/m) ?? version(adbV, /Android Debug Bridge version/),
    scrcpy: version(scrcpyV, /scrcpy/),
    maestro: /^\s*(\d+(?:\.\d+)+)\s*$/m.exec(maestroV)?.[1],
    ...apple,
    node: version(nodeV, /^/),
    podman: version(podmanV, /podman version/),
  });
}

/**
 * The last look, and a fresh one in the background now and every `TOOLCHAINS_TTL_MS` (written to `file`). `apple`
 * (a Mac): Xcode's part every `APPLE_LOOK_MS`; when it differs from what the server heard, `onChange` gets the whole
 * list (false: not sent, tried again the next minute).
 */
export function cachedToolchains(
  file: string,
  probe: () => Promise<RunnerToolchains> = () => probeToolchains(),
  apple: { look: () => Promise<AppleKeys>; onChange: (toolchains: RunnerToolchains) => unknown } | null = null,
) {
  let current = readJson<RunnerToolchains>(file);
  const appleOf = (t: RunnerToolchains | null) =>
    JSON.stringify([t?.xcode, t?.xcodeSdk, t?.appleTeam, t?.appleAccount]);
  /** Xcode's part as the server last heard it (`hello` reads `get`, or a frame that went out). */
  let told = appleOf(current);
  let looking: Promise<void> | null = null;
  const look = () =>
    (looking ??= probe()
      .then((found) => {
        current = found;
        writeJson(file, found);
      })
      .catch(() => undefined)
      .finally(() => {
        looking = null;
      }));
  void look();
  const timer = setInterval(() => void look(), TOOLCHAINS_TTL_MS);
  timer.unref?.();
  let appleLooking = false;
  /** One look at Xcode's part; resolves once it is stored (and told, when it changed). */
  const lookApple = async () => {
    if (!apple || appleLooking || looking) return;
    appleLooking = true;
    try {
      const keys = defined(await apple.look());
      const before = current ?? {};
      const next = defined<RunnerToolchains>({
        ...before,
        xcode: undefined,
        xcodeSdk: undefined,
        appleTeam: undefined,
        appleAccount: undefined,
        ...keys,
      });
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        current = next;
        writeJson(file, next);
      }
      // Against what the server heard, not the last look: a hello sent before the start's full look finished.
      if (appleOf(next) !== told && apple.onChange(next) !== false) told = appleOf(next);
    } catch {
      // the next minute's look
    } finally {
      appleLooking = false;
    }
  };
  const appleTimer = apple ? setInterval(() => void lookApple(), APPLE_LOOK_MS) : null;
  appleTimer?.unref?.();
  return {
    get: () => {
      told = appleOf(current);
      return current ?? undefined;
    },
    look,
    lookApple,
    stop: () => {
      clearInterval(timer);
      if (appleTimer) clearInterval(appleTimer);
    },
  };
}

/** Xcode's part of the toolchains, the 60 s look (`cachedToolchains`'s `apple`). */
export const appleToolchains = (opts: ToolchainsProbe = {}) => appleKeys(opts);
