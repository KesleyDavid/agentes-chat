import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeAgents } from "../../runner/access";
import { accountSelfCheck, REFUSED, type SelfCheck } from "../../runner/account-check";
import {
  ACCOUNT_USERS_FILE,
  AccountUsers,
  AGENT_USERS_FILE,
  AgentUsers,
  accountCwd,
  accountLauncher,
  adbServerPort,
  agentGid,
  agentSubids,
  agentUserName,
  authEgressPrefix,
  containersCommand,
  denySchedulers,
  ensureContainers,
  ensureSubids,
  keepContainers,
  readAccountUsers,
  readAgentUsers,
  rootlessContainers,
  SUBIDS,
  stopAccountScopes,
  stopContainers,
  systemLauncher,
  trustedNetworkLauncher,
} from "../../runner/agent-users";
import { agentCategorySlice, agentSlice, type RunCommand } from "../../runner/service";
import { errorCode, removeDirs, tempDir } from "./helpers";

/** A root-owned executable that is no link: `/usr/bin/true` is one where coreutils is a multicall binary (Ubuntu 26.04). */
const ROOT_TOOL = realpathSync("/usr/bin/true");

const dirs: string[] = [];
afterEach(() => removeDirs(dirs));

const RANGE: [number, number] = [21000, 21099];
const ANA = { id: "A1B2C3D4-0000-4000-8000-000000000001", handle: "ana", name: "Ana Ção" };
const BIA = { id: "b2c3d4e5-0000-4000-8000-000000000002", handle: "bia", name: "Bia" };

interface OsUser {
  name: string;
  uid: number;
  comment: string;
}

/** `name:first:count` lines of a subuid or subgid file. */
const subidLines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

/**
 * passwd in memory; useradd and usermod fail the way the real ones do (9: the name exists, 4: the uid is taken). With
 * `etc`, useradd gives a new user the next free range of subordinate ids, as Debian's does, and usermod's
 * `--add-subuids`/`--del-subuids` (and gids) change those files.
 */
function fakeOs(users: OsUser[] = [{ name: "root", uid: 0, comment: "root" }], etc?: string) {
  const subids = (name: string, add: boolean, file: "subuid" | "subgid", range: string) => {
    if (!etc) return;
    const [first = 0, last = 0] = range.split("-").map(Number);
    const at = path.join(etc, file);
    const line = `${name}:${first}:${last - first + 1}`;
    const lines = subidLines(at).filter((l) => l !== line);
    writeFileSync(at, [...lines, ...(add ? [line] : [])].map((l) => `${l}\n`).join(""));
  };
  const calls: string[] = [];
  const fails = new Map<string, number>();
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args].join(" "));
    const failure = fails.get(file);
    if (failure !== undefined) {
      fails.delete(file);
      return { code: failure, output: `${file}: cannot lock /etc/passwd` };
    }
    const name = args.at(-1) ?? "";
    if (file === "getent") {
      return {
        code: 0,
        output: users.map((u) => `${u.name}:x:${u.uid}:${u.uid}:${u.comment}:/home/${u.name}:/bin/bash`).join("\n"),
      };
    }
    if (file === "useradd") {
      const uid = Number(args[args.indexOf("--uid") + 1]);
      if (users.some((u) => u.name === name)) return { code: 9, output: `useradd: user '${name}' already exists` };
      if (users.some((u) => u.uid === uid)) return { code: 4, output: `useradd: UID ${uid} is not unique` };
      users.push({ name, uid, comment: args[args.indexOf("--comment") + 1] ?? "" });
      if (etc && !args.includes("--system")) {
        const next = 100000 + 65536 * subidLines(path.join(etc, "subuid")).length;
        for (const f of ["subuid", "subgid"] as const) subids(name, true, f, `${next}-${next + 65535}`);
      }
      return { code: 0, output: "" };
    }
    if (file === "usermod") {
      const u = users.find((x) => x.name === name);
      if (!u) return { code: 6, output: `usermod: user '${name}' does not exist` };
      if (args[0] === "--comment") u.comment = args[1] ?? "";
      for (const [i, flag] of args.entries()) {
        const m = /^--(add|del)-sub(uid|gid)s$/.exec(flag);
        if (m) subids(name, m[1] === "add", m[2] === "uid" ? "subuid" : "subgid", args[i + 1] ?? "");
      }
      return { code: 0, output: "" };
    }
    return { code: 0, output: "" };
  };
  return { run, calls, users, failNext: (file: string, code: number) => fails.set(file, code) };
}

function setup(users?: OsUser[]) {
  const home = tempDir("agent-users-");
  dirs.push(home);
  const os = fakeOs(users, home);
  return { home, os, users: new AgentUsers({ home, range: RANGE, run: os.run, etc: home }) };
}

const listed = (home: string) => JSON.parse(readFileSync(path.join(home, AGENT_USERS_FILE), "utf8")) as unknown;

test("an agent's first request makes its user with the lowest free uid, listed in agents.json", () => {
  const { home, os, users } = setup([
    { name: "root", uid: 0, comment: "root" },
    { name: "maria", uid: 1000, comment: "Maria" },
    { name: "someone", uid: 21000, comment: "" },
    { name: "other", uid: 21001, comment: "" },
  ]);
  // A listed uid whose user is gone is still never handed out again.
  writeFileSync(
    path.join(home, AGENT_USERS_FILE),
    JSON.stringify([{ id: "gone-0001", user: "ag-gone0001", uid: 21002 }]),
  );

  expect(users.ensure(ANA)).toEqual({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 });
  expect(os.calls).toEqual([
    "getent passwd",
    "useradd --uid 21003 --user-group --create-home --home-dir /home/ag-a1b2c3d4 --shell /bin/bash --comment Ana Ção ag-a1b2c3d4",
    "chmod 0700 /home/ag-a1b2c3d4",
    // The range useradd gave it by the order users came in goes; its own block, from its uid, comes (ADR 0169).
    "usermod --del-subuids 100000-165535 --add-subuids 1376452608-1376518143 --del-subgids 100000-165535 --add-subgids 1376452608-1376518143 ag-a1b2c3d4",
  ]);
  expect(listed(home)).toEqual([
    { id: "gone-0001", user: "ag-gone0001", uid: 21002 },
    { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 },
  ]);
  if (process.platform !== "win32") expect(statSync(path.join(home, AGENT_USERS_FILE)).mode & 0o777).toBe(0o600);

  expect(users.ensure(BIA)).toEqual({ id: BIA.id, user: "ag-b2c3d4e5", uid: 21004 });
});

test("idempotent: the same agent again runs nothing; a new process only looks it up", () => {
  const { home, os, users } = setup();
  const first = users.ensure(ANA);
  os.calls.length = 0;
  expect(users.ensure(ANA)).toEqual(first);
  expect(users.ensure({ id: ANA.id, handle: ANA.handle })).toEqual(first);
  expect(os.calls).toEqual([]);

  const before = readFileSync(path.join(home, AGENT_USERS_FILE), "utf8");
  const again = new AgentUsers({ home, range: RANGE, run: os.run, etc: home });
  expect(again.ensure(ANA)).toEqual(first);
  expect(os.calls).toEqual(["getent passwd"]);
  expect(readFileSync(path.join(home, AGENT_USERS_FILE), "utf8")).toBe(before);
});

test("a rename changes the user's comment (usermod -c); a request without a name changes nothing", () => {
  const { os, users } = setup();
  users.ensure(ANA);
  os.calls.length = 0;
  users.ensure({ ...ANA, name: "Ana Nova" });
  expect(os.calls).toEqual(["getent passwd", "usermod --comment Ana Nova ag-a1b2c3d4"]);
  expect(os.users.find((u) => u.name === "ag-a1b2c3d4")?.comment).toBe("Ana Nova");
  os.calls.length = 0;
  users.ensure({ id: ANA.id, handle: ANA.handle });
  users.ensure({ ...ANA, name: "Ana Nova" });
  expect(os.calls).toEqual([]);
});

test("name rules: ag- and the id's first 8 letters and digits; comments useradd accepts", () => {
  expect(agentUserName(ANA.id)).toBe("ag-a1b2c3d4");
  expect(agentUserName("0123abcd")).toBe("ag-0123abcd");
  for (const bad of ["", "abc", "a-b-c-d-e-f-g", "--------"]) expect(() => agentUserName(bad)).toThrow();

  const { os, users } = setup();
  users.ensure({ ...ANA, name: "Ana: dev\nops\t1 " });
  users.ensure({ id: BIA.id, handle: "bia" });
  const added = os.users.slice(1);
  expect(added.map((u) => u.comment)).toEqual(["Ana dev ops 1", "bia"]);
});

test("a bad id or a user name another listed agent has is refused, and nothing is made", async () => {
  const { home, os, users } = setup();
  expect(await errorCode(() => users.ensure({ id: "short", handle: "x" }))).toBe("bad_request");
  expect(os.calls).toEqual([]);
  users.ensure(ANA);
  os.calls.length = 0;
  // Same first 8 of the id, another agent.
  const twin = { id: "a1b2c3d4-ffff-4fff-8fff-ffffffffffff", handle: "twin", name: "Twin" };
  expect(await errorCode(() => users.ensure(twin))).toBe("internal");
  expect(os.calls).toEqual(["getent passwd"]);
  expect(readAgentUsers(home).map((r) => r.id)).toEqual([ANA.id]);
});

test("a listed user whose uid changed on the computer is refused", async () => {
  const { os, users, home } = setup();
  users.ensure(ANA);
  const u = os.users.find((x) => x.name === "ag-a1b2c3d4");
  if (u) u.uid = 21050;
  const again = new AgentUsers({ home, range: RANGE, run: os.run, etc: home });
  expect(await errorCode(() => again.ensure(ANA))).toBe("internal");
});

test("agents.json lost: the agent's existing user is listed again with its own uid; one outside the range isn't", async () => {
  const { home, os, users } = setup([
    { name: "root", uid: 0, comment: "root" },
    { name: "ag-a1b2c3d4", uid: 21007, comment: "Ana Ção" },
    { name: "ag-b2c3d4e5", uid: 1001, comment: "Bia" },
  ]);
  expect(users.ensure(ANA)).toEqual({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21007 });
  expect(os.calls).toEqual([
    "getent passwd",
    "usermod --add-subuids 1376714752-1376780287 --add-subgids 1376714752-1376780287 ag-a1b2c3d4",
  ]);
  expect(await errorCode(() => users.ensure(BIA))).toBe("internal");
  expect(readAgentUsers(home)).toEqual([{ id: ANA.id, user: "ag-a1b2c3d4", uid: 21007 }]);
});

test("a useradd that fails keeps the uid listed: the next request makes the user with it", async () => {
  const { home, os, users } = setup();
  os.failNext("useradd", 10);
  expect(await errorCode(() => users.ensure(ANA))).toBe("internal");
  expect(readAgentUsers(home)).toEqual([{ id: ANA.id, user: "ag-a1b2c3d4", uid: 21000 }]);
  expect(users.ensure(BIA).uid).toBe(21001);
  os.calls.length = 0;
  expect(users.ensure(ANA).uid).toBe(21000);
  expect(os.calls[1]).toStartWith("useradd --uid 21000 ");
});

test("with a shared folder, each agent's user joins its group and gets ~/shared, made as the agent, once per process", () => {
  const home = tempDir("agent-users-");
  dirs.push(home);
  const os = fakeOs(undefined, home);
  const shared = { path: "/srv/agentes/shared", group: "agentes-shared" };
  const users = new AgentUsers({ home, range: RANGE, run: os.run, etc: home, shared });
  users.ensure(ANA);
  expect(os.calls.slice(-2)).toEqual([
    "usermod -aG agentes-shared ag-a1b2c3d4",
    "/usr/sbin/runuser -u ag-a1b2c3d4 -- ln -s /srv/agentes/shared /home/ag-a1b2c3d4/shared",
  ]);
  os.calls.length = 0;
  users.ensure(ANA);
  expect(os.calls).toEqual([]);

  // An existing agent joins too, at its first request after the runner starts; a failed usermod is only logged.
  const lines: string[] = [];
  const again = new AgentUsers({ home, range: RANGE, run: os.run, etc: home, shared, log: (l) => lines.push(l) });
  os.failNext("usermod", 6);
  expect(again.ensure(ANA).user).toBe("ag-a1b2c3d4");
  expect(os.calls.filter((c) => c.startsWith("usermod") || c.startsWith("/usr/sbin/runuser"))).toEqual([
    "usermod -aG agentes-shared ag-a1b2c3d4",
    "/usr/sbin/runuser -u ag-a1b2c3d4 -- ln -s /srv/agentes/shared /home/ag-a1b2c3d4/shared",
  ]);
  expect(lines).toEqual([expect.stringContaining("ag-a1b2c3d4 can't use the shared folder: usermod failed (6)")]);
});

test("no uid left in the range: refused", async () => {
  const home = tempDir("agent-users-");
  dirs.push(home);
  const os = fakeOs([
    { name: "a", uid: 21000, comment: "" },
    { name: "b", uid: 21001, comment: "" },
  ]);
  const users = new AgentUsers({ home, range: [21000, 21001], run: os.run, etc: home });
  expect(await errorCode(() => users.ensure(ANA))).toBe("internal");
  expect(readAgentUsers(home)).toEqual([]);
});

test("agents.json: only well-formed rows count, and the server's agent list never lands in it", () => {
  const home = tempDir("agent-users-");
  dirs.push(home);
  const file = path.join(home, AGENT_USERS_FILE);
  writeFileSync(
    file,
    JSON.stringify([
      { id: "x", handle: "dev", name: "Dev" },
      { id: "y", user: "root", uid: 0 },
      { id: "z", user: "ag-zzzzzzzz", uid: 999 },
      { id: "w", user: "ag-wwwwwwww", uid: 21050, extra: true },
    ]),
  );
  expect(readAgentUsers(home)).toEqual([{ id: "w", user: "ag-wwwwwwww", uid: 21050 }]);
  writeFileSync(file, "not json");
  expect(readAgentUsers(home)).toEqual([]);

  writeFileSync(file, JSON.stringify([{ id: "w", user: "ag-wwwwwwww", uid: 21050 }]));
  writeAgents(home, [{ id: "w", handle: "dev", name: "Dev" }]);
  expect(readAgentUsers(home)).toEqual([{ id: "w", user: "ag-wwwwwwww", uid: 21050 }]);
});

test("the launcher: the agent's slice, its own temporary folders, its user, absolute paths, a fixed environment", () => {
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 };
  const env = {
    HOME: "/home/ag-a1b2c3d4",
    USER: "ag-a1b2c3d4",
    LOGNAME: "ag-a1b2c3d4",
    SHELL: "/bin/bash",
    // The shared folder's bin/ (ADR 0115) is named, never on the PATH: every agent can write there.
    PATH: "/usr/local/bin:/usr/bin:/bin",
    AGENTES_SHARED_BIN: "/home/ag-a1b2c3d4/shared/bin",
    LANG: "C.UTF-8",
    ANDROID_ADB_SERVER_PORT: "31627",
    // A finished build's Gradle and Kotlin daemons give the memory back after 5 idle minutes, not 3 hours.
    GRADLE_OPTS: "-Dorg.gradle.daemon.idletimeout=300000",
  };
  const launcher = systemLauncher(user, true, false, false);
  const p = launcher.prefix;
  for (const systemd of [true, false])
    expect((systemLauncher(user, systemd, false).env.PATH ?? "").split(":")).not.toContain(env.AGENTES_SHARED_BIN);
  expect(p.slice(0, 8)).toEqual([
    "/usr/bin/systemd-run",
    "--quiet",
    "--scope",
    "--collect",
    "--slice=agents-21003.slice",
    "--",
    "/bin/sh",
    "-c",
  ]);
  expect(p.slice(9, 18)).toEqual([
    "sh",
    "21003",
    "/usr/bin/unshare",
    "--mount",
    "--propagation",
    "slave",
    "--",
    "/bin/sh",
    "-c",
  ]);
  expect(p.join("\n")).not.toContain("hidepid=");
  expect(p.slice(19)).toEqual(["sh", "21003", "/usr/sbin/runuser", "-u", "ag-a1b2c3d4", "--"]);
  expect(launcher).toMatchObject({ env, home: "/home/ag-a1b2c3d4", tmp: "/run/agentes-runner-tmp/21003/tmp" });
  // Root on the computer: the agent's own tmpfs, mounted once (a lock, so two first launches don't stack two).
  expect((p[8] ?? "").split("\n")).toEqual([
    "set -e",
    "r=/run/agentes-runner-tmp",
    'mkdir -p "$r"',
    'chmod 0700 "$r"',
    'd="$r/$1"',
    "shift",
    'mkdir -p "$d"',
    `flock "$r/.lock" sh -c 'mountpoint -q "$1" || mount -t tmpfs -o mode=0700,size=50%,nr_inodes=1m agentes-runner-tmp "$1"' sh "$d"`,
    'exec "$@"',
  ]);
  // Root, in the agent's own mount namespace, before it becomes the agent: its folders under root-only ones, bound
  // over the shared ones (/tmp, /dev/shm and /run/lock from its tmpfs, /var/tmp from the disk); in its own /tmp only
  // mkdir, never a chmod an agent's link could aim.
  expect((p[18] ?? "").split("\n")).toEqual([
    "set -e",
    "m=/run/agentes-runner-tmp/$1",
    "r=/var/lib/agentes-runner-tmp",
    'mkdir -p "$r"',
    'chmod 0700 "$r"',
    'd="$r/$1"',
    "shift",
    'mkdir -p "$d"',
    'chmod 0700 "$d"',
    'mkdir -p "$d/var-tmp"',
    'chmod 1777 "$d/var-tmp"',
    'for f in tmp shm lock; do mkdir -p "$m/$f"; chmod 1777 "$m/$f"; done',
    'mount --bind "$m/tmp" /tmp',
    'mount --bind "$d/var-tmp" /var/tmp',
    'mount --bind "$m/shm" /dev/shm',
    'if [ "$(stat -c %a /run/lock 2>/dev/null)" = 1777 ]; then mount --bind "$m/lock" /run/lock; fi',
    "mkdir -m 1777 /tmp/.X11-unix 2>/dev/null || :",
    "mkdir -m 1777 /tmp/.ICE-unix 2>/dev/null || :",
    'exec "$@"',
  ]);
  // systemd 253 and later: a process the kernel stops for memory takes only itself, not the rest of the scope.
  const keeps = systemLauncher(user, true, true, false).prefix;
  expect(keeps.slice(3, 6)).toEqual(["--collect", "--property=OOMPolicy=continue", "--slice=agents-21003.slice"]);
  expect(keeps.slice(6)).toEqual(p.slice(5));
  // No systemd as PID 1 (a container): runuser alone.
  expect(systemLauncher(user, false)).toEqual({
    prefix: ["/usr/sbin/runuser", "-u", "ag-a1b2c3d4", "--"],
    env,
    home: "/home/ag-a1b2c3d4",
  });
});

test("an agent's user can't schedule cron or at jobs, which would run outside its launcher", () => {
  const { home, users } = setup();
  const cron = path.join(home, "cron.deny");
  const at = path.join(home, "at.deny");
  // No at.deny: at takes root's jobs alone, so it isn't made.
  users.ensure(ANA);
  expect(readFileSync(cron, "utf8")).toBe("ag-a1b2c3d4\n");
  expect(statSync(cron).mode & 0o777).toBe(0o644);
  expect(existsSync(at)).toBe(false);
  // An at.deny of the distribution's, without a last newline; an agent already listed isn't again.
  writeFileSync(at, "daemon\nnobody");
  writeFileSync(cron, "ag-a1b2c3d4\n");
  users.ensure(BIA);
  expect(readFileSync(cron, "utf8")).toBe("ag-a1b2c3d4\nag-b2c3d4e5\n");
  expect(readFileSync(at, "utf8")).toBe("daemon\nnobody\nag-b2c3d4e5\n");
  // A new process looks again at its first request for each agent: one listed before this runner is too.
  writeFileSync(cron, "");
  const os = fakeOs([{ name: "ag-a1b2c3d4", uid: 21000, comment: "Ana Ção" }]);
  new AgentUsers({ home, range: RANGE, run: os.run, etc: home }).ensure(ANA);
  expect(os.calls).toEqual(["getent passwd"]);
  expect(readFileSync(cron, "utf8")).toBe("ag-a1b2c3d4\n");
  // The runner's start denies each agent it lists, before any request.
  denySchedulers("ag-b2c3d4e5", home);
  expect(readFileSync(cron, "utf8")).toBe("ag-a1b2c3d4\nag-b2c3d4e5\n");
});

test("adb's server port: one per agent, outside every band and Linux's ephemeral range", () => {
  expect(adbServerPort(20001)).toBe(30625);
  const ports = new Set<number>();
  for (let uid = 20000; uid <= 20999; uid++) ports.add(adbServerPort(uid));
  expect(ports.size).toBe(1000);
  for (let uid = 1000; uid <= 59999; uid += 7) {
    const port = adbServerPort(uid);
    expect(port >= 30000 && port <= 32767).toBe(true);
  }
});

test("inside the agent's slice, its Chrome and its AI CLIs each get one, named from its uid", () => {
  expect(agentSlice(21003)).toBe("agents-21003.slice");
  expect(agentCategorySlice(21003, "browser")).toBe("agents-21003-browser.slice");
  expect(agentCategorySlice(21003, "cli")).toBe("agents-21003-cli.slice");
});

test("an agent user's group, as the computer says it (`id -g`): never root's, never a guess", async () => {
  const calls: string[] = [];
  const answer =
    (code: number, output: string): RunCommand =>
    (file, args) => {
      calls.push([file, ...args].join(" "));
      return { code, output };
    };
  expect(agentGid("ag-a1b2c3d4", answer(0, "21007"))).toBe(21007);
  expect(calls).toEqual(["id -g ag-a1b2c3d4"]);
  expect(await errorCode(() => agentGid("ag-a1b2c3d4", answer(1, "id: 'ag-a1b2c3d4': no such user")))).toBe("internal");
  expect(await errorCode(() => agentGid("ag-a1b2c3d4", answer(0, "0")))).toBe("internal");
  expect(await errorCode(() => agentGid("ag-a1b2c3d4", answer(0, "21007 21008")))).toBe("internal");
});

test("the auth egress group: made once with groupadd, its gid in setpriv's prefix; none without setpriv or a gid", () => {
  const fake = (o: { setpriv?: boolean; group?: string | null; made?: string | null }) => {
    const calls: string[] = [];
    let group = o.group ?? null;
    const run: RunCommand = (file, args) => {
      calls.push([file, ...args].join(" "));
      if (file === "/usr/bin/setpriv") return { code: o.setpriv === false ? 127 : 0, output: "setpriv 2.39" };
      if (file === "groupadd") {
        group = o.made ?? null;
        return { code: 0, output: "" };
      }
      return group === null ? { code: 2, output: "" } : { code: 0, output: group };
    };
    return { run, calls };
  };
  const PREFIX = ["/usr/bin/setpriv", "--regid=995", "--clear-groups", "--"];
  const made = fake({ made: "agentes-auth:x:995:" });
  expect(authEgressPrefix(made.run)).toEqual(PREFIX);
  expect(made.calls).toEqual([
    "/usr/bin/setpriv --version",
    "getent group agentes-auth",
    "groupadd --system agentes-auth",
    "getent group agentes-auth",
  ]);
  const there = fake({ group: "agentes-auth:x:995:" });
  expect(authEgressPrefix(there.run)).toEqual(PREFIX);
  expect(there.calls).not.toContain("groupadd --system agentes-auth");
  const noSetpriv = fake({ setpriv: false, group: "agentes-auth:x:995:" });
  expect(authEgressPrefix(noSetpriv.run)).toBeNull();
  expect(noSetpriv.calls).toEqual(["/usr/bin/setpriv --version"]);
  expect(authEgressPrefix(fake({}).run)).toBeNull();
  // Root's group never stands in.
  expect(authEgressPrefix(fake({ group: "agentes-auth:x:0:" }).run)).toBeNull();
});

test("a privileged network hook rejects writable ancestors, symlinks and non-executables", () => {
  const file = "/opt/network/launch";
  const stats = (bad?: string, mode = 0o755, uid = 0, link = false) =>
    ((p: string) => ({
      uid: p === bad ? uid : 0,
      mode: p === bad ? mode : 0o755,
      isFile: () => p === file,
      isDirectory: () => p !== file,
      isSymbolicLink: () => p === bad && link,
    })) as unknown as Parameters<typeof trustedNetworkLauncher>[1];
  expect(trustedNetworkLauncher(file, stats())).toEqual([file]);
  expect(() => trustedNetworkLauncher(file, stats("/opt", 0o777))).toThrow();
  expect(() => trustedNetworkLauncher(file, stats(file, 0o644))).toThrow();
  expect(() => trustedNetworkLauncher(file, stats(file, 0o755, 1000))).toThrow();
  expect(() => trustedNetworkLauncher(file, stats(file, 0o755, 0, true))).toThrow();
  expect(() => trustedNetworkLauncher("launch", stats())).toThrow();
});

test.if(process.platform !== "win32")("the optional namespace launcher precedes runuser for every agent launch", () => {
  const prefix = systemLauncher(
    { id: ANA.id, user: "ag-a1b2c3d4", uid: 21000, networkLauncher: ROOT_TOOL },
    false,
  ).prefix;
  expect(prefix).toEqual([ROOT_TOOL, "21000", "--", "/usr/sbin/runuser", "-u", "ag-a1b2c3d4", "--"]);
});

test("a configured routing mark drops network capabilities even without a namespace hook", () => {
  const user = { id: "a1b2c3d4", user: "ag-a1b2c3d4", uid: 21000, networkMark: 0x08000000 };
  expect(systemLauncher(user, false).prefix).toEqual([
    "/usr/bin/setpriv",
    "--no-new-privs",
    "--bounding-set=-net_admin,-net_raw",
    "--",
    "/usr/sbin/runuser",
    "-u",
    user.user,
    "--",
  ]);
  const scoped = systemLauncher({ ...user, networkLauncher: ROOT_TOOL }, true).prefix;
  expect(scoped.indexOf(ROOT_TOOL)).toBeLessThan(scoped.indexOf("/usr/bin/setpriv"));
  expect(scoped.join("\n")).toContain("mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc");
  expect(scoped.indexOf("/usr/bin/setpriv")).toBeLessThan(scoped.indexOf("/usr/sbin/runuser"));
  expect(systemLauncher({ ...user, networkMark: undefined }, false).prefix[0]).toBe("/usr/sbin/runuser");
});

// ── Rootless containers (ADR 0169) ──────────────────────────────────────────

test("an agent's subordinate ids: the 65536 from its uid, apart from every other agent's block and every real uid", () => {
  expect(SUBIDS).toBe(65536);
  expect(agentSubids(21000)).toEqual([1376256000, 1376321535]);
  // The next agent's block starts right after: none shares an id.
  expect(agentSubids(21001)[0]).toBe(agentSubids(21000)[1] + 1);
  // The lowest agent uid's block lies above every real uid (all below 65536), the highest's below the last id.
  expect(agentSubids(1000)[0]).toBeGreaterThan(65535);
  expect(agentSubids(59999)[1]).toBeLessThan(2 ** 32 - 1);
});

test("ensureSubids: the agent's block once, by name or by uid; files that aren't there are made", () => {
  const etc = tempDir("subids-");
  dirs.push(etc);
  const calls: string[] = [];
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args].join(" "));
    return { code: 0, output: "" };
  };
  const user = { user: "ag-a1b2c3d4", uid: 21000 };
  expect(ensureSubids(user, etc, run)).toBeNull();
  expect(calls).toEqual([
    "usermod --add-subuids 1376256000-1376321535 --add-subgids 1376256000-1376321535 ag-a1b2c3d4",
  ]);
  for (const f of ["subuid", "subgid"]) expect(statSync(path.join(etc, f)).mode & 0o777).toBe(0o644);
  calls.length = 0;
  writeFileSync(path.join(etc, "subuid"), "ag-a1b2c3d4:1376256000:65536\n");
  writeFileSync(path.join(etc, "subgid"), "21000:1376256000:65536\n");
  expect(ensureSubids(user, etc, run)).toBeNull();
  expect(calls).toEqual([]);
  // A usermod that fails says so.
  const failing: RunCommand = () => ({ code: 10, output: "usermod: cannot lock /etc/subuid" });
  expect(ensureSubids({ user: "ag-b2c3d4e5", uid: 21001 }, etc, failing)).toBe(
    "usermod failed (10): usermod: cannot lock /etc/subuid",
  );
});

test("a range anyone else holds over the agent's block leaves it none, never sharing ids; only logged", () => {
  const home = tempDir("agent-users-");
  dirs.push(home);
  const os = fakeOs(undefined, home);
  const lines: string[] = [];
  writeFileSync(path.join(home, "subuid"), "someone:1376300000:100\n");
  const users = new AgentUsers({ home, range: RANGE, run: os.run, etc: home, log: (l) => lines.push(l) });
  expect(users.ensure(ANA)).toEqual({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21000 });
  // useradd's range goes, and no block comes.
  expect(os.calls.at(-1)).toBe("usermod --del-subuids 165536-231071 --del-subgids 165536-231071 ag-a1b2c3d4");
  expect(readFileSync(path.join(home, "subuid"), "utf8")).toBe("someone:1376300000:100\n");
  expect(readFileSync(path.join(home, "subgid"), "utf8")).toBe("");
  expect(lines).toEqual([
    "ag-a1b2c3d4 has no ids for containers: someone holds 1376300000-1376300099, over its 1376256000-1376321535",
  ]);
});

test("rootlessContainers: Podman and both id-map helpers, or none", () => {
  const have = (files: string[]) => (file: string) => files.includes(file);
  expect(rootlessContainers(have(["/usr/bin/podman", "/usr/bin/newuidmap", "/usr/bin/newgidmap"]))).toBe(true);
  expect(rootlessContainers(have(["/usr/bin/podman", "/usr/bin/newuidmap"]))).toBe(false);
  expect(rootlessContainers(have(["/usr/bin/newuidmap", "/usr/bin/newgidmap"]))).toBe(false);
});

test("every launch with containers: its runtime dir bound in its view, Podman's socket, no_new_privs as before", () => {
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003, networkMark: 0x08000000 };
  const l = systemLauncher(user, true, false, true);
  const socket = "unix:///run/user/21003/podman/podman.sock";
  expect(l.env).toMatchObject({ XDG_RUNTIME_DIR: "/run/user/21003", CONTAINER_HOST: socket, DOCKER_HOST: socket });
  const view = (l.prefix[18] ?? "").split("\n");
  expect(view[1]).toBe("/usr/bin/mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc");
  expect(view.slice(-5)).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's own expansion, not JavaScript's.
    "u=${m##*/}",
    'install -d -m 0700 -o "$u" "$m/run"',
    'mkdir -p "/run/user/$u"',
    'mount --bind "$m/run" "/run/user/$u"',
    'exec "$@"',
  ]);
  // Only the containers service goes without it.
  expect(l.prefix).toContain("--no-new-privs");
});

test("the containers service: a delegated unit of the agent's slice, its steps, set-user-ID for the id-map helpers alone", () => {
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003, networkLauncher: ROOT_TOOL, networkMark: 0x08000000 };
  const argv = containersCommand(user, true);
  // No --collect: a unit its start limit stopped stays loaded as failed, which is how the runner tells. Its steps'
  // stderr goes to the journal under one identifier, where the runner reads why.
  expect(argv.slice(0, 15)).toEqual([
    "/usr/bin/systemd-run",
    "--quiet",
    "--expand-environment=no",
    "--unit=agentes-containers-21003.service",
    "--slice=agents-21003.slice",
    "--property=Delegate=yes",
    "--property=Restart=always",
    "--property=RestartSec=5",
    "--property=StartLimitIntervalSec=60",
    "--property=StartLimitBurst=5",
    "--property=OOMPolicy=continue",
    "--property=TimeoutStopSec=15",
    "--property=StandardError=journal",
    "--property=SyslogIdentifier=agentes-containers",
    "--",
  ]);
  // systemd writes an expanded command to the unit's file with each `$` doubled, and runs that after a daemon-reload:
  // a `$$` sent there reaches the shell as its own pid. Unexpanded, the scripts go as they are.
  for (const arg of argv) expect(arg).not.toContain("$$");
  // Before 254 there is no switch: each `$` doubled, which systemd reads as one.
  expect(containersCommand(user, false)).toEqual(
    argv.filter((a) => a !== "--expand-environment=no").map((a) => a.replaceAll("$", () => "$$")),
  );
  const at = argv.indexOf("/usr/bin/unshare");
  const view = argv[at + 7] ?? "";
  expect(view).toContain("hidepid=2");
  expect(view).toContain('mount --bind "$m/run" "/run/user/$u"');
  // Its own cgroup only, made the agent's.
  expect(view).toContain('*/agents-"$u".slice/agentes-containers-"$u".service) ;;');
  expect(view).toContain('chown "$u" "$c" "$c/cgroup.procs" "$c/cgroup.subtree_control" "$c/cgroup.threads"');
  // Every mount nosuid with its options kept, the two helpers set-user-ID again; last, after every bind.
  expect(view).toContain('mount -o "remount,bind,nosuid,$o" "$p"');
  expect(view.trimEnd().split("\n").slice(-2)).toEqual([
    'for f in /usr/bin/newuidmap /usr/bin/newgidmap; do mount --bind "$f" "$f"; mount -o remount,bind,suid "$f"; done',
    'exec "$@"',
  ]);
  // The computer's cgroup2 kept before the network hook, which may mount a /sys without one (`ip netns exec` does).
  expect(view.indexOf('mount --bind /sys/fs/cgroup "$m/cgroup"')).toBeGreaterThan(view.indexOf("chown"));
  expect(view.indexOf('mount --bind /sys/fs/cgroup "$m/cgroup"')).toBeLessThan(view.indexOf("findmnt -rno"));
  // Then its network hook, cgroup2 put back after it, the bounding set without no_new_privs, its user and only its
  // environment.
  expect(argv.slice(at + 8, at + 24)).toEqual([
    "sh",
    "21003",
    ROOT_TOOL,
    "21003",
    "--",
    "/bin/sh",
    "-c",
    'set -e\n[ -e /sys/fs/cgroup/cgroup.controllers ] || mount --bind "$1" /sys/fs/cgroup\nshift\nexec "$@"',
    "sh",
    "/run/agentes-runner-tmp/21003/cgroup",
    "/usr/bin/setpriv",
    "--bounding-set=-net_admin,-net_raw",
    "--",
    "/usr/sbin/runuser",
    "-u",
    "ag-a1b2c3d4",
  ]);
  expect(argv).not.toContain("--no-new-privs");
  expect(argv).toContain("XDG_RUNTIME_DIR=/run/user/21003");
  // It is Podman's own service: never a client of itself.
  expect(argv.some((a) => /^(CONTAINER|DOCKER)_HOST=/.test(a))).toBe(false);
  expect(argv.at(-2)).toContain("compose_warning_logs = false");
  expect(argv.at(-1)).toContain('graphroot = "/home/ag-a1b2c3d4/.local/share/containers/storage"');
  // Its user manager logs to the journal: the console it would use otherwise is root's.
  expect(argv.at(-4)?.split("\n").at(-1)).toBe("exec /usr/lib/systemd/systemd --user --log-target=journal");
  // Without a network hook, /sys stays the computer's: nothing kept, nothing put back.
  const plain = containersCommand({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 }, true);
  expect(plain.join("\n")).not.toContain("/sys/fs/cgroup/cgroup.controllers");
  expect(plain.join("\n")).not.toContain('"$m/cgroup"');
  expect(plain[plain.indexOf("/usr/bin/unshare") + 10]).toBe("/usr/bin/setpriv");
});

test.if(process.platform !== "win32")(
  "the service's start, as the agent: its defaults where it has none, Podman's socket on",
  () => {
    const home = tempDir("containers-home-");
    dirs.push(home);
    const argv = containersCommand({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 }, true);
    const lines = (argv.at(-4) ?? "").split("\n");
    // Its cgroup checked, then its user manager: neither runs here.
    expect(lines.at(-1)).toBe("exec /usr/lib/systemd/systemd --user --log-target=journal");
    const start = [...lines.slice(0, -3), "exit 0"].join("\n");
    const sh = (conf: string) =>
      spawnSync("/bin/sh", ["-c", start, "sh", conf, "storage"], { env: { HOME: home, PATH: "/usr/bin:/bin" } });
    expect(sh("first").status).toBe(0);
    const c = path.join(home, ".config");
    expect(readFileSync(path.join(c, "containers/containers.conf"), "utf8")).toBe("first");
    expect(readFileSync(path.join(c, "containers/storage.conf"), "utf8")).toBe("storage");
    expect(readlinkSync(path.join(c, "systemd/user/sockets.target.wants/podman.socket"))).toBe(
      "/usr/lib/systemd/user/podman.socket",
    );
    expect(readlinkSync(path.join(c, "systemd/user/default.target.wants/podman-restart.service"))).toBe(
      "/usr/lib/systemd/user/podman-restart.service",
    );
    // What the agent changed stays.
    expect(sh("second").status).toBe(0);
    expect(readFileSync(path.join(c, "containers/containers.conf"), "utf8")).toBe("first");
  },
);

test.if(process.platform !== "win32")(
  "the service's start says why its user manager can't run where its view has no cgroup of its own (a hook's /sys)",
  () => {
    const home = tempDir("containers-home-");
    const bin = tempDir("containers-bin-");
    dirs.push(home, bin);
    // What /proc/self/cgroup names, where the view's /sys has no cgroup2 under it.
    writeFileSync(path.join(bin, "sed"), "#!/bin/sh\necho /agents.slice/agents-21003.slice/nowhere.service\n", {
      mode: 0o755,
    });
    const argv = containersCommand({ id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 }, true);
    const r = spawnSync("/bin/sh", ["-c", argv.at(-4) ?? "", "sh", "conf", "storage"], {
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    });
    // A user manager with no cgroup exits 1 and says nothing anywhere its unit's journal shows: this line is what does.
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(
      "its user manager has no cgroup to run in (/sys/fs/cgroup/agents.slice/agents-21003.slice/nowhere.service is not writable)",
    );
  },
);

test("ensureContainers: started when it isn't, left when it runs as it would start, started anew when that changed", () => {
  const calls: string[][] = [];
  let shown = "ActiveState=inactive\nDescription=\n";
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args]);
    return { code: 0, output: file === "systemctl" && args[0] === "show" ? shown : "" };
  };
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 };
  const show = ["systemctl", "show", "--property=ActiveState,Description,Result", "agentes-containers-21003.service"];
  expect(ensureContainers(user, run)).toBeNull();
  expect(calls[0]).toEqual(show);
  const [file, description = "", ...rest] = calls[1] ?? [];
  expect(file).toBe("/usr/bin/systemd-run");
  expect(description).toMatch(/^--description=agentes\.chat containers [0-9a-f]{16}$/);
  expect(rest).toEqual(containersCommand(user).slice(1));
  shown = `ActiveState=active\nDescription=${description.slice("--description=".length)}\n`;
  calls.length = 0;
  expect(ensureContainers(user, run)).toBeNull();
  expect(calls).toEqual([show]);
  // In a namespace now: what runs there stops, and it starts again through the network hook.
  calls.length = 0;
  expect(ensureContainers({ ...user, networkLauncher: ROOT_TOOL }, run)).toBeNull();
  expect(calls[1]).toEqual(["systemctl", "stop", "agentes-containers-21003.service"]);
  expect(calls[2]?.[1]).not.toBe(description);
  expect(calls[2]).toContain(ROOT_TOOL);
  const refused: RunCommand = (f) =>
    f === "systemctl" ? { code: 0, output: "ActiveState=inactive\n" } : { code: 1, output: "Unit was already loaded" };
  expect(ensureContainers(user, refused)).toBe("/usr/bin/systemd-run failed (1): Unit was already loaded");
  calls.length = 0;
  stopContainers(21003, run);
  expect(calls).toEqual([["systemctl", "stop", "--no-block", "agentes-containers-21003.service"]]);
});

test("ensureContainers: one its start limit stopped stays down for the same command, with the reason its journal has", () => {
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 };
  const calls: string[][] = [];
  let shown = "";
  let journal = "network hook: no namespace for agent 21003\n";
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args]);
    if (file === "systemctl" && args[0] === "show") return { code: 0, output: shown };
    return { code: 0, output: file === "journalctl" ? journal : "" };
  };
  // Its description as the runner starts it.
  expect(ensureContainers(user, run)).toBeNull();
  const description = (calls[1]?.[1] ?? "").slice("--description=".length);
  // Systemd stopped restarting it: the last failure's result stays, not start-limit-hit.
  shown = `ActiveState=failed\nDescription=${description}\nResult=exit-code\n`;
  calls.length = 0;
  expect(ensureContainers(user, run)).toBe("network hook: no namespace for agent 21003");
  expect(calls.slice(1)).toEqual([
    [
      "journalctl",
      "--no-pager",
      "--output=cat",
      "--lines=1",
      "_SYSTEMD_UNIT=agentes-containers-21003.service",
      "SYSLOG_IDENTIFIER=agentes-containers",
      "+",
      "_UID=21003",
      "SYSLOG_IDENTIFIER=systemd",
    ],
  ]);
  journal = "";
  expect(ensureContainers(user, run)).toBe("its service failed at every start (exit-code)");
  // A stop that timed out says nothing about its next start; a changed command gets its own tries.
  for (const failed of [
    `ActiveState=failed\nDescription=${description}\nResult=timeout\n`,
    "ActiveState=failed\nDescription=agentes.chat containers 0000000000000000\nResult=exit-code\n",
  ]) {
    shown = failed;
    calls.length = 0;
    expect(ensureContainers(user, run)).toBeNull();
    expect(calls.slice(1).map((c) => c.slice(0, 2))).toEqual([
      ["systemctl", "reset-failed"],
      ["/usr/bin/systemd-run", `--description=${description}`],
    ]);
  }
});

test("keepContainers: none for an agent whose brain's shell has a sandbox of its own, its service stopped (ADR 0169)", () => {
  const calls: string[][] = [];
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args]);
    return { code: 0, output: file === "systemctl" && args[0] === "show" ? "ActiveState=active\nDescription=\n" : "" };
  };
  const user = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21003 };
  expect(keepContainers(user, false, run)).toBeNull();
  expect(calls).toEqual([["systemctl", "stop", "--no-block", "agentes-containers-21003.service"]]);
  calls.length = 0;
  expect(keepContainers(user, true, run)).toBeNull();
  expect(calls.map((c) => c.slice(0, 2))).toEqual([
    ["systemctl", "show"],
    ["systemctl", "stop"],
    ["/usr/bin/systemd-run", expect.stringMatching(/^--description=/)],
  ]);
});

// ── A Claude login for several agents: the sign-in's own user ────────────────

const ADA_LOGIN = "0193aaaa-0000-7000-8000-000000000001";
const LIA_LOGIN = "0193bbbb-0000-7000-8000-000000000002";
const AUTH_GID = 997;

function accountSetup(users?: OsUser[]) {
  const home = tempDir("account-users-");
  dirs.push(home);
  const root = path.join(home, "stores");
  const os = fakeOs(users);
  const run: RunCommand = (file, args) =>
    file === "getent" && args[0] === "group"
      ? { code: 0, output: `agentes-auth:x:${AUTH_GID}:` }
      : file === "id"
        ? { code: 0, output: "21042" }
        : os.run(file, args);
  return { home, root, os, accounts: new AccountUsers({ home, root, bridges: "/run/test-bridges", run, etc: home }) };
}

test("a sign-in's user: outside the agents' range, the auth group only, no shell, listed, and no cron or at", () => {
  const { home, root, os, accounts } = accountSetup([
    { name: "root", uid: 0, comment: "root" },
    { name: "someone", uid: 30000, comment: "" },
  ]);
  // A uid an agent has, or one a removed sign-in had, is never handed out.
  writeFileSync(path.join(home, AGENT_USERS_FILE), JSON.stringify([{ id: "x", user: "ag-xxxxxxxx", uid: 30001 }]));
  writeFileSync(
    path.join(home, ACCOUNT_USERS_FILE),
    JSON.stringify([{ id: LIA_LOGIN, user: "agc-0193bbbb", uid: 30002 }]),
  );

  const user = accounts.ensure(ADA_LOGIN);
  expect(user).toEqual({ id: ADA_LOGIN, user: "agc-0193aaaa", uid: 30003, gid: AUTH_GID });
  const store = path.join(root, ADA_LOGIN);
  expect(os.calls).toEqual([
    "getent passwd",
    `useradd --system --uid 30003 --gid agentes-auth --no-create-home --home-dir ${store} --shell /usr/sbin/nologin agc-0193aaaa`,
    `install -d -m 0711 -o 0 -g 0 ${root}`,
    `install -d -m 0711 -o 0 -g 0 ${store}`,
    `install -d -m 0711 -o 0 -g 0 ${store}/run`,
    `install -d -m 0711 -o 0 -g 0 ${store}/cwd`,
    `install -d -m 0700 -o 30003 -g ${AUTH_GID} ${store}/config`,
  ]);
  expect(readFileSync(path.join(home, "cron.deny"), "utf8")).toBe("agc-0193aaaa\n");
  expect(readAccountUsers(home).map((r) => r.uid)).toEqual([30002, 30003]);

  const made = os.calls.length;
  expect(accounts.ensure(ADA_LOGIN)).toEqual(user);
  expect(os.calls).toHaveLength(made);
});

test("a sign-in's user: an older runner's is taken back, anything else with its name is refused", async () => {
  const left = accountSetup([{ name: "agc-0193aaaa", uid: 30007, comment: "" }]);
  expect(left.accounts.ensure(ADA_LOGIN).uid).toBe(30007);
  expect(left.os.calls.join("\n")).not.toContain("useradd");

  const other = accountSetup([{ name: "agc-0193aaaa", uid: 1000, comment: "" }]);
  expect(await errorCode(() => other.accounts.ensure(ADA_LOGIN))).toBe("internal");
  expect(await errorCode(() => other.accounts.ensure("../../etc"))).toBe("bad_request");
});

test("agents never get the uid of a sign-in that is gone", () => {
  const { home, os } = setup();
  writeFileSync(
    path.join(home, ACCOUNT_USERS_FILE),
    JSON.stringify([{ id: ADA_LOGIN, user: "agc-0193aaaa", uid: 21000 }]),
  );
  const users = new AgentUsers({ home, range: RANGE, run: os.run, etc: home });
  expect(users.ensure(ANA).uid).toBe(21001);
});

test("a room: root writes, the sign-in's user only reads through an ACL (its group is every sign-in's), once", () => {
  const { root, os, accounts } = accountSetup();
  const user = accounts.ensure(ADA_LOGIN);
  os.calls.length = 0;
  accounts.room(user, 21000);
  accounts.room(user, 21000);
  const store = path.join(root, ADA_LOGIN);
  expect(os.calls).toEqual([
    `install -d -m 0750 -o 0 -g 0 ${store}/run/21000`,
    `setfacl -m u:30000:rx,d:u:30000:rx ${store}/run/21000`,
    `install -d -m 0700 -o 30000 -g ${AUTH_GID} ${store}/run/21000/home`,
    `install -d -m 0700 -o 30000 -g ${AUTH_GID} ${store}/cwd/21000`,
  ]);
});

test("the relay's folder: the agent's, entered by the sign-in's user; root touches nothing inside it", () => {
  const { accounts, os } = accountSetup();
  const user = accounts.ensure(ADA_LOGIN);
  os.calls.length = 0;
  const agent = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21000 };
  expect(accounts.bridge(user, agent)).toBe("/run/test-bridges/21000/mcp.sock");
  expect(accounts.bridge(user, agent)).toBe("/run/test-bridges/21000/mcp.sock");
  expect(os.calls).toEqual([
    "install -d -m 0711 -o 0 -g 0 /run/test-bridges",
    "install -d -m 0700 -o 21000 -g 21042 /run/test-bridges/21000",
    "setfacl -m u:30000:x /run/test-bridges/21000",
  ]);
});

const AGC = { id: ADA_LOGIN, user: "agc-0193aaaa", uid: 30000, gid: AUTH_GID };
const AGENT = { id: ANA.id, user: "ag-a1b2c3d4", uid: 21000 };
const CWD = "/home/ag-a1b2c3d4/ana-a1b2c3d4";

test("the account launcher: the agent's cli slice, the view, its network hook, then the sign-in's user", () => {
  const { prefix, env, home } = accountLauncher(AGC, { ...AGENT, networkLauncher: ROOT_TOOL }, CWD);
  const c = prefix.indexOf("-c");
  const unit = prefix[4] as string;
  expect(unit).toMatch(/^--unit=agentes-account-21000-[0-9a-f]{8}$/);
  expect(prefix.slice(0, c + 1).filter((a) => a !== unit)).toEqual([
    "/usr/bin/systemd-run",
    "--quiet",
    "--scope",
    "--collect",
    `--slice=${agentCategorySlice(21000, "cli")}`,
    "--",
    "/usr/bin/unshare",
    "--mount",
    "--propagation",
    "slave",
    "--",
    "/bin/sh",
    "-c",
  ]);
  expect(prefix.slice(c + 2)).toEqual([
    "sh",
    ADA_LOGIN,
    "21000",
    CWD,
    ROOT_TOOL,
    "21000",
    "--",
    "/usr/bin/setpriv",
    "--no-new-privs",
    "--bounding-set=-net_admin,-net_raw",
    "--",
    "/usr/bin/setpriv",
    "--reuid=30000",
    `--regid=${AUTH_GID}`,
    "--clear-groups",
    "--",
  ]);
  // A scope has no exec settings: systemd-run would refuse the property and no CLI would ever start.
  expect(prefix.join(" ")).not.toContain("LimitCORE");
  expect(prefix[c + 1]).toContain("ulimit -c 0");
  const store = `/var/lib/agentes-claude/${ADA_LOGIN}`;
  expect(home).toBe(`${store}/run/21000`);
  expect(env).toEqual({
    HOME: `${store}/run/21000/home`,
    USER: "agc-0193aaaa",
    LOGNAME: "agc-0193aaaa",
    SHELL: "/bin/bash",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    TMPDIR: "/tmp",
    CLAUDE_CONFIG_DIR: `${store}/config`,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
    DISABLE_AUTOUPDATER: "1",
  });
});

test("the account launcher for no agent: its own probe room, no slice, no network hook, no cwd of an agent", () => {
  const { prefix, home } = accountLauncher(AGC, null);
  expect(prefix.join(" ")).not.toContain("--slice");
  expect(prefix[4]).toMatch(/^--unit=agentes-account-probe-/);
  expect(prefix.slice(prefix.indexOf("sh"), prefix.indexOf("sh") + 4)).toEqual(["sh", ADA_LOGIN, "probe", ""]);
  expect(home).toEndWith("/run/probe");
});

test("root builds a cwd only inside what it masks, under the agent's home or a grant, as a plain path", async () => {
  expect(accountCwd(CWD, AGENT)).toBe(CWD);
  expect(accountCwd("/srv/agentes/shared/app", AGENT, ["/srv/agentes/shared"])).toBe("/srv/agentes/shared/app");
  for (const bad of [
    "relative/path",
    "/home/ag-a1b2c3d4/../ag-b2c3d4e5",
    "/home/ag-a1b2c3d4/a/",
    "/home/ag-b2c3d4e5/theirs",
    "/srv/agentes/shared/app",
    "/var/lib/agentes-claude/x",
    "",
  ]) {
    expect(await errorCode(() => accountCwd(bad, AGENT))).toBe("not_allowed");
  }
  // A grant outside the masks would have root mkdir and mount on the real path.
  expect(await errorCode(() => accountCwd("/opt/app", AGENT, ["/opt"]))).toBe("not_allowed");
  expect(await errorCode(() => accountLauncher(AGC, AGENT, "/etc"))).toBe("not_allowed");
});

test.if(process.platform !== "win32")(
  "the view: staged before the masks, every agent root masked, only this sign-in's folders back, the cwd last",
  () => {
    const { prefix } = accountLauncher(AGC, AGENT, CWD);
    const script = prefix[prefix.indexOf("-c") + 1] as string;
    const stubs = [
      'say() { echo "$*"; }',
      'mount() { say mount "$@"; }',
      'umount() { say umount "$@"; }',
      'mkdir() { say mkdir "$@"; }',
      'rmdir() { say rmdir "$@"; }',
      'cd() { say cd "$@"; }',
      "stat() { echo 1777; }",
      // Every root exists, as on a real computer.
      "test() { return 0; }",
    ].join("\n");
    const body = script.replace('[ -d "$m" ]', "test");
    const r = spawnSync("/bin/sh", ["-c", `${stubs}\n${body}`, "sh", ADA_LOGIN, "21000", CWD, "/bin/echo", "ran"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const a = `/var/lib/agentes-claude/${ADA_LOGIN}`;
    const tmp = (at: string) =>
      `mount -t tmpfs -o mode=1777,nosuid,nodev,size=50%,nr_inodes=1m agentes-account-tmp ${at}`;
    const mask = (at: string) => `mount -t tmpfs -o mode=0755,nosuid,nodev,size=1m agentes-account-view ${at}`;
    expect(r.stdout.trim().split("\n")).toEqual([
      tmp("/tmp"),
      tmp("/var/tmp"),
      tmp("/dev/shm"),
      tmp("/run/lock"),
      "mkdir /tmp/.a",
      `mount --bind ${a} /tmp/.a`,
      mask("/home"),
      mask("/srv/agentes"),
      mask("/var/lib/agentes-runner-agents"),
      mask("/var/cache/agentes-git"),
      mask("/var/lib/agentes-claude"),
      `mkdir -p ${a}/config ${a}/run/21000`,
      `mount --bind /tmp/.a/config ${a}/config`,
      `mount --bind /tmp/.a/run/21000 ${a}/run/21000`,
      `mkdir -p ${CWD}`,
      `mount --bind /tmp/.a/cwd/21000 ${CWD}`,
      "umount /tmp/.a",
      "rmdir /tmp/.a",
      `cd ${CWD}`,
      "ran",
    ]);
  },
);

test("removing a sign-in: its processes, store and user go, its uid stays taken", () => {
  const { home, root, os, accounts } = accountSetup();
  const { uid } = accounts.ensure(ADA_LOGIN);
  const store = path.join(root, ADA_LOGIN);
  mkdirSync(path.join(store, "config"), { recursive: true });
  os.calls.length = 0;
  accounts.remove(ADA_LOGIN);
  expect(os.calls).toEqual([`pkill -KILL -U ${uid}`, "userdel --force agc-0193aaaa"]);
  expect(existsSync(store)).toBe(false);
  expect(readAccountUsers(home).map((r) => r.uid)).toEqual([uid]);
  // The fake keeps the name in passwd: the row alone says which uid is this sign-in's.
  expect(accounts.ensure(ADA_LOGIN).uid).toBe(uid);
  expect(accounts.ensure(LIA_LOGIN).uid).toBe(uid + 1);
});

test("the runner's start ends what its sign-ins' users left running; scopes stop only where there are sign-ins", () => {
  const { os, accounts } = accountSetup();
  accounts.sweep();
  accounts.stopScopes(21000);
  expect(os.calls).toEqual([]);
  const a = accounts.ensure(ADA_LOGIN);
  const b = accounts.ensure(LIA_LOGIN);
  os.calls.length = 0;
  accounts.sweep();
  accounts.stopScopes(21000);
  expect(os.calls).toEqual([
    `pkill -KILL -U ${a.uid}`,
    `pkill -KILL -U ${b.uid}`,
    "systemctl stop --no-block agentes-account-21000-*.scope",
  ]);
  const calls: string[] = [];
  stopAccountScopes(21001, (file, args) => {
    calls.push([file, ...args].join(" "));
    return { code: 0, output: "" };
  });
  expect(calls).toEqual(["systemctl stop --no-block agentes-account-21001-*.scope"]);
});

test("an agent that left: its rooms and transcripts go from every sign-in, a shared path's stay", () => {
  const { root, accounts } = accountSetup();
  const stores = [ADA_LOGIN, LIA_LOGIN].map((id) => {
    accounts.ensure(id);
    return path.join(root, id);
  });
  const projects = [
    "-home-ag-a1b2c3d4",
    "-home-ag-a1b2c3d4-ana-a1b2c3d4",
    "-var-lib-agentes-runner-agents-ag-a1b2c3d4",
    "-home-ag-b2c3d4e5-bia-b2c3d4e5",
    "-home-ag-a1b2c3d4x",
    "-srv-agentes-shared-app",
  ];
  for (const store of stores) {
    for (const dir of ["cwd/21000", "run/21000/1", "cwd/21001", ...projects.map((p) => `config/projects/${p}`)]) {
      mkdirSync(path.join(store, dir), { recursive: true });
    }
  }
  accounts.sweepAgent(AGENT);
  for (const store of stores) {
    expect(existsSync(path.join(store, "cwd/21000"))).toBe(false);
    expect(existsSync(path.join(store, "run/21000"))).toBe(false);
    expect(existsSync(path.join(store, "cwd/21001"))).toBe(true);
    expect(projects.filter((p) => existsSync(path.join(store, "config/projects", p)))).toEqual([
      "-home-ag-b2c3d4e5-bia-b2c3d4e5",
      "-home-ag-a1b2c3d4x",
      "-srv-agentes-shared-app",
    ]);
  }
});

test("a session moves to another folder's project as the sign-in's user, following no link", () => {
  const calls: string[][] = [];
  const accounts = new AccountUsers({
    home: "/nowhere",
    root: "/nowhere",
    run: (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, output: "" };
    },
  });
  accounts.carry(AGC, "/s/config/projects/a/x.jsonl", "/s/config/projects/b/x.jsonl");
  expect(calls).toHaveLength(1);
  const call = calls[0] as string[];
  expect(call.slice(0, 5)).toEqual([
    "/usr/bin/setpriv",
    "--reuid=30000",
    `--regid=${AUTH_GID}`,
    "--clear-groups",
    "--",
  ]);
  expect(call[7]).toContain("--no-dereference");
  expect(call.slice(8)).toEqual([
    "sh",
    "/s/config/projects/b",
    "/s/config/projects/a/x.jsonl",
    "/s/config/projects/b/x.jsonl",
  ]);
});

// ── The self-check ────────────────────────────────────────────────────────────

const FAKE_CLAUDE = path.join(import.meta.dir, "fake-claude.mjs");
const SWITCH = { refresh: "A" as const };
const rootOwned = (() => ({
  uid: 0,
  mode: 0o755,
  isSymbolicLink: () => false,
  isFile: () => true,
  isDirectory: () => true,
})) as unknown as NonNullable<SelfCheck["stat"]>;

function selfCheck(over: Partial<SelfCheck> = {}, os: Partial<Record<string, { code: number; output: string }>> = {}) {
  const home = tempDir("account-check-");
  dirs.push(home);
  const launched: (string | null | undefined)[] = [];
  const calls: string[] = [];
  const run: RunCommand = (file, args) => {
    calls.push([file, ...args].join(" "));
    if (args.includes("--version")) return os.version ?? { code: 0, output: "2.1.310 (Claude Code)" };
    if (file === "pgrep") return os.pgrep ?? { code: 0, output: "4242" };
    if (file === "/usr/bin/setpriv") return os.setpriv ?? { code: 0, output: "" };
    if (file === "nft") return os.nft ?? { code: 0, output: '{"nftables":[{"counter":{"bytes":5}}]}' };
    return { code: 1, output: "" };
  };
  const rooms: number[] = [];
  const check: SelfCheck = {
    config: { mode: "system", claudeSharedLogin: SWITCH, server: "https://app.example.com" },
    users: {
      ensure: (id) => ({ id, user: "agc-00000000", uid: 30000, gid: AUTH_GID }),
      room: (_u, room) => void rooms.push(room as number),
    },
    home,
    relay: [process.execPath],
    cli: ["/usr/bin/env", process.execPath, FAKE_CLAUDE],
    systemd: true,
    run,
    stat: rootOwned,
    launcher: (_a, agent, cwd) => {
      launched.push(cwd);
      return {
        prefix: agent?.networkLauncher ? ["/usr/bin/env", "ROUTED=1"] : [],
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.FAKE_CLAUDE_EXTRA_TOOL ? { FAKE_CLAUDE_EXTRA_TOOL: process.env.FAKE_CLAUDE_EXTRA_TOOL } : {}),
        },
        home,
      };
    },
    ...over,
  };
  return { check, calls, launched, rooms, home };
}

test.if(process.platform !== "win32")(
  "the self-check passes only with every barrier tried: the CLI, its tools, and an agent's user refused",
  async () => {
    const { check, calls, launched, rooms } = selfCheck();
    expect(await accountSelfCheck(check)).toBeNull();
    expect(rooms).toEqual([30999]);
    expect(launched).toEqual(["/home/ag-00000000/probe"]);
    const agent = calls.find((c) => c.startsWith("/usr/bin/setpriv")) ?? "";
    expect(agent).toContain("--reuid=30999 --regid=30999 --clear-groups --");
    expect(agent).toEndWith(" sh /var/lib/agentes-claude/00000000-0000-4000-8000-000000000000 4242");
  },
);

test.if(process.platform !== "win32")("what the agent's user tries counts only when the kernel refused it", () => {
  const denied = "ls: cannot open directory: Permission denied";
  const hidden = "cat: /proc/1/environ: No such file or directory";
  const answers = (o: { ls?: string; proc?: string; kill?: string }) => {
    const said = (text: string | undefined, fallback: string) => `echo "${text ?? fallback}" >&2; return 1`;
    const stubs = `ls() { ${said(o.ls, denied)}; }; cat() { ${said(o.proc, hidden)}; }; head() { ${said(o.proc, hidden)}; }; kill() { ${said(o.kill, "kill: Operation not permitted")}; }`;
    return Bun.spawnSync(["/bin/sh", "-c", `${stubs}\n${REFUSED}`, "sh", "/store", "1"]).exitCode;
  };
  expect(answers({})).toBe(0);
  expect(answers({ proc: "cat: /proc/1/environ: Permission denied" })).toBe(0);
  expect(answers({ kill: "kill: No such process" })).not.toBe(0);
  expect(answers({ ls: "ls: cannot access: No such file or directory" })).not.toBe(0);
  expect(answers({ proc: "cat: read error: Input/output error" })).not.toBe(0);
});

test("the self-check says why: off, no systemd, an untrusted path", async () => {
  const off = selfCheck();
  off.check.config = { mode: "system" };
  expect(await accountSelfCheck(off.check)).toContain("off");
  const noLock = selfCheck();
  noLock.check.config = { ...noLock.check.config, claudeSharedLogin: { ...SWITCH, refresh: "B" } };
  expect(await accountSelfCheck(noLock.check)).toContain("refreshLock");
  expect(await accountSelfCheck(selfCheck({ systemd: false }).check)).toContain("systemd");
  const writable = (() => ({ ...(rootOwned as unknown as () => object)(), mode: 0o777 })) as unknown;
  expect(await accountSelfCheck(selfCheck({ stat: writable as SelfCheck["stat"] }).check)).toContain("Claude CLI");
});

test.if(process.platform !== "win32")(
  "the self-check takes any Claude CLI version, and a failure names the one installed",
  async () => {
    for (const output of ["2.1.299 (Claude Code)", "9.0.0 (Claude Code)", ""]) {
      expect(await accountSelfCheck(selfCheck({}, { version: { code: 0, output } }).check)).toBeNull();
    }
    expect(await accountSelfCheck(selfCheck({}, { version: { code: 127, output: "" } }).check)).toBeNull();
    const failed = selfCheck(
      {},
      { pgrep: { code: 1, output: "" }, version: { code: 0, output: "9.0.0 (Claude Code)" } },
    );
    expect(await accountSelfCheck(failed.check)).toBe("The Claude CLI's process wasn't found (Claude CLI 9.0.0)");
    const silent = selfCheck({}, { pgrep: { code: 1, output: "" }, version: { code: 127, output: "" } });
    expect(await accountSelfCheck(silent.check)).toBe("The Claude CLI's process wasn't found");
  },
);

test.if(process.platform !== "win32")(
  "the self-check holds the relay's script to what it holds its runtime",
  async () => {
    const script = realpathSync(FAKE_CLAUDE);
    const withScript = (info: object) =>
      selfCheck({
        relay: [process.execPath, script],
        stat: ((file: string) =>
          file === script
            ? { ...(rootOwned as unknown as () => object)(), ...info }
            : rootOwned(file)) as SelfCheck["stat"],
      }).check;
    expect(await accountSelfCheck(withScript({ mode: 0o644 }))).toBeNull();
    expect(await accountSelfCheck(withScript({ uid: 1000, mode: 0o644 }))).toContain("runner");
    expect(await accountSelfCheck(withScript({ mode: 0o664 }))).toContain("runner");
    const noExec = selfCheck({
      stat: ((file: string) =>
        file === realpathSync(process.execPath)
          ? { ...(rootOwned as unknown as () => object)(), mode: 0o644 }
          : rootOwned(file)) as SelfCheck["stat"],
    });
    expect(await accountSelfCheck(noExec.check)).toContain("runner");
  },
);

test.if(process.platform !== "win32")(
  "the self-check fails on a built-in tool the CLI keeps, a process it can't find, or an agent that reached anything",
  async () => {
    process.env.FAKE_CLAUDE_EXTRA_TOOL = "Bash";
    try {
      expect(await accountSelfCheck(selfCheck().check)).toContain("Bash");
    } finally {
      delete process.env.FAKE_CLAUDE_EXTRA_TOOL;
    }
    expect(await accountSelfCheck(selfCheck({}, { pgrep: { code: 1, output: "" } }).check)).toContain("process");
    expect(await accountSelfCheck(selfCheck({}, { setpriv: { code: 1, output: "" } }).check)).toContain("reached");
    const dead = selfCheck({ launcher: () => ({ prefix: ["/usr/bin/false"], env: {}, home: "/" }) });
    expect(await accountSelfCheck(dead.check)).toContain("didn't start");
  },
);

test.if(process.platform !== "win32")(
  "the agent's probe counts only a refusal: a path that is there, or isn't, is no pass",
  async () => {
    const store = tempDir("account-store-");
    dirs.push(store);
    mkdirSync(path.join(store, "config"));
    let code = -1;
    const { check } = selfCheck();
    const real = check.run as RunCommand;
    check.run = (file, args) => {
      if (file !== "/usr/bin/setpriv") return real(file, args);
      const sh = args.slice(args.indexOf("--") + 1);
      code = spawnSync(sh[0] as string, [...sh.slice(1, -2), store, "1"]).status ?? -1;
      return { code, output: "" };
    };
    expect(await accountSelfCheck(check)).toContain("reached");
    expect(code).not.toBe(0);
  },
);

test.if(process.platform !== "win32")(
  "the self-check with a network hook: the auth route, a real agent's route, and no byte outside the relay",
  async () => {
    const network = { networkLauncher: ROOT_TOOL, networkRevision: 2, networkAuthRoute: true as const };
    const config = { mode: "system" as const, claudeSharedLogin: SWITCH, server: "https://app.example.com" };
    const older = selfCheck();
    older.check.config = { ...config, ...network, networkAuthRoute: undefined };
    expect(await accountSelfCheck(older.check)).toContain("don't route");

    const empty = selfCheck();
    empty.check.config = { ...config, ...network };
    expect(await accountSelfCheck(empty.check)).toContain("No agent");

    const ran: string[][] = [];
    const routed = selfCheck({
      exec: async (argv) => {
        ran.push(argv);
        return true;
      },
    });
    routed.check.config = { ...config, ...network };
    writeFileSync(path.join(routed.home, AGENT_USERS_FILE), JSON.stringify([AGENT]));
    expect(await accountSelfCheck(routed.check)).toBeNull();
    expect(routed.rooms).toEqual([30999, 21000]);
    expect(routed.launched).toEqual(["/home/ag-00000000/probe", "/home/ag-a1b2c3d4/probe"]);
    expect(ran[0]?.slice(0, 3)).toEqual(["/usr/bin/env", "ROUTED=1", "/usr/bin/curl"]);
    expect(ran[0]?.at(-1)).toBe("https://app.example.com/api/machines/ip");

    const blocked = selfCheck({ exec: async () => false });
    blocked.check.config = { ...config, ...network };
    writeFileSync(path.join(blocked.home, AGENT_USERS_FILE), JSON.stringify([AGENT]));
    expect(await accountSelfCheck(blocked.check)).toContain("no way out");

    let bytes = 0;
    const leaked = selfCheck({
      exec: async () => {
        bytes = 100;
        return true;
      },
    });
    const real = leaked.check.run as RunCommand;
    leaked.check.run = (file, args) =>
      file === "nft" ? { code: 0, output: `{"nftables":[{"counter":{"bytes":${bytes}}}]}` } : real(file, args);
    leaked.check.config = { ...config, ...network };
    writeFileSync(path.join(leaked.home, AGENT_USERS_FILE), JSON.stringify([AGENT]));
    expect(await accountSelfCheck(leaked.check)).toContain("outside the relay");
  },
);
