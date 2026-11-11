import type { TFunction } from "i18next";
import {
  type Agent,
  type AgentDraft,
  type AgentProposalCard,
  type AiStatus,
  type CalendarProposal,
  type CardDelegate,
  type CostKind,
  type CostlyDecision,
  type Member,
  type PersonLimitCard,
  type ProposedRoutine,
  type Role,
  type Skill,
  type SuggestedAi,
  type TeamProposalCard,
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionCard,
} from "../api/types";
import type { Level } from "./access-levels";
import { workspaceActionContext, workspaceActionWords } from "./actions";
import { type AppPage, isAppPage } from "./app-pages";
import type { ConnectedItem } from "./connected";
import { isHttpsUrl, serverCovers } from "./custom-tools";
import { formatUsd, joinNames } from "./format";
import { aiStateOf, PLAN_BRAIN } from "./no-ai";
import type { Permission } from "./permissions";
import { type TeamWeekCard, teamWeekCardOf } from "./team-week";
import { type UsagePauseCard, usagePauseCardOf } from "./usage-pause";

/**
 * An agent's action card (ADR 0061, `meta.actionCard`): its button opens the app's own dialog, filled in.
 * The card keeps no state; whether it's done comes from live data. Platform-neutral (web and phone).
 */

export type ConnectAiStep = "claude" | "chatgpt" | "api_key";

/** "Conectar uma IA": the Connect dialog at a step, for the agents the card names. */
export interface ConnectAiCard {
  kind: "connect_ai";
  /** Who the agent offered it to (the person behind its run). */
  forUserId: string | null;
  /** None: the dialog's first step (a plan or a key). */
  what?: ConnectAiStep;
  /** With `api_key`: the provider to pick. */
  provider?: string;
  /** None: any agent the person may change. */
  agentIds: string[];
  /** The agent's line for the person. */
  why: string;
}

const STEPS: ReadonlySet<string> = new Set<ConnectAiStep>(["claude", "chatgpt", "api_key"]);

/**
 * A stretch's pause card (ADR 0089): agents did what they may do on their own since a person last acted, and wait
 * here. Continuar (`api.chat.answerNow` on the card) lets them go on; the card then says who did, and when.
 */
export interface StretchCard {
  kind: "stretch_paused";
  state: "paused" | "continued";
  /** `runs`: the steps agents may take on their own ran out (`limit`, never shown); `spend`: `limit`% of an agent's monthly budget. */
  reason: "runs" | "spend";
  limit: number;
  /** The person behind the work (else the routine's creator): with the agents' owners and admins, who may go on. */
  forUserId: string | null;
  /** The agents that stopped. */
  agentIds: string[];
  continuedByUserId: string | null;
  continuedAt: string | null;
}

export function stretchCardOf(meta: Record<string, unknown> | null | undefined): StretchCard | null {
  const raw = meta?.actionCard as Partial<StretchCard> | undefined;
  if (raw?.kind !== "stretch_paused" || !Array.isArray(raw.agentIds) || typeof raw.limit !== "number") return null;
  return {
    kind: "stretch_paused",
    state: raw.state === "continued" ? "continued" : "paused",
    reason: raw.reason === "spend" ? "spend" : "runs",
    limit: raw.limit,
    forUserId: typeof raw.forUserId === "string" ? raw.forUserId : null,
    agentIds: raw.agentIds.filter((id): id is string => typeof id === "string"),
    continuedByUserId: typeof raw.continuedByUserId === "string" ? raw.continuedByUserId : null,
    continuedAt: typeof raw.continuedAt === "string" ? raw.continuedAt : null,
  };
}

/**
 * "Ada e Theo pararam para checar com você antes de continuar", in the reader's language. A budget pause says the
 * share it used, and `cost` that share in money for people who may see it ("US$ 10,00"). No step count: it means
 * nothing to the person (an old card's `limit` on a run pause is never shown).
 */
export function stretchCardText(t: TFunction, card: StretchCard, names: string[], cost?: string | null) {
  // Plurals by `count` and the `_cost` context are past what the typed keys can check here.
  const say = t as unknown as (key: string, options: Record<string, unknown>) => string;
  const agents = joinNames(names, t);
  const count = names.length;
  if (card.reason === "runs") return say("chat.body.stretch_paused_runs", { agents, count });
  return say("chat.body.stretch_paused_spend", {
    agents,
    count,
    percent: card.limit,
    ...(cost ? { context: "cost", amount: cost } : {}),
  });
}

/** Continuar is for whoever asked, the agents' owners or an admin: the same people as Continuar under a stopped reply. */
export const mayContinueStretch = (
  card: StretchCard,
  meId: string | null,
  ownerOf: (agentId: string) => string | null | undefined,
  admin: boolean,
) => admin || (meId !== null && (card.forUserId === meId || card.agentIds.some((id) => ownerOf(id) === meId)));

/**
 * "Conectar Linear" / "Adicionar MCP" (`offer_connect_app`): the connect dialog at a catalog entry, or at connecting by
 * address with `url` filled in (neither: the address is typed there).
 */
export interface ConnectAppCard {
  kind: "connect_app";
  forUserId: string | null;
  connector?: string;
  url?: string;
  why: string;
}

/** "Convidar pessoas" (`offer_invites`): the invite dialog with these addresses filled in, as members. */
export interface InviteCard {
  kind: "invite_people";
  forUserId: string | null;
  emails: string[];
  why: string;
}

/**
 * "Instalar skill" (`offer_install_skill`): the install dialog with the skill's GitHub link filled in, where a person
 * who manages skills picks it and installs it.
 */
export interface InstallSkillCard {
  kind: "install_skill";
  forUserId: string | null;
  url: string;
  why: string;
}

/**
 * "Atualizar skills" (`update_skill_from_source`): the skills to update from their links, or whose update waits on
 * its files that run; each opens in Skills, where who manages skills updates it or applies what waits.
 */
export interface UpdateSkillsCard {
  kind: "update_skills";
  forUserId: string | null;
  skillIds: string[];
  why: string;
}

/**
 * The right hand's card of a teammate's settings (ADR 0137): one card, a row per agent and decider
 * (`proposals.list({ ids })` reads them).
 */
export interface SettingsProposalCard {
  kind: "settings_proposal";
  forUserId: string | null;
  proposalIds: string[];
  /** The right hand looked at it for the person it is for (ADR 0139 §2). */
  delegate?: CardDelegate | null;
}

/** "Decidir aprovações" (`offer_approvals`, ADR 0137 §4): approvals waiting for this person, decided on the card. */
export interface ApprovalsCard {
  kind: "approvals";
  forUserId: string | null;
  approvalIds: string[];
  why: string;
}

/** One person's change on a people card (`propose_member_changes`). */
export type MemberChangeRow = { userId: string; name: string } & (
  | { role: Role }
  | { addRoleIds: string[]; removeRoleIds: string[] }
  | { remove: true }
);

/** "Mudar pessoas": a row per change, applied with the members screen's own calls and confirmation. */
export interface MemberChangesCard {
  kind: "member_changes";
  forUserId: string | null;
  rows: MemberChangeRow[];
  why: string;
}

/** "Abrir …" (`offer_open_page`): one of the app's screens, at an agent or a channel for those two. */
export interface OpenPageCard {
  kind: "open_page";
  forUserId: string | null;
  page: AppPage;
  agentId?: string;
  channelId?: string;
  why: string;
}

/** An agent's event proposal (`propose_event`): the person who asked confirms it, which creates the event. */
export interface CalendarProposalCard {
  kind: "calendar_proposal";
  proposal: CalendarProposal;
}

const PROPOSAL_STATES: readonly string[] = ["pending", "confirmed", "dismissed"];

/** The proposal on its message (`meta.calendarProposal`), only as the server writes it whole. */
export function calendarProposalCardOf(meta: Record<string, unknown> | null | undefined): CalendarProposalCard | null {
  const p = meta?.calendarProposal as Partial<CalendarProposal> | undefined;
  if (!p || typeof p !== "object") return null;
  const texts = [p.id, p.agentId, p.title, p.start, p.end].every((v) => typeof v === "string");
  if (!texts || !Array.isArray(p.participants) || !PROPOSAL_STATES.includes(p.status ?? "")) return null;
  return { kind: "calendar_proposal", proposal: p as CalendarProposal };
}

export type ActionCard =
  | CalendarProposalCard
  | WorkspaceActionCard
  | ApprovalsCard
  | MemberChangesCard
  | OpenPageCard
  | ConnectAiCard
  | ConnectAppCard
  | InviteCard
  | InstallSkillCard
  | UpdateSkillsCard
  | SettingsProposalCard
  | AgentProposalCard
  | TeamProposalCard
  | StretchCard
  | UsagePauseCard
  | CostlyProposalCard
  | PersonLimitCard
  | TeamWeekCard;

/** The card an agent posts when the person behind its run is at their monthly limit (ADR 0141). */
export const personLimitCardOf = (meta: Record<string, unknown> | null | undefined): PersonLimitCard | null => {
  const c = meta?.actionCard as Partial<PersonLimitCard> | undefined;
  return c?.kind === "person_limit" && typeof c.agentId === "string" && typeof c.state === "string"
    ? (c as PersonLimitCard)
    : null;
};

/**
 * An agent asks before costly work nobody asked for directly (ADR 0131 §3): opening a PR, installing packages, a long
 * job. Its person (or the agent's owner, or who manages agents) says go for this time, always, not now, or never for
 * this kind; the card keeps what they said.
 */
export interface CostlyProposalCard {
  kind: "autonomy_proposal";
  signalId: string;
  agentId: string;
  cost: CostKind;
  /** What it wants to run or call, as the agent would (a command, a tool). */
  what: string;
  forUserId: string | null;
  state: "open" | CostlyDecision;
  decidedByUserId: string | null;
}

/** The costly-work proposal on a message, or null. */
export function costlyProposalOf(meta: Record<string, unknown> | null | undefined): CostlyProposalCard | null {
  const raw = meta?.actionCard as Partial<CostlyProposalCard> | undefined;
  if (raw?.kind !== "autonomy_proposal" || typeof raw.signalId !== "string" || typeof raw.agentId !== "string")
    return null;
  const cost: CostKind = raw.cost === "install" || raw.cost === "long" ? raw.cost : "pr";
  const states = ["go", "not_now", "never", "always"] as const;
  return {
    kind: "autonomy_proposal",
    signalId: raw.signalId,
    agentId: raw.agentId,
    cost,
    what: typeof raw.what === "string" ? raw.what : "",
    forUserId: typeof raw.forUserId === "string" ? raw.forUserId : null,
    state: states.find((s) => s === raw.state) ?? "open",
    decidedByUserId: typeof raw.decidedByUserId === "string" ? raw.decidedByUserId : null,
  };
}

/** Who may decide it: the person it is for, the agent's owner, or someone who manages agents. */
export const mayDecideCostly = (
  card: CostlyProposalCard,
  userId: string,
  ownerOf: (agentId: string) => string | null | undefined,
  managesAgents: boolean,
) => card.forUserId === userId || mayRememberCostly(card, userId, ownerOf, managesAgents);

/** Who may answer it for every time ("Sempre", "Nunca"), which changes the agent: its owner or who manages agents. */
export const mayRememberCostly = (
  card: CostlyProposalCard,
  userId: string,
  ownerOf: (agentId: string) => string | null | undefined,
  managesAgents: boolean,
) => ownerOf(card.agentId) === userId || managesAgents;

/** An agent's proposal of a new agent (ADR 0081), or null. Unlike the Connect card, it keeps its state. */
export function agentProposalOf(meta: Record<string, unknown> | null | undefined): AgentProposalCard | null {
  const raw = meta?.actionCard as Partial<AgentProposalCard> | undefined;
  return raw?.kind === "agent_proposal" && raw.params?.draft && typeof raw.expiresAt === "string"
    ? (raw as AgentProposalCard)
    : null;
}

/** The right hand's team card (ADR 0137 §10), or null. */
export function teamProposalOf(meta: Record<string, unknown> | null | undefined): TeamProposalCard | null {
  const raw = meta?.actionCard as Partial<TeamProposalCard> | undefined;
  return raw?.kind === "team_proposal" && Array.isArray(raw.params?.agents) && typeof raw.expiresAt === "string"
    ? (raw as TeamProposalCard)
    : null;
}

/**
 * Where a proposal stands: waiting for a person (also while someone creates it), expired, created, denied, or
 * superseded by a newer card for the same agent.
 */
export function proposalStatus(
  card: AgentProposalCard,
  now = Date.now(),
): "open" | "expired" | "created" | "denied" | "superseded" {
  if (card.state === "created" || card.state === "denied" || card.state === "superseded") return card.state;
  return Date.parse(card.expiresAt) <= now ? "expired" : "open";
}

/** "Pensa com Claude Max", "Pensa pela API", "Sem IA ainda…": the AI a proposal suggests. */
export const suggestedAiText = (t: TFunction, ai: SuggestedAi) =>
  ai.kind === "account"
    ? t("actionCard.agentProposal.aiAccount", { account: ai.label })
    : t(ai.kind === "model" ? "actionCard.agentProposal.aiModel" : "actionCard.agentProposal.aiNone");

/** A created proposal's routine nobody made yet (its agent wasn't where it reports): it can still be made. */
export const routineLeft = (card: AgentProposalCard) =>
  card.state === "created" && !!card.agentId && !!card.params.draft.routine && !card.routineId;

/** The draft's connector levels as "Criar agente" keeps them (by connection; the rest none). */
export const draftLevels = (draft: AgentDraft): Record<string, Level> =>
  Object.fromEntries(draft.access.map((a) => [a.connectionId, a.level]));

/**
 * The draft's mailbox levels the reviewer gives (their own mailboxes: only a mailbox's owner gives an agent access to
 * it), as "Criar agente" keeps them.
 */
export const draftMailLevels = (draft: AgentDraft, meId: string): Record<string, Level> =>
  Object.fromEntries((draft.mail ?? []).filter((m) => m.ownerUserId === meId).map((m) => [m.accountId, m.level]));

/** Who gives a line of a proposal: an admin (a channel, an app), or only one person (their mailbox). */
export type LineGiver = { who: "admin" } | { who: "person"; userId: string };

/**
 * A line of what a proposed agent gets, as its card lists it: a channel, an app or a mailbox at a level, its routine.
 * `given`: created in one click, whether it got it (null while open, or when it was created from the review). `needs`:
 * who gives it when the viewer can't (open), or when nobody did yet (created in one click).
 */
export interface ProposalLine {
  key: string;
  kind: "channel" | "app" | "mail" | "routine";
  /** The channel's, connection's or mailbox's id (the routine: its name). */
  id: string;
  level?: "read" | "write";
  given: boolean | null;
  needs: LineGiver | null;
}

/** The lines of a proposal's card for this viewer (who may manage agents: `admin`). */
export function proposalLines(card: AgentProposalCard, viewer: { userId: string; admin: boolean }): ProposalLine[] {
  const { draft } = card.params;
  const status = proposalStatus(card);
  const applied = status === "created" ? card.applied : undefined;
  const admin: LineGiver = { who: "admin" };
  const line = (
    kind: ProposalLine["kind"],
    id: string,
    given: string[] | undefined,
    giver: LineGiver,
    viewerGives: boolean,
    level?: "read" | "write",
  ): ProposalLine => {
    const got = applied && given ? given.includes(id) : null;
    const needs = status === "open" ? (viewerGives ? null : giver) : got === false ? giver : null;
    return { key: `${kind}:${id}`, kind, id, ...(level ? { level } : {}), given: got, needs };
  };
  return [
    ...draft.channelIds.map((id) => line("channel", id, applied?.channelIds, admin, viewer.admin)),
    ...draft.access.map((a) => line("app", a.connectionId, applied?.connectionIds, admin, viewer.admin, a.level)),
    ...(draft.mail ?? []).map((m) =>
      line(
        "mail",
        m.accountId,
        applied?.mailAccountIds,
        { who: "person", userId: m.ownerUserId },
        // Only its owner gives it, admin or not; an admin who isn't sees who must.
        m.ownerUserId === viewer.userId,
        m.level,
      ),
    ),
    ...(draft.routine ? [routineLine(card, draft.routine, status, viewer.admin)] : []),
  ];
}

/** Its routine waits for whoever puts the agent in the channel it reports in (an admin), when nobody did yet. */
function routineLine(
  card: AgentProposalCard,
  routine: ProposedRoutine,
  status: ReturnType<typeof proposalStatus>,
  admin: boolean,
): ProposalLine {
  const applied = status === "created" ? card.applied : undefined;
  const given = status === "created" && (applied || card.routineId) ? Boolean(card.routineId) : null;
  const where = routine.reportsIn;
  const waits = !!where && !(applied ? applied.channelIds.includes(where) : admin);
  const needs = (status === "open" || given === false) && waits ? ({ who: "admin" } as const) : null;
  return { key: "routine", kind: "routine", id: routine.name, given, needs };
}

export function actionCardOf(meta: Record<string, unknown> | null | undefined): ActionCard | null {
  const proposal =
    agentProposalOf(meta) ??
    teamProposalOf(meta) ??
    stretchCardOf(meta) ??
    usagePauseCardOf(meta) ??
    costlyProposalOf(meta) ??
    personLimitCardOf(meta) ??
    teamWeekCardOf(meta) ??
    calendarProposalCardOf(meta);
  if (proposal) return proposal;
  const raw = meta?.actionCard;
  if (!raw || typeof raw !== "object") return null;
  const workspace = workspaceActionCardOf(raw);
  if (workspace) return workspace;
  if ((raw as { kind?: unknown }).kind === "settings_proposal") {
    const r = raw as { forUserId?: unknown; proposalIds?: unknown; delegate?: CardDelegate | null };
    const proposalIds = Array.isArray(r.proposalIds)
      ? r.proposalIds.filter((id): id is string => typeof id === "string")
      : [];
    return proposalIds.length > 0
      ? {
          kind: "settings_proposal",
          forUserId: typeof r.forUserId === "string" ? r.forUserId : null,
          proposalIds,
          delegate: r.delegate ?? null,
        }
      : null;
  }
  const card = raw as { kind?: unknown; forUserId?: unknown; params?: unknown };
  if (!card.params || typeof card.params !== "object") return null;
  const p = card.params as Record<string, unknown>;
  const forUserId = typeof card.forUserId === "string" ? card.forUserId : null;
  const why = typeof p.why === "string" ? p.why : "";
  if (card.kind === "connect_app") {
    return {
      kind: "connect_app",
      forUserId,
      ...(typeof p.connector === "string" ? { connector: p.connector } : {}),
      ...(typeof p.url === "string" && isHttpsUrl(p.url) ? { url: p.url } : {}),
      why,
    };
  }
  if (card.kind === "install_skill") {
    return typeof p.url === "string" && isHttpsUrl(p.url)
      ? { kind: "install_skill", forUserId, url: p.url, why }
      : null;
  }
  if (card.kind === "update_skills") {
    const skillIds = Array.isArray(p.skillIds) ? p.skillIds.filter((id): id is string => typeof id === "string") : [];
    return skillIds.length > 0 ? { kind: "update_skills", forUserId, skillIds, why } : null;
  }
  if (card.kind === "approvals") {
    const approvalIds = strings(p.approvalIds);
    return approvalIds.length > 0 ? { kind: "approvals", forUserId, approvalIds, why } : null;
  }
  if (card.kind === "member_changes") {
    const rows = (Array.isArray(p.rows) ? p.rows : []).flatMap((r): MemberChangeRow[] => {
      const row = (r ?? {}) as Record<string, unknown>;
      if (typeof row.userId !== "string") return [];
      const who = { userId: row.userId, name: typeof row.name === "string" ? row.name : "" };
      if (row.remove === true) return [{ ...who, remove: true }];
      if (row.role === "owner" || row.role === "member") return [{ ...who, role: row.role }];
      const addRoleIds = strings(row.addRoleIds);
      const removeRoleIds = strings(row.removeRoleIds);
      return addRoleIds.length || removeRoleIds.length ? [{ ...who, addRoleIds, removeRoleIds }] : [];
    });
    return rows.length > 0 ? { kind: "member_changes", forUserId, rows, why } : null;
  }
  if (card.kind === "open_page") {
    if (!isAppPage(p.page)) return null;
    return {
      kind: "open_page",
      forUserId,
      page: p.page,
      ...(typeof p.agentId === "string" ? { agentId: p.agentId } : {}),
      ...(typeof p.channelId === "string" ? { channelId: p.channelId } : {}),
      why,
    };
  }
  if (card.kind === "invite_people") {
    const emails = Array.isArray(p.emails) ? p.emails.filter((e): e is string => typeof e === "string") : [];
    return emails.length > 0 ? { kind: "invite_people", forUserId, emails, why } : null;
  }
  if (card.kind !== "connect_ai") return null;
  return {
    kind: "connect_ai",
    forUserId: typeof card.forUserId === "string" ? card.forUserId : null,
    ...(typeof p.what === "string" && STEPS.has(p.what) ? { what: p.what as ConnectAiStep } : {}),
    ...(typeof p.provider === "string" ? { provider: p.provider } : {}),
    agentIds: Array.isArray(p.agentIds) ? p.agentIds.filter((id): id is string => typeof id === "string") : [],
    why: typeof p.why === "string" ? p.why : "",
  };
}

/**
 * Done once every agent the card names can think, and for a plan's card thinks with that plan. A card that
 * names no agent (an organization's key) stays a button: nothing live says which key it was for.
 */
export function connectAiDone(
  card: ConnectAiCard,
  status: AiStatus | undefined,
  agentById: ReadonlyMap<string, Pick<Agent, "brain">>,
) {
  if (!status || card.agentIds.length === 0) return false;
  const brain = card.what === "claude" || card.what === "chatgpt" ? PLAN_BRAIN[card.what] : null;
  return card.agentIds.every(
    (id) => aiStateOf(status, id) === "ready" && (!brain || agentById.get(id)?.brain?.kind === brain),
  );
}

/**
 * Done once the workspace has it working: a connection of its catalog entry, or a server at its address, whose sign-in
 * still works (one to reconnect opens the card again).
 */
export const connectAppDone = (
  card: ConnectAppCard,
  items: readonly (Pick<ConnectedItem, "def" | "server"> & Partial<Pick<ConnectedItem, "needsReconnect">>)[],
) => {
  const working = items.filter((i) => !i.needsReconnect);
  return card.connector
    ? working.some((i) => i.def?.id === card.connector)
    : Boolean(card.url) && working.some((i) => serverCovers(i.server?.serverUrl, card.url));
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Whether a people card's row is settled now, by the members list: the person's ownership or roles hold, or they are
 * gone (removed, or left: nothing is left to apply to them).
 */
export function memberRowDone(row: MemberChangeRow, members: readonly Pick<Member, "userId" | "role" | "roleIds">[]) {
  const m = members.find((x) => x.userId === row.userId);
  if (!m) return true;
  if ("remove" in row) return false;
  if ("role" in row) return m.role === row.role;
  const has = new Set(m.roleIds ?? []);
  return row.addRoleIds.every((id) => has.has(id)) && row.removeRoleIds.every((id) => !has.has(id));
}

/** The roles a row leaves the person with: theirs now, with its roles given and taken. */
export const rolesAfter = (row: { addRoleIds: string[]; removeRoleIds: string[] }, now: readonly string[] = []) => [
  ...new Set([...now.filter((id) => !row.removeRoleIds.includes(id)), ...row.addRoleIds]),
];

/** Done once every address is invited (an invitation open or accepted), by the invitations the viewer may list. */
export const inviteDone = (card: InviteCard, invited: readonly string[]) => {
  const have = new Set(invited.map((e) => e.toLowerCase()));
  return card.emails.every((e) => have.has(e.toLowerCase()));
};

/** Done once the library has a skill installed from the card's link. */
export const installSkillDone = (card: InstallSkillCard, skills: readonly Pick<Skill, "sourceUrl">[]) =>
  skills.some((s) => s.sourceUrl === card.url);

/**
 * Where a skill of an update card stands: `waiting` (its update changes files that run), `done` (its link was read
 * after the card was posted and nothing waits) or `open` (to update from its link). A skill that's gone counts as done.
 */
export function skillUpdateState(skill: Pick<Skill, "checkedAt" | "pendingUpdate"> | undefined, postedAt: string) {
  if (!skill) return "done" as const;
  if (skill.pendingUpdate && !skill.pendingUpdate.dismissed) return "waiting" as const;
  return skill.checkedAt && skill.checkedAt >= postedAt ? ("done" as const) : ("open" as const);
}

/**
 * The right hand's card of a workspace change (`workspace_action`), or null: an action of its catalog for whoever may,
 * with the words of its sentence (`rightHand.action.{action}`).
 */
export function workspaceActionCardOf(raw: unknown): WorkspaceActionCard | null {
  const c = (raw ?? {}) as Partial<WorkspaceActionCard>;
  if (c.kind !== "workspace_action" || !c.params || typeof c.params.action !== "string") return null;
  const words = Object.fromEntries(
    Object.entries(c.params.words ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
  return {
    kind: "workspace_action",
    forUserId: typeof c.forUserId === "string" ? c.forUserId : "",
    params: {
      action: c.params.action,
      input: c.params.input && typeof c.params.input === "object" ? c.params.input : {},
      words,
      needs: typeof c.params.needs === "string" ? c.params.needs : null,
      why: typeof c.params.why === "string" ? c.params.why : "",
      ...(c.params.refused === true ? { refused: true } : {}),
      ...(c.params.self === true ? { self: true } : {}),
    },
    state: c.state === "applied" || c.state === "dismissed" ? c.state : "pending",
    decidedByUserId: typeof c.decidedByUserId === "string" ? c.decidedByUserId : null,
    decidedAt: typeof c.decidedAt === "string" ? c.decidedAt : null,
    askedAt: typeof c.askedAt === "string" ? c.askedAt : null,
  };
}

/** The card's sentence: `rightHand.action.{action}`, or the plain one for an action this build doesn't know. */
export const actionCardKey = (card: WorkspaceActionCard) =>
  (WORKSPACE_ACTION_IDS as readonly string[]).includes(card.params.action)
    ? `rightHand.action.${workspaceActionContext(card.params.action, card.params.words)}`
    : "rightHand.action.other";

/** The values of the card's sentence, in the reader's language (`workspaceActionWords`). */
export const actionCardWords = (card: WorkspaceActionCard, t: TFunction) =>
  workspaceActionWords(card.params.action, card.params.words, t);

/**
 * Everything else the card changes, under its sentence, so whoever applies it from their inbox sees all of it: what a
 * role or a channel's exception gives or takes in the permissions' own words ("conversar, dar missões e editar a wiki";
 * "+ editar a wiki, − aprovar ações"), a new name, where a role moves, a channel turned private, a new budget. Empty when
 * the sentence says it all.
 */
export function actionCardDetail(card: WorkspaceActionCard, t: TFunction, locale = "en"): string {
  const input = card.params.input;
  const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
  const short = (k: string) => t(`permissions.${k}.short` as never, { defaultValue: k }) as string;
  const change = (add: unknown, take: unknown) =>
    [...keys(add).map((k) => `+ ${short(k)}`), ...keys(take).map((k) => `− ${short(k)}`)].join(", ");
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const parts = (...p: (string | false)[]) => p.filter(Boolean).join(" · ");
  const renamed = text(input.name) && `→ ${text(input.name)}`;
  switch (card.params.action) {
    case "create_role":
      return joinNames(keys(input.permissions).map(short), t);
    case "update_role":
      return parts(renamed, change(input.add_permissions, input.remove_permissions));
    case "move_role":
      return `${input.above === true ? "↑" : "↓"} ${card.params.words.other ?? ""}`.trim();
    case "set_channel_permissions":
      return change(input.allow, input.deny) || (t("channel.perms.clear") as string);
    case "update_channel":
      return parts(
        text(input.name) && `→ #${text(input.name).replace(/^#/, "")}`,
        text(input.topic),
        typeof input.private === "boolean" &&
          (t(input.private ? "channel.visibilityPrivate" : "channel.visibilityPublic") as string),
      );
    case "update_workspace":
      return parts(
        renamed,
        text(input.timezone),
        typeof input.default_budget_usd === "number" &&
          (t("agent.budgetDefaultChoice", {
            amount: t("agentPage.perMonth", { amount: formatUsd(locale, input.default_budget_usd) }),
          }) as string),
      );
    case "decide_join_request":
      return input.approve === true
        ? keys(input.roleNames)
            .map((n) => `+ ${n}`)
            .join(", ")
        : text(input.reason);
    default:
      return "";
  }
}

/**
 * Whether this viewer gets Aplicar on the card: the key its screen asks for, unless they are the person it was for and
 * the screen already refused them (a role above theirs), who sends it on instead. The server checks again either way.
 */
export const mayApplyCard = (
  card: WorkspaceActionCard,
  viewer: { userId: string; may: (key: Permission) => boolean },
) =>
  !(card.forUserId === viewer.userId && card.params.refused) &&
  // Their own status or notifications: only theirs to apply.
  !(card.params.self && card.forUserId !== viewer.userId) &&
  (card.params.needs === null || viewer.may(card.params.needs));
