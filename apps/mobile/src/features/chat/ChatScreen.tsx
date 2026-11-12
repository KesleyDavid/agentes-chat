import {
  type Agent,
  type ArtifactDetail,
  type ArtifactRef,
  type BrowserHandoff,
  type ConnectionStatus,
  heldTakeoversHere,
  inMainTimeline,
  type LiveRun,
  MESSAGES_PAGE,
  type Message,
  type MessageMedia,
  type MessagePin,
  type ReceiptsState,
  type ReplyRef,
  type RunConsultation,
  type SearchHit,
  sendHelpers,
  typingIn,
  useAgentsBrowserHandoffs,
  useAiStatus,
  useApi,
  useChannels,
  useChannelThreads,
  useConsultations,
  useCreateMission,
  useDmReads,
  useDms,
  useHeldPlaces,
  useJoinChannel,
  useMarkChannelRead,
  useMarkThreadRead,
  useMessages,
  useMissionControl,
  usePins,
  usePostMessage,
  useRightHandWave,
  useRoster,
  useSettings,
  useSteerState,
  useThreadInfo,
  useThreadMessages,
  useThreadMission,
} from "@agenteschat/client";
import { activityVerb, listNames } from "@agenteschat/client/lib/activity";
import { canTalk } from "@agenteschat/client/lib/audience";
import { runPosition, screenAboveEnd } from "@agenteschat/client/lib/chat";
import { CHAT_RHYTHM, firstUnreadId, opensAtLastRead } from "@agenteschat/client/lib/chat-look";
import { type ConversationWait, conversationWaits } from "@agenteschat/client/lib/computer-queue";
import {
  asExchanges,
  consultBlocksNearEnd,
  consultNoticeFolds,
  consultsForLine,
} from "@agenteschat/client/lib/consult-group";
import { errorCode, errorText } from "@agenteschat/client/lib/errors";
import { mentionsReader, offersEveryone } from "@agenteschat/client/lib/everyone";
import { capitalize } from "@agenteschat/client/lib/format";
import { issueTakenOf, issueWorkOf, taskConversationOf } from "@agenteschat/client/lib/issues";
import { workIsOver } from "@agenteschat/client/lib/long-work";
import { supersededBrainNotices } from "@agenteschat/client/lib/machine-outages";
import {
  isMediaAfterReply,
  isMediaAlone,
  mediaTabsOf,
  messageMediaOf,
  textOrMedia,
} from "@agenteschat/client/lib/media";
import { isEventLine } from "@agenteschat/client/lib/notices";
import { can } from "@agenteschat/client/lib/permissions";
import { pinsIn } from "@agenteschat/client/lib/pins";
import { localMeta } from "@agenteschat/client/lib/reply";
import { retryAnswer } from "@agenteschat/client/lib/retry-answer";
import { isRightHand, rightHandSeenKey } from "@agenteschat/client/lib/right-hand";
import { seenMessageId } from "@agenteschat/client/lib/seen";
import { lastPostedId } from "@agenteschat/client/lib/timeline";
import { voiceOf } from "@agenteschat/client/lib/voice";
import { isIdHandle } from "@agenteschat/ui/names";
import { KeyboardAwareLegendList, useKeyboardChatComposerInset } from "@legendapp/list/keyboard";
import type { LegendListRef, OnViewableItemsChanged } from "@legendapp/list/react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useIsFocused, useIsPreview } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, type LayoutChangeEvent, Platform, ScrollView, StyleSheet, View } from "react-native";
import { KeyboardController, KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { frameClock } from "@/agent/clock";
import { StickerStageContext } from "@/agent/StickerCanvas";
import { createStickerStage } from "@/agent/sticker-stage";
import { holdOpenConversation } from "@/lib/push";
import { rightHandSeen } from "@/lib/storage";
import { useOrg } from "@/providers/org";
import { usePush } from "@/providers/push";
import { useRealtime } from "@/providers/realtime";
import {
  Button,
  Composer,
  type ComposerWorking,
  Count,
  Icon,
  IconButton,
  LineIcon,
  motion,
  PressScale,
  type SendHow,
  Text,
  useReducedMotion,
  useTheme,
  useToast,
} from "@/ui";
import { router } from "@/ui/navigation";
import { AgentSetupIntro, useSetupSteps } from "../agents/setup/SetupCard";
import { usePlanHold } from "../ai/parts";
import { BrowserCard, BrowserRunCard } from "../browser/BrowserCard";
import { OpenHandoffProvider } from "../browser/open";
import { threadTitle } from "../chats/logic";
import { chatHref } from "../links/logic";
import { MissionCardView } from "../missions/cards";
import { isOpenMission } from "../missions/logic";
import { PushOfferLine } from "../push/PushOfferLine";
import { FanStrip, QueueWaitRow } from "../queue/parts";
import { DmQueueButton, QueueButton, useAgentsQueue, useOpenQueue } from "../queue/QueueSheet";
import { RemindSheet } from "../reminders/RemindSheet";
import { RightHandIntro } from "../right-hand/Intro";
import { ConversationSearch } from "../search/ConversationSearch";
import { hitTarget } from "../search/logic";
import { takeShareHandoff, useShareHandoff } from "../share/handoff";
import { AgentFace, Face, OpensAgent } from "../shared/Face";
import { FirstUse } from "../shared/FirstUse";
import { useColors, useDirectory, useMeId, useMyHandle, useOrgId, useWhen } from "../shared/hooks";
import { agentLook, previewOf } from "../shared/logic";
import { FocusLive, PushedHeader, Tile } from "../shared/parts";
import { SheetHostProvider, useSheet } from "../shared/SheetHost";
import { useDmStatusLine, usePresenceWord } from "../status/hooks";
import { PersonStatusCard } from "../status/StatusCard";
import { AgentTasksButton, useDmAgentTasks } from "../task-manager/AgentTasksButton";
import { agentTasksHref, tasksBadge } from "../task-manager/logic";
import { retryVoice, type VoiceRefusal } from "../voice/outbox";
import { useVoiceComposer } from "../voice/useVoiceComposer";
import { AgentReceiptLine } from "./AgentReceipts";
import { AttachmentStrip, MAX_PENDING, type PendingFile } from "./AttachmentStrip";
import { receiptMessageId, turnHeadId } from "./agent-receipts";
import { AskStore } from "./ask-store";
import { AskBar, AskProbes, AskStoreProvider, useAskWatch, useAwayAsk } from "./asks";
import { ChannelHello } from "./ChannelHello";
import { ChannelMembersSheet } from "./ChannelMembers";
import { ChannelPicker } from "./ChannelPicker";
import { ChannelWelcome } from "./ChannelWelcome";
import { ConversationSwitcher } from "./ConversationSwitcher";
import { takeComposerRequest, useComposerRequest } from "./composer-request";
import { DATE_PILL_IDLE_MS, DatePill } from "./DatePill";
import { DmComputerButton } from "./DmComputerButton";
import { EventLine } from "./EventLine";
import { FirstDay } from "./FirstDay";
import { HeaderPill } from "./HeaderPill";
import { composerSuggestions } from "./intent";
import { IssueTakenLine } from "./issue-work";
import { browsingRuns, WorkingLine } from "./LiveRows";
import { useChatLive } from "./live";
import {
  buildRows,
  type ChatRow,
  dayInView,
  mayStopRun,
  mergeTimeline,
  parseSlash,
  pinTarget,
  quietInset,
  readMark,
  stoppableInLine,
  workingEntries,
} from "./logic";
import { RowLookContext, useConversationLook, useRhythm } from "./look";
import { MediaPickerSheet } from "./MediaPickerSheet";
import { MentionPicker, useMentionMembers } from "./MentionPicker";
import { MessageMenuFor } from "./MessageMenu";
import { MessageRow } from "./MessageRow";
import { stickerRowsOnScreen } from "./media";
import { insertRef, refQuery } from "./mentions";
import { NoAiBanner } from "./NoAiBanner";
import { endsOnNoAiCard, noAiBanner } from "./no-ai-banner";
import { PinnedLines, PinsSheet } from "./PinsSheet";
import { QuoteBar } from "./QuoteLine";
import { AgentLocked, UnavailableLines } from "./ReachLines";
import { SwipeReply } from "./SwipeReply";
import {
  appendedKeys,
  lastSeenKey,
  type Place,
  placeCorrection,
  type ScrollRow,
  STICK_TO_END_THRESHOLD,
  type Unseen,
  unseenBelow,
} from "./scroll";
import {
  ChannelOptions,
  MessageActions,
  type MessageActionsContext,
  MissionSummaryView,
  NewMissionForm,
  PlusActions,
  type PlusPick,
  ThreadOptions,
} from "./sheets";
import { StoppedRunsContext, stoppedRunsKey, stoppedRunsOf } from "./stopped-runs";
import { rememberTurn, turnItems, turnRuns, turnSignature, withOpacity } from "./turn";
import { JumpToMessageContext } from "./WorkLine";

/** A run's messages this recent are asked whether a take over still holds the agent's browser. */
const HELD_RECENT_MS = 12 * 60 * 60_000;

type Row =
  | (ChatRow & {
      /** A quiet line right under another: they stack as one group. */
      afterLine?: boolean;
      /** The next row of a turn under anything but a row of it: it takes a turn's gap. */
      newTurn?: boolean;
    })
  | { kind: "marker"; key: string; text: string }
  /** A run in line for its computer (`conversationWaits`): no live row of its own, this one for all its messages. */
  | { kind: "wait"; key: string; wait: ConversationWait }
  /** An agent's browser card: its live run in the browser, or (no run row) a take over held here. */
  | { kind: "browser"; key: string; run: LiveRun; handoff?: undefined }
  | { kind: "browser"; key: string; run: null; handoff: BrowserHandoff }
  | { kind: "unseen"; key: string; fading: boolean };

const rowKey = (r: Row) => r.key;
const isQuietLine = (r: Row | undefined) =>
  r?.kind === "message" && (isEventLine(r.message.meta) || issueTakenOf(r.message.meta) !== null);
/**
 * A row's type for the list, which keeps sizes per type: messages by how long they are and whether they carry a card
 * (as Expensify buckets them), so a row not measured yet is guessed close to its size and older pages land without a
 * jump.
 */
const rowType = (r: Row) => {
  if (r.kind !== "message") return r.kind;
  // A GIF or a sticker alone (ADR 0091) is about its picture's size, not a text's.
  if (voiceOf(r.message.meta)) return "message-voice";
  const media = r.message.body.trim() ? null : messageMediaOf(r.message.meta);
  if (media) return `message-${media.kind}`;
  const n = r.message.body.length;
  const size = n < 80 ? "s" : n < 320 ? "m" : n < 1200 ? "l" : "xl";
  return r.message.meta && Object.keys(r.message.meta).length > 0 ? `message-${size}-card` : `message-${size}`;
};
/** A sticker's row counts as in view from here: one barely in at the edge doesn't take a place among those playing. */
const STICKER_VIEW = { id: "stickers", itemVisiblePercentThreshold: 30 };
const DIVIDER_KEY = "unseen-divider";
/** The "Novas" line stays this long after the person reached it, then fades (~0.6 s). */
const DIVIDER_FADE_MS = 3500;
/** A dropped connection shows only past this long (a quick reconnect says nothing). */
const OFFLINE_AFTER_MS = 1200;
/** "Conectado de novo" stays this long. */
const BACK_ONLINE_MS = 1600;
/** A row that just arrived at the bottom rises in (only while it is fresh: not when scrolled back into view). */
/** A live arrival rises 6pt into place (`--dur-base`, as on the web); history and a jump never do. */
const ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 6 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }] },
}).duration(motion.base);
const FRESH_MS = 800;
/** How close to the end a scroll has to stop for a list held at a long message's start to follow again. */
const READ_RELEASE_PX = 24;
/** How long the sheet takes to slide away before the conversation it picked takes this one's place. */
const SHEET_LEAVE_MS = 240;
/** The composer's safe-area padding hides behind the open keyboard; this much stays between them. */
const KEYBOARD_GAP = 8;
const COMPOSER_INPUT_ID = "chat-composer";
/** How long the conversation is held in place after something opens over it and after it closes (ms). */
const HOLD_MS = 900;
/** Holding a message opens the system's menu where there is one (iOS); elsewhere, the app's sheet. */
const NATIVE_MENU = Platform.OS === "ios";
/** The notifications line was shown and answered here: it doesn't come back on this screen. */
const OFFER_DONE = "done";
/** How long the list keeps ignoring the keyboard after what covered it closed (its closing animation, ms). */
const FREEZE_AFTER_MS = 450;
/** The list shows by itself after this even if it never said it was placed (ms). */
const SHOW_LIST_MS = 700;
/** Going to a pinned message: at most this many older pages loaded looking for it. */
const SEEK_MAX_PAGES = 10;
/** How long the message gone to stays lit. */
const FLASH_MS = 1600;
/** No questions to other agents here (yet): the same list each time, so the memos over it keep. */
const NO_CONSULTATIONS: RunConsultation[] = [];

/**
 * A conversation: a channel, a DM, a thread or a mission's thread (`threadId`). `handoffId`: a request
 * for help a push or the inbox opened it for (its card opens in place, in control).
 */
/** "Revisor, Dev" for a screen reader, or just "Revisor" while there is no role or status (never "Revisor, ."). */
const who = (name: string, status: string) => (status ? `${name}, ${status}` : name);

export function ChatScreen({
  channelId,
  threadId,
  handoffId,
  focusId,
}: {
  channelId: string;
  threadId?: string | null;
  handoffId?: string | null;
  /** Open at this message: paged in, scrolled to and lit for a moment (a pin). */
  focusId?: string | null;
}) {
  return (
    <SheetHostProvider>
      <FocusLive>
        <OpenHandoffProvider handoffId={handoffId ?? null}>
          <Chat channelId={channelId} threadId={threadId ?? null} focusId={focusId ?? null} />
        </OpenHandoffProvider>
      </FocusLive>
    </SheetHostProvider>
  );
}

function Chat({
  channelId,
  threadId,
  focusId,
}: {
  channelId: string;
  threadId: string | null;
  focusId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const orgId = useOrgId();
  const meId = useMeId();
  const myHandle = useMyHandle();
  const api = useApi();
  const dir = useDirectory();
  const c = useColors();
  const toast = useToast();
  const sheet = useSheet();
  const insets = useSafeAreaInsets();
  const when = useWhen();
  // The requests waiting here and which messages are on screen: the line above the composer says when one
  // waits out of view (waiting beats working).
  const [asks] = useState(() => new AskStore());
  const awayAsk = useAwayAsk(asks);

  const channels = useChannels(orgId);
  const dms = useDms(orgId);
  const channel = channels.data?.find((x) => x.id === channelId);
  const dm = dms.data?.find((d) => d.channelId === channelId);
  // A conversation the loaded lists don't have yet (opened a moment ago, or reached by a link): they load
  // again once, so the header gets its name.
  const unlisted = channels.isSuccess && dms.isSuccess && !channel && !dm;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once each time the conversation goes missing
  useEffect(() => {
    if (!unlisted) return;
    void channels.refetch();
    void dms.refetch();
  }, [unlisted]);
  const isThread = Boolean(threadId);
  const thread = useThreadInfo(orgId, threadId);
  const missionQ = useThreadMission(orgId, threadId);
  const mission = missionQ.data ?? null;
  const dmAgentId = dm?.with.type === "agent" ? dm.with.id : null;
  const dmAgent = dmAgentId ? dir.agentById.get(dmAgentId) : undefined;
  const rowLook = useConversationLook(
    Boolean(dm) || thread.data?.channelKind === "dm",
    dmAgent ? agentLook(dmAgent).color : undefined,
  );
  const rhythm = CHAT_RHYTHM[rowLook.style];
  const quiet = quietInset(rowLook);
  // The right hand (ADR 0137): its own line and composer hint, no computer, and its greeting on top.
  const rightHand = isRightHand(dmAgent) && !isThread;
  // A new agent's setup checklist (ADR 0155 §2) for whoever sets it up: its greeting and the checklist on top.
  const setupIntro = useSetupSteps(dmAgent).length > 0 && !rightHand && !isThread;
  // Its DM is open, from its row or any other way in: its row's "Novo" goes.
  useEffect(() => {
    if (rightHand && meId) rightHandSeen.mark(rightHandSeenKey(meId, orgId));
  }, [rightHand, meId, orgId]);
  // Its wave on the person's first visit, kept here: the greeting moves into the list with the first message, and
  // the wave neither goes nor plays again.
  const wave = useRightHandWave(orgId, rightHand && dmAgent ? dmAgent.id : "");
  const waveFrom = useMemo(() => (wave ? frameClock.time() : undefined), [wave]);
  const member = dm ? true : (channel?.isMember ?? true);
  // An administrator reads every channel without joining it (ADR 0151): only what needs being in it waits for Entrar.
  const admin = can(useOrg().org, "administrator");
  const readable = member || admin;
  const roster = useRoster(orgId, channelId, Boolean(channel?.isMember) && !isThread);
  // The computer this conversation's agents share, while turns wait for it: the bar's way into its line.
  const queueAgents = useMemo(
    () => (dmAgentId ? [dmAgentId] : (roster.data ?? []).filter((r) => r.type === "agent").map((r) => r.id)),
    [dmAgentId, roster.data],
  );
  const { machineId: queueMachineId, queue: barQueue } = useAgentsQueue(queueAgents);
  const openQueue = useOpenQueue();
  const queueShown = Boolean(queueMachineId && barQueue?.waiting.length && !isThread);
  const join = useJoinChannel(orgId, channelId);
  // The "@" picker's sections: a channel's members (also in its threads); a DM has none.
  const mentionMembers = useMentionMembers(channelId, !dm && Boolean(channel?.isMember));

  // ── Messages ──
  const top = useMessages(orgId, channelId, readable && !isThread);
  const threadMessages = useThreadMessages(orgId, isThread && readable ? channelId : undefined, threadId ?? "");
  const channelThreads = useChannelThreads(orgId, channelId, "all", readable && !isThread);
  // Every thread with replies is a link under its root (as on the web): agents asked in the
  // channel answer in the channel, so a thread is always a conversation of its own.
  const linkThreads = useMemo(
    () =>
      new Map(
        (channelThreads.data?.threads ?? [])
          .filter((x) => x.state !== "archived" && (x.replyCount > 0 || x.mission || x.context))
          .map((x) => [x.id, x]),
      ),
    [channelThreads.data],
  );
  const [older, setOlder] = useState<Message[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const list = useMemo(() => {
    if (isThread) {
      // My replies still sending wait in the channel's list.
      const mine = (top.data ?? []).filter((m) => m.local && m.threadId === threadId);
      return mergeTimeline(threadMessages.data ?? [], [mine]);
    }
    return mergeTimeline([...older, ...(top.data ?? [])], []);
  }, [isThread, threadId, top.data, threadMessages.data, older]);
  // Messages said in the channel itself: a "thinking" row the app guessed hangs off one of them.
  const topIds = useMemo(() => new Set(list.flatMap((m) => (m.threadId ? [] : [m.id]))), [list]);
  // A DM with a person: their face beside my latest message once they read it (live: `channel.read`).
  const reads = useDmReads(orgId, channelId, dm?.with.type === "person" && !isThread);
  const seenId = useMemo(
    () => (reads.data && meId ? seenMessageId(top.data ?? [], meId, reads.data) : null),
    [reads.data, top.data, meId],
  );
  const seenBy = seenId ? dm?.with.id : undefined;

  // ── Live ──
  const live = useChatLive(orgId, channelId, readable);
  // Agents my message here named that won't answer me: in this conversation or this thread only.
  const notices = useMemo(
    () => live.notices.filter((n) => (isThread ? n.threadId === threadId : n.threadId === null)),
    [live.notices, isThread, threadId],
  );
  // People's messages loaded over HTTP start (or catch up) their agents' receipts, as on the web.
  const { seed: seedReceipts } = live;
  useEffect(() => {
    if (list.length > 0) seedReceipts(list);
  }, [list, seedReceipts]);
  const runs = useMemo(
    () => live.runs.filter((r) => (isThread ? r.threadId === threadId : inMainTimeline(r, topIds))),
    [live.runs, isThread, threadId, topIds],
  );
  const consults = useMemo(
    () => live.consults.filter((x) => (isThread ? x.threadId === threadId : inMainTimeline(x, topIds))),
    [live.consults, isThread, threadId, topIds],
  );

  // "Parar" in the working line (as on the web): who manages agents, the agent's owner, or who started it.
  const { org } = useOrg();
  const manageAgents = can(org, "manage_agents");
  const canStop = useCallback(
    (r: LiveRun) =>
      mayStopRun(r, {
        meId,
        manageAgents,
        agentOwnerId: dir.agentById.get(r.agentId)?.ownerUserId,
        messages: list,
      }),
    [meId, manageAgents, dir.agentById, list],
  );
  const { stop } = live;
  const stopRun = useCallback(
    (r: LiveRun) => {
      if (meId) stop(r.runId, meId);
    },
    [meId, stop],
  );
  // Who is typing here, in this conversation or this thread (never me), as on the web; `live` drops who stopped.
  const typing = useMemo(
    () => typingIn(live.typing, channelId, Date.now(), meId ?? undefined, threadId),
    [live.typing, channelId, meId, threadId],
  );
  const { sendTyping } = live;
  // While an agent works here, a tap on send reaches it at its next pause and holding send stops it and sends (the
  // server takes a steer). "Parar" itself is a word at the end of the line above the composer (and of the live row
  // while it shows): the composer keeps only its send, the one ink circle.
  const busyRuns = useMemo(() => stoppableInLine(runs).filter((r) => !r.stopping), [runs]);
  const stoppable = useMemo(() => stoppableInLine(runs).filter((r) => canStop(r)), [runs, canStop]);
  const working = useMemo<ComposerWorking | null>(() => (busyRuns.length === 0 ? null : {}), [busyRuns]);
  const lineStop = useMemo(
    () => (stoppable.length > 0 ? { runs: stoppable, onStop: stopRun } : undefined),
    [stoppable, stopRun],
  );
  // An agent's DM header counts its tasks, here and elsewhere (ADR 0128); a tap opens them, pushed like a thread.
  const agentTasks = useDmAgentTasks(member && !isThread ? dmAgentId : null);

  // ── Agents' blocks ──
  // An agent at work in its browser: its card in the conversation, open on demand.
  const browsing = useMemo(() => browsingRuns(runs), [runs]);
  // A take over held here after its run's live row went (the run paused for the person, or ended): the
  // same card stays, at the end, until the browser is handed back. Its runs: recent ones of this
  // conversation, the ones taken over here (or heard of in its events), and the live ones.
  const heldPlaces = useHeldPlaces();
  const heldAsk = useMemo(() => {
    const since = Date.now() - HELD_RECENT_MS;
    const runIds = new Set<string>(runs.map((r) => r.runId));
    const agentIds = new Set<string>();
    for (const m of list) {
      if (m.author.type !== "agent" || !m.author.id || !m.agentRunId || Date.parse(m.createdAt) < since) continue;
      runIds.add(m.agentRunId);
      agentIds.add(m.author.id);
    }
    for (const p of heldPlaces) {
      if (p.channelId !== channelId || (isThread && p.threadId !== threadId)) continue;
      runIds.add(p.runId);
      agentIds.add(p.agentId);
    }
    return { runIds, agentIds: [...agentIds].sort() };
  }, [runs, list, heldPlaces, channelId, threadId, isThread]);
  const agentHandoffs = useAgentsBrowserHandoffs(orgId, heldAsk.agentIds);
  const heldNow = heldTakeoversHere(agentHandoffs, {
    runIds: heldAsk.runIds,
    drawnAgents: new Set(browsing.map((r) => r.agentId)),
  });
  const heldKey = heldNow.map((h) => `${h.id}:${h.runId}:${h.controllerUserId ?? ""}`).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows change only when what is held changes
  const held = useMemo(() => heldNow, [heldKey]);
  // The messages an agent read while working (its "Leu seu recado" wells quote them; a GIF or a sticker by its word).
  const bodiesRef = useRef(new Map<string, string>());
  bodiesRef.current = useMemo(() => new Map(list.map((m) => [m.id, textOrMedia(t, m.body, m.meta)])), [list, t]);
  const bodyOf = useCallback((id: string) => bodiesRef.current.get(id), []);
  // Every agent at work here draws nothing in the conversation while it works: the line above the composer says who
  // works, on what and for how long, and its reply shows whole once posted, with the work it did (kept here, so the
  // reply shows it at once, `recentTurn`). A run in its browser has its browser card instead.
  const atWork = useMemo(() => turnRuns(runs, new Set(browsing.map((r) => r.runId))), [runs, browsing]);
  const workKey = atWork.map((r) => `${r.runId}:${turnSignature(turnItems(r))}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `workKey` stands for the runs' work
  useEffect(() => {
    for (const run of atWork) {
      const items = turnItems(run, true);
      const quotes = Object.fromEntries(
        items.flatMap((x) => (x.kind === "steer" ? [[x.messageId, bodyOf(x.messageId) ?? ""]] : [])),
      );
      rememberTurn(run.runId, { items, quotes, at: Date.now() });
    }
  }, [workKey]);
  const [openBrowsers, setOpenBrowsers] = useState<ReadonlySet<string>>(() => new Set());
  const toggleBrowser = useCallback((agentId: string, open: boolean) => {
    setOpenBrowsers((prev) => {
      if (prev.has(agentId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(agentId);
      else next.delete(agentId);
      return next;
    });
  }, []);

  // ── Rows ──
  // One waiting card per agent and computer: an older "my computer is away" gives way to the newer one.
  const superseded = useMemo(() => supersededBrainNotices(list), [list]);
  const workingKey = runs.map((r) => r.agentId).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: new only when who is at work changes
  const agentsAtWork = useMemo(() => new Set(runs.map((r) => r.agentId)), [workingKey]);
  const waitsNow = conversationWaits(isThread ? list : list.filter((m) => !m.threadId), live.receipts, (id) =>
    live.runs.some((r) => r.runId === id),
  );
  const waitsKey = waitsNow.map((w) => `${w.agentId}:${w.runId}`).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: new only when the waits change, not on every receipt
  const waits = useMemo(() => waitsNow, [waitsKey]);
  const rows = useMemo<Row[]>(() => {
    const waitRows = waits.map((wait) => ({
      kind: "wait" as const,
      key: `wait-${wait.runId ?? wait.agentId}`,
      wait,
    }));
    if (isThread && threadId) {
      const root = list.find((m) => m.id === threadId);
      const replies = list.filter((m) => m.id !== threadId);
      const info = thread.data;
      // A task's conversation (ADR 0145): its root stands for the task, one screen back; only the replies show.
      const head: Row[] =
        root && !taskConversationOf(root.meta)
          ? [
              {
                kind: "marker",
                key: "started",
                // In a DM, with whom (its channel name is internal, "dm-…"); in a channel, where.
                text:
                  info?.channelKind === "dm" || dm
                    ? t("mobile.chat.startedWith", { name: dm?.with.name ?? "" })
                    : t("mobile.chat.startedIn", { channel: info?.channelName ?? channel?.name ?? "" }),
              },
              // The root as it started the thread (its mission card is pinned above already).
              {
                kind: "message",
                key: root.id,
                message: { ...root, meta: { ...root.meta, missionStart: undefined, missionLink: undefined } },
                grouped: false,
              },
              {
                kind: "marker",
                key: "replies",
                text: t("mobile.chat.replies", { count: info?.replyCount ?? replies.length }),
              },
            ]
          : [];
      return [
        ...head,
        ...buildRows(replies, (m) => superseded.has(m.id), agentsAtWork),
        ...browsing.map((run) => ({ kind: "browser" as const, key: `browser-${run.agentId}`, run })),
        ...held.map((h) => ({ kind: "browser" as const, key: `browser-${h.agentId}`, run: null, handoff: h })),
        ...waitRows,
      ];
    }
    // A thread's replies live in the thread; the channel shows its link.
    const hidden = (m: Message) => superseded.has(m.id) || Boolean(m.threadId);
    return [
      ...buildRows(list, hidden, agentsAtWork),
      ...browsing.map((run) => ({ kind: "browser" as const, key: `browser-${run.agentId}`, run })),
      ...held.map((h) => ({ kind: "browser" as const, key: `browser-${h.agentId}`, run: null, handoff: h })),
      ...waitRows,
    ];
  }, [isThread, threadId, list, thread.data, channel?.name, dm, browsing, held, superseded, agentsAtWork, t, waits]);
  const shownMessages = useMemo(() => rows.flatMap((r) => (r.kind === "message" ? [r.message] : [])), [rows]);
  // Questions agents asked other agents, in the pair row before the replies that asked (`ConsultGroup`): how each
  // answer's notice draws (hidden under a reply close by, one line to one farther up, and while its asker still works
  // and posted nothing yet: its reply brings the row), and the working line without the questions a reply near the
  // end shows (an asker at work shows none: the line says them).
  // An exchange between the same two agents draws on its first asking run's reply (`asExchanges`).
  const consultData = useConsultations(orgId, channelId).data;
  const consultList = useMemo(() => (consultData ? asExchanges(consultData) : NO_CONSULTATIONS), [consultData]);
  const liveTurns = useMemo(
    () => new Set(atWork.flatMap((r) => (shownMessages.some((m) => m.agentRunId === r.runId) ? [] : [r.runId]))),
    [atWork, shownMessages],
  );
  const foldsNow = useMemo(
    () => consultNoticeFolds(shownMessages, consultList, liveTurns, "first"),
    [shownMessages, consultList, liveTurns],
  );
  // The rows redraw when a notice's fold changes, not on every message (the folds are rebuilt on each).
  const foldsKey = [...foldsNow].map(([id, f]) => `${id}:${f.fold === "line" ? f.messageId : f.fold}`).join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `foldsKey` stands for the folds
  const consultFolds = useMemo(() => foldsNow, [foldsKey]);
  // One stop is one pill: the stopped reply's, with its notice's words (who, the reason), the notice itself drawing
  // nothing while that reply is here (`stoppedRunsOf`). Rebuilt with the messages, redrawn only when a stop changes.
  const stoppedNow = useMemo(() => stoppedRunsOf(shownMessages), [shownMessages]);
  const stoppedKey = stoppedRunsKey(stoppedNow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stoppedKey` stands for the stops
  const stoppedRuns = useMemo(() => stoppedNow, [stoppedKey]);
  const lineConsults = useMemo(
    () => consultsForLine(consults, consultBlocksNearEnd(shownMessages, consultList, undefined, "first")),
    [consults, shownMessages, consultList],
  );

  // ── Following the end ──
  // The list sticks to the end only while the person is near it (Legend List's maintainScrollAtEnd); farther
  // up nothing moves (the scroll is never taken): the round button at the top right counts what arrived below (in
  // red when it mentions me) and goes back to the end, and a "Novas" line marks the first of it.
  const listRef = useRef<LegendListRef>(null);
  // The person dragging the list, a new hold on their place (see "Keeping the place") and the app moving it on
  // purpose (sending, the pill, a pin): each lets go of a held place.
  const dragging = useRef(false);
  const holding = useRef(0);
  const aimed = useRef(0);
  const letGo = useCallback(() => {
    holding.current++;
    aimed.current++;
  }, []);
  const scrollRows = useMemo<ScrollRow[]>(
    () =>
      rows.map((r) => ({
        key: r.key,
        kind: r.kind === "message" ? "message" : "other",
        ...(r.kind === "message" ? { id: r.message.id } : {}),
        mine: r.kind === "message" && r.message.author.type === "person" && r.message.author.id === meId,
        // An agent's sticker or GIF after its reply (ADR 0091) is never news of its own.
        silent: r.kind === "message" && isMediaAfterReply(r.message.meta),
        mentionsMe: r.kind === "message" && r.message.author.id !== meId && mentionsReader(r.message, myHandle),
        ...(r.kind === "message" && r.message.author.id
          ? { who: `${r.message.author.type}:${r.message.author.id}` }
          : {}),
      })),
    [rows, meId, myHandle],
  );
  const [atEnd, setAtEnd] = useState(true);
  const atEndRef = useRef(atEnd);
  atEndRef.current = atEnd;
  // Held at the start of a long message someone else wrote (see "Reading from the top"): the list doesn't follow
  // the end until the person gets there, sends, or takes the pill.
  const [readHold, setReadHold] = useState(false);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  // The message posted last when the person was last at the end: one posted since in a place above the last row they
  // saw (`PLACE_KEPT_MS`) is new to them too.
  const [seenPostedId, setSeenPostedId] = useState<string | undefined>();
  const latestSeen = lastSeenKey(scrollRows);
  const postedNow = useMemo(() => lastPostedId(list), [list]);
  useEffect(() => {
    if (!atEnd) return;
    setSeenKey(latestSeen);
    setSeenPostedId(postedNow);
  }, [atEnd, latestSeen, postedNow]);
  // More than a screen above the end: the round button shows even with nothing new below, and the header's pill
  // closes to the face.
  const [far, setFar] = useState(false);
  // Who writes now ("Atlas escrevendo"): its reply comes below, whole once posted.
  const writingKey = [...new Set(atWork.filter((r) => r.status === "running").map((r) => `agent:${r.agentId}`))].join(
    " ",
  );
  const unseen: Unseen = useMemo(
    () =>
      atEnd
        ? { messages: 0, firstKey: null, authors: [], working: [], mentionsMe: false }
        : { ...unseenBelow(scrollRows, seenKey, seenPostedId), working: writingKey ? writingKey.split(" ") : [] },
    [atEnd, scrollRows, seenKey, seenPostedId, writingKey],
  );
  // "Novas": before the first new row while the person reads above; it fades a while after they reach it.
  const [divider, setDivider] = useState<{ beforeKey: string; fading: boolean } | null>(null);
  useEffect(() => {
    if (unseen.firstKey && (!divider || divider.fading)) setDivider({ beforeKey: unseen.firstKey, fading: false });
  }, [unseen.firstKey, divider]);
  const [reached, setReached] = useState(false);
  useEffect(() => {
    if (atEnd) setReached(true);
  }, [atEnd]);
  useEffect(() => {
    if (!divider || divider.fading || !reached) return;
    const fade = setTimeout(() => setDivider((d) => (d ? { ...d, fading: true } : d)), DIVIDER_FADE_MS);
    return () => clearTimeout(fade);
  }, [divider, reached]);
  useEffect(() => {
    if (!divider?.fading) return;
    const gone = setTimeout(() => setDivider((d) => (d?.fading ? null : d)), 700);
    return () => clearTimeout(gone);
  }, [divider]);
  useEffect(() => {
    if (!atEnd && unseen.firstKey) setReached(false);
  }, [atEnd, unseen.firstKey]);
  const shownRows = useMemo<Row[]>(() => {
    const at = divider ? rows.findIndex((r) => r.key === divider.beforeKey) : -1;
    const all: Row[] =
      divider && at >= 0
        ? [...rows.slice(0, at), { kind: "unseen", key: DIVIDER_KEY, fading: divider.fading }, ...rows.slice(at)]
        : rows;
    return all.map((r, i) => {
      if (r.kind !== "message") return r;
      const above = all[i - 1];
      if (isQuietLine(r)) return isQuietLine(above) ? { ...r, afterLine: true } : r;
      return r.grouped && (above?.kind !== "message" || isQuietLine(above)) ? { ...r, newTurn: true } : r;
    });
  }, [rows, divider]);
  const toEnd = useCallback(() => {
    letGo();
    setReadHold(false);
    setAtEnd(true);
    requestAnimationFrame(() => void listRef.current?.scrollToEnd({ animated: true }));
  }, [letGo]);

  // "Ver" on the requests' line: the list goes to the request and stays there. It stops following the end, as
  // when reading a long message from its top, so a reply streaming in doesn't pull it back down; reaching the end,
  // sending or the pill follow again. The card ends its message: a message taller than the screen shows its end.
  const holdAt = useCallback(
    (messageId: string | undefined, viewPosition = 0.5, animated = true) => {
      const key = messageId ? rows.find((r) => r.kind === "message" && r.message.id === messageId)?.key : undefined;
      if (!key) return false;
      letGo();
      setReadHold(true);
      // After the render that turns following off, so the end doesn't pull it back down.
      requestAnimationFrame(() => {
        const index = listRef.current?.getState().indexByKey(key);
        if (index === undefined) return;
        void listRef.current?.scrollToIndex({ index, animated, viewPosition, viewPositionFallback: "end" });
      });
      return true;
    },
    [rows, letGo],
  );
  const seeAsk = useCallback(() => void holdAt(awayAsk?.ask.messageId), [awayAsk, holdAt]);

  // Rows that arrive at the bottom while the screen is open rise in; older pages and the first load don't.
  const prevKeysRef = useRef<string[]>([]);
  const freshRef = useRef(new Map<string, number>());
  const rowKeys = useMemo(() => rows.map(rowKey), [rows]);
  useMemo(() => {
    const now = Date.now();
    for (const key of appendedKeys(prevKeysRef.current, rowKeys)) freshRef.current.set(key, now);
    for (const [key, t0] of freshRef.current) if (now - t0 > FRESH_MS) freshRef.current.delete(key);
  }, [rowKeys]);
  useEffect(() => {
    prevKeysRef.current = rowKeys;
  }, [rowKeys]);
  // Less motion asked for: nothing rises in.
  const stillRows = useReducedMotion();
  const isFresh = useCallback(
    (key: string) => {
      const t0 = freshRef.current.get(key);
      return !stillRows && t0 !== undefined && Date.now() - t0 <= FRESH_MS;
    },
    [stillRows],
  );

  // ── Read ──
  // Seen up to the message posted last, wherever its place: the list's badges (a channel's or DM's, or a thread's)
  // clear at once.
  const markRead = useMarkChannelRead(orgId).mutate;
  const markThreadRead = useMarkThreadRead(orgId).mutate;
  // Peeked at from the list (iOS's long press preview): nothing is read until it is opened.
  const peeking = useIsPreview();
  useEffect(() => {
    if (peeking || !member || !postedNow) return;
    const mark = readMark(channelId, threadId);
    if (mark.kind === "thread") markThreadRead(mark.id);
    else markRead(mark.id);
  }, [peeking, markRead, markThreadRead, channelId, threadId, member, postedNow]);

  // ── Older pages (channel view) ──
  const [loadingOlder, setLoadingOlder] = useState(false);
  // The list asks for older rows on a layout change too, not only a scroll (Legend List 3.7): one page at a
  // time, whatever the state says this render.
  const fetchingOlder = useRef(false);
  const loadOlder = useCallback(() => {
    if (isThread || olderDone || loadingOlder || fetchingOlder.current || !top.data) return;
    const oldest = older[0] ?? top.data[0];
    if (!oldest || top.data.length < MESSAGES_PAGE) {
      setOlderDone(true);
      return;
    }
    fetchingOlder.current = true;
    setLoadingOlder(true);
    api.chat
      .messages(orgId, channelId, { before: oldest.createdAt, limit: MESSAGES_PAGE })
      .then((page) => {
        setOlder((prev) => [...page, ...prev]);
        if (page.length < MESSAGES_PAGE) setOlderDone(true);
      })
      .catch(() => setOlderDone(true))
      .finally(() => {
        fetchingOlder.current = false;
        setLoadingOlder(false);
      });
  }, [api, orgId, channelId, isThread, olderDone, loadingOlder, top.data, older]);

  // ── Sending ──
  // Without a connection (no internet, or the server restarting) a message isn't "failed": it waits with a
  // clock and goes by itself when the connection is back, from whatever screen is open (`useSendWaiting`).
  const post = usePostMessage(orgId, channelId, {
    me: { id: meId ?? "" },
    // An agent DM: "pensando…" at once, on the message the agent answers. Not when it went into the work
    // already going (the server steered it: no second run, its block says "lê na próxima pausa"), nor for a GIF or a
    // sticker alone, which no agent answers (ADR 0091).
    onSent: (message) => {
      const steered = Array.isArray(message.meta?.steeredRunIds) && message.meta.steeredRunIds.length > 0;
      if (dmAgentId && !steered && !isMediaAlone(message)) {
        live.expect(message.threadId ?? message.id, [dmAgentId], message.id);
      }
      // A channel with agents: the router (or a mention) decides who answers, and `message.routed` always follows.
      // A GIF or a sticker alone routes to nobody, so it gets no clock to keep.
      if (channel && channelAgents.length > 0 && !isMediaAlone(message)) live.picking(message.id);
    },
    onFailed: (error, { waits }) => {
      if (waits) return;
      const gone = errorCode(error) === "message.reply_not_found";
      toast({ title: gone ? errorText(t, error) : t("mobile.chat.notSent"), icon: "x" });
    },
  });
  const { send, retry } = sendHelpers(post);
  // "Responder" in a thread: the next message answers this one (`meta.replyTo`).
  const [quote, setQuote] = useState<Message | null>(null);
  const [replyAt, setReplyAt] = useState(0);
  const onReply = useCallback((m: Message) => {
    setQuote(m);
    setReplyAt(Date.now());
  }, []);
  const takeQuote = (files: ArtifactRef[] = []) => {
    if (!quote) return files.length > 0 ? localMeta(null, "", files) : undefined;
    setQuote(null);
    return localMeta(quote, dir.nameOf(quote.author), files);
  };
  const qc = useQueryClient();
  const voiceRefused = useCallback(
    (reason: VoiceRefusal) => toast({ title: t(reason === "limit" ? "voice.limit" : "voice.notSent"), icon: "x" }),
    [t, toast],
  );
  // Rows keep the same callback (so a streaming reply doesn't re-render every message).
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const onRetry = useCallback(
    (m: Message) => {
      // A voice note waits in its own outbox: tried again there, now.
      if (voiceOf(m.meta) && m.local) retryVoice(qc, m.clientId, voiceRefused);
      else retryRef.current(m);
    },
    [qc, voiceRefused],
  );
  // "Tentar de novo" under a message no agent could answer: the agent answers that same message again; only when it
  // can't, the same words go again, here (the web's `resend`).
  const sendRef = useRef(send);
  sendRef.current = send;
  const onResend = useCallback(
    (m: Message) =>
      retryAnswer(api, orgId, m, () => {
        sendRef.current(m.body, threadId);
        toEnd();
      }).catch((error) => toast({ title: errorText(t, error), icon: "x" })),
    [api, orgId, threadId, toEnd, toast, t],
  );
  const realtime = useRealtime().status;
  const control = useMissionControl(orgId);
  const createMission = useCreateMission(orgId);
  const channelAgents = (roster.data ?? []).filter((r) => r.type === "agent").map((r) => r.id);
  const soleAgent = dmAgentId ?? (channelAgents.length === 1 ? (channelAgents[0] ?? null) : null);
  // An empty channel says hi through one of its agents that answers me, by a handle people can read (as the web).
  const talkable = channelAgents.map((id) => dir.agentById.get(id)).filter((a): a is Agent => Boolean(a) && canTalk(a));
  const helloAgent = talkable.find((a) => !isIdHandle(a.handle)) ?? talkable[0];

  const openNewMission = (goal = "", homeThreadId: string | null = threadId) =>
    sheet.open(
      <NewMissionForm
        goal={goal}
        channelId={channelId}
        threadId={homeThreadId}
        preferredAgentId={mission?.agentId ?? soleAgent}
        currentThreadId={threadId}
      />,
    );
  const openRemind = (input: { text?: string; message?: Message } = {}) =>
    sheet.open(
      <RemindSheet
        channelId={channelId}
        threadId={threadId}
        {...(input.message ? { message: input.message } : {})}
        {...(input.text ? { initialText: input.text } : {})}
      />,
    );
  const summarize = () => {
    if (mission) sheet.open(<MissionSummaryView missionId={mission.id} />);
    else send(t("mobile.chat.summaryMessage"), threadId);
  };

  // Sending always goes to the end. While an agent works, "Parar e mandar" makes it read this one now.
  const onSend = (raw: string, how: SendHow = "join") => {
    const text = raw.trim();
    // Photos or files waiting above the field: they go with the words, which are their caption (or with none).
    if (pending.length > 0) {
      void sendWithFiles(text, how);
      return;
    }
    if (!text) return;
    const cmd = parseSlash(text);
    if (!cmd) {
      const meta = takeQuote();
      send(text, threadId, how === "now" ? { ...meta, steer: "now" } : meta);
      toEnd();
      return;
    }
    switch (cmd.command) {
      case "mission":
        if (cmd.arg && soleAgent && !mission)
          createMission.mutate(
            { agentId: soleAgent, goal: cmd.arg, ...(threadId ? { threadId } : { channelId }) },
            {
              onSuccess: (m) => {
                toast({
                  title: t("mobile.newMission.created", { name: dir.agentById.get(soleAgent)?.name ?? "" }),
                  agentId: m.agentId,
                });
                if (m.threadId !== threadId) router.push(chatHref(m.channelId, m.threadId));
              },
              onError: () => toast({ title: t("mobile.app.failed"), icon: "x" }),
            },
          );
        else openNewMission(cmd.arg);
        return;
      case "summary":
        summarize();
        return;
      case "remind":
        openRemind({ text: cmd.arg });
        return;
      case "plan":
        if (mission) router.push(`/mission/${mission.id}`);
        else toast({ title: t("mobile.chat.noMission"), icon: "x" });
        return;
      default: {
        if (!mission) {
          toast({ title: t("mobile.chat.noMission"), icon: "x" });
          return;
        }
        const action = cmd.command;
        control.mutate(
          { missionId: mission.id, action },
          {
            onSuccess: () => toast({ title: t(`mobile.chat.missionDone.${action}`), agentId: mission.agentId }),
            onError: () => toast({ title: t("mobile.app.failed"), icon: "x" }),
          },
        );
      }
    }
  };

  // GIFs and stickers (ADR 0091): the button only where one can go; one tap in the sheet sends it like any message of
  // mine. The list is aimed at the end before the sheet closes: the place it held under the sheet doesn't come back.
  const settings = useSettings(orgId).data;
  const mediaTabs = mediaTabsOf(settings, dir.agents.length, Boolean(api.gifs));
  const voice = useVoiceComposer({
    orgId,
    channelId,
    threadId,
    agentId: dmAgentId,
    replyTo: quote?.id ?? null,
    authorId: meId ?? "",
    enabled: Boolean(meId && settings?.voiceAvailable && settings.voiceMessages),
    afterSend: () => {
      setQuote(null);
      toEnd();
    },
  });
  const sendMedia = (media: MessageMedia) => {
    send("", threadId, { ...takeQuote(), media });
    toEnd();
    sheet.close();
  };
  const openMedia = () =>
    sheet.open(
      <MediaPickerSheet
        tabs={mediaTabs}
        channelId={channelId}
        isDm={Boolean(dm)}
        dmAgentId={dmAgentId}
        onSend={sendMedia}
      />,
    );

  // ── Photos and files ──
  // Picked, they wait above the field (`AttachmentStrip`): × takes one out, the words typed are their caption, and
  // send uploads them and sends everything as one message. A thumbnail dims while its upload runs; one that fails
  // stays, marked, and the caption comes back to the field, so nothing typed is lost.
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [captionBack, setCaptionBack] = useState<{ text: string; at: number } | null>(null);
  const addPending = (files: { uri: string; name: string; type: string }[]) => {
    if (files.length === 0) return;
    const at = Date.now();
    const picked = files.map((f, i): PendingFile => ({ ...f, id: `${at}-${i}-${f.uri}`, state: "waiting" }));
    if (pending.length + picked.length > MAX_PENDING)
      toast({ title: t("mobile.chat.attach.tooMany", { count: MAX_PENDING }), icon: "file" });
    setPending((now) => [...now, ...picked].slice(0, MAX_PENDING));
  };
  const removePending = (id: string) => setPending((now) => now.filter((f) => f.id !== id));
  const uploadOne = async (file: PendingFile): Promise<ArtifactRef> => {
    // React Native's FormData sends `{ uri, name, type }` as a file part.
    const part = { uri: file.uri, name: file.name, type: file.type };
    const asFile = part as unknown as Parameters<typeof api.artifacts.upload>[1];
    const saved: ArtifactDetail = await api.artifacts.upload(orgId, asFile, {
      channelId,
      ...(threadId ? { threadId } : {}),
    });
    return { id: saved.id, version: saved.version, title: saved.title };
  };
  const sendWithFiles = async (text: string, how: SendHow, files: PendingFile[] = pending) => {
    setPending((now) => now.map((f): PendingFile => ({ ...f, state: "sending" })));
    const results = await Promise.allSettled(files.map(uploadOne));
    const failed = new Set(files.filter((_, i) => results[i]?.status === "rejected").map((f) => f.id));
    if (failed.size > 0) {
      // Nothing goes half sent: the ones that failed stay marked, the caption comes back to try again.
      const after = (f: PendingFile): PendingFile["state"] => (failed.has(f.id) ? "failed" : "waiting");
      setPending((now) => now.map((f) => ({ ...f, state: after(f) })));
      if (text) setCaptionBack({ text, at: Date.now() });
      toast({ title: t("mobile.chat.uploadFailed"), icon: "x" });
      return;
    }
    const refs = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const meta = takeQuote(refs);
    send(text, threadId, how === "now" ? { ...meta, steer: "now" } : meta);
    setPending([]);
    toEnd();
  };
  // What another app shared ("Compartilhar com…" picked this agent): it goes at once, through this conversation's own
  // sending, so the photos show in the strip while they upload and the agent starts reading as soon as it lands.
  const shareIn = useShareHandoff(channelId);
  const shareReady = Boolean(meId) && (Boolean(dm) || Boolean(channel));
  // biome-ignore lint/correctness/useExhaustiveDependencies: sent once per handoff (`at`), when the conversation is known
  useEffect(() => {
    if (!shareIn || !shareReady) return;
    takeShareHandoff(shareIn.at);
    if (shareIn.files.length > 0) {
      const files = shareIn.files.map(
        (f, i): PendingFile => ({ ...f, id: `${shareIn.at}-${i}-${f.uri}`, state: "sending" }),
      );
      setPending(files);
      void sendWithFiles(shareIn.text, "join", files);
    } else if (shareIn.text) {
      send(shareIn.text, threadId);
      toEnd();
    }
  }, [shareIn?.at, shareReady]);
  const pickedAsset = (a: ImagePicker.ImagePickerAsset) => ({
    uri: a.uri,
    name: a.fileName ?? (a.type === "video" ? "video.mp4" : "photo.jpg"),
    type: a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg"),
  });
  const openPlus = () => sheet.open(<PlusActions media={mediaTabs.length > 0} onPick={(p) => void onPlus(p)} />);
  const onPlus = async (pick: PlusPick) => {
    // The library, the camera and the files picker open once the sheet is gone: presented over it while it slid out,
    // iOS took them away with it and the app waited for an answer that never came. The GIFs' sheet takes its place
    // the same way.
    const after = pick === "camera" || pick === "photos" || pick === "file" || pick === "media";
    if (after) await new Promise<void>((done) => sheet.close(done));
    else sheet.close();
    switch (pick) {
      case "media":
        openMedia();
        return;
      case "camera": {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          toast({ title: t("mobile.plus.noCamera"), icon: "camera" });
          return;
        }
        const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
        if (!res.canceled) addPending(res.assets.map(pickedAsset));
        return;
      }
      case "photos": {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images", "videos"],
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, MAX_PENDING - pending.length),
          orderedSelection: true,
        });
        if (!res.canceled) addPending(res.assets.map(pickedAsset));
        return;
      }
      case "file": {
        const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
        if (!res.canceled)
          addPending(
            res.assets.map((a) => ({ uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream" })),
          );
        return;
      }
      case "mission":
        setTimeout(() => openNewMission(), 250);
        return;
      case "summary":
        summarize();
        return;
      case "remind":
        setTimeout(() => openRemind(), 250);
        return;
    }
  };

  // ── Holding a message, swiping it ──
  // "Responder" quotes the message above the field, in the conversation or the thread (the server keeps the quote in
  // the same place), wherever I can write.
  const canMission = !mission && (Boolean(dm) || Boolean(channel));
  const canReply =
    member &&
    (!isThread || thread.data?.state !== "archived") &&
    channel?.can?.post !== false &&
    (!dmAgent || canTalk(dmAgent));
  // What a message's menu works with: the system's menu (iOS) and the app's sheet (Android) list the same actions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: openNewMission and openRemind read the latest state when called
  const menuOf = useCallback(
    (m: Message): MessageActionsContext => ({
      message: m,
      canMission,
      inThread: isThread,
      thread: linkThreads.get(m.threadId ?? m.id),
      onMission: (goal, rootId) => openNewMission(goal, rootId),
      onRemind: (message) => openRemind({ message }),
      onReply: canReply ? onReply : undefined,
    }),
    [canMission, isThread, linkThreads, canReply, onReply],
  );
  // The app's own sheet only where the platform has no menu of its own: on iOS a hold is the system's.
  const onLongPress = useMemo(
    () => (NATIVE_MENU ? undefined : (m: Message) => sheet.open(<MessageActions {...menuOf(m)} />)),
    [sheet, menuOf],
  );

  // ── Pins ──
  const rowsRef = useRef<Row[]>([]);
  // Going to a message (a pin, `?m=`): found among the rows, or older pages loaded until it is (at most
  // `SEEK_MAX_PAGES`); then scrolled to and lit for a moment.
  const [seek, setSeek] = useState<string | null>(focusId);
  const [flashId, setFlashId] = useState<string | null>(null);
  const seekPages = useRef(0);
  const seekPressed = useRef(false);
  const seekReady = isThread ? threadMessages.isSuccess && !threadMessages.isPlaceholderData : top.isSuccess;
  const seekRefreshing = isThread ? threadMessages.isFetching : top.isFetching;
  useEffect(() => {
    if (!seek || !seekReady) return;
    const index = shownRows.findIndex((r) => r.kind === "message" && r.message.id === seek);
    if (index >= 0) {
      setSeek(null);
      seekPressed.current = false;
      letGo();
      void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
      setFlashId(seek);
      return;
    }
    if (isThread || olderDone || seekPages.current >= SEEK_MAX_PAGES) {
      // A cached page refreshing may still bring it.
      if (seekRefreshing) return;
      setSeek(null);
      if (seekPressed.current) toast({ title: t("channel.jumpTooFar") });
      else toast({ title: t("channel.jumpMissing"), icon: "x" });
      seekPressed.current = false;
      return;
    }
    if (!loadingOlder) {
      seekPages.current += 1;
      loadOlder();
    }
  }, [seek, seekReady, seekRefreshing, shownRows, isThread, olderDone, loadingOlder, loadOlder, letGo, t, toast]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);
  const onQuote = useCallback(
    (reply: ReplyRef) => {
      // A thread's reply isn't a row of the conversation: it is on the thread's screen.
      if (!isThread && reply.threadId) {
        router.push(chatHref(channelId, reply.threadId, reply.messageId));
        return;
      }
      seekPages.current = 0;
      seekPressed.current = true;
      setSeek(reply.messageId);
    },
    [isThread, channelId],
  );
  const goToPin = (pin: MessagePin) => {
    sheet.close();
    const target = pinTarget(pin, threadId);
    if (target.kind === "open") {
      router.push(chatHref(channelId, target.threadId, target.messageId));
      return;
    }
    seekPages.current = 0;
    setSeek(target.messageId);
  };
  const openPins = () => sheet.open(<PinsSheet channelId={channelId} threadId={threadId} onPick={goToPin} />);
  // "Buscar nesta conversa" (as the web's header search): on the timeline, not in a thread.
  const searchPlace = isThread
    ? null
    : dm
      ? { id: channelId, name: dm.with.name, dm: true }
      : channel
        ? { id: channelId, name: channel.name }
        : null;
  const goToHit = (hit: SearchHit) => {
    sheet.close();
    const target = hitTarget(hit, channelId);
    if (target.kind === "open") {
      router.push(target.href);
      return;
    }
    seekPages.current = 0;
    setSeek(target.messageId);
  };
  const openSearch = () =>
    searchPlace ? sheet.open(<ConversationSearch place={searchPlace} onPick={goToHit} />) : undefined;
  // "Ver resultado" on a work's line: its report, when this conversation shows it.
  const jumpToMessage = useCallback((messageId: string) => {
    const index = rowsRef.current.findIndex((r) => r.kind === "message" && r.message.id === messageId);
    if (index < 0) return false;
    void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
    return true;
  }, []);
  const openMembers = () =>
    channel ? sheet.open(<ChannelMembersSheet channelId={channelId} channelName={channel.name} />) : undefined;

  // ── Header ──
  // The header is glass over the conversation: the system's
  // back and "…" circles, and in the middle a pill with who or where, its sky and what the agent is doing.
  const info = thread.data;
  // A task's work thread: its root was written by the server in one language ("Issue #1: …"); the card's
  // number and title, in the reader's.
  const root = isThread ? list.find((m) => m.id === threadId) : undefined;
  const rootWork = issueWorkOf(root?.meta);
  // A task's conversation (ADR 0145): "Conversa da tarefa", the task under it.
  const rootTask = taskConversationOf(root?.meta);
  const title = isThread
    ? rootTask
      ? t("issues.conversation.title")
      : rootWork
        ? t("issues.open", { number: rootWork.number, title: rootWork.title })
        : info
          ? // A thread on a GIF or a sticker has no words of its own to title it (ADR 0091).
            threadTitle(info) || previewOf(root ? textOrMedia(t, root.body, root.meta) : "") || t("mobile.chat.thread")
          : ""
    : dm
      ? dm.with.name
      : channel
        ? `#${channel.name}`
        : "";
  const agentsHere = (roster.data ?? []).filter((r) => r.type === "agent").length;
  const subtitle = isThread
    ? rootTask
      ? `#${rootTask.number} · ${rootTask.title}`
      : info
        ? info.channelKind === "dm"
          ? // A DM's channel name is internal ("dm-…"): the thread says who it is with.
            t(
              mission
                ? "mobile.chat.missionWith"
                : info.state === "closed"
                  ? "mobile.chat.closedThreadWith"
                  : "mobile.chat.threadWith",
              { name: dm?.with.name ?? "" },
            )
          : t(
              mission
                ? "mobile.chat.missionIn"
                : info.state === "closed"
                  ? "mobile.chat.closedThreadIn"
                  : "mobile.chat.threadIn",
              {
                channel: info.channelName,
              },
            )
        : undefined
    : dmAgentId
      ? rightHand
        ? `${t("rightHand.label")} · ${t("rightHand.actsAsYou")}`
        : dir.agentById.get(dmAgentId)?.role || undefined
      : channel && roster.data
        ? // People and agents counted apart: "1 pessoa · 3 agentes", never "4 membros · 3 agentes".
          `${t("mobile.chat.people", { count: roster.data.length - agentsHere })} · ${t("mobile.chat.agentsHere", { count: agentsHere })}`
        : undefined;
  // An agent's DM while it works: the pill's quiet line says what it does ("Consultando o GitHub").
  const dmDoing = useMemo(() => {
    if (!dmAgentId || isThread) return null;
    const entry = workingEntries(runs, lineConsults, (id) => dir.agentById.get(id)?.name ?? "").find(
      (e) => e.type === "agent" && e.id === dmAgentId,
    );
    if (!entry) return null;
    return capitalize(activityVerb(t, entry.activity), i18n.language);
  }, [dmAgentId, isThread, runs, lineConsults, dir.agentById, t, i18n.language]);
  // A DM's pill says how the other side is (ADR 0084): an agent's presence and what it does, a person's line.
  const dmLine = useDmStatusLine(
    dm && !isThread ? { type: dm.with.type, id: dm.with.id } : null,
    dmDoing,
    dmAgentId ? subtitle : undefined,
  );
  // The ⋯ of a DM with a person says how they appear, their line in a card under it.
  const personDm = dm && !dmAgentId && !isThread ? dm.with.id : null;
  const optionsLine = usePresenceWord(personDm ? { type: "person", id: personDm } : null) ?? subtitle;
  // ── Keeping the place ──
  // Something opening over the conversation must not move it: on iOS it jumped when a header button opened a sheet
  // or the agent's computer. Where the person was (the end, or a row on screen) is taken before it opens, and given
  // back for a moment after it opens and after it closes, whichever way the list moved, unless they drag it or
  // the app scrolls it on purpose (sending, the pill, a pin).
  const placeNow = useCallback((): Place | null => {
    const list = listRef.current;
    const state = list?.getState();
    if (!list || !state) return null;
    if (state.isFollowingEnd) return { end: true };
    const anchor = list.anchorVisibleContent({ hold: false });
    const position = anchor ? state.positionByKey(anchor.key) : undefined;
    return { end: false, scroll: state.scroll, key: anchor?.key ?? null, position: position ?? null };
  }, []);
  const holdPlace = useCallback((place: Place | null) => {
    if (!place) return;
    const hold = ++holding.current;
    dragging.current = false;
    const until = Date.now() + HOLD_MS;
    const check = () => {
      if (dragging.current || holding.current !== hold) return;
      const list = listRef.current;
      const state = list?.getState();
      if (list && state) {
        const fix = placeCorrection(place, {
          scroll: state.scroll,
          distanceFromEnd: state.distanceFromEnd,
          positionOf: state.positionByKey,
        });
        if (fix === "end") void list.scrollToEnd({ animated: false });
        else if (fix !== null) void list.scrollToOffset({ offset: fix, animated: false });
      }
      if (Date.now() < until) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, []);
  // Stickers play in the rows in view (a few of them), never under a sheet (ADR 0091).
  const [stickers] = useState(createStickerStage);
  useEffect(() => sheet.subscribe(stickers.setCovered), [sheet, stickers]);
  // The floating date: the day at the top of what is in view, shown while the person drags or flings the list.
  const [topDay, setTopDay] = useState<string | null>(null);
  const dayShown = useSharedValue(0);
  const dayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showDay = useCallback(() => {
    clearTimeout(dayTimer.current);
    dayShown.value = withTiming(1, { duration: 120 });
  }, [dayShown]);
  const hideDay = useCallback(() => {
    clearTimeout(dayTimer.current);
    dayTimer.current = setTimeout(() => {
      dayShown.value = withTiming(0, { duration: 300 });
    }, DATE_PILL_IDLE_MS);
  }, [dayShown]);
  useEffect(() => () => clearTimeout(dayTimer.current), []);
  const onViewable = useCallback<NonNullable<OnViewableItemsChanged<Row>>>(
    ({ viewableItems }) => {
      stickers.setOnScreen(stickerRowsOnScreen(viewableItems));
      setTopDay((prev) => dayInView(viewableItems, prev));
    },
    [stickers],
  );
  // While something covers the conversation (a sheet, the agent's computer) the list ignores the keyboard: it
  // leaving under the cover, or coming back, must not move it (Bluesky and Mattermost freeze or dismiss first too).
  const freeze = useSharedValue(false);
  const covered = useRef(false);
  const cover = useCallback(() => {
    covered.current = true;
    freeze.value = true;
  }, [freeze]);
  const uncover = useCallback(() => {
    covered.current = false;
    setTimeout(() => {
      if (!covered.current) freeze.value = false;
    }, FREEZE_AFTER_MS);
  }, [freeze]);
  // Every sheet of this screen says when it opens (before the keyboard leaves) and closes: one place for all of
  // them (the header's, a message's, the composer's).
  useEffect(() => {
    let place: Place | null = null;
    let aimedAt = 0;
    return sheet.subscribe((open) => {
      if (open) {
        // A sheet opened from another keeps the place taken by the first.
        if (!covered.current) {
          place = placeNow();
          aimedAt = aimed.current;
        }
        cover();
        holdPlace(place);
        return;
      }
      uncover();
      // Unless the app moved the list on purpose meanwhile (a message sent from the sheet).
      if (aimed.current === aimedAt) holdPlace(place);
    });
  }, [sheet, cover, uncover, placeNow, holdPlace]);
  // The agent's computer opens full screen: where the conversation was is kept, and given back on return.
  const away = useRef<Place | null>(null);
  const left = useRef(false);
  const leavePlace = useCallback(() => {
    away.current = placeNow();
    left.current = true;
    holdPlace(away.current);
    cover();
    Keyboard.dismiss();
  }, [placeNow, holdPlace, cover]);
  useFocusEffect(
    useCallback(() => {
      if (!left.current) return;
      left.current = false;
      holdPlace(away.current);
      uncover();
    }, [holdPlace, uncover]),
  );
  const openOptions = () =>
    info && isThread
      ? sheet.open(
          <ThreadOptions
            thread={info}
            mission={mission}
            onMission={() => openNewMission("", info.id)}
            onPins={openPins}
          />,
        )
      : sheet.open(
          <ChannelOptions
            channelId={channelId}
            title={title}
            {...(optionsLine ? { subtitle: optionsLine } : {})}
            leading={
              dm ? (
                <OpensAgent agentId={dm.with.id}>
                  <Face who={{ type: dm.with.type, id: dm.with.id }} size={36} live={false} />
                </OpensAgent>
              ) : (
                <Tile icon="hash" />
              )
            }
            agentId={dmAgentId}
            about={personDm ? <PersonStatusCard userId={personDm} /> : undefined}
            onPins={openPins}
            onMembers={channel && !dm ? openMembers : undefined}
            onSearch={dm && searchPlace ? openSearch : undefined}
          />,
        );
  // Holding the pill: "Trocar de conversa". The pick swaps the conversation in place (the route's params; the
  // screen is keyed by them), not a new screen sliding in: the slide made the header's pill jump at its end.
  // The swap waits for the sheet to finish closing (it lives in this screen, which the swap remounts).
  const hold = {
    onHold: () => {
      let picked: string | null = null;
      sheet.open(
        <ConversationSwitcher
          channelId={channelId}
          onPick={(id) => {
            picked = id === channelId ? null : id;
            sheet.close();
          }}
        />,
        {
          onClose: () => {
            const id = picked;
            // `onClose` runs as the sheet starts leaving: the swap waits for it to slide away.
            if (id) setTimeout(() => router.setParams({ channelId: id, thread: "", handoff: "" }), SHEET_LEAVE_MS);
          },
        },
      );
    },
    holdHint: t("mobile.chat.switchHint"),
  };
  const pill =
    isThread && info ? (
      <HeaderPill
        lead={<Icon name="reply" size={18} color={c.muted} />}
        title={title}
        subtitle={subtitle}
        onPress={openOptions}
        {...hold}
        label={t("mobile.chat.headerChannel", { who: who(title, subtitle ?? "") })}
      />
    ) : dm ? (
      <HeaderPill
        lead={
          dmAgentId ? (
            <AgentFace
              agentId={dmAgentId}
              size={32}
              framed={false}
              mode={dmDoing ? "run" : "idle"}
              presence
              ring={c.glassSolid}
            />
          ) : (
            <Face who={{ type: dm.with.type, id: dm.with.id }} size={32} live={false} presence ring={c.glassSolid} />
          )
        }
        title={dm.with.name}
        subtitle={dmLine ?? dmDoing ?? subtitle}
        color={dmAgentId ? agentLook(dmAgent).color : undefined}
        working={Boolean(dmDoing)}
        // Reading far up, only the face stays (the screen is the messages); a new reply opens it again.
        collapsed={far && unseen.messages === 0}
        extraActions={(dmAgentId ? 1 : 0) + (queueShown ? 1 : 0) + (agentTasks ? tasksBadge(agentTasks).room : 0)}
        onPress={dmAgentId ? () => router.push(`/agent/${dmAgentId}`) : openOptions}
        {...hold}
        label={
          dmAgentId
            ? t("mobile.chat.headerAgent", { who: who(dm.with.name, dmLine ?? dmDoing ?? subtitle ?? "") })
            : t("mobile.chat.headerChannel", { who: who(dm.with.name, dmLine ?? "") })
        }
      />
    ) : channel ? (
      <HeaderPill
        lead={<Icon name="hash" size={18} color={c.muted} />}
        title={channel.name}
        subtitle={roster.data ? t("mobile.chat.here", { count: roster.data.length }) : undefined}
        // The channel's sky in the pill, as an agent's DM: the color of the first agent in it.
        color={agentLook(dir.agentById.get(roster.data?.find((r) => r.type === "agent")?.id ?? "")).color}
        trailing={
          roster.data && roster.data.length > 0 ? (
            <View style={styles.faces}>
              {roster.data.slice(0, 3).map((r, i) => (
                // Every face the same size and shape box, ringed in the pill's glass: an agent in its tile
                // (its body alone stood lower than a person's circle), a person in a circle.
                <View
                  key={`${r.type}:${r.id}`}
                  style={[
                    styles.pillFace,
                    i > 0 && styles.pillOverlap,
                    { borderColor: c.glassSolid },
                    r.type !== "agent" && styles.round,
                  ]}
                >
                  <Face who={r} size={20} live={false} />
                </View>
              ))}
            </View>
          ) : undefined
        }
        onPress={openMembers}
        extraActions={(queueShown ? 1 : 0) + (searchPlace ? 1 : 0)}
        {...hold}
        label={t("mobile.chat.headerChannel", { who: who(title, subtitle ?? "") })}
      />
    ) : null;
  // An agent's DM also opens its tasks while it has some (ADR 0128), pushed like a thread, and its computer (as the
  // web's DM header) for whoever may watch it: one entry, the line while turns wait for the computer (the way on to
  // it inside), else the computer.
  const dmComputer = dmAgentId && !isThread && !rightHand ? { agentId: dmAgentId, onOpen: leavePlace } : undefined;
  const right =
    (isThread && info) || dm || channel ? (
      <>
        {dmAgentId && agentTasks ? (
          <AgentTasksButton
            agentId={dmAgentId}
            view={agentTasks}
            onPress={() => {
              leavePlace();
              router.push(agentTasksHref(dmAgentId, { channelId, threadId }));
            }}
          />
        ) : null}
        {queueShown && barQueue && queueMachineId ? (
          dmComputer ? (
            <DmQueueButton
              agentId={dmComputer.agentId}
              queue={barQueue}
              onPress={() => openQueue(queueMachineId, dmComputer)}
            />
          ) : (
            <QueueButton queue={barQueue} onPress={() => openQueue(queueMachineId)} />
          )
        ) : dmComputer ? (
          <DmComputerButton agentId={dmComputer.agentId} onOpen={leavePlace} />
        ) : null}
        {/* A DM searches from its "…" (its name and the agent's own buttons keep the room). */}
        {searchPlace && !dm ? (
          <IconButton icon="search" label={t("searchPage.searchHere")} onPress={openSearch} />
        ) : null}
        <IconButton icon="more" label={t("mobile.chat.options")} onPress={openOptions} />
      </>
    ) : null;

  const placeholder = isThread
    ? rootTask
      ? // One line on the phone: the tip after "·" in the web's placeholder doesn't fit.
        t("issues.comment")
      : t("mobile.chat.reply")
    : dm
      ? // One line on the phone: the right hand's "nada muda sem você" doesn't fit beside its name.
        t("mobile.chat.messageTo", { name: dm.with.name })
      : t("mobile.chat.messageIn", { channel: channel ? `#${channel.name}` : "" });
  // What to say next comes from the latest card: a code change, a file; none
  // while the agent works, asks or waits for an approval.
  const people = useMemo(
    () => [...dir.memberById.values()].map((p) => ({ id: p.userId, name: p.name })),
    [dir.memberById],
  );
  const suggestions = useMemo(
    () =>
      composerSuggestions({ messages: list, meId, people }).map((x) => ({
        icon: x.icon,
        label: t(`mobile.chat.intent.suggest.${x.key}`, x.values ?? {}),
      })),
    [list, meId, people, t],
  );
  rowsRef.current = rows;
  const pinned = mission && isOpenMission(mission) ? mission : null;
  // Something is pinned here: its lines wait above the first message (`PinnedLines`).
  const pinsData = usePins(orgId, channelId, member).data;
  const hasPins = useMemo(() => pinsIn(pinsData ?? [], threadId).length > 0, [pinsData, threadId]);

  // ── Agents' receipts and "no AI" ──
  // One receipt on screen (`receiptMessageId`): a mark beside my bubble, or at the end of the name line of someone
  // else's turn; a line under the message only for what asks something of you.
  const receiptId = useMemo(() => receiptMessageId(shownMessages, live.receipts), [shownMessages, live.receipts]);
  const receiptMine = Boolean(meId && shownMessages.find((m) => m.id === receiptId)?.author.id === meId);
  // Someone else's message sent into a task at work says nothing here (mine wears it: `ReceiptMark`).
  const receiptSteered = useSteerState(orgId, channelId, receiptId && !receiptMine ? receiptId : "") !== null;
  const markAt = useMemo(
    () => (!receiptId || receiptSteered ? null : receiptMine ? receiptId : turnHeadId(rows, receiptId)),
    [receiptId, receiptSteered, receiptMine, rows],
  );
  // The line redraws when what it shows changes, not on every event that touches the receipt (typing).
  const receiptNow = receiptId ? live.receipts[receiptId] : undefined;
  const receiptKey = receiptNow
    ? JSON.stringify([
        receiptNow.agents,
        receiptNow.routed,
        receiptNow.noAi ?? null,
        receiptNow.blocked ?? null,
        receiptNow.referenced ?? null,
        receiptNow.mentioned ?? null,
        receiptNow.picking ?? null,
        receiptNow.mentionNeeded ?? null,
        receiptNow.decidedBy ?? null,
      ])
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `receiptKey` stands for the receipt
  const receipt = useMemo(() => receiptNow, [receiptKey]);
  // Agents' messages that called several agents: their strip (`FanStrip`). Only their receipts redraw the list.
  const fanNow = shownMessages
    .filter((m) => m.author.type === "agent" && m.mentionedAgentIds.length > 1)
    .map((m) => [m.id, live.receipts[m.id]] as const);
  const fanKey = JSON.stringify(fanNow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fanKey` stands for the receipts
  const receipts: ReceiptsState = useMemo(() => Object.fromEntries(fanNow.filter(([, r]) => r)), [fanKey]);
  // Above the box: an agent here without an AI, or the whole workspace without one (as on the web).
  const aiStatus = useAiStatus(orgId);
  const planHeld = usePlanHold(orgId, org) !== null;
  // The right hand's greeting says it itself (its Connect AI card).
  const banner =
    member && !rightHand && !planHeld && !setupIntro
      ? noAiBanner(aiStatus.data, {
          agentIds: dmAgentId ? [dmAgentId] : channelAgents,
          dmAgentId,
          cardShown: endsOnNoAiCard(shownMessages),
        })
      : null;
  const connectInline = banner === null;
  // A thread opens on its root the channel holds (`isPlaceholderData`) when it has no replies to wait for.
  const loading = isThread
    ? threadMessages.isLoading || (threadMessages.isPlaceholderData && (thread.data?.replyCount ?? 1) > 0)
    : top.isLoading;

  // ── Asking for notifications where it makes sense ──
  // Right after an agent says it will take a while (a long work it is still on, ADR 0121), once, under that
  // message: "Quer saber quando a Dora terminar?" with Avisar. Only while the app may still ask (the person
  // hasn't answered the system yet), and never twice on this screen.
  const push = usePush();
  const longWorkAt = useMemo(() => {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m && m.author.type === "agent" && m.longWork && !workIsOver(m.longWork)) return m.id;
    }
    return null;
  }, [list]);
  const [offerAt, setOfferAt] = useState<string | null>(null);
  const { markOffered } = push;
  const mayOffer = push.offer.answer && member;
  useEffect(() => {
    if (offerAt || !longWorkAt || !mayOffer) return;
    setOfferAt(longWorkAt);
    // Counted as offered once it shows: the home's own ask waits its turn after this one.
    markOffered();
  }, [offerAt, longWorkAt, mayOffer, markOffered]);

  // A message's own row (`renderItem` wraps it in the swipe and the menu).
  const rowOf = useCallback(
    (item: Extract<Row, { kind: "message" }>) => (
      <MessageRow
        message={item.message}
        grouped={item.grouped}
        newTurn={item.newTurn}
        run={runPosition(item.grouped, item.continued ?? false)}
        above={item.above}
        aboveThread={item.above && !isThread ? linkThreads.has(item.above.id) : false}
        meId={meId}
        thread={isThread ? undefined : linkThreads.get(item.message.id)}
        inThread={isThread}
        {...(onLongPress ? { onLongPress } : {})}
        onRetry={onRetry}
        onQuote={onQuote}
        receipt={item.message.id === markAt ? receipt : undefined}
        seenBy={item.message.id === seenId ? seenBy : undefined}
      />
    ),
    [isThread, linkThreads, meId, onLongPress, onRetry, onQuote, markAt, receipt, seenId, seenBy],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case "day":
          return (
            <Text variant="footnote" tone="faint" style={[styles.day, { marginTop: rhythm.turn }]}>
              {when.day(item.iso)}
            </Text>
          );
        case "marker":
          return (
            <Text variant="footnote" tone="faint" style={[styles.day, { marginTop: rhythm.turn }]}>
              {item.text}
            </Text>
          );
        case "wait":
          return <QueueWaitRow channelId={channelId} wait={item.wait} />;
        case "unseen":
          return <UnseenLine fading={item.fading} />;
        case "browser": {
          const agentId = item.run ? item.run.agentId : item.handoff.agentId;
          return (
            <Animated.View
              entering={isFresh(item.key) ? ENTER : undefined}
              style={[styles.browserRow, { paddingLeft: quiet, marginTop: rhythm.turn }]}
            >
              {item.run ? (
                <BrowserRunCard
                  run={item.run}
                  open={openBrowsers.has(agentId)}
                  onToggle={(open) => toggleBrowser(agentId, open)}
                />
              ) : (
                <BrowserCard
                  agentId={agentId}
                  handoff={item.handoff}
                  open={openBrowsers.has(agentId)}
                  onToggle={(open) => toggleBrowser(agentId, open)}
                />
              )}
            </Animated.View>
          );
        }
        case "message":
          // What reached an agent's conversation (a routine's report, another agent's answer) and a routine
          // that ran in the background: quiet lines, never a person's or the agent's own voice.
          if (isEventLine(item.message.meta))
            return (
              <EventLine
                message={item.message}
                fold={consultFolds.get(item.message.id)}
                gap={item.afterLine ? rhythm.part : rhythm.turn}
              />
            );
          // An agent took an issue made from this conversation: one quiet line, not a voice.
          if (issueTakenOf(item.message.meta))
            return <IssueTakenLine message={item.message} gap={item.afterLine ? rhythm.part : rhythm.turn} />;
          return (
            // New, it rises in, an agent's reply too: it shows whole, once, with nothing drawn before it to replace.
            <Animated.View
              entering={isFresh(item.key) ? ENTER : undefined}
              style={item.message.id === flashId ? { backgroundColor: c.sunken } : undefined}
            >
              {/* Swipe right to answer it (a quote above the field); hold it for the system's menu (iOS) or the
                  app's sheet. A message still on its way has neither. */}
              <SwipeReply enabled={canReply && !item.message.local} onReply={() => onReply(item.message)}>
                {NATIVE_MENU && !item.message.local ? (
                  <MessageMenuFor
                    context={menuOf(item.message)}
                    href={chatHref(item.message.channelId, item.message.threadId, item.message.id)}
                  >
                    {/* One plain view for the menu to lift (the row can be a fragment: a pair row, a quote). */}
                    <View collapsable={false}>{rowOf(item)}</View>
                  </MessageMenuFor>
                ) : (
                  rowOf(item)
                )}
              </SwipeReply>
              {item.message.author.type === "agent" && item.message.mentionedAgentIds.length > 1 ? (
                <FanStrip message={item.message} receipt={receipts[item.message.id]} />
              ) : null}
              {item.message.id === receiptId ? (
                <AgentReceiptLine
                  message={item.message}
                  receipt={receipt}
                  mine={item.message.author.id === meId}
                  connectInline={connectInline}
                  onRetry={onResend}
                />
              ) : null}
              {item.message.id === offerAt ? (
                <PushOfferLine agent={dir.nameOf(item.message.author)} onDone={() => setOfferAt(OFFER_DONE)} />
              ) : null}
            </Animated.View>
          );
      }
    },
    [
      when,
      rhythm,
      quiet,
      meId,
      channelId,
      isFresh,
      openBrowsers,
      toggleBrowser,
      receiptId,
      receipt,
      connectInline,
      onResend,
      consultFolds,
      flashId,
      c.sunken,
      receipts,
      rowOf,
      canReply,
      onReply,
      menuOf,
      offerAt,
      dir,
    ],
  );

  // Pushes about this conversation stay quiet while it is on screen (no banner, no buzz), and so does the island.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    // The release clears it only if it still holds this screen's conversation (the next screen may have
    // taken over before this one's blur).
    return holdOpenConversation({ orgId, channelId, threadId });
  }, [focused, orgId, channelId, threadId]);
  // "Falar com o Theo" from two agents' conversation: "@theo " in this field, once this screen is in view again.
  const composerRequest = useComposerRequest(channelId);
  const prefill = focused ? composerRequest : null;
  useEffect(() => {
    if (prefill) takeComposerRequest(prefill.at);
  }, [prefill]);

  // ── Composer and keyboard ──
  // The composer floats over the list's bottom and rides the keyboard (KeyboardStickyView); the list's end
  // inset is the composer's height plus the keyboard, moved on the UI thread frame by frame (also while the
  // keyboard is dragged down interactively).
  const composerRef = useRef<ComponentRef<typeof View>>(null);
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(listRef, composerRef);
  const [composerHeight, setComposerHeight] = useState(0);
  const onComposerBoxLayout = (e: LayoutChangeEvent) => {
    onComposerLayout(e);
    setComposerHeight(e.nativeEvent.layout.height);
  };
  const bottomPad = Math.max(insets.bottom, 10);
  // The header floats over the conversation (glass on iOS 26, a blur before; round plates on Android), which
  // fades under it.
  // Peeked at from the list (iOS's long press): no bar over it and no composer, so no room for either.
  const barHeight = useHeaderHeight();
  const headerHeight = peeking ? 0 : barHeight;
  const lift = Math.max(0, bottomPad - KEYBOARD_GAP);
  const showList = !loading && !(rows.length === 0 && runs.length === 0);
  // The conversation starts below the clear bar by our own padding, on both platforms (the pinned card, when there
  // is one, already holds that room). iOS's automatic inset made keyboard moves land short at the end.
  const hasPin = pinned !== null;
  // The conversation's first message is loaded (a thread loads whole): what sits above it can show.
  const atStart = isThread || olderDone || (top.data?.length ?? 0) < MESSAGES_PAGE;
  const listPad = useMemo(
    () => (hasPin ? styles.listPad : [styles.listPad, { paddingTop: headerHeight + 8 }]),
    [hasPin, headerHeight],
  );

  // ── Requests out of view ──
  // A waiting request shows while 40 points of its card do in the list's band: below the floating header (a pinned
  // card already holds that room) and above the composer, which rides the keyboard less `lift` (its dock's offset).
  // Nothing is out of view before the list is placed at the end, so the line above the composer never flashes.
  const listFrame = useRef<ComponentRef<typeof View>>(null);
  const listPlaced = useRef(false);
  const askInsets = useCallback(() => {
    if (!listPlaced.current) return null;
    const keyboard = KeyboardController.isVisible() ? Math.max(0, KeyboardController.state().height - lift) : 0;
    return { top: hasPin ? 0 : headerHeight, bottom: composerHeight + keyboard };
  }, [hasPin, headerHeight, composerHeight, lift]);
  // A row the list doesn't draw now (outside what it keeps mounted) has no card: its request is out of view.
  const askDrawn = useCallback((messageId: string) => {
    const state = listRef.current?.getState();
    const key = rowsRef.current.find((r) => r.kind === "message" && r.message.id === messageId)?.key;
    const index = state && key !== undefined ? state.indexByKey(key) : undefined;
    return state !== undefined && index !== undefined && index >= state.startBuffered && index <= state.endBuffered;
  }, []);
  const watchList = useAskWatch(asks, { frame: () => listFrame.current, insets: askInsets, drawn: askDrawn });
  const onListScroll = useCallback(() => {
    watchList();
    const state = listRef.current?.getState();
    if (state) setFar(screenAboveEnd(state.distanceFromEnd, state.scrollLength));
  }, [watchList]);

  // The list shows once it sits at the end (no frame of it placing itself), as Bluesky's and Expensify's do; from
  // a little opacity, not none, so the glass inside rows keeps drawing.
  const listShown = useSharedValue(0.05);
  const listFade = useAnimatedStyle(() => ({ opacity: listShown.value }));
  const revealList = useCallback(() => {
    listShown.value = withTiming(1, { duration: 160 });
    listPlaced.current = true;
    watchList();
  }, [listShown, watchList]);
  useEffect(() => {
    if (!showList) return;
    const timer = setTimeout(revealList, SHOW_LIST_MS);
    return () => clearTimeout(timer);
  }, [showList, revealList]);

  // Whether the list follows the end (its own intent: kept through a drag's momentum and while a scroll to the end
  // lands, released by reading up, rearmed back near the end): the "new messages" button shows otherwise.
  useEffect(() => {
    if (!showList) return;
    const state = listRef.current?.getState();
    if (!state) return;
    // A new list opens at the end (initialScrollAtEnd); only changes count from here, so the button never
    // flashes on open.
    setAtEnd(true);
    return state.listen("isFollowingEnd", setAtEnd);
  }, [showList]);

  // "Última mensagem lida" with something unread: it opens at the "Novas" line, kept as it was on opening because
  // reading moves it. Threads open at their end.
  // Read as the lists arrive: a notification can open it before them.
  const readFrom = useRef<{ at: string | null | undefined } | null | undefined>(undefined);
  if (readFrom.current === undefined && (channel || dm))
    readFrom.current =
      !isThread && opensAtLastRead(org?.chatPrefs, channel?.unreadCount ?? dm?.unread ?? 0)
        ? { at: channel?.lastReadAt ?? dm?.lastReadAt }
        : null;
  const atReadDone = useRef(false);
  useEffect(() => {
    const from = readFrom.current;
    if (atReadDone.current || !from || !showList || !top.data || rows.length === 0) return;
    const id = firstUnreadId(list, from.at, meId);
    const key = rows.find((r) => r.kind === "message" && r.message.id === id)?.key;
    // A page kept from an earlier visit has none of them: wait for the fresh one.
    atReadDone.current = Boolean(key) || !top.isFetching;
    if (!key) return;
    setDivider({ beforeKey: key, fading: false });
    setReached(false);
    holdAt(id ?? undefined, 0, false);
  }, [showList, top.data, top.isFetching, rows, list, meId, holdAt]);

  // ── Reading from the top ──
  // A message someone else wrote (an agent's reply, also while it streams, or a teammate's) taller than the room
  // between the bar and the box lands once with its first line under the bar, as on the web (`readingLanding`),
  // and the list stops following the end, so it reads top to bottom. Reaching the end, sending or the pill
  // follow again. Rows there when the conversation opens, and one arriving while the person reads above, never
  // move it.
  const landedRef = useRef(new Set<string>());
  const toReadRef = useRef<string | null>(null);
  const readPrevRef = useRef<string[]>([]);
  useEffect(() => {
    const byKey = new Map(scrollRows.map((r) => [r.key, r]));
    for (const key of appendedKeys(readPrevRef.current, rowKeys)) {
      const r = byKey.get(key);
      if (!r || r.kind === "other") continue;
      // Your own message goes to the end as always; what was waiting to be read before it no longer jumps.
      toReadRef.current = r.mine || landedRef.current.has(key) ? null : key;
    }
    readPrevRef.current = rowKeys;
  }, [rowKeys, scrollRows]);
  const readRoom = headerHeight + 8;
  const checkReading = useCallback(() => {
    const key = toReadRef.current;
    const state = listRef.current?.getState();
    if (!key || !state) return;
    const index = state.indexByKey(key);
    if (index === undefined) return;
    if (state.sizeAtIndex(index) <= state.scrollLength - readRoom - composerHeight) return;
    toReadRef.current = null;
    landedRef.current.add(key);
    if (!atEndRef.current) return;
    setReadHold(true);
    // After the render that turns following off, so the end doesn't pull it back down.
    requestAnimationFrame(() => {
      void listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0, viewOffset: readRoom });
    });
  }, [readRoom, composerHeight]);
  useEffect(() => {
    if (!showList) return;
    const state = listRef.current?.getState();
    if (!state) return;
    return state.listen("totalSize", checkReading);
  }, [showList, checkReading]);
  // Rows growing or shrinking (a reply streaming, a card opening) move the waiting requests' cards and the live rows.
  useEffect(() => {
    if (!showList) return;
    const state = listRef.current?.getState();
    if (!state) return;
    return state.listen("totalSize", watchList);
  }, [showList, watchList]);
  // The person scrolled down to the end of what they were reading: the list follows again.
  const releaseAtEnd = useCallback(() => {
    const state = listRef.current?.getState();
    if (state && state.distanceFromEnd <= READ_RELEASE_PX) setReadHold(false);
  }, []);

  return (
    <AskStoreProvider store={asks}>
      <AskProbes messages={shownMessages} />
      <View style={[styles.screen, { backgroundColor: c.bg }]}>
        {/* A clear bar on every conversation (DM, channel, thread): the band behind it is ours, below, so the
            system's scroll edge never makes one look different from another. */}
        <PushedHeader title={pill ?? title} plate solid={false} right={right} />
        {hasPin ? (
          // The bar is see-through (the conversation runs under it): an open mission's card starts below it. Pinned
          // messages have no bar here: they wait above the first message, revealed by pulling down (`PinnedLines`).
          <View style={{ backgroundColor: c.bg, paddingTop: headerHeight }}>
            {pinned ? (
              <View style={styles.pin}>
                <MissionCardView mission={pinned} pinned />
              </View>
            ) : null}
          </View>
        ) : null}
        {/* No `textInputNativeID`: with it the composer could stay down while the keyboard was up (iOS 26; Bluesky
            drops it too). The offset is whole points: a fractional one made the overscroll glitch. */}
        <KeyboardGestureArea
          style={styles.grow}
          interpolator="ios"
          offset={Math.round(Math.max(0, composerHeight - lift))}
        >
          {loading ? (
            <View style={[styles.center, { paddingBottom: composerHeight }]}>
              <Text tone="faint">{t("mobile.common.loading")}</Text>
            </View>
          ) : (
            <>
              {/* Mounted before the first message too: a list that appears while the keyboard is already up never
                  hears it open, and its first message landed under it. */}
              <Animated.View style={[styles.grow, listFade]}>
                {/* The list's frame, where the waiting requests' cards are measured from (never flattened away). */}
                <View ref={listFrame} collapsable={false} style={styles.grow} onLayout={watchList}>
                  <StickerStageContext.Provider value={stickers}>
                    <JumpToMessageContext.Provider value={jumpToMessage}>
                      <RowLookContext.Provider value={rowLook}>
                        <StoppedRunsContext.Provider value={stoppedRuns}>
                          <KeyboardAwareLegendList
                            ref={listRef}
                            style={styles.grow}
                            data={shownRows}
                            keyExtractor={rowKey}
                            getItemType={rowType}
                            renderItem={renderItem}
                            // The list redraws mounted rows only when this changes: what a row shows beyond its
                            // message (the thread link that loads after it, a held state) lives in `renderItem`'s
                            // dependencies.
                            extraData={renderItem}
                            estimatedItemSize={72}
                            // Opens at the latest message, short conversations sit at the bottom like any chat.
                            initialScrollAtEnd
                            alignItemsAtEnd
                            // New messages, a reply growing word by word and the working line keep the end in view,
                            // but only while the person is near it.
                            maintainScrollAtEnd={!readHold}
                            maintainScrollAtEndThreshold={STICK_TO_END_THRESHOLD}
                            // Older pages above and rows changing size keep what is on screen still.
                            maintainVisibleContentPosition
                            // Our own insets, never the system's (the keyboard library's advice for chat lists): the
                            // bar's room is the content's top padding, the indicator kept below the bar.
                            contentInsetAdjustmentBehavior="never"
                            automaticallyAdjustContentInsets={false}
                            scrollIndicatorInsets={{ top: headerHeight }}
                            // Still while a sheet or the agent's computer covers the conversation.
                            freeze={freeze}
                            onReady={revealList}
                            onStartReached={loadOlder}
                            // A look at the waiting requests' cards and the live rows, once a frame and only while
                            // there is one.
                            onScroll={onListScroll}
                            onViewableItemsChanged={onViewable}
                            viewabilityConfig={STICKER_VIEW}
                            onScrollBeginDrag={() => {
                              dragging.current = true;
                              showDay();
                            }}
                            onScrollEndDrag={() => {
                              releaseAtEnd();
                              hideDay();
                            }}
                            onMomentumScrollBegin={showDay}
                            onMomentumScrollEnd={() => {
                              releaseAtEnd();
                              hideDay();
                            }}
                            onStartReachedThreshold={0.5}
                            keyboardDismissMode="interactive"
                            keyboardShouldPersistTaps="handled"
                            keyboardOffset={lift}
                            contentInsetEndAdjustment={contentInsetEndAdjustment}
                            contentContainerStyle={listPad}
                            // At the conversation's start, once it is loaded: the pinned messages (pulling down past
                            // the first message reveals them), then the right hand's greeting or a new agent's
                            // checklist.
                            ListHeaderComponent={
                              atStart && (hasPins || (dmAgent && (rightHand || setupIntro))) ? (
                                <>
                                  {hasPins ? (
                                    <PinnedLines
                                      channelId={channelId}
                                      threadId={threadId}
                                      onOpen={openPins}
                                      onPick={goToPin}
                                    />
                                  ) : null}
                                  {dmAgent && rightHand ? (
                                    <RightHandIntro agent={dmAgent} channelId={channelId} waveFrom={waveFrom} />
                                  ) : dmAgent && setupIntro ? (
                                    <AgentSetupIntro agent={dmAgent} channelId={channelId} />
                                  ) : null}
                                </>
                              ) : undefined
                            }
                          />
                        </StoppedRunsContext.Provider>
                      </RowLookContext.Provider>
                    </JumpToMessageContext.Provider>
                  </StickerStageContext.Provider>
                  <DatePill day={topDay} shown={dayShown} top={hasPin ? 8 : headerHeight + 8} />
                </View>
              </Animated.View>
              {showList ? null : (
                // A conversation with nothing yet: the agent's first day or a quiet line, over the empty list.
                <View style={StyleSheet.absoluteFill}>
                  {dmAgent && rightHand ? (
                    <ScrollView contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: composerHeight }}>
                      <RightHandIntro agent={dmAgent} channelId={channelId} waveFrom={waveFrom} />
                    </ScrollView>
                  ) : dmAgent && setupIntro ? (
                    <ScrollView contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: composerHeight }}>
                      <AgentSetupIntro agent={dmAgent} channelId={channelId} />
                    </ScrollView>
                  ) : dmAgent && !isThread ? (
                    <FirstDay agent={dmAgent} bottomInset={composerHeight} keyboardLift={lift} onAsk={onSend} />
                  ) : channel && helloAgent && !dm && !isThread ? (
                    <ChannelHello
                      channelId={channelId}
                      channel={channel.name}
                      topic={channel.topic}
                      agents={[helloAgent, ...talkable.filter((a) => a.id !== helloAgent.id)]}
                      members={roster.data ?? []}
                      bottomInset={composerHeight}
                      keyboardLift={lift}
                      onAsk={onSend}
                    />
                  ) : (
                    <View style={[styles.center, { paddingBottom: composerHeight }]}>
                      {/* No button: the composer under it is the next step. */}
                      <FirstUse place="chat" size="panel" acts={member && channel?.can?.post !== false} />
                    </View>
                  )}
                </View>
              )}
            </>
          )}
          {!hasPin ? (
            // The conversation fades under the floating header, as it does under the box. Not under a pinned bar
            // or card: the list already starts below them, and a header-tall fade there was a dark band over the
            // first messages (the pinned bar's own hairline is the edge).
            <LinearGradient
              pointerEvents="none"
              colors={[c.bg, withOpacity(c.bg, 0.86), withOpacity(c.bg, 0)]}
              locations={[0, 0.62, 1]}
              style={[styles.topFade, { height: headerHeight + 28 }]}
            />
          ) : null}
          {channel && !dm && !isThread && member && showList ? (
            // The channel greets you under the bar, as the web's: a newcomer's #general, or the first channel of a day.
            <ChannelWelcome
              channelId={channelId}
              channelName={channel.name}
              messages={top.data}
              agentIds={channelAgents}
              top={headerHeight + 8}
            />
          ) : null}
          {/* Above the composer and its working line, riding the keyboard with them. */}
          <KeyboardStickyView
            offset={{ opened: lift }}
            style={[styles.jumpAt, { bottom: composerHeight + 10 }]}
            pointerEvents="box-none"
          >
            {showList && (readHold || (!atEnd && (far || unseen.messages > 0 || unseen.working.length > 0))) ? (
              <ToLatest unseen={unseen} onPress={toEnd} />
            ) : null}
          </KeyboardStickyView>
          {peeking ? null : (
            <KeyboardStickyView offset={{ opened: lift }} style={styles.composerDock}>
              <View
                ref={composerRef}
                onLayout={onComposerBoxLayout}
                style={[styles.composer, { paddingBottom: bottomPad }]}
              >
                {/* The conversation fades under the box: no hard edge above it. */}
                <LinearGradient
                  pointerEvents="none"
                  colors={[withOpacity(c.bg, 0), withOpacity(c.bg, 0.9), c.bg]}
                  locations={[0, 0.3, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <Connection status={realtime} />
                {banner ? <NoAiBanner banner={banner} /> : null}
                <UnavailableLines notices={notices} />
                {/* Who is working, right above the composer (as on the web), while they work; a request waiting out
                    of view takes the line, with "Ver" (and the working line's stop while one agent works). */}
                {member && awayAsk ? (
                  <AskBar
                    away={awayAsk}
                    onSee={seeAsk}
                    runs={runs}
                    consults={lineConsults}
                    canStop={canStop}
                    onStop={stopRun}
                  />
                ) : null}
                {member && !awayAsk ? (
                  <WorkingLine
                    runs={runs}
                    consults={lineConsults}
                    typing={typing}
                    onOpenBrowser={(agentId) => {
                      // The agent's browser card opens in the conversation (at the end), not another screen.
                      toggleBrowser(agentId, true);
                      toEnd();
                    }}
                    stop={lineStop}
                  />
                ) : null}
                {member && dmAgent && !canTalk(dmAgent) ? (
                  <AgentLocked agent={dmAgent} />
                ) : member && channel?.can?.post === false ? (
                  // The channel's exceptions keep me from sending here (ADR 0134): reading stays open.
                  <Text variant="footnote" tone="muted" style={styles.readOnly}>
                    {t("channel.perms.readOnlyComposer")}
                  </Text>
                ) : member ? (
                  <Composer
                    placeholder={placeholder}
                    onSend={onSend}
                    working={working}
                    // GIFs and stickers live in the "+", with the photos: the field only sends.
                    onPlus={openPlus}
                    media={null}
                    draftKey={threadId ? `${channelId}:${threadId}` : channelId}
                    inputNativeID={COMPOSER_INPUT_ID}
                    {...(suggestions.length > 0 ? { suggestions } : {})}
                    {...(dmAgentId && !isThread ? { face: <AgentFace agentId={dmAgentId} size={22} /> } : {})}
                    mentionAt={refQuery}
                    insertMention={insertRef}
                    prefill={prefill ?? captionBack}
                    focusAt={replyAt}
                    // Photos and files waiting to go (their caption is the field), then whom it answers.
                    banner={
                      pending.length > 0 || quote ? (
                        <>
                          <AttachmentStrip
                            files={pending}
                            onRemove={removePending}
                            onAdd={pending.length < MAX_PENDING ? openPlus : undefined}
                          />
                          {quote ? <QuoteBar name={dir.nameOf(quote.author)} onCancel={() => setQuote(null)} /> : null}
                        </>
                      ) : undefined
                    }
                    sendEmpty={pending.length > 0}
                    mention={({ query, sigil, pick }) =>
                      sigil === "#" ? (
                        <ChannelPicker query={query} pick={pick} />
                      ) : (
                        <MentionPicker
                          query={query}
                          pick={pick}
                          channelId={channelId}
                          members={mentionMembers}
                          everyone={offersEveryone(org, Boolean(dm))}
                        />
                      )
                    }
                    onType={(text) => sendTyping(threadId, text)}
                    voice={voice}
                  />
                ) : (
                  <>
                    {admin ? (
                      <Text variant="footnote" tone="muted" style={styles.readOnly}>
                        {t("channel.adminReading")}
                      </Text>
                    ) : null}
                    <Button
                      variant="primary"
                      wide
                      label={t("mobile.chat.join")}
                      disabled={join.isPending}
                      onPress={() => join.mutate()}
                    />
                  </>
                )}
              </View>
            </KeyboardStickyView>
          )}
        </KeyboardGestureArea>
      </View>
    </AskStoreProvider>
  );
}

/**
 * Back to the latest messages: a round button at the bottom right, right above the composer, as on the web.
 * It counts what arrived below, in red when one mentions me; its label says who spoke and who is writing.
 */
function ToLatest({ unseen, onPress }: { unseen: Unseen; onPress: () => void }) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const { colors, shadows, reducedMotion } = useTheme();
  const nameOf = (who: string) => {
    const at = who.indexOf(":");
    return dir.nameOf({ type: who.slice(0, at), id: who.slice(at + 1) });
  };
  const said = [
    unseen.messages > 0 ? t("mobile.chat.unseen.count", { count: unseen.messages }) : "",
    unseen.authors.length > 0 ? listNames(t, unseen.authors.map(nameOf)) : "",
    unseen.working.length > 0
      ? t("mobile.chat.unseen.working", { names: listNames(t, unseen.working.map(nameOf)) })
      : "",
    unseen.mentionsMe ? t("mobile.chat.unseen.mentionsYou") : "",
  ].filter(Boolean);
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(160)}
      exiting={reducedMotion ? undefined : FadeOut.duration(120)}
      pointerEvents="box-none"
    >
      <PressScale
        to={0.92}
        onPress={onPress}
        accessibilityRole="button"
        // A 40-point circle: 4 around it gives the 48 a thumb needs.
        hitSlop={4}
        accessibilityLabel={
          said.length > 0 ? t("mobile.chat.toLatestNew", { text: said.join(" · ") }) : t("mobile.chat.toLatest")
        }
        style={[styles.jump, { backgroundColor: colors.raised, boxShadow: `${shadows.e2}, ${shadows.top}` }]}
      >
        <View style={styles.jumpIcon}>
          <Icon name="down" size={20} color={colors.ink2} />
        </View>
      </PressScale>
      {unseen.messages > 0 ? (
        <View style={[styles.jumpCount, { borderColor: colors.bg }]} pointerEvents="none">
          <Count
            value={unseen.messages}
            size={11}
            inverted
            max={99}
            {...(unseen.mentionsMe ? { fill: colors.danger, color: colors.raised } : {})}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** "Novas": before the first message that arrived while the person read above; it fades once read. */
function UnseenLine({ fading }: { fading: boolean }) {
  const { t } = useTranslation();
  const rhythm = useRhythm();
  const c = useColors();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(fading ? 0 : 1, { duration: 600 });
  }, [fading, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.unseen, { marginTop: rhythm.turn }, style]} accessibilityRole="text">
      <Text variant="caption" style={[styles.unseenText, { color: c.agent }]}>
        {t("mobile.chat.unseen.divider")}
      </Text>
      <View style={[styles.unseenRule, { backgroundColor: c.agent }]} />
    </Animated.View>
  );
}

/**
 * The connection, above the composer: "Sem conexão. O que você mandar sai sozinho quando
 * voltar." while it is down (a quick reconnect says nothing), then "Conectado de novo" for a moment.
 */
function Connection({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation();
  const c = useColors();
  const reduced = useReducedMotion();
  const down = status === "reconnecting" || status === "closed";
  const [shown, setShown] = useState<"down" | "back" | null>(null);
  useEffect(() => {
    if (down) {
      const id = setTimeout(() => setShown("down"), OFFLINE_AFTER_MS);
      return () => clearTimeout(id);
    }
    if (status === "open") setShown((s) => (s === "down" ? "back" : s));
  }, [down, status]);
  useEffect(() => {
    if (shown !== "back") return;
    const id = setTimeout(() => setShown(null), BACK_ONLINE_MS);
    return () => clearTimeout(id);
  }, [shown]);
  if (!shown) return null;
  const back = shown === "back";
  return (
    <Animated.View
      key={shown}
      entering={reduced ? undefined : FadeInDown.duration(220)}
      exiting={reduced ? undefined : FadeOut.duration(160)}
      accessibilityLiveRegion="polite"
      style={[styles.conn, { backgroundColor: back ? withOpacity(c.ok, 0.14) : c.warnSoft }]}
    >
      {/* On the first line: the offline sentence wraps, and centred on both lines the icon floated between them. */}
      <LineIcon variant="small" name={back ? "check" : "wifi"} size={15} color={back ? c.ok : c.warn} />
      <Text variant="small" style={[styles.connText, { color: back ? c.ok : c.warn }]}>
        {back ? t("mobile.chat.connection.back") : t("mobile.chat.connection.down")}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  topFade: { position: "absolute", top: 0, left: 0, right: 0 },
  // Under the agent's words, like a card on its message.
  browserRow: { paddingRight: 16 },
  screen: { flex: 1 },
  grow: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  pin: { paddingHorizontal: 12, paddingBottom: 10 },
  day: { alignSelf: "center", textAlign: "center", fontWeight: "600" },
  listPad: { paddingTop: 8, paddingBottom: 8 },
  composer: { paddingHorizontal: 10, paddingTop: 6 },
  readOnly: { textAlign: "center", paddingHorizontal: 16, paddingVertical: 12 },
  composerDock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  jumpAt: { position: "absolute", right: 14 },
  jump: { width: 40, height: 40, borderRadius: 20 },
  jumpIcon: { flex: 1, alignItems: "center", justifyContent: "center" },
  jumpCount: { position: "absolute", top: -6, right: -6, borderWidth: 2, borderRadius: 999 },
  pillFace: { borderWidth: 2, borderRadius: 8 },
  pillOverlap: { marginLeft: -6 },
  unseen: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16 },
  unseenText: { fontWeight: "700" },
  unseenRule: { flex: 1, height: StyleSheet.hairlineWidth * 2, opacity: 0.45 },
  conn: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 4,
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    borderBottomLeftRadius: 3,
  },
  connText: { flexShrink: 1, fontWeight: "600" },
  faces: { flexDirection: "row" },
  round: { borderRadius: 12 },
});
