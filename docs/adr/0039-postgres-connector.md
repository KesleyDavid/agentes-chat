# 0039. A native Postgres connector: agents read with SQL, writes always ask

- Status: Accepted (read-only first: `pg_execute` and `database:write` come later, after real use)
- Date: 2026-10-19
- Extends: ADR 0015 (Tool Gateway and approvals), ADR 0016 (connectors), ADR 0007 (credentials), ADR 0037 (reads never ask)
- Out of scope: MySQL, SQL Server, BigQuery and other warehouses (the same shape later, one driver each); databases only reachable from a private network (see "Private networks")

## Context

People want agents that answer from their own data: "how many orders yesterday", "which customers churned this month", "why is this user stuck". Today the only path is a custom MCP connector pointing at a public HTTPS SQL server, and the Supabase preset (`execute_sql` with `read_only=true`, `packages/engine/src/connectors/presets.ts`). Most small companies have a plain Postgres (Railway, Neon, RDS, Render, a VPS) and no MCP server in front of it, so they can't connect at all.

What we already have:

- The Tool Gateway takes any number of `ToolSource`s (`createToolGateway({ sources })`, `packages/engine/src/tools/types.ts`). Sources only offer tools; the gateway alone decides (scopes from `agent_scopes`, re-read per call; sensitive calls become approvals with the exact parameters and an action hash).
- Per-org encrypted credentials (`sealSecret`, ADR 0007) and connector connections (`connector_connections`).
- The address guard used for MCP URLs (`isBlockedAddress`, `assertPublicHttpsUrl` in `net-guard.ts`).
- The `postgres` driver is already a dependency (`packages/db`), and tests run on PGlite.

So the plumbing is there. The work is making SQL safe to hand to a model.

## Decision

### A connector that is a `ToolSource`, not an MCP server

- New connector `postgres` in the catalog, category `dev`, auth `connection_string`. The org connects a database once; each agent gets a subset of its scopes (ADR 0016). An org can connect several databases; each is its own connection with its own name ("Production (read replica)", "Analytics").
- It runs in-process in the server: no MCP hop, no extra service. Its tools go through the same gateway path as every other tool (scopes, audit, outcomes, approvals).

### Every brain gets it the same way

- **Cloud agents** (the engine's tool loop) see the `pg_*` tools like any granted connector tool.
- **Computer brains** (Claude Code, Codex on a connected computer, ADR 0032) get them through the runner's `agentes` MCP bridge: `bridgeToolsFor` lists the run's gateway tools, connector tools included, and each call comes back to `invokeToolForRun`, i.e. the same gateway, grants, approvals and limits. The SQL still runs from our server, not from the machine; the credential never reaches the machine.
- What we do not control: a computer brain can also run `psql` or its own tools on that machine with whatever credentials the person keeps there. That path is governed by the machine's command policy and folders, not by this connector. The connect screen doesn't change that; it is the person's machine.

### Tools and scopes

| Tool | Scope | Level |
| --- | --- | --- |
| `pg_list_tables` (schemas, tables, views, row estimates) | `database:read` | read |
| `pg_describe_table` (columns, types, keys, indexes, comments) | `database:read` | read |
| `pg_query` (one `SELECT`/`WITH` statement, parameters allowed) | `database:read` | read, never asks (ADR 0037) |
| `pg_execute` (one `INSERT`/`UPDATE`/`DELETE`) | `database:write` | sensitive: always an approval showing the exact SQL, the parameters and the database |

- No DDL tool (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`). Changing a schema is a migration in the person's repository, not an agent call.
- Tool names carry the connection name when an agent has more than one database, so the model can tell them apart.

### Reads can only read

Layered, because no single check is enough:

1. **The database user (strongest).** The connect screen recommends, with the exact SQL to run, a dedicated role with only `SELECT` (and `pg_read_all_data` where available), ideally on a read replica. A connection whose role can write is marked "can change data" in the app; only such a connection can grant `database:write`.
2. **Read-only transaction.** Every read runs as `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`, so even a writable role cannot change data through `pg_query`.
3. **One statement.** The statement is parsed (a real Postgres parser, not a regex) and must be a single `SELECT`/`WITH`/`EXPLAIN` (no `ANALYZE`). Rejected: multiple statements, `COPY`, `DO`, `CALL`, `SET`/`RESET` of session settings, `LISTEN`/`NOTIFY`, `pg_sleep` and the admin functions (`pg_read_file`, `pg_terminate_backend`, `lo_*`, `dblink*`).
4. **Limits per call.** `statement_timeout` 15 s (org setting up to 60 s), `idle_in_transaction_session_timeout`, `lock_timeout` 2 s. The server streams rows and stops at 500 rows or 64 KB of text, whichever comes first, and tells the model the result was cut (with the total when cheap). Values longer than 2 KB are truncated; `bytea` is never returned.

Writes (`pg_execute`) run in a normal transaction after approval, with the same timeouts, one statement, and `RETURNING` capped like reads. The approval card shows the SQL and the rows it would touch (`EXPLAIN` estimate). The gateway re-checks the grant and the action hash before executing, and it runs at most once.

### Connection and network

- The connection string (or host, port, database, user, password, `sslmode`) is sealed per org like provider keys (ADR 0007) and never returned to any client; the app shows only host, database and user.
- **TLS required** by default (`sslmode=require`; `verify-full` when the provider gives a CA). Turning TLS off is an explicit admin choice with a warning.
- **Address guard:** the host is resolved on every new connection and refused when it points to a private, loopback, link-local or metadata address (`isBlockedAddress`), so an agent can't be used to reach our own network. Re-resolving per connection closes DNS rebinding.
- **Pool:** at most 2 connections per org connection, opened on first use and closed after 5 minutes idle. `application_name = agentes.chat` so the database owner can see and kill our sessions.
- "Test connection" in the app runs `select version()` plus a check of what the role can do (to set the "can change data" mark).

### Per-call checks (`checkCall`)

This connector is the second user of the per-call hook (ADR 0038; after GitHub). Optional rules per agent:

- Allowed schemas or tables (the parser lists the relations a statement touches; anything outside is refused).
- Hidden columns (e.g. `users.password_hash`, `cpf`): refused in `SELECT` lists and `*` expansion is rewritten to exclude them.
- A daily cap of reads per agent.

### Data and the model

- Query results go to the model provider, like any tool result. The connect screen says so in plain words, next to the hidden-columns setting. This matters for LGPD: the org decides what personal data its agents may read.
- Results are untrusted content (they may contain text written by end users); they are marked as such in the transcript, like email bodies (ADR 0038).
- Every call is logged with the SQL, row count, duration and the agent, never the returned rows.

### Private networks

A database without a public address (Railway's internal Postgres, a company LAN, a VPC) is not reachable from our servers, and we will not open tunnels from the Cloud. The path for those is a connected computer inside that network (ADR 0025): the runner opens the connection locally and the same tools run there, with the same checks applied by our gateway. That variant is a follow-up; the connector API is designed so the executor can be the server or a machine.

## Consequences

- Most small companies can let agents answer from their data with one connect screen, without running an MCP server.
- Safety depends on layers we control (read-only transaction, parser, limits, address guard, approvals) plus one we recommend (a read-only role). The app makes the recommendation concrete and shows when a connection can write.
- A heavy `SELECT` can still load the person's database within the timeout. We recommend a replica and keep the timeout short.
- Adds a SQL parser dependency (e.g. `pgsql-ast-parser` or libpg-query's WASM build) to the engine; to be chosen when building, preferring the official parser.
- Tests: the source, parser rules, limits and approvals run on PGlite with a fake resolver for the address guard; no network.

## Open questions

- Decided 2026-10-19: read-only first. `pg_execute` and `database:write` stay designed here but ship later.
- Schema context: should the connector keep a cached summary of tables and comments that goes into the agent's context, so it doesn't call `pg_list_tables` every run?

## Built (2026-10-19, read-only)

- **Tables** (migration 0076): `db_connections` (address, user, sealed password bound to `db-connection|org|id`, `can_write` from the last test, `off_actions`, `suggested_hidden`), `db_agent_policies` (tables, hidden columns, daily cap, time limit) and `db_queries` (every call: statement, row count, duration, error; never the rows).
- **Driver** (`packages/adapters/src/database.ts`): `DatabaseDriver` → `DatabaseClient.readOnly(limits, fn)`; postgres.js in the server (2 sockets, 5 minutes idle, `application_name = agentes.chat`, TLS `require` without certificate check like libpq, the server name for SNI); `createFakeDatabaseDriver` over PGlite in tests. Adapters get `databases` (always on in the server).
- **Engine** (`packages/engine/src/databases/*`): `connections.ts` (test, create, reconnect, revoke, pool per connection version, `publicHostAddress` in `net-guard.ts` resolves and checks the host on every new pool and the driver connects to that address), `policies.ts`, `guard.ts`, `tools.ts`, `text.ts`.
- **Tool names**: `pg_<slug>_list_tables`, `pg_<slug>_describe_table`, `pg_<slug>_query`, the slug from the connection's label (`databaseSlugs`); `connectorLabel` is the label, so the chat's work steps say "Produção".
- **Parser**: `libpg-query` (Postgres 17's own parser as WASM, ~1.2 MB, no native build). The guard also walks the tree for any other `*Stmt`, `SELECT INTO`, `FOR UPDATE`, blocked functions (sleep, files, signals, advisory locks, large objects, dblink, functions that run SQL from text: `query_to_xml` and the other XML ones, `ts_stat`, `ts_rewrite`, `crosstab*`, `connectby`, `xpath_table`; replication) and blocked catalogs (`pg_statistic`, `pg_stats*`, `pg_authid`, `pg_shadow`, user mappings). `SELECT`s run wrapped as `select * from (…) limit 501` with `search_path = public`, so unqualified names are `public.*` for the rules too, except the `pg_catalog` relations Postgres resolves first (a fixed list; any other `pg_*` name is a `public` table under the agent's rules).
- **Hidden columns**: refused when named (any table in the query that has hidden columns), through `*`/`t.*`, or as a whole-row value (`row_to_json(t)`, `to_jsonb(users)`); a query that reads such a table may not rename columns with an alias list (`users AS x(a, b, c)`), which would hand hidden columns out under new names. Default: on connect the test lists columns whose names look sensitive (password, hash, secret, token, api key, salt, otp, cpf, cnpj, ssn, passport, phone, card, cvv, iban, birth…) into `suggested_hidden`; an agent without saved rules gets them hidden, and the rules step starts from them.
- **Grants**: `database:read` with `connection_id`; never part of "all tools" (`*`), and replacing an agent's other grants keeps it (`notMailGrant` / `mailConnectionIds` now cover databases too). Levels in the app: Sem acesso · Ler.
- **API** (`apps/server/src/routes/app/databases.ts`): list, connect (`422 { error: auth | unreachable | blocked_host | tls | unknown }`), update (label, tools off, new address or password, tested), disconnect, tables, and per agent get/put.
- **Web**: the "Banco de dados" card (Desenvolvimento), the 4-step flow of email (conectar → o que faz → quem pode usar → regras), connected row, Reconectar, Desconectar, and a "Bancos de dados" card on the agent page.

Not done: the private-network path through a connected computer; `pg_execute`; a schema summary in the agent's context (open question above); views or user functions that read hidden columns or other tables are not caught by the rules (the read-only role and the transaction still hold; recommend a role without access to what agents must not read).

## Um servidor inteiro (2026-11-03)

A SaaS with one database per customer would need one connection per database (hundreds), each with its own rules. A connection can now read every database of its server instead.

- **Data** (migration 0204): `db_connections.whole_server` (default false: existing connections don't change) and `database_prefix` (null = no filter); `db_agent_policies.databases` (exact names, empty = every database found); `db_queries.database` (null on single-database rows). `database` stays `not null`: on a whole-server row it is the sample, where the list of databases is read and where the rules' tables and sensitive columns come from. A boolean, not a `scope` column, because "scope" already means `agent_scopes`.
- **Connecting**: the address may leave out the database. With `wholeServer`, the list is read from the database given, else `postgres`, else `template1` (the next only on `3D000` or `42501`; `pg_database` is shared, so any database lists them all): `DATABASES_SQL` lists the databases that aren't templates, allow connections and the role may `CONNECT` to, filtered by the prefix, at most 2000. None → the test error `no_databases`, even when the address names a database. The sample (the database given when it is in the list, else the first by name: a database outside the prefix is only where the list is read) gets the usual test (tables, `canWrite`, sensitive columns). The label defaults to the host. Turning `wholeServer` on or off, or changing the prefix, is a reconnect: tested first. A single database without a name still means `postgres`.
- **The list** is cached 5 minutes per connection version (`TtlCache`, keyed `id:updatedAt`), never stored in the row: writing it would change `updated_at`, the pools' version, and reopen every pool. "Atualizar lista" reads it again (`GET …/databases/{id}/databases?refresh=1`). An agent naming a database not in the list reloads it once (at most once a minute per connection) before being refused, so a new customer shows up without anyone editing anything. If the sample was dropped, the list is read from `postgres`, then `template1`.
- **Prefix, not a picked list on the connection**: "Só os que começam com" keeps the app's own databases (`postgres`, metabase, billing) away from every agent and lets new customers in on their own. A fixed list at the connection would miss new customers; restricting is the per-agent list's job.
- **Tools**: one set per connection, never per database (300 databases would be 900 tools). A whole-server connection gets `pg_<slug>_list_databases` (optional `search`; the names minus the agent's exclusions; logged as `list_databases` and counted against the cap; always on, not in `DB_ACTIONS`) and a required `database` input on `list_tables`, `describe_table` and `query` ("One database of this server (from list_databases). Each call reads only that one."). `checkCall` refuses a name that isn't in the list (after the one reload) or isn't in the agent's list, with the same message for both: `Not allowed: X is not a database of Produção. Call pg_<slug>_list_databases.` Each tool's description says that each database may belong to a different customer: answer about the one asked about and name it, combine only when asked. The line is in the descriptions, not in `context.ts`, so it is only there with the tools. Single-database connections keep exactly the 3 tools and schemas they had.
- **Pools**: keyed `id|database`, still checked against `updatedAt`; postgres.js stays at 2 sockets per pool and 5 minutes idle. At most `MAX_POOLS_PER_CONNECTION = 8` per connection: opening a 9th closes that connection's least recently used one (`end({ timeout: 65 })` lets a running query finish, 60 s at most), so at most 16 sockets reach the customer's server. Every new pool resolves and checks the address again. `dropClient(id)` closes every pool of the connection.
- **Rules**: one policy per (agent, connection) for every database (tables, hidden columns, cap, time limit): the same schema in every database is the multi-tenant norm. The daily cap is per (agent, connection), summed over its databases (200 means 200 in all). `databases` on the policy (at most 2000 names of at most 63 characters; absent or empty = every one) is the hard isolation, for example a support agent limited to one customer. The API leaves `databases` out of a policy when it is empty, so single-database policies read as before.
- **Guard**: a table named with a database (`RangeVar.catalogname`) is refused on every connection; on a whole server the message says to pass the database in `database`, one per query (Postgres refuses cross-database names anyway, `0A000`; the guard keeps it explicit, and `dblink` was already blocked). On a whole server only: `pg_stat_activity` and `pg_stat_get_activity()` (the SQL text of the same role's sessions in other databases: other customers' queries), `pg_database`, `pg_stat_database` and `pg_stat_database_conflicts` (names outside the agent's list), `pg_stat_statements` in any schema (view and functions), `pg_stat_get_backend_*()` (another session's SQL text) and `pg_database_size()` (probes names outside the list).
- **Access per database**: a whole server's `pg_hba` may refuse the role on some databases only (`28000`): that call says so and the connection stays active. A refused password (`28P01`) or a refusal on the sample still marks it for reconnecting.
- **Tenant isolation**: one call reads one database, so a cross-customer join can't happen; an agent can still put several results together when a person asks (totals across customers). Every result names its database: the header `[Database Produção · cliente_042]`, `data.database`, the `describe` title `Query Produção · cliente_042` (the agent audit), `db_queries.database`; the connect audit records `wholeServer`, the prefix and how many databases were found. A database's rows asking the agent to read another customer are covered by the untrusted-data wrapper, and the per-agent list is the hard stop. `postgres_fdw` foreign tables follow only the role's own privileges, as before.
- **Widening an existing connection asks once** (owner decision): "Bancos" on the connected row opens "Quais bancos" with the prefix (`DatabaseScopeDialog`; saving is the tested reconnect above). When agents already read the connection and the save may open more databases (one database → the whole server, or a prefix dropped or changed to one that isn't a longer version of the old, `widensDatabaseScope` in `@agenteschat/client/lib/databases`), the same dialog turns into "Abrir o servidor inteiro?" (or "Abrir mais bancos?" with a prefix): "Os 3 agentes com acesso passam a ler todos os bancos deste servidor. Dá para limitar por agente em Regras.", Continuar / Cancelar. Cancelar saves nothing and goes back to the choice. No question for a new connection, when no agent reads it, or when the scope narrows. The count is the connection's `agents` (already in the list), so the route is unchanged.
- **Read-only role**: the connect help's SQL for a whole server is `create role agentes_leitura …; grant pg_read_all_data to agentes_leitura;` (Postgres 14 or newer).
- **Left out**: rules per database (if one server mixes schemas; meanwhile a second connection with "Só este banco"); the database in the live chat step, which still shows only the connection's label (needs `run-tools.ts`); a picked list on the connection (the prefix and the per-agent list cover it). The phone has no database screens, only the `queryingDatabase` activity line, so it needs no change.

## Addendum: how the checks follow Postgres (2026-11-11)

- **CTE names are scoped as Postgres scopes them**: a `WITH` names its queries for its own statement and what is nested in it. Outside it, and inside a CTE's own query without `RECURSIVE`, the same name is the real table and goes through the agent's rules (tables, hidden columns, blocked catalogs).
- **Whole rows through a join**: when a query reads a table with hidden columns, the alias of a join (`(a JOIN b …) AS j`, `USING (…) AS j`) can't be used as a value either, like a table's name or alias already couldn't. `alias.column` is unchanged. A subquery's alias stays usable (`json_agg(s) FROM (SELECT id, email FROM users) s`): its row is only its own select list, which is checked like any other. So does a function's alias, since it is also the name of its column (`generate_series(…) AS d`).
- **One statement on the wire**: the driver sends every query over the extended protocol, which takes a single statement, and each read-only transaction sets `standard_conforming_strings = on`, so the server reads string literals exactly as the parser that checked the query did.
- **Reconnecting**: the stored password is reused only while the server, port and user stay the same. Changing any of them needs the password again (`database.password_required`), before anything is opened.
