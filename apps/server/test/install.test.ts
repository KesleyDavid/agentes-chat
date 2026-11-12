import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@agenteschat/config";
import { en } from "../../../packages/i18n/src/en";
import {
  computerFiles,
  HOST_LAUNCHD_LABEL,
  HOST_SERVICE,
  hostLogFile,
  hostState,
  hostTokenConflict,
  installedCommands,
  parseOptions,
  SYSTEM_RUNNER_HOME,
  TELEMETRY_TEXT,
} from "../../../packages/setup/src/lib";
import { TERM_SH } from "../../../packages/setup/src/term-sh";
import { SYSTEM_RUNNER_HOME as RUNNER_SYSTEM_HOME } from "../runner/config";
import { HostComputer } from "../runner/host";
import { installScript, SYSTEM_LAUNCHER, SYSTEM_RUNNER_DIR } from "../runner/install-script";
import {
  LAUNCHD_LABEL,
  launchdPlist,
  launchdPlistPath,
  SERVICE_NAME,
  SYSTEM_UNIT_PATH,
  systemdSystemUnit,
} from "../runner/service";
import { createApp } from "../src/app";

// The install.sh tests spawn shells and stubs, which take seconds on a loaded machine; the preload's longer
// default timeout reaches only the first test file of a run.
setDefaultTimeout(30_000);

/**
 * install.sh: served at /install, and its decisions per machine, read from `--plan`. The commands it
 * asks about the machine are stubs that answer as that machine would; every command that could change
 * the machine is a stub too, and `--plan` must call none of them.
 */
const SCRIPT = join(import.meta.dir, "../../../install.sh");
const text = readFileSync(SCRIPT, "utf8");
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `agentes-install-${name}-`));
  dirs.push(dir);
  return dir;
};

interface Machine {
  os: string;
  arch: string;
  uid: number;
  /** The engine's version, or "down" (the CLI is there, the engine doesn't answer); no docker command without it. */
  docker?: string;
  /** The Compose plugin's version; none without it. */
  compose?: string;
  /** A bun on the PATH, and its version. */
  bun?: string;
  sudo?: boolean;
  musl?: boolean;
  /** Other commands this machine has (colima, brew): stubs that only note their call. */
  has?: string[];
}

/** What the installer asks the machine, as `command args` lines. Anything else it runs is a change. */
const PROBES =
  /^(uname -[sm]|id -u|docker info --format \{\{\.ServerVersion\}\}|docker compose version --short|bun --version)$/;

interface RunOptions {
  piped?: string;
  env?: Record<string, string>;
  /** On a pseudo-terminal (100 columns): stdout and stderr come back together, in `out`. */
  tty?: boolean;
  /** A real run, not --plan: its setup is the bun stub, which notes AGENTES_FRAME. */
  real?: boolean;
  /** Shell commands run just before the installer, in its terminal. */
  before?: string;
}

async function plan(machine: Machine, args: string[] = [], o: RunOptions = {}) {
  const bin = tempDir("bin");
  const home = tempDir("home");
  const log = join(bin, "calls.log");
  writeFileSync(log, "");
  const stub = (name: string, body = "") =>
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`, { mode: 0o755 });
  stub("uname", `case "$1" in -m) echo ${machine.arch} ;; *) echo ${machine.os} ;; esac`);
  stub("id", `echo ${machine.uid}`);
  if (machine.docker) {
    const info = machine.docker === "down" ? "exit 1" : `echo ${machine.docker}`;
    // Without the plugin, docker reads --short as a flag of its own.
    const compose = machine.compose ? `echo ${machine.compose}` : `echo "unknown flag: --short" >&2; exit 125`;
    stub("docker", `case "$1" in info) ${info} ;; compose) ${compose} ;; esac`);
  }
  if (machine.bun) {
    // As the setup: whether it draws in the installer's frame, and the terminal it reads.
    const setup = `echo "frame \${AGENTES_FRAME:-none} stdin $(tty -s && tty || echo none)" >> "$STUB_LOG"`;
    stub("bun", `case "$1" in --version) echo ${machine.bun} ;; *) ${setup} ;; esac`);
  }
  if (machine.musl) stub("ldd", `echo "musl libc (x86_64)" >&2; exit 1`);
  for (const name of machine.has ?? []) stub(name);
  for (const name of [
    "curl",
    "unzip",
    "python3",
    "mkdir",
    "mv",
    "chmod",
    "systemctl",
    ...(machine.sudo === false ? [] : ["sudo"]),
  ]) {
    stub(name);
  }
  // A real run keeps its work in a folder of its own.
  for (const tool of ["sleep", ...(o.real ? ["mktemp", "rm", "tty"] : [])]) {
    symlinkSync(Bun.which(tool) as string, join(bin, tool));
  }
  const argv = [...(o.real ? [] : ["--plan"]), ...args];
  const direct = o.piped === undefined ? ["/bin/sh", SCRIPT, ...argv] : ["/bin/sh", "-s", "--", ...argv];
  const cmd = o.before ? ["/bin/sh", "-c", `${o.before} && exec "$@"`, "sh", ...direct] : direct;
  const env = { PATH: bin, HOME: home, STUB_LOG: log, ...o.env };
  let out = "";
  let err = "";
  let code: number;
  if (o.tty) {
    const decoder = new TextDecoder();
    let eof = () => {};
    const drained = new Promise<void>((resolve) => {
      eof = resolve;
    });
    const proc = Bun.spawn(cmd, {
      cwd: home,
      env: { TERM: "xterm-256color", ...env },
      terminal: {
        cols: 100,
        rows: 40,
        data: (_t, bytes) => {
          out += decoder.decode(bytes);
        },
        exit: () => eof(),
      },
    });
    [code] = await Promise.all([proc.exited, drained]);
  } else {
    const proc = Bun.spawn(cmd, {
      cwd: home,
      env,
      stdin: o.piped === undefined ? "ignore" : new Blob([o.piped]),
      stdout: "pipe",
      stderr: "pipe",
      // A session of its own, so no controlling terminal, as under cloud-init or CI.
      detached: true,
    });
    [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  }
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { code, out, err, calls, bin, home, changes: calls.filter((call) => !PROBES.test(call)) };
}

/** What a terminal shows, without the colors. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's escapes are what it leaves out
const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replaceAll("\r", "");

const linuxRoot: Machine = { os: "Linux", arch: "x86_64", uid: 0 };
const mac: Machine = { os: "Darwin", arch: "arm64", uid: 501 };
const bunZip = (target: string) =>
  `$ curl -fsSL --proto =https --retry 3 -o <tmp>/bun.zip https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-${target}.zip`;
const composeDownload = (asset: string) =>
  `$ curl -fsSL --proto =https --retry 3 -o <tmp>/docker-compose https://github.com/docker/compose/releases/download/v5.5.1/${asset}`;

describe("GET /install", () => {
  const app = () => {
    const web = tempDir("web");
    writeFileSync(join(web, "index.html"), '<!doctype html><div id="root"></div>');
    return createApp({ edition: "selfhost", version: "1", modules: [], pingDatabase: async () => {}, webDir: web });
  };

  test("serves install.sh as a shell script, never cached, ahead of the web app", async () => {
    const server = app();
    for (const path of ["/install", "/install.sh"]) {
      const res = await server.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("text/x-shellscript");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(text);
    }
  });

  test("serves the repository's docker-compose.yml, the one the setup downloads into a folder that has none", async () => {
    const res = await app().request("/install/docker-compose.yml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("application/yaml");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(readFileSync(join(import.meta.dir, "../../../docker-compose.yml"), "utf8"));
  });
});

describe("the setup reads the agents' computer the way the runner writes it", () => {
  test("its service's name, and its log on a Mac", () => {
    expect(HOST_SERVICE).toBe(SERVICE_NAME);
    const home = "/Users/ana/.agentes-runner";
    const plist = launchdPlist({ runtime: "/usr/local/bin/bun", script: `${home}/agentes-runner.mjs`, home });
    expect(plist).toContain(`<key>StandardOutPath</key>\n  <string>${hostLogFile(home)}</string>`);
  });

  test("where its service and its runner are, and the home a connected computer's token is in", () => {
    expect(HOST_LAUNCHD_LABEL).toBe(LAUNCHD_LABEL);
    expect(SYSTEM_RUNNER_HOME).toBe(RUNNER_SYSTEM_HOME);
    expect(computerFiles(true, "/Users/ana", "/Users/ana/.agentes-runner")).toEqual({
      service: launchdPlistPath("/Users/ana"),
      bundle: "/Users/ana/.agentes-runner/agentes-runner.mjs",
      command: "/Users/ana/.agentes-runner/bin/agentes-runner",
      log: hostLogFile("/Users/ana/.agentes-runner"),
    });
    expect(computerFiles(false, "/root", "/root/.agentes-runner")).toEqual({
      service: SYSTEM_UNIT_PATH,
      bundle: `${SYSTEM_RUNNER_DIR}/agentes-runner.mjs`,
      command: SYSTEM_LAUNCHER,
      log: null,
    });
    // The installer's own runner paths, and its check for a connected computer.
    const script = installScript("https://agentes.test");
    expect(script).toContain('BUNDLE="$SYSTEM_DIR/agentes-runner.mjs"');
    expect(script).toContain('BUNDLE="$RUNNER_HOME/agentes-runner.mjs"');
    expect(script).toContain('LAUNCHER="$RUNNER_HOME/bin/agentes-runner"');
    expect(script).toContain(`grep -q '"token"' "$RUNNER_HOME/config.json"`);
  });

  test("whether its service lets agents run commands, from the unit and the plist the runner writes", () => {
    const launch = {
      runtime: "/opt/agentes-runner/bin/bun",
      script: "/opt/agentes-runner/agentes-runner.mjs",
      home: "/x",
    };
    const host = ["host", "--server", "http://127.0.0.1:3000", "--token-file", "/opt/agentes/host-computer-token"];
    for (const write of [systemdSystemUnit, launchdPlist]) {
      expect(installedCommands(write(launch, host))).toBe(true);
      expect(installedCommands(write(launch, [...host, "--no-exec"]))).toBe(false);
      // A connected computer's own service isn't this server's.
      expect(installedCommands(write(launch, ["start"]))).toBeNull();
    }
  });

  test("each setting the setup won't add the token beside is one the server refuses to start with", () => {
    const valid = { DATABASE_URL: "postgres://u:p@localhost:5432/db", AGENTES_SECRET: "x".repeat(48) };
    const token = { HOST_COMPUTER_TOKEN: "t".repeat(64), OPERATOR_API_TOKEN: "o".repeat(64) };
    const env = (setting: string) => Object.fromEntries([setting.split("=") as [string, string]]);
    for (const content of ["ALLOW_SIGNUP=true\n", "MACHINE_PROVISIONING=external\n"]) {
      const conflict = hostTokenConflict(content);
      if (!conflict) throw new Error(`no conflict for ${content}`);
      expect(() => loadConfig({ ...valid, ...token, ...env(conflict.now) })).toThrow(
        /HOST_COMPUTER_TOKEN can't be set/,
      );
      expect(() => loadConfig({ ...valid, ...token, ...env(conflict.off) })).not.toThrow();
    }
    expect(hostTokenConflict("ALLOW_SIGNUP=false\nMACHINE_PROVISIONING=off\n")).toBeNull();
  });

  test("the usage statistics question says what the web app's switch says", () => {
    const { label, help } = en.settings.telemetry;
    expect(TELEMETRY_TEXT.join(" ")).toBe(`${label}: ${help.charAt(0).toLowerCase()}${help.slice(1)}`);
  });

  test("each state of `agentes-runner host`, from the lines it logs", async () => {
    const answers: [string, () => Promise<Response>][] = [
      ["on", async () => Response.json({ orgs: [] })],
      ["off", async () => new Response("{}", { status: 404 })],
      ["refused", async () => new Response("{}", { status: 401 })],
      [
        "unreachable",
        async () => {
          throw new Error("Unable to connect");
        },
      ],
    ];
    for (const [state, answer] of answers) {
      const lines: string[] = [];
      const computer = new HostComputer({
        server: "http://127.0.0.1:3000",
        token: () => "t".repeat(64),
        state: tempDir("host"),
        name: "box",
        system: false,
        exec: false,
        // As `agentes-runner host` writes it: a time stamp, then the line.
        log: (line) => lines.push(`${new Date().toISOString()} ${line}`),
        start: () => ({ exited: new Promise(() => {}), kill: () => {} }),
        fetch: answer,
      });
      await computer.sync();
      expect(hostState(lines.join("\n"))).toBe(state as ReturnType<typeof hostState>);
    }
    const lines: string[] = [];
    const noToken = new HostComputer({
      server: "http://127.0.0.1:3000",
      token: () => null,
      state: tempDir("host"),
      name: "box",
      system: false,
      exec: false,
      log: (line) => lines.push(`${new Date().toISOString()} ${line}`),
      start: () => ({ exited: new Promise(() => {}), kill: () => {} }),
    });
    await noToken.sync();
    expect(hostState(lines.join("\n"))).toBe("no_token");
  });
});

describe("install.sh", () => {
  test("parses as POSIX sh", () => {
    expect(Bun.spawnSync(["/bin/sh", "-n", SCRIPT]).exitCode).toBe(0);
  });

  test("a download cut short runs nothing", async () => {
    const lastLine = text.trimEnd().lastIndexOf("\n");
    for (const cut of [text.slice(0, lastLine), text.slice(0, Math.floor(text.length / 2))]) {
      const run = await plan(linuxRoot, [], { piped: cut });
      expect(run.calls).toEqual([]);
      expect(run.out).toBe("");
    }
  });

  test("draws as the runner's installer does: its term.sh is packages/setup/src/term-sh.ts", () => {
    const start = "# --- term.sh: packages/setup/src/term-sh.ts, kept equal by a test ---\n";
    const end = "# --- end of term.sh ---\n";
    expect(text).toContain(start);
    expect(text.slice(text.indexOf(start) + start.length, text.indexOf(end))).toBe(TERM_SH);
  });

  test("on a terminal: the logo, the badge and the line; a run that needs root draws none of it before sudo", async () => {
    const root = await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.4.4" }, [], { tty: true });
    expect(root.code).toBe(0);
    const screen = plain(root.out);
    expect(screen).toContain("▀");
    expect(screen).toContain(
      "┌   agentes.chat  install plan (--plan: nothing runs)\n│\n◇  Linux on x64, as root\n◇  A terminal: the setup asks its questions there\n",
    );
    expect(screen).toContain("│\n└  Nothing ran. For the setup's own plan, run its command above with --dry-run.\n");

    // Root first: a run that needs it draws nothing before sudo, so the logo shows once, in the root run.
    const user: Machine = { os: "Linux", arch: "x86_64", uid: 1000 };
    const real = await plan(user, ["--yes"], { tty: true, real: true });
    expect(real.code).toBe(0);
    expect(plain(real.out)).toBe(
      `●  Docker needs root here: running this installer again as root\n   $ sudo sh ${SCRIPT} --yes\n`,
    );
    expect(real.calls).toContain(`sudo sh ${SCRIPT} --yes`);

    // Its plan draws the logo and the frame, then stops where the root run would start.
    const planned = plain((await plan(user, ["--yes"], { tty: true })).out);
    expect(planned).toContain("▀");
    expect(planned).toContain("┌   agentes.chat  install plan (--plan: nothing runs)\n│\n◇  Linux on x64\n");
    expect(planned).toEndWith(
      `●  Docker needs root here: running this installer again as root\n│  $ sudo sh ${SCRIPT} --yes\n│\n└  With --plan it stops here. As root, --plan shows the rest.\n`,
    );
  });

  test("a real run says what it found, echoes no command, and hands over to the setup in its own frame", async () => {
    const dir = tempDir("dir");
    const machine = { ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.4.4" };
    const run = await plan(machine, ["--dir", dir, "--network", "local"], { real: true });
    expect(run.code).toBe(0);
    expect(run.out).toContain("◇  Docker 26.1.5\n◇  Compose 2.26.1\n");
    expect(run.out).not.toContain("$ ");
    expect(run.out).toEndWith(
      `\n◇  The setup, in ${dir}:\n     ${run.bin}/bun x --bun @agenteschat/setup@0.1.1 --network local\n\n`,
    );
    // The setup draws in the installer's frame: no logo or badge of its own.
    expect(run.calls).toContain("bun x --bun @agenteschat/setup@0.1.1 --network local");
    expect(run.calls).toContain("frame 1 stdin none");
  });

  test("on a terminal, the setup reads it by its own name: Bun on macOS can't wait for keys on /dev/tty", async () => {
    const dir = tempDir("dir");
    const machine = { ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.4.4" };
    const run = await plan(machine, ["--dir", dir], { real: true, tty: true });
    expect(run.code).toBe(0);
    expect(plain(run.out)).toContain(
      `◇  The setup, in ${dir}:\n│    ${run.bin}/bun x --bun @agenteschat/setup@0.1.1\n│\n`,
    );
    expect(run.calls.find((call) => call.startsWith("frame "))).toMatch(/^frame 1 stdin \/dev\/(pts\/\d+|ttys\d+)$/);
  });

  // Root reads any device, so only another user sees the one that can't be opened by its name.
  test.skipIf(process.getuid?.() === 0)(
    "a terminal it can't open by its name (after su, it's still the first user's): the setup reads /dev/tty",
    async () => {
      const dir = tempDir("dir");
      const device = join(tempDir("device"), "name");
      const machine = { ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.4.4" };
      // Its terminal as after su: /dev/tty opens, the device by its name doesn't.
      const before = `d=$(${Bun.which("tty")}) && echo "$d" > ${device} && ${Bun.which("chmod")} u-r "$d"`;
      try {
        const run = await plan(machine, ["--dir", dir], { real: true, tty: true, before });
        expect(run.code).toBe(0);
        expect(run.out).not.toContain("Permission denied");
        expect(run.calls).toContain("frame 1 stdin /dev/tty");
      } finally {
        Bun.spawnSync([Bun.which("chmod") as string, "u+r", readFileSync(device, "utf8").trim()]);
      }
    },
  );

  test("hands over to the setup it ships with, on a Bun at least the repository's", () => {
    const setup = JSON.parse(readFileSync(join(import.meta.dir, "../../../packages/setup/package.json"), "utf8"));
    expect(text).toContain(`\n  SETUP_VERSION=${setup.version}\n`);
    const root = JSON.parse(readFileSync(join(import.meta.dir, "../../../package.json"), "utf8"));
    const repo = (root.packageManager as string).replace(/^bun@/, "").split(".").map(Number);
    const pinned = (/\n {2}BUN_VERSION=([\d.]+)\n/.exec(text)?.[1] ?? "").split(".").map(Number);
    const order = pinned.map((n, i) => n - (repo[i] ?? 0)).find((d) => d !== 0) ?? 0;
    expect(order).toBeGreaterThanOrEqual(0);
  });

  test("Linux as root without Docker: Docker's own script with --yes, then Bun and the setup", async () => {
    const run = await plan(linuxRoot, ["--yes", "--network", "local"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("◇  Linux on x64, as root");
    expect(run.out).toContain("◇  Docker isn't installed: installing it with Docker's own script (--yes)");
    expect(run.out).toContain("$ curl -fsSL --proto =https --retry 3 -o <tmp>/get-docker.sh https://get.docker.com");
    expect(run.out).toContain("$ sh <tmp>/get-docker.sh");
    expect(run.out).toContain("◇  Compose comes with it");
    expect(run.out).toContain(bunZip("linux-x64-baseline"));
    expect(run.out).toContain("$ mv <tmp>/bun-linux-x64-baseline/bun /opt/agentes/.runtime/bun");
    expect(run.out).toContain("$ cd /opt/agentes");
    expect(run.out).toContain(
      "$ /opt/agentes/.runtime/bun x --bun @agenteschat/setup@0.1.1 --network local </dev/null",
    );
    expect(run.changes).toEqual([]);
  });

  test("docker.io without Compose, or with an old one: the pinned plugin for every user", async () => {
    const none = await plan({ ...linuxRoot, docker: "26.1.5+dfsg1" });
    expect(none.out).toContain("◇  Docker 26.1.5+dfsg1");
    expect(none.out).toContain(
      "◇  Docker has no Compose plugin: installing Compose 5.5.1 (SHA-256 checked) in /usr/local/lib/docker/cli-plugins",
    );
    expect(none.out).toContain(composeDownload("docker-compose-linux-x86_64"));
    expect(none.out).toContain("$ mv <tmp>/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose");
    expect(none.out).not.toContain("get.docker.com");
    expect(none.changes).toEqual([]);

    const old = await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.20.2" });
    expect(old.out).toContain("◇  Compose 2.20.2 is older than 2.23.1: installing Compose 5.5.1");

    const fine = await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.3.1" });
    expect(fine.out).toContain("◇  Compose 2.26.1");
    expect(fine.out).not.toContain("docker-compose");
    // A bun older than the pinned one isn't used.
    expect(fine.out).toContain(bunZip("linux-x64-baseline"));
  });

  test("not root and no Docker: the same install again with sudo, its options kept", async () => {
    const user: Machine = { os: "Linux", arch: "x86_64", uid: 1000 };
    const file = await plan(user, ["--yes", "--dir", "/srv/agentes", "--network", "local"]);
    expect(file.code).toBe(0);
    // --plan runs nothing again, so it starts as any plan does, then says where it stops.
    expect(file.out).toBe(
      [
        "agentes.chat install plan (--plan: nothing runs)",
        "◇  Linux on x64",
        "◇  No terminal: the setup takes its defaults and the options given",
        "●  Docker needs root here: running this installer again as root",
        `   $ sudo sh ${SCRIPT} --yes --dir /srv/agentes --network local`,
        "",
        "With --plan it stops here. As root, --plan shows the rest.",
        "",
      ].join("\n"),
    );
    expect(file.changes).toEqual([]);

    // Under curl | sh there's no file to run again: it downloads the published one.
    const piped = await plan({ ...user, docker: "down" }, [], { piped: text });
    expect(piped.out).toContain("●  Docker needs root here: downloading this installer to run it again as root");
    expect(piped.out).toContain(
      "$ curl -fsSL --proto =https --retry 3 -o <tmp>/install.sh https://agentes.chat/install",
    );
    expect(piped.out).toContain("$ sudo sh <tmp>/install.sh");
    expect(piped.changes).toEqual([]);

    const noSudo = await plan({ ...user, sudo: false });
    expect(noSudo.code).toBe(1);
    expect(noSudo.err).toContain("Docker needs root here, and this computer has no sudo.");
  });

  test("--computer yes as a user other than root on Linux: the same install again with sudo before anything else, else stopped; as root and on a Mac it goes on", async () => {
    // A user who can use Docker: only the agents' computer needs root.
    const user: Machine = { os: "Linux", arch: "x86_64", uid: 1000, docker: "27.3.1", compose: "2.26.1" };
    const why = "Making this machine your agents' computer (--computer yes) needs root";
    expect((await plan(user, ["--computer", "yes", "--network", "local"])).out).toBe(
      [
        "agentes.chat install plan (--plan: nothing runs)",
        "◇  Linux on x64",
        "◇  No terminal: the setup takes its defaults and the options given",
        `●  ${why}: running this installer again as root`,
        `   $ sudo sh ${SCRIPT} --computer yes --network local`,
        "",
        "With --plan it stops here. As root, --plan shows the rest.",
        "",
      ].join("\n"),
    );
    // Run for real: sudo comes first, with nothing downloaded or written before it.
    const real = await plan(user, ["--computer=yes"], { real: true });
    expect(real.code).toBe(0);
    expect(real.changes).toEqual([`sudo sh ${SCRIPT} --computer=yes`]);
    // An install of this user's keeps its folder: as root, the default is /opt/agentes.
    const installed = await plan(user, ["--computer", "yes"], {
      before: '/bin/mkdir -p "$HOME/agentes" && : > "$HOME/agentes/.env"',
    });
    expect(installed.out).toContain(`$ sudo sh ${SCRIPT} --dir ${installed.home}/agentes --computer yes\n`);
    const noSudo = await plan({ ...user, sudo: false }, ["--computer", "yes"], { real: true });
    expect(noSudo.code).toBe(1);
    expect(noSudo.err).toContain(`${why}, and this computer has no sudo.`);
    expect(noSudo.err).toContain(
      "Run this as root, or leave out --computer yes and connect a computer later in Settings › Devices.",
    );
    expect(noSudo.changes).toEqual([]);

    // The last --computer given wins, as in the setup. Root, and a Mac, need no sudo for it.
    for (const run of [
      await plan(user, ["--computer", "yes", "--computer", "no"]),
      await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1" }, ["--computer", "yes"]),
      await plan({ ...mac, docker: "28.5.1", bun: "1.4.4" }, ["--computer", "yes"]),
    ]) {
      expect(run.code).toBe(0);
      expect(run.out).not.toContain("sudo");
      expect(run.out).toContain("@agenteschat/setup@0.1.1 --computer ");
    }
  });

  test("a user who can use Docker installs in their home, Compose in their own plugins", async () => {
    const run = await plan({ os: "Linux", arch: "x86_64", uid: 1000, docker: "27.3.1" });
    expect(run.code).toBe(0);
    expect(run.out).toContain(`in ${run.home}/.docker/cli-plugins`);
    expect(run.out).toContain(`$ cd ${run.home}/agentes`);
    expect(run.changes).toEqual([]);
  });

  test("a Mac with Docker running: Docker, and the bun it already has", async () => {
    const run = await plan({ ...mac, docker: "28.5.1", bun: "1.4.4" }, ["--network", "local"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("◇  macOS on Apple silicon");
    expect(run.out).toContain("◇  Docker 28.5.1");
    expect(run.out).toContain(`◇  Bun 1.4.4 (${run.bin}/bun)`);
    expect(run.out).toContain(`$ cd ${run.home}/agentes`);
    expect(run.out).toContain(`$ ${run.bin}/bun x --bun @agenteschat/setup@0.1.1 --network local </dev/null`);
    expect(run.out).not.toContain("--native");
    expect(run.out).not.toContain("Compose");
    expect(run.changes).toEqual([]);
  });

  test("a Mac without Docker, or with it stopped, is told what to install or start; --native isn't there yet", async () => {
    const none = await plan(mac);
    expect(none.code).toBe(1);
    expect(none.err).toContain("This installer runs agentes.chat on Docker, and this Mac doesn't have it.");
    expect(none.err).toContain("Docker Desktop, OrbStack or Colima");
    expect(none.err).toContain("Run agentes.chat on this Mac");
    expect(none.out).not.toContain("Bun");
    expect(none.changes).toEqual([]);

    const stopped = await plan({ ...mac, docker: "down" });
    expect(stopped.code).toBe(1);
    expect(stopped.err).toContain("Docker is on this Mac, but it doesn't answer.");

    // With no terminal to ask and no --yes, it starts and installs nothing.
    const colima = await plan({ ...mac, docker: "down", has: ["colima"] });
    expect(colima.code).toBe(1);
    expect(colima.err).toContain("pass --yes to start it");
    expect(colima.changes).toEqual([]);

    for (const machine of [mac, linuxRoot]) {
      const native = await plan(machine, ["--native"]);
      expect(native.code).toBe(1);
      expect(native.err).toContain("can't run agentes.chat without Docker yet (--native)");
      expect(native.calls).toEqual([]);
    }
  });

  test("a Mac with Colima stopped: started (--yes), then the wait for Docker to answer", async () => {
    const run = await plan({ ...mac, docker: "down", has: ["colima"], bun: "1.4.4" }, ["--yes"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("◇  Colima isn't running: starting it, once you say yes (--yes doesn't ask)");
    expect(run.out).toContain("$ colima start");
    expect(run.out).toContain("◇  Then waits for Docker to answer");
    expect(run.changes).toEqual([]);
  });

  test("a Mac with no Docker: Colima with Homebrew (--yes), and Homebrew first only on a terminal", async () => {
    const brew = await plan({ ...mac, has: ["brew"], bun: "1.4.4" }, ["--yes"]);
    expect(brew.code).toBe(0);
    expect(brew.out).toContain("◇  No Docker: installing Colima with Homebrew and starting it");
    expect(brew.out).toContain(`$ ${brew.bin}/brew install colima docker docker-compose`);
    expect(brew.out).toContain("$ colima start");
    expect(brew.changes).toEqual([]);

    // Homebrew's own installer asks for a password: without a terminal it stops before it.
    const noBrew = await plan(mac, ["--yes"]);
    expect(noBrew.code).toBe(1);
    expect(noBrew.err).toContain("Homebrew's installer needs a terminal");
    expect(noBrew.changes).toEqual([]);
  });

  test("Linux with Docker stopped: started (--yes), else told how without a terminal", async () => {
    const run = await plan({ ...linuxRoot, docker: "down", compose: "2.26.1" }, ["--yes"]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("$ systemctl enable --now docker");
    expect(run.out).toContain("◇  Then waits for Docker to answer");
    expect(run.changes).toEqual([]);

    const stopped = await plan({ ...linuxRoot, docker: "down" });
    expect(stopped.code).toBe(1);
    expect(stopped.err).toContain("Docker is installed, but its engine doesn't answer.");
    expect(stopped.err).toContain("pass --yes to start it");
  });

  test("every option it hands the setup is one the setup knows", async () => {
    const runs = [
      await plan(linuxRoot, ["--yes", "--network", "local", "--email", "skip"]),
      await plan(linuxRoot, ["--yes", "--computer", "no", "--computer-commands", "no", "--telemetry", "off"]),
      await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1" }, ["--json"]),
      await plan({ ...mac, docker: "28.5.1", bun: "1.4.4" }, ["--network", "local"]),
      await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1" }, ["--email", "skip"], { piped: text }),
    ];
    for (const run of runs) {
      const line = `${run.out}${run.err}`.split("\n").find((l) => l.includes("@agenteschat/setup@"));
      const args = line?.split("@agenteschat/setup@0.1.1")[1]?.replace("</dev/null", "").trim().split(" ");
      expect(args).toBeDefined();
      expect(parseOptions((args ?? []).filter(Boolean), {})).not.toHaveProperty("error");
    }
  });

  test("arm64 Linux gets the arm64 Bun and Compose", async () => {
    const run = await plan({ os: "Linux", arch: "aarch64", uid: 0, docker: "26.1.5" });
    expect(run.out).toContain("◇  Linux on arm64, as root");
    expect(run.out).toContain(composeDownload("docker-compose-linux-aarch64"));
    expect(run.out).toContain(bunZip("linux-aarch64"));
  });

  test("anything but 64-bit macOS or glibc Linux is refused, with the manual steps", async () => {
    for (const machine of [
      { os: "FreeBSD", arch: "amd64", uid: 0 },
      { os: "Linux", arch: "i686", uid: 0 },
      { os: "MINGW64_NT-10.0", arch: "x86_64", uid: 0 },
    ]) {
      const run = await plan(machine);
      expect(run.code).toBe(1);
      expect(run.err).toContain(`this is ${machine.os} on ${machine.arch}`);
      expect(run.err).toContain("https://agentes.chat/docs/install-on-a-server");
    }
    const musl = await plan({ ...linuxRoot, musl: true });
    expect(musl.code).toBe(1);
    expect(musl.err).toContain("musl");
  });

  test("no terminal: Docker only with --yes, and the setup reads nothing, not the piped script", async () => {
    const run = await plan(linuxRoot);
    expect(run.out).toContain("◇  No terminal: the setup takes its defaults and the options given");
    expect(run.code).toBe(1);
    expect(run.err).toContain("with no terminal to ask");
    expect(run.err).toContain("Pass --yes");

    const piped = await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1" }, ["--email", "skip"], {
      piped: text,
    });
    expect(piped.code).toBe(0);
    expect(piped.out).toContain("@agenteschat/setup@0.1.1 --email skip </dev/null");
  });

  test("a local build of the setup, and --json output kept off stdout", async () => {
    const build = join(tempDir("setup"), "index.js");
    writeFileSync(build, "");
    const run = await plan({ ...linuxRoot, docker: "26.1.5", compose: "2.26.1", bun: "1.4.4" }, ["--json"], {
      env: { AGENTES_INSTALL_SETUP: build },
    });
    expect(run.code).toBe(0);
    expect(run.out).toBe("");
    expect(run.err).toContain(`$ ${run.bin}/bun ${build} --json </dev/null`);
  });
});
