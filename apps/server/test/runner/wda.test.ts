import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { RunnerError } from "../../runner/errors";
import {
  type AppleLook,
  type AppleTeam,
  appleIdCount,
  appleLookOf,
  buildArgs,
  certificatesOf,
  downloadPinned,
  HelperGone,
  HelperSlow,
  helperBundleId,
  helperReason,
  IosHelper,
  mjpegStream,
  parseXcodeTeams,
  profileExpiry,
  profileTeam,
  RENEW_BEFORE_MS,
  RETRY_MS,
  subjectTeam,
  teamLabel,
  validIdentities,
  WDA_VERSION,
  WdaClient,
  wdaScreenDriver,
} from "../../runner/wda";
import { fakeUsbmuxd, freePort } from "./fake-usbmuxd";
import { errorCode, removeDirs, tempDir } from "./helpers";

// Each fake Xcode tool is a process of its own: an iPhone helper's build, check and start take seconds on a busy machine.
setDefaultTimeout(30_000);

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
  removeDirs(dirs);
});

const FAKE = path.join(import.meta.dir, "fake-phone-tools.mjs");
const IPHONE = "00008110-001475263AC0A01E";
const SIM = "5C5C62E5-74E2-4E25-93AD-65E264BE78A4";
const TEAM = { id: "A1B2C3D4E5", name: "Sam Rivera", free: true };

test("what a failed build or start needs, in Xcode's own words", () => {
  const cases: [string, string | null][] = [
    ['error: No Account for Team "A1B2C3D4E5". Add a new account in Accounts settings', "apple_account_missing"],
    ['Signing for "WebDriverAgentRunner" requires a development team.', "apple_account_missing"],
    ["Your maximum App ID limit has been reached. You may create up to 10 App IDs every 7 days.", "team_limit"],
    ["The maximum number of apps for free development profiles has been reached.", "team_limit"],
    ["Verify that the Developer App certificate for your account is trusted on your device.", "helper_untrusted"],
    ["Failed to initialize for UI testing: Timed out while enabling automation mode.", "ui_automation_off"],
    ["Unlock Ana's iPhone to Continue", "locked"],
    ["The provisioning profile has expired", "helper_expired"],
    [
      'Error Domain=com.apple.dt.XCTDaemonErrorDomain Code=41 "Not authorized for performing UI testing actions."',
      "ui_not_authorized",
    ],
    ["clang: error: linker command failed", null],
  ];
  for (const [text, reason] of cases) expect([text, helperReason(text)]).toEqual([text, reason]);
});

test("signing: the Personal Team first, under a bundle id of its own, built for that iPhone", () => {
  const teams = parseXcodeTeams({
    "11111111-2222-4333-8444-555555555555": [
      { isFreeProvisioningTeam: 0, teamID: "Z9Y8X7W6V5", teamName: "Acme", teamType: "Company" },
      { isFreeProvisioningTeam: 1, teamID: TEAM.id, teamName: "Sam Rivera", teamType: "Personal Team" },
      { teamID: "bad" },
    ],
    // Before Xcode 14 the accounts were keyed by email.
    "sam@example.com": [{ teamID: TEAM.id, teamName: "Sam Rivera", teamType: "Personal Team" }],
  });
  expect(teams).toEqual([TEAM, { id: "Z9Y8X7W6V5", name: "Acme", free: false }]);
  expect(teamLabel(TEAM)).toBe("Sam Rivera (Personal Team)");
  expect(helperBundleId(TEAM.id)).toBe("chat.agentes.wda.a1b2c3d4e5");
  const device = buildArgs("/w/WebDriverAgent.xcodeproj", "/w/d", { kind: "device", udid: IPHONE, team: TEAM.id });
  expect(device.slice(0, 2)).toEqual(["xcodebuild", "build-for-testing"]);
  expect(device).toContain(`id=${IPHONE}`);
  for (const a of [
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration",
    "CODE_SIGN_STYLE=Automatic",
    `DEVELOPMENT_TEAM=${TEAM.id}`,
    "PRODUCT_BUNDLE_IDENTIFIER=chat.agentes.wda.a1b2c3d4e5",
  ])
    expect(device).toContain(a);
  const sim = buildArgs("/w/WebDriverAgent.xcodeproj", "/w/s", { kind: "simulator" });
  expect(sim).toContain("generic/platform=iOS Simulator");
  expect(sim.some((a) => a.startsWith("DEVELOPMENT_TEAM") || a.startsWith("-allowProvisioning"))).toBe(false);
  // An Xcode 26 whose simulator platform lacks Swift Testing's interop library: WDA leaves it out.
  expect(sim.some((a) => a.startsWith("WDA_XCTEST_EXCLUDED_2600="))).toBe(false);
  const older = buildArgs("/w/WebDriverAgent.xcodeproj", "/w/s", { kind: "simulator", noTestingInterop: true });
  expect(older.find((a) => a.startsWith("WDA_XCTEST_EXCLUDED_2600="))).toContain("lib_TestingInterop.dylib");
  expect(
    profileExpiry("<dict><key>ExpirationDate</key>\n\t<date>2026-11-16T04:00:00Z</date><key>Name</key></dict>"),
  ).toBe(Date.parse("2026-11-16T04:00:00Z"));
  expect(profileExpiry("<dict></dict>")).toBe(null);
});

/** A development profile as `security cms -D -i` prints it, made 2026-11-10 and lasting `days`. */
const profile = (team: string, name: string, days: number, over: { platform?: string; dev?: boolean } = {}) => {
  const made = Date.parse("2026-11-10T00:00:00Z");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AppIDName</key>	<string>XC chat agentes wda</string>
	<key>CreationDate</key>	<date>2026-11-10T00:00:00Z</date>
	<key>DeveloperCertificates</key>	<array><data>MIIB</data></array>
	<key>Entitlements</key>	<dict><key>get-task-allow</key><${over.dev === false ? "false" : "true"}/></dict>
	<key>ExpirationDate</key>	<date>${new Date(made + days * 24 * 3600_000).toISOString().replace(".000", "")}</date>
	<key>Name</key>	<string>iOS Team Provisioning Profile: chat.agentes.wda</string>
	<key>Platform</key>	<array><string>${over.platform ?? "iOS"}</string></array>
	<key>TeamIdentifier</key>	<array><string>${team}</string></array>
	<key>TeamName</key>	<string>${name}</string>
	<key>Version</key>	<integer>1</integer>
</dict>
</plist>`;
};

test("Apple teams from every source: Xcode's cache, profiles, signing identities; ordered, free flagged, three answers", () => {
  // Xcode 26.5 and later can keep an empty cache while Settings › Apple Accounts shows the account.
  expect(parseXcodeTeams({})).toEqual([]);
  expect(
    parseXcodeTeams({
      "11111111-2222-4333-8444-555555555555": [{ teamID: TEAM.id, teamName: "Sam Rivera (Personal Team)" }],
    }),
  ).toEqual([TEAM]);
  expect(
    appleIdCount({
      "IDE.Prod": [{ identifier: "sam@example.com", username: "sam@example.com" }],
      "IDE.Other": [{ username: "kai@example.com" }, { nothing: true }],
    }),
  ).toBe(2);
  const now = Date.parse("2026-11-11T12:00:00Z");
  // A free team's profile lasts 7 days, a paid one's a year.
  expect(profileTeam(profile(TEAM.id, "Sam Rivera", 7), now)).toEqual(TEAM);
  expect(profileTeam(profile("Z9Y8X7W6V5", "Acme Inc.", 365), now)).toEqual({
    id: "Z9Y8X7W6V5",
    name: "Acme Inc.",
    free: false,
  });
  expect(profileTeam(profile(TEAM.id, "Sam Rivera", 7), now + 7 * 24 * 3600_000)).toBeNull();
  expect(profileTeam(profile(TEAM.id, "Sam Rivera", 7, { platform: "OSX" }), now)).toBeNull();
  expect(profileTeam(profile(TEAM.id, "Sam Rivera", 7, { dev: false }), now)).toBeNull();
  expect(profileTeam("not a plist", now)).toBeNull();
  const valid = "0123456789ABCDEF0123456789ABCDEF01234567";
  const revoked = "FEDCBA9876543210FEDCBA9876543210FEDCBA98";
  const ids = validIdentities(
    `  1) ${valid} "Apple Development: Sam Rivera (QWERTY1234)"\n     1 valid identities found\n`,
  );
  expect([...ids]).toEqual([valid]);
  const pem = (body: string) => `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
  const certs = certificatesOf(
    `SHA-256 hash: ${"A".repeat(64)}\nSHA-1 hash: ${revoked}\n${pem("MIIBold")}\nSHA-256 hash: ${"B".repeat(64)}\nSHA-1 hash: ${valid}\n${pem("MIIBnew")}\n`,
  );
  expect(certs.map((c) => c.sha1)).toEqual([revoked, valid]);
  expect(certs.filter((c) => ids.has(c.sha1)).map((c) => c.pem)).toEqual([pem("MIIBnew")]);
  // The team is the OU, never the id in the CN's parentheses (the person's).
  const libre =
    "subject= /UID=QWERTY1234/CN=Apple Development: Sam Rivera (QWERTY1234)/OU=A1B2C3D4E5/O=Sam Rivera/C=US";
  const openssl =
    "subject=UID = QWERTY1234, CN = Apple Development: Sam Rivera (QWERTY1234), OU = A1B2C3D4E5, O = Sam Rivera, C = US";
  for (const line of [libre, openssl]) expect(subjectTeam(line)).toEqual({ ...TEAM, free: false });
  expect(subjectTeam("subject= /CN=Apple Development: Sam Rivera (QWERTY1234)")).toBeNull();
  // The Personal Team first, then Xcode's last pick, then the rest; a free flag from any copy counts.
  const acme = { id: "Z9Y8X7W6V5", name: "Acme Inc.", free: false };
  const picked = { id: "P1C2K3E4D5", name: "Picked LLC", free: false };
  expect(appleLookOf([acme, picked, { ...TEAM, free: false }, TEAM], 1, picked.id)).toEqual({
    teams: [TEAM, picked, acme],
    account: "team",
  });
  expect(appleLookOf([], 1)).toEqual({ teams: [], account: "no_team" });
  expect(appleLookOf([], 0)).toEqual({ teams: [], account: "none" });
});

test("a helper that stops answering is dropped and started again; one that is slow is asked again; Code=41 in words", async () => {
  let hang = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/session") return Response.json({ sessionId: "s1" });
      if (url.pathname === "/status") return Response.json({ value: { ready: true } });
      if (url.pathname.endsWith("/slow")) {
        if (hang) await Bun.sleep(5000);
        return Response.json({ value: null });
      }
      if (url.pathname.endsWith("/wda/tap"))
        return Response.json(
          {
            value: {
              error: "unknown error",
              message:
                'Error Domain=com.apple.dt.XCTDaemonErrorDomain Code=41 "Not authorized for performing UI testing actions."',
            },
          },
          { status: 500 },
        );
      return Response.json({ value: null });
    },
  });
  closers.push(() => server.stop(true));
  const gone: (string | null)[] = [];
  const c = new WdaClient(`http://127.0.0.1:${server.port}`, fetch, { onGone: (r) => gone.push(r) });
  hang = true;
  // Up but slow: asked again, nothing dropped.
  expect(await c.call("GET", "/slow", undefined, { timeoutMs: 100 }).catch((e) => e)).toBeInstanceOf(HelperSlow);
  expect(gone).toEqual([]);
  const refused = await c.tap(1, 2).catch((e: RunnerError) => e);
  expect(refused).toMatchObject({
    code: "phone_not_ready",
    message: expect.stringContaining("refused the test helper"),
  });
  expect(gone).toEqual(["ui_not_authorized"]);
  // A stopped flow stops its calls at once.
  const stop = new AbortController();
  const asked = c.scoped(stop.signal).call("GET", "/slow");
  stop.abort();
  expect(await asked.catch((e: Error) => e.message)).toBe("Stopped");
  server.stop(true);
  expect(await c.call("GET", "/status").catch((e) => e)).toBeInstanceOf(HelperGone);
  expect(gone).toEqual(["ui_not_authorized", null]);
});

test("a pinned download is used only when its checksum is the pinned one", async () => {
  const bytes = Buffer.from("WDA");
  const fetchOk = (async () => new Response(bytes)) as unknown as typeof fetch;
  const sha = "a3ba1d1e4bd9dfcc5e0fbcafbc7a3bec2f6e6d3b3c4fb7d3a5a0b0c6e2a0a0a0";
  expect(await errorCode(() => downloadPinned("https://example.com/wda.tgz", sha, "the helper", fetchOk))).toBe(
    "internal",
  );
  const real = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(await downloadPinned("https://example.com/wda.tgz", real, "the helper", fetchOk)).toEqual(bytes);
});

test("WDA's API: one session, taps and swipes in points, typing, buttons, and its errors in words", async () => {
  const seen: [string, string, unknown][] = [];
  let sessions = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      seen.push([req.method, url.pathname, body]);
      if (url.pathname === "/session") return Response.json({ sessionId: `s${++sessions}`, value: {} });
      if (url.pathname === "/session/s1/wda/keys")
        return Response.json({ value: { error: "invalid session id" } }, { status: 404 });
      if (url.pathname.endsWith("/wda/tap") && (body as { x: number }).x < 0)
        return Response.json(
          { value: { error: "invalid argument", message: "Out of the screen\nstack" } },
          { status: 400 },
        );
      return Response.json({ value: null });
    },
  });
  closers.push(() => server.stop(true));
  const c = new WdaClient(`http://127.0.0.1:${server.port}`);
  await c.tap(10, 20);
  await c.swipe(1, 2, 3, 4, 300);
  await c.keys("hé\n");
  await c.button("home");
  await c.button("volumeup");
  expect(seen.map(([m, p]) => `${m} ${p}`)).toEqual([
    "POST /session",
    // No idle wait before each look: a busy app never is idle.
    "POST /session/s1/appium/settings",
    "POST /session/s1/wda/tap",
    "POST /session/s1/actions",
    "POST /session/s1/wda/keys",
    // The session ended: a new one, and the call again.
    "POST /session",
    "POST /session/s2/appium/settings",
    "POST /session/s2/wda/keys",
    "POST /wda/homescreen",
    "POST /session/s2/wda/pressButton",
  ]);
  expect(seen[1]?.[2]).toEqual({ settings: { waitForIdleTimeout: 0, animationCoolOffTimeout: 0 } });
  expect(seen[2]?.[2]).toEqual({ x: 10, y: 20 });
  expect(seen[3]?.[2]).toMatchObject({
    actions: [
      {
        type: "pointer",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", x: 1, y: 2 },
          { type: "pointerDown" },
          { type: "pointerMove", duration: 300, x: 3, y: 4 },
          { type: "pointerUp" },
        ],
      },
    ],
  });
  expect(seen[7]?.[2]).toEqual({ value: ["h", "é", "\n"] });
  expect(seen[9]?.[2]).toEqual({ name: "volumeup" });
  const err = await c.tap(-1, 0).catch((e: Error) => e.message);
  expect(err).toBe("The test helper said: Out of the screen");
});

test("the MJPEG stream: asked like a page, every JPEG whole whatever the chunks", async () => {
  const a = Buffer.from("ffd8ffc0001108000a00140301ffd9", "hex");
  const b = Buffer.from("ffd8aaaaffd9", "hex");
  const server = net.createServer((s) =>
    s.once("data", (req) => {
      expect(req.toString()).toStartWith("GET / HTTP/1.0");
      const all = Buffer.concat([
        Buffer.from("HTTP/1.0 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=--BoundaryString\r\n\r\n"),
        Buffer.from(`--BoundaryString\r\nContent-type: image/jpeg\r\nContent-Length: ${a.length}\r\n\r\n`),
        a,
        Buffer.from(`\r\n\r\n--BoundaryString\r\nContent-type: image/jpeg\r\nContent-Length: ${b.length}\r\n\r\n`),
        b,
        Buffer.from("\r\n\r\n"),
      ]);
      // Three bytes at a time.
      let i = 0;
      const t = setInterval(() => {
        if (i >= all.length) return clearInterval(t);
        s.write(all.subarray(i, i + 3));
        i += 3;
      }, 1);
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());
  const got: Buffer[] = [];
  const stream = mjpegStream((server.address() as net.AddressInfo).port, (j) => got.push(j));
  closers.push(stream.close);
  for (let n = 0; n < 200 && got.length < 2; n++) await Bun.sleep(5);
  expect(got).toEqual([a, b]);
});

/** A Mac with the fake xcodebuild, the helper's source unpacked, a fake usbmuxd reaching the fake WDA. */
async function mac(state: Record<string, unknown> = {}) {
  const root = tempDir("wda-");
  dirs.push(root);
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const xcrun = path.join(bin, "xcrun");
  writeFileSync(xcrun, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" xcrun "$@"\n`, { mode: 0o755 });
  mkdirSync(
    path.join(root, ".agentes-runner", "wda", "src", `WebDriverAgent-${WDA_VERSION}`, "WebDriverAgent.xcodeproj"),
    {
      recursive: true,
    },
  );
  const stateFile = path.join(root, "state.json");
  const logFile = path.join(root, "log");
  const setState = (next: Record<string, unknown>) => writeFileSync(stateFile, JSON.stringify(next));
  setState(state);
  const [wda, mjpeg] = [await freePort(), await freePort()];
  const mux = await fakeUsbmuxd(root, [{ id: 5, serial: IPHONE }], { 8100: wda, 9100: mjpeg });
  closers.push(mux.close);
  let now = Date.parse("2026-11-09T04:00:00Z");
  let teams: AppleTeam[] | AppleLook = [TEAM];
  let locked = false;
  const logged: string[] = [];
  const helper = new IosHelper({
    home: root,
    env: {
      PATH: bin,
      FAKE_PHONE_STATE: stateFile,
      FAKE_PHONE_LOG: logFile,
      FAKE_WDA_PORT: String(wda),
      FAKE_MJPEG_PORT: String(mjpeg),
    },
    log: (line) => logged.push(line),
    now: () => now,
    usbmuxSocket: mux.file,
    teams: async () => teams,
    screenLocked: async () => locked,
  });
  closers.push(() => helper.stopAll());
  const calls = () =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as unknown[])
      : [];
  /** `need` until it says `want` (the background build or check is done), or what it says after 15 s. */
  const settle = async (want: unknown, udid = IPHONE) => {
    let last: unknown = null;
    for (let i = 0; i < 600; i++) {
      last = helper.need(udid, xcrun);
      if (JSON.stringify(last) === JSON.stringify(want)) return last;
      await Bun.sleep(25);
    }
    return last;
  };
  return {
    root,
    xcrun,
    helper,
    calls,
    setState,
    settle,
    meta: () => JSON.parse(readFileSync(path.join(root, ".agentes-runner", "wda", IPHONE, "meta.json"), "utf8")),
    setTeams: (t: typeof teams) => {
      teams = t;
    },
    setLocked: (on: boolean) => {
      locked = on;
    },
    logged,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

test("a real iPhone's helper: built under the Personal Team, checked once on the phone, then ready", async () => {
  const m = await mac();
  // The first look starts the build: the phone shows it's being prepared.
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_missing" });
  expect(await m.settle(null)).toBe(null);
  const build = m.calls().find((c) => c[0] === "xcrun" && c[2] === "build-for-testing") as string[];
  expect(build).toContain(`DEVELOPMENT_TEAM=${TEAM.id}`);
  expect(build).toContain(`id=${IPHONE}`);
  // The check ran it on the phone through usbmuxd, then stopped it.
  const run = m.calls().find((c) => c[0] === "xcrun" && c[2] === "test-without-building") as string[];
  expect(run).toContain(`id=${IPHONE}`);
  expect(m.calls().some((c) => c[0] === "wda" && c[2] === "/status")).toBe(true);
  expect(m.meta()).toMatchObject({ xcode: "26.3", team: TEAM.id, checkedAt: expect.any(Number) });
  // An op: it runs until let go.
  const up = await m.helper.run("device", IPHONE, m.xcrun);
  expect((await up.client.screenshot()).subarray(1, 4).toString()).toBe("PNG");
  const driver = wdaScreenDriver(m.helper, { serial: IPHONE, kind: "device" }, m.xcrun);
  const frame = await driver.frame(new AbortController().signal);
  expect([frame.width, frame.height]).toEqual([20, 10]);
  // Live view coordinates are the frame's pixels: WDA gets points (390 wide here).
  await driver.tap(10, 5);
  const tap = m.calls().find((c) => c[0] === "wda" && String(c[2]).endsWith("/wda/tap"));
  expect(tap?.[3]).toEqual({ x: 195, y: 422 });
  await driver.key("back");
  m.helper.stop(IPHONE);
  const first = m.meta().builtAt;
  // A day before the 7-day profile ends, it's built again in the background; the phone stays ready meanwhile.
  m.tick(7 * 24 * 3600_000 - RENEW_BEFORE_MS + 1000);
  expect(m.helper.need(IPHONE, m.xcrun)).toBe(null);
  const builds = () => m.calls().filter((c) => c[2] === "build-for-testing").length;
  for (let i = 0; i < 400 && builds() < 2; i++) await Bun.sleep(25);
  expect(builds()).toBe(2);
  expect(await m.settle(null)).toBe(null);
  for (let i = 0; i < 400 && m.meta().builtAt === first; i++) await Bun.sleep(25);
  // Xcode kept the profile it had (it ends in 12 hours): no build again until it ends, then one.
  const renewed = m.meta();
  expect(renewed.builtAt).not.toBe(first);
  const metaFile = path.join(m.root, ".agentes-runner", "wda", IPHONE, "meta.json");
  writeFileSync(metaFile, JSON.stringify({ ...renewed, expiresAt: renewed.builtAt + RENEW_BEFORE_MS / 2 }));
  for (let i = 0; i < 8; i++) {
    expect(m.helper.need(IPHONE, m.xcrun)).toBe(null);
    await Bun.sleep(25);
  }
  expect(builds()).toBe(2);
  m.tick(RENEW_BEFORE_MS / 2);
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_expired" });
  expect(await m.settle(null)).toBe(null);
  expect(builds()).toBe(3);
});

test("another runner of this user builds it or holds the phone: this one waits, running nothing", async () => {
  const m = await mac();
  const lock = (...parts: string[]) => {
    const file = path.join(m.root, ".agentes-runner", ...parts);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: process.ppid, mode: "phone", startedAt: new Date().toISOString() }));
    return file;
  };
  const building = lock("wda", "locks", `${IPHONE}.lock`);
  const holding = lock("phone-locks", `ios_${IPHONE}.lock`);
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_missing" });
  rmSync(building);
  const metaFile = path.join(m.root, ".agentes-runner", "wda", IPHONE, "meta.json");
  for (let i = 0; i < 400 && !existsSync(metaFile); i++) {
    m.helper.need(IPHONE, m.xcrun);
    await Bun.sleep(25);
  }
  // Built; the phone is another workspace's right now, so the check on it waits.
  for (let i = 0; i < 8; i++) {
    expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_missing" });
    await Bun.sleep(25);
  }
  expect(m.calls().some((c) => c[2] === "test-without-building")).toBe(false);
  // Nor does a view from this workspace start it there.
  expect(await errorCode(() => m.helper.run("device", IPHONE, m.xcrun))).toBe("phone_busy");
  rmSync(holding);
  expect(await m.settle(null)).toBe(null);
});

test("a build that fails for a reason Xcode's words don't name says them to the agent", async () => {
  const m = await mac({ wdaBuildFail: "clang: error: linker command failed with exit code 1\n" });
  expect(await m.settle({ state: "needs_you", reason: "helper_missing" })).toEqual({
    state: "needs_you",
    reason: "helper_missing",
  });
  expect(m.helper.unknownFailure(IPHONE)).toBe("clang: error: linker command failed with exit code 1");
});

test("a real iPhone's helper waits on the person: no Apple Account, UI Automation off, not trusted, the app limit", async () => {
  const m = await mac();
  m.setTeams([]);
  expect(await m.settle({ state: "needs_you", reason: "apple_account_missing" })).toEqual({
    state: "needs_you",
    reason: "apple_account_missing",
  });
  expect(await errorCode(() => m.helper.run("device", IPHONE, m.xcrun))).toBe("phone_not_ready");
  // Signed in, no team yet (Xcode 27 before its first build for an iPhone): said so, a minute later.
  m.setTeams({ teams: [], account: "no_team" });
  m.tick(RETRY_MS.account);
  expect(await m.settle({ state: "needs_you", reason: "apple_team_missing" })).toEqual({
    state: "needs_you",
    reason: "apple_team_missing",
  });
  expect(m.calls().some((c) => c[2] === "build-for-testing")).toBe(false);
  // A team shows up: the next minute's try builds it (no doubled wait: xcodebuild never ran).
  m.setTeams([TEAM]);
  m.setState({ wdaRunFail: "Testing failed:\n\tTimed out while enabling automation mode.\n" });
  m.tick(RETRY_MS.account);
  expect(await m.settle({ state: "needs_you", reason: "ui_automation_off" })).toEqual({
    state: "needs_you",
    reason: "ui_automation_off",
  });
  m.setState({
    wdaRunFail:
      "The request was denied. Verify that the Developer App certificate for your account is trusted on your device.",
  });
  m.tick(RETRY_MS.check);
  expect(await m.settle({ state: "needs_you", reason: "helper_untrusted" })).toEqual({
    state: "needs_you",
    reason: "helper_untrusted",
  });
  // Turned on and trusted: ready, at the next try (each failure in a row waits twice as long).
  m.setState({});
  const runs = () => m.calls().filter((c) => c[2] === "test-without-building").length;
  const before = runs();
  m.tick(RETRY_MS.check);
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "needs_you", reason: "helper_untrusted" });
  await Bun.sleep(100);
  expect(runs()).toBe(before);
  m.tick(RETRY_MS.check);
  expect(await m.settle(null)).toBe(null);
  // The renewal hits the free team's limit and the profile runs out: what's needed is said.
  m.setState({
    wdaBuildFail: "error: Your maximum App ID limit has been reached. You may create up to 10 App IDs every 7 days.\n",
  });
  m.tick(8 * 24 * 3600_000);
  expect(await m.settle({ state: "needs_you", reason: "team_limit" })).toEqual({
    state: "needs_you",
    reason: "team_limit",
  });
});

test("the Mac's screen locked: no signing build until it's unlocked; a helper that dies says why, and starts again", async () => {
  const m = await mac();
  m.setLocked(true);
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_missing" });
  await Bun.sleep(300);
  expect(m.helper.need(IPHONE, m.xcrun)).toEqual({ state: "preparing", reason: "helper_missing" });
  expect(m.calls().some((c) => c[2] === "build-for-testing")).toBe(false);
  m.setLocked(false);
  expect(await m.settle(null)).toBe(null);
  const up = await m.helper.run("device", IPHONE, m.xcrun);
  up.child.kill("SIGKILL");
  for (let i = 0; i < 200 && !m.logged.some((l) => l.startsWith("iPhone test helper stopped")); i++)
    await Bun.sleep(25);
  expect(m.logged.some((l) => l.startsWith(`iPhone test helper stopped (${IPHONE})`))).toBe(true);
  const again = await m.helper.run("device", IPHONE, m.xcrun);
  expect(again).not.toBe(up);
  expect((await again.client.screenshot()).subarray(1, 4).toString()).toBe("PNG");
});

test("a simulator's helper: one build for every simulator, no signing, started on first use", async () => {
  const m = await mac();
  const up = await m.helper.run("simulator", SIM, m.xcrun);
  const build = m.calls().find((c) => c[2] === "build-for-testing") as string[];
  expect(build).toContain("generic/platform=iOS Simulator");
  expect(build.some((a) => String(a).startsWith("DEVELOPMENT_TEAM"))).toBe(false);
  expect(up.client.base).toStartWith("http://127.0.0.1:");
  expect(await m.helper.run("simulator", SIM, m.xcrun)).toBe(up);
  m.helper.stop(SIM);
  await m.helper.run("simulator", "D54B1757-01C6-48BB-87F2-E6109AECE89A", m.xcrun);
  expect(m.calls().filter((c) => c[2] === "build-for-testing")).toHaveLength(1);
});
