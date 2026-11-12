import type { ThreadActor, ThreadInfo } from "@agenteschat/client";
import { useChannels, useMissionList, useThreadList } from "@agenteschat/client";
import { relativeTime } from "@agenteschat/client/lib/format";
import { previewBody } from "@agenteschat/client/lib/message-body";
import { can } from "@agenteschat/client/lib/permissions";
import { threadStatus, threadTitle } from "@agenteschat/client/lib/threads";
import {
  AvatarStack,
  Button,
  Checkbox,
  cx,
  EmptyState,
  FilterBar,
  FilterChip,
  FilterToggle,
  GroupHeading,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  SearchField,
  Segmented,
  Toolbar,
} from "@agenteschat/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActorAvatar } from "@/components/AgentAvatar";
import { useActors } from "@/components/actors";
import { useActorFilterOptions, useFilterCopy } from "@/components/filters";
import { ErrorState, LoadingList } from "@/components/Loading";
import { MissionStatusChip, missionSummaryStatusKey } from "@/components/missions/MissionBits";
import { NewMissionDialog } from "@/components/missions/MissionDialogs";
import { MissionsTab } from "@/components/missions/MissionList";
import { useOrg } from "@/components/org-context";
import { SelectionBar } from "@/components/SelectionBar";
import { SidePanel } from "@/components/SidePanel";
import { ThreadStatusChip, useThreadControls } from "@/components/threads/ThreadBits";
import { useRightHandLook } from "@/hooks/useRightHandLook";
import { useOpenParam } from "@/lib/open-param";
import { useToast } from "@/lib/toast";
import { ThreadPage } from "./ThreadPage";
import { THREAD_TABS, type ThreadsTab } from "./thread-tabs";
import "./threads.css";

/**
 * Threads: the subjects that left the channels and DMs. Tabs, search
 * and filters, rows grouped by channel (DMs together) with the tag, people
 * and time in fixed columns, hover actions, ⋯, multi-select with the
 * floating bar, and the thread itself in the panel beside the list. No unread counts (reads are per
 * channel) and no counts on the tabs (the API doesn't give them).
 */

const actorsOf = (t: ThreadInfo): { type: ThreadActor["type"]; id: string }[] =>
  t.participants.flatMap((p) => (p.id ? [{ type: p.type, id: p.id }] : []));

export function ThreadsPage({ initialTab, initialChannel }: { initialTab?: ThreadsTab; initialChannel?: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const channels = useChannels(org.id);
  const copy = useFilterCopy();
  const agentOptions = useActorFilterOptions().filter((o) => o.value.startsWith("agent:"));
  const [tab, setTab] = useState<ThreadsTab>(initialTab ?? "all");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [channel, setChannel] = useState<string[]>(initialChannel ? [initialChannel] : []);
  const [agent, setAgent] = useState<string[]>([]);
  const [needsYou, setNeedsYou] = useState(false);
  const [mine, setMine] = useState(false);
  // The thread open in the panel beside the list, in the URL (`?open=…`).
  const [openId, setOpenId] = useOpenParam();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [newMission, setNewMission] = useState(false);
  // Channel groups folded by the person (this visit only).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const missions = tab === "missions";
  // The server's rule. With none yet, the empty state holds the button (the same two lists it reads, unfiltered).
  const opensMissions = can(org, "post") && can(org, "assign_work");
  const openMissions = useMissionList(org.id, { status: "open" }, missions);
  const closedMissions = useMissionList(org.id, { status: "closed" }, missions);
  const noMissions = missions && openMissions.data?.missions.length === 0 && closedMissions.data?.missions.length === 0;
  const filters = {
    tab,
    ...(channel[0] ? { channelId: channel[0] } : {}),
    ...(agent[0] ? { agentId: agent[0].slice("agent:".length) } : {}),
    ...(needsYou ? { needsYou: true } : {}),
    ...(mine ? { mine: true } : {}),
    ...(query ? { q: query } : {}),
  };
  const list = useThreadList(org.id, filters, !missions);
  // "Missões" + a count chip: the open missions I see (the server counts them).
  const missionCounts = useMissionList(org.id, { status: "open", limit: 1 }).data?.counts;
  const threads = useMemo(() => list.data?.pages.flatMap((p) => p.threads) ?? [], [list.data]);
  const controls = useThreadControls();
  const toast = useToast();
  const selected = threads.filter((x) => picked.has(x.id));
  const filtered = Boolean(channel.length || agent.length || needsYou || mine || query);
  const clearFilters = () => {
    setChannel([]);
    setAgent([]);
    setNeedsYou(false);
    setMine(false);
    setQ("");
  };
  // A new tab or filter starts a new selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets when the list's filters change
  useEffect(() => setPicked(new Set()), [tab, channel, agent, needsYou, mine, query]);
  // Esc clears the selection (the details dialog closes itself first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target instanceof Element && e.target.closest("[role=dialog], [role=menu]"))) return;
      if (!openId) setPicked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);
  const go = (thread: ThreadInfo) =>
    void navigate({ to: "/org/$orgId/threads/$threadId", params: { orgId: org.id, threadId: thread.id } });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const channelOptions = (channels.data ?? [])
    .filter((c) => c.isMember)
    .map((c) => ({ value: c.id, label: `#${c.name}` }));
  const bulk = (action: "close" | "archive" | "unarchive") => {
    const targets = selected.filter((x) => x.canManage);
    setPicked(new Set());
    if (targets.length > 0) controls.request(targets, action);
  };

  return (
    <div className="page page--list threads">
      <div className="threads__main">
        <PageHeader
          title={missions ? t("missions.title") : t("threads.title")}
          meta={missions ? t("missions.subtitle") : t("threads.subtitle")}
          actions={
            opensMissions &&
            !noMissions && (
              <Button
                variant={missions ? "primary" : "default"}
                icon={missions ? "plus" : "flag"}
                onClick={() => setNewMission(true)}
              >
                {t("missions.new.open")}
              </Button>
            )
          }
        />
        <div className="threads-tabs">
          <Segmented
            label={t("threads.tabsLabel")}
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setOpenId(null);
            }}
            options={THREAD_TABS.map((v) => ({
              value: v,
              label: t(`threads.tabs.${v}`),
              ...(v === "missions" && missionCounts?.active ? { count: missionCounts.active } : {}),
            }))}
          />
        </div>
        <Toolbar
          search={
            <SearchField
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              clearLabel={copy.clearSearch}
              placeholder={
                tab === "archived" ? t("threads.searchArchived") : missions ? t("missions.search") : t("threads.search")
              }
              aria-label={t("threads.search")}
            />
          }
        >
          <FilterBar
            label={t("threads.filters")}
            clearText={copy.clearAll}
            onClear={clearFilters}
            filters={[
              {
                key: "channel",
                active: channel.length > 0,
                node: (
                  <FilterChip
                    label={t("threads.filterChannel")}
                    icon="channel"
                    options={channelOptions}
                    value={channel}
                    onChange={(v) => setChannel(v.slice(-1))}
                    valueText={(o) => o.label}
                    clearLabel={copy.clearOf(t("threads.filterChannel"))}
                    searchLabel={copy.searchLabel}
                    searchPlaceholder={copy.searchPlaceholder}
                    noResults={copy.noResults}
                  />
                ),
              },
              {
                key: "agent",
                active: agent.length > 0,
                node: (
                  <FilterChip
                    label={t("threads.filterAgent")}
                    icon="agent"
                    options={agentOptions}
                    value={agent}
                    onChange={(v) => setAgent(v.slice(-1))}
                    valueText={(o) => o.label}
                    clearLabel={copy.clearOf(t("threads.filterAgent"))}
                    searchLabel={copy.searchLabel}
                    searchPlaceholder={copy.searchPlaceholder}
                    noResults={copy.noResults}
                  />
                ),
              },
              ...(missions
                ? []
                : [
                    {
                      key: "needsYou",
                      active: needsYou,
                      node: (
                        <FilterToggle icon="waiting" pressed={needsYou} onPressedChange={setNeedsYou}>
                          {t("threads.needsYou")}
                        </FilterToggle>
                      ),
                    },
                    {
                      key: "mine",
                      active: mine,
                      node: (
                        <FilterToggle icon="person" pressed={mine} onPressedChange={setMine}>
                          {t("threads.mine")}
                        </FilterToggle>
                      ),
                    },
                  ]),
            ]}
          />
        </Toolbar>
        {tab === "archived" && (
          <p className="threads-note ac-iconline">
            <Icon name="lock" size={14} />
            <span>
              <b>{t("threads.notes.archivedTitle")}</b> {t("threads.notes.archived")}
            </span>
          </p>
        )}
        {tab === "closed" && (
          <p className="threads-note ac-iconline">
            <Icon name="refresh" size={14} />
            <span>{t("threads.notes.closed")}</span>
          </p>
        )}
        {missions && (
          <MissionsTab
            filters={{
              q: query,
              ...(agent[0] ? { agentId: agent[0].slice("agent:".length) } : {}),
              ...(channel[0] ? { channelId: channel[0] } : {}),
            }}
            onNew={() => setNewMission(true)}
            onClear={clearFilters}
          />
        )}
        {!missions && list.isPending && <LoadingList count={5} />}
        {!missions && list.isError && !list.data && (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        )}
        {!missions && list.isSuccess && threads.length === 0 && (
          <ThreadsEmpty tab={tab} filtered={filtered} onClear={clearFilters} onAll={() => setTab("all")} />
        )}
        {!missions && threads.length > 0 && (
          <div className="ac-groups threads-groups" data-selecting={picked.size > 0 || undefined}>
            {byPlace(threads).map((group) => {
              const shut = collapsed.has(group.key);
              const label = group.dm ? t("threads.dms") : `#${group.name}`;
              return (
                <section key={group.key} className="threads-group" aria-label={label}>
                  <GroupHeading
                    className="threads-group__head"
                    title={
                      <button type="button" aria-expanded={!shut} onClick={() => toggleGroup(group.key)}>
                        <Icon name="chevronDown" size={14} className="threads-group__chev" />
                        <Icon name={group.dm ? "person" : "channel"} size={14} />
                        {group.dm ? label : group.name}
                      </button>
                    }
                    count={group.threads.length}
                  />
                  {!shut && (
                    <div className="list-card">
                      {group.threads.map((thread) => (
                        <ThreadRow
                          key={thread.id}
                          thread={thread}
                          open={thread.id === openId}
                          picked={picked.has(thread.id)}
                          onOpen={() => setOpenId(openId === thread.id ? null : thread.id)}
                          onGo={() => go(thread)}
                          onPick={() => toggle(thread.id)}
                          onAction={(action) => controls.request([thread], action)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {!missions && list.hasNextPage && (
          <Button className="threads-more" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {t("threads.loadMore")}
          </Button>
        )}
        {selected.length > 0 && (
          <SelectionBar label={t("threads.selection")}>
            <span className="drive-selbar__count">{t("threads.selected", { count: selected.length })}</span>
            {tab === "archived" ? (
              <Button size="sm" variant="ghost" icon="unarchive" onClick={() => bulk("unarchive")}>
                <span className="drive-selbar__label">{t("threads.actions.unarchive")}</span>
              </Button>
            ) : (
              <>
                {tab !== "closed" && (
                  <Button size="sm" variant="ghost" icon="check" onClick={() => bulk("close")}>
                    <span className="drive-selbar__label">{t("threads.actions.close")}</span>
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon="archiveBox" onClick={() => bulk("archive")}>
                  <span className="drive-selbar__label">{t("threads.actions.archive")}</span>
                </Button>
              </>
            )}
            <span className="drive-selbar__sep" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="close"
              aria-label={t("threads.clearSelection")}
              title={t("threads.clearSelection")}
              onClick={() => setPicked(new Set())}
            />
          </SelectionBar>
        )}
      </div>
      {openId && (
        // The thread itself, as a channel opens one beside its conversation: no details to go through first.
        <SidePanel label={t("threads.side.label")} onClose={() => setOpenId(null)}>
          <ThreadPage
            key={openId}
            threadId={openId}
            onClose={() => setOpenId(null)}
            onGone={() => {
              setOpenId(null);
              toast.show(t("threads.view.notFoundTitle"));
            }}
          />
        </SidePanel>
      )}
      {controls.dialog}
      {newMission && (
        <NewMissionDialog
          open={newMission}
          onOpenChange={setNewMission}
          initialChannelId={channel[0]}
          initialAgentId={agent[0]?.slice("agent:".length)}
        />
      )}
    </div>
  );
}

type RowAction = "close" | "reopen" | "archive" | "unarchive";

/** Quick actions on hover (and in ⋯): what makes sense for the thread's state. */
function quickActions(thread: ThreadInfo): RowAction[] {
  if (!thread.canManage) return [];
  if (thread.state === "archived") return ["unarchive"];
  if (thread.state === "closed") return ["reopen", "archive"];
  return ["close", "archive"];
}
const ACTION_ICON = { close: "check", reopen: "refresh", archive: "archiveBox", unarchive: "unarchive" } as const;

function ThreadRow({
  thread,
  open,
  picked,
  onOpen,
  onGo,
  onPick,
  onAction,
}: {
  thread: ThreadInfo;
  open: boolean;
  picked: boolean;
  onOpen: () => void;
  onGo: () => void;
  onPick: () => void;
  onAction: (action: RowAction) => void;
}) {
  const { t, i18n } = useTranslation();
  const actors = useActors();
  const title = threadTitle(thread);
  const people = actorsOf(thread);
  const last = thread.lastMessage;
  const more = t("threads.more", { title });
  const missionAgent = thread.mission ? actors.name({ type: "agent", id: thread.mission.agentId }) : "";
  const lead = leadOf(thread);
  const status = threadStatus(thread);
  // The tag shows only what asks for something: open and quiet shows nothing.
  const tag =
    thread.mission && thread.state === "open" ? (
      <MissionStatusChip
        status={missionSummaryStatusKey(thread.mission, thread.working)}
        agentId={thread.mission.agentId}
      />
    ) : status !== "open" ? (
      <ThreadStatusChip thread={thread} />
    ) : thread.suggestedResolved && thread.canManage ? (
      <button
        type="button"
        className="thread-row__resolved"
        title={t("threads.resolvedHint")}
        onClick={() => onAction("close")}
      >
        <Icon name="check" size={14} />
        {t("threads.resolved")}
      </button>
    ) : null;
  return (
    // biome-ignore lint/a11y: a mouse shortcut to the thread; the title button is the keyboard way
    <article
      className={cx("thread-row", open && "is-open", picked && "is-picked")}
      aria-label={title}
      data-dim={thread.state !== "open" || undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, [role=checkbox], [role=menu]")) return;
        onOpen();
      }}
    >
      {/* Who carries the thread; the checkbox takes its place on hover or while selecting. */}
      <span className="thread-row__lead">
        <span className="thread-row__face" aria-hidden="true">
          <ActorAvatar actor={lead} name={actors.name(lead)} size="sm" />
        </span>
        <Checkbox
          className="thread-row__check"
          checked={picked}
          onCheckedChange={onPick}
          aria-label={t("threads.pick", { title })}
        />
      </span>
      <div className="thread-row__title">
        <button type="button" className="thread-row__name" onClick={onOpen}>
          {title}
        </button>
        {thread.mission ? (
          <span className="thread-row__last thread-row__mission">
            <b>{t("missions.pinned.lab")}</b> ·{" "}
            {t("missions.items", { done: thread.mission.planDone, count: thread.mission.planTotal })}
            {missionAgent ? ` · ${missionAgent}` : ""}
          </span>
        ) : (
          last && (
            <span className="thread-row__last">
              {t("threads.lastLine", {
                name: actors.name(lastActor(last.author)),
                text: previewBody(t, last.excerpt, last.meta ?? null, last.mediaKind),
              })}
            </span>
          )
        )}
      </div>
      <div className="thread-row__end">
        <span className="thread-row__state">{tag}</span>
        <span className="thread-row__who">
          <AvatarStack aria-label={people.map((p) => actors.name(p)).join(", ")}>
            {people.slice(0, 3).map((p) => (
              <ActorAvatar key={`${p.type}:${p.id}`} actor={p} name={actors.name(p)} size="xs" />
            ))}
          </AvatarStack>
          {people.length > 3 && <span className="thread-row__more">+{people.length - 3}</span>}
        </span>
        <span className="thread-row__ago">{relativeTime(t, i18n.language, thread.lastActivityAt)}</span>
        <span className="thread-row__actions">
          {quickActions(thread).map((a) => (
            <Button
              key={a}
              size="sm"
              variant="ghost"
              iconOnly
              icon={ACTION_ICON[a]}
              className="thread-row__quick"
              aria-label={t(`threads.actions.${a}`)}
              title={t(`threads.actions.${a}`)}
              onClick={() => onAction(a)}
            />
          ))}
          <Menu
            align="end"
            label={more}
            trigger={<Button size="sm" variant="ghost" iconOnly icon="more" aria-label={more} />}
          >
            <MenuItem icon="external" onSelect={onGo}>
              {thread.state === "archived" ? t("threads.read") : t("threads.open")}
            </MenuItem>
            {quickActions(thread).length > 0 && <MenuSeparator />}
            {quickActions(thread).map((a) => (
              <MenuItem
                key={a}
                icon={ACTION_ICON[a]}
                description={a === "close" ? t("threads.actions.closeHint") : undefined}
                onSelect={() => onAction(a)}
              >
                {t(`threads.actions.${a}`)}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon="check" onSelect={onPick}>
              {picked ? t("threads.unpick") : t("threads.pickShort")}
            </MenuItem>
          </Menu>
        </span>
      </div>
    </article>
  );
}

/** Who carries the thread: the mission's agent, else the agent who spoke last, else the last agent in it, else whoever started it. */
function leadOf(thread: ThreadInfo): { type: ThreadActor["type"]; id: string } {
  if (thread.mission) return { type: "agent", id: thread.mission.agentId };
  const lastAuthor = thread.lastMessage?.author;
  if (lastAuthor?.type === "agent" && lastAuthor.id) return { type: "agent", id: lastAuthor.id };
  const agent = actorsOf(thread)
    .filter((p) => p.type === "agent")
    .at(-1);
  return agent ?? lastActor(thread.rootAuthor);
}

/** Threads by where they live, in the list's order (most recent first); every DM goes under one group. */
function byPlace(threads: ThreadInfo[]) {
  const groups = new Map<string, { key: string; dm: boolean; name: string; threads: ThreadInfo[] }>();
  for (const thread of threads) {
    const dm = thread.channelKind === "dm";
    const key = dm ? "dm" : thread.channelId;
    const group = groups.get(key) ?? { key, dm, name: thread.channelName, threads: [] };
    group.threads.push(thread);
    groups.set(key, group);
  }
  return [...groups.values()];
}

const lastActor = (a: ThreadActor) => ({ type: a.type, id: a.id ?? "" });

function ThreadsEmpty({
  tab,
  filtered,
  onClear,
  onAll,
}: {
  tab: ThreadsTab;
  filtered: boolean;
  onClear: () => void;
  onAll: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const look = useRightHandLook();
  const channel = useChannels(org.id).data?.find((c) => c.isMember);
  if (filtered) {
    return (
      <EmptyState
        size="panel"
        title={t("threads.empty.noResults")}
        actions={<Button onClick={onClear}>{t("threads.empty.clear")}</Button>}
      >
        {t("threads.empty.noResultsText")}
      </EmptyState>
    );
  }
  if (tab === "all") {
    return (
      <EmptyState
        size="page"
        agent={look}
        title={t("threads.empty.allTitle")}
        actions={
          channel && (
            <Button asChild variant="primary" icon="channel">
              <Link to="/org/$orgId/c/$channelId" params={{ orgId: org.id, channelId: channel.id }}>
                {t("empty.goToChannel", { channel: channel.name })}
              </Link>
            </Button>
          )
        }
      >
        {t("threads.empty.all")}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      size="panel"
      // Nobody working is a calm moment: the others are only an empty tab.
      agent={tab === "working" ? look : undefined}
      mood="deal"
      title={t(`threads.empty.${tab}Title`)}
      actions={<Button onClick={onAll}>{t("threads.empty.seeAll")}</Button>}
    />
  );
}
