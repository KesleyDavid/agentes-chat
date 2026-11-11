import { expect, test } from "bun:test";
import { guardSql, normalizeDatabasePolicy, provenReadOnly, type SqlRules } from "../src";

const open: SqlRules = { tables: [], hiddenColumns: [] };
const reason = async (sql: string, rules = open) => {
  const r = await guardSql(sql, rules);
  return r.ok ? null : r.reason;
};

test("one SELECT (with WITH, or EXPLAIN without ANALYZE) passes, trailing semicolons and comments out of the body", async () => {
  const r = await guardSql("with x as (select id from orders) select count(*) from x; ", open);
  expect(r).toMatchObject({
    ok: true,
    kind: "select",
    body: "with x as (select id from orders) select count(*) from x",
  });
  expect(r.ok && r.relations).toEqual(["public.orders"]);
  expect(await guardSql("explain select * from analytics.daily", open)).toMatchObject({ ok: true, kind: "explain" });
});

test("anything that writes, locks, sleeps, reads files or runs SQL from text is refused", async () => {
  expect(await reason("delete from orders")).toContain("read-only");
  expect(await reason("select 1; select 2")).toBe("Send exactly one statement per call.");
  expect(await reason("with d as (delete from orders returning *) select * from d")).toContain("DELETE is not allowed");
  expect(await reason("select * into copy from orders")).toBe("SELECT INTO is not allowed.");
  expect(await reason("select * from orders for update")).toContain("FOR UPDATE");
  expect(await reason("explain analyze select 1")).toContain("ANALYZE");
  expect(await reason("explain delete from orders")).toBe("Only EXPLAIN of a SELECT is allowed.");
  expect(await reason("copy orders to stdout")).toContain("read-only");
  expect(await reason("set statement_timeout = 0")).toContain("read-only");
  expect(await reason("do $$ begin end $$")).toContain("read-only");
  expect(await reason("select pg_sleep(10)")).toContain("pg_sleep");
  expect(await reason("select pg_catalog.pg_read_file('/etc/passwd')")).toContain("pg_read_file");
  expect(await reason("select lo_import('/etc/passwd')")).toContain("lo_import");
  expect(await reason("select query_to_xml('delete from orders', true, true, '')")).toContain("query_to_xml");
  expect(await reason("select * from dblink('host=x', 'select 1') as t(a int)")).toContain("dblink");
  expect(await reason("select * from pg_stats")).toContain("pg_catalog.pg_stats");
  expect(await reason("select from where")).toContain("can't parse");
});

test("the agent's tables: other tables refused, CTE names and catalogs fine", async () => {
  const rules = { tables: ["orders", "analytics.daily"], hiddenColumns: [] };
  expect(await reason("select * from orders o join analytics.daily d on true", rules)).toBeNull();
  expect(await reason("with users as (select 1) select * from users", rules)).toBeNull();
  expect(await reason("select relname from pg_class", rules)).toBeNull();
  expect(await reason("select * from users", rules)).toContain(
    "may only read the tables public.orders, analytics.daily",
  );
  expect(await reason("select * from orders where customer_id in (select id from customers)", rules)).toContain(
    "may only read",
  );
});

test("hidden columns: never named, never through * or a whole-row value", async () => {
  const rules = { tables: [], hiddenColumns: ["public.customers.cpf", "users.password_hash"] };
  expect(await reason("select name, phone from customers", rules)).toBeNull();
  expect(await reason("select count(*) from customers", rules)).toBeNull();
  expect(await reason("select * from orders", rules)).toBeNull();
  expect(await reason("select cpf from customers", rules)).toContain("cpf is hidden");
  expect(await reason("select c.CPF from customers c", rules)).toContain("cpf is hidden");
  expect(await reason("select name from customers where cpf like '1%'", rules)).toContain("cpf is hidden");
  expect(await reason("select * from customers", rules)).toContain("instead of *");
  expect(await reason("select c.* from orders o join customers c on c.id = o.customer_id", rules)).toContain("*");
  expect(await reason("select row_to_json(c) from customers c", rules)).toContain("name the columns");
  expect(await reason("select to_jsonb(users) from users", rules)).toContain("name the columns");
});

test("a CTE's name stands for its query only where Postgres sees it", async () => {
  const rules = { tables: ["public.orders"], hiddenColumns: [] };
  // Ordinary use: one CTE, several where a later one reads an earlier one, one inside a subquery, a set operation.
  expect(await reason("with x as (select id from orders) select count(*) from x", rules)).toBeNull();
  expect(
    await reason("with a as (select id from orders), b as (select id from a) select * from b join a using (id)", rules),
  ).toBeNull();
  expect(
    await reason(
      "select id from orders where id in (with firsts as (select id from orders limit 3) select id from firsts)",
      rules,
    ),
  ).toBeNull();
  expect(
    await reason("with a as (select id from orders) select id from a union all select id from a", rules),
  ).toBeNull();
  // Nested: the inner query still sees the outer CTE, and its own.
  expect(
    await reason(
      "with a as (select id from orders) select * from (with b as (select id from a) select b.id from b, a) s",
      rules,
    ),
  ).toBeNull();
  expect(
    await reason("with a as (with b as (select id from orders) select id from b) select id from a", rules),
  ).toBeNull();
  // Recursive: a query reads itself, and one written after it.
  expect(
    await reason(
      "with recursive n as (select 1 as i union all select i + 1 from n where i < 5) select i from n",
      rules,
    ),
  ).toBeNull();
  expect(
    await reason("with recursive a as (select id from b), b as (select id from orders) select id from a", rules),
  ).toBeNull();
  // A CTE named like a table the agent may not read hides nothing real.
  expect(await reason("with users as (select id from orders) select * from users", rules)).toBeNull();

  // Outside the WITH's own statement the name is the real table again.
  expect(
    await reason("select email from users where exists (with users as (select 1) select 1 from users)", rules),
  ).toContain("may only read");
  expect(await reason("select * from (with users as (select 1) select * from users) s, users", rules)).toContain(
    "may only read",
  );
  // Without RECURSIVE a CTE's own query doesn't see its name, nor the ones after it.
  expect(await reason("with users as (select email from users) select * from users", rules)).toContain("may only read");
  expect(await reason("with a as (select * from users), users as (select 1) select * from a", rules)).toContain(
    "may only read",
  );
  // A schema-qualified name is never a CTE.
  expect(await reason("with users as (select 1) select * from public.users", rules)).toContain("may only read");
});

test("a CTE's name never covers a hidden column or a blocked catalog outside its scope", async () => {
  const rules = { tables: [], hiddenColumns: ["users.password_hash"] };
  expect(await reason("with users as (select password_hash from users) select count(*) from users", rules)).toContain(
    "password_hash is hidden",
  );
  expect(
    await reason("select password_hash from users where exists (with users as (select 1) select 1 from users)", rules),
  ).toContain("password_hash is hidden");
  expect(await reason("with pg_stats as (select * from pg_stats) select * from pg_stats")).toContain(
    "pg_catalog.pg_stats",
  );
  const whole = await guardSql(
    "with pg_database as (select datname from pg_database) select * from pg_database",
    open,
    { wholeServer: true },
  );
  expect(whole.ok).toBe(false);
});

test("hidden columns: no whole row through any alias, alias.column still fine", async () => {
  const rules = { tables: [], hiddenColumns: ["users.password_hash"] };
  expect(await reason("select row_to_json(j) from (users join orders o on true) as j", rules)).toContain("whole row");
  expect(await reason("select j from (users u join users u2 on true) as j", rules)).toContain("whole row");
  // A subquery's row is only its select list, so its alias is fine as a value; what it selects is still checked.
  expect(await reason("select to_jsonb(s) from (select id, email from users) s", rules)).toBeNull();
  expect(await reason("select to_jsonb(s) from (select u from users u) s", rules)).toContain("whole row");
  expect(await reason("select s from (select * from users) s", rules)).toContain("instead of *");
  expect(await reason("select s from (table users) s", rules)).not.toBeNull();
  expect(await reason("select s from (select j from (users u join orders o on true) as j) s", rules)).toContain(
    "whole row",
  );
  expect(await reason("select x from users a join users b using (password_hash) as x", rules)).toContain("whole row");
  // The refusal says what to write instead.
  expect(await reason("select j from (users u join orders o on true) as j", rules)).toContain("alias.column");
  // Naming columns through an alias, of a table, a join or a subquery.
  expect(await reason("select u.id, u.email from users u", rules)).toBeNull();
  expect(
    await reason("select j.email, j.total from (users u join orders o on o.customer_id = u.id) as j", rules),
  ).toBeNull();
  expect(
    await reason(
      "select s.email, o.total from (select id, email from users) s join orders o on o.customer_id = s.id",
      rules,
    ),
  ).toBeNull();
  // A function's alias is its column.
  expect(await reason("select u.email, d from users u, generate_series(1, 3) as d", rules)).toBeNull();
  // Without hidden columns in the query, a whole row through an alias is fine.
  expect(
    await reason("select row_to_json(j) from (orders o join customers c on c.id = o.customer_id) as j", rules),
  ).toBeNull();
});

test("hidden columns: never read under new names through an alias column list", async () => {
  const rules = { tables: [], hiddenColumns: ["public.users.password_hash"] };
  expect(await reason("select c from users as x(a, b, c)", rules)).toContain("alias list");
  expect(await reason("select x.c from users x(a, b, c) join orders o on o.user_id = x.a", rules)).toContain(
    "alias list",
  );
  expect(await reason("select j.c from (users u join orders o on true) as j(a, b, c)", rules)).toContain("alias list");
  expect(await reason("select n from users u, generate_series(1, 3) g(n)", rules)).toContain("alias list");
  // Without hidden columns in the query, alias lists are fine.
  expect(await reason("select n from orders, generate_series(1, 3) g(n)", rules)).toBeNull();
});

test("functions that run SQL from text are refused", async () => {
  expect(await reason("select * from ts_stat('select password_hash::tsvector from users')")).toContain("ts_stat");
  const rewrite = "select ts_rewrite('a'::tsquery, 'select cpf::tsquery, cpf::tsquery from customers')";
  expect(await reason(rewrite)).toContain("ts_rewrite");
  expect(await reason("select * from crosstab('select 1, 2, 3') as t(a int, b int)")).toContain("crosstab");
  expect(await reason("select * from pg_catalog.ts_stat('select 1')")).toContain("ts_stat");
});

test("an unqualified pg_* name is a catalog only when it is one; other pg_* names are public tables under the rules", async () => {
  const rules = { tables: ["orders"], hiddenColumns: [] };
  expect(await reason("select relname from pg_class", rules)).toBeNull();
  expect(await reason("select * from pg_secrets", rules)).toContain("may only read the tables public.orders");
  expect(await reason("select * from pg_catalog.pg_class", rules)).toBeNull();
  const hidden = { tables: [], hiddenColumns: ["pg_accounts.token"] };
  expect(await reason("select token from pg_accounts", hidden)).toContain("token is hidden");
  expect(await guardSql("select id from pg_accounts", open)).toMatchObject({
    ok: true,
    relations: ["public.pg_accounts"],
  });
});

test("names with capitals, spaces, slashes, dots or quotes are stored exact and checked as Postgres resolves them", async () => {
  const policy = normalizeDatabasePolicy({
    tables: ['dbo."Invoices 2024"', "Orders", 'dbo."a.b"'],
    hiddenColumns: ['dbo.invoices."Tax ID/Number"', 'dbo."Invoices 2024"."Say ""hi"""', "customers.cpf"],
    dailyQueryCap: null,
    timeoutSeconds: 15,
  });
  expect(policy.tables).toEqual(['dbo."Invoices 2024"', "public.orders", 'dbo."a.b"']);
  expect(policy.hiddenColumns).toEqual([
    'dbo.invoices."Tax ID/Number"',
    'dbo."Invoices 2024"."Say ""hi"""',
    "public.customers.cpf",
  ]);
  expect(() => normalizeDatabasePolicy({ ...policy, hiddenColumns: ['dbo.invoices."open'] })).toThrow(
    "is not schema.table.column",
  );

  const rules = { tables: [], hiddenColumns: policy.hiddenColumns };
  expect(await reason('select "Tax ID/Number" from dbo.invoices', rules)).toContain('"Tax ID/Number" is hidden');
  expect(await reason('select i."Tax ID/Number" from dbo.invoices i', rules)).toContain("is hidden");
  expect(await reason("select * from dbo.invoices", rules)).toContain("instead of *");
  expect(await reason('select "Say ""hi""" from dbo."Invoices 2024"', rules)).toContain("is hidden");
  expect(await reason("select id, total from dbo.invoices", rules)).toBeNull();

  const allowed = { tables: policy.tables, hiddenColumns: [] };
  expect(
    await reason('select * from dbo."Invoices 2024" join orders on true join dbo."a.b" on true', allowed),
  ).toBeNull();
  // Unquoted, Postgres folds the name: dbo.invoices 2024 is another table.
  expect(await reason("select * from DBO.INVOICES", allowed)).toContain("may only read the tables");
  expect(await guardSql('select 1 from dbo."Invoices 2024"', open)).toMatchObject({
    ok: true,
    relations: ['dbo."Invoices 2024"'],
  });
});

test("rules saved before names were kept exact (lowercase, unquoted) still hide the column", async () => {
  const rules = { tables: [], hiddenColumns: ["dbo.invoices.tax id/number", "dbo.clients.cpf"] };
  expect(normalizeDatabasePolicy({ ...rules, dailyQueryCap: null, timeoutSeconds: 15 }).hiddenColumns).toEqual([
    'dbo.invoices."tax id/number"',
    "dbo.clients.cpf",
  ]);
  expect(await reason('select "Tax ID/Number" from dbo.invoices', rules)).toContain("is hidden");
  expect(await reason('select "CPF" from dbo."Clients"', rules)).toContain("is hidden");
});

test("a whole row written as schema.table is a whole-row reference too", async () => {
  const rules = { tables: [], hiddenColumns: ['dbo.t."CPF/CNPJ"', "public.t.cpf"] };
  for (const sql of [
    "select to_json(dbo.t) from dbo.t",
    "select to_json(public.t) from t",
    'select (dbo.t)."CPF/CNPJ" from dbo.t',
    "select (public.t).cpf from t",
  ])
    expect(await reason(sql, rules)).toContain("hidden");
  expect(await reason("select t.id from dbo.t", rules)).toBeNull();
});

test("saved columns with dots or quotes in their names stay hidden and still save", async () => {
  const rules = { tables: [], hiddenColumns: ['dbo.t.my"col', "dbo.t.tel. celular"] };
  expect(await reason('select "my""col" from dbo.t', rules)).toContain("hidden");
  expect(await reason('select "Tel. Celular" from dbo.t', rules)).toContain("hidden");
  expect(normalizeDatabasePolicy({ ...rules, dailyQueryCap: null, timeoutSeconds: 15 }).hiddenColumns).toEqual([
    'dbo.t."my""col"',
    'dbo.t."tel. celular"',
  ]);
  // An entry that still doesn't parse hides its last part everywhere rather than nothing.
  expect(await reason("select secret from dbo.other", { tables: [], hiddenColumns: ["secret"] })).toContain("hidden");
});

test("a table allowlist saved lowercase still allows the table with capitals", async () => {
  const rules = { tables: ["dbo.clientesnfse"], hiddenColumns: [] };
  expect(await reason('select * from dbo."ClientesNFSe"', rules)).toBeNull();
  expect(await reason('select * from dbo."Other"', rules)).toContain("may only read the tables");
  // A quoted entry is exact.
  expect(
    await reason('select * from dbo."ClientesNFSe"', { tables: ['dbo."clientesNFSe"'], hiddenColumns: [] }),
  ).toContain("may only read the tables");
});

test("proven read-only (Aprovar sempre leituras): SELECTs and EXPLAINs calling only computing built-ins", async () => {
  const cases: [string, boolean][] = [
    ["select count(*) from orders where created_at > now() - interval '7 days'", true],
    ["-- weekly\nselect status, count(*) from orders /* all */ group by 1;", true],
    ["select count(*) from orders; select count(*) from customers;", true],
    ["with x as (select id from orders) select date_trunc('day', now()), count(*) from x", true],
    ["explain select * from orders", true],
    ["select pg_catalog.count(*) from orders", true],
    // Statement positions count bytes: text with accents before the next statement still proves it.
    ["select count(*) from clientes where cidade = 'São Paulo';select 2", true],
    ["select a ->> 'k', b between 1 and 2, c like 'x%', d in (1, 2), e::text, cast(f as int) from t", true],
    ["select 1 = any(select 2), j @> '{}'::jsonb, now()::date, x::timestamptz from t", true],
    // Writes, in a CTE or after a read; DDL, COPY, state-changing SET, transactions.
    ["with d as (insert into orders default values returning id) select * from d", false],
    ["select 1; delete from orders", false],
    ["select count(*) from orders; drop table orders", false],
    ["copy orders to stdout", false],
    ["set role postgres", false],
    ["begin; select 1; commit", false],
    ["explain analyze select 1", false],
    ["select * from orders for update", false],
    ["select * into backup from orders", false],
    // Functions with side effects, or that aren't known to only compute (the workspace's own may write).
    ["select nextval('orders_id_seq')", false],
    ["select setval('orders_id_seq', 1)", false],
    ["select pg_sleep(5)", false],
    ["select lo_import('/etc/passwd')", false],
    ["select archive_old_orders()", false],
    ["select public.count(*) from orders", false],
    ["select 1 operator(public.+) 2", false],
    // The workspace's own operators, types and sampling methods run its functions.
    ["select 1 <=> 2", false],
    ["select a <=> b from t", false],
    ["select cast(x as evil) from t", false],
    ["select x::public.evil from t", false],
    ["select 1 = any(select 2) and 3 <=> any(select 4)", false],
    ["select * from orders tablesample bernoulli (5)", false],
    ["", false],
    ["-- nothing here", false],
    ["select from where", false],
  ];
  const got: [string, boolean][] = [];
  for (const [sql] of cases) got.push([sql, await provenReadOnly(sql)]);
  expect(got).toEqual(cases);
});

test("a database name in a table is refused; a whole server also hides other databases and their sessions", async () => {
  expect(await reason("select * from app.public.orders")).toBe("Name tables as schema.table, without a database name.");
  const whole = async (sql: string) => {
    const r = await guardSql(sql, open, { wholeServer: true });
    return r.ok ? null : r.reason;
  };
  expect(await whole("select * from cliente_b.public.orders")).toContain("pass the database in `database`");
  for (const sql of [
    "select query from pg_stat_activity",
    "select datname from pg_catalog.pg_database",
    "select datname from pg_stat_database",
    "select query from public.pg_stat_statements",
    "select * from pg_stat_get_activity(null)",
    "select pg_stat_get_backend_activity(s) from pg_stat_get_backend_idset() s",
    "select pg_database_size('cliente_z')",
  ]) {
    expect(await whole(sql)).toContain("not allowed");
    expect(await reason(sql)).toBeNull();
  }
  expect(await whole("select count(*) from orders")).toBeNull();
});

test("an agent's databases: exact names, deduplicated, none = every one", () => {
  const base = { tables: [], hiddenColumns: [], dailyQueryCap: null, timeoutSeconds: 15 };
  expect(
    normalizeDatabasePolicy({ ...base, databases: [" cliente_a", "cliente_a", "Cliente_B", ""] }).databases,
  ).toEqual(["cliente_a", "Cliente_B"]);
  expect(normalizeDatabasePolicy({ ...base, databases: [] })).toEqual(base);
  expect(() => normalizeDatabasePolicy({ ...base, databases: ["x".repeat(64)] })).toThrow("63");
});
