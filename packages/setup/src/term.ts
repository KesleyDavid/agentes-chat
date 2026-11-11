/**
 * The look every agentes.chat command line shares: the logo, a line down the left with a mark per step,
 * spinners and questions. The setup uses it, and so does the runner (`@agenteschat/setup/src/term`); the
 * installers draw the same marks in POSIX sh (term-sh.ts).
 *
 * It degrades on its own: no color with NO_COLOR, FORCE_COLOR=0 or TERM=dumb (Node's and Bun's
 * getColorDepth, which also picks 16, 256 or 24-bit color), ASCII marks and no logo where the font lacks
 * them (the Linux console, Windows consoles other than Windows Terminal), and no line, logo or animation
 * when the output isn't a terminal (logs, pipes, --json's stderr in a file).
 */
import { emitKeypressEvents } from "node:readline";

export type Depth = 1 | 4 | 8 | 24;

interface Out {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
  getColorDepth?(): number;
}

interface Key {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

type KeyListener = (text: string | undefined, key: Key | undefined) => void;

interface In {
  isTTY?: boolean;
  setRawMode?(raw: boolean): unknown;
  on(event: "keypress", fn: KeyListener): unknown;
  on(event: "data", fn: (data: Buffer) => void): unknown;
  off(event: "keypress", fn: KeyListener): unknown;
  off(event: "data", fn: (data: Buffer) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export interface TermOptions {
  out?: Out;
  /** Where a refusal goes when `out` isn't a terminal (default stderr). */
  err?: Out;
  input?: In;
  env?: Record<string, string | undefined>;
  platform?: string;
  /** Overrides, for tests. */
  depth?: Depth;
  unicode?: boolean;
  columns?: number;
  /** The program that started this one opened the frame (default: AGENTES_FRAME=1 in `env`): no logo, no ┌. */
  inherited?: boolean;
  now?: () => number;
  every?: (ms: number, tick: () => void) => () => void;
  /** Ctrl-C at a question or during a spinner, once the terminal is restored. */
  canceled?: () => never;
}

/** The fonts of the Linux console and of Windows' old console have no ◆ ◇ ◒ (the `is-unicode-supported` rule). */
export function unicodeTerminal(env: Record<string, string | undefined>, platform: string): boolean {
  if (platform !== "win32") return env.TERM !== "linux";
  return (
    Boolean(env.WT_SESSION) ||
    env.TERM_PROGRAM === "vscode" ||
    env.TERM === "xterm-256color" ||
    env.TERM === "alacritty" ||
    env.TERMINAL_EMULATOR === "JetBrains-JediTerm"
  );
}

const MARKS = {
  unicode: {
    start: "┌",
    bar: "│",
    end: "└",
    done: "◇",
    ask: "◆",
    info: "●",
    on: "●",
    off: "○",
    skip: "○",
    warn: "▲",
    fail: "■",
    spin: ["◒", "◐", "◓", "◑"],
    bullet: "·",
    mask: "▪",
    more: "…",
  },
  ascii: {
    start: "+",
    bar: "|",
    end: "+",
    done: "o",
    ask: "?",
    info: "*",
    on: ">",
    off: " ",
    skip: "-",
    warn: "!",
    fail: "x",
    spin: ["-", "\\", "|", "/"],
    bullet: "-",
    mask: "*",
    more: "...",
  },
};

/**
 * The sky blue of links, commands and the active marks: SKY_TONES[2] (#2b74e6) in 24-bit, about 4.4:1 on a
 * white terminal and 4.7:1 on a black one; xterm 32 (#0087d7) in 256 colors; the theme's bright blue in 16.
 */
const ACCENT: Record<Depth, string> = { 24: "38;2;43;116;230", 8: "38;5;32", 4: "94", 1: "" };
/** The badge: white on the agent blue (#0063d1, 5.7:1), whatever the terminal's background. */
const BADGE: Record<Depth, string> = { 24: "48;2;0;99;209;97", 8: "48;5;26;38;5;231", 4: "44;97", 1: "" };

/**
 * The logo's mark: the agent of packages/ui/src/agent/engine.js on the 12×12 grid the web's LogoMark dithers
 * (`ditherUrl("sky", 12)`): 0–4 its body tones (bodyTones("sky"), deep to light), w its eyes, . outside it.
 * A literal, since this package is MIT and the engine isn't: packages/ui/test/logo-mark.test.ts rebuilds it
 * from the engine (inBody, toneAt, eyeShapes) and compares.
 */
export const LOGO_MARK = [
  "..43434343..",
  ".3333333332.",
  "333333333233",
  "232323232223",
  "3232w23w3222",
  "2222w22w2212",
  "2222w22w2122",
  "121212121112",
  "212121212111",
  "111111111101",
  "11111111101.",
  "0101010100..",
];

/** The wordmark: "agentes" in pixels after Funnel Display Light at about 12 px (x-height 6, one-pixel strokes). */
const GLYPHS: Record<string, string[]> = {
  a: ["", "", "", ".###.", "....#", ".####", "#...#", "#...#", ".####", "", "", ""],
  g: ["", "", "", ".####", "#...#", "#...#", "#...#", "#...#", ".####", "....#", ".###.", ""],
  e: ["", "", "", ".###.", "#...#", "#####", "#....", "#....", ".####", "", "", ""],
  n: ["", "", "", "#.##.", "##..#", "#...#", "#...#", "#...#", "#...#", "", "", ""],
  t: ["", ".#..", ".#..", "####", ".#..", ".#..", ".#..", ".#..", "..##", "", "", ""],
  s: ["", "", "", ".####", "#....", ".###.", "....#", "....#", "####.", "", "", ""],
};

const TONE_RGB = ["0;61;130", "0;99;209", "70;147;232", "140;195;255", "198;225;255", "255;255;255"];
const TONE_256 = [25, 26, 68, 111, 189, 231];
/** 16 colors: blue for the deep tones, bright blue for the light ones, bright white for the eyes. */
const TONE_16 = [4, 4, 12, 12, 12, 15];

/** The SGR parameter for tone `t` (0–4, 5 the eyes) as foreground (38) or background (48). */
function toneSgr(depth: Depth, t: number, layer: 38 | 48): string {
  if (depth === 24) return `${layer};2;${TONE_RGB[t]}`;
  if (depth === 8) return `${layer};5;${TONE_256[t]}`;
  const n = TONE_16[t] ?? 4;
  return String((layer === 38 ? 30 : 40) + (n >= 8 ? 60 + n - 8 : n));
}

const toneOf = (pixel: string) => (pixel === "w" ? 5 : pixel === "." ? -1 : Number(pixel));

/** Two pixels in one character: ▀ with the top as its color and the bottom as its background. */
function halfBlock(depth: Depth, top: number, bottom: number): string {
  if (depth === 1) {
    // One color: the body, with its eyes left out (the mono logo).
    const t = top >= 0 && top < 5;
    const b = bottom >= 0 && bottom < 5;
    return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
  }
  if (top < 0 && bottom < 0) return " ";
  if (bottom < 0) return `\x1b[0;${toneSgr(depth, top, 38)}m▀`;
  if (top < 0) return `\x1b[0;${toneSgr(depth, bottom, 38)}m▄`;
  if (toneSgr(depth, top, 38) === toneSgr(depth, bottom, 38)) return `\x1b[0;${toneSgr(depth, top, 38)}m█`;
  return `\x1b[0;${toneSgr(depth, top, 38)};${toneSgr(depth, bottom, 48)}m▀`;
}

function wordRows(word: string): string[] {
  const rows = Array.from({ length: 12 }, () => "");
  [...word].forEach((ch, i) => {
    const glyph = GLYPHS[ch] ?? [];
    const w = Math.max(...glyph.map((r) => r.length));
    for (let y = 0; y < 12; y++) rows[y] += (glyph[y] ?? "").padEnd(w, ".") + (i < word.length - 1 ? "." : "");
  });
  return rows;
}

/** The logo's lines (63 columns): the mark in the sky's dither beside "agentes", ".chat" muted on the baseline. */
export function logoLines(depth: Depth): string[] {
  const word = wordRows("agentes");
  const lines: string[] = [];
  for (let y = 0; y < 12; y += 2) {
    const top = LOGO_MARK[y] as string;
    const bottom = LOGO_MARK[y + 1] as string;
    let mark = "";
    for (let x = 0; x < top.length; x++)
      mark += halfBlock(depth, toneOf(top[x] as string), toneOf(bottom[x] as string));
    const wt = word[y] as string;
    const wb = word[y + 1] as string;
    let letters = "";
    for (let x = 0; x < wt.length; x++) letters += halfBlock(1, wt[x] === "#" ? 0 : -1, wb[x] === "#" ? 0 : -1);
    const reset = depth === 1 ? "" : "\x1b[0m";
    const tld = y === 8 ? (depth === 1 ? " .chat" : " \x1b[2m.chat\x1b[0m") : "";
    lines.push(`  ${mark}${reset}   ${letters.trimEnd()}${tld}`.trimEnd());
  }
  return lines;
}

export const LOGO_WIDTH = 63;

// biome-ignore lint/suspicious/noControlCharactersInRegex: the colors' escapes are what it leaves out
const SGR = /\x1b\[[0-9;]*m/g;
/** Two columns on a terminal: East Asian wide and fullwidth characters (wcwidth's ranges), and emoji. */
const WIDE =
  /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u;
/** No column of their own: combining marks (variation selectors among them), zero-width spaces and joiners. */
const ZERO = /[\p{Mn}\p{Me}\p{Cf}]/u;

const columnsOf = (ch: string) => (WIDE.test(ch) ? 2 : ZERO.test(ch) ? 0 : 1);

/** The columns `text` takes on a terminal, its colors left out. */
export function visible(text: string): number {
  let columns = 0;
  for (const ch of text.replace(SGR, "")) columns += columnsOf(ch);
  return columns;
}

/** The rows `line` takes on a terminal `columns` wide: it folds, and a wide character that doesn't fit moves down. */
export function rowsOf(line: string, columns: number): number {
  let rows = 1;
  let at = 0;
  for (const ch of line.replace(SGR, "")) {
    const w = columnsOf(ch);
    if (at + w > columns) {
      rows++;
      at = 0;
    }
    at += w;
  }
  return rows;
}

/** `text` (colors left out) within `room` columns: cut at its end, or at its start to keep the end, with `more`. */
function cut(text: string, room: number, more: string, keepEnd = false): string {
  if (visible(text) <= room) return text;
  const chars = [...text.replace(SGR, "")];
  if (keepEnd) chars.reverse();
  const kept: string[] = [];
  let used = visible(more);
  for (const ch of chars) {
    used += columnsOf(ch);
    if (used > room) break;
    kept.push(ch);
  }
  return keepEnd ? `${more}${kept.reverse().join("")}` : `${kept.join("")}${more}`;
}

/** Words onto lines of `width` columns; a word longer than that (a URL) gets a line of its own, whole. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && visible(line) + 1 + visible(word) > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/** "12s", "1m 04s". */
export function elapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export interface Spinner {
  /** A new label, or a new line under it (a command's latest output; null clears it). */
  update(label: string | null, detail?: string | null): void;
  /** Done: the line becomes ◇ and `text`. */
  done(text: string, ...detail: string[]): void;
  /** Not done, but it goes on: ▲. */
  warn(text: string, ...detail: string[]): void;
  /** Failed: ■ (the error, then its fix). */
  fail(error: string, fix?: string): void;
}

export interface AskOptions {
  /** Shown before what's typed, and dim before the answer once answered. */
  label?: string;
  description?: string[];
  /** Taken on an empty Enter. */
  initial?: string;
  /** Dim in the empty field. */
  placeholder?: string;
  /** Typed as ▪, answered as a row of ▪ of one fixed length. */
  secret?: boolean;
  /** A problem with the answer (shown under it), or null. */
  validate?: (value: string) => string | null;
}

export type Term = ReturnType<typeof createTerm>;
export type ListStyle = "numbered" | "bullets" | "plain";

export function createTerm(o: TermOptions = {}) {
  const out = o.out ?? process.stdout;
  const err = o.err ?? process.stderr;
  const input = o.input ?? (process.stdin as unknown as In);
  const env = o.env ?? process.env;
  const tty = out.isTTY === true && env.TERM !== "dumb";
  const depth: Depth = o.depth ?? (tty ? ((out.getColorDepth?.() ?? 1) as Depth) : 1);
  const unicode = o.unicode ?? unicodeTerminal(env, o.platform ?? process.platform);
  const S = unicode ? MARKS.unicode : MARKS.ascii;
  // A log keeps each line whole, for grep; a terminal gets them wrapped at its width, 80 at most.
  const width = tty ? Math.max(20, Math.min(o.columns ?? (out.columns || 80), 80)) : Number.POSITIVE_INFINITY;
  const now = o.now ?? Date.now;
  const every =
    o.every ??
    ((ms: number, tick: () => void) => {
      const id = setInterval(tick, ms);
      return () => clearInterval(id);
    });
  const raw = tty && input.isTTY === true && typeof input.setRawMode === "function";
  const inherited = o.inherited ?? env.AGENTES_FRAME === "1";

  // Each style closes only itself (22 bold and dim, 39 the color), so they nest: a link inside a bold line.
  const paint = (open: string, close: string) => (text: string) =>
    depth > 1 && open && text ? `\x1b[${open}m${text}\x1b[${close}m` : text;
  const bold = paint("1", "22");
  const dim = paint("2", "22");
  const accent = paint(ACCENT[depth], "39");
  const ok = paint("32", "39");
  const yellow = paint("33", "39");
  const red = paint("31", "39");
  /** URLs in a line of prose, in the accent color: trailing punctuation left out, and none with a <placeholder>. */
  const links = (line: string) => line.replace(/https?:\/\/[^\s<>"]+?(?=[.,:;)"]*(?:\s|$))/g, (url) => accent(url));

  const write = (text: string) => out.write(text);
  /** The line, or nothing when the output isn't a terminal (logs keep the marks, not the frame). */
  const bar = (color = dim) => (tty ? color(S.bar) : " ");
  const lineOf = (lead: string, text: string) => `${lead}  ${text}`.trimEnd();
  /** Erases the `n` rows just written (the cursor is on the row after them). */
  const erase = (n: number) => (n > 0 ? `\x1b[${n}A\r\x1b[J` : "");
  /** The rows `lines` take on the terminal, which can be narrower than `width`, or a word wider than it. */
  const rows = (lines: string[]) => lines.reduce((n, l) => n + rowsOf(l, o.columns ?? (out.columns || 80)), 0);

  /** The spinner on the screen, if any: whatever is said meanwhile goes above it. */
  let active: { rows: number; draw(): string } | null = null;
  /** Whether the last line out is a gap (the intro's, or the parent's when the frame is inherited). */
  let gapped = true;
  const say = (lines: string[]) => {
    if (lines.length === 0) return;
    gapped = false;
    const text = lines.map((l) => `${l}\n`).join("");
    if (!active) return void write(text);
    write(`${erase(active.rows)}${text}${active.draw()}`);
  };

  /** A mark and its text, wrapped under the line; `rest` are dim lines after it. */
  function block(mark: string, text: string, rest: string[] = [], barColor = dim): string[] {
    const lines: string[] = [];
    for (const [i, l] of wrap(text, width - 3).entries()) lines.push(lineOf(i === 0 ? mark : bar(barColor), links(l)));
    for (const r of rest) for (const l of wrap(r, width - 3)) lines.push(lineOf(bar(barColor), dim(links(l))));
    return lines;
  }

  /**
   * Body lines: numbered (1.), bulleted (·) or plain, each item's wrap hanging under its own text. A line of an
   * item that starts with "$ " is a command to copy: on a line of its own, never wrapped, without the "$ ".
   */
  function items(list: string[], style: ListStyle): string[] {
    const lines: string[] = [];
    list.forEach((item, i) => {
      const lead = style === "numbered" ? `${i + 1}. ` : style === "bullets" ? `${S.bullet} ` : "";
      const pad = " ".repeat(lead.length);
      let first = true;
      for (const part of item.split("\n")) {
        if (part.startsWith("$ ")) {
          lines.push(`${bar()}  ${first ? lead : `${pad}  `}${accent(part.slice(2))}`);
          first = false;
          continue;
        }
        for (const l of wrap(part, width - 3 - lead.length)) {
          lines.push(lineOf(bar(), `${first ? lead : pad}${links(l)}`));
          first = false;
        }
      }
    });
    return lines;
  }

  // ── Raw keys, the cursor, Ctrl-C ──────────────────────────────────────────

  let rawOn = false;
  let hidden = false;
  const setRaw = (on: boolean) => {
    if (!raw || rawOn === on) return;
    rawOn = on;
    input.setRawMode?.(on);
    if (on) input.resume();
    else input.pause();
  };
  /** A process that ends while keys are raw (an uncaught error) leaves the terminal as it found it. */
  const restore = () => {
    setRaw(false);
    if (hidden) write("\x1b[?25h");
    hidden = false;
  };
  const hideCursor = () => {
    if (!raw || hidden) return;
    hidden = true;
    write("\x1b[?25l");
    process.once("exit", restore);
  };
  const showCursor = () => {
    if (!hidden) return;
    process.off("exit", restore);
    restore();
  };
  let stopActive = () => {};
  /**
   * Ctrl-C while keys are raw (a question, a spinner): the terminal back as it was, then the interrupt a terminal
   * would have sent, to the whole process group, so an installer that started this one stops with it.
   */
  const cancel = (): never => {
    stopActive();
    showCursor();
    setRaw(false);
    say([lineOf(red(S.fail), "Canceled"), ...(tty ? [dim(S.end)] : [])]);
    if (o.canceled) return o.canceled();
    if (process.platform !== "win32") process.kill(0, "SIGINT");
    process.exit(130);
  };

  /** A waiting question's title: ◆, bold, wrapped under the line. */
  const asking = (title: string) =>
    wrap(title, width - 3).map((l, i) => lineOf(i === 0 ? accent(S.ask) : bar(accent), bold(l)));
  /** A waiting question's description, dim. */
  const described = (lines: string[]) =>
    lines.flatMap((d) => wrap(d, width - 3).map((l) => lineOf(bar(accent), dim(links(l)))));

  /** The keyboard loop behind the questions: draws `render()`, hands each key to `on`, erases it at the end. */
  function keys<T>(
    render: () => string[],
    on: (key: Key, done: (value: T) => void, text: string | undefined) => void,
  ): Promise<T> {
    stopActive();
    return new Promise<T>((resolve) => {
      let drawn = 0;
      const draw = () => {
        const lines = render();
        write(`${erase(drawn)}${lines.map((l) => `${l}\n`).join("")}`);
        drawn = rows(lines);
      };
      const onKey = (text: string | undefined, key: Key = {}) => {
        if (key.ctrl && key.name === "c") {
          input.off("keypress", onKey);
          write(erase(drawn));
          cancel();
        }
        let result: { value: T } | null = null;
        on(key, (value) => (result = { value }), text);
        if (!result) return draw();
        input.off("keypress", onKey);
        setRaw(false);
        write(erase(drawn));
        showCursor();
        resolve((result as { value: T }).value);
      };
      emitKeypressEvents(input as unknown as NodeJS.ReadableStream);
      hideCursor();
      setRaw(true);
      input.on("keypress", onKey);
      draw();
    });
  }

  const term = {
    depth,
    unicode,
    width,
    tty,
    /** Questions take keys here; otherwise the caller reads lines (piped answers) and shows them with `answered`. */
    interactive: raw,
    inherited,
    marks: S,
    accent,
    bold,
    dim,

    /** The logo where it fits, then ┌ and the badge; nothing when the frame is the parent's. */
    intro(title: string, logo = true) {
      if (inherited) return;
      if (!tty) return say([`agentes.chat ${title}`]);
      if (logo && unicode && width >= LOGO_WIDTH + 1) say(["", ...logoLines(depth), ""]);
      const badge = depth > 1 ? `\x1b[${BADGE[depth]}m agentes.chat \x1b[0m` : "agentes.chat";
      say([...wrap(`${badge} ${title}`, width - 3).map((l, i) => lineOf(i === 0 ? dim(S.start) : bar(), l)), bar()]);
      gapped = true;
    },
    /** An empty line on the line, never two in a row. */
    gap() {
      if (gapped) return;
      say([tty ? bar() : ""]);
      gapped = true;
    },
    /** Prose under the line (wrapped; URLs in the accent color). */
    text: (text: string, faint = false) =>
      say(wrap(text, width - 3).map((l) => lineOf(bar(), faint ? dim(links(l)) : links(l)))),
    /** A command or a link to copy, on a line of its own, never wrapped (`label` quiet before it). */
    command: (text: string, label?: string) => say([`${bar()}    ${label ? `${dim(label)}  ` : ""}${accent(text)}`]),
    /** ◇ Something done or checked. */
    step: (text: string, ...rest: string[]) => say(block(ok(S.done), text, rest)),
    /** ● Something to read or do: a title and its lines. */
    info(title: string, list: string[] = [], style: ListStyle = "plain") {
      say([
        ...wrap(title, width - 3).map((l, i) => lineOf(i === 0 ? accent(S.info) : bar(), bold(links(l)))),
        ...items(list, style),
      ]);
    },
    /** ▲ Not what was hoped, but it goes on. */
    warn: (text: string, ...rest: string[]) => say(block(yellow(S.warn), text, rest)),
    /** ○ Left out (a check that couldn't run here), quiet. */
    skipped: (text: string) => say(wrap(text, width - 3).map((l, i) => lineOf(i === 0 ? dim(S.skip) : bar(), dim(l)))),
    /** Lines kept as they are (a log, JSON), quiet, under the line. */
    quiet: (lines: string[]) => say(lines.map((l) => lineOf(bar(), dim(l)))),
    /** ■ It failed: what, then how to fix it. */
    fail: (error: string, fix?: string) =>
      say([
        ...wrap(error, width - 3).map((l, i) => lineOf(i === 0 ? red(S.fail) : bar(), bold(l))),
        ...(fix ? wrap(fix, width - 3).map((l) => lineOf(bar(), links(l))) : []),
      ]),
    /**
     * ■ Why the command stops, in place of a wait that was turning. Without a terminal it goes to stderr, as the
     * installers' refusals do: a provisioner reads why there, on its last line.
     */
    refuse(error: string) {
      stopActive();
      if (tty) term.fail(error);
      else err.write(`${lineOf(S.fail, error)}\n`);
    },
    /** └ The end of the frame, its text wrapped beside it (a log gets the text alone). */
    end(text = "") {
      if (!tty) return say(text ? [text] : []);
      say(wrap(text, width - 3).map((l, i) => lineOf(i === 0 ? dim(S.end) : " ", l)));
    },
    /**
     * └ Stopped, after a failure. A log ends on the failure itself, so whatever reads its last line for the
     * reason (the setup reading the runner's installer, a provisioner) finds it there.
     */
    stop() {
      if (tty) term.end("Stopped");
    },
    /** A QR code's lines (light modules drawn): forced light on dark, so phones read it on any theme. */
    qr: (lines: string[]) => say(lines.map((l) => `${bar()}  ${depth > 1 ? `\x1b[97;40m${l}\x1b[0m` : l}`)),

    /** ◒ A wait: animated on a terminal, with the time once it passes 3 s and `detail` (dim) under it. */
    spin(label: string, detail: string | null = null): Spinner {
      stopActive();
      const t0 = now();
      let frame = 0;
      // One line each, cut to the terminal's columns, so a redraw erases exactly what it drew.
      const lines = () => {
        const s = Math.floor((now() - t0) / 1000);
        const time = s >= 3 ? `  ${elapsed(s)}` : "";
        const head = `${accent(S.spin[frame % S.spin.length] as string)}  ${cut(label, width - 4 - time.length, S.more)}${dim(time)}`;
        return detail ? [head, `${bar()}  ${dim(cut(detail, width - 4, S.more))}`] : [head];
      };
      let stop = () => {};
      if (tty) {
        const me = {
          rows: 0,
          draw() {
            const next = lines();
            me.rows = rows(next);
            return next.map((l) => `${l}\n`).join("");
          },
        };
        const redraw = () => write(`${erase(me.rows)}${me.draw()}`);
        // Hidden only while keys are raw: Ctrl-C then comes to cancel(), which shows it again.
        hideCursor();
        setRaw(true);
        const onData = (data: Buffer) => {
          if (data.includes(3)) cancel();
        };
        if (raw) input.on("data", onData);
        const stopTimer = every(80, () => {
          frame++;
          redraw();
        });
        active = me;
        redraw();
        stop = () => {
          stopTimer();
          if (raw) input.off("data", onData);
          setRaw(false);
          if (active === me) {
            write(erase(me.rows));
            active = null;
          }
          showCursor();
          stopActive = () => {};
        };
        stopActive = stop;
      } else say([lineOf(S.spin[0] as string, label)]);
      return {
        update(next, nextDetail) {
          if (next !== null) label = next;
          if (nextDetail !== undefined) detail = nextDetail;
          if (active) write(`${erase(active.rows)}${active.draw()}`);
        },
        done(text, ...rest) {
          stop();
          say(block(ok(S.done), text, rest.filter(Boolean)));
        },
        warn(text, ...rest) {
          stop();
          say(block(yellow(S.warn), text, rest.filter(Boolean)));
        },
        fail(error, fix) {
          stop();
          term.fail(error, fix);
        },
      };
    },

    /** Stops a spinner that is still turning and gives the terminal back (the end of a program). */
    close() {
      stopActive();
      showCursor();
      setRaw(false);
    },

    // ── Questions (a terminal on both ends; otherwise the caller reads lines and calls `answered`) ──

    /**
     * The block a question leaves once answered: ◇ its title, then the answer (dim, or dim `prefix` and the answer).
     * A secret answer leaves the same row of marks whatever it was: this output is kept in logs, so none of its
     * characters and not its length may show.
     */
    answered(title: string, answer: string, prefix?: string, secret = false) {
      const quiet = [...(prefix ?? "")].length;
      let at = 0;
      const lines = wrap(`${prefix ?? ""}${secret ? S.mask.repeat(8) : answer}`, width - 3).map((l) => {
        const chars = [...l];
        // How much of this line is still the prefix (wrap drops one space at each break).
        const k = prefix === undefined ? chars.length : Math.max(0, Math.min(chars.length, quiet - at));
        at += chars.length + 1;
        return lineOf(bar(), `${dim(chars.slice(0, k).join(""))}${chars.slice(k).join("")}`);
      });
      say([...block(ok(S.done), title), ...lines]);
    },

    /** ◆ One of `options`: ↑/↓ (or j/k, Tab, its number) and Enter. */
    async choose<T extends string>(
      title: string,
      options: { value: T; label: string }[],
      initial: T,
      description: string[] = [],
    ): Promise<T> {
      let at = Math.max(
        0,
        options.findIndex((x) => x.value === initial),
      );
      const render = () => [
        ...asking(title),
        ...described(description),
        ...options.flatMap((x, i) =>
          wrap(x.label, width - 5).map((l, j) =>
            lineOf(
              bar(accent),
              j > 0 ? `  ${i === at ? l : dim(l)}` : i === at ? `${accent(S.on)} ${l}` : dim(`${S.off} ${l}`),
            ),
          ),
        ),
        accent(S.end),
      ];
      const value = await keys<T>(render, (key, done) => {
        const n = Number(key.sequence);
        if (key.name === "up" || key.name === "k") at = (at + options.length - 1) % options.length;
        else if (key.name === "down" || key.name === "j" || key.name === "tab") at = (at + 1) % options.length;
        else if (Number.isInteger(n) && n >= 1 && n <= options.length) at = n - 1;
        else if (key.name === "return" || key.name === "enter") done(options[at]?.value as T);
      });
      term.answered(title, options.find((x) => x.value === value)?.label ?? value);
      return value;
    },

    /** ◆ Yes or no: ←/→ (or h/l, Tab, y, n) and Enter; `question` sits on the line of the choice. */
    async confirm(title: string, question: string, yes: boolean, description: string[] = []): Promise<boolean> {
      let value = yes;
      const render = () => [
        ...asking(title),
        ...described(description),
        ...wrap(question, width - 3 - 16).map((l, i, all) =>
          lineOf(
            bar(accent),
            i < all.length - 1
              ? l
              : `${l}  ${value ? `${accent(S.on)} Yes` : dim(`${S.off} Yes`)} ${dim("/")} ${value ? dim(`${S.off} No`) : `${accent(S.on)} No`}`,
          ),
        ),
        accent(S.end),
      ];
      // y and n choose, Enter answers: a "y" typed with its Enter, as at a [Y/n] prompt, answers this question only.
      const answer = await keys<boolean>(render, (key, done) => {
        if (["left", "right", "h", "l", "tab"].includes(key.name ?? "")) value = !value;
        else if (key.name === "y") value = true;
        else if (key.name === "n") value = false;
        else if (key.name === "return" || key.name === "enter") done(value);
      });
      term.answered(title, answer ? "Yes" : "No", `${question} `);
      return answer;
    },

    /** ◆ A typed answer: letters, Backspace, Ctrl-U and Enter; a problem shows under it until it's fixed. */
    async ask(title: string, a: AskOptions = {}): Promise<string> {
      let value = "";
      let problem: string | null = null;
      const label = a.label ? `${a.label}: ` : "";
      // What's typed stays on one line, so the question redraws in place: a long answer shows its end.
      const room = width - 3 - visible(label) - 2;
      const render = () => {
        const shown = cut(a.secret ? S.mask.repeat([...value].length) : value, room, S.more, true);
        const hint = value ? "" : dim(a.placeholder ?? a.initial ?? "");
        return [
          ...asking(title),
          ...described(a.description ?? []),
          lineOf(bar(accent), `${label}${shown}${depth > 1 ? "\x1b[7m \x1b[27m" : "_"}${hint}`),
          ...(problem
            ? wrap(problem, width - 3).map((l, i) => lineOf(i === 0 ? yellow(S.end) : " ", yellow(l)))
            : [accent(S.end)]),
        ];
      };
      const answer = await keys<string>(render, (key, done, text) => {
        if (key.name === "return" || key.name === "enter") {
          const v = value.trim() || a.initial || "";
          problem = v ? (a.validate?.(v) ?? null) : "An answer is needed.";
          if (!problem) done(v);
        } else if (key.name === "backspace") value = [...value].slice(0, -1).join("");
        else if (key.ctrl && key.name === "u") value = "";
        else if (text && !key.ctrl && text >= " ") value += text;
      });
      term.answered(title, answer, label, a.secret);
      return answer;
    },
  };
  return term;
}
