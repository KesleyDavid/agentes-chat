import type { TFunction } from "i18next";
import type {
  AccountLoginStatus,
  DeviceLocation,
  Machine,
  MachineAccess,
  MachineAccount,
  MachineAccountKind,
  MachineFolderGrant,
  MachineToolName,
} from "../api/types";
import { errorCode, sendWaits } from "./errors";
import { formatBytes } from "./files";

/**
 * Connected computers (ADR 0025, ADR 0036): the device code, the commands the
 * site shows, and what a machine allows. Platform-neutral (web and phone).
 */

/** The alphabet of device codes (no 0/O, 1/I/L). */
const CODE_RE = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;

/** "k7q·4zp", "K7Q-4ZP " → "K7Q4ZP" (what the API takes). */
export const normalizeUserCode = (raw: string) => raw.toUpperCase().replace(CODE_RE, "").slice(0, 12);

/** "K7Q4ZP" → "K7Q·4ZP", shown on both sides only to compare. */
export function formatUserCode(raw: string): string {
  const code = normalizeUserCode(raw);
  if (code.length < 4) return code;
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}·${code.slice(half)}`;
}

/** "Curitiba, PR, Brasil" from the server's best-effort location; null when there is nothing to say. */
export function locationText(loc: DeviceLocation | null | undefined): string | null {
  if (!loc) return null;
  if (typeof loc === "string") return loc.trim() || null;
  const parts = [loc.city, loc.region, loc.country].map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Quotes a path for a POSIX shell only when it needs it. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The terminal installer (servers, Linux): no code; it prints one to confirm in the browser. */
export const installCommand = (origin: string) =>
  `curl -fsSL ${origin.replace(/\/+$/, "")}/api/machines/install.sh | sh`;

/** Granting happens on the machine: the fallback command for people without the app. */
export const allowFolderCommand = (path: string, handle?: string) =>
  `agentes-runner folders allow ${shellQuote(path)}${handle ? ` --agent ${handle}` : ""}`;

/**
 * Why a computer can't run its agent browser or desktop use yet, in the person's words (`machines.reasons.<code>`).
 * A runner from before reason codes says it in its own English: with `install`, the code its reason means when it
 * carries a command to run (the command shows in its own block, `commandInReason`), else its English.
 */
export function machineReasonText(
  t: TFunction,
  info: { reason: string | null; code?: string | null } | null | undefined,
  install?: string,
): string | null {
  const code = info?.code ?? (install && commandInReason(info?.reason) ? install : null);
  if (!code) return info?.reason ?? null;
  const tt = t as unknown as (key: string, options: { defaultValue: string }) => string;
  return tt(`machines.reasons.${code}`, { defaultValue: info?.reason ?? "" }) || (info?.reason ?? null);
}

/** The first command in a runner's own words ("…run `agentes-runner browser install --with-deps`"), to copy. */
export function commandInReason(reason: string | null | undefined): string | null {
  const m = reason ? /`([^`]+)`/.exec(reason) : null;
  return m?.[1] ?? null;
}

/**
 * Turns a tool on at the computer (`desktop`: the agents' screens): its runner's settings, which are root's in system
 * mode (ADR 0057).
 */
export const toolOnCommand = (m: Pick<Machine, "mode">, tool: keyof MachineAccess["tools"]) =>
  `${m.mode === "system" ? "sudo " : ""}agentes-runner tools enable ${tool}`;

/** A Mac or a PC: folders and tools are allowed in the agentes.chat app there. Any other may be a server without it. */
export const allowsInApp = (os: string | null | undefined) => os === "darwin" || os === "windows";

/**
 * `brain.reasons.tool_off`'s line for a brain whose tool is off on `m`: the app's Preferences on a Mac or a PC, and on
 * any other computer the command too.
 */
export function toolOffReason(
  m: Pick<Machine, "os" | "mode"> | null | undefined,
  kind: "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity",
) {
  if (!m || allowsInApp(m.os)) return { key: "brain.reasons.tool_off" as const, command: "" };
  return {
    key: "brain.reasons.tool_offLinux" as const,
    command: toolOnCommand(m, kind === "claude_code" ? "claude" : kind),
  };
}

/** The last part of a path: "/Users/you/Projects/loja-v5" → "loja-v5". */
export function folderName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export const MACHINE_TOOLS: MachineToolName[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "grok",
  "antigravity",
  "commands",
];

/** The folders of a machine an agent may use (beyond its own folder). */
export const foldersOfAgent = (access: MachineAccess | null | undefined, agentId: string): MachineFolderGrant[] =>
  (access?.folders ?? []).filter((f) => f.agents.includes(agentId));

/** Agents of the grant every agent on the computer has (`ALL_AGENTS` in the machine protocol). */
const ALL_AGENTS = "*";

/** The computer's shared folder (ADR 0115): its folder granted to every agent; null when its runner has none. */
export const sharedFolderOf = (access: MachineAccess | null | undefined): string | null =>
  access?.folders.find((f) => f.agents.includes(ALL_AGENTS))?.path ?? null;

/** The folders people allowed, without the shared folder (a row of its own that nobody removes). */
export const allowedFolders = (access: MachineAccess | null | undefined): MachineFolderGrant[] =>
  (access?.folders ?? []).filter((f) => !f.agents.includes(ALL_AGENTS));

/** The shared folder row's facts: its size (or not measured yet) and what is free on the disk. */
export function sharedFolderFacts(t: TFunction, locale: string, disk: Machine["disk"]): string {
  const gb = (n: number) => formatBytes(locale, n * 2 ** 30);
  return [
    disk?.sharedGb != null ? t("machines.shared.size", { size: gb(disk.sharedGb) }) : t("machines.shared.measuring"),
    ...(disk ? [t("machines.shared.free", { free: gb(disk.freeGb) })] : []),
  ].join(" · ");
}

/** Paused now: `until` absent or still ahead. */
export function isPaused(m: Pick<Machine, "paused">, now = Date.now()): boolean {
  const p = m.paused;
  // The server sends `{ until }` while paused and null otherwise; `paused: false` means not paused too.
  if (!p || p.paused === false) return false;
  if (!p.until) return true;
  const end = Date.parse(p.until);
  return Number.isNaN(end) || end > now;
}

/** The download link as given, or on `origin` when the server sends a path. */
export const downloadHref = (url: string, origin = "") => (/^https?:\/\//.test(url) ? url : `${origin}${url}`);

/** The systems the desktop app runs on (`window.__agentesDesktop.platform` on the site, `{{device}}` in the copy). */
export type Platform = "mac" | "windows" | "linux";

/** From a user agent: WKWebView or a Mac's browser, WebView2 or a Windows browser, and everything else as Linux. */
export function platformOf(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  return "linux";
}

/** A phone or a tablet, from its browser's user agent: the app is for computers. */
export const isHandheld = (userAgent: string) => /Android|iPhone|iPad|iPod/i.test(userAgent);

/** A desktop build, as `/api/desktop/latest` asks for it. */
export interface DesktopBuild {
  target: "darwin" | "windows" | "linux";
  arch: "aarch64" | "x86_64";
}

/**
 * The app's build for the computer a browser runs on: one build for both Mac chips; x64 or ARM64 on Windows and
 * Linux. A Windows browser says x64 even on ARM (Windows runs x64 apps there, emulated), unless `cpu` (the browser's
 * own `userAgentData` architecture, `desktopCpu`) says "arm". Null where none fits: a phone or a tablet, or a Linux
 * on another chip.
 */
export function desktopTargetOf(userAgent: string, cpu?: string | null): DesktopBuild | null {
  const platform = platformOf(userAgent);
  if (isHandheld(userAgent)) return null;
  if (platform === "mac") return { target: "darwin", arch: "aarch64" };
  const arm = cpu === "arm" || /\b(aarch64|arm64)\b/i.test(userAgent);
  if (platform === "linux" && !arm && !/x86_64|x64|amd64/i.test(userAgent)) return null;
  return { target: platform, arch: arm ? "aarch64" : "x86_64" };
}

/**
 * The computer's architecture as a Chromium browser reports it (`navigator.userAgentData`, "arm" or "x86"): the one
 * way to tell a Windows on ARM. Null where the browser doesn't say (Safari, Firefox).
 */
export async function desktopCpu(): Promise<string | null> {
  const data = (
    globalThis.navigator as
      | { userAgentData?: { getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string }> } }
      | undefined
  )?.userAgentData;
  if (!data?.getHighEntropyValues) return null;
  try {
    return (await data.getHighEntropyValues(["architecture"])).architecture ?? null;
  } catch {
    return null;
  }
}

/** Which portrait a computer gets; same names as `ComputerKind` in @agenteschat/ui. */
export type ComputerKind = "mac" | "windows" | "linux";
export type ComputerState = "online" | "paused" | "offline";

/** A machine's `os` → its portrait: Macs, Windows PCs, and everything else drawn as a Linux server. */
export function computerKind(os: string | null | undefined): ComputerKind {
  const v = (os ?? "").toLowerCase();
  if (v === "darwin" || v === "macos" || v === "mac") return "mac";
  if (v === "windows" || v === "win32") return "windows";
  return "linux";
}

/**
 * Who may turn a tool off or take a folder away here: an admin or whoever connected it, never on the
 * workspace's own computer, where nobody in the workspace could turn them back on (ADR 0056 §10).
 */
export const canReduceAccess = (m: Pick<Machine, "canManage" | "kind">) => m.canManage && m.kind !== "managed";

/** Paused wins over online (a paused machine is still connected); otherwise online or offline. */
export function computerState(m: Pick<Machine, "online" | "paused">, now = Date.now()): ComputerState {
  if (isPaused(m, now)) return "paused";
  return m.online ? "online" : "offline";
}

/**
 * Which `machines.host.*` line says what the server's own computer is: one
 * user per agent on Linux (the runner's system mode there), the installer's
 * own user on a Mac, neither said until it first connects.
 */
export function hostDescKey(os: string): "descUsers" | "descShared" | "desc" {
  if (os === "linux") return "descUsers";
  return os === "darwin" ? "descShared" : "desc";
}

/** What a computer is called on screen: its name, or `hostLabel` for the server's own until its runner names it. */
export const machineTitle = (m: Pick<Machine, "name" | "kind">, hostLabel: string) =>
  m.name || (m.kind === "host" ? hostLabel : "");

/**
 * Whether a line about where something runs names the computer (`GET …/machines`, every member's list): only
 * where the workspace has more than one. The Cloud's own computer, or a server's only one, tells nothing.
 */
export const namesComputers = (machines: readonly unknown[] | null | undefined) => (machines?.length ?? 0) > 1;

/**
 * A code pasted for a Claude sign-in is this sign-in's when it ends with `#<state>` of its link (what
 * Claude's page shows). Only then does a paste go to the computer without a tap: anything else from the
 * clipboard (a password) waits for the person.
 */
export function isSignInCode(text: string, signInUrl: string): boolean {
  let state: string | null = null;
  try {
    state = new URL(signInUrl).searchParams.get("state");
  } catch {
    return false;
  }
  const code = text.trim();
  return Boolean(state) && code.length > (state?.length ?? 0) + 1 && code.endsWith(`#${state}`) && !/\s/.test(code);
}

/** What starts a sign-in on the computer (`beginAccountLogin`'s options). */
export interface AccountLoginInput {
  accountId?: string;
  email?: string;
  provider?: string;
}

/**
 * Starts a sign-in on the computer: again to `again` (signed out), or a coding plan's key account (`provider`). Claude
 * takes `hint`, the email of the account it should be, as its CLI's login hint: the account's own when it signs in
 * again, never asked of the person. A hint the server refuses only steered Claude's page, so it starts without one.
 */
export async function beginLogin<T>(
  begin: (input: AccountLoginInput) => Promise<T>,
  kind: MachineAccountKind,
  { again, provider, hint }: { again?: string | undefined; provider?: string | undefined; hint?: string | null },
): Promise<T> {
  const input: AccountLoginInput = { ...(again ? { accountId: again } : {}), ...(provider ? { provider } : {}) };
  if (kind !== "claude_code" || provider || !hint) return begin(input);
  try {
    return await begin({ ...input, email: hint });
  } catch (error) {
    if (errorCode(error) !== "account.invalid_email") throw error;
    return begin(input);
  }
}

/**
 * The account a sign-in came back as when its person already has it on that computer (the new sign-in is removed
 * there): theirs to think with instead, while it is signed in and no agent thinks with it, or it thinks for all of
 * their agents there (`shared`).
 */
export function freeDuplicate(status: AccountLoginStatus | undefined): MachineAccount | null {
  const account = status?.duplicate?.account;
  return account?.status === "active" && (account.usedBy.length === 0 || account.shared === true) ? account : null;
}

/**
 * A new sign-in came back as another account than its hint (Claude's login hint only steers Claude's page): the
 * person's to use or not, never thought with on its own.
 */
export const otherThanHint = (hint: string | null | undefined, account: Pick<MachineAccount, "email">): boolean =>
  Boolean(hint && account.email && account.email.toLowerCase() !== hint.toLowerCase());

/**
 * How long a sign-in's status reads may keep failing before it fails: a server restart and the runner's reconnect.
 * After a drop the runner dials again 1, 2, 4, 8, 16, then 32 s apart (`backoffDelay` in the runner, ±20 %). A restart
 * of up to about 30 s (deploy/deploy.sh) can miss the fifth dial, at 25 to 37 s, and wait for the sixth, at up to
 * 76 s; this covers it and the next read.
 */
export const LOGIN_RECONNECT_MS = 90_000;

/** A read of a sign-in's status that failed while the server restarts or the computer reconnects. */
export const loginReadPasses = (error: unknown) => {
  const code = errorCode(error);
  return sendWaits(error) || code === "machine.offline" || code === "machine.timeout";
};

/**
 * A read that failed in a way that passes (`loginReadPasses`), and when this run of failed reads began: counted from
 * its first failure, so a page back from the background isn't failed by the time it spent there.
 */
export class LoginReadError extends Error {
  constructor(
    cause: unknown,
    readonly since: number,
  ) {
    super("The sign-in can't be read for now", { cause });
    this.name = "LoginReadError";
  }
}

/** Where reading a sign-in's status stands (`loginRead`); null while it reads. */
export type LoginRead = "reconnecting" | "noAnswer" | "failed" | null;

/**
 * `reconnecting` while the reads fail in a way that passes, up to `LOGIN_RECONNECT_MS` from the first of them;
 * `noAnswer` past that; `failed` at once on any other error. The sign-in goes on on the computer meanwhile, and the
 * next answer picks it up.
 */
export function loginRead(status: { isError: boolean; error: unknown; errorUpdatedAt: number }): LoginRead {
  if (!status.isError) return null;
  if (!(status.error instanceof LoginReadError)) return "failed";
  return status.errorUpdatedAt - status.error.since < LOGIN_RECONNECT_MS ? "reconnecting" : "noAnswer";
}
