import { describe, expect, test } from "bun:test";
import type { RunnerPhone } from "@agenteschat/adapters/machine-protocol";
import type { ControlIphoneSetup } from "@agenteschat/adapters/runner-control";
import {
  androidStepsUrl,
  deviceServer,
  downloadDue,
  iphoneHere,
  iphoneSteps,
  iphoneStepsUrl,
  isSignedOut,
  siteApi,
} from "../src/control/devices";
import type { Home } from "../src/control/store";
import type { Host, SiteAnswer } from "../src/host/types";

const READY: ControlIphoneSetup = {
  xcode: "27.0",
  platform: { state: "installed", version: "27.1" },
  account: { name: "Sam Rivera", personal: true },
};
const iphone = (over: Partial<RunnerPhone> = {}): RunnerPhone => ({
  platform: "ios",
  serial: "00008110-001475263AC0A01E",
  kind: "device",
  model: "iPhone 16",
  name: "Sam's iPhone 16",
  osVersion: "27.1",
  state: "ready",
  ...over,
});
const at = (setup: ControlIphoneSetup | null, phone: RunnerPhone | null) => {
  const { states, current } = iphoneSteps(setup, phone);
  return { current, state: current ? states[current] : null, states };
};

describe("the iPhone setup's checklist", () => {
  test("the Mac's own steps first: Xcode, the iOS platform, the Apple Account", () => {
    expect(at(null, null)).toMatchObject({ current: "xcode", state: "active" });
    expect(at({ ...READY, xcode: null }, null)).toMatchObject({ current: "xcode", state: "needs" });
    expect(at({ ...READY, platform: { state: "missing" } }, null)).toMatchObject({ current: "tools", state: "active" });
    expect(at({ ...READY, platform: { state: "downloading", percent: 40 } }, null)).toMatchObject({
      current: "tools",
      state: "active",
    });
    expect(at({ ...READY, platform: { state: "failed", message: "offline" } }, null)).toMatchObject({
      current: "tools",
      state: "needs",
    });
    expect(at({ ...READY, account: null }, null)).toMatchObject({ current: "account", state: "needs" });
  });

  test("then the iPhone's, from what it reports: each turns done by itself", () => {
    expect(at(READY, null)).toMatchObject({ current: "connected", state: "active" });
    expect(at(READY, iphone({ state: "needs_you", reason: "untrusted" }))).toMatchObject({
      current: "connected",
      state: "needs",
    });
    const devMode = at(READY, iphone({ state: "needs_you", reason: "developer_mode_off" }));
    expect(devMode).toMatchObject({ current: "developerMode", state: "needs" });
    expect(devMode.states).toMatchObject({ xcode: "done", account: "done", connected: "done", uiAutomation: "todo" });
    expect(at(READY, iphone({ state: "needs_you", reason: "ui_automation_off" })).current).toBe("uiAutomation");
    expect(at(READY, iphone({ state: "preparing", reason: "helper_missing" }))).toMatchObject({
      current: "helper",
      state: "active",
    });
    expect(at(READY, iphone({ state: "needs_you", reason: "helper_expired" }))).toMatchObject({
      current: "helper",
      state: "needs",
    });
    const ready = iphoneSteps(READY, iphone());
    expect(ready.current).toBeNull();
    expect(ready.done).toBe(7);
  });

  test("an iPhone that needs a newer Xcode, or the Mac still preparing it, goes back to that step", () => {
    expect(at(READY, iphone({ state: "needs_you", reason: "xcode_too_old" })).current).toBe("xcode");
    expect(at(READY, iphone({ state: "preparing", reason: "device_support" }))).toMatchObject({ current: "tools" });
    // The test helper's own reasons, from a runner that builds it: no Apple Account to sign it, not trusted yet.
    const reason = (r: string) => r as RunnerPhone["reason"];
    expect(at(READY, iphone({ state: "needs_you", reason: reason("apple_account_missing") })).current).toBe("account");
    expect(at(READY, iphone({ state: "needs_you", reason: reason("helper_untrusted") }))).toMatchObject({
      current: "helper",
      state: "needs",
    });
  });

  test("an account with no team, refused taps and an iOS too old each stop at their own step", () => {
    // An app that can't read `noTeam` still sees the account missing, never done.
    expect(at({ ...READY, account: null, noTeam: true }, null)).toMatchObject({ current: "account", state: "needs" });
    expect(at(READY, iphone({ state: "needs_you", reason: "apple_team_missing" }))).toMatchObject({
      current: "account",
      state: "needs",
    });
    expect(at(READY, iphone({ state: "needs_you", reason: "ui_not_authorized" }))).toMatchObject({
      current: "uiAutomation",
      state: "needs",
    });
    const old = at(READY, iphone({ state: "unsupported", reason: "os_too_old", osVersion: "16.7.10" }));
    expect(old).toMatchObject({ current: "connected", state: "needs" });
    expect(old.states.helper).toBe("todo");
  });

  test("the download starts by itself only when Xcode is here and nothing downloads or failed", () => {
    expect(downloadDue({ ...READY, platform: { state: "missing" } })).toBe(true);
    expect(downloadDue({ ...READY, xcode: null, platform: { state: "missing" } })).toBe(false);
    expect(downloadDue({ ...READY, platform: { state: "failed", message: "x" } })).toBe(false);
    expect(downloadDue(READY)).toBe(false);
    expect(downloadDue(null)).toBe(false);
  });

  test("a real iPhone counts, never a simulator", () => {
    expect(iphoneHere([iphone({ kind: "simulator" })])).toBeNull();
    expect(iphoneHere([iphone({ kind: "simulator" }), iphone()])?.kind).toBe("device");
    expect(iphoneHere(undefined)).toBeNull();
  });
});

describe("this computer on its server", () => {
  test("the QR and the Android steps open this computer's own steps", () => {
    expect(iphoneStepsUrl("https://app.agentes.chat", "o1", "m-1")).toBe(
      "https://app.agentes.chat/org/o1/settings/devices/iphone-setup?computer=m-1",
    );
    expect(androidStepsUrl("https://app.agentes.chat", "o1", "m-1")).toBe(
      "https://app.agentes.chat/org/o1/settings/devices/android-setup?computer=m-1",
    );
  });

  test("the server here's homes are asked at its address in the window", () => {
    const home = { status: { server: "http://127.0.0.1:4310" } } as Home;
    const local = { run: true, url: "http://127.0.0.1:4310", publicUrl: "https://ana-mac.tail1234.ts.net" };
    expect(deviceServer(home, local)).toBe("https://ana-mac.tail1234.ts.net");
    expect(deviceServer(home, { ...local, run: false })).toBe("http://127.0.0.1:4310");
    expect(deviceServer({ status: { server: "https://agentes.example.com" } } as Home, local)).toBe(
      "https://agentes.example.com",
    );
  });

  test("the app API through the window's session: the path, the body, a Stop's empty answer, signed out", async () => {
    const calls: [string, string, string, string | undefined][] = [];
    let next: SiteAnswer | string = { status: 200, body: JSON.stringify({ devices: [], requests: [] }) };
    const host = {
      siteFetch: async (server: string, method: string, path: string, body?: string) => {
        calls.push([server, method, path, body]);
        if (typeof next === "string") throw next;
        return next;
      },
    } as unknown as Host;
    const api = siteApi(host, "https://agentes.example.com");
    expect(await api.devices.list("o1")).toEqual({ devices: [], requests: [] });
    next = { status: 200, body: JSON.stringify({ id: "m-1" }) };
    await api.devices.updateComputer("o1", "m-1", { audience: { mode: "everyone", userIds: [], roleIds: [] } });
    next = { status: 204, body: "" };
    await api.devices.stopPhone("o1", "p-1");
    expect(calls).toEqual([
      ["https://agentes.example.com", "GET", "/api/app/organizations/o1/devices", undefined],
      [
        "https://agentes.example.com",
        "PATCH",
        "/api/app/organizations/o1/devices/computers/m-1",
        JSON.stringify({ audience: { mode: "everyone", userIds: [], roleIds: [] } }),
      ],
      ["https://agentes.example.com", "POST", "/api/app/organizations/o1/devices/phones/p-1/stop", "{}"],
    ]);
    next = "signed_out";
    expect(await api.devices.list("o1").catch((e: unknown) => isSignedOut(e))).toBe(true);
    next = { status: 401, body: JSON.stringify({ error: { code: "auth.unauthorized", message: "Sign in" } }) };
    expect(await api.devices.list("o1").catch((e: unknown) => isSignedOut(e))).toBe(true);
    next = { status: 403, body: JSON.stringify({ error: { code: "device.widen_forbidden", message: "No" } }) };
    expect(await api.devices.list("o1").catch((e: unknown) => isSignedOut(e))).toBe(false);
  });
});
