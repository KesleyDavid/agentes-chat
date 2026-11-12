import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ENG_ID, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

/* A personal workspace's sidebar (ADR 0159): the person on top, the agents with no header and New agent under them,
   group conversations (a row to create the first while there is none), people only when there are some, one More at the end with Início, Go to… and every tool. */

/** A narrow screen (the new agent's two steps, NEW_AGENT_STEPS_QUERY): only that query matches. */
let media: { mockRestore: () => void } | null = null;
const narrowScreen = () => {
  media = spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        matches: q === "(max-width: 959px)",
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
};

afterEach(() => {
  media?.mockRestore();
  media = null;
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

type State = ReturnType<typeof seedState>;
/** Acme as a personal workspace, nothing waiting for me; `alone`: João isn't a member. */
const personal = ({ alone = false }: { alone?: boolean } = {}) => {
  const state = seedState();
  const org = state.me?.organizations[0];
  if (org) org.mode = "personal";
  for (const a of state.approvals) a.status = "approved";
  for (const p of state.proposals) p.status = "accepted";
  if (alone) state.members = state.members.filter((m) => m.userId === state.me?.user.id);
  return state;
};
const go = async (state: State, path = `c/${ENG_ID}`) => {
  await renderApp(`/org/${ORG_ID}/${path}`, { api: createFakeApi(state) });
  await settle(8);
  return state;
};
const click = async (el: Element) => {
  await act(async () => fireEvent.click(el));
  await settle(3);
};
const nav = () => document.getElementById("app-nav") as HTMLElement;
const top = () => nav().querySelector(".sidebar__top") as HTMLElement;
const blocks = () => [...nav().querySelectorAll<HTMLElement>(".sidebar__block")].map((b) => b.dataset.section);
const channelRows = () =>
  [...nav().querySelectorAll('.sidebar__item[data-kind="channel"] .sidebar__item-label')].map((l) => l.textContent);

describe("a personal workspace's sidebar", () => {
  test("me on top with the bell beside me, and no foot", async () => {
    await go(personal());
    const me = within(top()).getByRole("button", { name: /^Conta: / });
    expect(me.textContent).toContain("Walter");
    // My row, not the workspace's: my name wraps whole there, never cut.
    expect(me.classList.contains("sidebar__org-button--me")).toBe(true);
    expect(within(top()).getByRole("link", { name: "Notificações" }).getAttribute("href")).toBe(
      `/org/${ORG_ID}/notifications`,
    );
    expect(within(top()).queryByRole("button", { name: /Menu do workspace/ })).toBeNull();
    expect(nav().querySelector(".sidebar__foot")).toBeNull();
    expect(nav().querySelectorAll(".sidebar__bell")).toHaveLength(1);
  });

  test("my menu opens down with my account, the settings and my workspaces in it", async () => {
    await go(personal());
    const me = within(top()).getByRole("button", { name: /^Conta: / });
    me.focus();
    await act(async () => {
      fireEvent.keyDown(me, { key: "Enter" });
      fireEvent.keyUp(me, { key: "Enter" });
    });
    await settle(3);
    const menu = screen().getAllByRole("menu")[0] as HTMLElement;
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.getAttribute("aria-label") ?? el.textContent),
    ).toEqual([
      // My face on top changes my photo.
      "Trocar foto",
      "Definir status",
      "Editar perfil",
      "Sua conta",
      "Configurações",
      // A personal workspace of mine is me: my face (its initial here) and my name, never the workspace's.
      "WWalterVocê está aqui",
      "Novo workspace",
      "Sair",
    ]);
    expect(menu.textContent).toContain("Seus workspaces");
  });

  test("no tool in sight while nothing waits; one More at the end with Início, Go to… and every tool", async () => {
    await go(personal());
    expect(nav().querySelector(".sidebar__tools")).toBeNull();
    expect(nav().querySelector(".sidebar__jump")).toBeNull();
    const more = nav().querySelector(".sidebar__end .sidebar__more") as HTMLElement;
    expect(more).not.toBeNull();
    await click(more);
    const menu = screen().getByRole("dialog", { name: "Mais" });
    const names = within(menu)
      .getAllByRole("link")
      .map((l) => l.querySelector(".ac-menu__label")?.firstChild?.textContent);
    expect(names).toEqual([
      "Início",
      "Aprovações",
      "Propostas de melhoria",
      "Rotinas",
      "Drive",
      "Calendário",
      "Tarefas",
      "Threads",
      "Equipe",
      "Wiki",
      "Painéis",
      "Gerenciador de tarefas",
    ]);
    expect(within(menu).getByRole("button", { name: /Ir para…/ })).toBeTruthy();
    const tasks = within(menu).getByRole("link", { name: /Tarefas/ });
    expect(tasks.querySelector(".ac-menu__desc")?.textContent).toBe("Suas tarefas e as dos seus agentes");
  });

  test("Aprovações comes into sight while something waits", async () => {
    const state = personal();
    const first = state.approvals[0];
    if (first) first.status = "pending";
    await go(state);
    const rows = [...nav().querySelectorAll(".sidebar__tools .sidebar__item-label")].map((l) => l.textContent);
    expect(rows).toEqual(["Aprovações"]);
  });

  test("the agents have no header; New agent sits right under them and opens the new agent's card (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    expect(agents.querySelector(".sidebar__section-toggle")).toBeNull();
    const rows = [...agents.querySelectorAll(".sidebar__item")];
    const last = rows.at(-1) as HTMLElement;
    expect(last.classList.contains("sidebar__new-agent")).toBe(true);
    expect(last.textContent).toBe("Novo agente");
    await click(last);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    // From scratch first, then the personal starters; Clara picked, introducing herself on her card.
    const options = within(dialog).getAllByRole("option");
    expect(options[0]?.textContent).toContain("Do zero");
    // Each row's face stands beside its two lines, the name's capitals at its top (never centred on both).
    for (const option of options) {
      expect(option.classList.contains("ac-faceline")).toBe(true);
      expect(option.querySelector(".tp-gallery__text > b.ac-captop")).toBeTruthy();
    }
    expect(within(dialog).getByRole("option", { name: /Clara/ }).getAttribute("aria-selected")).toBe("true");
    expect((within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement).value).toBe("Clara");
    expect(dialog.textContent).toContain("Oi, eu sou a");
    // "Vai usar" holds only what is connected here (GitHub), at write; her starter's apps wait for the chat.
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(within(uses).getByRole("button", { name: /GitHub/ }).textContent).toContain("Lê e escreve");
    expect(uses.textContent).not.toContain("Todoist");
    // How she works: her own instructions, editable in place; the first tasks stay in the chat.
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    expect(how.value).toContain("Confere a agenda toda manhã");
    expect(dialog.textContent).not.toContain("Para começar, peça");
    // The footer's start: the import, always in sight.
    expect(within(dialog).getByRole("button", { name: /Trazer agentes de outro app/ })).toBeTruthy();
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    const made = state.calls.find((c) => c.method === "agents.create");
    expect(made).toBeTruthy();
    const input = made?.args[1] as {
      name: string;
      instructions: string;
      setup: { starter?: string; hello?: string; apps?: object };
    };
    expect(input.name).toBe("Clara");
    expect(input.instructions).toContain("Confere a agenda toda manhã");
    expect(input.setup.starter).toBe("clara");
    expect(input.setup.hello).toContain("agenda");
    // The checklist suggests her starter's apps not connected yet, and keeps the card's (ADR 0164).
    expect(input.setup.apps).toMatchObject({ "google-calendar": "write", todoist: "write", github: "write" });
  });

  test("the agent being made never reads as taken: its @ stays the one shown, though the list has it before Criar is answered", async () => {
    const state = withRightHand(personal());
    const api = createFakeApi(state);
    const make = api.agents.create;
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    api.agents.create = async (...args) => {
      const made = await make(...args);
      await answered;
      return made;
    };
    const { sockets } = await renderApp(`/org/${ORG_ID}/c/${ENG_ID}`, { api });
    await settle(8);
    await act(async () => sockets.last().open());
    await settle(2);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    const handle = () => dialog.querySelector(".nac__handle")?.textContent;
    const shown = handle();
    expect(shown).toContain("No chat: @clara");
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    // Made on the server, which says so on the socket before it answers.
    await act(async () => sockets.last().push({ type: "event", scope: "org", event: { type: "agents.changed" } }));
    await settle(6);
    expect(agents.textContent).toContain("Clara");
    expect(handle()).toBe(shown);
    await act(async () => answer());
    await settle(6);
  });

  test("how it works is edited on the card; its helpers add a line and the cursor goes after it (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getByRole("region", { name: "Como a Clara trabalha" })).toBeTruthy();
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(how, { target: { value: "Só lembra, nunca marca." } }));
    await click(within(dialog).getByRole("button", { name: "O que evitar" }));
    expect(how.value).toBe("Só lembra, nunca marca.\nEvite: ");
    expect(how.selectionStart).toBe(how.value.length);
    // Enter in it is a new line, not Create.
    await act(async () => fireEvent.keyDown(how, { key: "Enter" }));
    expect(state.calls.some((c) => c.method === "agents.create")).toBe(false);
    await click(within(dialog).getByRole("button", { name: /Criar Clara/ }));
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as { instructions: string };
    expect(input.instructions).toBe("Só lembra, nunca marca.\nEvite:");
  });

  test("Outro app: the catalog in a dialog, the starter's apps on top; Usar puts a connected one on the card", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    await click(within(dialog).getByRole("option", { name: /Gabi/ }));
    // Taken off the card, GitHub is one click away again.
    await click(within(dialog).getByRole("button", { name: /GitHub/ }));
    await click(screen().getByRole("button", { name: "Tirar GitHub" }));
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(uses.textContent).toContain("Nada por enquanto.");
    await click(within(uses).getByRole("button", { name: "Escolher apps" }));
    const picker = screen().getByRole("dialog", { name: /Apps d[ao] Gabi/ });
    const suggested = within(picker).getByRole("region", { name: /Sugeridos para/ });
    expect(suggested.textContent).toContain("Notion");
    expect(within(suggested).getByRole("button", { name: "Conectar" })).toBeTruthy();
    const connected = within(picker).getByRole("region", { name: "Conectados" });
    await click(within(connected).getByRole("button", { name: "Usar" }));
    expect(within(connected).queryByRole("button", { name: "Usar" })).toBeNull();
    expect(connected.textContent).toContain("No cartão");
    // On the card under the picker (hidden from the accessibility tree while the picker is open).
    expect(uses.textContent).toContain("GitHub");
    // An app not connected yet runs the usual flow from here, and the card waits for the provider's way back.
    await click(within(suggested).getByRole("button", { name: "Conectar" }));
    expect(screen().getByRole("dialog", { name: /Notion/ })).toBeTruthy();
    const saved = JSON.parse(sessionStorage.getItem("agentes:new-agent") ?? "null") as { sel: string; pending: string };
    expect(saved).toMatchObject({ sel: "gabi", pending: "notion" });
  });

  test("on a narrow screen, two steps: a row opens its card, Back keeps every edit, Create is the card's (ADR 0164)", async () => {
    narrowScreen();
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    // Step 1, the list: no card and no Create; the import stays at the footer's start.
    let dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getAllByRole("option")[0]?.textContent).toContain("Do zero");
    expect(within(dialog).queryByRole("textbox", { name: "Nome" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Criar/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Trazer agentes de outro app/ })).toBeTruthy();
    // A row leads to its card, titled with its name, a back arrow before it.
    await click(within(dialog).getByRole("option", { name: /Gabi/ }));
    dialog = screen().getByRole("dialog", { name: "Gabi" });
    expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    const nameField = within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement;
    expect(nameField.value).toBe("Gabi");
    await act(async () => fireEvent.change(nameField, { target: { value: "Gabriela" } }));
    const how = within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(how, { target: { value: "Só perguntas." } }));
    // Back: the list, with the pick and the edits kept.
    await click(within(dialog).getByRole("button", { name: "Voltar" }));
    dialog = screen().getByRole("dialog", { name: "Novo agente" });
    const row = within(dialog).getByRole("option", { name: /Gabriela/ });
    expect(row.getAttribute("aria-selected")).toBe("true");
    await click(row);
    dialog = screen().getByRole("dialog", { name: "Gabriela" });
    expect((within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement).value).toBe(
      "Só perguntas.",
    );
    // Create: the card's one button, at the sheet's width.
    const create = within(dialog).getByRole("button", { name: /Criar Gabriela/ });
    expect(within(dialog).queryByRole("button", { name: "Cancelar" })).toBeNull();
    await click(create);
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as {
      name: string;
      instructions: string;
    };
    expect(input).toMatchObject({ name: "Gabriela", instructions: "Só perguntas." });
  });

  test("back from connecting an app on the provider's page, the card opens as it was, the app on it", async () => {
    const state = withRightHand(personal());
    const draft = {
      name: "Gabi",
      what: "Monto o seu plano de estudos.",
      look: { color: "sky", eyes: "round", accessory: "none" },
      apps: {},
      skills: null,
      instructions: "Só perguntas, nunca respostas.",
    };
    sessionStorage.setItem(
      "agentes:new-agent",
      JSON.stringify({
        org: ORG_ID,
        at: Date.now(),
        channelId: null,
        sel: "gabi",
        drafts: { gabi: draft },
        pending: "notion",
      }),
    );
    window.history.replaceState(
      null,
      "",
      `/org/${ORG_ID}/c/${ENG_ID}?newAgent=resume&connected=notion&outcome=connected`,
    );
    await go(state);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    expect(within(dialog).getByRole("option", { name: /Gabi/ }).getAttribute("aria-selected")).toBe("true");
    expect((within(dialog).getByRole("textbox", { name: "Instruções" }) as HTMLTextAreaElement).value).toBe(
      "Só perguntas, nunca respostas.",
    );
    const uses = within(dialog).getByRole("region", { name: "Vai usar" });
    expect(within(uses).getByRole("button", { name: /Notion/ }).textContent).toContain("Lê e escreve");
    // Its parameters leave the address, and nothing waits any more.
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("agentes:new-agent")).toBeNull();
  });

  test("from scratch, the card asks what it will do and offers names that fit it (ADR 0164)", async () => {
    const state = withRightHand(personal());
    await go(state);
    const agents = nav().querySelector('.sidebar__block[data-section="agents"]') as HTMLElement;
    await click([...agents.querySelectorAll(".sidebar__item")].at(-1) as HTMLElement);
    const dialog = screen().getByRole("dialog", { name: "Novo agente" });
    await click(within(dialog).getByRole("option", { name: /Do zero/ }));
    const create = within(dialog).getByRole("button", { name: /Criar agente/ }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    const what = within(dialog).getByRole("textbox", { name: "O que faz" });
    await act(async () => fireEvent.change(what, { target: { value: "Cuidar da agenda do consultório" } }));
    await settle(2);
    // An agenda's names; one of them picked becomes its name.
    const idea = within(dialog).getByRole("button", { name: "Lia" });
    await click(idea);
    expect((within(dialog).getByRole("textbox", { name: "Nome" }) as HTMLInputElement).value).toBe("Lia");
    await click(within(dialog).getByRole("button", { name: /Criar Lia/ }));
    const input = state.calls.find((c) => c.method === "agents.create")?.args[1] as {
      instructions: string;
      setup: { role: null; hello?: string };
    };
    expect(input.instructions).toBe("Cuidar da agenda do consultório");
    expect(input.setup).toMatchObject({ role: null, hello: "Cuidar da agenda do consultório" });
  });

  test("the agents come first; channels are Conversas em grupo; with someone else in, people and #general show", async () => {
    await go(personal());
    expect(blocks()).toEqual(["agents", "channels", "people"]);
    const toggles = [...nav().querySelectorAll(".sidebar__section-toggle")].map((b) => b.textContent);
    expect(toggles).toContain("Conversas em grupo");
    expect(toggles).toContain("Mensagens diretas");
    expect(channelRows()).toContain("general");
  });

  test("alone: no people and no #general; the channels show while there is another one", async () => {
    await go(personal({ alone: true }));
    expect(blocks()).toEqual(["agents", "channels"]);
    expect(channelRows()).toEqual(["eng"]);
  });

  test("alone with only #general: Conversas em grupo holds one row, which creates the first", async () => {
    const state = personal({ alone: true });
    state.channels = state.channels.filter((c) => c.name === "general");
    await go(state, `dm/agent/${ADA_ID}`);
    expect(blocks()).toEqual(["agents", "channels"]);
    expect(channelRows()).toEqual([]);
    await click(within(nav()).getByRole("button", { name: "Nova conversa em grupo" }));
    expect(screen().getByRole("dialog", { name: "Nova conversa em grupo" })).toBeTruthy();
  });

  test("with a group conversation in the list the row is gone: the header's + creates the next", async () => {
    await go(personal({ alone: true }));
    expect(channelRows()).toEqual(["eng"]);
    expect(nav().querySelector(".sidebar__new-channel")).toBeNull();
  });

  test("a team's sidebar is as before: the workspace on top, ⌘K under it, me and the bell at the foot", async () => {
    await go(seedState());
    expect(nav().querySelector(".sidebar__end")).toBeNull();
    expect(nav().querySelector(".sidebar__jump")).not.toBeNull();
    expect(nav().querySelector(".sidebar__foot .sidebar__bell")).not.toBeNull();
    expect(blocks()).toEqual(["tools", "channels", "agents", "people"]);
  });
});
