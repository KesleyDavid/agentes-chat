import { afterEach, expect, test } from "bun:test";
import { createFakeDatabaseDriver, DatabaseError } from "@agenteschat/adapters";
import { eq, schema } from "@agenteschat/db";
import {
  createDatabaseConnection,
  DATABASES_SQL,
  databaseSlugs,
  dropClient,
  getAgentDatabases,
  grantScopes,
  isSensitive,
  listDatabaseConnections,
  listDatabaseTables,
  listServerDatabases,
  MAX_POOLS_PER_CONNECTION,
  openPools,
  revokeDatabaseConnection,
  setAgentScopes,
  updateDatabaseConnection,
} from "../src";
import { connectDatabase, type DatabaseFixture, databaseSetup, giveDatabase, runContext } from "./database-fixtures";
import { addMember } from "./fixtures";

let d: DatabaseFixture;
afterEach(async () => {
  await d?.close();
  d = undefined as never;
});

test("connecting tests first, seals the password, finds sensitive columns and whether the user can write", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  expect(c).toMatchObject({
    label: "Produção",
    host: "db.example.com",
    port: 5432,
    database: "app",
    username: "reader",
    sslmode: "require",
    status: "active",
    // PGlite's user is a superuser: the app recommends a read-only one.
    canWrite: true,
  });
  expect(c.suggestedHidden).toEqual(["public.customers.cpf", "public.customers.phone", "public.users.password_hash"]);
  expect(JSON.stringify(c)).not.toContain("s3cret");
  // The driver got the checked address, never the name to resolve again.
  expect(d.opened.at(-1)).toMatchObject({ host: "db.example.com", address: "93.184.216.34", password: "s3cret" });
  const [row] = await d.f.db.select().from(schema.dbConnections).where(eq(schema.dbConnections.id, c.id));
  expect(row?.secretCiphertext).toBeTruthy();
  expect(row?.secretCiphertext).not.toContain("s3cret");
  const member = await addMember(d.f.db, d.f.org.id, "member");
  const listed = await listDatabaseConnections(d.f.db, member.id, d.f.org.id);
  expect(JSON.stringify(listed)).not.toContain("s3cret");
});

test("private hosts, wrong passwords and bad addresses don't connect", async () => {
  d = await databaseSetup();
  const connect = (url: string) => createDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, { label: "x", url });
  expect(await connect("postgres://u:p@db.internal-company.net/app")).toEqual({ ok: false, error: "blocked_host" });
  expect(await connect("postgres://u:p@localhost/app")).toEqual({ ok: false, error: "blocked_host" });
  expect(await connect("postgres://u:p@169.254.169.254/app")).toEqual({ ok: false, error: "blocked_host" });
  d.state.fail = new DatabaseError("password authentication failed", "auth");
  expect(await connect("postgres://u:p@db.example.com/app")).toEqual({ ok: false, error: "auth" });
  d.state.fail = new DatabaseError("server does not support SSL", "tls");
  expect(await connect("postgres://u:p@db.example.com/app")).toEqual({ ok: false, error: "tls" });
  d.state.fail = null;
  await expect(connect("mysql://u:p@db.example.com/app")).rejects.toThrow("postgres://");
  await expect(connect("postgres://u@db.example.com/app")).rejects.toThrow("password");
  // Members can't connect databases.
  const member = await addMember(d.f.db, d.f.org.id, "member");
  await expect(
    createDatabaseConnection(d.deps, member.id, d.f.org.id, { url: "postgres://u:p@db.example.com/app" }),
  ).rejects.toThrow();
  expect(await listDatabaseConnections(d.f.db, d.f.owner.id, d.f.org.id)).toEqual([]);
});

test("tools follow the agent's access; never part of 'all tools' nor replaced by the agent's other grants", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  const ctx = await runContext(d.f);
  const names = async () => (await d.tools.list(ctx)).map((t) => t.name).filter((n) => n.startsWith("pg_"));
  await grantScopes(d.f.db, d.f.org.id, d.f.agent.id, [{ connectionId: null, scope: "*" }]);
  expect(await names()).toEqual([]);
  await giveDatabase(d, c.id);
  expect(await names()).toEqual(["pg_producao_describe_table", "pg_producao_list_tables", "pg_producao_query"]);
  // Counted as Postgres by our own verbs, never the connection's label (ADR 0103).
  expect((await d.tools.list(ctx)).flatMap((t) => (t.name.startsWith("pg_") ? [t.connector] : []))).toEqual([
    { key: "postgres", via: "native", tool: "describe_table" },
    { key: "postgres", via: "native", tool: "list_tables" },
    { key: "postgres", via: "native", tool: "query" },
  ]);
  const query = (await d.tools.list(ctx)).find((t) => t.name === "pg_producao_query");
  expect(query && isSensitive(query)).toBe(false);
  expect(query?.connectorLabel).toBe("Produção");
  expect(query?.service).toBe("postgres");
  // Replacing the agent's other grants keeps the database one.
  await setAgentScopes(d.f.db, d.f.owner.id, d.f.org.id, d.f.agent.id, [{ connectionId: null, scope: "context:read" }]);
  expect(await names()).toHaveLength(3);
  // Tools turned off for the database never become tools.
  await updateDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, c.id, { offActions: ["describe_table"] });
  expect(await names()).toEqual(["pg_producao_list_tables", "pg_producao_query"]);
  const access = await getAgentDatabases(d.f.db, d.f.owner.id, d.f.org.id, d.f.agent.id);
  expect(access).toEqual([
    {
      connectionId: c.id,
      level: "read",
      policy: { tables: [], hiddenColumns: [], dailyQueryCap: null, timeoutSeconds: 15 },
    },
  ]);
  await revokeDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, c.id);
  expect(await names()).toEqual([]);
});

test("queries: read-only, rows as untrusted data, capped at 500, logged without their rows", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  await giveDatabase(d, c.id);
  const ctx = await runContext(d.f);
  const call = (input: Record<string, unknown>) =>
    d.tools.invoke(ctx, { toolUseId: `tu_${Math.random()}`, name: "pg_producao_query", input });

  const r = await call({ sql: "select status, count(*) from orders group by 1 order by 1;" });
  if (r.type !== "result") throw new Error("expected a result");
  expect(r.output.isError).toBeUndefined();
  expect(r.output.content).toContain("[Database Produção] 2 rows");
  expect(r.output.content).toContain("columns: status, count");
  expect(r.output.content).toContain('["canceled",233]');
  expect(r.output.content).toContain('<database_rows untrusted="true">');

  const many = await call({ sql: "select id, note from orders where total > $1", params: [5] });
  if (many.type !== "result") throw new Error("expected a result");
  expect(many.output.content).toContain("the first 500 rows (there are more");
  // A value can't close our block.
  expect(many.output.content.match(/<\/?database_rows/g)).toHaveLength(2);

  // Even past the parser, the transaction is read-only.
  const write = await call({ sql: "select nextval('orders_id_seq')" });
  expect(write).toMatchObject({ output: { isError: true } });
  expect(write.type === "result" && write.output.content).toContain("read-only");

  expect(await call({ sql: "update orders set total = 0" })).toMatchObject({
    output: { isError: true, content: expect.stringContaining("Not allowed: Only SELECT") },
  });
  const bad = await call({ sql: "select nope from orders" });
  expect(bad.type === "result" && bad.output.content).toContain("Postgres error:");
  const total = await d.pg.query<{ n: number }>("select count(*)::int as n from orders where total = 0");
  expect(total.rows[0]?.n).toBe(0);

  const log = await d.f.db.select().from(schema.dbQueries).where(eq(schema.dbQueries.connectionId, c.id));
  expect(log.map((q) => q.kind)).toEqual(["query", "query", "query", "query"]);
  expect(log[0]).toMatchObject({ statement: "select status, count(*) from orders group by 1 order by 1", rowCount: 2 });
  expect(JSON.stringify(log)).not.toContain("canceled");
});

test("the agent's rules: tables, hidden columns and the daily cap", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  await giveDatabase(d, c.id, "read", {
    tables: ["orders", "customers"],
    hiddenColumns: ["customers.cpf"],
    dailyQueryCap: 3,
  });
  const ctx = await runContext(d.f);
  const call = (name: string, input: Record<string, unknown>) =>
    d.tools.invoke(ctx, { toolUseId: `tu_${Math.random()}`, name: `pg_producao_${name}`, input });

  const tables = await call("list_tables", {});
  if (tables.type !== "result") throw new Error("expected a result");
  expect(tables.output.content).toContain("public.orders (table, ");
  expect(tables.output.content).toContain("One row per order");
  expect(tables.output.content).not.toContain("users");

  const described = await call("describe_table", { table: "customers" });
  expect(described.type === "result" && described.output.content).toContain("cpf text [hidden from you");
  expect(await call("describe_table", { table: "users" })).toMatchObject({
    output: { isError: true, content: expect.stringContaining("may only read the tables") },
  });
  expect(await call("query", { sql: "select cpf from customers" })).toMatchObject({
    output: { isError: true, content: expect.stringContaining("cpf is hidden") },
  });
  // The cap counts what ran: list + describe + this one, then no more today.
  const third = await call("query", { sql: "select name from customers" });
  expect(third.type === "result" && third.output.isError).toBeUndefined();
  expect(await call("query", { sql: "select 1" })).toMatchObject({
    output: { isError: true, content: expect.stringContaining("already ran its 3 queries") },
  });
});

test("the stored password only goes to the server and user it was saved for", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  const update = (input: Parameters<typeof updateDatabaseConnection>[4]) =>
    updateDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, c.id, input);
  d.opened.length = 0;
  // Another server, port or user needs the password again: nothing is opened without it.
  for (const input of [
    { host: "other.example.com" },
    { host: "other.example.com", sslmode: "disable" as const },
    { port: 6543 },
    { username: "someone" },
  ]) {
    await expect(update(input)).rejects.toMatchObject({ code: "database.password_required" });
  }
  await expect(update({ url: "postgres://reader@other.example.com/app" })).rejects.toThrow("password");
  expect(d.opened).toEqual([]);
  // What stays on the same server and user keeps using it: another database, the same address written again.
  expect((await update({ database: "reports" })).ok).toBe(true);
  expect((await update({ host: "DB.example.com", port: 5432, username: "reader" })).ok).toBe(true);
  expect(d.opened.every((t) => t.host === "db.example.com" && t.password === "s3cret")).toBe(true);
  // With its password, the address changes.
  const moved = await update({ host: "other.example.com", password: "n3w" });
  expect(moved.ok && moved.connection.host).toBe("other.example.com");
  expect(d.opened.at(-1)).toMatchObject({ host: "other.example.com", password: "n3w" });
  const byUrl = await update({ url: "postgres://writer:0ther@third.example.com:6543/app" });
  expect(byUrl.ok && byUrl.connection).toMatchObject({ host: "third.example.com", port: 6543, username: "writer" });
});

test("string literals are read as the checked query's parser read them, whatever the server's setting", async () => {
  d = await databaseSetup();
  await d.pg.exec("set standard_conforming_strings = off");
  const client = await createFakeDatabaseDriver({ db: d.pg }).open({
    host: "db.example.com",
    address: "93.184.216.34",
    port: 5432,
    database: "app",
    username: "reader",
    password: "x",
    sslmode: "require",
  });
  // One literal with a backslash in it, not a literal followed by more SQL.
  const r = await client.readOnly({ statementTimeoutMs: 1000, searchPath: "public" }, (run) =>
    run("select 'a\\'' as x, 2 as y --'"),
  );
  expect(r.columns).toHaveLength(1);
  expect(String(r.rows[0]?.[0])).toContain("as x, 2 as y");
});

test("a refused password marks the database for reconnecting; a new password brings it back", async () => {
  d = await databaseSetup();
  const c = await connectDatabase(d);
  await giveDatabase(d, c.id);
  // A new password reopens the pool: the next open fails like a changed password would.
  d.state.fail = new DatabaseError("password authentication failed", "auth");
  const r = await updateDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, c.id, { password: "wrong" });
  expect(r).toEqual({ ok: false, error: "auth" });
  d.state.fail = null;
  const ok = await updateDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, c.id, { password: "n3w" });
  expect(ok.ok).toBe(true);
  expect(d.opened.at(-1)?.password).toBe("n3w");
  expect(
    (await listDatabaseTables(d.deps, d.f.owner.id, d.f.org.id, c.id)).map((t) => `${t.schema}.${t.name}`),
  ).toEqual(["analytics.daily", "public.customers", "public.orders", "public.users"]);
});

test("slugs per connection are short, plain and distinct", () => {
  expect(
    [
      ...databaseSlugs([
        { id: "a", label: "Produção (réplica)" },
        { id: "b", label: "Produção réplica" },
        { id: "c", label: "!!" },
      ]).values(),
    ].map((s) => s.length <= 20 && /^[a-z0-9]+$/.test(s)),
  ).toEqual([true, true, true]);
});

// ── A whole server (one connection, every database) ─────────────────────────

const wholeServer = (d: DatabaseFixture, input: Record<string, unknown> = {}) =>
  createDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, {
    url: "postgres://reader:s3cret@db.example.com:5432",
    wholeServer: true,
    ...input,
  });

test("a whole server: no database name needed, the first database is the sample, the prefix filters the list", async () => {
  d = await databaseSetup();
  d.state.server = ["cliente_a", "cliente_b", "metabase"];
  const r = await wholeServer(d, { databasePrefix: "cliente_" });
  if (!r.ok) throw new Error(r.error);
  expect(r.connection).toMatchObject({
    label: "db.example.com",
    database: "cliente_a",
    wholeServer: true,
    databasePrefix: "cliente_",
    databaseCount: 2,
  });
  // The list is read from `postgres`, then the sample is tested like a single database.
  expect(d.opened.map((t) => t.database)).toEqual(["postgres", "cliente_a"]);
  expect(r.connection.suggestedHidden).toContain("public.customers.cpf");
  expect(await listServerDatabases(d.deps, d.f.owner.id, d.f.org.id, r.connection.id)).toEqual([
    "cliente_a",
    "cliente_b",
  ]);
  const [audit] = await d.f.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "database.connected"));
  expect(audit?.details).toMatchObject({ wholeServer: true, prefix: "cliente_", databases: 2 });

  // Nothing the user can open: a plain error, nothing saved (a database in the address doesn't count).
  expect(await wholeServer(d, { databasePrefix: "x_" })).toEqual({ ok: false, error: "no_databases" });
  expect(
    await wholeServer(d, { url: "postgres://reader:s3cret@db.example.com:5432/cliente_a", databasePrefix: "x_" }),
  ).toEqual({ ok: false, error: "no_databases" });
  // A database in the address outside the prefix is only where the list is read: the sample is one agents read.
  const entry = await wholeServer(d, {
    url: "postgres://reader:s3cret@db.example.com:5432/postgres",
    databasePrefix: "cliente_",
  });
  expect(entry.ok && entry.connection.database).toBe("cliente_a");
  expect(d.opened.slice(-2).map((t) => t.database)).toEqual(["postgres", "cliente_a"]);
  // No `postgres` on the server: the list comes from `template1`.
  d.state.refuseDatabase = (db) => (db === "postgres" ? new DatabaseError("no such database", "query", "3D000") : null);
  const fallback = await wholeServer(d);
  expect(fallback.ok && fallback.connection.databaseCount).toBe(3);
  expect(d.opened.at(-2)?.database).toBe("template1");
  d.state.refuseDatabase = undefined;

  // A single database without a name is still `postgres`, as before.
  const single = await createDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, {
    url: "postgres://reader:s3cret@db.example.com",
  });
  expect(single.ok && single.connection).toMatchObject({
    database: "postgres",
    wholeServer: false,
    databaseCount: null,
  });
  // Switching to the whole server is a reconnect: tested first.
  if (!single.ok) throw new Error(single.error);
  const before = d.opened.length;
  const switched = await updateDatabaseConnection(d.deps, d.f.owner.id, d.f.org.id, single.connection.id, {
    wholeServer: true,
  });
  // `postgres` isn't one of the databases listed, so the sample is the first that is.
  expect(switched.ok && switched.connection).toMatchObject({ wholeServer: true, database: "cliente_a" });
  expect(d.opened.length).toBeGreaterThan(before);
});

test("the server's real list: no templates, by prefix", async () => {
  d = await databaseSetup();
  const names = async (prefix: string) =>
    (await d.pg.query<[string]>(DATABASES_SQL, [prefix], { rowMode: "array" })).rows.map((r) => r[0]);
  expect(await names("")).toEqual(["postgres"]);
  expect(await names("post")).toEqual(["postgres"]);
  expect(await names("cliente_")).toEqual([]);
});

test("whole-server tools: one database per call, the agent's list, the cap over every database, receipts", async () => {
  d = await databaseSetup();
  d.state.server = ["cliente_a", "cliente_b", "cliente_c"];
  const r = await wholeServer(d, { label: "Produção" });
  if (!r.ok) throw new Error(r.error);
  const c = r.connection;
  const single = await connectDatabase(d, "Analytics");
  await giveDatabase(d, single.id);
  await giveDatabase(d, c.id, "read", { databases: ["cliente_a", "cliente_b"], dailyQueryCap: 5 });
  const ctx = await runContext(d.f);
  const tools = (await d.tools.list(ctx)).filter((t) => t.name.startsWith("pg_"));
  expect(tools.map((t) => t.name)).toEqual([
    "pg_analytics_describe_table",
    "pg_analytics_list_tables",
    "pg_analytics_query",
    "pg_producao_describe_table",
    "pg_producao_list_databases",
    "pg_producao_list_tables",
    "pg_producao_query",
  ]);
  const schemaOf = (name: string) =>
    tools.find((t) => t.name === name)?.inputSchema as { properties: Record<string, unknown>; required?: string[] };
  expect(schemaOf("pg_producao_query").required).toEqual(["database", "sql"]);
  expect(tools.find((t) => t.name === "pg_producao_query")?.description).toContain("different customer");
  expect(Object.keys(schemaOf("pg_analytics_query").properties)).toEqual(["sql", "params"]);
  expect(tools.find((t) => t.name === "pg_analytics_query")?.description).not.toContain("customer");

  const call = (name: string, input: Record<string, unknown>) =>
    d.tools.invoke(ctx, { toolUseId: `tu_${Math.random()}`, name: `pg_producao_${name}`, input });
  const content = (x: Awaited<ReturnType<typeof call>>) => (x.type === "result" ? x.output.content : "");

  const listed = await call("list_databases", {});
  expect(content(listed)).toContain("2 databases");
  expect(content(listed)).toContain("cliente_b");
  expect(content(listed)).not.toContain("cliente_c");

  const q = await call("query", { database: "cliente_b", sql: "select count(*) from orders" });
  expect(content(q)).toContain("[Database Produção · cliente_b] 1 rows");
  expect(q.type === "result" && q.output.data).toMatchObject({ database: "cliente_b" });
  expect(d.opened.at(-1)?.database).toBe("cliente_b");
  await call("list_tables", { database: "cliente_a" });
  expect(d.opened.at(-1)?.database).toBe("cliente_a");

  // Outside the agent's list, or not on the server: refused the same way.
  expect(await call("query", { database: "cliente_c", sql: "select 1" })).toMatchObject({
    output: {
      isError: true,
      content: "Not allowed: cliente_c is not a database of Produção. Call pg_producao_list_databases.",
    },
  });
  // A name from another database in the SQL itself.
  expect(
    content(await call("query", { database: "cliente_a", sql: "select * from cliente_c.public.orders" })),
  ).toContain("pass the database in `database`");
  expect(content(await call("query", { database: "cliente_a", sql: "select query from pg_stat_activity" }))).toContain(
    "not allowed here",
  );

  const log = await d.f.db.select().from(schema.dbQueries).where(eq(schema.dbQueries.connectionId, c.id));
  expect(log.map((x) => [x.kind, x.database])).toEqual([
    ["list_databases", null],
    ["query", "cliente_b"],
    ["list_tables", "cliente_a"],
  ]);
  // The cap sums every database: 3 ran, 2 more today.
  await call("query", { database: "cliente_a", sql: "select 1" });
  await call("describe_table", { database: "cliente_b", table: "orders" });
  expect(content(await call("query", { database: "cliente_a", sql: "select 1" }))).toContain(
    "already ran its 5 queries",
  );
});

test("whole server: a database whose access rules refuse the user is closed, the connection still works", async () => {
  d = await databaseSetup();
  d.state.server = ["cliente_a", "cliente_b"];
  const r = await wholeServer(d, { label: "Produção" });
  if (!r.ok) throw new Error(r.error);
  await giveDatabase(d, r.connection.id);
  const ctx = await runContext(d.f);
  const call = (database: string) =>
    d.tools.invoke(ctx, {
      toolUseId: `tu_${Math.random()}`,
      name: "pg_producao_query",
      input: { database, sql: "select 1" },
    });
  d.state.refuseDatabase = (db) =>
    db === "cliente_b" ? new DatabaseError('no pg_hba.conf entry for database "cliente_b"', "auth", "28000") : null;
  expect(await call("cliente_b")).toMatchObject({
    output: { isError: true, content: expect.stringContaining("refused this user on the database cliente_b") },
  });
  const status = async () =>
    (await d.f.db.select().from(schema.dbConnections).where(eq(schema.dbConnections.id, r.connection.id)))[0]?.status;
  expect(await status()).toBe("active");
  expect(await call("cliente_a")).toMatchObject({ output: { content: expect.stringContaining("1 rows") } });
  // A refused password is the whole connection's.
  d.state.refuseDatabase = (db) =>
    db === "cliente_b" ? new DatabaseError("password authentication failed", "auth", "28P01") : null;
  await call("cliente_b");
  expect(await status()).toBe("needs_reconnect");
});

test("whole server: an unknown database reloads the list once, then is refused", async () => {
  d = await databaseSetup();
  d.state.server = ["cliente_a"];
  const r = await wholeServer(d, { label: "Produção" });
  if (!r.ok) throw new Error(r.error);
  await giveDatabase(d, r.connection.id);
  const ctx = await runContext(d.f);
  const call = (database: string) =>
    d.tools.invoke(ctx, {
      toolUseId: `tu_${Math.random()}`,
      name: "pg_producao_query",
      input: { database, sql: "select 1" },
    });
  const read = d.state.listed;
  d.state.server.push("cliente_novo");
  // A customer added since the list was read: found on the one reload.
  const ok = await call("cliente_novo");
  expect(ok.type === "result" && ok.output.isError).toBeUndefined();
  expect(d.state.listed).toBe(read + 1);
  // Another unknown name within the minute: no new read, refused.
  expect(await call("nope")).toMatchObject({ output: { isError: true } });
  expect(d.state.listed).toBe(read + 1);
});

test("whole server: at most 8 pools per connection, the least recently used closed; dropClient closes them all", async () => {
  d = await databaseSetup();
  d.state.server = Array.from({ length: 9 }, (_, i) => `cliente_${i + 1}`);
  const r = await wholeServer(d, { label: "Produção" });
  if (!r.ok) throw new Error(r.error);
  await giveDatabase(d, r.connection.id);
  const ctx = await runContext(d.f);
  for (const database of d.state.server) {
    const x = await d.tools.invoke(ctx, {
      toolUseId: `tu_${database}`,
      name: "pg_producao_query",
      input: { database, sql: "select 1" },
    });
    expect(x.type === "result" && x.output.isError).toBeUndefined();
  }
  expect(openPools(r.connection.id)).toHaveLength(MAX_POOLS_PER_CONNECTION);
  expect(openPools(r.connection.id)).not.toContain("cliente_1");
  dropClient(r.connection.id);
  expect(openPools(r.connection.id)).toEqual([]);
});
