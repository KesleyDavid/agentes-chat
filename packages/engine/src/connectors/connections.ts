import { createHash } from "node:crypto";
import type { KeyWrapper } from "@agenteschat/adapters";
import { and, asc, type Database, type Executor, eq, isNull, lt, or, schema, sql } from "@agenteschat/db";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type AuditEntry, recordAudit } from "../audit";
import { caches } from "../cache";
import { openSecret, randomToken, sealSecret, sha256 } from "../crypto";
import { ConflictError, ForbiddenError, MisconfiguredError, NotFoundError, ValidationError } from "../errors";
import { forgetInstallationTokens } from "../git/github-app";
import { outboundFetch, type ResolveHost } from "../net-guard";
import { requirePermission } from "../organizations";
import { CONNECTOR_ALL } from "../tools/scopes";
import { CONNECTOR_CATALOG, type ConnectorDefinition } from "./catalog";
import { type ComposioConnectors, completeComposioOAuth, forgetComposioAccount } from "./composio";
import { beginMcpOAuth, isCustom, storeCustomConnection } from "./custom";
import { offersCatalog } from "./listing";
import type { McpConnect } from "./mcp";
import { clientAuth, getOAuthClient, type McpOAuthDeps, probeMcpServer } from "./oauth-mcp";
import { oauthReturnTo } from "./oauth-return";
import { presetForServer } from "./presets";

const { connectorConnections, oauthStates, agentScopes, agents, approvalRules, githubAppInstallations } = schema;

export type ConnectorConnection = typeof connectorConnections.$inferSelect;

/** What connecting did: a new account, a new sign-in for one ("Reconectar"), or the same account again. */
export type ConnectOutcome = "connected" | "reconnected" | "same_account";

/** A label as tool names start with it: `Stripe` → `stripe`, `Ads Brasil!` → `ads_brasil`. */
export const toolPrefixOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "mcp";

/** The service a connection's tools are named after: its prefix without a later account's number (`stripe_2`). */
export const prefixService = (toolPrefix: string) => toolPrefix.replace(/_\d+$/, "");

/**
 * What a connection's tool names start with. A row the previous version stored while this one deployed has none:
 * its tools keep the names that version gave them, a catalog connector's id or a server's label as a slug.
 */
export const toolPrefixOfConnection = (c: Pick<ConnectorConnection, "connector" | "label" | "toolPrefix">) =>
  c.toolPrefix ?? (isCustom(c) ? toolPrefixOf(c.label) : c.connector);

const activeOf = (orgId: string) => and(eq(connectorConnections.orgId, orgId), isNull(connectorConnections.revokedAt));

/**
 * The first of `base`, `base_2`, `base_3`… that no live connection of the workspace starts its tools with. The id of a
 * catalog connector this server offers is kept for it (`own`: that connector's own connection), so tool names never
 * collide; one it doesn't offer (Linear without its OAuth app) is free for the one-click server standing in for it.
 */
export async function freeToolPrefix(tx: Executor, orgId: string, base: string, oauthApps?: OAuthApps, own?: string) {
  const rows = await tx
    .select({
      connector: connectorConnections.connector,
      label: connectorConnections.label,
      toolPrefix: connectorConnections.toolPrefix,
    })
    .from(connectorConnections)
    .where(activeOf(orgId));
  const kept = Object.keys(CONNECTOR_CATALOG).filter((id) => id !== own && offersCatalog(id, oauthApps));
  const taken = new Set([...rows.map(toolPrefixOfConnection), ...kept]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

async function labelsTaken(tx: Executor, orgId: string, exceptId?: string) {
  const rows = await tx
    .select({ id: connectorConnections.id, label: connectorConnections.label })
    .from(connectorConnections)
    .where(activeOf(orgId));
  return new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.label.toLowerCase()));
}

/** `base`, else `base 2`, `base 3`…: a name no other live connection of the workspace has. */
export async function freeLabel(tx: Executor, orgId: string, base: string) {
  const taken = await labelsTaken(tx, orgId);
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** A connection's name: 1 to 80 characters, and no other live connection of the workspace has it (409). */
export async function checkLabel(tx: Executor, orgId: string, label: string, connectionId: string) {
  const name = label.trim();
  if (name.length < 1 || name.length > 80) {
    throw new ValidationError("The name must have 1 to 80 characters", "connector.label_invalid");
  }
  if ((await labelsTaken(tx, orgId, connectionId)).has(name.toLowerCase())) {
    throw new ConflictError("Another connector already has this name", "connector.label_taken");
  }
  return name;
}

/** The headers a sign-in or a key opens the server with. */
export function bearerHeaders(secret: ConnectionSecret): Record<string, string> {
  const token = secret.apiKey ?? secret.accessToken;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * A new connection starts at "Ler e escrever" (`connector:*`) for every agent: agents get the basics and people take
 * access away where they want. Sensitive tools still ask a person on every call, whatever the grant. Connecting is an
 * admin's call, as giving grants is; each agent's grant is an `agent.access_changed` audit row. Runs in the caller's
 * transaction, which clears the org's scope cache once it commits.
 */
export async function grantToEveryAgent(
  tx: Executor,
  orgId: string,
  actorId: string,
  connection: Pick<ConnectorConnection, "id" | "label">,
) {
  const everyone = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, orgId), isNull(agents.archivedAt)));
  if (everyone.length === 0) return;
  await tx.insert(agentScopes).values(
    everyone.map((a) => ({
      orgId,
      agentId: a.id,
      connectionId: connection.id,
      scope: CONNECTOR_ALL,
      grantedByUserId: actorId,
    })),
  );
  for (const a of everyone) {
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorId },
      action: "agent.access_changed",
      target: { type: "agent", id: a.id },
      details: { connectionId: connection.id, label: connection.label, level: "write" },
    });
  }
}

/** OAuth app credentials per connector (from env; real apps are configured per deployment). */
export type OAuthApps = Record<string, { clientId: string; clientSecret: string } | undefined>;

/** What's stored (encrypted) for a connection. Never returned by any API. */
export interface ConnectionSecret {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
}

export interface ConnectorDeps {
  db: Database;
  /** Current wrapper first (seals), then legacy ones (open only). */
  keyWrappers: KeyWrapper[];
  oauthApps?: OAuthApps;
  /** Public base URL, for the OAuth redirect URI. */
  publicUrl: string;
  /** Injected in tests; real network otherwise. */
  http?: typeof fetch;
  /** DNS for the SSRF guard (tests: fake). */
  resolveHost?: ResolveHost;
  now?: () => Date;
  /** How to open MCP sessions (tests: in-process servers): the account a sign-in reached is asked with it. */
  connect?: McpConnect;
  /** Services through Composio (ADR 0107): null without `COMPOSIO_API_KEY`. */
  composio?: ComposioConnectors | null;
  /** Between reads of a Composio account still finishing its sign-in (tests: 0). */
  composioPollMs?: number;
}

const aadFor = (orgId: string, id: string) => `connector-connection|${orgId}|${id}`;
const stateAad = (orgId: string, id: string) => `oauth-state|${orgId}|${id}`;
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const oauthRedirectUri = (publicUrl: string) =>
  `${publicUrl.replace(/\/$/, "")}/api/app/connectors/oauth/callback`;

export function connectorDefinition(id: string): ConnectorDefinition {
  const def = CONNECTOR_CATALOG[id];
  if (!def) throw new ValidationError(`Unknown connector ${id}`);
  return def;
}

/**
 * The OAuth scopes a catalog connection's sign-in lacks that the catalog asks for now (GitHub's `project`): Reconectar
 * adds them. None for a key, a server's own sign-in or a sign-in we don't know the scopes of.
 */
export function missingOAuthScopes(c: Pick<ConnectorConnection, "connector" | "authType" | "oauthScopes">): string[] {
  const wanted = CONNECTOR_CATALOG[c.connector]?.oauth?.scopes;
  if (!wanted || c.authType !== "oauth" || c.oauthScopes === null) return [];
  const have = new Set(c.oauthScopes.split(/[\s,]+/));
  return wanted.filter((scope) => !have.has(scope));
}

/** Public view: no secrets. */
export const connectionView = (c: ConnectorConnection) => ({
  id: c.id,
  connector: c.connector,
  label: c.label,
  serverUrl: c.serverUrl,
  authType: c.authType,
  accountLabel: c.accountLabel,
  tokenExpiresAt: c.tokenExpiresAt ? c.tokenExpiresAt.toISOString() : null,
  createdAt: c.createdAt.toISOString(),
  revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
  reconnectAdds: missingOAuthScopes(c),
  status: c.status === "needs_reconnect" ? ("needs_reconnect" as const) : ("active" as const),
});

function checkServerUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError("serverUrl must be a URL");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "localhost")) {
    throw new ValidationError("serverUrl must use https");
  }
  return parsed.toString();
}

async function storeConnection(
  deps: ConnectorDeps,
  input: {
    orgId: string;
    actorId: string;
    connector: string;
    authType: "oauth" | "api_key" | "none";
    serverUrl: string;
    label?: string;
    secret: ConnectionSecret | null;
    tokenExpiresAt?: Date | null;
    accountLabel?: string | null;
    oauthClientId?: string | null;
    resource?: string | null;
    oauthScopes?: string | null;
  },
): Promise<{ connection: ConnectorConnection; outcome: ConnectOutcome }> {
  const def = connectorDefinition(input.connector);
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  const sealed = input.secret ? await sealSecret(wrapper, JSON.stringify(input.secret), aadFor(input.orgId, id)) : null;
  return deps.db.transaction(async (tx) => {
    // One active connection per connector: a new one replaces the old (grants move over); a first one is every agent's.
    const [previous] = await tx
      .update(connectorConnections)
      .set({ revokedAt: deps.now?.() ?? new Date() })
      .where(
        and(
          eq(connectorConnections.orgId, input.orgId),
          eq(connectorConnections.connector, input.connector),
          isNull(connectorConnections.revokedAt),
        ),
      )
      .returning();
    const [row] = await tx
      .insert(connectorConnections)
      .values({
        id,
        orgId: input.orgId,
        connector: input.connector,
        label: previous?.label ?? (await freeLabel(tx, input.orgId, input.label?.trim() || def.label)),
        toolPrefix: previous
          ? toolPrefixOfConnection(previous)
          : await freeToolPrefix(tx, input.orgId, def.id, deps.oauthApps, def.id),
        serverUrl: input.serverUrl,
        authType: input.authType,
        secretCiphertext: sealed?.ciphertext ?? null,
        wrappedDataKey: sealed?.wrappedDataKey ?? null,
        kekId: sealed?.kekId ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null,
        accountLabel: input.accountLabel ?? null,
        oauthClientId: input.oauthClientId ?? null,
        resource: input.resource ?? null,
        oauthScopes: input.oauthScopes ?? null,
        createdByUserId: input.actorId,
      })
      .returning();
    if (!row) throw new Error("connection insert returned nothing");
    if (previous) {
      await tx.update(agentScopes).set({ connectionId: row.id }).where(eq(agentScopes.connectionId, previous.id));
      // "Aprovar sempre" (and the git proxy's grants through it) moves with them: Reconectar never asks again.
      await tx.update(approvalRules).set({ connectionId: row.id }).where(eq(approvalRules.connectionId, previous.id));
    }
    // A custom server writes its own rows (`connector.custom_connected`, custom.ts).
    if (!input.connector.startsWith("custom:")) {
      await recordAudit(tx, {
        orgId: input.orgId,
        actor: { type: "person", id: input.actorId },
        action: previous ? "connector.reconnected" : "connector.connected",
        target: { type: "connector", id: row.id },
        details: { connector: input.connector, label: row.label, auth: input.authType },
      });
    }
    if (!previous) await grantToEveryAgent(tx, input.orgId, input.actorId, row);
    caches.connections.delete(`${input.orgId}:active`);
    caches.scopes.deletePrefix(`${input.orgId}:`);
    // Over GitHub through the app alone, an account is a first connection to people: never a "Reconectar".
    return {
      connection: row,
      outcome: previous && previous.authType !== GITHUB_APP_AUTH ? "reconnected" : "connected",
    };
  });
}

/** Connects with an API key (or a server that needs no auth). Admins only. */
export async function createApiKeyConnection(
  deps: ConnectorDeps,
  actorId: string,
  orgId: string,
  input: { connector: string; apiKey?: string; label?: string },
) {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const def = connectorDefinition(input.connector);
  const serverUrl = checkServerUrl(def.serverUrl);
  const apiKey = input.apiKey?.trim();
  if (apiKey !== undefined && apiKey.length < 8) throw new ValidationError("apiKey looks too short");
  const { connection } = await storeConnection(deps, {
    orgId,
    actorId,
    connector: input.connector,
    authType: apiKey ? "api_key" : "none",
    serverUrl,
    label: input.label,
    secret: apiKey ? { apiKey } : null,
  });
  return connection;
}

export async function listConnections(db: Database, actorId: string, orgId: string) {
  await requirePermission(db, actorId, orgId, "read");
  return db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.orgId, orgId),
        isNull(connectorConnections.revokedAt),
        // Custom servers have their own endpoints (`…/connectors/custom`).
        sql`${connectorConnections.connector} not like 'custom:%'`,
      ),
    )
    .orderBy(asc(connectorConnections.createdAt));
}

/**
 * Renames a connection, any kind (admins): it's how people and agents tell two accounts of a service apart. Its tools
 * keep their names (`tool_prefix`), so grants and denials of single tools keep applying.
 */
export async function renameConnection(db: Database, actorId: string, orgId: string, id: string, label: string) {
  await requirePermission(db, actorId, orgId, "manage_connectors");
  const row = await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(connectorConnections)
      .where(and(eq(connectorConnections.id, id), activeOf(orgId)));
    if (!c) throw new NotFoundError("Connection not found");
    if (label.trim() === c.label) return c;
    const name = await checkLabel(tx, orgId, label, c.id);
    const [row] = await tx
      .update(connectorConnections)
      .set({ label: name, updatedAt: new Date() })
      .where(eq(connectorConnections.id, c.id))
      .returning();
    if (!row) throw new Error("connection update returned nothing");
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorId },
      action: "connector.renamed",
      target: { type: "connector_connection", id: c.id },
      details: { from: c.label, to: name, label: name },
    });
    return row;
  });
  caches.connections.delete(`${orgId}:active`);
  return row;
}

/**
 * Best effort: tells the provider to drop this connection's token too (GitHub OAuth apps:
 * `DELETE /applications/{client_id}/token`). Never the whole grant: that would also revoke the tokens the same
 * GitHub account gave this server's app in its other workspaces. Never blocks disconnecting.
 */
export async function revokeAtProvider(deps: ConnectorDeps, orgId: string, connectionId: string) {
  const [c] = await deps.db
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.id, connectionId), eq(connectorConnections.orgId, orgId)));
  if (!c || c.revokedAt || c.connector !== "github" || c.authType !== "oauth") return false;
  const app = deps.oauthApps?.github;
  const secret = await openConnectionSecret(deps.keyWrappers, c).catch(() => null);
  if (!app || !secret?.accessToken) return false;
  const res = await (deps.http ?? fetch)(
    `https://api.github.com/applications/${encodeURIComponent(app.clientId)}/token`,
    {
      method: "DELETE",
      headers: {
        authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: secret.accessToken }),
    },
  ).catch(() => null);
  return Boolean(res && (res.status === 204 || res.status === 404));
}

/**
 * Disconnects: the secret stays sealed but unused; agents lose the connection's scopes and its "Aprovar sempre" rules.
 * A service through Composio: Composio then drops the account (`composio`), best effort, never revoking it there.
 * GitHub (ADR 0156): an account's connection in a workspace with GitHub App installations becomes GitHub through the
 * app alone (same row, its secret cleared, grants and rules kept); GitHub through the app alone unbinds them all.
 */
export async function revokeConnection(
  db: Database,
  actorId: string,
  orgId: string,
  connectionId: string,
  composio?: Pick<ComposioConnectors, "client"> | null,
) {
  await requirePermission(db, actorId, orgId, "manage_connectors");
  const actor = { type: "person" as const, id: actorId };
  const { gone, unbound } = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(connectorConnections)
      .where(and(eq(connectorConnections.id, connectionId), activeOf(orgId)))
      .for("update");
    if (!current) throw new NotFoundError("Connection not found");
    const accounts = current.connector === "github" ? await installationAccounts(tx, orgId) : [];
    if (accounts.length > 0 && current.authType !== GITHUB_APP_AUTH) {
      await tx
        .update(connectorConnections)
        .set({ ...APP_ALONE, accountLabel: accounts.join(", "), updatedAt: new Date() })
        .where(eq(connectorConnections.id, current.id));
      await recordAudit(tx, {
        orgId,
        actor,
        action: "connector.disconnected",
        target: { type: "connector", id: connectionId },
        details: { connector: current.connector, label: current.label, kept: GITHUB_APP_AUTH },
      });
      return { gone: null, unbound: [] };
    }
    const unbound =
      current.authType === GITHUB_APP_AUTH
        ? await tx
            .delete(githubAppInstallations)
            .where(eq(githubAppInstallations.orgId, orgId))
            .returning({ id: githubAppInstallations.id, installationId: githubAppInstallations.installationId })
        : [];
    for (const i of unbound) {
      await recordAudit(tx, {
        orgId,
        actor,
        action: "github_app.removed",
        target: { type: "github_app_installation", id: i.id },
        details: { installationId: i.installationId },
      });
    }
    return { gone: await dropConnection(tx, orgId, current, actor), unbound };
  });
  for (const i of unbound) forgetInstallationTokens(i.installationId);
  caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${orgId}:`);
  if (gone?.composioAccountId && composio) await forgetComposioAccount(composio.client, gone.composioAccountId);
}

/** Revokes a live connection in the caller's transaction: agents lose its scopes and its "Aprovar sempre" rules. */
async function dropConnection(tx: Executor, orgId: string, row: ConnectorConnection, actor: AuditEntry["actor"]) {
  await tx.update(connectorConnections).set({ revokedAt: new Date() }).where(eq(connectorConnections.id, row.id));
  await tx.delete(agentScopes).where(eq(agentScopes.connectionId, row.id));
  await tx.delete(approvalRules).where(eq(approvalRules.connectionId, row.id));
  await recordAudit(tx, {
    orgId,
    actor,
    action: "connector.disconnected",
    target: { type: "connector", id: row.id },
    details: { connector: row.connector, label: row.label },
  });
  return row;
}

/** `auth_type` of GitHub through the workspace's GitHub App installations alone (ADR 0156): no secret of its own. */
export const GITHUB_APP_AUTH = "github_app";

/** What a GitHub connection keeps of an account once only the app is left. */
const APP_ALONE = {
  authType: GITHUB_APP_AUTH,
  secretCiphertext: null,
  wrappedDataKey: null,
  kekId: null,
  tokenExpiresAt: null,
  accountId: null,
  oauthClientId: null,
  resource: null,
  oauthScopes: null,
  refreshingUntil: null,
};

/** The GitHub accounts of the workspace's GitHub App installations, in the order they were bound. */
async function installationAccounts(tx: Executor, orgId: string) {
  const rows = await tx
    .select({ login: githubAppInstallations.accountLogin })
    .from(githubAppInstallations)
    .where(eq(githubAppInstallations.orgId, orgId))
    .orderBy(asc(githubAppInstallations.createdAt));
  return rows.map((r) => r.login);
}

/**
 * Keeps the workspace's GitHub connection in step with its GitHub App installations (ADR 0156), in the caller's
 * transaction: with installations and no GitHub connection, the app alone is one, made by the person binding it
 * (every agent's, like any first connection: grants, rules and the git proxy work as with an account's); a row of the
 * app alone names their accounts, and ends with the last one, as disconnecting does. An account's own connection is
 * left as it is: the app's tokens are used where it is installed anyway.
 */
export async function syncGitHubAppConnection(
  tx: Executor,
  orgId: string,
  actor: AuditEntry["actor"],
  oauthApps?: OAuthApps,
) {
  const accounts = await installationAccounts(tx, orgId);
  const [current] = await tx
    .select()
    .from(connectorConnections)
    .where(and(activeOf(orgId), eq(connectorConnections.connector, "github")))
    .for("update");
  const label = accounts.join(", ");
  if (current && current.authType !== GITHUB_APP_AUTH) return;
  if (current && accounts.length === 0) await dropConnection(tx, orgId, current, actor);
  else if (current && current.accountLabel !== label) {
    await tx
      .update(connectorConnections)
      .set({ accountLabel: label, updatedAt: new Date() })
      .where(eq(connectorConnections.id, current.id));
  } else if (!current && accounts.length > 0 && actor.type === "person" && actor.id) {
    const def = connectorDefinition("github");
    const [row] = await tx
      .insert(connectorConnections)
      .values({
        orgId,
        connector: def.id,
        label: await freeLabel(tx, orgId, def.label),
        toolPrefix: await freeToolPrefix(tx, orgId, def.id, oauthApps, def.id),
        serverUrl: def.serverUrl,
        authType: GITHUB_APP_AUTH,
        accountLabel: label,
        createdByUserId: actor.id,
      })
      .returning();
    if (!row) throw new Error("connection insert returned nothing");
    await recordAudit(tx, {
      orgId,
      actor,
      action: "connector.connected",
      target: { type: "connector", id: row.id },
      details: { connector: def.id, label: row.label, auth: GITHUB_APP_AUTH },
    });
    await grantToEveryAgent(tx, orgId, actor.id, row);
  } else return;
  caches.connections.delete(`${orgId}:active`);
  caches.scopes.deletePrefix(`${orgId}:`);
}

export async function activeConnections(db: Database, orgId: string) {
  return caches.connections.getOrLoad(`${orgId}:active`, () => loadActiveConnections(db, orgId)) as Promise<
    ConnectorConnection[]
  >;
}

async function loadActiveConnections(db: Database, orgId: string) {
  return db
    .select()
    .from(connectorConnections)
    .where(and(eq(connectorConnections.orgId, orgId), isNull(connectorConnections.revokedAt)));
}

/** Decrypts a connection's secret. Backend only (the MCP client is its only caller). */
export async function openConnectionSecret(
  keyWrappers: KeyWrapper[],
  c: ConnectorConnection,
): Promise<ConnectionSecret | null> {
  if (!c.secretCiphertext || !c.wrappedDataKey || !c.kekId) return null;
  const json = await openSecret(
    keyWrappers,
    { ciphertext: c.secretCiphertext, wrappedDataKey: c.wrappedDataKey, kekId: c.kekId },
    aadFor(c.orgId, c.id),
  );
  return JSON.parse(json) as ConnectionSecret;
}

// ── OAuth (authorization code + state + PKCE S256) ───────────────────────────

const base64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Starts connecting a connector over OAuth. Returns the provider's authorize
 * URL. State is random and single use (only its hash is stored); the PKCE
 * verifier is sealed. Admins only.
 */
export async function startOAuth(
  deps: ConnectorDeps,
  actorId: string,
  orgId: string,
  connector: string,
  options: { returnTo?: string } = {},
): Promise<{ authorizeUrl: string; state: string }> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const def = connectorDefinition(connector);
  const app = deps.oauthApps?.[connector];
  const serverUrl = checkServerUrl(def.serverUrl);
  if (!def.oauth || !app) {
    // A catalog entry without a fixed OAuth app uses the server's own MCP OAuth (discovery + registration).
    const native =
      def.auth.includes("oauth") && !def.oauth
        ? await nativeAuthorizeUrl(deps, actorId, orgId, connector, serverUrl, options.returnTo)
        : null;
    if (native) return { authorizeUrl: native, state: "" };
    throw new ValidationError(`OAuth for ${def.label} is not configured on this server`);
  }
  const returnTo = oauthReturnTo(options.returnTo);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  const sealed = await sealSecret(wrapper, verifier, stateAad(orgId, id));
  await deps.db.insert(oauthStates).values({
    id,
    orgId,
    connector,
    userId: actorId,
    stateHash: sha256(state),
    verifierCiphertext: sealed.ciphertext,
    wrappedDataKey: sealed.wrappedDataKey,
    kekId: sealed.kekId,
    serverUrl,
    returnTo,
    expiresAt: new Date((deps.now?.() ?? new Date()).getTime() + OAUTH_STATE_TTL_MS),
  });
  const url = new URL(def.oauth.authorizeUrl);
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(deps.publicUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", def.oauth.scopes.join(def.oauth.scopeSeparator ?? " "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizeUrl: url.toString(), state };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** What the provider granted (GitHub: comma-separated). */
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * A token endpoint's `error` that refuses the client itself (its id or secret), never the person's sign-in: OAuth's
 * `invalid_client` (RFC 6749 §5.2) and GitHub's `incorrect_client_credentials`.
 */
export const clientRefused = (error: unknown) => error === "invalid_client" || error === "incorrect_client_credentials";

/**
 * The fetch for a token endpoint an authorization server's metadata named (MCP OAuth), where a built-in connector's
 * fixed one goes straight: checked and pinned at every exchange and refresh, and a redirect is never followed, so
 * the form (the code, the refresh token, the client's secret) only goes to a public address.
 */
const namedTokenFetch = (deps: ConnectorDeps) => deps.http ?? outboundFetch({ resolveHost: deps.resolveHost });

/** `ownApp`: the connector, when the client is this server's own OAuth app for it (`oauthApps`). */
async function tokenRequest(
  deps: ConnectorDeps,
  url: string,
  form: Record<string, string | undefined>,
  headers: Record<string, string> = {},
  ownApp?: ConnectorDefinition,
  http: typeof fetch = deps.http ?? fetch,
): Promise<TokenResponse> {
  const res = await http(url, {
    method: "POST",
    // The form carries the code, the refresh token and the client's secret: they go to the address asked, never on.
    redirect: "error",
    // Well inside a refresh's 30 s lease (`refreshOnce`), which the other calls for that connection wait on.
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...headers },
    body: new URLSearchParams(
      Object.entries(form).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    const said = `The provider refused the authorization: ${body.error_description ?? body.error ?? res.status}`;
    if (ownApp && clientRefused(body.error)) {
      throw new MisconfiguredError(
        `${ownApp.label} refused this server's OAuth app for the ${ownApp.id} connector (a wrong client id or secret): ${body.error_description ?? body.error}`,
        "connector.misconfigured",
        { provider: ownApp.label },
      );
    }
    // Its own answer (some say `error` with a 200): a 5xx or a 429 is the provider busy, not the sign-in gone.
    throw res.status < 500 && res.status !== 429 ? new TokenRefused(said) : new ValidationError(said);
  }
  return body;
}

/** The provider answered a token request with no: the sign-in it was made with no longer works. */
export class TokenRefused extends ValidationError {}

/**
 * A connection whose sign-in stopped working (a refresh refused, a server answering 401, a Composio account gone): no
 * tools until Reconectar, which makes a sign-in anew. Its row and the agents' listings say so.
 */
export async function markToReconnect(
  db: Database,
  connection: Pick<ConnectorConnection, "id" | "orgId">,
  reason: string,
) {
  await db
    .update(connectorConnections)
    .set({ status: "needs_reconnect", lastError: reason.slice(0, 300), updatedAt: new Date() })
    .where(and(eq(connectorConnections.id, connection.id), isNull(connectorConnections.revokedAt)));
  caches.connections.delete(`${connection.orgId}:active`);
}

/**
 * A server that refused the connection's credentials (HTTP 401) marks it to reconnect, never through Composio: its
 * refusals say whose they are (`composioFailure`).
 */
export async function noteRefusedSignIn(db: Database, connection: ConnectorConnection, error: unknown) {
  if (!(error instanceof StreamableHTTPError) || error.code !== 401 || connection.composioAccountId) return;
  await markToReconnect(db, connection, error.message);
}

/**
 * What a state stands for, without using it up: who started it, in which organization, for which connector, and where
 * it lands. Null when it is unknown, used or expired. The callback reads it to know whether the phone app started
 * the authorization (the app then finishes it with its own session).
 */
export async function peekOAuthState(
  deps: Pick<ConnectorDeps, "db" | "now">,
  state: string,
): Promise<{ orgId: string; userId: string; connector: string; returnTo: string } | null> {
  const at = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select({
      orgId: oauthStates.orgId,
      userId: oauthStates.userId,
      connector: oauthStates.connector,
      returnTo: oauthStates.returnTo,
      usedAt: oauthStates.usedAt,
      expiresAt: oauthStates.expiresAt,
    })
    .from(oauthStates)
    .where(eq(oauthStates.stateHash, sha256(state)));
  if (!row || row.usedAt || row.expiresAt <= at) return null;
  return { orgId: row.orgId, userId: row.userId, connector: row.connector, returnTo: row.returnTo };
}

/**
 * OAuth callback: checks state (exists, unused, not expired, same person),
 * exchanges the code with the PKCE verifier, and stores the tokens sealed.
 */
export async function completeOAuth(
  deps: ConnectorDeps,
  user: { id: string },
  input: { state: string; code: string },
): Promise<{ connection: ConnectorConnection; returnTo: string; outcome: ConnectOutcome }> {
  const at = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select()
    .from(oauthStates)
    .where(eq(oauthStates.stateHash, sha256(input.state)));
  if (row?.usedAt) throw new ConflictError("This authorization link was already used", "oauth.link_used");
  if (!row || row.expiresAt <= at)
    throw new ConflictError("This authorization link is invalid or expired", "oauth.link_expired");
  if (row.userId !== user.id)
    throw new ForbiddenError("Finish connecting with the account that started it", "oauth.other_account");
  const claimed = await deps.db
    .update(oauthStates)
    .set({ usedAt: at })
    .where(and(eq(oauthStates.id, row.id), isNull(oauthStates.usedAt)))
    .returning({ id: oauthStates.id });
  if (claimed.length === 0) throw new ConflictError("This authorization link was already used", "oauth.link_used");
  // Still an admin? (Roles can change during the round trip.)
  await requirePermission(deps.db, user.id, row.orgId, "manage_connectors");

  if (row.composioAccountId) return completeComposioOAuth(deps, user, row, input.code);
  if (row.oauthClientId) return completeMcpOAuth(deps, user, row, input.code, at);
  const def = connectorDefinition(row.connector);
  const app = deps.oauthApps?.[row.connector];
  if (!def.oauth || !app) throw new ValidationError(`OAuth for ${def.label} is not configured on this server`);
  const verifier = await stateVerifier(deps, row);
  const token = await tokenRequest(
    deps,
    def.oauth.tokenUrl,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: oauthRedirectUri(deps.publicUrl),
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code_verifier: verifier,
    },
    {},
    def,
  );
  const stored = await storeConnection(deps, {
    orgId: row.orgId,
    actorId: user.id,
    connector: row.connector,
    authType: "oauth",
    serverUrl: checkServerUrl(row.serverUrl ?? def.serverUrl),
    secret: { accessToken: token.access_token, refreshToken: token.refresh_token },
    tokenExpiresAt: token.expires_in ? new Date(at.getTime() + token.expires_in * 1000) : null,
    // An empty `scope` (a GitHub App's client, which has no scopes) is unknown, never "none granted".
    oauthScopes:
      (typeof token.scope === "string" ? token.scope.split(/[\s,]+/) : def.oauth.scopes).filter(Boolean).join(" ") ||
      null,
  });
  return { ...stored, returnTo: row.returnTo };
}

/** This process's refreshes in flight, by connection id: calls that need the same one share it. */
const refreshing = new Map<string, Promise<ConnectionSecret | null>>();

/**
 * Credentials to call a connection's MCP server, refreshing an OAuth token
 * that expires within a minute. Returns the HTTP headers to send.
 */
export async function connectionHeaders(deps: ConnectorDeps, c: ConnectorConnection): Promise<Record<string, string>> {
  const secret = await openConnectionSecret(deps.keyWrappers, c);
  if (!secret) return {};
  if (secret.apiKey) {
    return { authorization: `${presetForServer(c.serverUrl)?.keyScheme ?? "Bearer"} ${secret.apiKey}` };
  }
  const at = deps.now?.() ?? new Date();
  if (!expiring(c, secret, at)) return bearer(secret);
  let pending = refreshing.get(c.id);
  if (!pending) {
    pending = refreshOnce(deps, c.id, at).finally(() => refreshing.delete(c.id));
    refreshing.set(c.id, pending);
  }
  const fresh = await pending;
  caches.connections.delete(`${c.orgId}:active`);
  return fresh ? bearer(fresh) : {};
}

const expiring = (c: ConnectorConnection, secret: ConnectionSecret, at: Date) =>
  Boolean(secret.refreshToken && c.tokenExpiresAt && c.tokenExpiresAt.getTime() - at.getTime() < 60_000);

const bearer = (secret: ConnectionSecret): Record<string, string> =>
  secret.accessToken ? { authorization: `Bearer ${secret.accessToken}` } : {};

/**
 * One refresh at a time per connection, across processes: many servers rotate the refresh token, so a second
 * refresh with the one just spent fails and breaks the connection. The call that takes the row's lease
 * (`refreshing_until`) asks the provider, with no transaction open while it answers (native mode's PGlite would hold
 * every other query until then); the others read the row until its tokens change, or the lease ends and one of them
 * takes it. Null when the row has no tokens.
 */
async function refreshOnce(deps: ConnectorDeps, id: string, at: Date): Promise<ConnectionSecret | null> {
  const read = async () =>
    (await deps.db.select().from(connectorConnections).where(eq(connectorConnections.id, id)))[0];
  const row = await read();
  const stored = row ? await openConnectionSecret(deps.keyWrappers, row) : null;
  if (!row?.secretCiphertext || !stored) return null;
  if (!expiring(row, stored, at)) return stored;
  const old = row.secretCiphertext;
  for (;;) {
    const [leased] = await deps.db
      .update(connectorConnections)
      .set({ refreshingUntil: sql`now() + interval '30 seconds'` })
      .where(
        and(
          eq(connectorConnections.id, id),
          eq(connectorConnections.secretCiphertext, old),
          or(isNull(connectorConnections.refreshingUntil), lt(connectorConnections.refreshingUntil, sql`now()`)),
        ),
      )
      .returning({ id: connectorConnections.id });
    if (leased) {
      try {
        return (await refreshTokens(deps, row, stored, at)) ?? stored;
      } catch (error) {
        if (error instanceof TokenRefused) await markToReconnect(deps.db, row, error.message);
        throw error;
      } finally {
        // Left alone (the process died), the lease ends by itself.
        await deps.db
          .update(connectorConnections)
          .set({ refreshingUntil: null })
          .where(eq(connectorConnections.id, id))
          .catch(() => {});
      }
    }
    const latest = await read();
    if (!latest?.secretCiphertext) return null;
    if (latest.secretCiphertext !== old) return openConnectionSecret(deps.keyWrappers, latest);
    await Bun.sleep(200);
  }
}

/**
 * New tokens from the connection's registered client (MCP OAuth, for the resource it was authorized for) or our OAuth
 * app, sealed in its row unless it got other tokens meanwhile (a reconnect). Null when neither can refresh it.
 */
async function refreshTokens(
  deps: ConnectorDeps,
  c: ConnectorConnection,
  secret: ConnectionSecret,
  at: Date,
): Promise<ConnectionSecret | null> {
  const refresh = { grant_type: "refresh_token", refresh_token: secret.refreshToken };
  const client = c.oauthClientId ? await getOAuthClient(deps.db, c.oauthClientId) : null;
  let token: TokenResponse;
  if (client) {
    const auth = await clientAuth(deps.keyWrappers, client);
    token = await tokenRequest(
      deps,
      client.tokenEndpoint,
      { ...refresh, resource: c.resource ?? undefined, ...auth.form },
      auth.headers,
      undefined,
      namedTokenFetch(deps),
    );
  } else {
    const def = c.connector.startsWith("custom:") ? null : connectorDefinition(c.connector);
    const app = deps.oauthApps?.[c.connector];
    if (!def?.oauth || !app) return null;
    token = await tokenRequest(deps, def.oauth.tokenUrl, {
      ...refresh,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    });
  }
  const next: ConnectionSecret = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? secret.refreshToken,
  };
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const sealed = await sealSecret(wrapper, JSON.stringify(next), aadFor(c.orgId, c.id));
  // No `updatedAt`: a new token for the same sign-in lists the same tools, and the tool listing cache is keyed on it.
  await deps.db
    .update(connectorConnections)
    .set({
      secretCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      tokenExpiresAt: token.expires_in ? new Date(at.getTime() + token.expires_in * 1000) : null,
    })
    .where(and(eq(connectorConnections.id, c.id), eq(connectorConnections.secretCiphertext, c.secretCiphertext ?? "")));
  return next;
}

/** Validates a connector grant: the connection is active in the org and the scope is in its catalog. */
export const connectorGrantValidator = async (
  db: Database,
  orgId: string,
  grant: { connectionId: string | null; scope: string },
): Promise<string | null> => {
  if (!grant.connectionId) return null;
  const [c] = await db
    .select()
    .from(connectorConnections)
    .where(
      and(
        eq(connectorConnections.id, grant.connectionId),
        eq(connectorConnections.orgId, orgId),
        isNull(connectorConnections.revokedAt),
      ),
    );
  if (!c) return "connectionId is not an active connection of this organization";
  if (c.connector.startsWith("custom:")) {
    return grant.scope === `custom:${c.id}:read` || grant.scope === `custom:${c.id}:write`
      ? null
      : `Unknown scope ${grant.scope} for this server`;
  }
  const def = CONNECTOR_CATALOG[c.connector];
  const [prefix, scope] = grant.scope.split(":");
  if (!def || prefix !== c.connector || !scope || !Object.hasOwn(def.scopes, scope)) {
    return `Unknown scope ${grant.scope} for ${c.connector}`;
  }
  return null;
};

/** The PKCE verifier an authorization was started with (a Composio sign-in has none). */
async function stateVerifier(deps: ConnectorDeps, row: typeof oauthStates.$inferSelect) {
  if (!row.verifierCiphertext || !row.wrappedDataKey || !row.kekId) {
    throw new ConflictError("This authorization link is invalid or expired");
  }
  return openSecret(
    deps.keyWrappers,
    { ciphertext: row.verifierCiphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId },
    stateAad(row.orgId, row.id),
  );
}

/** Catalog connector without a registered app: the server's own MCP OAuth, if it has one. */
async function nativeAuthorizeUrl(
  deps: ConnectorDeps & McpOAuthDeps,
  actorId: string,
  orgId: string,
  connector: string,
  serverUrl: string,
  returnTo?: string,
) {
  const probe = await probeMcpServer(deps, serverUrl).catch(() => null);
  if (probe?.kind !== "oauth") return null;
  const started = await beginMcpOAuth(deps, actorId, orgId, {
    connector,
    serverUrl,
    resource: probe.resource,
    issuer: probe.issuer,
    scopes: probe.scopes,
    returnTo,
  });
  return started.status === "oauth" ? started.authorizeUrl : null;
}

/** Callback of an MCP-native authorization: token with PKCE and `resource`, then the connection. */
async function completeMcpOAuth(
  deps: ConnectorDeps,
  user: { id: string },
  row: typeof oauthStates.$inferSelect,
  code: string,
  at: Date,
): Promise<{ connection: ConnectorConnection; returnTo: string; outcome: ConnectOutcome }> {
  const client = row.oauthClientId ? await getOAuthClient(deps.db, row.oauthClientId) : null;
  if (!client) throw new ValidationError("The authorization server registration is missing");
  const verifier = await stateVerifier(deps, row);
  const auth = await clientAuth(deps.keyWrappers, client);
  const token = await tokenRequest(
    deps,
    client.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: oauthRedirectUri(deps.publicUrl),
      code_verifier: verifier,
      ...(row.resource ? { resource: row.resource } : {}),
      ...auth.form,
    },
    auth.headers,
    undefined,
    namedTokenFetch(deps),
  );
  const secret = { accessToken: token.access_token, refreshToken: token.refresh_token };
  const tokenExpiresAt = token.expires_in ? new Date(at.getTime() + token.expires_in * 1000) : null;
  const serverUrl = row.serverUrl ?? "";
  if (row.connector === "custom") {
    const stored = await storeCustomConnection(deps, {
      orgId: row.orgId,
      actorId: user.id,
      serverUrl,
      label: row.label ?? new URL(serverUrl).hostname,
      authType: "oauth",
      secret,
      tokenExpiresAt,
      oauthClientId: client.id,
      resource: row.resource,
      connectionId: row.connectionId,
    });
    return { ...stored, returnTo: row.returnTo };
  }
  const stored = await storeConnection(deps, {
    orgId: row.orgId,
    actorId: user.id,
    connector: row.connector,
    authType: "oauth",
    serverUrl: checkServerUrl(serverUrl),
    secret,
    tokenExpiresAt,
    oauthClientId: client.id,
    resource: row.resource,
  });
  return { ...stored, returnTo: row.returnTo };
}
