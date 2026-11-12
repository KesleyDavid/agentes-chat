import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import { siteApi } from "../src/control/devices";
import { PREPARE_PREF } from "../src/control/permissions";
import { DesktopStore, pairedHomes } from "../src/control/store";
import { FAKE_SERVER } from "../src/dev/fake-runner";
import { readPref, writePref } from "../src/hooks";
import { createFakeHost, type FakeHost } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ToastProvider } from "../src/ui/Toast";
import { Popover } from "../src/windows/Popover";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The menu checks agentes.chat for a desktop update: tests stay off the network, so no release yet. And
// intersections come by hand (happy-dom reports none), to the observer watching inside a given root.
const realFetch = globalThis.fetch;
const realObserver = globalThis.IntersectionObserver;
const observers: { root: unknown; callback: IntersectionObserverCallback }[] = [];
beforeAll(() => {
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      observers.push({ root: options?.root, callback });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  globalThis.IntersectionObserver = realObserver;
});

/**
 * The menu, by default with agentes.chat on this Mac, a folder request and two jobs (taller than the menu gets),
 * once `ready` says it shows what the test looks at.
 */
async function withMenu(
  check: (el: HTMLElement, store: DesktopStore) => unknown,
  host: FakeHost = createFakeHost("popover", "here"),
  ready: (el: HTMLElement) => unknown = (el) => el.querySelector(".dk-req"),
) {
  const store = new DesktopStore(host, {});
  const stop = store.start();
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={createDesktopI18n("en", host.platform)}>
          <AppProvider host={host} store={store}>
            <ToastProvider>
              <Popover />
            </ToastProvider>
          </AppProvider>
        </I18nextProvider>,
      );
    });
    await until(() => ready(el));
    await check(el, store);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

/** Each banner on the menu: its title, the line under it (null without one) and its buttons. */
const banners = (el: HTMLElement) =>
  [...el.querySelectorAll(".dk-banner")].map((banner) => ({
    title: banner.querySelector(".dk-banner__text b")?.textContent,
    line: banner.querySelector(".dk-banner__text small")?.textContent ?? null,
    actions: [...banner.querySelectorAll(".dk-banner__acts button")].map((b) => b.textContent),
  }));

test("the menu bar menu: what goes on here scrolls, and Open, Preferences and Quit stay below it", () =>
  withMenu((el) => {
    const body = el.querySelector(".dk-pop__body");
    const foot = el.querySelector(".dk-pop__foot");
    expect(body?.querySelector(".dk-req")).toBeTruthy();
    expect(body?.querySelector(".dk-job")).toBeTruthy();
    expect(body?.querySelector("button.dk-mi")).toBeNull();
    const actions = [...(foot?.querySelectorAll("button.dk-mi") ?? [])].map((b) => b.textContent ?? "");
    for (const label of ["Open agentes.chat", "Preferences…", "Quit agentes.chat"]) {
      expect(actions.some((text) => text.includes(label))).toBe(true);
    }
  }));

test("on a short screen the card's cap is lower, so the window and the actions at its bottom stay on it", async () => {
  const screen = window.screen as { availHeight: number };
  const height = screen.availHeight;
  screen.availHeight = 640;
  try {
    await withMenu((el) => {
      // 640 less the window's margins around the card (6 above, 34 below).
      const shell = el.querySelector<HTMLElement>(".dk-pop-shell");
      expect(shell?.style.getPropertyValue("--pop-room")).toBe("600px");
    });
  } finally {
    screen.availHeight = height;
  }
});

test("the middle fades out at the bottom while its end is out of sight, by the latest crossing", () =>
  withMenu(async (el) => {
    const body = el.querySelector(".dk-pop__body");
    const watcher = observers.findLast((o) => o.root === body);
    expect(watcher).toBeDefined();
    const cross = (...seen: boolean[]) =>
      act(async () => watcher?.callback(seen.map((isIntersecting) => ({ isIntersecting })) as never, {} as never));
    await cross(true, false);
    expect(body?.hasAttribute("data-more")).toBe(true);
    await cross(false, true);
    expect(body?.hasAttribute("data-more")).toBe(false);
  }));

describe("the menu's banners say only what matters there", () => {
  /** A newer version of the app, from the release the menu checks. */
  async function withUpdate(run: () => Promise<void>) {
    const before = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        version: "9.9.9",
        url: "https://app.agentes.chat/api/desktop/download/9.9.9/agentes_9.9.9_universal.dmg",
      })) as unknown as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = before;
    }
  }
  const update = { title: "Version 9.9.9 is available", line: null, actions: ["See what's new"] };

  test("a new version: its title and See what's new, with or without agents working here", () =>
    withUpdate(async () => {
      await withMenu(
        (el) => expect(banners(el)).toContainEqual(update),
        createFakeHost("popover", "here"),
        (el) => el.querySelector(".dk-req") && banners(el).length > 0,
      );
      await withMenu(
        (el) => expect(banners(el)).toEqual([update]),
        createFakeHost("popover", "cloud"),
        (el) => banners(el).length > 0,
      );
    }));

  test("agentes.chat not starting here: its title, why and where to look, Copy details, the logs and Try again", () =>
    withMenu(
      (el) =>
        expect(banners(el)).toContainEqual({
          title: "agentes.chat isn't starting on this Mac",
          line: "The details say why: copy them for whoever helps you, or look at the logs. Help",
          actions: ["Copy details", "Show the logs", "Try again"],
        }),
      createFakeHost("popover", "here", { here: { phase: "failing" } }),
      (el) => banners(el).length > 0,
    ));

  test("no internet: what already started keeps going", async () => {
    const host = createFakeHost("popover", "here");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      await withMenu(async (el) => {
        await act(async () => {
          for (const runner of host.runners.values()) runner.setOnline(false);
        });
        await until(() => banners(el).some((b) => b.title === "No internet. Trying again…"));
        expect(banners(el).find((b) => b.title === "No internet. Trying again…")?.line).toBe(
          "What already started keeps running here and sends the result when the connection is back.",
        );
      }, host);
    } finally {
      delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  test("paused: no agent starts anything new here", () =>
    withMenu(async (el, store) => {
      await act(async () => {
        await store.requestAll({ type: "pause", until: null });
      });
      await until(() => banners(el).some((b) => b.title === "Paused until you resume"));
      expect(banners(el).find((b) => b.title === "Paused until you resume")?.line).toBe(
        "No agent, from any workspace, starts anything new on this Mac.",
      );
    }));

  test("paused: Resume now, pressed, waits for its answer: it shows it and takes no second press", () =>
    withMenu(async (el, store) => {
      await act(async () => {
        await store.requestAll({ type: "pause", until: null });
      });
      await until(() => banners(el).some((b) => b.title === "Paused until you resume"));
      const sent: string[] = [];
      let answer = () => {};
      const real = store.requestAll.bind(store);
      store.requestAll = ((request: { type: string }) => {
        sent.push(request.type);
        return new Promise((resolve) => {
          answer = () => resolve(real(request as never));
        });
      }) as typeof store.requestAll;
      const resume = () =>
        [...el.querySelectorAll<HTMLButtonElement>(".dk-banner__acts button")].find(
          (b) => b.textContent === "Resume now",
        );
      await act(async () => resume()?.click());
      await act(async () => resume()?.click());
      expect(sent).toEqual(["resume"]);
      expect(resume()?.getAttribute("aria-busy")).toBe("true");
      expect(resume()?.disabled).toBe(true);
      await act(async () => answer());
      await until(() => !banners(el).some((b) => b.title === "Paused until you resume"));
    }));

  test("Quit: what happens to the work running here, and to everyone when agentes.chat runs here", async () => {
    const quit = async (el: HTMLElement) => {
      const button = [...el.querySelectorAll("button.dk-mi")].find((b) => b.textContent?.includes("Quit agentes.chat"));
      await act(async () => (button as HTMLButtonElement | undefined)?.click());
      return el.querySelector(".dk-confirm p")?.textContent;
    };
    await withMenu(
      async (el) =>
        expect(await quit(el)).toBe(
          "Agents can't use this Mac while the app is closed. What is already running finishes and sends the result when you open it again.",
        ),
      createFakeHost("popover", "selfhost"),
    );
    await withMenu(async (el) =>
      expect(await quit(el)).toBe(
        "agentes.chat stops on this Mac: nobody can use it, here, on your phone or your teammates', until you open the app again.",
      ),
    );
  });
});

describe("the server here's Stop (ADR 0158)", () => {
  test("in sight, with how long and what it cuts off; an hour says when it's back", () =>
    withMenu(async (el) => {
      const stop = [...el.querySelectorAll(".dk-ph button")].find((b) => b.textContent === "Stop") as HTMLElement;
      await act(async () => stop.click());
      const rows = [...el.querySelectorAll(".dk-here__more button")].map((b) => b.textContent);
      expect(rows).toEqual(["Stop for 1 hour", "Stop until I start it", "Don't start it with the app…"]);
      expect(el.querySelector(".dk-here__more .dk-sub__hint")?.textContent).toBe(
        "Stopping cuts everyone off, the phone included.",
      );
      await act(async () => (el.querySelector(".dk-here__more button") as HTMLElement).click());
      await until(() => el.querySelector(".dk-ph small")?.textContent?.startsWith("Stopped · back at"));
      const start = [...el.querySelectorAll(".dk-ph button")].find((b) => b.textContent === "Start it");
      expect(start).toBeTruthy();
    }));
});

test("the site's This computer: the Mac pairs with commands on, then the welcome window prepares it", async () => {
  const host = createFakeHost("popover", "selfhost");
  try {
    await withMenu(
      async (_el, store) => {
        let userCode = "";
        await act(async () => {
          const reply = await host.askThisMac({
            kind: "connect",
            orgId: "o-norte",
            origin: FAKE_SERVER,
            agentsHere: true,
          });
          userCode = (reply.data as { userCode: string }).userCode;
        });
        await act(async () => {
          await siteApi(host, FAKE_SERVER).machines.confirmDevice("o-norte", userCode, {});
        });
        const norte = () => pairedHomes(store.getSnapshot()).find((h) => h.status?.org?.id === "o-norte");
        await until(() => norte()?.access?.tools.commands === true);
        await until(() => host.window === "welcome");
        expect(readPref<unknown>(PREPARE_PREF, null)).toEqual({ org: "Estúdio Norte", server: FAKE_SERVER });
        expect(await host.autostart()).toBe(true);
      },
      host,
      (el) => el.querySelector(".dk-pop__foot"),
    );
  } finally {
    writePref(PREPARE_PREF, null);
  }
});
