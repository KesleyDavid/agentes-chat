import { describe, expect, setSystemTime, test } from "bun:test";
import type { RunnerPhone } from "@agenteschat/adapters/machine-protocol";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider, useSnapshot } from "../src/app";
import { IPHONE_SETUP_PREF } from "../src/control/devices";
import { DesktopStore, pairedHomes } from "../src/control/store";
import { readPref, writePref } from "../src/hooks";
import { createFakeHost, type FakeHost } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ToastProvider } from "../src/ui/Toast";
import { WindowView } from "../src/WindowView";
import { ThisMacCards } from "../src/windows/prefs/ThisMac";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function until(ready: () => unknown) {
  for (let i = 0; i < 200 && !ready(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(Boolean(ready())).toBe(true);
}

async function mount(
  window: "prefs" | "welcome",
  view: ReactNode,
  check: (el: HTMLElement, host: FakeHost) => Promise<void>,
) {
  const host = createFakeHost(window, "selfhost");
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={createDesktopI18n("en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>{view}</ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      ),
    );
    await check(el, host);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

/** The first workspace's cards alone (the fake has two). */
function OneWorkspace() {
  const homes = pairedHomes(useSnapshot()).slice(0, 1);
  return homes.length ? <ThisMacCards homes={homes} offers={[]} /> : null;
}

const rowOf = (el: HTMLElement, title: string) =>
  [...el.querySelectorAll<HTMLElement>(".dk-crow")].find(
    (r) => r.querySelector(".dk-crow__title")?.textContent === title,
  );
const button = (root: ParentNode | undefined, text: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === text);

describe("Preferences › This Mac", () => {
  test("agents, commands as this user, who can use it, and each phone with its state and one way out", () =>
    mount("prefs", <OneWorkspace />, async (el, host) => {
      await until(() => rowOf(el, "Pixel 8") && rowOf(el, "Who can use it")?.querySelector('[role="combobox"]'));
      expect(
        rowOf(el, "Let Acme's agents use this Mac")?.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
      ).toBe("true");
      expect(document.getElementById("mac-commands-hint")?.textContent).toContain("They run as sam");
      expect(rowOf(el, "Who can use it")?.querySelector('[role="combobox"]')?.textContent).toBe("Only me");

      const pixel = rowOf(el, "Pixel 8");
      expect(pixel?.querySelector(".ac-chip")?.textContent).toBe("In use by Ada");
      expect(pixel?.querySelector("small")?.textContent).toMatch(/^for Rui since .+ · Everyone can use it$/);
      const iphone = rowOf(el, "Sam's iPhone 16");
      expect(iphone?.querySelector(".ac-chip")?.textContent).toBe("Needs you");
      expect(iphone?.querySelector("small")?.textContent).toBe("Developer Mode is off");

      // Stop: the web's own stop, on this computer's server; the phone is free once the list comes back.
      await act(async () => button(pixel, "Stop")?.click());
      await until(() => rowOf(el, "Pixel 8")?.querySelector(".ac-chip")?.textContent === "Ready");
      expect(host.site.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
        "/api/app/organizations/org_acme/devices/phones/0b6c5a8e-0000-4000-8000-000000000001/stop",
      ]);

      // Show me how on the iPhone: the setup, in the welcome window.
      await act(async () => button(rowOf(el, "Sam's iPhone 16"), "Show me how")?.click());
      expect(readPref(IPHONE_SETUP_PREF, false)).toBe(true);
      expect(host.window).toBe("welcome");
      writePref(IPHONE_SETUP_PREF, false);
    }));

  test("signed out on that server: says so, with the way to sign in", () =>
    mount("prefs", <OneWorkspace />, async (el, host) => {
      host.site.signedOut = true;
      await until(() => rowOf(el, "Who can use it")?.querySelector("small"));
      expect(rowOf(el, "Who can use it")?.querySelector("small")?.textContent).toBe(
        "Sign in to agentes.tail1234.ts.net in the app to see who can use this Mac.",
      );
      expect(button(rowOf(el, "Who can use it"), "Open")).toBeTruthy();
    }));
});

describe("the iPhone setup window", () => {
  test("Preferences' Show me how opens it in the welcome window; the Mac downloads what Xcode needs by itself", async () => {
    writePref(IPHONE_SETUP_PREF, true);
    await mount("welcome", <WindowView name="welcome" />, async (el, host) => {
      await until(() => el.querySelector('[data-screen="iphone"]') && el.querySelector('[aria-current="step"]'));
      expect(readPref(IPHONE_SETUP_PREF, true)).toBe(false);
      // Asked again while it shows: taken at once, so the next welcome window is the first run again.
      writePref(IPHONE_SETUP_PREF, true);
      await act(() => host.showWindow("welcome"));
      expect(readPref(IPHONE_SETUP_PREF, true)).toBe(false);
      expect(el.querySelector("h1")?.textContent).toBe("Connect an iPhone");
      // Xcode is there, the iOS platform isn't: it starts downloading and reaches the iPhone's own step.
      await until(() => el.querySelector('[aria-current="step"] b')?.textContent === "Turn on Developer Mode");
      const steps = [...el.querySelectorAll(".dk-fr__steps > li")].map((li) => [
        li.querySelector("b")?.textContent,
        li.getAttribute("data-state"),
      ]);
      expect(steps).toEqual([
        ["Xcode", "done"],
        ["iPhone tools", "done"],
        ["Apple Account in Xcode", "done"],
        ["iPhone connected", "done"],
        ["Turn on Developer Mode", "warn"],
        ["Turn on UI Automation", "todo"],
        ["Test helper", "todo"],
      ]);
      expect(el.querySelector('[aria-current="step"] .ac-setpath')?.textContent).toBe(
        "SettingsPrivacy & SecurityDeveloper Mode",
      );
      expect(el.textContent).toContain("Sam Rivera · Personal Team");
      // Our phone app is in no store yet: no QR that would only open a web page on the iPhone.
      expect(el.querySelector(".dk-ip__qr")).toBeNull();
      expect(button(el, "Back")).toBeTruthy();
      expect(button(el, "Cancel")).toBeTruthy();

      // The helper built, but the iPhone doesn't trust its developer yet: where on the iPhone to trust it.
      for (const runner of host.runners.values())
        runner.setPhones(runner.phones.map((p) => (p.platform === "ios" ? { ...p, reason: "helper_untrusted" } : p)));
      await until(() => el.querySelector('[aria-current="step"] b')?.textContent === "Test helper");
      expect(el.querySelector('[aria-current="step"]')?.textContent).toContain("Tap the developer's name, then Trust.");
      expect(el.querySelector('[aria-current="step"] .ac-setpath')?.textContent).toBe(
        "SettingsGeneralVPN & Device Management",
      );
    });
  });

  test("every iPhone state names its way out, and a step that sits still says what most likely holds it", async () => {
    writePref(IPHONE_SETUP_PREF, true);
    await mount("welcome", <WindowView name="welcome" />, async (el, host) => {
      const step = () => el.querySelector('[aria-current="step"]');
      const at = (name: string) => until(() => step()?.querySelector("b")?.textContent === name);
      const phone = (over: Partial<RunnerPhone>) => {
        for (const runner of host.runners.values())
          runner.setPhones(runner.phones.map((p) => (p.platform === "ios" ? { ...p, ...over } : p)));
      };
      await at("Turn on Developer Mode");

      phone({ reason: "ui_not_authorized" });
      await at("Turn on UI Automation");
      expect(step()?.textContent).toContain("The iPhone refused the test helper's taps. Unlock it");

      for (const runner of host.runners.values()) runner.iphone = { ...runner.iphone, sdk: "26.2" };
      phone({ reason: "xcode_too_old", osVersion: "27.0" });
      await at("Xcode");
      // The SDK comes with the next ask of the Mac (every 2 s), after the phone's own report.
      await until(() => step()?.textContent?.includes("knows iOS 26.2 at most"));
      expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 27.0 and Xcode on");
      expect(step()?.textContent).toContain("knows iOS 26.2 at most. Install Xcode 27, then run this in Terminal.");
      expect(step()?.querySelector("code")?.textContent).toBe("xcrun devicectl manage ddis update");

      // Below iOS 17: what it runs and what agents need, with no spinner left turning.
      phone({ state: "unsupported", reason: "os_too_old", osVersion: "16.7.10" });
      await at("iPhone connected");
      expect(step()?.getAttribute("data-state")).toBe("warn");
      expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 16.7.10, and agents need iOS 17 or newer.");
      expect(el.querySelector(".dk-fr__stepmark .ac-pixspin")).toBeNull();

      // Xcode lists an account that shows no team: its own words, not "sign in".
      for (const runner of host.runners.values()) runner.iphone = { ...runner.iphone, account: null, noTeam: true };
      await at("Apple Account in Xcode");
      expect(step()?.textContent).toContain("Xcode is signed in but shows no team yet.");

      for (const runner of host.runners.values())
        runner.iphone = { ...runner.iphone, account: { name: "Sam Rivera", personal: true } };
      phone({ state: "preparing", reason: "helper_missing", osVersion: "27.1" });
      await at("Test helper");
      expect(step()?.querySelector(".dk-ip__stall")).toBeNull();
      try {
        // The next ask of the Mac, 45 s on with nothing changed: what the helper waits for.
        setSystemTime(new Date(Date.now() + 46_000));
        await until(() => step()?.querySelector(".dk-ip__stall"));
        expect(step()?.querySelector(".dk-ip__stall")?.textContent).toContain(
          "builds the test helper and starts it on the iPhone",
        );
      } finally {
        setSystemTime();
      }
    });
  });

  test("without the ask, the welcome window is the first run", () =>
    mount("welcome", <WindowView name="welcome" />, async (el) => {
      await until(() => el.querySelector(".dk-fr"));
      expect(el.querySelector('[data-screen="iphone"]')).toBeNull();
    }));
});
