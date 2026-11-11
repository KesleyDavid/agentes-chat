import { createHash } from "node:crypto";
import type { BlobStore } from "@agenteschat/adapters";
import { and, asc, type Database, type Executor, eq, inArray, isNull, like, schema, sql } from "@agenteschat/db";
import { recordAudit } from "../audit";
import { caches } from "../cache";
import { type ConnectorEventId, connectorEventsOf } from "../connector-triggers";
import { randomToken, sealSecret, sha256 } from "../crypto";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from "../errors";
import type { Judge } from "../judge";
import { oneLine } from "../mail/text";
import { assertPublicHttpsUrl } from "../net-guard";
import { can, requirePermission } from "../organizations";
import { isAgentesCloud } from "../telemetry";
import {
  classifyByRules,
  classifyTools,
  describeToolName,
  POSTING_ACTIONS,
  type ReasonCode,
  type SuggestionSource,
  sharedPrefix,
  type ToolClass,
  type ToolNameParts,
  type ToolToClassify,
  UNKNOWN_CLASS,
} from "./classify";
import { beginComposioConnect, composioServiceOf, forgetComposioAccount } from "./composio";
import {
  bearerHeaders,
  type ConnectionSecret,
  type ConnectOutcome,
  type ConnectorConnection,
  checkLabel,
  connectionHeaders,
  freeLabel,
  freeToolPrefix,
  grantToEveryAgent,
  noteRefusedSignIn,
  OAUTH_STATE_TTL_MS,
  oauthRedirectUri,
  prefixService,
  toolPrefixOf,
  toolPrefixOfConnection,
} from "./connections";
import type { McpCallResult, McpConnect, McpSession, McpTool } from "./mcp";
import {
  authServerMetadata,
  ensureOAuthClient,
  type McpOAuthDeps,
  oauthScope,
  probeMcpServer,
  serverKey,
} from "./oauth-mcp";
import { oauthReturnTo } from "./oauth-return";
import { seedToolPins } from "./pins";
import { composioToolkitOf, composioToolName, type McpPreset, presetForServer, serverUrlShown } from "./presets";
import { type McpServerInfo, refreshServerIcon } from "./server-icon";

const { connectorConnections, customTools, oauthStates, agentScopes, agents } = schema;

export const CUSTOM_PREFIX = "custom:";
export const isCustom = (c: Pick<ConnectorConnection, "connector">) => c.connector.startsWith(CUSTOM_PREFIX);
export type ToolAccess = "read" | "write" | "approval";
const ACCESS: readonly ToolAccess[] = ["read", "write", "approval"];
/** An admin's decision on a tool: how it may be used, or `off` (never offered to agents, not asked again). */
export type ToolDecision = ToolAccess | "off";
const DECISIONS: readonly ToolDecision[] = [...ACCESS, "off"];

/** The scope a classified tool needs: reading, or writing (also for tools that always ask approval). */
export const customScope = (connectionId: string, access: ToolAccess) =>
  `custom:${connectionId}:${access === "read" ? "read" : "write"}`;

/**
 * Our suggestion by the rules alone (annotations, then the verb in the name;
 * see `classify.ts`). Ambiguous names, which the judge answers when listing,
 * get approval here.
 */
export function suggestAccess(tool: ToolToClassify): ToolAccess {
  return (classifyByRules(tool) ?? UNKNOWN_CLASS).level;
}

/** Our suggestion, except tools the server itself keeps read-only (a preset's `readTools`). */
export function suggestFor(tool: ToolToClassify, readTools: readonly string[] = []): ToolAccess {
  return (classifyByRules(tool, readTools) ?? UNKNOWN_CLASS).level;
}

/**
 * Composio's meta tools (docs.composio.dev/reference/meta-tools). The executor runs other Composio actions by
 * slug. The workbench and bash run code in Composio's sandbox, which can call any action, and the proxy sends any
 * HTTP request to a connected app's API (`PUT …/pulls/12/merge` too): they always ask a person whatever their
 * annotations or stored level say.
 */
export const COMPOSIO_EXECUTOR = "COMPOSIO_MULTI_EXECUTE_TOOL";
export const COMPOSIO_ANY_ACTION: ReadonlySet<string> = new Set([
  "COMPOSIO_REMOTE_WORKBENCH",
  "COMPOSIO_REMOTE_BASH_TOOL",
  "COMPOSIO_PROXY_EXECUTE",
]);

const COMPOSIO_SLUG = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** The executor's documented input besides `tools`, with each value's type. */
const EXECUTOR_FIELDS: Readonly<Record<string, "string" | "boolean">> = {
  thought: "string",
  sync_response_to_workbench: "boolean",
  current_step: "string",
  current_step_metric: "string",
  session_id: "string",
};

/**
 * The action slugs one call of Composio's executor runs (each once), or null when its input isn't the
 * documented shape: then nothing is guessed, and the call asks a person like any other. A slug of another
 * meta tool (`COMPOSIO_…`, the workbench above all) never counts as one of its actions.
 */
export function composioActions(input: Record<string, unknown>): string[] | null {
  for (const [key, value] of Object.entries(input)) {
    if (key === "tools") continue;
    const type = EXECUTOR_FIELDS[key];
    if (!type || typeof value !== type) return null;
  }
  const tools = input.tools;
  if (!Array.isArray(tools) || tools.length === 0 || tools.length > 50) return null;
  const slugs: string[] = [];
  for (const item of tools) {
    if (!isPlainObject(item)) return null;
    const { tool_slug: slug, arguments: args, ...rest } = item;
    if (Object.keys(rest).length > 0 || (args !== undefined && !isPlainObject(args))) return null;
    if (typeof slug !== "string" || slug.length > 128 || !COMPOSIO_SLUG.test(slug) || slug.startsWith("COMPOSIO_"))
      return null;
    slugs.push(slug);
  }
  return [...new Set(slugs)];
}

export interface CustomToolView {
  name: string;
  description: string;
  readOnlyHint: boolean | null;
  /** Our suggestion until an admin decides (`accept-suggestion` applies it). */
  suggestedAccess: ToolAccess | null;
  /** Null = not decided yet (hidden from agents, waits for review). */
  access: ToolDecision | null;
  /** What the tool does now: the decision, else the suggestion. */
  level: ToolDecision;
  /** Where the suggestion came from (annotations, the verb, the judge…). */
  suggestionSource: SuggestionSource | null;
  /** Why we suggest it, as a code the web translates (`spends_money`, `unknown`…). */
  suggestionReason: ReasonCode | null;
  /** Deletes, sends, pays…: may only ask for approval or be off. */
  sensitive: boolean;
  /** The name couldn't decide it and no one confirmed the suggestion yet ("Precisam da sua decisão"). */
  pending: boolean;
  /** Off: never offered to agents. */
  off: boolean;
  /** The readable name's parts (the web says them in the person's language). */
  nameParts: ToolNameParts;
  /** The resource it is about (`campaign`, `ticket`), from the name: tools are grouped by it. */
  subject: string;
  label: string;
  firstSeenAt: string;
}

export interface CustomServerView {
  id: string;
  serverUrl: string;
  /** The account's name here ("Stripe (Acme)", "Stripe 2"): admins rename it. */
  label: string;
  /** The account as the provider names it ("Acme"), when it says; null otherwise. */
  accountLabel: string | null;
  authType: "oauth" | "api_key";
  /** The server's own icon, served by us (`/api/app/connector-icons/…`); null = a monogram. */
  iconUrl: string | null;
  /** A service through Composio (ADR 0107): its page signs in, and its address means nothing to people. */
  via?: "composio";
  /** `needs_reconnect`: its sign-in stopped working (a Composio account too), and it has no tools until Reconectar. */
  status: "active" | "needs_reconnect";
  /** Why its tools couldn't be read the last time we asked (short, the server's or the SDK's words); null when read. */
  toolsError: string | null;
  tools: CustomToolView[];
  /** What routines can wait on from it (ADR 0130): MillionSend's received email. */
  events: ConnectorEventId[];
  reviewedAt: string | null;
  createdAt: string;
}

export type CustomConnectStart =
  | { status: "connected"; server: CustomServerView; outcome: ConnectOutcome }
  | { status: "oauth"; authorizeUrl: string }
  /**
   * `not_approved`: it has OAuth but only lets in apps it approved, and agentes.chat isn't one yet. `detail`: how it
   * refused our registration, in its own words (`error: error_description`, short).
   */
  | { status: "needs_key"; reason?: "not_approved"; detail?: string };

export interface CustomDeps extends McpOAuthDeps {
  /** Suggests a level for tools whose name doesn't say (none: they suggest approval). */
  judge?: Judge;
  /** Where servers' icons are kept (the platform store); none: no icons. */
  blobs?: BlobStore;
  log?: { warn(message: string, data?: Record<string, unknown>): void };
}

const aadFor = (orgId: string, id: string) => `connector-connection|${orgId}|${id}`;
const stateAad = (orgId: string, id: string) => `oauth-state|${orgId}|${id}`;

/** "list_open_issues" → "List open issues" (a starting label people can change). */
const humanize = (name: string) => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

async function toolRows(db: Database, connectionIds: string[]) {
  if (connectionIds.length === 0) return [];
  return db
    .select()
    .from(customTools)
    .where(and(inArray(customTools.connectionId, connectionIds), isNull(customTools.removedAt)))
    .orderBy(asc(customTools.name));
}

type ToolRow = typeof customTools.$inferSelect;
const AMBIGUOUS: readonly string[] = ["judge", "judge_failed"];
const isPending = (t: ToolRow) => AMBIGUOUS.includes(t.suggestionSource ?? "") && t.confirmedAt === null;

function toolView(t: ToolRow, prefix: string | null): CustomToolView {
  const suggestedAccess = ACCESS.includes(t.suggestedAccess as ToolAccess) ? (t.suggestedAccess as ToolAccess) : null;
  const access = DECISIONS.includes(t.access as ToolDecision) ? (t.access as ToolDecision) : null;
  const { subject, ...nameParts } = describeToolName(t.name, prefix);
  return {
    name: t.name,
    description: t.description,
    readOnlyHint: t.readOnlyHint,
    suggestedAccess,
    access,
    level: access ?? suggestedAccess ?? suggestAccess(t),
    suggestionSource: (t.suggestionSource as SuggestionSource | null) ?? null,
    suggestionReason: (t.suggestionReason as ReasonCode | null) ?? null,
    sensitive: t.sensitive,
    pending: isPending(t),
    off: access === "off",
    nameParts,
    subject,
    label: t.label,
    firstSeenAt: t.firstSeenAt.toISOString(),
  };
}

/** `whole`: the reader manages connectors, so sees the address as it was typed. */
function view(c: ConnectorConnection, tools: ToolRow[], whole = true): CustomServerView {
  const mine = tools.filter((t) => t.connectionId === c.id);
  const prefix = sharedPrefix(mine.map((t) => t.name));
  return {
    id: c.id,
    serverUrl: whole ? c.serverUrl : serverUrlShown(c.serverUrl),
    label: c.label,
    accountLabel: c.accountLabel,
    authType: c.authType === "oauth" ? "oauth" : "api_key",
    iconUrl: c.icon,
    ...(composioToolkitOf(c.serverUrl) ? { via: "composio" as const } : {}),
    status: c.status === "needs_reconnect" ? "needs_reconnect" : "active",
    toolsError: c.status === "needs_reconnect" ? null : c.lastError,
    tools: mine.map((t) => toolView(t, prefix)),
    events: connectorEventsOf(c.serverUrl),
    reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadCustom(db: Database, orgId: string, id: string) {
  const [c] = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.id, id),
        eq(connectorConnections.orgId, orgId),
        like(connectorConnections.connector, `${CUSTOM_PREFIX}%`),
        isNull(connectorConnections.revokedAt),
      ),
    );
  if (!c) throw new NotFoundError("Server not found");
  return c;
}

export async function listCustomServers(db: Database, actorId: string, orgId: string): Promise<CustomServerView[]> {
  const whole = can(await requirePermission(db, actorId, orgId, "read"), "manage_connectors");
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.orgId, orgId),
        like(connectorConnections.connector, `${CUSTOM_PREFIX}%`),
        isNull(connectorConnections.revokedAt),
      ),
    )
    .orderBy(asc(connectorConnections.createdAt));
  const tools = await toolRows(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => view(r, tools, whole));
}

type AccountSpec = NonNullable<McpPreset["account"]>;
export interface ProviderAccount {
  id: string;
  name: string | null;
}

const at = (value: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), value);

/**
 * What a preset's account tool answers (JSON), as one account: the ids of all it lists, sorted and joined, and their
 * names in that order on one line; without `list`, the one account it answers (Composio's answer may hold it in
 * `response_data`). Null when it doesn't say, or doesn't say it of every account it lists.
 */
export function accountFrom(spec: AccountSpec, result: McpCallResult): ProviderAccount | null {
  if (result.isError) return null;
  let data: unknown;
  try {
    data = JSON.parse(result.content);
  } catch {
    return null;
  }
  const list = spec.list ? at(data, spec.list) : [at(data, "response_data") ?? data];
  if (!Array.isArray(list) || list.length === 0) return null;
  const accounts = new Map<string, string>();
  for (const entry of list) {
    const parts = spec.id.map((path) => at(entry, path));
    if (typeof parts[0] !== "string" || !parts[0].trim() || parts.some((v) => v === undefined || v === null)) {
      return null;
    }
    const name = at(entry, spec.name);
    accounts.set(parts.map((v) => String(v).trim()).join(":"), typeof name === "string" ? name.trim() : "");
  }
  const ids = [...accounts.keys()].sort();
  const names = [...new Set(ids.map((id) => accounts.get(id)).filter((n): n is string => Boolean(n)))];
  return { id: ids.join(","), name: names.length > 0 ? oneLine(names.join(", "), 80) : null };
}

/** Asks the account behind a session (a preset with an account tool); null when it can't tell. */
async function askAccount(session: McpSession, spec: AccountSpec | undefined) {
  if (!spec) return null;
  return accountFrom(spec, await session.callTool(spec.tool, spec.args ?? {}));
}

/** The account a fresh sign-in, key or Composio account reached, asked before anything is stored. */
async function providerAccount(
  deps: CustomDeps,
  spec: AccountSpec | undefined,
  connection: Parameters<McpConnect>[0],
  headers: Record<string, string>,
) {
  if (!spec || !deps.connect) return null;
  try {
    const session = await deps.connect(connection, headers);
    try {
      return await askAccount(session, spec);
    } finally {
      await session.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

/** "Stripe (Acme)": the service and the account, within the 80 characters of a name. */
const accountName = (service: string, account: string) =>
  `${service} (${oneLine(account, Math.max(8, 77 - service.length))})`;

/** "Reconectar": the live connection of this workspace it names, at the same address (400 otherwise). */
export async function reconnectTarget(db: Database, orgId: string, connectionId: string, serverUrl: string) {
  const c = await loadCustom(db, orgId, connectionId).catch(() => null);
  if (!c) throw new NotFoundError("This account is no longer connected", "connector.gone");
  if (serverKey(c.serverUrl) !== serverKey(serverUrl)) {
    throw new ValidationError("Reconnect the account at its own address", "connector.other_server");
  }
  return c;
}

/**
 * Stores a custom server's connection: one row per account, several per server (ADR 0099). `connectionId`
 * ("Reconectar") gives that account a new sign-in in place, so its name, tools and grants stay; signing in to
 * another account there is refused (`connector.other_account`), the grants were given for that one. Without it a
 * new account comes in, except when the provider says it is one already connected (its sign-in is refreshed,
 * `same_account`) or the server has no sign-in at all (the one connection it has). Every new account
 * is every agent's (`grantToEveryAgent`). Addresses match as the apps match them
 * (`serverKey`). A service through Composio (ADR 0107) keeps Composio's account and no secret; the account it
 * replaces goes away at Composio.
 */
export async function storeCustomConnection(
  deps: CustomDeps,
  input: {
    orgId: string;
    actorId: string;
    serverUrl: string;
    /** The service's name ("Stripe", what the person typed): its first account's name, the others' base. */
    label: string;
    authType: "oauth" | "api_key" | "none";
    secret: ConnectionSecret | null;
    tokenExpiresAt?: Date | null;
    oauthClientId?: string | null;
    resource?: string | null;
    connectionId?: string | null;
    /** Through Composio: its connected account, and the name Composio keeps for it when the entry can't ask. */
    composio?: { accountId: string; name: string | null };
  },
): Promise<{ connection: ConnectorConnection; outcome: ConnectOutcome }> {
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const preset = presetForServer(input.serverUrl);
  const reached = { serverUrl: input.serverUrl, orgId: input.orgId, composioAccountId: input.composio?.accountId };
  const account =
    input.secret || input.composio
      ? await providerAccount(deps, preset?.account, reached, input.secret ? bearerHeaders(input.secret) : {})
      : null;
  // Composio's name for the account when the entry's account action didn't say: a name, never an identity.
  const named = account?.name ?? input.composio?.name ?? null;
  const key = serverKey(input.serverUrl);
  const same = await liveAccounts(deps.db, input.orgId, key);
  if (account) {
    // Accounts connected before their provider was asked: asked now, so the same account is recognized.
    for (const c of same.filter((c) => !c.accountId)) c.accountId = (await fillAccount(deps, c))?.id ?? null;
  }
  let target: ConnectorConnection | undefined;
  if (input.connectionId) {
    target = await reconnectTarget(deps.db, input.orgId, input.connectionId, input.serverUrl);
    // Its grants were given for the account it is: a sign-in that can't say which one it reached doesn't replace it.
    if (preset?.account && target.accountId && !account) {
      throw new ConflictError("Couldn't check which account you signed in to", "connector.account_unknown");
    }
    if (account && target.accountId && target.accountId !== account.id) {
      throw new ConflictError("You signed in to another account", "connector.other_account");
    }
  } else if (account) {
    target = same.find((c) => c.accountId === account.id);
  } else if (input.authType === "none") {
    // Nothing to sign in to: connecting again is the one connection it has.
    if (same[0]) return { connection: same[0], outcome: "same_account" };
  }
  const outcome: ConnectOutcome = input.connectionId ? "reconnected" : target ? "same_account" : "connected";
  const id = target?.id ?? crypto.randomUUID();
  const sealed = input.secret ? await sealSecret(wrapper, JSON.stringify(input.secret), aadFor(input.orgId, id)) : null;
  const credentials = {
    authType: input.authType,
    secretCiphertext: sealed?.ciphertext ?? null,
    wrappedDataKey: sealed?.wrappedDataKey ?? null,
    kekId: sealed?.kekId ?? null,
    tokenExpiresAt: input.tokenExpiresAt ?? null,
    oauthClientId: input.oauthClientId ?? null,
    resource: input.resource ?? null,
    ...(account ? { accountId: account.id, accountLabel: named } : named ? { accountLabel: named } : {}),
    // New credentials: whatever stopped working before is behind it.
    status: "active",
    lastError: null,
    ...(input.composio ? { composioAccountId: input.composio.accountId } : {}),
  };
  if (target) {
    const [row] = await deps.db
      .update(connectorConnections)
      .set({ ...credentials, updatedAt: new Date() })
      .where(eq(connectorConnections.id, target.id))
      .returning();
    if (!row) throw new Error("connection update returned nothing");
    caches.connections.delete(`${input.orgId}:active`);
    caches.scopes.deletePrefix(`${input.orgId}:`);
    const replaced = target.composioAccountId;
    if (replaced && deps.composio && replaced !== input.composio?.accountId) {
      await forgetComposioAccount(deps.composio.client, replaced);
    }
    await recordAudit(deps.db, {
      orgId: input.orgId,
      actor: { type: "person", id: input.actorId },
      action: "connector.custom_reconnected",
      target: { type: "connector_connection", id: row.id },
      details: {
        serverUrl: serverUrlShown(input.serverUrl),
        authType: input.authType,
        label: row.label,
        account: row.accountLabel,
        sameAccount: outcome === "same_account",
      },
    });
    return { connection: row, outcome };
  }
  const service = input.label.trim().slice(0, 80) || new URL(input.serverUrl).hostname;
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await deps.db.transaction(async (tx) => {
        // Two connects of one server at once: read under the lock, so only one of them is its first account, and
        // one that reached the same account as the other is that connection, not a second one.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`connector-accounts:${input.orgId}:${key}`}))`);
        const live = await liveAccounts(tx, input.orgId, key);
        const twin = account
          ? live.find((c) => c.accountId === account.id)
          : input.authType === "none"
            ? live[0]
            : null;
        if (twin) return { twin, row: null };
        // The service's name, not the account's: `stripe`, then `stripe_2`; a later account goes by the server's
        // oldest one, whatever it is called now.
        const base = live[0] ? prefixService(toolPrefixOfConnection(live[0])) : toolPrefixOf(service);
        const label = await freeLabel(tx, input.orgId, named ? accountName(service, named) : service);
        const toolPrefix = await freeToolPrefix(tx, input.orgId, base, deps.oauthApps);
        const [row] = await tx
          .insert(connectorConnections)
          .values({
            id,
            orgId: input.orgId,
            connector: `${CUSTOM_PREFIX}${id}`,
            label,
            toolPrefix,
            serverUrl: input.serverUrl,
            ...credentials,
            createdByUserId: input.actorId,
          })
          .returning();
        if (!row) throw new Error("connection insert returned nothing");
        await recordAudit(tx, {
          orgId: input.orgId,
          actor: { type: "person", id: input.actorId },
          action: "connector.custom_connected",
          target: { type: "connector_connection", id: row.id },
          details: {
            serverUrl: serverUrlShown(input.serverUrl),
            authType: input.authType,
            label,
            account: named,
            everyAgent: true,
          },
        });
        await grantToEveryAgent(tx, input.orgId, input.actorId, row);
        return { twin: null, row };
      });
      if (!done.row) {
        // Connected again from the start, it finds that connection and refreshes its sign-in.
        return account
          ? storeCustomConnection(deps, input)
          : { connection: done.twin, outcome: "same_account" as const };
      }
      caches.connections.delete(`${input.orgId}:active`);
      caches.scopes.deletePrefix(`${input.orgId}:`);
      return { connection: done.row, outcome };
    } catch (error) {
      // Another connect took the same tool prefix a moment ago: the next number is free.
      if (attempt < 2 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

/** A workspace's live accounts of one server (`serverKey`), oldest first. */
async function liveAccounts(db: Executor, orgId: string, key: string) {
  const rows = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.orgId, orgId),
        like(connectorConnections.connector, `${CUSTOM_PREFIX}%`),
        isNull(connectorConnections.revokedAt),
      ),
    )
    .orderBy(asc(connectorConnections.createdAt));
  return rows.filter((c) => serverKey(c.serverUrl) === key);
}

/** Asks the provider which account a stored connection is (its own credentials) and keeps the answer. */
async function fillAccount(deps: CustomDeps, c: ConnectorConnection) {
  const spec = presetForServer(c.serverUrl)?.account;
  if (!spec || !deps.connect) return null;
  try {
    const session = await deps.connect(c, await connectionHeaders(deps, c));
    try {
      const account = await askAccount(session, spec);
      if (account) await keepAccount(deps.db, c, account);
      return account;
    } finally {
      await session.close().catch(() => {});
    }
  } catch (error) {
    await noteRefusedSignIn(deps.db, c, error);
    return null;
  }
}

/** The provider's name for the account, refreshed; its id only when none was known (a sign-in never changes it). */
async function keepAccount(db: Database, c: ConnectorConnection, account: ProviderAccount) {
  // The connection is another account than the one its sign-in reaches now: that one's name isn't its name.
  if (c.accountId && c.accountId !== account.id) return;
  await db
    .update(connectorConnections)
    .set({ accountLabel: account.name, ...(c.accountId ? {} : { accountId: account.id }) })
    .where(eq(connectorConnections.id, c.id));
  caches.connections.delete(`${c.orgId}:active`);
}

/** The server couldn't be reached or its tools couldn't be listed; the reason is kept as the server's `toolsError`. */
export class ToolsUnreadable extends Error {}

/**
 * Lists the server's tools again: new ones come in unclassified (hidden from
 * agents until an admin classifies them), gone ones are marked removed. Each
 * gets a suggestion (annotations, the verb, else the judge: its answers are
 * kept per tool name and asked again only when its description changed). A tool
 * that turns out sensitive can't stay free: its read/write decision becomes
 * approval. A level nobody set by hand follows a stricter suggestion (a read
 * that became a write); no level ever gets looser here.
 */
export async function syncCustomTools(deps: CustomDeps, c: ConnectorConnection) {
  const preset = presetForServer(c.serverUrl);
  let listed: McpTool[];
  let info: McpServerInfo | null = null;
  let account: ProviderAccount | null = null;
  try {
    if (!deps.connect) throw new Error("no MCP connect configured");
    const session = await deps.connect(c, await connectionHeaders(deps, c));
    try {
      listed = await session.listTools();
      info = session.serverInfo?.() ?? null;
      if (listed.some((t) => t.name === preset?.account?.tool)) {
        account = await askAccount(session, preset?.account).catch(() => null);
      }
    } finally {
      await session.close().catch(() => {});
    }
  } catch (error) {
    const reason = oneLine(error instanceof Error ? error.message : String(error), 200) || "failed";
    deps.log?.warn("custom connector tools unreadable", { orgId: c.orgId, connectionId: c.id, reason });
    await noteRefusedSignIn(deps.db, c, error);
    // A connection marked to reconnect keeps its own reason.
    await deps.db
      .update(connectorConnections)
      .set({ lastError: reason })
      .where(and(eq(connectorConnections.id, c.id), eq(connectorConnections.status, "active")));
    throw new ToolsUnreadable(reason, { cause: error });
  }
  if (account) await keepAccount(deps.db, c, account);
  const composio = composioServiceOf(c.serverUrl);
  if (!composio) await seedToolPins(deps.db, c, listed);
  const writeTools = composio
    ? composio.way.actions.filter((a) => POSTING_ACTIONS.has(a)).map((a) => composioToolName(composio.way, a))
    : [];
  const existing = await deps.db.select().from(customTools).where(eq(customTools.connectionId, c.id));
  const byName = new Map(existing.map((t) => [t.name, t]));
  const cached = new Map<string, ToolClass>();
  const said = new Map(listed.map((t) => [t.name, (t.description ?? "").slice(0, 2000)]));
  for (const t of existing) {
    // The judge read the description: its answer holds only for that text.
    if (said.get(t.name) !== t.description) continue;
    if (t.suggestionSource === "judge" && ACCESS.includes(t.suggestedAccess as ToolAccess)) {
      cached.set(t.name, {
        level: t.suggestedAccess as ToolAccess,
        source: "judge",
        reason: (t.suggestionReason as ReasonCode | null) ?? "unknown",
        sensitive: false,
      });
    }
  }
  const classes = await classifyTools(listed, {
    orgId: c.orgId,
    server: c.label,
    judge: deps.judge,
    readTools: preset?.readTools,
    writeTools,
    cached,
  });
  const seen = new Set<string>();
  for (const tool of listed) {
    seen.add(tool.name);
    const old = byName.get(tool.name);
    const description = (tool.description ?? "").slice(0, 2000);
    const cls = classes.get(tool.name) ?? classifyByRules(tool, preset?.readTools, writeTools) ?? UNKNOWN_CLASS;
    const suggestion = {
      suggestedAccess: cls.level,
      suggestionSource: cls.source,
      suggestionReason: cls.reason,
      sensitive: cls.sensitive,
    };
    if (old) {
      const free = old.access === "read" || old.access === "write" ? old.access : null;
      const stricter = free && old.confirmedAt === null && ACCESS.indexOf(cls.level) > ACCESS.indexOf(free);
      await deps.db
        .update(customTools)
        .set({
          description,
          readOnlyHint: tool.readOnlyHint ?? null,
          destructiveHint: tool.destructiveHint ?? null,
          ...suggestion,
          ...(free && cls.sensitive ? { access: "approval" } : stricter ? { access: cls.level } : {}),
          removedAt: null,
        })
        .where(eq(customTools.id, old.id));
    } else {
      await deps.db.insert(customTools).values({
        orgId: c.orgId,
        connectionId: c.id,
        name: tool.name,
        description,
        readOnlyHint: tool.readOnlyHint ?? null,
        destructiveHint: tool.destructiveHint ?? null,
        ...suggestion,
        access: null,
        label: humanize(tool.name).slice(0, 120),
      });
    }
  }
  const gone = existing.filter((t) => !seen.has(t.name) && !t.removedAt).map((t) => t.id);
  if (gone.length > 0) {
    await deps.db.update(customTools).set({ removedAt: new Date() }).where(inArray(customTools.id, gone));
  }
  await deps.db
    .update(connectorConnections)
    .set({ updatedAt: new Date(), ...(c.status === "needs_reconnect" ? {} : { lastError: null }) })
    .where(eq(connectorConnections.id, c.id));
  caches.connections.delete(`${c.orgId}:active`);
  await refreshServerIcon(deps, c, info).catch(() => {});
}

/** The server as stored now (a listing may have just changed its icon). */
async function serverView(db: Database, orgId: string, id: string) {
  return view(await loadCustom(db, orgId, id), await toolRows(db, [id]));
}

/**
 * Connects an https MCP server by URL (admins): a new account, or with `connectionId` a new sign-in for that one
 * ("Reconectar", same address only). With an API key: stored and connected. Without: if it answers openly,
 * connected; if it speaks MCP OAuth with dynamic registration, the authorize URL comes back; otherwise `needs_key`.
 */
export async function connectCustomServer(
  deps: CustomDeps,
  actorId: string,
  orgId: string,
  input: { serverUrl: string; apiKey?: string; label?: string; returnTo?: string; connectionId?: string },
): Promise<CustomConnectStart> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  // A service through Composio signs in on Composio's page: its address is never fetched.
  if (composioToolkitOf(input.serverUrl.trim())) return beginComposioConnect(deps, actorId, orgId, input);
  const url = await assertPublicHttpsUrl(input.serverUrl.trim(), deps.resolveHost);
  const serverUrl = url.toString();
  // Checked before anyone signs in for nothing.
  if (input.connectionId) await reconnectTarget(deps.db, orgId, input.connectionId, serverUrl);
  const label = input.label?.trim() || presetForServer(serverUrl)?.label || url.hostname;
  const apiKey = input.apiKey?.trim();
  const stored = async (authType: "api_key" | "none", secret: ConnectionSecret | null) => {
    const { connection, outcome } = await storeCustomConnection(deps, {
      orgId,
      actorId,
      serverUrl,
      label,
      authType,
      secret,
      connectionId: input.connectionId,
    });
    await syncCustomTools(deps, connection).catch(() => {});
    return {
      status: "connected" as const,
      server: await serverView(deps.db, connection.orgId, connection.id),
      outcome,
    };
  };
  if (apiKey) {
    if (apiKey.length < 8) throw new ValidationError("The key looks too short", "connector.key_too_short");
    // The vendor's terms forbid asking for a token: on the Cloud it signs in only (ADR 0107).
    if (presetForServer(serverUrl)?.cloudOAuthOnly && isAgentesCloud(deps.publicUrl)) {
      throw new ValidationError("This service connects by signing in", "connector.oauth_only");
    }
    return stored("api_key", { apiKey });
  }
  const probe = await probeMcpServer(deps, serverUrl);
  if (probe.kind === "open") return stored("none", null);
  if (probe.kind === "needs_key") return { status: "needs_key" };
  return beginMcpOAuth(deps, actorId, orgId, {
    connector: "custom",
    serverUrl,
    label,
    resource: probe.resource,
    issuer: probe.issuer,
    scopes: probe.scopes,
    returnTo: input.returnTo,
    connectionId: input.connectionId,
  });
}

/**
 * Starts an MCP-native OAuth authorization: authorization server metadata,
 * a registered client (DCR), state + PKCE S256 + `resource`. `needs_key` when
 * the server can't do it, with `not_approved` when it only registers clients
 * it approved.
 */
export async function beginMcpOAuth(
  deps: McpOAuthDeps,
  actorId: string,
  orgId: string,
  input: {
    connector: string;
    serverUrl: string;
    label?: string;
    resource: string;
    issuer: string;
    scopes: string[];
    returnTo?: string;
    /** "Reconectar": the connection whose sign-in this replaces. */
    connectionId?: string;
  },
): Promise<Exclude<CustomConnectStart, { status: "connected" }>> {
  const meta = await authServerMetadata(deps, input.issuer);
  if (!meta) return { status: "needs_key" };
  const redirectUri = oauthRedirectUri(deps.publicUrl);
  // Worked out again each time: a client still in use keeps the scope it was registered with, maybe without
  // offline_access.
  const scope = oauthScope(meta, input.scopes);
  const client = await ensureOAuthClient(deps, orgId, input.issuer, meta, { redirectUri, scope });
  if (client && "notApproved" in client) {
    return { status: "needs_key", reason: "not_approved", ...(client.detail ? { detail: client.detail } : {}) };
  }
  if (!client) return { status: "needs_key" };
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  const sealed = await sealSecret(wrapper, verifier, stateAad(orgId, id));
  const returnTo = oauthReturnTo(input.returnTo);
  await deps.db.insert(oauthStates).values({
    id,
    orgId,
    connector: input.connector,
    userId: actorId,
    stateHash: sha256(state),
    verifierCiphertext: sealed.ciphertext,
    wrappedDataKey: sealed.wrappedDataKey,
    kekId: sealed.kekId,
    serverUrl: input.serverUrl,
    returnTo,
    oauthClientId: client.id,
    resource: input.resource,
    label: input.label ?? null,
    connectionId: input.connectionId ?? null,
    expiresAt: new Date((deps.now?.() ?? new Date()).getTime() + OAUTH_STATE_TTL_MS),
  });
  const url = new URL(client.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  if (scope) url.searchParams.set("scope", scope);
  return { status: "oauth", authorizeUrl: url.toString() };
}

/** Lists the tools again (admins). */
export async function refreshCustomServer(deps: CustomDeps, actorId: string, orgId: string, id: string) {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const c = await loadCustom(deps.db, orgId, id);
  // A server that can't be read comes back with `toolsError`, for the apps to say why and offer to try again.
  await syncCustomTools(deps, c).catch((error) => {
    if (!(error instanceof ToolsUnreadable)) throw error;
  });
  return serverView(deps.db, c.orgId, c.id);
}

/** A person's decision on one tool. `confirmed: false` = the suggestion applies, but it still waits for a decision. */
export interface ToolDecisionInput {
  name: string;
  access: ToolDecision;
  label: string;
  confirmed?: boolean;
}

/**
 * Saves the label and each tool's classification (admins). Only classified
 * tools are offered to agents; `approval` tools always ask a person; `off`
 * tools are never offered and don't wait for review. Sensitive tools may
 * only ask for approval or be off.
 */
export async function saveCustomTools(
  deps: CustomDeps,
  actorId: string,
  orgId: string,
  id: string,
  input: { label: string; tools: ToolDecisionInput[] },
) {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const c = await loadCustom(deps.db, orgId, id);
  const known = new Map((await toolRows(deps.db, [c.id])).map((t) => [t.name, t]));
  for (const t of input.tools) {
    if (!DECISIONS.includes(t.access)) throw new ValidationError(`Invalid access for ${t.name}`);
    const row = known.get(t.name);
    if (!row) throw new ValidationError(`Unknown tool ${t.name}`);
    if (row.sensitive && (t.access === "read" || t.access === "write")) {
      throw new ValidationError(
        `${t.name} is sensitive: it can only ask for approval or be off`,
        "connector.sensitive_tool",
        { tool: t.name },
      );
    }
  }
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    const asked = input.label.trim();
    const label = asked && asked !== c.label ? await checkLabel(tx, orgId, asked, c.id) : c.label;
    for (const t of input.tools) {
      const row = known.get(t.name);
      if (!row) continue;
      await tx
        .update(customTools)
        .set({
          access: t.access,
          label: t.label.trim().slice(0, 120) || row.label,
          ...(t.confirmed === false ? {} : { confirmedAt: row.confirmedAt ?? now }),
        })
        .where(eq(customTools.id, row.id));
    }
    await tx
      .update(connectorConnections)
      .set({ label, reviewedAt: now, updatedAt: now })
      .where(eq(connectorConnections.id, c.id));
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorId },
      action: "connector.custom_tools_classified",
      target: { type: "connector_connection", id: c.id },
      details: { tools: input.tools.map((t) => ({ name: t.name, access: t.access })) },
    });
  });
  caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${orgId}:`);
  return serverView(deps.db, orgId, id);
}

/** Classified, still-listed tools of a custom connection (the tool source exposes only these). */
export async function classifiedTools(db: Database, connectionId: string) {
  const rows = await toolRows(db, [connectionId]);
  return rows.filter((t) => ACCESS.includes(t.access as ToolAccess));
}

/**
 * Applies our suggestion to every tool not classified yet (admins), in one
 * call. Returns the server and the agents that don't have access to it yet,
 * so the app can offer to grant it.
 */
export async function acceptCustomSuggestion(deps: CustomDeps, actorId: string, orgId: string, id: string) {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const c = await loadCustom(deps.db, orgId, id);
  const rows = await toolRows(deps.db, [c.id]);
  const tools = rows.map((t): ToolDecisionInput => {
    let access = (
      DECISIONS.includes(t.access as ToolDecision)
        ? t.access
        : ACCESS.includes(t.suggestedAccess as ToolAccess)
          ? t.suggestedAccess
          : suggestAccess(t)
    ) as ToolDecision;
    if (t.sensitive && (access === "read" || access === "write")) access = "approval";
    // Accepting applies the suggestion; ambiguous tools still wait for a person's decision.
    return { name: t.name, access, label: t.label, confirmed: false };
  });
  const server = await saveCustomTools(deps, actorId, orgId, id, { label: c.label, tools });
  const grants = await deps.db
    .select({ agentId: agentScopes.agentId, scope: agentScopes.scope, connectionId: agentScopes.connectionId })
    .from(agentScopes)
    .where(eq(agentScopes.orgId, orgId));
  const withAccess = new Set(
    grants
      .filter((g) => g.scope === "*" || (g.connectionId === c.id && g.scope !== "" && !g.scope.startsWith("deny:")))
      .map((g) => g.agentId),
  );
  const agentRows = await deps.db
    .select({ id: agents.id, name: agents.name, handle: agents.handle })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt)));
  return {
    server,
    agentsWithoutAccess: agentRows.filter((a) => !withAccess.has(a.id)),
    /** Body for `PUT …/agents/{id}/access` that adds this server whole (merge with the agent's current access). */
    suggestedGrant: { connectors: { [c.id]: true } },
  };
}
