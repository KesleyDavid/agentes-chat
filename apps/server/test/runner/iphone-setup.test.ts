import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  accountOf,
  IphoneSetup,
  parseDownloadLine,
  parseIosRuntime,
  parseXcodeVersion,
  XCODE_APP_STORE,
} from "../../runner/iphone-setup";
import { parseXcodeTeams } from "../../runner/wda";
import { removeDirs, tempDir, waitFor } from "./helpers";

const dirs: string[] = [];
const setups: IphoneSetup[] = [];
afterEach(() => {
  for (const s of setups.splice(0)) s.stop();
  removeDirs(dirs);
});

const FAKE = path.join(import.meta.dir, "fake-xcode-tools.mjs");
const TOOLS = ["xcode-select", "xcodebuild", "xcrun", "defaults", "plutil", "open"];
const RUNTIME = {
  platform: "iOS",
  version: "26.2",
  isAvailable: true,
  identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2",
};
const TEAMS = {
  "0A1B2C3D-0000-4000-8000-00000000A11C": [
    { teamID: "A1B2C3D4E5", teamName: "Acme Inc.", teamType: "Company", isFreeProvisioningTeam: false },
    {
      teamID: "Z9Y8X7W6V5",
      teamName: "Sam Rivera (Personal Team)",
      teamType: "Personal Team",
      isFreeProvisioningTeam: true,
    },
  ],
};

/** A Mac with fake Xcode tools on its PATH. */
function rig(state: Record<string, unknown>, platform: NodeJS.Platform = "darwin") {
  const root = tempDir("iphone-");
  dirs.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  for (const tool of TOOLS) {
    writeFileSync(path.join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${tool} "$@"\n`, {
      mode: 0o755,
    });
  }
  const stateFile = path.join(root, "state.json");
  const logFile = path.join(root, "log");
  const go = path.join(root, "go");
  const setState = (next: Record<string, unknown>) => writeFileSync(stateFile, JSON.stringify(next));
  setState(state);
  const setup = new IphoneSetup({
    log: () => {},
    env: { PATH: bin, HOME: root, FAKE_XCODE_STATE: stateFile, FAKE_XCODE_LOG: logFile, FAKE_XCODE_GO: go },
    platform,
    dirs: [],
  });
  setups.push(setup);
  const calls = () =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as string[])
      : [];
  return { setup, setState, calls, finish: () => writeFileSync(go, "") };
}

test("parsers read Xcode's own answers", () => {
  expect(parseXcodeVersion("Xcode 26.3\nBuild version 17C529\n")).toBe("26.3");
  expect(parseXcodeVersion("xcode-select: error: tool 'xcodebuild' requires Xcode")).toBeNull();
  expect(
    parseIosRuntime({
      runtimes: [
        { ...RUNTIME, version: "18.6" },
        RUNTIME,
        { platform: "watchOS", version: "27.0", isAvailable: true },
        { platform: "iOS", version: "27.0", isAvailable: false },
      ],
    }),
  ).toBe("26.2");
  expect(parseIosRuntime({ runtimes: [] })).toBeNull();
  expect(accountOf({ teams: parseXcodeTeams(TEAMS), account: "team" })).toEqual({
    account: { name: "Sam Rivera", personal: true },
  });
  expect(
    accountOf({ teams: parseXcodeTeams({ a: [{ teamID: "A1B2C3D4E5", teamName: "Acme Inc." }] }), account: "team" }),
  ).toEqual({ account: { name: "Acme Inc.", personal: false } });
  // Signed in with no team yet: an older desktop app reads `account: null` as missing, never as done.
  expect(accountOf({ teams: [], account: "no_team" })).toEqual({ account: null, noTeam: true });
  expect(accountOf({ teams: [], account: "none" })).toEqual({ account: null });
  expect(parseDownloadLine("Downloading iOS 26.1 Simulator (23B80): 12.3% (1.04 GB of 8.43 GB)")).toEqual({
    state: "downloading",
    percent: 12.3,
    done: "1.04 GB",
    total: "8.43 GB",
  });
  expect(parseDownloadLine("Finding content…")).toBeNull();
});

test("a Mac with Xcode, the iOS platform and an Apple Account has every step", async () => {
  const { setup } = rig({ xcode: "26.3", runtimes: [RUNTIME], teams: TEAMS });
  expect(await setup.check()).toEqual({
    xcode: "26.3",
    platform: { state: "installed", version: "26.2" },
    account: { name: "Sam Rivera", personal: true },
  });
});

test("no developer tools: xcodebuild is never run (macOS would ask to install them)", async () => {
  const { setup, calls } = rig({ noTools: true });
  expect(await setup.check()).toEqual({ xcode: null, platform: { state: "missing" }, account: null });
  expect(calls().some(([tool]) => tool === "xcodebuild")).toBe(false);
});

test("only a Mac has any of it", async () => {
  const { setup, calls } = rig({ xcode: "26.3", runtimes: [RUNTIME] }, "linux");
  expect((await setup.check()).xcode).toBeNull();
  expect(await setup.open("xcode")).toEqual({ opened: false });
  expect(calls()).toEqual([]);
});

test("the iOS platform downloads once, with its progress, then shows installed", async () => {
  const { setup, setState, calls, finish } = rig({
    xcode: "26.3",
    download: ["Finding content…", "Downloading iOS 26.2 Simulator (23C54): 40.5% (3.4 GB of 8.4 GB)"],
  });
  expect((await setup.check()).platform).toEqual({ state: "missing" });
  const started = await setup.start();
  expect(started.platform.state).toBe("downloading");
  await waitFor(() => calls().some(([tool, flag]) => tool === "xcodebuild" && flag === "-downloadPlatform"));
  let now = await setup.check();
  for (let i = 0; i < 100 && now.platform.state === "downloading" && now.platform.percent === null; i++) {
    await Bun.sleep(20);
    now = await setup.check();
  }
  expect(now.platform).toEqual({ state: "downloading", percent: 40.5, done: "3.4 GB", total: "8.4 GB" });
  // A second ask while it runs starts nothing.
  await setup.start();
  expect(calls().filter(([tool, flag]) => tool === "xcodebuild" && flag === "-downloadPlatform")).toHaveLength(1);
  setState({ xcode: "26.3", runtimes: [RUNTIME] });
  finish();
  for (let i = 0; i < 100 && now.platform.state !== "installed"; i++) {
    await Bun.sleep(20);
    now = await setup.check();
  }
  expect(now.platform).toEqual({ state: "installed", version: "26.2" });
});

test("a failed download says why, and the next ask starts it again", async () => {
  const { setup, calls, finish } = rig({ xcode: "26.3", downloadFail: true });
  finish();
  await setup.start();
  let now = await setup.check();
  for (let i = 0; i < 100 && now.platform.state !== "failed"; i++) {
    await Bun.sleep(20);
    now = await setup.check();
  }
  expect(now.platform).toEqual({ state: "failed", message: "Download failed: the network connection was lost." });
  await setup.start();
  await waitFor(
    () => calls().filter(([tool, flag]) => tool === "xcodebuild" && flag === "-downloadPlatform").length === 2,
  );
});

test("opens Xcode, or its App Store page", async () => {
  const { setup, calls } = rig({});
  expect(await setup.open("xcode")).toEqual({ opened: true });
  expect(await setup.open("appStore")).toEqual({ opened: true });
  expect(calls().filter(([tool]) => tool === "open")).toEqual([
    ["open", "-a", "Xcode"],
    ["open", XCODE_APP_STORE],
  ]);
});
