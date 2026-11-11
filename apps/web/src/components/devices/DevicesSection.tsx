import type { ComputerDevice, DeviceJoinRequest, PhoneDevice } from "@agenteschat/client";
import { useComputerSetup } from "@agenteschat/client";
import { setupView } from "@agenteschat/client/lib/computer";
import {
  computerLine,
  type DeviceFilter,
  type DeviceRow,
  deviceCounts,
  deviceName,
  deviceRows,
  iosOf,
  joinFacts,
  phoneLine,
  statusDetail,
} from "@agenteschat/client/lib/devices";
import { errorText } from "@agenteschat/client/lib/errors";
import { computerKind } from "@agenteschat/client/lib/machines";
import { can } from "@agenteschat/client/lib/permissions";
import {
  Button,
  ComputerPortrait,
  EmptyState,
  List,
  Menu,
  MenuItem,
  MenuSeparator,
  SearchField,
  Segmented,
  Toolbar,
} from "@agenteschat/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentComputersCard } from "@/components/AgentComputer";
import { HelpLink } from "@/components/HelpLink";
import { ErrorState, LoadingList } from "@/components/Loading";
import { HostComputerCard } from "@/components/Machines";
import { useOrg } from "@/components/org-context";
import { useComputerEdition, WorkspaceComputerCard } from "@/components/WorkspaceComputer";
import { useToast } from "@/lib/toast";
import { ConnectDialog, type ConnectStart } from "./ConnectDialog";
import { JoinRequestDialog, RemoveDeviceDialog, RenameDeviceDialog } from "./dialogs";
import { DevicePortrait, OwnerLine, ownerOf, StatusPill, WhoLine } from "./parts";
import {
  useDenyRequest,
  useDevices,
  useForgetPhone,
  useRemoveComputer,
  useStopPhone,
  useUpdateComputer,
  useUpdatePhone,
} from "./queries";

type Target = { kind: "computer"; device: ComputerDevice } | { kind: "phone"; device: PhoneDevice };

/**
 * Settings › Devices: the computers agents work on, each with the phones it reaches nested under it, the computers
 * asking to join on top, and Connect a device. The workspace computer first, with no menu. Every member sees every
 * device; who may use or change one is on its page.
 */
export function DevicesSection({ start }: { start?: ConnectStart | null }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const edition = useComputerEdition(org.id);
  const setup = useComputerSetup(org.id);
  const view = setupView(setup.data, setup.dataUpdatedAt);
  const devices = useDevices(org.id);
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [query, setQuery] = useState("");
  const [connect, setConnect] = useState<ConnectStart | null>(start ?? null);
  const [joining, setJoining] = useState<DeviceJoinRequest | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [removing, setRemoving] = useState<Target | null>(null);
  const canConnect = can(org, "pair_computers");
  const list = devices.data?.devices ?? [];
  const counts = deviceCounts(list);
  const rows = deviceRows(list, filter, query);
  const fix = (phone: PhoneDevice, host: ComputerDevice | null) =>
    setConnect({ step: phone.platform === "ios" ? "iphone" : "android", hostId: host?.id ?? null });

  return (
    <>
      {/* While the workspace computer is on its way, its setup card says where it is. */}
      {view && view.phase !== "ready" && <WorkspaceComputerCard view={view} />}
      <Toolbar
        label={t("devices.filter.label")}
        search={
          <SearchField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            clearLabel={t("filters.clearSearch")}
            placeholder={t("devices.search")}
            aria-label={t("devices.searchLabel")}
          />
        }
        actions={
          canConnect && (
            <Button variant="primary" icon="plus" onClick={() => setConnect({ step: "choose" })}>
              {t("devices.connect")}
            </Button>
          )
        }
      >
        <Segmented
          label={t("devices.filter.label")}
          value={filter}
          onValueChange={setFilter}
          options={(["all", "computers", "phones"] as const).map((v) => ({
            value: v,
            label: t(`devices.filter.${v}`),
            count: counts[v],
          }))}
        />
      </Toolbar>
      {(devices.data?.requests.length ?? 0) > 0 && (
        <List className="dv-list" role="list" aria-label={t("devices.request.list")}>
          {devices.data?.requests.map((r) => (
            <JoinRow key={r.id} request={r} onLetJoin={() => setJoining(r)} />
          ))}
        </List>
      )}
      {devices.isLoading && <LoadingList count={4} trailing />}
      {devices.isError && !devices.data && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}
      {devices.isSuccess &&
        (rows.length > 0 ? (
          <List className="dv-list" role="list" aria-label={t("settings.section.devices")}>
            {rows.map((row) => (
              <DeviceRowView
                key={`${row.kind}-${row.device.id}`}
                row={row}
                onFix={fix}
                onRename={(target) => setRenaming(target)}
                onRemove={(target) => setRemoving(target)}
              />
            ))}
          </List>
        ) : (
          <EmptyState
            size="panel"
            icon={query ? "search" : "computer"}
            title={t(
              query
                ? "devices.empty.searchTitle"
                : filter === "phones"
                  ? "devices.empty.phonesTitle"
                  : "devices.empty.title",
            )}
            // Connect a device is the toolbar's: the empty state adds only a phone's own way in.
            actions={
              !query && canConnect && filter === "phones" ? (
                <Button onClick={() => setConnect({ step: "android" })}>{t("devices.connectPhone")}</Button>
              ) : undefined
            }
          >
            {t(
              query
                ? "devices.empty.searchText"
                : filter === "phones"
                  ? "devices.empty.phonesText"
                  : "devices.empty.text",
            )}
          </EmptyState>
        ))}
      {edition === "selfhost" && (
        <>
          <HostComputerCard onlyOff />
          <AgentComputersCard />
        </>
      )}
      <p className="page__note">
        <HelpLink slug="computers">{t("devices.how")}</HelpLink>
      </p>
      <ConnectDialog start={connect} onClose={() => setConnect(null)} />
      <JoinRequestDialog request={joining} onClose={() => setJoining(null)} />
      <DeviceRenameDialog target={renaming} onClose={() => setRenaming(null)} />
      <DeviceRemoveDialog target={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

/** A computer that ran a connect link: its facts, and Let it join or Deny (for the link's maker and admins). */
function JoinRow({ request: r, onLetJoin }: { request: DeviceJoinRequest; onLetJoin: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const deny = useDenyRequest(org.id);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid row of the kit's list (a div), named for screen readers
    <div className="ac-list__row dv-row dv-row--ask" role="listitem">
      <span className="dv-pic">
        <ComputerPortrait kind={computerKind(r.os)} state="online" />
      </span>
      <span className="dv-row__main">
        <b className="dv-row__name ac-captop">{t("devices.request.title", { name: r.name, org: org.name })}</b>
        <span className="dv-row__kind">{joinFacts(t, r)}</span>
      </span>
      <span className="dv-row__acts ac-acts">
        <Button
          size="sm"
          loading={deny.isPending}
          disabled={deny.isPending}
          onClick={() =>
            deny.mutate(r.id, {
              onSuccess: () => toast.show(t("devices.request.denied", { name: r.name })),
              onError: (err) => toast.show(errorText(t, err), "error"),
            })
          }
        >
          {t("devices.request.deny")}
        </Button>
        <Button size="sm" variant="primary" disabled={deny.isPending} onClick={onLetJoin}>
          {t("devices.request.letJoin")}
        </Button>
      </span>
    </div>
  );
}

/**
 * One row: portrait, name over what it is, the state over its detail, whose it is over who can use it, and its menu.
 * A phone under its host is indented and drawn from it.
 */
export function DeviceRowView({
  row,
  onFix,
  onRename,
  onRemove,
  onHostPage = false,
}: {
  row: DeviceRow;
  /** On its computer's page: the line doesn't name the computer again. */
  onHostPage?: boolean;
  onFix: (phone: PhoneDevice, host: ComputerDevice | null) => void;
  onRename: (target: Target) => void;
  onRemove: (target: Target) => void;
}) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const stop = useStopPhone(org.id);
  const toast = useToast();
  const navigate = useNavigate();
  const d = row.device;
  const host = row.kind === "phone" ? row.host : null;
  const detail = statusDetail(t, i18n.language, d.status, { host: host?.name, hostOs: host?.os, ios: iosOf(d) });
  const target: Target =
    row.kind === "computer" ? { kind: "computer", device: row.device } : { kind: "phone", device: row.device };
  const label = t("devices.menu", { name: d.name });
  const canStop = row.kind === "phone" && d.status.kind === "in_use" && (d.mayManage || d.status.userId === me.user.id);
  const managed = row.kind === "computer" && row.device.machineKind === "managed";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a grid row of the kit's list (a div), named for screen readers
    <div
      className={row.kind === "phone" && row.nested ? "ac-list__row dv-row dv-row--child" : "ac-list__row dv-row"}
      role="listitem"
    >
      <DevicePortrait device={d} />
      <span className="dv-row__main">
        {row.kind === "phone" ? (
          <Link
            to="/org/$orgId/settings/devices/phones/$phoneId"
            params={{ orgId: org.id, phoneId: d.id }}
            className="dv-row__name machine-row__name ac-captop"
          >
            {deviceName(t, d)}
          </Link>
        ) : (
          <Link
            to="/org/$orgId/settings/devices/$deviceId"
            params={{ orgId: org.id, deviceId: d.id }}
            className="dv-row__name machine-row__name ac-captop"
          >
            {deviceName(t, d)}
          </Link>
        )}
        <span className="dv-row__kind">
          {row.kind === "computer"
            ? computerLine(t, row.device)
            : phoneLine(t, row.device, row.nested || onHostPage ? null : host?.name)}
        </span>
      </span>
      <span className="dv-row__status">
        <StatusPill status={d.status} />
        {detail &&
          (d.status.kind === "needs_you" && row.kind === "phone" && d.mayManage ? (
            <button type="button" className="ac-link dv-row__detail" onClick={() => onFix(row.device, host)}>
              {detail}
            </button>
          ) : (
            <span className="dv-row__detail">{detail}</span>
          ))}
      </span>
      <span className="dv-row__people">
        <OwnerLine device={{ ownerUserId: row.kind === "computer" ? ownerOf(row.device) : d.ownerUserId }} />
        <WhoLine device={d} host={host} />
      </span>
      <span className="dv-row__end">
        {!managed && (d.mayManage || canStop) && (
          <Menu
            align="end"
            label={label}
            trigger={<Button size="sm" variant="ghost" iconOnly icon="more" aria-label={label} />}
          >
            <MenuItem
              icon="settings"
              onSelect={() =>
                void (row.kind === "phone"
                  ? navigate({
                      to: "/org/$orgId/settings/devices/phones/$phoneId",
                      params: { orgId: org.id, phoneId: d.id },
                    })
                  : navigate({
                      to: "/org/$orgId/settings/devices/$deviceId",
                      params: { orgId: org.id, deviceId: d.id },
                    }))
              }
            >
              {t("devices.settings")}
            </MenuItem>
            {d.mayManage && (
              <MenuItem icon="edit" onSelect={() => onRename(target)}>
                {t("devices.rename")}
              </MenuItem>
            )}
            {canStop && (
              <MenuItem
                icon="stop"
                onSelect={() =>
                  stop.mutate(d.id, {
                    onSuccess: () => toast.show(t("devices.stopped", { name: d.name })),
                    onError: (err) => toast.show(errorText(t, err), "error"),
                  })
                }
              >
                {t("devices.stop")}
              </MenuItem>
            )}
            {d.mayManage && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={row.kind === "computer" && row.device.machineKind === "host" ? "block" : "trash"}
                  danger
                  onSelect={() => onRemove(target)}
                >
                  {row.kind === "computer" && row.device.machineKind === "host"
                    ? t("machines.host.stop")
                    : t(row.kind === "phone" ? "devices.forget" : "devices.remove")}
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </span>
    </div>
  );
}

/** Rename from a row's menu or a device's page. */
export function DeviceRenameDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const computer = useUpdateComputer(org.id);
  const phone = useUpdatePhone(org.id);
  const save = target?.kind === "phone" ? phone : computer;
  return (
    <RenameDeviceDialog
      open={target !== null}
      name={target?.device.name ?? ""}
      onClose={onClose}
      saving={save.isPending}
      onSave={async (name) => {
        if (!target) return;
        if (target.kind === "phone") await phone.mutateAsync({ id: target.device.id, name });
        else await computer.mutateAsync({ id: target.device.id, name });
        toast.show(t("devices.renamed", { name }));
      }}
    />
  );
}

/** Remove a computer (or forget a phone) from a row's menu or a device's page; `onRemoved` after it went. */
export function DeviceRemoveDialog({
  target,
  onClose,
  onRemoved,
}: {
  target: Target | null;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const remove = useRemoveComputer(org.id);
  const forget = useForgetPhone(org.id);
  const phone = target?.kind === "phone";
  const pending = phone ? forget.isPending : remove.isPending;
  return (
    <RemoveDeviceDialog
      open={target !== null}
      name={target?.device.name ?? ""}
      phone={phone}
      host={target?.kind === "computer" && target.device.machineKind === "host"}
      onClose={onClose}
      removing={pending}
      onRemove={() => {
        if (!target) return;
        const name = target.device.name;
        const done = {
          onSuccess: () => {
            toast.show(
              target.kind === "computer" && target.device.machineKind === "host"
                ? t("machines.host.stopped")
                : t(phone ? "devices.forgotten" : "devices.removed", { name }),
            );
            onClose();
            onRemoved?.();
          },
          onError: (err: unknown) => toast.show(errorText(t, err), "error"),
        };
        if (phone) forget.mutate(target.device.id, done);
        else remove.mutate(target.device.id, done);
      }}
    />
  );
}

export type { Target as DeviceTarget };
