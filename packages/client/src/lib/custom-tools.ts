import type { CustomServer, CustomTool, ToolAccess, ToolDecision } from "../api/types";

/**
 * Classification of a custom MCP server's tools ("O que {{name}} faz"). Each
 * tool is on or off, and when on it reads, writes, or always asks for
 * approval. Undecided tools start with the backend's suggestion (else: read
 * when the server says read-only, approval otherwise). Nothing is exposed
 * until an admin saves; tools that appear later stay hidden until decided.
 */

export const defaultAccess = (tool: Pick<CustomTool, "readOnlyHint">): ToolAccess =>
  tool.readOnlyHint === true ? "read" : "approval";

/** `list_tickets`, `github.list-tickets` → `List tickets`, `Github list tickets` (when the server gives no name). */
export const humanize = (name: string) => {
  const words = name
    .replace(/[_.-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export interface ToolDraft {
  name: string;
  description: string;
  label: string;
  access: ToolAccess;
  /** Off: never offered to agents. */
  on: boolean;
  /** Appeared after the last review. */
  isNew: boolean;
}

export function draftFrom(server: CustomServer): ToolDraft[] {
  return server.tools.map((t) => ({
    name: t.name,
    description: t.description,
    label: t.label || humanize(t.name),
    access: t.access && t.access !== "off" ? t.access : (t.suggestedAccess ?? defaultAccess(t)),
    on: t.access !== "off",
    isNew: t.access === null && server.reviewedAt !== null,
  }));
}

/** The `PUT …/tools` body: each tool's decision. */
export const decisionsOf = (drafts: ToolDraft[]): { name: string; access: ToolDecision; label: string }[] =>
  drafts.map((d) => ({ name: d.name, access: d.on ? d.access : "off", label: d.label }));

/** Tools waiting for a decision ("N ferramentas novas para revisar"). */
export const toolsToReview = (server: CustomServer) => server.tools.filter((t) => t.access === null).length;

/** What agents can see: tools of a reviewed server that are on. */
export const exposedTools = (server: CustomServer) =>
  server.reviewedAt ? server.tools.filter((t) => t.access !== null && t.access !== "off") : [];

export const isHttpsUrl = (v: string) => /^https:\/\/[^\s/]+/.test(v.trim());

/** Same MCP address, ignoring a trailing slash and case. */
export const sameServer = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && (a ?? "").replace(/\/+$/, "").toLowerCase() === (b ?? "").replace(/\/+$/, "").toLowerCase();

/**
 * Whether a listed server is the one at `url`. Who can't manage connectors is told only a server's origin, so a
 * listed address with no path or query also stands for any address on that host.
 */
export const serverCovers = (listed: string | null | undefined, url: string | null | undefined) => {
  if (sameServer(listed, url)) return true;
  const origin = (listed ?? "").replace(/\/+$/, "").toLowerCase();
  if (!/^https:\/\/[^\s/?#]+$/.test(origin)) return false;
  const rest = (url ?? "").trim().toLowerCase();
  return rest.startsWith(origin) && /^[/?#]/.test(rest.slice(origin.length));
};
