import type { ComputerDevice, PhoneDevice } from "@agenteschat/client";
import { computerName } from "@agenteschat/client/lib/computer";
import { iosMajor, tooOldVersion, useStalled } from "@agenteschat/client/lib/devices";
import { isPersonal } from "@agenteschat/client/lib/workspace-mode";
import * as Device from "expo-device";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Button, GroupedFooter, GroupedList, GroupedRow, Icon, InkOrbit, Text, useTheme } from "@/ui";
import { router } from "@/ui/navigation";
import { Note, Step, StepsCard, StepText } from "../ai/parts";
import { Gap, SettingsPage } from "../settings/parts";
import { useMeId } from "../shared/hooks";
import { pickOne } from "../shared/PickerSheet";
import { goBack } from "../shared/parts";
import {
  IPHONE_STEP_REASONS,
  IPHONE_STEPS,
  iphoneStep,
  phoneFacts,
  phoneHosts,
  reasonText,
  thisPhoneOn,
} from "./logic";
import { ConnectedHero, DevicePortrait, useAudienceText } from "./parts";
import { useDevices } from "./queries";

/**
 * "Conectar este iPhone", on the iPhone itself, mirrored live from what its Mac sees: plugged in, trusted, Developer
 * Mode, UI Automation, the test helper. An iPhone app can't open another app's settings, so the path is drawn as text
 * (Settings › Privacy & Security › Developer Mode), never a button that claims to open it. The Mac does the rest.
 */
export function IphoneSetupScreen({ machineId }: { machineId?: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const meId = useMeId();
  const list = useDevices(4000);
  const [picked, setPicked] = useState<string | null>(machineId ?? null);
  const devices = list.data?.devices ?? [];
  const macs = phoneHosts(devices, meId, "ios");
  const seeing = devices.find((d) => thisPhoneOn(d.phones, "ios", Device.modelName));
  const host = devices.find((d) => d.id === picked) ?? seeing ?? (macs.length === 1 ? macs[0] : undefined);
  const hostName = host
    ? computerName(t, org?.name ?? "", { kind: host.machineKind, name: host.name }, isPersonal(org))
    : "";
  const phone = host ? thisPhoneOn(host.phones, "ios", Device.modelName) : null;
  const step = iphoneStep(phone);
  const reason = phone && phone.status.kind !== "offline" && "reason" in phone.status ? phone.status.reason : null;
  const tooOld = phone?.status.kind === "unsupported";
  // A step that sits unchanged gets what most likely holds it.
  const stalled = useStalled(host && !tooOld ? [host.id, step, phone?.id, reason].join(":") : null);
  const [plugged, setPlugged] = useState(false);
  if (host && phone && step === IPHONE_STEPS.length)
    return <IphoneDone phone={phone} host={host} hostName={hostName} />;
  /** The reason's own words where a step's text doesn't say it, with its way out. */
  const note = (r: string) =>
    r === "apple_team_missing"
      ? t("mobile.devices.iphone.teamMissing")
      : r === "ui_not_authorized"
        ? t("mobile.devices.iphone.uiRefused")
        : r === "xcode_too_old" && phone?.osVersion
          ? t("mobile.devices.iphone.xcodeOld", {
              version: phone.osVersion,
              major: iosMajor(phone.osVersion),
              host: hostName,
            })
          : reasonText(t, r);
  const state = (i: number) => (i < step ? "done" : i === step ? "now" : "later");
  const choose = async () => {
    const key = await pickOne({
      title: t("mobile.devices.android.computer"),
      options: macs.map((m) => ({ key: m.id, label: m.name })),
      value: host?.id ?? null,
    });
    if (key) setPicked(key);
  };
  const waiting = (
    <Note icon={<InkOrbit size={15} />} live>
      {t("mobile.devices.iphone.waiting", { host: hostName })}
    </Note>
  );
  const stall = (key: "plug" | "devmode") =>
    stalled || (key === "plug" && plugged) ? (
      <Note icon="info">{t(`mobile.devices.iphone.stall.${key}`, { host: hostName })}</Note>
    ) : null;
  return (
    <SettingsPage
      title={t("mobile.devices.iphone.title")}
      subtitle={host ? t("mobile.devices.iphone.with", { host: hostName }) : undefined}
    >
      {macs.length > 1 ? (
        <>
          <Gap />
          <GroupedList>
            <GroupedRow
              label={t("mobile.devices.android.computer")}
              value={hostName}
              menu
              onPress={() => void choose()}
            />
          </GroupedList>
        </>
      ) : null}
      {!host && list.isSuccess ? (
        <View style={styles.block}>
          <Note icon="info">{t("mobile.devices.iphone.noHost")}</Note>
          <Button
            size="sm"
            variant="secondary"
            label={t("mobile.devices.connect.title")}
            onPress={() => router.push("/settings/devices/connect")}
          />
        </View>
      ) : null}
      {host && tooOld && phone ? (
        <View style={styles.block}>
          <Note icon="x">{t("mobile.devices.iphone.tooOld", { version: tooOldVersion(t, phone.osVersion) })}</Note>
        </View>
      ) : null}
      {host && !tooOld ? (
        <>
          <View style={styles.steps}>
            <StepsCard>
              <Step n={1} title={t("mobile.devices.iphone.step1", { host: hostName })} state={state(0)}>
                {step === 0 ? (
                  <>
                    {waiting}
                    {stall("plug")}
                    {!stalled && !plugged ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        label={t("mobile.devices.iphone.pluggedIn")}
                        onPress={() => setPlugged(true)}
                      />
                    ) : null}
                  </>
                ) : null}
              </Step>
              <Step n={2} divider title={t("mobile.devices.iphone.step2")} state={state(1)}>
                {step === 1 ? <StepText>{t("mobile.devices.iphone.step2Text")}</StepText> : null}
              </Step>
              <Step
                n={3}
                divider
                title={t("mobile.devices.iphone.step3")}
                hint={t("mobile.devices.iphone.step3Hint")}
                state={state(2)}
              >
                {step === 2 ? (
                  <>
                    <SettingsPath />
                    <DevModeSwitch />
                    <StepText>{t("mobile.devices.iphone.step3Text")}</StepText>
                    {reason && !IPHONE_STEP_REASONS.has(reason) ? (
                      <Note icon="info">{note(reason)}</Note>
                    ) : (
                      <>
                        {waiting}
                        {stall("devmode")}
                      </>
                    )}
                  </>
                ) : null}
              </Step>
              <Step n={4} divider title={t("mobile.devices.iphone.step4")} state={state(3)}>
                {step <= 3 ? <StepText>{t("mobile.devices.iphone.step4Text")}</StepText> : null}
                {step === 3 && reason === "ui_not_authorized" ? <Note icon="info">{note(reason)}</Note> : null}
              </Step>
              <Step
                n={5}
                divider
                title={t("mobile.devices.iphone.step5")}
                hint={t("mobile.devices.iphone.step5Hint", { host: hostName })}
                state={state(4)}
              >
                <StepText>{t("mobile.devices.iphone.step5Text")}</StepText>
                {step === 4 && reason && !IPHONE_STEP_REASONS.has(reason) ? (
                  <Note icon="info">{note(reason)}</Note>
                ) : null}
              </Step>
            </StepsCard>
          </View>
          <GroupedFooter>{t("mobile.devices.iphone.footer")}</GroupedFooter>
        </>
      ) : null}
    </SettingsPage>
  );
}

/** Settings › Privacy & Security › Developer Mode, as the iPhone's own rows read, each step with its chevron. */
function SettingsPath() {
  const { t } = useTranslation();
  const c = useTheme().colors;
  const steps = [
    t("mobile.devices.iphone.path.settings"),
    t("mobile.devices.iphone.path.privacy"),
    t("mobile.devices.iphone.path.devMode"),
  ];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("mobile.devices.iphone.pathA11y")}
      style={styles.path}
    >
      {steps.map((label, i) => (
        <Fragment key={label}>
          <View style={styles.crumbStep}>
            <View style={[styles.crumb, { backgroundColor: c.sunken }]}>
              <Text variant="subhead" tone="ink" style={styles.bold}>
                {label}
              </Text>
            </View>
            {i < steps.length - 1 ? <Icon name="right" size={13} color={c.faint} /> : null}
          </View>
        </Fragment>
      ))}
    </View>
  );
}

/** The Developer Mode row as iOS draws it, its switch off and the row outlined to find it. */
function DevModeSwitch() {
  const { t } = useTranslation();
  const { scheme } = useTheme();
  // The system's own colors: a drawing of iOS's Settings.
  const k = scheme === "dark" ? IOS_DARK : IOS_LIGHT;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("mobile.devices.iphone.switchA11y")}
      style={[styles.osRow, { backgroundColor: k.row, borderColor: k.accent }]}
    >
      <Text variant="callout" style={[styles.grow, { color: k.ink }]}>
        {t("mobile.devices.iphone.path.devMode")}
      </Text>
      <View style={[styles.track, { backgroundColor: k.track }]}>
        <View style={styles.knob} />
      </View>
    </View>
  );
}

const IOS_LIGHT = { row: "rgba(0,122,255,0.08)", ink: "#000000", accent: "#007aff", track: "#e9e9ea" };
const IOS_DARK = { row: "rgba(10,132,255,0.16)", ink: "#ffffff", accent: "#0a84ff", track: "#39393d" };

/** The Mac sees this iPhone ready: it says so, and who can use it (its Mac's rule, changed there). */
function IphoneDone({ phone, host, hostName }: { phone: PhoneDevice; host: ComputerDevice; hostName: string }) {
  const { t } = useTranslation();
  const audienceText = useAudienceText();
  return (
    <SettingsPage
      title={t("mobile.devices.iphone.title")}
      bottom={<Button variant="primary" wide label={t("mobile.common.done")} onPress={goBack} />}
    >
      <Gap />
      <ConnectedHero
        portrait={<DevicePortrait phone={phone} size={96} />}
        title={t("mobile.devices.connect.joined", { name: phone.name })}
        line={phoneFacts(t, phone, hostName)}
      />
      <Gap />
      <GroupedList>
        <GroupedRow
          label={t("mobile.devices.audience.label")}
          value={audienceText(host.audience, host.ownerUserId)}
          {...(host.mayManage
            ? {
                chevron: true,
                onPress: () => router.push({ pathname: "/settings/devices/audience", params: { id: host.id } }),
              }
            : {})}
        />
      </GroupedList>
      <GroupedFooter>{t("mobile.devices.page.followsHost")}</GroupedFooter>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: 4, paddingTop: 16, gap: 12, alignItems: "flex-start" },
  steps: { paddingTop: 12 },
  path: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 4, rowGap: 4, marginTop: 4 },
  crumbStep: { flexDirection: "row", alignItems: "center", gap: 4 },
  crumb: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  bold: { fontWeight: "600" },
  osRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // 12 from the path above and from the words under it (with the steps' 4-point gap).
    marginVertical: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
  },
  track: { width: 51, height: 31, borderRadius: 16, padding: 2 },
  // iOS's knob carries a shadow: without it a white knob on the light track disappears.
  knob: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.06)",
  },
  grow: { flex: 1, minWidth: 0 },
});
