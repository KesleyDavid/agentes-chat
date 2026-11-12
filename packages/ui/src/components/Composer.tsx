import { Popover as RPopover } from "radix-ui";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { channelQuery, insertChannelRef } from "../channel-refs";
import { cx } from "../cx";
import { onScreenKeyboard } from "../device";
import { EDGE_ROOM, placeOverSelection } from "../floating";
import {
  applyFormat,
  FORMAT_KINDS,
  type FormatKind,
  formatShortcut,
  formatShortcutHint,
  insertText,
  type TextEdit,
} from "../format";
import { Icon, type IconName } from "../icons/Icon";
import { selectionRect } from "../selection-rect";
import { Button } from "./Button";
import { type EmojiPickerLabels, EmojiPickerPopover, type PickerTab } from "./EmojiPicker";
import { useAutoGrow, useLocked } from "./Field";
import { modKey } from "./Kbd";
import { PixelStop } from "./PixelMarks";
import { Spinner } from "./Skeleton";
import { useVoiceRecorder, type VoiceNotice, type VoiceTake, voiceRecordingSupported } from "./voice-recorder";

/** Names of the formatting buttons (also their tooltips, with the shortcut). */
export type ComposerFormatLabels = Record<FormatKind, string> & {
  /** Accessible name of the toolbar ("Formatação"). */
  toolbar: string;
  /** Put in `[…](https://)` when making a link with nothing selected ("texto"). */
  linkText?: string;
};

const FORMAT_ICON: Record<FormatKind, IconName> = {
  bold: "bold",
  italic: "italic",
  strike: "strike",
  code: "code",
  codeBlock: "codeBlock",
  link: "link",
  bulletList: "bulletList",
  numberedList: "numberedList",
  quote: "quote",
};
/** A hairline after these (inline styles | code | link | blocks). */
const FORMAT_GROUP_ENDS: FormatKind[] = ["strike", "codeBlock", "link"];

/** One "@" suggestion. `insert` is what goes after the "@" (the handle). */
export interface ComposerSuggestion {
  key: string;
  insert: string;
  label: string;
  /** "@ada · Agente · Dev". */
  description?: ReactNode;
  /** A small avatar. */
  leading?: ReactNode;
  /** "não está no canal". */
  note?: string;
  /** Consecutive items with the same group get a heading ("Neste canal", "No workspace"). */
  group?: string;
}

export interface ComposerMentions {
  /** Suggestions for what follows "@", already filtered and ordered. */
  search: (query: string) => ComposerSuggestion[];
  /** After an item was inserted (e.g. offer "Adicionar ao canal"). */
  onPick?: (item: ComposerSuggestion) => void;
  /** Accessible name of the list ("Pessoas e agentes"). */
  listLabel: string;
}

/** A "/" command: picking it runs `onPick` (or puts `insert` in the box). */
export interface ComposerCommand {
  key: string;
  /** "/relatório". */
  label: string;
  /** "Theo monta um documento". */
  description?: ReactNode;
  leading?: ReactNode;
  /** Text that replaces the box (e.g. "/relatório "). Defaults to `${label} `. */
  insert?: string;
  onPick?: () => void;
}

export interface ComposerCommands {
  list: ComposerCommand[];
  /** Accessible name of the menu ("Comandos"). */
  listLabel: string;
}

/** An agent is working here: with an empty box, send turns into stop (click or Esc stops right away). */
export interface ComposerWorking {
  /** "Parar o Theo". */
  stopLabel: string;
  /** The stop button's tooltip ("Parar o Theo · Esc"). */
  stopText?: ReactNode;
  onStop: () => void;
}

/** What a message sent while an agent works does: joins what it is doing, or stops it to be read now. */
export type SendChoice = "join" | "interrupt";

/** Enter sends with the current choice; ⌘/Ctrl+Enter (`alt`) with the other one. */
export const sendChoice = (current: SendChoice, alt: boolean): SendChoice =>
  alt ? (current === "join" ? "interrupt" : "join") : current;

/** The row above the box while an agent works and there is text: "Juntar ao que ele faz" / "Parar e mandar". */
export interface ComposerChoice {
  joinLabel: string;
  interruptLabel: string;
  /** Accessible name of the choice ("Ao mandar"). */
  label: string;
  /** Desktop hint next to it ("↵ junta · ⌘↵ para e manda"); `mod` is "⌘" or "Ctrl". */
  hint?: (choice: SendChoice, mod: string) => ReactNode;
}

/** Voice messages in the box: what it says, and what the app does with a recording (ADR 0100). */
export interface ComposerVoice {
  /** Where this recording would go: when it changes, one under way is dropped. */
  scope: string;
  /** Asked before the microphone opens: false stops there (the app says why). */
  allowed?: () => Promise<boolean>;
  onTake: (take: VoiceTake) => void;
  onNotice: (notice: VoiceNotice) => void;
  labels: {
    record: string;
    recording: string;
    pause: string;
    resume: string;
    discard: string;
    send: string;
    listen: string;
    stopListening: string;
    /** "Enter envia · Esc apaga". */
    keys: string;
    /** While holding the microphone. */
    keysHold: string;
    keysPaused: string;
    /** The last seconds, counting down: "faltam 13 s". */
    left: (seconds: number) => string;
  };
}

/** The clock counts down over the last seconds of the five minutes. */
const VOICE_LIMIT_S = 300;
const VOICE_COUNTDOWN_S = 15;

/** What takes its own click in the card; a click anywhere else in it belongs to the text box. */
const COMPOSER_CONTROLS = "button, a, input, select, textarea, label, canvas, [role='button'], [role='menuitem']";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called with the trimmed text on Enter (Shift+Enter adds a line) or the send button. While `working`
   * or with a `choice`, `opts.interrupt` says whether the person chose "Parar e mandar".
   */
  onSend: (text: string, opts?: { interrupt?: boolean }) => void;
  /** Accessible name of the text box, e.g. "Mensagem para #eng". */
  label: string;
  placeholder?: string;
  sendLabel: string;
  attachLabel?: string;
  onAttach?: () => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Lets the parent focus the box or insert text (e.g. "Chamar um agente"). */
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Esc in the box means something here (stopping an agent): a panel beside it doesn't close on it. */
  keepsEsc?: boolean;
  /** "@" autocomplete (combobox pattern on the text box). */
  mentions?: ComposerMentions;
  /** "/" at the start of the box opens these commands (same combobox). */
  commands?: ComposerCommands;
  /** `[[` autocompletes (e.g. wiki pages): `insert` is the title put inside `[[…]]`. */
  links?: ComposerMentions;
  /** "#" autocompletes channels: `insert` is the name put after the "#". */
  channels?: ComposerMentions;
  /** Context pills on a line above the text (the target agent, the active skill, a select of who answers). */
  pills?: ReactNode;
  /**
   * The pills open the text's own row instead, before attach, a hairline after them (a DM with an agent: its chip
   * is context, not a second line).
   */
  inlinePills?: boolean;
  /** The send button's tooltip, with the key hint ("Enviar ↵"). */
  sendText?: string;
  /** Formatting (bold, italic, lists…) in a bar that floats over selected text, and its ⌘/Ctrl shortcuts, writing Markdown. */
  format?: ComposerFormatLabels;
  /** The emoji button: the picker inserts at the caret. `button` names it ("Emoji"). */
  emoji?: EmojiPickerLabels & { button: string };
  /**
   * More tabs in the emoji button's picker, after Emojis (GIFs and stickers, ADR 0091): one picker with tabs, named
   * by `pickerLabels`. What a tab picks it sends itself.
   */
  pickerTabs?: PickerTab[];
  pickerLabels?: { dialog: string; tabs: string };
  /** Files picked with the attach button (when there is no `onAttach`), dropped on the box or pasted. */
  onFiles?: (files: File[]) => void;
  /** Inside the card, above the text (e.g. "Respondendo a Ana" with the quoted line). */
  header?: ReactNode;
  /** Inside the card, above the text's row (e.g. files being uploaded, as `ComposerFile`). */
  attachments?: ReactNode;
  /** Something is attached: the message may go without text. */
  canSendEmpty?: boolean;
  /** Not yet (e.g. uploads still running): Enter and the send button wait. */
  sendBlocked?: boolean;
  /** An agent is working in this conversation (send ↔ stop). */
  working?: ComposerWorking | null;
  /**
   * While an agent works here and there is text: the choice row above the box. Given on its own (without
   * `working`) to whoever may write but not stop it: they choose too, there is just no stop button.
   */
  choice?: ComposerChoice;
  /** The microphone: absent, there is none. */
  voice?: ComposerVoice;
}

/**
 * A file in the composer, as a tile beside the others: an image shows its
 * thumbnail (`preview`, a local object URL); the rest show the type, name and
 * `detail` (the size). A spinner while it uploads, remove.
 */
export function ComposerFile({
  name,
  icon = "file",
  preview,
  detail,
  status,
  statusLabel,
  removeLabel,
  onRemove,
}: {
  name: string;
  icon?: IconName;
  /** An image's thumbnail URL. */
  preview?: string;
  /** Under the name ("1,2 MB"). */
  detail?: string;
  status: "uploading" | "done" | "failed";
  /** Read with the name ("enviando…", "não enviado"). */
  statusLabel?: string;
  /** "Remover relatorio.pdf". */
  removeLabel: string;
  onRemove: () => void;
}) {
  const remove = (
    <button type="button" className="ac-composer__file-remove" aria-label={removeLabel} onClick={onRemove}>
      <Icon name="close" size={14} />
    </button>
  );
  if (preview) {
    return (
      <span
        className="ac-composer__file ac-composer__file--image"
        data-status={status}
        aria-busy={status === "uploading" || undefined}
        title={name}
      >
        <img src={preview} alt="" />
        <span className="ac-visually-hidden">{name}</span>
        {status !== "done" && (
          <span className="ac-composer__file-state" aria-hidden="true">
            {status === "uploading" ? <Spinner size={16} /> : <Icon name="alert" size={16} />}
          </span>
        )}
        {statusLabel && <span className="ac-visually-hidden">{statusLabel}</span>}
        {remove}
      </span>
    );
  }
  return (
    <span className="ac-composer__file" data-status={status} aria-busy={status === "uploading" || undefined}>
      <span className="ac-composer__file-icon">
        {status === "uploading" ? (
          <Spinner size={16} />
        ) : (
          <Icon name={status === "failed" ? "alert" : icon} size={18} />
        )}
      </span>
      <span className="ac-composer__file-text">
        <span className="ac-composer__file-name" title={name}>
          {name}
        </span>
        {(statusLabel || detail) && <span className="ac-composer__file-detail">{statusLabel ?? detail}</span>}
      </span>
      {remove}
    </span>
  );
}

/**
 * The formatting buttons, floating over the text selected in the box (`range`, null while nothing is): inside the
 * composer's card and placed from it, so it goes where the card goes, right after the text box for the Tab key. One tab stop, arrows move between them (toolbar pattern). Not in the page until the first selection, kept
 * after it to fade out.
 */
function FormatBar({
  labels,
  onFormat,
  range,
  value,
  field,
  card,
  barRef,
  onLeave,
}: {
  labels: ComposerFormatLabels;
  onFormat: (kind: FormatKind) => void;
  range: [number, number] | null;
  /** The box's text: the bar moves as the words do. */
  value: string;
  field: RefObject<HTMLTextAreaElement | null>;
  card: RefObject<HTMLDivElement | null>;
  barRef: RefObject<HTMLDivElement | null>;
  /** The focus left the bar, or Escape was pressed in it (`back`: to the text box). */
  onLeave: (to: EventTarget | null, back?: boolean) => void;
}) {
  const [focus, setFocus] = useState(0);
  const used = useRef(false);
  const open = range !== null;
  if (open) used.current = true;
  const start = range?.[0] ?? 0;
  const end = range?.[1] ?? 0;
  const mod = modKey();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is why it runs again, the words under it moved
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = barRef.current;
      const text = field.current;
      const column = card.current?.getBoundingClientRect();
      const origin = el?.offsetParent?.getBoundingClientRect();
      if (!el || !text || !column || !origin) return;
      el.style.maxWidth = `min(${column.width}px, 100vw - ${2 * EDGE_ROOM}px)`;
      // Its layout size: the entrance's transform would measure it smaller.
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const to = placeOverSelection(selectionRect(text, start, end), size, column, window.innerWidth);
      el.style.left = `${to.left - origin.left}px`;
      el.style.top = `${to.top - origin.top}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, start, end, value, field, card, barRef]);
  if (!used.current) return null;
  const move = (i: number) => {
    const next = (i + FORMAT_KINDS.length) % FORMAT_KINDS.length;
    setFocus(next);
    barRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  return (
    <div
      ref={barRef}
      className="ac-formatbar"
      role="toolbar"
      aria-label={labels.toolbar}
      data-open={open || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
      // Keep the text box's focus and selection, also on the room between the buttons.
      onMouseDown={(e) => e.preventDefault()}
      onBlur={(e) => onLeave(e.relatedTarget)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(focus + 1);
        else if (e.key === "ArrowLeft") move(focus - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(FORMAT_KINDS.length - 1);
        else if (e.key === "Escape") {
          e.stopPropagation();
          onLeave(null, true);
        } else return;
        e.preventDefault();
      }}
    >
      {FORMAT_KINDS.map((kind, i) => {
        const hint = formatShortcutHint(kind, mod);
        return (
          <span
            key={kind}
            className="ac-formatbar__item"
            data-group-end={FORMAT_GROUP_ENDS.includes(kind) || undefined}
          >
            <button
              type="button"
              className="ac-formatbar__btn"
              aria-label={labels[kind]}
              title={hint ? `${labels[kind]} (${hint})` : labels[kind]}
              tabIndex={i === focus ? 0 : -1}
              onFocus={() => setFocus(i)}
              onClick={() => onFormat(kind)}
            >
              <Icon name={FORMAT_ICON[kind]} size={16} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** "[[que" right before the caret (no "]]" or line break yet). */
export function linkQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("[[");
  if (at < 0) return null;
  const query = before.slice(at + 2);
  if (/[\]\n[]/.test(query) || query.length > 80) return null;
  return { start: at, query };
}

/** "@que" right before the caret (start of text or after a space or bracket). */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|[\s(])@([\p{L}\p{N}_-]{0,32})$/u);
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query };
}

/**
 * The placeholder on one line, whatever the box's width (a phone, a task's side panel): the tip after its " · " goes
 * when all of it doesn't fit, and what's left ends in "…" (CSS) if even that doesn't. Measured, not guessed from the
 * window, because a focused field never ends it in "…" (the browser drops the ellipsis while editing).
 */
function useOneLinePlaceholder(ref: RefObject<HTMLTextAreaElement | null>, placeholder: string | undefined) {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !placeholder?.includes(" · ")) return;
    const pen = document.createElement("canvas").getContext("2d");
    if (!pen) return;
    let live = true;
    const measure = () => {
      // Hidden (a closed panel): it keeps the last answer.
      if (!live || !el.clientWidth) return;
      const s = getComputedStyle(el);
      pen.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const room = el.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight);
      setFits(pen.measureText(placeholder).width + 2 <= room);
    };
    measure();
    // The web font may land after the first measure, a little wider than the fallback.
    void document.fonts?.ready.then(measure);
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    watch?.observe(el);
    return () => {
      live = false;
      watch?.disconnect();
    };
  }, [ref, placeholder]);
  return fits ? placeholder : placeholder?.split(" · ")[0];
}

/**
 * The chat message box, one row: attach and emoji, the text, the microphone and send (primary, icon only). The row
 * grows with the text, its buttons staying at the bottom. Formatting floats over selected text. Focus on the whole box.
 */
export function Composer({
  value,
  onChange,
  onSend,
  label,
  placeholder,
  sendLabel,
  attachLabel,
  onAttach,
  disabled: off,
  id,
  className,
  textareaRef,
  keepsEsc,
  mentions,
  commands,
  links,
  channels,
  pills,
  inlinePills,
  sendText,
  format,
  emoji,
  pickerTabs,
  pickerLabels,
  onFiles,
  header,
  attachments,
  canSendEmpty,
  sendBlocked,
  working,
  choice,
  voice,
}: ComposerProps) {
  const locked = useLocked();
  const disabled = off || locked;
  const ref = useRef<HTMLTextAreaElement>(null);
  const shownPlaceholder = useOneLinePlaceholder(ref, placeholder);
  const wave = useRef<HTMLCanvasElement>(null);
  const rec = useVoiceRecorder(voice, wave);
  const recording = rec.active;
  // The box keeps its height while recording, whatever was typed, attached or hidden: read as it starts.
  const [heldHeight, setHeldHeight] = useState<number | undefined>(undefined);
  const { discard } = rec;
  const scope = voice?.scope;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scope` is why it runs
  useEffect(() => () => discard(false), [scope, discard]);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // The text selected in the box, while the box (or the formatting bar over it) has the focus.
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const notePicked = (start: number, end: number) =>
    setSelected((was) => (start === end ? null : was?.[0] === start && was[1] === end ? was : [start, end]));
  const listId = useId();
  useImperativeHandle(textareaRef, () => ref.current as HTMLTextAreaElement, []);
  // The "@…" being typed, and the one the person closed with Esc.
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  // `[[que` being typed (wiki links).
  const [linkToken, setLinkToken] = useState<{ start: number; query: string } | null>(null);
  // "#que" being typed (channels).
  const [channelToken, setChannelToken] = useState<{ start: number; query: string } | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const caretAfter = useRef<number | null>(null);
  // A selection to restore after the text changes (formatting, an emoji).
  const selectAfter = useRef<[number, number] | null>(null);

  useAutoGrow(ref, value);
  // Once the text is in: the caret after an inserted mention, or a selection put back.
  useLayoutEffect(() => {
    // The box emptied without a keystroke (the message went out, a draft was cleared): no list stays open over it.
    if (!value) {
      setToken(null);
      setLinkToken(null);
      setChannelToken(null);
    }
    const el = ref.current;
    if (!el) return;
    if (caretAfter.current !== null) {
      el.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
    if (selectAfter.current) {
      el.focus();
      el.setSelectionRange(...selectAfter.current);
      selectAfter.current = null;
    }
  }, [value]);

  /** Replaces the text and selection (formatting, emoji), keeping the focus in the box. */
  const edit = (next: TextEdit) => {
    const el = ref.current;
    notePicked(next.start, next.end);
    if (next.value === value) {
      el?.focus();
      el?.setSelectionRange(next.start, next.end);
      return;
    }
    selectAfter.current = [next.start, next.end];
    onChange(next.value);
  };
  const selection = () => {
    const el = ref.current;
    return { start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length };
  };
  const applyKind = (kind: FormatKind) => {
    const { start, end } = selection();
    edit(applyFormat(value, start, end, kind, { link: format?.linkText }));
  };
  const insertEmoji = (e: string) => {
    const { start, end } = selection();
    edit(insertText(value, start, end, e));
  };
  const files = (list: FileList | null | undefined) => Array.from(list ?? []);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  // "/" commands: only while the box is just "/word" (no space yet).
  const slash = commands ? /^\/(\S*)$/.exec(value) : null;
  const slashItems: ComposerSuggestion[] =
    slash && dismissed !== -1
      ? (commands?.list
          .filter((c) => c.label.toLowerCase().includes((slash[1] ?? "").toLowerCase()))
          .map((c) => ({
            key: c.key,
            insert: c.insert ?? `${c.label} `,
            label: c.label,
            description: c.description,
            leading: c.leading,
          })) ?? [])
      : [];
  const mentionItems = mentions && token && token.start !== dismissed ? mentions.search(token.query) : [];
  const linkItems = links && linkToken && linkToken.start !== dismissed ? links.search(linkToken.query) : [];
  const channelItems =
    channels && channelToken && channelToken.start !== dismissed ? channels.search(channelToken.query) : [];
  const items =
    slashItems.length > 0
      ? slashItems
      : linkItems.length > 0
        ? linkItems
        : channelItems.length > 0
          ? channelItems
          : mentionItems;
  const isSlash = slashItems.length > 0;
  const isLink = !isSlash && linkItems.length > 0;
  const isChannel = !isSlash && !isLink && channelItems.length > 0;
  const open = items.length > 0;
  const current = Math.min(active, Math.max(0, items.length - 1));

  const track = (text: string, caret: number) => {
    if (links) {
      const nextLink = linkQuery(text, caret);
      if (nextLink?.start !== linkToken?.start || nextLink?.query !== linkToken?.query) {
        setLinkToken(nextLink);
        setActive(0);
      }
    }
    const nextChannel = channels ? channelQuery(text, caret) : null;
    if (channels && (nextChannel?.start !== channelToken?.start || nextChannel?.query !== channelToken?.query)) {
      setChannelToken(nextChannel);
      setActive(0);
    }
    if (!mentions) {
      if (channels && dismissed !== null && dismissed !== -1 && nextChannel?.start !== dismissed) setDismissed(null);
      return;
    }
    const next = mentionQuery(text, caret);
    if (next?.start !== token?.start || next?.query !== token?.query) {
      setToken(next);
      setActive(0);
    }
    // A closed "@" or "#" list stays closed while its token is still being typed.
    if (dismissed !== null && next?.start !== dismissed && nextChannel?.start !== dismissed) setDismissed(null);
  };

  const pick = (item: ComposerSuggestion) => {
    if (isSlash) {
      const command = commands?.list.find((c) => c.key === item.key);
      caretAfter.current = item.insert.length;
      onChange(item.insert);
      command?.onPick?.();
      return;
    }
    if (isLink && linkToken) {
      const end = linkToken.start + 2 + linkToken.query.length;
      const inserted = `[[${item.insert}]] `;
      const next = value.slice(0, linkToken.start) + inserted + value.slice(end).replace(/^\]\]\s?/, "");
      caretAfter.current = linkToken.start + inserted.length;
      setLinkToken(null);
      onChange(next);
      links?.onPick?.(item);
      return;
    }
    if (isChannel && channelToken) {
      const next = insertChannelRef(value, channelToken, item.insert);
      caretAfter.current = next.caret;
      setChannelToken(null);
      onChange(next.text);
      channels?.onPick?.(item);
      return;
    }
    if (!token) return;
    const caret = token.start + 1 + token.query.length;
    const inserted = `@${item.insert} `;
    const next = value.slice(0, token.start) + inserted + value.slice(caret).replace(/^ /, "");
    caretAfter.current = token.start + inserted.length;
    setToken(null);
    onChange(next);
    mentions?.onPick?.(item);
  };

  const ready = Boolean(value.trim() || canSendEmpty) && !disabled && !sendBlocked;
  // An agent at work and nothing to send: the send button is the stop button.
  const stopMode = Boolean(working) && !disabled && !value.trim() && !canSendEmpty && !recording;
  const showChoice = Boolean(choice) && Boolean(value.trim()) && !disabled;
  const [chosen, setChosen] = useState<SendChoice>("join");
  const [pressed, setPressed] = useState(false);
  // The press flash; cleared if the composer goes away first (a stop that ends the run unmounts it).
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(pressTimer.current ?? undefined), []);
  const press = () => {
    setPressed(true);
    clearTimeout(pressTimer.current ?? undefined);
    pressTimer.current = setTimeout(() => setPressed(false), 160);
  };
  const stop = () => {
    if (!working) return;
    press();
    working.onStop();
  };
  const send = (alt = false) => {
    if (recording) {
      void rec.send();
      return;
    }
    if (!ready) return;
    if (working || choice) onSend(value.trim(), { interrupt: showChoice && sendChoice(chosen, alt) === "interrupt" });
    else onSend(value.trim());
    setChosen("join");
    // Keep typing: focus stays in the box (also after clicking the send button).
    ref.current?.focus();
  };

  const dismiss = () =>
    setDismissed(
      isSlash
        ? -1
        : isLink
          ? (linkToken?.start ?? null)
          : isChannel
            ? (channelToken?.start ?? null)
            : (token?.start ?? null),
    );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // A layer above already closed on this Esc: the suggestions, or a card that opened under the pointer and left the
    // focus here. It is spent: it stops no agent, and the page's own Esc (an inbox reply closes on it) never sees it.
    if (e.key === "Escape" && e.defaultPrevented) {
      e.stopPropagation();
      return;
    }
    const kind = format ? formatShortcut(e) : null;
    if (kind) {
      // Also keeps ⌘K (link) from reaching the command palette.
      e.preventDefault();
      e.stopPropagation();
      applyKind(kind);
      return;
    }
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + items.length) % items.length);
        return;
      }
      const item = items[current];
      // The first Enter picks, even on a name typed in full ("oi @ada"): people press it to choose, and a message
      // holding only the name went out by mistake. With the list closed by the pick, the next Enter sends.
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (item) pick(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
    }
    // Esc in an empty box while an agent works: stop it right away.
    if (e.key === "Escape" && stopMode) {
      e.preventDefault();
      e.stopPropagation();
      stop();
      return;
    }
    // On-screen keyboards: Enter is a new line; the send button sends.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !onScreenKeyboard()) {
      e.preventDefault();
      send(e.metaKey || e.ctrlKey);
    }
  };

  useLayoutEffect(() => {
    if (recording) setHeldHeight(box.current?.offsetHeight);
    else setHeldHeight(undefined);
  }, [recording]);
  const hasMic = Boolean(voice) && !disabled && voiceRecordingSupported();
  const countdown = VOICE_LIMIT_S - rec.seconds;
  const voiceHint = !voice
    ? ""
    : recording && countdown <= VOICE_COUNTDOWN_S
      ? voice.labels.left(countdown)
      : rec.phase === "paused"
        ? voice.labels.keysPaused
        : rec.hold
          ? voice.labels.keysHold
          : voice.labels.keys;
  const micLabel = !voice
    ? ""
    : rec.phase === "paused"
      ? voice.labels.resume
      : rec.phase === "rec" && !rec.hold
        ? voice.labels.pause
        : voice.labels.record;

  const optionId = (i: number) => `${listId}-${i}`;
  const textarea = (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      aria-label={label}
      data-esc-own={keepsEsc ? "" : undefined}
      placeholder={shownPlaceholder}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (dismissed === -1 && !e.target.value.startsWith("/")) setDismissed(null);
        onChange(e.target.value);
        track(e.target.value, e.target.selectionStart ?? e.target.value.length);
        notePicked(e.target.selectionStart ?? 0, e.target.selectionEnd ?? 0);
      }}
      onSelect={(e) => {
        track(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
        notePicked(e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0);
      }}
      onFocus={(e) => notePicked(e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0)}
      // To the formatting bar (the Tab key): the selection is still what it formats.
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && bar.current?.contains(e.relatedTarget))) setSelected(null);
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        const pasted = files(e.clipboardData?.files);
        if (!onFiles || pasted.length === 0) return;
        e.preventDefault();
        onFiles(pasted);
      }}
      {...(mentions || commands || links || channels
        ? {
            role: "combobox",
            "aria-autocomplete": "list" as const,
            "aria-expanded": open,
            "aria-controls": open ? listId : undefined,
            "aria-activedescendant": open ? optionId(current) : undefined,
          }
        : {})}
    />
  );

  const choiceRow =
    showChoice && choice ? (
      <div className="ac-composer-choice">
        <div className="ac-seg ac-seg--sm" role="radiogroup" aria-label={choice.label}>
          {(["join", "interrupt"] as const).map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: a two-way segmented choice, styled like the app's other segments
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={chosen === c}
              data-on={chosen === c || undefined}
              className="ac-seg__item"
              // Keep the text box's focus and selection.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setChosen(c);
                ref.current?.focus();
              }}
            >
              {c === "join" ? <Icon name="arrowRight" size={14} /> : <Icon name="bolt" size={14} />}
              {c === "join" ? choice.joinLabel : choice.interruptLabel}
            </button>
          ))}
        </div>
        {choice.hint && (
          <span className="ac-composer-choice__hint" aria-hidden="true">
            {choice.hint(chosen, modKey())}
          </span>
        )}
      </div>
    ) : null;

  const sendTitle = stopMode
    ? typeof working?.stopText === "string"
      ? working.stopText
      : working?.stopLabel
    : sendText
      ? `${sendText} ↵`
      : undefined;

  return (
    <>
      {choiceRow}
      <RPopover.Root
        open={open}
        onOpenChange={(o) => {
          if (!o && open) dismiss();
        }}
      >
        <RPopover.Anchor asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: files dropped anywhere on the card (the attach button is the accessible way), and its empty room is part of the text box, as a mouse sees it */}
          <div
            ref={box}
            className={cx("ac-composer", inlinePills && "ac-composer--lead", className)}
            data-disabled={disabled || undefined}
            data-dragging={dragging || undefined}
            data-voice={recording ? rec.phase : undefined}
            data-esc-layer={recording || attachments ? "" : undefined}
            style={heldHeight ? { minHeight: heldHeight, maxHeight: heldHeight } : undefined}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest(COMPOSER_CONTROLS)) return;
              // Keeps the caret where it was.
              e.preventDefault();
              ref.current?.focus();
            }}
            onDragOver={
              onFiles
                ? (e) => {
                    if (!hasFiles(e) || disabled) return;
                    e.preventDefault();
                    setDragging(true);
                  }
                : undefined
            }
            onDragLeave={
              onFiles
                ? (e) => {
                    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
                      setDragging(false);
                  }
                : undefined
            }
            onDrop={
              onFiles
                ? (e) => {
                    setDragging(false);
                    const dropped = files(e.dataTransfer?.files);
                    if (dropped.length === 0 || disabled) return;
                    e.preventDefault();
                    onFiles(dropped);
                  }
                : undefined
            }
          >
            {header && <div className="ac-composer__header">{header}</div>}
            {pills && !inlinePills && <div className="ac-composer__pills">{pills}</div>}
            {attachments && <div className="ac-composer__attachments">{attachments}</div>}
            <div className="ac-composer__row">
              {pills && inlinePills && <div className="ac-composer__pills">{pills}</div>}
              <div className="ac-composer__tools">
                {voice && recording && (
                  <Button
                    variant="ghost"
                    iconOnly
                    size="sm"
                    icon="trash"
                    className="ac-composer__voice-trash"
                    aria-label={voice.labels.discard}
                    onClick={() => rec.discard(true)}
                  />
                )}
                {attachLabel && (
                  <Button
                    variant="ghost"
                    iconOnly
                    size="sm"
                    icon="attach"
                    aria-label={attachLabel}
                    onClick={onAttach ?? (onFiles ? () => fileInput.current?.click() : undefined)}
                    disabled={(!onAttach && !onFiles) || disabled}
                  />
                )}
                {onFiles && !onAttach && (
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    tabIndex={-1}
                    aria-label={attachLabel}
                    onChange={(e) => {
                      const picked = files(e.target.files);
                      e.target.value = "";
                      if (picked.length > 0) onFiles(picked);
                    }}
                  />
                )}
                {emoji && !disabled && (
                  <EmojiPickerPopover
                    labels={emoji}
                    onPick={insertEmoji}
                    tabs={pickerTabs}
                    tabLabels={pickerLabels}
                    align="start"
                    // Back to the text box (the caret after the emoji), not to the button.
                    onCloseAutoFocus={(e) => {
                      e.preventDefault();
                      ref.current?.focus();
                    }}
                    trigger={<Button variant="ghost" iconOnly size="sm" icon="smile" aria-label={emoji.button} />}
                  />
                )}
              </div>
              <div className="ac-composer__text">
                {textarea}
                {format && !disabled && (
                  <FormatBar
                    labels={format}
                    onFormat={applyKind}
                    range={recording || open ? null : selected}
                    value={value}
                    field={ref}
                    card={box}
                    barRef={bar}
                    onLeave={(to, back) => {
                      if (back) ref.current?.focus();
                      else if (to !== ref.current && !(to instanceof Node && bar.current?.contains(to)))
                        setSelected(null);
                    }}
                  />
                )}
                {voice && (
                  // biome-ignore lint/a11y/useSemanticElements: a recording's controls, named as one
                  <div className="ac-composer__voice" role="group" aria-label={voice.labels.recording}>
                    {rec.phase === "paused" ? (
                      <button
                        type="button"
                        className="ac-voice__play ac-composer__listen"
                        aria-label={rec.listening ? voice.labels.stopListening : voice.labels.listen}
                        onClick={() => void rec.toggleListening()}
                      >
                        <Icon name={rec.listening ? "pause" : "play"} size={14} />
                      </button>
                    ) : (
                      <span className="ac-composer__voice-dot" aria-hidden="true" />
                    )}
                    <span ref={rec.timer} className="ac-composer__voice-time">
                      0:00
                    </span>
                    <canvas ref={wave} className="ac-composer__wave" onPointerDown={rec.onWavePointerDown} />
                    {recording && (
                      <span
                        className="ac-composer__voice-hint"
                        data-left={countdown <= VOICE_COUNTDOWN_S || undefined}
                        aria-live="off"
                      >
                        {voiceHint}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="ac-composer__tools">
                {hasMic && (
                  <Button
                    variant="ghost"
                    iconOnly
                    size="sm"
                    icon={rec.phase === "rec" && !rec.hold ? "pause" : "mic"}
                    className="ac-composer__mic"
                    data-on={rec.phase === "rec" || rec.phase === "paused" || undefined}
                    aria-label={micLabel}
                    title={micLabel}
                    {...rec.micProps}
                  />
                )}
                {/* The compact primary square (32px): dim until there is something to send. */}
                {working !== undefined ? (
                  // An agent may work here: one button whose glyph morphs between send and stop.
                  <Button
                    variant="primary"
                    size="sm"
                    className="ac-composer__send ac-btn--icon"
                    data-ready={ready || stopMode || recording ? "" : undefined}
                    data-mode={stopMode ? "stop" : "send"}
                    data-press={pressed || undefined}
                    aria-label={recording && voice ? voice.labels.send : stopMode ? working?.stopLabel : sendLabel}
                    title={sendTitle}
                    onClick={() => {
                      if (stopMode) stop();
                      else {
                        press();
                        send();
                      }
                    }}
                    disabled={!ready && !stopMode && !recording}
                  >
                    <span className="ac-composer__glyph ac-composer__glyph--send" aria-hidden="true">
                      <Icon name="send" />
                    </span>
                    <span className="ac-composer__glyph ac-composer__glyph--stop" aria-hidden="true">
                      <PixelStop size={13} animated={stopMode} />
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    iconOnly
                    icon="send"
                    className="ac-composer__send"
                    data-ready={ready || recording ? "" : undefined}
                    aria-label={recording && voice ? voice.labels.send : sendLabel}
                    title={sendTitle}
                    onClick={() => send()}
                    disabled={!ready && !recording}
                  />
                )}
              </div>
            </div>
          </div>
        </RPopover.Anchor>
        {(mentions || commands || links || channels) && (
          <RPopover.Portal>
            <RPopover.Content
              className={cx("ac-menu ac-suggest", isSlash && "ac-suggest--commands")}
              side="top"
              align="start"
              sideOffset={6}
              collisionPadding={EDGE_ROOM}
              // Focus stays in the text box (combobox).
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onInteractOutside={(e) => {
                if (e.target instanceof Node && box.current?.contains(e.target)) e.preventDefault();
              }}
            >
              <div
                role="listbox"
                id={listId}
                aria-label={
                  isSlash
                    ? (commands?.listLabel ?? "")
                    : isLink
                      ? (links?.listLabel ?? "")
                      : isChannel
                        ? (channels?.listLabel ?? "")
                        : (mentions?.listLabel ?? "")
                }
              >
                {items.map((item, i) => {
                  const heading = item.group && item.group !== items[i - 1]?.group;
                  return (
                    <div key={item.key} role="presentation">
                      {heading && (
                        <div className="ac-menu__heading" role="presentation">
                          {item.group}
                        </div>
                      )}
                      <div
                        id={optionId(i)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={i === current}
                        data-active={i === current || undefined}
                        className="ac-menu__item ac-suggest__item"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          pick(item);
                        }}
                        onClick={() => pick(item)}
                        onKeyDown={() => {}}
                      >
                        {item.leading && (
                          <span className="ac-menu__leading" aria-hidden="true">
                            {item.leading}
                          </span>
                        )}
                        <span className="ac-menu__label">
                          <span>{item.label}</span>
                          {item.description && <span className="ac-menu__desc">{item.description}</span>}
                        </span>
                        {item.note && <span className="ac-suggest__note">{item.note}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </RPopover.Content>
          </RPopover.Portal>
        )}
      </RPopover.Root>
    </>
  );
}
