import { describe, expect, test } from "bun:test";
import type { DeviceAudience, DeviceStatus, PhoneDevice } from "@agenteschat/client";
import { placeOf, subtitleOf } from "../../src/features/activity/logic";
import {
  androidStage,
  audienceText,
  connectKindOf,
  deviceHref,
  deviceNoticeOf,
  deviceNoticeTitle,
  deviceWaitOf,
  iphoneStep,
  joinFacts,
  narrowsAudience,
  phoneFacts,
  phonePortrait,
  reasonText,
  statusView,
  thisPhoneOn,
} from "../../src/features/devices/logic";
import { translator } from "./fixtures";

const when = { time: () => "14:10", short: () => "14:02" };
const AT = "2026-11-09T14:10:00.000Z";

function phone(over: Partial<PhoneDevice> & { id: string }): PhoneDevice {
  return {
    platform: "android",
    phoneKind: "device",
    name: "Pixel 8",
    model: "Pixel 8",
    osVersion: "16",
    hostMachineId: "mac",
    ownerUserId: "sam",
    audience: { mode: "owner", userIds: [], roleIds: [] },
    status: { kind: "ready" },
    transport: "usb",
    lastSeenAt: AT,
    mayUse: true,
    mayManage: true,
    ...over,
  };
}

const needs = (reason: string): DeviceStatus => ({ kind: "needs_you", reason });

describe("a device's state, as its chip and the words after it", async () => {
  const t = await translator("en");
  test("in use names the agent on the chip and whom it works for after it", () => {
    const v = statusView(
      t,
      { kind: "in_use", agentId: "lia", agentName: "Lia", userId: "rui", userName: "Rui Tanaka", since: AT },
      when,
    );
    expect([v.label, v.icon, v.agentId, v.line]).toEqual(["In use by Lia", "face", "lia", "for Rui since 14:10"]);
  });
  test("needs you is the amber chip, with the reason in words; an unknown reason still says something", () => {
    const v = statusView(t, needs("developer_mode_off"), when);
    expect([v.label, v.wait, v.line]).toEqual(["Needs you", true, "Developer Mode is off"]);
    expect(statusView(t, needs("something_new"), when).line).toBe("Not ready yet");
  });
  test("offline says when it was last seen, or that it is away with its computer", () => {
    expect(statusView(t, { kind: "offline", lastSeenAt: AT }, when).line).toBe("last seen 14:02");
    expect(statusView(t, { kind: "offline", lastSeenAt: AT, withHost: true }, when, "Ana's iMac").line).toBe(
      "with Ana's iMac",
    );
    expect(statusView(t, { kind: "busy", running: 1, max: 1 }, when).label).toBe("Busy 1/1");
  });
});

describe("who can use a device", async () => {
  const t = await translator("en");
  const names: Record<string, string> = { sam: "Sam Rivera", rui: "Rui Tanaka", ana: "Ana Costa" };
  const o = (meId: string) => ({
    ownerId: "sam",
    meId,
    nameOf: (id: string) => names[id] ?? "",
    roleName: (id: string) => (id === "mobile" ? "Mobile team" : ""),
    hostName: "Sam's MacBook Pro",
  });
  const owner: DeviceAudience = { mode: "owner", userIds: [], roleIds: [] };
  const everyone: DeviceAudience = { mode: "everyone", userIds: [], roleIds: [] };
  const some: DeviceAudience = { mode: "people", userIds: ["rui"], roleIds: ["mobile"] };
  test("in short words, for its owner and for others; an iPhone follows its Mac", () => {
    expect(audienceText(t, owner, o("sam"))).toBe("Only me");
    expect(audienceText(t, owner, o("rui"))).toBe("Only Sam");
    expect(audienceText(t, everyone, o("rui"))).toBe("Everyone");
    expect(audienceText(t, some, o("sam"))).toBe("Rui Tanaka and Mobile team");
    expect(audienceText(t, null, o("sam"))).toBe("Same as Sam's MacBook Pro");
  });
  test("an admin only narrows someone's device", () => {
    expect(narrowsAudience(everyone, some)).toBe(true);
    expect(narrowsAudience(some, owner)).toBe(true);
    expect(narrowsAudience(some, { mode: "people", userIds: ["rui"], roleIds: [] })).toBe(true);
    expect(narrowsAudience(some, { mode: "people", userIds: ["rui", "ana"], roleIds: [] })).toBe(false);
    expect(narrowsAudience(owner, some)).toBe(false);
    expect(narrowsAudience(some, everyone)).toBe(false);
  });
});

describe("the phone in hand", () => {
  test("found on its computer by its model, else the only real phone of its kind there", () => {
    const pixel = phone({ id: "p1" });
    const emulator = phone({ id: "e1", phoneKind: "emulator", model: "sdk_gphone64" });
    const galaxy = phone({ id: "g1", model: "SM-S921B" });
    expect(thisPhoneOn([emulator, galaxy, pixel], "android", "Pixel 8")?.id).toBe("p1");
    expect(thisPhoneOn([emulator, galaxy], "android", "Pixel 8")?.id).toBe("g1");
    expect(thisPhoneOn([galaxy, pixel], "android", "Pixel 9")).toBeNull();
    expect(thisPhoneOn([pixel], "ios", "iPhone 16")).toBeNull();
  });
  test("Android's setup moves on with what the computer reports", () => {
    expect(androidStage(null)).toBe("looking");
    expect(androidStage(phone({ id: "p", status: { kind: "offline", lastSeenAt: null } }))).toBe("looking");
    expect(androidStage(phone({ id: "p", status: needs("unauthorized") }))).toBe("allow");
    expect(androidStage(phone({ id: "p" }))).toBe("done");
  });
  test("a phone with no driver: its maker's USB driver on Windows, udev rules on Linux", async () => {
    const t = await translator("en");
    expect(reasonText(t, "no_driver", "windows")).toBe("Windows needs the phone maker's USB driver");
    expect(reasonText(t, "no_driver", "linux")).toBe("Linux needs udev rules for this phone");
    expect(reasonText(t, "no_driver")).toBe("Windows needs the phone maker's USB driver");
  });
  test("the iPhone's steps follow the Mac's reason", () => {
    expect(iphoneStep(null)).toBe(0);
    expect(iphoneStep(phone({ id: "i", status: needs("untrusted") }))).toBe(1);
    expect(iphoneStep(phone({ id: "i", status: needs("developer_mode_off") }))).toBe(2);
    expect(iphoneStep(phone({ id: "i", status: needs("ui_automation_off") }))).toBe(3);
    expect(iphoneStep(phone({ id: "i", status: needs("helper_expired") }))).toBe(4);
    // The Mac builds the test helper; trusting it, or an Apple Account or app limit, holds that last step.
    for (const reason of ["helper_untrusted", "team_limit", "apple_account_missing", "apple_team_missing"])
      expect(iphoneStep(phone({ id: "i", status: needs(reason) }))).toBe(4);
    expect(iphoneStep(phone({ id: "i" }))).toBe(5);
    // The iPhone refused the helper's taps: UI Automation's step says what to do.
    expect(iphoneStep(phone({ id: "i", status: needs("ui_not_authorized") }))).toBe(3);
    // Below iOS 17 it never gets past being plugged in, and never reads as ready.
    expect(iphoneStep(phone({ id: "i", status: { kind: "unsupported", reason: "os_too_old" } }))).toBe(0);
  });
  test("the new iPhone reasons have their own words", async () => {
    const t = await translator("en");
    expect(reasonText(t, "apple_team_missing")).toBe("Xcode on the Mac shows no team yet");
    expect(reasonText(t, "ui_not_authorized")).toBe("This iPhone refused the test helper's taps");
  });
  test("a phone waiting on someone is drawn dimmed, an offline one dark", () => {
    expect(phonePortrait(phone({ id: "i", platform: "ios", status: needs("locked") }))).toEqual({
      kind: "iphone",
      state: "paused",
    });
    expect(phonePortrait(phone({ id: "p", status: { kind: "offline", lastSeenAt: null } })).state).toBe("offline");
  });
});

describe("notices, waits and facts", async () => {
  const en = await translator("en");
  const pt = await translator("pt-BR");
  test("a device's notice reads its ids and opens the phone, else the computer, else Devices", () => {
    const d = deviceNoticeOf({
      kind: "device.in_use" as never,
      source: { phoneId: "p1", machineId: "k1", label: "Pixel 8", userId: "rui" } as never,
      latest: { text: "Recording a test video" },
    });
    expect(d).toEqual({
      kind: "device.in_use",
      requestId: null,
      phoneId: "p1",
      machineId: "k1",
      device: "Pixel 8",
      forUserId: "rui",
      doing: "Recording a test video",
    });
    expect(d ? deviceHref(d) : null).toBe("/settings/devices/phone/p1");
    expect(deviceHref({ phoneId: "../x", machineId: null })).toBe("/settings/devices");
    expect(deviceNoticeOf({ kind: "mention", source: {} })).toBeNull();
    if (!d) return;
    expect(deviceNoticeTitle(en, d, "Lia", "Rui", "Acme")).toBe("Lia is using Pixel 8 for Rui");
    expect(deviceNoticeTitle(en, { ...d, device: "Sam's iPhone 16" }, "Lia", "", "Acme")).toBe(
      "Lia is using Sam's iPhone 16",
    );
    expect(deviceNoticeTitle(en, { ...d, kind: "device.join_request", device: "build-box" }, "", "", "Acme")).toBe(
      "build-box wants to join Acme",
    );
  });
  test("an inbox row of a device's notice says only what the agent is doing under its title", () => {
    const n = {
      kind: "device.in_use",
      source: { phoneId: "p1", label: "Pixel 8", userId: "rui" },
      latest: { title: "Rui", text: "Recording a test video" },
    } as never;
    expect(subtitleOf(n, () => "")).toBe("Recording a test video");
    expect(placeOf(n)).toBe("");
    const waiting = { ...(n as object), kind: "device.waiting", latest: { title: "Rui" } } as never;
    expect(subtitleOf(waiting, () => "")).toBe("");
  });
  test("a wait for a device, from either place the run says it", () => {
    expect(
      deviceWaitOf({ deviceWait: { deviceName: "Pixel 8", hostName: "Sam's MacBook Pro", reason: "offline" } }),
    ).toMatchObject({ device: "Pixel 8", host: "Sam's MacBook Pro", reason: "offline", over: false });
    expect(deviceWaitOf({ brainUnavailable: { kind: "device", device: "Pixel 8", state: "back" } })?.over).toBe(true);
    expect(deviceWaitOf({ brainUnavailable: { brain: "claude_code", machineId: "k1" } })).toBeNull();
  });
  test("facts read in the app's language, Android's own prompt included", () => {
    expect(phoneFacts(en, phone({ id: "p" }), "Sam's MacBook Pro")).toBe("Android 16 · on Sam's MacBook Pro");
    expect(joinFacts(en, { os: "linux", ip: "203.0.113.7", location: "Lisbon" })).toBe("Linux · 203.0.113.7 · Lisbon");
    expect(pt("mobile.devices.android.prompt.title")).toBe("Permitir a depuração USB?");
    expect(pt("mobile.devices.android.prompt.always")).toBe("Sempre permitir neste computador");
    expect([pt("mobile.devices.android.prompt.cancel"), pt("mobile.devices.android.prompt.allow")]).toEqual([
      "Cancelar",
      "Permitir",
    ]);
    expect(en("mobile.devices.android.prompt.title")).toBe("Allow USB debugging?");
  });

  test("connecting another computer: through its app, or one line; the app's Allow named as the app names it", () => {
    expect(["app", "server", "computer", "phone", undefined].map(connectKindOf)).toEqual([
      "app",
      "server",
      "computer",
      null,
      null,
    ]);
    expect(en("mobile.devices.connect.appStep3", { org: "Acme" })).toBe(
      "Click Allow when it asks to let Acme's agents use it",
    );
    expect(pt("mobile.devices.connect.appConnected", { name: "Mac mini da Ana" })).toBe("Conectado: Mac mini da Ana");
  });
});
