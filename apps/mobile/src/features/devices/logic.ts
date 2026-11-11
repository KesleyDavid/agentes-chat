import type {
  AppNotification,
  ComputerDevice,
  DeviceAudience,
  DeviceStatus,
  DevicesList,
  PhoneDevice,
} from "@agenteschat/client";
import { firstName, namesText } from "@agenteschat/client/lib/format";
import { computerKind } from "@agenteschat/client/lib/machines";
import type { TFunction } from "i18next";
import type { ComputerState, PortraitKind } from "@/computer/cells";
import type { IconName } from "@/ui";
import { osOf } from "../settings/logic";
import { isSafeId } from "../shared/logic";

/**
 * Bring your own devices on the phone: how a device's state, rule and requests read, and which phone on a computer
 * is the one in hand. Pure (no React Native), so it runs in `bun test`.
 */

/** A device's state as its chip and the quieter words after it ("In use by Lia" · "for Rui since 14:10"). */
export interface StatusView {
  label: string;
  /** `spin`: work under way; `face`: the agent using it leads the chip. */
  icon: IconName | "spin" | "face" | null;
  /** Waits on a person: the amber chip. */
  wait: boolean;
  agentId: string | null;
  line: string | null;
}

/**
 * What a reason code says (`PhoneReason` and the server's own); an unknown one says it isn't ready. `os`: the host's,
 * since a phone with no driver needs its maker's on Windows and udev rules on Linux.
 */
export function reasonText(t: TFunction, reason: string | null | undefined, os?: string | null): string {
  const other = t("mobile.devices.reason.other");
  const key = reason === "no_driver" && os && computerKind(os) === "linux" ? "no_driverLinux" : reason;
  return key ? t(`mobile.devices.reason.${key}`, { defaultValue: other }) : other;
}

export function statusView(
  t: TFunction,
  s: DeviceStatus,
  when: { time: (iso: string) => string; short: (iso: string) => string },
  hostName?: string | null,
): StatusView {
  const view = (label: string, icon: StatusView["icon"], line: string | null = null): StatusView => ({
    label,
    icon,
    wait: false,
    agentId: null,
    line,
  });
  switch (s.kind) {
    case "ready":
      return view(t("mobile.devices.status.ready"), "check");
    case "in_use": {
      const since = when.time(s.since);
      return {
        label: t("mobile.devices.status.inUse", { name: s.agentName ?? s.userName ?? "" }),
        icon: s.agentId ? "face" : null,
        wait: false,
        agentId: s.agentId,
        line:
          s.agentName && s.userName
            ? t("mobile.devices.status.inUseFor", { person: firstName(s.userName), time: since })
            : t("mobile.devices.status.since", { time: since }),
      };
    }
    case "busy":
      return view(t("mobile.devices.status.busy", { running: s.running, max: s.max }), "spin");
    case "needs_you":
      return { ...view(t("mobile.devices.status.needsYou"), null, reasonText(t, s.reason)), wait: true };
    case "preparing":
      return view(t("mobile.devices.status.preparing"), "spin", reasonText(t, s.reason));
    case "paused":
      return view(
        t("mobile.devices.status.paused"),
        "pause",
        s.until ? t("mobile.devices.status.until", { time: when.time(s.until) }) : null,
      );
    case "offline":
      return view(
        t("mobile.devices.status.offline"),
        null,
        s.withHost && hostName
          ? t("mobile.devices.status.withHost", { host: hostName })
          : s.lastSeenAt
            ? t("mobile.devices.status.seen", { when: when.short(s.lastSeenAt) })
            : null,
      );
    case "unsupported":
      return view(t("mobile.devices.status.unsupported"), "x", reasonText(t, s.reason));
  }
}

/** Ready to take work (ready, in use by someone, or running tasks). */
export const isUp = (s: DeviceStatus) => s.kind === "ready" || s.kind === "in_use" || s.kind === "busy";

export function computerPortrait(d: Pick<ComputerDevice, "os" | "status">): {
  kind: PortraitKind;
  state: ComputerState;
} {
  const state = d.status.kind === "offline" ? "offline" : d.status.kind === "paused" ? "paused" : "online";
  return { kind: computerKind(d.os), state };
}

/** A phone that waits on someone, or can't be used, is drawn dimmed. */
export function phonePortrait(p: Pick<PhoneDevice, "platform" | "status">): {
  kind: PortraitKind;
  state: ComputerState;
} {
  const k = p.status.kind;
  const state = k === "offline" ? "offline" : isUp(p.status) ? "online" : "paused";
  return { kind: p.platform === "ios" ? "iphone" : "android", state };
}

/** "Android 16 · on Sam's MacBook Pro". */
export function phoneFacts(t: TFunction, p: Pick<PhoneDevice, "platform" | "osVersion">, hostName: string | null) {
  const os = t(p.platform === "ios" ? "mobile.devices.os.ios" : "mobile.devices.os.android", { version: p.osVersion });
  return [os, hostName ? t("mobile.devices.onHost", { host: hostName }) : null].filter(Boolean).join(" · ");
}

/** "macOS · 10 CPUs · 32 GB". */
export function computerFacts(t: TFunction, d: Pick<ComputerDevice, "os" | "cpus" | "memoryGb">) {
  return [
    t(`machines.os.${osOf(d.os)}`),
    d.cpus ? t("mobile.devices.cpus", { count: d.cpus }) : null,
    d.memoryGb ? t("mobile.devices.memory", { gb: Math.round(d.memoryGb) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A join request's facts: "Linux · 203.0.113.7 · Lisbon". */
/** A computer asking to join (named by what the list holds: the shared type's name changes). */
export type DeviceJoin = DevicesList["requests"][number];

export const joinFacts = (t: TFunction, r: Pick<DeviceJoin, "os" | "ip" | "location">) =>
  [t(`machines.os.${osOf(r.os)}`), r.ip, r.location].filter(Boolean).join(" · ");

/** "Conectar um dispositivo"'s `?kind=`: another computer through its app, or a one-line link for a server or one. */
export type ConnectKind = "app" | "server" | "computer";
export const connectKindOf = (kind: string | undefined): ConnectKind | null =>
  kind === "app" || kind === "server" || kind === "computer" ? kind : null;

/** Who may point their agents at a device, said short: "Only me", "Only Sam", "Everyone", "Rui and Mobile team". */
export function audienceText(
  t: TFunction,
  audience: DeviceAudience | null,
  o: {
    ownerId: string | null;
    meId: string | null;
    nameOf: (userId: string) => string;
    roleName: (roleId: string) => string;
    hostName?: string | null;
  },
): string {
  if (!audience) return t("mobile.devices.audience.sameAs", { host: o.hostName ?? "" });
  if (audience.mode === "everyone" || (audience.mode === "owner" && !o.ownerId))
    return t("mobile.devices.audience.everyone");
  if (audience.mode === "owner")
    return o.ownerId === o.meId
      ? t("mobile.devices.audience.me")
      : t("mobile.devices.audience.only", { name: firstName(o.nameOf(o.ownerId ?? "")) });
  const names = [...audience.userIds.map(o.nameOf), ...audience.roleIds.map(o.roleName)].filter(Boolean);
  return names.length ? namesText(t, names, 2) : t("mobile.devices.audience.me");
}

/** A rule only narrows from `from` to `to` (an admin may narrow someone's personal device, never widen it). */
export function narrowsAudience(from: DeviceAudience, to: DeviceAudience): boolean {
  if (to.mode === "owner" || from.mode === "everyone") return true;
  if (to.mode === "everyone" || from.mode === "owner") return false;
  return to.userIds.every((id) => from.userIds.includes(id)) && to.roleIds.every((id) => from.roleIds.includes(id));
}

/** A computer or a phone by id, with the computer it's on. */
export function findDevice(devices: readonly ComputerDevice[] | undefined, id: string) {
  for (const d of devices ?? []) {
    if (d.id === id) return { computer: d, phone: null };
    const phone = d.phones.find((p) => p.id === id);
    if (phone) return { computer: d, phone };
  }
  return null;
}

/** Computers that can take a phone from this person: theirs, single-user (a server install has no USB phones). */
export const phoneHosts = (devices: readonly ComputerDevice[], meId: string | null, platform: "android" | "ios") =>
  devices.filter(
    (d) =>
      d.machineKind === "connected" &&
      d.ownerUserId === meId &&
      !d.systemMode &&
      (platform === "android" || computerKind(d.os) === "mac"),
  );

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The phone in hand among a computer's phones: a real phone of this platform whose model is this one's ("Pixel 8"),
 * else the only real phone of this platform there. Null while the computer doesn't see it.
 */
export function thisPhoneOn(
  phones: readonly PhoneDevice[],
  platform: "android" | "ios",
  model: string | null | undefined,
): PhoneDevice | null {
  const real = phones.filter((p) => p.platform === platform && p.phoneKind === "device");
  const same = model ? real.filter((p) => norm(p.model) === norm(model)) : [];
  return same[0] ?? (real.length === 1 ? (real[0] ?? null) : null);
}

/** Where an Android phone is in its setup, from what its computer reports. */
export type AndroidStage = "looking" | "allow" | "done";

export function androidStage(phone: Pick<PhoneDevice, "status"> | null | undefined): AndroidStage {
  if (!phone || phone.status.kind === "offline") return "looking";
  if (isUp(phone.status)) return "done";
  return "allow";
}

/** What the Mac reports while it sets up the test helper (the last step). */
const HELPER_STEP = new Set([
  "helper_missing",
  "helper_expired",
  "helper_untrusted",
  "team_limit",
  "apple_account_missing",
  "apple_team_missing",
]);

/** The iPhone guide's steps, in order; `iphoneStep` is the index of the one to do now (5: all done). */
export const IPHONE_STEPS = ["plug", "trust", "devmode", "automation", "helper"] as const;

export function iphoneStep(phone: Pick<PhoneDevice, "status"> | null | undefined): number {
  // Below iOS 17 (`unsupported`) it never gets past being plugged in: the guide says why instead of its steps.
  if (!phone || phone.status.kind === "offline" || phone.status.kind === "unsupported") return 0;
  if (isUp(phone.status)) return IPHONE_STEPS.length;
  const s = phone.status;
  const reason = "reason" in s ? s.reason : "";
  if (reason === "untrusted" || reason === "locked") return 1;
  if (reason === "ui_automation_off" || reason === "ui_not_authorized") return 3;
  if (HELPER_STEP.has(reason)) return 4;
  return 2;
}

/** Reasons the iPhone guide's steps already say: anything else gets its own line under them. */
export const IPHONE_STEP_REASONS = new Set([
  "untrusted",
  "locked",
  "developer_mode_off",
  "ui_automation_off",
  "helper_missing",
  "helper_expired",
  "helper_untrusted",
]);

// ── Notifications and waits ─────────────────────────────────────────────────

export const DEVICE_NOTICES = [
  "device.join_request",
  "device.in_use",
  "device.access_request",
  "device.waiting",
] as const;
export type DeviceNoticeKind = (typeof DEVICE_NOTICES)[number];

export const isDeviceNotice = (kind: string): kind is DeviceNoticeKind =>
  (DEVICE_NOTICES as readonly string[]).includes(kind);

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * A device notification's ids and words: `source.requestId` (a join or access request), `source.phoneId` or
 * `source.machineId`, the device's name in `source.label`, whom the agent works for in `source.userId`, what it is
 * doing in `latest.text`.
 */
export interface DeviceNotice {
  kind: DeviceNoticeKind;
  requestId: string | null;
  phoneId: string | null;
  machineId: string | null;
  device: string;
  forUserId: string | null;
  doing: string | null;
}

export function deviceNoticeOf(
  n: Pick<AppNotification, "kind" | "source"> & Partial<Pick<AppNotification, "latest">>,
): DeviceNotice | null {
  if (!isDeviceNotice(n.kind)) return null;
  const s = n.source as Record<string, unknown>;
  return {
    kind: n.kind,
    requestId: str(s.requestId),
    phoneId: str(s.phoneId),
    machineId: str(s.machineId),
    device: str(s.label) ?? n.latest?.title ?? "",
    forUserId: str(s.userId),
    doing: n.latest?.text ?? null,
  };
}

/**
 * A device notification's sentence, with `names` standing for the agent (drawn bold by the inbox): "build-box wants
 * to join Acme", "Lia is using your Pixel 8 for Rui", "Lia asks to use your iPhone 16 for Rui", "Lia is waiting for
 * your MacBook for Rui".
 */
export function deviceNoticeTitle(t: TFunction, d: DeviceNotice, names: string, person: string, org: string) {
  if (d.kind === "device.join_request") return t("mobile.devices.notice.join_request", { device: d.device, org });
  const key = d.kind.slice("device.".length);
  return t(`mobile.devices.notice.${key}${person ? "For" : ""}`, { names, device: d.device, person });
}

/** The device a notification is about: a phone's page, a computer's, or the list. */
export const deviceHref = (d: Pick<DeviceNotice, "phoneId" | "machineId">) =>
  isSafeId(d.phoneId)
    ? (`/settings/devices/phone/${d.phoneId}` as const)
    : isSafeId(d.machineId)
      ? (`/settings/devices/${d.machineId}` as const)
      : ("/settings/devices" as const);

/** A run waiting for a device, from its message's meta (`deviceWait`, or `brainUnavailable` with `kind: "device"`). */
export interface DeviceWaitInfo {
  runId: string | null;
  device: string;
  host: string | null;
  reason: string | null;
  lastSeenAt: string | null;
  /** It came back, or the wait ended: the card is a decided pill. */
  over: boolean;
}

export function deviceWaitOf(meta: Record<string, unknown> | null | undefined): DeviceWaitInfo | null {
  const raw = meta?.deviceWait ?? meta?.brainUnavailable;
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (meta?.deviceWait === undefined && w.kind !== "device") return null;
  const state = str(w.state);
  return {
    runId: str(w.runId),
    device: str(w.deviceName) ?? str(w.device) ?? "",
    host: str(w.hostName) ?? str(w.host),
    reason: str(w.reason) ?? str(w.code),
    lastSeenAt: str(w.lastSeenAt),
    over: state !== null && state !== "waiting",
  };
}
