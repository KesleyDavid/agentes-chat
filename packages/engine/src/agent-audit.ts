import { and, type Database, desc, type Executor, eq, inArray, lt, ne, or, schema, sql } from "@agenteschat/db";
import { recordAudit } from "./audit";
import type { RunAuthority } from "./authority";
import { readableChannelIds } from "./channels";
import { serverUrlShown } from "./connectors/presets";
import { cutText } from "./format";
import { can, requirePermission } from "./organizations";
import { MAKE_KEY_TOOL, REQUEST_SECRET_TOOL } from "./secrets";
import { taskSeenSql } from "./task-access";
import { redactCredentials as masked } from "./tool-detail";
import type { ToolOutput } from "./tools/types";
import { visibleWikiPageIds } from "./wiki-links";

const { auditLog, agents, approvals, channels, issues, secretRequests, users } = schema;

/**
 * The audit of what agents do: every tool call that matters, written by the
 * Tool Gateway on every brain as one `tool.call` row in `audit_log` (with the
 * run, its conversation, the person behind it and how it ended), next to what
 * people change. Admins read it all (`listAudit`).
 */

export const TOOL_CALL = "tool.call";

// `contact`: a Vault contact's fields are personal data, kept out of audit rows (ADR 0144).
const SECRET_KEY =
  /pass(word|wd|phrase)?$|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|^contact$/i;
const MAX_STRING = 500;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;
const MAX_INPUT = 4000;

/**
 * A call's input as the audit keeps it: values under secret-looking keys
 * dropped, credentials masked in every string, long strings and lists cut.
 * Enough to tell what the agent did (to whom, which repository, what title),
 * never a key someone could use.
 */
export function auditInput(input: Record<string, unknown>): Record<string, unknown> {
  const clean = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") {
      const text = masked(value);
      return text.length > MAX_STRING ? `${cutText(text, MAX_STRING)}…` : text;
    }
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_DEPTH) return "…";
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map((v) => clean(v, depth + 1));
      return value.length > MAX_ITEMS ? [...items, `… ${value.length - MAX_ITEMS} more`] : items;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "***" : clean(v, depth + 1),
      ]),
    );
  };
  const out = clean(input, 0) as Record<string, unknown>;
  const text = JSON.stringify(out);
  return text.length > MAX_INPUT ? { cut: `${cutText(text, MAX_INPUT)}…` } : out;
}

/**
 * Which calls the audit keeps. Every refusal and failure; of the rest, what
 * changes or sends something, a connected app's reads (someone's data), and
 * the computer's commands. Not looking around inside the workspace (search,
 * reading a channel), a directory's search or `pass`: they would bury the rest.
 */
export function auditsCall(
  kind: string,
  tool: { connectionId?: string | null },
  outcome: schema.AuditOutcome,
): boolean {
  if (outcome === "refused" || outcome === "failed") return kind !== "directory";
  if (kind === "read") return Boolean(tool.connectionId);
  return kind !== "directory" && kind !== "pass" && kind !== "self" && kind !== "here";
}

const MAX_TITLE = 200;

/** The call in words, as its approval card says it ("Sentry: List issues"); null when the tool has none. */
export function callTitle(
  tool: { describe?: (input: Record<string, unknown>) => { title: string } },
  input: Record<string, unknown>,
): string | null {
  try {
    return tool.describe?.(input).title ?? null;
  } catch {
    return null;
  }
}

/** The task or wiki page a call wrote, so the audit shows its title only to who sees it. */
export type ToolCallSubject = { type: "issue" | "wiki_page"; id: string };

export function callSubject(output: ToolOutput): ToolCallSubject | null {
  const issue = (output.data?.issue as { id?: unknown } | undefined)?.id;
  if (typeof issue === "string") return { type: "issue", id: issue };
  const page = output.data?.wikiPageId;
  return typeof page === "string" ? { type: "wiki_page", id: page } : null;
}

/** One tool call an agent made (see `auditsCall`). Never fails the call. */
export async function recordToolCall(
  db: Executor,
  call: {
    orgId: string;
    agentId: string;
    runId: string | null;
    channelId: string | null;
    authority: RunAuthority | null;
    tool: string;
    /** `toolKind`'s kind (`external`, `internal`, `computer`…). */
    kind: string;
    connector?: string | null;
    /** `callTitle`, or an approval's title. */
    title?: string | null;
    input: Record<string, unknown>;
    outcome: schema.AuditOutcome;
    /** Why it was refused or failed, or the agent's `why` for an approval. */
    reason?: string | null;
    /** The Tool Gateway's own refusal, as a word the apps say (`data.refusal`): `reason` is the agent's English. */
    refusal?: string | null;
    approvalId?: string | null;
    /** A call waiting for a person's secret (`request_secret`): the request. */
    secretRequestId?: string | null;
    /** A call that ran without asking under "Aprovar sempre": its rules (`approval_rules`). */
    approvalRules?: string[] | null;
    about?: ToolCallSubject | null;
  },
) {
  // A secret's variable-style name is the agent's own: people read its label (the call's title), never this.
  const { name: secretName, ...rest } = call.input;
  const named = call.tool === REQUEST_SECRET_TOOL || call.tool === MAKE_KEY_TOOL;
  const asked = named && typeof secretName === "string" && secretName ? secretName : null;
  const unnamed = (text: string) => (asked ? text.replaceAll(asked, "the secret") : text);
  const input = asked === null ? call.input : (JSON.parse(unnamed(JSON.stringify(rest))) as Record<string, unknown>);
  const reason = call.reason && unnamed(call.reason);
  await recordAudit(db, {
    orgId: call.orgId,
    actor: { type: "agent", id: call.agentId },
    action: TOOL_CALL,
    target: { type: "tool", id: call.tool },
    details: {
      kind: call.kind,
      ...(call.connector ? { connector: call.connector } : {}),
      ...(call.title ? { title: cutText(masked(call.title), MAX_TITLE) } : {}),
      behind: call.authority?.kind ?? null,
      ...(call.authority?.kind === "routine" && call.authority.brief
        ? { routine: { id: call.authority.brief.routineId, name: call.authority.brief.name } }
        : {}),
      input: auditInput(input),
      ...(reason ? { reason: cutText(masked(reason), MAX_STRING) } : {}),
      ...(call.refusal ? { refusal: call.refusal } : {}),
      ...(call.approvalId ? { approvalId: call.approvalId } : {}),
      ...(call.secretRequestId ? { secretRequestId: call.secretRequestId } : {}),
      ...(call.approvalRules?.length ? { approvalRules: call.approvalRules } : {}),
      ...(call.about ? { about: call.about } : {}),
    },
    runId: call.runId,
    channelId: call.channelId,
    onBehalfOfUserId: call.authority?.personId ?? null,
    outcome: call.outcome,
  }).catch(() => {});
}

// ── Reading it ────────────────────────────────────────────────────────────

/**
 * Rows a tool writes about itself while the gateway records the same call (`tool.call`): the reader leaves
 * them out so one action is one row. They stay in the table for whoever reads it raw.
 */
const TOOL_CALL_ECHOES = [
  "message.posted_elsewhere",
  "message.sent_dm",
  "secret.requested",
  "desktop.app_opened",
  "desktop.file_opened",
];
/** A mailbox tool's own rows (`mail.sent`, `mail.archive`…), echoes too. */
const MAIL_ECHO = "mail.%";

export type AuditActorType = "person" | "agent" | "system";

export interface AuditFilter {
  actorType?: AuditActorType;
  /** An agent's or a person's id. */
  actorId?: string;
  /** An agent's id: what it did, and what people applied from its cards (`details.via`). */
  via?: string;
  /** Any of these endings (`refused` and `failed` together: what went wrong). */
  outcome?: schema.AuditOutcome[];
  /** Only calls whose approval nobody has answered yet. */
  waiting?: boolean;
  /** `tool`: agents' tool calls only; `change`: everything else. */
  kind?: "tool" | "change";
  /** Rows older than this id (ids grow with time): the next page. */
  before?: string;
  limit?: number;
}

export interface AuditRow {
  id: string;
  at: string;
  actor: { type: AuditActorType; id: string | null; name: string | null };
  action: string;
  target: { type: string; id: string | null };
  details: Record<string, unknown>;
  runId: string | null;
  channelId: string | null;
  /** Where it happened; null when there is no conversation or it was deleted. */
  channel: { id: string; name: string; kind: schema.ChannelKind } | null;
  onBehalfOf: { id: string; name: string | null } | null;
  outcome: schema.AuditOutcome | null;
  /** The approval a call waited for (or ran after), as it stands now: a `pending` row may be decided since. */
  approval: { id: string; status: string; decidedBy: { id: string; name: string | null } | null } | null;
  /** The secret a call waited for, as it stands now (`pending`, `delivered`, `declined`, `expired`, `canceled`). */
  secret: { id: string; status: (typeof schema.secretRequestStatusEnum.enumValues)[number] } | null;
}

export const AUDIT_PAGE = 50;
export const AUDIT_PAGE_MAX = 200;

/** Tools whose input names a task or a wiki page. */
const CONTENT_TOOLS = /^(create_issue|update_issue|comment_issue|create_wiki_page|update_wiki_page|link_to_wiki)$/;

type AuditLogRow = typeof auditLog.$inferSelect;

/** The task or wiki page a row is about, when it says. */
function subjectOf(r: AuditLogRow): ToolCallSubject | null {
  if (r.action === TOOL_CALL) return (r.details.about as ToolCallSubject | undefined) ?? null;
  return r.targetId && (r.targetType === "issue" || r.targetType === "wiki_page")
    ? { type: r.targetType, id: r.targetId }
    : null;
}

/**
 * The rows that keep their title from this reader (ADR 0151). Administrators see everything; `view_audit` given to
 * anyone else shows a task's or a page's title only to who sees it. A tool call that doesn't say what it wrote (from
 * before it did, or one that failed) goes by its conversation: who doesn't read it doesn't get what was typed there.
 */
async function hiddenFrom(db: Database, orgId: string, userId: string, rows: AuditLogRow[]) {
  const subjects = rows.map((r) => [r, subjectOf(r)] as const);
  const ids = (type: ToolCallSubject["type"]) => subjects.flatMap(([, s]) => (s?.type === type ? [s.id] : []));
  const issueIds = ids("issue");
  const unnamed = rows.filter((r) => r.action === TOOL_CALL && CONTENT_TOOLS.test(r.targetId ?? "") && !subjectOf(r));
  const places = [...new Set(unnamed.flatMap((r) => (r.channelId ? [r.channelId] : [])))];
  const [seenIssues, seenPages, read, open] = await Promise.all([
    issueIds.length
      ? db
          .select({ id: issues.id })
          .from(issues)
          .where(and(inArray(issues.id, issueIds), taskSeenSql("issues", sql`${userId}::text`)))
      : Promise.resolve([]),
    visibleWikiPageIds(db, userId, ids("wiki_page")),
    readableChannelIds(db, orgId, userId, places),
    places.length
      ? db
          .select({ id: channels.id })
          .from(channels)
          .where(and(inArray(channels.id, places), eq(channels.kind, "channel"), eq(channels.visibility, "public")))
      : Promise.resolve([]),
  ]);
  const seen = new Set([...seenIssues.map((i) => i.id), ...seenPages]);
  const publicPlaces = new Set(open.map((c) => c.id));
  const hidden = new Set<string>();
  for (const [r, s] of subjects) {
    if (
      s
        ? !seen.has(s.id)
        : unnamed.includes(r) && !(r.channelId && (read.has(r.channelId) || publicPlaces.has(r.channelId)))
    )
      hidden.add(r.id);
  }
  return hidden;
}

/** Rows that carry a custom server's address: `view_audit` is not `manage_connectors`, so it leaves as its origin. */
const CUSTOM_SERVER_ACTIONS: readonly string[] = ["connector.custom_connected", "connector.custom_reconnected"];

/**
 * The org's audit log, newest first, for admins (`configure`): what people
 * changed and what agents did, with names (an agent or person since removed
 * keeps its id and a null name).
 */
export async function listAudit(
  db: Database,
  actorId: string,
  orgId: string,
  filter: AuditFilter = {},
): Promise<{ rows: AuditRow[]; next: string | null }> {
  const membership = await requirePermission(db, actorId, orgId, "view_audit");
  const limit = Math.min(Math.max(filter.limit ?? AUDIT_PAGE, 1), AUDIT_PAGE_MAX);
  const found = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.orgId, orgId),
        filter.actorType ? eq(auditLog.actorType, filter.actorType) : undefined,
        filter.actorId ? eq(auditLog.actorId, filter.actorId) : undefined,
        filter.via
          ? or(
              and(eq(auditLog.actorType, "agent"), eq(auditLog.actorId, filter.via)),
              sql`${auditLog.details}->>'via' = ${filter.via}`,
            )
          : undefined,
        filter.outcome?.length ? inArray(auditLog.outcome, filter.outcome) : undefined,
        filter.waiting
          ? and(
              eq(auditLog.outcome, "pending"),
              sql`(exists (select 1 from ${approvals} where ${approvals.orgId} = ${auditLog.orgId}
                and ${approvals.id}::text = ${auditLog.details}->>'approvalId' and ${approvals.status} = 'pending')
              or exists (select 1 from ${secretRequests} where ${secretRequests.orgId} = ${auditLog.orgId}
                and ${secretRequests.id}::text = ${auditLog.details}->>'secretRequestId'
                and ${secretRequests.status} = 'pending'))`,
            )
          : undefined,
        sql`not (${auditLog.actorType} = 'agent' and (${inArray(auditLog.action, TOOL_CALL_ECHOES)}
          or ${auditLog.action} like ${MAIL_ECHO}))`,
        filter.kind === "tool" ? eq(auditLog.action, TOOL_CALL) : undefined,
        filter.kind === "change" ? ne(auditLog.action, TOOL_CALL) : undefined,
        filter.before ? lt(auditLog.id, filter.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const page = found.slice(0, limit);
  const hidden = can(membership, "administrator") ? new Set<string>() : await hiddenFrom(db, orgId, actorId, page);

  const approvalOf = (r: (typeof page)[number]) =>
    typeof r.details.approvalId === "string" ? r.details.approvalId : null;
  const secretOf = (r: (typeof page)[number]) =>
    typeof r.details.secretRequestId === "string" ? r.details.secretRequestId : null;
  const ids = (of: (r: (typeof page)[number]) => string | null) => [
    ...new Set(page.map(of).filter((id): id is string => Boolean(id))),
  ];
  const approvalIds = ids(approvalOf);
  const secretIds = ids(secretOf);
  const channelIds = ids((r) => r.channelId);
  const [approvalRows, secretRows, channelRows] = await Promise.all([
    approvalIds.length
      ? db
          .select({ id: approvals.id, status: approvals.status, decidedBy: approvals.decidedByUserId })
          .from(approvals)
          .where(and(eq(approvals.orgId, orgId), inArray(approvals.id, approvalIds)))
      : Promise.resolve([]),
    secretIds.length
      ? db
          .select({ id: secretRequests.id, status: secretRequests.status })
          .from(secretRequests)
          .where(and(eq(secretRequests.orgId, orgId), inArray(secretRequests.id, secretIds)))
      : Promise.resolve([]),
    channelIds.length
      ? db
          .select({ id: channels.id, name: channels.name, kind: channels.kind })
          .from(channels)
          .where(and(eq(channels.orgId, orgId), inArray(channels.id, channelIds)))
      : Promise.resolve([]),
  ]);
  const approvalById = new Map(approvalRows.map((a) => [a.id, a]));
  const secretById = new Map(secretRows.map((s) => [s.id, s]));
  const channelById = new Map(channelRows.map((c) => [c.id, c]));

  const agentIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of page) {
    if (r.actorType === "agent" && r.actorId) agentIds.add(r.actorId);
    if (r.actorType === "person" && r.actorId) userIds.add(r.actorId);
    if (r.onBehalfOfUserId) userIds.add(r.onBehalfOfUserId);
  }
  for (const a of approvalRows) if (a.decidedBy) userIds.add(a.decidedBy);
  const [agentRows, userRows] = await Promise.all([
    agentIds.size
      ? db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(and(eq(agents.orgId, orgId), inArray(agents.id, [...agentIds])))
      : Promise.resolve([]),
    userIds.size
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...userIds]))
      : Promise.resolve([]),
  ]);
  const agentName = new Map(agentRows.map((a) => [a.id, a.name]));
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const nameOf = (type: string, id: string | null) =>
    id ? ((type === "agent" ? agentName.get(id) : type === "person" ? userName.get(id) : undefined) ?? null) : null;

  return {
    rows: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: { type: r.actorType as AuditActorType, id: r.actorId, name: nameOf(r.actorType, r.actorId) },
      action: r.action,
      target: { type: r.targetType, id: r.targetId },
      // A tool call's input was cleaned when it was written; the rest (a server's address, a database's
      // host…) is cleaned here, as it leaves.
      details: hidden.has(r.id)
        ? r.action === TOOL_CALL
          ? { kind: r.details.kind, behind: r.details.behind, input: {} }
          : {}
        : r.action === TOOL_CALL
          ? r.details
          : auditInput(
              CUSTOM_SERVER_ACTIONS.includes(r.action) && typeof r.details.serverUrl === "string"
                ? { ...r.details, serverUrl: serverUrlShown(r.details.serverUrl) }
                : r.details,
            ),
      runId: r.runId,
      channelId: r.channelId,
      channel: (r.channelId && (channelById.get(r.channelId) as AuditRow["channel"])) || null,
      onBehalfOf: r.onBehalfOfUserId
        ? { id: r.onBehalfOfUserId, name: userName.get(r.onBehalfOfUserId) ?? null }
        : null,
      outcome: r.outcome ?? null,
      approval: (() => {
        const a = approvalById.get(approvalOf(r) ?? "");
        if (!a) return null;
        return {
          id: a.id,
          status: a.status,
          decidedBy: a.decidedBy ? { id: a.decidedBy, name: userName.get(a.decidedBy) ?? null } : null,
        };
      })(),
      secret: secretById.get(secretOf(r) ?? "") ?? null,
    })),
    next: found.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}
