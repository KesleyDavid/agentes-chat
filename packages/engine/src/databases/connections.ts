import {
  type DatabaseClient,
  type DatabaseDriver,
  DatabaseError,
  type DatabaseRun,
  type DatabaseTarget,
  type KeyWrapper,
} from "@agenteschat/adapters";
import { and, asc, type Database, eq, inArray, isNull, schema, sql } from "@agenteschat/db";
import { recordAudit } from "../audit";
import { caches, TtlCache } from "../cache";
import { openSecret, sealSecret } from "../crypto";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { publicHostAddress, type ResolveHost, resolveHostDns } from "../net-guard";
import { requirePermission } from "../organizations";
import { identPath } from "./identifiers";

const { dbConnections, agentScopes } = schema;

export type DbConnectionRow = typeof dbConnections.$inferSelect;

/** What the database code needs (connections, tools). */
export interface DatabaseDeps {
  db: Database;
  /** Current wrapper first (seals), then legacy ones (open only). */
  keyWrappers: KeyWrapper[];
  /** Null/absent = the database connector is off on this server. */
  databases?: DatabaseDriver | null;
  /** DNS for the address guard (tests: fake). */
  resolveHost?: ResolveHost;
  now?: () => Date;
}

/** The one scope an agent holds on a database (`agent_scopes.connection_id` = the connection). Read-only for now. */
export const DATABASE_SCOPE = "database:read";

/** What people turn on or off for a database ("O que faz"); one tool each. */
export const DB_ACTIONS = ["list_tables", "describe_table", "query"] as const;
export type DbAction = (typeof DB_ACTIONS)[number];

/** Where the database lives (only for the help shown when connecting). */
export const DB_PROVIDERS = ["supabase", "neon", "railway", "rds", "render", "other"] as const;
export type DbProvider = (typeof DB_PROVIDERS)[number];

/** Why a connection test failed. */
export type DbTestError = "auth" | "unreachable" | "blocked_host" | "tls" | "no_databases" | "unknown";

export interface DatabaseConnectionView {
  id: string;
  label: string;
  provider: DbProvider;
  host: string;
  port: number;
  /** On a whole-server connection, the sample database (where the rules' tables come from). */
  database: string;
  /** Agents read every database of the server, one per call. */
  wholeServer: boolean;
  /** Whole server: only the databases whose names start with this; null = every one. */
  databasePrefix: string | null;
  /** Whole server: how many databases agents see, when the list was read in the last minutes; else null. */
  databaseCount: number | null;
  username: string;
  sslmode: "require" | "disable";
  status: "active" | "needs_reconnect";
  lastError: string | null;
  /** The user can change data: the app recommends a read-only one (agents only read anyway). */
  canWrite: boolean;
  createdAt: string;
  offActions: DbAction[];
  /** Columns hidden by default in agents' rules (`schema.table.column`). */
  suggestedHidden: string[];
  /** Agents that can read it. */
  agents: { agentId: string }[];
}

const aadFor = (orgId: string, id: string) => `db-connection|${orgId}|${id}`;

export function dbConnectionView(row: DbConnectionRow, agentIds?: Set<string>): DatabaseConnectionView {
  return {
    id: row.id,
    label: row.label,
    provider: ((DB_PROVIDERS as readonly string[]).includes(row.provider) ? row.provider : "other") as DbProvider,
    host: row.host,
    port: row.port,
    database: row.database,
    wholeServer: row.wholeServer,
    databasePrefix: row.databasePrefix,
    databaseCount: row.wholeServer ? (discovered.get(discoveryKey(row))?.length ?? null) : null,
    username: row.username,
    sslmode: row.sslmode === "disable" ? "disable" : "require",
    status: row.status === "needs_reconnect" ? "needs_reconnect" : "active",
    lastError: row.lastError,
    canWrite: row.canWrite,
    createdAt: row.createdAt.toISOString(),
    offActions: row.offActions.filter((a): a is DbAction => (DB_ACTIONS as readonly string[]).includes(a)),
    suggestedHidden: row.suggestedHidden,
    agents: [...(agentIds ?? [])].map((agentId) => ({ agentId })),
  };
}

/** Agents that can read each database (connection id → agent ids). */
export async function dbGrants(db: Database, orgId: string, connectionIds: string[]) {
  const out = new Map<string, Set<string>>();
  if (connectionIds.length === 0) return out;
  const rows = await db
    .select({ connectionId: agentScopes.connectionId, agentId: agentScopes.agentId })
    .from(agentScopes)
    .where(
      and(
        eq(agentScopes.orgId, orgId),
        inArray(agentScopes.connectionId, connectionIds),
        eq(agentScopes.scope, DATABASE_SCOPE),
      ),
    );
  for (const r of rows) {
    if (!r.connectionId) continue;
    const set = out.get(r.connectionId) ?? new Set<string>();
    set.add(r.agentId);
    out.set(r.connectionId, set);
  }
  return out;
}

/** The org's databases (not disconnected), oldest first. */
export async function orgDbConnections(db: Database, orgId: string) {
  return db
    .select()
    .from(dbConnections)
    .where(and(eq(dbConnections.orgId, orgId), isNull(dbConnections.revokedAt)))
    .orderBy(asc(dbConnections.createdAt), asc(dbConnections.id));
}

export async function listDatabaseConnections(db: Database, actorId: string, orgId: string) {
  await requirePermission(db, actorId, orgId, "read");
  const rows = await orgDbConnections(db, orgId);
  const grants = await dbGrants(
    db,
    orgId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => dbConnectionView(r, grants.get(r.id)));
}

export async function loadDbConnection(db: Database, orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(dbConnections)
    .where(and(eq(dbConnections.id, id), eq(dbConnections.orgId, orgId), isNull(dbConnections.revokedAt)));
  if (!row) throw new NotFoundError("Database not found", "database.not_found");
  return row;
}

export async function getDatabaseConnectionView(db: Database, orgId: string, id: string) {
  const row = await loadDbConnection(db, orgId, id);
  return dbConnectionView(row, (await dbGrants(db, orgId, [row.id])).get(row.id));
}

// ── Input ───────────────────────────────────────────────────────────────────

export interface DatabaseConnectionInput {
  label?: string;
  provider?: string;
  /** `postgres://user:password@host:port/database?sslmode=…`; the fields below win over it. */
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslmode?: "require" | "disable";
  /** Every database of the server (one per call); the database, if given, is where the rules' tables come from. */
  wholeServer?: boolean;
  /** Whole server: only the databases whose names start with this. */
  databasePrefix?: string;
}

interface Settings {
  host: string;
  port: number;
  /** Whole server: "" when none was given (an entry database is picked when connecting). */
  database: string;
  username: string;
  password: string;
  sslmode: "require" | "disable";
  wholeServer: boolean;
  databasePrefix: string | null;
}

type Address = Omit<Settings, "wholeServer" | "databasePrefix">;

/** The address and fields as one set of settings; throws on anything missing or malformed. */
export function databaseSettings(input: DatabaseConnectionInput, fallback?: Partial<Settings>): Settings {
  let fromUrl: Partial<Settings> = {};
  if (input.url?.trim()) {
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      throw new ValidationError(
        "The address must look like postgres://user:password@host:5432/database",
        "database.url",
      );
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      throw new ValidationError("The address must start with postgres://", "database.url");
    const ssl = url.searchParams.get("sslmode");
    fromUrl = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port ? Number(url.port) : undefined,
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      sslmode: ssl === "disable" ? "disable" : ssl ? "require" : undefined,
    };
  }
  const pick = <K extends keyof Settings>(k: K) => (input[k] ?? fromUrl[k] ?? fallback?.[k]) as Settings[K] | undefined;
  const host = String(pick("host") ?? "")
    .trim()
    .toLowerCase();
  const port = Number(pick("port") ?? 5432);
  const wholeServer = input.wholeServer ?? fallback?.wholeServer ?? false;
  const database = String(pick("database") ?? "").trim() || (wholeServer ? "" : "postgres");
  const prefix = wholeServer ? (input.databasePrefix ?? fallback?.databasePrefix ?? "").trim() : "";
  const username = String(pick("username") ?? "").trim();
  const password = String(pick("password") ?? "");
  const sslmode = pick("sslmode") === "disable" ? "disable" : "require";
  if (!host) throw new ValidationError("Give the database server", "database.host_required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError("Invalid port", "database.port");
  if (!username) throw new ValidationError("Give the database user", "database.user_required");
  if (!password) throw new ValidationError("Give the database password", "database.password_required");
  if (host.length > 253 || database.length > 63 || username.length > 63 || prefix.length > 63)
    throw new ValidationError("Too long", "database.too_long");
  return { host, port, database, username, password, sslmode, wholeServer, databasePrefix: prefix || null };
}

// ── Opening ─────────────────────────────────────────────────────────────────

/** Columns whose names say they hold secrets or personal data: hidden by default in agents' rules. */
const SENSITIVE_COLUMN =
  /(pass(word|wd)?|pwd|hash|secret|token|api_?key|private_?key|salt|otp|cpf|cnpj|ssn|passport|phone|telefone|celular|whatsapp|card|cartao|cvv|iban|account_number|tax_id|birth|nascimento)/i;

export const LIST_TABLES_SQL = `select n.nspname as schema, c.relname as name,
  case c.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else 'table' end as kind,
  greatest(c.reltuples, 0)::bigint as rows_estimate,
  obj_description(c.oid, 'pg_class') as comment
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
  and has_table_privilege(c.oid, 'SELECT')
order by 1, 2
limit 1000`;

const COLUMNS_SQL = `select n.nspname, c.relname, a.attname
from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped
  and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
order by 1, 2, a.attnum
limit 20000`;

const CAN_WRITE_SQL = `select coalesce((select rolsuper from pg_roles where rolname = current_user), false)
  or exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_toast%'
      and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE') or has_table_privilege(c.oid, 'DELETE'))
  ) as can_write`;

/** The limits of the connection test and the tools' catalog reads. */
export const CATALOG_LIMITS = { statementTimeoutMs: 10_000, searchPath: "public" };

const driverOf = (deps: Pick<DatabaseDeps, "databases">) => {
  if (!deps.databases) throw new ConflictError("Databases are off on this server", "database.disabled");
  return deps.databases;
};

/** Where to connect for these settings: a checked public address, or why not. */
async function targetFor(
  deps: DatabaseDeps,
  s: Address,
): Promise<{ ok: true; target: DatabaseTarget } | { ok: false; error: DbTestError }> {
  const r = await publicHostAddress(s.host, deps.resolveHost ?? resolveHostDns);
  if (!r.ok) return { ok: false, error: r.reason === "blocked" ? "blocked_host" : "unreachable" };
  const { host, port, database, username, password, sslmode } = s;
  return { ok: true, target: { host, port, database, username, password, sslmode, address: r.address } };
}

const testErrorOf = (error: unknown): DbTestError => {
  if (error instanceof DatabaseError) {
    if (error.code === "auth" || error.code === "unreachable" || error.code === "tls") return error.code;
    if (error.code === "timeout") return "unreachable";
  }
  return "unknown";
};

export interface DatabaseTestResult {
  version: string;
  tables: number;
  canWrite: boolean;
  suggestedHidden: string[];
  /** Whole server: the sample database read, and every database found. */
  database?: string;
  databases?: string[];
}

type Tested = { ok: true; result: DatabaseTestResult } | { ok: false; error: DbTestError };

/** Connects, reads the version, counts the tables, and checks whether the user can change data. */
async function testDatabase(deps: DatabaseDeps, s: Address): Promise<Tested> {
  const t = await targetFor(deps, s);
  if (!t.ok) return t;
  let client: DatabaseClient | null = null;
  try {
    client = await driverOf(deps).open(t.target);
    const result = await client.readOnly(CATALOG_LIMITS, async (run) => {
      const version = String((await run("select version()")).rows[0]?.[0] ?? "");
      const tables = (await run(LIST_TABLES_SQL)).rows.length;
      const canWrite = (await run(CAN_WRITE_SQL)).rows[0]?.[0] === true;
      return { version, tables, canWrite, suggestedHidden: await sensitiveColumns(run) };
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: testErrorOf(error) };
  } finally {
    await client?.close().catch(() => {});
  }
}

/**
 * The databases of a server the role can open (`$1`: a name prefix, '' = all). `pg_database` is shared,
 * so any database of the server lists them all.
 */
export const DATABASES_SQL = `select datname from pg_database
where not datistemplate and datallowconn
  and has_database_privilege(datname, 'CONNECT')
  and ($1::text = '' or starts_with(datname, $1::text))
order by 1 limit 2000`;

/** Where to read the list when the given database is gone or closed to the role. */
const ENTRY_DATABASES = ["postgres", "template1"];
const missingOrDenied = (error: unknown) =>
  error instanceof DatabaseError && (error.sqlState === "3D000" || error.sqlState === "42501");

async function readDatabases(run: DatabaseRun, prefix: string | null) {
  return (await run(DATABASES_SQL, [prefix ?? ""])).rows.map((r) => String(r[0]));
}

/**
 * Tries each entry database in turn (the next only when one doesn't exist or can't be opened), returning what
 * `read` returns from the first that works.
 */
async function fromEntry<T>(entries: string[], read: (database: string) => Promise<T>): Promise<T> {
  const list = [...new Set(entries)];
  for (const [i, database] of list.entries()) {
    try {
      return await read(database);
    } catch (error) {
      if (i === list.length - 1 || !missingOrDenied(error)) throw error;
    }
  }
  throw new Error("no entry database");
}

/**
 * Whole server: lists the databases from an entry database, then runs the usual test on the sample (the
 * database given, else the first found).
 */
async function testSettings(deps: DatabaseDeps, s: Settings): Promise<Tested> {
  if (!s.wholeServer) return testDatabase(deps, s);
  const t = await targetFor(deps, s);
  if (!t.ok) return t;
  let databases: string[];
  try {
    databases = await fromEntry([s.database, ...ENTRY_DATABASES].filter(Boolean), async (database) => {
      const client = await driverOf(deps).open({ ...t.target, database });
      try {
        return await client.readOnly(CATALOG_LIMITS, (run) => readDatabases(run, s.databasePrefix));
      } finally {
        await client.close().catch(() => {});
      }
    });
  } catch (error) {
    return { ok: false, error: testErrorOf(error) };
  }
  // The database given is only an entry when agents can't read it (outside the prefix, no CONNECT): the rules'
  // tables and sensitive columns come from one they can.
  const sample = s.database && databases.includes(s.database) ? s.database : databases[0];
  if (!sample) return { ok: false, error: "no_databases" };
  const tested = await testDatabase(deps, { ...s, database: sample });
  return tested.ok ? { ok: true, result: { ...tested.result, database: sample, databases } } : tested;
}

async function sensitiveColumns(run: DatabaseRun) {
  const rows = (await run(COLUMNS_SQL)).rows;
  return rows
    .filter((r) => SENSITIVE_COLUMN.test(String(r[2] ?? "")))
    .map((r) => identPath([String(r[0]), String(r[1]), String(r[2])]))
    .slice(0, 200);
}

/**
 * Pooled clients, one per (connection, database) at the connection's current version, closed after 5 minutes
 * unused; re-resolved when reopened. A whole-server connection keeps at most `MAX_POOLS_PER_CONNECTION` open
 * (2 sockets each), closing the least recently used.
 */
const clients = new Map<string, { version: number; client: Promise<DatabaseClient>; usedAt: number }>();
const IDLE_MS = 5 * 60_000;
export const MAX_POOLS_PER_CONNECTION = 8;
const poolKey = (connectionId: string, database: string) => `${connectionId}|${database}`;
const closeClient = (c: { client: Promise<DatabaseClient> }) => void c.client.then((x) => x.close()).catch(() => {});

async function passwordOf(deps: DatabaseDeps, row: DbConnectionRow) {
  return openSecret(
    deps.keyWrappers,
    { ciphertext: row.secretCiphertext, wrappedDataKey: row.wrappedDataKey, kekId: row.kekId },
    aadFor(row.orgId, row.id),
  );
}

/** A client for one database of a connection (backend only; its own database by default), from the pool. */
export async function clientFor(
  deps: DatabaseDeps,
  row: DbConnectionRow,
  database = row.database,
): Promise<DatabaseClient> {
  const now = Date.now();
  for (const [k, c] of clients) {
    if (now - c.usedAt > IDLE_MS) {
      clients.delete(k);
      closeClient(c);
    }
  }
  const key = poolKey(row.id, database);
  const version = row.updatedAt.getTime();
  const cached = clients.get(key);
  if (cached?.version === version) {
    cached.usedAt = now;
    return cached.client;
  }
  if (cached) {
    clients.delete(key);
    closeClient(cached);
  }
  const mine = [...clients].filter(([k]) => k.startsWith(`${row.id}|`)).sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [k, c] of mine.slice(0, Math.max(0, mine.length - MAX_POOLS_PER_CONNECTION + 1))) {
    clients.delete(k);
    closeClient(c);
  }
  const client = (async () => {
    const s: Address = {
      host: row.host,
      port: row.port,
      database,
      username: row.username,
      password: await passwordOf(deps, row),
      sslmode: row.sslmode === "disable" ? "disable" : "require",
    };
    const t = await targetFor(deps, s);
    if (!t.ok)
      throw new DatabaseError(
        t.error === "blocked_host" ? "This server is not allowed." : "The database server didn't answer.",
        "unreachable",
      );
    return driverOf(deps).open(t.target);
  })();
  clients.set(key, { version, client, usedAt: now });
  client.catch(() => clients.get(key)?.client === client && clients.delete(key));
  return client;
}

/** Forgets a connection's pooled clients, one per database it read (disconnect, new password). */
export function dropClient(connectionId: string) {
  for (const [k, c] of clients) {
    if (!k.startsWith(`${connectionId}|`)) continue;
    clients.delete(k);
    closeClient(c);
  }
}

/** The pools open for a connection, by database (tests). */
export const openPools = (connectionId: string) =>
  [...clients.keys()].filter((k) => k.startsWith(`${connectionId}|`)).map((k) => k.slice(connectionId.length + 1));

// ── A whole server's databases ──────────────────────────────────────────────

/**
 * The databases a whole-server connection sees, kept 5 minutes per connection version. Never stored in the row:
 * writing it would change `updated_at`, the pools' version, and reopen every pool.
 */
const discovered = new TtlCache<string[]>(5 * 60_000, 1000);
const discoveryKey = (row: Pick<DbConnectionRow, "id" | "updatedAt">) => `${row.id}:${row.updatedAt.getTime()}`;
const reloadedAt = new Map<string, number>();
const RELOAD_MS = 60_000;

/** The databases of a whole-server connection (the cached list unless `refresh`). */
export async function serverDatabases(
  deps: DatabaseDeps,
  row: DbConnectionRow,
  options: { refresh?: boolean } = {},
): Promise<string[]> {
  const key = discoveryKey(row);
  const hit = options.refresh ? undefined : discovered.get(key);
  if (hit) return hit;
  // The sample database first; if it was dropped, the server's usual ones.
  const names = await fromEntry([row.database, ...ENTRY_DATABASES], async (database) => {
    const client = await clientFor(deps, row, database);
    return client.readOnly(CATALOG_LIMITS, (run) => readDatabases(run, row.databasePrefix));
  });
  discovered.set(key, names);
  return names;
}

/**
 * Whether `name` is one of the connection's databases; a name not in the list reloads it once (at most once a
 * minute per connection) before saying no, so a customer's new database shows up without waiting.
 */
export async function isServerDatabase(deps: DatabaseDeps, row: DbConnectionRow, name: string) {
  if ((await serverDatabases(deps, row)).includes(name)) return true;
  const now = Date.now();
  if (now - (reloadedAt.get(row.id) ?? 0) < RELOAD_MS) return false;
  reloadedAt.set(row.id, now);
  return (await serverDatabases(deps, row, { refresh: true })).includes(name);
}

// ── Changes ─────────────────────────────────────────────────────────────────

/**
 * Connects a database (admins): tested first (address guard, TLS, login,
 * what the user can do); the password is sealed bound to (org, connection).
 * Returns the test's error instead of saving when it fails.
 */
export async function createDatabaseConnection(
  deps: DatabaseDeps,
  actorId: string,
  orgId: string,
  input: DatabaseConnectionInput,
): Promise<{ ok: true; connection: DatabaseConnectionView } | { ok: false; error: DbTestError }> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  driverOf(deps);
  const s = databaseSettings(input);
  const tested = await testSettings(deps, s);
  if (!tested.ok) return tested;
  const wrapper = deps.keyWrappers[0];
  if (!wrapper) throw new Error("no key wrapper");
  const id = crypto.randomUUID();
  const sealed = await sealSecret(wrapper, s.password, aadFor(orgId, id));
  const provider = (DB_PROVIDERS as readonly string[]).includes(input.provider ?? "") ? input.provider : "other";
  const database = tested.result.database ?? s.database;
  const [row] = await deps.db
    .insert(dbConnections)
    .values({
      id,
      orgId,
      label: input.label?.trim().slice(0, 80) || (s.wholeServer ? s.host : s.database),
      provider,
      host: s.host,
      port: s.port,
      database,
      wholeServer: s.wholeServer,
      databasePrefix: s.databasePrefix,
      username: s.username,
      sslmode: s.sslmode,
      secretCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      status: "active",
      canWrite: tested.result.canWrite,
      suggestedHidden: tested.result.suggestedHidden,
      createdByUserId: actorId,
    })
    .returning();
  if (!row) throw new Error("database connection insert returned nothing");
  if (tested.result.databases) discovered.set(discoveryKey(row), tested.result.databases);
  await recordAudit(deps.db, {
    orgId,
    actor: { type: "person", id: actorId },
    action: "database.connected",
    target: { type: "db_connection", id },
    details: {
      host: s.host,
      database,
      username: s.username,
      canWrite: tested.result.canWrite,
      ...wholeServerDetails(s, tested.result),
    },
  });
  return { ok: true, connection: dbConnectionView(row) };
}

const wholeServerDetails = (s: Settings, result: DatabaseTestResult) =>
  s.wholeServer ? { wholeServer: true, prefix: s.databasePrefix, databases: result.databases?.length ?? 0 } : {};

/** Renames, turns tools on or off, or (tested first) replaces the address or password or which databases it reads. */
export async function updateDatabaseConnection(
  deps: DatabaseDeps,
  actorId: string,
  orgId: string,
  connectionId: string,
  input: DatabaseConnectionInput & { offActions?: string[] },
): Promise<{ ok: true; connection: DatabaseConnectionView } | { ok: false; error: DbTestError }> {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const row = await loadDbConnection(deps.db, orgId, connectionId);
  const set: Partial<typeof dbConnections.$inferInsert> = {};
  if (input.label !== undefined)
    set.label = input.label.trim().slice(0, 80) || (row.wholeServer ? row.host : row.database);
  if (input.offActions !== undefined) {
    const unknown = input.offActions.filter((a) => !(DB_ACTIONS as readonly string[]).includes(a));
    if (unknown.length > 0) throw new ValidationError(`Unknown actions: ${unknown.join(", ")}`, "database.action");
    set.offActions = [...new Set(input.offActions)];
  }
  const reconnect = [input.url, input.host, input.port, input.database, input.username, input.password, input.sslmode];
  const scopeChanged =
    (input.wholeServer !== undefined && input.wholeServer !== row.wholeServer) ||
    (input.databasePrefix !== undefined && (input.databasePrefix.trim() || null) !== row.databasePrefix);
  let tested: DatabaseTestResult | null = null;
  if (scopeChanged || reconnect.some((v) => v !== undefined)) {
    const given = input.password !== undefined || !!input.url;
    const s = databaseSettings(input, {
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: given ? input.password : await passwordOf(deps, row),
      sslmode: row.sslmode === "disable" ? "disable" : "require",
      wholeServer: row.wholeServer,
      databasePrefix: row.databasePrefix,
    });
    // A stored password only goes to the server and user it was saved for.
    if (!given && (s.host !== row.host || s.port !== row.port || s.username !== row.username))
      throw new ValidationError("Give the database password", "database.password_required");
    const test = await testSettings(deps, s);
    if (!test.ok) return test;
    tested = test.result;
    const wrapper = deps.keyWrappers[0];
    if (!wrapper) throw new Error("no key wrapper");
    const sealed = await sealSecret(wrapper, s.password, aadFor(orgId, row.id));
    Object.assign(set, {
      host: s.host,
      port: s.port,
      database: tested.database ?? s.database,
      wholeServer: s.wholeServer,
      databasePrefix: s.databasePrefix,
      username: s.username,
      sslmode: s.sslmode,
      secretCiphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
      canWrite: tested.canWrite,
      status: "active",
      lastError: null,
    });
    dropClient(row.id);
  }
  if (Object.keys(set).length > 0) {
    const updatedAt = new Date();
    await deps.db
      .update(dbConnections)
      .set({ ...set, updatedAt })
      .where(eq(dbConnections.id, row.id));
    if (tested?.databases) discovered.set(discoveryKey({ id: row.id, updatedAt }), tested.databases);
    if (set.secretCiphertext) {
      await recordAudit(deps.db, {
        orgId,
        actor: { type: "person", id: actorId },
        action: "database.reconnected",
        target: { type: "db_connection", id: row.id },
        ...(set.wholeServer
          ? { details: { wholeServer: true, prefix: set.databasePrefix, databases: tested?.databases?.length ?? 0 } }
          : {}),
      });
    }
  }
  return { ok: true, connection: await getDatabaseConnectionView(deps.db, orgId, row.id) };
}

/** Disconnects a database (admins): agents lose access; the password is forgotten. */
export async function revokeDatabaseConnection(
  deps: DatabaseDeps,
  actorId: string,
  orgId: string,
  connectionId: string,
) {
  await requirePermission(deps.db, actorId, orgId, "manage_connectors");
  const row = await loadDbConnection(deps.db, orgId, connectionId);
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(dbConnections)
      .set({ revokedAt: now, updatedAt: now, secretCiphertext: "", wrappedDataKey: "", kekId: "" })
      .where(eq(dbConnections.id, row.id));
    await tx.delete(agentScopes).where(and(eq(agentScopes.orgId, orgId), eq(agentScopes.connectionId, row.id)));
    await recordAudit(tx, {
      orgId,
      actor: { type: "person", id: actorId },
      action: "database.disconnected",
      target: { type: "db_connection", id: row.id },
      details: { host: row.host, database: row.database },
    });
  });
  dropClient(row.id);
  caches.scopes.deletePrefix(`${orgId}:`);
}

/** The password was refused: a person must reconnect. */
export async function markDatabaseNeedsReconnect(db: Database, connectionId: string, reason: string) {
  await db
    .update(dbConnections)
    .set({ status: "needs_reconnect", lastError: reason.slice(0, 300) })
    .where(and(eq(dbConnections.id, connectionId), isNull(dbConnections.revokedAt)));
}

export interface DatabaseTable {
  schema: string;
  name: string;
  kind: string;
  rowsEstimate: number;
}

/** A database's tables (agents' rules picker) (admins); on a whole server, of `database` (default: the sample). */
export async function listDatabaseTables(
  deps: DatabaseDeps,
  actorId: string,
  orgId: string,
  connectionId: string,
  database?: string,
) {
  await requirePermission(deps.db, actorId, orgId, "manage_agents");
  const row = await loadDbConnection(deps.db, orgId, connectionId);
  const which = row.wholeServer && database ? database : row.database;
  if (which !== row.database && !(await isServerDatabase(deps, row, which)))
    throw new NotFoundError("Database not found", "database.not_found");
  const client = await clientFor(deps, row, which);
  const rows = await client.readOnly(CATALOG_LIMITS, async (run) => (await run(LIST_TABLES_SQL)).rows);
  return rows.map(
    (r): DatabaseTable => ({
      schema: String(r[0]),
      name: String(r[1]),
      kind: String(r[2]),
      rowsEstimate: Number(r[3] ?? 0),
    }),
  );
}

/** A whole-server connection's databases (agents' rules picker) (admins); `refresh` reads the list again. */
export async function listServerDatabases(
  deps: DatabaseDeps,
  actorId: string,
  orgId: string,
  connectionId: string,
  options: { refresh?: boolean } = {},
) {
  await requirePermission(deps.db, actorId, orgId, "manage_agents");
  const row = await loadDbConnection(deps.db, orgId, connectionId);
  if (!row.wholeServer) return [row.database];
  return serverDatabases(deps, row, options);
}

/** Every database connection id of an org, connected or not (grants on them are managed only by the database API). */
export const dbConnectionIdsSql = (orgId: string) =>
  sql`(select ${dbConnections.id} from ${dbConnections} where ${dbConnections.orgId} = ${orgId})`;
