import {
  type AgentAudience,
  useAgentDetail,
  useAgentGroups,
  useModels,
  useSettings,
  useUsage,
} from "@agenteschat/client";
import { groupOf, NO_GROUP } from "@agenteschat/client/lib/agent-groups";
import { audienceSummary } from "@agenteschat/client/lib/audience";
import { engineOfBrain } from "@agenteschat/client/lib/brain";
import { modelUnpriced } from "@agenteschat/client/lib/endpoints";
import { formatMonth, formatPercent, formatTokensShort, formatUsd } from "@agenteschat/client/lib/format";
import { addsAgentsTo } from "@agenteschat/client/lib/permissions";
import {
  type AgentAppearance,
  agentGradient,
  Button,
  Card,
  CheckboxPill,
  Chip,
  colorKey,
  Field,
  Icon,
  type IconName,
  Meter,
  randomAppearance,
  Select,
  SettingNote,
} from "@agenteschat/ui";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AudienceChoice } from "@/components/AgentAudience";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentComputerPanel } from "@/components/AgentComputer";
import {
  BudgetField,
  InPlaceText,
  LookRows,
  NO_OWNER,
  OwnerSelect,
  OwnerValue,
  RoleTag,
  usd,
} from "@/components/AgentFields";
import { AgentSecretsList } from "@/components/AgentSecrets";
import { LoadingLine } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { ReportsList, ReportsToField } from "@/components/team/ReportsTo";
import { useComputerEdition } from "@/components/WorkspaceComputer";
import { useDirectory } from "@/hooks/useDirectory";
import {
  ADVANCED_SECTIONS,
  AGENT_SECTIONS,
  type AgentSection,
  type Field as EditField,
  FIELD_PLACE,
} from "@/lib/agent-edit";
import { BLANK_LOOK, cleanHandle } from "@/lib/new-agent";
import { BrakesCard } from "./BrakesCard";
import { CardHead, useAgentEdit, WasLine } from "./context";
import { ReadOnlyNote, useVisibleChannels } from "./pieces";

const SECTION_ICON: Record<AgentSection, IconName> = {
  identity: "person",
  brain: "bulb",
  budget: "wallet",
  owner: "members",
  audience: "message",
  channels: "channel",
  computer: "computer",
  danger: "archive",
};

/** A section of Configurações: a card with its head and, when changed, the outline. */
function Section({
  id,
  title,
  fields,
  action,
  hint,
  children,
  danger,
}: {
  id: AgentSection;
  title: string;
  fields: EditField[];
  action?: ReactNode;
  hint?: { name: string; text: ReactNode };
  children: ReactNode;
  danger?: boolean;
}) {
  const { changes, can } = useAgentEdit();
  const keys = changes.filter((c) => fields.includes(c.field)).map((c) => c.key);
  const editable = fields.some((f) => can(f));
  return (
    <Card
      as="section"
      id={`agp-sec-${id}`}
      className={danger ? "agp-card agp-sec agp-danger" : "agp-card agp-sec"}
      data-changed={keys.length > 0 || undefined}
      aria-labelledby={`agp-h-${id}`}
    >
      <CardHead
        id={`agp-h-${id}`}
        icon={SECTION_ICON[id]}
        title={title}
        changeKeys={keys}
        lock={editable || danger ? undefined : fields[0]}
        action={editable ? action : undefined}
        hint={hint}
      />
      {children}
    </Card>
  );
}

/** A read-only value where an input would be (members, or what the owner can't change). */
const ReadValue = ({ children }: { children: ReactNode }) => <span className="agp-ro">{children}</span>;

/**
 * The agent's identity as a card: its name big, then "@handle · role". Each piece edits where it is (into the draft,
 * which the page's save bar saves) and reads as a plain value for who can't change it.
 */
function IdentityCard() {
  const { t } = useTranslation();
  const { agent, draft, set, can, errors, changeOf } = useAgentEdit();
  const changed = (["name", "handle", "role"] as const).some((k) => changeOf(k)?.was);
  return (
    <>
      <div className="agp-id__name">
        {can("name") ? (
          <InPlaceText
            id="agp-name"
            value={draft.name}
            label={t("agent.nameLabel")}
            editLabel={t("agent.editName", { name: draft.name })}
            maxLength={80}
            invalid={!!errors.name}
            describedBy={errors.name ? "agp-name-error" : undefined}
            onCommit={(v) => set("name", v)}
          />
        ) : (
          draft.name
        )}
      </div>
      <div className="agp-id__line">
        <span className="agp-id__handle">
          {can("handle") ? (
            <InPlaceText
              id="agp-handle"
              value={draft.handle}
              shown={`@${draft.handle}`}
              prefix="@"
              label={t("agent.handleLabel")}
              editLabel={t("agent.editHandle", { handle: draft.handle })}
              maxLength={32}
              clean={cleanHandle}
              spellCheck={false}
              invalid={!!errors.handle}
              describedBy={errors.handle ? "agp-handle-error" : undefined}
              onCommit={(v) => set("handle", v)}
            />
          ) : (
            `@${draft.handle}`
          )}
        </span>
        <span className="agp-id__dot" aria-hidden="true">
          ·
        </span>
        <RoleTag id="agp-role" value={draft.role} onChange={can("role") ? (v) => set("role", v) : undefined} />
      </div>
      {errors.name && (
        <span className="newag__err" id="agp-name-error" role="alert">
          <Icon name="info" size={14} />
          {errors.name}
        </span>
      )}
      {errors.handle && (
        <span className="newag__err" id="agp-handle-error" role="alert">
          <Icon name="info" size={14} />
          {errors.handle}
        </span>
      )}
      {changed && (
        <div className="agp-id__was">
          <WasLine changeKey="name" />
          <WasLine changeKey="handle" />
          <WasLine changeKey="role" />
        </div>
      )}
      {draft.handle !== agent.handle && !errors.handle && (
        <span className="small muted">{t("agent.handleMoves", { handle: draft.handle, old: agent.handle })}</span>
      )}
    </>
  );
}

/** Who it reports to (ADR 0148 addendum) and who reports to it: applied at once with Desfazer, never in the save bar. */
function ReportsTo() {
  const { agent } = useAgentEdit();
  return (
    <>
      <ReportsToField agentId={agent.id} id="agp-reports-to" />
      <ReportsList agentId={agent.id} name={agent.name} />
    </>
  );
}

/**
 * Configurações: identity and look, who thinks (and the API's model and key), budget, owner, audience, channels, computer.
 * In a personal workspace (ADR 0159 §3) it comes in two parts: `basic` (its name, look and budget, the Settings tab) and
 * `advanced` (the rest, with who it reports to and its brakes, in the Advanced tab).
 */
export function SettingsTab({
  section,
  onSection,
  onArchive,
  onDelete,
  part = "all",
}: {
  section: AgentSection | undefined;
  onSection: (sec: AgentSection) => void;
  onArchive: () => void;
  onDelete: () => void;
  part?: "all" | "basic" | "advanced";
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const edition = useComputerEdition(org.id);
  const { agent, g, viewer, draft, set, can, changes, ownerFirst, openWork } = useAgentEdit();
  const admin = viewer === "admin";
  const groups = useAgentGroups(org.id).data ?? [];
  const inGroup = groupOf(groups, agent.id);
  // "Quem pensa" lives in the sentence under the name now (its dialog saves at once).
  const sections = AGENT_SECTIONS.filter(
    (s) =>
      s !== "brain" &&
      (s !== "danger" || admin) &&
      (part === "all" || ADVANCED_SECTIONS.includes(s) === (part === "advanced")),
  );
  const has = (s: AgentSection) => sections.includes(s);
  const visibleChannels = useVisibleChannels().list;
  // Where I may put it or take it out (the channels' ⓘ says so when some aren't).
  const placeable = visibleChannels.filter((c) => addsAgentsTo(c, me.user.id, org));
  const look = draft.look;
  return (
    <>
      <ReadOnlyNote />
      <div className="agp-cfg" data-part={part === "basic" ? "basic" : undefined}>
        {part !== "basic" && (
          <nav className="agp-subnav" aria-label={t("agentPage.settings.sections")}>
            {sections.map((s) => {
              const n = changes.filter((c) => FIELD_PLACE[c.field].sec === s).length;
              return (
                <button
                  key={s}
                  type="button"
                  className="agp-subnav__item"
                  data-danger={s === "danger" || undefined}
                  aria-current={section === s ? "true" : undefined}
                  onClick={() => onSection(s)}
                >
                  <Icon name={SECTION_ICON[s]} size={14} />
                  {s === "computer" ? t("agentPage.settings.computer") : t(`agentPage.settings.${s}`)}
                  {n > 0 && (
                    <span className="agp-tag agp-tag--dot">
                      <Icon name="edit" size={14} />
                      <span className="ac-visually-hidden">{t("agentPage.changesCount", { count: n })}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
        <div className="agp-col agp-col--cfg">
          {has("identity") && (
            <Section
              id="identity"
              title={t("agentPage.settings.identity")}
              fields={["name", "handle", "role", "look", "group"]}
              hint={{
                name: t("common.about", { label: t("agentPage.settings.identity") }),
                text: t("agent.identityHelp"),
              }}
              action={
                can("look") ? (
                  <Button
                    size="sm"
                    icon="shuffle"
                    onClick={() =>
                      set("look", { ...BLANK_LOOK, ...randomAppearance(look) } as Required<AgentAppearance>)
                    }
                  >
                    {t("newAgent.shuffle")}
                  </Button>
                ) : undefined
              }
            >
              <div className="agp-id">
                <span
                  className="agp-id__look"
                  style={{ "--a": agentGradient(look.color)[0], "--b": agentGradient(look.color)[1] } as CSSProperties}
                >
                  <AgentAvatar size="lg" framed={false} name={draft.name || agent.name} appearance={look} />
                </span>
                <div className="agp-id__fields">
                  <IdentityCard />
                  {/* Only once the workspace has groups (ADR 0083); they are made in the sidebar. */}
                  {groups.length > 0 && can("group") ? (
                    <div className="agp-field">
                      <Field label={t("agentPage.fields.group")} id="agp-group">
                        <Select
                          value={draft.group}
                          onValueChange={(v) => set("group", v)}
                          options={[
                            { value: NO_GROUP, label: t("agentGroups.none") },
                            ...groups.map((g) => ({ value: g.id, label: g.name })),
                          ]}
                        />
                      </Field>
                      <WasLine changeKey="group" />
                    </div>
                  ) : (
                    inGroup && (
                      <div className="agp-field">
                        <span className="newag__label">{t("agentPage.fields.group")}</span>
                        <ReadValue>{inGroup.name}</ReadValue>
                      </div>
                    )
                  )}
                  {/* Responde a (ADR 0148 addendum): applied at once with Desfazer, never part of the save bar. In a
                    personal workspace it is in Advanced, with its owner. */}
                  {part === "all" && <ReportsTo />}
                </div>
              </div>
              {can("look") ? (
                <>
                  <LookRows look={look} onChange={(next) => set("look", next)} />
                  <WasLine changeKey="look" />
                </>
              ) : (
                <span className="agp-chips">
                  <Chip icon="agent">
                    {[
                      t(`look.colors.${colorKey(look.color)}`),
                      t(`look.eyesNames.${look.eyes}`),
                      ...(look.accessory !== "none" ? [t(`look.accessories.${look.accessory}`)] : []),
                    ].join(" · ")}
                  </Chip>
                </span>
              )}
            </Section>
          )}

          {has("budget") && (
            <Section id="budget" title={t("agentPage.settings.budget")} fields={["budget"]}>
              <BudgetEditor />
            </Section>
          )}

          {has("owner") && (
            <Section id="owner" title={t("newAgent.owner")} fields={["owner"]}>
              <OwnerEditor />
              {part === "advanced" && <ReportsTo />}
            </Section>
          )}

          {has("audience") && (
            <Section id="audience" title={t("audience.title", g)} fields={["audience"]}>
              <AudienceEditor />
            </Section>
          )}

          {part !== "basic" && <BrakesCard />}

          {has("channels") && (
            <Section
              id="channels"
              title={t("newAgent.channels")}
              fields={["channels"]}
              hint={
                can("channels") && placeable.length < visibleChannels.length
                  ? {
                      name: t("common.about", { label: t("newAgent.channels") }),
                      text: t("agentPage.settings.channelsYours"),
                    }
                  : undefined
              }
            >
              <ChannelsEditor />
            </Section>
          )}

          {has("computer") && (
            <Section id="computer" title={t("computer.title", g)} fields={["machine"]}>
              {viewer === "member" ? (
                <p className="small muted">
                  {t("agentPage.computer.hidden", { owner: ownerFirst ?? t("roles.adminLower") })}
                </p>
              ) : (
                <AgentComputerPanel
                  agent={agent}
                  machineNote={
                    // The Cloud's agents all work on the workspace's own computer: nothing to pick.
                    can("machine") && edition === "selfhost" ? (
                      <Button
                        size="sm"
                        icon="computer"
                        onClick={() => openWork("computer")}
                        style={{ alignSelf: "flex-start" }}
                      >
                        {t("agentPage.work.open.computer", g)}
                      </Button>
                    ) : undefined
                  }
                />
              )}
              <AgentSecretsList agent={agent} editable={admin} />
            </Section>
          )}

          {has("danger") && (
            <Section id="danger" title={t("agentPage.settings.danger")} fields={[]} danger>
              <div className="agp-dz">
                <span className="agp-dz__t">
                  <b>{t("agentPage.archive.action", g)}</b>
                  <span>{t("agentPage.archive.help")}</span>
                </span>
                <Button variant="danger" icon="archive" onClick={onArchive}>
                  {t("agentPage.archive.button")}
                </Button>
              </div>
              <div className="agp-dz">
                <span className="agp-dz__t">
                  <b>{t("agentPage.delete.action", g)}</b>
                  <span>{t("agentPage.delete.help")}</span>
                </span>
                <Button variant="danger" icon="trash" onClick={onDelete}>
                  {t("agentPage.delete.button")}
                </Button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

/*
 * The editors of the Settings tab's sections, also the dialogs of the overview's fact sheet (Ficha.tsx): each edits the draft, which the page's
 * save bar (or the dialog's Save) saves.
 */

/** Budget: what it spent this month and its limit. */
export function BudgetEditor() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { org } = useOrg();
  const { agent, g, viewer, draft, saved, set, can, errors, ownerFirst } = useAgentEdit();
  const admin = viewer === "admin";
  const settings = useSettings(org.id);
  const detail = useAgentDetail(org.id, agent.id);
  const usage = useUsage(org.id);
  const models = useModels();
  const used = detail.data?.budgetUsedPercent ?? 0;
  const spent = usage.data?.find((u) => u.agentId === agent.id)?.costUsd;
  const defaultBudget = settings.data?.defaultAgentBudgetUsd;
  const limit = detail.data?.monthlyBudgetUsd ?? detail.data?.defaultBudgetUsd;
  const month = formatMonth(locale, new Date());
  return (
    <>
      <div className="agp-spent">
        <div className="agp-spent__top">
          {admin && spent !== undefined && limit !== undefined ? (
            <>
              <b>{formatUsd(locale, spent)}</b>
              <span className="small muted">
                {saved.budget === null
                  ? t("agentPage.settings.spentOfDefault", { month, amount: usd(t, locale, limit) })
                  : t("agentPage.settings.spentOf", { month, amount: usd(t, locale, limit) })}
              </span>
            </>
          ) : (
            <>
              <b>{formatPercent(locale, used)}</b>
              <span className="small muted">
                {detail.data?.monthlyBudgetUsd === null
                  ? t("agentPage.settings.usedDefault", { month })
                  : t("agentPage.settings.used", { month })}
              </span>
            </>
          )}
        </div>
        <Meter value={Math.min(100, used)} max={100} label={t("agent.budgetUsed")} marks={[80]} />
        {modelUnpriced(models.data?.models, agent.model) && (
          <SettingNote icon="info">{t("endpoint.budgetUnpriced")}</SettingNote>
        )}
        <ul className="agp-spent__stats">
          <li>
            <Icon name="bolt" size={14} />
            {t("agent.runsCount", { count: detail.data?.runsThisMonth ?? 0 })}
          </li>
          <li>
            <Icon name="coin" size={14} />
            {t("agent.tokensCount", { tokens: formatTokensShort(t, locale, detail.data?.tokensThisMonth ?? 0) })}
          </li>
          <li>
            <Icon name="bell" size={14} />
            {t("agentPage.settings.budgetAlert", { who: ownerFirst ?? t("agentPage.settings.theAdmins") })}
          </li>
        </ul>
      </div>
      {can("budget") && draft.budget !== undefined && saved.budget !== undefined ? (
        <div className="agp-field">
          <span className="newag__label">{t("agentPage.settings.limit")}</span>
          <BudgetField
            id="agp-budget"
            value={draft.budget}
            onChange={(v) => set("budget", v)}
            defaultBudget={defaultBudget}
            error={errors.budget}
          />
          <WasLine changeKey="budget" />
          {!errors.budget && (
            <span className="small muted">{t("agent.budgetHelp", { ...g, ownerNote: "" }).trim()}</span>
          )}
        </div>
      ) : (
        !admin && (
          <span className="agp-lock">
            <Icon name="lock" size={14} />
            {t("agentPage.settings.budgetAdmins")}
          </span>
        )
      )}
    </>
  );
}

/** Owner: who answers for it. */
export function OwnerEditor() {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const { draft, set, can } = useAgentEdit();
  const owner = draft.owner === NO_OWNER ? undefined : dir.memberById.get(draft.owner);
  const ownerId = draft.owner === NO_OWNER ? null : draft.owner;
  return (
    <>
      {can("owner") ? (
        <>
          <OwnerSelect
            value={draft.owner}
            members={dir.members}
            meId={me.user.id}
            onChange={(v) => {
              set("owner", v);
              if (v !== NO_OWNER && draft.audience.userIds.includes(v))
                set("audience", { ...draft.audience, userIds: draft.audience.userIds.filter((id) => id !== v) });
            }}
          />
          <WasLine changeKey="owner" />
        </>
      ) : (
        <OwnerValue member={owner} meId={me.user.id} />
      )}
      <span className="small muted">{ownerId ? t("newAgent.ownerHelp") : t("newAgent.noOwnerHelp")}</span>
    </>
  );
}

/** Who can talk to it. */
/** `layout`: the choices as cards (the Settings tab) or as rows (a dialog, where three cards leave one alone). */
export function AudienceEditor({ layout = "cards" }: { layout?: "cards" | "rows" } = {}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const { agent, draft, set, can, errors } = useAgentEdit();
  const ownerId = draft.owner === NO_OWNER ? null : draft.owner;
  // On a plan (ADR 0059 §5) only its owner lets more people in. Here every role is offered, in a personal workspace
  // too (ADR 0159): its own page keeps the whole choice.
  const onPlan = engineOfBrain(agent.brain?.kind) !== "agent";
  const chooseAudience = (next: AgentAudience) => set("audience", next);
  return (
    <>
      {can("audience") ? (
        <>
          <AudienceChoice
            compact
            layout={layout}
            value={draft.audience}
            onChange={chooseAudience}
            ownerUserId={ownerId}
            agentName={agent.name}
            idPrefix="agp-audience"
            onPlan={onPlan}
            everyRole
          />
          {errors.audience && (
            <span className="newag__err" role="alert">
              <Icon name="info" size={14} />
              {errors.audience}
            </span>
          )}
          <WasLine changeKey="audience" />
        </>
      ) : (
        <>
          <span className="agp-chips">
            <Chip icon="message">
              {audienceSummary(t, agent, (id) => dir.memberById.get(id)?.name, dir.roleName, org)}
            </Chip>
          </span>
          <span className="small muted">{t("audience.notListed")}</span>
        </>
      )}
    </>
  );
}

/** Channels: where it reads and answers. */
export function ChannelsEditor() {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const { agent, draft, set, can } = useAgentEdit();
  const visibleChannels = useVisibleChannels().list;
  // Where I may put it or take it out; the rest of its channels show as they are.
  const placeable = visibleChannels.filter((c) => addsAgentsTo(c, me.user.id, org));
  const fixed = visibleChannels.filter((c) => draft.channels?.includes(c.id) && !placeable.includes(c));
  const channelChips = (list: typeof visibleChannels) => (
    <span className="agp-chips">
      {list.map((c) => (
        <Chip key={c.id} icon="channel">
          {c.name}
        </Chip>
      ))}
    </span>
  );
  return (
    <>
      {draft.channels === undefined ? (
        <LoadingLine width={220} />
      ) : can("channels") ? (
        <>
          {placeable.length ? (
            <div className="newag__pills">
              {placeable.map((c) => (
                <CheckboxPill
                  key={c.id}
                  id={`agp-ch-${c.id}`}
                  checked={draft.channels?.includes(c.id) ?? false}
                  onCheckedChange={(on) => {
                    const next = new Set(draft.channels ?? []);
                    if (on) next.add(c.id);
                    else next.delete(c.id);
                    set("channels", [...next].sort());
                  }}
                >
                  {`#${c.name}`}
                </CheckboxPill>
              ))}
            </div>
          ) : (
            <span className="small muted">{t("newAgent.noChannels")}</span>
          )}
          {fixed.length > 0 && channelChips(fixed)}
        </>
      ) : draft.channels.length ? (
        channelChips(visibleChannels.filter((c) => draft.channels?.includes(c.id)))
      ) : (
        <span className="small muted">{t("agentPage.overview.noChannels", { handle: agent.handle })}</span>
      )}
      <WasLine changeKey="channels" />
      <span className="small muted">{t("agentPage.settings.channelsHelp", { handle: agent.handle })}</span>
    </>
  );
}
