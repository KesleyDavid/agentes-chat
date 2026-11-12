import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppProvider } from "../src/app";
import type { Tailnet } from "../src/control/local-server";
import { DesktopStore } from "../src/control/store";
import type { UpdateCheck } from "../src/hooks";
import { createFakeHost, type FakeHost, type Scenario } from "../src/host/fake";
import { createDesktopI18n } from "../src/i18n";
import { ToastProvider } from "../src/ui/Toast";
import { Advanced } from "../src/windows/prefs/Advanced";
import { Folders } from "../src/windows/prefs/Folders";
import { General } from "../src/windows/prefs/General";
import { Servers } from "../src/windows/prefs/Servers";
import { Tools } from "../src/windows/prefs/Tools";
import { Updates } from "../src/windows/prefs/Updates";
import { until } from "./until";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A Preferences tab on a fake host, once `ready` says it shows what the test looks at. `options.host` changes the
 * host before the tab first reads it.
 */
async function pane(
  scenario: Scenario,
  view: ReactNode,
  ready: (el: HTMLElement) => unknown,
  check: (el: HTMLElement, host: FakeHost, opened: string[]) => Promise<void> | void,
  options: { someCommands?: boolean; host?: (host: FakeHost) => void } = {},
) {
  const host = createFakeHost("prefs", scenario, { someCommands: options.someCommands });
  options.host?.(host);
  const opened: string[] = [];
  host.openExternal = async (url) => {
    opened.push(url);
  };
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
    await until(() => ready(el));
    await check(el, host, opened);
  } finally {
    await act(async () => root.unmount());
    el.remove();
    stop();
    for (const runner of host.runners.values()) runner.stop();
  }
}

/** What an element is described by, each description in order (a hint's text is in the page while it's closed). */
const describedBy = (el: Element | null | undefined) =>
  (el?.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(" ") || null;

/** Each row: its title, its ⓘ's hint, the hint its switch reads (when it has one) and the line under the title. */
const rows = (root: ParentNode) =>
  [...root.querySelectorAll(".dk-crow")].map((row) => {
    const control = row.querySelector(':scope > .dk-crow__end > [role="switch"]');
    return {
      title: row.querySelector(".dk-crow__title")?.textContent ?? null,
      hint: describedBy(row.querySelector("button.ac-hint")),
      ...(control ? { switch: describedBy(control) } : {}),
      line: row.querySelector(".dk-crow__text > small")?.textContent ?? null,
    };
  });
const row = (root: ParentNode, title: string) => rows(root).find((r) => r.title === title);

describe("Preferences: a setting's explanation behind its ⓘ", () => {
  test("General: no lead, and each behavior on one line, its ⓘ where it has something to say", () =>
    pane(
      "selfhost",
      <General />,
      (el) => el.querySelectorAll(".dk-card").length >= 3,
      (el) => {
        expect(el.querySelector(".dk-phead .dk-lead")).toBeNull();
        const behavior = [...el.querySelectorAll(".dk-card")].at(-1) as HTMLElement;
        expect(rows(behavior)).toEqual([
          // The language this computer shows the app in (ADR 0122): nothing to explain.
          { title: "Language", hint: null, line: null },
          {
            title: "Let me know about messages and requests",
            hint: "Mentions, direct messages and what waits for you, while the app is in the background.",
            switch: "Mentions, direct messages and what waits for you, while the app is in the background.",
            line: null,
          },
          { title: "Let me know when an agent asks for a folder", hint: null, switch: null, line: null },
          {
            title: "Let me know when an agent needs me in its browser",
            hint: "The request already reaches your phone and the site. This tells you here too.",
            switch: "The request already reaches your phone and the site. This tells you here too.",
            line: null,
          },
          {
            title: "Show in the Dock",
            hint: "With the count of what waits for you. Off, the app stays in the menu bar only while no window is open.",
            switch:
              "With the count of what waits for you. Off, the app stays in the menu bar only while no window is open.",
            line: null,
          },
          { title: "Show in the menu bar", hint: null, switch: null, line: null },
          {
            title: "Show the agents in the notch",
            hint: "On MacBooks with a notch: who is working shows around the camera.",
            switch: "On MacBooks with a notch: who is working shows around the camera.",
            line: null,
          },
        ]);
        // Open at login closes This Mac's card, where agents use this computer while the app is open.
        expect(row(el, "Open at login")).toEqual({
          title: "Open at login",
          hint: "Agents only use this Mac while the app is open.",
          switch: "Agents only use this Mac while the app is open.",
          line: null,
        });
        // The computer's name and the organizations: no lines that only describe them.
        expect(row(el, "Name")?.line).toBeNull();
        expect(el.textContent).not.toContain("Each one has its own folders and tasks");
      },
    ));

  test("Servers: the usage switch keeps what changing it does in sight, what it sends behind its ⓘ", () =>
    pane(
      "here",
      <Servers />,
      (el) =>
        row(el, "Send anonymous usage statistics to agentes.chat") &&
        row(el, "Reach it from your phone and teammates")?.line === null,
      (el) => {
        expect(row(el, "Send anonymous usage statistics to agentes.chat")).toEqual({
          title: "Send anonymous usage statistics to agentes.chat",
          hint: "Counts such as people, agents, machine sizes, AI tokens used and how much data the agents' browsers send and receive. Never messages, files, names or sites.",
          // The switch reads the hint, then what changing it does.
          switch:
            "Counts such as people, agents, machine sizes, AI tokens used and how much data the agents' browsers send and receive. Never messages, files, names or sites. Changing it restarts agentes.chat for a moment.",
          line: "Changing it restarts agentes.chat for a moment.",
        });
        expect(el.textContent).not.toContain("nothing is sent");
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe("Where this app opens agentes.chat.");
      },
    ));

  test("Servers: until Tailscale answers, reach says it is checking and its switch waits", async () => {
    // Tailscale is connected, but its read takes a moment: the line says so, never "Needs Tailscale" meanwhile.
    const answers: ((tailnet: Tailnet) => void)[] = [];
    await pane(
      "here",
      <Servers />,
      (el) => row(el, "Reach it from your phone and teammates"),
      async (el) => {
        const reach = () => row(el, "Reach it from your phone and teammates");
        expect(reach()?.line).toBe("Checking whether Tailscale is connected…");
        expect(el.querySelector("#here-reach")?.hasAttribute("disabled")).toBe(true);
        await act(async () => {
          for (const answer of answers) answer({ state: "on", device: "macbook" });
        });
        await until(() => !el.querySelector("#here-reach")?.hasAttribute("disabled"));
        expect(reach()?.line).toBeNull();
      },
      {
        host: (host) => {
          host.tailscale = () => new Promise((resolve) => answers.push(resolve));
        },
      },
    );
  });

  test("Folders: the note under the list is a link to how folders work, opened in the browser", () =>
    pane(
      "selfhost",
      <Folders />,
      (el) => el.querySelector(".dk-card .dk-crow"),
      async (el, _host, opened) => {
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe("What agents can see and change on this Mac.");
        const link = [...el.querySelectorAll("button")].find((b) => b.textContent === "How folders work");
        expect(link?.className).toBe("ac-link ac-link--muted dk-link");
        await act(async () => link?.click());
        expect(opened).toEqual(["https://agentes.chat/docs/computers#folders"]);
        expect(el.textContent).not.toContain("Removing deletes nothing");
      },
    ));

  test("Tools: each tool on one line with its ⓘ and its state; the warnings stay in sight", () =>
    pane(
      "selfhost",
      <Tools />,
      (el) => el.querySelector(".dk-crow .ac-chip") && el.querySelectorAll(".dk-ctitle").length >= 3,
      (el) => {
        const tools = rows(el.querySelector(".dk-card") as HTMLElement).map(({ title, hint, line }) => ({
          title,
          hint,
          line,
        }));
        expect(tools).toEqual([
          {
            title: "Claude Code",
            hint: "Writes and changes code in the allowed folders, with your Claude account.",
            line: null,
          },
          {
            title: "Codex",
            hint: "Writes and changes code in the allowed folders, with your ChatGPT account.",
            line: null,
          },
          {
            title: "Commands",
            hint: "Tests, builds and other Terminal commands. Each one shows in Activity.",
            line: null,
          },
          {
            title: "Browser",
            hint: "Opens websites for the agents in a browser of their own, without your logins.",
            line: null,
          },
        ]);
        const [claude] = el.querySelectorAll(".dk-card .dk-crow");
        expect(claude?.querySelector(".ac-hintline > .ac-chip")?.textContent).toBe("Connected");
        const under = [...el.querySelectorAll(".dk-crow__under")].map((u) => u.textContent);
        expect(under).toEqual([
          "Commands can reach the rest of this Mac, other workspaces' folders included.",
          "Logins an agent makes stay on this Mac, in its folder. Use only test accounts or the agent's own.",
        ]);
        // Their switches read the hint, then the line kept in sight under them.
        expect(describedBy(el.querySelector("#tool-commands"))).toBe(
          "Tests, builds and other Terminal commands. Each one shows in Activity. Commands can reach the rest of this Mac, other workspaces' folders included.",
        );
        expect(describedBy(el.querySelector("#tool-browser"))).toBe(
          "Opens websites for the agents in a browser of their own, without your logins. Logins an agent makes stay on this Mac, in its folder. Use only test accounts or the agent's own.",
        );
        expect(row(el, "Protected mode")?.hint).toBe(
          "Commands only write in the allowed folders and don't read the rest of the Mac. Some tools may get slower.",
        );
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe(
          "What agents of every workspace can run on this Mac.",
        );
      },
    ));

  test("Tools: Commands on for only some organizations says where, on screen and to its switch", () =>
    pane(
      "selfhost",
      <Tools />,
      (el) => el.querySelector("#tool-commands-some"),
      (el) => {
        expect(el.querySelector("#tool-commands-some")?.textContent).toBe(
          "On only for Acme. Turn it on for every workspace here.",
        );
        expect(describedBy(el.querySelector("#tool-commands"))).toBe(
          "Tests, builds and other Terminal commands. Each one shows in Activity. On only for Acme. Turn it on for every workspace here. Commands can reach the rest of this Mac, other workspaces' folders included.",
        );
      },
      { someCommands: true },
    ));

  test("Tools › accounts: what the card is for behind its title's ⓘ; signing in, the wrong account behind one", () =>
    pane(
      "selfhost",
      <Tools />,
      (el) => [...el.querySelectorAll("button")].some((b) => b.textContent === "Add account" && !b.disabled),
      async (el) => {
        const title = [...el.querySelectorAll(".dk-ctitle")].find((t) => t.textContent?.includes("Claude accounts"));
        expect(title?.querySelector("h3")?.textContent).toBe("Claude accounts");
        expect(title?.querySelector("h3 .ac-hint")).toBeNull();
        expect(title?.querySelector(":scope > button.ac-hint")?.getAttribute("aria-label")).toBe(
          "About Claude accounts",
        );
        expect(describedBy(title?.querySelector(":scope > button.ac-hint"))).toBe(
          "Each Acme agent picks its account on its own page. Accounts stay on this Mac only.",
        );
        const card = title?.closest("section")?.querySelector(".dk-card");
        const last = [...(card?.querySelectorAll(".dk-crow") ?? [])].at(-1);
        expect(last?.querySelector(".dk-crow__text")?.textContent).toBe("");
        const add = last?.querySelector("button");
        expect(add?.textContent).toBe("Add account");
        await act(async () => add?.click());
        await until(() => document.querySelector('[role="dialog"]'));
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        // The dialog is described by the sentence alone; its ⓘ ends the sentence's line, outside the description.
        expect(describedBy(dialog)).toBe("Sign in with the account you want to add, then click Authorize.");
        const info = dialog.querySelector(".ac-dialog__desc > button.ac-hint");
        expect(info).toBeTruthy();
        expect(document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.contains(info)).toBe(false);
        expect(info?.getAttribute("aria-label")).toBe("About the wrong account");
        expect(describedBy(info)).toBe(
          "Signed in to the wrong account by itself? Sign out of Claude there and try again.",
        );
        expect(dialog.querySelector(".dk-help")?.textContent ?? "").not.toContain("wrong account");
      },
    ));

  test("Advanced: each limit on one line with its ⓘ; the agents' folder explained once, by its title", () =>
    pane(
      "selfhost",
      <Advanced />,
      (el) => el.querySelectorAll(".dk-card").length === 3 && el.querySelector(".dk-path"),
      (el) => {
        expect(el.querySelector(".dk-phead .dk-lead")?.textContent).toBe(
          "Only change this if the Mac feels slow or busy.",
        );
        const [jobs, claude, folders] = el.querySelectorAll(".dk-card");
        expect([...rows(jobs as HTMLElement), ...rows(claude as HTMLElement)]).toEqual([
          {
            title: "At the same time",
            hint: "How many long jobs, like builds and tests, run together in each workspace.",
            line: null,
          },
          { title: "Longest each one may run", hint: "After that the job stops and the agent says so.", line: null },
          {
            title: "Open conversations",
            hint: "How many stay open in each workspace. More of them answer faster but use more memory.",
            line: null,
          },
          { title: "Close an idle conversation after", hint: null, line: null },
        ]);
        const title = [...el.querySelectorAll(".dk-ctitle")].find(
          (t) => t.querySelector("h3")?.textContent === "Agents' folder",
        );
        expect(describedBy(title?.querySelector("button.ac-hint"))).toBe(
          "One folder per workspace, with a folder for each agent.",
        );
        for (const r of rows(folders as HTMLElement)) expect(r.line).not.toContain("One folder per workspace");
      },
    ));

  test("Updates: no lead; Update and reopen alone, and the manual way keeps what stays", async () => {
    const latest = { version: "9.9.9", url: "https://app.agentes.chat/api/desktop/download/9.9.9/agentes.dmg" };
    const update: UpdateCheck = {
      state: { latest, available: true, required: false },
      checkedAt: null,
      checking: false,
      failed: false,
      check: async () => null,
      version: "0.6.0",
    };
    await pane(
      "selfhost",
      <Updates update={update} />,
      (el) => el.querySelector(".dk-ver__acts"),
      async (el, host) => {
        expect(el.querySelector(".dk-phead .dk-lead")).toBeNull();
        // The license's attribution and legal notices, always at the end.
        expect(el.textContent).toContain("Based on agentes.chat by Codari Global, LLC");
        expect(el.textContent).toContain("Copyright © 2026 Codari Global, LLC and contributors");
        const acts = el.querySelector(".dk-ver__acts") as HTMLElement;
        expect(acts.textContent).toBe("Update and reopen");
        host.installUpdate = async () => false;
        await act(async () => (acts.querySelector("button") as HTMLButtonElement).click());
        await until(() => el.textContent?.includes("Download version 9.9.9"));
        expect(el.querySelector(".dk-ver__acts .dk-help")?.textContent).toBe("Your servers and settings stay.");
      },
    );
  });

  test("Updates: the download with its bar and Cancel, which drops it; once whole, Installing… with no Cancel", async () => {
    const latest = { version: "9.9.9", url: "https://app.agentes.chat/api/desktop/download/9.9.9/agentes.dmg" };
    const update: UpdateCheck = {
      state: { latest, available: true, required: false },
      checkedAt: null,
      checking: false,
      failed: false,
      check: async () => null,
      version: "0.6.0",
    };
    await pane(
      "selfhost",
      <Updates update={update} />,
      (el) => el.querySelector(".dk-ver__acts"),
      async (el) => {
        const install = () => act(async () => (el.querySelector(".dk-ver__acts button") as HTMLButtonElement).click());
        const bar = () => el.querySelector('.dk-upd [role="progressbar"]');
        await install();
        await until(() => Number(bar()?.getAttribute("aria-valuenow")) > 0);
        expect(el.querySelector(".dk-upd__label")?.textContent).toBe("Downloading…");
        expect([...el.querySelectorAll(".dk-upd button")].map((b) => b.textContent)).toEqual(["Cancel"]);
        // Cancel: nothing installed, Update and reopen again, and no manual way.
        await act(async () => (el.querySelector(".dk-upd button") as HTMLButtonElement).click());
        await until(() => el.querySelector(".dk-ver__acts")?.textContent === "Update and reopen");
        expect(el.querySelector(".dk-upd")).toBeNull();
        expect(el.textContent).not.toContain("Update by hand");
        await install();
        await until(() => el.querySelector(".dk-upd__label")?.textContent === "Installing…");
        expect(el.querySelector(".dk-upd button")).toBeNull();
        expect(bar()?.getAttribute("aria-valuenow")).toBe("100");
        // The fake ends the install a moment later (nothing installs here): wait for it, or its state lands after
        // the DOM is gone and breaks the next file.
        await until(() => el.textContent?.includes("Download version 9.9.9"));
      },
    );
  });
});
