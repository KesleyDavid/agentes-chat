/**
 * The pure parts of the setup: options, .env editing, what Tailscale's status and Docker's errors mean,
 * the plan and the next steps. Everything that touches the disk, Docker or the terminal is in cli.ts.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderUnicodeCompact } from "uqr";

/** Every instance serves its own build's compose file there; agentes.chat's follows main, so it can be ahead of `:latest`. */
export const COMPOSE_URL = "https://agentes.chat/install/docker-compose.yml";
/** `INSTALL_DOCS_URL` in @agenteschat/i18n, as text: this MIT package bundles none of the AGPL workspace. */
export const GUIDE_URL = "https://agentes.chat/docs/install-on-a-server";
export const ISSUES_URL = "https://github.com/agentes-chat/agentes-chat/issues";
export const IMAGE = "ghcr.io/agentes-chat/agentes:latest";
/** The compose file's Tailscale serve config is inline (`configs.content`), which Compose reads from 2.23.1 on. */
export const MIN_COMPOSE = "2.23.1";
export const DEFAULT_HOSTNAME = "agentes";
export const DEFAULT_TAG = "tag:agentes";
export const DEFAULT_TIMEOUT_S = 300;
export const DEFAULT_EMAIL_API_URL = "https://api.millionsend.com";
/** The names Compose looks for, in the order it prefers them: the setup reads the file Compose runs. */
export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"] as const;
/** Whether a download is a compose file, not a web page or an error some server sent instead. */
export const isComposeFile = (text: string) => /^services:/m.test(text);

/** Tailscale admin console pages the steps send people to. */
export const TS = {
  signup: "https://login.tailscale.com/start",
  dns: "https://console.tailscale.com/admin/dns",
  keys: "https://console.tailscale.com/admin/settings/keys",
  machines: "https://console.tailscale.com/admin/machines",
  users: "https://console.tailscale.com/admin/users",
  policy: "https://console.tailscale.com/admin/acls",
  trust: "https://console.tailscale.com/admin/settings/trust-credentials",
  download: "https://tailscale.com/download",
} as const;

export const NETWORKS = ["tailscale", "domain", "local"] as const;
/** The ways in the setup sets up, or "proxy": a PUBLIC_URL of your own (nginx, a tunnel), which it keeps. */
export type Network = (typeof NETWORKS)[number] | "proxy";
export const EMAIL_CHOICES = ["skip", "smtp", "api"] as const;
export type EmailChoice = (typeof EMAIL_CHOICES)[number];
const YES_NO = ["yes", "no"] as const;
const ON_OFF = ["on", "off"] as const;
export type OnOff = (typeof ON_OFF)[number];

/** A check that failed, said so that a person or an agent can act on it. */
export interface Problem {
  check: string;
  error: string;
  fix: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface Options {
  network?: (typeof NETWORKS)[number];
  tailscaleKey?: string;
  tailscaleTag: string;
  hostname?: string;
  domain?: string;
  email?: EmailChoice;
  smtpUrl?: string;
  emailApiKey?: string;
  emailApiUrl?: string;
  emailFrom?: string;
  computer?: (typeof YES_NO)[number];
  computerCommands?: (typeof YES_NO)[number];
  /** `--requirements`: what to install for the agents without asking (`[]`: nothing); absent, asked. */
  requirements?: Requirement[];
  telemetry?: OnOff;
  typesafeKey?: string;
  start: boolean;
  tailscaleStatus?: string;
  timeout: number;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

const OPTIONS = {
  network: { type: "string" },
  "tailscale-key": { type: "string" },
  "tailscale-tag": { type: "string" },
  hostname: { type: "string" },
  domain: { type: "string" },
  email: { type: "string" },
  "smtp-url": { type: "string" },
  "email-api-key": { type: "string" },
  "email-api-url": { type: "string" },
  "email-from": { type: "string" },
  computer: { type: "string" },
  "computer-commands": { type: "string" },
  requirements: { type: "string" },
  telemetry: { type: "string" },
  "typesafe-key": { type: "string" },
  "no-start": { type: "boolean" },
  "tailscale-status": { type: "string" },
  timeout: { type: "string" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type OptionName = keyof typeof OPTIONS;

/** `tailscale-key` → `AGENTES_SETUP_TAILSCALE_KEY`: every option can come from the environment too. */
export const envName = (option: string) => `AGENTES_SETUP_${option.toUpperCase().replaceAll("-", "_")}`;

/** Flags first, then `AGENTES_SETUP_*` variables; every value checked the way a typed answer is. */
export function parseOptions(
  argv: string[],
  env: Record<string, string | undefined>,
): { options: Options } | { error: string } {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }));
  } catch (error) {
    return { error: `${(error as Error).message}. Run with --help for the options.` };
  }
  const text = (name: OptionName): string | undefined => {
    const value = typeof values[name] === "string" ? (values[name] as string) : env[envName(name)];
    return value?.trim() || undefined;
  };
  const flag = (name: OptionName) => values[name] === true || /^(1|true|yes)$/i.test(env[envName(name)]?.trim() ?? "");

  const network = text("network");
  if (network !== undefined && !isOneOf(network, NETWORKS))
    return { error: "--network is tailscale, domain or local." };
  const email = text("email");
  if (email !== undefined && !isOneOf(email, EMAIL_CHOICES)) return { error: "--email is skip, smtp or api." };
  const computer = text("computer");
  if (computer !== undefined && !isOneOf(computer, YES_NO)) return { error: "--computer is yes or no." };
  const commands = text("computer-commands");
  if (commands !== undefined && !isOneOf(commands, YES_NO)) return { error: "--computer-commands is yes or no." };
  const requirementsText = text("requirements");
  const requirements = requirementsText === undefined ? undefined : parseRequirements(requirementsText);
  if (requirements === null) {
    return { error: `--requirements is all, none, or some of ${REQUIREMENTS.join(", ")} (comma-separated).` };
  }
  const telemetry = text("telemetry");
  if (telemetry !== undefined && !isOneOf(telemetry, ON_OFF)) return { error: "--telemetry is on or off." };
  const timeoutText = text("timeout");
  const timeout = timeoutText === undefined ? DEFAULT_TIMEOUT_S : Number(timeoutText);
  if (!Number.isInteger(timeout) || timeout < 1) return { error: "--timeout is a number of seconds." };

  const checks: [OptionName, string | undefined, (value: string) => string | null][] = [
    ["tailscale-key", text("tailscale-key"), tailscaleKeyProblem],
    ["tailscale-tag", text("tailscale-tag"), tagProblem],
    ["hostname", text("hostname"), hostnameProblem],
    ["domain", text("domain"), (v) => domainProblem(normalizeDomain(v))],
    ["smtp-url", text("smtp-url"), smtpUrlProblem],
    ["email-api-url", text("email-api-url"), httpUrlProblem],
    ["email-from", text("email-from"), emailFromProblem],
    ["typesafe-key", text("typesafe-key"), jevKeyProblem],
  ];
  for (const [name, value, problem] of checks) {
    const found = value === undefined ? null : problem(value);
    if (found) return { error: `--${name}: ${found}` };
  }
  const domain = text("domain");
  return {
    options: {
      ...(network ? { network } : {}),
      ...optional("tailscaleKey", text("tailscale-key")),
      tailscaleTag: text("tailscale-tag") ?? DEFAULT_TAG,
      ...optional("hostname", text("hostname")),
      ...optional("domain", domain === undefined ? undefined : normalizeDomain(domain)),
      ...(email ? { email } : {}),
      ...optional("smtpUrl", text("smtp-url")),
      ...optional("emailApiKey", text("email-api-key")),
      ...optional("emailApiUrl", text("email-api-url")),
      ...optional("emailFrom", text("email-from")),
      ...(computer ? { computer } : {}),
      ...(commands ? { computerCommands: commands } : {}),
      ...(requirements ? { requirements } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...optional("typesafeKey", text("typesafe-key")),
      start: !flag("no-start"),
      ...optional("tailscaleStatus", text("tailscale-status")),
      timeout,
      dryRun: flag("dry-run"),
      json: flag("json"),
      help: flag("help"),
    },
  };
}

const optional = <K extends string>(key: K, value: string | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>;

function isOneOf<T extends string>(value: string, list: readonly T[]): value is T {
  return (list as readonly string[]).includes(value);
}

/** A problem said as a sentence of its own: the options' messages start lowercase, after `--flag: `. */
export const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A command's output line as the line under a wait shows it: no colors, and no mark of the agentes.chat look,
 * in its ASCII form too (where the font lacks the marks, they are followed by two spaces).
 */
export const outputLine = (line: string) =>
  line
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's escapes are what it leaves out
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/^\s*(?:[◇◆●○▲■◒◐◓◑│]\s+|[ox?*!-] {2})?/u, "")
    .trim();

/** What a command said last: its last line with words, as `outputLine` shows it (a failure's reason). */
export const lastLine = (output: string) =>
  output
    .split(/\r\n|\r|\n/)
    .map(outputLine)
    .filter(Boolean)
    .pop() ?? "";

/** A step whose command is on a line of its own (`\n$ `), as one plain sentence: `--json` returns it that way. */
export const plainStep = (step: string) => step.replaceAll("\n$ ", " ");

/** A typed answer to a numbered list: its number, or the value itself (`2` or `domain`). */
export function resolveChoice<T extends string>(answer: string, values: readonly T[]): T | null {
  const typed = answer.trim().toLowerCase();
  const byNumber = /^\d+$/.test(typed) ? values[Number(typed) - 1] : undefined;
  return byNumber ?? (isOneOf(typed, values) ? typed : null);
}

// ── Answers ─────────────────────────────────────────────────────────────────

export function tailscaleKeyProblem(key: string): string | null {
  if (key.startsWith("tskey-api-")) {
    return "that's an API access token. Paste an auth key (tskey-auth-…) or an OAuth client secret (tskey-client-…).";
  }
  if (!/^tskey-(auth|client)-[A-Za-z0-9-]{8,}(\?[A-Za-z0-9=&]+)?$/.test(key)) {
    return "that isn't a Tailscale auth key: one starts with tskey-auth- (or tskey-client- for an OAuth client secret) and has no spaces.";
  }
  return null;
}

export const tagProblem = (tag: string) =>
  /^tag:[A-Za-z0-9][A-Za-z0-9-]*$/.test(tag) ? null : "a tag looks like tag:agentes.";

export const hostnameProblem = (name: string) =>
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)
    ? null
    : "a device name has lowercase letters, digits and dashes, like agentes.";

/** "https://Chat.Example.com/" → "chat.example.com": people paste addresses as often as names. */
export const normalizeDomain = (input: string) =>
  input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");

export function domainProblem(domain: string): string | null {
  if (domain.endsWith(".ts.net")) return "a ts.net name comes from Tailscale: choose Tailscale instead.";
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(domain)) {
    return "that isn't a domain name like chat.example.com.";
  }
  return null;
}

export function smtpUrlProblem(url: string): string | null {
  const parsed = parseUrl(url);
  return parsed && (parsed.protocol === "smtp:" || parsed.protocol === "smtps:") && parsed.hostname
    ? null
    : "that isn't an SMTP URL like smtps://user:password@smtp.example.com:465 (percent-encode special characters in the user and password).";
}

export function httpUrlProblem(url: string): string | null {
  const parsed = parseUrl(url);
  return parsed && (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname
    ? null
    : "that isn't an address like https://api.resend.com.";
}

/** The name every email is sent under: the server's own default sender's (`SENDER_NAME` in packages/engine/src/email.ts). */
const SENDER_NAME = "agentes.chat";

/** A sender at `domain`, as the server's default one reads. */
export const senderAt = (domain: string) => `${SENDER_NAME} <ping@${domain}>`;

/** The sender the setup offers: at a public domain only, which a provider can verify (a ts.net name or localhost no). */
export const senderFor = (network: Network, domain: string | null) =>
  network === "domain" && domain ? senderAt(domain) : undefined;

/** The shapes `EMAIL_FROM` takes: a bare address, or `Name <address>`. */
export const emailFromProblem = (from: string) =>
  /^(?:[^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)
    ? null
    : `that isn't a sender like "${senderAt("example.com")}".`;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// ── .env ────────────────────────────────────────────────────────────────────

/** The top of a .env the setup creates. */
export const ENV_HEADER = `# agentes.chat settings, written by npx @agenteschat/setup (running it again is safe). The guide:
# ${GUIDE_URL}. AGENTES_SECRET encrypts the keys stored in the
# database: back it up apart from the database, and never change it.
`;

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Every `KEY=value` of a .env as Compose reads them: the last line of a key wins, as in
 * `cp .env.example .env` followed by appended values.
 */
export function envEntries(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = ENV_LINE.exec(line);
    if (match?.[1]) entries.set(match[1], unquoteEnvValue((match[2] ?? "").trim()));
  }
  return entries;
}

/** The value of `KEY=` (`envEntries`). Null when the line is absent, "" when it is empty. */
export function envValue(content: string | null, key: string): string | null {
  return envEntries(content ?? "").get(key) ?? null;
}

/**
 * Rewrites a key where it first appears, drops its other lines so the new value is the one Compose
 * reads, and appends the keys the file lacks. Comments and every other line stay as they are.
 */
export function upsertEnv(content: string, entries: Record<string, string>): string {
  const wanted = new Map(Object.entries(entries));
  const written = new Set<string>();
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    const key = ENV_LINE.exec(line)?.[1];
    const value = key === undefined ? undefined : wanted.get(key);
    if (key === undefined || value === undefined) lines.push(line);
    else if (!written.has(key)) {
      written.add(key);
      lines.push(`${key}=${quoteEnvValue(value)}`);
    }
  }
  const missing = [...wanted].filter(([key]) => !written.has(key));
  if (missing.length > 0) {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const [key, value] of missing) lines.push(`${key}=${quoteEnvValue(value)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * A value Compose reads back unchanged: as is when it has only plain characters, else in single quotes
 * (nothing is interpolated inside them), else double quotes. A line break would start a new key.
 */
export function quoteEnvValue(value: string): string {
  const flat = value.replace(/[\r\n]/g, "");
  if (/^[\w@%+=:,./-]*$/.test(flat)) return flat;
  if (!flat.includes("'")) return `'${flat}'`;
  // ponytail: a "$" inside double quotes is left for Compose to interpolate; no value the setup writes has both quote kinds.
  return `"${flat.replace(/[\\"]/g, "\\$&")}"`;
}

export function unquoteEnvValue(raw: string): string {
  const quote = raw[0];
  if ((quote === "'" || quote === '"') && raw.length >= 2 && raw.endsWith(quote)) {
    const inner = raw.slice(1, -1);
    return quote === '"' ? inner.replace(/\\([\\"])/g, "$1") : inner;
  }
  // Unquoted, " #" starts a comment.
  return raw.replace(/\s+#.*$/, "");
}

const list = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** How a .env says people reach the instance; null for a .env that says nothing yet. */
export function networkOf(content: string | null): Network | null {
  const profiles = list(envValue(content, "COMPOSE_PROFILES"));
  if (profiles.includes("tailscale")) return "tailscale";
  if (profiles.includes("https") || envValue(content, "DOMAIN")) return "domain";
  const url = envValue(content, "PUBLIC_URL");
  return !url ? null : isLocalUrl(url) ? "local" : "proxy";
}

type Profile = "tailscale" | "https" | null;

/**
 * What a run writes about the way in before anything starts: the .env lines (PUBLIC_URL only when it
 * changes) and the profile in COMPOSE_PROFILES. Tailscale's address is written once it has joined, a
 * public domain stays on localhost without Caddy until its owner exists (the first sign-up owns the
 * instance), and your own proxy's address is kept.
 */
export function wayIn(
  content: string | null,
  network: Network,
  domain: string | null,
): { entries: Record<string, string>; profile: Profile } {
  const now = envValue(content, "PUBLIC_URL");
  const local = `http://localhost:${envValue(content, "HOST_PORT") || "3000"}`;
  if (network === "domain") {
    const live = now === `https://${domain}`;
    return {
      entries: { ...(domain ? { DOMAIN: domain } : {}), ...(live || now === local ? {} : { PUBLIC_URL: local }) },
      profile: live ? "https" : null,
    };
  }
  // A DOMAIN left behind would take the next run back to the public domain.
  const entries: Record<string, string> = envValue(content, "DOMAIN") ? { DOMAIN: "" } : {};
  if (network === "local" && !isLocalUrl(now)) entries.PUBLIC_URL = local;
  return { entries, profile: network === "tailscale" ? "tailscale" : null };
}

/**
 * The command that removes the containers of a way in the .env drops: `docker compose up` leaves a
 * service of a disabled profile running, so a switch to Tailscale would keep Caddy serving the public
 * domain. Null when nothing is dropped.
 */
export function stopCommand(content: string | null, profile: Profile): string[] | null {
  const enabled = list(envValue(content, "COMPOSE_PROFILES"));
  const off = (["tailscale", "https"] as const).filter((name) => name !== profile && enabled.includes(name));
  if (off.length === 0) return null;
  const service = { tailscale: "tailscale", https: "caddy" };
  return ["compose", ...off.flatMap((name) => ["--profile", name]), "rm", "-sf", ...off.map((name) => service[name])];
}

/**
 * `COMPOSE_PROFILES` with one way in: `tailscale`, `https` (Caddy) or neither. Other profiles stay. The
 * content comes back unchanged when the profiles already match.
 */
export function withNetworkProfile(content: string, profile: Profile): string {
  const current = list(envValue(content, "COMPOSE_PROFILES"));
  const next = [...current.filter((p) => p !== "tailscale" && p !== "https"), ...(profile ? [profile] : [])];
  return next.join(",") === current.join(",") ? content : upsertEnv(content, { COMPOSE_PROFILES: next.join(",") });
}

/** What the compose file needs and the .env lacks: the master secret and the database password. */
export function secretEntries(content: string | null): Record<string, string> {
  return {
    ...(envValue(content, "AGENTES_SECRET") ? {} : { AGENTES_SECRET: randomBytes(48).toString("base64") }),
    // Hex: the compose file puts it inside the database URL.
    ...(envValue(content, "POSTGRES_PASSWORD") ? {} : { POSTGRES_PASSWORD: randomBytes(24).toString("hex") }),
  };
}

/**
 * The .env lines for a pasted key. An OAuth client secret registers a tagged device that stays (not
 * ephemeral) and needs no approval; the tag must be one the OAuth client was created with.
 */
export function tailscaleKeyEntries(key: string, tag: string, extraArgs: string | null): Record<string, string> {
  if (!key.startsWith("tskey-client-")) return { TS_AUTHKEY: key };
  const args = (extraArgs ?? "").split(/\s+/).filter((arg) => arg && !arg.startsWith("--advertise-tags"));
  return {
    TS_AUTHKEY: key.includes("?") ? key : `${key}?ephemeral=false&preauthorized=true`,
    TS_EXTRA_ARGS: [...args, `--advertise-tags=${tag}`].join(" "),
  };
}

/** A yes/no value as the server reads it (Zod's `stringbool` words); null when absent, empty or neither. */
export function envFlag(content: string | null, key: string): boolean | null {
  const value = (envValue(content, key) ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on", "y", "enabled"].includes(value)) return true;
  if (["false", "0", "no", "off", "n", "disabled"].includes(value)) return false;
  return null;
}

export const isTailnetUrl = (url: string | null) => /^https:\/\/[^/]+\.ts\.net\/?$/i.test(url ?? "");

export const isLocalUrl = (url: string | null) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url ?? "");

// ── Tailscale ───────────────────────────────────────────────────────────────

/** A tailnet setting's fix doesn't say "run the setup again": on a terminal, the setup waits for the click. */
export const PROBLEMS = {
  magicDns: {
    check: "tailscale.magicdns",
    error: "MagicDNS is off in your tailnet, so devices can't find this server by name.",
    fix: `Open ${TS.dns} and click "Enable MagicDNS".`,
  },
  https: {
    check: "tailscale.https",
    error: "HTTPS certificates are off in your tailnet.",
    fix: `Open ${TS.dns}, under "HTTPS Certificates" click "Enable HTTPS" and confirm.`,
  },
  key: {
    check: "tailscale.key",
    error: "Tailscale refused the auth key: it expired, was revoked, or was a one-off key that's already used.",
    fix: `Generate a new one at ${TS.keys} ("Generate auth key"), then run the setup again with it.`,
  },
  keyMissing: {
    check: "tailscale.key",
    error: "Tailscale needs an auth key to add this server to your tailnet.",
    fix: `Generate one at ${TS.keys} ("Generate auth key") and pass it: --tailscale-key tskey-auth-… (or AGENTES_SETUP_TAILSCALE_KEY).`,
  },
  approval: {
    check: "tailscale.approval",
    error: "This server is waiting for approval in your tailnet.",
    fix: `Open ${TS.machines}, find the server marked "Needs approval", and choose Approve in its … menu. A pre-approved auth key skips this.`,
  },
} satisfies Record<string, Problem>;

export const tagProblemFor = (tag: string): Problem => ({
  check: "tailscale.tag",
  error: `Tailscale refused the tag ${tag} for this key.`,
  fix: `Pass the tag the OAuth client was created with (--tailscale-tag), and list it under "tagOwners" in ${TS.policy}.`,
});

export type TailnetState =
  | { kind: "ready"; url: string; keyExpiry: string | null }
  | { kind: "waiting"; reason: "starting" | "approval" | "login" }
  | { kind: "problem"; problem: Problem };

/** What `tailscale status --json` says: on the tailnet with HTTPS (and the address), still on its way, or why not. */
export function readTailscaleStatus(raw: string): TailnetState {
  let status: {
    BackendState?: unknown;
    CurrentTailnet?: { MagicDNSEnabled?: unknown } | null;
    CertDomains?: unknown;
    Self?: { KeyExpiry?: unknown } | null;
  };
  try {
    status = JSON.parse(raw);
  } catch {
    return { kind: "waiting", reason: "starting" };
  }
  if (status.BackendState === "NeedsMachineAuth") return { kind: "waiting", reason: "approval" };
  if (status.BackendState === "NeedsLogin") return { kind: "waiting", reason: "login" };
  if (status.BackendState !== "Running") return { kind: "waiting", reason: "starting" };
  if (status.CurrentTailnet?.MagicDNSEnabled === false) return { kind: "problem", problem: PROBLEMS.magicDns };
  const domain = Array.isArray(status.CertDomains) ? status.CertDomains[0] : undefined;
  if (typeof domain !== "string" || !domain) return { kind: "problem", problem: PROBLEMS.https };
  const expiry = status.Self?.KeyExpiry;
  return { kind: "ready", url: `https://${domain}`, keyExpiry: typeof expiry === "string" ? expiry : null };
}

/** The latest thing the tailscale container's log says went wrong, or that it waits for approval. */
export function diagnoseTailscaleLogs(logs: string, tag: string): Problem | "approval" | null {
  for (const line of logs.split("\n").reverse()) {
    if (/invalid key|unable to validate API key|key (has )?expired/i.test(line)) return PROBLEMS.key;
    if (/tags?\b.*\b(invalid|not permitted)/i.test(line)) return tagProblemFor(tag);
    if (/machine authorization required/i.test(line)) return "approval";
    if (/ensure that HTTPS is enabled|HTTPS cert support is not enabled/i.test(line)) return PROBLEMS.https;
  }
  return null;
}

// ── Docker ──────────────────────────────────────────────────────────────────

/** `2.29.7`, `v2.29.7-desktop.1` and the like, compared by their first three numbers. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => /(\d+)\.(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number) ?? null;
  const [have, need] = [parse(version), parse(min)];
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return (have[i] ?? 0) > (need[i] ?? 0);
  }
  return true;
}

export type Platform = "linux" | "darwin" | "win32" | string;

const desktopUrl = (platform: Platform) =>
  platform === "win32"
    ? "https://docs.docker.com/desktop/setup/install/windows-install/"
    : "https://docs.docker.com/desktop/setup/install/mac-install/";

export const dockerProblems = (platform: Platform) => ({
  missing: {
    check: "docker",
    error: "Docker isn't installed.",
    fix:
      platform === "linux"
        ? "Install it with Docker's script, curl -fsSL https://get.docker.com | sudo sh, then run the setup again."
        : `Install Docker Desktop (${desktopUrl(platform)}), open it, then run the setup again.`,
  },
  compose: {
    check: "docker.compose",
    error: "Docker Compose v2 (docker compose) isn't installed.",
    fix:
      platform === "linux"
        ? "Install it with Docker's script, curl -fsSL https://get.docker.com | sudo sh (it includes Compose), or see https://docs.docker.com/compose/install/linux/. Then run the setup again."
        : "Update Docker Desktop, which includes Compose, then run the setup again.",
  },
  composeOld: (version: string): Problem => ({
    check: "docker.compose",
    error: `Docker Compose ${version} is too old: this compose file needs ${MIN_COMPOSE} or newer.`,
    fix:
      platform === "linux"
        ? "Update Docker (on Debian or Ubuntu with Docker's repository: sudo apt-get update && sudo apt-get install docker-compose-plugin), then run the setup again."
        : "Update Docker Desktop, then run the setup again.",
  }),
  down: {
    check: "docker.daemon",
    error: "Docker is installed but not running.",
    fix:
      platform === "linux"
        ? "Start it with sudo systemctl start docker, then run the setup again."
        : "Open Docker Desktop and wait until it says it's running, then run the setup again.",
  },
  permission: {
    check: "docker.permission",
    error: "Your user can't use Docker (permission denied on /var/run/docker.sock).",
    fix: "Add yourself to the docker group, sudo usermod -aG docker $USER, log out and back in, then run the setup again.",
  },
});

/** Why `docker version` failed: not running, or not allowed. */
export function diagnoseDocker(output: string, platform: Platform): Problem {
  const problems = dockerProblems(platform);
  return /permission denied/i.test(output) ? problems.permission : problems.down;
}

/** A `docker compose` failure people hit often, said with its fix; null for anything else. */
export function diagnoseCompose(output: string, platform: Platform): Problem | null {
  const busy = output.split("\n").find((line) => /port is already allocated|address already in use/i.test(line));
  if (busy !== undefined) {
    const port = /:(\d{2,5})(?!\d)/.exec(busy)?.[1] ?? "3000";
    const who = platform === "darwin" ? `lsof -nP -iTCP:${port} -sTCP:LISTEN` : `sudo ss -ltnp 'sport = :${port}'`;
    return port === "80" || port === "443"
      ? {
          check: "port",
          error: `Port ${port} on this machine is in use by another program, and a public domain needs ports 80 and 443.`,
          fix: `Stop that program (${who} shows which), then run the setup again.`,
        }
      : {
          check: "port",
          error: `Port ${port} on this machine is in use by another program.`,
          fix: `Set HOST_PORT to a free port in .env (HOST_PORT=3001), or stop that program (${who} shows which), then run the setup again.`,
        };
  }
  if (/permission denied[^\n]*docker\.sock/i.test(output)) return dockerProblems(platform).permission;
  if (/Cannot connect to the Docker daemon/i.test(output)) return dockerProblems(platform).down;
  if (/no space left on device/i.test(output)) {
    return {
      check: "disk",
      error: "This machine is out of disk space.",
      fix: "Free some space (docker system prune removes unused images), then run the setup again.",
    };
  }
  return null;
}

/** The lines after "Invalid configuration" in the app's log (read without Compose's prefix): what to fix in .env. */
export function diagnoseAppLogs(logs: string): Problem | null {
  const at = logs.lastIndexOf("Invalid configuration");
  if (at < 0) return null;
  const issues = [...logs.slice(at).matchAll(/^\s+- (.+)$/gm)].map((m) => (m[1] ?? "").trim()).slice(0, 5);
  return {
    check: "app.config",
    error: `The app refused its configuration${issues.length ? `: ${issues.join(". ")}` : ""}.`,
    fix: "Fix those values in .env, then run the setup again. docker compose logs agentes shows the whole message.",
  };
}

// ── Usage statistics ────────────────────────────────────────────────────────

/** The question's words are the web app's switch's (Settings → General), so every place says the same. */
export const TELEMETRY_TEXT = [
  "Send anonymous usage statistics to agentes.chat: counts such as people, agents,",
  "machine sizes, AI tokens used and how much data the agents' browsers send and",
  "receive. Never messages, files, names or sites.",
];

export function telemetryOf(content: string | null): OnOff | null {
  const on = envFlag(content, "TELEMETRY");
  return on === null ? null : on ? "on" : "off";
}

/**
 * The usage statistics: the flag, else what .env says, else the person's answer, yes by default (`ask`:
 * no flag and nothing in .env, so a terminal asks). Either answer goes into .env, so a run again keeps
 * it and asks nothing.
 */
export function decideTelemetry(p: { flag?: OnOff; content: string | null; answer?: boolean }) {
  const now = telemetryOf(p.content);
  const value: OnOff = p.flag ?? now ?? (p.answer === false ? "off" : "on");
  return { ask: !p.flag && !now, value, kept: value === now, entries: value === now ? {} : { TELEMETRY: value } };
}

// ── Jev ─────────────────────────────────────────────────────────────────────

/** TypeSafe's console, and its page where keys are made. */
export const TYPESAFE_CONSOLE = "https://console.typesafe.ai";
export const TYPESAFE_KEYS = `${TYPESAFE_CONSOLE}/keys`;

/** A whole key is printable ASCII: a pasted curly quote or space can't go in a request, which would read as no answer. */
export const jevKeyProblem = (key: string) =>
  /^[\x21-\x7E]{8,512}$/.test(key) ? null : `that isn't a whole TypeSafe key. Copy it again from ${TYPESAFE_KEYS}.`;

/**
 * What a TypeSafe answer says about a key, first match first, as the server reads it (`jevStateOf` in
 * packages/engine/src/jev-key.ts). The setup is standalone, so it keeps this copy: the same fixture table in both
 * packages' tests keeps the two alike. Null: the request's own fault, which says nothing about the key.
 */
export function jevStateOf(status: number, body?: unknown) {
  if (status >= 200 && status < 300) return "ok" as const;
  const detail = (body as { detail?: { error_type?: unknown; message?: unknown } | string } | null | undefined)?.detail;
  const words = typeof detail === "string" ? detail : `${detail?.error_type ?? ""} ${detail?.message ?? ""}`;
  if (status === 402 || /credit|balance|billing|payment|funds/i.test(words)) return "no_credit" as const;
  // 403 is TypeSafe's answer to a request without a key.
  if (status === 401 || status === 403) return "invalid" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "down" as const;
  return null;
}

export type JevCheck = "ok" | "invalid" | "no_credit" | "unchecked";

/** One tiny call (about 50 tokens), as the server's check: only a real call says a key has no credit. */
export async function checkJevKey(key: string, fetchFn: typeof fetch = fetch): Promise<JevCheck> {
  const question = {
    type: "noul",
    instructions: "Is the state the word ok?",
    criteria: { true: "The state is the word ok.", false: "The state is something else." },
  };
  try {
    const res = await fetchFn("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: "ok", questions: { ok: question } }),
      signal: AbortSignal.timeout(5000),
    });
    const state = jevStateOf(res.status, await res.json().catch(() => null));
    return state === "ok" || state === "invalid" || state === "no_credit" ? state : "unchecked";
  } catch {
    return "unchecked";
  }
}

export type JevChoice = JevCheck | "kept" | "off";

/**
 * Jev's key: `--typesafe-key` is checked with TypeSafe (never in a dry run) and goes into .env unless TypeSafe
 * refuses it, which writes nothing. Without it, or with the key .env already has, .env stays as it is: the app
 * asks the server's owner after the setup.
 */
export async function jevStep(p: {
  flag?: string;
  content: string | null;
  dryRun: boolean;
  check: (key: string) => Promise<JevCheck>;
}): Promise<
  { problem: Problem } | { value: JevChoice; entries: Record<string, string>; said?: { ok: boolean; text: string } }
> {
  const now = envValue(p.content, "TYPESAFE_API_KEY");
  if (!p.flag || p.flag === now) return { value: now ? "kept" : "off", entries: {} };
  if (p.dryRun) return { value: "unchecked", entries: {} };
  const state = await p.check(p.flag);
  if (state === "invalid") {
    return {
      problem: {
        check: "jev",
        error: "TypeSafe didn't accept --typesafe-key.",
        fix: `Copy the key again from ${TYPESAFE_KEYS}, or leave the option out and add it later in Settings › AI accounts.`,
      },
    };
  }
  const said = {
    ok: { ok: true, text: "Jev: key checked" },
    no_credit: {
      ok: false,
      text: `Jev: the key works but has no credit. Add credit at ${TYPESAFE_CONSOLE} and Jev starts by itself.`,
    },
    unchecked: {
      ok: false,
      text: "Jev: TypeSafe didn't answer, so the key wasn't checked. agentes.chat checks it when it uses it.",
    },
  }[state];
  return { value: state, entries: { TYPESAFE_API_KEY: p.flag }, said };
}

// ── The agents' computer ────────────────────────────────────────────────────

/** Beside .env: the service that runs agents here reads HOST_COMPUTER_TOKEN from it, never from its own command line. */
export const HOST_TOKEN_FILE = "host-computer-token";
/** A "4 GB" server reports a little less: the kernel keeps some memory for itself. */
const COMPUTER_MIN_MEMORY = 3.5 * 1024 ** 3;
export const COMPUTER_WAIT_S = 90;

export interface ThisMachine {
  platform: Platform;
  /** `process.arch`: on Linux on ARM the agents' browser is Chromium (ADR 0153). */
  arch: string;
  /** In bytes. */
  memory: number;
  root: boolean;
  /** Whether systemd runs it: on Linux the agents' computer is a systemd unit. */
  systemd: boolean;
  /**
   * Whether that systemd is built with BPF_FRAMEWORK (`systemctl --version`): each agent's user is kept off the
   * others' ports with it, and no agent's process starts without it.
   */
  bpf: boolean;
  /** Whether apt-get is here: the computers' installer installs the screens' and browsers' packages with it. */
  apt: boolean;
  /** Whether it's already connected to an agentes.chat as a computer (`connectedConfig`). */
  connected: boolean;
}

/**
 * `simple`: Linux without systemd's BPF_FRAMEWORK (Ubuntu), where agents can't each be a user of their own: offered
 * in simple mode instead, all of them as one user without sudo (`SIMPLE_USER`, ADR 0153 §5).
 */
export type ComputerOffer = { mac: boolean; simple: boolean; yes: boolean; why: string | null } | { problem: Problem };

/**
 * A setting the server refuses to start with alongside HOST_COMPUTER_TOKEN (packages/config, `loadConfig`),
 * and the value that lifts it; null when there's none.
 */
export function hostTokenConflict(content: string | null): { now: string; off: string } | null {
  if (envFlag(content, "ALLOW_SIGNUP")) return { now: "ALLOW_SIGNUP=true", off: "ALLOW_SIGNUP=false" };
  if (envValue(content, "MACHINE_PROVISIONING") === "external") {
    return { now: "MACHINE_PROVISIONING=external", off: "MACHINE_PROVISIONING=off" };
  }
  return null;
}

/**
 * Whether this machine can be its agents' computer, and the answer when nobody gives one: yes, except on
 * a Linux machine too small for agents' screens or without apt-get for their packages, which `why` says.
 */
export function computerOffer(machine: ThisMachine, content: string | null, image: boolean): ComputerOffer {
  const no = (error: string, fix: string): ComputerOffer => ({ problem: { check: "computer", error, fix } });
  const later = "connect a computer later in Settings › Devices";
  if (image) {
    return no(
      "Inside the image, the setup can't make this machine the agents' computer.",
      `Run the installer on the server for this folder instead, with --dir <folder> --computer yes: ${GUIDE_URL}#computers`,
    );
  }
  const conflict = hostTokenConflict(content);
  if (conflict?.off === "ALLOW_SIGNUP=false") {
    return no(
      "Sign-up is open here (ALLOW_SIGNUP=true), and this machine works for agents only while people join by invitation.",
      `Set ALLOW_SIGNUP=false in .env, or ${later}.`,
    );
  }
  if (conflict) {
    return no(
      "Each workspace here gets a computer of its own from a provisioner (MACHINE_PROVISIONING=external), and no other computer joins it.",
      "Set MACHINE_PROVISIONING=off in .env to use this machine instead.",
    );
  }
  const mac = machine.platform === "darwin";
  if (!mac && machine.platform !== "linux") return no("The agents' computer runs on Linux or a Mac.", `So ${later}.`);
  if (!mac && !machine.root) {
    return no(
      "Each agent gets a user of its own on this machine, which needs root.",
      `Run the setup as root, or ${later}.`,
    );
  }
  if (!mac && !machine.systemd) {
    return no("The agents' computer runs as a system service, and systemd isn't running here.", `So ${later}.`);
  }
  const simple = !mac && !machine.bpf;
  if (machine.connected) {
    // Its service would be replaced, and the server it's connected to would lose this computer.
    return no(
      "This machine is already connected to agentes.chat as a computer, so it can't also be this server's own.",
      `Its connection stays as it is. So ${later}.`,
    );
  }
  if (mac) return { mac, simple: false, yes: true, why: null };
  if (!machine.apt) {
    return {
      mac,
      simple,
      yes: false,
      why: "This machine has no apt-get, so the packages agents' screens and browsers need would be yours to install.",
    };
  }
  if (machine.memory >= COMPUTER_MIN_MEMORY) return { mac, simple, yes: true, why: null };
  const gb = Number((machine.memory / 1024 ** 3).toFixed(1));
  return {
    mac,
    simple,
    yes: false,
    why: `This machine has ${gb} GB of memory. Each agent's screen needs about 0.2 GB, and its browser 0.6 GB more.`,
  };
}

/** Whether a runner's config.json is a connected computer's: it has a token (the computers' installer checks the same). */
export function connectedConfig(text: string | null): boolean {
  try {
    const token = (JSON.parse(text ?? "null") as { token?: unknown } | null)?.token;
    return typeof token === "string" && token !== "";
  } catch {
    return false;
  }
}

/** What .env says: on (a token), off (answered no: the key, empty, which the server reads as unset), or never asked. */
export function computerOf(content: string | null): OnOff | null {
  const token = envValue(content, "HOST_COMPUTER_TOKEN");
  return token === null ? null : token ? "on" : "off";
}

/**
 * Where this machine reaches agentes.chat: the address the compose file publishes it on (`BIND_ADDRESS`,
 * `HOST_PORT`), loopback when that's every address. Root runs the installer that answers there.
 */
export function appOnThisMachine(content: string | null): string {
  const bind = envValue(content, "BIND_ADDRESS") || "127.0.0.1";
  const host = bind === "0.0.0.0" || bind === "[::]" ? "127.0.0.1" : bind;
  return `http://${host}:${envValue(content, "HOST_PORT") || "3000"}`;
}

/**
 * Simple mode (`ComputerOffer.simple`): the user every agent works as, without sudo, its home, and the token file its
 * service reads (a copy of `HOST_TOKEN_FILE` it owns).
 */
export const SIMPLE_USER = "agentes";
export const SIMPLE_HOME = `/home/${SIMPLE_USER}`;
export const SIMPLE_RUNNER_HOME = `${SIMPLE_HOME}/.agentes-runner`;
export const SIMPLE_TOKEN_FILE = `${SIMPLE_HOME}/${HOST_TOKEN_FILE}`;

/** What the question about simple mode says: why not each agent its own user, and what sharing one means. */
export const SIMPLE_MODE_WHY = [
  "This machine can't give each agent a user of its own: its systemd isn't built with BPF_FRAMEWORK (Ubuntu's isn't; Debian 13's is).",
  `In simple mode all agents work as one user, ${SIMPLE_USER}, without sudo: they can see each other's folders, but not yours or the server's.`,
];

export interface ComputerInstall {
  /** Where this machine reaches agentes.chat. */
  server: string;
  script: string;
  args: string[];
  /** Simple mode: run as this user, not root. */
  user?: string;
}

/**
 * The server's own installer for computers, run on this machine once agentes.chat answers, from where
 * this machine reaches it (`appOnThisMachine`): it may not reach the address people use (a tailnet name
 * served from a container). On Linux each agent gets a user and a screen; on a Mac agents work as the person.
 */
export function computerInstall(p: {
  mac: boolean;
  simple?: boolean;
  server: string;
  tokenFile: string;
  commands: boolean;
}): ComputerInstall {
  return {
    server: p.server,
    script: `${p.server}/api/machines/install.sh`,
    args: [
      ...(p.mac || p.simple ? [] : ["--system", "--desktop"]),
      "--server",
      p.server,
      "--host-token-file",
      p.simple ? SIMPLE_TOKEN_FILE : p.tokenFile,
      ...(p.commands ? [] : ["--no-exec"]),
    ],
    ...(p.simple ? { user: SIMPLE_USER } : {}),
  };
}

export const computerCommand = (install: ComputerInstall) =>
  `curl -fsSL ${install.script} | ${install.user ? `runuser -u ${install.user} -- ` : ""}sh -s -- ${install.args.map(quoteEnvValue).join(" ")}`;

// ── What the agents need on this machine ───────────────────────────────────

/** What the requirements step can install (the computers' installer's `--requirements`, ADR 0153 §6). */
export const REQUIREMENTS = ["browser", "desktop", "claude", "codex"] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/** `--requirements`: `all`, `none`, or a comma-separated list; null when it isn't one of those. */
export function parseRequirements(text: string): Requirement[] | null {
  const value = text.trim().toLowerCase();
  if (value === "all") return [...REQUIREMENTS];
  if (value === "none") return [];
  const list = value.split(",").map((v) => v.trim());
  if (!list.every((v) => isOneOf(v, REQUIREMENTS))) return null;
  return REQUIREMENTS.filter((r) => list.includes(r));
}

export interface RequirementCheck {
  id: Requirement;
  /** What people call it. */
  label: string;
  present: boolean;
  /** System mode's own installer brings it (`--system --desktop`): not asked. */
  withComputer: boolean;
}

/**
 * What the agents need on this Linux machine and whether it's there, where the runner looks for each: the browser
 * (Google Chrome, or Chromium on ARM), the packages for their screens, and Claude Code and Codex on an agent's PATH
 * (/usr/local/bin or /usr/bin). On a Mac nothing is checked: the person installs what they use.
 */
export function checkRequirements(m: {
  mac: boolean;
  simple: boolean;
  arch: string;
  exists: (path: string) => boolean;
}): RequirementCheck[] {
  if (m.mac) return [];
  const arm = m.arch === "arm64";
  const any = (paths: string[]) => paths.some(m.exists);
  return [
    {
      id: "browser",
      label: arm
        ? "Chromium (the agents' browser; Google makes no Chrome for Linux on ARM)"
        : "Google Chrome (the agents' browser)",
      present: any(["/opt/google/chrome/chrome", ...(arm ? ["/usr/bin/chromium", "/snap/bin/chromium"] : [])]),
      withComputer: !m.simple,
    },
    {
      id: "desktop",
      label: "A screen for each agent (Xtigervnc and XFCE, about 300 MB)",
      present: any(["/usr/bin/Xtigervnc"]) && any(["/usr/bin/xfce4-session"]),
      withComputer: !m.simple,
    },
    {
      id: "claude",
      label: "Claude Code (for agents that think with a Claude plan)",
      present: any(["/usr/local/bin/claude", "/usr/bin/claude"]),
      withComputer: false,
    },
    {
      id: "codex",
      label: "Codex (for agents that think with a ChatGPT plan)",
      present: any(["/usr/local/bin/codex", "/usr/bin/codex"]),
      withComputer: false,
    },
  ];
}

/** The requirements to ask about: missing and not brought by the computer's own installer. */
export const askableRequirements = (checks: RequirementCheck[]) => checks.filter((c) => !c.present && !c.withComputer);

/** The computers' installer run for the requirements chosen, as root. */
export const requirementsCommand = (install: ComputerInstall, list: Requirement[]) =>
  `curl -fsSL ${install.script} | sh -s -- --requirements ${list.join(",")}`;

/** What the run does about the agents' computer (a dry run takes the answers' defaults). */
export type ComputerPlan =
  | {
      state: "on";
      mac: boolean;
      /** Simple mode: every agent as `SIMPLE_USER` (`ComputerOffer.simple`). */
      simple: boolean;
      commands: boolean;
      install: ComputerInstall;
      /** On before this run, and nothing asked to change it: set up again only when it needs to be. */
      kept: boolean;
    }
  /** `wasOn`: this run turns it off. */
  | { state: "off"; wasOn: boolean }
  | { state: "skipped"; why: string };

export type ComputerDecision =
  | { ask: "computer" | "commands"; yes: boolean }
  | { plan: ComputerPlan; entries: Record<string, string> }
  | { problem: Problem };

/**
 * The agents' computer, from the flags, what .env says, what's installed and the person's answers so far:
 * the next question to ask with its default, or the plan and what .env gets. .env remembers the answer,
 * a token for yes and the key left empty for no, so a run again asks nothing; whether agents run
 * commands is read back from the installed service.
 */
export function decideComputer(p: {
  offer: ComputerOffer;
  content: string | null;
  computer?: "yes" | "no";
  commands?: "yes" | "no";
  /** Commands in the service installed here (`installedCommands`); null when there's none. */
  installed: boolean | null;
  answers: { on?: boolean; commands?: boolean };
  server: string;
  tokenFile: string;
}): ComputerDecision {
  const now = computerOf(p.content);
  const off = (): ComputerDecision => ({
    plan: { state: "off", wasOn: now === "on" },
    entries: now === "off" ? {} : { HOST_COMPUTER_TOKEN: "" },
  });
  if ("problem" in p.offer) {
    if (p.computer === "yes") return { problem: p.offer.problem };
    if (p.computer === "no" || now === "off") return off();
    const conflict = hostTokenConflict(p.content);
    if (now === "on" && conflict) {
      return {
        problem: {
          check: "computer",
          error: `agentes.chat doesn't start with this machine's token (HOST_COMPUTER_TOKEN in .env) and ${conflict.now} together.`,
          fix: `Set ${conflict.off} in .env, or run the setup again with --computer no.`,
        },
      };
    }
    return { plan: { state: "skipped", why: p.offer.problem.error }, entries: {} };
  }
  const on = p.computer ? p.computer === "yes" : now ? now === "on" : p.answers.on;
  if (on === undefined) return { ask: "computer", yes: p.offer.yes };
  if (!on) return off();
  const { mac, simple } = p.offer;
  // Commands start on everywhere (product decision). On a Mac agents work as the person, so the question is still
  // asked there, with yes as its answer by default.
  const unsaid = mac ? (now === "on" ? true : p.answers.commands) : true;
  const commands = p.commands ? p.commands === "yes" : (p.installed ?? unsaid);
  if (commands === undefined) return { ask: "commands", yes: true };
  return {
    plan: {
      state: "on",
      mac,
      simple,
      commands,
      install: computerInstall({ mac, simple, server: p.server, tokenFile: p.tokenFile, commands }),
      kept: now === "on" && !p.computer && !p.commands,
    },
    entries: now === "on" ? {} : { HOST_COMPUTER_TOKEN: randomBytes(48).toString("base64") },
  };
}

/** The service that runs agents here: its unit or launchd plist, and its runner, as the computers' installer puts them. */
export const HOST_SERVICE = "agentes-runner";
export const HOST_LAUNCHD_LABEL = "chat.agentes.runner";
/** The root runner's home on Linux: a computer connected in system mode has its token in its config.json. */
export const SYSTEM_RUNNER_HOME = "/var/lib/agentes-runner";

export function computerFiles(mac: boolean, home: string, runnerHome: string, simple = false) {
  if (simple) {
    return {
      service: `${SIMPLE_HOME}/.config/systemd/user/${HOST_SERVICE}.service`,
      bundle: `${SIMPLE_RUNNER_HOME}/agentes-runner.mjs`,
      command: `${SIMPLE_RUNNER_HOME}/bin/agentes-runner`,
      log: null,
    };
  }
  return mac
    ? {
        service: join(home, "Library", "LaunchAgents", `${HOST_LAUNCHD_LABEL}.plist`),
        bundle: join(runnerHome, "agentes-runner.mjs"),
        command: join(runnerHome, "bin", "agentes-runner"),
        log: hostLogFile(runnerHome),
      }
    : {
        service: `/etc/systemd/system/${HOST_SERVICE}.service`,
        bundle: "/opt/agentes-runner/agentes-runner.mjs",
        command: "/usr/local/bin/agentes-runner",
        log: null,
      };
}

export const hostLogFile = (runnerHome: string) => join(runnerHome, "runner.log");

/** Whether the service installed here lets agents run commands; null when it isn't this server's computer's. */
export function installedCommands(service: string | null): boolean | null {
  // The unit's ExecStart, or the plist's ProgramArguments.
  const args =
    /^ExecStart=(.*)$/m.exec(service ?? "")?.[1] ??
    /<key>ProgramArguments<\/key>([\s\S]*?)<\/array>/.exec(service ?? "")?.[1];
  if (!args || !/(^|[\s>"])host(?=[\s<"]|$)/.test(args)) return null;
  return !args.includes("--no-exec");
}

/**
 * Whether a computer kept on from an earlier run is fine as it is: running, answering the server, with the
 * runner the server serves. Setting it up again restarts it, which interrupts its agents.
 */
export const computerUpToDate = (p: {
  kept: boolean;
  running: boolean;
  state: HostState | null;
  /** The runner installed here, and the one the server serves now. */
  installed: string | null;
  served: string | null;
}) => p.kept && p.running && p.state === "on" && p.installed !== null && p.installed === p.served;

export type HostState = "on" | "off" | "refused" | "unreachable" | "no_token";

/** The lines `agentes-runner host` logs when its state changes (`host.ts`), after their time stamp. */
const HOST_LINES: [HostState, RegExp][] = [
  ["on", /^\S+ serving \d+ organizations?$/],
  ["off", /^\S+ the server has this computer turned off\b/],
  ["refused", /^\S+ the server refused this computer's token\b/],
  ["unreachable", /^\S+ can't reach .*; trying again$/],
  ["no_token", /^\S+ no HOST_COMPUTER_TOKEN to show the server\b/],
];

/** The state the agents' computer last logged; null before its first sync with the server. */
export function hostState(log: string): HostState | null {
  let state: HostState | null = null;
  for (const line of log.split("\n")) {
    const found = HOST_LINES.find(([, pattern]) => pattern.test(line.trim()));
    if (found) state = found[0];
  }
  return state;
}

export const COMPUTER_PROBLEMS = {
  off: {
    check: "computer.off",
    error: "agentes.chat runs without this machine's token (HOST_COMPUTER_TOKEN in .env).",
    fix: "Run docker compose up -d --force-recreate agentes, then the setup again.",
  },
  refused: {
    check: "computer.token",
    error: "agentes.chat refused this machine's token: host-computer-token and HOST_COMPUTER_TOKEN in .env differ.",
    fix: "Run the setup again: it writes the file from .env.",
  },
  no_token: {
    check: "computer.token",
    error: "The agents' computer can't read its token, host-computer-token.",
    fix: "Run the setup again: it writes the file from .env.",
  },
} satisfies Record<string, Problem>;

// ── An SSH tunnel ───────────────────────────────────────────────────────────

/** Where an SSH tunnel to this server logs in: a user, the domain or this server's address, and the SSH port. */
export interface SshTarget {
  user: string;
  host: string | null;
  /** Null for 22, or when unknown. */
  port: string | null;
}

/** RFC 1918, Tailscale's 100.64.0.0/10, and IPv6 unique local and link-local addresses. */
const PRIVATE_ADDRESS =
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

/**
 * The tunnel's login, from the setup's environment. The user: the person behind sudo, else this user; a
 * placeholder when neither is set (inside the image, where Docker sets neither), never a guess like root, which
 * cloud images refuse. The address and port the SSH session running the setup came in on (SSH_CONNECTION is
 * "client port server port"; sudo drops it): no address behind NAT, where a public client reached a private
 * address it never typed.
 */
export function sshTarget(env: Record<string, string | undefined>): SshTarget {
  const [client, , server, port] = env.SSH_CONNECTION?.trim().split(/\s+/) ?? [];
  const natted = !!server && PRIVATE_ADDRESS.test(server) && !PRIVATE_ADDRESS.test(client ?? "");
  return {
    user: env.SUDO_USER || env.USER || env.LOGNAME || "<user>",
    host: client && server && !natted ? server : null,
    port: port && port !== "22" ? port : null,
  };
}

/**
 * The tunnel from the person's computer to the app on this server's localhost. The same port on both ends:
 * the browser's address has to be PUBLIC_URL, http://localhost:<port>, the only origin the app accepts.
 */
export const sshTunnel = (port: string, to: SshTarget) =>
  `ssh ${to.port ? `-p ${to.port} ` : ""}-L ${port}:localhost:${port} ${to.user}@${to.host ?? "<server-address>"}`;

/**
 * A public domain's first start: private (PUBLIC_URL http://localhost:<port>) until the owner's account
 * exists, created through an SSH tunnel to the domain so nobody else can claim the instance; then the domain
 * goes live. The tunnel's command is a line of its own (`$ `), to copy whole.
 */
export function privateStart(p: { domain: string; port: string; ssh: SshTarget }) {
  return {
    steps: [
      `From your computer, open a tunnel to this server:\n$ ${sshTunnel(p.port, { ...p.ssh, host: p.domain })}`,
      `Open http://localhost:${p.port} and create your account: the first one owns the instance. It has to be port ${p.port} on your computer too: until ${p.domain} goes live, sign-up works only at that address.`,
    ],
  };
}

// ── The end ─────────────────────────────────────────────────────────────────

/**
 * The link the agentes.chat phone and desktop apps open on this server (the phone from the QR code). The web
 * app's "Abrir no celular" adds `&token=` for a one-time sign-in. SELF_HOSTING.md, "Your phone".
 */
export const appLink = (origin: string) => `agenteschat://connect?${new URLSearchParams({ server: origin })}`;

/** The phone app opens https servers only (a phone also reaches only its own localhost). */
export const hasAppLink = (url: string) => url.startsWith("https://");

/** What the end shows and what `--json` returns, with the agents' computer's failure, if it failed. */
export function theEnd(p: {
  network: Network;
  url: string;
  app: { health: Record<string, unknown>; firstRun: boolean } | null;
  keyExpiry: string | null;
  choices: { computer: ComputerPlan["state"]; telemetry: OnOff; jev: JevChoice } | null;
  first?: string[];
  failed: Problem | null;
  ssh: SshTarget;
}) {
  const link = hasAppLink(p.url) ? appLink(p.url) : null;
  const steps = [
    ...(p.first ?? []),
    ...nextSteps({
      network: p.network,
      url: p.url,
      firstRun: p.app?.firstRun ?? null,
      keyExpiry: p.keyExpiry,
      ssh: p.ssh,
    }),
  ];
  return {
    link,
    steps,
    result: {
      // agentes.chat is up either way, so its address and links still follow a failure of its computer.
      ok: p.failed === null,
      ...p.failed,
      network: p.network,
      url: p.url,
      health: p.app?.health ?? null,
      ownerExists: p.app ? !p.app.firstRun : null,
      appLink: link,
      phoneLink: link,
      ...p.choices,
      nextSteps: steps,
    },
  };
}

/** A QR code in half blocks, light modules drawn: on a terminal it needs light on dark (cli.ts sets the colors). */
export const qrCode = (text: string) => renderUnicodeCompact(text, { border: 2 });

export interface PlanInput {
  /** What's wrong with Docker, and its fix. Null when it's fine (the run says so above the plan) or not checked. */
  docker: string | null;
  /** What a run without --dry-run asks, when nothing else answers it. */
  questions: string[];
  envExists: boolean;
  newSecrets: string[];
  network: Network;
  /** PUBLIC_URL in .env now, and what the run writes before starting (null: unchanged). */
  publicUrl: { now: string | null; next: string | null };
  /** stopCommand's: the containers of the way in the run drops. */
  stop: string[] | null;
  hostname: string;
  /** Where the Tailscale key comes from. */
  tailscale: "given" | "env" | "joined" | "ask" | "missing";
  domain: string | null;
  email: EmailChoice | "set";
  computer: ComputerPlan;
  /** What the agents need here: what's there already, and what the run installs (`--requirements`). */
  requirements: { present: string[]; install: Requirement[] };
  /** The usage statistics' answer, and whether .env already had it. */
  telemetry: { value: OnOff; kept: boolean };
  /** Jev's key: `--typesafe-key` to check, kept from .env, or none. */
  jev: JevChoice;
  compose: string | null;
  start: boolean;
  image: boolean;
}

function computerStep(c: ComputerPlan): string {
  if (c.state === "off" && c.wasOn) {
    return `agents' computer: not this machine any more (HOST_COMPUTER_TOKEN emptied, ${HOST_TOKEN_FILE} removed)`;
  }
  if (c.state === "off") return "agents' computer: not this machine (connect one later in Settings › Devices)";
  if (c.state === "skipped") return `agents' computer: skipped. ${c.why}`;
  const who = c.mac
    ? `this Mac, agents working as you in folders of their own, commands ${c.commands ? "on" : "off"}`
    : c.simple
      ? `this machine in simple mode, every agent as the user ${SIMPLE_USER} (no sudo), commands ${c.commands ? "on" : "off"}`
      : "this machine, each agent a user of its own with a screen";
  return `agents' computer: ${who} (HOST_COMPUTER_TOKEN, also in ${HOST_TOKEN_FILE})`;
}

function telemetryStep(t: PlanInput["telemetry"]): string {
  if (t.kept) return `usage statistics: keep what .env has (TELEMETRY=${t.value})`;
  return t.value === "on"
    ? "usage statistics: sent to agentes.chat (TELEMETRY=on)"
    : "usage statistics: not sent (TELEMETRY=off)";
}

/** What the setup is about to do, step by step: the --dry-run output and the live run say the same. */
export function planSteps(p: PlanInput): string[] {
  const steps: string[] = [];
  if (p.image) steps.push("Docker: not checked here (setup inside the image)");
  else if (p.docker) steps.push(p.docker);
  if (p.questions.length) steps.push(`asks: ${p.questions.join(", ")}`);
  steps.push(
    p.envExists
      ? `.env: keep it and add only what's missing${p.newSecrets.length ? ` (${p.newSecrets.join(", ")})` : ""}`
      : `.env: create it, readable by you only, with ${p.newSecrets.join(" and ")} generated`,
  );
  if (p.network === "tailscale") {
    steps.push(`network: Tailscale, COMPOSE_PROFILES=tailscale, device name ${p.hostname}`);
    steps.push(
      {
        given: "Tailscale: join the tailnet with the key given",
        env: "Tailscale: join the tailnet with the key in .env",
        joined: "Tailscale: already on the tailnet, no key needed",
        ask: "Tailscale: show the admin console steps and ask for an auth key",
        missing: "Tailscale: stop, an auth key is needed (--tailscale-key)",
      }[p.tailscale],
    );
  } else if (p.network === "domain") {
    steps.push(`network: public domain ${p.domain ?? "(asked)"}, HTTPS by Caddy on ports 80 and 443`);
  } else if (p.network === "proxy") {
    steps.push(`network: your own proxy or tunnel at ${p.publicUrl.now} (PUBLIC_URL and COMPOSE_PROFILES stay)`);
  } else {
    steps.push("network: this machine only, http://localhost");
  }
  if (p.publicUrl.next) {
    steps.push(`PUBLIC_URL: ${p.publicUrl.next}${p.publicUrl.now ? `, replacing ${p.publicUrl.now}` : ""}`);
  }
  steps.push(
    {
      skip: "email: none for now (set SMTP_URL or MILLIONSEND_API_KEY later)",
      smtp: "email: an SMTP server",
      api: "email: a Resend-compatible API",
      set: "email: keep what .env has",
    }[p.email],
  );
  steps.push(computerStep(p.computer));
  if (p.requirements.present.length) steps.push(`already here for the agents: ${p.requirements.present.join(", ")}`);
  steps.push(telemetryStep(p.telemetry));
  if (p.jev === "kept") steps.push("Jev: keep what .env has (TYPESAFE_API_KEY)");
  else if (p.jev !== "off") steps.push("Jev: TYPESAFE_API_KEY from --typesafe-key, checked when the setup runs");
  steps.push(p.compose ? `compose: use ${p.compose}` : `compose: download docker-compose.yml from ${COMPOSE_URL}`);
  if (p.image || !p.start) {
    steps.push("start: print the commands to run (docker compose up -d) and how to finish");
    return steps;
  }
  if (p.stop) steps.push(`stop: docker ${p.stop.join(" ")}, the way in it no longer uses`);
  if (p.network === "tailscale") {
    steps.push("start: docker compose up -d tailscale, wait until it's on the tailnet with HTTPS");
    steps.push("PUBLIC_URL: write the address Tailscale gives it (https://<device>.<tailnet>.ts.net)");
    steps.push("start: docker compose up -d, wait for the HTTPS certificate and /api/health");
  } else if (p.network === "domain" && p.publicUrl.now === `https://${p.domain}`) {
    steps.push(`start: docker compose up -d, wait for https://${p.domain}`);
  } else if (p.network === "domain") {
    steps.push("start: docker compose up -d on localhost first, wait for /api/health");
    steps.push("owner: wait for the first account (through an SSH tunnel), so nobody else can take the instance");
    steps.push(`PUBLIC_URL: https://${p.domain ?? "<domain>"}, COMPOSE_PROFILES=https, then wait for the certificate`);
  } else {
    steps.push("start: docker compose up -d, wait for /api/health");
  }
  if (p.computer.state === "on" && p.requirements.install.length) {
    steps.push(`install for the agents: ${requirementsCommand(p.computer.install, p.requirements.install)}`);
  }
  if (p.computer.state === "on" && p.computer.simple) {
    steps.push(
      `user ${SIMPLE_USER}: create it if missing (no sudo), keep its services running (loginctl enable-linger), give it ${SIMPLE_TOKEN_FILE}`,
    );
  }
  if (p.computer.state === "on") {
    steps.push(
      `agents' computer: ${p.computer.kept ? "if it isn't running and up to date, " : ""}${computerCommand(p.computer.install)}, then wait up to ${COMPUTER_WAIT_S} s for it to answer`,
    );
  }
  const linked = p.network === "proxy" ? hasAppLink(p.publicUrl.now ?? "") : p.network !== "local";
  steps.push(
    linked
      ? "finish: the address, the link that opens the agentes.chat phone or desktop app on it with its QR code, and what to do next"
      : "finish: the address and what to do next",
  );
  return steps;
}

/** The phone app's sign-in screen (apps/mobile i18n, `auth.server`): its English labels and the Portuguese ones. */
const SCAN_IN_APP = `tap "Change" next to the server, then "Scan QR code" ("Trocar" and "Escanear QR code" in Portuguese)`;

/** What the person does once the setup is done. */
export function nextSteps(p: {
  network: Network;
  url: string;
  firstRun: boolean | null;
  keyExpiry: string | null;
  ssh: SshTarget;
}): string[] {
  const steps: string[] = [];
  const account = p.firstRun === false ? "sign in" : "create your account: the first one owns this instance";
  if (p.network === "tailscale") {
    steps.push(`On a computer or phone signed in to your tailnet, open ${p.url} and ${account}.`);
    steps.push(
      `Phone: install Tailscale (${TS.download}), sign in to your tailnet, and install the agentes.chat app. Then point the camera at the QR code above, or on the app's sign-in screen ${SCAN_IN_APP}.`,
    );
    steps.push(
      `People you invite need your tailnet too: invite them to it (${TS.users}, "Invite users"), or share this server with theirs (its … menu in ${TS.machines}, "Share").`,
    );
    if (p.keyExpiry) {
      steps.push(
        `In ${TS.machines}, open this server's … menu and choose "Disable Key Expiry", or it leaves your tailnet on ${p.keyExpiry.slice(0, 10)}.`,
      );
    }
  } else if (p.network === "domain" || p.network === "proxy") {
    steps.push(`Open ${p.url} and ${account}.`);
    if (hasAppLink(p.url)) {
      steps.push(
        `Phone: point the camera at the QR code above, or on the agentes.chat app's sign-in screen ${SCAN_IN_APP}.`,
      );
    }
  } else {
    const port = new URL(p.url).port || "80";
    steps.push(`Open ${p.url} and ${account}.`);
    steps.push(`On a server, open it from your computer through an SSH tunnel:\n$ ${sshTunnel(port, p.ssh)}`);
  }
  return steps;
}
