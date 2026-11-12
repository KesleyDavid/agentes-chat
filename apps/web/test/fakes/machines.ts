/**
 * Test fake — connected computers (ADR 0025, ADR 0036). Mirrors
 * apps/server/src/routes/machines.ts:
 * - `GET    …/machines` → `{ machines: Machine[] }`
 * - `PATCH  …/machines/{id}` `{ name }`, `DELETE …/machines/{id}`
 * - `GET    …/machines/host` → `{ machineId, on }` (404 = `null`: no computer of the server's own here);
 * - `GET    …/computer-setup` → `{ mode, state, step, reason, … }` (`pair` unless a test calls `setSetup()`);
 *   `POST …/machines/host` → `{ machineId, on: true }`
 * - `GET    /api/app/machines/device/{userCode}` → the computer that made the code (404 once gone)
 * - `POST   …/organizations/{orgId}/machines/device/{userCode}/confirm` `{ name? }` → 201, the machine
 *   (the same one when the code's `reconnect` names a machine of that organization)
 * - `POST   /api/app/machines/device/{userCode}/deny` → 204
 * - `POST   …/machines/{id}/access/reduce` `{ removeFolder?, disableTool? }` → the new access
 * - `GET    /api/desktop/latest?target=&arch=` → the release, or 404 (`null`)
 * - `GET    …/machines/outages` → `{ outages, targets }` (offline computers agents wait for)
 * - `GET    …/machines/{id}/queue` → the computer's line (`setQueue()`; nothing working or waiting by default)
 * - `POST   …/machines/{id}/move-agents` `{ agentIds, target }` → `{ moved, skipped, resumed, stillWaiting }`
 * - `POST   …/machines/{id}/account-logins` `{ kind }` → 201 `{ loginId, kind, url, publicKey? | userCode?, expiresAt }`
 * - `POST   …/account-logins/{loginId}/code` `{ box }` → 204; `GET …/account-logins/{loginId}` → `{ state, account? }`
 * - `DELETE …/account-logins/{loginId}` → 204
 * - `POST   …/ai-accounts/refresh` → 202 (the usage arrives later as `machine.updated`; nothing here)
 * - `GET    …/ai-accounts` → what `setAiAccounts()` set (none by default); `PATCH`/`DELETE …/accounts/{id}`
 *   rename or drop one of them
 * - `POST   …/account-logins` `{ kind, provider }` → a coding plan's key: no sign-in page but the plan's own
 * Sign-ins wait until a test calls `endLogin()`.
 * Tests add machines with `pair()`, codes with `addDevice()`, a release with `setRelease()`, outages with
 * `setOutages()` and the move's answer with `setMoveResult()`. No machines, codes, release or outages by default.
 */
import type {
  AccountLoginStatus,
  AiAccounts,
  ApiClient,
  ComputerQueue,
  ComputerSetup,
  DesktopRelease,
  DeviceRequest,
  HostComputer,
  Machine,
  MachineAccountKind,
  MachineOutages,
  MoveAgentsResult,
  SecretBox,
} from "@agenteschat/client";
import { ApiError } from "@agenteschat/client";
import { isPlanId, planOf } from "@agenteschat/client/lib/plans";
import { clone, type MockContext, MockNotFoundError } from "./context";

export interface FakeMachines {
  client: ApiClient["machines"];
  /** The computer connected (the device flow finished on the server): a new machine, online. */
  pair(input: Partial<Machine> & { name: string }): Machine;
  /** The stored machine (for the sandbox fake's `target`). */
  peek(id: string): Machine | undefined;
  /** Agents moved onto or off a machine. */
  setAgents(id: string, agents: Machine["agents"]): void;
  /** What the machine reports (pause, access) changes. */
  patch(id: string, patch: Partial<Machine>): void;
  all(): Machine[];
  /** A computer asked for a code (`POST /api/machines/device`). */
  addDevice(userCode: string, input?: Partial<DeviceRequest>): DeviceRequest;
  /** The newest desktop build; `null` = none (404). With `targets`, only those systems have it (`darwin`, `windows`, `linux`). */
  /** `targets`: the builds that have it (`darwin`, `windows`, `linux`, `windows-arm64`, `linux-arm64`); all when unset. */
  setRelease(release: DesktopRelease | null, targets?: string[]): void;
  /** Offline computers and where their agents could go. */
  setOutages(outages: MachineOutages): void;
  /** A computer's line (`queue`); unset: nothing working or waiting on it. */
  setQueue(queue: ComputerQueue): void;
  /** What `moveAgents` answers (default: every agent moved, nothing else). */
  setMoveResult(result: MoveAgentsResult | null): void;
  /** The server's own computer in the organization; `null` (default): it has none. */
  setHost(state: HostComputer | null): void;
  /** How far the workspace's own computer is (ADR 0056 §10); the default is `pair` (people connect theirs). */
  setSetup(setup: Partial<ComputerSetup>): void;
  /** The newest sign-in started (ADR 0041), with the code box sent for it, if any. */
  lastLogin(): { loginId: string; kind: MachineAccountKind; box: SecretBox | null; cancelled: boolean } | undefined;
  /** Every sign-in started, oldest first. */
  logins(): { loginId: string; kind: MachineAccountKind; box: SecretBox | null; cancelled: boolean }[];
  /** The computer finished (or gave up on) a sign-in. */
  endLogin(loginId: string, status: AccountLoginStatus): void;
  /** What "Contas de IA" lists. */
  setAiAccounts(view: AiAccounts): void;
}

let seq = 0;

const gone = () => new ApiError(404, "machine.device_not_found", "This code expired or was already used");

export function createFakeMachines(ctx: MockContext, log: (method: string, ...args: unknown[]) => void): FakeMachines {
  const machines: Machine[] = [];
  const devices = new Map<string, DeviceRequest>();
  let release: DesktopRelease | null = null;
  let releaseTargets: string[] | undefined;
  let outages: MachineOutages = { outages: [], targets: [] };
  const queues = new Map<string, ComputerQueue>();
  let moveResult: MoveAgentsResult | null = null;
  let host: HostComputer | null = null;
  const PAIR: ComputerSetup = {
    mode: "pair",
    state: null,
    step: null,
    reason: null,
    since: null,
    requestedAt: null,
    expectedReadyAt: null,
    secondsLeft: null,
    secondsWaited: null,
    notifyByEmail: false,
    specs: null,
    machineId: null,
  };
  let setup: ComputerSetup = PAIR;
  type Login = { loginId: string; kind: MachineAccountKind; box: SecretBox | null; cancelled: boolean };
  let ai: AiAccounts = { accounts: [], computers: [] };
  const logins: Login[] = [];
  const loginStatus = new Map<string, AccountLoginStatus>();
  const login = (loginId: string) => {
    const l = logins.find((x) => x.loginId === loginId && !x.cancelled);
    if (!l) throw new MockNotFoundError("Login não encontrado.");
    return l;
  };
  const find = (id: string) => {
    const m = machines.find((x) => x.id === id);
    if (!m) throw new MockNotFoundError("Computador não encontrado.");
    return m;
  };
  const device = (userCode: string) => {
    const d = devices.get(userCode);
    if (!d || Date.parse(d.expiresAt) <= ctx.now().getTime()) throw gone();
    return d;
  };
  const pair: FakeMachines["pair"] = (input) => {
    const m: Machine = {
      id: `00000000-0000-4000-8000-0000000009${String(++seq).padStart(2, "0")}`,
      online: true,
      lastSeenAt: ctx.now().toISOString(),
      hostname: "office-1",
      os: "linux",
      arch: "x64",
      runnerVersion: "0.1.0",
      execAllowed: true,
      pairedBy: { id: "u-walter", name: "Walter" },
      agents: [],
      workspace: "/home/runner/agentes",
      canManage: true,
      createdAt: ctx.now().toISOString(),
      ...input,
    };
    machines.push(m);
    return clone(m);
  };
  return {
    client: {
      list: async () => clone(machines),
      rename: async (orgId, machineId, name) => {
        log("machines.rename", orgId, machineId, name);
        const m = find(machineId);
        m.name = name;
        return { id: m.id, name };
      },
      remove: async (orgId, machineId) => {
        log("machines.remove", orgId, machineId);
        find(machineId);
        // The server's own computer is only stopped here: it can come back.
        if (host?.machineId === machineId) host = { ...host, on: false };
        machines.splice(
          machines.findIndex((m) => m.id === machineId),
          1,
        );
      },
      host: async () => clone(host),
      computerSetup: async () => clone(setup),
      hostOn: async (orgId) => {
        log("machines.hostOn", orgId);
        if (!host) throw new MockNotFoundError("Sem computador deste servidor.");
        host = { ...host, on: true };
        return clone(host);
      },
      device: async (userCode) => {
        log("machines.device", userCode);
        return clone(device(userCode));
      },
      confirmDevice: async (orgId, userCode, input) => {
        log("machines.confirmDevice", orgId, userCode, input);
        const d = device(userCode);
        devices.delete(userCode);
        // A reconnect in the same organization brings back the same machine (name kept).
        const back = d.reconnect?.orgId === orgId ? machines.find((m) => m.id === d.reconnect?.machineId) : undefined;
        if (back) {
          Object.assign(back, { online: true, hostname: d.hostname, runnerVersion: d.version });
          return clone(back);
        }
        // A new computer gets no agents until someone points one at it.
        return pair({
          name: input.name ?? d.name,
          os: d.os,
          arch: d.arch,
          hostname: d.hostname,
          runnerVersion: d.version,
        });
      },
      denyDevice: async (userCode) => {
        log("machines.denyDevice", userCode);
        device(userCode);
        devices.delete(userCode);
      },
      reduceAccess: async (orgId, machineId, input) => {
        log("machines.reduceAccess", orgId, machineId, input);
        const m = find(machineId);
        const access = m.access ?? { folders: [], tools: { claude: false, codex: false, commands: false } };
        const remove = input.removeFolder;
        const folders = remove
          ? access.folders.flatMap((f) => {
              if (f.path !== remove.path) return [f];
              const agentId = remove.agentId;
              return agentId ? [{ ...f, agents: f.agents.filter((a) => a !== agentId) }] : [];
            })
          : access.folders;
        const tools = input.disableTool ? { ...access.tools, [input.disableTool]: false } : access.tools;
        m.access = { folders, tools };
        return clone(m.access);
      },
      desktopLatest: async (target, arch) => {
        log("machines.desktopLatest", target, arch);
        const build = arch === "aarch64" && target !== "darwin" ? `${target}-arm64` : target;
        return release && (!releaseTargets || releaseTargets.includes(build)) ? clone(release) : null;
      },
      // Read on every workspace page (the notice): not logged, so tests' call lists stay as they were.
      outages: async () => clone(outages),
      // Read wherever an agent's line shows: not logged either.
      queue: async (_orgId, machineId) =>
        clone(queues.get(machineId) ?? { machineId, name: find(machineId).name, working: [], waiting: [] }),
      moveAgents: async (orgId, machineId, input) => {
        log("machines.moveAgents", orgId, machineId, input);
        return clone(moveResult ?? { moved: input.agentIds, skipped: [], resumed: 0, stillWaiting: 0 });
      },
      beginAccountLogin: async (orgId, machineId, kind, options = {}) => {
        log("machines.beginAccountLogin", orgId, machineId, kind, ...(Object.keys(options).length ? [options] : []));
        const loginId = `login_${logins.length + 1}`;
        logins.push({ loginId, kind, box: null, cancelled: false });
        const expiresAt = new Date(ctx.now().getTime() + 15 * 60_000).toISOString();
        if (kind === "codex")
          return { loginId, kind, url: "https://auth.openai.com/codex/device", userCode: "ABCD-1234", expiresAt };
        // Cursor's sign-in: its page, and the computer finishes by itself (no code).
        if (kind === "cursor" && !options.provider)
          return { loginId, kind, url: "https://cursor.com/loginDeepControl?challenge=fake", expiresAt };
        // A real one-time key, so the page can seal the code to it.
        const curve = { name: "ECDH", namedCurve: "P-256" };
        const eph = (await crypto.subtle.generateKey(curve, true, ["deriveBits"])) as CryptoKeyPair;
        const raw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
        const publicKey = btoa(String.fromCharCode(...raw));
        const plan = planOf(options.provider);
        if (plan && isPlanId(options.provider)) {
          return { loginId, kind, url: plan.site, provider: options.provider, publicKey, expiresAt };
        }
        if (kind === "cursor") {
          return {
            loginId,
            kind,
            url: "https://cursor.com/dashboard?tab=integrations",
            provider: "cursor",
            publicKey,
            expiresAt,
          };
        }
        return {
          loginId,
          kind,
          url: "https://claude.ai/oauth/authorize?code=true&state=st4te",
          publicKey,
          expiresAt,
        };
      },
      sendAccountCode: async (orgId, machineId, loginId, box) => {
        log("machines.sendAccountCode", orgId, machineId, loginId);
        login(loginId).box = box;
      },
      // Asked every 2 s while the block is open: not logged.
      accountLogin: async (_orgId, _machineId, loginId) => {
        login(loginId);
        const waiting: AccountLoginStatus = { state: "waiting" };
        return clone(loginStatus.get(loginId) ?? waiting);
      },
      cancelAccountLogin: async (orgId, machineId, loginId) => {
        log("machines.cancelAccountLogin", orgId, machineId, loginId);
        const l = logins.find((x) => x.loginId === loginId);
        if (l) l.cancelled = true;
      },
      refreshAccountUsage: async (orgId) => {
        log("machines.refreshAccountUsage", orgId);
      },
      // Read whenever an accounts screen renders: not logged.
      aiAccounts: async () => clone(ai),
      takeBackPlan: async (orgId, accountId, agentId) => {
        log("machines.takeBackPlan", orgId, accountId, agentId);
        return { agentIds: agentId ? [agentId] : [] };
      },
      renameAccount: async (orgId, machineId, accountId, label) => {
        log("machines.renameAccount", orgId, machineId, accountId, label);
        // One listed, or one a sign-in here just finished.
        const a =
          ai.accounts.find((x) => x.id === accountId) ??
          [...loginStatus.values()].find((st) => st.account?.id === accountId)?.account;
        if (!a) throw new MockNotFoundError("Conta não encontrada.");
        a.label = label;
        return clone(a);
      },
      removeAccount: async (orgId, machineId, accountId) => {
        log("machines.removeAccount", orgId, machineId, accountId);
        ai = { ...ai, accounts: ai.accounts.filter((x) => x.id !== accountId) };
      },
    },
    pair,
    peek: (id) => machines.find((m) => m.id === id),
    setAgents: (id, agents) => {
      const m = machines.find((x) => x.id === id);
      if (m) m.agents = agents;
    },
    patch: (id, patch) => {
      const m = machines.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    },
    all: () => clone(machines),
    setOutages: (next) => {
      outages = clone(next);
    },
    setQueue: (next) => {
      queues.set(next.machineId, clone(next));
    },
    setMoveResult: (next) => {
      moveResult = next;
    },
    setSetup: (next) => {
      setup = { ...PAIR, mode: "external", state: "preparing", ...next };
    },
    setHost: (next) => {
      host = clone(next);
    },
    lastLogin: () => {
      const l = logins.at(-1);
      return l ? { ...l } : undefined;
    },
    logins: () => logins.map((l) => ({ ...l })),
    endLogin: (loginId, status) => {
      loginStatus.set(loginId, status);
    },
    setAiAccounts: (view) => {
      ai = clone(view);
    },
    addDevice: (userCode, input = {}) => {
      const now = ctx.now();
      const d: DeviceRequest = {
        name: "MacBook do Walter",
        os: "darwin",
        arch: "arm64",
        hostname: "walter-mbp",
        version: "0.2.0",
        approxLocation: "Curitiba, PR, Brasil",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
        ...input,
      };
      devices.set(userCode, d);
      return clone(d);
    },
    setRelease: (r, targets) => {
      release = r;
      releaseTargets = targets;
    },
  };
}
