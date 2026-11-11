import { type ComposioClient, composioFile, FileTooLargeError } from "@agenteschat/adapters";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import { ARTIFACT_LIMITS, type ArtifactDeps, createFileArtifact, fileReach } from "../artifacts";
import { recordAudit } from "../audit";
import { connectorKeyOf } from "../connector-usage";
import { cutText } from "../format";
import { type GitHubAppAccess, githubCallAuth, githubListingHeaders } from "../git/github-call";
import { githubItemOfCall, recordGitHubItem } from "../git/github-events";
import { creditedMessage, runCoAuthor, signatureLine, signedBody } from "../git/signature";
import type { Judge } from "../judge";
import { assertPublicHttpsUrl, outboundFetch, type ResolveHost } from "../net-guard";
import { replyThreadOf } from "../runs";
import { alwaysAsks, customAlwaysAsks, MAX_RESULT_CHARS } from "../tools/gateway";
import type { ToolContext, ToolDefinition, ToolSource } from "../tools/types";
import { CONNECTOR_CATALOG, type ConnectorTool, connectorScope, fillTitle } from "./catalog";
import { sqlArgOf } from "./classify";
import { composioFailure, composioServiceOf } from "./composio";
import {
  activeConnections,
  type ConnectorConnection,
  type ConnectorDeps,
  connectionHeaders,
  GITHUB_APP_AUTH,
  noteRefusedSignIn,
  toolPrefixOfConnection,
} from "./connections";
import {
  COMPOSIO_ANY_ACTION,
  COMPOSIO_EXECUTOR,
  classifiedTools,
  composioActions,
  customScope,
  isCustom,
  syncCustomTools,
  type ToolAccess,
} from "./custom";
import { applyToolPins } from "./pins";
import { composioAction, presetForServer } from "./presets";
import type { McpServerInfo } from "./server-icon";

/** A tool as an MCP server lists it. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** The server's `readOnlyHint` annotation, when it sends one. */
  readOnlyHint?: boolean | null;
  /** The server's `destructiveHint` annotation, when it sends one. */
  destructiveHint?: boolean | null;
}

export interface McpCallResult {
  content: string;
  isError: boolean;
  /** A Composio action's answer as Composio gave it (files and all), for `keepComposioFiles`. */
  data?: unknown;
}

/** An open MCP client session. Only the connector tool source uses it, behind the Tool Gateway. */
export interface McpSession {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  /** Who the server said it is in `initialize` (name, title, icons); null when it said nothing. */
  serverInfo?(): McpServerInfo | null;
  close(): Promise<void>;
}

/**
 * Opens a session to a connection's server (or one not stored yet). Default: streamable HTTP; tests: in-process. A
 * service through Composio is opened by its workspace and Composio account (`withComposio`).
 */
export type McpConnect = (
  connection: Pick<ConnectorConnection, "serverUrl"> &
    Partial<Pick<ConnectorConnection, "orgId" | "composioAccountId">>,
  headers: Record<string, string>,
) => Promise<McpSession>;

/**
 * Every tool result passes. The SDK's default compiles each listed tool's `outputSchema` with a new Ajv for every
 * client, so for every listing, on the main thread: a second or more and tens of MB for a server with large schemas.
 * Nothing here checks a result against its schema; it reaches the model as untrusted text either way.
 */
const NO_OUTPUT_VALIDATION: jsonSchemaValidator = {
  getValidator: () => (input) => ({ valid: true, data: input as never, errorMessage: undefined }),
};

/** Wraps an official MCP SDK client over any transport. */
export async function mcpSessionOver(transport: Transport): Promise<McpSession> {
  const client = new Client({ name: "agentes.chat", version: "1" }, { jsonSchemaValidator: NO_OUTPUT_VALIDATION });
  await client.connect(transport);
  return {
    async listTools() {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of res.tools) {
          tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema as Record<string, unknown>,
            readOnlyHint: (t.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint ?? null,
            destructiveHint: (t.annotations as { destructiveHint?: boolean } | undefined)?.destructiveHint ?? null,
          });
        }
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return tools;
    },
    async callTool(name, args) {
      const res = (await client.callTool({ name, arguments: args })) as {
        content?: { type: string; text?: string; resource?: { text?: unknown } }[];
        isError?: boolean;
        structuredContent?: unknown;
      };
      // GitHub's `get_file_contents` sends the file itself as an embedded resource next to a one-line text block.
      const parts = (res.content ?? []).map((c) =>
        c.type === "text"
          ? (c.text ?? "")
          : c.type === "resource" && typeof c.resource?.text === "string"
            ? c.resource.text
            : `[${c.type}]`,
      );
      if (parts.length === 0 && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
      return { content: parts.join("\n"), isError: res.isError === true };
    },
    serverInfo: () => (client.getServerVersion() as McpServerInfo | undefined) ?? null,
    close: () => client.close(),
  };
}

export const connectOverHttp: McpConnect = (connection, headers) =>
  mcpSessionOver(
    new StreamableHTTPClientTransport(new URL(connection.serverUrl), {
      requestInit: { headers },
      fetch: tolerantMcpFetch(outboundFetch({ ownRedirects: true })),
    }),
  );

const JSONRPC_MEMBERS = ["jsonrpc", "id", "method", "params", "result", "error"];

/** A JSON-RPC message (or batch) with only the members JSON-RPC defines; anything else is returned as it is. */
export function jsonRpcMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonRpcMembers);
  if (!isRecord(value) || !("jsonrpc" in value)) return value;
  return Object.fromEntries(JSONRPC_MEMBERS.filter((k) => k in value).map((k) => [k, value[k]]));
}

/** The JSON text normalized by `jsonRpcMembers`; null when it isn't JSON. */
function jsonRpcText(text: string): string | null {
  try {
    return JSON.stringify(jsonRpcMembers(JSON.parse(text)));
  } catch {
    return null;
  }
}

/**
 * Rewrites each SSE event whose data is JSON as one `data:` line; every other line passes as it came. An event's data
 * may span several `data:` lines (joined with \n) and lines may end in \r\n, \r or \n, as SSE allows.
 */
function sseJsonRpcEvents(): TransformStream<string, string> {
  let rest = "";
  let data: string[] = [];
  let raw: string[] = [];
  const line = (l: string, out: TransformStreamDefaultController<string>) => {
    if (l.startsWith("data:")) {
      data.push(l.slice(l.startsWith("data: ") ? 6 : 5));
      raw.push(l);
      return;
    }
    if (l === "") {
      const json = data.length > 0 ? jsonRpcText(data.join("\n")) : null;
      for (const r of json === null ? raw : [`data: ${json}`]) out.enqueue(`${r}\n`);
      data = [];
      raw = [];
    }
    out.enqueue(`${l}\n`);
  };
  return new TransformStream({
    transform(chunk, out) {
      const text = rest + chunk;
      // A trailing \r may be the first half of \r\n: wait for the next chunk to tell.
      const cut = text.endsWith("\r") ? text.length - 1 : text.length;
      const lines = text.slice(0, cut).split(/\r\n|\r|\n/);
      rest = (lines.pop() ?? "") + text.slice(cut);
      for (const l of lines) line(l, out);
    },
    flush(out) {
      if (rest.endsWith("\r")) line(rest.slice(0, -1), out);
      else if (rest) raw.push(rest);
      for (const r of raw) out.enqueue(`${r}\n`);
    },
  });
}

/**
 * A fetch for the MCP transport that drops members JSON-RPC doesn't define from the server's messages before the SDK
 * reads them: the SDK refuses a whole response for one extra top-level member (some servers add their own, like a
 * `fonte` beside `result`), where other MCP clients ignore it. `result` and `error` pass untouched, so their shapes are
 * still checked; redirects and failed responses pass as they came.
 */
export function tolerantMcpFetch(base: FetchLike = fetch): FetchLike {
  return async (url, init) => {
    const res = await base(url, init);
    if (!res.ok || !res.body) return res;
    const type = res.headers.get("content-type") ?? "";
    let body: string | ReadableStream<Uint8Array>;
    if (type.includes("application/json")) {
      const text = await res.text();
      body = jsonRpcText(text) ?? text;
    } else if (type.includes("text/event-stream")) {
      body = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(sseJsonRpcEvents())
        .pipeThrough(new TextEncoderStream());
    } else {
      return res;
    }
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  };
}

/** Name the model sees for a connector tool: `github_merge_pull_request`. */
export const exposedToolName = (connector: string, tool: string) =>
  `${connector}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

const LIST_TTL_MS = 60_000;

/** Read before Composio's own words in its executor's description: what asks a person and what doesn't. */
const EXECUTOR_NOTE =
  "Reads such as list, get and search run without asking a person. GraphQL and SQL actions ask every time. Keep sync_response_to_workbench false unless you must script over the output: the workbench and bash ask a person every time.";

/**
 * Tools of the organization's connected MCP servers (layer 2 of ADR 0016). Lists
 * each server's tools, keeps only those in our catalog (with our scope and
 * sensitivity), and calls them over MCP. The Tool Gateway filters them by the
 * agent's scopes and gates sensitive ones; this source never decides access.
 * Tool output is untrusted content: it reaches the model only as a tool result.
 */
export function createConnectorToolSource(
  deps: ConnectorDeps & {
    connect?: McpConnect;
    /** Where files a Composio action returns are kept (the workspace's Drive); none: they aren't kept. */
    artifacts?: ArtifactDeps;
    log?: { warn(message: string, data?: Record<string, unknown>): void };
    /** Reads a changed tool whose name doesn't say its level (none: such a tool asks first). */
    judge?: Judge;
    /** The server's GitHub App (ADR 0156): GitHub's tools act as it wherever the workspace installed it. */
    githubApp?: GitHubAppAccess;
  },
): ToolSource {
  const connect = deps.connect ?? connectOverHttp;
  const cache = new Map<string, { at: number; tools: McpTool[] }>();
  /** How many times a listing found changed tools and worked out a custom server's levels again. */
  let reclassified = 0;
  const github = { fetch: deps.http ?? fetch, apiUrl: "https://api.github.com", ...deps.githubApp?.http };

  /** A session with the connection's own sign-in, or `auth` when the call goes as someone else (the GitHub App). */
  async function withSession<T>(
    connection: ConnectorConnection,
    fn: (s: McpSession) => Promise<T>,
    auth?: Record<string, string>,
  ): Promise<T> {
    const extra = isCustom(connection) ? undefined : CONNECTOR_CATALOG[connection.connector]?.headers;
    try {
      const session = await connect(connection, { ...extra, ...(auth ?? (await connectionHeaders(deps, connection))) });
      try {
        return await fn(session);
      } finally {
        await session.close().catch(() => {});
      }
    } catch (error) {
      // A 401 for headers given in `auth` may be the GitHub App's token, which says nothing of the connection's sign-in.
      if (!auth) await noteRefusedSignIn(deps.db, connection, error);
      throw error;
    }
  }

  async function serverTools(connection: ConnectorConnection) {
    // A change to the connection lists again at once; a token refresh isn't one (it leaves `updatedAt` as it was).
    const key = `${connection.id}:${connection.updatedAt.getTime()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.tools;
    const auth =
      connection.authType === GITHUB_APP_AUTH
        ? await githubListingHeaders(deps, deps.githubApp, { db: deps.db, orgId: connection.orgId }, connection)
        : undefined;
    if (auth === null) throw new Error("no installation of the GitHub App to list GitHub's tools with");
    const listed = await withSession(connection, (s) => s.listTools(), auth);
    const reclassify = isCustom(connection)
      ? () => syncCustomTools({ ...deps, connect }, connection).finally(() => reclassified++)
      : undefined;
    const tools = await applyToolPins({ ...deps, reclassify }, connection, listed, pinnedTool(connection));
    cache.set(key, { at: Date.now(), tools });
    return tools;
  }

  /**
   * What the agent writes to GitHub, signed (ADR 0156): a body ends with its line naming the agent and the person it
   * works for, a commit message credits that person. The approval card showed the agent's own words.
   */
  async function signed(
    input: Record<string, unknown>,
    sign: ConnectorTool["sign"],
    at: ToolContext & { token: string | null },
  ): Promise<Record<string, unknown>> {
    if (!sign) return input;
    const given = input[sign.field];
    if (sign.field === "body") {
      if (typeof given !== "string" && !sign.always) return input;
      const line = await signatureLine(at.db, at);
      return { ...input, body: signedBody(typeof given === "string" ? given : "", line) };
    }
    if (typeof given !== "string") return input;
    const trailer = await runCoAuthor({ db: at.db, http: github, token: at.token }, at);
    return trailer ? { ...input, message: creditedMessage(given, trailer) } : input;
  }

  /** Which of a connection's tools are watched for changes (ADR 0117): not Composio's (pinned by toolkit version), not ours. */
  function pinnedTool(connection: ConnectorConnection): (name: string) => boolean {
    if (isCustom(connection)) return composioServiceOf(connection.serverUrl) ? () => false : () => true;
    const def = CONNECTOR_CATALOG[connection.connector];
    return (name) => Boolean(def?.tools[name] && !def.tools[name]?.ours);
  }

  /**
   * A custom server's tools that an admin classified (hidden until then; `off`
   * never shows). `approval` and sensitive tools ask a person for every call;
   * `write` tools run on their own and each call goes to the audit log.
   * Composio's executor says which actions each call runs: reads go as the
   * server's reads, and "Aprovar sempre" may cover its other actions; its
   * workbench, bash and proxy always ask. A tool that asks only because of its
   * level may be approved for good for one agent (`customAlwaysAsks` aside).
   */
  async function customToolsOf(connection: ConnectorConnection): Promise<ToolDefinition[]> {
    // A sign-in that stopped working (a Composio account too) has no tools until it is reconnected.
    if (connection.status === "needs_reconnect") return [];
    let classified = await classifiedTools(deps.db, connection.id);
    if (classified.length === 0) return [];
    const before = reclassified;
    let listed: McpTool[];
    try {
      listed = await serverTools(connection);
    } catch {
      return [];
    }
    // The listing found changed tools: their levels are the ones worked out from the new version.
    if (reclassified !== before) classified = await classifiedTools(deps.db, connection.id);
    const byName = new Map(listed.map((t) => [t.name, t]));
    const preset = presetForServer(connection.serverUrl)?.id;
    const composio = composioServiceOf(connection.serverUrl);
    const prefix = toolPrefixOfConnection(connection);
    return classified.flatMap((row): ToolDefinition[] => {
      const tool = byName.get(row.name);
      const access = row.access as ToolAccess;
      if (!tool) return [];
      const executor = tool.name === COMPOSIO_EXECUTOR;
      const sqlArg = composio ? null : sqlArgOf(tool, preset);
      const action = composio ? composioAction(composio.way, tool.name) : null;
      // Our rules for a Composio action as they are now (its entry's `ask`, its tags at the pinned version), not only
      // as the row stored them at the last sync: an action they make ask asks on every connection at once.
      const asks = composio !== null && tool.destructiveHint === true;
      const said = executor
        ? [EXECUTOR_NOTE, tool.description].filter(Boolean).join(" ")
        : (tool.description ?? tool.name);
      return [
        {
          name: exposedToolName(prefix, tool.name),
          description: cutText(`[${connection.label}] ${row.label}: ${said}`, 1024),
          inputSchema: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object" },
          scope: customScope(connection.id, access),
          connectionId: connection.id,
          // Through Composio, counted under the toolkit's alias as ADR 0103 §7 says.
          connector: composio
            ? { key: connectorKeyOf({ toolkit: composio.way.toolkit }), via: "composio", tool: tool.name }
            : { key: connectorKeyOf(connection), via: "mcp", tool: tool.name },
          connectorLabel: connection.label,
          service: preset,
          serviceIcon: connection.icon ?? undefined,
          toolPrefix: prefix,
          // A sensitive tool never runs without approval, whatever is stored.
          sensitive: access === "approval" || row.sensitive || asks || COMPOSIO_ANY_ACTION.has(tool.name),
          // Its exact call may be approved ahead, except a tool that runs whatever its input says.
          ahead: !COMPOSIO_ANY_ACTION.has(tool.name),
          external: true, // whatever the server returns is third-party text
          // The executor names what each call does. A Composio action, and a custom server's own tool, is one action:
          // approved for good when it asks only because of its level (never a sensitive one, nor one that runs
          // whatever its arguments say), with any values.
          ...(executor
            ? { actions: composioActions, readScope: customScope(connection.id, "read"), rememberAs: tool.name }
            : !row.sensitive &&
                !asks &&
                !COMPOSIO_ANY_ACTION.has(tool.name) &&
                (action ? !alwaysAsks(action) : !composio && !customAlwaysAsks(tool.name))
              ? { rememberAs: tool.name }
              : {}),
          ...(sqlArg ? { sqlReads: { tool: tool.name, arg: sqlArg } } : {}),
          describe: (input) => {
            const actions = executor ? composioActions(input) : null;
            return {
              title: `${connection.label}: ${actions ? actions.join(", ") : row.label}`,
              detail: `${tool.name} · ${Object.entries(input)
                .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join(" · ")}`,
            };
          },
          execute: async (input, ctx) => {
            let result: McpCallResult;
            try {
              result = await withSession(connection, (s) => s.callTool(tool.name, input));
            } catch (error) {
              if (!composio) throw error;
              return composioFailure(deps, connection, error);
            }
            if (composio && deps.composio && !result.isError) {
              const kept = await keepComposioFiles(
                { client: deps.composio.client, artifacts: deps.artifacts, resolveHost: deps.resolveHost },
                ctx,
                result,
                connection.label,
              );
              result = { ...result, content: kept };
            }
            if (access === "write" && !row.sensitive) {
              await recordAudit(ctx.db, {
                orgId: ctx.orgId,
                actor: { type: "agent", id: ctx.agentId },
                action: "connector.tool_changed",
                target: { type: "connector_connection", id: connection.id },
                details: { tool: tool.name, runId: ctx.runId, isError: result.isError },
              }).catch(() => {});
            }
            return {
              content: result.content,
              isError: result.isError,
              data: { connector: "custom", serverId: connection.id, tool: tool.name, isError: result.isError },
            };
          },
        },
      ];
    });
  }

  return {
    name: "connectors",
    async tools(ctx) {
      const out: ToolDefinition[] = [];
      for (const connection of await activeConnections(ctx.db, ctx.orgId)) {
        if (isCustom(connection)) {
          out.push(...(await customToolsOf(connection)));
          continue;
        }
        const def = CONNECTOR_CATALOG[connection.connector];
        // A sign-in that stopped working has no tools until Reconectar.
        if (!def || connection.status === "needs_reconnect") continue;
        const prefix = toolPrefixOfConnection(connection);
        let listed: McpTool[];
        try {
          listed = await serverTools(connection);
        } catch {
          continue; // an unreachable server hides its tools for this turn
        }
        for (const tool of listed) {
          const mapped = def.tools[tool.name];
          if (!mapped || mapped.ours) continue; // not in our catalog, or one we serve: never exposed
          out.push({
            name: exposedToolName(prefix, tool.name),
            description: cutText(`[${connection.label}] ${tool.description ?? tool.name}`, 1024),
            inputSchema: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object" },
            scope: connectorScope(def.id, mapped.scope),
            connectionId: connection.id,
            connector: { key: def.id, via: "mcp", tool: tool.name },
            connectorLabel: connection.label,
            service: def.id,
            toolPrefix: prefix,
            sensitive: mapped.sensitive === true,
            ahead: true,
            external: true, // whatever the server returns is third-party text
            describe: (input) => ({
              title: mapped.title ? fillTitle(mapped.title, input) : `${def.label}: ${tool.name}`,
              detail: `${def.id}.${tool.name} · ${Object.entries(input)
                .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join(" · ")}`,
            }),
            execute: async (input, ctx) => {
              let auth: Record<string, string> | undefined;
              let args = input;
              if (def.id === "github") {
                const call = { tool: tool.name, scope: mapped.scope, input };
                const how = await githubCallAuth(deps, deps.githubApp, ctx, connection, call);
                if ("refused" in how) {
                  return {
                    content: how.refused,
                    isError: true,
                    data: { connector: def.id, tool: tool.name, isError: true },
                  };
                }
                auth = how.headers;
                args = await signed(input, mapped.sign, { ...ctx, token: how.token });
              }
              const result = await withSession(connection, (s) => s.callTool(tool.name, args), auth);
              // Where the agent's words went on GitHub: what people answer there comes back to it here.
              const item =
                def.id === "github" && mapped.sign?.field === "body" && !result.isError
                  ? githubItemOfCall(tool.name, input, result.content)
                  : null;
              if (item) await recordGitHubItem(ctx, item).catch(() => {});
              return {
                content: result.content,
                isError: result.isError,
                data: { connector: def.id, tool: tool.name, isError: result.isError },
                ...(mapped.onSuccess && !result.isError
                  ? {
                      outcome: {
                        kind: mapped.onSuccess.kind,
                        subject: fillTitle(mapped.onSuccess.subject, input),
                        summary: `${def.label} ${tool.name}`,
                      },
                    }
                  : {}),
              };
            },
          });
        }
      }
      return out;
    },
  };
}

/** What marks a file in a Composio answer: a short-lived download link, or the file's bytes inline. */
const FILE_LINK = ["s3url", "s3_url"];
const FILE_BYTES = ["contentBytes", "content_bytes", "base64"];
const TEXT_TYPE = /^(text\/|application\/(json|xml|csv|x-ndjson|yaml)|.*\+(json|xml)$)/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFile = (v: Record<string, unknown>) =>
  FILE_LINK.some((k) => typeof v[k] === "string") ||
  (FILE_BYTES.some((k) => typeof v[k] === "string") && ["mimetype", "mimeType", "name"].some((k) => k in v));

/**
 * Files in a Composio answer, downloaded now: the link expires, and it never reaches the model. A text file that fits
 * the result comes back as text; anything else is kept in the workspace's Drive as untrusted content, and the answer
 * names the file. Returns the answer to show, as JSON.
 */
export async function keepComposioFiles(
  deps: { client: Pick<ComposioClient, "fetchFile">; artifacts?: ArtifactDeps; resolveHost?: ResolveHost },
  ctx: ToolContext,
  result: McpCallResult,
  from: string,
): Promise<string> {
  const { artifacts } = deps;
  // The answer carries the service's data too, and composioFile follows links under several keys (a nested `file`,
  // `response_data`, `url`…): each is checked as it is fetched, so none reaches our own network. Nothing past what the
  // Drive keeps is read, so a huge file can't fill the server's memory.
  const client: Pick<ComposioClient, "fetchFile"> = {
    fetchFile: async (url) => {
      await assertPublicHttpsUrl(url, deps.resolveHost);
      return deps.client.fetchFile(url, ARTIFACT_LIMITS.fileBytes);
    },
  };
  const keep = async (file: Record<string, unknown>) => {
    const named = ["name", "file_name", "fileName", "filename"].map((k) => file[k]).find((v) => typeof v === "string");
    const name = typeof named === "string" && named.trim() ? named.trim().slice(0, 200) : "file";
    let bytes: { data: Uint8Array; contentType?: string };
    try {
      bytes = await composioFile(client, file);
    } catch (error) {
      if (error instanceof FileTooLargeError) {
        return { file: name, error: `The file is over ${error.maxBytes / 1024 / 1024} MB, too large to keep.` };
      }
      return { file: name, error: "The file couldn't be downloaded. Try again." };
    }
    const type = bytes.contentType ?? "";
    if (TEXT_TYPE.test(type) || /\.(txt|md|csv|json|xml|ya?ml|html?)$/i.test(name)) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.data);
      if (text.length <= MAX_RESULT_CHARS / 2 && !text.includes("\uFFFD")) return { file: name, text };
    }
    if (!artifacts) return { file: name, error: "Files can't be kept on this server." };
    try {
      const saved = await createFileArtifact(
        { ...artifacts, db: ctx.db },
        {
          type: "agent",
          agentId: ctx.agentId,
          channelId: ctx.channelId,
          threadId: replyThreadOf(ctx),
          runId: ctx.runId,
        },
        ctx.orgId,
        { title: name, name, bytes: bytes.data, contentType: type || null, note: `From ${from}`, byProduct: true },
      );
      const reach = await fileReach(ctx.db, ctx.orgId, saved.id);
      return { file: name, savedAs: `file ${saved.id} (untrusted content). ${reach}` };
    } catch (error) {
      return { file: name, error: `The file couldn't be kept: ${error instanceof Error ? error.message : "failed"}` };
    }
  };
  // Past this depth nothing is shown: a link down there would otherwise reach the model.
  const walk = async (value: unknown, depth: number): Promise<unknown> => {
    if (depth > 12) return "…";
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) out.push(await walk(item, depth + 1));
      return out;
    }
    if (!isRecord(value)) return value;
    if (isFile(value)) return keep(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = await walk(item, depth + 1);
    return out;
  };
  return JSON.stringify(await walk(result.data ?? {}, 0));
}
