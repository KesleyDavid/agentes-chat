/**
 * Preferences › General › This Mac: this computer's own row in its workspace's devices, who can use it and its phones
 * (the server's devices API through the main window's session, `Host.siteFetch`), and the iPhone setup's checklist,
 * from what the runner reports (`iphone.setup`, and the phones in its status). Pure, so the tests read it as is.
 */
import type { RunnerPhone } from "@agenteschat/adapters/machine-protocol";
import type { ControlIphoneSetup } from "@agenteschat/adapters/runner-control";
import type { ComputerDevice, DevicesList } from "@agenteschat/client";
import { createHttpApi } from "@agenteschat/client/api/http-client";
import type { Host } from "../host/types";
import { homeServer } from "./server";
import type { Home } from "./store";

/** The app API on `server`, asked through Rust with the main window's session there (only the devices' paths). */
export function siteApi(host: Host, server: string) {
  return createHttpApi({
    baseUrl: server,
    fetch: async (input, init) => {
      const body = typeof init.body === "string" ? init.body : undefined;
      const answer = await host.siteFetch(server, init.method ?? "GET", new URL(input).pathname, body);
      const empty = answer.status === 204 || !answer.body;
      return new Response(empty ? null : answer.body, {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

/** Rust's answer when the main window has no session on that server (never opened there, or signed out). */
export const SIGNED_OUT = "signed_out";

/** A failed ask meant "sign in there first": no session in the window, or the server refused the one it had. */
export const isSignedOut = (err: unknown) =>
  err === SIGNED_OUT || (typeof err === "object" && err !== null && (err as { status?: number }).status === 401);

/** This computer's own row in its workspace's list, by the machine its runner is paired as. */
export const thisComputer = (list: DevicesList | undefined, home: Home): ComputerDevice | null =>
  list?.devices.find((d) => d.id === home.status?.machine?.id) ?? null;

/** The server a home's devices are asked on: the server here's homes point at its loopback, its window at its address. */
export const deviceServer = (home: Home, local: { run: boolean; url: string | null; publicUrl: string | null }) => {
  const server = homeServer(home);
  return local.run && server && server === local.url && local.publicUrl ? local.publicUrl : server;
};

/** The web's Android steps for a phone plugged into this computer (its connect dialog, live with this computer). */
export const androidStepsUrl = (server: string, orgId: string, machineId: string) =>
  `${server}/org/${encodeURIComponent(orgId)}/settings/devices/android-setup?computer=${encodeURIComponent(machineId)}`;

/** The QR on the iPhone setup: the same steps in the phone app (an App Link), or the web where it isn't installed. */
export const iphoneStepsUrl = (server: string, orgId: string, machineId: string) =>
  `${server}/org/${encodeURIComponent(orgId)}/settings/devices/iphone-setup?computer=${encodeURIComponent(machineId)}`;

// ── The iPhone setup ─────────────────────────────────────────────────────────

/** Preferences opens the welcome window as the iPhone setup (read once by that window, then cleared). */
export const IPHONE_SETUP_PREF = "iphoneSetup";

export const IPHONE_SETUP_STEPS = [
  "xcode",
  "tools",
  "account",
  "connected",
  "developerMode",
  "uiAutomation",
  "helper",
] as const;
export type IphoneSetupStep = (typeof IPHONE_SETUP_STEPS)[number];
/** `active`: the Mac is at it (looking, downloading, building); `needs`: only the person can do it. */
export type IphoneStepState = "done" | "active" | "needs" | "todo";

/** The iPhone this Mac reaches: a real one (a simulator needs none of this). */
export const iphoneHere = (phones: readonly RunnerPhone[] | undefined) =>
  phones?.find((p) => p.platform === "ios" && p.kind === "device") ?? null;

const PHONE_STEP: Partial<Record<string, IphoneSetupStep>> = {
  xcode_missing: "xcode",
  xcode_too_old: "xcode",
  device_support: "tools",
  untrusted: "connected",
  locked: "connected",
  os_too_old: "connected",
  developer_mode_off: "developerMode",
  ui_automation_off: "uiAutomation",
  helper_missing: "helper",
  helper_expired: "helper",
  apple_account_missing: "account",
  apple_team_missing: "account",
  ui_not_authorized: "uiAutomation",
  helper_untrusted: "helper",
  team_limit: "helper",
};

/**
 * Where the setup stands: steps before the first undone one are done, that one is the Mac's to do (`active`) or the
 * person's (`needs`), the rest wait. The Mac's own steps come first; the iPhone's come from its reason, which turns
 * a step done by itself once the iPhone reports it. Null `setup`: still asking the Mac.
 */
export function iphoneSteps(
  setup: ControlIphoneSetup | null,
  phone: RunnerPhone | null,
): { states: Record<IphoneSetupStep, IphoneStepState>; current: IphoneSetupStep | null; done: number } {
  const reason = phone?.state === "ready" ? undefined : phone?.reason;
  const fromPhone = reason ? PHONE_STEP[reason] : undefined;
  let at: IphoneSetupStep | null = null;
  let mac = false;
  if (!setup) [at, mac] = ["xcode", true];
  else if (!setup.xcode || fromPhone === "xcode") at = "xcode";
  else if (setup.platform.state !== "installed" || fromPhone === "tools")
    [at, mac] = ["tools", setup.platform.state !== "failed"];
  else if (!setup.account || fromPhone === "account") at = "account";
  else if (!phone) [at, mac] = ["connected", true];
  else if (fromPhone) [at, mac] = [fromPhone, fromPhone === "helper" && phone.state === "preparing"];
  else if (phone.state !== "ready") [at, mac] = ["helper", phone.state === "preparing"];
  const index = at ? IPHONE_SETUP_STEPS.indexOf(at) : IPHONE_SETUP_STEPS.length;
  const states = Object.fromEntries(
    IPHONE_SETUP_STEPS.map((s, i) => [s, i < index ? "done" : i > index ? "todo" : mac ? "active" : "needs"]),
  ) as Record<IphoneSetupStep, IphoneStepState>;
  return { states, current: at, done: index };
}

/** The download is due: Xcode is here, the platform isn't, and nothing is downloading or failed (Try again asks). */
export const downloadDue = (setup: ControlIphoneSetup | null) => !!setup?.xcode && setup.platform.state === "missing";
