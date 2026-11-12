import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import type { AgentComputer, Machine } from "@agenteschat/client";
import { ApiError, applyComputerEvent, applyMachineEvent, keys } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { fileIcon, formatBytes, MAX_UPLOAD_BYTES, previewKind } from "@agenteschat/client/lib/files";
import { taskNoticeOf } from "@agenteschat/client/lib/missions";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { fileSaver } from "@/components/artifacts/ArtifactViewer";
import { objectUrls } from "@/components/artifacts/FileView";
import { createI18n } from "@/i18n";
import { ADA_ID, createFakeApi, ENG_ID, fakeMachinesOf, ORG_ID, seedState } from "./fake-api";
import { hintOf, shownText } from "./hint";
import { renderApp, screen, settle, showIn } from "./render";

const saved: { url: string; name: string }[] = [];
const realSave = fileSaver.save;
const realCreate = objectUrls.create;
const realRevoke = objectUrls.revoke;
let urls = 0;
beforeAll(() => {
  fileSaver.save = (url, name) => {
    saved.push({ url, name });
  };
  objectUrls.create = () => `blob:preview-${++urls}`;
  objectUrls.revoke = () => {};
});
afterAll(() => {
  fileSaver.save = realSave;
  objectUrls.create = realCreate;
  objectUrls.revoke = realRevoke;
});
afterEach(() => {
  cleanup();
  saved.length = 0;
  Reflect.deleteProperty(navigator, "userAgent");
});

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
/** The page as a browser on that system opens it (the test DOM's own user agent comes back after each test). */
const asBrowserOn = (ua: string) => Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });

const click = (el: Element) => act(async () => fireEvent.click(el));
const type = (el: Element, value: string) => act(async () => fireEvent.change(el, { target: { value } }));
const key = async (el: Element, k: string) => {
  await act(async () => {
    fireEvent.keyDown(el, { key: k });
    fireEvent.keyUp(el, { key: k });
  });
  await act(() => new Promise((r) => setTimeout(r, 0)));
};
const openMenu = async (trigger: HTMLElement) => {
  trigger.focus();
  await key(trigger, "Enter");
  return screen().getByRole("menu");
};
/** Picks files in a hidden file input. */
const choose = (input: Element, files: File[]) => act(async () => fireEvent.change(input, { target: { files } }));
const png = (name = "grafico.png") =>
  new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], name, { type: "image/png" });
const orgEvent = (event: Record<string, unknown>) => ({ type: "event", scope: "org", event });

describe("uploaded files in the Drive", () => {
  test("an image: icon, name, size, Baixar, and an inline preview from the download", async () => {
    const api = createFakeApi(seedState());
    const file = await api.artifacts.upload(ORG_ID, png());
    await renderApp(`/org/${ORG_ID}/drive?artifact=${file.id}`, { api });
    await settle(8);
    const dialog = screen().getByRole("dialog", { name: "grafico.png" });
    expect(dialog.textContent).toContain("Arquivo");
    expect(dialog.querySelector(".ac-details__subtitle")?.textContent).toMatch(/7\s?(byte|B)/);
    // The picture stays hidden (and nameless) until it has loaded and been fitted: its stage carries the name.
    const img = within(dialog).getByRole("group", { name: "Imagem: grafico.png" }).querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^blob:preview-/);
    // Text kinds' Editar never shows for files; Baixar saves the original with its name.
    expect(within(dialog).queryByRole("button", { name: "Editar" })).toBeNull();
    await click(within(dialog).getByRole("button", { name: "Baixar" }));
    expect(saved[0]).toEqual({
      url: `/api/app/organizations/${ORG_ID}/artifacts/${file.id}/file?version=1`,
      name: "grafico.png",
    });
  });

  test("in a chat card: an image shows its thumbnail (opens the viewer); other files show name, size and Baixar", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const image = await api.artifacts.upload(ORG_ID, png("contato.jpg"));
    const zip = await api.artifacts.upload(
      ORG_ID,
      new File([new Uint8Array([80, 75, 3, 4])], "carrossel.zip", { type: "application/zip" }),
    );
    const base = state.messages[0] as (typeof state.messages)[number];
    state.messages.push({
      ...base,
      id: "m-files",
      threadId: null,
      body: "Aqui estão os arquivos.",
      mentionedAgentIds: [],
      meta: {
        artifacts: [
          { id: image.id, version: 1 },
          { id: zip.id, version: 1 },
        ],
      },
      createdAt: new Date().toISOString(),
    });
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(10);
    // Both are tiles of one size side by side in the message: the picture as its cover, the zip its type.
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".artifact-cards > .artifact-tile"));
    expect(tiles).toHaveLength(2);
    const [thumb, row] = tiles as [HTMLElement, HTMLElement];
    expect(thumb.querySelector(".artifact-tile__picture img")?.getAttribute("src")).toMatch(/^blob:preview-/);
    // A picture is only the picture (its name and size are in its tip and the viewer's header, below).
    expect(thumb.querySelector(".artifact-tile__foot")).toBeNull();
    expect(row.querySelector(".artifact-tile__title")?.textContent).toBe("carrossel.zip");
    expect(row.querySelector(".artifact-tile__type")?.textContent).toBe("ZIP");
    expect(row.querySelector(".artifact-tile__meta")?.textContent).toMatch(/^ZIP · /);
    await click(within(row).getByRole("button", { name: "Baixar" }));
    expect(saved.at(-1)).toEqual({
      url: `/api/app/organizations/${ORG_ID}/artifacts/${zip.id}/file?version=1`,
      name: "carrossel.zip",
    });
    await click(within(thumb).getByRole("button", { name: "Abrir contato.jpg" }));
    await settle(4);
    expect(screen().getByRole("dialog", { name: "contato.jpg" })).toBeTruthy();
  });

  test("pictures side by side are only the pictures: each name and size in its tip and in the viewer (#51)", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const long = "IMG_20250914_183022_HDR_portrait_edited_edited.HEIC";
    const pictures = await Promise.all(
      [long, "depoimentos-desktop-pt.png", "banner.png", "foto.png"].map((name) =>
        api.artifacts.upload(ORG_ID, png(name)),
      ),
    );
    const report = "Relatorio_Financeiro_Consolidado_Q3_2025_versao_final_revisada.zip";
    const zip = await api.artifacts.upload(
      ORG_ID,
      new File([new Uint8Array([80, 75, 3, 4])], report, { type: "application/zip" }),
    );
    const base = state.messages[0] as (typeof state.messages)[number];
    state.messages.push({
      ...base,
      id: "m-pictures",
      threadId: null,
      body: "As fotos do evento.",
      mentionedAgentIds: [],
      meta: { artifacts: [...pictures, zip].map((p) => ({ id: p.id, version: 1 })) },
      createdAt: new Date().toISOString(),
    });
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(10);
    const tiles = Array.from(document.querySelectorAll<HTMLElement>(".artifact-cards > .artifact-tile[data-media]"));
    expect(tiles).toHaveLength(4);
    // No name or size drawn on either picture.
    for (const tile of tiles) expect(tile.querySelector(".artifact-tile__foot")).toBeNull();
    // A file beside them keeps its name under its cover, whole (it wraps, never ends in "…").
    const file = document.querySelector(".artifact-cards > .artifact-tile:not([data-media])");
    expect(file?.querySelector(".artifact-tile__title")?.textContent).toBe(report);
    expect(file?.querySelector(".artifact-tile__title")?.getAttribute("title")).toBeNull();
    const open = within(tiles[0] as HTMLElement).getByRole("button", { name: `Abrir ${long}` });
    // A screen reader hears its size as the button's description.
    expect(document.getElementById(open.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /^HEIC · 7\s?(byte|B)/,
    );
    // The keys' focus shows the name, whole, and the size in its tip.
    expect(document.querySelector(".ac-tip")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      open.focus();
    });
    expect(document.querySelector(".ac-tip.ac-msg__tip")?.textContent).toMatch(
      new RegExp(`^${long.replace(/\./g, "\\.")} · HEIC · 7\\s?(byte|B)`),
    );
    await act(async () => open.blur());
    expect(document.querySelector(".ac-tip")).toBeNull();
    // The viewer's header says both.
    await click(open);
    await settle(4);
    const dialog = screen().getByRole("dialog", { name: long });
    expect(dialog.querySelector(".ac-details__subtitle")?.textContent).toMatch(/7\s?(byte|B)/);
  });

  test("SVG and other types are download-only; small text files show their text, read-only", async () => {
    const api = createFakeApi(seedState());
    const svg = await api.artifacts.upload(
      ORG_ID,
      new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], "logo.svg", {
        type: "image/svg+xml",
      }),
    );
    const notes = await api.artifacts.upload(
      ORG_ID,
      new File(["linha 1\nlinha 2"], "notas.txt", { type: "text/plain" }),
    );
    await renderApp(`/org/${ORG_ID}/drive?artifact=${svg.id}`, { api });
    await settle(8);
    let dialog = screen().getByRole("dialog", { name: "logo.svg" });
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("iframe")).toBeNull();
    expect(dialog.textContent).toContain("Sem prévia para este tipo de arquivo.");
    cleanup();
    await renderApp(`/org/${ORG_ID}/drive?artifact=${notes.id}`, { api });
    await settle(8);
    dialog = screen().getByRole("dialog", { name: "notas.txt" });
    expect(dialog.querySelector(".file-view__text")?.textContent).toBe("linha 1\nlinha 2");
    expect(dialog.querySelector("textarea")).toBeNull();
  });

  test("a JSON file reads formatted in a code card, the text as written one press away", async () => {
    const api = createFakeApi(seedState());
    const raw = '{"status":"ok","checks":[{"id":"db","ms":12}]}';
    const file = await api.artifacts.upload(ORG_ID, new File([raw], "saude.json", { type: "application/json" }));
    await renderApp(`/org/${ORG_ID}/drive?artifact=${file.id}`, { api });
    await settle(8);
    const dialog = screen().getByRole("dialog", { name: "saude.json" });
    expect(dialog.querySelector(".file-view__text")).toBeNull();
    const code = () => dialog.querySelector(".code-card .code-card__code") as HTMLElement;
    expect(code().textContent).toBe(
      '{\n  "status": "ok",\n  "checks": [\n    {\n      "id": "db",\n      "ms": 12\n    }\n  ]\n}',
    );
    await click(within(dialog).getByRole("button", { name: "Original" }));
    expect(code().textContent).toBe(raw);
  });

  test("an upload keeps the original name, type and size, and is always untrusted", async () => {
    const api = createFakeApi(seedState());
    const file = await api.artifacts.upload(ORG_ID, png("mapa.png"));
    const detail = await api.artifacts.get(ORG_ID, file.id);
    expect(detail.content).toMatchObject({ kind: "file", name: "mapa.png", contentType: "image/png", size: 7 });
    expect(detail.untrusted).toBe(true);
  });

  test("Enviar arquivo: the picker uploads, the list updates and a toast offers Abrir", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    await renderApp(`/org/${ORG_ID}/drive`, { api });
    await settle(8);
    expect(screen().getByRole("button", { name: "Enviar arquivo" })).toBeTruthy();
    const input = document.querySelector("input[data-upload-input]") as HTMLInputElement;
    await choose(input, [png("vendas.png")]);
    await settle(6);
    expect(state.calls.find((c) => c.method === "artifacts.upload")?.args.slice(0, 2)).toEqual([ORG_ID, "vendas.png"]);
    expect(screen().getByText("“vendas.png” está no Drive.")).toBeTruthy();
    expect(screen().getByRole("button", { name: "vendas.png" })).toBeTruthy();
    await click(screen().getByRole("button", { name: "Abrir" }));
    await settle(6);
    expect(screen().getByRole("dialog", { name: "vendas.png" })).toBeTruthy();
  });

  test("over 50 MB: a translated message and nothing is sent", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    await renderApp(`/org/${ORG_ID}/drive`, { api });
    await settle(8);
    const big = png("video.png");
    Object.defineProperty(big, "size", { value: MAX_UPLOAD_BYTES + 1 });
    await choose(document.querySelector("input[data-upload-input]") as HTMLInputElement, [big]);
    await settle(4);
    expect(screen().getByRole("alert").textContent).toContain("“video.png” passa de 50 MB, o limite por arquivo.");
    expect(state.calls.some((c) => c.method === "artifacts.upload")).toBe(false);
  });

  test("dropping files on the Drive uploads them", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    await renderApp(`/org/${ORG_ID}/drive`, { api });
    await settle(8);
    const page = document.querySelector(".drive-drop") as HTMLElement;
    const dataTransfer = { types: ["Files"], files: [png("solto.png")], dropEffect: "none" };
    await act(async () => fireEvent.dragEnter(page, { dataTransfer }));
    expect(page.classList.contains("drive-drop--over")).toBe(true);
    expect(page.textContent).toContain("Solte para enviar ao Drive");
    await act(async () => fireEvent.drop(page, { dataTransfer }));
    await settle(6);
    expect(page.classList.contains("drive-drop--over")).toBe(false);
    expect(state.calls.find((c) => c.method === "artifacts.upload")?.args[1]).toBe("solto.png");
  });

  test("Enviar nova versão on a file I can edit", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const csv = (name: string) => new File(["a,b\n1,2\n"], name, { type: "text/csv" });
    const file = await api.artifacts.upload(ORG_ID, csv("vendas.csv"));
    await renderApp(`/org/${ORG_ID}/drive?artifact=${file.id}`, { api });
    await settle(8);
    const dialog = screen().getByRole("dialog", { name: "vendas.csv" });
    expect(within(dialog).getByRole("button", { name: "Enviar nova versão" })).toBeTruthy();
    await choose(dialog.querySelector("input[data-upload-input]") as HTMLInputElement, [csv("vendas-v2.csv")]);
    await settle(6);
    expect(state.calls.find((c) => c.method === "artifacts.uploadVersion")?.args.slice(0, 3)).toEqual([
      ORG_ID,
      file.id,
      "vendas-v2.csv",
    ]);
    expect(screen().getByText("Versão 2 salva.")).toBeTruthy();
    const history = within(screen().getByRole("dialog")).getByRole("navigation", { name: "Versões" });
    expect(within(history).getAllByRole("button")).toHaveLength(2);
  });
});

test("a picture (an agent's screenshot): a big viewer, its details in the header, no file card, no versions", async () => {
  const api = createFakeApi(seedState());
  const file = await api.artifacts.upload(ORG_ID, png("tela.png"));
  await renderApp(`/org/${ORG_ID}/drive?artifact=${file.id}`, { api });
  await settle(8);
  const dialog = screen().getByRole("dialog", { name: "tela.png" });
  expect(dialog.classList.contains("ac-details--xl")).toBe(true);
  // The title, its icon and details on the bar with the buttons, the size among the details.
  const bar = dialog.querySelector(".ac-details__bar") as HTMLElement;
  expect(bar.querySelector(".ac-details__title")?.textContent).toBe("tela.png");
  // Each fact whole (no-break spaces inside one): a narrow head breaks the line between facts.
  expect(bar.querySelector(".ac-details__subtitle")?.textContent).toBe(
    "Arquivo · Walter · sem\u00a0canal · agora · 7\u00a0bytes",
  );
  expect(within(bar).getByRole("button", { name: "Baixar" })).toBeTruthy();
  expect(dialog.querySelector(".file-view__head, .file-summary")).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Enviar nova versão" })).toBeNull();
  expect(within(dialog).queryByRole("navigation", { name: "Versões" })).toBeNull();
});

describe("Configurações → Dispositivos (self-host)", () => {
  const go = async (state = seedState()) => {
    const api = createFakeApi(state);
    const r = await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    const socket = r.sockets.last();
    await act(async () => socket.open());
    return {
      ...r,
      api,
      state,
      socket,
      machines: fakeMachinesOf.get(api) as NonNullable<ReturnType<typeof fakeMachinesOf.get>>,
    };
  };
  const row = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".dv-row")].find(
      (r) => r.querySelector(".dv-row__name")?.textContent === name,
    ) as HTMLElement;

  test("one section: one lead line, the devices and Connect a device", async () => {
    const { router } = await go();
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices`);
    const nav = screen().getByRole("navigation", { name: "Seções das configurações" });
    const links = within(nav)
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(links).toContain("Dispositivos");
    expect(links).not.toContain("Sandbox");
    const body = document.querySelector(".settings__body") as HTMLElement;
    expect(body.textContent).toContain(
      "Onde seus agentes trabalham: os computadores e celulares que as pessoas conectam.",
    );
    expect(body.textContent).not.toMatch(/Na nuvem|No seu computador|Computador na nuvem/);
    expect(screen().getByRole("button", { name: "Conectar um dispositivo" })).toBeTruthy();
    // Never internal names in the UI.
    expect(body.textContent).not.toMatch(/runner|MCP/i);
  });

  test("which computer each agent uses: picked here and saved at once; the counts follow", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const m = fakeMachinesOf.get(api)?.pair({ name: "Escritório", os: "darwin" }) as Machine;
    await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    const card = screen().getByRole("region", { name: "Qual computador cada agente usa" });
    const trigger = within(card).getByRole("combobox", { name: "Computador de Ada" });
    expect(trigger.textContent).toContain("Nenhum computador");
    trigger.focus();
    await act(async () => fireEvent.keyDown(trigger, { key: "Enter" }));
    await act(async () => fireEvent.click(screen().getByRole("option", { name: /^Escritório/ })));
    await settle(6);
    expect(state.calls.find((c) => c.method === "sandbox.setTarget")?.args).toEqual([ORG_ID, ADA_ID, m.id]);
    expect(document.body.textContent).toContain("Ada agora usa Escritório.");
    expect(within(card).getByRole("combobox", { name: "Computador de Ada" }).textContent).toContain("Escritório");
    // The row's portrait is the Mac's.
    expect(document.querySelector(".dv-row canvas.ac-computer")?.getAttribute("data-kind")).toBe("mac");
  });

  test("which computer each agent uses: this server's computer, before its runner names it, by what it is", async () => {
    const api = createFakeApi(seedState());
    const agents = [{ id: ADA_ID, name: "Ada", handle: "ada" }];
    fakeMachinesOf.get(api)?.pair({ name: "", kind: "host", agents });
    await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    const card = screen().getByRole("region", { name: "Qual computador cada agente usa" });
    const trigger = within(card).getByRole("combobox", { name: "Computador de Ada" });
    expect(trigger.textContent).toContain("Computador deste servidor");
  });

  test("members see each agent's computer but don't pick for agents they don't own", async () => {
    const state = seedState();
    if (state.me?.organizations[0]) state.me.organizations[0].role = "member";
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.pair({ name: "Escritório" });
    await renderApp(`/org/${ORG_ID}/settings/computers`, { api });
    await settle(8);
    const card = screen().getByRole("region", { name: "Qual computador cada agente usa" });
    expect(within(card).queryByRole("combobox")).toBeNull();
    expect(card.textContent).toContain("Nenhum computador");
  });

  test("download: Another computer offers the app for the system this page is open on, the other two in a small menu", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.setRelease({
      version: "0.2.0",
      url: "/api/desktop/download/0.2.0/agentes_0.2.0_aarch64.dmg",
      sha256: "",
      publishedAt: "2026-10-16T12:00:00.000Z",
    });
    asBrowserOn(MAC_UA);
    await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    await click(screen().getByRole("button", { name: "Conectar um dispositivo" }));
    await settle(4);
    await click(
      within(screen().getByRole("dialog", { name: "Conectar um dispositivo" })).getByText("Outro computador"),
    );
    await settle(4);
    const dialog = screen().getByRole("dialog", { name: "Conectar outro computador" });
    const download = within(dialog).getByRole("link", { name: "Baixar para macOS" });
    expect(download.getAttribute("href")).toBe(
      "http://localhost:3000/api/desktop/download/0.2.0/agentes_0.2.0_aarch64.dmg",
    );
    expect(within(dialog).getByRole("button", { name: "Outros sistemas" })).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/instalado|installed/i);
  });

  const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0";
  const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  /** Another computer's flow, on a browser on `ua`, with builds for Mac and Linux only (or `builds`). */
  const computerFlow = async (ua: string, api = createFakeApi(seedState()), builds = ["darwin", "linux"]) => {
    fakeMachinesOf.get(api)?.setRelease(
      {
        version: "0.6.0",
        url: "/api/desktop/download/0.6.0/agentes_0.6.0_aarch64.dmg",
        sha256: "",
        publishedAt: "2026-11-10T12:00:00.000Z",
      },
      builds,
    );
    asBrowserOn(ua);
    const app = await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    await click(screen().getByRole("button", { name: "Conectar um dispositivo" }));
    await settle(4);
    await click(
      within(screen().getByRole("dialog", { name: "Conectar um dispositivo" })).getByText("Outro computador"),
    );
    await settle(4);
    return Object.assign(screen().getByRole("dialog", { name: "Conectar outro computador" }), { app });
  };
  const menuItems = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole("menuitem")
      .map((i) => [i.textContent, i.hasAttribute("data-disabled")]);

  test("download: a system with no build yet is offered disabled, marked Em breve, in the menu", async () => {
    const dialog = await computerFlow(MAC_UA);
    expect(within(dialog).getByRole("link", { name: "Baixar para macOS" })).toBeTruthy();
    const menu = await openMenu(within(dialog).getByRole("button", { name: "Outros sistemas" }));
    expect(menuItems(menu)).toEqual([
      ["Baixar para WindowsEm breve", true],
      ["Baixar para Linux", false],
    ]);
  });

  test("download: on a system with no build yet, its button stays, disabled and marked Em breve", async () => {
    const dialog = await computerFlow(WINDOWS_UA);
    const mine = within(dialog).getByRole("button", { name: "Baixar para Windows" }) as HTMLButtonElement;
    expect([mine.disabled, mine.nextElementSibling?.textContent]).toEqual([true, "Em breve"]);
    const menu = await openMenu(within(dialog).getByRole("button", { name: "Outros sistemas" }));
    expect(menuItems(menu)).toEqual([
      ["Baixar para macOS", false],
      ["Baixar para Linux", false],
    ]);
  });

  test("download: while the builds are asked for, the button waits disabled and nothing says Em breve", async () => {
    const api = createFakeApi(seedState());
    api.machines.desktopLatest = () => new Promise(() => {});
    const dialog = await computerFlow(WINDOWS_UA, api);
    const mine = within(dialog).getByRole("button", { name: /^Baixar para Windows/ }) as HTMLButtonElement;
    expect([mine.disabled, mine.getAttribute("aria-busy")]).toEqual([true, "true"]);
    const menu = await openMenu(within(dialog).getByRole("button", { name: "Outros sistemas" }));
    expect(menuItems(menu)).toEqual([
      ["Baixar para macOS", true],
      ["Baixar para Linux", true],
    ]);
    expect(screen().queryByText("Em breve")).toBeNull();
  });

  test("download: the longest words (Dutch) for the button, its mark and the menu, for the layout check", async () => {
    const dialog = await computerFlow(WINDOWS_UA);
    await showIn(dialog.app.services, "nl");
    const mine = within(dialog).getByRole("button", { name: "Downloaden voor Windows" });
    expect(mine.nextElementSibling?.textContent).toBe("Binnenkort");
    const menu = await openMenu(within(dialog).getByRole("button", { name: "Andere systemen" }));
    expect(menuItems(menu)).toEqual([
      ["Downloaden voor macOS", false],
      ["Downloaden voor Linux", false],
    ]);
  });

  test("download: on a phone, the menu alone, Windows marked, in the longest words (Dutch) for the layout check", async () => {
    const dialog = await computerFlow(IPHONE_UA);
    await showIn(dialog.app.services, "nl");
    expect(within(dialog).queryByRole("button", { name: /^Downloaden voor/ })).toBeNull();
    const menu = await openMenu(within(dialog).getByRole("button", { name: "De app downloaden" }));
    expect(menuItems(menu)).toEqual([
      ["Downloaden voor macOS", false],
      ["Downloaden voor WindowsBinnenkort", true],
      ["Downloaden voor Linux", false],
    ]);
  });

  test("download: an ARM build is offered once it has a release; Windows on ARM takes x64 until then", async () => {
    // A Linux on ARM with its build out: its own button, and the others in the menu.
    const linuxArm = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0";
    const dialog = await computerFlow(linuxArm, createFakeApi(seedState()), ["darwin", "linux", "linux-arm64"]);
    expect(within(dialog).getByRole("link", { name: "Baixar para Linux (ARM)" })).toBeTruthy();
    const menu = await openMenu(within(dialog).getByRole("button", { name: "Outros sistemas" }));
    // No Windows on ARM release yet: not listed; Windows itself says Em breve.
    expect(menuItems(menu)).toEqual([
      ["Baixar para macOS", false],
      ["Baixar para WindowsEm breve", true],
      ["Baixar para Linux", false],
    ]);
  });

  test("download: a Windows on ARM (as its browser reports the chip) gets the x64 build while ARM64 has none", async () => {
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { getHighEntropyValues: async () => ({ architecture: "arm" }) },
    });
    try {
      const dialog = await computerFlow(WINDOWS_UA, createFakeApi(seedState()), ["darwin", "windows"]);
      expect(within(dialog).getByRole("link", { name: "Baixar para Windows" })).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, "userAgentData");
    }
  });

  test("a row: its state and whose it is; it opens the computer's page", async () => {
    const { machines, router, socket } = await go();
    const m = machines.pair({ name: "Escritório" });
    await act(async () => socket.push(orgEvent({ type: "machine.paired", machineId: m.id, name: m.name })));
    await settle(6);
    const r = row("Escritório");
    expect(r.querySelector(".dv-status")?.textContent).toBe("Pronto");
    expect(r.querySelector(".dv-row__owner")?.textContent).toContain("Walter");
    await click(within(r).getByRole("link", { name: "Escritório" }));
    await settle(6);
    expect(router.state.location.pathname).toBe(`/org/${ORG_ID}/settings/devices/${m.id}`);
    expect(screen().getByRole("heading", { name: "Escritório" })).toBeTruthy();
  });

  test("rename and remove, with our own confirm", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const m = fakeMachinesOf.get(api)?.pair({ name: "Notebook", online: false, lastSeenAt: null }) as Machine;
    await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    let menu = await openMenu(within(row("Notebook")).getByRole("button", { name: "Ações de Notebook" }));
    await click(within(menu).getByRole("menuitem", { name: "Renomear" }));
    const rename = screen().getByRole("dialog", { name: "Renomear o dispositivo" });
    await type(within(rename).getByLabelText("Nome"), "Notebook do Walter");
    await click(within(rename).getByRole("button", { name: "Salvar" }));
    await settle(4);
    expect(state.calls.find((c) => c.method === "devices.updateComputer")?.args).toEqual([
      ORG_ID,
      m.id,
      { name: "Notebook do Walter" },
    ]);
    menu = await openMenu(within(row("Notebook do Walter")).getByRole("button", { name: /^Ações de / }));
    await click(within(menu).getByRole("menuitem", { name: "Remover" }));
    const confirm = screen().getByRole("dialog", { name: "Remover Notebook do Walter?" });
    await click(within(confirm).getByRole("button", { name: "Remover" }));
    await settle(4);
    expect(state.calls.find((c) => c.method === "devices.removeComputer")?.args).toEqual([ORG_ID, m.id]);
  });

  test("this server's own computer: stopped here with its own words, and turned back on", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const machines = fakeMachinesOf.get(api);
    const m = machines?.pair({ name: "srv-1", kind: "host" }) as Machine;
    machines?.setHost({ machineId: m.id, on: true });
    await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    const menu = await openMenu(within(row("srv-1")).getByRole("button", { name: "Ações de srv-1" }));
    await click(within(menu).getByRole("menuitem", { name: "Parar de usar neste workspace" }));
    const confirm = screen().getByRole("dialog", { name: "Parar de usar o computador deste servidor?" });
    expect(confirm.textContent).toContain("Dá para voltar a usar quando quiser");
    await click(within(confirm).getByRole("button", { name: "Parar de usar neste workspace" }));
    await settle(6);
    expect(state.calls.find((c) => c.method === "machines.remove")?.args).toEqual([ORG_ID, m.id]);
    const off = document.querySelector(".machine-row") as HTMLElement;
    expect(off.textContent).toContain("Este workspace não usa o computador deste servidor.");
    await click(within(off).getByRole("button", { name: "Usar o computador deste servidor" }));
    await settle(4);
    expect(state.calls.find((c) => c.method === "machines.hostOn")?.args).toEqual([ORG_ID]);
  });

  test("someone else's computer: no actions", async () => {
    const api = createFakeApi(seedState());
    fakeMachinesOf.get(api)?.pair({ name: "Servidor do João", canManage: false, workspace: null });
    await renderApp(`/org/${ORG_ID}/settings/devices`, { api });
    await settle(8);
    expect(within(row("Servidor do João")).queryByRole("button", { name: /^Ações de / })).toBeNull();
  });
});

describe("an agent's folder request in the chat (ADR 0036 §8)", () => {
  // The server sends `path` and `computer`; the agent is the note's author.
  const params = {
    path: "/Users/you/Projects/loja-v5",
    computer: "MacBook do Walter",
    command: "agentes-runner folders allow /Users/you/Projects/loja-v5 --agent ada",
  };
  const post = (
    state: ReturnType<typeof seedState>,
    id: string,
    bodyCode: string,
    bodyParams: object,
    machineId?: string,
  ) => {
    const base = state.messages[0] as (typeof state.messages)[number];
    state.messages.push({
      ...base,
      id,
      threadId: null,
      author: { type: "agent", id: ADA_ID },
      body: "Ada asked for a folder.",
      mentionedAgentIds: [],
      meta: { bodyCode, bodyParams, ...(machineId ? { machineAccess: { machineId } } : {}) },
      createdAt: new Date().toISOString(),
    });
  };

  test("a note about the workspace's own computer shows no command: nobody can run it there", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const m = fakeMachinesOf.get(api)?.pair({ name: "Computador da Acme", kind: "managed" }) as Machine;
    post(state, "m-ask", "machine_access_requested", params, m.id);
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(10);
    const ask = document.querySelector('[data-message-id="m-ask"]') as HTMLElement;
    expect(ask.textContent).not.toContain("Rode no Terminal dele");
    expect(ask.querySelector(".machine-command__code")).toBeNull();
  });

  test("waiting on the computer, with the command for a computer without the app; then Liberado", async () => {
    const state = seedState();
    post(state, "m-ask", "machine_access_requested", params);
    post(state, "m-ok", "machine_access_granted", { path: params.path, computer: params.computer });
    await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api: createFakeApi(state) });
    await settle(10);
    const ask = document.querySelector('[data-message-id="m-ask"]') as HTMLElement;
    expect(ask.textContent).toContain("Ada pediu a pasta loja-v5 no MacBook do Walter. Esperando a resposta lá.");
    expect(ask.querySelector(".machine-command__code")?.textContent).toBe(params.command);
    const ok = document.querySelector('[data-message-id="m-ok"]') as HTMLElement;
    expect(ok.textContent).toContain("Liberado: Ada já pode usar loja-v5 no MacBook do Walter");
    expect(ok.querySelector(".machine-command__code")).toBeNull();
  });

  test("the notice codes the chat knows", () => {
    expect(taskNoticeOf({ bodyCode: "machine_access_denied", bodyParams: { folder: "x" } })).toEqual({
      code: "machine_access_denied",
      params: { folder: "x" },
    });
    expect(taskNoticeOf({ bodyCode: "machine_access_maybe" })).toBeNull();
    const en = createI18n("en");
    expect(en.t("missions.notice.machine_access_denied", { ...params, agent: "Ada", folder: "loja-v5" })).toBe(
      "Declined: Ada won't use loja-v5 on MacBook do Walter",
    );
  });
});

describe("the computer page: pause, folders and tools (ADR 0036)", () => {
  const LOJA = "/Users/you/Projects/loja-v5";
  const DOCS = "/Users/you/Documents";
  const mac = (over: Partial<Machine> = {}): Partial<Machine> & { name: string } => ({
    name: "MacBook do Walter",
    os: "darwin",
    arch: "arm64",
    agents: [{ id: ADA_ID, name: "Ada", handle: "ada" }],
    access: {
      folders: [
        { path: LOJA, agents: [ADA_ID] },
        { path: DOCS, agents: [] },
      ],
      tools: { claude: true, codex: false, commands: true },
    },
    ...over,
  });
  const open = async (over: Partial<Machine> = {}) => {
    const state = seedState();
    const api = createFakeApi(state);
    const machines = fakeMachinesOf.get(api) as NonNullable<ReturnType<typeof fakeMachinesOf.get>>;
    const m = machines.pair(mac(over));
    const r = await renderApp(`/org/${ORG_ID}/settings/computers/${m.id}`, { api });
    await settle(8);
    const socket = r.sockets.last();
    await act(async () => socket.open());
    return { ...r, state, api, machines, m, socket };
  };
  const folderRow = (path: string) => document.querySelector(`[data-folder="${path}"]`) as HTMLElement;
  const reduceCalls = (state: ReturnType<typeof seedState>) =>
    state.calls.filter((c) => c.method === "machines.reduceAccess").map((c) => c.args);

  test("its facts start at the card's edge, under the portrait, whatever the portrait's width", async () => {
    await open();
    expect(document.querySelector(".ac-card > .dv-facts")?.textContent).toContain("macOS");
    const css = await Bun.file(new URL("../src/layout.css", import.meta.url).pathname).text();
    expect(css).toContain("\n.machine-page__facts {\n  display: flex;");
    // No indent past a portrait: a tower is half as wide as a laptop.
    expect(css).not.toMatch(/\.machine-page__facts\s*\{[^}]*padding/);
  });

  test("the pause set on the machine shows and goes away live", async () => {
    const { m, socket } = await open();
    const head = screen().getByRole("region", { name: "MacBook do Walter" });
    expect(head.textContent).not.toContain("Pausado");
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(until));
    await act(async () =>
      socket.push(orgEvent({ type: "machine.updated", machineId: m.id, paused: { until, timezone: null } })),
    );
    await settle(2);
    // "Pausado", "até 16:24" (past midnight the date comes first: "até 10 nov 00:08").
    const sameDay = new Date(until).toDateString() === new Date().toDateString();
    const line = head.querySelector(".dv-statusline")?.textContent ?? "";
    expect(line).toContain("Pausado");
    expect(line).toContain(sameDay ? `até ${time}` : "até ");
    expect(line).toContain(time);
    expect(head.textContent).toContain("Pausado no próprio computador por quem o conectou.");
    // The server says "not paused" with null.
    await act(async () => socket.push(orgEvent({ type: "machine.updated", machineId: m.id, paused: null })));
    await settle(2);
    expect(head.textContent).not.toContain("Pausado");
  });

  test("owner: folders with the agents that use them; Remover (one agent, everyone) calls reduce", async () => {
    const { state, m } = await open();
    // The card is its title and its rows: no line under the title.
    expect(shownText(screen().getByRole("region", { name: "Pastas liberadas" }))).not.toContain("pastas a mais");
    const loja = folderRow(LOJA);
    expect(loja.textContent).toContain("loja-v5");
    expect(loja.querySelector("code")?.textContent).toBe(LOJA);
    expect(loja.textContent).toContain("Quem usa loja-v5: Ada");
    expect(folderRow(DOCS).textContent).toContain("Nenhum agente usa ainda");

    let menu = await openMenu(within(loja).getByRole("button", { name: "Ações de loja-v5" }));
    await click(within(menu).getByRole("menuitem", { name: "Só para Ada" }));
    let dialog = screen().getByRole("dialog", { name: "Tirar loja-v5 de Ada?" });
    await click(within(dialog).getByRole("button", { name: "Remover" }));
    await settle(4);
    expect(reduceCalls(state)[0]).toEqual([ORG_ID, m.id, { removeFolder: { path: LOJA, agentId: ADA_ID } }]);
    expect(document.body.textContent).toContain("Ada não usa mais loja-v5.");
    expect(folderRow(LOJA).textContent).toContain("Nenhum agente usa ainda");

    menu = await openMenu(within(folderRow(DOCS)).getByRole("button", { name: "Ações de Documents" }));
    await click(within(menu).getByRole("menuitem", { name: "Remover para todos" }));
    dialog = screen().getByRole("dialog", { name: "Remover Documents?" });
    expect(dialog.textContent).toContain("só no próprio computador");
    await click(within(dialog).getByRole("button", { name: "Remover" }));
    await settle(4);
    expect(reduceCalls(state)[1]).toEqual([ORG_ID, m.id, { removeFolder: { path: DOCS } }]);
    expect(folderRow(DOCS)).toBeNull();
  });

  test("the shared folder (ADR 0115): its own row with its path, size and the free disk; no actions, not in the list", async () => {
    const SHARED = "/Users/you/agentes/shared";
    await open({
      access: {
        folders: [
          { path: LOJA, agents: [ADA_ID] },
          { path: SHARED, agents: ["*"] },
        ],
        tools: { claude: true, codex: false, commands: true },
      },
      disk: { freeGb: 42.5, use: 0.8, sharedGb: 3.2 },
    });
    const row = document.querySelector("[data-shared-folder]") as HTMLElement;
    expect(row.textContent).toContain("Pasta compartilhada");
    expect(row.textContent).toContain("Todos os agentes daqui leem e escrevem nela.");
    expect(row.querySelector("code")?.textContent).toBe(SHARED);
    expect(row.textContent).toContain("3,2 GB nela · 43 GB livres no disco");
    expect(row.querySelector("button")).toBeNull();
    expect(folderRow(SHARED)).toBeNull();
    expect(folderRow(LOJA).textContent).toContain("loja-v5");
  });

  test("the shared folder before its size is measured, with no folder allowed; a runner without one has no row", async () => {
    await open();
    expect(document.querySelector("[data-shared-folder]")).toBeNull();
    cleanup();
    await open({
      access: {
        folders: [{ path: "/srv/agentes/shared", agents: ["*"] }],
        tools: { claude: true, codex: false, commands: true },
      },
    });
    expect(document.querySelector("[data-shared-folder]")?.textContent).toContain("Tamanho ainda não medido");
    // Nobody allowed a folder: the shared one doesn't count as one.
    expect(document.body.textContent).toContain("Nenhuma pasta a mais");
  });

  test("owner: tools on/off; Desligar turns one off; granting is never a button here", async () => {
    const { state, m } = await open();
    const tools = screen().getByRole("region", { name: "Ferramentas" });
    const claude = tools.querySelector('[data-tool="claude"]') as HTMLElement;
    const codex = tools.querySelector('[data-tool="codex"]') as HTMLElement;
    expect(claude.textContent).toContain("Ligado");
    expect(codex.textContent).toContain("Desligado");
    expect(within(codex).queryByRole("button", { name: /^Desligar/ })).toBeNull();
    // Each tool is its name and its ⓘ; that Commands reach past the allowed folders stays in view while it's on.
    expect(hintOf("Claude Code", tools).text).toBe("Escreve e muda arquivos, só nas pastas liberadas.");
    expect(hintOf("Codex", tools).text).toBe("Como o Claude Code, com uma conta do ChatGPT. Só nas pastas liberadas.");
    expect(hintOf("Comandos", tools).text).toBe("Roda comandos do Terminal, como testes e builds.");
    expect(shownText(tools)).not.toMatch(
      /O que os agentes podem rodar|Escreve e muda|Como o Claude Code|Roda comandos/,
    );
    expect(shownText(tools)).toContain("Comandos podem chegar a outras partes do computador");

    await click(within(claude).getByRole("button", { name: "Desligar Claude Code" }));
    const dialog = screen().getByRole("dialog", { name: "Desligar Claude Code?" });
    await click(within(dialog).getByRole("button", { name: "Desligar" }));
    await settle(4);
    expect(reduceCalls(state)).toEqual([[ORG_ID, m.id, { disableTool: "claude" }]]);
    expect((tools.querySelector('[data-tool="claude"]') as HTMLElement).textContent).toContain("Desligado");

    // To grant: on the computer (the app), the terminal command as a fallback; no grant button.
    expect(screen().queryByRole("button", { name: /^(Liberar|Ligar)/ })).toBeNull();
    const grant = screen().getByRole("region", { name: "Para liberar mais" });
    expect(grant.textContent).toContain("abra o app do agentes.chat nele (Preferências → Pastas).");
    expect(grant.textContent).toContain("Sem o app? No terminal do computador:");
    expect(grant.querySelector(".machine-command__code")?.textContent).toBe(
      "agentes-runner folders allow <pasta> --agent <agente>",
    );
  });

  test("the browser off: whoever is at the computer turns it on in the app, or on Linux with the command", async () => {
    const card = () => document.querySelector('[aria-labelledby="sec-machine-browser"]') as HTMLElement;
    await open();
    expect(card().textContent).toContain(
      "Só quem está no computador liga, no app do agentes.chat: Preferências → Ferramentas.",
    );
    expect(card().querySelector(".machine-command__code")).toBeNull();
    cleanup();
    await open({ os: "linux", name: "Servidor", mode: "system" });
    expect(card().textContent).toContain("Sem o app? No terminal do computador:");
    expect(card().querySelector(".machine-command__code")?.textContent).toBe(
      "sudo agentes-runner tools enable browser",
    );
  });

  test("to allow more: the app on a Mac or a PC, the computer's terminal on Linux", async () => {
    const grantText = async (over: Partial<Machine>) => {
      cleanup();
      await open(over);
      return screen().getByRole("region", { name: "Para liberar mais" }).textContent;
    };
    expect(await grantText({ os: "windows", name: "PC da Ana" })).toContain(
      "abra o app do agentes.chat nele (Preferências → Pastas).Sem o app? No terminal do computador:",
    );
    const linux = await grantText({ os: "linux", name: "Servidor", mode: "system" });
    expect(linux).toContain("Liberar é no próprio computador, no Terminal dele, como administrador:");
    expect(linux).not.toContain("app do agentes.chat");
  });

  test("read-only for someone who is neither an admin nor who connected it", async () => {
    const { state } = await open({ canManage: false, workspace: null, pairedBy: { id: "u-joao", name: "João" } });
    expect(document.body.textContent).toContain("Só João e os admins mudam o que este computador libera.");
    expect(document.body.textContent).not.toContain("Daqui você vê");
    expect(screen().queryByRole("button", { name: "Ações de loja-v5" })).toBeNull();
    expect(screen().queryByRole("button", { name: /^Desligar/ })).toBeNull();
    expect(screen().queryByRole("button", { name: /^Ações de MacBook/ })).toBeNull();
    expect(screen().getByRole("region", { name: "Para liberar mais" }).textContent).toContain(
      "Só João libera, no próprio computador.",
    );
    // Still sees what is allowed.
    expect(folderRow(LOJA).textContent).toContain("Quem usa loja-v5: Ada");
    expect(reduceCalls(state)).toEqual([]);
  });

  test("members: the server hides the folders from them; the page says who sees them", async () => {
    await open({ canManage: false, workspace: null, access: null, pairedBy: { id: "u-joao", name: "João" } });
    expect(document.body.textContent).toContain(
      "Só admins e quem conectou veem as pastas e as ferramentas deste computador.",
    );
    expect(document.body.textContent).not.toContain("ainda não informou");
  });

  test("access reported later: a note until the machine says what it allows; then it follows the event", async () => {
    const { m, socket, machines } = await open({ access: null });
    expect(document.body.textContent).toContain("Este computador ainda não informou o que libera.");
    expect(screen().queryByRole("region", { name: "Ferramentas" })).toBeNull();
    const tools = { claude: true, codex: true, commands: false };
    const access = { folders: [{ path: LOJA, agents: [ADA_ID] }], tools };
    // The server says only "it changed" (`access: true`): the page refetches what this person may see.
    machines.patch(m.id, { access });
    await act(async () => socket.push(orgEvent({ type: "machine.updated", machineId: m.id, access: true })));
    await settle(4);
    expect(folderRow(LOJA)).not.toBeNull();
    expect(screen().getByRole("region", { name: "Ferramentas" })).toBeTruthy();
  });

  test("a computer that doesn't exist: a designed state with the way back", async () => {
    const api = createFakeApi(seedState());
    await renderApp(`/org/${ORG_ID}/settings/computers/nope`, { api });
    await settle(8);
    expect(screen().getByText("Este dispositivo não está mais aqui")).toBeTruthy();
    // The way back: the page's own link (the settings menu has one too).
    expect(document.querySelector("a.machine-page__back")?.textContent).toContain("Dispositivos");
  });

  test("agent page: the folders of its computer this agent may use", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const m = fakeMachinesOf.get(api)?.pair(mac()) as Machine;
    await api.sandbox.setTarget(ORG_ID, ADA_ID, m.id);
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings&sec=computer`, { api });
    await settle(8);
    const section = document.querySelector("[data-agent-folders]") as HTMLElement;
    expect(section.textContent).toContain("Pastas no computador");
    expect(section.textContent).toContain("Além da própria pasta, usa estas:");
    expect(section.textContent).toContain("loja-v5");
    expect(section.querySelector("code")?.textContent).toBe(LOJA);
    // Allowed on the machine but not for Ada.
    expect(section.textContent).not.toContain(DOCS);
    // Where more is allowed is the label's ⓘ.
    expect(hintOf("Pastas no computador", section).text).toBe(
      "Liberar outra pasta é no próprio computador, por quem o conectou.",
    );
    expect(shownText(section)).not.toContain("Liberar outra pasta");
    // Who runs the computer is its name's ⓘ; the name shows once, with no read-only row naming it again.
    const pc = document.querySelector(".agp-pc") as HTMLElement;
    expect(hintOf("MacBook do Walter", pc).text).toBe(
      "Quem conectou este computador liga, desliga e pausa nele mesmo.",
    );
    expect(shownText(pc)).not.toContain("Quem conectou este computador");
    expect(pc.querySelector(".agp-ro")).toBeNull();
    expect(within(pc).getByRole("button", { name: "Mudar onde trabalha" })).toBeTruthy();
  });

  test("browser: an agent at work in its browser stays in use between its calls; Ver shows its card (ADR 0040)", async () => {
    const state = seedState();
    const api = createFakeApi(state);
    const machines = fakeMachinesOf.get(api) as NonNullable<ReturnType<typeof fakeMachinesOf.get>>;
    const m = machines.pair(
      mac({
        access: { folders: [], tools: { claude: true, codex: false, commands: true, browser: true } },
        browser: { available: true, version: "0.39.1", chrome: "Chrome 141", reason: null },
      }),
    );
    // Ada works in its browser in #eng (a conversation this tab listens to); then that call ends.
    const r = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(8);
    const socket = r.sockets.last();
    await act(async () => socket.open());
    const threadId = state.messages.filter((x) => x.channelId === ENG_ID).at(-1)?.id;
    const ev = (event: Record<string, unknown>) =>
      act(async () =>
        socket.push({
          type: "event",
          channelId: ENG_ID,
          event: { channelId: ENG_ID, threadId, runId: "r-browse", agentId: ADA_ID, ...event },
        }),
      );
    await ev({ type: "agent.thinking" });
    await ev({ type: "agent.tool", tool: "browser_open", detail: "loja.example.com" });
    await ev({ type: "agent.tool", tool: null });
    await act(() =>
      r.router.navigate({
        to: "/org/$orgId/settings/computers/$machineId",
        params: { orgId: ORG_ID, machineId: m.id },
      }),
    );
    await settle(8);
    const card = document.querySelector('[aria-labelledby="sec-machine-browser"]') as HTMLElement;
    // Its title, then its state: no line under the title.
    expect(card.querySelector(".ac-card__sub")).toBeNull();
    expect(card.textContent).toContain("Em uso agora");
    expect(card.textContent).not.toContain("Ninguém usa o navegador agora.");
    expect(card.querySelector(".brw-use")?.textContent).toContain("No navegador");
    // Ver shows its card in the page's own layout, not the conversation's frame. Recolher puts it away.
    const see = within(card).getByRole("button", { name: "Ver" });
    await act(async () => fireEvent.click(see));
    await settle(4);
    const browser = card.querySelector(".brw-ac") as HTMLElement;
    expect(browser.classList.contains("brw-mf")).toBe(false);
    await act(async () => fireEvent.click(within(browser).getByRole("button", { name: "Recolher" })));
    await settle(2);
    expect(card.querySelector(".brw-ac")).toBeNull();
    expect(see.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("agent page: which computer", () => {
  // Picking the computer moved to the page's sentence ("Mudar onde trabalha", saved at once):
  // apps/web/test/agent-brain.test.tsx covers it.

  test("members who don't own the agent don't get the selector", async () => {
    const state = seedState();
    if (state.me?.organizations[0]) state.me.organizations[0].role = "member";
    const api = createFakeApi(state);
    fakeMachinesOf.get(api)?.pair({ name: "Escritório" });
    await renderApp(`/org/${ORG_ID}/agents/${ADA_ID}?tab=settings`, { api });
    await settle(8);
    expect(screen().queryByRole("combobox", { name: "Computador" })).toBeNull();
  });

  test("an error's code is said in the person's language; an unknown one never in the server's words", () => {
    const i18n = createI18n("pt-BR");
    const t = i18n.t.bind(i18n);
    expect(errorText(t, new ApiError(413, "artifact.file_too_large", "too large"))).toBe(
      "O arquivo passa de 50 MB, o limite por arquivo.",
    );
    expect(errorText(t, new ApiError(500, "boom", "Server exploded"))).toBe(
      "Algo deu errado do nosso lado. Tente de novo daqui a pouco.",
    );
    const en = createI18n("en");
    expect(errorText(en.t.bind(en), new ApiError(400, "machine.pairing_invalid", "x"))).toBe(
      "Invalid, used or expired code. Generate another one.",
    );
  });
});

describe("realtime: machines and agent computers", () => {
  const machine = (over: Partial<Machine> = {}): Machine => ({
    id: "m1",
    name: "Escritório",
    online: true,
    lastSeenAt: null,
    hostname: "h",
    os: "linux",
    arch: "x64",
    runnerVersion: "0.1.0",
    execAllowed: true,
    pairedBy: null,
    agents: [],
    workspace: null,
    canManage: true,
    createdAt: "2026-10-15T00:00:00.000Z",
    ...over,
  });
  const pc: AgentComputer = {
    target: { kind: "machine", machineId: "m1", name: "Escritório", online: true },
  };

  test("status, rename and delete update the list and the agents' views", () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.machines(ORG_ID), [machine()]);
    qc.setQueryData(keys.computer(ORG_ID, ADA_ID), pc);
    expect(applyMachineEvent(qc, ORG_ID, { type: "machine.status", machineId: "m1", online: false } as never)).toBe(
      true,
    );
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.online).toBe(false);
    expect(qc.getQueryData<AgentComputer>(keys.computer(ORG_ID, ADA_ID))?.target).toMatchObject({ online: false });
    applyMachineEvent(qc, ORG_ID, { type: "machine.updated", machineId: "m1", name: "Sala 2" } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.name).toBe("Sala 2");
    expect(qc.getQueryData<AgentComputer>(keys.computer(ORG_ID, ADA_ID))?.target).toMatchObject({ name: "Sala 2" });
    applyMachineEvent(qc, ORG_ID, { type: "machine.deleted", machineId: "m1" } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))).toEqual([]);
    expect(applyMachineEvent(qc, ORG_ID, { type: "agent.typing" })).toBe(false);
  });

  test("pause and access reported by the machine patch the list; an empty update refetches (ADR 0036)", () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.machines(ORG_ID), [machine()]);
    const until = "2026-10-17T19:24:00.000Z";
    applyMachineEvent(qc, ORG_ID, { type: "machine.state", machineId: "m1", paused: { paused: true, until } } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.paused).toEqual({ paused: true, until });
    const access = { folders: [{ path: "/p", agents: ["a1", 3] }, { path: "" }], tools: { claude: true } };
    applyMachineEvent(qc, ORG_ID, { type: "machine.access", machineId: "m1", access } as never);
    // Checked and cut like the server does: bad entries dropped, missing tools off.
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.access).toEqual({
      folders: [{ path: "/p", agents: ["a1"] }],
      tools: { claude: true, codex: false, commands: false },
    });
    applyMachineEvent(qc, ORG_ID, { type: "machine.updated", machineId: "m1", paused: { paused: false } } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.paused).toEqual({ paused: false });
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.name).toBe("Escritório");
    expect(applyMachineEvent(qc, ORG_ID, { type: "machine.updated", machineId: "m1" } as never)).toBe(true);
    expect(qc.getQueryState(keys.machines(ORG_ID))?.isInvalidated).toBe(true);
  });

  test("the server's shapes: `paused: { until }` / null, and `access: true` (refetch)", () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.machines(ORG_ID), [machine()]);
    applyMachineEvent(qc, ORG_ID, {
      type: "machine.updated",
      machineId: "m1",
      paused: { until: null, timezone: null },
      access: true,
    } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.paused).toEqual({ paused: true, until: null });
    expect(qc.getQueryState(keys.machines(ORG_ID))?.isInvalidated).toBe(true);
    applyMachineEvent(qc, ORG_ID, { type: "machine.updated", machineId: "m1", paused: null } as never);
    expect(qc.getQueryData<Machine[]>(keys.machines(ORG_ID))?.[0]?.paused).toEqual({ paused: false });
  });

  test("agent.computer sets the target", () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.computer(ORG_ID, ADA_ID), { target: { kind: "none" } });
    applyComputerEvent(qc, ORG_ID, {
      type: "agent.computer",
      agentId: ADA_ID,
      target: { kind: "machine", machineId: "m1", name: "Escritório", online: true },
    } as never);
    const view = qc.getQueryData<AgentComputer>(keys.computer(ORG_ID, ADA_ID));
    expect(view?.target).toEqual({ kind: "machine", machineId: "m1", name: "Escritório", online: true });
  });
});

describe("file helpers", () => {
  test("previews only raster images, PDF and video", () => {
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("video/quicktime")).toBe("video");
    expect(previewKind("video/x-msvideo")).toBeNull();
    expect(previewKind("image/jpeg; charset=binary")).toBe("image");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/svg+xml")).toBeNull();
    expect(previewKind("text/html")).toBeNull();
    expect(previewKind("application/octet-stream")).toBeNull();
  });

  test("icons by name, then type; sizes in the locale", () => {
    expect(fileIcon("foto.JPG")).toBe("image");
    expect(fileIcon("dados.xlsx")).toBe("table");
    expect(fileIcon("site.zip")).toBe("archive");
    expect(fileIcon("contrato.pdf")).toBe("document");
    expect(fileIcon("sem-extensao", "image/webp")).toBe("image");
    expect(fileIcon("abertura.MOV")).toBe("video");
    expect(fileIcon("sem-extensao", "video/webm")).toBe("video");
    expect(fileIcon("binario")).toBe("file");
    expect(formatBytes("pt-BR", 1536)).toContain("1,5");
    expect(formatBytes("en", 3 * 1024 * 1024)).toContain("3");
    expect(formatBytes("en", 3 * 1024 * 1024)).toContain("MB");
  });
});
