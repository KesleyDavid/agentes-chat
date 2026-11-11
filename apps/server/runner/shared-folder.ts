import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ALL_AGENTS, type RunnerAccess } from "@agenteschat/adapters/machine-protocol";
import { type RunCommand, runSync } from "./service";

/**
 * The computer's shared folder (ADR 0115): one folder every agent on it reads and writes, for what several of them
 * need (a cloned repository, a downloaded dataset, a CLI in `bin/`) so each doesn't fetch it again.
 *
 * System mode: `/srv/agentes/shared`, root's, of the group `agentes-shared` every agent's user joins (setgid, so
 * what is made inside keeps the group), with default ACLs so files made there stay writable by the group whatever
 * the agent's umask. Root makes the folder and `bin/` once and never changes anything inside it: an agent may
 * have put a link anywhere there. On the server's own computer every organization's runner has a folder and a
 * group of its own, so nothing crosses between organizations.
 *
 * Single-user mode (every agent as the person's own user): `<workspace>/shared`, nothing more to it.
 */
export const SHARED_ROOT = "/srv/agentes";
export const SHARED_DIR = `${SHARED_ROOT}/shared`;
export const SHARED_GROUP = "agentes-shared";
/** Each agent's link to it, in its home (system mode): the shell, the desktop and its `bin/` go through it. */
export const SHARED_LINK = "shared";
/**
 * System mode: the env var holding the agent's shared `bin/`, which is never on its PATH. The runner's own launches
 * (`resolveCommand`) never look there either: a `claude` another agent put there would run with this agent's sign-in.
 */
export const SHARED_BIN_ENV = "AGENTES_SHARED_BIN";

export interface SharedSpec {
  path: string;
  /** System mode: the group of the agents' users. */
  group?: string;
}

/** On the server's own computer, each organization's runner's group: this and its `id8`. */
const ORG_SHARED_GROUP = "agentes-sh-";

/** System mode's folder and group; `id8` on the server's own computer (one per organization's runner). */
export const systemShared = (id8?: string): Required<SharedSpec> =>
  id8
    ? { path: `${SHARED_ROOT}/shared-${id8}`, group: `${ORG_SHARED_GROUP}${id8}` }
    : { path: SHARED_DIR, group: SHARED_GROUP };

/** Whether a group is one organization's runner's on the server's own computer (`systemShared` with an `id8`). */
export const isOrgSharedGroup = (name: string) => name.startsWith(ORG_SHARED_GROUP);

const ACL = "g:%g:rwx,d:g:%g:rwX,d:m::rwX,d:o::-";

/**
 * Makes system mode's folder as root: the group, the folder (2770, root and the group) with its ACLs, and `bin/`
 * where there is none (with a umask that leaves it the group's, never a chmod inside the folder). Without
 * `setfacl` (the `acl` package) it still works, but what an agent makes there is the group's to read only, until
 * it says otherwise (`chmod g+w`). Returns what went wrong, for the log; nothing when all is set.
 */
export function ensureSystemShared(spec: Required<SharedSpec>, run: RunCommand = runSync): string[] {
  const problems: string[] = [];
  const step = (file: string, args: string[]) => {
    const r = run(file, args);
    if (r.code !== 0) problems.push(`${file} failed (${r.code}): ${r.output.slice(0, 200)}`);
    return r.code === 0;
  };
  if (!step("groupadd", ["--system", "-f", spec.group])) return problems;
  if (!step("install", ["-d", "-m", "0755", "-o", "root", "-g", "root", path.dirname(spec.path)])) return problems;
  if (!step("install", ["-d", "-m", "2770", "-o", "root", "-g", spec.group, spec.path])) return problems;
  step("setfacl", ["-m", ACL.replaceAll("%g", spec.group), spec.path]);
  step("sh", ["-c", 'umask 007 && mkdir -p -- "$1"', "sh", path.join(spec.path, "bin")]);
  return problems;
}

/** Single-user mode's folder, made where missing. */
export function ensureSingleShared(workspaceReal: string): string {
  const dir = path.join(workspaceReal, "shared");
  mkdirSync(path.join(dir, "bin"), { recursive: true });
  return dir;
}

/**
 * An agent's user joins the shared folder (system mode, at its first request after the runner starts): the group,
 * for its next processes, and the link in its home, made as the agent itself (root never writes where the agent
 * may have put a link). A home that already has something by that name keeps it. Errors are the caller's to log.
 */
export function joinShared(user: string, home: string, spec: Required<SharedSpec>, run: RunCommand = runSync) {
  const problems: string[] = [];
  const g = run("usermod", ["-aG", spec.group, user]);
  if (g.code !== 0) problems.push(`usermod failed (${g.code}): ${g.output.slice(0, 200)}`);
  run("/usr/sbin/runuser", ["-u", user, "--", "ln", "-s", spec.path, path.join(home, SHARED_LINK)]);
  return problems;
}

/**
 * `access` with the shared folder granted to every agent (ADR 0115), unless it already is. First, since the server
 * keeps only the first `ACCESS_LIMITS.folders` of a report.
 */
export function withShared(access: RunnerAccess, shared: string | null): RunnerAccess {
  if (!shared || (access.folders[0]?.path === shared && access.folders[0].agents.includes(ALL_AGENTS))) return access;
  return {
    ...access,
    folders: [{ path: shared, agents: [ALL_AGENTS] }, ...access.folders.filter((f) => f.path !== shared)],
  };
}

const execFileAsync = promisify(execFile);

/** How often the shared folder's size is measured: `du` walks every file there. */
export const SHARED_SIZE_MS = 3600_000;

/** `du -sk`'s total in GB (one decimal); null when it printed none. */
export function duGb(stdout: string): number | null {
  const kb = Number.parseInt(stdout.trim(), 10);
  return Number.isFinite(kb) ? Math.round((kb / 2 ** 20) * 10) / 10 : null;
}

/** The folder's size in GB, measured at the lowest priority; null where it can't be (Windows). */
export async function sharedSizeGb(dir: string): Promise<number | null> {
  if (process.platform === "win32") return null;
  try {
    const { stdout } = await execFileAsync("nice", ["-n", "19", "du", "-sk", dir], { timeout: 10 * 60_000 });
    return duGb(stdout);
  } catch (err) {
    // du exits 1 for what it couldn't read (another agent's private file) and still prints the total of the rest.
    const out = (err as { stdout?: unknown }).stdout;
    return typeof out === "string" ? duGb(out) : null;
  }
}
