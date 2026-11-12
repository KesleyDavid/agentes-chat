import { expect, test } from "bun:test";
import type { ControlEvent, ControlStatus } from "@agenteschat/adapters/runner-control";
import { filesFolder } from "../src/control/local-server";
import { DesktopStore, type Home } from "../src/control/store";
import { answerThisMac, connect, toolsHere, whenHostHomeReady } from "../src/control/this-mac";
import type { Host } from "../src/host/types";

/**
 * The site in the main window asking this computer: status, connect, reconnect, Preferences, the server here's
 * files, each about the asking page's own server only (Rust adds `origin`, `agentsHere` and `local`).
 */

const SERVER = "https://agentes.tail1234.ts.net";
const OTHER = "https://other.example.com";

const paired = (orgId: string, connection: ControlStatus["connection"] = "online", server = SERVER): ControlStatus => ({
  paired: true,
  server,
  org: { id: orgId, name: "Acme" },
  machine: { id: `m-${orgId}`, name: "MacBook" },
  connection,
  version: "0.1.0",
  protocol: 10,
  paused: { paused: false, until: null },
  executors: { claude: { version: "2.1.4" } },
  agents: [],
});
const unpaired: ControlStatus = {
  ...paired("x"),
  paired: false,
  org: undefined,
  machine: undefined,
  connection: "unpaired",
};

/** Runners answering from `statuses` (by home); `sent` records every request. */
function setup(statuses: Record<string, ControlStatus>, others = false) {
  const sent: { homeId: string; type: string; tool?: string; on?: boolean; server?: string }[] = [];
  let onLine: (homeId: string, line: string) => void = () => {};
  let added = 0;
  const host = {
    window: "popover",
    fake: true,
    platform: "mac",
    listRunners: async () =>
      Object.keys(statuses).map((homeId) => ({ homeId, dir: `/tmp/${homeId}`, running: true, hello: null })),
    onLine: (cb: typeof onLine) => {
      onLine = cb;
      return () => {};
    },
    onRunnerState: () => () => {},
    addRunner: async () => {
      const homeId = `new${++added}`;
      statuses[homeId] = unpaired;
      return homeId;
    },
    send: async (homeId: string, line: string) => {
      const req = JSON.parse(line) as { id: string; type: string; tool?: string; on?: boolean; server?: string };
      sent.push({ homeId, type: req.type, tool: req.tool, on: req.on, server: req.server });
      let data: unknown = {};
      if (req.type === "status") data = statuses[homeId];
      if (req.type === "jobs") data = { jobs: [] };
      if (req.type === "access.pending") data = { requests: [] };
      if (req.type === "access.get")
        data = others ? { folders: [], tools: { claude: true, codex: false, commands: true } } : null;
      if (req.type === "org.logo") data = { logo: null };
      if (req.type === "pair.start") data = { started: true };
      queueMicrotask(() => onLine(homeId, JSON.stringify({ type: "reply", id: req.id, ok: true, data })));
    },
  } as unknown as Host;
  const store = new DesktopStore(host, { idPrefix: "t" });
  const event = (homeId: string, e: ControlEvent) => onLine(homeId, JSON.stringify({ type: "event", event: e }));
  const prefs: string[] = [];
  // The folders of this computer, and the ones shown in Finder.
  const folders = new Set<string>();
  const revealed: string[] = [];
  const deps = {
    store,
    openPrefs: async (tab: "folders" | "tools" | "updates") => void prefs.push(tab),
    showRequests: async () => void prefs.push("requests"),
    localDir: async () => "/Users/ana/.agentes",
    revealFolder: async (path: string) => {
      if (!folders.has(path)) throw new Error("not a folder");
      revealed.push(path);
    },
    codeTimeoutMs: 500,
  };
  return { store, sent, event, deps, prefs, folders, revealed };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

test("status: only the asking server's organizations, and whether agents may work here for it", async () => {
  const { store, deps } = setup({ h1: paired("o1"), h2: unpaired, h3: paired("o3", "online", OTHER) });
  store.start();
  await settle();
  expect(await answerThisMac(deps, { kind: "status", origin: SERVER, agentsHere: true })).toEqual({
    orgs: [{ orgId: "o1", machineId: "m-o1", connection: "online" }],
    agentsHere: true,
    local: false,
  });
  expect(await answerThisMac(deps, { kind: "status", origin: "https://app.agentes.chat", agentsHere: false })).toEqual({
    orgs: [],
    agentsHere: false,
    local: false,
  });
});

test("status on the server here: its own homes point at its loopback address, whichever address the page has", async () => {
  const LOCAL = "http://127.0.0.1:4310";
  const { store, deps } = setup({ h1: paired("o1", "online", LOCAL), h2: paired("o2") });
  store.start();
  await settle();
  const asked = { kind: "status" as const, origin: "https://ana-mac.tail1234.ts.net", agentsHere: false };
  expect(await answerThisMac(deps, { ...asked, local: true, also: LOCAL })).toEqual({
    orgs: [{ orgId: "o1", machineId: "m-o1", connection: "online" }],
    agentsHere: false,
    local: true,
  });
});

test("connect: refused where the page says agents can't work here (a server on this computer)", async () => {
  const { store, sent, deps } = setup({});
  store.start();
  await settle();
  for (const origin of ["http://127.0.0.1:4310", "https://agentes.tail1234.ts.net"]) {
    await expect(answerThisMac(deps, { kind: "connect", orgId: "o1", origin, agentsHere: false })).rejects.toThrow(
      "not_here",
    );
  }
  expect(sent.some((s) => s.type === "pair.start")).toBe(false);
});

test("connect: pairs with the asking page's own server; the first organization starts with open tools", async () => {
  const { store, sent, event, deps: base } = setup({ h1: paired("o1") });
  let opensAtLogin = false;
  const deps = {
    ...base,
    onPaired: () => {
      opensAtLogin = true;
    },
  };
  store.start();
  await settle();
  const connect = (orgId: string) => answerThisMac(deps, { kind: "connect", orgId, origin: SERVER, agentsHere: true });
  expect(await connect("o1")).toEqual({ userCode: null });
  expect(sent.some((s) => s.type === "pair.start")).toBe(false);

  const answer = connect("o2");
  await settle();
  expect(sent.filter((s) => s.type === "pair.start")).toEqual([
    { homeId: "new1", type: "pair.start", tool: undefined, on: undefined, server: SERVER },
  ]);
  event("new1", {
    kind: "pair.code",
    userCode: "ABCD-EFGH",
    verificationUrl: `${SERVER}/conectar`,
    expiresAt: "2026-10-21T20:00:00Z",
  });
  expect(await answer).toEqual({ userCode: "ABCD-EFGH" });
  expect(opensAtLogin).toBe(false);

  // Confirmed on the site, and no other organization here has tools to copy: everything on, Codex too, which no
  // runner found here (installed later, it works without a trip to Preferences).
  event("new1", { kind: "pair.done", org: { id: "o2", name: "Beta" }, machine: { id: "m2", name: "MacBook" } });
  await settle();
  await settle();
  const tools = sent.filter((s) => s.homeId === "new1" && s.type === "tools.set").map((s) => [s.tool, s.on]);
  expect(tools).toEqual([
    ["claude", true],
    ["codex", true],
    ["commands", true],
    ["browser", true],
  ]);
  // Its agents work while the app runs: it opens at login now.
  expect(opensAtLogin).toBe(true);
});

test("connect: a new organization copies the others' tools for the whole computer, with commands on", async () => {
  // Another organization here has commands on.
  const { store, sent, event, deps } = setup({ h1: paired("o1") }, true);
  store.start();
  await settle();
  const answer = answerThisMac(deps, { kind: "connect", orgId: "o2", origin: SERVER, agentsHere: true });
  await settle();
  event("new1", {
    kind: "pair.code",
    userCode: "ABCD-EFGH",
    verificationUrl: `${SERVER}/c`,
    expiresAt: "2026-10-21T20:00:00Z",
  });
  await answer;
  event("new1", { kind: "pair.done", org: { id: "o2", name: "Beta" }, machine: { id: "m2", name: "MacBook" } });
  await settle();
  await settle();
  const tools = sent.filter((s) => s.homeId === "new1" && s.type === "tools.set").map((s) => [s.tool, s.on]);
  expect(tools).toEqual([
    ["claude", true],
    ["codex", false],
    ["commands", true],
    ["browser", false],
  ]);
});

test("connect: the pairing sheet's choices go over the defaults; a home that comes back keeps its own", async () => {
  const { store, sent, event, deps } = setup({ h1: paired("o1", "refused") });
  store.start();
  await settle();
  const code = (homeId: string) =>
    event(homeId, {
      kind: "pair.code",
      userCode: "ABCD-EFGH",
      verificationUrl: `${SERVER}/c`,
      expiresAt: "2026-10-21T20:00:00Z",
    });
  const toolsOf = (homeId: string) =>
    sent.filter((s) => s.homeId === homeId && s.type === "tools.set").map((s) => [s.tool, s.on]);

  const fresh = connect({ ...deps, tools: { commands: false, browser: false } }, "o2", SERVER);
  await settle();
  code("new1");
  await fresh;
  event("new1", { kind: "pair.done", org: { id: "o2", name: "Beta" }, machine: { id: "m2", name: "MacBook" } });
  await settle();
  await settle();
  expect(toolsOf("new1")).toEqual([
    ["claude", true],
    ["codex", true],
    ["commands", false],
    ["browser", false],
  ]);

  // Refused by its organization and paired again: the runner kept its access, nothing is set over it.
  const back = connect({ ...deps, tools: { commands: true } }, "o1", SERVER);
  await settle();
  code("h1");
  await back;
  event("h1", { kind: "pair.done", org: { id: "o1", name: "Acme" }, machine: { id: "m-o1", name: "MacBook" } });
  await settle();
  await settle();
  expect(toolsOf("h1")).toEqual([]);
});

test("the server here's own new home: the same open tools as any pairing, commands included", async () => {
  const { store, sent } = setup({ h1: paired("o1", "online", "http://127.0.0.1:4310") });
  store.start();
  await settle();
  whenHostHomeReady(store, "h1");
  await settle();
  await settle();
  expect(sent.filter((s) => s.type === "tools.set").map((s) => [s.tool, s.on])).toEqual([
    ["claude", true],
    ["codex", true],
    ["commands", true],
    ["browser", true],
  ]);
});

test("Preferences' tools: commands read on only when every organization has them, and say who does", () => {
  const home = (name: string, commands: boolean) =>
    ({
      status: { org: { id: name, name } },
      access: { folders: [], tools: { claude: true, codex: false, commands, browser: true } },
    }) as unknown as Home;
  expect(toolsHere([home("Acme", true), home("Beta", false)])).toEqual({
    tools: { claude: true, codex: false, commands: false, browser: true },
    commandsOnlyFor: ["Acme"],
  });
  expect(toolsHere([home("Acme", true), home("Beta", true)])).toMatchObject({
    tools: { commands: true },
    commandsOnlyFor: [],
  });
  expect(toolsHere([])).toEqual({
    tools: { claude: false, codex: false, commands: false, browser: false },
    commandsOnlyFor: [],
  });
});

test("connect: a refused organization comes back on its own home; a failure rejects", async () => {
  const { store, sent, event, deps } = setup({ h1: paired("o1", "refused") }, true);
  store.start();
  await settle();
  const answer = answerThisMac(deps, { kind: "connect", orgId: "o1", origin: SERVER, agentsHere: true });
  await settle();
  expect(sent.filter((s) => s.type === "pair.start").map((s) => s.homeId)).toEqual(["h1"]);
  event("h1", { kind: "pair.failed", code: "network", message: "offline" });
  await expect(answer).rejects.toThrow("network");
});

test("prefs and requests: Preferences on the asked tab, the popover", async () => {
  const { deps, prefs } = setup({});
  expect(await answerThisMac(deps, { kind: "prefs", tab: "updates" })).toEqual({});
  expect(await answerThisMac(deps, { kind: "requests" })).toEqual({});
  expect(prefs).toEqual(["updates", "requests"]);
});

test("reconnect: the organization's own runner on that server; anywhere else rejects", async () => {
  const { store, sent, deps } = setup({ h1: paired("o1", "offline") });
  store.start();
  await settle();
  expect(await answerThisMac(deps, { kind: "reconnect", orgId: "o1", origin: SERVER })).toEqual({});
  expect(sent.filter((s) => s.type === "reconnect").map((s) => s.homeId)).toEqual(["h1"]);
  await expect(answerThisMac(deps, { kind: "reconnect", orgId: "o2", origin: SERVER })).rejects.toThrow(
    "not_connected",
  );
  await expect(answerThisMac(deps, { kind: "reconnect", orgId: "o1", origin: OTHER })).rejects.toThrow("not_connected");
});

test("files: the server here's files in Finder, only for its own page; its folder until the first upload", async () => {
  const { deps, folders, revealed } = setup({});
  folders.add("/Users/ana/.agentes");
  // Another server's page: Rust adds `local` only for the server here's own.
  await expect(answerThisMac(deps, { kind: "files" })).rejects.toThrow("not_here");
  expect(revealed).toEqual([]);
  // Nothing uploaded yet, so no `files` in it: the server's own folder.
  expect(await answerThisMac(deps, { kind: "files", local: true })).toEqual({});
  folders.add("/Users/ana/.agentes/files");
  expect(await answerThisMac(deps, { kind: "files", local: true })).toEqual({});
  expect(revealed).toEqual(["/Users/ana/.agentes", "/Users/ana/.agentes/files"]);
  expect(filesFolder("C:\\Users\\ana\\.agentes")).toBe("C:\\Users\\ana\\.agentes\\files");
});
