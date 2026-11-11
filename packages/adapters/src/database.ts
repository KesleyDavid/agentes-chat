import { isIP } from "node:net";
import postgres from "postgres";

/**
 * People's Postgres databases for agents (ADR 0039): the engine opens one
 * client per connection and runs every agent query through `readOnly`.
 * The real driver is postgres.js; tests use `createFakeDatabaseDriver` over
 * PGlite (no network).
 */
export interface DatabaseTarget {
  /** The name people typed (TLS server name, messages). */
  host: string;
  /** Where to connect: an address the engine resolved and checked (never inside our network). */
  address: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** `require`: TLS without checking the certificate (like libpq); `disable`: plain (test databases only). */
  sslmode: "require" | "disable";
}

/** Why a database call failed: `auth` (wrong user or password), `unreachable`, `tls`, `timeout`, `query` (the SQL itself). */
export type DatabaseErrorCode = "auth" | "unreachable" | "tls" | "timeout" | "query" | "unknown";

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: DatabaseErrorCode,
    /** Postgres's SQLSTATE when it sent one (`3D000`: no such database, `42501`: no privilege). */
    readonly sqlState?: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export interface DatabaseRows {
  columns: { name: string; type: number }[];
  rows: unknown[][];
}

export type DatabaseRun = (text: string, params?: unknown[]) => Promise<DatabaseRows>;

export interface DatabaseLimits {
  /** Each statement is cancelled past this. */
  statementTimeoutMs: number;
  /** Unqualified names resolve here first (pg_catalog is always searched). */
  searchPath?: string;
}

export interface DatabaseClient {
  /**
   * Runs `fn` inside `BEGIN TRANSACTION READ ONLY` with the limits set
   * locally (statement and lock timeouts), then rolls back.
   */
  readOnly<T>(limits: DatabaseLimits, fn: (run: DatabaseRun) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DatabaseDriver {
  open(target: DatabaseTarget): Promise<DatabaseClient>;
}

const LOCK_TIMEOUT_MS = 2_000;
const IDLE_IN_TX_MS = 30_000;
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The `set local …` statements of a read-only transaction. */
export function readOnlySettings(limits: DatabaseLimits): string[] {
  const ms = Math.max(100, Math.min(120_000, Math.round(limits.statementTimeoutMs)));
  return [
    `set local statement_timeout = ${ms}`,
    `set local lock_timeout = ${LOCK_TIMEOUT_MS}`,
    `set local idle_in_transaction_session_timeout = ${IDLE_IN_TX_MS}`,
    // The server must read string literals as the parser that checked the query did (backslashes are plain text).
    "set local standard_conforming_strings = on",
    ...(limits.searchPath ? [`set local search_path = ${quoteLiteral(limits.searchPath)}`] : []),
  ];
}

/** A driver failure as one of our codes (SQLSTATE first, then the network error). */
export function databaseErrorOf(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const e = error as { code?: string; message?: string; errno?: string };
  const message = e?.message ?? String(error);
  const code = typeof e?.code === "string" ? e.code : "";
  if (code.startsWith("28")) return new DatabaseError(message, "auth", code);
  if (code === "57014") return new DatabaseError("The query took too long and was cancelled.", "timeout");
  if (code === "55P03") return new DatabaseError("The query waited too long for a lock and was cancelled.", "timeout");
  if (/^[0-9A-Z]{5}$/.test(code) && code !== "08006" && code !== "08001")
    return new DatabaseError(message, "query", code);
  if (/ssl|tls|certificate/i.test(message)) return new DatabaseError(message, "tls");
  if (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "CONNECT_TIMEOUT", "ECONNRESET"].includes(
      code,
    ) ||
    code.startsWith("08")
  )
    return new DatabaseError(message, "unreachable");
  return new DatabaseError(message, "unknown");
}

const ROLLBACK = Symbol("rollback");

/**
 * The extended protocol takes one statement per message; postgres.js would otherwise send a query without
 * parameters over the simple protocol, where the server runs every statement it finds in the text.
 */
const ONE_STATEMENT: postgres.UnsafeQueryOptions & { simple: boolean } = { simple: false };

/**
 * postgres.js: a small pool per connection (2 sockets, closed after 5 minutes idle), `application_name = agentes.chat`.
 * `connect` stands in for postgres.js in tests.
 */
export function createPostgresDatabaseDriver(
  options: { connectTimeoutSeconds?: number; connect?: typeof postgres } = {},
): DatabaseDriver {
  const connect = options.connect ?? postgres;
  return {
    async open(target) {
      const sql = connect({
        host: target.address,
        port: target.port,
        database: target.database,
        username: target.username,
        password: target.password,
        ssl:
          target.sslmode === "require"
            ? { rejectUnauthorized: false, ...(isIP(target.host) ? {} : { servername: target.host }) }
            : false,
        max: 2,
        idle_timeout: 300,
        connect_timeout: options.connectTimeoutSeconds ?? 10,
        prepare: false,
        fetch_types: false,
        onnotice: () => {},
        connection: { application_name: "agentes.chat" },
      });
      return {
        async readOnly(limits, fn) {
          let out: Awaited<ReturnType<typeof fn>> | undefined;
          try {
            await sql.begin("read only", async (tx) => {
              for (const s of readOnlySettings(limits)) await tx.unsafe(s);
              out = await fn(async (text, params) => {
                const result = await tx
                  .unsafe(text, (params ?? []) as postgres.ParameterOrJSON<never>[], ONE_STATEMENT)
                  .values();
                return {
                  columns: (result.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
                  rows: [...result] as unknown[][],
                };
              });
              // Nothing to keep: a read-only transaction ends in a rollback.
              throw ROLLBACK;
            });
          } catch (error) {
            if (error !== ROLLBACK) throw databaseErrorOf(error);
          }
          return out as Awaited<ReturnType<typeof fn>>;
        },
        async close() {
          // Running queries finish first (a whole server closes its least recently used pool while one may be
          // running); the longest an agent's query runs is 60 s.
          await sql.end({ timeout: 65 });
        },
      };
    },
  };
}

/** What the fake needs from PGlite (`query` with `rowMode: "array"`, `exec`). */
export interface FakeQueryable {
  query(
    text: string,
    params?: unknown[],
    options?: { rowMode?: "array" | "object" },
  ): Promise<{ rows: unknown[]; fields: { name: string; dataTypeID: number }[] }>;
  exec(text: string): Promise<unknown>;
}

/**
 * Tests: every target opens the same PGlite (one connection, calls in
 * order). `refuse` can fail a target (wrong password, unreachable…);
 * `opened` records each open; `answer` replies to a statement instead of
 * PGlite (which has a single database: the list of a server's databases).
 */
export function createFakeDatabaseDriver(o: {
  db: FakeQueryable;
  refuse?: (target: DatabaseTarget) => DatabaseError | null;
  opened?: DatabaseTarget[];
  answer?: (text: string, params: unknown[], target: DatabaseTarget) => DatabaseRows | null;
}): DatabaseDriver {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return {
    async open(target) {
      const refused = o.refuse?.(target);
      if (refused) throw refused;
      o.opened?.push(target);
      let closed = false;
      return {
        readOnly(limits, fn) {
          if (closed) throw new DatabaseError("client closed", "unknown");
          return serial(async () => {
            await o.db.exec("begin transaction read only");
            try {
              for (const s of readOnlySettings(limits)) await o.db.exec(s);
              return await fn(async (text, params) => {
                const answered = o.answer?.(text, params ?? [], target);
                if (answered) return answered;
                try {
                  const r = await o.db.query(text, params ?? [], { rowMode: "array" });
                  return {
                    columns: r.fields.map((f) => ({ name: f.name, type: f.dataTypeID })),
                    rows: r.rows as unknown[][],
                  };
                } catch (error) {
                  throw databaseErrorOf(error);
                }
              });
            } finally {
              await o.db.exec("rollback");
            }
          });
        },
        async close() {
          closed = true;
        },
      };
    },
  };
}
