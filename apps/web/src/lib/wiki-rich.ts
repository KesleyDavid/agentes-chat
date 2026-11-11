import { INLINE, type MdRangedBlock, parseMarkdown, parseWikiToken, SAFE_URL } from "@agenteschat/client/lib/markdown";

/**
 * The wiki's visual editor works on the page as it reads (the same `.md` elements) and saves Markdown, the format
 * agents and Obsidian read (ADR 0023). Two halves:
 *
 * - `richFromMarkdown`: the page's blocks as editable HTML. Each block carries `data-b` (its index) and the text it
 *   came from is kept, so a block nobody touched goes back exactly as written (spacing, wrapped lines, syntax the
 *   reader doesn't draw); an untouched page saves as the same text.
 * - `markdownFromRich`: the editor's elements back to Markdown, reading only what the reader draws (headings,
 *   paragraphs, lists and tasks, quotes and callouts, tables, code, rules, links, bold, italic, strike, code).
 *   Anything else a paste or the browser leaves (spans, divs, fonts, images) is read as its text.
 */

/**
 * The page's blocks: the editor's HTML and, by block index, the source text each came from. `lead` is a first
 * `# Title` equal to the page's title: the page shows its title above, so it stays out of the editor and goes back
 * in front when it saves.
 */
export interface RichDoc {
  html: string;
  sources: string[];
  lead: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TASK = /^\[( |x|X)\]\s+(.*)$/;
const CALLOUT = /^\[!([\w-]+)\][+-]?\s*(.*)$/i;
/** Obsidian's callout kinds in the reader's three looks (the same rule as `Markdown`). */
const calloutLook = (kind: string) =>
  /^(warning|caution|attention|danger|error|bug|failure|fail|missing|important)$/.test(kind)
    ? "warning"
    : /^(tip|hint|success|check|done)$/.test(kind)
      ? "tip"
      : "note";

/** A link to another page: kept whole while editing (one piece the caret steps over). */
export const wikiLinkHtml = (title: string, label: string) =>
  `<a class="wiki-link" contenteditable="false" data-title="${esc(title)}"${label !== title ? ` data-label="${esc(label)}"` : ""}>${esc(label)}</a>`;

/** A line's inline Markdown as editor HTML (the reader's `renderInline`, as strings). */
export function inlineHtml(text: string): string {
  let out = "";
  let rest = text;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m || m.index === undefined) {
      out += esc(rest);
      break;
    }
    const tok = m[0];
    const embed = Boolean(m[6] && m.index > 0 && rest[m.index - 1] === "!");
    out += esc(rest.slice(0, embed ? m.index - 1 : m.index));
    if (embed) out += rawHtml(`!${tok}`, parseWikiToken(tok).title, "span");
    else if (m[1]) out += `<code>${esc(tok.slice(1, -1))}</code>`;
    else if (m[2]) out += `<strong>${inlineHtml(tok.slice(2, -2))}</strong>`;
    else if (m[3]) out += `<em>${inlineHtml(tok.slice(1, -1))}</em>`;
    else if (m[7]) out += `<del>${inlineHtml(tok.slice(2, -2))}</del>`;
    else if (m[4]) {
      const parts = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = parts?.[2] ?? "";
      out += SAFE_URL.test(href)
        ? `<a class="ac-link" href="${esc(href)}">${inlineHtml(parts?.[1] ?? "")}</a>`
        : esc(tok);
    } else if (m[6]) {
      const { title, label } = parseWikiToken(tok);
      out += wikiLinkHtml(title, label);
    } else out += `<a class="ac-link" href="${esc(tok)}">${esc(tok)}</a>`;
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

/** Syntax the editor keeps as written and shows as one piece (an embedded file, another note). */
function rawHtml(source: string, label: string, tag: "span" | "p") {
  return `<${tag} class="wiki-rich__raw" contenteditable="false" data-md="${esc(source)}">${esc(label)}</${tag}>`;
}

function blockHtml(b: MdRangedBlock, at: number): string {
  const tag = (name: string, inner: string, extra = "") => `<${name} data-b="${at}"${extra}>${inner}</${name}>`;
  switch (b.type) {
    case "heading": {
      const level = Math.min(6, b.level + 1);
      return tag(`h${level}`, inlineHtml(b.text));
    }
    case "paragraph":
      return tag("p", inlineHtml(b.text));
    case "code":
      return tag("pre", `<code>${esc(b.text)}</code>`, b.lang ? ` data-lang="${esc(b.lang)}"` : "");
    case "list": {
      const items = b.items
        .map((item) => {
          const task = item.match(TASK);
          if (!task) return `<li>${inlineHtml(item)}</li>`;
          const done = task[1] !== " ";
          return `<li class="md__task"${done ? " data-done" : ""}><span class="md__task-box" contenteditable="false"></span>${inlineHtml(task[2] ?? "")}</li>`;
        })
        .join("");
      return tag(b.ordered ? "ol" : "ul", items);
    }
    case "quote": {
      const callout = (b.lines[0] ?? "").match(CALLOUT);
      if (callout) {
        const kind = (callout[1] ?? "note").toLowerCase();
        const body = b.lines.slice(1).join(" ").trim();
        return tag(
          "aside",
          `<b class="md__callout-title">${inlineHtml(callout[2] ?? "")}</b><span class="md__callout-body">${inlineHtml(body)}</span>`,
          ` class="md__callout" data-kind="${calloutLook(kind)}" data-callout="${esc(kind)}"`,
        );
      }
      return tag("blockquote", inlineHtml(b.text));
    }
    case "embed":
      return rawHtml(`![[${b.target}]]`, b.target, "p").replace("<p ", `<p data-b="${at}" `);
    case "rule":
      return `<hr data-b="${at}">`;
    // The editor parses without `details`: a `<details>` block stays its lines, as written.
    case "details":
      return tag("p", esc(`${b.summary}\n${b.body}`));
    case "table": {
      const align = (i: number) => (b.align[i] && b.align[i] !== "left" ? ` data-align="${b.align[i]}"` : "");
      const head = b.header.map((h, i) => `<th${align(i)}>${inlineHtml(h)}</th>`).join("");
      const rows = b.rows
        .map((r) => {
          const cells = b.header.map((_, i) => `<td${align(i)}>${inlineHtml(r[i] ?? "") || "<br>"}</td>`);
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
      return `<div class="md__table" data-b="${at}"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
}

/** The page as the editor's HTML, block by block, with the text each block came from. */
export function richFromMarkdown(source: string, options: { title?: string } = {}): RichDoc {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let blocks = parseMarkdown(source, { ranges: true });
  const textOf = (b: MdRangedBlock) => lines.slice(b.range[0], b.range[1]).join("\n").replace(/\s+$/, "");
  const first = blocks[0];
  let lead = "";
  const title = options.title?.trim();
  if (first?.type === "heading" && first.level === 1 && title && first.text.trim() === title) {
    lead = textOf(first);
    blocks = blocks.slice(1);
  }
  const sources = blocks.map(textOf);
  const html = blocks.map((b, i) => blockHtml(b, i)).join("");
  return { html: html || "<p><br></p>", sources, lead };
}

/* ── Back to Markdown ─────────────────────────────────────────────────────────────────────────────────────────── */

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "ASIDE",
  "PRE",
  "HR",
  "TABLE",
  "SECTION",
  "ARTICLE",
]);

const isBlock = (n: Node): n is HTMLElement => n.nodeType === 1 && BLOCK_TAGS.has((n as HTMLElement).tagName);
const BLOCK_SELECTOR = [...BLOCK_TAGS].map((tag) => tag.toLowerCase()).join(",");
/** An inline element around blocks (a document's paste wraps everything in one <b>): a container, not a mark. */
const wrapsBlocks = (n: Node): n is HTMLElement =>
  n.nodeType === 1 && (n as HTMLElement).querySelector(BLOCK_SELECTOR) !== null;

/** Marks hug their words: "** a **" never closes, so spaces at the edges move outside. */
function wrap(inner: string, mark: string, close = mark) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const [, lead = "", core = "", trail = ""] = m ?? [];
  return core ? `${lead}${mark}${core}${close}${trail}` : inner;
}

function styleMarks(el: HTMLElement) {
  const st = el.style;
  return {
    // A document's paste wraps everything in <b style="font-weight:normal">: the style wins.
    bold:
      ((el.tagName === "B" || el.tagName === "STRONG") && !/^(normal|[1-5]00)$/.test(st.fontWeight)) ||
      /^(bold|[6-9]00)$/.test(st.fontWeight),
    italic: el.tagName === "I" || el.tagName === "EM" || st.fontStyle === "italic",
    strike:
      el.tagName === "S" ||
      el.tagName === "DEL" ||
      el.tagName === "STRIKE" ||
      /line-through/.test(st.textDecoration || st.textDecorationLine),
  };
}

/** A node's inline content as one line of Markdown. */
export function inlineMarkdown(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) out += inlineOf(child);
  return out;
}

function inlineOf(n: Node): string {
  if (n.nodeType === 3) return (n.textContent ?? "").replace(/ /g, " ").replace(/\n/g, " ");
  if (n.nodeType !== 1) return "";
  const el = n as HTMLElement;
  if (el.dataset.md) return el.dataset.md;
  if (el.classList.contains("md__task-box")) return "";
  switch (el.tagName) {
    case "BR":
      return " ";
    case "IMG":
      return (el as HTMLImageElement).alt ?? "";
    case "CODE":
      return el.textContent ? `\`${el.textContent.replace(/`/g, "'")}\`` : "";
    case "A": {
      if (el.classList.contains("wiki-link")) {
        const title = el.dataset.title || el.textContent || "";
        const label = el.dataset.label ?? (el.textContent || title);
        return title ? (label && label !== title ? `[[${title}|${label}]]` : `[[${title}]]`) : label;
      }
      const href = el.getAttribute("href") ?? "";
      const text = inlineMarkdown(el);
      if (!SAFE_URL.test(href)) return text;
      return !text.trim() || text.trim() === href ? href : `[${text.trim()}](${href})`;
    }
  }
  let inner = inlineMarkdown(el);
  const marks = styleMarks(el);
  if (marks.strike) inner = wrap(inner, "~~");
  // "_" (not "*") so it nests inside bold: "**_both_**".
  if (marks.italic) inner = wrap(inner, "_");
  if (marks.bold) inner = wrap(inner, "**");
  return inner;
}

/** A cell's text: one line, and no "|" that would split the row. */
const cell = (el: Element | undefined) => (el ? inlineMarkdown(el).trim().replace(/\|/g, "∣") : "");

function tableMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  if (!rows.length) return "";
  const head = Array.from((rows[0] as HTMLTableRowElement).cells);
  const width = Math.max(...rows.map((r) => r.cells.length));
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")];
  const align = Array.from({ length: width }, (_, i) => {
    const a = head[i]?.getAttribute("data-align") ?? (head[i] as HTMLElement | undefined)?.style.textAlign;
    return a === "center" ? ":---:" : a === "right" ? "---:" : "---";
  });
  return [
    line(pad(head.map((c) => cell(c)))),
    line(align),
    ...rows.slice(1).map((r) => line(pad(Array.from(r.cells).map((c) => cell(c))))),
  ].join("\n");
}

function listMarkdown(list: HTMLElement, depth = 0): string {
  const ordered = list.tagName === "OL";
  const indent = "  ".repeat(depth);
  const out: string[] = [];
  let n = 1;
  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") continue;
    const own = list.ownerDocument.createElement("div");
    const nested: HTMLElement[] = [];
    for (const c of Array.from(li.childNodes)) {
      if (c.nodeType === 1 && ((c as HTMLElement).tagName === "UL" || (c as HTMLElement).tagName === "OL"))
        nested.push(c as HTMLElement);
      else own.append(c.cloneNode(true));
    }
    const text = inlineMarkdown(own).trim();
    const task = li.classList.contains("md__task");
    const mark = ordered ? `${n++}. ` : "- ";
    const box = task ? (li.hasAttribute("data-done") ? "[x] " : "[ ] ") : "";
    if (text || task) out.push(`${indent}${mark}${box}${text}`);
    for (const sub of nested) {
      const inner = listMarkdown(sub, depth + 1);
      if (inner) out.push(inner);
    }
  }
  return out.join("\n");
}

/** One block element as Markdown; "" when it holds nothing. */
function blockMarkdown(el: HTMLElement): string {
  if (el.dataset.md) return el.dataset.md;
  switch (el.tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const text = inlineMarkdown(el).trim();
      const level = Math.max(1, Number(el.tagName[1]) - 1);
      return text ? `${"#".repeat(level)} ${text}` : "";
    }
    case "UL":
    case "OL":
      return listMarkdown(el);
    case "LI":
      return inlineMarkdown(el).trim() ? `- ${inlineMarkdown(el).trim()}` : "";
    case "BLOCKQUOTE": {
      const text = childrenMarkdown(el);
      return text
        ? text
            .split("\n")
            .map((l) => (l ? `> ${l}` : ">"))
            .join("\n")
        : "";
    }
    case "ASIDE": {
      if (!el.classList.contains("md__callout")) return childrenMarkdown(el);
      const kind = el.dataset.callout || el.dataset.kind || "note";
      const title = el.querySelector(".md__callout-title");
      const bodyEl = el.querySelector(".md__callout-body");
      const titleText = title ? inlineMarkdown(title).trim() : "";
      const bodyText = bodyEl ? inlineMarkdown(bodyEl).trim() : inlineMarkdown(el).replace(titleText, "").trim();
      return [`> [!${kind}]${titleText ? ` ${titleText}` : ""}`, ...(bodyText ? [`> ${bodyText}`] : [])].join("\n");
    }
    case "PRE": {
      const text = (el.textContent ?? "").replace(/\n$/, "");
      return text.trim() ? `\`\`\`${el.dataset.lang ?? ""}\n${text}\n\`\`\`` : "";
    }
    case "HR":
      return "---";
    case "TABLE":
      return tableMarkdown(el as HTMLTableElement);
    default: {
      if (el.classList.contains("md__table")) {
        const table = el.querySelector("table");
        return table ? tableMarkdown(table) : "";
      }
      // A div or paragraph: its own blocks when it wraps some (a paste, the browser's Enter), else one paragraph.
      if (Array.from(el.childNodes).some((c) => isBlock(c) || wrapsBlocks(c))) return childrenMarkdown(el);
      return inlineMarkdown(el).trim();
    }
  }
}

/** A container's children as blocks; loose text and inline pieces between them make paragraphs. */
function childrenMarkdown(root: Node, keep?: (el: HTMLElement) => string | undefined): string {
  const parts: string[] = [];
  let loose: Node[] = [];
  const flush = () => {
    if (!loose.length) return;
    // In the nodes' own document: a paste is read in one that loads nothing, and a copy appended to an element of the
    // page's would be adopted by it, images' requests and handlers included.
    const holder = (root.ownerDocument ?? document).createElement("p");
    for (const n of loose) holder.append(n.cloneNode(true));
    const text = inlineMarkdown(holder).trim();
    if (text) parts.push(text);
    loose = [];
  };
  for (const n of Array.from(root.childNodes)) {
    if (n.nodeType === 1 && (isBlock(n) || (n as HTMLElement).dataset.b !== undefined)) {
      flush();
      const el = n as HTMLElement;
      const md = keep?.(el) ?? blockMarkdown(el);
      if (md) parts.push(md);
    } else if (wrapsBlocks(n)) {
      flush();
      const md = childrenMarkdown(n);
      if (md) parts.push(md);
    } else loose.push(n);
  }
  flush();
  return parts.join("\n\n");
}

/**
 * The editor's content as Markdown. `sources` and `snapshots` (by block index) let a block whose HTML didn't change
 * go back as it was written; with every block untouched and in place, the original text comes back whole.
 */
export function markdownFromRich(
  root: HTMLElement,
  doc?: { original: string; sources: string[]; snapshots: Map<number, string>; lead?: string },
): string {
  if (doc) {
    const kids = Array.from(root.children) as HTMLElement[];
    const untouched =
      kids.length === doc.sources.length &&
      kids.every((el, i) => el.dataset.b === String(i) && doc.snapshots.get(i) === el.outerHTML);
    if (untouched && root.childNodes.length === kids.length) return doc.original;
  }
  const kept = (el: HTMLElement) => {
    if (!doc || el.dataset.b === undefined) return undefined;
    const i = Number(el.dataset.b);
    return doc.snapshots.get(i) === el.outerHTML ? doc.sources[i] : undefined;
  };
  const body = childrenMarkdown(root, kept)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return doc?.lead ? (body ? `${doc.lead}\n\n${body}` : doc.lead) : body;
}

/** A first `# Title` line follows a rename (the reader hides it only while it equals the title). */
export function retitled(body: string, from: string, to: string): string {
  if (from === to) return body;
  const first = body.split("\n", 1)[0] ?? "";
  return first.trim() === `# ${from.trim()}` ? `# ${to.trim()}${body.slice(first.length)}` : body;
}

/** What the editor shows of a pasted HTML (another site, a document): through Markdown, so only what the page draws. */
export function pastedHtml(html: string): string {
  // Parsed in a document of its own, which loads nothing and runs nothing: the page's own would start an image's
  // request, and run its handlers, before anything here is removed.
  const holder = new DOMParser().parseFromString(html, "text/html").body;
  for (const el of Array.from(holder.querySelectorAll("script,style,meta,link,title,noscript,iframe,object")))
    el.remove();
  const md = childrenMarkdown(holder);
  return md ? richFromMarkdown(md).html.replace(/ data-b="\d+"/g, "") : "";
}

/** A pasted plain text: Markdown as the page draws it (paragraphs, lists, links), never raw HTML. */
export const pastedText = (text: string) => richFromMarkdown(text).html.replace(/ data-b="\d+"/g, "");
