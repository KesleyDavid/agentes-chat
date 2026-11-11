import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../src/api/http";
import { keys } from "../src/api/keys";
import type { AccountLoginStatus, AppNotification, Machine, MachineAccount } from "../src/api/types";
import {
  type AccountLoginInput,
  allowedFolders,
  allowFolderCommand,
  allowsInApp,
  beginLogin,
  commandInReason,
  computerKind,
  computerState,
  desktopTargetOf,
  downloadHref,
  folderName,
  foldersOfAgent,
  formatUserCode,
  freeDuplicate,
  installCommand,
  isHandheld,
  isPaused,
  LOGIN_RECONNECT_MS,
  LoginReadError,
  locationText,
  loginRead,
  loginReadPasses,
  machineReasonText,
  normalizeUserCode,
  otherThanHint,
  platformOf,
  sharedFolderFacts,
  sharedFolderOf,
  shellQuote,
  toolOffReason,
  toolOnCommand,
} from "../src/lib/machines";
import { openTarget, workspaceHeadline } from "../src/lib/notifications";
import { accessOf, applyComputerEvent, applyMachineEvent, pauseOf } from "../src/realtime/machines";

describe("connected computers helpers (ADR 0036)", () => {
  test("device codes: normalized for the API, shown with a dot to compare", () => {
    expect(normalizeUserCode(" k7q·4zp")).toBe("K7Q4ZP");
    // Letters that look alike (0/O, 1/I/L) are never in a code.
    expect(normalizeUserCode("O0I1L")).toBe("");
    expect(formatUserCode("K7Q4ZP")).toBe("K7Q·4ZP");
    expect(formatUserCode("K7Q")).toBe("K7Q");
  });

  test("commands: the installer has no code; granting quotes paths that need it", () => {
    expect(installCommand("https://app.agentes.chat/")).toBe(
      "curl -fsSL https://app.agentes.chat/api/machines/install.sh | sh",
    );
    expect(allowFolderCommand("/Users/you/Projects/loja-v5", "bento")).toBe(
      "agentes-runner folders allow /Users/you/Projects/loja-v5 --agent bento",
    );
    expect(allowFolderCommand("/Users/you/Meus Projetos")).toBe(
      "agentes-runner folders allow '/Users/you/Meus Projetos'",
    );
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    // What a runner says is missing: the command in it, to copy.
    expect(commandInReason("Install what desktop use needs: `sudo apt install xdotool` (missing: xdotool)")).toBe(
      "sudo apt install xdotool",
    );
    expect(commandInReason("Desktop use runs on Linux computers only")).toBeNull();
    expect(commandInReason(null)).toBeNull();
  });

  test("why a computer can't yet: the runner's code in the person's words; an older runner's own English as it is", async () => {
    const { ptBR, resources } = await import("@agenteschat/i18n");
    const i18next = (await import("i18next")).default;
    const instance = i18next.createInstance();
    void instance.init({ lng: "pt-BR", fallbackLng: "en", resources, initAsync: false });
    const t = instance.t;
    const download = "Couldn't download the agent browser: fetch failed";
    expect(machineReasonText(t, { reason: download, code: "browser_download" })).toBe(
      ptBR.machines.reasons.browser_download,
    );
    expect(machineReasonText(t, { reason: download, code: null })).toBe(download);
    // A code this app has no words for yet: the runner's own.
    expect(machineReasonText(t, { reason: download, code: "browser_new_thing" })).toBe(download);
    expect(machineReasonText(t, null)).toBeNull();
    // A runner from before codes, its install sentence with the command in it: the app's words, the command in its block.
    const install = "Install what desktop use needs: `sudo apt install xdotool` (missing: xdotool)";
    expect(machineReasonText(t, { reason: install }, "desktop_use_install")).toBe(
      ptBR.machines.reasons.desktop_use_install,
    );
    expect(machineReasonText(t, { reason: "Desktop use runs on Linux computers only" }, "desktop_use_install")).toBe(
      "Desktop use runs on Linux computers only",
    );
  });

  test("folders: the name, and the ones an agent may use", () => {
    expect(folderName("/Users/you/Projects/loja-v5/")).toBe("loja-v5");
    expect(folderName("C:\\Users\\w\\docs")).toBe("docs");
    const access = {
      folders: [
        { path: "/a", agents: ["x"] },
        { path: "/b", agents: [] },
      ],
      tools: { claude: true, codex: false, commands: false },
    };
    expect(foldersOfAgent(access, "x").map((f) => f.path)).toEqual(["/a"]);
    expect(foldersOfAgent(null, "x")).toEqual([]);
  });

  test("pause: until resumed, until a time, or over", () => {
    const now = Date.parse("2026-10-17T15:00:00.000Z");
    expect(isPaused({ paused: { paused: true, until: null } }, now)).toBe(true);
    expect(isPaused({ paused: { paused: true, until: "2026-10-17T16:24:00.000Z" } }, now)).toBe(true);
    expect(isPaused({ paused: { paused: true, until: "2026-10-17T14:00:00.000Z" } }, now)).toBe(false);
    expect(isPaused({ paused: { paused: false } }, now)).toBe(false);
    expect(isPaused({}, now)).toBe(false);
  });

  test("events are checked before they touch the cache", () => {
    expect(pauseOf({ paused: true })).toEqual({ paused: true, until: null });
    // The server's own shape: `{ until }` while paused, null when not.
    expect(pauseOf({ until: "2026-10-17T16:24:00.000Z", timezone: null })).toEqual({
      paused: true,
      until: "2026-10-17T16:24:00.000Z",
    });
    expect(pauseOf(null)).toEqual({ paused: false });
    expect(isPaused({ paused: { until: null } })).toBe(true);
    expect(isPaused({ paused: null })).toBe(false);
    expect(pauseOf({ paused: false, until: "x" })).toEqual({ paused: false });
    expect(pauseOf("yes")).toBeUndefined();
    expect(accessOf(null)).toBeNull();
    expect(accessOf({ folders: "no" })).toBeUndefined();
  });

  test("download link and location", () => {
    expect(downloadHref("/api/desktop/download/0.2.0/a.dmg", "https://app.agentes.chat")).toBe(
      "https://app.agentes.chat/api/desktop/download/0.2.0/a.dmg",
    );
    expect(downloadHref("https://cdn.example/a.dmg", "https://app.agentes.chat")).toBe("https://cdn.example/a.dmg");
    expect(locationText({ city: "Curitiba", region: null, country: "Brasil" })).toBe("Curitiba, Brasil");
  });

  test("the app to download follows the visitor's system: one build for both Mac chips, x64 or ARM64 elsewhere", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
    const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
    const linux = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
    const arm = "Mozilla/5.0 (X11; Linux aarch64; rv:131.0) Gecko/20100101 Firefox/131.0";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    expect([mac, windows, linux].map(platformOf)).toEqual(["mac", "windows", "linux"]);
    expect(desktopTargetOf(mac)).toEqual({ target: "darwin", arch: "aarch64" });
    expect(desktopTargetOf(windows)).toEqual({ target: "windows", arch: "x86_64" });
    expect(desktopTargetOf(linux)).toEqual({ target: "linux", arch: "x86_64" });
    expect(desktopTargetOf(arm)).toEqual({ target: "linux", arch: "aarch64" });
    // A Windows browser says x64 on ARM too: only its own report of the chip tells.
    expect(desktopTargetOf(windows, "arm")).toEqual({ target: "windows", arch: "aarch64" });
    expect(desktopTargetOf(windows, "x86")).toEqual({ target: "windows", arch: "x86_64" });
    // A phone reads as Linux or a Mac, and a Linux on another chip has no build: none of them gets one.
    const armv7 = "Mozilla/5.0 (X11; Linux armv7l; rv:131.0) Gecko/20100101 Firefox/131.0";
    expect([platformOf(android), platformOf(iphone)]).toEqual(["linux", "mac"]);
    expect([android, iphone, armv7].map((ua) => desktopTargetOf(ua))).toEqual([null, null, null]);
    expect([android, iphone, linux, mac].map(isHandheld)).toEqual([true, true, false, false]);
  });

  test("a tool turned off: the app's Preferences on a Mac or a PC, the command too elsewhere (sudo in system mode)", () => {
    expect(toolOnCommand({ mode: "single" }, "browser")).toBe("agentes-runner tools enable browser");
    expect(toolOnCommand({ mode: "system" }, "desktop")).toBe("sudo agentes-runner tools enable desktop");
    expect([allowsInApp("darwin"), allowsInApp("windows"), allowsInApp("linux"), allowsInApp("other")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(toolOffReason({ os: "darwin", mode: "single" }, "claude_code")).toEqual({
      key: "brain.reasons.tool_off",
      command: "",
    });
    expect(toolOffReason({ os: "windows", mode: "single" }, "codex").key).toBe("brain.reasons.tool_off");
    expect(toolOffReason({ os: "linux", mode: "system" }, "claude_code")).toEqual({
      key: "brain.reasons.tool_offLinux",
      command: "sudo agentes-runner tools enable claude",
    });
    expect(toolOffReason({ os: "linux", mode: "single" }, "codex").command).toBe("agentes-runner tools enable codex");
    // Not known yet: the app's line, as before.
    expect(toolOffReason(undefined, "codex").key).toBe("brain.reasons.tool_off");
  });

  test("portraits: the kind from the machine's os, the state with pause over online", () => {
    expect(computerKind("darwin")).toBe("mac");
    expect(computerKind("windows")).toBe("windows");
    expect(computerKind("linux")).toBe("linux");
    expect(computerKind("other")).toBe("linux");
    expect(computerKind(null)).toBe("linux");
    expect(computerState({ online: true, paused: null })).toBe("online");
    expect(computerState({ online: false, paused: null })).toBe("offline");
    expect(computerState({ online: true, paused: { until: null } })).toBe("paused");
    expect(computerState({ online: true, paused: { until: "2026-01-01T00:00:00Z" } }, Date.parse("2026-02-01"))).toBe(
      "online",
    );
  });

  test("the browser and who thinks refetch when the computer allows something new, or the agent moves", () => {
    const qc = new QueryClient();
    const browser = keys.agentBrowser("o1", "a1");
    const brain = keys.agentBrain("o1", "a1");
    const stale = () => [browser, brain].map((k) => qc.getQueryState(k)?.isInvalidated ?? false);
    const fresh = () => {
      qc.setQueryData(browser, { available: false });
      qc.setQueryData(brain, { brain: "model" });
    };
    fresh();
    // A rename alone changes neither.
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", name: "Mac" } as { type: string });
    expect(stale()).toEqual([false, false]);
    // The person turned the browser on in the app's Ferramentas: no reload needed.
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", access: true } as { type: string });
    expect(stale()).toEqual([true, true]);
    fresh();
    // A plan's program installed there since it connected (`executors.changed`): its sign-in turns on in place.
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", executors: true } as { type: string });
    expect(stale()).toEqual([true, true]);
    fresh();
    applyComputerEvent(qc, "o1", { type: "agent.computer", agentId: "a1", target: { kind: "none" } } as {
      type: string;
    });
    expect(stale()).toEqual([true, true]);
  });

  test("the agents' screens refetch when the computer changes, so a browser card on one goes back to frames", () => {
    const qc = new QueryClient();
    const desk = keys.agentDesktop("o1", "a1");
    const other = keys.agentDesktop("o1", "a2");
    const stale = () => [desk, other].map((k) => qc.getQueryState(k)?.isInvalidated ?? false);
    const fresh = () => {
      qc.setQueryData(desk, { available: true });
      qc.setQueryData(other, { available: true });
    };
    fresh();
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", name: "Mac" } as { type: string });
    expect(stale()).toEqual([false, false]);
    // Offline, its switches, its agents moving: every agent's screen.
    applyMachineEvent(qc, "o1", { type: "machine.status", machineId: "m1", online: false } as { type: string });
    expect(stale()).toEqual([true, true]);
    fresh();
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", access: true } as { type: string });
    expect(stale()).toEqual([true, true]);
    fresh();
    // An agent's own computer changing: that agent's screen.
    applyComputerEvent(qc, "o1", { type: "agent.computer", agentId: "a1" } as { type: string });
    expect(stale()).toEqual([true, false]);
    // Never its picture: each one asked again is a capture on the computer.
    const picture = keys.agentDesktopPicture("o1", "a1");
    qc.setQueryData(picture, { picture: null });
    applyMachineEvent(qc, "o1", { type: "machine.status", machineId: "m1", online: false } as { type: string });
    applyComputerEvent(qc, "o1", { type: "agent.computer", agentId: "a1" } as { type: string });
    expect(qc.getQueryState(picture)?.isInvalidated).toBe(false);
  });

  test("a plan's usage moving on a computer refetches the agent list, which carries each plan's limits", () => {
    const qc = new QueryClient();
    const agents = keys.agents("o1");
    const stale = () => qc.getQueryState(agents)?.isInvalidated ?? false;
    qc.setQueryData(agents, []);
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", name: "Mac" } as { type: string });
    expect(stale()).toBe(false);
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", accounts: true } as { type: string });
    expect(stale()).toBe(true);
  });

  test("a sign-in starts with no address asked: Claude's hint is the account's own, dropped if the server refuses it", async () => {
    const sent: AccountLoginInput[] = [];
    const begin = async (input: AccountLoginInput) => {
      sent.push(input);
      return input;
    };
    // A first sign-in names nothing; signing in again names the account, and Claude gets its email as the hint.
    expect(await beginLogin(begin, "claude_code", {})).toEqual({});
    expect(await beginLogin(begin, "claude_code", { again: "a1", hint: "walt@acme.com" })).toEqual({
      accountId: "a1",
      email: "walt@acme.com",
    });
    // ChatGPT and a coding plan's key take no hint.
    expect(await beginLogin(begin, "codex", { again: "a2", hint: "walt@acme.com" })).toEqual({ accountId: "a2" });
    expect(await beginLogin(begin, "claude_code", { provider: "zai", hint: "walt@acme.com" })).toEqual({
      provider: "zai",
    });
    // The hint only steered Claude's page: refused, the sign-in starts without it; anything else stays an error.
    const strict = async (input: AccountLoginInput) => {
      if (input.email) throw new ApiError(400, "account.invalid_email", "Use a plain email address");
      return begin(input);
    };
    sent.length = 0;
    expect(await beginLogin(strict, "claude_code", { again: "a1", hint: "o'brien@acme.com" })).toEqual({
      accountId: "a1",
    });
    expect(sent).toEqual([{ accountId: "a1" }]);
    const offline = async (): Promise<AccountLoginInput> => {
      throw new ApiError(409, "machine.offline", "Offline");
    };
    expect(await beginLogin(offline, "claude_code", { hint: "walt@acme.com" }).catch((e) => e.code)).toBe(
      "machine.offline",
    );
  });

  test("the account a sign-in came back as, already there: theirs to use while it's signed in and thinks for no one", () => {
    const account: MachineAccount = {
      id: "a1",
      kind: "claude_code",
      label: "Claude Max",
      email: "walt@acme.com",
      plan: "max",
      status: "active",
      ownerId: "u1",
      ownerName: "Walter",
      mine: true,
      usedBy: [],
      usage: null,
      provider: null,
      keyHint: null,
    };
    const failed = (duplicate: AccountLoginStatus["duplicate"]): AccountLoginStatus => ({ state: "failed", duplicate });
    expect(freeDuplicate(failed({ label: "Claude Max", account }))).toBe(account);
    expect(freeDuplicate(failed({ label: "Claude Max", account: { ...account, usedBy: ["Theo"] } }))).toBeNull();
    // One for all of the person's agents there thinks for this one too.
    const forAll = { ...account, usedBy: ["Theo"], shared: true };
    expect(freeDuplicate(failed({ label: "Claude Max", account: forAll }))).toBe(forAll);
    expect(freeDuplicate(failed({ label: "Claude Max", account: { ...account, status: "signed_out" } }))).toBeNull();
    // An older server names it only.
    expect(freeDuplicate(failed({ label: "Claude Max" }))).toBeNull();
    expect(freeDuplicate({ state: "failed" })).toBeNull();
    expect(freeDuplicate(undefined)).toBeNull();
  });

  test("a new sign-in is another account only when its hint named a different email", () => {
    expect(otherThanHint("walt@pessoal.com", { email: "walt@acme.com" })).toBe(true);
    expect(otherThanHint("Walt@Pessoal.com", { email: "walt@pessoal.com" })).toBe(false);
    // No hint (Claude's page picked), or no email to compare: the account that came back is the one.
    expect(otherThanHint(null, { email: "walt@acme.com" })).toBe(false);
    expect(otherThanHint(undefined, { email: "walt@acme.com" })).toBe(false);
    expect(otherThanHint("walt@pessoal.com", { email: null })).toBe(false);
  });

  test("a sign-in's status that can't be read: reconnecting for 90 s from the first failed read, if it passes", () => {
    // A restart that misses the runner's fifth dial (`backoffDelay`: 1, 2, 4, 8, 16, then 32 s after a drop, each up
    // to 20 % late) has it back at the sixth: still waiting then, and for the next read 2 s on.
    const sixthDial = [1, 2, 4, 8, 16, 32].reduce((at, s) => at + s * 1.2, 0) * 1000;
    expect(LOGIN_RECONNECT_MS).toBeGreaterThan(sixthDial + 2_000);
    // The server restarting (no answer, or only the proxy's) or the computer reconnecting (offline, late).
    for (const error of [
      new TypeError("Failed to fetch"),
      new ApiError(502, "http_502", "Bad Gateway"),
      new ApiError(521, "http_521", "Web server is down"),
      new ApiError(409, "machine.offline", "The computer agentes.chat isn't answering right now."),
      new ApiError(502, "machine.timeout", "the computer agentes.chat did not answer in time"),
    ])
      expect(loginReadPasses(error)).toBe(true);
    // The sign-in gone from the server or the computer, the session over, or the server's own error.
    const gone = [
      new ApiError(404, "account.login_not_found", "Sign-in not found"),
      new ApiError(502, "machine.not_found", "This sign-in is gone (it expired or was canceled)"),
      new ApiError(401, "unauthorized", "Sign in again"),
      new ApiError(500, "internal", "Internal error"),
    ];
    for (const error of gone) expect(loginReadPasses(error)).toBe(false);
    const first = Date.parse("2026-10-30T12:00:00Z");
    const failing = (afterMs: number) => ({
      isError: true,
      error: new LoginReadError(new TypeError("Failed to fetch"), first),
      errorUpdatedAt: first + afterMs,
    });
    expect(loginRead(failing(0))).toBe("reconnecting");
    expect(loginRead(failing(LOGIN_RECONNECT_MS - 1))).toBe("reconnecting");
    expect(loginRead(failing(LOGIN_RECONNECT_MS))).toBe("noAnswer");
    for (const error of gone) expect(loginRead({ isError: true, error, errorUpdatedAt: first })).toBe("failed");
    expect(loginRead({ isError: false, error: null, errorUpdatedAt: first })).toBeNull();
  });
});

test("an observed exit address updates live and is cleared across connection changes", () => {
  const qc = new QueryClient();
  const list = keys.machines("o1");
  qc.setQueryData(list, [{ id: "m1", kind: "managed", online: true, egress: null }]);
  const event = (value: Record<string, unknown>) =>
    applyMachineEvent(qc, "o1", { type: "machine.updated", machineId: "m1", ...value } as { type: string });
  const current = () => qc.getQueryData<Machine[]>(list)?.[0]?.egress;
  const first = { ip: "8.8.8.8", country: "US", at: "2026-11-01T12:00:00Z" };
  event({ egress: first });
  expect(current()).toEqual(first);
  event({ egress: { ip: "1.1.1.1", country: 42, at: first.at } });
  expect(current()).toEqual({ ip: "1.1.1.1", at: first.at });
  event({ egress: { ip: "<bad>", at: first.at } });
  expect(current()?.ip).toBe("1.1.1.1");
  event({ egress: null });
  expect(current()).toBeNull();
  event({ egress: first });
  applyMachineEvent(qc, "o1", { type: "machine.status", machineId: "m1", online: false } as { type: string });
  expect(current()).toBeNull();
  applyMachineEvent(qc, "o1", { type: "machine.status", machineId: "m1", online: true } as { type: string });
  expect(current()).toBeNull();
  qc.clear();
});

test("personal machine updates discard old-server public addresses", () => {
  const qc = new QueryClient();
  const list = keys.machines("o1");
  qc.setQueryData(list, [{ id: "m1", kind: "connected", online: true, egress: null }]);
  applyMachineEvent(qc, "o1", {
    type: "machine.updated",
    machineId: "m1",
    egress: { ip: "8.8.8.8", country: "US", at: "2026-11-01T12:00:00Z" },
  } as { type: string });
  expect(qc.getQueryData<Machine[]>(list)?.[0]?.egress).toBeNull();
  qc.clear();
});

describe("the shared folder (ADR 0115)", () => {
  test("is the folder granted to every agent; an agent's own list leaves it out; its disk notice opens the computer", () => {
    const access = {
      folders: [
        { path: "/srv/data", agents: ["ada"] },
        { path: "/srv/agentes/shared", agents: ["*"] },
      ],
      tools: { claude: true, codex: true, commands: true },
    };
    expect(sharedFolderOf(access)).toBe("/srv/agentes/shared");
    expect(sharedFolderOf({ ...access, folders: [access.folders[0] as (typeof access.folders)[0]] })).toBeNull();
    expect(sharedFolderOf(null)).toBeNull();
    expect(foldersOfAgent(access, "ada").map((f) => f.path)).toEqual(["/srv/data"]);
    const notice = {
      kind: "computer_disk_full",
      source: { machineId: "m1", label: "Build box" },
      latest: { diskUse: 0.91 },
    } as unknown as AppNotification;
    expect(workspaceHeadline(notice)).toBe("machines.shared.diskFullNotice");
    expect(openTarget(notice)).toEqual({
      to: "/org/$orgId/settings/computers/$machineId",
      params: { machineId: "m1" },
    });
    // A computer without Google Chrome (ADR 0133): its own headline, and it opens that computer too.
    const noChrome = { ...notice, kind: "computer_no_chrome", latest: {} } as AppNotification;
    expect(workspaceHeadline(noChrome)).toBe("machines.chromeMissingNotice");
    expect(openTarget(noChrome)).toEqual(openTarget(notice));
  });

  test("the folders people allowed leave it out (web and phone show it on its own row); its facts", () => {
    const access = {
      folders: [
        { path: "/srv/data", agents: ["ada"] },
        { path: "/srv/agentes/shared", agents: ["*"] },
      ],
      tools: { claude: true, codex: true, commands: true },
    };
    expect(allowedFolders(access).map((f) => f.path)).toEqual(["/srv/data"]);
    expect(allowedFolders({ ...access, folders: [access.folders[1] as (typeof access.folders)[0]] })).toEqual([]);
    expect(allowedFolders(null)).toEqual([]);
    const t = ((key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ""}`) as never;
    expect(sharedFolderFacts(t, "en", { freeGb: 42.5, use: 0.8, sharedGb: 3.2 })).toBe(
      'machines.shared.size{"size":"3.2 GB"} · machines.shared.free{"free":"43 GB"}',
    );
    expect(sharedFolderFacts(t, "en", null)).toBe("machines.shared.measuring");
  });
});
