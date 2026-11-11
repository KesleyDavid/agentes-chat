import { describe, expect, test } from "bun:test";
import { setupDom } from "@agenteschat/ui/testing/dom";

setupDom();

import { parseMarkdown } from "@agenteschat/client/lib/markdown";
import { markdownFromRich, pastedHtml, retitled, richFromMarkdown } from "@/lib/wiki-rich";

/** The editor as it opens: the page's HTML in a box, each block's HTML kept as it was. */
function open(source: string, title?: string) {
  const rich = richFromMarkdown(source, { title });
  const root = document.createElement("div");
  root.innerHTML = rich.html;
  const snapshots = new Map<number, string>();
  for (const el of Array.from(root.children) as HTMLElement[])
    if (el.dataset.b !== undefined) snapshots.set(Number(el.dataset.b), el.outerHTML);
  const doc = { original: source, sources: rich.sources, snapshots, lead: rich.lead };
  return { root, save: () => markdownFromRich(root, doc) };
}

describe("the wiki's visual editor", () => {
  test("the parser can say which lines each block came from", () => {
    const blocks = parseMarkdown("# T\n\nUm\ndois\n\n- a\n- b\n\n```js\nx\n```", { ranges: true });
    expect(blocks.map((b) => [b.type, b.range])).toEqual([
      ["heading", [0, 1]],
      ["paragraph", [2, 4]],
      ["list", [5, 7]],
      ["code", [8, 11]],
    ]);
    // Without asking, the blocks are as they always were.
    expect(parseMarkdown("# T")).toEqual([{ type: "heading", level: 1, text: "T" }]);
  });

  test("a page opened and saved without a change is the same text, quirks included", () => {
    const source =
      "Linhas  quebradas\nà mão, com  espaços.\n\n\n- item\n  - aninhado\n\n> [!warning] Cuidado\n> Texto\n\n<b>html cru</b>";
    expect(open(source).save()).toBe(source);
  });

  test("changing one block rewrites only that block; the others stay as written", () => {
    const source = "Primeira linha\nquebrada.\n\n- a\n  - b\n\nÚltimo parágrafo.";
    const { root, save } = open(source);
    const last = root.lastElementChild as HTMLElement;
    last.textContent = "Último parágrafo, mudado.";
    expect(save()).toBe("Primeira linha\nquebrada.\n\n- a\n  - b\n\nÚltimo parágrafo, mudado.");
  });

  test("every block the page draws goes back to Markdown", () => {
    const source = [
      "## Seção",
      "Texto com **negrito**, _itálico_, ~~riscado~~, `código`, [[Glossário|o glossário]] e [site](https://acme.com).",
      "- [x] Feita\n- [ ] Aberta",
      "1. Primeiro\n2. Segundo",
      "> [!tip] Dica\n> Use a tabela.",
      "| Plano | Preço |\n|---|---:|\n| Pro | R$ 1.290 |",
      "```sql\nselect 1\n```",
      "---",
      "![[proposta.pdf]]",
    ].join("\n\n");
    const { root, save } = open(source);
    // Touch every block: each is read back from the page's elements, none from its source.
    for (const el of Array.from(root.children) as HTMLElement[]) el.setAttribute("data-touched", "");
    expect(save()).toBe(
      [
        "## Seção",
        "Texto com **negrito**, _itálico_, ~~riscado~~, `código`, [[Glossário|o glossário]] e [site](https://acme.com).",
        "- [x] Feita\n- [ ] Aberta",
        "1. Primeiro\n2. Segundo",
        "> [!tip] Dica\n> Use a tabela.",
        "| Plano | Preço |\n| --- | ---: |\n| Pro | R$ 1.290 |",
        "```sql\nselect 1\n```",
        "---",
        "![[proposta.pdf]]",
      ].join("\n\n"),
    );
  });

  test("what the browser makes while typing reads as the page draws it", () => {
    const { root, save } = open("Começo.");
    root.innerHTML +=
      '<div>Um <b>negrito</b> e <span style="font-style: italic">itálico</span>.</div><h3>Sub</h3><ul><li>um<ul><li>dois</li></ul></li></ul><table><tr><th>A|B</th></tr><tr><td>1</td></tr></table>';
    expect(save()).toBe(
      "Começo.\n\nUm **negrito** e _itálico_.\n\n## Sub\n\n- um\n  - dois\n\n| A∣B |\n| --- |\n| 1 |",
    );
  });

  test("a document's paste: its wrapper isn't bold, its styles are marks, the rest is text", () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal"><p><span style="font-weight:700">Negrito</span> e <i>itálico</i></p><ul><li>item</li></ul><script>x()</script></b>';
    expect(pastedHtml(html)).toBe("<p><strong>Negrito</strong> e <em>itálico</em></p><ul><li>item</li></ul>");
  });

  test("a paste is read outside the page: no element of it is ever made in the live document", () => {
    const made: string[] = [];
    const create = document.createElement;
    document.createElement = ((tag: string) => {
      made.push(tag.toLowerCase());
      return create.call(document, tag);
    }) as typeof document.createElement;
    try {
      const out = pastedHtml('<p>Oi <img src="https://example.com/x.png" alt="foto" onerror="window.ran = 1"></p>');
      expect(out).toBe("<p>Oi foto</p>");
    } finally {
      document.createElement = create;
    }
    expect(made).toEqual([]);
  });

  test("a first heading equal to the title stays out of the editor and goes back on save, renamed with the page", () => {
    const { root, save } = open("# Deploy\n\nSó de segunda a quinta.", "Deploy");
    expect(root.textContent).toBe("Só de segunda a quinta.");
    (root.firstElementChild as HTMLElement).textContent = "Só de segunda a quarta.";
    expect(save()).toBe("# Deploy\n\nSó de segunda a quarta.");
    expect(retitled("# Deploy\n\nTexto", "Deploy", "Publicação")).toBe("# Publicação\n\nTexto");
    expect(retitled("Sem título no texto", "Deploy", "Publicação")).toBe("Sem título no texto");
  });
});
