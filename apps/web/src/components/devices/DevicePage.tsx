import type { ComputerDevice, DeviceAudience, PhoneDevice } from "@agenteschat/client";
import { useMachines } from "@agenteschat/client";
import {
  deviceName,
  findPhone,
  iosOf,
  osName,
  personInControl,
  phoneLink,
  phoneSystem,
  statusLook,
  statusSentence,
} from "@agenteschat/client/lib/devices";
import { errorText } from "@agenteschat/client/lib/errors";
import { clockAt } from "@agenteschat/client/lib/format";
import { isPaused } from "@agenteschat/client/lib/machines";
import { can } from "@agenteschat/client/lib/permissions";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Icon,
  List,
  Menu,
  MenuItem,
  MenuSeparator,
  ProviderLogo,
  Select,
  Switch,
} from "@agenteschat/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingList } from "@/components/Loading";
import { MachineAccessCards, MachineAgents, MachineFactsExtra, MachinePage } from "@/components/Machines";
import { PrefRow } from "@/components/NoticePrefs";
import { useOrg } from "@/components/org-context";
import { OrgMark } from "@/components/ProfilePhoto";
import { useToast } from "@/lib/toast";
import { ConnectDialog, type ConnectStart } from "./ConnectDialog";
import { DeviceRemoveDialog, DeviceRenameDialog, DeviceRowView, type DeviceTarget } from "./DevicesSection";
import { PhoneLive } from "./PhoneLive";
import { DevicePortrait, Facts, StatusPill, useOwner } from "./parts";
import { useDevices, useStopPhone, useUpdateComputer, useUpdatePhone } from "./queries";
import { WhoCanUseRow } from "./WhoCanUse";

/** `/settings/devices/<id>` (a computer) or `/settings/devices/phones/<id>` (a phone). */
export function DevicePage({ path }: { path: string }) {
  const phoneId = path.startsWith("phones/") ? path.slice("phones/".length) : null;
  return phoneId ? <PhonePage phoneId={phoneId} /> : <ComputerPage machineId={path} />;
}

function BackToDevices() {
  const { t } = useTranslation();
  const { org } = useOrg();
  return (
    <Button asChild size="sm" variant="ghost" className="machine-page__back">
      <Link to="/org/$orgId/settings/$section" params={{ orgId: org.id, section: "devices" }} search={{}}>
        <Icon name="chevronLeft" />
        {t("devices.back")}
      </Link>
    </Button>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <>
      <BackToDevices />
      <Card>
        <EmptyState icon="computer" title={t("devices.notFound")}>
          {t("devices.notFoundText")}
        </EmptyState>
      </Card>
    </>
  );
}

function useBackToList() {
  const { org } = useOrg();
  const navigate = useNavigate();
  return () =>
    void navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section: "devices" }, search: {} });
}

/** The header card's top: the 96 portrait, the name with its rename pencil, chips (whose, where), the menu. */
function Head({
  device,
  chips,
  menu,
  onRename,
}: {
  device: ComputerDevice | PhoneDevice;
  chips: ReactNode;
  menu?: ReactNode;
  onRename?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="row machine-page__head dv-head">
      <DevicePortrait device={device} size={96} />
      <span className="list-col machine-page__title">
        <span className="row dv-title ac-captop">
          <h2 id="dv-page-title" className="ac-card__title">
            {deviceName(t, device)}
          </h2>
          {onRename && (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              icon="edit"
              aria-label={t("devices.renameName", { name: device.name })}
              onClick={onRename}
            />
          )}
        </span>
        <span className="row dv-headchips">{chips}</span>
      </span>
      {menu}
    </div>
  );
}

/** Whose it is, as a chip: a person's face and name, or the workspace's mark. */
function OwnerChip({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  // A personal workspace names no workspace (ADR 0159): a device of nobody in particular is its person's.
  const owner = useOwner(userId ?? (isPersonal(org) ? me.user.id : null));
  return owner ? (
    <Chip lead={<Avatar kind="person" size="xs" name={owner.name} imageUrl={owner.image} />}>{owner.name}</Chip>
  ) : (
    <Chip lead={<OrgMark logo={org.logo} size={14} />}>{t("devices.workspace")}</Chip>
  );
}

/** The state, its reason in words, and its one action. */
function StatusLine({
  status,
  host,
  hostOs,
  action,
  ios,
}: {
  status: PhoneDevice["status"];
  host?: string;
  /** The host's system: a phone with no driver reads by it. */
  hostOs?: string;
  action?: ReactNode;
  ios?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const sentence = statusSentence(t, i18n.language, status, { host, hostOs, ios });
  const label = status.kind === "in_use" && status.label ? status.label : null;
  return (
    <div className="dv-statusline" data-status={statusLook(status)} role="status">
      <StatusPill status={status} />
      <span className="dv-statusline__text">
        {sentence}
        {label && <small> · {label}</small>}
      </span>
      {action}
    </div>
  );
}

const TOOL_MARK: Record<string, string> = {
  git: "git",
  java: "openjdk",
  androidSdk: "android",
  adb: "android",
  xcode: "apple",
};
const TOOL_ORDER = ["java", "androidSdk", "adb", "git", "xcode", "node", "maestro", "scrcpy"];

/** The toolchains a computer reports, as chips with their official marks ("JDK 21", "Git 2.47"). */
function Toolchains({ tools }: { tools: Record<string, string> }) {
  const { t } = useTranslation();
  const say = t as unknown as (key: string, options: Record<string, string>) => string;
  // The Apple Account that signs the iPhone helper is no tool: the iPhone guide shows it.
  const found = Object.keys(tools)
    .filter((k) => k !== "appleTeam")
    .sort((a, b) => TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b));
  return (
    <span className="dv-tools">
      {found.map((k) => {
        const version = tools[k] ?? "";
        // The SDK reports its folder, not a version.
        const shown = /[/\\]/.test(version) ? "" : version;
        const mark = TOOL_MARK[k];
        return (
          <Chip key={k} lead={mark ? <ProviderLogo id={mark} size="xs" /> : undefined}>
            {say(`devices.tools.${TOOL_ORDER.includes(k) ? k : "other"}`, { version: shown, name: k }).trim()}
          </Chip>
        );
      })}
    </span>
  );
}

const TASKS = ["1", "2", "3", "4", "6", "8"] as const;

/**
 * A computer someone connected: its state and one action, facts and toolchains; who can use it, how many tasks at once
 * and whether it belongs to the workspace; the phones it reaches; then its folders and tools; Remove. The workspace
 * computer keeps its own page.
 */
function ComputerPage({ machineId }: { machineId: string }) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const devices = useDevices(org.id);
  const machines = useMachines(org.id);
  const update = useUpdateComputer(org.id);
  const back = useBackToList();
  const [renaming, setRenaming] = useState<DeviceTarget | null>(null);
  const [removing, setRemoving] = useState<DeviceTarget | null>(null);
  const [connect, setConnect] = useState<ConnectStart | null>(null);
  if (devices.isLoading) return <LoadingList count={2} trailing />;
  if (devices.isError && !devices.data)
    return <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />;
  const d = devices.data?.devices.find((x) => x.id === machineId);
  if (!d) return <NotFound />;
  if (d.machineKind === "managed") return <MachinePage machineId={machineId} />;
  const machine = machines.data?.find((m) => m.id === machineId);
  // The computer's own events patch the machines list at once (a pause, going offline): the line follows them.
  const status: ComputerDevice["status"] =
    machine && isPaused(machine)
      ? { kind: "paused", until: machine.paused?.until ?? null }
      : machine && !machine.online && d.status.kind !== "offline"
        ? { kind: "offline", lastSeenAt: machine.lastSeenAt }
        : d.status;
  const owner = d.ownerUserId === me.user.id;
  const admin = can(org, "configure");
  const save = (input: Parameters<typeof update.mutate>[0], done?: string) =>
    update.mutate(input, {
      onSuccess: () => done && toast.show(done),
      onError: (err) => toast.show(errorText(t, err), "error"),
    });
  const target: DeviceTarget = { kind: "computer", device: d };
  // This server's own computer stops being used here (and can be again), it isn't removed.
  const host = d.machineKind === "host";
  const removeWords = host ? t("machines.host.stop") : t("devices.remove");
  const facts = [
    { label: t("devices.facts.system"), value: osName(t, d.os) },
    ...(d.cpus ? [{ label: t("devices.facts.cpu"), value: String(d.cpus) }] : []),
    ...(d.memoryGb ? [{ label: t("devices.facts.memory"), value: t("devices.memory", { gb: d.memoryGb }) }] : []),
    ...(d.status.kind === "offline" && d.lastSeenAt
      ? [{ label: t("devices.facts.lastSeen"), value: clockAt(i18n.language, d.lastSeenAt) }]
      : []),
    ...(Object.keys(d.toolchains).length > 0
      ? [{ label: t("devices.facts.toolchains"), value: <Toolchains tools={d.toolchains} />, wide: true }]
      : []),
  ];
  return (
    <>
      <BackToDevices />
      <Card aria-labelledby="dv-page-title">
        <Head
          device={d}
          chips={<OwnerChip userId={d.belongsToWorkspace ? null : d.ownerUserId} />}
          onRename={d.mayManage ? () => setRenaming(target) : undefined}
          menu={
            d.mayManage && (
              <Menu
                align="end"
                label={t("devices.menu", { name: d.name })}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon="more"
                    aria-label={t("devices.menu", { name: d.name })}
                  />
                }
              >
                <MenuItem icon="edit" onSelect={() => setRenaming(target)}>
                  {t("devices.rename")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={host ? "block" : "trash"} danger onSelect={() => setRemoving(target)}>
                  {removeWords}
                </MenuItem>
              </Menu>
            )
          }
        />
        <StatusLine status={status} />
        <Facts facts={facts} />
        {status.kind === "paused" && <span className="small muted">{t("machines.pausedHint")}</span>}
        {machine && <MachineFactsExtra machine={machine} />}
        {d.systemMode ? (
          <p className="ac-setnote ac-iconline">
            <Icon name="code" size={14} />
            <span>{t("machines.agentUsers")}</span>
          </p>
        ) : null}
        {machine && <MachineAgents machine={machine} />}
      </Card>
      {/* Who may change it: its owner and the admins. Everyone else reads. */}
      {!d.mayManage && <ReadOnlyNote userId={d.ownerUserId} />}
      <Card aria-label={t("devices.sharing")}>
        <div className="settings-rows">
          <WhoCanUseRow
            idPrefix="dv-pc"
            value={d.audience}
            ownerUserId={d.ownerUserId}
            editable={d.mayManage}
            narrowOnly={!owner}
            saving={update.isPending}
            hint={t("devices.who.computerHint")}
            onChange={(audience: DeviceAudience) => save({ id: d.id, audience })}
          />
          {/* Only once the computer says its limit: a guess here would be a setting that changes nothing. */}
          {d.maxTasks !== null && (
            <PrefRow
              id="dv-pc-tasks"
              icon="layers"
              label={t("devices.maxTasks")}
              hint={t("devices.maxTasksHint")}
              control={
                <Select
                  size="sm"
                  align="end"
                  aria-label={t("devices.maxTasks")}
                  disabled={!owner || update.isPending}
                  value={String(d.maxTasks)}
                  onValueChange={(v) => save({ id: d.id, maxTasks: Number(v) })}
                  // The value it has stays a choice even when it isn't one of ours, so the select never shows empty.
                  options={[...new Set([...TASKS, String(d.maxTasks)])]
                    .sort((a, b) => Number(a) - Number(b))
                    .map((n) => ({ value: n, label: n }))}
                />
              }
            />
          )}
          {admin && d.machineKind === "connected" && (
            <PrefRow
              id="dv-pc-belongs"
              icon="members"
              label={t("devices.belongs")}
              hint={t("devices.belongsHint")}
              status={<ConnectedBy userId={d.ownerUserId} />}
              control={
                <Switch
                  id="dv-pc-belongs-switch"
                  checked={d.belongsToWorkspace}
                  disabled={update.isPending}
                  onCheckedChange={(on) => save({ id: d.id, belongsToWorkspace: on })}
                />
              }
            />
          )}
        </div>
      </Card>
      {d.phones.length > 0 && (
        <Card aria-labelledby="dv-pc-phones">
          <CardHeader id="dv-pc-phones" icon="phone" title={t("devices.phonesHere")} />
          <List className="dv-list" role="list" aria-label={t("devices.phonesHere")}>
            {d.phones.map((p) => (
              <DeviceRowView
                key={p.id}
                row={{ kind: "phone", device: p, host: d, nested: false }}
                onHostPage
                onFix={(phone) => setConnect({ step: phone.platform === "ios" ? "iphone" : "android", hostId: d.id })}
                onRename={setRenaming}
                onRemove={setRemoving}
              />
            ))}
          </List>
        </Card>
      )}
      {machine && <MachineAccessCards machine={machine} />}
      {d.mayManage && (
        <div>
          <Button size="sm" variant="danger" icon={host ? "block" : "trash"} onClick={() => setRemoving(target)}>
            {removeWords}
          </Button>
        </div>
      )}
      <DeviceRenameDialog target={renaming} onClose={() => setRenaming(null)} />
      <DeviceRemoveDialog
        target={removing}
        onClose={() => setRemoving(null)}
        onRemoved={removing?.kind === "computer" ? back : undefined}
      />
      <ConnectDialog start={connect} onClose={() => setConnect(null)} />
    </>
  );
}

function ReadOnlyNote({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  const owner = useOwner(userId);
  return (
    <p className="page__note">
      {owner ? t("machines.page.readOnly", { name: owner.name }) : t("machines.page.readOnlyNobody")}
    </p>
  );
}

function ConnectedBy({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  const owner = useOwner(userId);
  return owner ? t("devices.connectedBy", { name: owner.name }) : null;
}

/**
 * A phone a computer reaches: its state (Stop while an agent uses it), facts, who can use it (an iPhone follows its
 * Mac), Forget.
 */
function PhonePage({ phoneId }: { phoneId: string }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const devices = useDevices(org.id);
  const update = useUpdatePhone(org.id);
  const stop = useStopPhone(org.id);
  const back = useBackToList();
  const [renaming, setRenaming] = useState<DeviceTarget | null>(null);
  const [removing, setRemoving] = useState<DeviceTarget | null>(null);
  const [connect, setConnect] = useState<ConnectStart | null>(null);
  if (devices.isLoading) return <LoadingList count={2} trailing />;
  if (devices.isError && !devices.data)
    return <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />;
  const found = findPhone(devices.data?.devices, phoneId);
  if (!found) return <NotFound />;
  const { phone: p, host } = found;
  const target: DeviceTarget = { kind: "phone", device: p };
  const owner = p.ownerUserId === me.user.id;
  // A person in control gives it back on its screen instead.
  const canStop =
    p.status.kind === "in_use" &&
    personInControl(p.status) !== me.user.id &&
    (p.mayManage || p.status.userId === me.user.id);
  const action =
    p.status.kind === "in_use" && canStop ? (
      <Button
        size="sm"
        icon="stop"
        loading={stop.isPending}
        disabled={stop.isPending}
        onClick={() =>
          stop.mutate(p.id, {
            onSuccess: () => toast.show(t("devices.stopped", { name: p.name })),
            onError: (err) => toast.show(errorText(t, err), "error"),
          })
        }
      >
        {t("devices.stop")}
      </Button>
    ) : p.status.kind === "needs_you" && p.mayManage ? (
      <Button
        size="sm"
        onClick={() => setConnect({ step: p.platform === "ios" ? "iphone" : "android", hostId: host.id })}
      >
        {t("devices.showMe")}
      </Button>
    ) : undefined;
  const link = phoneLink(t, p);
  const facts = [
    { label: t("devices.facts.system"), value: phoneSystem(t, p) },
    { label: t("devices.facts.model"), value: p.model },
    ...(link ? [{ label: t("devices.facts.connection"), value: link }] : []),
  ];
  return (
    <>
      <BackToDevices />
      <Card aria-labelledby="dv-page-title">
        <Head
          device={p}
          chips={
            <>
              <OwnerChip userId={p.ownerUserId} />
              <Link
                to="/org/$orgId/settings/devices/$deviceId"
                params={{ orgId: org.id, deviceId: host.id }}
                className="ac-chip dv-chiplink"
              >
                <Icon name="computer" size={14} />
                <span className="ac-chip__text">{t("devices.onHostChip", { host: host.name })}</span>
              </Link>
            </>
          }
          onRename={p.mayManage ? () => setRenaming(target) : undefined}
          menu={
            p.mayManage && (
              <Menu
                align="end"
                label={t("devices.menu", { name: p.name })}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    icon="more"
                    aria-label={t("devices.menu", { name: p.name })}
                  />
                }
              >
                <MenuItem icon="edit" onSelect={() => setRenaming(target)}>
                  {t("devices.rename")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="trash" danger onSelect={() => setRemoving(target)}>
                  {t("devices.forget")}
                </MenuItem>
              </Menu>
            )
          }
        />
        <StatusLine status={p.status} host={host.name} hostOs={host.os} action={action} ios={iosOf(p)} />
        <Facts facts={facts} />
      </Card>
      <PhoneLive key={p.id} phone={p} host={host.name} />
      <Card aria-label={t("devices.sharing")}>
        <div className="settings-rows">
          {p.audience ? (
            <WhoCanUseRow
              idPrefix="dv-phone"
              value={p.audience}
              ownerUserId={p.ownerUserId}
              editable={p.mayManage}
              narrowOnly={!owner}
              saving={update.isPending}
              hint={t("devices.who.phoneHint", { host: host.name })}
              onChange={(audience) =>
                update.mutate({ id: p.id, audience }, { onError: (err) => toast.show(errorText(t, err), "error") })
              }
            />
          ) : (
            <PrefRow
              id="dv-phone-who"
              icon="link"
              label={t("devices.who.title")}
              hint={t("devices.who.followsHint")}
              value={
                <Link
                  to="/org/$orgId/settings/devices/$deviceId"
                  params={{ orgId: org.id, deviceId: host.id }}
                  className="ac-link"
                >
                  {t("devices.who.sameAs", { host: host.name })}
                </Link>
              }
            />
          )}
        </div>
      </Card>
      {p.mayManage && (
        <div>
          <Button size="sm" variant="danger" icon="trash" onClick={() => setRemoving(target)}>
            {t("devices.forget")}
          </Button>
        </div>
      )}
      <DeviceRenameDialog target={renaming} onClose={() => setRenaming(null)} />
      <DeviceRemoveDialog target={removing} onClose={() => setRemoving(null)} onRemoved={back} />
      <ConnectDialog start={connect} onClose={() => setConnect(null)} />
    </>
  );
}
