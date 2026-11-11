import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { sentence, tailscaleKeyProblem } from "../src/lib";
import {
  createTerm,
  type Depth,
  LOGO_WIDTH,
  logoLines,
  rowsOf,
  type TermOptions,
  unicodeTerminal,
  visible,
  wrap,
} from "../src/term";
import { TERM_SH } from "../src/term-sh";

/** Keys as a terminal sends them, after readline's keypress decoding. */
class Keys extends EventEmitter {
  isTTY = true;
  raw = false;
  setRawMode(raw: boolean) {
    this.raw = raw;
    return this;
  }
  resume() {
    return this;
  }
  pause() {
    return this;
  }
  press(name: string, o: { ctrl?: boolean } = {}) {
    this.emit("keypress", undefined, { name, sequence: name, ...o });
  }
  type(text: string) {
    for (const ch of text) this.emit("keypress", ch, { name: ch.toLowerCase(), sequence: ch });
  }
}

/** A term writing into a string, on a terminal of 80 columns (or `columns`) unless `tty` is false. */
function capture(o: TermOptions & { tty?: boolean } = {}) {
  let text = "";
  let errors = "";
  const keys = new Keys();
  let now = 0;
  const ticks = new Set<() => void>();
  const term = createTerm({
    env: {},
    platform: "linux",
    input: keys as never,
    now: () => now,
    every: (_ms, tick) => {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    canceled: () => {
      throw new Error("canceled");
    },
    ...o,
    out: { isTTY: o.tty ?? true, columns: 80, write: (s: string) => (text += s) },
    err: { write: (s: string) => (errors += s) },
  });
  /** `seconds` pass, and a spinner turns once. */
  const wait = (seconds: number) => {
    now += seconds * 1000;
    for (const tick of ticks) tick();
  };
  return {
    term,
    keys,
    wait,
    text: () => text,
    errors: () => errors,
    screen: () => screen(text, o.columns ?? 80),
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal's colors, which the screen leaves out
const COLORS = /\x1b\[[0-9;]*m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the cursor's moves, which the screen applies
const MOVES = /(\x1b\[\d*[AJ]|\x1b\[\?25[lh]|\n|\r)/;

/**
 * What a terminal `columns` wide shows in the end: a line wider than it folds onto the next row (by Bun's measure of
 * columns, not the one under test), the cursor moves (up, erase below) applied, colors and the cursor dropped.
 */
function screen(text: string, columns = 80): string {
  const rows = [""];
  let row = 0;
  for (const part of text.replace(COLORS, "").split(MOVES)) {
    if (!part || part === "\r" || part.includes("?25")) continue;
    if (part === "\n") rows[++row] ??= "";
    else if (part.endsWith("A")) row -= Number(part.slice(2, -1)) || 1;
    else if (part.endsWith("J")) {
      rows.length = row + 1;
      rows[row] = "";
    } else
      for (const ch of part) {
        if (Bun.stringWidth(`${rows[row]}${ch}`) > columns) rows[++row] = "";
        rows[row] += ch;
      }
  }
  return rows.join("\n");
}

/** How many times `text` shows on the screen. */
const count = (shown: string, text: string) => shown.split(text).length - 1;

describe("the look's pieces", () => {
  test("words wrap within the width; a word longer than it (a URL) keeps a line of its own, whole", () => {
    const url = `https://example.com/${"x".repeat(90)}`;
    expect(wrap(`see ${url} now`, 40)).toEqual(["see", url, "now"]);
    for (const line of wrap("word ".repeat(60), 77)) expect(visible(line)).toBeLessThanOrEqual(77);
  });

  test("marks need a font with ◆ ◇ ◒: not the Linux console, and on Windows only the terminals that have it", () => {
    expect(unicodeTerminal({ TERM: "linux" }, "linux")).toBe(false);
    expect(unicodeTerminal({ TERM: "xterm-256color" }, "linux")).toBe(true);
    expect(unicodeTerminal({}, "darwin")).toBe(true);
    expect(unicodeTerminal({ WT_SESSION: "1" }, "win32")).toBe(true);
    expect(unicodeTerminal({ TERM_PROGRAM: "vscode" }, "win32")).toBe(true);
    expect(unicodeTerminal({}, "win32")).toBe(false);
  });

  test("the logo fits its 63 columns in every color depth, and the installers draw it the same, escape for escape", () => {
    for (const [depth, sh] of [
      [24, 24],
      [8, 256],
      [4, 16],
      [1, 0],
    ] as const) {
      for (const line of logoLines(depth)) expect(visible(line)).toBeLessThanOrEqual(LOGO_WIDTH);
      const drawn = spawnSync("sh", ["-c", `${TERM_SH}\nt_init 1; T_DEPTH=${sh}; t_style; t_logo`], {
        encoding: "utf8",
      });
      expect(drawn.stderr).toBe("");
      expect(drawn.stdout).toBe(`\n${logoLines(depth).join("\n")}\n\n`);
    }
  });

  test("links take the accent, without the sentence's period, and never half of a <placeholder> address", () => {
    const { term, text } = capture({ depth: 24 });
    term.text("Open https://agents.example.com. Or https://agentes.<your tailnet>.ts.net soon.");
    expect(text()).toContain("\x1b[38;2;43;116;230mhttps://agents.example.com\x1b[39m.");
    expect(text()).not.toContain("\x1b[38;2;43;116;230mhttps://agentes.");
  });

  test("widths in a terminal's columns: wide characters take two, combining marks none", () => {
    for (const text of ["agentes", "中文", "한국어", "ｆｕｌｌ", "e\u0301", "正在设置 fonts-noto-cjk"])
      expect(visible(text)).toBe(Bun.stringWidth(text));
    expect(visible("\x1b[2m│\x1b[22m")).toBe(1);
    expect(rowsOf("x".repeat(80), 80)).toBe(1);
    expect(rowsOf("x".repeat(81), 80)).toBe(2);
    // The wide character doesn't fit in the last column, so it starts the next row.
    expect(rowsOf(`${"x".repeat(79)}中${"x".repeat(78)}`, 80)).toBe(2);
    expect(rowsOf(`${"x".repeat(79)}中${"x".repeat(79)}`, 80)).toBe(3);
  });

  test("the installers' end and title wrap beside their mark on a narrow terminal", () => {
    const run = (call: string) =>
      spawnSync("sh", ["-c", `${TERM_SH}\nt_init 1; T_FRAME=1 T_COLS=40 T_FOLD=1; ${call}`], { encoding: "utf8" });
    const intro = run('t_intro "install plan (--plan: nothing runs)"');
    expect(intro.stdout).toBe("┌  agentes.chat install plan (--plan:\n│  nothing runs)\n│\n");
    const said = "Nothing ran. For the setup's own plan, run its command above with --dry-run.";
    const end = run(`T_OPEN=1; t_style; t_end "${said}"`).stdout.trimEnd().split("\n");
    expect(end[0]).toStartWith("└  Nothing ran.");
    for (const line of end.slice(1)) expect(line).toStartWith("   ");
    expect(end.map((line) => line.slice(3)).join(" ")).toBe(said);
    for (const line of [...intro.stdout.split("\n"), ...end]) expect(visible(line)).toBeLessThanOrEqual(40);
  });

  test("the installers' snippet is POSIX sh, and only defines functions", () => {
    expect(spawnSync("sh", ["-n"], { input: TERM_SH }).status).toBe(0);
    const run = spawnSync("sh", ["-c", TERM_SH], { encoding: "utf8" });
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("");
  });
});

describe("what each terminal gets", () => {
  const steps = (term: ReturnType<typeof createTerm>) => {
    term.intro("setup");
    term.text("Setting up in /opt/agentes.", true);
    term.step("Docker 27.3.1");
    term.gap();
    term.info(
      "Create your account",
      ["From your computer:\n$ ssh -L 3000:localhost:3000 root@agents.example.com"],
      "numbered",
    );
    term.gap();
    term.spin("Waiting for the account").done("Account created");
    term.warn("Agents' computer: set up, but it hasn't answered yet");
    term.fail("It failed.", "Fix it.");
    term.stop();
  };

  test("24-bit color: the logo, the badge on the agent blue, the line and the marks", () => {
    const { term, screen, text } = capture({ depth: 24 });
    steps(term);
    expect(text()).toContain("\x1b[48;2;0;99;209;97m agentes.chat \x1b[0m setup");
    expect(screen()).toBe(
      [
        "",
        ...logoLines(24).map((line) => line.replace(COLORS, "")),
        "",
        "┌   agentes.chat  setup",
        "│",
        "│  Setting up in /opt/agentes.",
        "◇  Docker 27.3.1",
        "│",
        "●  Create your account",
        "│  1. From your computer:",
        "│       ssh -L 3000:localhost:3000 root@agents.example.com",
        "│",
        "◇  Account created",
        "▲  Agents' computer: set up, but it hasn't answered yet",
        "■  It failed.",
        "│  Fix it.",
        "└  Stopped",
        "",
      ].join("\n"),
    );
  });

  test("NO_COLOR (depth 1): not one escape; the frame and the mono logo stay", () => {
    const { term, text } = capture({ depth: 1 });
    steps(term);
    // Only the cursor moves a wait needs: no color, bold or dim.
    expect(text().match(COLORS)).toBeNull();
    expect(text()).toContain("████ ██ ████");
    expect(text()).toContain("┌  agentes.chat setup\n│\n");
    expect(text()).toContain("◇  Docker 27.3.1");
  });

  test("ASCII where the font lacks the marks: no logo, and + | o * ! x", () => {
    const { term, screen } = capture({ depth: 4, unicode: false });
    steps(term);
    expect(screen()).toStartWith(
      "+   agentes.chat  setup\n|\n|  Setting up in /opt/agentes.\no  Docker 27.3.1\n|\n*  Create",
    );
    expect(screen()).toContain("!  Agents' computer");
    expect(screen()).toContain("x  It failed.\n|  Fix it.\n+  Stopped");
  });

  test("not a terminal (a log, a pipe): the marks, no line, no logo, no escape, each wait once, a failure last", () => {
    const { term, text } = capture({ tty: false });
    steps(term);
    expect(text()).toBe(
      [
        "agentes.chat setup",
        "   Setting up in /opt/agentes.",
        "◇  Docker 27.3.1",
        "",
        "●  Create your account",
        "   1. From your computer:",
        "        ssh -L 3000:localhost:3000 root@agents.example.com",
        "",
        "◒  Waiting for the account",
        "◇  Account created",
        "▲  Agents' computer: set up, but it hasn't answered yet",
        "■  It failed.",
        "   Fix it.",
        "",
      ].join("\n"),
    );
  });

  test("a refusal: ■ and └ Stopped on a terminal; without one, the last line of stderr, nothing after it", () => {
    const framed = capture({ depth: 24 });
    framed.term.intro("update", false);
    framed.term.spin("Downloading the runner");
    framed.term.refuse("Download failed: 404 https://x.test/runner/agentes-runner.mjs");
    framed.term.stop();
    expect(framed.screen()).toBe(
      "┌   agentes.chat  update\n│\n■  Download failed: 404 https://x.test/runner/agentes-runner.mjs\n└  Stopped\n",
    );
    expect(framed.keys.raw).toBe(false);
    expect(framed.errors()).toBe("");

    const log = capture({ tty: false });
    log.term.intro("update", false);
    log.term.spin("Downloading the runner");
    log.term.refuse("Download failed: 404 https://x.test/runner/agentes-runner.mjs");
    log.term.stop();
    expect(log.text()).toBe("agentes.chat update\n◒  Downloading the runner\n");
    expect(log.errors()).toBe("■  Download failed: 404 https://x.test/runner/agentes-runner.mjs\n");
  });

  test("a narrow terminal: the title and the end wrap beside their marks, every line within its columns", () => {
    const { term, screen } = capture({ depth: 1, columns: 40 });
    term.intro("install plan (--plan: nothing runs)", false);
    term.end("Nothing ran. For the setup's own plan, run its command above with --dry-run.");
    const lines = screen().trimEnd().split("\n");
    expect(lines.slice(0, 3)).toEqual(["┌  agentes.chat install plan (--plan:", "│  nothing runs)", "│"]);
    expect(lines[3]).toStartWith("└  Nothing ran.");
    for (const line of lines.slice(4)) expect(line).toStartWith("   ");
    for (const line of lines) expect(visible(line)).toBeLessThanOrEqual(40);
  });

  test("a log keeps each line whole, for grep", () => {
    const { term, text } = capture({ tty: false });
    const long = `Agents' computer: set up, but it hasn't answered agentes.chat yet. It keeps trying. Its log: ${"x".repeat(60)}`;
    term.warn(long);
    term.info("Next", [long], "numbered");
    expect(text()).toBe(`▲  ${long}\n●  Next\n   1. ${long}\n`);
  });

  test("inside another program's frame (AGENTES_FRAME=1): no logo and no ┌, straight onto its line", () => {
    const { term, text } = capture({ depth: 24, env: { AGENTES_FRAME: "1" } });
    expect(term.inherited).toBe(true);
    term.intro("setup");
    term.gap();
    term.step("Docker 27.3.1");
    expect(screen(text())).toBe("◇  Docker 27.3.1\n");
    expect(capture({ tty: false, env: { AGENTES_FRAME: "1" } }).term.inherited).toBe(true);
  });

  test("a numbered item that is a command keeps its number, the command whole", () => {
    const { term, text } = capture({ tty: false });
    term.info("Next", ["$ docker compose up -d", "Run the setup again."], "numbered");
    expect(text()).toBe("●  Next\n   1. docker compose up -d\n   2. Run the setup again.\n");
  });

  test("text wraps at 77 columns under the line, never two gaps in a row", () => {
    const { term, screen } = capture({ depth: 1 });
    term.intro("setup", false);
    term.gap();
    term.step("word ".repeat(30).trim());
    term.gap();
    term.gap();
    term.end("Done");
    for (const line of screen().split("\n")) expect([...line].length).toBeLessThanOrEqual(80);
    expect(screen()).toContain("◇  word word");
    expect(screen()).toContain("│  word");
    expect(screen()).not.toContain("│\n│\n");
  });
});

describe("waits", () => {
  test("a spinner turns with its time from 3 s on and its detail under it; what's said meanwhile goes above it", () => {
    const { term, wait, screen } = capture({ depth: 24 });
    const s = term.spin("Starting agentes.chat (docker compose up -d)", "The first time downloads about 2 GB.");
    expect(screen()).toBe("◒  Starting agentes.chat (docker compose up -d)\n│  The first time downloads about 2 GB.\n");
    wait(64);
    expect(screen()).toBe(
      "◐  Starting agentes.chat (docker compose up -d)  1m 04s\n│  The first time downloads about 2 GB.\n",
    );
    s.update(null, "Container agentes-agentes-1  Started");
    term.info("Approve this server in your tailnet");
    expect(screen()).toBe(
      "●  Approve this server in your tailnet\n◐  Starting agentes.chat (docker compose up -d)  1m 04s\n│  Container agentes-agentes-1  Started\n",
    );
    s.done("agentes.chat 1.0.0 is up, on this server only");
    expect(screen()).toBe("●  Approve this server in your tailnet\n◇  agentes.chat 1.0.0 is up, on this server only\n");
    wait(1);
    expect(screen()).toBe("●  Approve this server in your tailnet\n◇  agentes.chat 1.0.0 is up, on this server only\n");
  });

  test("a long label is cut to one line, so the spinner redraws in place", () => {
    const { term, screen } = capture({ depth: 1 });
    term.spin(`Waiting for ${"a".repeat(100)}`);
    const [line] = screen().split("\n");
    expect([...(line ?? "")].length).toBeLessThanOrEqual(80);
    expect(line).toEndWith("…");
  });

  test("a detail in Chinese or Japanese is cut by its columns, so each turn redraws over the last", () => {
    const { term, wait, screen } = capture({ depth: 24 });
    const s = term.spin("Setting up this machine for your agents");
    s.update(null, "正在设置 fonts-noto-cjk (1:20201206-cjk+repack1-1) …… ".repeat(3));
    for (let i = 0; i < 5; i++) wait(1);
    const rows = screen().split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toStartWith("◐  Setting up this machine for your agents  5s");
    expect(rows[1]).toStartWith("│  正在设置 fonts-noto-cjk");
    expect(Bun.stringWidth(rows[1] as string)).toBeLessThanOrEqual(79);
  });

  test("a terminal narrower than the frame: a spinner's lines fold, and it still redraws over them", () => {
    const { term, wait, screen } = capture({ depth: 1, columns: 15 });
    term.spin("Waiting for the confirmation", "The code expires in 10 minutes.");
    for (let i = 0; i < 5; i++) wait(1);
    expect(screen().match(/[◒◐◓◑]/g)).toEqual(["◐"]);
    expect(count(screen(), "The code")).toBe(1);
    expect(screen()).toStartWith("◐  Waiting for");
  });

  test("a failed wait says what and how to fix it in its place", () => {
    const { term, screen } = capture({ depth: 8 });
    term
      .spin("Waiting for https://agents.example.com")
      .fail("agents.example.com doesn't resolve yet.", "Add a DNS record.");
    expect(screen()).toBe("■  agents.example.com doesn't resolve yet.\n│  Add a DNS record.\n");
  });

  test("Ctrl-C during a wait: the terminal back as it was, then Canceled and the end of the frame", () => {
    const { term, keys, text, screen } = capture({ depth: 24 });
    term.spin("Waiting for the confirmation");
    expect(keys.raw).toBe(true);
    expect(() => keys.emit("data", Buffer.from([3]))).toThrow("canceled");
    expect(keys.raw).toBe(false);
    expect(text()).toEndWith("\x1b[?25h\x1b[31m■\x1b[39m  Canceled\n\x1b[2m└\x1b[22m\n");
    expect(screen()).toBe("■  Canceled\n└\n");
  });
});

describe("questions", () => {
  test("one of several: ↓, a number and Enter; it stays as its title and the option", async () => {
    const { term, keys, screen } = capture({ depth: 24 });
    const options = [
      { value: "tailscale", label: "Tailscale: private HTTPS on your tailnet, no domain or open port (recommended)" },
      { value: "domain", label: "A public domain, with HTTPS on ports 80 and 443" },
      { value: "local", label: "This machine only (http://localhost)" },
    ];
    const answer = term.choose("How will people reach this instance?", options, "tailscale");
    expect(screen()).toBe(
      [
        "◆  How will people reach this instance?",
        "│  ● Tailscale: private HTTPS on your tailnet, no domain or open port",
        "│    (recommended)",
        "│  ○ A public domain, with HTTPS on ports 80 and 443",
        "│  ○ This machine only (http://localhost)",
        "└",
        "",
      ].join("\n"),
    );
    keys.press("down");
    keys.press("down");
    keys.type("2");
    keys.press("return");
    expect(await answer).toBe("domain");
    expect(screen()).toBe(
      "◇  How will people reach this instance?\n│  A public domain, with HTTPS on ports 80 and 443\n",
    );
    expect(keys.raw).toBe(false);
  });

  test("yes or no: y chooses and Enter answers, so a y typed with its Enter answers this question only", async () => {
    const { term, keys, screen } = capture({ depth: 24 });
    const answer = term.confirm("Usage statistics", "Send them?", false, ["Counts only."]);
    expect(screen()).toBe("◆  Usage statistics\n│  Counts only.\n│  Send them?  ○ Yes / ● No\n└\n");
    keys.type("y");
    expect(screen()).toBe("◆  Usage statistics\n│  Counts only.\n│  Send them?  ● Yes / ○ No\n└\n");
    keys.press("return");
    expect(await answer).toBe(true);
    expect(screen()).toBe("◇  Usage statistics\n│  Send them? Yes\n");
  });

  test("typed and secret: ▪ while typing, a problem until it's fixed, a fixed row of ▪ once answered", async () => {
    const { term, keys, screen } = capture({ depth: 24 });
    const answer = term.ask("Paste the auth key", {
      secret: true,
      placeholder: "tskey-auth-…",
      validate: (v) => (v.startsWith("tskey-") ? null : "That isn't a Tailscale auth key."),
    });
    expect(screen()).toBe("◆  Paste the auth key\n│   tskey-auth-…\n└\n");
    keys.type("nope");
    keys.press("return");
    expect(screen()).toBe("◆  Paste the auth key\n│  ▪▪▪▪ \n└  That isn't a Tailscale auth key.\n");
    keys.press("u", { ctrl: true });
    keys.type("tskey-auth-kQ7xYp2CNTRL");
    keys.press("return");
    expect(await answer).toBe("tskey-auth-kQ7xYp2CNTRL");
    expect(screen()).toBe("◇  Paste the auth key\n│  ▪▪▪▪▪▪▪▪\n");
  });

  test("a secret answer read from a pipe leaves the same row of marks in the log, whatever it was", () => {
    const logged = ["smtps://ab:pw@smtp.example.com:465", "key_live_0000000000000000", "x"].map((secret) => {
      const { term, text } = capture({ tty: false });
      term.answered("API key", secret, "API key: ", true);
      expect(text()).not.toContain(secret.slice(0, 4));
      return text();
    });
    expect(logged[0]).toContain("API key: ▪▪▪▪▪▪▪▪");
    expect(new Set(logged).size).toBe(1);
  });

  test("a typed answer with a label, its default taken on an empty Enter", async () => {
    const { term, keys, screen } = capture({ depth: 1 });
    const answer = term.ask("Email API", { label: "API address", initial: "https://api.millionsend.com" });
    keys.press("return");
    expect(await answer).toBe("https://api.millionsend.com");
    expect(screen()).toBe("◇  Email API\n│  API address: https://api.millionsend.com\n");
  });

  test("a long answer shows its end on one line, so the question redraws in place", async () => {
    const { term, keys, screen } = capture({ depth: 1 });
    const answer = term.ask("SMTP URL", { label: "URL" });
    keys.type(`smtps://${"u".repeat(100)}@smtp.example.com:465`);
    const line = screen().split("\n")[1] ?? "";
    expect([...line].length).toBeLessThanOrEqual(80);
    expect(line).toStartWith("│  URL: …");
    expect(line).toEndWith("@smtp.example.com:465_");
    keys.press("return");
    expect(await answer).toStartWith("smtps://uuu");
  });

  test("a problem longer than a line wraps under └, so the question keeps its height at every key", async () => {
    const { term, keys, screen } = capture({ depth: 24 });
    const answer = term.ask("Paste the auth key", {
      secret: true,
      validate: (v) => {
        const problem = tailscaleKeyProblem(v);
        return problem ? sentence(problem) : null;
      },
    });
    keys.type("tskey-api-abc");
    keys.press("return");
    expect(screen()).toContain("└  That's an API access token.");
    expect(visible(`└  ${sentence(tailscaleKeyProblem("tskey-api-abc") ?? "")}`)).toBeGreaterThan(80);
    const height = screen().split("\n").length;
    keys.type("defgh");
    keys.press("backspace");
    expect(screen().split("\n")).toHaveLength(height);
    expect(count(screen(), "Paste the auth key")).toBe(1);
    keys.press("u", { ctrl: true });
    keys.type("tskey-auth-kQ7xYp2CNTRL");
    keys.press("return");
    expect(await answer).toBe("tskey-auth-kQ7xYp2CNTRL");
    expect(screen()).toBe("◇  Paste the auth key\n│  ▪▪▪▪▪▪▪▪\n");
  });

  test("a word wider than the terminal folds, and the question still redraws over itself", async () => {
    const { term, keys, screen } = capture({ depth: 1 });
    const answer = term.ask("Where is it?", { description: [`https://example.com/${"x".repeat(90)}`] });
    for (const ch of "agents.example.com") keys.type(ch);
    expect(count(screen(), "Where is it?")).toBe(1);
    keys.press("return");
    expect(await answer).toBe("agents.example.com");
    expect(screen()).toBe("◇  Where is it?\n│  agents.example.com\n");
  });

  test("an answer typed in wide characters shows its end within the line", async () => {
    const { term, keys, screen } = capture({ depth: 1 });
    void term.ask("Organization", { label: "Name" });
    keys.type("株式会社".repeat(20));
    const [, line = ""] = screen().split("\n");
    expect(line).toStartWith("│  Name: …");
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80);
    expect(count(screen(), "Organization")).toBe(1);
  });

  test("piped answers show as the same two lines", () => {
    const { term, text } = capture({ tty: false });
    term.answered("Agents' computer", "Yes", "Use this machine as your agents' computer? ");
    term.answered("How will people reach this instance?", "This machine only (http://localhost)");
    expect(text()).toBe(
      "◇  Agents' computer\n   Use this machine as your agents' computer? Yes\n◇  How will people reach this instance?\n   This machine only (http://localhost)\n",
    );
  });

  test("Ctrl-C at a question: the question goes, Canceled, and the interrupt", async () => {
    const { term, keys, screen } = capture({ depth: 24 });
    void term.confirm("Agents' computer", "Use this machine?", true);
    expect(() => keys.press("c", { ctrl: true })).toThrow("canceled");
    expect(keys.raw).toBe(false);
    expect(screen()).toBe("■  Canceled\n└\n");
  });
});

test("every depth draws the same layout", () => {
  const shapes = ([24, 8, 4, 1] as Depth[]).map((depth) => {
    const { term, screen } = capture({ depth });
    term.intro("setup", false);
    term.step("Docker 27.3.1", "With Compose 2.29.7");
    term.command("https://agents.example.com", "App:");
    term.end("Done");
    return screen();
  });
  // Only the badge differs: its own background takes a space on each side.
  for (const shape of shapes)
    expect(shape.replace("┌   agentes.chat  setup", "┌  agentes.chat setup")).toBe(shapes[3] as string);
});
