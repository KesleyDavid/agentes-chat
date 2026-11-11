import type { PhoneReason, PubSub } from "@agenteschat/adapters";
import { and, type Database, type Executor, eq, gt, inArray, isNull, rowsOf, schema, sql } from "@agenteschat/db";
import { getAgentCached } from "./agents";
import { accountablePerson, runAuthorityById } from "./authority";
import { caches, cachesEnabled } from "./cache";
import {
  type ComputerDevice,
  type DeviceRule,
  type DeviceStatus,
  listDevices,
  type MachinePhoneRow,
  machineRule,
  mayUseDevice,
  type PhoneDevice,
  phoneRule,
} from "./devices";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { formatDuration } from "./machine-task-text";
import { taskRequester } from "./machine-tasks";
import { notify, resolveNotifications } from "./notifications";
import { personAtComputerWay } from "./runner-update";
import { replyThreadOf } from "./runs";
import type { ToolContext, ToolOutput } from "./tools/types";

const { deviceAccessRequests, machinePhones, machines } = schema;

/**
 * Bring your own devices, the agents' side: which device a `computer` or `phone` argument names, who the agent works
 * for there (the requester), whether that person's agents may use it, and the words a tool answers with when it can't.
 */

/** The machine columns resolving and checking read. */
export const deviceComputerColumns = {
  id: machines.id,
  name: machines.name,
  kind: machines.kind,
  os: machines.os,
  pairedByUserId: machines.pairedByUserId,
  audienceMode: machines.audienceMode,
  audienceUserIds: machines.audienceUserIds,
  audienceRoleIds: machines.audienceRoleIds,
  belongsToWorkspace: machines.belongsToWorkspace,
  online: machines.online,
  lastSeenAt: machines.lastSeenAt,
};
export type DeviceComputer = {
  id: string;
  name: string;
  kind: string;
  os: string;
  pairedByUserId: string | null;
  audienceMode: "everyone" | "people" | "owner";
  audienceUserIds: string[];
  audienceRoleIds: string[];
  belongsToWorkspace: boolean;
  online: boolean;
  lastSeenAt: Date | null;
};

export interface WorkspaceDevices {
  computers: DeviceComputer[];
  phones: MachinePhoneRow[];
}

/** The workspace's computers and the phones they reach (removed ones left out). */
export async function workspaceDevices(db: Executor, orgId: string): Promise<WorkspaceDevices> {
  const [computers, phones] = await Promise.all([
    db
      .select(deviceComputerColumns)
      .from(machines)
      .where(and(eq(machines.orgId, orgId), isNull(machines.deletedAt))),
    db
      .select()
      .from(machinePhones)
      .where(and(eq(machinePhones.orgId, orgId), isNull(machinePhones.deletedAt))),
  ]);
  return { computers, phones };
}

/** What a device argument named. */
export type DevicePick<T> = { ok: true; item: T } | { ok: false; message: string };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * One device by what an agent called it: its id, then its name as is (any case, also `aliases`: a phone's model or
 * serial), then the one name starting with it. Several or none: why, with the names to choose from.
 */
export function pickDevice<T extends { id: string; name: string }>(
  items: T[],
  arg: string,
  what: "computer" | "phone" | "device",
  aliases: (item: T) => string[] = () => [],
): DevicePick<T> {
  const asked = norm(arg);
  const names = (list: T[]) => list.map((i) => `"${i.name}"`).join(", ");
  const plural = `${what}s`;
  if (!asked) return { ok: false, message: `Name the ${what} (its name, as ${listText(items, plural)}).` };
  const byId = items.find((i) => i.id === arg.trim());
  if (byId) return { ok: true, item: byId };
  const exact = items.filter((i) => norm(i.name) === asked || aliases(i).some((a) => norm(a) === asked));
  const prefixed = exact.length > 0 ? exact : items.filter((i) => norm(i.name).startsWith(asked));
  const [only] = prefixed;
  if (only && prefixed.length === 1) return { ok: true, item: only };
  if (prefixed.length > 1)
    return {
      ok: false,
      message: `"${arg.trim()}" matches several ${plural}: ${names(prefixed)}. Ask the person which one, or use its exact name.`,
    };
  return { ok: false, message: `No ${what} is called "${arg.trim()}". ${capitalize(listText(items, plural))}.` };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const listText = (items: { name: string }[], plural: string) =>
  items.length === 0
    ? `the workspace has no ${plural}`
    : `the workspace's ${plural}: ${items
        .slice(0, 20)
        .map((i) => `"${i.name}"`)
        .join(", ")}`;

/** A phone's other names an agent may use: its model and its serial. */
export const phoneAliases = (p: MachinePhoneRow) => [p.model, p.serial].filter(Boolean);

/**
 * Whom the agent works for on a device: the person behind the message (a hand-off's root person), a woken task's or
 * mission's requester, a routine's creator, else the agent's owner.
 */
export async function deviceRequester(ctx: ToolContext): Promise<string | null> {
  const person = await taskRequester(ctx).catch(() => null);
  if (person) return person;
  const routine = accountablePerson(await runAuthorityById(ctx.db, ctx.orgId, ctx.runId));
  if (routine) return routine;
  return (await getAgentCached(ctx.db, ctx.orgId, ctx.agentId))?.ownerUserId ?? null;
}

/** First names, as the agent says them ("Sam"). */
export async function firstNames(db: Executor, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name.trim().split(/\s+/)[0] || r.name]));
}

/** "Sam's Pixel 8"; a name that already says whose ("Ana's iPhone") stays as is. */
export const ownedName = (name: string, owner: string | null | undefined) =>
  !owner || /['’]s\b/i.test(name) ? name : `${owner}'s ${name}`;

/** "12 min ago", or "never" when it was never seen. */
export function seenAgo(at: Date | string | null | undefined, now = new Date()) {
  if (!at) return "never seen";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(at).getTime()) / 1000));
  return `last seen ${formatDuration(seconds)} ago`;
}

/** A device being checked: a computer, or a phone and its host. */
export type DeviceTarget =
  | { kind: "computer"; computer: DeviceComputer }
  | { kind: "phone"; phone: MachinePhoneRow; host: DeviceComputer | null };

export const targetName = (t: DeviceTarget) => (t.kind === "computer" ? t.computer.name : t.phone.name);
export const targetMachineId = (t: DeviceTarget) =>
  t.kind === "computer" ? t.computer.id : (t.phone.machineId ?? t.host?.id ?? null);

export function targetRule(t: DeviceTarget): DeviceRule {
  if (t.kind === "computer") return machineRule(t.computer);
  return phoneRule(t.phone, t.host ? machineRule(t.host) : null);
}

/** How long an access request waits for the device's owner. */
export const ACCESS_REQUEST_MS = 24 * 3600_000;

export type UseCheck =
  | { ok: true; requester: string | null }
  | { ok: false; requester: string | null; message: string; requestId?: string };

/**
 * Whether the run's agent may use this device for its requester: always on its own computer (its home), else the
 * device's rule (an iPhone's is its host's) or an access the owner granted. Not allowed: the owner is asked once
 * (`device_access_requests`, and a `device.access_request` notification), and the answer says so.
 */
export async function checkDeviceUse(
  deps: { db: Database; pubsub?: PubSub },
  ctx: ToolContext,
  target: DeviceTarget,
  why = "",
): Promise<UseCheck> {
  const requester = await deviceRequester(ctx);
  const agent = await getAgentCached(ctx.db, ctx.orgId, ctx.agentId);
  if (target.kind === "computer" && agent?.machineId === target.computer.id) return { ok: true, requester };
  const rule = targetRule(target);
  const allowed = requester
    ? await mayUseDevice(ctx.db, ctx.orgId, requester, rule, { runId: ctx.runId })
    : rule.audience.mode === "everyone" || (rule.ownerUserId === null && rule.belongsToWorkspace);
  if (allowed) return { ok: true, requester };
  const owner = rule.ownerUserId;
  const names = await firstNames(ctx.db, [owner, requester]);
  const ownerName = owner ? (names.get(owner) ?? "its owner") : null;
  const forWhom = requester ? (names.get(requester) ?? "the person you work for") : "this run";
  const name = ownedName(targetName(target), ownerName);
  const ruleText =
    rule.audience.mode === "owner" ? `set to Only ${ownerName ?? "its owner"}` : "shared with some people only";
  if (!owner || !requester) {
    return {
      ok: false,
      requester,
      message: `${name} is ${ruleText}, not for ${forWhom}. Nobody can be asked for it: an admin can change who uses it under Settings › Devices. Use another device.`,
    };
  }
  const requestId = await askDeviceOwner(deps, ctx, target, { owner, requester, why, requesterName: forWhom });
  return {
    ok: false,
    requester,
    requestId,
    message: `${name} is ${ruleText}, so you can't use it for ${forWhom}. ${ownerName} was asked to let you (they answer Allow once, Always or No). Tell the person, then call wait_for_device("${targetName(target)}") to start by yourself if they say yes, or use another device.`,
  };
}

/**
 * Tells a device's owner that someone else's agent is using it (`device.in_use`): once per run and device, never for
 * the owner's own agents nor on the agent's own computer.
 */
export async function noteDeviceInUse(
  deps: { db: Database; pubsub?: PubSub },
  ctx: ToolContext,
  target: DeviceTarget,
  requester: string | null,
  label?: string,
) {
  const owner = targetRule(target).ownerUserId;
  if (!owner || owner === requester) return;
  if (
    target.kind === "computer" &&
    (await getAgentCached(ctx.db, ctx.orgId, ctx.agentId))?.machineId === target.computer.id
  )
    return;
  const deviceId = target.kind === "computer" ? target.computer.id : target.phone.id;
  const machineId = targetMachineId(target);
  const names = await firstNames(ctx.db, [requester]);
  const thread = replyThreadOf(ctx);
  await notify(deps, {
    orgId: ctx.orgId,
    userIds: [owner],
    kind: "device.in_use",
    groupKey: `device-in-use:${ctx.runId}:${deviceId}`,
    actor: { type: "agent", id: ctx.agentId },
    source: {
      channelId: ctx.channelId,
      ...(thread ? { threadId: thread } : {}),
      ...(machineId ? { machineId } : {}),
      ...(target.kind === "phone" ? { phoneId: target.phone.id } : {}),
      ...(requester ? { userId: requester } : {}),
      runId: ctx.runId,
      label: targetName(target),
    },
    latest: { ...(requester ? { title: names.get(requester) } : {}), ...(label ? { text: label } : {}) },
  }).catch(() => undefined);
}

/** The owner's pending request for this person on this device, or a new one (and its notification). */
async function askDeviceOwner(
  deps: { db: Database; pubsub?: PubSub },
  ctx: ToolContext,
  target: DeviceTarget,
  input: { owner: string; requester: string; why: string; requesterName: string },
): Promise<string> {
  const now = new Date();
  const machineId = targetMachineId(target);
  const phoneId = target.kind === "phone" ? target.phone.id : null;
  const [open] = await ctx.db
    .select({ id: deviceAccessRequests.id })
    .from(deviceAccessRequests)
    .where(
      and(
        eq(deviceAccessRequests.orgId, ctx.orgId),
        eq(deviceAccessRequests.requesterUserId, input.requester),
        eq(deviceAccessRequests.status, "pending"),
        phoneId ? eq(deviceAccessRequests.phoneId, phoneId) : eq(deviceAccessRequests.machineId, machineId ?? ""),
        gt(deviceAccessRequests.expiresAt, now),
      ),
    )
    .limit(1);
  if (open) return open.id;
  const [row] = await ctx.db
    .insert(deviceAccessRequests)
    .values({
      orgId: ctx.orgId,
      machineId,
      phoneId,
      requesterUserId: input.requester,
      agentId: ctx.agentId,
      runId: ctx.runId,
      reason: input.why.slice(0, 300),
      expiresAt: new Date(now.getTime() + ACCESS_REQUEST_MS),
    })
    .returning({ id: deviceAccessRequests.id });
  if (!row) throw new Error("device_access_requests insert returned nothing");
  await notify(deps, {
    orgId: ctx.orgId,
    userIds: [input.owner],
    kind: "device.access_request",
    groupKey: `device-access:${row.id}`,
    waiting: true,
    actor: { type: "agent", id: ctx.agentId },
    source: {
      channelId: ctx.channelId,
      threadId: replyThreadOf(ctx) ?? undefined,
      ...(machineId ? { machineId } : {}),
      ...(phoneId ? { phoneId } : {}),
      requestId: row.id,
      userId: input.requester,
      runId: ctx.runId,
      label: targetName(target),
    },
    latest: { title: input.requesterName, ...(input.why ? { text: input.why } : {}) },
  }).catch(() => undefined);
  return row.id;
}

/** What to tell the person for a phone that needs them, by its reason (`PhoneReason`), and whether it ends by itself. */
export function phoneReasonText(
  reason: PhoneReason | string | null,
  phone: string,
  host: string,
): { text: string; byItself: boolean } {
  switch (reason) {
    case "locked":
      return { text: `${phone} is connected but locked. Ask the person to unlock it.`, byItself: false };
    case "unauthorized":
      return {
        text: `${phone} doesn't allow USB debugging from ${host} yet. Ask the person to tap Allow on the phone ("Allow USB debugging?", with "Always allow from this computer").`,
        byItself: false,
      };
    case "untrusted":
      return {
        text: `${phone} doesn't trust ${host} yet. Ask the person to unlock it and tap Trust.`,
        byItself: false,
      };
    case "developer_mode_off":
      return {
        text: `${phone} needs Developer Mode: Settings → Privacy & Security → Developer Mode, then restart. Ask the person to turn it on.`,
        byItself: false,
      };
    case "ui_automation_off":
      return {
        text: `${phone} needs UI Automation: Settings → Developer → Enable UI Automation. Ask the person to turn it on.`,
        byItself: false,
      };
    case "xcode_missing":
      return { text: `${host} has no Xcode. Ask the person to install it from the App Store.`, byItself: false };
    case "xcode_too_old":
      return {
        text: `${phone} runs an iOS newer than Xcode on ${host} can drive. Ask the person to install the Xcode matching the iPhone's iOS (27 for iOS 27), then run \`xcrun devicectl manage ddis update\`.`,
        byItself: false,
      };
    case "helper_missing":
      return {
        text: `${host} is still setting up the test helper on ${phone} (a few minutes the first time).`,
        byItself: true,
      };
    case "helper_expired":
      return { text: `${host} is renewing the test helper on ${phone} (its free signature ran out).`, byItself: true };
    case "apple_account_missing":
      return {
        text: `I couldn't set up the test helper on ${phone}: Xcode on ${host} isn't signed in to an Apple Account. Ask the person to sign in under Xcode → Settings → Apple Accounts (a free one is enough).`,
        byItself: false,
      };
    case "apple_team_missing":
      return {
        text: `I couldn't set up the test helper on ${phone}: Xcode on ${host} is signed in but shows no team yet. Ask the person to make any iOS app in Xcode, pick their team under Signing & Capabilities and run it on the iPhone once.`,
        byItself: false,
      };
    case "ui_not_authorized":
      return {
        text: `${phone} refused the test helper's taps. Ask the person to unlock it and enter its passcode if it asks, and if it keeps happening to turn Settings → Developer → Enable UI Automation off and on.`,
        byItself: false,
      };
    case "team_limit":
      return {
        text: `The free Apple Account on ${host} has reached its limit of apps on ${phone}. Ask the person to remove an app they built themselves from it.`,
        byItself: false,
      };
    case "helper_untrusted":
      return {
        text: `${phone} doesn't trust the test helper yet. Ask the person to trust the developer on it: Settings → General → VPN & Device Management.`,
        byItself: false,
      };
    case "no_driver":
      return {
        text: `Windows doesn't see ${phone} on ${host}. Ask the person to install the phone maker's USB driver.`,
        byItself: false,
      };
    case "adb_offline":
      return {
        text: `${phone} isn't answering ${host} (it may be restarting). Ask the person to plug it in again.`,
        byItself: false,
      };
    case "booting":
      return { text: `${phone} is still starting.`, byItself: true };
    case "device_support":
      return { text: `${host} is preparing ${phone} (it downloads what Xcode needs for it).`, byItself: true };
    case "os_too_old":
      return {
        text: `${phone} runs a system too old for the testing tools (an iPhone needs iOS 17 or newer). Use another phone.`,
        byItself: false,
      };
    default:
      return { text: `${phone} isn't ready${reason ? ` (${reason})` : ""}.`, byItself: false };
  }
}

/** The way back the agent is told when it should wait for a device. */
export const waitHint = (name: string) =>
  `Call wait_for_device("${name}") to start by yourself when it's ready, or use another device (computer_status lists them).`;

/** A person decided an access request (the device's owner only): `once` (this run, a day), `always` (joins its rule), `no`. */
export async function decideDeviceAccess(
  deps: { db: Database; pubsub?: PubSub },
  actorId: string,
  orgId: string,
  requestId: string,
  decision: "once" | "always" | "no",
): Promise<{
  status: "once" | "always" | "denied";
  runId: string | null;
  machineId: string | null;
  phoneId: string | null;
}> {
  const [row] = await deps.db
    .select()
    .from(deviceAccessRequests)
    .where(and(eq(deviceAccessRequests.orgId, orgId), eq(deviceAccessRequests.id, requestId)));
  if (!row) throw new NotFoundError("Access request not found");
  const [phone] = row.phoneId
    ? await deps.db.select().from(machinePhones).where(eq(machinePhones.id, row.phoneId))
    : [];
  const [host] = row.machineId
    ? await deps.db.select(deviceComputerColumns).from(machines).where(eq(machines.id, row.machineId))
    : [];
  const rule = phone ? phoneRule(phone, host ? machineRule(host) : null) : host ? machineRule(host) : null;
  if (!rule) throw new NotFoundError("That device is gone");
  if (rule.ownerUserId !== actorId) throw new ForbiddenError("Only the device's owner can answer this");
  if (row.status !== "pending") throw new ValidationError("This request was already answered");
  const status = decision === "no" ? "denied" : decision;
  await deps.db
    .update(deviceAccessRequests)
    .set({ status, decidedByUserId: actorId, decidedAt: new Date() })
    .where(eq(deviceAccessRequests.id, row.id));
  if (decision === "always") {
    // The requester joins the rule the owner reads (the phone's own, or for an iPhone its host's).
    const followsHost = phone ? phone.followsHost : true;
    const table = phone && !followsHost ? machinePhones : machines;
    const id = phone && !followsHost ? phone.id : (host?.id ?? "");
    const users = [...new Set([...rule.audience.userIds, row.requesterUserId])];
    if (rule.audience.mode !== "everyone") {
      await deps.db
        .update(table)
        .set({ audienceMode: "people", audienceUserIds: users, audienceRoleIds: rule.audience.roleIds })
        .where(eq(table.id, id));
    }
  }
  await resolveNotifications(deps, orgId, { groupKey: `device-access:${row.id}` }).catch(() => 0);
  return { status, runId: row.runId, machineId: row.machineId, phoneId: row.phoneId };
}

/** Whether the workspace has a device besides this computer: the `computer` argument is offered then. */
/** The workspace's devices by name, for the prompt and the tool lists (`deviceRoster`). */
export interface DeviceRoster {
  computers: { id: string; name: string; os: string }[];
  phones: { id: string; name: string; platform: string }[];
}

async function loadRoster(db: Executor, orgId: string): Promise<DeviceRoster> {
  const rows = rowsOf<{ kind: string; id: string; name: string; os: string }>(
    await db.execute(sql`select 'computer' as kind, m.id::text as id, m.name, m.os from machines m
      where m.org_id = ${orgId}::uuid and m.deleted_at is null
      union all
      select 'phone', p.id::text, p.name, p.platform from machine_phones p
      where p.org_id = ${orgId}::uuid and p.deleted_at is null`),
  );
  return {
    computers: rows.filter((r) => r.kind === "computer").map(({ id, name, os }) => ({ id, name, os })),
    phones: rows.filter((r) => r.kind === "phone").map(({ id, name, os }) => ({ id, name, platform: os })),
  };
}

/**
 * The workspace's computers and phones by name, in one statement that a run's prompt and its tool lists share
 * (`caches.deviceRoster`, a few seconds). Picking a device for an op reads `workspaceDevices` fresh instead.
 */
export function deviceRoster(db: Executor, orgId: string): Promise<DeviceRoster> {
  if (!cachesEnabled()) return loadRoster(db, orgId);
  const key = `${orgId}:roster`;
  const hit = caches.deviceRoster.get(key) as Promise<DeviceRoster> | undefined;
  if (hit) return hit;
  const loading = loadRoster(db, orgId);
  caches.deviceRoster.set(key, loading);
  loading.catch(() => caches.deviceRoster.delete(key));
  return loading;
}

/** Whether the roster has a phone, and a device besides `machineId` (the agent's own computer). */
export const rosterFacts = (roster: DeviceRoster, machineId: string | null) => {
  const phones = roster.phones.length > 0;
  return { phones, others: phones || roster.computers.some((c) => c.id !== machineId) };
};

/** "macOS", "Windows", "Linux", or the word the runner said. */
export const osName = (os: string) =>
  ({ darwin: "macOS", windows: "Windows", linux: "Linux", android: "Android", ios: "iOS" })[os] ?? os;

function statusWords(s: DeviceStatus, people: Map<string, string>) {
  switch (s.kind) {
    case "ready":
      return "ready";
    case "in_use": {
      const who = s.agentName ?? "an agent";
      const forWhom = s.userName ?? (s.userId ? people.get(s.userId) : undefined);
      return `in use by ${who}${forWhom ? ` for ${forWhom}` : ""}${s.label ? ` (${s.label})` : ""}, since ${seenAgo(s.since).replace("last seen ", "")}`;
    }
    case "busy":
      return `busy (${s.running} of ${s.max} tasks running)`;
    case "needs_you":
      return `needs its person (${s.reason})`;
    case "preparing":
      return `getting ready (${s.reason})`;
    case "paused":
      return `paused by its owner${s.until ? ` until ${s.until}` : ""}`;
    case "offline":
      return `${s.withHost ? "offline with its computer" : "offline"} (${seenAgo(s.lastSeenAt)})`;
    case "unsupported":
      return `can't be used (${s.reason})`;
  }
}

function phoneLine(p: PhoneDevice, people: Map<string, string>) {
  const kind = p.phoneKind === "device" ? "" : ` ${p.phoneKind}`;
  const system = `${p.platform === "ios" ? "iOS" : "Android"}${p.osVersion ? ` ${p.osVersion}` : ""}`;
  const model = p.model && p.model !== p.name ? `${p.model}, ` : "";
  return `"${p.name}" (${model}${system}${kind}): ${statusWords(p.status, people)}`;
}

/** The switches agents' tools need on a computer, as people call them. */
const SWITCHES = { commands: "shell commands", claude: "Claude Code", codex: "Codex" } as const;

/** Which of those switches are off. */
export const switchesOff = (on: Record<keyof typeof SWITCHES, boolean>) =>
  (Object.keys(SWITCHES) as (keyof typeof SWITCHES)[])
    .filter((key) => !on[key])
    .map((key) => ({ key, name: SWITCHES[key] }));

/**
 * "Off there: …" for a computer, from its runner's last report, and who turns them on: what an agent would otherwise
 * learn only by failing. A coding CLI never found there has nothing to turn on.
 */
export function offThereText(m: {
  os: string;
  execAllowed: boolean;
  access: { tools: { claude: boolean; codex: boolean } } | null;
  executors: { claude?: unknown; codex?: unknown; mode?: string };
}) {
  const tools = m.access?.tools;
  const off = switchesOff({
    commands: m.execAllowed,
    claude: !tools || !m.executors.claude || tools.claude,
    codex: !tools || !m.executors.codex || tools.codex,
  });
  if (off.length === 0) return "";
  return `Off there: ${off.map((s) => s.name).join(", ")}. Only the person at it can turn ${off.length > 1 ? "them" : "it"} on, ${personAtComputerWay(
    m,
    "Tools",
    off.map((s) => `tools enable ${s.key}`),
  )}.`;
}

/** `offThereText` of each of the workspace's computers. Not in `listDevices`: its access is for admins and the pairer. */
async function offThere(db: Database, orgId: string) {
  const rows = await db
    .select({
      id: machines.id,
      os: machines.os,
      execAllowed: machines.execAllowed,
      access: machines.access,
      executors: machines.executors,
    })
    .from(machines)
    .where(and(eq(machines.orgId, orgId), isNull(machines.deletedAt)));
  return new Map(rows.map((m) => [m.id, offThereText(m)]));
}

function computerLine(d: ComputerDevice, people: Map<string, string>, requester: string | null, off = "") {
  const size = [d.cpus ? `${d.cpus} CPUs` : "", d.memoryGb ? `${d.memoryGb} GB` : ""].filter(Boolean).join(", ");
  const facts = [osName(d.os), d.arch, size].filter(Boolean).join(" ");
  const owner =
    d.machineKind === "managed"
      ? "the workspace's own computer"
      : !d.ownerUserId
        ? "the workspace's"
        : d.ownerUserId === requester
          ? "theirs"
          : `${people.get(d.ownerUserId) ?? "someone"}'s`;
  const tools = Object.entries(d.toolchains)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const phones = d.phones.map((p) => phoneLine(p, people));
  return [
    `- "${d.name}" (${facts}; ${owner}${d.systemMode ? "; each agent its own user" : ""}): ${statusWords(d.status, people)}.`,
    tools ? `  Tools: ${tools}.` : "",
    off ? `  ${off}` : "",
    ...phones.map((line) => `  Phone ${line}.`),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * What `computer_status` says of the other devices: every one the agent may use for the person it works for, its
 * phones nested, and which ones that person's agents may not use. `asked`: one device (a computer or a phone) only.
 */
export async function devicesForRequester(
  ctx: ToolContext,
  asked: string,
): Promise<{ text: string; only?: ToolOutput }> {
  const requester = await deviceRequester(ctx);
  if (!requester) return { text: "" };
  // Someone no longer in the workspace sees no devices.
  const all = await listDevices(ctx.db, ctx.orgId, requester).catch(() => null);
  if (!all) return { text: "" };
  const { devices } = all;
  const people = await firstNames(ctx.db, [
    requester,
    ...devices.map((d) => d.ownerUserId),
    ...devices.flatMap((d) => d.phones.map((p) => (p.status.kind === "in_use" ? p.status.userId : null))),
  ]);
  const forWhom = people.get(requester) ?? "the person you work for";
  const off = await offThere(ctx.db, ctx.orgId).catch(() => new Map<string, string>());
  if (asked.trim()) {
    const phones = devices.flatMap((d) => d.phones.map((p) => ({ ...p, host: d })));
    const found = pickDevice<{ id: string; name: string }>([...devices, ...phones], asked, "device", (i) =>
      "model" in i ? [String(i.model)] : [],
    );
    if (!found.ok) return { text: "", only: { content: found.message, isError: true } };
    const computer = devices.find((d) => d.id === found.item.id);
    const phone = phones.find((p) => p.id === found.item.id);
    const line = computer
      ? computerLine(computer, people, requester, computer.mayUse ? off.get(computer.id) : "")
      : phone
        ? `- Phone ${phoneLine(phone, people)}, on "${phone.host.name}".`
        : "";
    const may = (computer ?? phone)?.mayUse;
    return {
      text: "",
      only: {
        content: `${line}\n${may ? `You may use it for ${forWhom}.` : `It isn't shared with ${forWhom}: using it asks its owner.`}`,
      },
    };
  }
  // Its own computer is said above (`computer_status`), not listed again.
  const home = (await getAgentCached(ctx.db, ctx.orgId, ctx.agentId))?.machineId ?? null;
  const listed = devices.filter((d) => d.id !== home || d.phones.length > 0);
  const usable = listed.filter((d) => d.mayUse || d.id === home || d.phones.some((p) => p.mayUse));
  const others = listed.filter((d) => !usable.includes(d));
  if (usable.length === 0 && others.length === 0) return { text: "" };
  return {
    text: [
      `# Devices you may use for ${forWhom}`,
      ...usable.map((d) => {
        const line = computerLine(
          { ...d, phones: d.phones.filter((p) => p.mayUse) },
          people,
          requester,
          d.mayUse || d.id === home ? off.get(d.id) : "",
        );
        // A phone shared on its own grants none of its computer's commands.
        return d.mayUse || d.id === home
          ? line
          : line.replace(/\.(\n|$)/, `. Only its phones are shared with ${forWhom}.$1`);
      }),
      others.length > 0
        ? `Not shared with ${forWhom} (using one asks its owner): ${others.map((d) => `"${d.name}"`).join(", ")}.`
        : "",
      "Name a computer with `computer` on run_code, start_task and the file tools, and a phone with the phone tools' `phone`. When one isn't ready, wait_for_device starts by itself once it is.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Whether the agent's secrets may go to this computer: its own, the workspace's (nobody owns it), or one the person it
 * works for owns. Never to someone else's personal device, whose owner can read what lands there.
 */
export async function secretsMayGo(ctx: ToolContext, machineId: string): Promise<boolean> {
  if ((await getAgentCached(ctx.db, ctx.orgId, ctx.agentId))?.machineId === machineId) return true;
  const [m] = await ctx.db
    .select({ owner: machines.pairedByUserId })
    .from(machines)
    .where(and(eq(machines.orgId, ctx.orgId), eq(machines.id, machineId)));
  if (!m) return false;
  return m.owner === null || m.owner === (await deviceRequester(ctx));
}
