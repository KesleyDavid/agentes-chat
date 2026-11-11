import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { ApiError } from "@agenteschat/client";
import { cleanup } from "@testing-library/react";
import { createI18n } from "@/i18n";
import { showReturnNotices } from "@/lib/return-notices";
import { createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, settle } from "./render";

afterEach(() => cleanup());

const CONNECTORS = `/org/${ORG_ID}/settings/connectors`;

/** The toasts the app shows on opening at `path`, and the address it is left at. */
function open(path: string, lng: "pt-BR" | "en" = "pt-BR") {
  window.history.replaceState(null, "", path);
  const shown: [string, string | undefined][] = [];
  showReturnNotices(
    createI18n(lng).t,
    (text, tone) => void shown.push([typeof text === "string" ? text : text.text, tone]),
  );
  return { shown, left: window.location.pathname + window.location.search + window.location.hash };
}

describe("back from a provider's sign-in that didn't connect", () => {
  test("each reason in the person's words, in both languages; only its own parameter leaves the address", () => {
    const said = {
      "pt-BR": {
        cancelled: "A conexão foi cancelada. Nada mudou.",
        expired: "Esse link expirou. Comece de novo em Conectores.",
        used: "Esse link já foi usado. Se não conectou, comece de novo em Conectores.",
        other_account: "Termine com a conta que começou. Este navegador entrou com outra.",
        not_allowed: "Você não tem permissão para isso.",
        not_visible: "Sua conta do GitHub não vê essa instalação. Instale com uma conta que tenha acesso a ela.",
        other_workspace:
          "Essa conta do GitHub já está ligada a outro workspace. Remova o app de lá antes de instalar aqui.",
        installed_outside:
          "O app foi instalado nessa conta do GitHub fora do agentes.chat. Remova o app no GitHub e instale de novo em Conectores › GitHub.",
        owner_required:
          "Só o dono da conta do GitHub pode instalar o app. Peça para essa pessoa instalar em Conectores › GitHub neste workspace.",
        owner_unknown:
          "O GitHub não disse quem é dono dessa organização. Quem cuida do servidor precisa adicionar a permissão de organização Members (somente leitura) ao app do GitHub, e depois você instala de novo.",
        failed: "Não deu para conectar. Tente de novo em instantes.",
        "Some words from the server": "Não deu para conectar. Tente de novo em instantes.",
      },
      en: {
        cancelled: "The connection was cancelled. Nothing changed.",
        expired: "That link expired. Start again from Connectors.",
        used: "That link was already used. If it didn't connect, start again from Connectors.",
        other_account: "Finish with the account that started it. This browser is signed in with another one.",
        not_allowed: "You don't have permission for this.",
        not_visible:
          "Your GitHub account can't see that installation. Install it with an account that has access to it.",
        other_workspace:
          "That GitHub account is already linked to another workspace. Remove the app there before installing it here.",
        installed_outside:
          "The app was installed on that GitHub account outside agentes.chat. Remove it on GitHub and install it again from Connectors › GitHub.",
        owner_required:
          "Only the GitHub account's owner can install the app. Ask them to install it from Connectors › GitHub in this workspace.",
        owner_unknown:
          "GitHub didn't say who owns that organization. Whoever runs the server needs to add the organization permission Members (read-only) to the GitHub app, then you install it again.",
        failed: "Couldn't connect. Try again in a moment.",
        "Some words from the server": "Couldn't connect. Try again in a moment.",
      },
    } as const;
    for (const lng of ["pt-BR", "en"] as const) {
      for (const [code, text] of Object.entries(said[lng])) {
        for (const param of ["connector_error", "github_app_error"]) {
          const query = new URLSearchParams({ tab: "apps", [param]: code });
          expect(open(`${CONNECTORS}?${query}#mail`, lng)).toEqual({
            shown: [[text, "error"]],
            left: `${CONNECTORS}?tab=apps#mail`,
          });
        }
      }
    }
  });

  test("a connector account's own refusal comes back as its full code, apart from the browser's other account", () => {
    expect(open(`${CONNECTORS}?connector_error=connector.other_account`, "en").shown).toEqual([
      ["You signed in to another account. To connect it, use Add another account.", "error"],
    ]);
    expect(open(`${CONNECTORS}?connector_error=connector.unfinished`, "en").shown).toEqual([
      ["The sign-in at Composio didn't finish. Try again.", "error"],
    ]);
    // A code from elsewhere stays the generic text.
    expect(open(`${CONNECTORS}?connector_error=connector.nothing_like_it`, "en").shown).toEqual([
      ["Couldn't connect. Try again in a moment.", "error"],
    ]);
  });

  test("this server's own app refused at the provider: what's wrong and who fixes it, the connector by its name", () => {
    expect(open(`${CONNECTORS}?github_app_error=misconfigured&tab=apps`)).toEqual({
      shown: [
        [
          "O app do GitHub está com a chave secreta errada no servidor, então a instalação não conclui. Quem cuida do servidor precisa trocar a chave nas configurações do app.",
          "error",
        ],
      ],
      left: `${CONNECTORS}?tab=apps`,
    });
    expect(open(`${CONNECTORS}?connector_error=misconfigured&connector=linear&tab=apps`, "en")).toEqual({
      shown: [
        [
          "The connection to Linear is set up wrong on the server, so it can't finish. Whoever runs the server needs to replace the key in the app's settings.",
          "error",
        ],
      ],
      left: `${CONNECTORS}?tab=apps`,
    });
    // A connector the app has no name for (an address made by hand): only that it failed, never the address's words.
    for (const connector of ["constructor", "evil-corp", ""]) {
      expect(open(`${CONNECTORS}?connector_error=misconfigured&connector=${connector}`, "en").shown).toEqual([
        ["Couldn't connect. Try again in a moment.", "error"],
      ]);
    }
  });

  test("the GitHub account's owner was asked to install: news, not an error, with where the owner installs it", () => {
    expect(open(`${CONNECTORS}?github_app_error=requested`)).toEqual({
      shown: [
        [
          "Só o dono da conta do GitHub pode instalar o app. Peça para essa pessoa instalar em Conectores › GitHub neste workspace.",
          "info",
        ],
      ],
      left: CONNECTORS,
    });
    expect(open("/?github_app_error=requested", "en").shown).toEqual([
      [
        "Only the GitHub account's owner can install the app. Ask them to install it from Connectors › GitHub in this workspace.",
        "info",
      ],
    ]);
  });

  test("GitHub's return that worked: the app installed, or the server's own app made, on whatever page it lands", () => {
    expect(open(`${CONNECTORS}?github_app=installed&tab=apps`)).toEqual({
      shown: [["App agentes.chat instalado.", undefined]],
      left: `${CONNECTORS}?tab=apps`,
    });
    expect(open(`/org/${ORG_ID}/settings/skills?github_app=created`, "en")).toEqual({
      shown: [["GitHub app created. Workspaces here can install it now.", undefined]],
      left: `/org/${ORG_ID}/settings/skills`,
    });
    // Anything else is left as it came.
    expect(open(`${CONNECTORS}?github_app=nonsense`).shown).toEqual([]);
  });

  test("Gmail's or Outlook's that found no workspace says so on the start; Conectores reads its own", () => {
    expect(open("/?mail=failed&account=a1&x=1")).toEqual({
      shown: [["Não deu para conectar o email. Tente de novo.", "error"]],
      left: "/?x=1",
    });
    expect(open(`${CONNECTORS}?mail=failed&account=a1`)).toEqual({
      shown: [],
      left: `${CONNECTORS}?mail=failed&account=a1`,
    });
    expect(open(`${CONNECTORS}?connected=github`)).toEqual({ shown: [], left: `${CONNECTORS}?connected=github` });
  });

  test("in the desktop app's window: the provider's refusal, or finishing here refused, said the same way", async () => {
    await renderApp(`/desktop/connector?org=${ORG_ID}&error=access_denied`, { api: createFakeApi(seedState()) });
    await settle(8);
    expect(document.querySelector(".ac-toast")?.textContent).toContain("A conexão foi cancelada. Nada mudou.");
    cleanup();
    const api = createFakeApi(seedState());
    api.connectors.completeOAuth = async () => {
      throw new ApiError(409, "oauth.link_expired", "This authorization link is invalid or expired");
    };
    const { router } = await renderApp(`/desktop/connector?org=${ORG_ID}&state=s1&code=c1`, { api });
    await settle(8);
    expect(document.querySelector(".ac-toast")?.textContent).toContain(
      "Esse link expirou. Comece de novo em Conectores.",
    );
    expect(document.body.textContent).not.toContain("invalid or expired");
    expect(router.state.location.pathname).toBe(CONNECTORS);
  });

  test("in the desktop app's window: this server's OAuth app refused, said by its code with the provider it names", async () => {
    const api = createFakeApi(seedState());
    api.connectors.completeOAuth = async () => {
      throw new ApiError(500, "connector.misconfigured", "GitHub refused this server's OAuth app", {
        provider: "GitHub",
      });
    };
    await renderApp(`/desktop/connector?org=${ORG_ID}&state=s1&code=c1`, { api });
    await settle(8);
    expect(document.querySelector(".ac-toast")?.textContent).toContain(
      "A conexão com GitHub está mal configurada no servidor, então ela não conclui. Quem cuida do servidor precisa trocar a chave nas configurações do app.",
    );
    expect(document.body.textContent).not.toContain("refused this server");
  });
});
