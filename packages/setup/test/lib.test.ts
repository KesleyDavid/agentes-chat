import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mobileEn } from "../../../apps/mobile/src/i18n/keys.en";
import { mobilePtBR } from "../../../apps/mobile/src/i18n/keys.pt-BR";
import {
  appLink,
  appOnThisMachine,
  askableRequirements,
  COMPOSE_FILES,
  checkJevKey,
  checkRequirements,
  computerCommand,
  computerInstall,
  computerOf,
  computerOffer,
  computerUpToDate,
  connectedConfig,
  DEFAULT_TAG,
  DEFAULT_TIMEOUT_S,
  decideComputer,
  decideTelemetry,
  diagnoseAppLogs,
  diagnoseCompose,
  diagnoseTailscaleLogs,
  domainProblem,
  emailFromProblem,
  envFlag,
  envName,
  envValue,
  hostState,
  installedCommands,
  isComposeFile,
  isTailnetUrl,
  type JevCheck,
  jevStateOf,
  jevStep,
  lastLine,
  networkOf,
  nextSteps,
  normalizeDomain,
  outputLine,
  type PlanInput,
  PROBLEMS,
  parseOptions,
  parseRequirements,
  plainStep,
  planSteps,
  privateStart,
  qrCode,
  quoteEnvValue,
  type Requirement,
  readTailscaleStatus,
  resolveChoice,
  secretEntries,
  senderFor,
  sentence,
  sshTarget,
  sshTunnel,
  stopCommand,
  type ThisMachine,
  tailscaleKeyEntries,
  tailscaleKeyProblem,
  telemetryOf,
  theEnd,
  upsertEnv,
  versionAtLeast,
  wayIn,
  withNetworkProfile,
} from "../src/lib";

const root = join(import.meta.dir, "../../..");
const AUTH_KEY = "tskey-auth-kAbC123CNTRL-SECRETabc123";
const CLIENT_SECRET = "tskey-client-kXyZ789CNTRL-SECRETxyz789";
const SSH = { user: "ana", host: "203.0.113.7", port: null };

describe("options", () => {
  const parse = (argv: string[], env: Record<string, string> = {}) => parseOptions(argv, env);

  test("defaults: ask for what's missing, start, wait 5 minutes", () => {
    expect(parse([])).toEqual({
      options: {
        tailscaleTag: DEFAULT_TAG,
        start: true,
        timeout: DEFAULT_TIMEOUT_S,
        dryRun: false,
        json: false,
        help: false,
      },
    });
  });

  test("every answer as a flag, or as AGENTES_SETUP_<OPTION>", () => {
    const flags = parse([
      "--network",
      "tailscale",
      "--tailscale-key",
      AUTH_KEY,
      "--hostname",
      "chat",
      "--email",
      "smtp",
      "--smtp-url",
      "smtps://u:p@smtp.example.com:465",
      "--email-from",
      "agentes.chat <ping@example.com>",
      "--computer",
      "no",
      "--computer-commands",
      "yes",
      "--telemetry",
      "off",
      "--no-start",
      "--timeout",
      "60",
      "--json",
      "--dry-run",
    ]);
    expect(flags).toMatchObject({
      options: {
        network: "tailscale",
        tailscaleKey: AUTH_KEY,
        hostname: "chat",
        email: "smtp",
        smtpUrl: "smtps://u:p@smtp.example.com:465",
        emailFrom: "agentes.chat <ping@example.com>",
        computer: "no",
        computerCommands: "yes",
        telemetry: "off",
        start: false,
        timeout: 60,
        json: true,
        dryRun: true,
      },
    });
    expect(envName("tailscale-key")).toBe("AGENTES_SETUP_TAILSCALE_KEY");
    const fromEnv = parse([], {
      AGENTES_SETUP_NETWORK: "domain",
      AGENTES_SETUP_DOMAIN: "https://Chat.Example.com/",
      AGENTES_SETUP_NO_START: "1",
      AGENTES_SETUP_JSON: "true",
      AGENTES_SETUP_TELEMETRY: "off",
    });
    expect(fromEnv).toMatchObject({
      options: { network: "domain", domain: "chat.example.com", start: false, json: true, telemetry: "off" },
    });
    // A flag wins over the environment.
    expect(parse(["--network", "local"], { AGENTES_SETUP_NETWORK: "domain" })).toMatchObject({
      options: { network: "local" },
    });
  });

  test("a wrong value is refused before anything runs, with the option's name", () => {
    expect(parse(["--network", "vpn"])).toEqual({ error: "--network is tailscale, domain or local." });
    expect(parse(["--email", "yes"])).toEqual({ error: "--email is skip, smtp or api." });
    expect(parse(["--computer", "on"])).toEqual({ error: "--computer is yes or no." });
    expect(parse(["--computer-commands", "maybe"])).toEqual({ error: "--computer-commands is yes or no." });
    expect(parse(["--telemetry", "yes"])).toEqual({ error: "--telemetry is on or off." });
    expect(parse(["--timeout", "soon"])).toEqual({ error: "--timeout is a number of seconds." });
    expect(parse(["--tailscale-key", "abc"])).toMatchObject({ error: expect.stringMatching(/^--tailscale-key: /) });
    expect(parse(["--hostname", "My Server"])).toMatchObject({ error: expect.stringMatching(/^--hostname: /) });
    expect(parse(["--tailscale-tag", "agentes"])).toMatchObject({ error: expect.stringMatching(/^--tailscale-tag: /) });
    expect(parse(["--smtp-url", "smtp.example.com"])).toMatchObject({ error: expect.stringMatching(/^--smtp-url: /) });
    expect(parse(["--email-from", "ola"])).toMatchObject({ error: expect.stringMatching(/^--email-from: /) });
    // A key cut short, or pasted with a curly quote, a space or a zero-width space: never sent, never written.
    for (const key of ["ts_123", "ts_live 9f2c", "“ts_live_9f2c”", "ts_live_\u200b9f2c"])
      expect(parse(["--typesafe-key", key])).toEqual({
        error: "--typesafe-key: that isn't a whole TypeSafe key. Copy it again from https://console.typesafe.ai/keys.",
      });
    expect(parse(["--frobnicate"])).toMatchObject({ error: expect.stringContaining("--help") });
  });

  test("a numbered answer, or the name itself", () => {
    const values = ["tailscale", "domain", "local"] as const;
    expect(resolveChoice("2", values)).toBe("domain");
    expect(resolveChoice(" Local ", values)).toBe("local");
    expect(resolveChoice("4", values)).toBeNull();
    expect(resolveChoice("vpn", values)).toBeNull();
  });
});

describe("Jev's key (--typesafe-key)", () => {
  test("a flag, or AGENTES_SETUP_TYPESAFE_KEY", () => {
    expect(parseOptions(["--typesafe-key", "ts_live_9f2c"], {})).toMatchObject({
      options: { typesafeKey: "ts_live_9f2c" },
    });
    expect(parseOptions([], { AGENTES_SETUP_TYPESAFE_KEY: " ts_live_9f2c " })).toMatchObject({
      options: { typesafeKey: "ts_live_9f2c" },
    });
    // In --help, after --telemetry, in the options' column.
    expect(readFileSync(join(import.meta.dir, "../src/cli.ts"), "utf8")).toMatch(
      /--telemetry <on\|off> {16}.*\n {2}--typesafe-key <key> {16}TypeSafe key for Jev, optional \(\$\{TYPESAFE_KEYS\}\)\n/,
    );
  });

  test("what TypeSafe's answer says about a key, as the server reads it (packages/engine/test/jev-key.test.ts)", () => {
    const credit = { detail: { error_type: "billing_error", message: "Insufficient credits" } };
    const table: [number, unknown, ReturnType<typeof jevStateOf>][] = [
      [200, undefined, "ok"],
      [401, undefined, "invalid"],
      [402, undefined, "no_credit"],
      [403, { detail: { error_type: "authentication_error", message: "Must supply an API key!" } }, "invalid"],
      [403, credit, "no_credit"],
      [400, { detail: { message: "Your balance is too low" } }, "no_credit"],
      [400, { detail: "out of funds" }, "no_credit"],
      [400, undefined, null],
      [413, undefined, null],
      [415, undefined, null],
      [422, { detail: { message: "The image must be 280 to 1568 px a side" } }, null],
      [429, undefined, "rate_limited"],
      [500, undefined, "down"],
      [529, { detail: { error_type: "overloaded_error" } }, "down"],
    ];
    for (const [status, body, state] of table)
      expect({ status, state: jevStateOf(status, body) }).toEqual({ status, state });
  });

  test("the check: one call to TypeSafe with the key; no answer, a limit or an outage leave it unchecked", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const answer = (status: number | "offline", body: unknown = {}) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
        if (status === "offline") throw new TypeError("fetch failed");
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
    expect(await checkJevKey("ts_live_9f2c", answer(200))).toBe("ok");
    expect(seen).toEqual([{ url: "https://api.typesafe.ai/v1/systemone", auth: "Bearer ts_live_9f2c" }]);
    expect(await checkJevKey("ts_live_9f2c", answer(401))).toBe("invalid");
    expect(await checkJevKey("ts_live_9f2c", answer(402))).toBe("no_credit");
    for (const status of [429, 529, 422, "offline"] as const)
      expect([status, await checkJevKey("ts_live_9f2c", answer(status))]).toEqual([status, "unchecked"]);
  });

  test("checked before .env is written: refused writes nothing, the others write it and say how it went", async () => {
    const asked: string[] = [];
    const typesafe = (state: JevCheck) => async (key: string) => {
      asked.push(key);
      return state;
    };
    const step = (state: JevCheck, flag?: string, content: string | null = null, dryRun = false) =>
      jevStep({ ...(flag ? { flag } : {}), content, dryRun, check: typesafe(state) });

    expect(await step("ok", "ts_live_9f2c")).toEqual({
      value: "ok",
      entries: { TYPESAFE_API_KEY: "ts_live_9f2c" },
      said: { ok: true, text: "Jev: key checked" },
    });
    expect(await step("invalid", "ts_wrong_0000")).toEqual({
      problem: {
        check: "jev",
        error: "TypeSafe didn't accept --typesafe-key.",
        fix: "Copy the key again from https://console.typesafe.ai/keys, or leave the option out and add it later in Settings › AI accounts.",
      },
    });
    expect(await step("no_credit", "ts_empty_5555")).toEqual({
      value: "no_credit",
      entries: { TYPESAFE_API_KEY: "ts_empty_5555" },
      said: {
        ok: false,
        text: "Jev: the key works but has no credit. Add credit at https://console.typesafe.ai and Jev starts by itself.",
      },
    });
    expect(await step("unchecked", "ts_live_9f2c")).toEqual({
      value: "unchecked",
      entries: { TYPESAFE_API_KEY: "ts_live_9f2c" },
      said: {
        ok: false,
        text: "Jev: TypeSafe didn't answer, so the key wasn't checked. agentes.chat checks it when it uses it.",
      },
    });
    expect(asked).toEqual(["ts_live_9f2c", "ts_wrong_0000", "ts_empty_5555", "ts_live_9f2c"]);

    asked.length = 0;
    const env = "TYPESAFE_API_KEY=ts_live_9f2c\n";
    // A run again without the flag, or with the key .env has, keeps it as it is; without either, no Jev.
    expect(await step("ok", undefined, env)).toEqual({ value: "kept", entries: {} });
    expect(await step("ok", "ts_live_9f2c", env)).toEqual({ value: "kept", entries: {} });
    expect(await step("ok")).toEqual({ value: "off", entries: {} });
    // A dry run asks TypeSafe nothing.
    expect(await step("ok", "ts_new_7777", env, true)).toEqual({ value: "unchecked", entries: {} });
    expect(asked).toEqual([]);
  });
});

describe("answers", () => {
  test("Tailscale keys: auth keys and OAuth client secrets, never an API token", () => {
    expect(tailscaleKeyProblem(AUTH_KEY)).toBeNull();
    expect(tailscaleKeyProblem(CLIENT_SECRET)).toBeNull();
    expect(tailscaleKeyProblem(`${CLIENT_SECRET}?ephemeral=false&preauthorized=true`)).toBeNull();
    expect(tailscaleKeyProblem("tskey-api-kAbC123CNTRL-SECRET")).toContain("API access token");
    expect(tailscaleKeyProblem("tskey-auth-short")).toContain("isn't a Tailscale auth key");
    expect(tailscaleKeyProblem(`${AUTH_KEY} trailing`)).toContain("isn't a Tailscale auth key");
  });

  test("domains: pasted addresses become names; ts.net names belong to Tailscale", () => {
    expect(normalizeDomain(" https://Chat.Example.com/login?x=1 ")).toBe("chat.example.com");
    expect(domainProblem("chat.example.com")).toBeNull();
    expect(domainProblem("localhost")).not.toBeNull();
    expect(domainProblem("10.0.0.1")).not.toBeNull();
    expect(domainProblem("box.tail1234.ts.net")).toContain("Tailscale");
  });

  test("the sender offered is the server's own default: agentes.chat, at a public domain only", () => {
    // The same name every email signs with (packages/engine's defaultEmailFrom).
    expect(senderFor("domain", "chat.acme.com")).toBe("agentes.chat <ping@chat.acme.com>");
    expect(senderFor("domain", null)).toBeUndefined();
    expect(senderFor("tailscale", null)).toBeUndefined();
    expect(senderFor("local", null)).toBeUndefined();
    expect(emailFromProblem("agentes.chat <ping@chat.acme.com>")).toBeNull();
    // The old name is still a sender: a .env that has it keeps it.
    expect(emailFromProblem("agentes <ping@chat.acme.com>")).toBeNull();
    expect(emailFromProblem("ola")).toBe('that isn\'t a sender like "agentes.chat <ping@example.com>".');
  });

  test("a problem shown on its own starts as a sentence", () => {
    expect(sentence("that isn't a domain name like chat.example.com.")).toBe(
      "That isn't a domain name like chat.example.com.",
    );
  });
});

describe("output", () => {
  test("a command's latest line, under a wait: no colors, and no mark of an installer's own", () => {
    expect(outputLine(" Container agentes-agentes-1  Started\r")).toBe("Container agentes-agentes-1  Started");
    expect(outputLine("\x1b[2m◒  Installing the packages for the agents' browser and screens\x1b[0m")).toBe(
      "Installing the packages for the agents' browser and screens",
    );
    expect(outputLine("◇  Bun 1.4.4 (SHA-256 checked)")).toBe("Bun 1.4.4 (SHA-256 checked)");
    expect(outputLine("│  ")).toBe("");
    expect(outputLine("E: Unable to locate package docker-ce")).toBe("E: Unable to locate package docker-ce");
    // The Linux console's marks (TERM=linux), two spaces after them as after the others.
    expect(outputLine("o  The runner, from https://agents.example.com")).toBe(
      "The runner, from https://agents.example.com",
    );
    expect(outputLine("-  Installing the packages for the agents' browser")).toBe(
      "Installing the packages for the agents' browser",
    );
    expect(outputLine("x  download failed")).toBe("download failed");
    expect(outputLine("o pacote foi instalado")).toBe("o pacote foi instalado");
  });

  test("a failed command's reason is its last line with words, without the mark before it", () => {
    const installer = [
      "agentes.chat connect this computer",
      "◇  Bun 1.4.4 (SHA-256 checked)",
      "◒  Downloading the runner from https://agents.example.com",
      "curl: (22) The requested URL returned error: 404",
      "■  download failed",
      "",
    ].join("\n");
    expect(lastLine(installer)).toBe("download failed");
    expect(lastLine("x  download failed\r\n")).toBe("download failed");
    expect(lastLine("Error response from daemon: no space left on device\n")).toBe(
      "Error response from daemon: no space left on device",
    );
    expect(lastLine("")).toBe("");
  });

  test("--json's steps are plain sentences: a command the frame puts on a line of its own follows its words", () => {
    expect(plainStep("On a server, open it through an SSH tunnel:\n$ ssh -L 3000:localhost:3000 ana@203.0.113.7")).toBe(
      "On a server, open it through an SSH tunnel: ssh -L 3000:localhost:3000 ana@203.0.113.7",
    );
    expect(plainStep("Open http://localhost:3000 and create your account.")).toBe(
      "Open http://localhost:3000 and create your account.",
    );
  });
});

describe(".env", () => {
  test("values are read the way Compose reads them", () => {
    const env = '# comment\nexport A=1\nB = \'two words\'\nC="say \\"hi\\""\nD=plain # note\nE=\n';
    expect(envValue(env, "A")).toBe("1");
    expect(envValue(env, "B")).toBe("two words");
    expect(envValue(env, "C")).toBe('say "hi"');
    expect(envValue(env, "D")).toBe("plain");
    expect(envValue(env, "E")).toBe("");
    expect(envValue(env, "F")).toBeNull();
    expect(envValue(null, "A")).toBeNull();
  });

  test("a key set twice reads as its last line, as Compose reads it: .env.example, then values appended", () => {
    // `cp .env.example .env`, then `echo AGENTES_SECRET=… >> .env`, and a domain added by hand later.
    const env =
      "# Required.\nAGENTES_SECRET=\nPUBLIC_URL=http://localhost:3000\nX=1\nAGENTES_SECRET=real-secret\nPUBLIC_URL=https://chat.example.com\n";
    expect(envValue(env, "AGENTES_SECRET")).toBe("real-secret");
    expect(envValue(env, "PUBLIC_URL")).toBe("https://chat.example.com");
    expect(secretEntries(env)).not.toHaveProperty("AGENTES_SECRET");
    expect(wayIn(env, networkOf(env) ?? "tailscale", null).entries).toEqual({});
  });

  test("a written key keeps its first line and loses the others, new keys at the end, comments stay", () => {
    const env = "# mine\nPUBLIC_URL=http://localhost:3000\nX=1\nPUBLIC_URL=http://old\n";
    const next = upsertEnv(env, { PUBLIC_URL: "https://box.tail1234.ts.net", NEW: "v" });
    expect(next).toBe("# mine\nPUBLIC_URL=https://box.tail1234.ts.net\nX=1\nNEW=v\n");
    expect(envValue(next, "PUBLIC_URL")).toBe("https://box.tail1234.ts.net");
    expect(upsertEnv("", { A: "1" })).toBe("A=1\n");
    expect(upsertEnv("A=1\n", {})).toBe("A=1\n");
  });

  test("anything a value holds comes back unchanged", () => {
    for (const value of [
      "plain-value_1.2/3:4@5%6+7=8,9",
      "has space",
      "pa$$word#1",
      "it's",
      `${CLIENT_SECRET}?ephemeral=false&preauthorized=true`,
      "",
    ]) {
      expect(envValue(upsertEnv("", { K: value }), "K")).toBe(value);
    }
    expect(quoteEnvValue("line\nbreak")).toBe("linebreak");
  });

  test("one way in: tailscale or https in COMPOSE_PROFILES, other profiles kept", () => {
    expect(envValue(withNetworkProfile("", "tailscale"), "COMPOSE_PROFILES")).toBe("tailscale");
    const both = "COMPOSE_PROFILES=https,backup\n";
    expect(envValue(withNetworkProfile(both, "tailscale"), "COMPOSE_PROFILES")).toBe("backup,tailscale");
    expect(envValue(withNetworkProfile(both, null), "COMPOSE_PROFILES")).toBe("backup");
    expect(withNetworkProfile("A=1\n", null)).toBe("A=1\n");
    expect(withNetworkProfile("COMPOSE_PROFILES=tailscale\n", "tailscale")).toBe("COMPOSE_PROFILES=tailscale\n");
  });

  test("the network a .env already says", () => {
    expect(networkOf(null)).toBeNull();
    expect(networkOf("AGENTES_SECRET=x\n")).toBeNull();
    expect(networkOf("PUBLIC_URL=http://localhost:3000\n")).toBe("local");
    expect(networkOf("COMPOSE_PROFILES=backup,tailscale\n")).toBe("tailscale");
    expect(networkOf("COMPOSE_PROFILES=https\n")).toBe("domain");
    expect(networkOf("DOMAIN=chat.example.com\nPUBLIC_URL=http://localhost:3000\n")).toBe("domain");
    // An address no profile manages: nginx, a tunnel, Tailscale on the host.
    expect(networkOf("PUBLIC_URL=https://chat.example.com\n")).toBe("proxy");
    expect(networkOf("PUBLIC_URL=https://box.tail1234.ts.net\n")).toBe("proxy");
  });

  test("a second run writes PUBLIC_URL only where the way in owns it", () => {
    const nginx = "PUBLIC_URL=https://chat.example.com\nSMTP_URL=smtps://u:p@smtp.example.com:465\n";
    expect(wayIn(nginx, "proxy", null)).toEqual({ entries: {}, profile: null });
    expect(upsertEnv(withNetworkProfile(nginx, null), {})).toBe(nginx);
    const live = "DOMAIN=chat.example.com\nPUBLIC_URL=https://chat.example.com\nCOMPOSE_PROFILES=https\n";
    expect(wayIn(live, "domain", "chat.example.com")).toEqual({
      entries: { DOMAIN: "chat.example.com" },
      profile: "https",
    });
    // Not live yet: localhost, without Caddy, until the owner exists.
    expect(wayIn("HOST_PORT=3001\n", "domain", "chat.example.com")).toEqual({
      entries: { DOMAIN: "chat.example.com", PUBLIC_URL: "http://localhost:3001" },
      profile: null,
    });
    expect(wayIn("PUBLIC_URL=http://localhost:3000\n", "domain", "chat.example.com").entries).toEqual({
      DOMAIN: "chat.example.com",
    });
    const tailnet = "COMPOSE_PROFILES=tailscale\nPUBLIC_URL=https://agentes.tail1234.ts.net\n";
    expect(wayIn(tailnet, "tailscale", null)).toEqual({ entries: {}, profile: "tailscale" });
    expect(wayIn("PUBLIC_URL=http://localhost:3000\n", "local", null).entries).toEqual({});
    expect(wayIn(null, "local", null).entries).toEqual({ PUBLIC_URL: "http://localhost:3000" });
    // Chosen, not inferred: this machine only replaces the address.
    expect(wayIn(tailnet, "local", null)).toEqual({ entries: { PUBLIC_URL: "http://localhost:3000" }, profile: null });
    // Leaving a public domain empties DOMAIN, or the next run would take the domain back.
    const left = upsertEnv(withNetworkProfile(live, null), wayIn(live, "local", null).entries);
    expect(networkOf(left)).toBe("local");
    expect(wayIn(live, "tailscale", null).entries).toEqual({ DOMAIN: "" });
  });

  test("switching the way in removes the old one, which docker compose up leaves running", () => {
    const domain = "COMPOSE_PROFILES=backup,https\n";
    expect(stopCommand(domain, "tailscale")).toEqual(["compose", "--profile", "https", "rm", "-sf", "caddy"]);
    expect(stopCommand("COMPOSE_PROFILES=tailscale\n", null)).toEqual([
      "compose",
      "--profile",
      "tailscale",
      "rm",
      "-sf",
      "tailscale",
    ]);
    expect(stopCommand(domain, "https")).toBeNull();
    expect(stopCommand(null, "tailscale")).toBeNull();
    expect(stopCommand("COMPOSE_PROFILES=backup\n", null)).toBeNull();
  });

  test("secrets are generated only when missing, never replaced", () => {
    const fresh = secretEntries(null);
    expect(fresh.AGENTES_SECRET?.length).toBe(64);
    expect(fresh.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
    expect(secretEntries("AGENTES_SECRET=kept\nPOSTGRES_PASSWORD=kept\n")).toEqual({});
    expect(Object.keys(secretEntries("AGENTES_SECRET=kept\nPOSTGRES_PASSWORD=\n"))).toEqual(["POSTGRES_PASSWORD"]);
  });

  test("covers what the app requires: .env.example's required values come from the setup or the compose file", () => {
    const required = [...readFileSync(join(root, ".env.example"), "utf8").matchAll(/^# Required\.\n(\w+)=/gm)].map(
      (m) => m[1],
    );
    expect(required.sort()).toEqual(["AGENTES_SECRET", "DATABASE_URL"]);
    expect(Object.keys(secretEntries(null))).toContain("AGENTES_SECRET");
    expect(readFileSync(join(root, "docker-compose.yml"), "utf8")).toContain("DATABASE_URL:");
  });

  test("an OAuth client secret registers a tagged device that stays", () => {
    expect(tailscaleKeyEntries(AUTH_KEY, DEFAULT_TAG, null)).toEqual({ TS_AUTHKEY: AUTH_KEY });
    expect(tailscaleKeyEntries(CLIENT_SECRET, "tag:chat", "--ssh --advertise-tags=tag:old")).toEqual({
      TS_AUTHKEY: `${CLIENT_SECRET}?ephemeral=false&preauthorized=true`,
      TS_EXTRA_ARGS: "--ssh --advertise-tags=tag:chat",
    });
    const pasted = `${CLIENT_SECRET}?ephemeral=false`;
    expect(tailscaleKeyEntries(pasted, DEFAULT_TAG, null).TS_AUTHKEY).toBe(pasted);
  });
});

describe("Tailscale", () => {
  const status = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      BackendState: "Running",
      CurrentTailnet: { Name: "you@example.com", MagicDNSSuffix: "tail1234.ts.net", MagicDNSEnabled: true },
      CertDomains: ["agentes.tail1234.ts.net"],
      Self: { DNSName: "agentes.tail1234.ts.net.", KeyExpiry: "2027-04-19T12:00:00Z" },
      ...overrides,
    });

  test("on the tailnet with HTTPS: the address, and when its key expires", () => {
    expect(readTailscaleStatus(status())).toEqual({
      kind: "ready",
      url: "https://agentes.tail1234.ts.net",
      keyExpiry: "2027-04-19T12:00:00Z",
    });
    // A tagged device's key doesn't expire.
    expect(readTailscaleStatus(status({ Self: { DNSName: "agentes.tail1234.ts.net." } }))).toMatchObject({
      keyExpiry: null,
    });
  });

  test("the tailnet settings it needs, each with the click that fixes it", () => {
    expect(readTailscaleStatus(status({ CertDomains: null }))).toEqual({ kind: "problem", problem: PROBLEMS.https });
    expect(readTailscaleStatus(status({ CurrentTailnet: { MagicDNSEnabled: false }, CertDomains: [] }))).toEqual({
      kind: "problem",
      problem: PROBLEMS.magicDns,
    });
    expect(PROBLEMS.https.fix).toContain("Enable HTTPS");
    expect(PROBLEMS.magicDns.fix).toContain("Enable MagicDNS");
  });

  test("still on its way: starting, logging in, or waiting for approval", () => {
    expect(readTailscaleStatus(status({ BackendState: "NeedsMachineAuth" }))).toEqual({
      kind: "waiting",
      reason: "approval",
    });
    expect(readTailscaleStatus(status({ BackendState: "NeedsLogin" }))).toEqual({ kind: "waiting", reason: "login" });
    expect(readTailscaleStatus(status({ BackendState: "Starting" }))).toEqual({ kind: "waiting", reason: "starting" });
    expect(readTailscaleStatus("not json")).toEqual({ kind: "waiting", reason: "starting" });
  });

  test("the container's log says what went wrong; the latest line wins", () => {
    const refused = "boot: 2026/10/21 tailscale up failed: backend error: invalid key: API key kAbC123CNTRL not valid";
    expect(diagnoseTailscaleLogs(refused, DEFAULT_TAG)).toEqual(PROBLEMS.key);
    expect(diagnoseTailscaleLogs("requested tags [tag:agentes] are invalid or not permitted", "tag:x")).toMatchObject({
      check: "tailscale.tag",
      error: expect.stringContaining("tag:x"),
    });
    expect(
      diagnoseTailscaleLogs("boot: machine authorization required, please visit the admin panel", DEFAULT_TAG),
    ).toBe("approval");
    expect(
      diagnoseTailscaleLogs(
        "serve proxy: … To make it work, ensure that HTTPS is enabled for your tailnet",
        DEFAULT_TAG,
      ),
    ).toEqual(PROBLEMS.https);
    expect(diagnoseTailscaleLogs(`${refused}\nmachine authorization required`, DEFAULT_TAG)).toBe("approval");
    expect(diagnoseTailscaleLogs('boot: tailscaled in state "Starting", waiting', DEFAULT_TAG)).toBeNull();
  });

  test("addresses Tailscale gives", () => {
    expect(isTailnetUrl("https://agentes.tail1234.ts.net")).toBe(true);
    expect(isTailnetUrl("http://agentes.tail1234.ts.net")).toBe(false);
    expect(isTailnetUrl("https://chat.example.com")).toBe(false);
    expect(isTailnetUrl(null)).toBe(false);
  });
});

describe("Docker", () => {
  test("Compose versions, as each build prints them", () => {
    expect(versionAtLeast("2.23.1", "2.23.1")).toBe(true);
    expect(versionAtLeast("v2.29.7-desktop.1", "2.23.1")).toBe(true);
    expect(versionAtLeast("2.21.0", "2.23.1")).toBe(false);
    expect(versionAtLeast("1.29.2", "2.23.1")).toBe(false);
    expect(versionAtLeast("unknown", "2.23.1")).toBe(false);
  });

  test("a port in use names the port and the fix", () => {
    const app = diagnoseCompose(
      "Error response from daemon: driver failed programming external connectivity on endpoint x-agentes-1 (abc): Bind for 127.0.0.1:3000 failed: port is already allocated",
      "linux",
    );
    expect(app).toMatchObject({ check: "port", error: expect.stringContaining("Port 3000") });
    expect(app?.fix).toContain("HOST_PORT=3001");
    expect(app?.fix).toContain("ss -ltnp 'sport = :3000'");
    const web = diagnoseCompose(
      "Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:443 -> 0.0.0.0:0: listen tcp 0.0.0.0:443: bind: address already in use",
      "darwin",
    );
    expect(web).toMatchObject({ check: "port", error: expect.stringContaining("ports 80 and 443") });
    expect(web?.fix).toContain("lsof -nP -iTCP:443");
  });

  test("Docker itself: not running, not allowed, out of disk; anything else is shown as is", () => {
    expect(
      diagnoseCompose("Cannot connect to the Docker daemon at unix:///var/run/docker.sock.", "linux"),
    ).toMatchObject({
      check: "docker.daemon",
    });
    expect(
      diagnoseCompose(
        "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock",
        "linux",
      ),
    ).toMatchObject({ check: "docker.permission" });
    expect(diagnoseCompose("write /var/lib/docker/tmp/x: no space left on device", "linux")).toMatchObject({
      check: "disk",
    });
    expect(diagnoseCompose("something new went wrong", "linux")).toBeNull();
  });

  test("the app's own refusal names the values to fix", () => {
    const logs =
      "Invalid configuration:\n  - AGENTES_SECRET is required\n  - PUBLIC_URL: Invalid URL\n\nCopy .env.example";
    expect(diagnoseAppLogs(logs)).toMatchObject({
      check: "app.config",
      error: "The app refused its configuration: AGENTES_SECRET is required. PUBLIC_URL: Invalid URL.",
    });
    expect(diagnoseAppLogs('{"level":"info","msg":"starting agentes.chat"}')).toBeNull();
  });
});

describe("the agents' computer", () => {
  const GB = 1024 ** 3;
  const server: ThisMachine = {
    platform: "linux",
    arch: "x64",
    memory: 8 * GB,
    root: true,
    systemd: true,
    bpf: true,
    apt: true,
    connected: false,
  };
  const mac: ThisMachine = {
    ...server,
    platform: "darwin",
    memory: 16 * GB,
    root: false,
    systemd: false,
    bpf: false,
    apt: false,
  };

  test("yes by default on a Linux server with room for agents' screens, and on a Mac", () => {
    expect(computerOffer(server, null, false)).toEqual({ mac: false, simple: false, yes: true, why: null });
    // A "4 GB" server reports a little less.
    expect(computerOffer({ ...server, memory: 3.8 * GB }, null, false)).toMatchObject({ yes: true });
    expect(computerOffer(mac, null, false)).toEqual({ mac: true, simple: false, yes: true, why: null });
  });

  test("no by default under 4 GB, or without apt-get for the screens' and browsers' packages, saying why", () => {
    expect(computerOffer({ ...server, memory: 2 * GB }, null, false)).toEqual({
      mac: false,
      simple: false,
      yes: false,
      why: "This machine has 2 GB of memory. Each agent's screen needs about 0.2 GB, and its browser 0.6 GB more.",
    });
    expect(computerOffer({ ...server, memory: 1.9 * GB }, null, false)).toMatchObject({
      why: expect.stringMatching(/^This machine has 1\.9 GB of memory\./),
    });
    expect(computerOffer({ ...server, apt: false }, null, false)).toEqual({
      mac: false,
      simple: false,
      yes: false,
      why: "This machine has no apt-get, so the packages agents' screens and browsers need would be yours to install.",
    });
  });

  test("skipped where it can't be, each with the reason and what to do instead", () => {
    const why = (machine: ThisMachine, content: string | null = null, image = false) => {
      const offer = computerOffer(machine, content, image);
      return "problem" in offer ? offer.problem : null;
    };
    for (const open of ["ALLOW_SIGNUP=true\n", "ALLOW_SIGNUP=1\n", "ALLOW_SIGNUP=yes\n"]) {
      expect(why(server, open)?.error).toContain("Sign-up is open here (ALLOW_SIGNUP=true)");
    }
    expect(why(server, "ALLOW_SIGNUP=false\n")).toBeNull();
    // Every workspace gets a computer from a provisioner, and the server takes no other.
    expect(why(server, "MACHINE_PROVISIONING=external\n")).toEqual({
      check: "computer",
      error:
        "Each workspace here gets a computer of its own from a provisioner (MACHINE_PROVISIONING=external), and no other computer joins it.",
      fix: "Set MACHINE_PROVISIONING=off in .env to use this machine instead.",
    });
    expect(why(server, "MACHINE_PROVISIONING=off\n")).toBeNull();
    expect(why({ ...server, root: false })?.error).toContain("needs root");
    expect(why({ ...server, systemd: false })?.error).toContain("systemd isn't running");
    // Ubuntu's systemd can't keep each agent its own user: offered in simple mode instead (ADR 0153 §5).
    expect(why({ ...server, bpf: false })).toBeNull();
    expect(why(server, null, true)?.fix).toBe(
      "Run the installer on the server for this folder instead, with --dir <folder> --computer yes: https://agentes.chat/docs/install-on-a-server#computers",
    );
    expect(why({ ...server, platform: "win32" })?.error).toBe("The agents' computer runs on Linux or a Mac.");
    // Already a computer of some server: its service would be replaced.
    for (const machine of [server, mac]) {
      expect(why({ ...machine, connected: true })?.error).toBe(
        "This machine is already connected to agentes.chat as a computer, so it can't also be this server's own.",
      );
    }
    for (const machine of [
      { ...server, root: false },
      { ...server, systemd: false },
      { ...server, connected: true },
    ]) {
      expect(why(machine)?.fix).toContain("Settings › Devices");
    }
  });

  test("a runner's config.json is a connected computer's when it has a token", () => {
    expect(connectedConfig('{ "server": "https://agentes.chat", "token": "agm_x" }')).toBe(true);
    for (const text of [null, "", "{}", '{ "mode": "system" }', '{ "token": "" }', "not json"]) {
      expect([text, connectedConfig(text)]).toEqual([text, false]);
    }
  });

  test(".env remembers the answer: a token for yes, the key left empty for no", () => {
    expect(computerOf(null)).toBeNull();
    expect(computerOf("AGENTES_SECRET=x\n")).toBeNull();
    expect(computerOf(`HOST_COMPUTER_TOKEN=${"t".repeat(64)}\n`)).toBe("on");
    expect(computerOf("HOST_COMPUTER_TOKEN=\n")).toBe("off");
  });

  test("this machine reaches the app where the compose file publishes it", () => {
    expect(appOnThisMachine(null)).toBe("http://127.0.0.1:3000");
    expect(appOnThisMachine("HOST_PORT=3001\n")).toBe("http://127.0.0.1:3001");
    expect(appOnThisMachine("BIND_ADDRESS=0.0.0.0\n")).toBe("http://127.0.0.1:3000");
    expect(appOnThisMachine("BIND_ADDRESS=[::]\n")).toBe("http://127.0.0.1:3000");
    // Published on one address only: loopback isn't it, and whatever answers there isn't agentes.chat.
    expect(appOnThisMachine("BIND_ADDRESS=10.0.0.5\nHOST_PORT=8080\n")).toBe("http://10.0.0.5:8080");
  });

  test("set up with the server's own installer: system mode on Linux, as the person on a Mac", () => {
    const linux = computerInstall({
      mac: false,
      server: "http://127.0.0.1:3001",
      tokenFile: "/opt/agentes/host-computer-token",
      commands: true,
    });
    expect(linux).toEqual({
      server: "http://127.0.0.1:3001",
      script: "http://127.0.0.1:3001/api/machines/install.sh",
      args: [
        "--system",
        "--desktop",
        "--server",
        "http://127.0.0.1:3001",
        "--host-token-file",
        "/opt/agentes/host-computer-token",
      ],
    });
    const onMac = computerInstall({
      mac: true,
      server: "http://127.0.0.1:3000",
      tokenFile: "/Users/ana/my agentes/host-computer-token",
      commands: false,
    });
    expect(onMac.args).toEqual([
      "--server",
      "http://127.0.0.1:3000",
      "--host-token-file",
      "/Users/ana/my agentes/host-computer-token",
      "--no-exec",
    ]);
    expect(computerCommand(onMac)).toBe(
      "curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --server http://127.0.0.1:3000 --host-token-file '/Users/ana/my agentes/host-computer-token' --no-exec",
    );
  });

  describe("what the run decides, question by question", () => {
    const TOKEN = `HOST_COMPUTER_TOKEN=${"t".repeat(64)}\n`;
    const decide = (
      machine: ThisMachine,
      over: Partial<Parameters<typeof decideComputer>[0]> = {},
    ): ReturnType<typeof decideComputer> =>
      decideComputer({
        offer: computerOffer(machine, over.content ?? null, false),
        content: null,
        installed: null,
        answers: {},
        server: "http://127.0.0.1:3000",
        tokenFile: "/opt/agentes/host-computer-token",
        ...over,
      });
    const plan = (d: ReturnType<typeof decideComputer>) => ("plan" in d ? d.plan : null);

    test("a first run asks, yes by default; yes writes a new token, no the key left empty", () => {
      expect(decide(server)).toEqual({ ask: "computer", yes: true });
      expect(decide({ ...server, memory: 2 * GB })).toEqual({ ask: "computer", yes: false });
      const yes = decide(server, { answers: { on: true } });
      expect(plan(yes)).toMatchObject({ state: "on", mac: false, commands: true, kept: false });
      expect("entries" in yes && yes.entries.HOST_COMPUTER_TOKEN).toMatch(/^[A-Za-z0-9+/]{64}$/);
      expect(decide(server, { answers: { on: false } })).toEqual({
        plan: { state: "off", wasOn: false },
        entries: { HOST_COMPUTER_TOKEN: "" },
      });
    });

    test("on a Mac a second question, commands, yes by default", () => {
      expect(decide(mac, { answers: { on: true } })).toEqual({ ask: "commands", yes: true });
      const no = plan(decide(mac, { answers: { on: true, commands: false } }));
      expect(no).toMatchObject({ state: "on", mac: true, commands: false });
      expect(no?.state === "on" && no.install.args).toContain("--no-exec");
      expect(plan(decide(mac, { commands: "yes", answers: { on: true } }))).toMatchObject({ commands: true });
    });

    test("a run again asks nothing: .env has the answer, the installed service whether commands are on", () => {
      const again = decide(server, { content: TOKEN });
      expect(again).toEqual({ plan: expect.objectContaining({ state: "on", kept: true }), entries: {} });
      expect(decide(server, { content: "HOST_COMPUTER_TOKEN=\n" })).toEqual({
        plan: { state: "off", wasOn: false },
        entries: {},
      });
      for (const installed of [true, false]) {
        expect(plan(decide(mac, { content: TOKEN, installed }))).toMatchObject({ commands: installed, kept: true });
      }
      // On before, but nothing installed yet (the first run stopped short): still no question, commands on.
      expect(plan(decide(mac, { content: TOKEN }))).toMatchObject({ state: "on", commands: true, kept: true });
    });

    test("flags answer without asking; one given sets the computer up again", () => {
      expect(plan(decide(server, { computer: "yes" }))).toMatchObject({ state: "on", kept: false });
      expect(plan(decide(server, { content: TOKEN, computer: "yes" }))).toMatchObject({ state: "on", kept: false });
      expect(plan(decide(server, { content: TOKEN, commands: "no" }))).toMatchObject({ commands: false, kept: false });
      // Turned off after a yes: the token goes, and the run says how to remove what ran agents here.
      expect(decide(server, { content: TOKEN, computer: "no" })).toEqual({
        plan: { state: "off", wasOn: true },
        entries: { HOST_COMPUTER_TOKEN: "" },
      });
    });

    test("where it can't be: skipped and .env left alone, refused when asked for, stopped when the server wouldn't start", () => {
      const noRoot = { ...server, root: false };
      expect(decide(noRoot)).toEqual({
        plan: { state: "skipped", why: "Each agent gets a user of its own on this machine, which needs root." },
        entries: {},
      });
      expect(decide(noRoot, { computer: "yes" })).toEqual({ problem: expect.objectContaining({ check: "computer" }) });
      expect(decide(noRoot, { computer: "no" })).toEqual({
        plan: { state: "off", wasOn: false },
        entries: { HOST_COMPUTER_TOKEN: "" },
      });
      // Run again as someone else: the computer set up earlier stays on.
      expect(decide(noRoot, { content: TOKEN })).toMatchObject({ plan: { state: "skipped" }, entries: {} });
      // Sign-up opened, or a provisioner turned on, after a yes: the server refuses to start with either.
      expect(decide(server, { content: `${TOKEN}ALLOW_SIGNUP=true\n` })).toEqual({
        problem: {
          check: "computer",
          error:
            "agentes.chat doesn't start with this machine's token (HOST_COMPUTER_TOKEN in .env) and ALLOW_SIGNUP=true together.",
          fix: "Set ALLOW_SIGNUP=false in .env, or run the setup again with --computer no.",
        },
      });
      const provisioned = decide(server, { content: `${TOKEN}MACHINE_PROVISIONING=external\n` });
      expect("problem" in provisioned && provisioned.problem.fix).toBe(
        "Set MACHINE_PROVISIONING=off in .env, or run the setup again with --computer no.",
      );
      expect(decide(server, { content: `${TOKEN}MACHINE_PROVISIONING=external\n`, computer: "no" })).toEqual({
        plan: { state: "off", wasOn: true },
        entries: { HOST_COMPUTER_TOKEN: "" },
      });
    });
  });

  test("whether the installed service lets agents run commands, from its own arguments", () => {
    const unit = (args: string) =>
      `[Unit]\nDescription=agentes.chat runner\n\n[Service]\nExecStart="/opt/agentes-runner/bin/bun" "/opt/agentes-runner/agentes-runner.mjs" ${args}\n`;
    expect(installedCommands(unit("host --server http://127.0.0.1:3000 --token-file /opt/agentes/t"))).toBe(true);
    expect(installedCommands(unit("host --server http://127.0.0.1:3000 --no-exec"))).toBe(false);
    const plist = (args: string[]) =>
      `<key>ProgramArguments</key>\n  <array>\n    ${args.map((a) => `<string>${a}</string>`).join("\n    ")}\n  </array>`;
    expect(installedCommands(plist(["/usr/local/bin/bun", "host", "--no-exec"]))).toBe(false);
    expect(installedCommands(plist(["/usr/local/bin/bun", "host"]))).toBe(true);
    // A connected computer's own service, or none.
    expect(installedCommands(unit("start"))).toBeNull();
    expect(installedCommands(plist(["/usr/local/bin/bun", "start"]))).toBeNull();
    expect(installedCommands(null)).toBeNull();
  });

  test("a computer kept from an earlier run is left running only when it's up to date", () => {
    const fine = { kept: true, running: true, state: "on" as const, installed: "runner v1", served: "runner v1" };
    expect(computerUpToDate(fine)).toBe(true);
    for (const change of [
      { kept: false },
      { running: false },
      { state: "unreachable" as const },
      { state: null },
      { served: "runner v2" },
      { installed: null },
      { installed: null, served: null },
    ]) {
      expect([change, computerUpToDate({ ...fine, ...change })]).toEqual([change, false]);
    }
  });

  test("its state, from the lines it logs: the latest wins, its organizations' lines don't count", () => {
    const at = "2026-10-25T12:00:00.000Z";
    expect(hostState("")).toBeNull();
    expect(
      hostState(
        `${at} agentes-runner 0.9.0: this server's computer for http://127.0.0.1:3000 (/var/lib/agentes-runner)`,
      ),
    ).toBeNull();
    expect(hostState(`${at} can't reach http://127.0.0.1:3000 (Unable to connect); trying again`)).toBe("unreachable");
    expect(
      hostState(`${at} can't reach http://127.0.0.1:3000 (refused); trying again\n${at} serving 0 organizations`),
    ).toBe("on");
    expect(hostState(`${at} serving 1 organization`)).toBe("on");
    expect(hostState(`${at} the server has this computer turned off (no HOST_COMPUTER_TOKEN there): waiting`)).toBe(
      "off",
    );
    expect(
      hostState(`${at} the server refused this computer's token (HOST_COMPUTER_TOKEN): waiting for the right one`),
    ).toBe("refused");
    expect(hostState(`${at} no HOST_COMPUTER_TOKEN to show the server: waiting for it`)).toBe("no_token");
    expect(hostState(`[Acme] ${at} serving 3 organizations`)).toBeNull();
  });
});

describe("usage statistics", () => {
  test("TELEMETRY read as the server reads it: on, off, or not said yet", () => {
    expect(telemetryOf(null)).toBeNull();
    expect(telemetryOf("TELEMETRY=\n")).toBeNull();
    expect(telemetryOf("TELEMETRY=on\n")).toBe("on");
    expect(telemetryOf("TELEMETRY=off\n")).toBe("off");
    expect(telemetryOf("TELEMETRY=False\n")).toBe("off");
    expect(telemetryOf("TELEMETRY=1\n")).toBe("on");
    expect(telemetryOf("TELEMETRY=maybe\n")).toBeNull();
    expect(envFlag("ALLOW_SIGNUP=enabled\n", "ALLOW_SIGNUP")).toBe(true);
    expect(envFlag("ALLOW_SIGNUP=n\n", "ALLOW_SIGNUP")).toBe(false);
  });

  test("asked once, yes by default; either answer goes into .env, and a run again keeps it", () => {
    expect(decideTelemetry({ content: null })).toEqual({
      ask: true,
      value: "on",
      kept: false,
      entries: { TELEMETRY: "on" },
    });
    expect(decideTelemetry({ content: null, answer: false })).toMatchObject({
      value: "off",
      entries: { TELEMETRY: "off" },
    });
    for (const value of ["on", "off"] as const) {
      expect(decideTelemetry({ content: `TELEMETRY=${value}\n` })).toEqual({
        ask: false,
        value,
        kept: true,
        entries: {},
      });
    }
    expect(decideTelemetry({ flag: "off", content: "TELEMETRY=on\n" })).toEqual({
      ask: false,
      value: "off",
      kept: false,
      entries: { TELEMETRY: "off" },
    });
  });
});

describe("the end", () => {
  test("the link the phone app opens, and its QR code", () => {
    const link = appLink("https://agentes.tail1234.ts.net");
    expect(link).toBe("agenteschat://connect?server=https%3A%2F%2Fagentes.tail1234.ts.net");
    const rows = qrCode(link).split("\n");
    // Two modules per text row, square, with a quiet border.
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect([...row].length).toBe([...(rows[0] as string)].length);
    expect(Math.abs([...(rows[0] as string)].length - rows.length * 2)).toBeLessThanOrEqual(1);
  });

  test("what it shows and returns: the link only for https, the computer's failure with agentes.chat still up", () => {
    const app = { health: { status: "ok", version: "1.4.0" }, firstRun: true };
    const choices = { computer: "on" as const, telemetry: "on" as const, jev: "ok" as const };
    const tailnet = theEnd({
      network: "tailscale",
      url: "https://agentes.tail1234.ts.net",
      app,
      keyExpiry: null,
      choices,
      failed: null,
      ssh: SSH,
    });
    expect(tailnet.link).toBe("agenteschat://connect?server=https%3A%2F%2Fagentes.tail1234.ts.net");
    expect(tailnet.result).toEqual({
      ok: true,
      network: "tailscale",
      url: "https://agentes.tail1234.ts.net",
      health: app.health,
      ownerExists: false,
      appLink: tailnet.link,
      phoneLink: tailnet.link,
      computer: "on",
      telemetry: "on",
      jev: "ok",
      nextSteps: tailnet.steps,
    });
    // A phone opens no http server, and reaches only its own localhost.
    const local = theEnd({
      network: "local",
      url: "http://localhost:3000",
      app,
      keyExpiry: null,
      choices,
      failed: null,
      ssh: SSH,
    });
    expect(local.link).toBeNull();
    expect(local.result).toMatchObject({ appLink: null, phoneLink: null });
    const failed = {
      check: "computer.install",
      error: "Setting up the agents' computer failed: x",
      fix: "Run it again.",
    };
    expect(
      theEnd({
        network: "tailscale",
        url: "https://agentes.tail1234.ts.net",
        app,
        keyExpiry: null,
        choices,
        failed,
        ssh: SSH,
      }).result,
    ).toMatchObject({ ok: false, ...failed, url: "https://agentes.tail1234.ts.net", appLink: tailnet.link });
    expect(
      theEnd({
        network: "tailscale",
        url: "https://a.ts.net",
        app: null,
        keyExpiry: null,
        choices: null,
        first: ["Run it."],
        failed: null,
        ssh: SSH,
      }),
    ).toMatchObject({ steps: expect.arrayContaining(["Run it."]), result: { ownerExists: null, health: null } });
  });

  test("next steps: the tailnet, the phone, and the key that would expire", () => {
    const steps = nextSteps({
      network: "tailscale",
      url: "https://agentes.tail1234.ts.net",
      firstRun: true,
      keyExpiry: "2027-04-19T12:00:00Z",
      ssh: SSH,
    });
    expect(steps[0]).toBe(
      "On a computer or phone signed in to your tailnet, open https://agentes.tail1234.ts.net and create your account: the first one owns this instance.",
    );
    expect(steps.join("\n")).toContain('"Disable Key Expiry", or it leaves your tailnet on 2027-04-19');
    const local = nextSteps({
      network: "local",
      url: "http://localhost:3001",
      firstRun: false,
      keyExpiry: null,
      ssh: SSH,
    });
    expect(local).toEqual([
      "Open http://localhost:3001 and sign in.",
      "On a server, open it from your computer through an SSH tunnel:\n$ ssh -L 3001:localhost:3001 ana@203.0.113.7",
    ]);
    const proxy = nextSteps({
      network: "proxy",
      url: "https://chat.example.com",
      firstRun: false,
      keyExpiry: null,
      ssh: SSH,
    });
    expect(proxy[0]).toBe("Open https://chat.example.com and sign in.");
    expect(proxy[1]).toStartWith("Phone: point the camera at the QR code above");
    // An http proxy has no QR code to point at.
    expect(
      nextSteps({ network: "proxy", url: "http://192.168.1.5:3000", firstRun: false, keyExpiry: null, ssh: SSH }),
    ).toEqual(["Open http://192.168.1.5:3000 and sign in."]);
  });

  test("the phone app's sign-in screen, in the words it shows in English and in Portuguese", () => {
    const labels = [mobileEn.auth.server, mobilePtBR.auth.server].flatMap((s) => [s.change, s.scan]);
    const phone = [
      nextSteps({ network: "tailscale", url: "https://a.tail1234.ts.net", firstRun: true, keyExpiry: null, ssh: SSH }),
      nextSteps({ network: "domain", url: "https://chat.example.com", firstRun: false, keyExpiry: null, ssh: SSH }),
    ].map((steps) => steps[1]);
    for (const step of phone) for (const label of labels) expect(step).toContain(`"${label}"`);
  });
});

describe("an SSH tunnel", () => {
  const user = (env: Record<string, string>) => sshTarget(env).user;
  const at = (connection: string) => sshTarget({ USER: "ana", SSH_CONNECTION: connection });

  test("as the person behind sudo, else this user; without either (inside the image), a placeholder, not root", () => {
    expect(user({ SUDO_USER: "ana", USER: "root" })).toBe("ana");
    expect(user({ USER: "ana", LOGNAME: "ana" })).toBe("ana");
    expect(user({ LOGNAME: "ana" })).toBe("ana");
    expect(user({})).toBe("<user>");
    expect(sshTunnel("3000", sshTarget({}))).toBe("ssh -L 3000:localhost:3000 <user>@<server-address>");
  });

  test("to the address the SSH session came in on, unless that one is behind NAT", () => {
    expect(at("198.51.100.20 51234 203.0.113.7 22").host).toBe("203.0.113.7");
    expect(at("192.168.1.20 51234 192.168.1.50 22").host).toBe("192.168.1.50");
    expect(at("100.101.102.103 51234 100.64.0.5 22").host).toBe("100.64.0.5");
    expect(at("2001:db8::1 51234 2001:db8::7 22").host).toBe("2001:db8::7");
    // A cloud's 1:1 NAT: the session came in on a public address this server never sees.
    expect(at("198.51.100.20 51234 172.31.5.6 22").host).toBeNull();
    expect(sshTarget({ USER: "ana" }).host).toBeNull();
    expect(at("").host).toBeNull();
  });

  test("on the port the SSH session came in on, when it isn't 22", () => {
    expect(at("198.51.100.20 51234 203.0.113.7 22").port).toBeNull();
    // Behind NAT the address is unknown, but a 1:1 NAT keeps the port.
    const natted = at("198.51.100.20 51234 172.31.5.6 2222");
    expect(natted).toEqual({ user: "ana", host: null, port: "2222" });
    expect(sshTunnel("3000", natted)).toBe("ssh -p 2222 -L 3000:localhost:3000 ana@<server-address>");
  });

  test("a public domain starts privately: the owner's account through a tunnel to the domain, on the same port", () => {
    const ssh = at("198.51.100.20 51234 172.31.5.6 2222");
    // The tunnel's command on a line of its own ("$ "), to copy whole.
    expect(privateStart({ domain: "chat.example.com", port: "3000", ssh }).steps).toEqual([
      "From your computer, open a tunnel to this server:\n$ ssh -p 2222 -L 3000:localhost:3000 ana@chat.example.com",
      "Open http://localhost:3000 and create your account: the first one owns the instance. It has to be port 3000 on your computer too: until chat.example.com goes live, sign-up works only at that address.",
    ]);
  });
});

describe("the plan", () => {
  const linux = computerInstall({
    mac: false,
    server: "http://127.0.0.1:3000",
    tokenFile: "/opt/agentes/host-computer-token",
    commands: true,
  });
  const base: PlanInput = {
    docker: null,
    questions: [],
    envExists: false,
    newSecrets: ["AGENTES_SECRET", "POSTGRES_PASSWORD"],
    network: "tailscale",
    publicUrl: { now: null, next: null },
    stop: null,
    hostname: "agentes",
    tailscale: "ask",
    domain: null,
    email: "skip",
    computer: { state: "on", mac: false, simple: false, commands: true, install: linux, kept: false },
    requirements: { present: [], install: [] },
    telemetry: { value: "on", kept: false },
    jev: "off",
    compose: null,
    start: true,
    image: false,
  };
  const finishLine =
    "finish: the address, the link that opens the agentes.chat phone or desktop app on it with its QR code, and what to do next";

  test("an empty directory on a tailnet: every step, in order", () => {
    expect(planSteps(base)).toEqual([
      ".env: create it, readable by you only, with AGENTES_SECRET and POSTGRES_PASSWORD generated",
      "network: Tailscale, COMPOSE_PROFILES=tailscale, device name agentes",
      "Tailscale: show the admin console steps and ask for an auth key",
      "email: none for now (set SMTP_URL or MILLIONSEND_API_KEY later)",
      "agents' computer: this machine, each agent a user of its own with a screen (HOST_COMPUTER_TOKEN, also in host-computer-token)",
      "usage statistics: sent to agentes.chat (TELEMETRY=on)",
      "compose: download docker-compose.yml from https://agentes.chat/install/docker-compose.yml",
      "start: docker compose up -d tailscale, wait until it's on the tailnet with HTTPS",
      "PUBLIC_URL: write the address Tailscale gives it (https://<device>.<tailnet>.ts.net)",
      "start: docker compose up -d, wait for the HTTPS certificate and /api/health",
      "agents' computer: curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --system --desktop --server http://127.0.0.1:3000 --host-token-file /opt/agentes/host-computer-token, then wait up to 90 s for it to answer",
      finishLine,
    ]);
  });

  test("the agents' computer: a Mac, kept, no, turned off, skipped; the usage statistics kept or off", () => {
    const onMac = computerInstall({
      mac: true,
      server: "http://127.0.0.1:3001",
      tokenFile: "/Users/ana/agentes/host-computer-token",
      commands: false,
    });
    const steps = planSteps({
      ...base,
      computer: { state: "on", mac: true, simple: false, commands: false, install: onMac, kept: false },
    });
    expect(steps).toContain(
      "agents' computer: this Mac, agents working as you in folders of their own, commands off (HOST_COMPUTER_TOKEN, also in host-computer-token)",
    );
    expect(steps).toContain(
      "agents' computer: curl -fsSL http://127.0.0.1:3001/api/machines/install.sh | sh -s -- --server http://127.0.0.1:3001 --host-token-file /Users/ana/agentes/host-computer-token --no-exec, then wait up to 90 s for it to answer",
    );
    const kept = planSteps({ ...base, computer: { ...base.computer, kept: true } as PlanInput["computer"] });
    expect(kept).toContain(
      "agents' computer: if it isn't running and up to date, curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --system --desktop --server http://127.0.0.1:3000 --host-token-file /opt/agentes/host-computer-token, then wait up to 90 s for it to answer",
    );
    const off = planSteps({
      ...base,
      computer: { state: "off", wasOn: false },
      telemetry: { value: "off", kept: false },
    });
    expect(off).toContain("agents' computer: not this machine (connect one later in Settings › Devices)");
    expect(off).toContain("usage statistics: not sent (TELEMETRY=off)");
    expect(off.some((s) => s.includes("install.sh"))).toBe(false);
    expect(planSteps({ ...base, computer: { state: "off", wasOn: true } })).toContain(
      "agents' computer: not this machine any more (HOST_COMPUTER_TOKEN emptied, host-computer-token removed)",
    );
    const skipped = planSteps({
      ...base,
      computer: { state: "skipped", why: "Each agent gets a user of its own on this machine, which needs root." },
      telemetry: { value: "off", kept: true },
    });
    expect(skipped).toContain(
      "agents' computer: skipped. Each agent gets a user of its own on this machine, which needs root.",
    );
    expect(skipped).toContain("usage statistics: keep what .env has (TELEMETRY=off)");
    // Without starting, the install waits for the run that starts it.
    expect(planSteps({ ...base, start: false }).some((s) => s.includes("install.sh"))).toBe(false);
  });

  test("simple mode and what the agents need: said before, installed as root, then the computer as its user", () => {
    const simple = computerInstall({
      mac: false,
      simple: true,
      server: "http://127.0.0.1:3000",
      tokenFile: "/opt/agentes/host-computer-token",
      commands: true,
    });
    expect(simple).toEqual({
      server: "http://127.0.0.1:3000",
      script: "http://127.0.0.1:3000/api/machines/install.sh",
      args: ["--server", "http://127.0.0.1:3000", "--host-token-file", "/home/agentes/host-computer-token"],
      user: "agentes",
    });
    const steps = planSteps({
      ...base,
      computer: { state: "on", mac: false, simple: true, commands: true, install: simple, kept: false },
      requirements: { present: ["claude"], install: ["browser", "desktop", "codex"] },
    });
    expect(steps).toContain(
      "agents' computer: this machine in simple mode, every agent as the user agentes (no sudo), commands on (HOST_COMPUTER_TOKEN, also in host-computer-token)",
    );
    expect(steps).toContain("already here for the agents: claude");
    const at = (start: string) => steps.findIndex((l) => l.startsWith(start));
    expect(steps[at("install for the agents")]).toBe(
      "install for the agents: curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --requirements browser,desktop,codex",
    );
    expect(steps[at("user agentes")]).toBe(
      "user agentes: create it if missing (no sudo), keep its services running (loginctl enable-linger), give it /home/agentes/host-computer-token",
    );
    expect(steps[at("agents' computer: curl")]).toBe(
      "agents' computer: curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | runuser -u agentes -- sh -s -- --server http://127.0.0.1:3000 --host-token-file /home/agentes/host-computer-token, then wait up to 90 s for it to answer",
    );
    // In that order, after agentes.chat is up.
    expect(at("start: docker compose up -d,")).toBeLessThan(at("install for the agents"));
    expect(at("install for the agents")).toBeLessThan(at("user agentes"));
    expect(at("user agentes")).toBeLessThan(at("agents' computer: curl"));
  });

  test("Jev: a key given is checked when the setup runs; one in .env stays; none says nothing", () => {
    const jev = (value: PlanInput["jev"]) => planSteps({ ...base, jev: value }).filter((l) => l.startsWith("Jev"));
    expect(jev("unchecked")).toEqual(["Jev: TYPESAFE_API_KEY from --typesafe-key, checked when the setup runs"]);
    expect(jev("kept")).toEqual(["Jev: keep what .env has (TYPESAFE_API_KEY)"]);
    expect(jev("off")).toEqual([]);
  });

  test("a second run keeps what's there", () => {
    const again = planSteps({
      ...base,
      envExists: true,
      newSecrets: [],
      tailscale: "joined",
      email: "set",
      compose: "docker-compose.yml",
    });
    expect(again).toContain(".env: keep it and add only what's missing");
    expect(again).toContain("Tailscale: already on the tailnet, no key needed");
    expect(again).toContain("email: keep what .env has");
    expect(again).toContain("compose: use docker-compose.yml");
  });

  test("a dry run lists the questions the real run asks", () => {
    const steps = planSteps({ ...base, questions: ["how people reach it", "email"] });
    expect(steps[0]).toBe("asks: how people reach it, email");
  });

  test("Docker is in the plan only when it's not fine: the run says it is, once, above the plan", () => {
    expect(planSteps(base).some((s) => s.includes("Docker"))).toBe(false);
    const missing = "Docker isn't installed. Install Docker: https://docs.docker.com/engine/install/";
    expect(planSteps({ ...base, docker: missing })[0]).toBe(missing);
  });

  test("a public domain waits for the owner before going live", () => {
    const steps = planSteps({ ...base, network: "domain", domain: "chat.example.com" });
    expect(steps).toContain("network: public domain chat.example.com, HTTPS by Caddy on ports 80 and 443");
    expect(steps.some((s) => s.startsWith("owner: wait for the first account"))).toBe(true);
    expect(steps).toContain(
      "PUBLIC_URL: https://chat.example.com, COMPOSE_PROFILES=https, then wait for the certificate",
    );
    const live = planSteps({
      ...base,
      network: "domain",
      domain: "chat.example.com",
      publicUrl: { now: "https://chat.example.com", next: null },
    });
    expect(live.slice(-3)).toEqual([
      "start: docker compose up -d, wait for https://chat.example.com",
      expect.stringMatching(/^agents' computer: curl -fsSL http:\/\/127\.0\.0\.1:3000\/api\/machines\/install\.sh /),
      finishLine,
    ]);
  });

  test("your own proxy is kept; a changed PUBLIC_URL and a removed way in are said before they happen", () => {
    const proxy = planSteps({
      ...base,
      envExists: true,
      network: "proxy",
      publicUrl: { now: "https://chat.example.com", next: null },
    });
    expect(proxy).toContain(
      "network: your own proxy or tunnel at https://chat.example.com (PUBLIC_URL and COMPOSE_PROFILES stay)",
    );
    expect(proxy.some((s) => s.startsWith("PUBLIC_URL:"))).toBe(false);
    expect(proxy.at(-1)).toBe(finishLine);
    expect(planSteps({ ...base, network: "proxy", publicUrl: { now: "http://10.0.0.5", next: null } }).at(-1)).toBe(
      "finish: the address and what to do next",
    );
    const local = planSteps({
      ...base,
      network: "local",
      publicUrl: { now: "https://agentes.tail1234.ts.net", next: "http://localhost:3000" },
      stop: ["compose", "--profile", "tailscale", "rm", "-sf", "tailscale"],
    });
    expect(local).toContain("PUBLIC_URL: http://localhost:3000, replacing https://agentes.tail1234.ts.net");
    expect(local).toContain("stop: docker compose --profile tailscale rm -sf tailscale, the way in it no longer uses");
    // No link and no QR code for localhost: a phone reaches only its own.
    expect(local.at(-1)).toBe("finish: the address and what to do next");
  });

  test("inside the image, and without starting: the commands to run", () => {
    const image = planSteps({ ...base, image: true });
    expect(image[0]).toBe("Docker: not checked here (setup inside the image)");
    expect(image.at(-1)).toBe("start: print the commands to run (docker compose up -d) and how to finish");
    expect(planSteps({ ...base, start: false }).at(-1)).toBe(image.at(-1));
  });
});

describe("the compose file the setup drives", () => {
  const file = readFileSync(join(root, "docker-compose.yml"), "utf8");
  const compose = Bun.YAML.parse(file) as {
    services: Record<string, Record<string, unknown>>;
    configs: Record<string, { content: string }>;
    volumes: Record<string, unknown>;
  };

  test("is the one the setup downloads, looked for in Compose's own order", () => {
    expect(COMPOSE_FILES).toEqual(["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"]);
    // A web page answered at its address (an instance older than the route) is never saved as it.
    expect(isComposeFile(file)).toBe(true);
    expect(isComposeFile('<!doctype html>\n<html lang="en"><div id="root"></div></html>')).toBe(false);
    expect(Object.keys(compose.services)).toEqual(
      expect.arrayContaining(["postgres", "agentes", "tailscale", "caddy"]),
    );
    expect(compose.services.caddy?.profiles).toEqual(["https"]);
  });

  test("Tailscale: pinned, its own profile, userspace, logged in once, state kept", () => {
    const tailscale = compose.services.tailscale as {
      image: string;
      profiles: string[];
      environment: Record<string, string>;
      configs: { source: string; target: string }[];
      volumes: string[];
      ports?: unknown;
      cap_add?: unknown;
      devices?: unknown;
    };
    expect(tailscale.image).toMatch(/^tailscale\/tailscale:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(tailscale.profiles).toEqual(["tailscale"]);
    expect(tailscale.environment).toMatchObject({
      TS_USERSPACE: "true",
      TS_AUTH_ONCE: "true",
      TS_STATE_DIR: "/var/lib/tailscale",
      TS_SERVE_CONFIG: "/config/serve.json",
    });
    expect(tailscale.configs).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose's interpolation, not a template literal
      { source: "tailscale-serve-${TAILSCALE_FUNNEL:-false}", target: "/config/serve.json" },
    ]);
    expect(tailscale.volumes).toEqual(["tailscale-state:/var/lib/tailscale"]);
    expect("tailscale-state" in compose.volumes).toBe(true);
    expect(tailscale.ports ?? tailscale.cap_add ?? tailscale.devices).toBeUndefined();
  });

  test("Caddy: its own Caddyfile, and while the app is down the page that says so, as a 503", () => {
    const caddy = compose.services.caddy as { command?: unknown; configs?: { source: string; target: string }[] };
    // The image's default command runs /etc/caddy/Caddyfile.
    expect(caddy.command).toBeUndefined();
    expect(caddy.configs).toEqual([
      { source: "caddyfile", target: "/etc/caddy/Caddyfile" },
      { source: "unavailable-page", target: "/etc/caddy/errors/unavailable.html" },
    ]);
    expect(compose.configs.caddyfile?.content).toBe(
      [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose's interpolation, not a template literal
        "${DOMAIN:-localhost} {",
        "\trequest_body /mcp* {",
        "\t\tmax_size 128KiB",
        "\t}",
        "\treverse_proxy agentes:3000",
        "\thandle_errors 502 503 504 {",
        "\t\troot * /etc/caddy/errors",
        "\t\trewrite * /unavailable.html",
        "\t\theader Cache-Control no-store",
        "\t\tfile_server {",
        "\t\t\tstatus 503",
        "\t\t}",
        "\t}",
        "}\n",
      ].join("\n"),
    );
    // Holding requests through a restart stays agentes.chat Cloud's.
    expect(file).not.toContain("lb_try_duration");
    // The compose file is downloaded alone, so the page travels inside it (`bun run sync:unavailable`).
    expect(compose.configs["unavailable-page"]?.content).toBe(
      readFileSync(join(root, "apps/web/public/unavailable.html"), "utf8"),
    );
  });

  test("the serve config: HTTPS on 443 to the app, Funnel only with TAILSCALE_FUNNEL=true", () => {
    // Compose turns $$ into $; the container then fills in its name.
    const serve = (funnel: string) =>
      JSON.parse(
        (compose.configs[`tailscale-serve-${funnel}`]?.content ?? "").replaceAll(
          "$${TS_CERT_DOMAIN}",
          "agentes.tail1234.ts.net",
        ),
      );
    const web = { "agentes.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://agentes:3000" } } } };
    expect(Object.keys(compose.configs).filter((name) => name.startsWith("tailscale-serve"))).toEqual([
      "tailscale-serve-false",
      "tailscale-serve-true",
    ]);
    expect(serve("false")).toEqual({ TCP: { "443": { HTTPS: true } }, Web: web });
    expect(serve("true")).toEqual({
      TCP: { "443": { HTTPS: true } },
      Web: web,
      AllowFunnel: { "agentes.tail1234.ts.net:443": true },
    });
  });
});

describe("what the agents need", () => {
  const all: Requirement[] = ["browser", "desktop", "claude", "codex"];
  test("--requirements: all, none, or a list in the order they're installed", () => {
    expect(parseRequirements("all")).toEqual(all);
    expect(parseRequirements("NONE")).toEqual([]);
    expect(parseRequirements("codex, browser")).toEqual(["browser", "codex"]);
    expect(parseRequirements("browser,chrome")).toBeNull();
    expect(parseOptions(["--requirements", "claude"], {})).toMatchObject({ options: { requirements: ["claude"] } });
    expect(parseOptions([], { AGENTES_SETUP_REQUIREMENTS: "none" })).toMatchObject({ options: { requirements: [] } });
    expect(parseOptions(["--requirements", "x"], {})).toEqual({
      error: "--requirements is all, none, or some of browser, desktop, claude, codex (comma-separated).",
    });
  });

  test("checked where the runner looks for each; system mode's installer brings the browser and screens itself", () => {
    const has = (paths: string[]) => (p: string) => paths.includes(p);
    const nothing = checkRequirements({ mac: false, simple: true, arch: "arm64", exists: has([]) });
    expect(nothing.map((c) => [c.id, c.present, c.withComputer])).toEqual([
      ["browser", false, false],
      ["desktop", false, false],
      ["claude", false, false],
      ["codex", false, false],
    ]);
    expect(nothing[0]?.label).toStartWith("Chromium");
    expect(askableRequirements(nothing).map((c) => c.id)).toEqual(all);
    // Ubuntu's snap Chromium on ARM, the screens' packages and Claude Code there already.
    const some = checkRequirements({
      mac: false,
      simple: true,
      arch: "arm64",
      exists: has(["/snap/bin/chromium", "/usr/bin/Xtigervnc", "/usr/bin/xfce4-session", "/usr/local/bin/claude"]),
    });
    expect(askableRequirements(some).map((c) => c.id)).toEqual(["codex"]);
    // On x86_64 only Google Chrome counts.
    const x64 = checkRequirements({ mac: false, simple: true, arch: "x64", exists: has(["/usr/bin/chromium"]) });
    expect(x64[0]).toMatchObject({ present: false, label: expect.stringMatching(/^Google Chrome/) });
    // System mode: only the coding CLIs are asked about.
    const system = checkRequirements({ mac: false, simple: false, arch: "x64", exists: has([]) });
    expect(askableRequirements(system).map((c) => c.id)).toEqual(["claude", "codex"]);
    expect(checkRequirements({ mac: true, simple: false, arch: "arm64", exists: has([]) })).toEqual([]);
  });

  test("Ubuntu (no BPF_FRAMEWORK) is offered simple mode, yes by default where there's room and apt", () => {
    const ubuntu: ThisMachine = {
      platform: "linux",
      arch: "arm64",
      memory: 24 * 1024 ** 3,
      root: true,
      systemd: true,
      bpf: false,
      apt: true,
      connected: false,
    };
    expect(computerOffer(ubuntu, null, false)).toEqual({ mac: false, simple: true, yes: true, why: null });
    const decided = decideComputer({
      offer: computerOffer(ubuntu, null, false),
      content: null,
      installed: null,
      answers: { on: true },
      server: "http://127.0.0.1:3000",
      tokenFile: "/opt/agentes/host-computer-token",
    });
    expect("plan" in decided && decided.plan).toMatchObject({
      state: "on",
      simple: true,
      commands: true,
      install: { user: "agentes", args: expect.not.arrayContaining(["--system"]) },
    });
    // Still root and systemd: simple mode makes its user and runs its service.
    expect(computerOffer({ ...ubuntu, root: false }, null, false)).toMatchObject({ problem: { check: "computer" } });
  });
});
