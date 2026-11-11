import { type ComputerDevice, type DeviceAudience, type PhoneDevice, useLookForPhones } from "@agenteschat/client";
import {
  ANDROID_SLOW_MS,
  ANDROID_TICKABLE,
  ANDROID_UDEV,
  ANDROID_USB_DRIVERS,
  type AndroidStage,
  type AndroidStep,
  androidNotShowing,
  androidStage,
  androidSteps,
  computerLine,
  DDIS_UPDATE,
  IPHONE_STEPS,
  type IphoneStep,
  iosMajor,
  iphoneNoTeam,
  iphoneOf,
  iphoneSteps,
  PHONE_APP_IN_STORE,
  phoneLine,
  reasonText,
  type StepState,
  tooOldVersion,
  useStalled,
  wifiHosts,
  wifiPairLive,
  wifiPairText,
} from "@agenteschat/client/lib/devices";
import { errorText } from "@agenteschat/client/lib/errors";
import { computerKind } from "@agenteschat/client/lib/machines";
import {
  Button,
  ComputerIcon,
  DialogBody,
  Field,
  Icon,
  Input,
  Locked,
  PixelSpinner,
  QrCode,
  Segmented,
  Select,
  SettingsPath,
  useNow,
} from "@agenteschat/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandBlock } from "@/components/machine-bits";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { FlowFooter, type FlowProps } from "./flow";
import { DevicePortrait } from "./parts";
import { useDevices, useUpdatePhone, useWifiPairing } from "./queries";
import { WhoPicker, WhoSelect } from "./WhoCanUse";

/** While a phone flow is open, the list is asked every 2 s too: the phone may show up between events. */
const PHONE_POLL_MS = 2000;

/**
 * One step of a live checklist: its mark (a tick, the live orbit, an alert, or its number), title, one line, extras.
 * `open` given: the step folds to its title when not open, and its title opens it (`onOpen`); a done step shows its
 * extras when open. Without it, a done step hides them. `live`: the current step's mark spins (the computer watches).
 */
function Step({
  state,
  title,
  text,
  children,
  live = true,
  open,
  onOpen,
}: {
  state: StepState;
  title: ReactNode;
  text?: ReactNode;
  children?: ReactNode;
  live?: boolean;
  open?: boolean;
  onOpen?: () => void;
}) {
  const shut = open === false;
  return (
    <li
      className="dv-step"
      data-state={state}
      data-shut={shut ? "" : undefined}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span className="dv-step__mark" aria-hidden="true">
        {state === "done" ? (
          <Icon name="check" size={14} />
        ) : state === "current" && live ? (
          <PixelSpinner size={14} />
        ) : state === "needs" ? (
          <Icon name="alert" size={14} />
        ) : null}
      </span>
      <div className="dv-step__head">
        {shut && onOpen ? (
          <button type="button" className="dv-step__title dv-step__open" aria-expanded="false" onClick={onOpen}>
            {title}
          </button>
        ) : (
          <p className="dv-step__title">{title}</p>
        )}
        {text && !shut && (
          <p className="dv-step__text" role={state === "current" ? "status" : undefined}>
            {text}
          </p>
        )}
      </div>
      {children && !shut && (open || state !== "done") && <div className="dv-step__more">{children}</div>}
    </li>
  );
}

/** A tiny drawing of the phone's own setting row, the row to find ringed: a tap count or its switch. */
function SettingRowDrawing({ title, sub, taps }: { title: string; sub: string; taps?: number }) {
  return (
    <div className="dv-setting" role="img" aria-label={title}>
      <span className="dv-setting__text">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      {taps ? (
        <span className="dv-setting__tap">
          <Icon name="pointer" size={14} />
          {taps}×
        </span>
      ) : (
        <span className="dv-setting__switch" data-on="" />
      )}
    </div>
  );
}

/**
 * Android's own "Allow USB debugging?" prompt, drawn in the app's language with Android's own words for it (we can
 * only draw it: nothing may tick it or tap Allow for the person).
 */
export function UsbPrompt({ wifi = false }: { wifi?: boolean }) {
  const { t } = useTranslation();
  const title = t(wifi ? "devices.android.prompt.titleWifi" : "devices.android.prompt.title");
  return (
    <div className="dv-setting dv-setting--dialog" role="img" aria-label={title}>
      <span className="dv-setting__title">{title}</span>
      <span className="dv-setting__row">
        {/* The checkbox's look, drawn: nothing here can be ticked. */}
        <span className="ac-check" data-state="checked" aria-hidden="true">
          <span className="ac-check__mark" data-state="checked">
            <svg viewBox="0 0 12 12" fill="none" className="ac-check__svg" aria-hidden="true">
              <path className="ac-check__tick" d="m2.5 6.2 2.3 2.3 4.7-5" />
            </svg>
          </span>
        </span>
        {t(wifi ? "devices.android.prompt.alwaysWifi" : "devices.android.prompt.always")}
      </span>
      <span className="dv-setting__btns">
        <span>{t("devices.android.prompt.cancel")}</span>
        <span className="dv-setting__tap">
          <Icon name="pointer" size={14} />
          {t("devices.android.prompt.allow")}
        </span>
      </span>
    </div>
  );
}

/** The phone makers' USB drivers for Windows, on their official pages. */
function DriverLinks() {
  const { t } = useTranslation();
  const links = [
    [ANDROID_USB_DRIVERS.google, t("devices.android.drivers.google")],
    [ANDROID_USB_DRIVERS.samsung, t("devices.android.drivers.samsung")],
    [ANDROID_USB_DRIVERS.others, t("devices.android.drivers.others")],
  ] as const;
  return (
    <span className="dv-links">
      {links.map(([href, label]) => (
        <a key={href} className="ac-link" href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ))}
    </span>
  );
}

/**
 * By cable. Developer options and USB debugging happen on the phone, where the computer can't see them until the
 * phone shows up: the person ticks them (Done), and may untick their own tick. One step is open at a time, a done one
 * opens again from its title. Once the computer sees the phone in any state, every step before Allow is done. After
 * 30 s on the cable step with no phone, why one may not show up, for the computer's system.
 */
function CableSteps({ host, stage }: { host: ComputerDevice; stage: AndroidStage }) {
  const { t } = useTranslation();
  const [ticked, setTicked] = useState<ReadonlySet<AndroidStep>>(() => new Set());
  // A step opened from its title stays open until the computer moves on.
  const [asked, setAsked] = useState<{ step: AndroidStep; at: AndroidStage["kind"] } | null>(null);
  const steps = androidSteps(stage, ticked, asked?.at === stage.kind ? asked.step : null);
  const waiting = stage.kind === "looking" && steps.now === "plug";
  const [since, setSince] = useState<number | null>(null);
  if (waiting !== (since !== null)) setSince(waiting ? Date.now() : null);
  const now = useNow(waiting ? 1000 : false);
  const slow = since !== null && Math.max(now, Date.now()) - since >= ANDROID_SLOW_MS;
  const linux = computerKind(host.os) === "linux";
  const tick = (step: AndroidStep, on: boolean) => {
    setTicked((had) => {
      const next = new Set(had);
      if (on) next.add(step);
      else next.delete(step);
      return next;
    });
    setAsked(null);
  };
  const fold = (step: AndroidStep) => ({
    state: steps.states[step],
    open: steps.open === step,
    onOpen: () => setAsked({ step, at: stage.kind }),
    live: !ANDROID_TICKABLE.has(step),
  });
  /** Done, or Not done yet on a tick only the person gave. */
  const mark = (step: AndroidStep) =>
    steps.states[step] !== "done" ? (
      <Button size="sm" icon="check" onClick={() => tick(step, true)}>
        {t("devices.android.done")}
      </Button>
    ) : steps.byHand.has(step) ? (
      <button type="button" className="ac-link ac-link--muted small" onClick={() => tick(step, false)}>
        {t("devices.android.notYet")}
      </button>
    ) : null;
  const plugText =
    stage.kind === "driver"
      ? t(linux ? "devices.android.noDriverLinux" : "devices.android.noDriver", { computer: host.name })
      : steps.states.plug === "done"
        ? t("devices.android.plugged", { computer: host.name })
        : t("devices.android.looking", { computer: host.name });
  return (
    <ol className="dv-steps">
      <Step {...fold("devOptions")} title={t("devices.android.devOptions")} text={t("devices.android.devOptionsText")}>
        <SettingRowDrawing
          title={t("devices.android.buildNumber")}
          sub={t("devices.android.buildNumberSub")}
          taps={7}
        />
        {mark("devOptions")}
      </Step>
      <Step
        {...fold("usbDebugging")}
        title={t("devices.android.usbDebugging")}
        text={t("devices.android.usbDebuggingText")}
      >
        <SettingRowDrawing title={t("devices.android.usbRow")} sub={t("devices.android.usbRowSub")} />
        {mark("usbDebugging")}
      </Step>
      <Step {...fold("plug")} title={t("devices.android.plug")} text={plugText}>
        {stage.kind === "driver" ? (
          linux ? (
            <a className="ac-link small" href={ANDROID_UDEV} target="_blank" rel="noopener noreferrer">
              {t("devices.android.udev")}
            </a>
          ) : (
            <DriverLinks />
          )
        ) : slow && waiting ? (
          <section className="dv-slow" aria-labelledby="dv-slow-title">
            <p className="dv-slow__title" id="dv-slow-title">
              {t("devices.android.slow")}
            </p>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none */}
            <ul className="dv-slow__list" role="list">
              {androidNotShowing(host.os).map((item) => (
                <li key={item}>
                  {t(`devices.android.help.${item}`)}
                  {item === "usbDebugging" && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="ac-link"
                        onClick={() => setAsked({ step: "usbDebugging", at: stage.kind })}
                      >
                        {t("devices.android.help.seeStep")}
                      </button>
                    </>
                  )}
                  {item === "driver" && <DriverLinks />}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </Step>
      <Step {...fold("allow")} title={t("devices.android.allow")} text={t("devices.android.allowText")}>
        <UsbPrompt />
      </Step>
    </ol>
  );
}

type WifiPair = ReturnType<typeof useWifiPairing>;

/**
 * Over Wi-Fi: Developer options, Wireless debugging (with Android's "on this network" prompt drawn), then the QR the
 * computer shows beside the steps, or the six-digit code typed here. The last step's line follows the computer:
 * waiting for the scan, found and pairing, connecting, or why it failed with Try again.
 */
function WifiSteps({ pair, computer, mac }: { pair: WifiPair; computer: string; mac: boolean }) {
  const { t } = useTranslation();
  const p = pair.pairing;
  const found = p !== undefined && (p.state === "pairing" || p.state === "connecting" || p.state === "connected");
  const failed = Boolean(pair.error) || p?.state === "failed";
  const line = pair.error
    ? errorText(t, pair.error)
    : p
      ? wifiPairText(t, p, computer, mac)
      : pair.way === "qr"
        ? t("devices.wifiPair.making")
        : undefined;
  const code = pair.way === "code";
  return (
    <ol className="dv-steps">
      <Step
        state={found ? "done" : "waiting"}
        title={t("devices.android.devOptions")}
        text={t("devices.android.devOptionsText")}
      >
        <SettingRowDrawing
          title={t("devices.android.buildNumber")}
          sub={t("devices.android.buildNumberSub")}
          taps={7}
        />
      </Step>
      <Step
        state={found ? "done" : "waiting"}
        title={t("devices.wifiPair.wireless")}
        text={t("devices.wifiPair.wirelessText")}
      >
        <UsbPrompt wifi />
      </Step>
      <Step
        state={failed ? "needs" : p && !wifiPairLive(p) ? "done" : "current"}
        title={t(code ? "devices.wifiPair.code" : "devices.wifiPair.scan")}
        text={line}
      >
        <SettingsPath
          label={t("devices.onThePhone")}
          segments={[
            t("devices.android.path.devOptions"),
            t("devices.android.path.wireless"),
            t(code ? "devices.android.path.pairCode" : "devices.wifiPair.pathQr"),
          ]}
        />
        {code ? (
          <CodeForm pair={pair} locked={pair.starting || wifiPairLive(p)} />
        ) : (
          <p className="dv-step__text dv-narrow">{t("devices.wifiPair.narrow")}</p>
        )}
        {failed && !code && (
          <span className="dv-step__acts">
            <Button size="sm" onClick={pair.retry}>
              {t("devices.wifiPair.tryAgain")}
            </Button>
          </span>
        )}
        <button type="button" className="ac-link small" onClick={() => pair.switchWay(code ? "qr" : "code")}>
          {t(code ? "devices.wifiPair.useQr" : "devices.wifiPair.useCode")}
        </button>
      </Step>
    </ol>
  );
}

/** The six digits and the address Pair device with pairing code shows, typed here; kept after a failure. */
function CodeForm({ pair, locked }: { pair: WifiPair; locked: boolean }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const ready = /^\S+:\d{1,5}$/.test(address.trim()) && /^\d{6}$/.test(code);
  return (
    <Locked when={locked}>
      <form
        className="ac-form dv-pair-code"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !locked) pair.pairWithCode({ address: address.trim(), code });
        }}
      >
        <Field label={t("devices.wifiPair.address")} id="dv-pair-address">
          <Input
            value={address}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("devices.wifiPair.addressExample")}
            maxLength={80}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Field label={t("devices.wifiPair.pairingCode")} id="dv-pair-code">
          <Input
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={!ready || locked} loading={locked}>
          {t("devices.wifiPair.pair")}
        </Button>
      </form>
    </Locked>
  );
}

/** Android's own pairing QR beside the steps, faded once the phone took it or the pairing ended. */
function WifiCard({ pair }: { pair: WifiPair }) {
  const { t } = useTranslation();
  const p = pair.pairing;
  const qr = p?.qr;
  return (
    <div className={(p && p.state !== "waiting") || pair.error ? "dv-qr dv-qr--used" : "dv-qr"}>
      <span className="dv-qr__code">
        {qr ? (
          <QrCode text={qr} label={t("devices.wifiPair.qrLabel")} />
        ) : (
          <span className="dv-qr__wait">
            {pair.error ? <Icon name="alert" size={20} /> : <PixelSpinner size={24} />}
          </span>
        )}
      </span>
      <span className="dv-qr__text">
        <p className="dv-qr__line">{t("devices.wifiPair.qrLine")}</p>
        <p className="dv-qr__caption">{t("devices.wifiPair.qrCaption")}</p>
      </span>
    </div>
  );
}

/** A computer to plug into: its line icon, name and whether it's online, online ones first. */
function HostSelect({
  hosts,
  value,
  onChange,
  id,
}: {
  hosts: ComputerDevice[];
  value: string;
  onChange: (id: string) => void;
  id: string;
}) {
  const { t } = useTranslation();
  return (
    <Select
      id={id}
      value={value}
      onValueChange={onChange}
      options={hosts.map((h) => ({
        value: h.id,
        label: t(h.status.kind === "offline" ? "devices.host.offline" : "devices.host.online", { name: h.name }),
        leading: <ComputerIcon kind={computerKind(h.os)} size={16} />,
        description: computerLine(t, h),
      }))}
    />
  );
}

const onlineFirst = (a: ComputerDevice, b: ComputerDevice) =>
  Number(a.status.kind === "offline") - Number(b.status.kind === "offline");

/** The computer a phone flow starts on: the one asked for, else the viewer's own online one, else any online one. */
function pickHost(hosts: ComputerDevice[], wanted: string | null, me: string) {
  return (
    hosts.find((h) => h.id === wanted) ??
    hosts.find((h) => h.ownerUserId === me && h.status.kind !== "offline") ??
    hosts.find((h) => h.status.kind !== "offline") ??
    hosts[0]
  );
}

/** No computer to plug a phone into yet: say so, and offer to connect one. */
function NeedsComputer({ text, onConnect }: { text: string; onConnect: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="setup-progress setup-progress--line ac-iconline" role="status">
      <Icon name="info" size={14} />
      <span>
        {text}{" "}
        <button type="button" className="ac-link" onClick={onConnect}>
          {t("devices.connectComputer")}
        </button>
      </span>
    </p>
  );
}

/**
 * An Android phone through a computer people connected: pick the computer, then a checklist the computer drives (it
 * sees the phone ask to allow USB debugging, then ready). Once our phone app is in the store, a QR beside it opens the
 * same steps there, where buttons open each setting. Over Wi-Fi: the computer shows Android's pairing QR (or takes the
 * six-digit code), then finds, pairs and connects the phone by itself.
 */
export function AndroidFlow({
  onClose,
  onBack,
  setTitle,
  hostId,
  onConnectComputer,
}: FlowProps & { hostId: string | null; onConnectComputer: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const devices = useDevices(org.id, PHONE_POLL_MS);
  const all = (devices.data?.devices ?? []).filter((d) => d.machineKind !== "managed").sort(onlineFirst);
  const [picked, setPicked] = useState<string | null>(hostId);
  const [way, setWay] = useState<"cable" | "wifi">("cable");
  // Pairing puts the phone on the computer's own adb: only computers the person may manage.
  const hosts = way === "wifi" ? wifiHosts(all) : all;
  const host = pickHost(hosts, picked, me.user.id);
  const wifi = useWifiPairing(org.id, host?.id ?? null, way === "wifi" && host?.status.kind !== "offline");
  const pairedId = wifi.pairing?.phoneId;
  const paired = pairedId ? host?.phones.find((p) => p.id === pairedId) : undefined;
  // The phones each computer had when the dialog opened: only a new one (or one still asking) is the one being plugged.
  const known = useRef<Set<string> | null>(null);
  if (!known.current && devices.data)
    known.current = new Set(devices.data.devices.flatMap((d) => d.phones.map((p) => p.id)));
  const stage = androidStage(host, known.current ?? new Set());
  useLookForPhones(
    org.id,
    host?.id ?? null,
    way === "cable" && host?.status.kind !== "offline" && stage.kind !== "ready",
  );
  const readyName = paired?.name ?? (stage.kind === "ready" ? stage.phone.name : null);
  useEffect(
    () => setTitle(readyName ? t("devices.android.connectedTitle", { name: readyName }) : t("devices.android.title")),
    [readyName, setTitle, t],
  );
  if (paired && host) return <PhoneConnected phone={paired} host={host} onClose={onClose} />;
  if (stage.kind === "ready" && host) return <PhoneConnected phone={stage.phone} host={host} onClose={onClose} />;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const guide =
    host && PHONE_APP_IN_STORE.android
      ? `${origin}/org/${org.id}/settings/devices/android-setup?computer=${encodeURIComponent(host.id)}`
      : "";
  const steps =
    way === "cable"
      ? host && <CableSteps key={host.id} host={host} stage={stage} />
      : host && <WifiSteps pair={wifi} computer={host.name} mac={computerKind(host.os) === "mac"} />;
  return (
    <>
      <DialogBody className="dv-android">
        {hosts.length === 0 && way === "cable" ? (
          <NeedsComputer text={t("devices.android.noComputer")} onConnect={onConnectComputer} />
        ) : (
          // The computer and the way span the body on every tab, so switching ways never moves them; a QR sits
          // beside the steps alone.
          <div className="stack-4" style={{ gap: "var(--space-4)" }}>
            {host && (
              <Field
                label={t(way === "cable" ? "devices.android.plugInto" : "devices.android.pairWith")}
                id="dv-android-host"
              >
                <HostSelect hosts={hosts} value={host.id} onChange={setPicked} id="dv-android-host" />
              </Field>
            )}
            <Segmented
              block
              label={t("devices.android.way")}
              value={way}
              onValueChange={setWay}
              options={[
                {
                  value: "cable",
                  label: (
                    <>
                      {t("devices.android.cable")}
                      <span className="dv-seg__note">{t("devices.android.recommended")}</span>
                    </>
                  ),
                },
                { value: "wifi", label: t("devices.android.wifi") },
              ]}
            />
            {!host ? (
              <NeedsComputer text={t("devices.wifiPair.noComputer")} onConnect={onConnectComputer} />
            ) : host.status.kind === "offline" ? (
              <p className="setup-progress setup-progress--line ac-iconline" role="status">
                <Icon name="dash" size={14} />
                <span>{t("devices.android.hostOffline", { computer: host.name })}</span>
              </p>
            ) : (
              <div className="dv-split">
                {steps}
                {way === "wifi" && wifi.way === "qr" ? (
                  <WifiCard pair={wifi} />
                ) : guide ? (
                  <div className="dv-qr">
                    <span className="dv-qr__code">
                      <QrCode text={guide} label={t("devices.android.qrLabel")} />
                    </span>
                    <span className="dv-qr__text">
                      <p className="dv-qr__line">{t("devices.android.qrLine")}</p>
                      <p className="dv-qr__caption">{t("devices.android.qrCaption")}</p>
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </DialogBody>
      <FlowFooter
        onClose={onClose}
        onBack={onBack}
        note={
          way === "wifi" ? (
            <span className="ac-iconline small muted">
              <Icon name="info" size={14} />
              <span>{t("devices.android.wifiNote")}</span>
            </span>
          ) : undefined
        }
      />
    </>
  );
}

/** The phone showed up ready: its portrait and facts, its name and who can use it, saved on Done. */
function PhoneConnected({ phone, host, onClose }: { phone: PhoneDevice; host: ComputerDevice; onClose: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const update = useUpdatePhone(org.id);
  const [name, setName] = useState(phone.name);
  const [audience, setAudience] = useState<DeviceAudience>(
    () => phone.audience ?? { mode: "owner", userIds: [], roleIds: [] },
  );
  const follows = phone.audience === null;
  const done = () => {
    const clean = name.trim();
    const input = {
      ...(clean && clean !== phone.name ? { name: clean } : {}),
      ...(!follows ? { audience } : {}),
    };
    if (Object.keys(input).length === 0) return onClose();
    update.mutate(
      { id: phone.id, ...input },
      { onSuccess: onClose, onError: (err) => toast.show(errorText(t, err), "error") },
    );
  };
  return (
    <>
      <Locked when={update.isPending}>
        <DialogBody>
          <div className="ac-faceline" role="status">
            <DevicePortrait device={phone} />
            <span className="dv-connected__text">
              <span className="dv-connected__name ac-captop">{phone.name}</span>
              <span className="dv-connected__facts">{phoneLine(t, phone, host.name)}</span>
            </span>
          </div>
          <Field label={t("devices.name")} id="dv-phone-name" example={t("devices.nameHelp")}>
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!follows && (
            <>
              <Field
                label={t("devices.who.title")}
                id="dv-phone-who"
                example={t("devices.who.phoneHint", { host: host.name })}
              >
                <WhoSelect value={audience} onChange={setAudience} />
              </Field>
              <WhoPicker value={audience} onChange={setAudience} ownerUserId={me.user.id} idPrefix="dv-phone" />
            </>
          )}
        </DialogBody>
      </Locked>
      <FlowFooter onClose={onClose}>
        <Button variant="primary" onClick={done} loading={update.isPending} disabled={update.isPending}>
          {t("devices.done")}
        </Button>
      </FlowFooter>
    </>
  );
}

const APP_STORE_XCODE = "https://apps.apple.com/app/xcode/id497799835";

/**
 * An iPhone through a Mac: pick the Mac, then the checklist mirrored from what the Mac reports. Steps on the iPhone
 * show their Settings path: no app or page can open those screens.
 */
export function IphoneFlow({
  onClose,
  onBack,
  setTitle,
  hostId,
  onConnectComputer,
}: FlowProps & { hostId: string | null; onConnectComputer: () => void }) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const devices = useDevices(org.id, PHONE_POLL_MS);
  const macs = (devices.data?.devices ?? [])
    .filter((d) => d.machineKind !== "managed" && computerKind(d.os) === "mac")
    .sort(onlineFirst);
  const [picked, setPicked] = useState<string | null>(hostId);
  const mac = pickHost(macs, picked, me.user.id);
  const phone = iphoneOf(mac);
  const states = iphoneSteps(mac, phone);
  const ready = IPHONE_STEPS.every((s) => states[s] === "done");
  const reason = phone && "reason" in phone.status ? phone.status.reason : null;
  const tooOld = phone?.status.kind === "unsupported";
  const at = IPHONE_STEPS.find((s) => states[s] === "current" || states[s] === "needs") ?? null;
  // The Mac reports by itself; a step that sits unchanged gets what most likely holds it. Nothing to add for an iPhone
  // below iOS 17, nor where the step's own text already says what to do (a helper the person must act on, no team).
  const stalled = useStalled(
    at &&
      mac &&
      !tooOld &&
      !(at === "helper" && states.helper === "needs") &&
      !(at === "account" && iphoneNoTeam(mac, phone))
      ? [mac.id, at, phone?.id, reason].join(":")
      : null,
  );
  const [plugged, setPlugged] = useState(false);
  const looking = at === "connected" && !phone;
  useEffect(() => setTitle(t("devices.iphone.title")), [setTitle, t]);
  const macName = mac?.name ?? "";
  const sdk = mac?.toolchains.xcodeSdk;
  const text: Record<IphoneStep, ReactNode> = {
    xcode:
      states.xcode === "done"
        ? t("devices.iphone.xcodeDone", { version: mac?.toolchains.xcode ?? "" })
        : reason === "xcode_too_old"
          ? phone?.osVersion
            ? t(sdk ? "devices.iphone.xcodeOld" : "devices.iphone.xcodeOldAny", {
                name: phone.name,
                version: phone.osVersion,
                major: iosMajor(phone.osVersion),
                sdk,
                mac: macName,
              })
            : reasonText(t, reason)
          : t("devices.iphone.xcodeText", { mac: macName }),
    tools: states.tools === "done" ? t("devices.iphone.toolsDone") : t("devices.iphone.toolsText"),
    account:
      states.account === "done"
        ? (mac?.toolchains.appleTeam ?? t("devices.iphone.accountDone"))
        : iphoneNoTeam(mac, phone)
          ? t("devices.iphone.teamMissingText")
          : t("devices.iphone.accountText", { mac: macName }),
    connected:
      tooOld && phone
        ? t("devices.iphone.tooOld", { name: phone.name, version: tooOldVersion(t, phone.osVersion) })
        : states.connected === "done" && phone
          ? t("devices.iphone.connectedDone", { name: phone.name, version: phone.osVersion })
          : t("devices.iphone.connectedText", { mac: macName }),
    trust: states.trust === "done" ? t("devices.iphone.trustDone") : t("devices.iphone.trustText"),
    developerMode: states.developerMode === "done" ? t("devices.iphone.devModeDone") : t("devices.iphone.devModeText"),
    uiAutomation:
      reason === "ui_not_authorized" ? t("devices.iphone.uiRefusedText") : t("devices.iphone.uiAutomationText"),
    helper:
      reason === "helper_untrusted"
        ? t("devices.iphone.helperUntrustedText")
        : reason === "team_limit"
          ? t("devices.iphone.teamLimitText")
          : t("devices.iphone.helperText"),
  };
  const more: Partial<Record<IphoneStep, ReactNode>> = {
    xcode: (
      <>
        <span className="dv-step__acts">
          <Button asChild size="sm" icon="external">
            <a href={APP_STORE_XCODE} target="_blank" rel="noopener noreferrer">
              {t("devices.iphone.getXcode")}
            </a>
          </Button>
        </span>
        {reason === "xcode_too_old" && phone?.osVersion && <CommandBlock command={DDIS_UPDATE} />}
      </>
    ),
    ...(looking && !plugged && !stalled
      ? {
          connected: (
            <span className="dv-step__acts">
              <Button size="sm" onClick={() => setPlugged(true)}>
                {t("devices.iphone.pluggedIn")}
              </Button>
            </span>
          ),
        }
      : {}),
    developerMode: (
      <SettingsPath
        label={t("devices.onTheIphone")}
        segments={[
          t("devices.iphone.path.settings"),
          t("devices.iphone.path.privacy"),
          t("devices.iphone.path.devMode"),
        ]}
      />
    ),
    uiAutomation: (
      <SettingsPath
        label={t("devices.onTheIphone")}
        segments={[
          t("devices.iphone.path.settings"),
          t("devices.iphone.path.developer"),
          t("devices.iphone.path.uiAutomation"),
        ]}
      />
    ),
    ...(reason === "helper_untrusted"
      ? {
          helper: (
            <SettingsPath
              label={t("devices.onTheIphone")}
              segments={[
                t("devices.iphone.path.settings"),
                t("devices.iphone.path.general"),
                t("devices.iphone.path.deviceManagement"),
              ]}
            />
          ),
        }
      : {}),
  };
  const note = (
    <span className="ac-iconline small muted">
      <Icon name="info" size={14} />
      <span>{t("devices.iphone.noMacNote")}</span>
    </span>
  );
  return (
    <>
      <DialogBody>
        <p className="small muted">{t("devices.iphone.lead")}</p>
        {macs.length === 0 ? (
          <NeedsComputer text={t("devices.iphone.noMac")} onConnect={onConnectComputer} />
        ) : (
          <>
            <Field label={t("devices.iphone.mac")} id="dv-iphone-mac">
              <HostSelect hosts={macs} value={mac?.id ?? ""} onChange={setPicked} id="dv-iphone-mac" />
            </Field>
            {mac?.status.kind === "offline" ? (
              <p className="setup-progress setup-progress--line ac-iconline" role="status">
                <Icon name="dash" size={14} />
                <span>{t("devices.android.hostOffline", { computer: mac.name })}</span>
              </p>
            ) : (
              <ol className="dv-steps">
                {IPHONE_STEPS.map((s) => (
                  <Step key={s} state={states[s]} title={t(`devices.iphone.steps.${s}`)} text={text[s]}>
                    {s === at && (more[s] || stalled || (looking && plugged)) ? (
                      <>
                        {more[s]}
                        {(stalled || (looking && plugged)) && (
                          <p className="dv-step__stall ac-iconline small" role="status">
                            <Icon name="info" size={14} />
                            <span>{t(`devices.iphone.stall.${s}`, { mac: macName })}</span>
                          </p>
                        )}
                      </>
                    ) : null}
                  </Step>
                ))}
              </ol>
            )}
            {ready && phone && (
              <p className="setup-progress setup-progress--line ac-iconline" role="status">
                <Icon name="check" size={14} />
                <span>{t("devices.iphone.ready", { name: phone.name })}</span>
              </p>
            )}
          </>
        )}
      </DialogBody>
      <FlowFooter onClose={onClose} onBack={onBack} note={note}>
        {ready ? (
          <Button variant="primary" onClick={onClose}>
            {t("devices.done")}
          </Button>
        ) : undefined}
      </FlowFooter>
    </>
  );
}
