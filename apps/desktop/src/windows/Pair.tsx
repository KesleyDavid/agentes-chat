/**
 * Pairing this computer from the welcome window, after the person said yes here. `PairOffer`: shown once after
 * sign-in for a workspace this computer doesn't work for yet (the card is the ask, so no system dialog follows).
 * `PairLinkSheet`: a pair link from the web, with who made it and where from, read from its server; Connect starts
 * the runner with the link and waits for its maker to let it in on the web. Both show what agents can do here as
 * switches, and on a Mac go on to `Prepare` (its permissions) once paired.
 */
import type { DeviceAudience } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Button, Checkbox, Icon, type IconName, PixelSpinner, ProviderLogo, Select, Switch } from "@agenteschat/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHost, useSnapshot, useStore } from "../app";
import { type LinkFailure, type LinkInfo, type PairTarget, pairWithLink, pairWithSession } from "../control/pair";
import { allDone } from "../control/permissions";
import { serverName } from "../control/server";
import { type PairTools, pairTools, toolsFound } from "../control/this-mac";
import { MacPortrait, OrgTile } from "../ui/bits";
import { MacPermissionCard, needsPrepare, useMacGrants } from "../ui/permissions";
import { CardTitle, hintFor, PrefCard, PrefRow } from "../ui/settings";
import { PeoplePicker } from "./prefs/ThisMac";

const AUDIENCE_ICON: Record<DeviceAudience["mode"], IconName> = {
  owner: "audienceOwner",
  everyone: "audienceEveryone",
  people: "audiencePeople",
};

/** A sheet of the welcome window's body: a title, what it says, the buttons at the bottom. */
function Sheet({
  lead,
  title,
  children,
  acts,
}: {
  lead?: ReactNode;
  title: string;
  children?: ReactNode;
  acts: ReactNode;
}) {
  return (
    <div className="dk-fr__sheet dk-pair">
      {lead}
      <h1>{title}</h1>
      {children}
      <div className="dk-fr__acts">{acts}</div>
    </div>
  );
}

/** The welcome window around a sheet shown outside the first run. */
export const Framed = ({ children }: { children: ReactNode }) => (
  <div className="dk-fr" data-screen="pair">
    <div className="dk-fr__body">{children}</div>
  </div>
);

const Problem = ({ text }: { text: string }) => (
  <span className="dk-honest dk-fr__problem ac-iconline" role="alert">
    <Icon name="alert" size={16} />
    <span>{text}</span>
  </span>
);

const Waiting = ({ text }: { text: string }) => (
  <p className="dk-fr__question dk-fr__checking" aria-live="polite">
    <PixelSpinner size={14} color="sky" />
    <span className="dk-shimmer">{text}</span>
  </p>
);

const logo = (mark: ReactNode) => <span className="dk-logo">{mark}</span>;

/**
 * "What agents can do here": the pairing's tools as switches, on as `pairTools` starts them (Claude Code's and Codex's
 * rows only once a runner here found them); `chosen` holds the ones the person changed. Folders come later.
 */
function ToolSwitches({
  chosen,
  onChange,
  disabled,
}: {
  chosen: Partial<PairTools>;
  onChange: (next: Partial<PairTools>) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const snap = useSnapshot();
  const found = toolsFound(snap);
  const tools = { ...pairTools(snap), ...chosen };
  const row = (tool: keyof PairTools, lead: ReactNode, name: string, desc: string, under?: ReactNode) => (
    <PrefRow
      key={tool}
      lead={lead}
      htmlFor={`pair-${tool}`}
      title={name}
      hint={hintFor(t, name, desc)}
      under={under}
      end={
        <Switch
          id={`pair-${tool}`}
          aria-describedby={under ? `pair-${tool}-hint pair-${tool}-warn` : `pair-${tool}-hint`}
          checked={tools[tool]}
          disabled={disabled}
          onCheckedChange={(on) => onChange({ ...chosen, [tool]: on })}
        />
      }
    />
  );
  return (
    <div className="dk-pair__group">
      <CardTitle>{t("desktop.pair.canDo")}</CardTitle>
      <PrefCard>
        {row(
          "commands",
          logo(<Icon name="code" size={16} />),
          t("desktop.tools.commandsName"),
          t("desktop.tools.commandsDesc"),
          <span className="dk-honest ac-iconline">
            <Icon name="alert" size={14} />
            <span id="pair-commands-warn">{t("desktop.tools.commandsWarn")}</span>
          </span>,
        )}
        {found?.claude &&
          row(
            "claude",
            logo(<ProviderLogo id="claude_code" size="xs" />),
            t("desktop.tools.claudeName"),
            t("desktop.tools.claudeDesc"),
          )}
        {found?.codex &&
          row(
            "codex",
            logo(<ProviderLogo id="codex" size="xs" />),
            t("desktop.tools.codexName"),
            t("desktop.tools.codexDesc"),
          )}
        {row(
          "browser",
          logo(<Icon name="globe" size={16} />),
          t("desktop.tools.browserName"),
          t("desktop.tools.browserDesc"),
        )}
      </PrefCard>
      <p className="dk-under-card dk-help">{t("desktop.pair.foldersLater")}</p>
    </div>
  );
}

/**
 * "Get this Mac ready", right after pairing on a Mac: the permissions agents need, asked now so nothing stops them
 * later. Kept by the app from the start, so when macOS quits it for Screen Recording or Full Disk Access it opens here
 * again (`resumed`, the statuses read fresh). Skip for now and Continue both end it: the pairing never depends on it.
 */
export function Prepare({
  org,
  server,
  resumed = false,
  onClose,
}: {
  org: string;
  server: string;
  resumed?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const keep = useCallback(
    () => host.setSetupState({ step: "prepare", org, server }).catch(() => {}),
    [host, org, server],
  );
  // Left without Continue or Skip (Esc back to an earlier screen): forgotten too. A quit never unmounts it.
  useEffect(() => {
    void keep();
    return () => void host.setSetupState(null).catch(() => {});
  }, [keep, host]);
  const mac = useMacGrants(keep);
  const finish = () => {
    void host.setSetupState(null).catch(() => {});
    onClose();
  };
  return (
    <Sheet
      lead={<MacPortrait state="online" />}
      title={t("desktop.prepare.title")}
      acts={
        <>
          {!(mac.grants && allDone(mac.grants)) && (
            <Button variant="ghost" onClick={finish}>
              {t("desktop.prepare.skip")}
            </Button>
          )}
          <Button variant="primary" onClick={finish}>
            {t("desktop.common.continue")}
          </Button>
        </>
      }
    >
      <p className="dk-lead">{t("desktop.prepare.lead", { org })}</p>
      <div className="dk-pair__group">
        <MacPermissionCard mac={mac} resumed={resumed} />
      </div>
    </Sheet>
  );
}

/** "Let Acme's agents use this Mac?": who may use it, open at login, what agents can do, Not now or Allow. */
export function PairOffer({ target, onClose }: { target: PairTarget; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const store = useStore();
  const [audience, setAudience] = useState<DeviceAudience>({ mode: "owner", userIds: [], roleIds: [] });
  const [picking, setPicking] = useState(false);
  const [atLogin, setAtLogin] = useState(true);
  const [tools, setTools] = useState<Partial<PairTools>>({});
  const [state, setState] = useState<"ask" | "busy" | "prepare" | "done">("ask");
  const [failed, setFailed] = useState<string | null>(null);
  const org = target.name;
  const lead = <OrgTile logo={target.logo} size="lg" />;

  const allow = async () => {
    setState("busy");
    setFailed(null);
    try {
      await pairWithSession(host, store, target, audience, tools);
      if (atLogin) await host.setAutostart(true).catch(() => {});
      setState((await needsPrepare(host).catch(() => false)) ? "prepare" : "done");
    } catch (err) {
      setFailed(errorText(t, err, i18n.language));
      setState("ask");
    }
  };

  if (state === "prepare")
    return (
      <Framed>
        <Prepare org={org} server={target.server} onClose={onClose} />
      </Framed>
    );
  if (state === "done") {
    return (
      <Framed>
        <Sheet
          lead={lead}
          title={t("desktop.pair.done", { org })}
          acts={
            <Button variant="primary" autoFocus onClick={onClose}>
              {t("desktop.common.close")}
            </Button>
          }
        />
      </Framed>
    );
  }
  const busy = state === "busy";
  return (
    <Framed>
      <Sheet
        lead={lead}
        title={t("desktop.pair.offerTitle", { org })}
        acts={
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              {t("desktop.pair.notNow")}
            </Button>
            {/* Never focused first: it opens by itself after sign-in, while the person may be typing. */}
            <Button variant="primary" loading={busy} onClick={() => void allow()}>
              {t("desktop.pair.allow")}
            </Button>
          </>
        }
      >
        <PrefCard>
          <PrefRow
            lead={
              <span className="dk-logo">
                <Icon name={AUDIENCE_ICON[audience.mode]} size={16} />
              </span>
            }
            htmlFor="pair-who"
            title={t("desktop.prefs.thisMac.who")}
            end={
              <Select
                id="pair-who"
                size="sm"
                align="end"
                value={audience.mode}
                disabled={busy}
                onValueChange={(mode) => {
                  if (mode === "people") setPicking(true);
                  else setAudience({ mode, userIds: [], roleIds: [] });
                }}
                options={(["owner", "everyone", "people"] as const).map((mode) => ({
                  value: mode,
                  label:
                    mode === "everyone"
                      ? t("desktop.prefs.thisMac.everyone", { org })
                      : t(`desktop.prefs.thisMac.${mode}`),
                  leading: <Icon name={AUDIENCE_ICON[mode]} size={16} />,
                }))}
              />
            }
          />
          <PrefRow
            lead={<Checkbox id="pair-login" checked={atLogin} disabled={busy} onCheckedChange={setAtLogin} />}
            htmlFor="pair-login"
            title={t("desktop.pair.keepReady")}
          />
        </PrefCard>
        <ToolSwitches chosen={tools} onChange={setTools} disabled={busy} />
        {failed && <Problem text={failed} />}
        {picking && (
          <PeoplePicker
            server={target.server}
            orgId={target.orgId}
            ownerUserId={null}
            value={audience.mode === "people" ? audience : { mode: "people", userIds: [], roleIds: [] }}
            saving={false}
            onCancel={() => setPicking(false)}
            onSave={(next) => {
              setAudience(next);
              setPicking(false);
            }}
          />
        )}
      </Sheet>
    </Framed>
  );
}

type LinkState =
  | { kind: "checking" }
  | { kind: "expired" }
  | { kind: "unreachable" }
  | { kind: "ask"; info: LinkInfo }
  | { kind: "waiting"; info: LinkInfo }
  | { kind: "prepare"; org: string }
  | { kind: "done"; org: string }
  | { kind: "failed"; info: LinkInfo; code: LinkFailure };

const isFailure = (code: string): code is LinkFailure =>
  ["expired", "denied", "network", "internal", "link_invalid"].includes(code);

/** "Connect this Mac to Acme?": asked by, from, this Mac; Connect waits for the link's maker. */
export function PairLinkSheet({ server, code, onClose }: { server: string; code: string; onClose: () => void }) {
  const { t } = useTranslation();
  const host = useHost();
  const store = useStore();
  const snap = useSnapshot();
  const [state, setState] = useState<LinkState>({ kind: "checking" });
  const [asked, setAsked] = useState(0);
  const [tools, setTools] = useState<Partial<PairTools>>({});
  const from = serverName(server);
  // The sheet gone (Cancel, Esc, a newer link): the runner stops asking, even if it hadn't started yet.
  const pairing = useRef<{ cancel: () => Promise<void> } | null>(null);
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      void pairing.current?.cancel();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` is Try again
  useEffect(() => {
    let live = true;
    setState({ kind: "checking" });
    host
      .pairLinkInfo(server, code)
      .then((info) => live && setState({ kind: "ask", info }))
      .catch((err: unknown) => live && setState({ kind: err === "link_expired" ? "expired" : "unreachable" }));
    return () => {
      live = false;
    };
  }, [host, server, code, asked]);

  const connect = async (info: LinkInfo) => {
    setState({ kind: "waiting", info });
    try {
      const started = await pairWithLink(store, server, code, tools);
      pairing.current = started;
      if (gone.current) return void started.cancel();
      const org = await started.done;
      pairing.current = null;
      // Agents of a computer paired here work while the app runs.
      await host.setAutostart(true).catch(() => {});
      const prepare = await needsPrepare(host).catch(() => false);
      if (!gone.current) setState({ kind: prepare ? "prepare" : "done", org });
    } catch (err) {
      pairing.current = null;
      const word = err instanceof Error ? err.message : "";
      if (gone.current || word === "canceled") return;
      setState({ kind: "failed", info, code: isFailure(word) ? word : "internal" });
    }
  };

  const close = (
    <Button variant="primary" autoFocus onClick={onClose}>
      {t("desktop.common.close")}
    </Button>
  );
  if (state.kind === "checking")
    return (
      <Sheet
        title={from}
        acts={
          <Button variant="ghost" onClick={onClose}>
            {t("desktop.common.cancel")}
          </Button>
        }
      >
        <Waiting text={t("desktop.link.checking")} />
      </Sheet>
    );
  if (state.kind === "expired")
    return (
      <Sheet title={from} acts={close}>
        <Problem text={t("desktop.pair.expired")} />
      </Sheet>
    );
  if (state.kind === "unreachable")
    return (
      <Sheet
        title={from}
        acts={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("desktop.common.cancel")}
            </Button>
            <Button variant="primary" icon="refresh" autoFocus onClick={() => setAsked((n) => n + 1)}>
              {t("desktop.common.retry")}
            </Button>
          </>
        }
      >
        <Problem text={t("desktop.prefs.thisMac.unreachable", { server: from })} />
      </Sheet>
    );
  if (state.kind === "prepare") return <Prepare org={state.org} server={server} onClose={onClose} />;
  if (state.kind === "done") return <Sheet title={t("desktop.pair.done", { org: state.org })} acts={close} />;

  const { info } = state;
  const computer = info.computer ?? snap.homes.find((h) => h.status?.machine)?.status?.machine?.name;
  const facts = (
    <PrefCard>
      <PrefRow title={t("desktop.pair.askedBy")} end={info.by} />
      <PrefRow title={t("desktop.pair.from")} end={from} />
      {computer && <PrefRow title={t("desktop.prefs.general.thisMac")} end={computer} />}
    </PrefCard>
  );
  const title = t("desktop.pair.linkTitle", { org: info.org });
  if (state.kind === "waiting")
    return (
      <Sheet
        title={title}
        acts={
          <Button variant="ghost" onClick={onClose}>
            {t("desktop.common.cancel")}
          </Button>
        }
      >
        {facts}
        <Waiting text={t("desktop.pair.waiting", { by: info.by })} />
      </Sheet>
    );
  if (state.kind === "failed") {
    const again = state.code === "network" || state.code === "internal";
    const text =
      state.code === "denied"
        ? t("desktop.pair.denied", { by: info.by })
        : state.code === "network"
          ? t("desktop.prefs.thisMac.unreachable", { server: from })
          : state.code === "internal"
            ? t("desktop.common.error")
            : t("desktop.pair.expired");
    return (
      <Sheet
        title={title}
        acts={
          again ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("desktop.pair.notNow")}
              </Button>
              <Button variant="primary" icon="refresh" autoFocus onClick={() => void connect(info)}>
                {t("desktop.common.retry")}
              </Button>
            </>
          ) : (
            close
          )
        }
      >
        {facts}
        <Problem text={text} />
      </Sheet>
    );
  }
  return (
    <Sheet
      title={title}
      acts={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("desktop.pair.notNow")}
          </Button>
          {/* Never focused first: a page can open this link while the person types elsewhere, and Enter isn't a yes. */}
          <Button variant="primary" onClick={() => void connect(info)}>
            {t("desktop.link.connect")}
          </Button>
        </>
      }
    >
      {facts}
      <p className="dk-lead">{t("desktop.pair.linkBody")}</p>
      <ToolSwitches chosen={tools} onChange={setTools} disabled={false} />
    </Sheet>
  );
}
