import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { AGENT_WORKER_HOMES } from "@agenteschat/adapters/command-policy";
import { type AgentScope, isAccountId } from "@agenteschat/adapters/machine-protocol";
import { isAgentUid } from "./config";
import { RunnerError } from "./errors";
import { readJson, writeJson } from "./json-file";
import { validateNetworkMark } from "./network-mark";
import { agentId8 } from "./paths";
import {
  AGENT_RAM_ROOT,
  AGENT_TMP_ROOT,
  agentCategorySlice,
  agentSlice,
  agentTmp,
  installedSystemd,
  type RunCommand,
  runSync,
  scopeOomPolicy,
  systemdBooted,
} from "./service";
import { joinShared, SHARED_BIN_ENV, SHARED_LINK, SHARED_ROOT, type SharedSpec } from "./shared-folder";

/**
 * System mode: every agent works as its own OS user, `ag-<first 8 of its id>`,
 * made on the agent's first request with the lowest free uid in the
 * computer's range. `<runner home>/agents.json` lists them as
 * `[{ id, user, uid }]`. Firewall rules and per-agent counters on the computer
 * key on those uids, so a uid listed there never goes to another agent, even
 * once its user is gone. Users are never removed here: wiping the computer does that.
 */
export const AGENT_USERS_FILE = "agents.json";

export interface AgentUser {
  id: string;
  user: string;
  uid: number;
  /** Supplied only by the root daemon, never persisted in the agent list. */
  networkLauncher?: string;
  /** Root-only routing configuration: also prevents acquiring network capabilities through file caps. */
  networkMark?: number;
  networkRevision?: number;
}

/** How root runs a command as an agent: `prefix` before the command, exactly `env`, in `home`. */
export interface Launcher {
  prefix: string[];
  /** The command's whole environment; callers add what it needs (DISPLAY, TERM…). */
  env: Record<string, string>;
  /** The agent's home (its worker makes the agent's folder inside it, as everywhere: `<handle>-<id8>`). */
  home: string;
  /** Where the agent's own /tmp is on the computer, when it has one (under systemd). */
  tmp?: string;
}

/**
 * Runs as root on the computer, before the agent's own mount namespace (`$1` its uid): the agent's tmpfs, so its
 * /tmp, /dev/shm and /run/lock are in memory as the computer's are, each with its own room. Mounted at its first
 * launch after the computer starts, under a lock: two first launches at once would stack two mounts.
 */
const AGENT_RAM = [
  "set -e",
  `r=${AGENT_RAM_ROOT}`,
  'mkdir -p "$r"',
  'chmod 0700 "$r"',
  'd="$r/$1"',
  "shift",
  'mkdir -p "$d"',
  `flock "$r/.lock" sh -c 'mountpoint -q "$1" || mount -t tmpfs -o mode=0700,size=50%,nr_inodes=1m agentes-runner-tmp "$1"' sh "$d"`,
  'exec "$@"',
].join("\n");

/**
 * Runs as root in the agent's new mount namespace, before it becomes the agent (`$1` its uid): its own temporary
 * folders over the shared ones, so nothing another agent leaves there (a Postgres socket on trust, a name it
 * squats) is in its reach. They live under folders only root reaches, so no agent can swap them; in the agent's
 * own /tmp only `mkdir` runs, never `chmod`, since the agent may have put a link there. Every launch of the agent
 * binds the same folders, so its processes see one /tmp.
 */
const PRIVATE_TMP_STEPS = [
  "set -e",
  `m=${AGENT_RAM_ROOT}/$1`,
  `r=${AGENT_TMP_ROOT}`,
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
];
const PRIVATE_TMP = [...PRIVATE_TMP_STEPS, 'exec "$@"'].join("\n");

/**
 * Rootless containers for the agents (ADR 0169): Podman, and the set-user-ID helpers that map an agent's own ids
 * into its user namespaces. Where they are, each agent has a containers service (`containersCommand`), and every
 * launch of it a runtime dir and Podman's socket.
 */
const ID_MAP_HELPERS = ["/usr/bin/newuidmap", "/usr/bin/newgidmap"];
const CONTAINER_TOOLS = ["/usr/bin/podman", ...ID_MAP_HELPERS];
export const rootlessContainers = (exists: (file: string) => boolean = existsSync) =>
  CONTAINER_TOOLS.every((file) => exists(file));
/** The agent's `XDG_RUNTIME_DIR` as it sees it: `run/` in its tmpfs, cleared at every boot and never aged. */
export const agentRuntimeDir = (uid: number) => `/run/user/${uid}`;
export const containersUnit = (uid: number) => `agentes-containers-${uid}.service`;
const podmanSocket = (uid: number) => `unix://${agentRuntimeDir(uid)}/podman/podman.sock`;

/** Root, in the agent's namespace before it becomes the agent (`$m` its tmpfs): its runtime dir where XDG puts it. */
const RUNTIME_DIR = [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's own expansion, not JavaScript's.
  "u=${m##*/}",
  'install -d -m 0700 -o "$u" "$m/run"',
  'mkdir -p "/run/user/$u"',
  'mount --bind "$m/run" "/run/user/$u"',
];

/** Root, in the containers service: its unit's cgroup becomes the agent's to divide (Delegate=yes, as user@ does). */
const DELEGATE = [
  'c=/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)',
  'case $c in */agents-"$u".slice/agentes-containers-"$u".service) ;; *) echo "not its containers service: $c" >&2; exit 1 ;; esac',
  'chown "$u" "$c" "$c/cgroup.procs" "$c/cgroup.subtree_control" "$c/cgroup.threads"',
];

/**
 * Root, in the containers service, before a network hook: the computer's cgroup2 kept in the agent's tmpfs (`$m`,
 * root's alone). A hook that enters its namespace through `ip netns exec` mounts a fresh /sys with no cgroup2 under it,
 * where the agent's user manager can't start ("Cannot determine cgroup we are running in"), so `CGROUP_BACK` binds this
 * one there again. A bind, never a new cgroup2 mount: one from the init cgroup namespace would set the hierarchy's root
 * flags (nsdelegate, memory_recursiveprot) for the whole computer from its own options.
 */
const CGROUP_KEPT = ['mkdir -p "$m/cgroup"', 'mount --bind /sys/fs/cgroup "$m/cgroup"'];
const keptCgroup = (uid: number) => `${AGENT_RAM_ROOT}/${uid}/cgroup`;
/** Root, after the network hook (`$1` the kept cgroup2): put back where the hook's /sys has none. */
const CGROUP_BACK = [
  "set -e",
  '[ -e /sys/fs/cgroup/cgroup.controllers ] || mount --bind "$1" /sys/fs/cgroup',
  "shift",
  'exec "$@"',
].join("\n");

/**
 * Root, in the containers service, last: every mount nosuid but the two id-map helpers. The service runs without
 * no_new_privs, which would void their set-user-ID, so this is what keeps every other set-user-ID program from its
 * processes. The options a mount has are given back with nosuid, since a remount with util-linux's older mount(2)
 * path would reset them. A mount it can't remount (an autofs point) stays as it is.
 */
const NOSUID_VIEW = [
  'command -v findmnt >/dev/null || { echo "findmnt is missing (util-linux): no nosuid view without it" >&2; exit 1; }',
  'findmnt -rno TARGET,VFS-OPTIONS | while read -r p o; do mount -o "remount,bind,nosuid,$o" "$p" 2>/dev/null || :; done',
  `for f in ${ID_MAP_HELPERS.join(" ")}; do mount --bind "$f" "$f"; mount -o remount,bind,suid "$f"; done`,
];

/**
 * As the agent, the containers service's start: its own defaults where it has none (`$1` and `$2`, Podman's
 * containers.conf and storage.conf), Podman's socket and its restart of `restart: always` containers switched on,
 * then its user manager. All of it is the agent's to change; none of it keeps it apart from the others. A user manager
 * logs to /dev/console, which the agent can't open, unless told the journal; and one that exits at once loses its
 * unit there (journald reads that from the gone process), so the cgroup it needs is checked here first, out loud.
 */
const CONTAINERS_START = [
  'c="$HOME/.config"',
  'mkdir -p "$c/containers" "$c/systemd/user/sockets.target.wants" "$c/systemd/user/default.target.wants" || :',
  '[ -e "$c/containers/containers.conf" ] || printf %s "$1" > "$c/containers/containers.conf" || :',
  '[ -e "$c/containers/storage.conf" ] || printf %s "$2" > "$c/containers/storage.conf" || :',
  "for u in sockets.target.wants/podman.socket default.target.wants/podman-restart.service; do",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's own expansion, not JavaScript's.
  '  [ -e "$c/systemd/user/$u" ] || ln -s "/usr/lib/systemd/user/${u#*/}" "$c/systemd/user/$u" || :',
  "done",
  'g=/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)',
  '[ -w "$g" ] || { echo "its user manager has no cgroup to run in ($g is not writable)" >&2; exit 1; }',
  "exec /usr/lib/systemd/systemd --user --log-target=journal",
].join("\n");

/** The identifier of its steps' lines in the journal, where the runner reads why it stopped (`containersFailure`). */
const CONTAINERS_LOG = "agentes-containers";

/** Podman's banner before every `docker compose` (an external provider's) off. */
const CONTAINERS_CONF =
  "# agentes.chat wrote this once: change it as you like.\n[engine]\ncompose_warning_logs = false\n";
/** Images, containers and volumes in the agent's home: its disk, which moves with the workspace. */
const storageConf = (home: string) =>
  `# agentes.chat wrote this once: change it as you like.\n[storage]\ndriver = "overlay"\ngraphroot = "${home}/.local/share/containers/storage"\n`;

/**
 * adb's server port for an agent (`ANDROID_ADB_SERVER_PORT`, which adb, the Android Gradle plugin, Expo and React
 * Native read): in 30000-32767, outside every browser band and Linux's ephemeral range, and different for every
 * uid of any range of up to 2768 uids. Without it every agent's adb would want 5037.
 */
export const adbServerPort = (uid: number) => 30_000 + (uid % 2768);

/**
 * Gradle's daemon exits after 5 idle minutes instead of 3 hours, and the Kotlin daemon with it: the agents share the
 * computer's memory (`agentLimits`), and a finished Android build's daemons hold gigabytes of it, which leaves the
 * other agents no room for their turns. Five minutes keep them warm between an agent's edits and builds. Gradle reads
 * its client's system properties after every gradle.properties (`LayoutToPropertiesConverter`), so this holds for
 * `gradlew` too, and an agent's own `-D` or `GRADLE_OPTS` still wins.
 */
const GRADLE_OPTS = "-Dorg.gradle.daemon.idletimeout=300000";

const USER_NAME = /^ag-[a-z0-9]{8}$/;
const AGENT_SHELL = "/bin/bash";
const AGENT_PATH = "/usr/local/bin:/usr/bin:/bin";

export const agentUserName = (agentId: string) => `ag-${agentId8(agentId)}`;
export const agentHome = (user: string) => `/home/${user}`;

/** passwd's comment field: useradd refuses `:` (its separator) and newlines, and breaks on other control characters. */
const passwdComment = (name: string | undefined) =>
  (name ?? "")
    .replace(/[\p{Cc}:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

const isAgentUser = (v: unknown): v is AgentUser => {
  const r = v as Partial<AgentUser> | null;
  return (
    typeof r?.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= 64 &&
    typeof r.user === "string" &&
    USER_NAME.test(r.user) &&
    isAgentUid(r.uid)
  );
};

/** The listed agent users; a row that isn't well formed is left out. */
export function readAgentUsers(home: string): AgentUser[] {
  const v = readJson<unknown>(path.join(home, AGENT_USERS_FILE));
  return Array.isArray(v) ? v.filter(isAgentUser).map(({ id, user, uid }) => ({ id, user, uid })) : [];
}

interface PasswdEntry {
  name: string;
  uid: number;
  comment: string;
}

const parsePasswd = (text: string): PasswdEntry[] =>
  text.split("\n").flatMap((line) => {
    const [name = "", , uid = "", , comment = ""] = line.split(":");
    return name && /^\d+$/.test(uid) ? [{ name, uid: Number(uid), comment }] : [];
  });

function freeUid([first, last]: [number, number], used: Set<number>): number {
  for (let uid = first; uid <= last; uid++) if (!used.has(uid)) return uid;
  throw new RunnerError("internal", `No uid is left for a new agent user in ${first}-${last}`);
}

export class AgentUsers {
  /** Agents already checked by this process, with their user's comment. */
  private readonly ready = new Map<string, { user: AgentUser; comment: string }>();

  constructor(
    private readonly opts: {
      home: string;
      range: [number, number];
      run?: RunCommand;
      etc?: string;
      /** The computer's shared folder (ADR 0115), which every agent's user joins. */
      shared?: Required<SharedSpec>;
      log?: (line: string) => void;
    },
  ) {}

  /**
   * The agent's user, made on its first request. After that, a request only
   * keeps the user's comment to the agent's name (`usermod -c` after a rename).
   */
  ensure(agent: AgentScope): AgentUser {
    const name = passwdComment(agent.name);
    const known = this.ready.get(agent.id);
    if (known && (!name || name === known.comment)) return known.user;
    const userName = agentUserName(agent.id);
    const passwd = parsePasswd(this.run("getent", ["passwd"]));
    const user = known?.user ?? this.listed(agent.id, userName, passwd);
    const entry = passwd.find((e) => e.name === user.user);
    let comment = entry?.comment ?? "";
    if (!entry) {
      comment = name || passwdComment(agent.handle) || user.user;
      const home = agentHome(user.user);
      this.run("useradd", [
        "--uid",
        String(user.uid),
        "--user-group",
        "--create-home",
        "--home-dir",
        home,
        "--shell",
        AGENT_SHELL,
        "--comment",
        comment,
        user.user,
      ]);
      // Without HOME_MODE in login.defs (older useradd), the home would be 755.
      this.run("chmod", ["0700", home]);
    } else if (entry.uid !== user.uid) {
      throw new RunnerError(
        "internal",
        `${user.user} has uid ${entry.uid} on this computer, not ${user.uid} as ${AGENT_USERS_FILE} says`,
      );
    } else if (name && name !== entry.comment) {
      this.run("usermod", ["--comment", name, user.user]);
      comment = name;
    }
    if (!known) {
      denySchedulers(user.user, this.opts.etc);
      // Without its ids the agent still works; only its containers don't start.
      let ids: string | null;
      try {
        ids = ensureSubids(user, this.opts.etc, this.opts.run);
      } catch (err) {
        ids = err instanceof Error ? err.message : String(err);
      }
      if (ids) this.opts.log?.(`${user.user} has no ids for containers: ${ids}`);
      // A computer that can't share still serves the agent, in its own folders.
      const { shared } = this.opts;
      for (const p of shared ? joinShared(user.user, agentHome(user.user), shared, this.opts.run) : []) {
        this.opts.log?.(`${user.user} can't use the shared folder: ${p}`);
      }
    }
    this.ready.set(agent.id, { user, comment });
    return user;
  }

  /** The agent's row in agents.json, added (before its user exists) when it has none. */
  private listed(id: string, user: string, passwd: PasswdEntry[]): AgentUser {
    const file = path.join(this.opts.home, AGENT_USERS_FILE);
    const rows = readAgentUsers(this.opts.home);
    const row = rows.find((r) => r.id === id);
    if (row) return row;
    if (rows.some((r) => r.user === user)) {
      throw new RunnerError("internal", `Another agent on this computer already has the user ${user}`);
    }
    const [first, last] = this.opts.range;
    // A user by that name that isn't listed (agents.json was lost) is this agent's when it has an agent uid nobody listed.
    const existing = passwd.find((e) => e.name === user);
    if (existing && (existing.uid < first || existing.uid > last || rows.some((r) => r.uid === existing.uid))) {
      throw new RunnerError("internal", `${user} already exists on this computer with uid ${existing.uid}`);
    }
    const taken = [...passwd, ...rows, ...readAccountUsers(this.opts.home)];
    const uid = existing?.uid ?? freeUid(this.opts.range, new Set(taken.map((r) => r.uid)));
    const added = { id, user, uid };
    // Listed first: a useradd that fails leaves the uid this agent's, and the next request retries it.
    writeJson(file, [...rows, added]);
    return added;
  }

  private run(file: string, args: string[]): string {
    const r = (this.opts.run ?? runSync)(file, args);
    if (r.code !== 0) throw new RunnerError("internal", `${file} failed (${r.code}): ${r.output.slice(0, 500)}`);
    return r.output;
  }
}

/**
 * cron and at would start the agent's jobs outside its launcher: in no slice of its own, with the computer's
 * shared /tmp. Its user goes in their deny files: `cron.deny` made where missing (without it or `cron.allow`,
 * cron takes everyone's jobs), `at.deny` only where it is (without it or `at.allow`, at takes root's alone). An
 * allow file, where one is, already leaves agents out.
 */
export function denySchedulers(user: string, etc = "/etc") {
  for (const [name, make] of [
    ["cron.deny", true],
    ["at.deny", false],
  ] as const) {
    const file = path.join(etc, name);
    let text: string | null = null;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      // missing
    }
    if (text === null && !make) continue;
    if (text?.split("\n").some((line) => line.trim() === user)) continue;
    try {
      appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${user}\n`);
      // crontab reads it as the person who runs it: a file it can't read would deny no one.
      if (text === null) chmodSync(file, 0o644);
    } catch (err) {
      throw new RunnerError(
        "internal",
        `Couldn't keep ${user} from scheduling cron and at jobs (${file}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * An agent's subordinate uids and gids (`/etc/subuid`, `/etc/subgid`), which the users inside its rootless
 * containers map to: the 65536 from `uid << 16`. Taken from the uid alone, they are the same on every computer where
 * the agent keeps its uid (a move keeps it), so what its containers left in its home keeps owners it maps. No two
 * agents share one, and none is a real uid: those are all below 65536, an agent's block 1000 << 16 or above. An
 * operator's firewall that keys on agents' uids must also take every id from 65536 up for an agent's (ADR 0169).
 */
export const SUBIDS = 65536;
export const agentSubids = (uid: number): [number, number] => [uid * SUBIDS, (uid + 1) * SUBIDS - 1];

interface SubidRange {
  owner: string;
  first: number;
  last: number;
}

const parseSubids = (text: string): SubidRange[] =>
  text.split("\n").flatMap((line) => {
    const [owner = "", start = "", count = ""] = line.trim().split(":");
    return owner && /^\d+$/.test(start) && /^[1-9]\d*$/.test(count)
      ? [{ owner, first: Number(start), last: Number(start) + Number(count) - 1 }]
      : [];
  });

/**
 * Gives the agent's user its own block (`agentSubids`) in both files and no other range: useradd hands each new user
 * the next free one by the order users came in, which no other computer repeats. Anyone else's range over that block
 * leaves the agent with none, never sharing ids (its containers then don't start). usermod takes the files' lock.
 * Returns why the agent has no ids, or null.
 */
export function ensureSubids(user: Pick<AgentUser, "user" | "uid">, etc = "/etc", run: RunCommand = runSync) {
  const [first, last] = agentSubids(user.uid);
  const files = [
    ["subuid", "--del-subuids", "--add-subuids"],
    ["subgid", "--del-subgids", "--add-subgids"],
  ] as const;
  const ranges = files.map(([name]) => {
    const file = path.join(etc, name);
    try {
      return parseSubids(readFileSync(file, "utf8"));
    } catch {
      // usermod refuses to add ranges to a file that isn't there. Podman reads it as the agent: readable by all.
      writeFileSync(file, "", { flag: "a" });
      chmodSync(file, 0o644);
      return [];
    }
  });
  const own = (r: SubidRange) => r.owner === user.user || r.owner === String(user.uid);
  const clash = ranges.flat().find((r) => !own(r) && r.first <= last && r.last >= first);
  const exact = (r: SubidRange) => r.first === first && r.last === last;
  const args = files.flatMap(([, del, add], i) => {
    const mine = (ranges[i] ?? []).filter(own);
    return [
      // usermod removes a user's ranges by its name only.
      ...mine
        .filter((r) => r.owner === user.user && (clash || !exact(r)))
        .flatMap((r) => [del, `${r.first}-${r.last}`]),
      ...(clash || mine.some(exact) ? [] : [add, `${first}-${last}`]),
    ];
  });
  if (args.length > 0) {
    const r = run("usermod", [...args, user.user]);
    if (r.code !== 0) return `usermod failed (${r.code}): ${r.output.slice(0, 300)}`;
  }
  return clash ? `${clash.owner} holds ${clash.first}-${clash.last}, over its ${first}-${last}` : null;
}

/**
 * Runs a command as the agent's user inside its slice (whose limits then
 * hold), with its own temporary folders (`AGENT_RAM`, `PRIVATE_TMP`), or with
 * runuser alone where systemd isn't PID 1 (a container). Absolute paths: root
 * never looks these up on a PATH. `--collect`: a scope the OOM killer ended
 * doesn't stay behind as a failed unit. `OOMPolicy=continue` (`oomPolicy`): a
 * process the kernel stops for memory takes only itself, so the command it ran
 * fails where its caller can tell, and the agent's other work goes on. sh,
 * unshare and sh each become the next program (no fork), so runuser still
 * passes SIGTERM on; with slave propagation, what the computer unmounts leaves
 * the agent's namespace too. With rootless containers (`containers`), every
 * launch has the agent's runtime dir and talks to its containers service's
 * Podman (`docker` and `podman` both, through the socket's Docker API too).
 */
export function systemLauncher(
  u: AgentUser,
  systemd = systemdBooted(),
  oomPolicy = systemd && scopeOomPolicy(),
  containers = systemd && rootlessContainers(),
): Launcher {
  const home = agentHome(u.user);
  const runuser = ["/usr/sbin/runuser", "-u", u.user, "--"];
  const command = [...networkPrefix(u), ...networkRestrictions(u), ...runuser];
  const socket = podmanSocket(u.uid);
  const env = {
    ...agentEnv(u, containers),
    ...(containers ? { CONTAINER_HOST: socket, DOCKER_HOST: socket } : {}),
  };
  if (!systemd) return { prefix: command, env, home };
  return {
    prefix: [
      "/usr/bin/systemd-run",
      "--quiet",
      "--scope",
      "--collect",
      ...(oomPolicy ? ["--property=OOMPolicy=continue"] : []),
      `--slice=${agentSlice(u.uid)}`,
      "--",
      "/bin/sh",
      "-c",
      AGENT_RAM,
      "sh",
      String(u.uid),
      "/usr/bin/unshare",
      "--mount",
      "--propagation",
      "slave",
      "--",
      "/bin/sh",
      "-c",
      agentView(u, containers ? RUNTIME_DIR : []),
      "sh",
      String(u.uid),
      ...command,
    ],
    env,
    home,
    tmp: agentTmp(u.uid),
  };
}

/** The agent's whole environment; a launch adds what one command needs (DISPLAY, TERM…). */
function agentEnv(u: AgentUser, containers: boolean): Record<string, string> {
  const home = agentHome(u.user);
  return {
    HOME: home,
    USER: u.user,
    LOGNAME: u.user,
    SHELL: AGENT_SHELL,
    // The shared `bin/` is never on it: every agent can write there, and a tool found by name would run as
    // whichever agent called it, with that agent's files and sign-ins. Agents reach it by full path.
    PATH: AGENT_PATH,
    [SHARED_BIN_ENV]: `${home}/${SHARED_LINK}/bin`,
    LANG: "C.UTF-8",
    ANDROID_ADB_SERVER_PORT: String(adbServerPort(u.uid)),
    GRADLE_OPTS,
    ...(containers ? { XDG_RUNTIME_DIR: agentRuntimeDir(u.uid) } : {}),
  };
}

/** Root's steps in the agent's new mount namespace (`PRIVATE_TMP`, with `more` before it becomes the agent). */
function agentView(u: AgentUser, more: string[]) {
  const view = more.length > 0 ? [...PRIVATE_TMP_STEPS, ...more, 'exec "$@"'].join("\n") : PRIVATE_TMP;
  // A configured isolation policy gets a fresh private proc instance, never a host remount.
  return u.networkLauncher || u.networkMark || u.networkRevision
    ? `set -e\n/usr/bin/mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc\n${view}`
    : view;
}

/**
 * The agent's containers service, `agentes-containers-<uid>.service` (ADR 0169): a systemd user manager of the
 * agent's own, which runs Podman's API (its socket, every launch's `CONTAINER_HOST` and `DOCKER_HOST`), the
 * healthcheck timers, compose's DNS helper and the containers themselves. It goes through the steps every launch of
 * the agent does (its tmpfs, its mount namespace and /tmp, its network hook, its user) in a unit of its slice whose
 * cgroup is the agent's to divide, so each container's `--memory` and `--cpus` hold inside the agent's share, and
 * stopping the slice stops them all. Without no_new_privs, which would void the id-map helpers' set-user-ID: its
 * mount view keeps set-user-ID to them alone (`NOSUID_VIEW`), and the bounding set still drops NET_ADMIN and NET_RAW.
 * `Restart=always` runs it again, network hook included, if it dies, 5 starts a minute at most: one that fails at every
 * start then stays failed (no `--collect`), its steps' lines in the journal under `CONTAINERS_LOG`, and isn't started
 * again for the same command (`ensureContainers`). OOMPolicy=continue: a container the kernel stops for memory takes
 * only itself. A service's command line is its ExecStart=, unlike a scope's: systemd expands `$` in it, and writes it
 * to the unit's file under /run/systemd/transient with every `$` doubled, which is what runs after any daemon-reload.
 * So `--expand-environment=no` (`literal`, systemd 254 and later), which keeps it as it is in both; before 254 there is
 * no such switch, and every `$` goes doubled, which it reads as one.
 */
export function containersCommand(u: AgentUser, literal = installedSystemd() >= 254): string[] {
  const env = Object.entries(agentEnv(u, true)).map(([name, value]) => `${name}=${value}`);
  const hook = networkPrefix(u);
  const command = [
    "/bin/sh",
    "-c",
    AGENT_RAM,
    "sh",
    String(u.uid),
    "/usr/bin/unshare",
    "--mount",
    "--propagation",
    "slave",
    "--",
    "/bin/sh",
    "-c",
    agentView(u, [...RUNTIME_DIR, ...DELEGATE, ...(hook.length > 0 ? CGROUP_KEPT : []), ...NOSUID_VIEW]),
    "sh",
    String(u.uid),
    ...hook,
    ...(hook.length > 0 ? ["/bin/sh", "-c", CGROUP_BACK, "sh", keptCgroup(u.uid)] : []),
    SETPRIV,
    "--bounding-set=-net_admin,-net_raw",
    "--",
    "/usr/sbin/runuser",
    "-u",
    u.user,
    "--",
    "/usr/bin/env",
    "-i",
    ...env,
    "/bin/sh",
    "-c",
    CONTAINERS_START,
    "sh",
    CONTAINERS_CONF,
    storageConf(agentHome(u.user)),
  ];
  return [
    "/usr/bin/systemd-run",
    "--quiet",
    ...(literal ? ["--expand-environment=no"] : []),
    `--unit=${containersUnit(u.uid)}`,
    `--slice=${agentSlice(u.uid)}`,
    "--property=Delegate=yes",
    "--property=Restart=always",
    "--property=RestartSec=5",
    "--property=StartLimitIntervalSec=60",
    "--property=StartLimitBurst=5",
    "--property=OOMPolicy=continue",
    "--property=TimeoutStopSec=15",
    "--property=StandardError=journal",
    `--property=SyslogIdentifier=${CONTAINERS_LOG}`,
    "--",
    ...(literal ? command : command.map((arg) => arg.replaceAll("$", () => "$$"))),
  ];
}

/**
 * The agent's containers service running as `containersCommand` says now: started when it isn't, and started again
 * when what it would run changed (its network hook above all: a namespace's containers live where the agent's other
 * processes do), which stops its containers. Its description carries that command's hash. One its start limit stopped
 * stays down for that same command, which would fail the same way: started again once the command changes, the
 * computer restarts, or someone runs `systemctl reset-failed` on it. Returns why it doesn't run, or null.
 */
export function ensureContainers(u: AgentUser, run: RunCommand = runSync): string | null {
  const [file = "", ...args] = containersCommand(u);
  const description = `agentes.chat containers ${createHash("sha256")
    .update([file, ...args].join("\0"))
    .digest("hex")
    .slice(0, 16)}`;
  const unit = containersUnit(u.uid);
  const shown = run("systemctl", ["show", "--property=ActiveState,Description,Result", unit]).output;
  const property = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(shown)?.[1];
  const same = property("Description") === description;
  const state = property("ActiveState") ?? "";
  if (state === "failed") {
    // With Restart=always it fails only when systemd stops restarting it (its start limit, the last failure's result
    // kept) or when a stop timed out, which says nothing about its next start.
    const result = property("Result") ?? "";
    if (same && result !== "timeout") return containersFailure(u.uid, result, run);
    // A failed unit stays loaded, and a new one can't take its name.
    run("systemctl", ["reset-failed", unit]);
  } else if (["active", "activating", "reloading"].includes(state)) {
    if (same) return null;
    run("systemctl", ["stop", unit]);
  }
  const r = run(file, [`--description=${description}`, ...args]);
  return r.code === 0 ? null : `${file} failed (${r.code}): ${r.output.slice(0, 300)}`;
}

/**
 * Why its containers service stopped at its start limit: the last line its steps wrote, or its user manager (whose
 * lines lose their unit when it exits at once, so they're found by the agent's uid).
 */
function containersFailure(uid: number, result: string, run: RunCommand) {
  const r = run("journalctl", [
    "--no-pager",
    "--output=cat",
    "--lines=1",
    `_SYSTEMD_UNIT=${containersUnit(uid)}`,
    `SYSLOG_IDENTIFIER=${CONTAINERS_LOG}`,
    "+",
    `_UID=${uid}`,
    "SYSLOG_IDENTIFIER=systemd",
  ]);
  const line = r.code === 0 ? r.output.split("\n")[0]?.trim() : "";
  return line ? line.slice(0, 300) : `its service failed at every start (${result})`;
}

/** The agent's containers stop (a network change's deadline, the agent left this computer). */
export const stopContainers = (uid: number, run: RunCommand = runSync) =>
  run("systemctl", ["stop", "--no-block", containersUnit(uid)]);

/**
 * Its containers service as the agents frame says (`MachineAgent.containers`): kept as `ensureContainers` keeps it, or
 * stopped for an agent whose brain's shell runs in a sandbox of its CLI's own, which the service, outside it, would be
 * a way out of (ADR 0169).
 */
export function keepContainers(u: AgentUser, allowed: boolean, run: RunCommand = runSync): string | null {
  if (allowed) return ensureContainers(u, run);
  stopContainers(u.uid, run);
  return null;
}

/** Root executes this hook before dropping privileges. Every path component must remain root-controlled. */
export const trustedNetworkLauncher = (file: string, stat = lstatSync) =>
  trustedRootFile(file, "network launcher", stat);

/** `file` when it and every folder above it are root's alone, none of them a link. A `script` needs no exec bit. */
export function trustedRootFile(file: string, what: string, stat = lstatSync, script = false): string[] {
  if (!path.isAbsolute(file) || file.includes("\0")) throw new Error(`The ${what} must be an absolute path`);
  let current = path.resolve(file);
  while (true) {
    const info = stat(current);
    if (
      info.uid !== 0 ||
      (info.mode & 0o022) !== 0 ||
      info.isSymbolicLink() ||
      (current === path.resolve(file) ? !info.isFile() || (!script && (info.mode & 0o111) === 0) : !info.isDirectory())
    ) {
      throw new Error(`The ${what} and its parent directories must be owned and writable only by root`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [path.resolve(file)];
}

/** The agent user's own group (`useradd --user-group` made it; its id needn't be the uid). */
export function agentGid(user: string, run: RunCommand = runSync): number {
  const r = run("id", ["-g", user]);
  const gid = Number(r.output);
  if (r.code !== 0 || !/^\d+$/.test(r.output) || gid === 0) {
    throw new RunnerError("internal", `The group of ${user} isn't known here (${r.code}): ${r.output.slice(0, 200)}`);
  }
  return gid;
}

/** Commands before runuser and root's network diagnostics enter the same optional network context. */
export function networkPrefix(user: AgentUser): string[] {
  return user.networkLauncher ? [...trustedNetworkLauncher(user.networkLauncher), String(user.uid), "--"] : [];
}

/** A configured routing exemption must not be forgeable by gaining file capabilities after exec. */
export function networkRestrictions(user: AgentUser): string[] {
  if (user.networkMark === undefined) return [];
  validateNetworkMark(user.networkMark);
  return ["/usr/bin/setpriv", "--no-new-privs", "--bounding-set=-net_admin,-net_raw", "--"];
}

/** Root's shared git cache on a system-mode computer (ADR 0116 §4) and the system user that owns it. */
export const GIT_CACHE_DIR = "/var/cache/agentes-git";
export const GIT_CACHE_USER = "agentes-git";

/** The cache's owner, made the first time (a system user nobody signs in as). */
export function ensureGitCacheUser(run: RunCommand = runSync): { uid: number; gid: number } {
  const id = (flag: string) => run("id", [flag, GIT_CACHE_USER]);
  if (id("-u").code !== 0) {
    run("useradd", [
      "--system",
      "--user-group",
      "--no-create-home",
      "--home-dir",
      GIT_CACHE_DIR,
      "--shell",
      "/usr/sbin/nologin",
      GIT_CACHE_USER,
    ]);
  }
  const uid = id("-u");
  const gid = id("-g");
  if (uid.code !== 0 || gid.code !== 0) throw new RunnerError("internal", `${GIT_CACHE_USER} couldn't be made`);
  return { uid: Number(uid.output.trim()), gid: Number(gid.output.trim()) };
}

/**
 * The group root's Claude sign-in, status, sign-out and usage children run as on a system-mode computer, so the
 * computer's egress rules can route them (and nothing else of root) like the agents' traffic. Nobody is a member.
 */
export const AUTH_EGRESS_GROUP = "agentes-auth";
const SETPRIV = "/usr/bin/setpriv";
/** `$1` the new project, `$2` the transcript, `$3` its copy: a link stays a link, which then resumes nothing. */
const CARRY_SESSION = 'umask 077 && mkdir -p -- "$1" && exec cp --no-dereference --remove-destination -- "$2" "$3"';

/** That group's id, the group made the first time; null when it can't be. */
function authEgressGid(run: RunCommand): number | null {
  const gid = () => {
    const r = run("getent", ["group", AUTH_EGRESS_GROUP]);
    const n = Number(r.output.split(":")[2]);
    return r.code === 0 && Number.isInteger(n) && n > 0 ? n : null;
  };
  const found = gid();
  if (found !== null) return found;
  run("groupadd", ["--system", AUTH_EGRESS_GROUP]);
  return gid();
}

/**
 * What goes before such a child (`setpriv --regid=<gid> --clear-groups --`); null without `setpriv` or the group, and
 * the child then runs as before.
 */
export function authEgressPrefix(run: RunCommand = runSync): string[] | null {
  if (run(SETPRIV, ["--version"]).code !== 0) return null;
  const found = authEgressGid(run);
  return found === null ? null : [SETPRIV, `--regid=${found}`, "--clear-groups", "--"];
}

/** Lets one agent's uid into one cached repository; false without `setfacl` (the clone then goes without the cache). */
export const grantGitCache = (dir: string, uid: number, run: RunCommand = runSync) =>
  run("setfacl", ["-m", `u:${uid}:rx`, dir]).code === 0;

/**
 * A Claude login of the CLI's own that serves several agents: one system user per sign-in, `agc-<first 8 of its id>`,
 * is the only owner of that sign-in's `CLAUDE_CONFIG_DIR`, and every Claude CLI on it runs as that user. Its primary group is `agentes-auth`, which the computer's egress rules already route strictly and
 * which grants no file. `<runner home>/account-users.json` lists them as `[{ id, user, uid }]`; a row outlives its
 * user, so a uid is never given out twice.
 */
export const ACCOUNT_USERS_FILE = "account-users.json";
export const ACCOUNT_STORES = "/var/lib/agentes-claude";
/** Each agent's relay socket for the CLIs on its sign-ins: outside every mask of `ACCOUNT_VIEW`. */
const ACCOUNT_BRIDGES = "/run/agentes-bridge";
/** Outside the default agent range. Its last uid is left out for the self-check's stand-in agent (`PROBE_AGENT_UID`). */
export const ACCOUNT_UID_RANGE: [number, number] = [30000, 30998];
export const PROBE_AGENT_UID = 30999;
/** The `run/` and scope name of what runs for no agent: sign-in, status, usage, sign-out. */
const PROBE_ROOM = "probe";
const ACCOUNT_USER_NAME = /^agc-[a-z0-9]{8}$/;

export interface AccountUser {
  id: string;
  user: string;
  uid: number;
  gid: number;
}

export const accountUserName = (accountId: string) => `agc-${agentId8(accountId)}`;

const isAccountRow = (v: unknown): v is Omit<AccountUser, "gid"> => {
  const r = v as Partial<AccountUser> | null;
  return isAccountId(r?.id) && typeof r?.user === "string" && ACCOUNT_USER_NAME.test(r.user) && isAgentUid(r.uid);
};

/** The sign-ins' users, retired ones too; a row that isn't well formed is left out. */
export function readAccountUsers(home: string): Omit<AccountUser, "gid">[] {
  const v = readJson<unknown>(path.join(home, ACCOUNT_USERS_FILE));
  return Array.isArray(v) ? v.filter(isAccountRow).map(({ id, user, uid }) => ({ id, user, uid })) : [];
}

/** What holds agents' data. Claude's mount view hides them all; a turn's cwd must lie under one but the stores. */
const AGENT_DATA_ROOTS = ["/home", SHARED_ROOT, AGENT_WORKER_HOMES, GIT_CACHE_DIR];
export const ACCOUNT_MASKED_ROOTS = [...AGENT_DATA_ROOTS, ACCOUNT_STORES];

const inside = (root: string, p: string) => p.startsWith(`${root}/`);
export const underMaskedRoot = (p: string) => ACCOUNT_MASKED_ROOTS.some((root) => inside(root, p));

/**
 * Runs as root in the CLI's new mount namespace (`$1` the sign-in, `$2` its room under `run/`, `$3` the path the CLI
 * should see as its cwd, empty for its room). The temporary folders are new and in memory: unlike `PRIVATE_TMP`'s,
 * nothing an agent wrote is in them. The masks hide every agent's data; the sign-in's own folders come back through a
 * bind taken before its parent is masked. The cwd is a new path in a mask, so no link an agent planted is followed,
 * with this room's empty folder bound on it: nothing an agent can write lies above or below the CLI.
 * `ulimit -c 0` and not systemd-run's LimitCORE: a scope has no exec settings and refuses that property.
 */
const ACCOUNT_VIEW = [
  "set -e",
  "ulimit -c 0",
  `v=${ACCOUNT_STORES}`,
  'a="$v/$1"',
  'r="$2"',
  'c="$3"',
  "shift 3",
  "t=mode=1777,nosuid,nodev,size=50%,nr_inodes=1m",
  'mount -t tmpfs -o "$t" agentes-account-tmp /tmp',
  'mount -t tmpfs -o "$t" agentes-account-tmp /var/tmp',
  'mount -t tmpfs -o "$t" agentes-account-tmp /dev/shm',
  'if [ "$(stat -c %a /run/lock 2>/dev/null)" = 1777 ]; then mount -t tmpfs -o "$t" agentes-account-tmp /run/lock; fi',
  "mkdir /tmp/.a",
  'mount --bind "$a" /tmp/.a',
  `for m in ${ACCOUNT_MASKED_ROOTS.join(" ")}; do`,
  '  if [ -d "$m" ]; then mount -t tmpfs -o mode=0755,nosuid,nodev,size=1m agentes-account-view "$m"; fi',
  "done",
  'mkdir -p "$a/config" "$a/run/$r"',
  'mount --bind /tmp/.a/config "$a/config"',
  'mount --bind "/tmp/.a/run/$r" "$a/run/$r"',
  'if [ -n "$c" ]; then',
  '  mkdir -p "$c"',
  '  mount --bind "/tmp/.a/cwd/$r" "$c"',
  "else",
  '  c="$a/run/$r"',
  "fi",
  "umount /tmp/.a",
  "rmdir /tmp/.a",
  'cd "$c"',
  'exec "$@"',
].join("\n");

/**
 * A turn's cwd when root may build it: a plain absolute path under the agent's home or one of its grants, inside a
 * mask. The worker resolved it as the agent, so this is a check of what came from the agent's side.
 */
export function accountCwd(cwd: string, agent: AgentUser, grants: readonly string[] = []): string {
  const allowed = [agentHome(agent.user), ...grants].some((root) => cwd === root || inside(root, cwd));
  if (
    !path.isAbsolute(cwd) ||
    path.normalize(cwd) !== cwd ||
    cwd.endsWith("/") ||
    cwd.includes("\0") ||
    !allowed ||
    !AGENT_DATA_ROOTS.some((root) => inside(root, cwd))
  ) {
    throw new RunnerError("not_allowed", "That folder can't be used with this sign-in");
  }
  return cwd;
}

const accountScope = (room: string | number) => `agentes-account-${room}`;

/**
 * Runs a command as the sign-in's user in its mount view (`ACCOUNT_VIEW`). With an agent: in that agent's cli slice and
 * network, at `cwd`. Without one (sign-in, status, usage, sign-out): on the computer's own network, where the group
 * routes it, in the sign-in's probe room. A named scope, so `stopAccountScopes` finds these and leaves the agent's own
 * processes in the slice alone. Every step execs the next, so the process spawned is the CLI itself and root's
 * signals reach it. `home` is `run/<room>`: a folder that exists outside the view too, for spawn's cwd.
 */
export function accountLauncher(
  account: AccountUser,
  agent: AgentUser | null,
  cwd: string | null = null,
  grants: readonly string[] = [],
): Launcher {
  const room = agent ? String(agent.uid) : PROBE_ROOM;
  const stand = agent ? accountCwd(cwd ?? "", agent, grants) : "";
  const store = path.join(ACCOUNT_STORES, account.id);
  const run = path.join(store, "run", room);
  return {
    prefix: [
      "/usr/bin/systemd-run",
      "--quiet",
      "--scope",
      "--collect",
      `--unit=${accountScope(room)}-${randomBytes(4).toString("hex")}`,
      ...(agent ? [`--slice=${agentCategorySlice(agent.uid, "cli")}`] : []),
      "--",
      "/usr/bin/unshare",
      "--mount",
      "--propagation",
      "slave",
      "--",
      "/bin/sh",
      "-c",
      ACCOUNT_VIEW,
      "sh",
      account.id,
      room,
      stand,
      ...(agent ? networkPrefix(agent) : []),
      SETPRIV,
      "--no-new-privs",
      "--bounding-set=-net_admin,-net_raw",
      "--",
      SETPRIV,
      `--reuid=${account.uid}`,
      `--regid=${account.gid}`,
      "--clear-groups",
      "--",
    ],
    env: {
      HOME: path.join(run, "home"),
      USER: account.user,
      LOGNAME: account.user,
      SHELL: AGENT_SHELL,
      PATH: AGENT_PATH,
      LANG: "C.UTF-8",
      TMPDIR: "/tmp",
      CLAUDE_CONFIG_DIR: path.join(store, "config"),
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      // Undocumented, so `neutralizeFileMentions` covers a CLI that ignores it.
      CLAUDE_CODE_DISABLE_FILE_MENTIONS: "1",
      DISABLE_AUTOUPDATER: "1",
    },
    home: run,
  };
}

export class AccountUsers {
  private readonly ready = new Map<string, AccountUser>();
  /** Rooms already made by this process, as `<account>/<room>`. */
  private readonly rooms = new Set<string>();

  constructor(
    private readonly opts: {
      home: string;
      /** Tests: `ACCOUNT_STORES`, `ACCOUNT_BRIDGES`. */
      root?: string;
      bridges?: string;
      run?: RunCommand;
      etc?: string;
      log?: (line: string) => void;
    },
  ) {}

  private store(id: string) {
    return path.join(this.opts.root ?? ACCOUNT_STORES, id);
  }

  /** The sign-in's user and folders, made the first time; a user an older runner left behind is taken back. */
  ensure(id: string): AccountUser {
    const known = this.ready.get(id);
    if (known) return known;
    if (!isAccountId(id)) throw new RunnerError("bad_request", "Invalid account id");
    const passwd = parsePasswd(this.run("getent", ["passwd"]));
    const row = this.listed(id, accountUserName(id), passwd);
    const gid = authEgressGid(this.opts.run ?? runSync);
    if (gid === null) throw new RunnerError("internal", `The group ${AUTH_EGRESS_GROUP} couldn't be made here`);
    const entry = passwd.find((e) => e.name === row.user);
    if (!entry) {
      this.run("useradd", [
        "--system",
        "--uid",
        String(row.uid),
        "--gid",
        AUTH_EGRESS_GROUP,
        "--no-create-home",
        "--home-dir",
        this.store(id),
        "--shell",
        "/usr/sbin/nologin",
        row.user,
      ]);
    } else if (entry.uid !== row.uid) {
      throw new RunnerError(
        "internal",
        `${row.user} has uid ${entry.uid} on this computer, not ${row.uid} as ${ACCOUNT_USERS_FILE} says`,
      );
    }
    denySchedulers(row.user, this.opts.etc);
    const user = { ...row, gid };
    const store = this.store(id);
    // Each parent is root's, so the sign-in's user can't swap what `install` works on.
    for (const dir of [path.dirname(store), store, `${store}/run`, `${store}/cwd`]) this.folder(dir, "0711");
    this.folder(`${store}/config`, "0700", user);
    this.ready.set(id, user);
    return user;
  }

  /**
   * `run/<room>` (and for an agent `cwd/<room>`). Root writes what is in `run/`; the sign-in's user reads it through an
   * ACL, since its only group is the one all sign-ins share. Its HOME there is its own and stays empty of anything root
   * or an agent wrote.
   */
  room(user: AccountUser, room: number | "probe") {
    const key = `${user.id}/${room}`;
    if (this.rooms.has(key)) return;
    const store = this.store(user.id);
    const dir = `${store}/run/${room}`;
    this.folder(dir, "0750");
    this.run("setfacl", ["-m", `u:${user.uid}:rx,d:u:${user.uid}:rx`, dir]);
    this.folder(`${dir}/home`, "0700", user);
    if (room !== PROBE_ROOM) this.folder(`${store}/cwd/${room}`, "0700", user);
    this.rooms.add(key);
  }

  /**
   * Where the agent's worker listens for this sign-in's relays: a folder of the agent's own that the sign-in's user may
   * only enter. Root's parent, so what the ACL lands on is that folder and no link the agent left.
   */
  bridge(user: AccountUser, agent: AgentUser): string {
    const key = `${user.id}/bridge/${agent.uid}`;
    const dir = path.join(this.opts.bridges ?? ACCOUNT_BRIDGES, String(agent.uid));
    if (!this.rooms.has(key)) {
      this.run("install", ["-d", "-m", "0711", "-o", "0", "-g", "0", path.dirname(dir)]);
      this.run("install", [
        "-d",
        "-m",
        "0700",
        "-o",
        String(agent.uid),
        "-g",
        String(agentGid(agent.user, this.opts.run)),
        dir,
      ]);
      this.run("setfacl", ["-m", `u:${user.uid}:x`, dir]);
      this.rooms.add(key);
    }
    return path.join(dir, "mcp.sock");
  }

  /** How root runs what serves no agent on this sign-in (`accountLauncher`), its user and room made first. */
  launcher(id: string): Launcher {
    const user = this.ensure(id);
    this.room(user, PROBE_ROOM);
    return accountLauncher(user, null);
  }

  /** The sign-in is gone: its processes, its store and its user. Its row stays, so its uid is never used again. */
  remove(id: string) {
    const row = readAccountUsers(this.opts.home).find((r) => r.id === id);
    if (row) this.kill(row.uid);
    rmSync(this.store(id), { recursive: true, force: true });
    if (row) {
      // 6: no such user. Forced: a process killed just now may not be gone yet.
      const r = (this.opts.run ?? runSync)("userdel", ["--force", row.user]);
      if (r.code !== 0 && r.code !== 6) this.opts.log?.(`userdel ${row.user} failed (${r.code}): ${r.output}`);
    }
    this.ready.delete(id);
    for (const key of this.rooms) if (key.startsWith(`${id}/`)) this.rooms.delete(key);
  }

  /** The runner just started: no CLI of a sign-in survives it, and turns resume from their sessions. */
  sweep() {
    for (const { uid } of readAccountUsers(this.opts.home)) this.kill(uid);
  }

  /** A session's transcript into another folder's project, as the sign-in's user: only it and root write there. */
  carry(user: AccountUser, from: string, to: string) {
    const id = [`--reuid=${user.uid}`, `--regid=${user.gid}`, "--clear-groups", "--"];
    this.run(SETPRIV, [...id, "/bin/sh", "-c", CARRY_SESSION, "sh", path.dirname(to), from, to]);
  }

  /** The agent's CLIs on every sign-in stop (`stopAccountScopes`); nothing runs where there are no sign-ins. */
  stopScopes(uid: number) {
    if (readAccountUsers(this.opts.home).length > 0) stopAccountScopes(uid, this.opts.run);
  }

  /**
   * The agent was deleted: what every sign-in holds for it goes. Its transcripts are the `projects/` folders
   * named after a path with its user in it; one on a path it shared stays. Only root and the sign-in's user write
   * in these folders, and `rmSync` follows no link.
   */
  sweepAgent(agent: Pick<AgentUser, "user" | "uid">) {
    this.stopScopes(agent.uid);
    const slug = new RegExp(`(^|-)${agent.user}(-|$)`);
    for (const { id } of readAccountUsers(this.opts.home)) {
      const store = this.store(id);
      const projects = path.join(store, "config", "projects");
      let names: string[] = [];
      try {
        names = readdirSync(projects);
      } catch {
        // no transcripts here
      }
      const gone = [`${store}/cwd/${agent.uid}`, `${store}/run/${agent.uid}`];
      gone.push(...names.filter((n) => slug.test(n)).map((n) => path.join(projects, n)));
      for (const dir of gone) rmSync(dir, { recursive: true, force: true });
      this.rooms.delete(`${id}/${agent.uid}`);
    }
  }

  private kill(uid: number) {
    (this.opts.run ?? runSync)("pkill", ["-KILL", "-U", String(uid)]);
  }

  private folder(dir: string, mode: string, owner?: AccountUser) {
    const [uid, gid] = owner ? [owner.uid, owner.gid] : [0, 0];
    this.run("install", ["-d", "-m", mode, "-o", String(uid), "-g", String(gid), dir]);
  }

  private listed(id: string, user: string, passwd: PasswdEntry[]) {
    const file = path.join(this.opts.home, ACCOUNT_USERS_FILE);
    const rows = readAccountUsers(this.opts.home);
    const row = rows.find((r) => r.id === id);
    if (row) return row;
    if (rows.some((r) => r.user === user)) {
      throw new RunnerError("internal", `Another sign-in on this computer already has the user ${user}`);
    }
    const [first, last] = ACCOUNT_UID_RANGE;
    const existing = passwd.find((e) => e.name === user);
    if (existing && (existing.uid < first || existing.uid > last || rows.some((r) => r.uid === existing.uid))) {
      throw new RunnerError("internal", `${user} already exists on this computer with uid ${existing.uid}`);
    }
    const taken = [...passwd, ...rows, ...readAgentUsers(this.opts.home)];
    const uid = existing?.uid ?? freeUid(ACCOUNT_UID_RANGE, new Set(taken.map((r) => r.uid)));
    const added = { id, user, uid };
    // Listed first: a useradd that fails leaves the uid this sign-in's, and the next request retries it.
    writeJson(file, [...rows, added]);
    return added;
  }

  private run(file: string, args: string[]): string {
    const r = (this.opts.run ?? runSync)(file, args);
    if (r.code !== 0) throw new RunnerError("internal", `${file} failed (${r.code}): ${r.output.slice(0, 500)}`);
    return r.output;
  }
}

/**
 * Stops the CLIs root launched for this agent (`accountLauncher`). They run as a sign-in's user, so nothing that stops
 * an agent by its uid reaches them.
 */
export function stopAccountScopes(uid: number, run: RunCommand = runSync) {
  run("systemctl", ["stop", "--no-block", `${accountScope(uid)}-*.scope`]);
}
