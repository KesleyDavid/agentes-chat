import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { domWindow, setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { PhoneDevice } from "@agenteschat/client";
import { ANDROID_SLOW_MS, ANDROID_USB_DRIVERS } from "@agenteschat/client/lib/devices";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { createFakeApi, ENG_ID, fakeDevicesOf, fakeMachinesOf } from "./fake-api";
import { notification } from "./fakes/notifications";
import { ANA, acmeDevices, acmeState, BUILD_PC, IMAC, IPHONE, LIA, MAC, ORG_ID, PIXEL, RUI } from "./fixtures/devices";
import { renderApp, screen, settle, showIn } from "./render";

let home: string | undefined;
/** The address this page is open at: the desktop app takes a pair link of an https server only. */
const servedAt = (url: string) => {
  home ??= domWindow().location.href;
  domWindow().happyDOM.setURL(url);
};

afterEach(() => {
  cleanup();
  setSystemTime();
  if (home) domWindow().happyDOM.setURL(home);
});

/** Each step of a checklist: its state, and its title alone when folded. */
const stepsOf = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll(".dv-step")].map(
    (s) => `${s.getAttribute("data-state")}${s.hasAttribute("data-shut") ? " folded" : ""}`,
  );
/** The clock moves past the guide's 30 s, and the dialog's 1 s tick redraws it. */
const after30s = async () => {
  setSystemTime(new Date(Date.now() + ANDROID_SLOW_MS + 1000));
  await act(() => new Promise((r) => setTimeout(r, 1100)));
  await settle(4);
};

const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};
/** What the 2 s poll or a devices event would do: ask the server again now. */
const refetch = async (services: Awaited<ReturnType<typeof renderApp>>["services"]) => {
  await act(async () => {
    await services.queryClient.invalidateQueries({ queryKey: ["org"] });
  });
  await settle(4);
};
/** A row's ⋯ (Radix opens a menu from the keyboard here): its menu. */
const openMenu = async (trigger: HTMLElement) => {
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyUp(trigger, { key: "Enter" });
  });
  await settle(2);
  return screen().getByRole("menu");
};
const calls = (state: ReturnType<typeof acmeState>, method: string) => state.calls.filter((c) => c.method === method);

async function open(
  path: string,
  setup?: (devices: NonNullable<ReturnType<typeof fakeDevicesOf.get>>) => void,
  state = acmeState(),
) {
  const api = createFakeApi(state);
  const devices = fakeDevicesOf.get(api);
  if (!devices) throw new Error("no devices fake");
  devices.set(acmeDevices());
  fakeMachinesOf.get(api)?.setRelease({
    version: "1.8.0",
    url: "/api/desktop/download/1.8.0/agentes.dmg",
    sha256: "0".repeat(64),
    publishedAt: "2026-11-01T12:00:00.000Z",
  });
  setup?.(devices);
  const app = await renderApp(path, { api });
  await settle(6);
  await showIn(app.services, "en");
  return { ...app, state, devices, api };
}

describe("Settings › Devices", () => {
  test("old Computers links land on Devices", async () => {
    const { router } = await open(`/org/${ORG_ID}/settings/computers`);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices`);
    const old = await open(`/org/${ORG_ID}/settings/computers/${MAC}`);
    expect(old.router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices/${MAC}`);
  });

  test("the list: computers with their phones nested, states with their detail, whose and who can use it", async () => {
    await open(`/org/${ORG_ID}/settings/devices`);
    const list = screen().getByRole("list", { name: "Devices" });
    const rows = [...list.querySelectorAll(".dv-row")];
    expect(rows.map((r) => r.querySelector(".dv-row__name")?.textContent)).toEqual([
      "Workspace computer",
      "Sam's MacBook Pro",
      "Pixel 8",
      "Sam's iPhone 16",
      "Windows build PC",
      "build-box",
      "Ana's iMac",
      "Ana's iPhone 15",
    ]);
    const pixel = rows[2] as HTMLElement;
    expect(pixel.classList.contains("dv-row--child")).toBe(true);
    expect(pixel.querySelector(".dv-status")?.textContent).toBe("In use by Lia");
    expect(pixel.querySelector(".dv-row__detail")?.textContent).toMatch(/^for Rui since /);
    expect(pixel.querySelector(".dv-row__who")?.textContent).toBe("Everyone, phone only");
    const iphone = rows[3] as HTMLElement;
    expect(iphone.querySelector(".dv-status")?.getAttribute("data-status")).toBe("needs");
    expect(iphone.querySelector(".dv-row__detail")?.textContent).toBe("Turn on Developer Mode");
    expect(iphone.querySelector(".dv-row__who")?.textContent).toBe("Same as its Mac");
    expect(rows[4]?.querySelector(".dv-status")?.textContent).toBe("Busy 1/1");
    expect(rows[4]?.querySelector(".dv-row__owner")?.textContent).toBe("Workspace");
    expect(rows[6]?.querySelector(".dv-row__detail")?.textContent).toMatch(/^last seen /);
    expect(rows[7]?.querySelector(".dv-row__detail")?.textContent).toBe("with Ana's iMac");
    // The workspace computer has no menu.
    expect(rows[0]?.querySelector(".dv-row__end button")).toBeNull();
    // A computer asking to join sits on top.
    expect(screen().getByRole("list", { name: "Asking to join" }).textContent).toContain(
      "ci-runner wants to join Acme",
    );
  });

  test("filters and search", async () => {
    await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("radio", { name: /Phones/ }));
    const names = () =>
      [...screen().getByRole("list", { name: "Devices" }).querySelectorAll(".dv-row__name")].map((n) => n.textContent);
    expect(names()).toEqual(["Pixel 8", "Sam's iPhone 16", "Ana's iPhone 15"]);
    await click(screen().getByRole("radio", { name: /All/ }));
    const search = screen().getByRole("searchbox", { name: "Search devices" });
    await act(async () => fireEvent.change(search, { target: { value: "pixel" } }));
    await settle(2);
    expect(names()).toEqual(["Sam's MacBook Pro", "Pixel 8"]);
  });

  test("a row's menu opens with Settings, its page, for computers and phones", async () => {
    const { router } = await open(`/org/${ORG_ID}/settings/devices`);
    let menu = await openMenu(screen().getByRole("button", { name: "Sam's MacBook Pro actions" }));
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Settings", "Rename", "Remove"]);
    await click(within(menu).getByRole("menuitem", { name: "Settings" }));
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices/${MAC}`);
    await act(() =>
      router.navigate({ to: "/org/$orgId/settings/$section", params: { orgId: ORG_ID, section: "devices" } }),
    );
    await settle(4);
    menu = await openMenu(screen().getByRole("button", { name: "Pixel 8 actions" }));
    expect(within(menu).getAllByRole("menuitem")[0]?.textContent).toBe("Settings");
    await click(within(menu).getByRole("menuitem", { name: "Settings" }));
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices/phones/${PIXEL}`);
  });

  test("Let it join, from the list: name and who can use it, then the server lets it in", async () => {
    const { state } = await open(`/org/${ORG_ID}/settings/devices`);
    const ask = screen().getByRole("list", { name: "Asking to join" });
    await click(within(ask).getByRole("button", { name: "Let it join" }));
    const dialog = screen().getByRole("dialog", { name: "ci-runner wants to join Acme" });
    expect(dialog.textContent).toContain("203.0.113.7");
    await click(within(dialog).getByRole("button", { name: "Let it join" }));
    expect(calls(state, "devices.approveRequest")[0]?.args.slice(1)).toEqual([
      "r-ci",
      { name: "ci-runner", audience: { mode: "owner", userIds: [], roleIds: [] } },
    ]);
  });
});

describe("Connect a device", () => {
  test("a server: the one line, then the computer asking to join, then connected", async () => {
    const { state, devices, services } = await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    const chooser = screen().getByRole("dialog", { name: "Connect a device" });
    expect(chooser.textContent).toContain("Android phone");
    await click(within(chooser).getByRole("button", { name: /A server or VPS/ }));
    const dialog = screen().getByRole("dialog", { name: "Connect a server" });
    expect(dialog.querySelector("code")?.textContent).toBe("curl -fsSL https://app.agentes.chat/i/7KQ2-M9X1 | sh");
    expect(dialog.textContent).toContain("Works once, for 10 minutes");
    expect(dialog.textContent).toContain("Waiting for the server…");
    await click(within(dialog).getByRole("radio", { name: "Windows" }));
    expect(dialog.querySelector("code")?.textContent).toBe("irm https://app.agentes.chat/i/7KQ2-M9X1/ps | iex");
    devices.setLink({ status: "asking", request: acmeDevices().requests[0] });
    await refetch(services);
    const asking = screen().getByRole("dialog", { name: "ci-runner wants to join Acme" });
    await click(within(asking).getByRole("button", { name: "Let it join" }));
    // A server is everyone's by default.
    expect(calls(state, "devices.approveRequest")[0]?.args[2]).toEqual({
      name: "ci-runner",
      audience: { mode: "everyone", userIds: [], roleIds: [] },
    });
    expect(screen().getByRole("dialog", { name: "ci-runner is connected" })).toBeTruthy();
  });

  test("the computers: this one, another one, a server or VPS", async () => {
    await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    const computers = screen().getByRole("region", { name: "Computers" });
    expect([...computers.querySelectorAll(".dv-option__title")].map((n) => n.textContent)).toEqual([
      "This computer",
      "Another computer",
      "A server or VPS",
    ]);
    // Served over plain http here: the app wouldn't take a link to it, so this computer gets its one line.
    await click(screen().getByRole("button", { name: /This computer/ }));
    const line = screen().getByRole("dialog", { name: "Connect a computer" });
    expect(within(line).queryByRole("link", { name: "Open the agentes.chat app" })).toBeNull();
  });

  test("this computer, from a browser: the app opens a link to this server, asks to join, the maker lets it in", async () => {
    servedAt("https://app.agentes.chat/");
    const { state, devices, services } = await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /This computer/ }));
    const dialog = screen().getByRole("dialog", { name: "This computer" });
    expect(calls(state, "devices.createLink")[0]?.args).toEqual([ORG_ID, "computer"]);
    const app = within(dialog).getByRole("link", { name: "Open the agentes.chat app" });
    expect(app.getAttribute("href")).toBe("agenteschat://pair?server=https%3A%2F%2Fapp.agentes.chat&link=7KQ2-M9X1");
    expect(dialog.textContent).toContain("Waiting for the app on this computer…");
    expect(within(dialog).getByRole("heading", { name: "Don't have the app?" })).toBeTruthy();
    expect(dialog.textContent).toContain("After installing, press Open the agentes.chat app again.");

    devices.setLink({ status: "asking", request: acmeDevices().requests[0] });
    await refetch(services);
    const asking = screen().getByRole("dialog", { name: "ci-runner wants to join Acme" });
    await click(within(asking).getByRole("button", { name: "Let it join" }));
    // This computer is the maker's own until they share it.
    expect(calls(state, "devices.approveRequest")[0]?.args[2]).toEqual({
      name: "ci-runner",
      audience: { mode: "owner", userIds: [], roleIds: [] },
    });
  });

  test("this computer without the app: one line for its terminal, or a server's", async () => {
    servedAt("https://app.agentes.chat/");
    await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /This computer/ }));
    await click(screen().getByRole("button", { name: "Or paste one line in its terminal" }));
    const line = screen().getByRole("dialog", { name: "Connect a computer" });
    expect(line.querySelector("code")?.textContent).toMatch(
      /^curl -fsSL https:\/\/app\.agentes\.chat\/i\/7KQ2-M9X\d \| sh$/,
    );
    await click(within(line).getByRole("button", { name: "Back" }));
    await click(screen().getByRole("button", { name: /This computer/ }));
    await click(screen().getByRole("button", { name: "A server? Use a terminal line" }));
    expect(screen().getByRole("dialog", { name: "Connect a server" })).toBeTruthy();
  });

  test("another computer: the app on it, signed in as me, then Connected once a computer of mine shows up", async () => {
    const { devices, services } = await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /Another computer/ }));
    const dialog = screen().getByRole("dialog", { name: "Connect another computer" });
    expect(dialog.textContent).toContain("Open it and sign in as yourself.");
    expect(dialog.textContent).toContain("Click Allow when it asks to let Acme's agents use it.");
    expect(dialog.textContent).toContain("Waiting for a computer of yours…");

    const list = acmeDevices();
    const mac = list.devices.find((d) => d.id === MAC);
    if (!mac) throw new Error("no Mac");
    // Someone else's new computer isn't the one this dialog waits for.
    devices.set({
      ...list,
      devices: [...list.devices, { ...mac, id: "m-ana-new", name: "Ana's laptop", ownerUserId: ANA, phones: [] }],
    });
    await refetch(services);
    expect(dialog.textContent).toContain("Waiting for a computer of yours…");
    devices.set({
      ...list,
      devices: [...list.devices, { ...mac, id: "m-sam-new", name: "Sam's Mac mini", phones: [] }],
    });
    await refetch(services);
    expect(dialog.textContent).toContain("Connected: Sam's Mac mini");
    expect(within(dialog).getByRole("link", { name: "Open its page" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/settings/devices/m-sam-new`,
    );
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    await click(within(dialog).getByRole("button", { name: "Can't install the app on it? Use a terminal line" }));
    expect(screen().getByRole("dialog", { name: "Connect a computer" })).toBeTruthy();
  });

  test("an Android phone: the computer's live checklist, Allow on the phone, then connected", async () => {
    const { devices, services, state } = await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /Android phone/ }));
    const dialog = screen().getByRole("dialog", { name: "Connect an Android phone" });
    // Fresh: Developer options open, the rest folded to their titles. The computer can't see it, so the person ticks it.
    expect(stepsOf(dialog)).toEqual(["current", "waiting folded", "waiting folded", "waiting folded"]);
    // A step on the phone shows its number, not the live mark: the computer isn't the one working on it.
    expect(dialog.querySelector('.dv-step[data-state="current"] .dv-step__mark')?.childElementCount).toBe(0);
    // Our phone app is in no store yet: no QR that would only open this page in the phone's browser.
    expect(dialog.querySelector(".dv-qr")).toBeNull();
    // The guide asks the computer to look for a phone it has no driver for.
    expect(calls(state, "devices.lookForPhones").at(-1)?.args).toEqual([ORG_ID, MAC]);
    await click(within(dialog).getByRole("button", { name: "Done" }));
    expect(stepsOf(dialog)).toEqual(["done folded", "current", "waiting folded", "waiting folded"]);
    // Ticked by hand: opened again from its title, it may be unticked.
    await click(within(dialog).getByRole("button", { name: "Turn on Developer options" }));
    expect(stepsOf(dialog)).toEqual(["done", "current folded", "waiting folded", "waiting folded"]);
    await click(within(dialog).getByRole("button", { name: "Not done yet" }));
    expect(stepsOf(dialog)).toEqual(["current", "waiting folded", "waiting folded", "waiting folded"]);
    await click(within(dialog).getByRole("button", { name: "Done" }));
    await click(within(dialog).getByRole("button", { name: "Done" }));
    expect(stepsOf(dialog)).toEqual(["done folded", "done folded", "current", "waiting folded"]);
    expect(dialog.textContent).toContain("Looking for a phone on Sam's MacBook Pro…");
    // Before 30 s, nothing more; no old hint behind an ⓘ.
    expect(dialog.querySelector(".dv-slow")).toBeNull();
    expect(dialog.textContent).not.toContain("Phone not showing up?");
    const list = acmeDevices();
    const mac = list.devices.find((d) => d.id === MAC);
    const pixel = mac?.phones.find((p) => p.id === PIXEL);
    if (!mac || !pixel) throw new Error("fixture");
    mac.phones.push({
      ...pixel,
      id: "p-new",
      name: "Galaxy S24",
      status: { kind: "needs_you", reason: "unauthorized" },
    });
    devices.set(list);
    await refetch(services);
    // Seen, even before Allow: every step before it ticks by itself, and none may be unticked.
    expect(stepsOf(dialog)).toEqual(["done folded", "done folded", "done folded", "needs"]);
    await click(within(dialog).getByRole("button", { name: "Turn on Developer options" }));
    expect(within(dialog).queryByRole("button", { name: "Not done yet" })).toBeNull();
    await click(within(dialog).getByRole("button", { name: "Tap Allow on the phone" }));
    const allow = dialog.querySelector('.dv-step[data-state="needs"]');
    expect(allow?.textContent).toContain("Tap Allow on the phone");
    expect(allow?.textContent).toContain("Allow USB debugging?");
    const added = mac.phones.at(-1);
    if (added) added.status = { kind: "ready" };
    devices.set(list);
    await refetch(services);
    expect(screen().getByRole("dialog", { name: "Galaxy S24 is connected" })).toBeTruthy();
  });

  test("Android by cable: the phone already plugged in shows up asking, and every step before Allow is done", async () => {
    const { devices, services } = await open(`/org/${ORG_ID}/settings/devices/android-setup?computer=${MAC}`);
    const dialog = screen().getByRole("dialog", { name: "Connect an Android phone" });
    const list = acmeDevices();
    const mac = list.devices.find((d) => d.id === MAC);
    const pixel = mac?.phones.find((p) => p.id === PIXEL);
    if (!mac || !pixel) throw new Error("fixture");
    mac.phones.push({
      ...pixel,
      id: "p-new",
      name: "Galaxy S24",
      status: { kind: "needs_you", reason: "unauthorized" },
    });
    devices.set(list);
    await refetch(services);
    expect(stepsOf(dialog)).toEqual(["done folded", "done folded", "done folded", "needs"]);
    expect(dialog.querySelector('.dv-step[data-state="needs"]')?.textContent).toContain("Allow USB debugging?");
  });

  test("Android by cable on Windows: after 30 s, why a phone may not show up, the maker's USB driver included", async () => {
    const { devices, services, state } = await open(
      `/org/${ORG_ID}/settings/devices/android-setup?computer=${BUILD_PC}`,
    );
    const dialog = screen().getByRole("dialog", { name: "Connect an Android phone" });
    expect(calls(state, "devices.lookForPhones").at(-1)?.args).toEqual([ORG_ID, BUILD_PC]);
    await click(within(dialog).getByRole("button", { name: "Done" }));
    await click(within(dialog).getByRole("button", { name: "Done" }));
    await after30s();
    const help = dialog.querySelector(".dv-slow");
    expect(help?.closest(".dv-step")?.getAttribute("data-state")).toBe("current");
    expect(help?.querySelector(".dv-slow__title")?.textContent).toBe("Still not showing up?");
    expect([...(help?.querySelectorAll(".dv-slow__list > li") ?? [])].map((li) => li.textContent)).toEqual([
      "A cable that carries data. Some only charge. Or try another port.",
      "The phone unlocked, with its screen on.",
      "If the phone asks how to use USB, pick File transfer.",
      "USB debugging on. See step 2",
      "On Samsung, Auto Blocker off: Settings\u00a0›\u00a0Security and privacy\u00a0›\u00a0Auto Blocker.",
      "On Windows, the phone maker's USB driver:Google, for PixelSamsungOther makers",
    ]);
    expect([...(help?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(
      Object.values(ANDROID_USB_DRIVERS),
    );
    // See step 2 opens USB debugging again.
    await click(within(dialog).getByRole("button", { name: "See step 2" }));
    expect(stepsOf(dialog)).toEqual(["done folded", "done", "current folded", "waiting folded"]);

    // The computer finds the phone with no driver: the cable step says so, with the drivers.
    const list = acmeDevices();
    const pc = list.devices.find((d) => d.id === BUILD_PC);
    const pixel = list.devices.flatMap((d) => d.phones).find((p) => p.id === PIXEL);
    if (!pc || !pixel) throw new Error("fixture");
    pc.phones.push({
      ...pixel,
      id: "p-nodriver",
      name: "Pixel 8",
      hostMachineId: BUILD_PC,
      status: { kind: "needs_you", reason: "no_driver" },
    });
    devices.set(list);
    await refetch(services);
    expect(stepsOf(dialog)).toEqual(["done folded", "done folded", "needs", "waiting folded"]);
    const cable = dialog.querySelector('.dv-step[data-state="needs"]');
    expect(cable?.querySelector(".dv-step__text")?.textContent).toBe(
      "Windows build PC sees the phone but has no USB driver for it. Install the phone maker's driver, then plug the phone in again.",
    );
    expect(cable?.querySelectorAll(".dv-links a")).toHaveLength(3);
  });

  test("Android by cable on a Mac, in German with a long computer name: the 30 s help without a driver", async () => {
    const longName = "Sams MacBook Pro aus dem Entwicklungsbüro im dritten Stock neben der Kaffeemaschine";
    const app = await open(`/org/${ORG_ID}/settings/devices/android-setup?computer=${MAC}`, (devices) => {
      const list = acmeDevices();
      const mac = list.devices.find((d) => d.id === MAC);
      if (mac) mac.name = longName;
      devices.set(list);
    });
    await showIn(app.services, "de");
    const dialog = screen().getByRole("dialog");
    for (const _ of [1, 2]) {
      const done = dialog.querySelector<HTMLButtonElement>('.dv-step[data-state="current"] .dv-step__more .ac-btn');
      if (!done) throw new Error("no Done");
      await click(done);
    }
    await after30s();
    const items = dialog.querySelectorAll(".dv-slow__list > li");
    expect(items).toHaveLength(5);
    expect(dialog.querySelector(".dv-slow a")).toBeNull();
    expect(dialog.textContent).toContain(longName);
  });

  test("an Android phone over Wi-Fi: Android's pairing QR, the computer's live line, then connected", async () => {
    const { state, devices, services } = await open(`/org/${ORG_ID}/settings/devices`);
    const ask = async () => {
      await act(async () => {
        await services.queryClient.invalidateQueries({ queryKey: ["wifi-pair-state"] });
      });
      await refetch(services);
    };
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /Android phone/ }));
    const dialog = screen().getByRole("dialog", { name: "Connect an Android phone" });
    await click(within(dialog).getByRole("radio", { name: "Over Wi-Fi" }));
    expect(calls(state, "devices.startWifiPairing")[0]?.args).toEqual([ORG_ID, MAC, {}]);
    expect(dialog.querySelector('.dv-qr svg[aria-label="QR code for Wireless debugging on the phone"]')).toBeTruthy();
    expect(dialog.querySelector('.dv-step[data-state="current"]')?.textContent).toContain(
      "Waiting for the phone to scan…",
    );
    expect(dialog.querySelector(".ac-setpath")?.textContent).toBe(
      "Developer optionsWireless debuggingPair device with QR code",
    );
    expect(dialog.querySelector('.dv-step[data-state="current"] .dv-step__title')?.textContent).toBe(
      "Scan it from Wireless debugging, not the camera",
    );
    expect(dialog.querySelector(".dv-qr")?.textContent).toBe(
      "Not with the cameraIt offers a Wi-Fi network named agentes-…, which doesn't exist. Keep the phone on the computer's Wi-Fi.",
    );
    devices.setPairing({ state: "pairing" });
    await ask();
    expect(dialog.textContent).toContain("Found a phone. Pairing…");
    expect(dialog.querySelector(".dv-qr--used")).toBeTruthy();

    // Nothing in 2 minutes: the camera or a phone off the Wi-Fi, and on a Mac its Local Network setting. Try again makes a new code.
    devices.setPairing({ state: "failed", reason: "timed_out" });
    await ask();
    const failed = dialog.querySelector('.dv-step[data-state="needs"]');
    expect(failed?.textContent).toContain(
      "No phone paired in 2 minutes. If the camera scanned the code or the phone left the Wi-Fi, put it on the same Wi-Fi as Sam's MacBook Pro and scan from Wireless debugging. On that Mac, also turn on agentes.chat in System Settings › Privacy & Security › Local Network.",
    );
    await click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(calls(state, "devices.startWifiPairing")).toHaveLength(2);

    // The six-digit way: what the phone shows, typed here.
    await click(within(dialog).getByRole("button", { name: "Use a pairing code instead" }));
    expect(calls(state, "devices.cancelWifiPairing").length).toBeGreaterThan(0);
    // No pairing QR now, and no QR into a phone app that isn't out yet: the steps take the dialog's width.
    expect(dialog.querySelector(".dv-qr")).toBeNull();
    const pairButton = within(dialog).getByRole("button", { name: "Pair" }) as HTMLButtonElement;
    expect(pairButton.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText("IP address and port"), {
        target: { value: "192.168.1.20:37099" },
      });
      fireEvent.change(within(dialog).getByLabelText("Wi-Fi pairing code"), { target: { value: "123456" } });
    });
    await click(pairButton);
    expect(calls(state, "devices.startWifiPairing").at(-1)?.args).toEqual([
      ORG_ID,
      MAC,
      { address: "192.168.1.20:37099", code: "123456" },
    ]);
    const list = acmeDevices();
    const mac = list.devices.find((d) => d.id === MAC);
    const pixel = mac?.phones.find((p) => p.id === PIXEL);
    if (!mac || !pixel) throw new Error("fixture");
    mac.phones.push({ ...pixel, id: "p-wifi", name: "Galaxy S24", transport: "wifi", status: { kind: "ready" } });
    devices.set(list);
    devices.setPairing({ state: "connected", phoneId: "p-wifi" });
    await ask();
    expect(screen().getByRole("dialog", { name: "Galaxy S24 is connected" })).toBeTruthy();
  });

  test("the Android steps in Portuguese: Android's own prompt, where to scan, the code way", async () => {
    const app = await open(`/org/${ORG_ID}/settings/devices/android-setup?computer=${MAC}`);
    await showIn(app.services, "pt-BR");
    const dialog = screen().getByRole("dialog", { name: "Conectar um celular Android" });
    expect(within(dialog).getByRole("button", { name: "Já fiz" })).toBeTruthy();
    // A later step opens from its title, to read ahead.
    await click(within(dialog).getByRole("button", { name: "Toque em Permitir no celular" }));
    expect(dialog.textContent).toContain("Permitir a depuração USB?");
    expect(dialog.textContent).toContain("Sempre permitir neste computador");
    await click(within(dialog).getByRole("radio", { name: "Por Wi-Fi" }));
    const qr = dialog.querySelector(".dv-qr")?.textContent;
    app.devices.setPairing({ state: "failed", reason: "same_wifi" });
    await act(async () => {
      await app.services.queryClient.invalidateQueries({ queryKey: ["wifi-pair-state"] });
    });
    await settle(4);
    const failed = dialog.querySelector('.dv-step[data-state="needs"] .dv-step__head .dv-step__text')?.textContent;
    await click(within(dialog).getByRole("button", { name: "Usar um código de pareamento" }));
    expect(qr).toContain("Não pela câmera");
    expect(failed).toBe(
      "Não deu para alcançar o celular. Coloque-o no mesmo Wi-Fi que Sam's MacBook Pro. Nesse Mac, ligue também o agentes.chat em Ajustes do Sistema › Privacidade e Segurança › Rede Local.",
    );
    expect(within(dialog).getByLabelText("Endereço IP e porta")).toBeTruthy();
    expect(within(dialog).getByLabelText("Código de pareamento por Wi-Fi")).toBeTruthy();
  });

  test("an iPhone: the checklist mirrors the Mac, Developer Mode as a Settings path", async () => {
    await open(`/org/${ORG_ID}/settings/devices`);
    await click(screen().getByRole("button", { name: "Connect a device" }));
    await click(screen().getByRole("button", { name: /iPhone/ }));
    const dialog = screen().getByRole("dialog", { name: "Connect an iPhone" });
    const states = [...dialog.querySelectorAll(".dv-step")].map((s) => s.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "done", "done", "done", "needs", "waiting", "waiting"]);
    expect(dialog.querySelector(".ac-setpath")?.textContent).toBe("SettingsPrivacy & SecurityDeveloper Mode");
  });

  test("an iPhone: each state has its way out, an old one ends the guide, a still step says why", async () => {
    type Status = PhoneDevice["status"];
    /** The fixture with Sam's iPhone in `status` (null: unplugged) and the Mac's toolchains topped up. */
    const iphoneAs = (status: Status | null, over: Partial<PhoneDevice> = {}, tools: Record<string, string> = {}) => {
      const list = acmeDevices();
      const mac = list.devices.find((d) => d.id === MAC);
      const iphone = mac?.phones.find((p) => p.id === IPHONE);
      if (!mac || !iphone) throw new Error("fixture");
      Object.assign(mac.toolchains, tools);
      if (status) Object.assign(iphone, { status, ...over });
      else mac.phones = mac.phones.filter((p) => p.id !== IPHONE);
      return list;
    };
    const app = await open(`/org/${ORG_ID}/settings/devices/iphone-setup?computer=${MAC}`);
    const dialog = () => screen().getByRole("dialog", { name: "Connect an iPhone" });
    const step = () => dialog().querySelector('.dv-step[data-state="current"], .dv-step[data-state="needs"]');
    const show = async (list: ReturnType<typeof acmeDevices>) => {
      app.devices.set(list);
      await refetch(app.services);
    };
    const team = { appleTeam: "Sam Rivera (Personal Team)" };

    await show(iphoneAs({ kind: "needs_you", reason: "ui_not_authorized" }));
    expect(step()?.textContent).toContain("Turn on UI Automation");
    expect(step()?.textContent).toContain("The iPhone refused the test helper's taps. Unlock it");

    await show(iphoneAs({ kind: "needs_you", reason: "xcode_too_old" }, {}, { xcodeSdk: "26.2" }));
    expect(step()?.textContent).toContain(
      "Sam's iPhone 16 runs iOS 27.1 and Xcode on Sam's MacBook Pro knows iOS 26.2 at most. Install Xcode 27, then run this in Terminal.",
    );
    expect(step()?.querySelector(".machine-command__code")?.textContent).toBe("xcrun devicectl manage ddis update");

    // Below iOS 17: the guide ends at being connected, says why, and nothing spins.
    await show(iphoneAs({ kind: "unsupported", reason: "os_too_old" }, { osVersion: "16.7.10" }));
    expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 16.7.10, and agents need iOS 17 or newer.");
    expect(dialog().querySelector(".dv-step__mark .ac-pixspin")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: "Done" })).toBeNull();
    // devicectl names no version for some of them.
    await show(iphoneAs({ kind: "unsupported", reason: "os_too_old" }, { osVersion: "" }));
    expect(step()?.textContent).toContain("Sam's iPhone 16 runs iOS 16 or older, and agents need iOS 17 or newer.");

    // Xcode lists an account that shows no team yet: how to get one, not "sign in".
    await show(iphoneAs(null, {}, { appleAccount: "no_team" }));
    expect(step()?.textContent).toContain("Apple Account in Xcode");
    expect(step()?.textContent).toContain("Xcode is signed in but shows no team yet.");

    // Plugged in, the Mac sees no iPhone: what to check, at once.
    await show(iphoneAs(null, {}, team));
    expect(step()?.getAttribute("data-state")).toBe("current");
    await click(within(step() as HTMLElement).getByRole("button", { name: "It's plugged in" }));
    expect(step()?.querySelector(".dv-step__stall")?.textContent).toBe(
      "Sam's MacBook Pro doesn't see an iPhone yet. Use a cable that carries data, not only power, unlock the iPhone and tap Trust if it asks.",
    );

    // The Mac builds the helper: 45 s with nothing new, and it says what that waits for.
    await show(iphoneAs({ kind: "preparing", reason: "helper_missing" }, {}, team));
    expect(step()?.textContent).toContain("Test helper");
    expect(step()?.querySelector(".dv-step__stall")).toBeNull();
    try {
      setSystemTime(new Date(Date.now() + 46_000));
      await refetch(app.services);
      expect(step()?.querySelector(".dv-step__stall")?.textContent).toContain(
        "Sam's MacBook Pro builds the test helper and starts it on the iPhone",
      );
    } finally {
      setSystemTime();
    }
  });
});

describe("A device's page", () => {
  test("a phone in use: Stop, and who can use it", async () => {
    const { state } = await open(`/org/${ORG_ID}/settings/devices/phones/${PIXEL}`);
    const line = document.querySelector(".dv-statusline");
    expect(line?.textContent).toContain("In use by Lia");
    expect(line?.textContent).toContain("Recording a test video");
    await click(within(line as HTMLElement).getByRole("button", { name: "Stop" }));
    expect(calls(state, "devices.stopPhone")[0]?.args).toEqual([ORG_ID, PIXEL]);
  });

  test("a phone's screen: watched while Lia uses it, taken by its owner, input as frames, given back", async () => {
    const drawn = globalThis.createImageBitmap;
    globalThis.createImageBitmap = (async () => ({ width: 1080, height: 2400, close() {} })) as never;
    try {
      const { sockets } = await open(`/org/${ORG_ID}/settings/devices/phones/${PIXEL}`);
      const screens = () => sockets.sockets.filter((s) => s.url.includes("/api/phone-screen"));
      const watch = screens().at(-1);
      expect(watch?.url).toContain(`phoneId=${PIXEL}&mode=watch`);
      const card = screen().getByRole("region", { name: "Screen" });
      expect(card.textContent).toContain("Lia is using it for Rui");
      expect(card.textContent).toContain("Taking control pauses Lia until you give it back.");
      expect(within(card).queryByRole("button", { name: "Take control" })).toBeNull();
      // Its first picture: live, acknowledged, and Take control shows.
      const picture = async (s: (typeof sockets.sockets)[number]) => {
        await act(async () => {
          s.onmessage?.({ data: new ArrayBuffer(8) });
        });
        await settle(4);
      };
      await act(async () => watch?.open());
      await picture(watch as (typeof sockets.sockets)[number]);
      expect(watch?.sent).toEqual([{ type: "ack" }]);
      await click(within(card).getByRole("button", { name: "Take control" }));
      expect(watch?.closed).toBe(true);
      const control = screens().at(-1) as (typeof sockets.sockets)[number];
      expect(control.url).toContain("mode=control");
      await act(async () => control.open());
      // Nothing of its own until its first picture: opening, and no input goes anywhere yet.
      expect(card.textContent).toContain("Opening the screen…");
      expect(card.textContent).not.toContain("You're in control");
      await picture(control);
      expect(card.textContent).toContain("You're in control");
      const canvas = card.querySelector("canvas") as HTMLCanvasElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 200 }) as DOMRect;
      await act(async () => {
        fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, button: 0 });
        fireEvent.pointerUp(canvas, { clientX: 50, clientY: 50, button: 0 });
      });
      const stage = screen().getByRole("application", { name: "Pixel 8's screen, live" });
      await act(async () => {
        fireEvent.keyDown(stage, { key: "a" });
        fireEvent.keyDown(stage, { key: "Enter" });
      });
      await click(within(card).getByRole("button", { name: "Home" }));
      expect(control.sent).toEqual([
        { type: "ack" },
        { type: "tap", x: 0.5, y: 0.25 },
        { type: "text", text: "a" },
        { type: "key", key: "enter" },
        { type: "key", key: "home" },
      ]);
      await click(within(card).getByRole("button", { name: "Give back" }));
      expect(control.closed).toBe(true);
      expect(screens().at(-1)?.url).toContain("mode=watch");
    } finally {
      globalThis.createImageBitmap = drawn;
    }
  });

  test("an iPhone follows its Mac", async () => {
    await open(`/org/${ORG_ID}/settings/devices/phones/${IPHONE}`);
    expect(document.querySelector(".settings-rows")?.textContent).toContain("Same as Sam's MacBook Pro");
  });

  test("an admin on someone's computer may only narrow who can use it", async () => {
    await open(`/org/${ORG_ID}/settings/devices/${IMAC}`);
    const select = screen().getByRole("combobox", { name: "Who can use it" });
    await act(async () => {
      fireEvent.pointerDown(select, { button: 0, pointerType: "mouse" });
      fireEvent.keyDown(select, { key: "Enter" });
    });
    await settle(2);
    const options = screen().getAllByRole("option");
    const disabled = options.filter((o) => o.getAttribute("aria-disabled") === "true").map((o) => o.textContent);
    expect(disabled).toEqual(["Everyone in the workspace", "Only some people or roles"]);
  });
});

describe("In the chat and the inbox", () => {
  test("an agent waiting for a device: Try now, another device, Stop waiting; once it's back, an ended pill", async () => {
    const state = acmeState();
    state.messages.push({
      id: "m-wait",
      channelId: ENG_ID,
      threadId: null,
      author: { type: "agent", id: LIA },
      body: "",
      mentionedAgentIds: [],
      agentRunId: "run-1",
      createdAt: new Date().toISOString(),
      meta: {
        deviceWait: {
          runId: "run-1",
          agentId: LIA,
          device: {
            kind: "phone",
            id: "p-ana-iphone",
            name: "Ana's iPhone 15",
            platform: "ios",
            hostId: "m-imac",
            hostName: "Ana's iMac",
            ownerUserId: "u-ana",
          },
          deviceName: "Ana's iPhone 15",
          hostName: "Ana's iMac",
          reason: "offline",
          detail: null,
          lastSeenAt: new Date(Date.now() - 18 * 60_000).toISOString(),
          state: "waiting",
        },
      },
    } as never);
    const { sockets } = await open(`/org/${ORG_ID}/c/${ENG_ID}`, undefined, state);
    await act(async () => sockets.last().open());
    const card = document.querySelector(".rq-open") as HTMLElement;
    expect(card.textContent).toContain("Waiting for Ana's iPhone 15");
    expect(card.textContent).toContain("Ana's iMac is offline");
    await click(within(card).getByRole("button", { name: "Try now" }));
    expect(calls(state, "devices.deviceWait")[0]?.args).toEqual([ORG_ID, "run-1", "retry"]);
    await click(within(card).getByRole("button", { name: "Stop waiting" }));
    expect(calls(state, "devices.deviceWait")[1]?.args).toEqual([ORG_ID, "run-1", "stop"]);
    // The server ends the wait and says so on the channel: the card flips without a reload.
    await act(async () =>
      sockets.last().push({
        type: "event",
        channelId: ENG_ID,
        event: {
          type: "device_wait.updated",
          channelId: ENG_ID,
          threadId: null,
          messageId: "m-wait",
          deviceWait: { deviceName: "Ana's iPhone 15", reason: "offline", state: "back" },
        },
      }),
    );
    await settle(4);
    expect(document.querySelector(".rq-done")?.textContent).toContain("Ana's iPhone 15 is back");
  });

  test("someone's agent asks for my phone: Allow once, Always or No, in the inbox", async () => {
    const state = acmeState();
    state.notifications = [
      notification({
        id: "n-dev",
        kind: "device.access_request" as never,
        waiting: true,
        actors: [{ type: "agent", id: LIA }],
        source: { requestId: "ar-1", phoneId: IPHONE, label: "Sam's iPhone 16", userId: RUI, runId: "run-2" } as never,
        latest: { title: "Rui", text: "Record the checkout" },
      }),
    ];
    await open(`/org/${ORG_ID}/notifications`, undefined, state);
    const row = document.querySelector('[data-n="n-dev"]') as HTMLElement;
    expect(row.textContent).toContain("Lia (for Rui) asks to use Sam's iPhone 16");
    expect(row.textContent).toContain("Devices");
    await click(within(row).getByRole("button", { name: "Allow once" }));
    expect(calls(state, "devices.decideAccess")[0]?.args).toEqual([ORG_ID, "ar-1", "once"]);
  });
});
