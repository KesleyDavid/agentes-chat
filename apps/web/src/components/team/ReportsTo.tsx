import type { AgentLineChange, TeamAgent } from "@agenteschat/client";
import { useSetAgentLines, useTeam } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { can } from "@agenteschat/client/lib/permissions";
import { rightHandOf } from "@agenteschat/client/lib/right-hand";
import { mayReportTo, reportsOf, supervisorOf } from "@agenteschat/client/lib/team-views";
import { Field, Icon, MenuRadioGroup, Select } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";
import { useToast } from "@/lib/toast";
import "@/pages/team.css";

const NOBODY = "";

/**
 * Responde a (ADR 0148 addendum): sets who agents report to at once, for who manages agents, and says so with
 * Desfazer (the same call with what they were). `said`: the toast's words; absent, one agent's line by name.
 */
export function useSetReportsTo() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const toast = useToast();
  const set = useSetAgentLines(org.id);
  const nameOf = (id: string | null) => (id ? (dir.agentById.get(id)?.name ?? "") : "");
  return (changes: AgentLineChange[], said?: string) =>
    set.mutate(changes, {
      onError: (e) => toast.show(errorText(t, e), "error"),
      onSuccess: ({ previous }) => {
        if (previous.length === 0) return;
        const [one] = changes;
        const words =
          said ??
          (one?.reportsToAgentId
            ? t("team.reportsTo.done", { agent: nameOf(one.agentId), to: nameOf(one.reportsToAgentId) })
            : t("team.reportsTo.cleared", { agent: nameOf(one?.agentId ?? null) }));
        toast.show(words, "info", {
          label: t("agentGroups.undo"),
          run: () => set.mutate(previous, { onError: (e) => toast.show(errorText(t, e), "error") }),
        });
      },
    });
}

/** The agents `agent` may report to, as the chart sees it: not Lodi (`lodiId`), not itself, not into its own line. */
export const supervisorChoices = (agent: Pick<TeamAgent, "id">, team: readonly TeamAgent[], lodiId?: string) =>
  team.filter((a) => a.id !== lodiId && a.id !== agent.id && mayReportTo(team, agent.id, a.id));

/**
 * "Responde a": a picker of agents, empty by default, applied at once with Desfazer. Who doesn't manage agents reads
 * the name. The line under it says it grants nothing.
 */
export function ReportsToField({ agentId, id }: { agentId: string; id: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const team = useTeam(org.id).data?.agents ?? [];
  const lodiId = rightHandOf(useDirectory(org.id).agents)?.id;
  const setReportsTo = useSetReportsTo();
  const agent = team.find((a) => a.id === agentId);
  if (!agent || agent.id === lodiId) return null;
  const current = supervisorOf(agent, team);
  const manages = can(org, "manage_agents");
  if (!manages && !current) return null;
  return (
    <div className="agp-field">
      {manages ? (
        <Field
          label={t("team.reportsTo.label")}
          id={id}
          hint={{ name: t("common.about", { label: t("team.reportsTo.label") }), text: t("team.reportsTo.help") }}
        >
          <Select
            value={current?.id ?? NOBODY}
            onValueChange={(v) => setReportsTo([{ agentId, reportsToAgentId: v || null }])}
            // A list of agents shows their faces (the empty choice a glyph in a face's room), the trigger the chosen one's.
            options={[
              {
                value: NOBODY,
                label: t("team.reportsTo.none"),
                leading: <Icon name="person" size={18} className="muted" />,
              },
              ...supervisorChoices(agent, team, lodiId).map((a) => ({
                value: a.id,
                label: a.name,
                leading: <AgentAvatar agentId={a.id} name={a.name} size="sm" />,
              })),
            ]}
          />
        </Field>
      ) : (
        <>
          <span className="newag__label">{t("team.reportsTo.label")}</span>
          <span className="agp-ro">{current?.name}</span>
        </>
      )}
    </div>
  );
}

/** A supervisor's page: "Quem responde a Nina", its reports, each a link to its page. Nothing when none. */
export function ReportsList({ agentId, name }: { agentId: string; name: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const team = useTeam(org.id).data?.agents ?? [];
  const reports = reportsOf(agentId, team);
  if (reports.length === 0) return null;
  return (
    <div className="agp-field">
      <span className="newag__label">{t("team.reportsTo.reports", { name })}</span>
      <span className="team-reports">
        {reports.map((a) => (
          <Link
            key={a.id}
            to="/org/$orgId/agents/$agentId"
            params={{ orgId: org.id, agentId: a.id }}
            className="team-chip team-reports__one"
          >
            <AgentAvatar agentId={a.id} name={a.name} size="xs" />
            {a.name}
          </Link>
        ))}
      </span>
    </div>
  );
}

/** Equipe › Lista's row menu: "Responde a" as a choice of agents, applied at once with Desfazer (the keyboard's way). */
export function ReportsToMenu({
  agent,
  team,
  lodiId,
}: {
  agent: TeamAgent;
  team: readonly TeamAgent[];
  lodiId?: string;
}) {
  const { t } = useTranslation();
  const setReportsTo = useSetReportsTo();
  const current = agent.reportsToAgentId ?? NOBODY;
  return (
    <MenuRadioGroup
      label={t("team.reportsTo.label")}
      value={current}
      onValueChange={(v) => {
        if (v !== current) setReportsTo([{ agentId: agent.id, reportsToAgentId: v || null }]);
      }}
      options={[
        { value: NOBODY, label: t("team.reportsTo.none") },
        ...supervisorChoices(agent, team, lodiId).map((a) => ({ value: a.id, label: a.name })),
      ]}
    />
  );
}
