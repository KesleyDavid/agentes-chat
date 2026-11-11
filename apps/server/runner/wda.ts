import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PhoneKind, PhoneReason, RunnerToolchains } from "@agenteschat/adapters/machine-protocol";
import { jpegSize } from "./browser";
import { RunnerError } from "./errors";
import { killTree } from "./exec";
import { readJson, writeJson } from "./json-file";
import { acquireLock, pidAlive, readLock } from "./lock";
import { type PhoneScreenDriver, REASON_WORDS, runTool, startTool } from "./phones";
import { parsePlist, USBMUXD_SOCKET, usbmuxForward } from "./usbmux";

/**
 * The iPhone test helper: WebDriverAgent (appium/WebDriverAgent, a pinned release built from source), the small
 * UI-test runner that reads, taps and films an iPhone's screen. A simulator gets one unsigned build; a real iPhone
 * gets its own, signed by the person's own Apple Account in Xcode (its Personal Team, automatic signing), renewed a
 * day before its profile runs out (a free team's lasts 7 days). It runs (`xcodebuild test-without-building`) while
 * an op needs it and stops when the phone is let go; a real iPhone's ports are reached through usbmuxd.
 */

export const WDA_VERSION = "16.15.3";
/** SHA-256 of GitHub's source archive of the `v${WDA_VERSION}` tag. */
export const WDA_SHA256 = "a232b9faaa47e33d5348dea362910a772ebf6f3b405d2a680ba9d488e30266e5";
const WDA_URL = `https://github.com/appium/WebDriverAgent/archive/refs/tags/v${WDA_VERSION}.tar.gz`;

/** ffmpeg (ffmpeg-static's macOS builds) for a real iPhone's recordings, fetched on first use when none is installed. */
export const FFMPEG_RELEASE = "b6.1.1";
export const FFMPEG_SHA256: Record<string, string> = {
  arm64: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
  x64: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
};

/** A free team's profile lasts 7 days: the helper is built again this long before it ends. */
export const RENEW_BEFORE_MS = 24 * 3600_000;
const FREE_PROFILE_MS = 7 * 24 * 3600_000;
/** After a failed build or check, the next try waits this long (a person may be fixing it now). */
export const RETRY_MS = { check: 30_000, account: 60_000, other: 10 * 60_000 } as const;
/** A running helper nobody used for this long is stopped (a live view left open with no phone held). */
export const HELPER_IDLE_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;
const DEVICE_PORT = 8100;
const DEVICE_MJPEG_PORT = 9100;

// ── Words ─────────────────────────────────────────────────────────────────────

/** What a failed build or start of the helper needs, from xcodebuild's words; null when it's none of these. */
export function helperReason(text: string): PhoneReason | null {
  if (/Not authorized for performing UI testing actions|XCTDaemonErrorDomain Code=41/i.test(text))
    return "ui_not_authorized";
  if (/maximum App ID limit|maximum number of apps|App ID limit|limit of \d+ apps/i.test(text)) return "team_limit";
  if (
    /No Account for Team|No accounts? (with|for)|requires a development team|session has expired|sign in (with|to) your Apple|Unable to log in|re-?enter (your )?password/i.test(
      text,
    )
  )
    return "apple_account_missing";
  if (/Developer App certificate|not been explicitly trusted|Untrusted Developer|is not trusted/i.test(text))
    return "helper_untrusted";
  if (/UI Automation|enabling automation mode/i.test(text)) return "ui_automation_off";
  if (/Developer Mode/i.test(text)) return "developer_mode_off";
  if (/not supported by this version of Xcode|newer version of Xcode|update Xcode/i.test(text)) return "xcode_too_old";
  if (/\bis locked\b|Unlock .* to Continue|passcode/i.test(text)) return "locked";
  if (/is busy|Preparing|Copying shared cache/i.test(text)) return "device_support";
  if (/provisioning profile.*expired|profile has expired/i.test(text)) return "helper_expired";
  return null;
}

export const helperWords = (reason: PhoneReason, detail: string) =>
  REASON_WORDS[reason] ?? `The test helper couldn't be set up: ${detail}`;

/** The first line of xcodebuild's output that says what failed. */
export const failureLine = (text: string) =>
  (
    text.split("\n").find((l) => /error:|failed|Testing failed/i.test(l) && !/^\s*\*\*/.test(l)) ??
    text.trim().split("\n").at(-1) ??
    ""
  )
    .trim()
    .slice(0, 400);

// ── Signing ───────────────────────────────────────────────────────────────────

export interface AppleTeam {
  id: string;
  name: string;
  free: boolean;
}

/** What Xcode's Apple Accounts give this Mac: the teams found (the Personal Team first), and the account's state. */
export interface AppleLook {
  teams: AppleTeam[];
  account: NonNullable<RunnerToolchains["appleAccount"]>;
}

const TEAM_ID = /^[A-Z0-9]{10}$/;
const PERSONAL = /\s*\(Personal Team\)\s*$/;
const DAY_MS = 24 * 3600_000;

/** Dedupe by id (a free flag from any copy counts); the Personal Team first, then Xcode's last pick, then the rest. */
export function orderTeams(teams: AppleTeam[], lastSelected?: string | null): AppleTeam[] {
  const byId = new Map<string, AppleTeam>();
  for (const t of teams) {
    const had = byId.get(t.id);
    if (!had) byId.set(t.id, { ...t });
    else if (t.free) had.free = true;
  }
  // The person's own Personal Team first: a company's team isn't theirs to fill with test apps.
  const rank = (t: AppleTeam) => (t.free ? 0 : t.id === lastSelected ? 1 : 2);
  return [...byId.values()].sort((a, b) => rank(a) - rank(b));
}

/** The look's answer: teams, else an account listed with none (`no_team`), else nothing (`none`). */
export const appleLookOf = (teams: AppleTeam[], accounts: number, lastSelected?: string | null): AppleLook => ({
  teams: orderTeams(teams, lastSelected),
  account: teams.length > 0 ? "team" : accounts > 0 ? "no_team" : "none",
});

/**
 * Xcode's signing teams (`IDEProvisioningTeamByIdentifier`, before Xcode 14 `IDEProvisioningTeams`): account → its
 * teams. A team cache: from Xcode 26.5 it can be empty while Settings › Apple Accounts shows the account.
 */
export function parseXcodeTeams(json: unknown): AppleTeam[] {
  const out: AppleTeam[] = [];
  for (const list of typeof json === "object" && json !== null ? Object.values(json) : []) {
    if (!Array.isArray(list)) continue;
    for (const t of list as Record<string, unknown>[]) {
      const id = typeof t?.teamID === "string" && TEAM_ID.test(t.teamID) ? t.teamID : null;
      if (!id) continue;
      const raw = typeof t.teamName === "string" ? t.teamName.trim() : "";
      const free =
        t.isFreeProvisioningTeam === true ||
        t.isFreeProvisioningTeam === 1 ||
        t.teamType === "Personal Team" ||
        PERSONAL.test(raw);
      out.push({ id, name: raw.replace(PERSONAL, "").slice(0, 80) || id, free });
    }
  }
  return orderTeams(out);
}

/** How many Apple Accounts Xcode lists (`DVTDeveloperAccountManagerAppleIDLists`, lists of accounts). */
export function appleIdCount(json: unknown): number {
  let n = 0;
  for (const list of typeof json === "object" && json !== null ? Object.values(json) : []) {
    if (!Array.isArray(list)) continue;
    for (const e of list as Record<string, unknown>[]) {
      if (e && (typeof e.identifier === "string" || typeof e.username === "string")) n++;
    }
  }
  return n;
}

/** A development profile for iPhones (`security cms -D -i`), not expired: its team, free when it lasts 8 days or less. */
export function profileTeam(xml: string, now: number): AppleTeam | null {
  let p: Record<string, unknown>;
  try {
    p = parsePlist(xml) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ids = Array.isArray(p?.TeamIdentifier) ? p.TeamIdentifier : [];
  const id = ids.find((x): x is string => typeof x === "string" && TEAM_ID.test(x));
  const ios = Array.isArray(p.Platform) && p.Platform.includes("iOS");
  const entitlements = (p.Entitlements ?? {}) as Record<string, unknown>;
  const created = p.CreationDate instanceof Date ? p.CreationDate.getTime() : Number.NaN;
  const ends = p.ExpirationDate instanceof Date ? p.ExpirationDate.getTime() : Number.NaN;
  if (!id || !ios || entitlements["get-task-allow"] !== true || !(ends > now)) return null;
  const name = typeof p.TeamName === "string" ? p.TeamName.trim().replace(PERSONAL, "").slice(0, 80) : "";
  return { id, name: name || id, free: ends - created <= 8 * DAY_MS };
}

/** `security find-identity -v -p codesigning`: the SHA-1s of the valid signing identities. */
export const validIdentities = (out: string) =>
  new Set([...out.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s/gm)].map((m) => m[1] as string));

/** `security find-certificate -a -Z -p`: each certificate's SHA-1 and PEM. */
export function certificatesOf(out: string): { sha1: string; pem: string }[] {
  const certs: { sha1: string; pem: string }[] = [];
  let sha1: string | null = null;
  for (const m of out.matchAll(
    /SHA-1 hash:\s*([0-9A-F]{40})|(-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----)/g,
  )) {
    if (m[1]) sha1 = m[1];
    else if (m[2] && sha1) {
      certs.push({ sha1, pem: m[2] });
      sha1 = null;
    }
  }
  return certs;
}

/**
 * `openssl x509 -noout -subject` of an Apple Development certificate (LibreSSL's `/K=V` or OpenSSL's `K = V, `): the
 * team is its OU and its name the O. The id in the CN's parentheses is the person's, never the team's.
 */
export function subjectTeam(line: string): AppleTeam | null {
  const body = line.replace(/^\s*subject\s*=\s*/i, "").trim();
  const parts = body.startsWith("/") ? body.slice(1).split("/") : body.split(/\s*(?<!\\),\s*/);
  const field = (key: string) =>
    parts
      .find((p) => new RegExp(`^${key}\\s*=`).test(p))
      ?.replace(/^\w+\s*=\s*/, "")
      .replace(/\\(.)/g, "$1")
      .trim();
  const id = field("OU");
  if (!id || !TEAM_ID.test(id)) return null;
  return { id, name: field("O")?.slice(0, 80) || id, free: false };
}

export interface AppleLookOptions {
  env?: NodeJS.ProcessEnv;
  /** Says once what each look that found nothing tried (counts only, never names). */
  log?: (line: string) => void;
  /** Where a macOS tool is (default `/usr/bin/<name>`); null: not here. */
  bin?: (name: "defaults" | "plutil" | "security" | "openssl") => string | null;
  now?: () => number;
}

const PROFILE_DIRS = [
  ["Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"],
  ["Library", "MobileDevice", "Provisioning Profiles"],
];
/** Decoded profiles by file, kept while the file is unchanged: a look runs every minute. */
const profileCache = new Map<string, { mtime: number; xml: string }>();
let lastLookLine = "";

/**
 * The teams of the Apple Accounts in Xcode on this Mac, all read-only, each source tried when the one before found
 * none: Xcode's settings (`defaults export`, one `plutil -extract` per key, never `-convert`, which fails on this
 * domain), xcodebuild's copy of them, Xcode's development profiles, then the keychain's Apple Development identities.
 */
export async function appleLook(o: AppleLookOptions = {}): Promise<AppleLook> {
  const env = o.env ?? process.env;
  const bin = o.bin ?? ((name: string) => `/usr/bin/${name}`);
  const now = (o.now ?? Date.now)();
  const notes: string[] = [];
  const run = async (name: Parameters<NonNullable<AppleLookOptions["bin"]>>[0], args: string[]) => {
    const b = bin(name);
    if (!b) return null;
    const r = await runTool(b, args, { timeoutMs: 15_000, env });
    return r.code === 0 && !r.timedOut ? r.stdout.toString("utf8") : null;
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentes-xcode-"));
  let accounts = 0;
  let last: string | null = null;
  const done = (teams: AppleTeam[]) => {
    if (teams.length > 0) lastLookLine = "";
    return appleLookOf(teams, accounts, last);
  };
  try {
    for (const domain of ["com.apple.dt.Xcode", "com.apple.dt.xcodebuild"]) {
      // `defaults` reads what Xcode has in memory too; the file on disk can lag.
      const file = path.join(dir, `${domain}.plist`);
      if ((await run("defaults", ["export", domain, file])) === null) {
        notes.push(`no ${domain} settings`);
        continue;
      }
      const key = (k: string, as: string) => run("plutil", ["-extract", k, as, "-o", "-", file]);
      // JSON can't hold a date or data value: such a key is read as XML.
      const value = async (k: string): Promise<unknown> => {
        const json = await key(k, "json");
        try {
          if (json !== null) return JSON.parse(json);
        } catch {
          // read as XML below
        }
        const xml = await key(k, "xml1");
        try {
          return xml ? parsePlist(xml) : null;
        } catch {
          return null;
        }
      };
      if (domain === "com.apple.dt.Xcode") {
        const picked = (await key("IDEProvisioningTeamManagerLastSelectedTeamID", "raw"))?.trim() ?? "";
        if (TEAM_ID.test(picked)) last = picked;
        accounts = appleIdCount(await value("DVTDeveloperAccountManagerAppleIDLists"));
      }
      for (const k of ["IDEProvisioningTeamByIdentifier", "IDEProvisioningTeams"]) {
        const teams = parseXcodeTeams(await value(k));
        if (teams.length > 0) return done(teams);
      }
      notes.push(`no team in ${domain}`);
    }
    const home = env.HOME || os.homedir();
    const profiles: AppleTeam[] = [];
    let read = 0;
    for (const parts of PROFILE_DIRS) {
      const folder = path.join(home, ...parts);
      for (const name of await readdir(folder).catch(() => [] as string[])) {
        if (!/\.(mobileprovision|provisionprofile)$/.test(name)) continue;
        const file = path.join(folder, name);
        const mtime = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
        const cached = profileCache.get(file);
        let xml = cached?.mtime === mtime ? cached.xml : null;
        if (xml === null) {
          xml = await run("security", ["cms", "-D", "-i", file]);
          if (xml !== null) profileCache.set(file, { mtime, xml });
        }
        read++;
        const team = xml ? profileTeam(xml, now) : null;
        if (team) profiles.push(team);
      }
    }
    if (profiles.length > 0) return done(profiles);
    notes.push(`no team in ${read} profiles`);
    const valid = validIdentities((await run("security", ["find-identity", "-v", "-p", "codesigning"])) ?? "");
    const certs = valid.size
      ? certificatesOf(
          (await run("security", ["find-certificate", "-a", "-Z", "-c", "Apple Development", "-p"])) ?? "",
        ).filter((c) => valid.has(c.sha1))
      : [];
    const identities: AppleTeam[] = [];
    for (const [i, cert] of certs.entries()) {
      const pem = path.join(dir, `cert-${i}.pem`);
      await writeFile(pem, cert.pem);
      const team = subjectTeam((await run("openssl", ["x509", "-noout", "-subject", "-in", pem])) ?? "");
      if (team) identities.push(team);
    }
    if (identities.length > 0) return done(identities);
    notes.push(`no team in ${valid.size} signing identities (${certs.length} Apple Development)`);
    const line = `Apple teams: ${notes.join(", ")}; ${accounts} Apple Accounts listed`;
    if (line !== lastLookLine) o.log?.(line);
    lastLookLine = line;
    return done([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The teams of the Apple Accounts signed in to Xcode on this Mac (none: no account, or no Xcode). */
export const xcodeTeams = async (env: NodeJS.ProcessEnv = process.env) => (await appleLook({ env })).teams;

/** The Mac's screen is locked (`ioreg -n Root -d1`): Xcode can lose the account if it signs while the keychain is. */
export async function macScreenLocked(env: NodeJS.ProcessEnv = process.env) {
  const r = await runTool("/usr/sbin/ioreg", ["-n", "Root", "-d1"], { timeoutMs: 10_000, env });
  return r.code === 0 && /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(r.stdout.toString("utf8"));
}

/** How a team reads in Xcode's own signing menu: "Sam Rivera (Personal Team)". */
export const teamLabel = (t: AppleTeam) => (t.free ? `${t.name} (Personal Team)` : t.name);

/**
 * The helper's bundle id under this team: WDA's own (`com.facebook.WebDriverAgentRunner`) is taken for every free
 * team ("bundle identifier is not available"), so each team gets one of its own.
 */
export const helperBundleId = (teamId: string) => `chat.agentes.wda.${teamId.toLowerCase()}`;

/** `xcodebuild build-for-testing` for one simulator build or one iPhone's. */
export function buildArgs(
  project: string,
  derived: string,
  target: { kind: "simulator"; noTestingInterop?: boolean } | { kind: "device"; udid: string; team: string },
): string[] {
  const common = [
    "xcodebuild",
    "build-for-testing",
    "-project",
    project,
    "-scheme",
    "WebDriverAgentRunner",
    "-derivedDataPath",
    derived,
    "COMPILER_INDEX_STORE_ENABLE=NO",
    "GCC_TREAT_WARNINGS_AS_ERRORS=0",
  ];
  if (target.kind === "simulator") {
    return [
      ...common,
      "-destination",
      "generic/platform=iOS Simulator",
      // WDA embeds Swift Testing's interop library from Xcode 26's simulator platform, which some 26.x releases
      // don't ship: then it is left out with the frameworks WDA already leaves to Xcode.
      ...(target.noTestingInterop ? [`WDA_XCTEST_EXCLUDED_2600=${WDA_XCODE26_EXCLUDED}`] : []),
    ];
  }
  return [
    ...common,
    "-destination",
    `id=${target.udid}`,
    "-allowProvisioningUpdates",
    "-allowProvisioningDeviceRegistration",
    "CODE_SIGN_STYLE=Automatic",
    `DEVELOPMENT_TEAM=${target.team}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${helperBundleId(target.team)}`,
  ];
}

/** WDA's own list for Xcode 26 simulator builds (`WDA_XCTEST_EXCLUDED_2600`), plus its Swift Testing extras. */
const WDA_XCODE26_EXCLUDED =
  "XCTest.framework XCTestCore.framework XCUIAutomation.framework XCTAutomationSupport.framework Testing.framework ResultDataPublisher.framework XCTestSupport.framework libXCTestSwiftSupport.dylib lib_TestingInterop.dylib _Testing_Foundation.framework";

/** When a profile (`security cms -D` of an `embedded.mobileprovision`) stops working; null when unread. */
export function profileExpiry(plist: string): number | null {
  const at = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(plist)?.[1];
  const ms = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

// ── Downloads ─────────────────────────────────────────────────────────────────

/** `url`'s bytes, refused unless their SHA-256 is `sha256`. */
export async function downloadPinned(url: string, sha256: string, what: string, fetchImpl: typeof fetch = fetch) {
  let bytes: Buffer;
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new RunnerError(
      "internal",
      `Couldn't download ${what}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    );
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new RunnerError("internal", `The ${what} download didn't match its checksum, so it was not used.`);
  }
  return bytes;
}

// ── Talking to it ─────────────────────────────────────────────────────────────

/** An element of WDA's screen tree (`GET /source?format=json`). */
export interface WdaNode {
  type?: string;
  rawIdentifier?: string | null;
  name?: string | null;
  label?: string | null;
  value?: string | null;
  placeholderValue?: string | null;
  isVisible?: string | boolean | number;
  isEnabled?: string | boolean | number;
  rect?: { x: number; y: number; width: number; height: number };
  children?: WdaNode[];
}

/** What drives an iPhone's screen: WDA's HTTP API, or a fake in tests. Points, not pixels. */
export interface IosScreen {
  screenshot(): Promise<Buffer>;
  windowSize(): Promise<{ width: number; height: number }>;
  source(): Promise<WdaNode>;
  tap(x: number, y: number): Promise<void>;
  swipe(x1: number, y1: number, x2: number, y2: number, ms: number): Promise<void>;
  keys(text: string): Promise<void>;
  button(name: "home" | "volumeup" | "volumedown"): Promise<void>;
  lock(): Promise<void>;
  launch(bundleId: string): Promise<void>;
  terminate(bundleId: string): Promise<void>;
}

/** The helper stopped answering (gone, or stuck): it was dropped, and the next call starts a fresh one. */
export class HelperGone extends RunnerError {
  constructor(message: string) {
    super("internal", message);
  }
}

/** The helper answers, but not in time (a busy screen): asking again may work. */
export class HelperSlow extends RunnerError {
  constructor(message: string) {
    super("internal", message);
  }
}

export interface WdaClientOptions {
  /** The helper is gone or refused UI actions (`reason`): its run is dropped. */
  onGone?: (reason: PhoneReason | null) => void;
  /** Stops this client's calls too (a flow's): `scoped`. */
  signal?: AbortSignal;
}

/** WDA's tree without what our lookups never read: each attribute costs it a query per element. */
const SOURCE_ROUTE =
  "/source?format=json&excluded_attributes=accessible,focused,nativeAccessibilityElement,traits,nativeFrame";
/** One look at the screen: a lookup polls again until its own deadline when one takes longer. */
export const SOURCE_TIMEOUT_MS = 20_000;

export class WdaClient implements IosScreen {
  /** Shared by concurrent calls and scoped copies: WDA keeps one session, and a second one opened ends the first. */
  private readonly shared: { sid: Promise<string> | null };

  constructor(
    readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly opts: WdaClientOptions = {},
    shared?: { sid: Promise<string> | null },
  ) {
    this.shared = shared ?? { sid: null };
  }

  /** The same helper and session, its calls stopped when `signal` aborts. */
  scoped(signal: AbortSignal) {
    return new WdaClient(this.base, this.fetchImpl, { ...this.opts, signal }, this.shared);
  }

  /** One call; WDA's own error in words. `session`: under `/session/<id>` (one is made, again if it ended). */
  async call<T = unknown>(
    method: string,
    route: string,
    body?: unknown,
    opts: { session?: boolean; timeoutMs?: number } = {},
  ) {
    const stop = this.opts.signal;
    for (let attempt = 0; ; attempt++) {
      const prefix = opts.session ? `/session/${await this.session()}` : "";
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 60_000);
      const res = await this.fetchImpl(`${this.base}${prefix}${route}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        signal: stop ? AbortSignal.any([timeout, stop]) : timeout,
      }).catch(async (err: unknown) => {
        if (stop?.aborted) throw new RunnerError("internal", "Stopped");
        const words = `The test helper didn't answer: ${err instanceof Error ? err.message : String(err)}`;
        // Slow on a busy screen, yet up: the caller may ask again. Down, or stuck: it's started again. WDA answers
        // `/status` on a queue of its own, beside the call that timed out.
        if (timeout.aborted && (await this.ready())) throw new HelperSlow(words);
        this.opts.onGone?.(null);
        throw new HelperGone(words);
      });
      const json = (await res.json().catch(() => ({}))) as { value?: unknown; sessionId?: string };
      const value = json.value as { error?: string; message?: string } | undefined;
      if (res.ok && !(value && typeof value === "object" && "error" in value)) return json.value as T;
      if (opts.session && attempt === 0 && /invalid session/i.test(String(value?.error ?? value?.message))) {
        this.shared.sid = null;
        continue;
      }
      const said = String(value?.message ?? value?.error ?? res.status);
      if (helperReason(said) === "ui_not_authorized") {
        // Its test session can't act any more: the next op starts a fresh one.
        this.opts.onGone?.("ui_not_authorized");
        throw new RunnerError("phone_not_ready", REASON_WORDS.ui_not_authorized as string);
      }
      throw new RunnerError("internal", `The test helper said: ${said.split("\n")[0]?.slice(0, 300)}`);
    }
  }

  session() {
    this.shared.sid ??= this.openSession().catch((err: unknown) => {
      this.shared.sid = null;
      throw err;
    });
    return this.shared.sid;
  }

  private async openSession() {
    const res = await this.fetchImpl(`${this.base}/session`, {
      method: "POST",
      body: JSON.stringify({ capabilities: { alwaysMatch: { shouldWaitForQuiescence: false } } }),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(60_000),
    }).catch((err: unknown) => {
      this.opts.onGone?.(null);
      throw new HelperGone(`The test helper didn't answer: ${err instanceof Error ? err.message : String(err)}`);
    });
    const json = (await res.json().catch(() => ({}))) as { sessionId?: string; value?: { sessionId?: string } };
    const sid = json.sessionId ?? json.value?.sessionId;
    if (!sid) throw new RunnerError("internal", "The test helper didn't open a session.");
    // Without a bundle id `shouldWaitForQuiescence` does nothing: WDA would wait up to 10 s for an idle app before
    // every look at the screen, which a busy app (a chat, a feed) never is.
    await this.fetchImpl(`${this.base}/session/${sid}/appium/settings`, {
      method: "POST",
      body: JSON.stringify({ settings: { waitForIdleTimeout: 0, animationCoolOffTimeout: 0 } }),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    return sid;
  }

  async ready() {
    const res = await this.fetchImpl(`${this.base}/status`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    return res?.ok === true;
  }

  async screenshot() {
    const b64 = await this.call<string>("GET", "/screenshot");
    return Buffer.from(String(b64), "base64");
  }

  windowSize() {
    return this.call<{ width: number; height: number }>("GET", "/window/size", undefined, { session: true });
  }

  source() {
    return this.call<WdaNode>("GET", SOURCE_ROUTE, undefined, { session: true, timeoutMs: SOURCE_TIMEOUT_MS });
  }

  /** The phone's lock screen shows (no session needed). */
  async locked() {
    return (await this.call<boolean>("GET", "/wda/locked", undefined, { timeoutMs: 10_000 })) === true;
  }

  async tap(x: number, y: number) {
    await this.call("POST", "/wda/tap", { x, y }, { session: true });
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, ms: number) {
    const finger = [
      { type: "pointerMove", duration: 0, x: x1, y: y1 },
      { type: "pointerDown", button: 0 },
      { type: "pointerMove", duration: Math.max(50, Math.round(ms)), x: x2, y: y2 },
      { type: "pointerUp", button: 0 },
    ];
    await this.call(
      "POST",
      "/actions",
      { actions: [{ type: "pointer", id: "finger", parameters: { pointerType: "touch" }, actions: finger }] },
      { session: true },
    );
  }

  async keys(text: string) {
    await this.call("POST", "/wda/keys", { value: [...text] }, { session: true });
  }

  async button(name: "home" | "volumeup" | "volumedown") {
    if (name === "home") await this.call("POST", "/wda/homescreen");
    else await this.call("POST", "/wda/pressButton", { name }, { session: true });
  }

  async lock() {
    await this.call("POST", "/wda/lock");
  }

  async launch(bundleId: string) {
    await this.call("POST", "/wda/apps/launch", { bundleId, shouldWaitForQuiescence: false }, { session: true });
  }

  async terminate(bundleId: string) {
    await this.call("POST", "/wda/apps/terminate", { bundleId }, { session: true });
  }
}

/**
 * A flow's screen: each call goes to the phone's running helper (`get`), and one the helper died under is tried
 * once more on a fresh one, once a flow.
 */
export function recoveringScreen(get: () => Promise<IosScreen>): IosScreen {
  let recovered = false;
  const call = async <T>(f: (s: IosScreen) => Promise<T>): Promise<T> => {
    try {
      return await f(await get());
    } catch (err) {
      if (!(err instanceof HelperGone) || recovered) throw err;
      recovered = true;
      return f(await get());
    }
  };
  return {
    screenshot: () => call((s) => s.screenshot()),
    windowSize: () => call((s) => s.windowSize()),
    source: () => call((s) => s.source()),
    tap: (x, y) => call((s) => s.tap(x, y)),
    swipe: (x1, y1, x2, y2, ms) => call((s) => s.swipe(x1, y1, x2, y2, ms)),
    keys: (text) => call((s) => s.keys(text)),
    button: (name) => call((s) => s.button(name)),
    lock: () => call((s) => s.lock()),
    launch: (id) => call((s) => s.launch(id)),
    terminate: (id) => call((s) => s.terminate(id)),
  };
}

/**
 * WDA's MJPEG stream (multipart, each part with its `Content-Length`): `onFrame` gets every JPEG. Its server answers
 * only once the client has sent something, so it's asked like a web page.
 */
export function mjpegStream(port: number, onFrame: (jpeg: Buffer) => void) {
  const socket = net.connect(port, "127.0.0.1");
  let buf = Buffer.alloc(0);
  let headerDone = false;
  socket.on("connect", () => socket.write("GET / HTTP/1.0\r\n\r\n"));
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = buf.subarray(0, end).toString("latin1");
      if (!headerDone) {
        headerDone = true;
        buf = buf.subarray(end + 4);
        continue;
      }
      const length = Number(/Content-Length:\s*(\d+)/i.exec(head)?.[1] ?? Number.NaN);
      if (!Number.isFinite(length)) {
        buf = buf.subarray(end + 4);
        continue;
      }
      if (buf.length < end + 4 + length) return;
      onFrame(Buffer.from(buf.subarray(end + 4, end + 4 + length)));
      buf = buf.subarray(end + 4 + length);
    }
  });
  const closed = new Promise<void>((resolve) => {
    socket.on("close", () => resolve());
    socket.on("error", () => resolve());
  });
  return { closed, close: () => socket.destroy() };
}

// ── Building and running ──────────────────────────────────────────────────────

/** What a real iPhone's helper needs, as the phone's state shows it; null: it's ready. */
export type HelperNeed = { state: "preparing" | "needs_you"; reason: PhoneReason } | null;

interface BuildMeta {
  xcode: string;
  team?: string;
  builtAt: number;
  expiresAt?: number;
  /** When the helper first ran on the phone (UI Automation on, the developer trusted). */
  checkedAt?: number;
}

interface Failure {
  reason: PhoneReason;
  detail: string;
  at: number;
  /** It failed running, not building: the next try only runs it again. */
  check: boolean;
  /** Failures in a row (`retryWait`). */
  tries: number;
  /** Xcode's words matched none of the reasons: `detail` is all there is to say. */
  unknown: boolean;
  /** No team to sign with, found before xcodebuild ran: tried again each minute, as cheap as the look. */
  precheck?: boolean;
}

export interface WdaRun {
  child: ChildProcess;
  client: WdaClient;
  mjpegPort: number;
  forwards: { close(): void }[];
  lastUsed: number;
  /** An op or a viewer uses it: a setup check leaves it running. */
  kept: boolean;
  frames: {
    latest: Buffer | null;
    waiters: ((jpeg: Buffer) => void)[];
    close(): void;
    idle: ReturnType<typeof setTimeout> | undefined;
  } | null;
}

export interface IosHelperOptions {
  /** The OS user's home: builds live in `<home>/.agentes-runner/wda`, shared by every runner of this user. */
  home: string;
  /** Where runners of this user lock the phones they hold (`PhoneManager`'s `lockDir`). */
  phoneLocks?: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  now?: () => number;
  fetch?: typeof fetch;
  usbmuxSocket?: string;
  /** Tests: the teams Xcode has, or the whole look (default `appleLook`). */
  teams?: () => Promise<AppleTeam[] | AppleLook>;
  /** Tests: the Mac's screen is locked (default `macScreenLocked`). */
  screenLocked?: () => Promise<boolean>;
}

/** A helper used this recently answered then: older, it's asked whether it still runs before it's handed out. */
const HEALTHY_FOR_MS = 5000;

const frameTimeoutMs = 5000;
const FRAMES_IDLE_MS = 30_000;
/** WDA's own MJPEG settings, which the live view uses; a recording raises them while it lasts. */
const MJPEG_DEFAULTS = { mjpegServerScreenshotQuality: 25, mjpegServerFramerate: 10 };

/** Which wait a failure gets before the next try. */
const retryOf = (f: Failure): keyof typeof RETRY_MS =>
  f.check || f.reason === "locked" || f.reason === "device_support"
    ? "check"
    : f.reason === "apple_account_missing"
      ? "account"
      : "other";

/**
 * The wait before the next try. One the person must fix (a setting on the iPhone, an account) doubles with each
 * failure in a row: each try runs a UI test on the phone, which ends any the person runs from Xcode. A locked or busy
 * phone is tried again soon.
 */
const retryWait = (f: Failure) =>
  f.reason === "locked" || f.reason === "device_support"
    ? RETRY_MS.check
    : f.precheck
      ? RETRY_MS.account
      : Math.min(RETRY_MS[retryOf(f)] * 2 ** (f.tries - 1), RETRY_MS.other);

export class IosHelper {
  private readonly dir: string;
  private readonly now: () => number;
  /** A build or a setup check under way, per phone (`simulator` for every simulator). */
  private readonly busy = new Map<string, Promise<void>>();
  private readonly failed = new Map<string, Failure>();
  private readonly running = new Map<string, WdaRun>();
  private readonly starting = new Map<string, Promise<WdaRun>>();
  /** Phones an op is starting the helper for: a setup check finishing meanwhile leaves it running. */
  private readonly wanted = new Set<string>();
  private xcode: string | null = null;
  /** The last build waited for the Mac's screen to be unlocked (`Deferred`). */
  private macLocked = false;

  constructor(private readonly opts: IosHelperOptions) {
    this.dir = path.join(opts.home, ".agentes-runner", "wda");
    this.now = opts.now ?? Date.now;
  }

  keyOf(kind: PhoneKind, udid: string) {
    return kind === "simulator" ? "simulator" : udid.replace(/[^\w-]/g, "_");
  }

  private meta(key: string) {
    return readJson<BuildMeta>(path.join(this.dir, key, "meta.json"));
  }

  private ends(meta: BuildMeta) {
    return meta.expiresAt ?? (meta.team ? meta.builtAt + FREE_PROFILE_MS : Number.POSITIVE_INFINITY);
  }

  private usable(meta: BuildMeta | null): meta is BuildMeta {
    return meta !== null && this.now() < this.ends(meta);
  }

  /** Built for this Xcode, and its profile isn't about to run out. */
  private fresh(meta: BuildMeta | null) {
    if (meta === null || (this.xcode && meta.xcode !== this.xcode)) return false;
    const renewAt = this.ends(meta) - RENEW_BEFORE_MS;
    // Xcode keeps a profile until it runs out: a renewal that got the same one waits for that end, not a new build
    // every poll.
    return this.now() < renewAt || (meta.builtAt >= renewAt && this.now() < this.ends(meta));
  }

  private fail(key: string, f: Omit<Failure, "tries" | "at">) {
    this.failed.set(key, { ...f, at: this.now(), tries: (this.failed.get(key)?.tries ?? 0) + 1 });
  }

  /** Another runner of this OS user (another workspace) holds the phone: running the helper there would end theirs. */
  private heldElsewhere(udid: string) {
    const dir = this.opts.phoneLocks ?? path.join(this.opts.home, ".agentes-runner", "phone-locks");
    const holder = readLock(dir, `ios_${udid.replace(/[^\w.-]/g, "_")}.lock`);
    return holder !== null && holder.pid !== process.pid && pidAlive(holder.pid);
  }

  /** Why the phone's helper can't be set up, when Xcode said something none of the reasons cover. */
  unknownFailure(udid: string): string | null {
    const failure = this.failed.get(this.keyOf("device", udid));
    return failure?.unknown ? failure.detail : null;
  }

  private async xcodeVersion(xcrun: string) {
    if (this.xcode) return this.xcode;
    const r = await runTool(xcrun, ["xcodebuild", "-version"], { timeoutMs: 30_000, env: this.opts.env });
    this.xcode = /Xcode\s+([\d.]+)/.exec(r.stdout.toString("utf8"))?.[1] ?? "unknown";
    return this.xcode;
  }

  /**
   * A real iPhone's helper as its checklist shows it: building (preparing), needing the person (the reason), or
   * ready (null). A build, a renewal or a setup check starts in the background when one is due.
   */
  need(udid: string, xcrun: string | null): HelperNeed {
    const key = this.keyOf("device", udid);
    const meta = this.meta(key);
    const failure = this.failed.get(key);
    if (xcrun) this.kick(key, xcrun, udid, meta, failure);
    // A renewal that failed leaves the build it would replace working until that one runs out.
    const renewing = failure && !failure.check && this.usable(meta) && meta.checkedAt;
    if (failure && !renewing)
      return { state: failure.reason === "device_support" ? "preparing" : "needs_you", reason: failure.reason };
    // Not built and nothing failed: it's being built, here or by another runner of this user.
    if (!this.usable(meta)) return { state: "preparing", reason: meta ? "helper_expired" : "helper_missing" };
    return meta.checkedAt ? null : { state: "preparing", reason: "helper_missing" };
  }

  private kick(key: string, xcrun: string, udid: string, meta: BuildMeta | null, failure: Failure | undefined) {
    if (!this.xcode) void this.xcodeVersion(xcrun);
    if (this.busy.has(key) || this.starting.has(udid) || this.running.has(udid)) return;
    if (failure && this.now() - failure.at < retryWait(failure)) return;
    if (!this.fresh(meta)) void this.build(key, xcrun, { kind: "device", udid });
    else if ((!meta?.checkedAt || failure) && !this.heldElsewhere(udid)) this.check(key, xcrun, udid);
  }

  /** Builds (or renews) one helper; concurrent asks share it. A failure is kept for `need` and `run` to say. */
  private build(key: string, xcrun: string, target: { kind: "simulator" } | { kind: "device"; udid: string }) {
    const pending = this.busy.get(key);
    if (pending) return pending;
    // Every runner of this OS user (one per workspace) shares the builds: one of them builds each.
    const lock = acquireLock(path.join(this.dir, "locks"), "phone", { file: `${key}.lock` });
    if (!lock.ok) return Promise.resolve();
    const job = this.buildNow(key, xcrun, target)
      .then(() => {
        this.failed.delete(key);
      })
      .catch((err: unknown) => {
        if (err instanceof Deferred) {
          if (!this.macLocked) this.opts.log(`iPhone test helper: waiting, ${err.message}`);
          this.macLocked = true;
          return;
        }
        const detail = err instanceof Error ? err.message : String(err);
        const known = err instanceof HelperFailure ? err.reason : null;
        const reason = known ?? (this.meta(key) ? "helper_expired" : "helper_missing");
        const precheck = err instanceof HelperFailure && err.precheck;
        this.fail(key, { reason, detail, check: false, unknown: known === null, ...(precheck ? { precheck } : {}) });
        // A missing team is looked for again each minute: said once.
        if (!precheck || this.failed.get(key)?.tries === 1) this.opts.log(`iPhone test helper: ${detail}`);
      })
      .finally(() => {
        lock.release();
        this.busy.delete(key);
      });
    this.busy.set(key, job);
    return job;
  }

  /** The pinned source, downloaded, checked and unpacked once. */
  private async source(): Promise<string> {
    const root = path.join(this.dir, "src", `WebDriverAgent-${WDA_VERSION}`);
    const project = path.join(root, "WebDriverAgent.xcodeproj");
    if (existsSync(project)) return project;
    const bytes = await downloadPinned(WDA_URL, WDA_SHA256, "the iPhone test helper", this.opts.fetch);
    const tmp = path.join(this.dir, `src-${process.pid}-${this.now()}`);
    await mkdir(tmp, { recursive: true });
    try {
      await writeFile(path.join(tmp, "wda.tar.gz"), bytes);
      const r = await runTool("/usr/bin/tar", ["-xzf", path.join(tmp, "wda.tar.gz"), "-C", tmp], {
        timeoutMs: 120_000,
      });
      if (r.code !== 0)
        throw new RunnerError("internal", `Unpacking the iPhone test helper failed: ${r.stderr.trim()}`);
      await mkdir(path.dirname(root), { recursive: true });
      await rm(root, { recursive: true, force: true });
      await rename(path.join(tmp, `WebDriverAgent-${WDA_VERSION}`), root);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return project;
  }

  private async buildNow(key: string, xcrun: string, target: { kind: "simulator" } | { kind: "device"; udid: string }) {
    const xcode = await this.xcodeVersion(xcrun);
    let team: AppleTeam | undefined;
    if (target.kind === "device") {
      // One report has Xcode 27 dropping the account when it signs while the keychain is locked.
      if (await (this.opts.screenLocked ?? (() => macScreenLocked(this.opts.env)))())
        throw new Deferred("the Mac's screen is locked");
      this.macLocked = false;
      const found = await (this.opts.teams ?? (() => appleLook({ env: this.opts.env, log: this.opts.log })))();
      const look = Array.isArray(found) ? appleLookOf(found, 0) : found;
      team = look.teams[0];
      if (!team && look.account === "no_team")
        throw new HelperFailure("apple_team_missing", "Xcode is signed in but shows no team yet.", true);
      if (!team) throw new HelperFailure("apple_account_missing", "Xcode isn't signed in to an Apple Account.", true);
    }
    const project = await this.source();
    const derived = path.join(this.dir, key);
    await mkdir(derived, { recursive: true });
    this.opts.log(`building the iPhone test helper (${target.kind === "device" ? target.udid : "simulator"})`);
    let args: string[];
    if (target.kind === "device" && team) args = buildArgs(project, derived, { ...target, team: team.id });
    else {
      const platform = await runTool(xcrun, ["--sdk", "iphonesimulator", "--show-sdk-platform-path"], {
        timeoutMs: 30_000,
        env: this.opts.env,
      });
      const dir = platform.code === 0 ? platform.stdout.toString("utf8").trim() : "";
      const interop = !dir || existsSync(path.join(dir, "Developer", "usr", "lib", "lib_TestingInterop.dylib"));
      args = buildArgs(project, derived, { kind: "simulator", noTestingInterop: !interop });
    }
    const r = await runTool(xcrun, args, { timeoutMs: BUILD_TIMEOUT_MS, env: this.opts.env });
    const said = `${r.stdout.toString("utf8")}\n${r.stderr}`;
    if (r.code !== 0 || r.timedOut) {
      throw new HelperFailure(helperReason(said), r.timedOut ? "The build didn't finish in time." : failureLine(said));
    }
    const meta: BuildMeta = { xcode, builtAt: this.now(), ...(team ? { team: team.id } : {}) };
    if (team) {
      const app = path.join(derived, "Build", "Products", "Debug-iphoneos", "WebDriverAgentRunner-Runner.app");
      const decoded = await runTool(
        "/usr/bin/security",
        ["cms", "-D", "-i", path.join(app, "embedded.mobileprovision")],
        {
          timeoutMs: 10_000,
          env: this.opts.env,
        },
      );
      const ends = decoded.code === 0 ? profileExpiry(decoded.stdout.toString("utf8")) : null;
      if (ends) meta.expiresAt = ends;
      // A renewal under the same team needs no new check: the phone already trusts it.
      const before = this.meta(key);
      if (before?.checkedAt && before.team === team.id) meta.checkedAt = before.checkedAt;
    }
    writeJson(path.join(derived, "meta.json"), meta);
  }

  /** Runs a new build once on its phone: UI Automation on and the developer trusted, or what's missing. */
  private check(key: string, xcrun: string, udid: string) {
    const job = this.start(key, xcrun, "device", udid).then(
      (run) => {
        const meta = this.meta(key);
        if (meta) writeJson(path.join(this.dir, key, "meta.json"), { ...meta, checkedAt: this.now() });
        if (!run.kept && !this.wanted.has(udid)) this.stop(udid);
      },
      () => undefined,
    );
    this.busy.set(
      key,
      job.finally(() => this.busy.delete(key)),
    );
  }

  /** The phone's helper running (a simulator's built first when needed); it stays up until `stop`. */
  async run(kind: PhoneKind, udid: string, xcrun: string): Promise<WdaRun> {
    const key = this.keyOf(kind, udid);
    const up = this.running.get(udid);
    if (up && (this.now() - up.lastUsed < HEALTHY_FOR_MS || (await up.client.ready()))) {
      up.lastUsed = this.now();
      up.kept = true;
      return up;
    }
    if (up && this.running.get(udid) === up) {
      this.opts.log(`iPhone test helper: ${udid} stopped answering, starting it again`);
      this.drop(udid, up);
    }
    if (this.heldElsewhere(udid)) {
      throw new RunnerError("phone_busy", "Another workspace's connection on this computer is using this iPhone.");
    }
    if (kind === "simulator") {
      if (!this.fresh(this.meta(key))) await this.build(key, xcrun, { kind: "simulator" });
      const failure = this.failed.get(key);
      if (!this.meta(key) && failure) {
        throw new RunnerError("internal", `The simulator's test helper didn't build: ${failure.detail}`);
      }
    } else if (!this.usable(this.meta(key))) {
      this.need(udid, xcrun);
      await this.busy.get(key);
      if (!this.usable(this.meta(key))) {
        const failure = this.failed.get(key);
        throw new RunnerError(
          "phone_not_ready",
          failure
            ? helperWords(failure.reason, failure.detail)
            : this.macLocked
              ? "This Mac's screen is locked, and the test helper is signed only while it's unlocked. Unlock the Mac, then try again."
              : "The test helper is still being set up on this Mac.",
        );
      }
    }
    this.wanted.add(udid);
    try {
      const run = await this.start(key, xcrun, kind, udid);
      run.kept = true;
      run.lastUsed = this.now();
      return run;
    } finally {
      this.wanted.delete(udid);
    }
  }

  private start(key: string, xcrun: string, kind: PhoneKind, udid: string): Promise<WdaRun> {
    const up = this.running.get(udid);
    if (up) return Promise.resolve(up);
    const pending = this.starting.get(udid);
    if (pending) return pending;
    const job = this.startNow(key, xcrun, kind, udid).finally(() => this.starting.delete(udid));
    this.starting.set(udid, job);
    return job;
  }

  private async xctestrun(key: string, kind: PhoneKind) {
    const products = path.join(this.dir, key, "Build", "Products");
    const want = kind === "simulator" ? "iphonesimulator" : "iphoneos";
    const name = (await readdir(products).catch(() => [] as string[])).find(
      (n) => n.endsWith(".xctestrun") && n.includes(want),
    );
    if (!name) throw new RunnerError("internal", "The test helper's build is missing.");
    return path.join(products, name);
  }

  private async startNow(key: string, xcrun: string, kind: PhoneKind, udid: string): Promise<WdaRun> {
    const xctestrun = await this.xctestrun(key, kind);
    const sim = kind === "simulator";
    const [port, mjpeg] = sim ? await Promise.all([freePort(), freePort()]) : [DEVICE_PORT, DEVICE_MJPEG_PORT];
    const env = {
      ...this.opts.env,
      TEST_RUNNER_USE_PORT: String(port),
      TEST_RUNNER_MJPEG_SERVER_PORT: String(mjpeg),
      // Loopback only: nobody on the Mac's or the iPhone's network can drive the phone; usbmuxd reaches it there.
      TEST_RUNNER_USE_IP: "127.0.0.1",
    };
    const args = ["xcodebuild", "test-without-building", "-xctestrun", xctestrun, "-destination", `id=${udid}`];
    const started = startTool(xcrun, args, { env });
    const child = started.child;
    if (!child) throw new RunnerError("internal", "The test helper couldn't start.");
    let said = "";
    // The tail: why it stopped comes last, after a long run's output.
    const hear = (chunk: Buffer) => {
      said = (said + chunk.toString("utf8")).slice(-256 * 1024);
    };
    child.stdout?.on("data", hear);
    child.stderr?.on("data", hear);
    let gone = false;
    void started.done.then(() => {
      gone = true;
    });
    const forwards: { close(): void }[] = [];
    const fail = (err: RunnerError) => {
      killTree(child, "SIGTERM");
      for (const f of forwards) f.close();
      return err;
    };
    let http = port;
    let frames = mjpeg;
    if (!sim) {
      try {
        const socket = this.opts.usbmuxSocket ?? USBMUXD_SOCKET;
        const a = await usbmuxForward(udid, DEVICE_PORT, socket);
        forwards.push(a);
        const b = await usbmuxForward(udid, DEVICE_MJPEG_PORT, socket);
        forwards.push(b);
        http = a.port;
        frames = b.port;
      } catch (err) {
        throw fail(err instanceof RunnerError ? err : new RunnerError("internal", String(err)));
      }
    }
    let run: WdaRun | null = null;
    const client = new WdaClient(`http://127.0.0.1:${http}`, this.opts.fetch, {
      onGone: (reason) => {
        if (reason && !sim) this.fail(key, { reason, detail: reason, check: true, unknown: false });
        if (run && this.running.get(udid) === run) this.drop(udid, run);
      },
    });
    const deadline = this.now() + (sim ? 180_000 : 300_000);
    while (!(await client.ready())) {
      if (gone || this.now() > deadline) {
        const reason = helperReason(said);
        const detail = gone ? failureLine(said) : "The test helper didn't start in time.";
        if (!sim) this.fail(key, { reason: reason ?? "helper_missing", detail, check: true, unknown: reason === null });
        throw fail(
          reason && reason !== "helper_expired"
            ? new RunnerError("phone_not_ready", helperWords(reason, detail))
            : new RunnerError("internal", `The test helper stopped: ${detail}`),
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!sim) this.failed.delete(key);
    const up: WdaRun = { child, client, mjpegPort: frames, forwards, lastUsed: this.now(), kept: false, frames: null };
    run = up;
    this.running.set(udid, up);
    void started.done.then(() => {
      if (this.running.get(udid) !== up) return;
      const reason = helperReason(said);
      this.opts.log(`iPhone test helper stopped (${udid}): ${failureLine(said) || "no words"}`);
      if (reason && !sim) this.fail(key, { reason, detail: failureLine(said), check: true, unknown: false });
      this.drop(udid, up);
    });
    return up;
  }

  private drop(udid: string, run: WdaRun) {
    this.running.delete(udid);
    run.frames?.close();
    killTree(run.child, "SIGTERM");
    for (const f of run.forwards) f.close();
  }

  /** Stops the phone's helper (the phone was let go). */
  stop(udid: string) {
    const run = this.running.get(udid);
    if (run) this.drop(udid, run);
  }

  stopAll() {
    for (const [udid, run] of [...this.running]) this.drop(udid, run);
  }

  /** Stops helpers nobody used for `HELPER_IDLE_MS`, except those of `held` phones (by UDID). */
  reap(held: ReadonlySet<string>) {
    for (const [udid, run] of [...this.running]) {
      if (!held.has(udid) && this.now() - run.lastUsed >= HELPER_IDLE_MS) this.drop(udid, run);
    }
  }

  /** The next frame of the phone's MJPEG stream (it opens on the first ask), else the last one after a while. */
  nextFrame(run: WdaRun, signal?: AbortSignal): Promise<Buffer> {
    run.lastUsed = this.now();
    if (!run.frames) {
      const frames: NonNullable<WdaRun["frames"]> = { latest: null, waiters: [], close: () => {}, idle: undefined };
      const stream = mjpegStream(run.mjpegPort, (jpeg) => {
        frames.latest = jpeg;
        for (const w of frames.waiters.splice(0)) w(jpeg);
      });
      frames.close = stream.close;
      void stream.closed.then(() => {
        if (run.frames === frames) run.frames = null;
      });
      run.frames = frames;
    }
    const frames = run.frames;
    // A view that stopped asking: the phone stops filming itself for it.
    clearTimeout(frames.idle);
    frames.idle = setTimeout(frames.close, FRAMES_IDLE_MS);
    return new Promise<Buffer>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        frames.waiters = frames.waiters.filter((w) => w !== take);
        signal?.removeEventListener("abort", aborted);
      };
      const take = (jpeg: Buffer) => {
        done();
        resolve(jpeg);
      };
      const aborted = () => {
        done();
        reject(new RunnerError("internal", "Stopped"));
      };
      const timer = setTimeout(() => {
        done();
        if (frames.latest) resolve(frames.latest);
        else reject(new RunnerError("internal", "The iPhone's screen sent no picture."));
      }, frameTimeoutMs);
      if (signal?.aborted) return aborted();
      signal?.addEventListener("abort", aborted, { once: true });
      frames.waiters.push(take);
    });
  }

  /**
   * Records the phone's MJPEG stream into an MP4 with ffmpeg, for at most `limitSeconds`. Timestamps are the
   * frames' arrival: WDA sends one whenever it read the screen, not at a fixed rate.
   */
  async record(run: WdaRun, ffmpeg: string, file: string, limitSeconds: number, signal: AbortSignal) {
    const encoder = await this.encoder(ffmpeg);
    // Sharper and smoother than the live view's defaults (quality 25, 10 a second), for a video someone watches.
    await run.client
      .call(
        "POST",
        "/appium/settings",
        { settings: { mjpegServerScreenshotQuality: 60, mjpegServerFramerate: 15 } },
        { session: true },
      )
      .catch(() => undefined);
    // stderr unread would fill its pipe and stall ffmpeg.
    const child = spawn(ffmpeg, ffmpegArgs(encoder, file), { stdio: ["pipe", "ignore", "ignore"], env: this.opts.env });
    (child.stdin as unknown as EventEmitter | null)?.on("error", () => {});
    const stream = mjpegStream(run.mjpegPort, (jpeg) => {
      run.lastUsed = this.now();
      if (child.stdin?.writable) child.stdin.write(jpeg);
    });
    const exited = new Promise<void>((resolve) => {
      (child as unknown as EventEmitter).on("close", () => resolve());
      (child as unknown as EventEmitter).on("error", () => resolve());
    });
    let finishing: Promise<void> | null = null;
    const stop = () =>
      (finishing ??= (async () => {
        clearTimeout(timer);
        stream.close();
        child.stdin?.end();
        void run.client
          .call("POST", "/appium/settings", { settings: MJPEG_DEFAULTS }, { session: true, timeoutMs: 5000 })
          .catch(() => undefined);
        const kill = setTimeout(() => child.kill("SIGKILL"), 30_000);
        await exited;
        clearTimeout(kill);
      })());
    const timer = setTimeout(() => void stop(), limitSeconds * 1000);
    signal.addEventListener("abort", () => void stop(), { once: true });
    void stream.closed.then(() => void stop());
    return { done: exited.then(() => stop()), stop };
  }

  /** The ffmpeg to record with: the one installed, else the pinned build, fetched and checked on first use. */
  async ffmpeg(found: string | null): Promise<string> {
    if (found) return found;
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const file = path.join(this.opts.home, ".agentes-runner", "tools", `ffmpeg-${FFMPEG_RELEASE}`);
    if (existsSync(file)) return file;
    const gz = await downloadPinned(
      `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-darwin-${arch}.gz`,
      FFMPEG_SHA256[arch] as string,
      "ffmpeg",
      this.opts.fetch,
    );
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, gunzipSync(gz), { mode: 0o755 });
    await chmod(tmp, 0o755);
    await rename(tmp, file);
    return file;
  }

  /** H.264 with the Mac's own encoder when this ffmpeg has it, else x264. */
  private async encoder(ffmpeg: string) {
    const r = await runTool(ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 20_000, env: this.opts.env });
    const list = r.stdout.toString("utf8");
    return /h264_videotoolbox/.test(list) ? "h264_videotoolbox" : /libx264/.test(list) ? "libx264" : "mpeg4";
  }
}

/** ffmpeg reading JPEGs on stdin into an MP4 that plays everywhere, its long side at most 1280. */
export const ffmpegArgs = (encoder: string, file: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-use_wallclock_as_timestamps",
  "1",
  "-f",
  "mjpeg",
  "-i",
  "pipe:0",
  "-vf",
  "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
  "-c:v",
  encoder,
  "-b:v",
  "2M",
  "-pix_fmt",
  "yuv420p",
  "-fps_mode",
  "vfr",
  "-movflags",
  "+faststart",
  "-y",
  file,
];

class HelperFailure extends Error {
  constructor(
    readonly reason: PhoneReason | null,
    message: string,
    readonly precheck = false,
  ) {
    super(message);
  }
}

/** Not now, and nothing failed: the next poll tries again. */
class Deferred extends Error {}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    (server as unknown as EventEmitter).once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The keys the live view presses. */
export type PhoneKey = Parameters<PhoneScreenDriver["key"]>[0];

// ── Live view ─────────────────────────────────────────────────────────────────

/**
 * The live view's driver for an iPhone or a simulator: frames from the helper's MJPEG stream, input through it.
 * Coordinates are the frame's pixels; WDA takes points, so they're scaled by the window's size.
 */
export function wdaScreenDriver(
  helper: IosHelper,
  phone: { serial: string; kind: PhoneKind },
  xcrun: string,
): PhoneScreenDriver {
  let frame: { width: number; height: number } | null = null;
  let points: { width: number; height: number } | null = null;
  const run = () => helper.run(phone.kind, phone.serial, xcrun);
  const scale = async (r: WdaRun) => {
    points ??= await r.client.windowSize();
    const f = frame ?? points;
    return { sx: points.width / f.width, sy: points.height / f.height };
  };
  return {
    async frame(signal) {
      const r = await run();
      const jpeg = await helper.nextFrame(r, signal);
      const size = jpegSize(jpeg);
      if (!size) throw new RunnerError("internal", "The iPhone's screen sent no picture.");
      frame = size;
      return { jpeg, ...size };
    },
    async tap(x, y) {
      const r = await run();
      const { sx, sy } = await scale(r);
      await r.client.tap(x * sx, y * sy);
    },
    async swipe(x1, y1, x2, y2, ms) {
      const r = await run();
      const { sx, sy } = await scale(r);
      await r.client.swipe(x1 * sx, y1 * sy, x2 * sx, y2 * sy, ms);
    },
    async text(s) {
      await (await run()).client.keys(s);
    },
    async key(key) {
      const r = await run();
      await pressKey(r.client, key, await r.client.windowSize());
    },
  };
}

/** A phone key on an iPhone: the buttons it has, the keyboard's keys, gestures for the rest. */
export async function pressKey(screen: IosScreen, key: PhoneKey, size: { width: number; height: number }) {
  switch (key) {
    case "home":
      return screen.button("home");
    case "volume_up":
      return screen.button("volumeup");
    case "volume_down":
      return screen.button("volumedown");
    case "power":
      return screen.lock();
    case "enter":
      return screen.keys("\n");
    case "delete":
      return screen.keys("\b");
    // No back button on an iPhone: the swipe in from the left edge that goes back in most apps.
    case "back":
      return screen.swipe(2, size.height / 2, size.width * 0.6, size.height / 2, 250);
    // The app switcher: a slow swipe up from the bottom edge, held halfway.
    case "app_switch":
      return screen.swipe(size.width / 2, size.height - 2, size.width / 2, size.height * 0.55, 900);
  }
}
