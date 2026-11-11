import type { ComputerDevice, DeviceAudience, DevicesList, Member, OrgRole, PhoneDevice } from "@agenteschat/client";
import {
  audienceWords,
  iosOf,
  portraitOf,
  reasonText,
  sameAudience,
  statusDetail,
  statusLook,
  statusPill,
} from "@agenteschat/client/lib/devices";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  ComputerPortrait,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  type IconName,
  Input,
  PixelSpinner,
  Select,
  Switch,
} from "@agenteschat/ui";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useStore } from "../../app";
import {
  androidStepsUrl,
  deviceServer,
  IPHONE_SETUP_PREF,
  isSignedOut,
  siteApi,
  thisComputer,
} from "../../control/devices";
import { type PairTarget, pairWithSession, targetKey } from "../../control/pair";
import { serverName } from "../../control/server";
import { type Home, orgName } from "../../control/store";
import { toolsHere } from "../../control/this-mac";
import { agentOf, useLocalServer, usePending, writePref } from "../../hooks";
import type { Host } from "../../host/types";
import { AgentFace, ConnectionChip, OrgTile } from "../../ui/bits";
import { MacPermissionCard, useMacGrants } from "../../ui/permissions";
import { CardTitle, hintFor, PrefCard, PrefRow } from "../../ui/settings";
import { useToast } from "../../ui/Toast";

/** How often the devices are asked while Preferences is open (the runner's own phone changes ask at once). */
const POLL_MS = 5000;

/** The iPhone setup, in the welcome window (it reads the pref once it shows). */
export function openIphoneSetup(host: Host) {
  writePref(IPHONE_SETUP_PREF, true);
  void host.showWindow("welcome").catch(() => {});
}

interface Target {
  homeId: string;
  server: string | null;
  orgId: string | null;
}
type Answer = { list?: DevicesList; error?: unknown };

/** Each home's devices on its server, asked together, again every `POLL_MS` and right after its phones changed. */
function useDevices(homes: readonly Home[]) {
  const host = useHost();
  const local = useLocalServer();
  const targets: Target[] = homes.map((h) => ({
    homeId: h.homeId,
    server: deviceServer(h, local),
    orgId: h.status?.org?.id ?? null,
  }));
  const key = JSON.stringify(targets);
  const phones = JSON.stringify(homes.map((h) => h.status?.phones ?? []));
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const load = useCallback(async () => {
    const asked = JSON.parse(key) as Target[];
    const got = await Promise.all(
      asked.map(async (a): Promise<[string, Answer]> => {
        if (!a.server || !a.orgId) return [a.homeId, {}];
        try {
          return [a.homeId, { list: await siteApi(host, a.server).devices.list(a.orgId) }];
        } catch (error) {
          return [a.homeId, { error }];
        }
      }),
    );
    setAnswers(Object.fromEntries(got));
  }, [host, key]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  // The runner saw a phone come, go or change state: its server heard it at the same moment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `phones` is the trigger itself
  useEffect(() => {
    const timer = setTimeout(() => void load(), 800);
    return () => clearTimeout(timer);
  }, [phones, load]);
  return { answers, load, targets };
}

const AUDIENCE_ICON: Record<DeviceAudience["mode"], IconName> = {
  owner: "audienceOwner",
  everyone: "audienceEveryone",
  people: "audiencePeople",
};

/**
 * General's This Mac part: one switch per workspace the person is signed in to (a paired one pauses and resumes, one
 * this computer doesn't work for yet pairs it after the system's dialog), Commands, who can use it, and the phones
 * plugged in with their state and one way out each (Stop, Show me how). The rule and the phones are the server's, as
 * the web sets them. On a Mac, its permissions (`Permissions`). `bottom`: Open at login, under the rest.
 */
export function ThisMacCards({ homes, offers, bottom }: { homes: Home[]; offers: PairTarget[]; bottom?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const store = useStore();
  const toast = useToast();
  const { answers, load, targets } = useDevices(homes);
  const [pending, run] = usePending<string>();
  const { tools } = toolsHere(homes);
  const user = homes.find((h) => h.status?.user)?.status?.user;
  const multi = homes.length > 1;
  const commandsTitle = t("desktop.tools.commandsName");

  const setAgents = (home: Home, on: boolean) =>
    run(home.homeId, async () => {
      try {
        await store.request(home.homeId, on ? { type: "resume" } : { type: "pause", until: null });
      } catch {
        toast(t("desktop.common.error"), "alert");
      }
    });
  const pair = (target: PairTarget) =>
    run(targetKey(target), async () => {
      try {
        if (!(await host.askToPair(target.server, target.name))) return;
        await pairWithSession(host, store, target);
        // Its agents work while the app runs.
        await host.setAutostart(true).catch(() => {});
        toast(t("desktop.pair.done", { org: target.name }));
      } catch (err) {
        toast(errorText(t, err, i18n.language), "alert");
      }
    });
  const workspaceRow = (
    key: string,
    logo: string | null,
    org: string,
    on: boolean,
    desc: string,
    onChange: (on: boolean) => void,
    chip?: ReactNode,
  ) => {
    const title = t("desktop.pair.letOrg", { org });
    const id = `mac-agents-${key}`;
    return (
      <PrefRow
        key={key}
        lead={<OrgTile logo={logo} size="lg" />}
        htmlFor={id}
        title={title}
        hint={hintFor(t, title, t("desktop.prefs.thisMac.letAgentsDesc"))}
        chip={chip}
        desc={desc}
        end={
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={on}
            disabled={pending !== null}
            onCheckedChange={onChange}
          />
        }
      />
    );
  };
  const setCommands = (on: boolean) =>
    run("commands", async () => {
      try {
        await store.requestAll({ type: "tools.set", tool: "commands", on });
        if (on) toast(t("desktop.prefs.tools.commandsOn"), "code");
      } catch {
        toast(t("desktop.common.error"), "alert");
      }
    });

  const logo = (icon: IconName) => (
    <span className="dk-logo">
      <Icon name={icon} size={16} />
    </span>
  );

  return (
    <>
      <CardTitle>{t("desktop.prefs.thisMac.agents")}</CardTitle>
      <PrefCard>
        {homes.map((h) => {
          const paused = h.status?.paused?.paused === true;
          return workspaceRow(
            h.homeId,
            h.logo,
            orgName(h),
            !paused,
            t(paused ? "desktop.pair.notUsing" : "desktop.pair.canUse"),
            (on) => void setAgents(h, on),
            <ConnectionChip status={h.status} running={h.running} />,
          );
        })}
        {offers.map((o) =>
          workspaceRow(targetKey(o), o.logo, o.name, pending === targetKey(o), t("desktop.pair.notUsing"), (on) => {
            if (on) void pair(o);
          }),
        )}
        {homes.length > 0 && (
          <PrefRow
            lead={logo("code")}
            htmlFor="mac-commands"
            title={commandsTitle}
            hint={hintFor(
              t,
              commandsTitle,
              user ? t("desktop.prefs.thisMac.commandsDesc", { user }) : t("desktop.tools.commandsDesc"),
            )}
            end={
              <Switch
                id="mac-commands"
                aria-describedby="mac-commands-hint mac-commands-warn"
                checked={tools.commands}
                disabled={pending !== null}
                onCheckedChange={(on) => void setCommands(on)}
              />
            }
            under={
              <span className="dk-honest ac-iconline">
                <Icon name="alert" size={14} />
                <span id="mac-commands-warn">{t("desktop.tools.commandsWarn")}</span>
              </span>
            }
          />
        )}
        {homes.map((h, i) => {
          const target = targets[i];
          const answer = answers[h.homeId];
          return target?.server && target.orgId ? (
            <WhoRow
              key={h.homeId}
              home={h}
              server={target.server}
              orgId={target.orgId}
              computer={thisComputer(answer?.list, h)}
              error={answer?.error}
              multi={multi}
              user={user}
              onChanged={load}
            />
          ) : null;
        })}
        {bottom}
      </PrefCard>

      {host.platform === "mac" && homes.length > 0 && <Permissions />}

      {homes.map((h, i) => {
        const target = targets[i];
        const computer = thisComputer(answers[h.homeId]?.list, h);
        if (!target?.server || !target.orgId || answers[h.homeId]?.error) return null;
        return (
          <Fragment key={h.homeId}>
            <CardTitle>
              {multi ? t("desktop.prefs.thisMac.phonesIn", { org: orgName(h) }) : t("desktop.prefs.thisMac.phones")}
            </CardTitle>
            {computer && computer.phones.length > 0 && (
              <PrefCard>
                {computer.phones.map((p) => (
                  <PhoneRow
                    key={p.id}
                    phone={p}
                    computer={computer}
                    home={h}
                    server={target.server ?? ""}
                    orgId={target.orgId ?? ""}
                    onChanged={load}
                  />
                ))}
              </PrefCard>
            )}
            <p className={computer?.phones.length ? "dk-under-card dk-help" : "dk-help"}>
              {t("desktop.prefs.thisMac.plug")}{" "}
              {computer && (
                <button
                  type="button"
                  className="ac-link dk-link"
                  onClick={() =>
                    void host.openExternal(androidStepsUrl(target.server ?? "", target.orgId ?? "", computer.id))
                  }
                >
                  {t("desktop.prefs.thisMac.androidSteps")}
                </button>
              )}
              {host.platform === "mac" && (
                <>
                  {computer && " · "}
                  <button type="button" className="ac-link dk-link" onClick={() => openIphoneSetup(host)}>
                    {t("desktop.prefs.thisMac.iphoneSteps")}
                  </button>
                </>
              )}
            </p>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * This Mac's permissions, as Prepare this Mac asks them, and where people turn them on again: an ad-hoc signed app
 * loses them with each update. Asking for Screen Recording or Full Disk Access keeps Preferences to open again when
 * macOS reopens the app.
 */
function Permissions() {
  const { t } = useTranslation();
  const host = useHost();
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    host
      .setupState()
      .then((s) => {
        if (s?.step !== "prefs" || !s.resumed) return;
        setResumed(true);
        return host.setSetupState(null);
      })
      .catch(() => {});
  }, [host]);
  const mac = useMacGrants(() => host.setSetupState({ step: "prefs" }).catch(() => {}));
  const title = t("desktop.prepare.prefsTitle");
  return (
    <>
      <CardTitle hint={hintFor(t, title, t("desktop.prepare.prefsHint"))}>{title}</CardTitle>
      <MacPermissionCard mac={mac} resumed={resumed} />
    </>
  );
}

/** Who may point their agents at this computer, the web's three choices; the people and roles in a dialog. */
function WhoRow({
  home,
  server,
  orgId,
  computer,
  error,
  multi,
  user,
  onChanged,
}: {
  home: Home;
  server: string;
  orgId: string;
  computer: ComputerDevice | null;
  error: unknown;
  multi: boolean;
  user: string | undefined;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const org = orgName(home);
  const title = multi ? t("desktop.prefs.thisMac.whoIn", { org }) : t("desktop.prefs.thisMac.who");
  const id = `who-${home.homeId}`;

  if (error) {
    const signedOut = isSignedOut(error);
    return (
      <PrefRow
        lead={
          <span className="dk-logo">
            <Icon name="audienceOwner" size={16} />
          </span>
        }
        title={title}
        desc={
          signedOut
            ? t("desktop.prefs.thisMac.signedOut", { server: serverName(server) })
            : t("desktop.prefs.thisMac.unreachable", { server: serverName(server) })
        }
        end={
          signedOut ? (
            <Button size="sm" onClick={() => void host.openExternal(`${server}/org/${encodeURIComponent(orgId)}`)}>
              {t("desktop.common.open")}
            </Button>
          ) : (
            <Button size="sm" icon="refresh" onClick={() => void onChanged()}>
              {t("desktop.common.retry")}
            </Button>
          )
        }
      />
    );
  }
  if (!computer) {
    return (
      <PrefRow
        lead={
          <span className="dk-logo">
            <Icon name="audienceOwner" size={16} />
          </span>
        }
        title={title}
        end={<PixelSpinner size={16} />}
      />
    );
  }

  const audience = computer.audience;
  const save = async (next: DeviceAudience) => {
    if (sameAudience(next, audience)) return true;
    setSaving(true);
    try {
      await siteApi(host, server).devices.updateComputer(orgId, computer.id, { audience: next });
      await onChanged();
      toast(t("desktop.prefs.thisMac.saved"));
      return true;
    } catch (err) {
      toast(errorText(t, err, i18n.language), "alert");
      return false;
    } finally {
      setSaving(false);
    }
  };
  // Someone else's agents on a computer where every agent is this OS user: what they can reach, said once.
  const wider = audience.mode !== "owner" && !computer.systemMode && user;

  return (
    <>
      <PrefRow
        lead={
          <span className="dk-logo">
            <Icon name={AUDIENCE_ICON[audience.mode]} size={16} />
          </span>
        }
        htmlFor={id}
        title={title}
        hint={hintFor(t, title, t("desktop.prefs.thisMac.whoDesc"))}
        desc={
          audience.mode === "people" ? (
            <>
              {audienceWords(t, { audience, ownerName: null }).text}
              {computer.mayManage && (
                <>
                  {" · "}
                  <button type="button" className="ac-link dk-link" onClick={() => setPicking(true)}>
                    {t("desktop.prefs.thisMac.edit")}
                  </button>
                </>
              )}
            </>
          ) : undefined
        }
        end={
          <Select
            id={id}
            size="sm"
            align="end"
            aria-describedby={`${id}-hint`}
            value={audience.mode}
            disabled={!computer.mayManage || saving}
            onValueChange={(mode) => {
              if (mode === "people") setPicking(true);
              else void save({ mode, userIds: [], roleIds: [] });
            }}
            options={(["owner", "everyone", "people"] as const).map((mode) => ({
              value: mode,
              label:
                mode === "everyone" ? t("desktop.prefs.thisMac.everyone", { org }) : t(`desktop.prefs.thisMac.${mode}`),
              leading: <Icon name={AUDIENCE_ICON[mode]} size={16} />,
            }))}
          />
        }
        under={
          wider ? (
            <span className="dk-honest ac-iconline">
              <Icon name="alert" size={14} />
              <span>{t("desktop.prefs.thisMac.wider", { user })}</span>
            </span>
          ) : undefined
        }
      />
      {picking && (
        <PeoplePicker
          server={server}
          orgId={orgId}
          ownerUserId={computer.ownerUserId}
          value={audience.mode === "people" ? audience : { mode: "people", userIds: [], roleIds: [] }}
          saving={saving}
          onCancel={() => setPicking(false)}
          onSave={async (next) => {
            if (await save(next)) setPicking(false);
          }}
        />
      )}
    </>
  );
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** "Specific people or roles": the workspace's people (the owner always can) and roles, ticked. */
export function PeoplePicker({
  server,
  orgId,
  ownerUserId,
  value,
  saving,
  onCancel,
  onSave,
}: {
  server: string;
  orgId: string;
  ownerUserId: string | null;
  value: DeviceAudience;
  saving: boolean;
  onCancel: () => void;
  onSave: (next: DeviceAudience) => void;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const [people, setPeople] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [userIds, setUserIds] = useState(() => new Set(value.userIds));
  const [roleIds, setRoleIds] = useState(() => new Set(value.roleIds));
  const api = useMemo(() => siteApi(host, server), [host, server]);
  useEffect(() => {
    let live = true;
    Promise.all([api.orgs.members(orgId), api.roles.list(orgId)])
      .then(([members, list]) => {
        if (!live) return;
        setPeople(members.filter((m) => m.userId !== ownerUserId));
        setRoles(list.roles.filter((r) => r.kind === "custom"));
      })
      .catch((err) => live && setFailed(errorText(t, err, i18n.language)));
    return () => {
      live = false;
    };
  }, [api, orgId, ownerUserId, t, i18n.language]);
  const q = fold(query.trim());
  const shown = (people ?? []).filter((m) => !q || fold(m.name).includes(q) || fold(m.email).includes(q));
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && onCancel()}
      title={t("desktop.prefs.thisMac.pickTitle")}
      description={t("desktop.prefs.thisMac.ownerAlways")}
      closeLabel={t("desktop.common.close")}
      width={440}
    >
      <DialogBody className="dk-pick">
        {failed ? (
          <p className="dk-honest">{failed}</p>
        ) : !people ? (
          <PixelSpinner size={16} />
        ) : (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("desktop.prefs.thisMac.search")}
              aria-label={t("desktop.prefs.thisMac.search")}
            />
            <h4 className="dk-ctitle">{t("audience.people")}</h4>
            <div className="dk-pick__list">
              {shown.length === 0 && <p className="dk-help">{t("desktop.prefs.thisMac.noMatch")}</p>}
              {shown.map((m) => (
                <div key={m.userId} className="dk-pick__row ac-iconline">
                  <Checkbox
                    id={`pick-person-${m.userId}`}
                    checked={userIds.has(m.userId)}
                    onCheckedChange={(on) => setUserIds((s) => toggle(s, m.userId, on))}
                  />
                  <label htmlFor={`pick-person-${m.userId}`} className="ac-iconline">
                    <Avatar kind="person" size="xs" name={m.name} imageUrl={m.avatarUrl ?? m.image} />
                    <span>{m.name}</span>
                  </label>
                </div>
              ))}
            </div>
            {roles.length > 0 && (
              <>
                <h4 className="dk-ctitle">{t("audience.roles")}</h4>
                <div className="dk-pick__list">
                  {roles.map((r) => (
                    <div key={r.id} className="dk-pick__row ac-iconline">
                      <Checkbox
                        id={`pick-role-${r.id}`}
                        checked={roleIds.has(r.id)}
                        onCheckedChange={(on) => setRoleIds((s) => toggle(s, r.id, on))}
                      />
                      <label htmlFor={`pick-role-${r.id}`}>{r.name}</label>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter bar>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("desktop.common.cancel")}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={!people}
          onClick={() => onSave({ mode: "people", userIds: [...userIds], roleIds: [...roleIds] })}
        >
          {t("desktop.prefs.thisMac.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** One phone on this computer: its state, who can use it, and its one way out (Stop, Show me how). */
function PhoneRow({
  phone,
  computer,
  home,
  server,
  orgId,
  onChanged,
}: {
  phone: PhoneDevice;
  computer: ComputerDevice;
  home: Home;
  server: string;
  orgId: string;
  onChanged: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const toast = useToast();
  const [stopping, setStopping] = useState(false);
  const { kind, state } = portraitOf(phone);
  const s = phone.status;
  const look = statusLook(s);
  const holder = s.kind === "in_use" && s.agentId ? agentOf(home, { id: s.agentId, name: s.agentName ?? "" }) : null;
  const who =
    phone.audience === null
      ? audienceWords(t, { audience: null, ownerName: null, short: true }).text
      : t("desktop.prefs.thisMac.phoneWho", {
          who:
            phone.audience.mode === "owner"
              ? t("desktop.prefs.thisMac.owner")
              : audienceWords(t, { audience: phone.audience, ownerName: null }).text,
        });
  const line =
    s.kind === "needs_you"
      ? reasonText(t, s.reason)
      : [statusDetail(t, i18n.language, s, { host: computer.name, ios: iosOf(phone) }), who]
          .filter(Boolean)
          .join(" · ");
  const icon: IconName | undefined =
    look === "ready"
      ? "check"
      : look === "needs"
        ? "alert"
        : look === "offline"
          ? "dash"
          : look === "paused"
            ? "pause"
            : undefined;
  const lead = holder ? (
    <AgentFace agent={holder} size="xs" />
  ) : look === "preparing" || look === "busy" ? (
    <PixelSpinner size={14} />
  ) : undefined;
  const howTo = phone.platform === "ios" ? look === "needs" || look === "preparing" : look === "needs";

  const stop = async () => {
    setStopping(true);
    try {
      await siteApi(host, server).devices.stopPhone(orgId, phone.id);
      toast(t("devices.stopped", { name: phone.name }));
      await onChanged();
    } catch (err) {
      toast(errorText(t, err, i18n.language), "alert");
    } finally {
      setStopping(false);
    }
  };

  return (
    <PrefRow
      lead={<ComputerPortrait kind={kind} state={state} size={48} />}
      title={phone.name}
      chip={
        <Chip tone={look === "needs" ? "waiting" : "neutral"} icon={lead ? undefined : icon} lead={lead}>
          {statusPill(t, s)}
        </Chip>
      }
      hint={
        phone.platform === "android"
          ? hintFor(t, t("devices.who.title"), t("devices.who.phoneHint", { host: computer.name }))
          : undefined
      }
      desc={line}
      end={
        s.kind === "in_use" ? (
          <Button size="sm" icon="stop" loading={stopping} onClick={() => void stop()}>
            {t("devices.stop")}
          </Button>
        ) : howTo ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              phone.platform === "ios"
                ? openIphoneSetup(host)
                : void host.openExternal(androidStepsUrl(server, orgId, computer.id))
            }
          >
            {t("devices.showMe")}
          </Button>
        ) : undefined
      }
    />
  );
}
