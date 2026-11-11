import { decodeEntities, htmlToText } from "@agenteschat/adapters";
import { cutText } from "./format";
import { assertPublicHttpsUrl, outboundFetch, type ResolveHost } from "./net-guard";
import { outboundRefusal } from "./outbound";
import type { ToolContext, ToolDefinition, ToolSource } from "./tools/types";

/** The usage rows of web calls (no tokens, no model): readers of model calls leave them out. */
export const WEB_USAGE_PROVIDER = "web";

/**
 * Reading the public web, for every agent and every run (ADR 0109): `web_search` and `web_fetch`, no scope (like
 * `ask_user`), so API brains get them as tools and computer brains through the engine's MCP bridge. A person can
 * still take one away from an agent (`deny:web_fetch`). Both only read: search asks a provider, fetch is one GET
 * through the public-URL guard. Every call is a run step (the Tool Gateway's) and a usage row.
 *
 * Search providers, first that answers: Brave (`BRAVE_SEARCH_API_KEY`), SearXNG (`SEARXNG_URL`), the agent's own
 * browser when it may use one (Google, then Bing or DuckDuckGo on a captcha or a block), DuckDuckGo's HTML page.
 */
export const WEB_SEARCH_TOOL = "web_search";
export const WEB_FETCH_TOOL = "web_fetch";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * A page read in the agent's own browser (`BrowserToolSource.readPage`): null when the agent has no browser it may
 * use, an empty text when the page didn't open.
 */
export type BrowserPageReader = (ctx: ToolContext, url: string) => Promise<{ text: string; url: string | null } | null>;

export interface WebToolDeps {
  braveKey?: string | null;
  searxngUrl?: string | null;
  browser?: BrowserPageReader | null;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  resolveHost?: ResolveHost;
  usage?: {
    recordExternalUsage(input: {
      orgId: string;
      agentId: string;
      runId?: string;
      kind: "agent";
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costNanoUsd: number;
    }): Promise<unknown>;
  } | null;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_CHARS = 20_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; agentes.chat; +https://agentes.chat)";

/** A page that is a wall, not content: a captcha, a bot check, a sign-in gate. */
const BLOCKED_PAGE =
  /captcha|unusual traffic|not a robot|are you a robot|verify you are human|access denied|enable javascript and cookies|anomaly-modal|\/sorry\/index/i;

export const blockedPage = (text: string) => BLOCKED_PAGE.test(text.slice(0, 5000));

/** DuckDuckGo's HTML results: a link `result__a` (through its `/l/?uddg=` redirect) and a `result__snippet`. */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const blocks = html.split(/class="result\s/).slice(1);
  for (const block of blocks) {
    const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    let url = decodeEntities(link[1] ?? "");
    const target = /[?&]uddg=([^&]+)/.exec(url);
    if (target?.[1]) url = decodeURIComponent(target[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
    out.push({ title: htmlToText(link[2] ?? ""), url, snippet: htmlToText(snippet) });
  }
  return out;
}

type Found = { results: SearchResult[] } | { page: string; url: string | null };
type Provider = { id: string; search(query: string, limit: number, ctx: ToolContext): Promise<Found> };

export function createWebToolSource(deps: WebToolDeps = {}): ToolSource {
  const http = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));

  const getJson = async (url: string, headers: Record<string, string>, signal?: AbortSignal) => {
    const res = await http(url, { headers: { accept: "application/json", ...headers }, signal: timeout(signal) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };

  const providers: Provider[] = [];
  if (deps.braveKey) {
    const key = deps.braveKey;
    providers.push({
      id: "brave",
      async search(query, limit, ctx) {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
        const data = await getJson(url, { "x-subscription-token": key }, ctx.signal);
        const list = ((data.web as { results?: unknown[] } | undefined)?.results ?? []) as Record<string, unknown>[];
        return { results: list.map((r) => result(r.title, r.url, r.description)) };
      },
    });
  }
  if (deps.searxngUrl) {
    const base = deps.searxngUrl.replace(/\/+$/, "");
    providers.push({
      id: "searxng",
      async search(query, _limit, ctx) {
        const data = await getJson(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {}, ctx.signal);
        const list = (data.results ?? []) as Record<string, unknown>[];
        return { results: list.map((r) => result(r.title, r.url, r.content)) };
      },
    });
  }
  const browser = deps.browser;
  if (browser) {
    providers.push({
      id: "browser",
      async search(query, _limit, ctx) {
        const q = encodeURIComponent(query);
        for (const engine of [
          `https://www.google.com/search?q=${q}`,
          `https://www.bing.com/search?q=${q}`,
          `https://html.duckduckgo.com/html/?q=${q}`,
        ]) {
          const page = await browser(ctx, engine);
          if (!page) throw new Error("no browser for this agent");
          if (page.text.trim() && !blockedPage(page.text) && !/\/sorry\//.test(page.url ?? "")) {
            return { page: page.text, url: page.url ?? engine };
          }
        }
        throw new Error("no search engine opened in the browser without a captcha or a block");
      },
    });
  }
  providers.push({
    id: "duckduckgo",
    async search(query, _limit, ctx) {
      const res = await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: timeout(ctx.signal),
      });
      const html = await res.text();
      if (!res.ok || blockedPage(html)) throw new Error(res.ok ? "showed a bot check" : `answered ${res.status}`);
      return { results: parseDuckDuckGoHtml(html) };
    },
  });

  const record = (ctx: ToolContext, model: string) =>
    deps.usage
      ?.recordExternalUsage({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        runId: ctx.runId,
        kind: "agent",
        provider: WEB_USAGE_PROVIDER,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costNanoUsd: 0,
      })
      .catch(() => {});

  const search: ToolDefinition = {
    name: WEB_SEARCH_TOOL,
    scope: "",
    external: true,
    description:
      "Search the public web: titles, links and snippets. Read a result with web_fetch (or your browser). When it finds nothing useful, change the words (shorter, other terms, another language) or the source before concluding.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 400 },
        limit: { type: "integer", minimum: 1, maximum: 10, description: "How many results (default 8)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const query = String(input.query ?? "").trim();
      const limit = typeof input.limit === "number" ? Math.min(10, Math.max(1, Math.round(input.limit))) : 8;
      const failed: string[] = [];
      for (const p of providers) {
        let found: Found;
        try {
          found = await p.search(query, limit, ctx);
        } catch (error) {
          failed.push(`${p.id}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        await record(ctx, p.id);
        if ("page" in found) {
          return {
            content: `Results page (${found.url}), read in your browser:\n${cutText(found.page.trim(), 12_000)}`,
            data: { provider: p.id, url: found.url },
          };
        }
        const results = found.results.filter((r) => r.url).slice(0, limit);
        if (results.length === 0) {
          failed.push(`${p.id}: no results`);
          continue;
        }
        return {
          content: results
            .map((r, i) => `${i + 1}. ${r.title || r.url}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`)
            .join("\n"),
          data: { provider: p.id, results: results.length },
        };
      }
      return {
        content: `Nothing found for "${query}" (${failed.join("; ")}). Change the words or the language, open a site you know with web_fetch, or search in your browser if you have one.`,
        data: { provider: null, failed },
      };
    },
  };

  const fetchTool: ToolDefinition = {
    name: WEB_FETCH_TOOL,
    scope: "",
    external: true,
    description:
      "Read a public web page or file by its address (GET only): its text. When a site blocks you or shows a captcha, try another source, a search, or your browser.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 1, maxLength: 2048, description: "Full address (https://…)." } },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const asked = String(input.url ?? "")
        .trim()
        .replace(/^http:\/\//i, "https://");
      const refused = await outboundRefusal(ctx, asked);
      if (refused) return refused;
      const page = await getPage(asked, ctx);
      await record(ctx, "fetch");
      if (!page.ok) return { content: page.text, isError: true, data: { url: asked } };
      return { content: page.text, data: { url: page.url, status: page.status } };
    },
  };

  /**
   * One GET through the public-URL guard on every hop, at most `MAX_BYTES`, as text. A redirect's target needs no
   * outbound check: the site chose it, and its `Page:` line makes it seen for the rest of the run.
   */
  async function getPage(
    raw: string,
    ctx: Pick<ToolContext, "signal">,
  ): Promise<{ ok: true; text: string; url: string; status: number } | { ok: false; text: string }> {
    let next = raw;
    const wait = timeout(ctx.signal);
    // Not `http`: that one also reaches the search service the operator set, which may be on this server's network.
    const openPage = deps.fetch ?? outboundFetch({ resolveHost: deps.resolveHost });
    for (let hop = 0; ; hop++) {
      let at: URL;
      try {
        at = await assertPublicHttpsUrl(next, deps.resolveHost);
      } catch (error) {
        return { ok: false, text: `Can't open ${next}: ${error instanceof Error ? error.message : String(error)}.` };
      }
      let res: Response;
      try {
        res = await openPage(at.toString(), {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
          signal: wait,
        });
      } catch (error) {
        return { ok: false, text: `Couldn't reach ${at.host} (${errorText(error)}). Try another source or a search.` };
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) return { ok: false, text: `${at.host} redirects too many times.` };
        next = new URL(location, at).toString();
        continue;
      }
      const body = await readCapped(res);
      const type = res.headers.get("content-type") ?? "";
      const text = /html|xml/i.test(type) || /^\s*</.test(body) ? htmlToText(body) : body;
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503 || blockedPage(text)) {
        return {
          ok: false,
          text: `${at.host} answered ${res.status}${blockedPage(text) ? " with a captcha or a bot check" : ""}: it blocks this server. Try another source, a search, or open it in your browser if you have one.`,
        };
      }
      if (!res.ok) return { ok: false, text: `${at.host} answered ${res.status} for ${at.pathname}.` };
      return {
        ok: true,
        status: res.status,
        url: at.toString(),
        text: `Page: ${at.toString()}\n${cutText(text.trim() || "(the page is empty)", MAX_PAGE_CHARS)}`,
      };
    }
  }

  return { name: "web", tools: async () => [search, fetchTool] };
}

const result = (title: unknown, url: unknown, snippet: unknown): SearchResult => ({
  title: typeof title === "string" ? htmlToText(title) : "",
  url: typeof url === "string" ? url : "",
  snippet: typeof snippet === "string" ? htmlToText(snippet) : "",
});

const timeout = (signal?: AbortSignal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A body as text, cut at `MAX_BYTES` while it streams (a page with no length can't run us out of memory). */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    size += chunk.byteLength;
    if (size >= MAX_BYTES) break;
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}
