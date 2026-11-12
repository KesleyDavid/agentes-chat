/**
 * `npx @agenteschat/setup`: from an empty directory to a running agentes.chat, on a tailnet by default.
 * Inside the app image (`docker run … agentes setup`) there is no Docker to drive, so it prepares the
 * directory and prints the commands that finish the job.
 */
import { spawn, spawnSync } from "node:child_process";
import type { EventEmitter } from "node:events";
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, totalmem } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  appOnThisMachine,
  askableRequirements,
  COMPOSE_FILES,
  COMPOSE_URL,
  COMPUTER_PROBLEMS,
  COMPUTER_WAIT_S,
  type ComputerPlan,
  checkJevKey,
  checkRequirements,
  computerFiles,
  computerOffer,
  computerUpToDate,
  connectedConfig,
  DEFAULT_EMAIL_API_URL,
  DEFAULT_HOSTNAME,
  decideComputer,
  decideTelemetry,
  diagnoseAppLogs,
  diagnoseCompose,
  diagnoseDocker,
  diagnoseTailscaleLogs,
  dockerProblems,
  domainProblem,
  type EmailChoice,
  ENV_HEADER,
  emailFromProblem,
  envName,
  envValue,
  GUIDE_URL,
  HOST_LAUNCHD_LABEL,
  HOST_SERVICE,
  HOST_TOKEN_FILE,
  hostState,
  httpUrlProblem,
  IMAGE,
  ISSUES_URL,
  installedCommands,
  isComposeFile,
  isTailnetUrl,
  type JevChoice,
  jevStep,
  lastLine,
  MIN_COMPOSE,
  type Network,
  networkOf,
  normalizeDomain,
  type OnOff,
  type Options,
  outputLine,
  PROBLEMS,
  type Problem,
  parseOptions,
  plainStep,
  planSteps,
  privateStart,
  qrCode,
  REQUIREMENTS,
  type Requirement,
  type RequirementCheck,
  readTailscaleStatus,
  requirementsCommand,
  resolveChoice,
  SIMPLE_HOME,
  SIMPLE_MODE_WHY,
  SIMPLE_RUNNER_HOME,
  SIMPLE_TOKEN_FILE,
  SIMPLE_USER,
  SYSTEM_RUNNER_HOME,
  secretEntries,
  senderAt,
  senderFor,
  sentence,
  smtpUrlProblem,
  sshTarget,
  stopCommand,
  TELEMETRY_TEXT,
  type ThisMachine,
  TS,
  TYPESAFE_KEYS,
  tailscaleKeyEntries,
  tailscaleKeyProblem,
  theEnd,
  upsertEnv,
  versionAtLeast,
  wayIn,
  withNetworkProfile,
} from "./lib";
import { createTerm, type ListStyle, type Spinner } from "./term";

const HELP = `agentes.chat setup: a self-hosted agentes.chat with Docker, in the current directory.

Usage: npx @agenteschat/setup [options]

It asks only for what it needs and fills in only what's missing, so running it again is safe.

  --network <tailscale|domain|local>  How people reach it. tailscale (the default): private HTTPS on
                                      your tailnet, no domain or open port. domain: a public domain with
                                      Caddy on ports 80 and 443. local: http://localhost on this machine.
                                      Without it, a PUBLIC_URL of your own in .env (nginx, a tunnel)
                                      stays as it is.
  --tailscale-key <key>               Auth key (tskey-auth-…) or OAuth client secret (tskey-client-…)
  --tailscale-tag <tag:name>          The tag for an OAuth client secret (default tag:agentes)
  --hostname <name>                   The server's name on the tailnet (default agentes)
  --domain <host>                     The public domain, with --network domain
  --email <skip|smtp|api>             Email for invitations and password resets (default skip)
  --smtp-url <url>                    smtps://user:password@smtp.example.com:465
  --email-api-key <key>               Key of a Resend-compatible API (MillionSend, Resend)
  --email-api-url <url>               That API's address (default ${DEFAULT_EMAIL_API_URL})
  --email-from <sender>               "${senderAt("example.com")}"
  --computer <yes|no>                 This machine as your agents' computer. Default yes on a Mac, and
                                      on Linux as root with systemd (built with BPF_FRAMEWORK), apt-get
                                      and 4 GB of memory or more.
  --computer-commands <yes|no>        Whether agents may run commands there (default yes. On a Mac
                                      they work as you, on Linux each agent is its own user).
                                      Linux without BPF_FRAMEWORK (Ubuntu) offers simple mode instead:
                                      every agent as the user ${SIMPLE_USER}, without sudo
  --requirements <all|none|list>      What to install there for the agents when missing, without
                                      asking: ${REQUIREMENTS.join(", ")} (default: asked, yes each)
  --telemetry <on|off>                Send anonymous usage statistics to agentes.chat (default on)
  --typesafe-key <key>                TypeSafe key for Jev, optional (${TYPESAFE_KEYS})
  --no-start                          Write .env and docker-compose.yml, start nothing
  --timeout <seconds>                 How long each wait may take (default 300)
  --tailscale-status <file|->         Finish from \`tailscale status --json\` (setup inside the image)
  --dry-run                           Print the plan and change nothing
  --json                              No questions. The result as JSON on stdout, progress on stderr
  -h, --help

Every option can come from the environment too: AGENTES_SETUP_<OPTION>, like
AGENTES_SETUP_TAILSCALE_KEY=tskey-auth-… Without a terminal, answers are read one per line from
stdin, and an empty line or the end of the input takes the default.

Guide: ${GUIDE_URL}`;

/** The runner's home for the person running the setup, as the computers' installer picks it. */
const RUNNER_HOME = process.env.AGENTES_RUNNER_HOME || join(homedir(), ".agentes-runner");

class SetupError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.error);
  }
}

type Result = { ok: boolean } & Record<string, unknown>;

type App = { health: { status?: string; version?: string } & Record<string, unknown>; firstRun: boolean };

export async function main(argv: string[], context: { image?: boolean } = {}): Promise<number> {
  const parsed = parseOptions(argv, process.env);
  if ("error" in parsed) {
    if (argv.includes("--json") || /^(1|true|yes)$/i.test(process.env[envName("json")]?.trim() ?? "")) {
      const result = { ok: false, check: "options", error: parsed.error, fix: "Run with --help for the options." };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      // In the installer's frame too, which the setup closes.
      const term = createTerm();
      term.intro("setup", false);
      term.refuse(parsed.error);
      term.stop();
    }
    return 2;
  }
  const opts = parsed.options;
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const ui = createUi(opts);
  let result: Result;
  try {
    result = await run(opts, ui, context.image === true);
  } catch (error) {
    // Anything unforeseen still ends as a check and a fix, so --json always answers.
    const problem =
      error instanceof SetupError
        ? error.problem
        : {
            check: "unexpected",
            error: (error as Error)?.message ?? String(error),
            fix: `Run it again. If it fails the same way, open an issue with this output: ${ISSUES_URL}`,
          };
    ui.fail(problem);
    result = { ok: false, ...problem };
  } finally {
    ui.close();
  }
  // The setup speaks last, inside the installer's frame too: it closes the frame.
  if (!result.ok) ui.stop();
  else {
    ui.gap();
    ui.end(ui.ending);
  }
  if (opts.json) {
    const steps = Array.isArray(result.nextSteps) ? { nextSteps: result.nextSteps.map(plainStep) } : {};
    process.stdout.write(`${JSON.stringify({ ...result, ...steps }, null, 2)}\n`);
  }
  return result.ok ? 0 : 1;
}

// ── Terminal ────────────────────────────────────────────────────────────────

type Ui = ReturnType<typeof createUi>;

interface AskOptions {
  /** Shown before what's typed, and before the answer once answered. */
  label?: string;
  description?: string[];
  initial?: string;
  placeholder?: string;
  /** Typed unseen, and never shown once answered. */
  secret?: boolean;
  /** Without an answer: asked again on a terminal, this problem when piped. */
  missing?: Problem;
  validate?: (value: string) => string | null;
}

function createUi(opts: Options) {
  // With --json, stdout is for the result alone.
  const stream = opts.json ? process.stderr : process.stdout;
  const term = createTerm({ out: stream });
  /** A person at a terminal, who can be asked again and waited for. */
  const interactive = !opts.json && stream.isTTY === true && process.stdin.isTTY === true;
  /** Arrow-key questions where the terminal can draw them; typed lines otherwise. */
  const keys = !opts.json && term.interactive;

  let reader: ReturnType<typeof createInterface> | undefined;
  let lines: AsyncIterator<string> | undefined;
  /** The next line of stdin; someone typing at a terminal that can't draw the questions sees `prompt` first. */
  const readLine = async (prompt: string): Promise<string | null> => {
    if (process.stdin.isTTY) stream.write(prompt);
    if (!lines) {
      reader = createInterface({ input: process.stdin, terminal: false });
      lines = reader[Symbol.asyncIterator]();
    }
    const next = await lines.next();
    return next.done ? null : next.value;
  };
  /** Before a typed answer at a terminal that can't draw the question: the question itself. */
  const question = (title: string, lines: string[], style: ListStyle = "plain") => {
    if (process.stdin.isTTY) term.info(title, lines, style);
  };

  let wait: Spinner | null = null;
  let waiting = "";
  /** The spinner that is turning, taken: its last line is the caller's. */
  const ending = () => {
    const spinner = wait;
    wait = null;
    return spinner;
  };

  const ui = {
    interactive,
    /** Answers come from a terminal or from piped lines; never with --json, and not from a piped `tailscale status`. */
    canAsk: !opts.json && !opts.dryRun && opts.tailscaleStatus !== "-",
    /** The installer's frame is around this run: it showed the folder and Docker just before. */
    inherited: term.inherited,
    /** How a run that went well ends: "Done", or nothing when what's left is for the person to run. */
    ending: "Done",
    intro: () => term.intro("setup"),
    gap: () => term.gap(),
    end: (text: string) => term.end(text),
    stop: () => term.stop(),
    note: (text: string) => term.text(text, true),
    /** A wait's spinner, or a new label on the one turning (a new label clears its detail). */
    wait(label: string, detail: string | null = null) {
      if (!wait) wait = term.spin(label, detail);
      else if (label !== waiting) wait.update(label, detail);
      else if (detail !== null) wait.update(null, detail);
      waiting = label;
    },
    /** The latest line of what the wait runs, under its spinner. */
    detail(line: string) {
      wait?.update(null, line);
    },
    ok(text: string, ...detail: string[]) {
      const spinner = ending();
      if (spinner) spinner.done(text, ...detail);
      else term.step(text, ...detail);
    },
    warn(text: string) {
      const spinner = ending();
      if (spinner) spinner.warn(text);
      else term.warn(text);
    },
    fail(problem: Problem) {
      const spinner = ending();
      if (spinner) spinner.fail(problem.error, problem.fix);
      else term.fail(problem.error, problem.fix);
    },
    /** Something to read or do, apart from what's around it (above a wait that is turning). */
    list(title: string, items: string[], style: ListStyle = "bullets") {
      term.gap();
      term.info(title, items, style);
      term.gap();
    },
    /** A title for the lines under it (commands, a QR code). */
    heading(title: string) {
      term.gap();
      term.info(title);
    },
    command: (text: string, label?: string) => term.command(text, label),
    qr(text: string) {
      // Light modules drawn on a forced dark background: right on dark and light terminals alike.
      term.qr(qrCode(text).split("\n"));
    },
    /** An answer; empty takes `initial`. Piped, a bad answer stops the setup: nobody is there to ask again. */
    async ask(title: string, o: AskOptions = {}): Promise<string> {
      term.gap();
      const validate = (v: string) => {
        const problem = o.validate?.(v);
        return problem ? sentence(problem) : null;
      };
      const answer = keys ? await term.ask(title, { ...o, validate }) : await typed();
      term.gap();
      return answer;

      async function typed() {
        question(title, o.description ?? []);
        for (;;) {
          const line = await readLine(`${o.label ?? title}${o.initial ? ` [${o.initial}]` : ""}: `);
          const answer = (line ?? "").trim() || o.initial || "";
          const problem = answer ? (o.validate?.(answer) ?? null) : o.missing ? "an answer is needed." : null;
          if (!problem) {
            term.answered(title, answer, o.label ? `${o.label}: ` : "", o.secret);
            return answer;
          }
          if (!interactive || line === null) {
            throw new SetupError(
              !answer && o.missing
                ? o.missing
                : { check: "answer", error: `${title}: ${problem}`, fix: "Run with --help for the options." },
            );
          }
          term.warn(sentence(problem));
        }
      }
    },
    async choose<T extends string>(title: string, items: { value: T; label: string }[], initial: T): Promise<T> {
      term.gap();
      const values = items.map((item) => item.value);
      let value: T;
      if (keys) value = await term.choose(title, items, initial);
      else {
        question(
          title,
          items.map((item) => item.label),
          "numbered",
        );
        const first = String(values.indexOf(initial) + 1);
        for (;;) {
          const line = await readLine(`Choose [${first}]: `);
          const chosen = resolveChoice((line ?? "").trim() || first, values);
          if (chosen) {
            value = chosen;
            break;
          }
          const problem = `type a number from 1 to ${items.length}.`;
          if (!interactive || line === null) {
            throw new SetupError({
              check: "answer",
              error: `Choose: ${problem}`,
              fix: "Run with --help for the options.",
            });
          }
          term.warn(sentence(problem));
        }
        term.answered(title, items[values.indexOf(value)]?.label ?? value);
      }
      term.gap();
      return value;
    },
    /** Yes or no: `question` on the line of the answer, Enter takes `yes`. */
    async confirm(title: string, prompt: string, yes: boolean, description: string[] = []): Promise<boolean> {
      term.gap();
      let value: boolean;
      if (keys) value = await term.confirm(title, prompt, yes, description);
      else {
        question(title, description);
        for (;;) {
          const line = await readLine(`${prompt} ${yes ? "[Y/n]" : "[y/N]"} `);
          const answer = (line ?? "").trim();
          if (!answer || /^(y|yes|n|no)$/i.test(answer)) {
            value = answer ? /^y/i.test(answer) : yes;
            break;
          }
          if (!interactive || line === null) {
            throw new SetupError({
              check: "answer",
              error: `${prompt}: answer y or n.`,
              fix: "Run with --help for the options.",
            });
          }
          term.warn("Answer y or n.");
        }
        term.answered(title, value ? "Yes" : "No", `${prompt} `);
      }
      term.gap();
      return value;
    },
    close() {
      term.close();
      reader?.close();
    },
  };
  return ui;
}

// ── Docker ──────────────────────────────────────────────────────────────────

function docker(args: string[], timeoutMs?: number) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
    return { code: -1, stdout: "", stderr: "" };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** `docker`'s way, without blocking: a wait's spinner keeps turning while a probe takes its seconds. */
function exec(
  command: string,
  args: string[],
  timeoutMs?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
    const done = (code: number) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const events = child as unknown as EventEmitter;
    events.on("error", (error: NodeJS.ErrnoException) => done(error.code === "ENOENT" ? -1 : 1));
    events.on("close", (code: number | null) => done(code ?? 1));
  });
}

function checkDocker(): { label: string } | { problem: Problem } {
  const problems = dockerProblems(process.platform);
  const server = docker(["version", "--format", "{{.Server.Version}}"]);
  if (server.code === -1) return { problem: problems.missing };
  if (server.code !== 0) return { problem: diagnoseDocker(server.stderr, process.platform) };
  const compose = docker(["compose", "version", "--short"]);
  if (compose.code !== 0) return { problem: problems.compose };
  const version = compose.stdout.trim().replace(/^v/, "");
  if (!versionAtLeast(version, MIN_COMPOSE)) return { problem: problems.composeOld(version) };
  return { label: `Docker ${server.stdout.trim()} with Compose ${version}` };
}

/** A command whose output is kept for a diagnosis, its latest line shown under the wait; `input` goes to its stdin. */
function streamed(
  ui: Ui,
  command: string,
  args: string[],
  input?: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let output = "";
    let partial = "";
    const forward = (chunk: Buffer) => {
      output += chunk.toString();
      const lines = `${partial}${chunk.toString()}`.split(/\r\n|\r|\n/);
      partial = lines.pop() ?? "";
      const latest = lines.map(outputLine).filter(Boolean).pop();
      if (latest) ui.detail(latest);
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    child.stdin?.end(input);
    const events = child as unknown as EventEmitter;
    events.on("error", (error: Error) =>
      reject(new SetupError({ check: command, error: error.message, fix: "Run the setup again." })),
    );
    events.on("close", (code: number | null) => resolve({ code, output }));
  });
}

/** A failed command's last lines, quiet, above what failed. */
function showTail(ui: Ui, output: string) {
  for (const line of output.trim().split("\n").slice(-12).map(outputLine).filter(Boolean)) ui.note(line);
}

/** `docker compose up -d`, its output kept for `diagnoseCompose`. */
async function composeUp(ui: Ui, services: string[] = []): Promise<void> {
  const { code, output } = await streamed(ui, "docker", ["compose", "up", "-d", "--quiet-pull", ...services]);
  if (code === 0) return;
  showTail(ui, output);
  throw new SetupError(
    diagnoseCompose(output, process.platform) ?? {
      check: "compose",
      error: `docker compose up failed: ${lastLine(output)}`,
      fix: "Fix what the output above says, then run the setup again.",
    },
  );
}

const logsOf = async (service: string) =>
  (await exec("docker", ["compose", "logs", "--no-color", "--no-log-prefix", "--tail", "80", service])).stdout;

const inTailscale = (args: string[], timeoutMs = 20_000) =>
  exec("docker", ["compose", "exec", "-T", "tailscale", "tailscale", ...args], timeoutMs);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Health, and whether an account exists yet, asked inside the app's container whatever port it's published on. */
const APP_PROBE = `const p = process.env.PORT || 3000;
const get = (path) => fetch("http://127.0.0.1:" + p + path).then((r) => r.json());
Promise.all([get("/api/health"), get("/api/app/auth-config")]).then(
  ([health, auth]) => console.log(JSON.stringify({ health, firstRun: auth.firstRun })),
  () => process.exit(1),
);`;

/** Waits for /api/health, and for `until`; `notYet` is the failure when the app answers but `until` never holds. */
async function waitForApp(timeoutS: number, until: (app: App) => boolean = () => true, notYet?: Problem): Promise<App> {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    let healthy = false;
    const probe = await exec("docker", ["compose", "exec", "-T", "agentes", "bun", "-e", APP_PROBE], 20_000);
    if (probe.code === 0) {
      try {
        const app = JSON.parse(probe.stdout) as App;
        healthy = app.health.status === "ok";
        if (healthy && until(app)) return app;
      } catch {
        // Not answering JSON yet.
      }
    } else {
      const problem = diagnoseAppLogs(await logsOf("agentes"));
      if (problem) throw new SetupError(problem);
    }
    if (Date.now() > deadline) {
      throw new SetupError(
        healthy && notYet
          ? notYet
          : {
              check: "app.health",
              error: `The app didn't answer /api/health within ${timeoutS} seconds.`,
              fix: "docker compose logs agentes shows why. Run the setup again once it's fixed (--timeout waits longer).",
            },
      );
    }
    await sleep(2000);
  }
}

// ── The setup ───────────────────────────────────────────────────────────────

type Env = { read(): string | null; save(content: string): void };

/** The wait for `docker compose up -d`: the first time it pulls the images. */
const STARTING = {
  label: "Starting agentes.chat (docker compose up -d)",
  detail: "The first time downloads about 2 GB.",
};

async function run(opts: Options, ui: Ui, image: boolean): Promise<Result> {
  const dir = process.cwd();
  const envPath = join(dir, ".env");
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : null;
  const env: Env = {
    read: () => content,
    save(next) {
      try {
        writeFileSync(envPath, next, { mode: 0o600 });
        chmodSync(envPath, 0o600);
      } catch (error) {
        throw new SetupError({
          check: "env",
          error: `Can't write .env in ${dir}: ${(error as Error).message}`,
          fix: "Run the setup as the user who owns this directory and its .env (ls -l shows who).",
        });
      }
      content = next;
    },
  };

  ui.intro();
  if (opts.tailscaleStatus) return finishFromStatus(opts, ui, env);

  const composeFile: string | null = COMPOSE_FILES.find((name) => existsSync(join(dir, name))) ?? null;
  const found = [content !== null ? ".env" : null, composeFile].filter(Boolean).join(" and ");
  // Inside the installer's frame, the folder and Docker were its last lines.
  if (found) ui.note(`Found ${found} in ${dir}: only what's missing is filled in.`);
  else if (!ui.inherited) ui.note(`Setting up in ${dir}.`);

  const mac = process.platform === "darwin";
  const machine: ThisMachine = {
    platform: process.platform,
    arch: process.arch,
    memory: totalmem(),
    root: process.getuid?.() === 0,
    systemd: existsSync("/run/systemd/system"),
    bpf: /\+BPF_FRAMEWORK\b/.test(spawnSync("systemctl", ["--version"], { encoding: "utf8" }).stdout ?? ""),
    apt: spawnSync("sh", ["-c", "command -v apt-get"], { stdio: "ignore" }).status === 0,
    connected:
      connectedConfig(readOrNull(join(mac ? RUNNER_HOME : SYSTEM_RUNNER_HOME, "config.json"))) ||
      (!mac && connectedConfig(readOrNull(join(SIMPLE_RUNNER_HOME, "config.json")))),
  };
  const offer = computerOffer(machine, content, image, dir);
  // --computer yes where it can't be (as a user other than root on Linux, say) stops before Docker or any question.
  if (opts.computer === "yes" && "problem" in offer) throw new SetupError(offer.problem);

  // Docker before any question: without it nothing below can run.
  const dockerCheck = image ? null : checkDocker();
  if (dockerCheck && "problem" in dockerCheck && !opts.dryRun) throw new SetupError(dockerCheck.problem);
  if (dockerCheck && "label" in dockerCheck && !ui.inherited) ui.ok(dockerCheck.label);

  // A dry run asks nothing: it lists what the real run would ask.
  const ask = ui.canAsk;
  const listQuestions = opts.dryRun && !opts.json && opts.tailscaleStatus !== "-";
  const questions: string[] = [];
  const current = networkOf(content);
  if (listQuestions && !opts.network) {
    questions.push(`how people reach it (${current ?? "tailscale"} unless you choose otherwise)`);
  }
  const network: Network =
    opts.network ??
    (ask
      ? await ui.choose<Network>(
          "How will people reach this instance?",
          [
            {
              value: "tailscale",
              label: "Tailscale: private HTTPS on your tailnet, no domain or open port (recommended)",
            },
            { value: "domain", label: "A public domain, with HTTPS on ports 80 and 443" },
            { value: "local", label: "This machine only (http://localhost)" },
            // Last, so that piped answers 1 to 3 mean the same whatever the .env holds.
            ...(current === "proxy"
              ? [
                  {
                    value: "proxy" as const,
                    label: `Keep ${envValue(content, "PUBLIC_URL")}: your own proxy or tunnel`,
                  },
                ]
              : []),
          ],
          current ?? "tailscale",
        )
      : (current ?? "tailscale"));

  const entries: Record<string, string> = secretEntries(content);
  const newSecrets = Object.keys(entries);
  const hostname = opts.hostname ?? (envValue(content, "TS_HOSTNAME") || DEFAULT_HOSTNAME);
  const port = envValue(content, "HOST_PORT") || "3000";
  let tailscale: "given" | "env" | "joined" | "ask" | "missing" = "missing";
  let domain: string | null = null;

  if (network === "tailscale") {
    if (opts.hostname) entries.TS_HOSTNAME = opts.hostname;
    tailscale = opts.tailscaleKey
      ? "given"
      : envValue(content, "TS_AUTHKEY")
        ? "env"
        : isTailnetUrl(envValue(content, "PUBLIC_URL"))
          ? "joined"
          : ask || listQuestions
            ? "ask"
            : "missing";
    let key = opts.tailscaleKey ?? null;
    if (tailscale === "ask" && ask) {
      tailscaleSteps(ui, hostname, opts.tailscaleTag);
      key = await ui.ask("Paste the auth key", {
        secret: true,
        placeholder: "tskey-auth-…",
        missing: PROBLEMS.keyMissing,
        validate: tailscaleKeyProblem,
      });
    }
    if (key) Object.assign(entries, tailscaleKeyEntries(key, opts.tailscaleTag, envValue(content, "TS_EXTRA_ARGS")));
    if (tailscale === "missing" && !opts.dryRun) throw new SetupError(PROBLEMS.keyMissing);
  } else if (network === "domain") {
    const missing = { check: "domain", error: "A public domain is needed.", fix: "Pass --domain chat.example.com." };
    domain = opts.domain ?? (envValue(content, "DOMAIN") || null);
    if (!domain && ask) {
      const answer = await ui.ask("A public domain", {
        label: "Domain",
        placeholder: "chat.example.com",
        description: [
          "Point a DNS A record for it (and AAAA if this server has IPv6) at this server's public IP.",
          "Open ports 80 and 443 in the server's firewall: Caddy gets a Let's Encrypt certificate on them.",
        ],
        missing,
        validate: (v) => domainProblem(normalizeDomain(v)),
      });
      domain = normalizeDomain(answer);
    }
    if (!domain && listQuestions) questions.push("the domain");
    if (!domain && !opts.dryRun) throw new SetupError(missing);
  }
  const way = wayIn(content, network, domain);
  Object.assign(entries, way.entries);
  const stop = stopCommand(content, way.profile);

  const preset = emailPreset(opts, content);
  if (listQuestions && preset === null) questions.push("email for invitations and password resets (skip by default)");
  const email = await emailEntries(opts, ui, preset, content, network, domain, entries);

  const files = computerFiles(mac, homedir(), RUNNER_HOME, !("problem" in offer) && offer.simple);
  const asked = listQuestions ? questions : null;
  const computer = await chooseComputer(opts, ui, {
    offer,
    content,
    installed: installedCommands(readOrNull(files.service)),
    server: appOnThisMachine(content),
    tokenFile: join(dir, HOST_TOKEN_FILE),
    questions: asked,
    entries,
  });
  const checks =
    computer.state === "on"
      ? checkRequirements({
          mac: computer.mac,
          simple: computer.simple,
          arch: process.arch,
          exists: existsSync,
          home: homedir(),
        })
      : [];
  const requirements = await chooseRequirements(opts, ui, checks, asked);
  const telemetry = await chooseTelemetry(opts, ui, content, asked, entries);
  // Checked with TypeSafe before anything is written: a key it refuses stops the setup here.
  const jev = await jevStep({ flag: opts.typesafeKey, content, dryRun: opts.dryRun, check: (key) => checkJevKey(key) });
  if ("problem" in jev) throw new SetupError(jev.problem);
  Object.assign(entries, jev.entries);
  if (jev.said?.ok) ui.ok(jev.said.text);
  else if (jev.said) ui.warn(jev.said.text);
  const choices: Choices = { computer, requirements, telemetry: telemetry.value, jev: jev.value };

  const plan = planSteps({
    docker: dockerCheck && "problem" in dockerCheck ? `${dockerCheck.problem.error} ${dockerCheck.problem.fix}` : null,
    questions,
    envExists: content !== null,
    newSecrets,
    network,
    publicUrl: { now: envValue(content, "PUBLIC_URL"), next: way.entries.PUBLIC_URL ?? null },
    stop,
    hostname,
    tailscale,
    domain,
    email,
    computer,
    requirements: { present: checks.filter((c) => c.present).map((c) => c.id), install: requirements },
    telemetry,
    jev: jev.value,
    compose: composeFile,
    start: opts.start,
    image,
  });
  if (opts.dryRun) {
    ui.list("The plan (--dry-run: nothing is written or started)", plan);
    ui.ending = "";
    return { ok: true, dryRun: true, network, ...results(choices), plan };
  }

  env.save(upsertEnv(withNetworkProfile(content ?? ENV_HEADER, way.profile), entries));
  const written = Object.keys(entries).filter((key) => key !== "TS_EXTRA_ARGS");
  ui.ok(`.env${written.length ? `: ${written.join(", ")}` : " kept as it was"} (readable by you only)`);
  const tokenFile = join(dir, HOST_TOKEN_FILE);
  if (computer.state === "on") {
    // Written again each run, from .env: the server reads the token there, the agents' computer here.
    saveSecret(tokenFile, envValue(env.read(), "HOST_COMPUTER_TOKEN") ?? "");
  } else if (computer.state === "off" && computer.wasOn) {
    rmSync(tokenFile, { force: true });
    ui.note("This machine stops being your agents' computer once agentes.chat restarts. To remove what ran them here:");
    ui.command(`${files.command} service uninstall --host`);
  }

  await ensureComposeFile(ui, dir, composeFile, network);

  if (image || !opts.start) return printCommands(ui, image, network, domain, content, stop, choices);
  ui.gap();
  if (stop) {
    const what = `the way in .env no longer uses (docker ${stop.join(" ")})`;
    ui.wait(`Removing ${what}`);
    const removed = await exec("docker", stop, 120_000);
    if (removed.code !== 0) {
      throw new SetupError({
        check: "compose",
        error: `docker ${stop.join(" ")} failed: ${removed.stderr.trim().split("\n").pop() ?? ""}`,
        fix: `Fix that, run docker ${stop.join(" ")} yourself, then run the setup again.`,
      });
    }
    ui.ok(`Removed ${what}`);
  }
  if (network === "tailscale") return startTailscale(opts, ui, env, choices);
  if (network === "domain") return startDomain(opts, ui, domain as string, env, choices);
  ui.wait(STARTING.label, STARTING.detail);
  await composeUp(ui);
  const app = await waitForApp(opts.timeout);
  ui.ok(`agentes.chat ${app.health.version ?? ""} is up`);
  return finish(ui, network, envValue(env.read(), "PUBLIC_URL") ?? `http://localhost:${port}`, app, null, choices);
}

/** What this run decided beyond the way in, carried to the end. */
interface Choices {
  computer: ComputerPlan;
  /** What the run installs for the agents (`--requirements`). */
  requirements: Requirement[];
  telemetry: OnOff;
  jev: JevChoice;
}

const results = (c: Choices) => ({
  computer: c.computer.state,
  requirements: c.requirements,
  telemetry: c.telemetry,
  jev: c.jev,
});

/** A file readable by its owner only, like .env. */
function saveSecret(file: string, content: string) {
  try {
    writeFileSync(file, content, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (error) {
    throw new SetupError({
      check: "env",
      error: `Can't write ${file}: ${(error as Error).message}`,
      fix: "Run the setup as the user who owns this directory and its .env (ls -l shows who).",
    });
  }
}

/** A yes/no question's answer: asked on a terminal, listed in a dry run's plan, else its default. */
async function yesOrNo(ui: Ui, questions: string[] | null, listed: string, yes: boolean, ask: () => Promise<boolean>) {
  if (questions) {
    questions.push(`${listed} (${yes ? "yes" : "no"} unless you choose otherwise)`);
    return yes;
  }
  return ui.canAsk ? ask() : yes;
}

/** The agents' computer, as `decideComputer` says: this machine, by default where it can be. */
async function chooseComputer(
  opts: Options,
  ui: Ui,
  c: Omit<Parameters<typeof decideComputer>[0], "answers" | "computer" | "commands"> & {
    /** A dry run's list: the questions go there, and their defaults are taken. */
    questions: string[] | null;
    entries: Record<string, string>;
  },
): Promise<ComputerPlan> {
  const answers: { on?: boolean; commands?: boolean } = {};
  for (;;) {
    const next = decideComputer({ ...c, computer: opts.computer, commands: opts.computerCommands, answers });
    if ("problem" in next) throw new SetupError(next.problem);
    if ("plan" in next) {
      Object.assign(c.entries, next.entries);
      if (next.plan.state === "skipped") ui.note(`Agents' computer: skipped. ${next.plan.why}`);
      return next.plan;
    }
    const mac = !("problem" in c.offer) && c.offer.mac;
    const simple = !("problem" in c.offer) && c.offer.simple;
    if (next.ask === "computer") {
      const why = !mac && !("problem" in c.offer) && c.offer.why ? [c.offer.why] : [];
      answers.on = await yesOrNo(
        ui,
        c.questions,
        `${mac ? "this Mac" : "this machine"} as your agents' computer${simple ? ` (simple mode: every agent as the user ${SIMPLE_USER})` : ""}`,
        next.yes,
        () =>
          ui.confirm(
            "Agents' computer",
            mac
              ? "Use this Mac as your agents' computer? They work as you, in folders of their own."
              : simple
                ? "Use this machine as your agents' computer, in simple mode?"
                : "Use this machine as your agents' computer?",
            next.yes,
            mac
              ? ["Agents need a computer to work on: a browser and a folder each. This Mac can be it."]
              : simple
                ? [...SIMPLE_MODE_WHY, ...why]
                : [
                    "Agents need a computer to work on: their own screen, a browser and a folder each. This machine can be it. Each agent gets a user of its own here, with about 0.2 GB of memory for its screen (0.6 GB more while its browser is open).",
                    ...why,
                  ],
          ),
      );
    } else {
      answers.commands = await yesOrNo(ui, c.questions, "whether agents may run commands on this Mac", next.yes, () =>
        ui.confirm("Commands on this Mac", "Can they run commands here too?", next.yes, [
          "Commands run as you and can reach your files.",
        ]),
      );
    }
  }
}

/**
 * What the agents need here (`checkRequirements`): what's there is said, and each missing one the computer's own
 * installer doesn't bring is asked about, yes by default (`--requirements` answers all; without a terminal, yes).
 */
async function chooseRequirements(
  opts: Options,
  ui: Ui,
  checks: RequirementCheck[],
  questions: string[] | null,
): Promise<Requirement[]> {
  if (checks.length === 0) return [];
  const askable = askableRequirements(checks);
  if (opts.requirements) return askable.filter((c) => opts.requirements?.includes(c.id)).map((c) => c.id);
  const present = checks.filter((c) => c.present);
  if (present.length && !questions)
    ui.ok(`Already here for the agents: ${present.map((c) => c.label.split(" (")[0]).join(", ")}`);
  const chosen: Requirement[] = [];
  for (const c of askable) {
    const yes = await yesOrNo(ui, questions, `install ${c.label}`, true, () =>
      ui.confirm("For the agents", `Install ${c.label}?`, true),
    );
    if (yes) chosen.push(c.id);
  }
  return chosen;
}

/** The usage statistics, as `decideTelemetry` says: asked once, then .env keeps `TELEMETRY=on|off`. */
async function chooseTelemetry(
  opts: Options,
  ui: Ui,
  content: string | null,
  questions: string[] | null,
  entries: Record<string, string>,
): Promise<{ value: OnOff; kept: boolean }> {
  const first = decideTelemetry({ ...(opts.telemetry ? { flag: opts.telemetry } : {}), content });
  const decision = first.ask
    ? decideTelemetry({
        content,
        answer: await yesOrNo(ui, questions, "usage statistics", true, () =>
          ui.confirm("Usage statistics", "Send them?", true, [TELEMETRY_TEXT.join(" ")]),
        ),
      })
    : first;
  Object.assign(entries, decision.entries);
  return { value: decision.value, kept: decision.kept };
}

function tailscaleSteps(ui: Ui, hostname: string, tag: string) {
  ui.list(
    "Tailscale",
    [
      `This server joins your tailnet as "${hostname}", at https://${hostname}.<your tailnet>.ts.net with a real certificate. Only devices in your tailnet reach it. No tailnet yet? Sign up free: ${TS.signup}`,
    ],
    "plain",
  );
  ui.list(
    "In the Tailscale admin console",
    [
      `DNS page, ${TS.dns}: if you see "Enable MagicDNS", click it. Under "HTTPS Certificates", click "Enable HTTPS" and confirm (device names go in a public certificate log).`,
      `Keys page, ${TS.keys}: click "Generate auth key". Leave Reusable and Ephemeral off, turn "Pre-approved" on if you see it, and click "Generate key". Copy the key (tskey-auth-…): it's shown once and works once.`,
    ],
    "numbered",
  );
  ui.list("Unattended, or an AI agent installing? An OAuth client secret replaces step 2", [
    `Access controls, ${TS.policy}: under "tagOwners" add "${tag}": ["autogroup:admin"], and save.`,
    `Trust credentials, ${TS.trust}: click "Credential", choose OAuth, give "Auth Keys" Write access with the tag ${tag}, and click "Generate credential".`,
    `Paste its secret (tskey-client-…) below, or pass it as --tailscale-key. The server joins as ${tag}, approved, with a key that never expires.`,
  ]);
}

/** The email answer the options or the .env already give; null when it's a question. */
function emailPreset(opts: Options, content: string | null): EmailChoice | "set" | null {
  if (opts.email) return opts.email;
  if (opts.smtpUrl) return "smtp";
  if (opts.emailApiKey) return "api";
  return envValue(content, "SMTP_URL") || envValue(content, "MILLIONSEND_API_KEY") ? "set" : null;
}

async function emailEntries(
  opts: Options,
  ui: Ui,
  preset: EmailChoice | "set" | null,
  content: string | null,
  network: Network,
  domain: string | null,
  entries: Record<string, string>,
): Promise<EmailChoice | "set"> {
  const choice: EmailChoice | "set" =
    preset ??
    (ui.canAsk
      ? await ui.choose(
          "Email for invitations and password resets (optional)",
          [
            { value: "skip", label: "Skip for now: invitation links can be copied in the app" },
            { value: "smtp", label: "An SMTP server" },
            { value: "api", label: "A Resend-compatible API (MillionSend, Resend)" },
          ],
          "skip",
        )
      : "skip");
  if (choice === "skip" || choice === "set" || opts.dryRun) return choice;
  const value = (given: string | undefined, flag: string, question: string, o: AskOptions) => {
    const missing = { check: "email", error: `${question} is needed for ${choice} email.`, fix: `Pass ${flag}.` };
    if (given) return Promise.resolve(given);
    if (!ui.canAsk) throw new SetupError(missing);
    return ui.ask(question, { ...o, missing });
  };
  if (choice === "smtp") {
    entries.SMTP_URL = await value(opts.smtpUrl, "--smtp-url", "SMTP URL (smtps://user:password@host:465)", {
      secret: true,
      validate: smtpUrlProblem,
    });
  } else {
    entries.MILLIONSEND_API_KEY = await value(opts.emailApiKey, "--email-api-key", "API key", { secret: true });
    const url =
      opts.emailApiUrl ??
      (ui.canAsk ? await ui.ask("API address", { initial: DEFAULT_EMAIL_API_URL, validate: httpUrlProblem }) : null);
    if (url && url !== DEFAULT_EMAIL_API_URL) entries.MILLIONSEND_API_URL = url;
  }
  // A sender .env already has stays as written. Without one, mail goes out as ping@ the server's own host, which no
  // provider verifies for a ts.net name or localhost.
  if (!envValue(content, "EMAIL_FROM")) {
    const fallback = senderFor(network, domain);
    entries.EMAIL_FROM = await value(opts.emailFrom ?? (ui.canAsk ? undefined : fallback), "--email-from", "Sender", {
      placeholder: senderAt("example.com"),
      validate: emailFromProblem,
      ...(fallback ? { initial: fallback } : {}),
    });
  }
  return choice;
}

async function ensureComposeFile(ui: Ui, dir: string, file: string | null, network: Network) {
  const service = network === "tailscale" ? "tailscale" : network === "domain" ? "caddy" : null;
  const content = file ? readFileSync(join(dir, file), "utf8") : null;
  if (file && (!service || new RegExp(`^ {2}${service}:`, "m").test(content ?? ""))) return;
  if (file) {
    const outdated = {
      check: "compose",
      error: `${file} has no ${service} service: it's from an older release.`,
      fix: `Download the current one (your settings live in .env): curl -fsSLO ${COMPOSE_URL}, then run the setup again.`,
    };
    if (!ui.interactive) throw new SetupError(outdated);
    const yes = await ui.confirm(outdated.error, "Download the current one over it? Settings stay in .env.", true);
    if (!yes) throw new SetupError(outdated);
  }
  ui.wait(`Downloading ${file ?? "docker-compose.yml"}`);
  try {
    const response = await fetch(COMPOSE_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (!isComposeFile(body)) throw new Error("what came back isn't a compose file");
    // Over the outdated file itself: Compose keeps reading a compose.yaml next to a newer docker-compose.yml.
    writeFileSync(join(dir, file ?? "docker-compose.yml"), body);
  } catch (error) {
    throw new SetupError({
      check: "compose.download",
      error: `Couldn't download docker-compose.yml: ${(error as Error).message}`,
      fix: `Download it into this directory yourself, curl -fsSLO ${COMPOSE_URL}, then run the setup again.`,
    });
  }
  ui.ok(`${file ?? "docker-compose.yml"} downloaded`);
}

/** Inside the image, or with --no-start: the commands that finish the job. */
function printCommands(
  ui: Ui,
  image: boolean,
  network: Network,
  domain: string | null,
  content: string | null,
  stop: string[] | null,
  choices: Choices,
): Result {
  const port = envValue(content, "HOST_PORT") || "3000";
  const setup = `docker run --rm -i --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ${envValue(content, "AGENTES_IMAGE") || IMAGE} setup`;
  const start =
    image && network === "tailscale"
      ? [
          "docker compose up -d tailscale",
          `Once Tailscale is on your tailnet (about a minute), write its address into .env:\n$ docker compose exec -T tailscale tailscale status --json | ${setup} --tailscale-status -`,
          "docker compose up -d (starts the app with that address)",
        ]
      : image && network === "domain"
        ? [
            "docker compose up -d",
            ...privateStart({ domain: domain as string, port, ssh: sshTarget(process.env) }).steps,
            `Then in .env set PUBLIC_URL=https://${domain} and add https to COMPOSE_PROFILES, and run docker compose up -d.`,
          ]
        : [
            "docker compose up -d",
            ...(image
              ? []
              : [
                  choices.computer.state === "on"
                    ? "Run the setup again: it waits for the instance, makes this machine the agents' computer and prints its address."
                    : "Run the setup again: it waits for the instance and prints its address.",
                ]),
          ];
  const commands = [...(stop ? [`docker ${stop.join(" ")} (the way in .env no longer uses)`] : []), ...start];
  ui.list("Next, in this directory", commands, "numbered");
  ui.ending = "";
  return { ok: true, network, started: false, ...results(choices), nextSteps: commands };
}

async function startTailscale(opts: Options, ui: Ui, env: Env, choices: Choices): Promise<Result> {
  ui.wait("Starting Tailscale (docker compose up -d tailscale)");
  await composeUp(ui, ["tailscale"]);
  const joined = await joinTailnet(opts, ui, env);
  ui.ok(`On your tailnet as ${new URL(joined.url).host}`);
  savePublicUrl(ui, env, joined.url);

  ui.wait(STARTING.label, STARTING.detail);
  await composeUp(ui);
  const tailnet = await joinTailnet(opts, ui, env);
  // A new TS_HOSTNAME is set only once the node is back on the tailnet under its old name.
  if (tailnet.url !== joined.url) {
    ui.ok(`Renamed on your tailnet: ${new URL(tailnet.url).host}`);
    savePublicUrl(ui, env, tailnet.url);
    ui.wait(STARTING.label);
    await composeUp(ui);
  }
  const host = new URL(tailnet.url).host;
  await ensureServe(opts, ui, env, host);
  await waitForCertificate(opts, ui, host);
  ui.ok("HTTPS certificate ready");
  ui.wait("Waiting for agentes.chat to answer");
  const app = await waitForApp(opts.timeout);
  ui.ok(`agentes.chat ${app.health.version ?? ""} is up`);
  return finish(ui, "tailscale", tailnet.url, app, tailnet.keyExpiry, choices);
}

/** PUBLIC_URL is the address Tailscale gives; the key goes, since the state volume keeps the node logged in. */
function savePublicUrl(ui: Ui, env: Env, url: string) {
  const current = env.read() ?? "";
  env.save(upsertEnv(current, { PUBLIC_URL: url, ...(envValue(current, "TS_AUTHKEY") ? { TS_AUTHKEY: "" } : {}) }));
  ui.ok(`.env: PUBLIC_URL=${url}`);
}

/** Waits for the tailnet; on a terminal, a refused or missing key is asked for again. */
async function joinTailnet(opts: Options, ui: Ui, env: Env): Promise<{ url: string; keyExpiry: string | null }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await waitForTailnet(opts, ui, Boolean(envValue(env.read(), "TS_AUTHKEY")));
    } catch (error) {
      if (!(error instanceof SetupError) || error.problem.check !== "tailscale.key" || !ui.interactive || attempt > 3) {
        throw error;
      }
      ui.fail(error.problem);
      const key = await ui.ask("Paste a new auth key", {
        secret: true,
        placeholder: "tskey-auth-…",
        missing: PROBLEMS.keyMissing,
        validate: tailscaleKeyProblem,
      });
      const current = env.read() ?? "";
      env.save(upsertEnv(current, tailscaleKeyEntries(key, opts.tailscaleTag, envValue(current, "TS_EXTRA_ARGS"))));
      ui.wait("Starting Tailscale (docker compose up -d tailscale)");
      await composeUp(ui, ["tailscale"]);
    }
  }
}

async function waitForTailnet(
  opts: Options,
  ui: Ui,
  hasKey: boolean,
): Promise<{ url: string; keyExpiry: string | null }> {
  const deadline = Date.now() + opts.timeout * 1000;
  let said = "";
  for (;;) {
    const status = await inTailscale(["status", "--json"]);
    const state = status.code === 0 ? readTailscaleStatus(status.stdout) : null;
    if (state?.kind === "ready") return state;
    // A tailnet setting someone can switch on while this waits; without a terminal, say it at once.
    const setting = state?.kind === "problem" ? state.problem : null;
    if (setting && !ui.interactive) throw new SetupError(setting);
    const logged = setting ? null : diagnoseTailscaleLogs(await logsOf("tailscale"), opts.tailscaleTag);
    if (logged && logged !== "approval") throw new SetupError(logged);
    if (state?.kind === "waiting" && state.reason === "login" && !hasKey) throw new SetupError(PROBLEMS.keyMissing);
    const approval = (state?.kind === "waiting" && state.reason === "approval") || logged === "approval";
    // What a person has to do goes above the spinner, once; the spinner says what it waits for.
    const note = setting
      ? {
          title: setting.error,
          lines: [setting.fix, "The setup goes on once it's on."],
          label: "Waiting for that setting",
        }
      : approval
        ? {
            title: "Waiting for approval",
            lines: [`Open ${TS.machines}, find the server marked "Needs approval", and choose Approve in its … menu.`],
            label: "Waiting for approval",
          }
        : null;
    ui.wait(note?.label ?? "Waiting for Tailscale to join your tailnet");
    if (note && note.title !== said) {
      ui.list(note.title, note.lines, "plain");
      said = note.title;
    }
    if (Date.now() > deadline) {
      throw new SetupError(
        setting ??
          (approval
            ? PROBLEMS.approval
            : {
                check: "tailscale.timeout",
                error: `Tailscale didn't join your tailnet within ${opts.timeout} seconds.`,
                fix: "docker compose logs tailscale shows why. Run the setup again once it's fixed (--timeout waits longer).",
              }),
      );
    }
    await sleep(2000);
  }
}

/**
 * The HTTPS proxy comes from the compose file's serve config, applied once the node knows its name. A node
 * that joined while HTTPS was still off in the tailnet may hold an empty one: a restart applies it again.
 */
async function ensureServe(opts: Options, ui: Ui, env: Env, host: string) {
  const served = async () => (await inTailscale(["serve", "status", "--json"])).stdout.includes(`"${host}:443"`);
  if (await served()) return;
  ui.wait("Applying the HTTPS proxy (docker compose restart tailscale)");
  await exec("docker", ["compose", "restart", "tailscale"], 60_000);
  await joinTailnet(opts, ui, env);
  for (let i = 0; i < 10 && !(await served()); i++) await sleep(2000);
  if (!(await served())) {
    throw new SetupError({
      check: "tailscale.serve",
      error: "Tailscale didn't turn on the HTTPS proxy for this server.",
      fix: 'docker compose logs tailscale shows why (the lines with "serve proxy"). Run the setup again once it\'s fixed.',
    });
  }
}

/** Asks Tailscale for the certificate the HTTPS proxy serves, so the first visit doesn't wait for it. */
async function waitForCertificate(opts: Options, ui: Ui, host: string) {
  ui.wait(`Getting the HTTPS certificate for ${host}`);
  const deadline = Date.now() + opts.timeout * 1000;
  for (;;) {
    // The certificate alone, to stdout: the private key is never written anywhere.
    const cert = await inTailscale(["cert", "--cert-file", "-", host], Math.max(5_000, deadline - Date.now()));
    if (cert.code === 0 && cert.stdout.includes("BEGIN CERTIFICATE")) return;
    if (Date.now() > deadline) {
      throw new SetupError({
        check: "tailscale.cert",
        error: `Tailscale couldn't get an HTTPS certificate for ${host}: ${cert.stderr.trim().split("\n").pop() ?? ""}`,
        fix: `Check that HTTPS is on (${TS.dns}, "HTTPS Certificates"), then run the setup again. Let's Encrypt limits how often one name gets a certificate, so after many tries wait a few hours.`,
      });
    }
    await sleep(3000);
  }
}

async function startDomain(opts: Options, ui: Ui, domain: string, env: Env, choices: Choices): Promise<Result> {
  const url = `https://${domain}`;
  if (envValue(env.read(), "PUBLIC_URL") !== url) {
    const port = envValue(env.read(), "HOST_PORT") || "3000";
    const { steps } = privateStart({ domain, port, ssh: sshTarget(process.env) });
    ui.wait("Starting agentes.chat privately first (docker compose up -d)", STARTING.detail);
    await composeUp(ui);
    const app = await waitForApp(opts.timeout);
    ui.ok(`agentes.chat ${app.health.version ?? ""} is up, on this server only`);
    if (app.firstRun) {
      if (!ui.interactive) {
        const again =
          choices.computer.state === "on"
            ? `Run the setup again: it turns on HTTPS for ${domain} and makes this machine the agents' computer.`
            : `Run the setup again: it turns on HTTPS for ${domain}.`;
        const next = [...steps, again];
        ui.list("Next", next, "numbered");
        ui.ending = "";
        return {
          ok: true,
          network: "domain",
          stage: "owner",
          url: `http://localhost:${port}`,
          ...results(choices),
          nextSteps: next,
        };
      }
      ui.list(`Create your account before ${domain} goes live`, steps, "numbered");
      // A person has to open the tunnel and sign up: longer than any service gets to start.
      const minutes = Math.max(30, Math.ceil(opts.timeout / 60));
      ui.wait(`Waiting for the account (up to ${minutes} minutes)`);
      await waitForApp(minutes * 60, (a) => !a.firstRun, {
        check: "domain.owner",
        error: `No account was created within ${minutes} minutes.`,
        fix: `Create it through the tunnel (the steps above), then run the setup again: it turns on HTTPS for ${domain}.`,
      });
      ui.ok("Account created");
    }
    env.save(upsertEnv(withNetworkProfile(env.read() ?? "", "https"), { PUBLIC_URL: url }));
    ui.ok(`.env: PUBLIC_URL=${url}, https in COMPOSE_PROFILES`);
  }
  ui.wait(`Waiting for ${url} (Caddy gets its certificate)`);
  await composeUp(ui);
  const app = await waitForApp(opts.timeout);
  const deadline = Date.now() + opts.timeout * 1000;
  for (;;) {
    let failure: unknown = null;
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) break;
      failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = (error as { cause?: unknown }).cause ?? error;
    }
    if (Date.now() > deadline) {
      throw new SetupError(
        /ENOTFOUND|EAI_AGAIN/.test(String(failure))
          ? {
              check: "domain.dns",
              error: `${domain} doesn't resolve to an address yet.`,
              fix: "Add a DNS A record for it pointing at this server's public IP (AAAA for IPv6), wait a few minutes, then run the setup again.",
            }
          : {
              check: "domain.https",
              error: `${url} doesn't answer yet (${String(failure)}).`,
              fix: "Ports 80 and 443 must be open to the internet, and the DNS record must point here. To see why the certificate failed, run docker compose logs caddy. Then run the setup again.",
            },
      );
    }
    await sleep(3000);
  }
  ui.ok(`${url} answers with a valid certificate`);
  return finish(ui, "domain", url, app, null, choices);
}

/** Inside the image: `tailscale status --json` on stdin (or in a file) gives the address for .env. */
async function finishFromStatus(opts: Options, ui: Ui, env: Env): Promise<Result> {
  const raw = readFileSync(opts.tailscaleStatus === "-" ? "/dev/stdin" : (opts.tailscaleStatus as string), "utf8");
  const state = readTailscaleStatus(raw);
  if (state.kind === "problem") throw new SetupError(state.problem);
  if (state.kind === "waiting") {
    throw new SetupError(
      state.reason === "approval"
        ? PROBLEMS.approval
        : {
            check: "tailscale.join",
            error: "Tailscale isn't on your tailnet yet.",
            fix: "Wait a minute and run the same command again. To see what it's doing, run docker compose logs tailscale.",
          },
    );
  }
  if (env.read() === null) {
    throw new SetupError({
      check: "env",
      error: "There's no .env here.",
      fix: 'Run it in the directory with your .env and docker-compose.yml (that\'s what -v "$PWD":/work does).',
    });
  }
  if (opts.dryRun) {
    const plan = [`.env: PUBLIC_URL=${state.url}${envValue(env.read(), "TS_AUTHKEY") ? ", TS_AUTHKEY emptied" : ""}`];
    ui.list("The plan (--dry-run: nothing is written or started)", plan);
    ui.ending = "";
    return { ok: true, dryRun: true, network: "tailscale", plan };
  }
  savePublicUrl(ui, env, state.url);
  return finish(ui, "tailscale", state.url, null, state.keyExpiry, null, [
    "Run docker compose up -d: it starts the app with this address.",
  ]);
}

/** A file's text, or null when it can't be read. */
function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** A file's text from `offset` on, or its last 256 KB; "" when it can't be read. */
function readFrom(file: string, offset: number | null) {
  try {
    const size = statSync(file).size;
    const start = offset ?? Math.max(0, size - 256 * 1024);
    const fd = openSync(file, "r");
    try {
      const bytes = Buffer.alloc(Math.max(0, size - start));
      readSync(fd, bytes, 0, bytes.length, start);
      return bytes.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

const succeeds = (command: string, args: string[]) =>
  spawnSync(command, args, { stdio: "ignore", timeout: 10_000 }).status === 0;

/**
 * The agents' computer, once agentes.chat answers: the server's installer for it, then up to
 * `COMPUTER_WAIT_S` for its first answer to the server, read from its own log. Not answering yet is a
 * warning: it keeps trying on its own. One kept from an earlier run is left alone while it's up to date.
 */
/**
 * Simple mode's user (`SIMPLE_USER`): made when missing (no sudo, no password), its services kept running without a
 * login (`loginctl enable-linger`), and given its own copy of the token. Returns its uid.
 */
async function prepareSimpleUser(): Promise<number> {
  const idOf = (flag: string) => Number(spawnSync("id", [flag, SIMPLE_USER], { encoding: "utf8" }).stdout.trim());
  if (!succeeds("id", ["-u", SIMPLE_USER])) {
    const made = await exec("useradd", ["-m", "-d", SIMPLE_HOME, "-s", "/bin/bash", SIMPLE_USER], 30_000);
    if (made.code !== 0) {
      throw new SetupError({
        check: "computer.user",
        error: `Making the user ${SIMPLE_USER} failed: ${lastLine(made.stderr)}`,
        fix: `Make it yourself (useradd -m -s /bin/bash ${SIMPLE_USER}), then run the setup again: agentes.chat itself is up.`,
      });
    }
  }
  const uid = idOf("-u");
  const gid = idOf("-g");
  const linger = await exec("loginctl", ["enable-linger", SIMPLE_USER], 30_000);
  const bus = `/run/user/${uid}/bus`;
  for (let i = 0; i < 30 && !existsSync(bus); i++) await sleep(500);
  if (linger.code !== 0 || !existsSync(bus)) {
    throw new SetupError({
      check: "computer.user",
      error: `The user ${SIMPLE_USER}'s services didn't start (loginctl enable-linger ${SIMPLE_USER}): ${lastLine(linger.stderr) || `no ${bus}`}`,
      fix: "Check that systemd-logind runs here, then run the setup again: agentes.chat itself is up.",
    });
  }
  writeFileSync(SIMPLE_TOKEN_FILE, readFileSync(join(process.cwd(), HOST_TOKEN_FILE)), { mode: 0o600 });
  chmodSync(SIMPLE_TOKEN_FILE, 0o600);
  chownSync(SIMPLE_TOKEN_FILE, uid, gid);
  return uid;
}

async function setUpComputer(
  ui: Ui,
  computer: Extract<ComputerPlan, { state: "on" }>,
  requirements: Requirement[] = [],
) {
  const what = computer.mac ? "this Mac" : "this machine";
  const files = computerFiles(computer.mac, homedir(), RUNNER_HOME, computer.simple);
  // Its unit's journal on Linux (the user unit's in simple mode), its log file on a Mac: since a time or an offset,
  // or the latest lines.
  const unit = computer.simple ? [`_SYSTEMD_USER_UNIT=${HOST_SERVICE}.service`] : ["-u", HOST_SERVICE];
  const log = async (since: { at: number; offset: number } | null) =>
    files.log
      ? readFrom(files.log, since ? since.offset : null)
      : (
          await exec(
            "journalctl",
            [...unit, "-o", "cat", "--no-pager", ...(since ? ["--since", `@${since.at}`] : ["-n", "1000"])],
            10_000,
          )
        ).stdout;
  let script: string | null = null;
  const installer = async () => {
    if (script !== null) return script;
    try {
      const response = await fetch(computer.install.script, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      script = await response.text();
      return script;
    } catch (error) {
      throw new SetupError({
        check: "computer.install",
        error: `Couldn't download the agents' computer's installer from ${computer.install.script}: ${(error as Error).message}`,
        fix: "Run the setup again: agentes.chat itself is up.",
      });
    }
  };
  // What the agents need, first: as root on Linux, whatever mode they run in; for this user on a Mac.
  if (requirements.length) {
    ui.wait(`Installing for the agents: ${requirements.join(", ")}`, "A few minutes the first time.");
    const run = await streamed(ui, "sh", ["-s", "--", "--requirements", requirements.join(",")], await installer());
    if (run.code !== 0) {
      showTail(ui, run.output);
      throw new SetupError({
        check: "computer.requirements",
        error: `Installing what the agents need failed: ${lastLine(run.output)}`,
        fix: `Fix what the output above says, then run the setup again (or ${requirementsCommand(computer.install, requirements)}): agentes.chat itself is up.`,
      });
    }
    ui.ok(`Installed for the agents: ${requirements.join(", ")}`);
  }
  if (computer.kept) {
    ui.wait(`Checking ${what} as your agents' computer`);
    const served = await fetch(`${computer.install.server}/runner/agentes-runner.mjs`, {
      signal: AbortSignal.timeout(30_000),
    })
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null);
    const running = computer.mac
      ? succeeds("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${HOST_LAUNCHD_LABEL}`])
      : computer.simple
        ? succeeds("systemctl", ["--user", "-M", `${SIMPLE_USER}@`, "is-active", "--quiet", HOST_SERVICE])
        : succeeds("systemctl", ["is-active", "--quiet", HOST_SERVICE]);
    const state = hostState(await log(null));
    if (computerUpToDate({ kept: true, running, state, installed: readOrNull(files.bundle), served })) {
      ui.ok(`Agents' computer: ${what}`);
      return;
    }
  }
  ui.wait(
    `Setting up ${what} for your agents`,
    computer.mac
      ? null
      : computer.simple
        ? `In simple mode, as the user ${SIMPLE_USER}.`
        : "A user and a screen for each, and the packages they need: a few minutes the first time.",
  );
  const since = {
    at: Math.floor(Date.now() / 1000),
    offset: files.log && existsSync(files.log) ? statSync(files.log).size : 0,
  };
  const text = await installer();
  let run: { code: number | null; output: string };
  if (computer.simple) {
    const uid = await prepareSimpleUser();
    run = await streamed(
      ui,
      "runuser",
      [
        "-u",
        SIMPLE_USER,
        "--",
        "env",
        `HOME=${SIMPLE_HOME}`,
        `XDG_RUNTIME_DIR=/run/user/${uid}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
        "sh",
        "-s",
        "--",
        ...computer.install.args,
      ],
      text,
    );
  } else {
    run = await streamed(ui, "sh", ["-s", "--", ...computer.install.args], text);
  }
  if (run.code !== 0) {
    showTail(ui, run.output);
    throw new SetupError({
      check: "computer.install",
      error: `Setting up the agents' computer failed: ${lastLine(run.output)}`,
      fix: "Fix what the output above says, then run the setup again: agentes.chat itself is up.",
    });
  }
  ui.wait(`Waiting for ${what} to answer agentes.chat`);
  const deadline = Date.now() + COMPUTER_WAIT_S * 1000;
  for (;;) {
    const state = hostState(await log(since));
    if (state === "on") {
      ui.ok(`Agents' computer: ${what}${computer.simple ? ` (simple mode, as ${SIMPLE_USER})` : ""}`);
      return;
    }
    if (state === "off" || state === "refused" || state === "no_token") throw new SetupError(COMPUTER_PROBLEMS[state]);
    if (Date.now() > deadline) {
      const where = files.log ?? `journalctl ${unit.join(" ")}`;
      ui.warn(`Agents' computer: set up, but it hasn't answered agentes.chat yet. It keeps trying. Its log: ${where}`);
      return;
    }
    await sleep(2000);
  }
}

async function finish(
  ui: Ui,
  network: Network,
  url: string,
  app: App | null,
  keyExpiry: string | null,
  choices: Choices | null,
  first: string[] = [],
): Promise<Result> {
  let failed: Problem | null = null;
  if (choices?.computer.state === "on") {
    try {
      await setUpComputer(ui, choices.computer, choices.requirements);
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      failed = error.problem;
      ui.fail(failed);
    }
  }
  const end = theEnd({
    network,
    url,
    app,
    keyExpiry,
    choices: choices ? results(choices) : null,
    first,
    failed,
    ssh: sshTarget(process.env),
  });
  // Inside the image the app isn't started yet: this is the address it will have.
  ui.heading(app ? "agentes.chat is up" : "agentes.chat's address");
  ui.command(url);
  if (end.link) {
    ui.gap();
    ui.command(end.link, "App:");
    ui.gap();
    ui.qr(end.link);
    ui.note("Open the App link where the agentes.chat app is installed, or point your phone's camera here.");
  }
  ui.list("Next", end.steps, "numbered");
  return end.result;
}
