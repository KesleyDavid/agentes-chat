import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { Agent, BrowserHandoff, DesktopStatus, DesktopViewState, SocketFactory } from "@agenteschat/client";
import { ApiError, keys } from "@agenteschat/client";
import { icons } from "@agenteschat/ui";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ComputerDialog } from "@/components/computer/ComputerDialog";
import { DesktopView } from "@/components/desktop/DesktopView";
import { ADA_ID, createFakeApi, fakeBrowserOf, fakeMachinesOf, meWithRole, ORG_ID, seedState } from "./fake-api";
import { fakeSockets } from "./fake-socket";
import { renderPage, screen, settle } from "./render";

/** A person's socket to the screen: the server side sends frames and closes it with a code. */
class DesktopSocket {
  binaryType = "blob";
  readyState = 1;
  closed = false;
  /** A microtask after it was made: what the computer sends first may arrive from then on. */
  late = false;
  /** Something listened to its frames in the tick it was made, before anything could arrive on it. */
  heardOnTime = false;
  /** What the page sent on it. */
  sent: unknown[] = [];
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly url: string) {
    queueMicrotask(() => {
      this.late = true;
    });
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (type === "message" && !this.late) this.heardOnTime = true;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  /** A frame from the server: text, or the computer's bytes. */
  serverSends(data: string | Uint8Array) {
    const frame = typeof data === "string" ? data : data.buffer;
    for (const fn of this.listeners.get("message") ?? []) fn({ data: frame });
  }
  serverClose(code: number, reason = "") {
    this.closed = true;
    for (const fn of this.listeners.get("close") ?? []) fn({ code, reason });
  }
}

/** The server's word on a socket whose stream changes mode in place (ADR 0058 §17): first, then at each switch. */
const MODE = (mode: "watch" | "control") => JSON.stringify({ type: "mode", mode });

/** A key event as the log reads it: `keydown a KeyA ctrl`. */
const keyText = (e: KeyboardEvent) =>
  [e.type, e.key, e.code, ...(["ctrl", "shift", "alt", "meta"] as const).filter((m) => e[`${m}Key`])]
    .filter(Boolean)
    .join(" ");

/**
 * noVNC's RFB as the screen drives it: how it was set and what it pasted; `log` holds, in order, the key events
 * replayed on its canvas, the keys it sent (`send Insert down`) and the clicks it sent (`mousedown`); `emit` plays its
 * events. Like noVNC, it drops keys, clicks and pastes until its connection opens (`emit("connect")`), and clicks
 * while view-only.
 */
class FakeRfb {
  static all: FakeRfb[] = [];
  viewOnly = false;
  qualityLevel = 6;
  compressionLevel = 2;
  scaleViewport = false;
  resizeSession = false;
  focusOnClick = true;
  background = "";
  pasted: string[] = [];
  log: string[] = [];
  connected = false;
  /** The computer's bytes its socket gave it, as noVNC reads them (`onmessage`). */
  got: number[][] = [];
  /** Like noVNC, it draws into a canvas of its own inside the screen, and takes its keys there. */
  readonly canvas = document.createElement("canvas");
  private listeners = new Map<string, ((e: Event) => void)[]>();
  constructor(
    readonly el: HTMLElement,
    readonly ws: {
      onmessage: ((e: MessageEvent) => void) | null;
      onclose: ((e: CloseEvent) => void) | null;
      close(): void;
    },
    readonly options?: { shared?: boolean },
  ) {
    ws.onmessage = (e) => this.got.push([...new Uint8Array(e.data as ArrayBuffer)]);
    // Like noVNC, a socket that closes takes its screen off the page.
    ws.onclose = () => this.canvas.remove();
    FakeRfb.all.push(this);
    this.canvas.width = 1280;
    this.canvas.height = 900;
    for (const type of ["keydown", "keyup"]) {
      this.canvas.addEventListener(type, (e) => {
        if (this.connected) this.log.push(keyText(e as KeyboardEvent));
      });
    }
    this.canvas.addEventListener("mousedown", () => {
      if (this.connected && !this.viewOnly) this.log.push("mousedown");
    });
    el.appendChild(this.canvas);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, detail?: unknown) {
    if (type === "connect") this.connected = true;
    for (const fn of this.listeners.get(type) ?? []) fn(new CustomEvent(type, { detail }));
  }
  clipboardPasteFrom(text: string) {
    if (this.connected) this.pasted.push(text);
  }
  sendKey(_keysym: number, code: string | null, down?: boolean) {
    if (this.connected) this.log.push(`send ${code} ${down ? "down" : "up"}`);
  }
  focus() {}
  disconnect() {
    this.canvas.remove();
    this.ws.close();
  }
}
mock.module("@novnc/novnc", () => ({ default: FakeRfb }));

const RUNNING: Partial<DesktopStatus> = { available: true, reason: null, running: true, canControl: true };

/** The screen sockets apart from the realtime one. */
function socketsFor() {
  const desktops: DesktopSocket[] = [];
  const realtime = fakeSockets();
  const factory: SocketFactory = (url) => {
    if (!url.includes("/api/desktop")) return realtime.factory(url);
    const s = new DesktopSocket(url);
    desktops.push(s);
    return s as unknown as ReturnType<SocketFactory>;
  };
  return { factory, desktops };
}

/** Ada on a Linux computer of the workspace's, which serves screens; self-host, or with `cloud` the Cloud's own. */
async function backend(desktop: Partial<DesktopStatus>, cloud = false) {
  const state = seedState();
  const api = createFakeApi(state);
  const fake = fakeBrowserOf.get(api);
  const machines = fakeMachinesOf.get(api);
  if (!fake || !machines) throw new Error("no fakes");
  const m = cloud
    ? machines.pair({ name: "Computador da Acme", kind: "managed", os: "linux", mode: "system" })
    : machines.pair({ name: "Servidor de casa", os: "linux", mode: "system" });
  if (cloud) machines.setSetup({ state: "ready", machineId: m.id });
  await api.sandbox.setTarget(ORG_ID, ADA_ID, m.id);
  fake.desktops.set(ADA_ID, desktop);
  return { state, api, fake, machines, machine: m, sockets: socketsFor() };
}

async function dialog(desktop: Partial<DesktopStatus> = RUNNING, cloud = false) {
  const b = await backend(desktop, cloud);
  const ada = b.state.agents.find((a) => a.id === ADA_ID) as Agent;
  let closed = 0;
  const r = await renderPage(<ComputerDialog agent={ada} open onClose={() => closed++} />, {
    api: b.api,
    org: true,
    createSocket: b.sockets.factory,
  });
  await settle(8);
  return { ...r, ...b, closed: () => closed };
}

const calls = (s: { state: ReturnType<typeof seedState> }, method: string) =>
  s.state.calls.filter((c) => c.method === method).map((c) => c.args);
const rfb = () => FakeRfb.all.at(-1) as FakeRfb;
const sub = () => (document.querySelector(".ac-dialog__sub") as HTMLElement).textContent;
const view = () => within(screen().getByRole("dialog", { name: "Computador da Ada" }));
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(4);
};
/** A click as Chrome, Edge and Firefox off a Mac make it: the button takes the browser's focus first. */
const clickFocusing = async (el: HTMLElement) => {
  await act(async () => el.focus());
  await click(el);
};
const connected = async () => {
  await act(async () => rfb().emit("connect"));
  await settle(2);
};
/** The browser's full screen: which element asked for it; `document.fullscreenElement` follows. */
function fullScreen() {
  const page = { requested: [] as Element[] };
  const doc = document as { fullscreenElement: Element | null };
  replaceOn(document, "fullscreenElement", null);
  replaceOn(document.documentElement, "requestFullscreen", function (this: Element) {
    page.requested.push(this);
    doc.fullscreenElement = this;
    return Promise.resolve();
  });
  replaceOn(document, "exitFullscreen", () => {
    doc.fullscreenElement = null;
    return Promise.resolve();
  });
  return page;
}
/** The dialog's classes. */
const classes = () => [...(document.querySelector(".cmp-dialog")?.classList ?? [])];
/** Past the time the full-screen bar stays once nothing asks for it (2.5 s). */
const barTime = () => act(() => new Promise((r) => setTimeout(r, 2_600)));
/** Past the time the pointer rests at the display's top edge before the bar comes back in control (0.5 s). */
const edgeTime = () => act(() => new Promise((r) => setTimeout(r, 600)));
/** The pointer moves over the page at this height. */
const pointerAt = (clientY: number) => act(async () => void fireEvent.pointerMove(document.body, { clientY }));

/** Ada's screen in this person's control, live: the field over it has the person's keys. */
async function controlled(cloud = false) {
  const t = await dialog(RUNNING, cloud);
  await connected();
  await click(view().getByRole("button", { name: "Assumir o controle" }));
  await settle(4);
  await connected();
  return {
    ...t,
    field: () => view().getByRole("textbox", { name: "Digitar no computador da Ada" }) as HTMLTextAreaElement,
  };
}
/** The line under the screen: its words. */
const line = () => document.querySelector(".dsk-line > .dsk-words")?.textContent;
/** What that line says watching: nothing about the viewer's own typing, which they may not be doing. */
const WATCHING = "Os programas do computador da Ada veem a tela e tudo o que é digitado ou colado nele.";
/** What the clipboard just did, said in that line in its words' place. */
const said = () => document.querySelector(".dsk-line > .dsk-said")?.textContent;
/** The last picture the screen holds over its next connection. */
const still = () => document.querySelector(".dsk-screen > .dsk-still");
/** Where a click on the screen lands: a cover over it takes it, a picture held over it lets it through (desktop.css). */
const clickLandsOn = () => document.querySelector(".dsk-stage > .brw-dim") ?? rfb().canvas;
const pasteOn = (el: Element, text: string) =>
  act(
    async () =>
      void fireEvent.paste(el, { clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") } }),
  );
const SHIFT_INSERT = ["send ShiftLeft down", "send Insert down", "send Insert up", "send ShiftLeft up"];

/** Globals a test replaced (the person's clipboard, the platform), put back after it. */
const restores: (() => void)[] = [];
function replaceOn(target: object, key: string, value: unknown) {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restores.push(() => {
    if (own) Object.defineProperty(target, key, own);
    else delete (target as Record<string, unknown>)[key];
  });
}

/** The person's clipboard as the browser keeps it: what was written there, and whether a write is let in. */
function clipboard({ refuses = false } = {}) {
  const board = { writes: 0, failed: 0, written: [] as string[], texts: [] as string[] };
  class Item {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }
  replaceOn(globalThis, "ClipboardItem", Item);
  replaceOn(navigator, "clipboard", {
    write: async ([item]: Item[]) => {
      board.writes++;
      if (refuses) throw new Error("NotAllowedError");
      try {
        const blob = await item?.data["text/plain"];
        board.written.push((await blob?.text()) ?? "");
      } catch (err) {
        board.failed++;
        throw err;
      }
    },
    writeText: async (text: string) => void board.texts.push(text),
  });
  return board;
}

const controlOf = (agentId: string, controllerUserId: string): BrowserHandoff => ({
  id: "h-joao",
  agentId,
  runId: null,
  machineId: "machine-1",
  screen: "desktop",
  kind: "takeover",
  instructions: "",
  status: "active",
  requestedForUserId: null,
  controllerUserId,
  note: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
});

beforeEach(() => {
  FakeRfb.all = [];
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  for (const put of restores.splice(0).reverse()) put();
});

/**
 * What the screen's canvas shows, read back the way the screen reads it (a small copy, off the page): black until
 * `dock()` (its dock on that black, two pixels of the copy) or `picture()` (the wallpaper drawn), and again after
 * `black()` (a new session that hasn't drawn). The DOM here draws nothing, so that copy's context is this stand-in
 * while it's on; the canvases on the page keep their own.
 */
function screenPixels() {
  let shows: "black" | "dock" | "picture" = "black";
  const proto = Object.getPrototypeOf(document.createElement("canvas")) as HTMLCanvasElement;
  const getContext = proto.getContext;
  const copy = {
    drawImage() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const bottom = 4 * w * (h - 1);
      if (shows === "dock") for (const x of [w / 2 - 1, w / 2]) data.set([240, 244, 250, 255], bottom + 4 * x);
      // The wallpaper: the sky, its pale band at the bottom.
      if (shows === "picture") {
        for (let i = 0; i < data.length; i += 4) data.set(i < bottom ? [75, 147, 255, 255] : [207, 230, 255, 255], i);
      }
      return { data };
    },
  };
  proto.getContext = function (this: HTMLCanvasElement, ...args: Parameters<HTMLCanvasElement["getContext"]>) {
    return this.isConnected ? getContext.apply(this, args) : copy;
  } as unknown as typeof proto.getContext;
  return {
    black: () => {
      shows = "black";
    },
    dock: () => {
      shows = "dock";
    },
    picture: () => {
      shows = "picture";
    },
    restore: () => {
      proto.getContext = getContext;
    },
  };
}
const waitLooks = () => act(async () => new Promise((r) => setTimeout(r, 260)));

describe("the agent's screen in the computer dialog", () => {
  test("someone who may drive the browser but not the whole computer: the button and the page say browser, and why", async () => {
    // The Cloud's computer in system mode, Ada on her owner's plan, and a role that controls computers but doesn't
    // manage agents: only her owner and admins who manage agents drive the screen (ADR 0059 §8).
    const b = await backend({ ...RUNNING, canControl: false, controlRefusal: "owner_plan" }, true);
    b.state.scopes[ADA_ID] = [...(b.state.scopes[ADA_ID] ?? []), { connectionId: null, scope: "browser:use" }];
    b.fake.settings.set(ADA_ID, { allowedDomains: null, available: true, reason: null, detail: null, machine: null });
    const ada = b.state.agents.find((a) => a.id === ADA_ID) as Agent;
    await renderPage(<ComputerDialog agent={ada} open onClose={() => {}} />, {
      api: b.api,
      org: true,
      createSocket: b.sockets.factory,
    });
    await settle(8);
    await connected();
    const why =
      "A\u00a0Ada pensa com o plano de quem é dona dela, então só essa pessoa e os admins que gerenciam agentes controlam o computador inteiro";
    expect(view().queryByRole("button", { name: "Assumir o controle" })).toBeNull();
    const take = view().getByRole("button", { name: "Assumir o navegador" });
    expect(take.getAttribute("title")).toBe(why);
    await click(take);
    // The browser's take over, never the screen's: the screen's would be refused.
    expect(calls(b, "browser.takeover")).toEqual([[ORG_ID, ADA_ID]]);
    await settle(8);
    const banner = document.querySelector(".cmp-banner[data-tone=info]") as HTMLElement;
    expect(banner.textContent).toBe(`Você está no navegador, não no computador inteiro${why}`);
  });

  test("whose role gives none of the agents' computers: no Assumir o navegador, and a click on the screen only says so, with Fechar", async () => {
    const b = await backend({ ...RUNNING, canControl: false, controlRefusal: "role" }, true);
    b.state.scopes[ADA_ID] = [...(b.state.scopes[ADA_ID] ?? []), { connectionId: null, scope: "browser:use" }];
    b.fake.settings.set(ADA_ID, { allowedDomains: null, available: true, reason: null, detail: null, machine: null });
    meWithRole(b.state, ["manage_agents"]);
    b.state.roles = (b.state.roles ?? []).map((r) =>
      r.kind === "everyone" ? { ...r, permissions: r.permissions.filter((p) => p !== "own_computers") } : r,
    );
    const ada = b.state.agents.find((a) => a.id === ADA_ID) as Agent;
    await renderPage(<ComputerDialog agent={ada} open onClose={() => {}} />, {
      api: b.api,
      org: true,
      createSocket: b.sockets.factory,
    });
    await settle(8);
    await connected();
    expect(view().queryByRole("button", { name: "Assumir o navegador" })).toBeNull();
    await act(async () => fireEvent.pointerDown(rfb().canvas, { pointerType: "mouse", button: 0 }));
    await settle(3);
    const prompt = document.querySelector(".dsk-ask") as HTMLElement;
    expect(prompt.textContent).toContain("Você está só assistindo.");
    expect(within(prompt).queryByRole("button", { name: /Assumir/ })).toBeNull();
    expect(within(prompt).getByRole("button", { name: "Fechar" })).toBeTruthy();
  });

  test("watching: a socket of its own in binary, view-only at quality 3, scaled; live once noVNC connects", async () => {
    const t = await dialog();
    expect(t.sockets.desktops).toHaveLength(1);
    const ws = t.sockets.desktops[0];
    // It takes its mode changing in place, where the server and the computer can (ADR 0058 §17).
    expect(ws?.url).toBe(`ws://localhost:3000/api/desktop?orgId=${ORG_ID}&agentId=${ADA_ID}&switch=1&mode=watch`);
    expect(ws?.binaryType).toBe("arraybuffer");
    // The computer speaks first: bytes that reach the socket before anything listens are lost.
    expect(ws?.heardOnTime).toBe(true);
    await act(async () => ws?.serverSends(Uint8Array.of(82, 70, 66)));
    expect(rfb().got).toEqual([[82, 70, 66]]);
    expect(rfb().options).toEqual({ shared: true });
    expect(rfb()).toMatchObject({
      viewOnly: true,
      showDotCursor: false,
      qualityLevel: 3,
      compressionLevel: 2,
      scaleViewport: true,
      resizeSession: false,
      focusOnClick: false,
    });
    // The cover says it opens; the head says nothing over it.
    expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
    expect(sub()).toBe("");
    await connected();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    expect(sub()).toBe("Ao vivo · você está assistindo");
    expect(view().getByRole("img", { name: "Tela da Ada, ao vivo" })).toBeTruthy();
    expect(view().getByRole("button", { name: "Assumir o controle" })).toBeTruthy();
    // No power and no fold: the screen starts by itself and stays on.
    expect(view().queryByRole("button", { name: "Desligar" })).toBeNull();
    expect(view().queryByRole("button", { name: "Recolher" })).toBeNull();
    // Watching gives no way to type into it.
    expect(view().queryByRole("textbox", { name: "Digitar no computador da Ada" })).toBeNull();
  });

  test("Live once a picture is there: a screen that just started stays black a moment, and says Opening meanwhile", async () => {
    const pixels = screenPixels();
    try {
      await dialog({ ...RUNNING, running: false });
      await connected();
      await waitLooks();
      expect(sub()).toBe("");
      expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
      expect(view().queryByRole("button", { name: "Assumir o controle" })).toBeNull();
      // Its dock drawn on the black, the wallpaper not yet: still opening.
      pixels.dock();
      await waitLooks();
      expect(sub()).toBe("");
      expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
      pixels.picture();
      await waitLooks();
      expect(sub()).toBe("Ao vivo · você está assistindo");
      expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
      expect(view().getByRole("button", { name: "Assumir o controle" })).toBeTruthy();
    } finally {
      pixels.restore();
    }
  });

  test("a picture that comes after noVNC connected lifts the cover within 50 ms: a first click on it isn't held back", async () => {
    const pixels = screenPixels();
    try {
      await dialog();
      await connected();
      expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
      pixels.picture();
      await act(() => new Promise((r) => setTimeout(r, 80)));
      expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    } finally {
      pixels.restore();
    }
  });

  test("a screen that stays one flat color for good is shown as it is after a while, not Opening forever", async () => {
    const pixels = screenPixels();
    try {
      await dialog();
      await connected();
      await waitLooks();
      expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
      setSystemTime(new Date(Date.now() + 10_500));
      await waitLooks();
      expect(sub()).toBe("Ao vivo · você está assistindo");
    } finally {
      setSystemTime();
      pixels.restore();
    }
  });

  test("a screen that isn't running opens like any other: no Off and no Turn on; an older computer's refusal reads as opening", async () => {
    const t = await dialog({ ...RUNNING, running: false });
    // Opening the stream starts it.
    expect(t.sockets.desktops).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Desligad|Ligar|está desligada/);
    // An older computer still refuses a screen that isn't running; the server starts it and the next try opens.
    await act(async () => t.sockets.desktops[0]?.serverClose(4502, "desktop_off"));
    await settle(4);
    expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Desligad|Ligar/);
    await act(async () => new Promise((r) => setTimeout(r, 1100)));
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(2);
    await connected();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  });

  test("held, its screen not running: nothing starts it, the pause said once; once the hold ends it opens", async () => {
    const t = await dialog({ ...RUNNING, running: false, held: true });
    expect(t.sockets.desktops).toHaveLength(0);
    expect(view().getAllByText("A Ada está em pausa por enquanto")).toHaveLength(1);
    expect(sub()).toBe("");
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    expect(view().queryByRole("button", { name: "Assumir o controle" })).toBeNull();

    t.fake.desktops.set(ADA_ID, { ...RUNNING, running: false });
    await act(async () => t.services.queryClient.invalidateQueries({ queryKey: keys.agentDesktop(ORG_ID, ADA_ID) }));
    await settle(6);
    expect(t.sockets.desktops).toHaveLength(1);
    await connected();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  });

  test("held while watching: the pause over the live screen; the stream's `held` close is the held cover, not opening", async () => {
    const t = await dialog({ ...RUNNING, held: true });
    await connected();
    expect(view().getByText("A Ada está em pausa por enquanto")).toBeTruthy();
    // The banner says the pause: live, and nothing more.
    expect(sub()).toBe("Ao vivo");
    expect(view().queryByRole("button", { name: "Assumir o controle" })).toBeNull();

    // Its screen went away meanwhile: the server starts none for a held agent. The close alone says so, before
    // the screen's state (asked again at the close, and still saying it runs) could.
    await act(async () => t.sockets.desktops[0]?.serverClose(4502, "held"));
    await settle(6);
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    expect(view().getAllByText("A Ada está em pausa por enquanto")).toHaveLength(1);
    expect(sub()).toBe("");
    // Not running and held: no socket tries again until the hold ends.
    t.fake.desktops.set(ADA_ID, { ...RUNNING, running: false, held: true });
    await act(async () => t.services.queryClient.invalidateQueries({ queryKey: keys.agentDesktop(ORG_ID, ADA_ID) }));
    await act(async () => new Promise((r) => setTimeout(r, 1100)));
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(1);
  });

  test("4409: someone else took control, the screen hides; once handed back it opens again", async () => {
    const t = await dialog();
    await connected();
    const joao = controlOf(ADA_ID, "u-joao");
    t.fake.handoffs.set(joao.id, joao);
    await act(async () => t.sockets.desktops[0]?.serverClose(4409, "someone_in_control"));
    await settle(6);
    // Who holds it is the head's; why nothing shows, and until when, the cover's: each said once.
    expect(sub()).toBe("João no controle");
    expect(screen().getByText("Por privacidade, a tela fica oculta até voltar para a Ada.")).toBeTruthy();
    expect(view().getAllByText(/João/)).toHaveLength(1);
    expect(view().queryByRole("button", { name: "Assumir o controle" })).toBeNull();
    expect(t.sockets.desktops).toHaveLength(1);
    // It opens again by itself: the screen's line stays under the cover, so the screen comes back in its place.
    expect(line()).toBe(WATCHING);
    expect(document.querySelector(".dsk.is-final")).toBeNull();

    t.fake.handoffs.set(joao.id, { ...joao, status: "done" });
    await act(async () => t.services.queryClient.invalidateQueries({ queryKey: keys.agentDesktop(ORG_ID, ADA_ID) }));
    await settle(6);
    expect(t.sockets.desktops).toHaveLength(2);
    expect(t.sockets.desktops[1]?.url).toContain("mode=watch");
    await connected();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  });

  test("too many watching: it says so and tries again; no room for another screen: Tentar de novo", async () => {
    const t = await dialog();
    await act(async () => t.sockets.desktops[0]?.serverClose(4429, "too_many"));
    await settle(4);
    expect(screen().getByText("Muita gente assistindo agora.")).toBeTruthy();
    expect(screen().getByText("Tentando de novo…")).toBeTruthy();
    expect(sub()).toBe("");
    expect(line()).toBe(WATCHING);
    await act(async () => new Promise((r) => setTimeout(r, 1100)));
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(2);

    await act(async () => t.sockets.desktops[1]?.serverClose(4502, "desktop_busy"));
    await settle(4);
    expect(
      screen().getByText("O Servidor de casa já mostra o máximo de telas que consegue. Tente de novo daqui a pouco."),
    ).toBeTruthy();
    // Nothing by itself: a person tries again. Its cover takes the line's room.
    expect(document.querySelector(".dsk.is-final")).toBeTruthy();
    expect(document.querySelector(".dsk-line")).toBeNull();
    await act(async () => new Promise((r) => setTimeout(r, 1100)));
    await settle(2);
    expect(t.sockets.desktops).toHaveLength(2);
    await click(view().getByRole("button", { name: "Tentar de novo" }));
    expect(t.sockets.desktops).toHaveLength(3);
  });

  test("Assumir takes the screen's own handoff, control opens at quality 6 with no keyboard to pick; Devolver hands it back", async () => {
    // A layout an older version kept is never sent: what a key types is the person's own layout's.
    localStorage.setItem("agentes.screen.keyboard", "br");
    const t = await dialog();
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    expect(calls(t, "browser.takeover")).toEqual([[ORG_ID, ADA_ID, "desktop"]]);
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=control");
    expect(t.sockets.desktops[0]?.closed).toBe(true);
    expect(rfb()).toMatchObject({ viewOnly: false, showDotCursor: true, qualityLevel: 6, focusOnClick: false });
    await connected();
    // The person's keys go to the screen at once, through a field over it.
    expect(document.activeElement === view().getByRole("textbox", { name: "Digitar no computador da Ada" })).toBe(true);
    expect(sub()).toBe("Você no controle · a\u00a0Ada espera");
    // What programs there can see, and nothing else: copy and paste work as anywhere.
    expect(line()).toBe("Os programas do computador da Ada veem a tela e o que você digita ou cola.");
    // No box to paste into and no keyboard to pick: the person's own keys paste, and type in their own layout.
    expect(view().queryByRole("textbox", { name: "Texto para colar no computador da Ada" })).toBeNull();
    expect(view().queryByRole("combobox")).toBeNull();
    expect(document.querySelector(".dsk-line")?.textContent).toBe(line());

    // Esc in control goes to the computer: the dialog stays.
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" }),
    );
    await settle(2);
    expect(t.closed()).toBe(0);
    expect(rfb().log).toContain("keydown Escape Escape");

    // The bar is there from the start, with the keys on the screen: Ada asked nothing, so the note waits behind
    // "Deixar um recado", and nothing but the person's click hands back.
    const foot = document.querySelector(".brw-ac__back") as HTMLElement;
    expect(foot.textContent).toContain("Devolver à Ada");
    expect(within(foot).queryByRole("button", { name: "Voltar" })).toBeNull();
    expect(view().queryByRole("textbox", { name: "Recado para a Ada" })).toBeNull();
    expect(document.activeElement === document.querySelector(".dsk-keys")).toBe(true);
    expect(calls(t, "browser.done")).toEqual([]);
    await click(view().getByRole("button", { name: "Deixar um recado" }));
    // One line in the middle of its field that grows as it wraps (its height set to its text): all of a note stays
    // in sight, and there is no grip to drag.
    const note = view().getByRole("textbox", { name: "Recado para a Ada" }) as HTMLTextAreaElement;
    expect(document.activeElement === note).toBe(true);
    expect([note.tagName, note.getAttribute("rows"), note.className]).toEqual([
      "TEXTAREA",
      "1",
      "ac-input brw-ac__note",
    ]);
    expect(note.style.height).not.toBe("");
    await act(async () => fireEvent.change(note, { target: { value: "Deixei o arquivo na mesa" } }));
    /** Whether the key is left to the note (a new line), not taken to hand back. */
    const enter = async (init: KeyboardEventInit = {}) => {
      let typed = true;
      await act(async () => {
        typed = fireEvent.keyDown(note, { key: "Enter", ...init });
      });
      return typed;
    };
    // As in the chat, Shift+Enter and the Enter that ends an input method's word add to the note.
    expect(await enter({ shiftKey: true })).toBe(true);
    expect(await enter({ isComposing: true })).toBe(true);
    expect(calls(t, "browser.done")).toEqual([]);
    // Enter hands it back, as the button does, and adds no line to it.
    expect(await enter()).toBe(false);
    expect(calls(t, "browser.done")).toEqual([[ORG_ID, "takeover-1", "Deixei o arquivo na mesa"]]);
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toContain("mode=watch");
    // Watching there is nothing to hand back.
    expect(document.querySelector(".brw-ac__back")).toBeNull();
  });

  test("on the Cloud the line in control has an ⓘ: the screen's text may be checked; never while watching", async () => {
    await dialog(RUNNING, true);
    await connected();
    const about = () => view().queryByRole("button", { name: "Sobre Verificações de segurança" });
    expect(about()).toBeNull();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    await connected();
    // The ⓘ goes with what programs there can see, the line's only words.
    const hintLine = document.querySelector(".dsk-line > .dsk-words > .ac-hintline") as HTMLElement;
    expect(hintLine.querySelector(":scope > .muted")?.textContent).toBe(
      "Os programas do computador da Ada veem a tela e o que você digita ou cola.",
    );
    expect(hintLine.nextElementSibling).toBeNull();
    const hint = about() as HTMLElement;
    expect(hintLine.contains(hint)).toBe(true);
    const words =
      "Podemos verificar o texto desta tela para impedir abuso. Guardamos só o resultado. O que a tela não mostra, como uma senha num prompt, nunca é capturado.";
    expect(document.getElementById(hint.getAttribute("aria-describedby") ?? "")?.textContent).toBe(words);
    await click(hint);
    expect(screen().getByRole("tooltip").textContent).toBe(words);
  });

  test("self-hosted, the line in control has no ⓘ: nothing there is screened", async () => {
    await controlled();
    expect(view().queryByRole("button", { name: "Sobre Verificações de segurança" })).toBeNull();
    expect(document.querySelector(".dsk-line .ac-hint, .dsk-line .ac-hintline")).toBeNull();
  });

  test("taking control keeps the last picture under Assumindo o controle…, never Abrindo: the keys reach the computer once it is connected", async () => {
    const t = await dialog();
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=control");
    expect(sub()).toBe("Você no controle · a\u00a0Ada espera");
    // noVNC drops keys until its connection opens: the picture stays, frosted, so it never looks ready meanwhile.
    expect(still()).not.toBeNull();
    expect(screen().getByText("Assumindo o controle…")).toBeTruthy();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    const field = view().getByRole("textbox", { name: "Digitar no computador da Ada" });
    fireEvent.keyDown(field, { key: "a", code: "KeyA" });
    expect(rfb().log).toEqual([]);
    await connected();
    expect(still()).toBeNull();
    expect(screen().queryByText("Assumindo o controle…")).toBeNull();
    fireEvent.keyDown(field, { key: "b", code: "KeyB" });
    expect(rfb().log).toEqual(["keydown b KeyB"]);
  });

  test("handing back keeps the last picture over the watching connection: the head says watching at once, never Abrindo", async () => {
    const t = await controlled();
    expect(still()).toBeNull();
    await click(view().getByRole("button", { name: "Devolver" }));
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=watch");
    // Watching as soon as the server says so: no wait for the new connection's picture.
    expect(sub()).toBe("Ao vivo · você está assistindo");
    expect(still()).not.toBeNull();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    expect(view().getByRole("button", { name: "Assumir o controle" })).toBeTruthy();
    await connected();
    expect(still()).toBeNull();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  });

  test("control taken again while a hand back's picture is still held: that picture stays under Assumindo o controle…", async () => {
    const t = await controlled();
    await click(view().getByRole("button", { name: "Devolver" }));
    await settle(4);
    expect(still()).not.toBeNull();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=control");
    expect(still()).not.toBeNull();
    expect(screen().getByText("Assumindo o controle…")).toBeTruthy();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
  });

  test("a stream that changes mode in place: taking control keeps its socket, the picture frosted until the computer's mark, then noVNC starts again on it in control", async () => {
    const t = await dialog();
    const ws = t.sockets.desktops[0] as DesktopSocket;
    await act(async () => ws.serverSends(MODE("watch")));
    await connected();
    const watching = rfb();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    // The server switches this socket's stream: none opens, and the picture is frosted until the switch comes.
    expect(t.sockets.desktops).toHaveLength(1);
    expect(ws.closed).toBe(false);
    expect(rfb()).toBe(watching);
    expect(screen().getByText("Assumindo o controle…")).toBeTruthy();
    expect(sub()).toBe("Você no controle · a Ada espera");
    // The mark: the socket says it took the switch, and noVNC starts again on it in control over the last picture,
    // with what came after the mark.
    await act(async () => {
      ws.serverSends(MODE("control"));
      ws.serverSends(Uint8Array.of(82, 70, 66));
    });
    await settle(4);
    expect(ws.sent).toEqual([MODE("control")]);
    expect(rfb()).not.toBe(watching);
    expect(watching.canvas.isConnected).toBe(false);
    expect(rfb()).toMatchObject({ viewOnly: false, showDotCursor: true, qualityLevel: 6, got: [[82, 70, 66]] });
    expect(still()).not.toBeNull();
    expect(screen().getByText("Assumindo o controle…")).toBeTruthy();
    await connected();
    expect(still()).toBeNull();
    expect(screen().queryByText("Assumindo o controle…")).toBeNull();
    const field = view().getByRole("textbox", { name: "Digitar no computador da Ada" });
    expect(document.activeElement === field).toBe(true);
    fireEvent.keyDown(field, { key: "b", code: "KeyB" });
    expect(rfb().log).toEqual(["keydown b KeyB"]);
    expect(t.sockets.desktops).toHaveLength(1);
  });

  test("in place, control's first click goes with its first key: the frost lifts as noVNC connects, the last picture kept until control draws", async () => {
    const pixels = screenPixels();
    try {
      const t = await dialog();
      const ws = t.sockets.desktops[0] as DesktopSocket;
      await act(async () => ws.serverSends(MODE("watch")));
      pixels.picture();
      await connected();
      await click(view().getByRole("button", { name: "Assumir o controle" }));
      await act(async () => ws.serverSends(MODE("control")));
      await settle(4);
      expect(still()).not.toBeNull();
      // A new login's first picture is a whole screen: it comes a round trip and more after noVNC connects.
      pixels.black();
      await connected();
      await waitLooks();
      expect(screen().queryByText("Assumindo o controle…")).toBeNull();
      expect(still()).not.toBeNull();
      fireEvent.mouseDown(clickLandsOn());
      expect(rfb().log).toEqual(["mousedown"]);
      pixels.picture();
      await waitLooks();
      expect(still()).toBeNull();
    } finally {
      pixels.restore();
    }
  });

  test("in place, handing back: the same socket watches again after the mark, over the last picture, never Abrindo", async () => {
    const t = await dialog();
    const ws = t.sockets.desktops[0] as DesktopSocket;
    await act(async () => ws.serverSends(MODE("watch")));
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await act(async () => ws.serverSends(MODE("control")));
    await settle(4);
    await connected();
    await click(view().getByRole("button", { name: "Devolver" }));
    await settle(4);
    await act(async () => ws.serverSends(MODE("watch")));
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(1);
    expect(ws.sent).toEqual([MODE("control"), MODE("watch")]);
    expect(rfb()).toMatchObject({ viewOnly: true, showDotCursor: false, qualityLevel: 3 });
    expect(sub()).toBe("Ao vivo · você está assistindo");
    expect(still()).not.toBeNull();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    await connected();
    expect(still()).toBeNull();
  });

  test("opened while already in control: one socket, in control, kept when its stream says it changes in place", async () => {
    const b = await backend(RUNNING);
    const mine = { ...controlOf(ADA_ID, "u-walter"), id: "h-mine" };
    b.fake.handoffs.set(mine.id, mine);
    const ada = b.state.agents.find((a) => a.id === ADA_ID) as Agent;
    await renderPage(<ComputerDialog agent={ada} open onClose={() => undefined} />, {
      api: b.api,
      org: true,
      createSocket: b.sockets.factory,
    });
    await settle(8);
    const ws = b.sockets.desktops[0] as DesktopSocket;
    await act(async () => ws.serverSends(MODE("control")));
    await settle(4);
    expect(b.sockets.desktops).toHaveLength(1);
    expect(ws.url).toEndWith("&switch=1&mode=control");
    expect(ws.closed).toBe(false);
    expect(rfb()).toMatchObject({ viewOnly: false, qualityLevel: 6 });
  });

  test("in place, a drop after the switch opens the screen again once, in the mode of the moment", async () => {
    const t = await dialog();
    const ws = t.sockets.desktops[0] as DesktopSocket;
    await act(async () => ws.serverSends(MODE("watch")));
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await act(async () => ws.serverSends(MODE("control")));
    await settle(4);
    await connected();
    await act(async () => ws.serverClose(1006));
    await act(() => new Promise((r) => setTimeout(r, 1_100)));
    await settle(6);
    expect(t.sockets.desktops).toHaveLength(2);
    expect(t.sockets.desktops[1]?.url).toEndWith("&mode=control");
    await act(async () => t.sockets.desktops[1]?.serverSends(MODE("control")));
    await settle(6);
    expect(t.sockets.desktops).toHaveLength(2);
    expect(t.sockets.desktops[1]?.closed).toBe(false);
  });

  test("in place, a switch that never comes: 3 s after the mode changed the screen opens again in the new mode", async () => {
    const t = await dialog();
    const ws = t.sockets.desktops[0] as DesktopSocket;
    await act(async () => ws.serverSends(MODE("watch")));
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(1);
    await act(() => new Promise((r) => setTimeout(r, 3_100)));
    await settle(4);
    expect(ws.closed).toBe(true);
    expect(t.sockets.desktops).toHaveLength(2);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=control");
  });

  test("Take control refused: said in the head, in its line's place, not in a toast over the window's corner", async () => {
    const t = await dialog();
    await connected();
    replaceOn(t.api.browser, "takeover", async () => {
      throw new ApiError(409, "conflict", "Someone else is in control");
    });
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    const said = document.querySelector(".ac-dialog__sub > .cmp-said");
    expect(said?.textContent).toBe("Outra pessoa já está ajudando.");
    expect(said?.getAttribute("role")).toBe("alert");
    expect(document.querySelector(".cmp-sub")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector(".ac-toast")).toBeNull();
  });

  test("the bar leaves the keys on the screen: a press on it takes nothing, and Esc in an empty note brings them back", async () => {
    const t = await controlled();
    const foot = document.querySelector(".brw-ac__back") as HTMLElement;
    // A press on the bar or its button keeps the browser's focus off it, so Enter stays the computer's.
    expect(fireEvent.mouseDown(foot)).toBe(false);
    expect(fireEvent.mouseDown(within(foot).getByRole("button", { name: "Devolver" }))).toBe(false);
    await act(async () => t.field().focus());
    await click(view().getByRole("button", { name: "Deixar um recado" }));
    const note = view().getByRole("textbox", { name: "Recado para a Ada" });
    expect(document.activeElement === note).toBe(true);
    // In the note, a press stays the field's own, to place the caret.
    expect(fireEvent.mouseDown(note)).toBe(true);
    await act(async () => fireEvent.keyDown(note, { key: "Escape" }));
    expect(view().queryByRole("textbox", { name: "Recado para a Ada" })).toBeNull();
    expect(document.activeElement === t.field()).toBe(true);
    expect(calls(t, "browser.done")).toEqual([]);
  });

  test("a hand back that fails: said in the head, the note kept to send again", async () => {
    const t = await controlled();
    replaceOn(t.api.browser, "done", async () => {
      throw new ApiError(500, "internal", "Something broke");
    });
    await click(view().getByRole("button", { name: "Deixar um recado" }));
    const note = () => view().getByRole("textbox", { name: "Recado para a Ada" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(note(), { target: { value: "Deixei aberto" } }));
    await click(view().getByRole("button", { name: "Devolver" }));
    expect(document.querySelector(".ac-dialog__sub > .cmp-said")?.textContent).toBe("Não deu certo. Tente de novo.");
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(note().value).toBe("Deixei aberto");
  });

  test("control ended on the server first (4410): it opens again as a watcher over the same picture; a drop then says so", async () => {
    const t = await controlled();
    const done = { ...(t.fake.handoffs.get("takeover-1") as BrowserHandoff), status: "done" as const };
    t.fake.handoffs.set(done.id, done);
    await act(async () => t.sockets.desktops.at(-1)?.serverClose(4410, "control_ended"));
    await settle(6);
    expect(still()).not.toBeNull();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    expect(sub()).toBe("Ao vivo · você está assistindo");
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=watch");
    // The new connection drops before it draws: the cover says why, over no old picture.
    await act(async () => t.sockets.desktops.at(-1)?.serverClose(4503, "offline"));
    await settle(4);
    expect(still()).toBeNull();
    expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
    expect(screen().getByText("Tentando de novo…")).toBeTruthy();
  });

  test("a hand back keeps the last picture dimmed under Devolvendo à Ada… until the watcher draws, never the cold cover", async () => {
    const t = await controlled();
    await click(view().getByRole("button", { name: "Devolver" }));
    await settle(4);
    expect(t.sockets.desktops.at(-1)?.url).toEndWith("&mode=watch");
    expect(still()).not.toBeNull();
    expect(sub()).toBe("Ao vivo · você está assistindo");
    const returning = () => screen().queryByText("Devolvendo à Ada…")?.closest(".brw-dim");
    expect(returning()?.classList.contains("is-clear")).toBe(true);
    // However long the watcher takes: the picture, dimmed, and what is happening, never "Abrindo…".
    await act(() => new Promise((r) => setTimeout(r, 3_100)));
    expect(still()).not.toBeNull();
    expect(returning()).toBeTruthy();
    expect(screen().queryByText("Abrindo o computador da Ada…")).toBeNull();
    // Nothing asks to take control meanwhile.
    await act(async () => fireEvent.pointerDown(rfb().canvas, { pointerType: "mouse", button: 0 }));
    expect(document.querySelector(".dsk-ask")).toBeNull();
    await connected();
    expect(still()).toBeNull();
    expect(returning()).toBeFalsy();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  }, 15_000);

  test("control taken over by someone else: their screen hidden at once, nothing of it kept under the cover", async () => {
    const t = await controlled();
    const mine = t.fake.handoffs.get("takeover-1") as BrowserHandoff;
    t.fake.handoffs.set(mine.id, { ...mine, status: "done" });
    const joao = controlOf(ADA_ID, "u-joao");
    t.fake.handoffs.set(joao.id, joao);
    await act(async () => t.sockets.desktops.at(-1)?.serverClose(4410, "control_ended"));
    await settle(6);
    expect(sub()).toBe("João no controle");
    expect(screen().getByText("Por privacidade, a tela fica oculta até voltar para a Ada.")).toBeTruthy();
    expect(still()).toBeNull();
  });

  test("in control each key is replayed on noVNC's canvas, never seen by the page; a blur lets go of what is held", async () => {
    const t = await controlled();
    const field = t.field();
    const page: string[] = [];
    const seen = (e: KeyboardEvent) => page.push(e.key);
    window.addEventListener("keydown", seen);
    try {
      // Taken from the browser (prevented) and replayed.
      expect(fireEvent.keyDown(field, { key: "a", code: "KeyA" })).toBe(false);
      fireEvent.keyUp(field, { key: "a", code: "KeyA" });
      fireEvent.keyDown(field, { key: "Shift", code: "ShiftLeft", shiftKey: true });
      await act(async () => field.blur());
      expect(rfb().log).toEqual([
        "keydown a KeyA",
        "keyup a KeyA",
        "keydown Shift ShiftLeft shift",
        "keyup Shift ShiftLeft shift",
      ]);
      expect(page).toEqual([]);
    } finally {
      window.removeEventListener("keydown", seen);
    }
  });

  test("Ctrl+V pastes the person's clipboard: the computer's clipboard, then Shift+Insert with Ctrl let go and held again", async () => {
    const t = await controlled();
    // The watching socket's close can arrive after the control one opened: the paste still goes.
    await act(async () => t.sockets.desktops[0]?.serverClose(1000));
    await settle(2);
    const field = t.field();
    fireEvent.keyDown(field, { key: "Control", code: "ControlLeft", ctrlKey: true });
    // V is the browser's own paste: neither replayed nor stopped.
    expect(fireEvent.keyDown(field, { key: "v", code: "KeyV", ctrlKey: true })).toBe(true);
    await pasteOn(field, "Olá, ação: êõú ç — 日本\r\nfim");
    expect(rfb().pasted).toEqual(["Olá, ação: êõú ç — 日本\nfim"]);
    expect(rfb().log).toEqual([
      "keydown Control ControlLeft ctrl",
      "keyup Control ControlLeft ctrl",
      ...SHIFT_INSERT,
      "keydown Control ControlLeft ctrl",
    ]);
  });

  test("a paste over 256 KB as it is sent, or with no text, sends nothing and says why", async () => {
    const t = await controlled();
    await pasteOn(t.field(), "");
    // In the line under the screen, where copy and paste are told, not a toast over the window's corner.
    expect(said()).toBe("No computador da Ada só dá para colar texto.");
    expect(document.querySelector(".dsk-said")?.getAttribute("role")).toBe("alert");
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(line()).toBeUndefined();
    // The limit is the computer's, in what noVNC sends: UTF-8, each line break as CRLF, and a NUL at the end.
    for (const text of ["x".repeat(262_144), "ã".repeat(131_072), "linha\n".repeat(40_000)]) {
      await pasteOn(t.field(), text);
    }
    expect(said()).toBe("Grande demais para colar no computador da Ada. No máximo 256 KB.");
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(rfb().pasted).toEqual([]);
    expect(rfb().log).toEqual([]);
    // Up to the limit goes, a CRLF counted as the two bytes it is.
    await pasteOn(t.field(), `${"x".repeat(262_141)}\r\n`);
    expect(rfb().pasted.map((text) => text.length)).toEqual([262_142]);
  });

  test("a dead key composes in the field: é goes as one key, an emoji as a paste", async () => {
    const t = await controlled();
    const field = t.field();
    // Left to the browser, which composes it.
    expect(fireEvent.keyDown(field, { key: "Dead", code: "Quote" })).toBe(true);
    expect(rfb().log).toEqual([]);
    const compose = async (text: string) => {
      field.value = text;
      await act(async () => {
        field.dispatchEvent(new Event("compositionend"));
        await new Promise((r) => setTimeout(r, 0));
      });
    };
    await compose("é");
    expect(rfb().log).toEqual(["keydown é"]);
    expect(field.value).toBe("");
    await compose("👍");
    expect(rfb().pasted).toEqual(["👍"]);
    expect(rfb().log.slice(1)).toEqual(SHIFT_INSERT);
  });

  test("⌘C on a Mac: Ctrl+Insert there, and what it copies within 2 s lands in the person's clipboard; ⌘V pastes", async () => {
    replaceOn(navigator, "platform", "MacIntel");
    const board = clipboard();
    const t = await controlled();
    expect(line()).toBe("Os programas do computador da Ada veem a tela e o que você digita ou cola.");
    const field = t.field();
    fireEvent.keyDown(field, { key: "Meta", code: "MetaLeft", metaKey: true });
    fireEvent.keyDown(field, { key: "c", code: "KeyC", metaKey: true });
    // ⌘ is Alt there: let go of it around the copy keys, then held again.
    expect(rfb().log).toEqual([
      "keydown Meta MetaLeft meta",
      "keyup Meta MetaLeft meta",
      "send ControlLeft down",
      "send Insert down",
      "send Insert up",
      "send ControlLeft up",
      "keydown Meta MetaLeft meta",
    ]);
    await act(async () => rfb().emit("clipboard", { text: "ls -la /tmp" }));
    await settle(2);
    expect(board.written).toEqual(["ls -la /tmp"]);
    // Said in the line under the screen, in its words' place: the window fills the page, and a toast would land on
    // its corner.
    expect(said()).toBe("Copiado do computador da Ada.");
    expect(document.querySelector(".dsk-said")?.getAttribute("role")).toBe("status");
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(t.closed()).toBe(0);
    expect(calls(t, "browser.done")).toEqual([]);

    rfb().log = [];
    expect(fireEvent.keyDown(field, { key: "v", code: "KeyV", metaKey: true })).toBe(true);
    await pasteOn(field, "oi");
    expect(rfb().pasted).toEqual(["oi"]);
    expect(rfb().log).toEqual(["keyup Meta MetaLeft meta", ...SHIFT_INSERT, "keydown Meta MetaLeft meta"]);
  });

  test("Ctrl+C elsewhere stays an interrupt there; nothing is written when nothing is copied", async () => {
    const board = clipboard();
    const t = await controlled();
    const field = t.field();
    fireEvent.keyDown(field, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.keyDown(field, { key: "c", code: "KeyC", ctrlKey: true });
    expect(rfb().log).toEqual(["keydown Control ControlLeft ctrl", "keydown c KeyC ctrl"]);
    await act(() => new Promise((r) => setTimeout(r, 2_100)));
    expect(board).toMatchObject({ writes: 1, failed: 1, written: [] });
    // Too late to be that copy's.
    await act(async () => rfb().emit("clipboard", { text: "^C" }));
    await settle(2);
    expect(board.writes).toBe(1);
    expect(document.querySelector(".ac-toast")).toBeNull();
  }, 10_000);

  test("what the computer copies by itself never reaches the person's clipboard", async () => {
    const board = clipboard();
    await controlled();
    await act(async () => rfb().emit("clipboard", { text: "a selection" }));
    await settle(2);
    expect(board.writes).toBe(0);
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(document.querySelector(".dsk-got")).toBeNull();
  });

  test("a browser that won't let the copy in: the line under the screen offers the text, with Copiar", async () => {
    const board = clipboard({ refuses: true });
    const t = await controlled();
    fireEvent.keyDown(t.field(), { key: "c", code: "KeyC", ctrlKey: true });
    await act(async () => rfb().emit("clipboard", { text: "ls -la /tmp" }));
    await settle(2);
    // In the dialog, not a toast: nothing reached the person's clipboard, and their click must reach the button.
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(view().getByText("Copiado no computador da Ada:")).toBeTruthy();
    expect(view().getByText("ls -la /tmp")).toBeTruthy();
    expect(line()).toBeUndefined();
    await click(view().getByRole("button", { name: "Copiar" }));
    expect(board.texts).toEqual(["ls -la /tmp"]);
    expect(said()).toBe("Copiado do computador da Ada.");
    expect(document.querySelector(".dsk-got")).toBeNull();
    expect(document.querySelector(".ac-toast")).toBeNull();
    expect(t.closed()).toBe(0);
    // Handed back and taken again: the line has its own words, nothing said from before.
    await click(view().getByRole("button", { name: "Devolver" }));
    await settle(4);
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    await connected();
    expect(said()).toBeUndefined();
    expect(line()).toBe("Os programas do computador da Ada veem a tela e o que você digita ou cola.");
  });

  test("the newest copy speaks: one kept out right after a Copiado is offered at once, not under the older word", async () => {
    clipboard();
    const t = await controlled();
    fireEvent.keyDown(t.field(), { key: "c", code: "KeyC", ctrlKey: true });
    await act(async () => rfb().emit("clipboard", { text: "primeiro" }));
    await settle(2);
    expect(said()).toBe("Copiado do computador da Ada.");
    clipboard({ refuses: true });
    fireEvent.keyDown(t.field(), { key: "c", code: "KeyC", ctrlKey: true });
    await act(async () => rfb().emit("clipboard", { text: "segundo" }));
    await settle(2);
    expect(said()).toBeUndefined();
    expect(document.querySelector(".dsk-got q")?.textContent).toBe("segundo");
  });

  test("watching: no field, nothing pasted, nothing copied", async () => {
    const board = clipboard();
    await dialog();
    await connected();
    expect(view().queryByRole("textbox", { name: "Digitar no computador da Ada" })).toBeNull();
    await pasteOn(document.body, "oi");
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC", ctrlKey: true });
    await act(async () => rfb().emit("clipboard", { text: "ls" }));
    await settle(2);
    expect(rfb().pasted).toEqual([]);
    expect(rfb().log).toEqual([]);
    expect(board.writes).toBe(0);
  });

  test("a phone: a Keyboard button raises its keyboard, no keys hint; what it types goes to the computer", async () => {
    replaceOn(navigator, "maxTouchPoints", 5);
    const t = await controlled();
    const field = t.field();
    // Its keyboard comes up only when asked.
    expect(document.activeElement === field).toBe(false);
    const keyboard = view().getByRole("button", { name: "Teclado" });
    expect(keyboard.getAttribute("aria-pressed")).toBe("false");
    expect(line()).toBe("Os programas do computador da Ada veem a tela e o que você digita ou cola.");
    await click(keyboard);
    expect(document.activeElement === field).toBe(true);
    expect(keyboard.getAttribute("aria-pressed")).toBe("true");
    field.value = "oi";
    await act(async () => void field.dispatchEvent(new InputEvent("input", { inputType: "insertText" })));
    expect(rfb().log).toEqual(["keydown o", "keydown i"]);
    expect(field.value).toBe("");
    await act(async () => void field.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward" })));
    expect(rfb().log.at(-1)).toBe("keydown Backspace");

    // Handed back with its keyboard up, then taken again: the button starts unpressed. Its return key adds a line to
    // the note, as in the chat; the button hands back.
    await click(view().getByRole("button", { name: "Deixar um recado" }));
    const note = view().getByRole("textbox", { name: "Recado para a Ada" });
    expect(fireEvent.keyDown(note, { key: "Enter" })).toBe(true);
    await settle(2);
    expect(calls(t, "browser.done")).toEqual([]);
    await click(view().getAllByRole("button", { name: "Devolver" }).at(-1) as HTMLElement);
    expect(calls(t, "browser.done")).toHaveLength(1);
    await settle(4);
    await connected();
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    await connected();
    expect(view().getByRole("button", { name: "Teclado" }).getAttribute("aria-pressed")).toBe("false");
  });

  test("leaving the page asks first, only in control", async () => {
    await dialog();
    await connected();
    const leaving = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leaving()).toBe(false);
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    expect(leaving()).toBe(true);
  });

  test("full screen is the page's and shows the computer alone; Esc leaves it, and Devolver works on its first click", async () => {
    const page = fullScreen();
    const t = await controlled();
    /** The glyph the full-screen button draws. */
    const glyph = (name: string) => view().getByRole("button", { name }).querySelector("path")?.getAttribute("d");
    // Corners pulled apart to go in, pushed together to come out: never an external link's arrow.
    expect(glyph("Tela cheia")).toBe(icons.expand[0]?.[1].d);
    await click(view().getByRole("button", { name: "Tela cheia" }));
    expect(glyph("Sair da tela cheia")).toBe(icons.shrink[0]?.[1].d);
    expect(view().getByRole("button", { name: "Sair da tela cheia" }).hasAttribute("aria-pressed")).toBe(false);
    // The page goes full screen, not the dialog: noVNC's capture layer on the page stays inside it.
    expect(page.requested).toEqual([document.documentElement]);
    expect(classes()).toEqual(expect.arrayContaining(["is-full", "is-screen-only"]));
    expect(classes()).not.toContain("is-bar-hidden");
    // The screen and what floats over it alone: anything else in the dialog (its sky strip) is hidden by the class
    // it really has, or it would take a row of the display.
    const css = await Bun.file(new URL("../src/components/computer/computer.css", import.meta.url).pathname).text();
    const others = [...(document.querySelector(".cmp-dialog")?.children ?? [])].filter(
      (el) => !el.matches(".ac-dialog__head, .cmp-body"),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const el of others) {
      expect(css).toMatch(
        new RegExp(`\\.cmp-dialog\\.is-screen-only > \\.${el.classList[0]}[,\\s][^{]*\\{\\s*display: none;`),
      );
    }
    // Without Keyboard Lock, Esc leaves full screen, even in control.
    await act(async () => fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" }));
    await settle(2);
    expect(classes()).not.toContain("is-full");
    expect(document.fullscreenElement).toBeNull();
    expect(t.closed()).toBe(0);
    await click(view().getByRole("button", { name: "Devolver" }));
    expect(calls(t, "browser.done")).toEqual([[ORG_ID, "takeover-1"]]);
  });

  test("Devolver in full screen: there in the bar under the screen, and one click hands back and leaves it", async () => {
    fullScreen();
    const t = await controlled();
    await click(view().getByRole("button", { name: "Tela cheia" }));
    expect(classes()).toContain("is-screen-only");
    // The dialog's head has only full screen and the close: Devolver is the bar's, under the screen.
    expect(
      within(document.querySelector(".cmp-acts") as HTMLElement).queryByRole("button", { name: "Devolver" }),
    ).toBeNull();
    const foot = document.querySelector(".brw-ac__back") as HTMLElement;
    await click(within(foot).getByRole("button", { name: "Devolver" }));
    expect(calls(t, "browser.done")).toEqual([[ORG_ID, "takeover-1"]]);
    expect(classes()).not.toContain("is-full");
    expect(document.fullscreenElement).toBeNull();
  });

  // Real time past the bar's 2.5 s: these tests say how long they may take, as the run's later files get 5 s.
  test("the full-screen bar hides itself; in control only a rest at the display's top edge, or a tap, brings it back", async () => {
    fullScreen();
    await controlled();
    await click(view().getByRole("button", { name: "Tela cheia" }));
    expect(classes()).not.toContain("is-line-hidden");
    await barTime();
    expect(classes()).toEqual(expect.arrayContaining(["is-bar-hidden", "is-line-hidden"]));
    // The pointer is the computer's: a move over the screen leaves it hidden.
    await pointerAt(400);
    expect(classes()).toContain("is-bar-hidden");
    // On its way to the computer's own top bar the pointer stops at the edge a moment: that brings nothing.
    await pointerAt(4);
    await pointerAt(30);
    await edgeTime();
    expect(classes()).toContain("is-bar-hidden");
    // Resting there brings the head back, alone: the line under it would cover more of the computer's top bar.
    await pointerAt(4);
    expect(classes()).toContain("is-bar-hidden");
    await edgeTime();
    expect(classes()).not.toContain("is-bar-hidden");
    expect(classes()).toContain("is-line-hidden");
    // On the bar it stays.
    await act(
      async () => void fireEvent.pointerMove(document.querySelector(".ac-dialog__head") as Element, { clientY: 30 }),
    );
    await barTime();
    expect(classes()).not.toContain("is-bar-hidden");
    // A phone has no pointer to bring to the edge: a tap anywhere brings all of it back, its Keyboard button too.
    await pointerAt(400);
    await barTime();
    expect(classes()).toContain("is-bar-hidden");
    await act(async () => void fireEvent.pointerDown(document.body, { clientY: 400, pointerType: "touch" }));
    expect(classes()).not.toContain("is-bar-hidden");
    expect(classes()).not.toContain("is-line-hidden");
  }, 20_000);

  test("watching in full screen, any move brings the bar back", async () => {
    fullScreen();
    await dialog();
    await connected();
    await click(view().getByRole("button", { name: "Tela cheia" }));
    await barTime();
    expect(classes()).toContain("is-bar-hidden");
    await pointerAt(400);
    expect(classes()).not.toContain("is-bar-hidden");
  }, 10_000);

  test("Keyboard Lock in control: Esc goes to the computer, and the lock goes with full screen", async () => {
    fullScreen();
    const lock = { locked: 0, unlocked: 0 };
    replaceOn(navigator, "keyboard", {
      lock: async () => void lock.locked++,
      unlock: () => void lock.unlocked++,
    });
    const t = await controlled();
    // Only full screen locks it.
    expect(lock.locked).toBe(0);
    // The keys still go to the computer after a click on the button, which takes the browser's focus.
    await clickFocusing(view().getByRole("button", { name: "Tela cheia" }));
    expect(lock.locked).toBe(1);
    expect(document.activeElement === t.field()).toBe(true);
    await act(async () =>
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" }),
    );
    await settle(2);
    expect(classes()).toContain("is-full");
    expect(t.closed()).toBe(0);
    expect(rfb().log).toContain("keydown Escape Escape");
    // Leaving it from the bar's button gives the keys back to the computer too, and lets go of the lock.
    await clickFocusing(view().getByRole("button", { name: "Sair da tela cheia" }));
    expect(classes()).not.toContain("is-full");
    expect(document.activeElement === t.field()).toBe(true);
    expect(lock.unlocked).toBe(1);
  });

  test("a page kept for the Back button lets its screen go, and opens it again when the person comes back", async () => {
    const t = await dialog();
    await connected();
    const page = (type: "pagehide" | "pageshow", persisted: boolean) =>
      act(async () => void window.dispatchEvent(Object.assign(new Event(type), { persisted })));
    // A page really going away is the browser's to close.
    await page("pagehide", false);
    expect(t.sockets.desktops[0]?.closed).toBe(false);

    await page("pagehide", true);
    expect(t.sockets.desktops[0]?.closed).toBe(true);
    // Its close arrives when the page is back: not a reason to stop opening the screen.
    await act(async () => t.sockets.desktops[0]?.serverClose(1000));
    await page("pageshow", true);
    await settle(4);
    expect(t.sockets.desktops).toHaveLength(2);
    expect(t.sockets.desktops[1]?.url).toContain("mode=watch");
    await connected();
    expect(sub()).toBe("Ao vivo · você está assistindo");
  });

  test("can't show on self-host: the reason, and for whoever paired it the command to run there", async () => {
    const t = await dialog({ ...RUNNING, available: false, reason: "not_allowed" });
    expect(t.sockets.desktops).toHaveLength(0);
    expect(screen().getByText("As telas estão desligadas no Servidor de casa. Ligue lá:")).toBeTruthy();
    // A system-mode computer's settings are its administrator's.
    expect(document.querySelector(".machine-command__code")?.textContent).toBe(
      "sudo agentes-runner tools enable desktop",
    );
    expect(view().getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    cleanup();

    const outdated = await dialog({ ...RUNNING, available: false, reason: "runner_outdated" });
    expect(outdated.sockets.desktops).toHaveLength(0);
    expect(screen().getByText("Atualize o agentes no Servidor de casa para ver a tela da Ada.")).toBeTruthy();
  });
});

describe("the dialog's size (computer.css)", () => {
  const css = () => Bun.file(new URL("../src/components/computer/computer.css", import.meta.url).pathname).text();
  const rule = (text: string, selector: string) => text.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";

  test("the screen fills what its stage gets, keeping its shape; no mode sizes it on its own", async () => {
    const text = await css();
    const stage = rule(text, ".cmp-body .dsk-stage,\n.cmp-body > .cmp-stage");
    expect(stage).toContain("container-type: size");
    expect(stage).toContain("flex: 1 1 0");
    expect(rule(text, ".cmp-body .dsk-screen,\n.cmp-body .cmp-stage__box")).toContain(
      "width: min(100cqw, 100cqh * 1280 / 900)",
    );
    // In control and in full screen alike: nothing outranks the stage's own measure.
    expect(text).not.toMatch(/is-control \.dsk-screen\s*\{[^}]*width/);
    expect(text).not.toMatch(/is-full \.(dsk-screen|cmp-stage__box)/);
    const full = rule(text, ".ac-dialog.cmp-dialog.is-full");
    expect(full).toContain("width: 100%");
    expect(full).toContain("height: 100%");
  });

  test("one frame for the screen, its covers, the agent's page and the wait: one size and one place in every state", async () => {
    const text = await css();
    // The wait for the workspace's computer takes the same frame, so its screen opens in place. Around the screen, the
    // body's 20 px on every side (the head's inset) and the line under it, kept whether a line shows there or not,
    // and 42 px of the page above and below, so a notice along its top stays whole.
    const frame = rule(text, ".ac-dialog.cmp-dialog:where(:has(.dsk, .cmp-stage, .cmp-prep, .brw-ac.is-surface))");
    expect(frame).toContain("--cmp-around: calc(124px + var(--cmp-line))");
    expect(frame).toContain("--cmp-room: calc(100dvh - 84px - var(--cmp-bar, 0px) - var(--cmp-around))");
    expect(frame).toContain("--cmp-screen: min(96vw - 40px, 1280px, var(--cmp-room) * 1280 / 900)");
    expect(frame).toContain("width: calc(var(--cmp-screen) + 40px)");
    expect(frame).toContain("height: calc(var(--cmp-screen) * 900 / 1280 + var(--cmp-around))");
    // Sized once: nothing that comes and goes (a banner, a request, the note) gives the window room of its own.
    expect(text).not.toMatch(/--cmp-(extra|over|under)/);
    expect(text).toContain(".ac-dialog.cmp-dialog {\n  --cmp-button: var(--control-h-sm);\n  --cmp-line: 22px;\n}");
    // No state sizes the dialog on its own: no rule but the frame's (and full screen's) gives it a height.
    expect(text.match(/\n {0,2}height: calc\(var\(--cmp-screen\)[^;]*;/g)).toHaveLength(1);
    expect(rule(text, ".cmp-body")).toContain("padding: 20px");
    // The wait fills that box, its words in the middle (on a phone it is as tall as its words). Auto margins centre
    // them, so a box shorter than the words starts them at its top and scrolls all of them: `justify-content: center`
    // would push their top out of reach.
    const prep = rule(text, ".cmp-prep");
    expect(prep).toContain("flex: 1 1 0");
    expect(prep).toContain("overflow-y: auto");
    expect(prep).not.toContain("justify-content");
    expect(rule(text, ".cmp-prep > :first-child")).toContain("margin-top: auto");
    expect(rule(text, ".cmp-prep > :last-child")).toContain("margin-bottom: auto");
    // Centred like every state: no top of its own but the desktop app's, and no eased height.
    expect(text.match(/\btop: calc\(50%[^;]*;/g)).toEqual(["top: calc(50% + var(--titlebar-h) / 2);"]);
    expect(text).not.toMatch(/transition: height/);
    expect(rule(text, ".cmp-steps-row")).toContain("height: var(--cmp-line)");
    // The page at 16:10 takes the most of its stage in the same frame, never a size of its own.
    expect(rule(text, ".cmp-body .brw-ac__page")).toContain("width: min(100cqw, 100cqh * 16 / 10)");
    expect(text).not.toContain("--cmp-page-room");
  });

  test("one size watching or in control: the line under the screen takes the steps' line's place", async () => {
    const text = await css();
    // No column of tools beside the screen any more, on any window.
    expect(text).not.toContain("--cmp-side");
    expect(text).not.toContain("min-aspect-ratio");
    expect(rule(text, ".cmp-body:has(> .dsk.is-control) > .cmp-steps-row")).toContain("display: none");
    const desk = await Bun.file(new URL("../src/components/desktop/desktop.css", import.meta.url).pathname).text();
    expect(rule(desk, ".dsk-line")).toContain("min-height: 22px");
    // In the window its words stay one 22 px line, whatever the window's width: what programs there can see first
    // (the Cloud's ⓘ with it), cut short only where nothing else fits, and the keys after it only when they fit whole
    // (they wrap to a second row it never shows). The phone's sheet and full screen keep no line's room: there it wraps.
    const frame = desk.split("@media (min-width: 721px) {")[1]?.split("\n}\n")[0] ?? "";
    const inFrame = (selector: string) => frame.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    const words = inFrame(".cmp-dialog:not(.is-screen-only) .dsk-words");
    for (const d of ["display: flex", "flex-wrap: wrap", "height: 22px", "overflow: hidden", "min-width: 0"]) {
      expect(words).toContain(d);
    }
    expect(inFrame(".cmp-dialog:not(.is-screen-only) .dsk-words > *")).toContain("min-width: 0");
    const each = inFrame(".cmp-dialog:not(.is-screen-only) .dsk-words .muted");
    for (const d of ["min-width: 0", "overflow: hidden", "white-space: nowrap", "text-overflow: ellipsis"]) {
      expect(each).toContain(d);
    }
  });

  test("a phone's Keyboard button leads the line with the words' first line on its middle", async () => {
    const desk = await Bun.file(new URL("../src/components/desktop/desktop.css", import.meta.url).pathname).text();
    // Not a baseline: a button's is its icon's bottom edge, about 4 px under its label's.
    const line = rule(desk, ".dsk-line");
    expect(line).toContain("align-items: flex-start");
    expect(line).toContain("line-height: 22px");
    // The 22 px line's middle on the button's, a small button that keeps its 32 px plate on touch: (32 − 22) / 2.
    expect(rule(desk, ".dsk-line > .ac-btn ~ *")).toContain("margin-top: calc((var(--control-h-sm) - 22px) / 2)");
    const kit = await Bun.file(
      new URL("../../../packages/ui/src/styles/components.css", import.meta.url).pathname,
    ).text();
    expect(kit).not.toContain("@media (pointer: coarse) {\n  .ac-btn--sm {\n    min-height");
  });

  test("the line's ⓘ is its sentence's: 4 px after its last letter", async () => {
    const kit = await Bun.file(
      new URL("../../../packages/ui/src/styles/components.css", import.meta.url).pathname,
    ).text();
    // The kit's hint line: the ⓘ 4 px after the last letter, in the 18 px it keeps for it.
    expect(rule(kit, ".ac-hintline > .ac-hint")).toContain("margin-inline: -1px -23px");
    expect(rule(kit, ".ac-hintline")).toContain("padding-inline-end: 18px");
    // In control on the Cloud the ⓘ is in the hint line, after its words, and nothing follows that line.
    await controlled(true);
    const hintLine = document.querySelector(".dsk-line > .dsk-words > .ac-hintline") as HTMLElement;
    const hint = hintLine.querySelector(":scope > .ac-hint");
    expect(hint?.previousElementSibling?.classList.contains("muted")).toBe(true);
    expect(hintLine.nextElementSibling).toBeNull();
  });

  /** A phone's rule: one of `@media (max-width: 640px)`. */
  const phoneRule = async (selector: string) =>
    (await css()).split("@media (max-width: 640px) {")[1]?.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";

  test("a phone's head keeps one row and one height: an action its icon alone, the face aside", async () => {
    // No second row for the actions: the head is the kit's one flex row.
    expect(await css()).not.toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    const square = await phoneRule(".cmp-acts > .ac-btn:has(> .ac-icon)");
    expect(square).toContain("width: var(--control-h-sm)");
    expect(square).toContain("padding: 0");
    const words = await phoneRule(".cmp-acts > .ac-btn .cmp-act-label");
    expect(words).toContain("position: absolute");
    expect(words).toContain("clip: rect(0 0 0 0)");
    // The name and the line under it keep a line each beside the controls: the title names the agent, so the face goes,
    // and either one cut short is still one line.
    expect(await phoneRule(".cmp-dialog .ac-dialog__lead")).toContain("display: none");
    const titles = await phoneRule(".cmp-dialog .ac-dialog__titles > *");
    expect(titles).toContain("white-space: nowrap");
    expect(titles).toContain("text-overflow: ellipsis");
    expect(titles).toContain("overflow: hidden");
    // A failed action's words in the line's place wrap whole instead, for the moment they show.
    expect(await phoneRule(".cmp-dialog .ac-dialog__sub:has(> .cmp-said)")).toContain("white-space: normal");
    // An icon alone sits in the middle of its square: no reaching out by its drawing's air there.
    const square2 = await phoneRule(".cmp-acts > .cmp-take");
    expect(square2).toContain("--lead-air: initial");
    expect(square2).toContain("--lead-rise: initial");
    // On a phone the body takes the head's 16 px inset, as the kit's head does there.
    expect(await phoneRule(".cmp-body")).toContain("padding: 16px");
    // The words that give way are the button's name.
    await dialog();
    await connected();
    const take = view().getByRole("button", { name: "Assumir o controle" });
    expect(take.querySelector(".cmp-act-label")?.textContent).toBe("Assumir o controle");
    expect(take.classList.contains("cmp-take")).toBe(true);
  });

  test("on a phone the wait and the page fill the sheet; the screen and its covers are one box, in its middle with all else under it", async () => {
    const text = await css();
    const sheet = text.split("@media (max-width: 720px) {")[1]?.split("\n}\n")[0] ?? "";
    const inSheet = (selector: string) => sheet.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    // The kit's full-screen sheet (Details on a phone): clear of the notch and the home bar, its full screen excepted.
    const clear = inSheet(".ac-dialog.cmp-dialog:not(.is-full)");
    expect(clear).toContain("padding-top: env(safe-area-inset-top, 0px)");
    expect(clear).toContain("padding-bottom: env(safe-area-inset-bottom, 0px)");
    // The wait's and the page's stages grow to the sheet's foot, never shorter than their words.
    expect(
      inSheet(
        ".cmp-body > .cmp-prep,\n  .cmp-body > .brw-ac.is-surface,\n  .cmp-body > .brw-ac.is-surface > .brw-ac__body,\n  .cmp-body > .brw-ac.is-surface .brw-ac__stage",
      ),
    ).toContain("flex: 1 0 auto");
    // The screen and any cover in its place (the dialog's opening, the screen's own) are one box: the screen's shape,
    // as wide as the sheet, so the screen opens where its cover was, nothing jumping. None fills the sheet any more.
    expect(inSheet(".cmp-body > .cmp-stage,\n  .cmp-body > .dsk,\n  .cmp-body .dsk-stage")).toContain("flex: none");
    expect(sheet).not.toContain('.dsk:not([data-state="live"]),');
    const covered = inSheet(
      '.cmp-body > .cmp-stage > .cmp-stage__box,\n  .cmp-body > .dsk:not([data-state="live"]) .dsk-screen',
    );
    expect(covered).toContain("width: 100%");
    expect(covered).toContain("aspect-ratio: 1280 / 900");
    expect(covered).toContain("place-self: auto");
    // The cover shares the box's cell, so words taller than the box (a fix to run there) grow it instead of spilling.
    expect(
      inSheet(
        ".cmp-body > .cmp-stage > :is(.cmp-stage__box, .brw-dim),\n  .cmp-body > .dsk > .dsk-stage > :is(.dsk-screen, .brw-dim)",
      ),
    ).toContain("grid-area: 1 / 1");
    const cell = inSheet(".cmp-body > .cmp-stage > .brw-dim,\n  .cmp-body > .dsk > .dsk-stage > .brw-dim");
    expect(cell).toContain("position: relative");
    expect(cell).toContain("place-self: stretch");
    // Its one column is the sheet's width: a long command never widens the box past the sheet.
    expect(inSheet(".cmp-body > .cmp-stage,\n  .cmp-body > .dsk > .dsk-stage")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    // That box and what goes under it, one block in the sheet's middle, the body measuring its room: the request being
    // helped with right under it, then the line or the note, a banner after the steps. The same room over the block
    // and under it gives: where they would run past the foot, the block rises that much. A cover keeps the screen's
    // line under it, so the screen opens in its place.
    expect(inSheet(".cmp-dialog:not(.is-screen-only) > .cmp-body")).toContain("container-type: size");
    const over = inSheet(".cmp-dialog:not(.is-screen-only) > .cmp-body:has(> :is(.dsk, .cmp-stage))::before");
    for (const d of ['content: ""', "flex: 1 1 0"]) expect(over).toContain(d);
    expect(over).not.toContain("max-height");
    const under = inSheet(".cmp-dialog:not(.is-screen-only) > .cmp-body:has(> :is(.dsk, .cmp-stage))::after");
    for (const d of ['content: ""', "order: 1", "flex: 1 1 0"]) expect(under).toContain(d);
    // Watching, the box keeps the place where it and its line's room sit in the middle, whatever the agent's steps and
    // a banner under it take: the room over it no more than that, none given to the room under it.
    const watching = ".cmp-dialog:not(.is-screen-only) > .cmp-body:has(.dsk-line):not(:has(> .dsk.is-control))";
    expect(inSheet(`${watching}::before`)).toContain(
      "max-height: calc((100cqh - 100cqw * 900 / 1280 - 8px - var(--cmp-line) + 4px) / 2)",
    );
    expect(inSheet(`${watching}::after`)).toContain("flex-grow: 0");
    // The body's gap next to each, taken back: neither adds a gap of its own.
    expect(over).toContain("margin-bottom: -8px");
    expect(under).toContain("margin-top: -8px");
    expect(rule(text, ".cmp-body")).toContain("gap: 8px");
    expect(sheet).not.toContain("margin-top: max(0px");
    expect(inSheet(".cmp-dialog:not(.is-screen-only) .dsk > .dsk-stage")).toContain("order: -1");
    expect(inSheet(".cmp-dialog:not(.is-screen-only) .cmp-body > .cmp-banner")).toContain("order: 1");
    // The phone's keyboard up, the screen rises to the sheet's top, over it; with less motion asked, it moves at once.
    const keyboard = text.split("@media (max-width: 720px) and (pointer: coarse) {")[1]?.split("\n}\n")[0] ?? "";
    expect(keyboard).toContain(
      "\n  .cmp-dialog:not(.is-screen-only) > .cmp-body:has(:is(.dsk-keys, .brw-ac__note):focus)::before {\n    flex-grow: 0;\n  }",
    );
    const glide = text.split("@media (max-width: 720px) and (prefers-reduced-motion: no-preference) {")[1] ?? "";
    expect(glide.split("\n}\n")[0]).toContain("transition: flex-grow 0.2s var(--out)");
    // The agent's page starts at its stage's top: its tools coming under it move nothing.
    expect(sheet).toContain("\n  .cmp-body > .brw-ac.is-surface .brw-ac__stage {\n    place-items: start center;\n  }");
    // With no steps, the line under the screen takes no room on the sheet.
    expect(inSheet(".cmp-steps-row:empty")).toContain("display: none");
    // In the window's frame the screen keeps its shape, centred in its stage.
    expect(rule(text, ".cmp-body .dsk-stage,\n.cmp-body > .cmp-stage")).toContain("place-items: center");
  });

  test("the window's foot is as deep as its sides: under the screen and the covers it opens from the line has words, the wait and a cover that stays take its room", async () => {
    const text = await css();
    // The line steps aside where it would be empty, and over the wait and a cover that stays even with steps; with
    // steps, the steps say it and the notice waits.
    expect(
      rule(
        text,
        ".cmp-body:has(> .dsk) > .cmp-steps-row:empty,\n.cmp-body:has(> :is(.cmp-stage, .cmp-prep, .dsk.is-final)) > .cmp-steps-row,\n.cmp-body:has(> .cmp-steps-row > .cmp-steps) > .dsk:not(.is-control) > .dsk-line",
      ),
    ).toContain("display: none");
    // Under a cover the screen's box is its whole stage, so the frost or the sky never shows the page round it.
    const covered = rule(
      text,
      '.cmp-body > .cmp-stage > .cmp-stage__box,\n.cmp-body > .dsk:not([data-state="live"]) .dsk-screen',
    );
    for (const d of ["place-self: stretch", "width: auto", "aspect-ratio: auto", "contain: size"]) {
      expect(covered).toContain(d);
    }
    // A cover's words and a fix to run there keep to its width: the command scrolls in its own block.
    expect(rule(text, ".cmp-body .brw-dim")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(text, ".cmp-body .brw-dim__box")).toContain("max-width: min(420px, 100% - 32px)");
    expect(rule(text, ".cmp-body .brw-dim__box > *")).toContain("max-width: 100%");
    // A tablet's line is as tall as the room the frame keeps for it, watching or in control, its words on its middle
    // where no Keyboard button leads them, as the steps are in its place: (40 − 22) / 2, nothing on a 22 px line.
    const desk = await Bun.file(new URL("../src/components/desktop/desktop.css", import.meta.url).pathname).text();
    const frame = desk.split("@media (min-width: 721px) {")[1]?.split("\n}\n")[0] ?? "";
    const inFrame = (selector: string) => frame.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    expect(inFrame(".cmp-dialog:not(.is-screen-only) .dsk-line")).toContain("min-height: var(--cmp-line)");
    const middle = "margin-top: calc((var(--cmp-line) - 22px) / 2)";
    expect(inFrame(".cmp-dialog:not(.is-screen-only) .dsk-line > :first-child:not(.ac-btn)")).toContain(middle);
    const wide = text.split("\n@media (min-width: 721px) {").slice(1).join("");
    expect(wide.split("\n  .cmp-body:has(> .dsk) > .cmp-steps-row > .cmp-steps {")[1]?.split("}")[0]).toContain(middle);

    // Opening, live and watching: what programs there can see, the screen opening where its cover was, without the ⓘ
    // (what may be checked in control), which comes with control.
    const t = await dialog(RUNNING, true);
    expect(screen().getByText("Abrindo o computador da Ada…")).toBeTruthy();
    expect(line()).toBe(WATCHING);
    await connected();
    expect(line()).toBe(WATCHING);
    expect(document.querySelector(".dsk-line .ac-hint")).toBeNull();
    expect(document.querySelector(".dsk-line > .dsk-words > .muted")).toBeTruthy();
    // In control the same words make the line, the ⓘ after them.
    await click(view().getByRole("button", { name: "Assumir o controle" }));
    await settle(4);
    await connected();
    expect([...document.querySelectorAll(".dsk-line > .dsk-words .muted")].map((m) => m.textContent)).toEqual([
      "Os programas do computador da Ada veem a tela e o que você digita ou cola.",
    ]);
    expect(document.querySelector(".dsk-line .ac-hint")).toBeTruthy();
    expect(t.sockets.desktops.length).toBeGreaterThan(1);
  });

  test("watching in full screen the screen floats alone: no line under it, nothing to keep a frame for", async () => {
    fullScreen();
    await dialog();
    await connected();
    expect(line()).toBe(WATCHING);
    await click(view().getByRole("button", { name: "Tela cheia" }));
    expect(classes()).toContain("is-screen-only");
    expect(document.querySelector(".dsk-line")).toBeNull();
  });

  test("the head's row stands one gap between what shows: the close and full screen reach out by their glyphs' air", async () => {
    // Full screen's arrows leave 2.7 of their icon's 20 units on each side; the dialog's × (the kit's) 5.2.
    const text = await css();
    expect(rule(text, ".cmp-acts > .cmp-full")).toContain("--glyph-air: calc(var(--control-icon-sm) * 2.7 / 20)");
    const kit = await Bun.file(
      new URL("../../../packages/ui/src/styles/components.css", import.meta.url).pathname,
    ).text();
    expect(rule(kit, ".ac-dialog__close > .ac-btn--glyph")).toContain(
      "--glyph-air: calc(var(--control-icon-sm) * 5.2 / 20)",
    );
    // The kit reaches out by that air; its plate and ring keep to the box less it on every side, a square under the
    // glyph, so they end where a neighbour's plate starts.
    expect(rule(kit, ".ac-acts > .ac-btn--glyph")).toContain(
      "margin-inline: calc(-1 * (var(--ghost-plate) + var(--glyph-air, 0px)))",
    );
    expect(rule(kit, ".ac-btn--ghost.ac-btn--glyph::before")).toContain("inset: var(--glyph-air, 0px)");
    expect(rule(kit, ".ac-btn--ghost.ac-btn--glyph > *")).toContain("position: relative");
    expect(rule(kit, ".ac-btn--ghost.ac-btn--glyph:hover::before")).toContain("background: var(--plate)");
    // Rings only for the keys (`trackInput`): with the pointer, a focused button looks as it does unfocused.
    expect(rule(kit, "html:not([data-pointer]) .ac-btn--ghost.ac-btn--glyph:focus-visible::before")).toContain(
      "box-shadow: var(--focus-ring)",
    );
    expect(rule(kit, "html:not([data-pointer]) .ac-btn--ghost.ac-btn--glyph:focus-visible")).toContain(
      "box-shadow: none",
    );
    await dialog();
    await connected();
    expect(view().getByRole("button", { name: "Tela cheia" }).className).toContain("cmp-full ac-btn--glyph");
    expect(view().getByRole("button", { name: "Fechar" }).classList.contains("ac-btn--glyph")).toBe(true);
  });

  test("Take control's icon keeps the pill's padding by its ink, on its words' capitals' middle", async () => {
    const kit = await Bun.file(
      new URL("../../../packages/ui/src/styles/components.css", import.meta.url).pathname,
    ).text();
    // The kit's button reaches a leading icon out by the air its drawing leaves before it and lifts it as far as asked.
    // Unset, the icon's box places it, and at no weight, so any rule of a page's own still wins.
    const lead = rule(kit, ":where(.ac-btn > .ac-icon:first-child, .ac-btn > .ac-swap > * > .ac-icon:first-child)");
    expect(lead).toContain("margin-inline-start: calc(-1 * var(--lead-air))");
    expect(lead).toContain("translate: 0 calc(-1 * var(--lead-rise))");
    // One move only: the build's minifier drops a `translate` declared beside a `transform`.
    expect(lead).not.toContain("transform");
    // The drawing's own air and middle (20 units, half the 1.6 stroke round it): its ink from 3.4, its middle at 10.4.
    // A new drawing asks for new numbers here.
    expect(icons.person).toEqual([
      ["circle", { cx: "10", cy: "7", r: "3.2" }],
      ["path", { d: "M4.2 17c.7-3 3-4.6 5.8-4.6s5.1 1.6 5.8 4.6" }],
    ]);
    const text = await css();
    const take = rule(text, ".cmp-acts > .cmp-take");
    expect(take).toContain("--lead-air: calc(var(--control-icon-sm) * 3.4 / 20)");
    expect(take).toContain("--lead-rise: calc(var(--control-icon-sm) * 0.4 / 20 + var(--cap-mid))");
    await dialog();
    await connected();
    expect(view().getByRole("button", { name: "Assumir o controle" }).classList.contains("cmp-take")).toBe(true);
  });

  test("the head's controls sit on the name's capitals in every state, as every dialog's close does", async () => {
    const text = await css();
    const head = rule(text, ".cmp-dialog :is(.ac-dialog__acts, .ac-dialog__close)");
    expect(head).toContain("align-self: flex-start");
    // The name's 24 px line round a 32 px control (40 on touch), lifted to its capitals' middle as the kit lifts a
    // one-line head's, whatever the line under the name says, or while it says nothing.
    expect(head).toContain("margin-top: calc((24px - var(--cmp-button)) / 2 - var(--title-cap-mid, var(--cap-mid)))");
    const kit = await Bun.file(
      new URL("../../../packages/ui/src/styles/components.css", import.meta.url).pathname,
    ).text();
    expect(rule(kit, ".ac-dialog__title")).toContain("line-height: 24px");
    expect(
      rule(kit, ".ac-dialog__title + .ac-dialog__acts,\n.ac-actline:has(> .ac-dialog__title) + .ac-dialog__close"),
    ).toContain("translate: 0 calc(-1 * var(--title-cap-mid, var(--cap-mid)))");
    // The line under the name keeps its room while empty, so the name and the controls stay where they are.
    expect(rule(text, ".cmp-sub:empty::before")).toContain('content: "\\00a0"');
    // Full screen's bar is its own box: the controls in its middle, beside both lines (the kit's 24 + 18 px).
    expect(rule(text, ".cmp-dialog.is-screen-only :is(.ac-dialog__acts, .ac-dialog__close)")).toContain(
      "margin-top: calc((24px + 18px - var(--cmp-button)) / 2)",
    );
    expect(rule(kit, ".ac-dialog__sub")).toContain("line-height: 18px");
  });

  test("the head's gaps read even by what shows: Take control's ring and shadow get their room", async () => {
    // A raised button shows past its box (the default's ring); the glyphs beside it don't.
    const text = await css();
    expect(rule(text, ".cmp-acts > .cmp-take")).toContain("margin-inline: 1.5px");
    const tokens = await Bun.file(
      new URL("../../../packages/ui/src/styles/tokens.css", import.meta.url).pathname,
    ).text();
    expect(tokens).toContain("0 0 0 1px var(--line)");
  });

  test("what comes over or under the screen takes the screen's room, never the window's", async () => {
    const text = await css();
    expect(text).toContain(".ac-dialog.cmp-dialog {\n  --cmp-button: var(--control-h-sm);\n  --cmp-line: 22px;\n}");
    // Its head's small buttons keep their 32 px plates on touch too.
    expect(text).not.toContain("@media (pointer: coarse) {\n  .ac-dialog.cmp-dialog {\n    --cmp-button:");
    // A banner, the request and the hand-back bar sit in the body's column with the screen's stage, which gets what they leave
    // and shrinks the screen inside it, keeping its shape.
    const column = rule(text, ".cmp-body > .dsk");
    expect(column).toContain("flex: 1 1 0");
    expect(column).toContain("min-height: 0");
    expect(rule(text, ".cmp-body .dsk-stage,\n.cmp-body > .cmp-stage")).toContain("container-type: size");
    // The window has them where that column holds them: the request over the screen, the bar under its line.
    const t = await controlled();
    const body = () => document.querySelector(".ac-dialog.cmp-dialog > .cmp-body");
    expect(body()?.querySelector(":scope > .dsk > .dsk-line + .brw-ac__back")).toBeTruthy();
    expect(t.sockets.desktops.length).toBeGreaterThan(0);
  });

  test("the agent's page keeps its tools' room under it in every state, so taking control moves it nowhere", async () => {
    const text = await css();
    // The 48 px field and the 8 px over it, the line's place in control, taken from the page's stage: the window keeps
    // the screen's size, so nothing moves when the page opens after a cover either.
    const room = text.split("@media (min-width: 721px) {\n  .cmp-body:has(> .brw-ac.is-surface) > .cmp-steps-row {")[1];
    expect(room?.split("}")[0]).toContain("height: calc(var(--control-h-lg) + 8px)");
    expect(text).not.toContain("is-surface) {\n  --cmp-line");
    expect(rule(text, ".cmp-body .brw-ac__foot")).toContain("padding: 8px 0 0");
    const browser = await Bun.file(new URL("../src/components/browser/browser.css", import.meta.url).pathname).text();
    expect(rule(browser, ".brw-tfield")).toContain("height: var(--control-h-lg)");
  });

  test("the desktop app: the window centres in the work area under its title bar", async () => {
    const text = await css();
    const app = text.split(
      "@media (min-width: 721px) {\n  html[data-desktop] .ac-dialog.cmp-dialog:not(.is-full) {",
    )[1];
    expect(app?.split("}")[0]).toContain("--cmp-bar: var(--titlebar-h)");
    expect(app?.split("}")[0]).toContain("top: calc(50% + var(--titlebar-h) / 2)");
    const desktop = await Bun.file(new URL("../src/desktop.css", import.meta.url).pathname).text();
    expect(desktop).toContain("--titlebar-h: calc(48px / var(--app-zoom, 1))");
  });

  test("the desktop app: the ⌘K field stands midway between the window's edge and the work's sheet", async () => {
    const desktop = await Bun.file(new URL("../src/desktop.css", import.meta.url).pathname).text();
    const layout = await Bun.file(new URL("../src/layout.css", import.meta.url).pathname).text();
    // A 32px field centred in the 48px bar: 8px over it and 8px under it, the sheet starting right under the bar.
    expect(desktop).toContain("--titlebar-h: calc(48px / var(--app-zoom, 1))");
    expect(desktop.split("\n.titlebar__search {")[1]?.split("}")[0]).toContain("height: var(--control-h-sm)");
    expect(layout.split("\n.shell__work {")[1]?.split("}")[0]).toContain("padding: 8px 8px 8px 0");
    const wide = desktop.split("@media (min-width: 761px) {\n  html[data-desktop] .titlebar {")[1]?.split("\n}\n")[0];
    expect(wide).toContain("html[data-desktop] .shell__work {\n    padding-top: 0;");
  });

  test("a tablet keeps room for the Keyboard button: watching or in control, one screen size", async () => {
    const text = await css();
    const tablet = text.split("@media (pointer: coarse) and (min-width: 721px) {")[1] ?? "";
    const inTablet = (selector: string) => tablet.split(`\n  ${selector} {`)[1]?.split("}")[0] ?? "";
    // The line under the screen is as tall as the small button it holds in control, in every state, so the frame
    // (which reads it) is the same watching or in control, and the steps' line takes that room too.
    expect(inTablet(".ac-dialog.cmp-dialog")).toContain("--cmp-line: var(--control-h-sm)");
    expect(tablet.split("\n}\n")[0]).not.toContain("height:");
    // After the line's own value, which it outweighs at the same weight.
    expect(text.indexOf("@media (pointer: coarse) and (min-width: 721px)")).toBeGreaterThan(
      text.indexOf("--cmp-line: 22px"),
    );
  });

  test("the picture held over a hand back is only a picture: the pointer goes through it", async () => {
    const desk = await Bun.file(new URL("../src/components/desktop/desktop.css", import.meta.url).pathname).text();
    expect(rule(desk, ".dsk-screen > .dsk-still")).toContain("pointer-events: none");
  });

  test("a note to the agent: one line in the middle of its field, growing up to four, with no grip", async () => {
    const brw = await Bun.file(new URL("../src/components/browser/browser.css", import.meta.url).pathname).text();
    const note = rule(brw, ".brw-ac__note.ac-input");
    expect(note).toContain("resize: none");
    expect(note).toContain("max-height: 110px");
  });

  test("full screen on the agent's screen: the screen alone on its ground, what floats over it hidden after a while", async () => {
    const text = await css();
    const dialog = rule(text, ".ac-dialog.cmp-dialog.is-screen-only");
    expect(dialog).toContain("display: grid");
    expect(dialog).toContain("background: var(--screen-bg)");
    const stage = rule(text, ".cmp-dialog.is-screen-only .dsk-stage");
    // The screen ends over the hand-back bar's row: the bar never covers its foot.
    expect(dialog).toContain("grid-template: auto auto auto auto 1fr auto / minmax(0, 1fr)");
    expect(stage).toContain("grid-area: 1 / 1 / 6 / -1");
    expect(rule(text, ".cmp-dialog.is-screen-only .brw-ac__back")).toContain("grid-area: 6 / 1");
    expect(stage).toContain("container-type: size");
    expect(rule(text, ".cmp-dialog.is-screen-only .dsk-screen")).toContain("width: min(100cqw, 100cqh * 1280 / 900)");
    // The ground is the screen's own in both themes: one token, no dark value of its own.
    const tokens = await Bun.file(
      new URL("../../../packages/ui/src/styles/tokens.css", import.meta.url).pathname,
    ).text();
    expect(tokens.match(/--screen-bg: #1f2128;/g)).toHaveLength(1);
  });

  test("the bar over the full screen: what hides with it, what keeps it, and over any cover", async () => {
    const text = await css();
    // The head hides with it; the request and the line under it also while the head alone came back.
    const hide = rule(
      text,
      ".cmp-dialog.is-bar-hidden > .ac-dialog__head,\n.cmp-dialog.is-line-hidden :is(.cmp-asked, .dsk-line)",
    );
    expect(hide).toContain("opacity: 0");
    expect(hide).toContain("pointer-events: none");
    // Sliding up as it fades, which reduced motion keeps to the fade.
    expect(hide).toContain("translate: 0 var(--bar-slide, -8px)");
    expect(text).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.cmp-dialog\.is-screen-only \{\s*--bar-slide: 0px;/,
    );
    // A banner or the computer's copy waiting for the person keeps it, and so does focus a key put there; not the
    // focus a click leaves on the button it pressed.
    const keeps =
      ".cmp-dialog:has(.cmp-banner, .dsk-got, .ac-dialog__head :focus-visible) :is(.ac-dialog__head, .cmp-asked, .dsk-line)";
    const keep = rule(text, keeps);
    expect(keep).toContain("opacity: 1");
    expect(keep).toContain("translate: none");
    expect(keep).toContain("pointer-events: auto");
    // What the clipboard just did shows the line alone for a moment, after the rule that hides it at the same weight.
    const said = rule(text, ".cmp-dialog:has(.dsk-said) .dsk-line");
    expect(said).toContain("opacity: 1");
    expect(said).not.toContain("pointer-events");
    expect(text.indexOf("\n.cmp-dialog:has(.dsk-said) .dsk-line {")).toBeGreaterThan(
      text.indexOf(
        "\n.cmp-dialog.is-bar-hidden > .ac-dialog__head,\n.cmp-dialog.is-line-hidden :is(.cmp-asked, .dsk-line) {",
      ),
    );
    // An action that failed brings the bar back, its buttons live, while the head says so.
    const failed = rule(text, ".cmp-dialog:has(.cmp-said) > .ac-dialog__head");
    expect(failed).toContain("opacity: 1");
    expect(failed).toContain("pointer-events: auto");
    expect(text.indexOf("\n.cmp-dialog:has(.cmp-said) > .ac-dialog__head {")).toBeGreaterThan(
      text.indexOf("\n.cmp-dialog.is-bar-hidden > .ac-dialog__head,"),
    );
    expect(text).not.toContain(":focus-within");
    // A cover over the screen (z-index 5) stays in the screen's own layer, under the bar.
    expect(rule(text, ".cmp-dialog.is-screen-only .dsk-stage")).toContain("isolation: isolate");
  });
});

describe("the person's clipboard", () => {
  test("is never read in the computer dialog: only a paste they make gives it", async () => {
    const dir = new URL("../src/components/", import.meta.url).pathname;
    const files = [...new Bun.Glob("{desktop,computer}/**/*.{ts,tsx}").scanSync({ cwd: dir })];
    expect(files.length).toBeGreaterThan(5);
    const reads: string[] = [];
    for (const file of files) {
      if (/clipboard\s*\??\.\s*read/.test(await Bun.file(dir + file).text())) reads.push(file);
    }
    expect(reads).toEqual([]);
  });
});

describe("watching offers control after deliberate interaction", () => {
  const prompt = () => document.querySelector(".dsk-ask") as HTMLElement | null;
  const press = () => act(async () => fireEvent.pointerDown(rfb().canvas, { pointerType: "mouse", button: 0 }));
  test("a first screen click offers control without passing input; Escape dismisses before closing", async () => {
    const t = await dialog();
    await connected();
    await press();
    await settle(3);
    expect(prompt()).not.toBeNull();
    // Dimmed, not frosted: the screen stays in sight under the question.
    expect(prompt()?.classList.contains("is-clear")).toBe(true);
    // Stacked: the title, take control, then Cancelar under it.
    const acts = prompt()?.querySelector(".brw-dim__box > .brw-dim__acts");
    expect(acts?.previousElementSibling?.classList.contains("brw-dim__row")).toBe(true);
    expect([...(acts?.children ?? [])].map((b) => b.textContent)).toEqual(["Assumir o controle", "Cancelar"]);
    expect(rfb().viewOnly).toBe(true);
    expect(rfb().log).toEqual([]);
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    await settle(3);
    expect(prompt()).toBeNull();
    expect(t.closed()).toBe(0);
    // The next try asks again.
    await press();
    await settle(2);
    expect(prompt()).not.toBeNull();
  });
  test("the question stays through more clicks, on the screen and on its dim; Cancelar closes it", async () => {
    await dialog();
    await connected();
    await press();
    await settle(2);
    await press();
    await act(async () => fireEvent.pointerDown(prompt() as HTMLElement, { pointerType: "mouse", button: 0 }));
    await settle(2);
    expect(prompt()).not.toBeNull();
    await click(within(prompt() as HTMLElement).getByRole("button", { name: "Cancelar" }));
    expect(prompt()).toBeNull();
    expect(rfb().log).toEqual([]);
    await press();
    await settle(2);
    expect(prompt()).not.toBeNull();
  });
  test("a key or a paste on the focused screen asks, sends nothing, and leaves shortcuts to the browser", async () => {
    await dialog();
    await connected();
    const stage = document.querySelector(".dsk-stage") as HTMLElement;
    // A click on the screen puts the keys there.
    await press();
    expect(document.activeElement === stage).toBe(true);
    await click(within(prompt() as HTMLElement).getByRole("button", { name: "Cancelar" }));
    stage.focus();
    /** Whether the key is left to the browser (not taken to ask). */
    const key = async (init: KeyboardEventInit) => {
      let left = true;
      await act(async () => {
        left = fireEvent.keyDown(stage, init);
      });
      await settle(1);
      return left;
    };
    for (const init of [{ key: "a", ctrlKey: true }, { key: "l", metaKey: true }, { key: "F5" }, { key: "Shift" }])
      expect([init.key, await key(init), prompt()]).toEqual([init.key, true, null]);
    // Tab moves the focus (the dialog keeps it inside): it never asks.
    await key({ key: "Tab" });
    expect(prompt()).toBeNull();
    for (const init of [{ key: "a" }, { key: " " }, { key: "Enter" }, { key: "ArrowDown" }]) {
      expect([init.key, await key(init), prompt() !== null]).toEqual([init.key, false, true]);
      await click(within(prompt() as HTMLElement).getByRole("button", { name: "Cancelar" }));
      stage.focus();
    }
    // A paste (its keys, or the browser's own paste event) asks too.
    expect(await key({ key: "Insert", shiftKey: true })).toBe(false);
    expect(prompt()).not.toBeNull();
    await click(within(prompt() as HTMLElement).getByRole("button", { name: "Cancelar" }));
    stage.focus();
    await act(async () => void fireEvent.paste(stage, { clipboardData: { getData: () => "segredo" } }));
    await settle(1);
    expect(prompt()).not.toBeNull();
    expect(rfb().log).toEqual([]);
  });
});

test("confirming the watching prompt takes control once and never replays the first click", async () => {
  const t = await dialog();
  await connected();
  const watching = rfb();
  await act(async () => fireEvent.pointerDown(watching.canvas, { pointerType: "mouse", button: 0 }));
  await settle(3);
  const prompt = document.querySelector(".dsk-ask") as HTMLElement;
  await click(within(prompt).getByRole("button", { name: "Assumir o controle" }));
  await connected();
  expect(calls(t, "browser.takeover")).toEqual([[ORG_ID, ADA_ID, "desktop"]]);
  expect(document.querySelector(".dsk-ask")).toBeNull();
  expect(watching.log).toEqual([]);
  expect(rfb().log).toEqual([]);
});

test("a touch scroll does not offer control; a later tap does", async () => {
  await dialog();
  await connected();
  const canvas = rfb().canvas;
  await act(async () => {
    fireEvent.pointerDown(canvas, { pointerType: "touch", clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 30, clientY: 80 });
  });
  await settle(2);
  expect(document.querySelector(".dsk-ask")).toBeNull();
  await act(async () => {
    fireEvent.pointerDown(canvas, { pointerType: "touch", clientX: 30, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerType: "touch", clientX: 32, clientY: 31 });
  });
  await settle(3);
  expect(document.querySelector(".dsk-ask")).not.toBeNull();
  expect(rfb().log).toEqual([]);
});

test("shortcuts and typing into a field never offer control; a letter anywhere else in the dialog does", async () => {
  await dialog();
  await connected();
  const ask = () => document.querySelector(".dsk-ask");
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "a", metaKey: true });
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.keyDown(document.body, { key: "a", isComposing: true });
  });
  await settle(2);
  expect(ask()).toBeNull();
  const input = document.createElement("input");
  document.body.appendChild(input);
  try {
    await act(async () => {
      input.focus();
      fireEvent.keyDown(input, { key: "a" });
    });
    await settle(2);
    expect(ask()).toBeNull();
  } finally {
    input.remove();
  }
  // A button of the dialog keeps its Enter and Space; a letter typed on it asks, and so does one on the page.
  const button = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(
    (b) => !b.closest(".dsk-stage"),
  ) as HTMLElement;
  await act(async () => {
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: " " });
  });
  await settle(2);
  expect(ask()).toBeNull();
  await act(async () => void fireEvent.keyDown(button, { key: "a" }));
  await settle(2);
  expect(ask()).not.toBeNull();
  // Cancelar goes, its focus back on the screen: the next key asks again.
  await click(within(ask() as HTMLElement).getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement === document.querySelector(".dsk-stage")).toBe(true);
  await act(async () => void fireEvent.keyDown(document.body, { key: "b" }));
  await settle(2);
  expect(ask()).not.toBeNull();
  expect(rfb().log).toEqual([]);
});

test("a connection quality change adjusts the active screen without reopening its socket", async () => {
  const network = new EventTarget() as EventTarget & { effectiveType: string; downlink: number; saveData: boolean };
  Object.assign(network, { effectiveType: "4g", downlink: 10, saveData: false });
  replaceOn(navigator, "connection", network);
  const t = await dialog();
  await connected();
  const active = rfb();
  const count = t.sockets.desktops.length;
  expect(active.qualityLevel).toBe(3);
  await act(async () => {
    network.saveData = true;
    network.dispatchEvent(new Event("change"));
  });
  expect(active.qualityLevel).toBe(1);
  expect(active.compressionLevel).toBe(6);
  expect(t.sockets.desktops).toHaveLength(count);
  expect(rfb()).toBe(active);
});

describe("a browser card's view of the screen (ADR 0058 §7)", () => {
  async function card() {
    const b = await backend(RUNNING);
    const states: DesktopViewState[] = [];
    const onView = (state: DesktopViewState) => void states.push(state);
    await renderPage(
      <DesktopView
        preview
        agentId={ADA_ID}
        name="Ada"
        computer="Servidor de casa"
        edition="selfhost"
        machine={b.machine}
        canTakeOver={false}
        onView={onView}
      />,
      { api: b.api, org: true, createSocket: b.sockets.factory },
    );
    await settle(6);
    return { ...b, states };
  }

  test("the whole screen, watching only: nothing to take, read or type under it, and its state goes to the card", async () => {
    const t = await card();
    const socket = t.sockets.desktops.at(-1) as DesktopSocket;
    expect(socket.url).toContain("preview=1&mode=watch");
    expect(socket.url).not.toContain("switch=1");
    expect(t.states.at(-1)).toBe("connecting");
    await connected();
    expect(t.states.at(-1)).toBe("live");
    expect(rfb().viewOnly).toBe(true);
    const root = document.querySelector(".dsk") as HTMLElement;
    expect(root.classList.contains("dsk--card")).toBe(true);
    // The card's own stage holds it: none of the dialog's.
    expect(root.querySelector(".brw-ac__stage")).toBeNull();
    expect(root.querySelector(".dsk-stage > .dsk-screen")).not.toBeNull();
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector(".dsk-keys")).toBeNull();
    expect(root.querySelector(".dsk-line")).toBeNull();
    // A click or a key on it asks nothing.
    const stage = root.querySelector(".dsk-stage") as HTMLElement;
    await act(async () => void fireEvent.pointerDown(stage));
    await act(async () => void fireEvent.keyDown(stage, { key: "a" }));
    await settle(2);
    expect(root.querySelector(".dsk-ask")).toBeNull();
    expect(rfb().log).toEqual([]);
  });

  test("a close it can't wait out ends it at once: the card shows the frames, no socket opens again", async () => {
    const t = await card();
    await connected();
    const count = t.sockets.desktops.length;
    await act(async () => (t.sockets.desktops.at(-1) as DesktopSocket).serverClose(4429, "preview_yield"));
    await settle(4);
    expect(t.states.at(-1)).toBe("busy");
    await act(() => new Promise((r) => setTimeout(r, 1_200)));
    expect(t.sockets.desktops).toHaveLength(count);
  });
});
