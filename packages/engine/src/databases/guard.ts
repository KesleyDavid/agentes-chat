import { parse } from "libpg-query";
import { identPath, parseIdentPath, quoteIdent, tableRuleNames } from "./identifiers";

/**
 * What an agent's SQL may be (ADR 0039), checked with Postgres's own parser
 * (libpg-query, WASM) before anything reaches the database:
 * one statement; a `SELECT` (with `WITH`) or an `EXPLAIN` of one without
 * `ANALYZE`; no other statement anywhere (data-changing CTEs, `SELECT INTO`,
 * `FOR UPDATE`); no function that sleeps, reads files, signals backends or
 * runs SQL from text; and the agent's rules (tables, hidden columns). The
 * read-only transaction and the role are the other layers.
 */

/** A relation as `schema.table` (`identPath`: exact names, quoted where needed; unqualified = `public`). */
export type RelationName = string;

export interface SqlRules {
  /** `schema.table` (`identPath`); empty = every table. */
  tables: string[];
  /** `schema.table.column` (`identPath`). */
  hiddenColumns: string[];
}

export type GuardResult =
  | { ok: true; kind: "select" | "explain"; body: string; relations: RelationName[] }
  | { ok: false; reason: string };

const BLOCKED_FUNCTIONS = new Set([
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "pg_ls_logdir",
  "pg_ls_waldir",
  "pg_ls_tmpdir",
  "pg_ls_archive_statusdir",
  "pg_logdir_ls",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_switch_wal",
  "pg_promote",
  "pg_notify",
  "set_config",
  "pg_drop_replication_slot",
  "dblink",
  // Run the SQL text they are given (full-text statistics and rewrites, the tablefunc and xml2 extensions).
  "ts_stat",
  "ts_rewrite",
  "connectby",
  "xpath_table",
]);
/** Refused by prefix: large objects, dblink, advisory locks, SQL-from-text (XML, crosstab), admin files, replication. */
const BLOCKED_PREFIXES = [
  "crosstab",
  "lo_",
  "dblink_",
  "pg_advisory_",
  "pg_try_advisory_",
  "query_to_xml",
  "cursor_to_xml",
  "table_to_xml",
  "schema_to_xml",
  "database_to_xml",
  "pg_file_",
  "pg_create_",
  "pg_replication_",
  "pg_logical_",
];
/** Catalogs that hold data values (statistics) or secrets: never read. */
const BLOCKED_RELATIONS = new Set([
  "pg_catalog.pg_statistic",
  "pg_catalog.pg_statistic_ext",
  "pg_catalog.pg_statistic_ext_data",
  "pg_catalog.pg_stats",
  "pg_catalog.pg_stats_ext",
  "pg_catalog.pg_stats_ext_exprs",
  "pg_catalog.pg_authid",
  "pg_catalog.pg_shadow",
  "pg_catalog.pg_user_mapping",
  "pg_catalog.pg_user_mappings",
]);
/**
 * A whole-server connection's role reaches every customer's database: what shows other databases' names or
 * sessions (the SQL text of the same role's queries elsewhere) is never read there.
 */
const WHOLE_SERVER_BLOCKED_RELATIONS = new Set([
  "pg_catalog.pg_stat_activity",
  "pg_catalog.pg_database",
  "pg_catalog.pg_stat_database",
  "pg_catalog.pg_stat_database_conflicts",
]);
const WHOLE_SERVER_BLOCKED_FUNCTIONS = new Set([
  "pg_stat_get_activity",
  "pg_stat_statements",
  "pg_stat_statements_info",
  // Probes whether a database outside the agent's list exists.
  "pg_database_size",
]);
/** `pg_stat_get_backend_activity(n)` and its siblings: another session's SQL text, database and user. */
const WHOLE_SERVER_BLOCKED_PREFIXES = ["pg_stat_get_backend"];
const CATALOG_SCHEMAS = new Set(["pg_catalog", "information_schema"]);
/**
 * Relations of `pg_catalog` that an unqualified name resolves to (Postgres searches `pg_catalog` before
 * `public`). Any other unqualified `pg_*` name is a table in `public` and goes through the agent's rules.
 * Kept to those every Postgres from 14 on has, so a listed name is a catalog on any of them; newer catalogs
 * are read schema-qualified (`pg_catalog.pg_stat_io`).
 */
const CATALOG_RELATIONS = new Set(
  `
  pg_aggregate pg_am pg_amop pg_amproc pg_attrdef pg_attribute pg_authid pg_auth_members pg_cast pg_class
  pg_collation pg_constraint pg_conversion pg_database pg_db_role_setting pg_default_acl pg_depend
  pg_description pg_enum pg_event_trigger pg_extension pg_foreign_data_wrapper pg_foreign_server
  pg_foreign_table pg_index pg_inherits pg_init_privs pg_language pg_largeobject pg_largeobject_metadata
  pg_namespace pg_opclass pg_operator pg_opfamily pg_partitioned_table pg_policy pg_proc pg_publication
  pg_publication_rel pg_range pg_replication_origin pg_rewrite pg_seclabel pg_sequence pg_shdepend
  pg_shdescription pg_shseclabel pg_statistic pg_statistic_ext pg_statistic_ext_data pg_subscription
  pg_subscription_rel pg_tablespace pg_transform pg_trigger pg_ts_config pg_ts_config_map pg_ts_dict
  pg_ts_parser pg_ts_template pg_type pg_user_mapping
  pg_available_extensions pg_available_extension_versions pg_backend_memory_contexts pg_config pg_cursors
  pg_file_settings pg_group pg_hba_file_rules pg_indexes pg_locks pg_matviews pg_policies pg_prepared_statements
  pg_prepared_xacts pg_publication_tables pg_replication_origin_status pg_replication_slots pg_roles pg_rules
  pg_seclabels pg_sequences pg_settings pg_shadow pg_shmem_allocations pg_stats pg_stats_ext pg_stats_ext_exprs
  pg_tables pg_timezone_abbrevs pg_timezone_names pg_user pg_user_mappings pg_views pg_stat_activity
  pg_stat_all_indexes pg_stat_all_tables pg_stat_archiver pg_stat_bgwriter pg_stat_database
  pg_stat_database_conflicts pg_stat_gssapi pg_stat_progress_analyze pg_stat_progress_basebackup
  pg_stat_progress_cluster pg_stat_progress_copy pg_stat_progress_create_index pg_stat_progress_vacuum
  pg_stat_replication pg_stat_replication_slots pg_stat_slru pg_stat_ssl pg_stat_subscription
  pg_stat_sys_indexes pg_stat_sys_tables pg_stat_user_functions pg_stat_user_indexes pg_stat_user_tables
  pg_stat_wal pg_stat_wal_receiver pg_stat_xact_all_tables pg_stat_xact_sys_tables pg_stat_xact_user_functions
  pg_stat_xact_user_tables pg_statio_all_indexes pg_statio_all_sequences pg_statio_all_tables
  pg_statio_sys_indexes pg_statio_sys_sequences pg_statio_sys_tables pg_statio_user_indexes
  pg_statio_user_sequences pg_statio_user_tables
  `
    .trim()
    .split(/\s+/),
);

const lower = (s: string) => s.toLowerCase();
/** `schema.table` or `table` (SQL, quoted parts kept exact) → the stored form; null when it isn't a table name. */
export function relationName(name: string): RelationName | null {
  const parts = parseIdentPath(name, 2);
  return parts && identPath(parts);
}

/** The agent's allowed tables as stored; empty = every table. */
export const allowedRelations = (tables: string[]) =>
  new Set(tables.map(relationName).filter((n): n is RelationName => n !== null));

/** Whether `allowedRelations` lets the agent read one table (empty = every table). */
export const relationAllowed = (allowed: Set<string>, schema: string, table: string) =>
  allowed.size === 0 || tableRuleNames(schema, table).some((n) => allowed.has(n));

/**
 * The hidden columns of one table, matched case-insensitively: rules saved before names were kept exact are
 * lowercase, and hiding a column that differs only in case is the safe side. A stored entry that doesn't parse
 * hides its last part on every table rather than nothing.
 */
export function hiddenColumnsOf(hiddenColumns: string[], schema: string, table: string): string[] {
  return hiddenColumns.flatMap((h) => {
    const parts = parseIdentPath(h, 3);
    if (!parts) {
      const last = h.slice(h.lastIndexOf(".") + 1).trim();
      return last ? [last] : [];
    }
    const [s = "", t = "", column = ""] = parts;
    return lower(s) === lower(schema) && lower(t) === lower(table) ? [column] : [];
  });
}

type Node = Record<string, unknown>;
const isObject = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const svalsOf = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.map((n) => (isObject(n) && isObject(n.String) ? String(n.String.sval ?? "") : "")).filter(Boolean)
    : [];

const NO_CTES: ReadonlySet<string> = new Set();
const cteNameOf = (item: unknown) =>
  isObject(item) && isObject(item.CommonTableExpr) && typeof item.CommonTableExpr.ctename === "string"
    ? item.CommonTableExpr.ctename
    : null;

/**
 * Every node of the tree with its key (`SelectStmt`, `FuncCall`…) and the CTE names visible there, scoped as
 * Postgres does: a `WITH` names its queries for its own statement and everything nested in it, never outside;
 * a query of the list sees the ones before it, and itself and the ones after it only under `RECURSIVE`.
 */
function walk(
  value: unknown,
  visit: (key: string, node: Node, ctes: ReadonlySet<string>) => void,
  ctes: ReadonlySet<string> = NO_CTES,
) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, ctes);
    return;
  }
  if (!isObject(value)) return;
  const withClause = isObject(value.withClause) ? value.withClause : null;
  const items = withClause && Array.isArray(withClause.ctes) ? withClause.ctes : [];
  const names = items.map(cteNameOf).filter((n): n is string => n !== null);
  const inner = names.length > 0 ? new Set([...ctes, ...names]) : ctes;
  for (const [key, child] of Object.entries(value)) {
    if (child === withClause && withClause) {
      visit(key, withClause, ctes);
      let seen = withClause.recursive === true ? inner : ctes;
      for (const item of items) {
        walk(item, visit, seen);
        const name = cteNameOf(item);
        if (name !== null && withClause.recursive !== true) seen = new Set([...seen, name]);
      }
      continue;
    }
    if (isObject(child)) visit(key, child, inner);
    walk(child, visit, inner);
  }
}

/**
 * Checks one agent query; `rules` are the agent's tables and hidden columns there. `wholeServer`: the connection
 * reads every database of its server (see `WHOLE_SERVER_BLOCKED_RELATIONS`).
 */
export async function guardSql(
  text: string,
  rules: SqlRules,
  options: { wholeServer?: boolean } = {},
): Promise<GuardResult> {
  const sqlText = text.trim();
  if (!sqlText) return { ok: false, reason: "The query is empty." };
  if (sqlText.length > 20_000) return { ok: false, reason: "The query is too long (at most 20,000 characters)." };
  let tree: { stmts?: { stmt: Node; stmt_location?: number; stmt_len?: number }[] };
  try {
    tree = await parse(sqlText);
  } catch (error) {
    return { ok: false, reason: `Postgres can't parse this query: ${error instanceof Error ? error.message : error}` };
  }
  const stmts = tree.stmts ?? [];
  if (stmts.length !== 1) return { ok: false, reason: "Send exactly one statement per call." };
  const first = stmts[0];
  if (!first) return { ok: false, reason: "The query is empty." };
  const top = first.stmt;
  let kind: "select" | "explain";
  if (isObject(top.SelectStmt)) kind = "select";
  else if (isObject(top.ExplainStmt)) {
    const explain = top.ExplainStmt;
    if (!isObject(explain.query) || !isObject(explain.query.SelectStmt))
      return { ok: false, reason: "Only EXPLAIN of a SELECT is allowed." };
    const analyze = (Array.isArray(explain.options) ? explain.options : []).some(
      (o) => isObject(o) && isObject(o.DefElem) && lower(String(o.DefElem.defname ?? "")) === "analyze",
    );
    if (analyze) return { ok: false, reason: "EXPLAIN ANALYZE runs the query; use EXPLAIN without ANALYZE." };
    kind = "explain";
  } else {
    return {
      ok: false,
      reason: "Only SELECT queries (and EXPLAIN of a SELECT) are allowed: this database is read-only.",
    };
  }

  const problems: string[] = [];
  const relations: { schema: string | null; table: string; alias: string | null; cte: boolean }[] = [];
  const aliases: string[] = [];
  let crossDatabase = false;
  const functions: string[] = [];
  const columnRefs: string[][] = [];
  let star = false;
  let aliasColumns = false;
  walk(top, (key, node, ctes) => {
    if (key.endsWith("Stmt") && key !== "SelectStmt" && key !== "ExplainStmt")
      problems.push(`${key.replace(/Stmt$/, "").toUpperCase()} is not allowed: this database is read-only.`);
    if (key === "SelectStmt") {
      if (node.intoClause) problems.push("SELECT INTO is not allowed.");
      if (node.lockingClause) problems.push("FOR UPDATE / FOR SHARE is not allowed.");
    }
    // The parser already folds unquoted names to lowercase and keeps quoted ones exact, as Postgres resolves them.
    if (key === "RangeVar" && typeof node.catalogname === "string") crossDatabase = true;
    if (key === "RangeVar" && typeof node.relname === "string") {
      const schema = typeof node.schemaname === "string" ? node.schemaname : null;
      const alias = isObject(node.alias) && typeof node.alias.aliasname === "string" ? node.alias.aliasname : null;
      relations.push({ schema, table: node.relname, alias, cte: schema === null && ctes.has(node.relname) });
    }
    // The name given to a join (`AS j`, `JOIN … USING (id) AS j`): a row of every column of the tables under it.
    // A subquery's alias is left out: its row is only its own select list, which is checked like any other.
    // A function's alias too: it is also the name of its one column (`generate_series(…) AS d`).
    if (key === "JoinExpr")
      for (const a of [node.alias, node.join_using_alias])
        if (isObject(a) && typeof a.aliasname === "string") aliases.push(a.aliasname);
    // `t(a, b)` after a table, join, subquery or function renames its columns by position.
    if (key === "alias" && Array.isArray(node.colnames) && node.colnames.length > 0) aliasColumns = true;
    if (key === "FuncCall") functions.push(lower(svalsOf(node.funcname).at(-1) ?? ""));
    if (key === "ColumnRef" && Array.isArray(node.fields)) {
      const fields = node.fields as unknown[];
      if (fields.some((f) => isObject(f) && "A_Star" in f)) star = true;
      columnRefs.push(svalsOf(fields));
    }
  });
  if (problems[0]) return { ok: false, reason: problems[0] };
  if (crossDatabase)
    return {
      ok: false,
      reason: options.wholeServer
        ? "Name tables as schema.table: pass the database in `database`, one per query."
        : "Name tables as schema.table, without a database name.",
    };

  for (const fn of functions) {
    if (
      BLOCKED_FUNCTIONS.has(fn) ||
      BLOCKED_PREFIXES.some((p) => fn.startsWith(p)) ||
      (options.wholeServer &&
        (WHOLE_SERVER_BLOCKED_FUNCTIONS.has(fn) || WHOLE_SERVER_BLOCKED_PREFIXES.some((p) => fn.startsWith(p))))
    )
      return { ok: false, reason: `The function ${fn}() is not allowed here.` };
  }

  // Unqualified names that aren't a CTE visible where they are written are catalogs (pg_catalog is searched
  // first) or tables in `public` (the search path we set).
  const resolved = relations
    .filter((r) => !r.cte)
    .map((r) => {
      const schema = r.schema ?? (CATALOG_RELATIONS.has(r.table) ? "pg_catalog" : "public");
      return { ...r, schema, name: identPath([schema, r.table]) };
    });
  const allowed = allowedRelations(rules.tables);
  for (const r of resolved) {
    if (BLOCKED_RELATIONS.has(r.name)) return { ok: false, reason: `${r.name} is not allowed (it holds data values).` };
    if (options.wholeServer && (WHOLE_SERVER_BLOCKED_RELATIONS.has(r.name) || r.table.startsWith("pg_stat_statements")))
      return { ok: false, reason: `${r.name} is not allowed here (it shows other databases of this server).` };
    if (CATALOG_SCHEMAS.has(r.schema)) continue;
    if (!relationAllowed(allowed, r.schema, r.table))
      return {
        ok: false,
        reason: `Not allowed: this agent may only read the tables ${[...allowed].join(", ")}.`,
      };
  }

  // Hidden columns of the tables this query reads: never named, never through * or a whole-row reference.
  const hiddenOf = (r: { schema: string; table: string }) => hiddenColumnsOf(rules.hiddenColumns, r.schema, r.table);
  const touched = resolved.filter((r) => hiddenOf(r).length > 0);
  if (touched.length > 0) {
    const hidden = new Set(touched.flatMap((r) => hiddenOf(r).map(lower)));
    // A join's alias stands for a whole row too, with every column of the tables under it.
    const rowNames = new Set(
      [...touched.flatMap((r) => [r.alias, r.table]), ...aliases].filter((x): x is string => !!x).map(lower),
    );
    const list = touched.map((r) => `${r.name}: ${hiddenOf(r).map(quoteIdent).join(", ")}`).join("; ");
    if (aliasColumns)
      return {
        ok: false,
        reason: `Some columns are hidden from this agent (${list}); don't rename columns with an alias list like t(a, b).`,
      };
    if (star)
      return {
        ok: false,
        reason: `Some columns are hidden from this agent (${list}). Name the columns you need instead of *.`,
      };
    for (const ref of columnRefs) {
      const last = ref.at(-1);
      if (last && hidden.has(lower(last)))
        return { ok: false, reason: `The column ${quoteIdent(last)} is hidden from this agent (${list}).` };
      // `t`, `dbo.t` or `(dbo.t).col`: the whole row of a table or alias (a column named like one is refused too).
      if (last && rowNames.has(lower(last)))
        return {
          ok: false,
          reason: `Some columns are hidden from this agent (${list}); ${quoteIdent(last)} would read a whole row: name the columns you need, like alias.column.`,
        };
    }
  }

  const start = first.stmt_location ?? 0;
  const body = (first.stmt_len ? sqlText.slice(start, start + first.stmt_len) : sqlText.slice(start))
    .trim()
    .replace(/;+\s*$/, "");
  return { ok: true, kind, body, relations: [...new Set(resolved.map((r) => r.name))] };
}

/**
 * Built-in functions that only compute (aggregates, windows, text, numbers, dates, JSON, sizes): with no read-only
 * transaction around it, a call of anything else (a sequence's `nextval`, the workspace's own functions, which can
 * write) keeps a query from being proven read-only.
 */
const COMPUTING_FUNCTIONS = new Set(
  `
  count sum avg min max array_agg string_agg json_agg jsonb_agg json_object_agg jsonb_object_agg bool_and bool_or
  every bit_and bit_or stddev stddev_samp stddev_pop variance var_samp var_pop corr covar_pop covar_samp
  regr_slope regr_intercept percentile_cont percentile_disc mode row_number rank dense_rank percent_rank
  cume_dist ntile lag lead first_value last_value nth_value coalesce nullif greatest least
  now current_date current_timestamp localtimestamp statement_timestamp transaction_timestamp clock_timestamp
  date_trunc date_part date_bin extract age make_date make_time make_timestamp make_timestamptz make_interval
  to_char to_date to_timestamp to_number timezone justify_days justify_hours justify_interval isfinite
  lower upper initcap length char_length octet_length bit_length trim btrim ltrim rtrim lpad rpad substring
  substr replace translate concat concat_ws left right position strpos split_part repeat reverse starts_with
  regexp_replace regexp_match regexp_matches regexp_split_to_array regexp_split_to_table regexp_like
  regexp_count regexp_substr format quote_ident quote_literal quote_nullable md5 sha256 encode decode
  string_to_array array_to_string unaccent
  abs round ceil ceiling floor trunc mod power pow sqrt cbrt exp ln log log10 sign div pi random width_bucket
  generate_series generate_subscripts unnest array_length array_lower array_upper array_position
  array_positions array_remove array_append array_prepend array_cat cardinality
  to_json to_jsonb row_to_json array_to_json json_build_object jsonb_build_object json_build_array
  jsonb_build_array json_object jsonb_object json_array_length jsonb_array_length json_typeof jsonb_typeof
  json_extract_path json_extract_path_text jsonb_extract_path jsonb_extract_path_text json_object_keys
  jsonb_object_keys json_each json_each_text jsonb_each jsonb_each_text json_array_elements
  json_array_elements_text jsonb_array_elements jsonb_array_elements_text jsonb_pretty jsonb_set jsonb_insert
  jsonb_strip_nulls jsonb_path_query jsonb_path_query_array jsonb_path_query_first jsonb_path_exists
  jsonb_path_match
  pg_size_pretty pg_total_relation_size pg_relation_size pg_table_size pg_indexes_size pg_database_size
  pg_column_size current_database current_schema current_schemas current_user session_user version
  format_type pg_get_indexdef pg_get_viewdef pg_get_constraintdef pg_get_functiondef pg_get_triggerdef
  pg_get_expr pg_get_userbyid pg_get_serial_sequence obj_description col_description shobj_description
  pg_table_is_visible pg_typeof has_table_privilege has_schema_privilege has_column_privilege
  gen_random_uuid uuid_generate_v4
  `
    .trim()
    .split(/\s+/),
);

/**
 * Built-in operators (and the names the parser gives `LIKE`, `BETWEEN`, `IN`…): any other symbol is one the workspace
 * made, whose function can write.
 */
const BUILTIN_OPERATORS = new Set([
  ..."= <> < > <= >= + - * / % ^ || ~~ !~~ ~~* !~~* ~ ~* !~ !~* @> <@ ? ?| ?& -> ->> #> #>> #- @? @@ &&".split(" "),
  "between",
  "not between",
  "between symmetric",
  "not between symmetric",
]);
/** Built-in types a cast may name without `pg_catalog.` (the parser qualifies the SQL-standard ones itself). */
const BUILTIN_TYPES = new Set(
  "text date timestamptz timetz uuid json jsonb bytea name oid regclass regtype inet cidr macaddr money tsvector tsquery".split(
    " ",
  ),
);

/**
 * Whether Postgres's own parser shows this SQL can't change anything (ADR 0015, "Aprovar sempre leituras"): one or
 * more statements, each a `SELECT` or an `EXPLAIN` of one that `guardSql` lets through (no data-changing CTE, no
 * `SELECT INTO`, no lock), calling only built-in functions that compute, built-in operators and casts to built-in
 * types, and no `TABLESAMPLE`. Comments and trailing semicolons are fine. Anything it can't parse is not proven.
 * ponytail: what the database resolves by the values' types is not seen: a view that calls a writing function, or the
 * workspace's own overload of a built-in name for its own type (`lower(my_type)`, `=` on it, a cast from it); a
 * workspace that has one removes the rule, or the database's own read-only role covers it.
 */
export async function provenReadOnly(text: string): Promise<boolean> {
  const sqlText = text.trim();
  if (!sqlText || sqlText.length > 20_000) return false;
  let tree: { stmts?: { stmt: Node; stmt_location?: number; stmt_len?: number }[] };
  try {
    tree = await parse(sqlText);
  } catch {
    return false;
  }
  const stmts = tree.stmts ?? [];
  if (stmts.length === 0) return false;
  // The parser's positions count UTF-8 bytes, not the string's characters.
  const bytes = Buffer.from(sqlText);
  for (const s of stmts) {
    const start = s.stmt_location ?? 0;
    const one = bytes.subarray(start, s.stmt_len ? start + s.stmt_len : undefined).toString();
    if (!(await guardSql(one, { tables: [], hiddenColumns: [] })).ok) return false;
  }
  let computes = true;
  const builtin = (names: string[], known: ReadonlySet<string>) =>
    names[0] === "pg_catalog" ? names.length === 2 : names.length === 1 && known.has(names[0] ?? "");
  walk(stmts, (key, node) => {
    if (key === "RangeTableSample") computes = false;
    else if (key === "TypeCast")
      computes &&= builtin(svalsOf((node.typeName as Node | undefined)?.names).map(lower), BUILTIN_TYPES);
    else if (key === "A_Expr" || key === "SubLink") {
      const names = svalsOf(key === "A_Expr" ? node.name : node.operName).map(lower);
      computes &&= names.length === 0 || builtin(names, BUILTIN_OPERATORS);
    } else if (key === "FuncCall") {
      const names = svalsOf(node.funcname).map(lower);
      if (names.length > 1 && names[0] !== "pg_catalog") computes = false;
      if (!COMPUTING_FUNCTIONS.has(names.at(-1) ?? "")) computes = false;
    }
  });
  return computes;
}
