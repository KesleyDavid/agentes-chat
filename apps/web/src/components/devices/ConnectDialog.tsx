import { type DeviceJoinRequest, useMe } from "@agenteschat/client";
import { joinFacts, linkPhase, newComputerOf } from "@agenteschat/client/lib/devices";
import { computerKind, isHandheld, platformOf } from "@agenteschat/client/lib/machines";
import { can } from "@agenteschat/client/lib/permissions";
import { appPairsWith, pairLink } from "@agenteschat/client/lib/server";
import {
  Button,
  ComputerPortrait,
  Dialog,
  DialogBody,
  DialogFooter,
  GroupHeading,
  Icon,
  InfoHint,
  PixelSpinner,
  ProviderLogo,
  Segmented,
  useNow,
} from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpLink } from "@/components/HelpLink";
import { DownloadWithGuide } from "@/components/install/guide";
import { CommandBlock } from "@/components/machine-bits";
import { useOrg } from "@/components/org-context";
import { ThisMacButton, useAgentsHere } from "@/components/ThisMac";
import { inDesktopApp } from "@/lib/desktop";
import { AndroidFlow, IphoneFlow } from "./ConnectPhone";
import { JoinRequestForm } from "./dialogs";
import { FlowFooter, type FlowProps } from "./flow";
import { StatusPill } from "./parts";
import { useConnectLink, useDevices, useLinkState } from "./queries";

export type ConnectStep = "choose" | "this" | "server" | "computer" | "link" | "android" | "iphone";
/** Which flow the dialog opens on, and the computer a phone flow starts with. */
export interface ConnectStart {
  step: ConnectStep;
  hostId?: string | null;
}

const WIDTH: Record<ConnectStep, number> = {
  choose: 560,
  this: 560,
  server: 560,
  computer: 560,
  link: 560,
  android: 720,
  iphone: 720,
};

/**
 * "Connect a device": a chooser (this computer, another computer, a server, an Android phone, an iPhone), then each
 * flow in place. Back goes to the chooser when the dialog started there; the × and Cancel always close it.
 */
export function ConnectDialog({ start, onClose }: { start: ConnectStart | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<ConnectStep>(start?.step ?? "choose");
  const [title, setTitle] = useState<ReactNode>(null);
  // Another computer whose system has no app build: its one line, on that system's tab.
  const [lineShell, setLineShell] = useState<"unix" | "windows" | undefined>(undefined);
  useEffect(() => {
    if (start) setStep(start.step);
  }, [start]);
  const fromChooser = start?.step === "choose";
  const back = fromChooser ? () => setStep("choose") : undefined;
  const flowProps = { onClose, onBack: back, setTitle };
  const toLine = (shell?: "unix" | "windows") => {
    setLineShell(shell);
    setStep("link");
  };
  return (
    <Dialog
      open={start !== null}
      onOpenChange={(o) => !o && onClose()}
      title={step === "choose" ? t("devices.connect") : (title ?? t("devices.connect"))}
      leading={step === "choose" ? undefined : <FlowMark step={step} />}
      closeLabel={t("common.close")}
      width={WIDTH[step]}
    >
      {start !== null &&
        (step === "choose" ? (
          <Chooser onPick={setStep} onClose={onClose} />
        ) : step === "this" ? (
          <LinkFlow
            key={step}
            kind="computer"
            viaApp
            onLine={toLine}
            onServer={() => setStep("server")}
            {...flowProps}
          />
        ) : step === "server" || step === "link" ? (
          // Its own instance per step: a line's system tab starts from where it came from.
          <LinkFlow key={step} kind={step === "server" ? "server" : "computer"} shell={lineShell} {...flowProps} />
        ) : step === "computer" ? (
          <ComputerFlow {...flowProps} onLine={toLine} />
        ) : step === "android" ? (
          <AndroidFlow {...flowProps} hostId={start.hostId ?? null} onConnectComputer={() => setStep("choose")} />
        ) : (
          <IphoneFlow {...flowProps} hostId={start.hostId ?? null} onConnectComputer={() => setStep("choose")} />
        ))}
    </Dialog>
  );
}

const systemMark = (platform: ReturnType<typeof platformOf>) => (platform === "mac" ? "apple" : platform);

function FlowMark({ step }: { step: ConnectStep }) {
  if (step === "this")
    return <ProviderLogo id={systemMark(platformOf(navigator.userAgent))} size="sm" className="dv-tile" />;
  if (step === "computer" || step === "link")
    return (
      <span className="ac-brand ac-brand--sm ac-brand--mono" aria-hidden="true">
        <Icon name="computer" size={16} />
      </span>
    );
  const id = step === "android" ? "android" : step === "iphone" ? "apple" : "linux";
  // A server's flow shows Tux; another computer's, our own computer icon.
  return <ProviderLogo id={id} size="sm" className="dv-tile" />;
}

const thisLabel = (platform: ReturnType<typeof platformOf>) =>
  platform === "mac"
    ? "devices.choose.thisMac"
    : platform === "windows"
      ? "devices.choose.thisPc"
      : "devices.choose.thisComputer";

function Chooser({ onPick, onClose }: { onPick: (step: ConnectStep) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const platform = platformOf(navigator.userAgent);
  const agentsHere = useAgentsHere();
  const option = (step: ConnectStep, mark: ReactNode, title: string, line: ReactNode) => (
    <button type="button" className="dv-option" onClick={() => onPick(step)}>
      {mark}
      <span className="dv-option__text">
        <span className="dv-option__title ac-captop">{title}</span>
        <span className="dv-option__line">{line}</span>
      </span>
      <Icon name="chevronRight" size={16} className="dv-option__arrow" />
    </button>
  );
  const thisMark = <ProviderLogo id={systemMark(platform)} size="sm" className="dv-tile" />;
  // Inside the desktop app that may host agents, one click (below). In a browser, the app on this computer through
  // a link, where the app takes one; a phone's browser has no computer to connect. Elsewhere (an app that runs this
  // server, plain http, a server on this computer) only the one line.
  const thisStep: ConnectStep | null = inDesktopApp()
    ? "link"
    : isHandheld(navigator.userAgent)
      ? null
      : appPairsWith(window.location.origin)
        ? "this"
        : "link";
  return (
    <>
      <DialogBody>
        <section aria-labelledby="dv-ch-computers">
          <GroupHeading level={3} id="dv-ch-computers" title={t("devices.choose.computers")} />
          <div className="dv-options">
            {inDesktopApp() && agentsHere ? (
              <div className="dv-option dv-wide">
                {thisMark}
                <span className="dv-option__text">
                  <span className="dv-option__title ac-captop">{t(thisLabel(platform))}</span>
                  <span className="dv-option__line">{t("devices.choose.thisLine")}</span>
                </span>
                <span className="dv-option__acts">
                  <ThisMacButton orgId={org.id} canPair={can(org, "pair_computers")} />
                </span>
              </div>
            ) : (
              thisStep &&
              option(
                thisStep,
                thisMark,
                t(thisLabel(platform)),
                t(thisStep === "this" ? "devices.choose.thisLine" : "devices.choose.serverLine"),
              )
            )}
            {option(
              "computer",
              <span className="ac-brand ac-brand--sm ac-brand--mono" aria-hidden="true">
                <Icon name="computer" size={16} />
              </span>,
              t("devices.choose.other"),
              <>
                <span className="dv-option__logos" aria-hidden="true">
                  <ProviderLogo id="apple" size="xs" />
                  <ProviderLogo id="windows" size="xs" />
                  <ProviderLogo id="linux" size="xs" />
                </span>
                {t("devices.choose.otherLine")}
              </>,
            )}
            {option(
              "server",
              <ProviderLogo id="linux" size="sm" className="dv-tile" />,
              t("devices.choose.server"),
              t("devices.choose.serverLine"),
            )}
          </div>
        </section>
        <section aria-labelledby="dv-ch-phones">
          <GroupHeading level={3} id="dv-ch-phones" title={t("devices.choose.phones")} />
          <div className="dv-options">
            {option(
              "android",
              <ProviderLogo id="android" size="sm" className="dv-tile" />,
              t("devices.choose.android"),
              t("devices.choose.androidLine"),
            )}
            {option(
              "iphone",
              <ProviderLogo id="apple" size="sm" className="dv-tile" />,
              t("devices.choose.iphone"),
              t("devices.choose.iphoneLine"),
            )}
          </div>
        </section>
      </DialogBody>
      <DialogFooter note={<HelpLink slug="computers">{t("devices.how")}</HelpLink>}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </DialogFooter>
    </>
  );
}

/**
 * Another computer: the desktop app on it, signed in as the person, asks before it connects, and the computer shows
 * up here as theirs by itself (the devices list, refreshed by the computer events). Or one line for its terminal.
 */
function ComputerFlow({
  onClose,
  onBack,
  setTitle,
  onLine,
}: FlowProps & { onLine: (shell?: "unix" | "windows") => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const myId = useMe().data?.user.id;
  const devices = useDevices(org.id);
  const known = useRef<Set<string> | null>(null);
  // From a list read now, not the cache: a computer that joined while nothing watched isn't the new one.
  if (!known.current && devices.data && !devices.isFetching)
    known.current = new Set(devices.data.devices.map((d) => d.id));
  const found = known.current ? newComputerOf(devices.data?.devices, known.current, myId) : undefined;
  useEffect(() => setTitle(t("devices.computer.title")), [setTitle, t]);
  return (
    <>
      <DialogBody>
        <ol className="machine-pair__steps apps-steps small">
          <li>
            <span className="apps-step">
              <span>{t("devices.computer.step1")}</span>
              <DownloadWithGuide primary onLine={onLine} />
            </span>
          </li>
          <li>
            <span className="apps-step">
              <span>{t("devices.computer.step2")}</span>
            </span>
          </li>
          <li>
            <span className="apps-step">
              <span>{t("devices.computer.step3", { org: org.name })}</span>
            </span>
          </li>
        </ol>
        <p className="small muted">{t("devices.computer.shows")}</p>
        {found ? (
          <p className="setup-progress setup-progress--line ac-iconline" role="status">
            <Icon name="check" size={14} />
            <span>
              {t("devices.computer.connected", { name: found.name })}{" "}
              <Link
                to="/org/$orgId/settings/devices/$deviceId"
                params={{ orgId: org.id, deviceId: found.id }}
                className="ac-link"
                onClick={onClose}
              >
                {t("devices.link.openPage")}
              </Link>
            </span>
          </p>
        ) : (
          <p className="setup-progress setup-progress--line ac-iconline" role="status">
            <PixelSpinner size={14} />
            <span>{t("devices.computer.waiting")}</span>
          </p>
        )}
      </DialogBody>
      <FlowFooter
        onClose={onClose}
        onBack={onBack}
        note={
          <button type="button" className="ac-link ac-link--muted" onClick={() => onLine()}>
            {t("devices.computer.noApp")}
          </button>
        }
      >
        {found ? (
          <Button variant="primary" onClick={onClose}>
            {t("devices.done")}
          </Button>
        ) : undefined}
      </FlowFooter>
    </>
  );
}

/**
 * A connect link, which works once for 10 minutes: one line to paste in a computer's terminal, or (`viaApp`, this
 * computer from a browser) the desktop app here opening it, which asks the person first. Either way the computer only
 * asks to join: it shows up here, live, with its name and address, for Let it join or Deny, then as connected.
 */
function LinkFlow({
  kind,
  shell,
  viaApp = false,
  onLine,
  onServer,
  onClose,
  onBack,
  setTitle,
}: FlowProps & {
  kind: "server" | "computer";
  shell?: "unix" | "windows";
  viaApp?: boolean;
  onLine?: (shell?: "unix" | "windows") => void;
  onServer?: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const link = useConnectLink(org.id, kind, true);
  const state = useLinkState(org.id, link.data);
  const now = useNow(link.data ? 1000 : false);
  const [tab, setTab] = useState<"unix" | "windows">(
    () => shell ?? (platformOf(navigator.userAgent) === "windows" ? "windows" : "unix"),
  );
  const [joined, setJoined] = useState<{ machineId: string; name: string; request: DeviceJoinRequest } | null>(null);
  const phase = joined ? "joined" : link.data ? linkPhase(state.data, link.data.expiresAt, now) : "waiting";
  const request = state.data?.request;
  useEffect(() => {
    if (joined) setTitle(t("devices.link.joinedTitle", { name: joined.name }));
    else if (phase === "asking" && request) setTitle(t("devices.request.title", { name: request.name, org: org.name }));
    else if (viaApp) setTitle(t(thisLabel(platformOf(navigator.userAgent))));
    else setTitle(t(kind === "server" ? "devices.link.serverTitle" : "devices.link.computerTitle"));
  }, [joined, phase, request, kind, viaApp, org.name, setTitle, t]);

  if (joined) return <Joined joined={joined} onClose={onClose} />;
  if (phase === "asking" && request)
    return (
      <JoinRequestForm
        request={request}
        kind={kind}
        onJoined={(machineId, name) => setJoined({ machineId, name, request })}
        onDenied={() => void link.refetch()}
      />
    );
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <>
      <DialogBody>
        {link.isError ? (
          <p className="setup-progress setup-progress--line ac-iconline" role="alert">
            <Icon name="alert" size={14} />
            <span>{t(viaApp ? "devices.thisApp.failed" : "devices.link.failed")}</span>
          </p>
        ) : viaApp ? (
          <OpenInApp
            href={link.data && phase === "waiting" ? pairLink(origin, link.data.code) : null}
            making={!link.data}
            onLine={onLine}
          />
        ) : (
          <ol className="machine-pair__steps apps-steps small">
            <li>
              <span className="apps-step">
                <span>{t(kind === "server" ? "devices.link.step1Server" : "devices.link.step1Computer")}</span>
                <Segmented
                  block
                  label={t("devices.link.system")}
                  value={tab}
                  onValueChange={setTab}
                  options={[
                    { value: "unix", label: t("devices.link.unix") },
                    { value: "windows", label: t("devices.link.windows") },
                  ]}
                />
                <span className="ac-field">
                  {link.data ? (
                    <CommandBlock
                      labelled
                      command={tab === "windows" ? link.data.commands.windows : link.data.commands.unix}
                    />
                  ) : (
                    <span className="machine-command dv-cmd" aria-busy="true">
                      <PixelSpinner size={14} label={t("devices.link.making")} />
                    </span>
                  )}
                  <span className="ac-field__example">
                    <span className="ac-hintline">
                      <span>{t("devices.link.once")}</span>
                      <InfoHint name={t("common.about", { label: t("devices.link.once") })}>
                        {t("devices.link.onceHint")}
                      </InfoHint>
                    </span>
                  </span>
                </span>
              </span>
            </li>
            <li>
              <span className="apps-step">
                <span>{t("devices.link.step2")}</span>
              </span>
            </li>
            <li>
              <span className="apps-step">
                <span>{t("devices.link.step3")}</span>
              </span>
            </li>
          </ol>
        )}
        {link.data && phase === "waiting" && (
          <p className="setup-progress setup-progress--line ac-iconline" role="status">
            <PixelSpinner size={14} />
            <span>
              {t(
                viaApp
                  ? "devices.thisApp.waiting"
                  : kind === "server"
                    ? "devices.link.waitingServer"
                    : "devices.link.waitingComputer",
              )}
            </span>
          </p>
        )}
        {(phase === "expired" || phase === "denied") && (
          <p className="setup-progress setup-progress--line ac-iconline" role="status">
            <Icon name="clock" size={14} />
            <span>
              {t(
                phase === "denied"
                  ? "devices.link.denied"
                  : viaApp
                    ? "devices.thisApp.expired"
                    : "devices.link.expired",
              )}{" "}
              <button type="button" className="ac-link" onClick={() => void link.refetch()}>
                {t(viaApp ? "devices.thisApp.again" : "devices.link.again")}
              </button>
            </span>
          </p>
        )}
      </DialogBody>
      <FlowFooter
        onClose={onClose}
        onBack={onBack}
        note={
          viaApp ? (
            <button type="button" className="ac-link ac-link--muted" onClick={onServer}>
              {t("devices.thisApp.server")}
            </button>
          ) : link.data ? (
            <a
              className="ac-link ac-link--muted"
              href={`${origin}/i/${link.data.code}${tab === "windows" ? "/ps" : ""}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("devices.link.readScript")}
            </a>
          ) : undefined
        }
      />
    </>
  );
}

/**
 * "Open the agentes.chat app": the link to the app on this computer (`href`; null while the link is made, or once it
 * ended), offered for as long as the dialog waits, since the person may install the app first. The browser asks
 * before it opens an app, so the words say what to choose.
 */
function OpenInApp({
  href,
  making,
  onLine,
}: {
  href: string | null;
  making: boolean;
  onLine?: (shell?: "unix" | "windows") => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="dv-app">
        <p>{t("devices.thisApp.text")}</p>
        {href ? (
          <Button asChild size="lg" variant="primary" block>
            <a href={href}>{t("devices.thisApp.open")}</a>
          </Button>
        ) : (
          <Button size="lg" variant="primary" block loading={making} disabled>
            {t("devices.thisApp.open")}
          </Button>
        )}
        <p className="small muted">{t("devices.thisApp.browserAsks")}</p>
      </div>
      <section className="dv-app dv-app--get" aria-labelledby="dv-app-get">
        <GroupHeading level={3} id="dv-app-get" title={t("devices.thisApp.noApp")} />
        <DownloadWithGuide onLine={onLine} />
        <p className="small muted">{t("devices.thisApp.afterInstall")}</p>
        <p className="small muted">
          <button type="button" className="ac-link" onClick={() => onLine?.()}>
            {t("devices.computer.orLine")}
          </button>
        </p>
      </section>
    </>
  );
}

/** The computer joined: its portrait, name and state, what it is, and Done. */
function Joined({
  joined,
  onClose,
}: {
  joined: { machineId: string; name: string; request: DeviceJoinRequest };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const devices = useDevices(org.id);
  const device = devices.data?.devices.find((d) => d.id === joined.machineId);
  return (
    <>
      <DialogBody>
        <div className="ac-faceline" role="status">
          <span className="dv-pic">
            <ComputerPortrait kind={computerKind(joined.request.os)} state="online" />
          </span>
          <span className="dv-connected__text">
            <span className="dv-connected__name ac-captop">
              {joined.name}
              {/* Just joined and not running yet: its service is starting, not a computer gone away. */}
              {device && (
                <StatusPill
                  status={device.status.kind === "offline" ? { kind: "preparing", reason: "starting" } : device.status}
                />
              )}
            </span>
            <span className="dv-connected__facts">{joinFacts(t, joined.request)}</span>
          </span>
        </div>
        <p className="small muted">
          <Link
            to="/org/$orgId/settings/devices/$deviceId"
            params={{ orgId: org.id, deviceId: joined.machineId }}
            className="ac-link"
            onClick={onClose}
          >
            {t("devices.link.openPage")}
          </Link>
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>
          {t("devices.done")}
        </Button>
      </DialogFooter>
    </>
  );
}
