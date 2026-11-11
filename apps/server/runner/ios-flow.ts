import { createHash } from "node:crypto";
import { RunnerError } from "./errors";
import { HelperSlow, type IosScreen, pressKey, type WdaNode } from "./wda";

/**
 * Maestro flows on a real iPhone, which Maestro itself no longer drives (2.11.0): the YAML is read here and its common
 * commands run through the test helper. Text and ids match as Maestro's do (the whole text, a regular expression,
 * any case); every lookup waits for the screen like Maestro's. Any other command stops the flow and says so.
 */

export const IOS_FLOW_COMMANDS = [
  "launchApp",
  "stopApp",
  "tapOn",
  "inputText",
  "eraseText",
  "assertVisible",
  "assertNotVisible",
  "scrollUntilVisible",
  "scroll",
  "swipe",
  "back",
  "pressKey",
  "waitForAnimationToEnd",
  "takeScreenshot",
] as const;

/** How long a tap or an assertion waits for its element. */
export const LOOKUP_MS = 10_000;
const POLL_MS = 400;

export interface IosFlowRun {
  /** The flow's `${NAME}`s (the request's, over the flow's own `env`). */
  env: Record<string, string>;
  signal: AbortSignal;
  /** The flow stops here (epoch ms). */
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Saves a `takeScreenshot`'s PNG; answers where it went. */
  save(name: string, png: Buffer): Promise<string>;
}

export interface IosFlowResult {
  passed: boolean;
  output: string;
  screenshots: string[];
}

type Selector = { text?: string; id?: string; index?: number; point?: string };
type Rect = { x: number; y: number; width: number; height: number };

class FlowStep extends Error {}

/** The flow's header (`appId`, `env`) and its commands, read from Maestro's YAML (one document or two). */
export function parseIosFlow(text: string): { appId: string | null; env: Record<string, string>; commands: unknown[] } {
  let docs: unknown;
  try {
    docs = Bun.YAML.parse(text);
  } catch (err) {
    throw new RunnerError(
      "bad_request",
      `The flow isn't valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Two documents (a header, then the commands); a flow that only starts with `---` is one list.
  const multi =
    Array.isArray(docs) &&
    docs.length === 2 &&
    typeof docs[0] === "object" &&
    docs[0] !== null &&
    !Array.isArray(docs[0]) &&
    Array.isArray(docs[1]);
  const header = (multi ? (docs as unknown[])[0] : null) as Record<string, unknown> | null;
  const commands = multi ? (docs as unknown[])[1] : docs;
  if (!Array.isArray(commands)) throw new RunnerError("bad_request", "The flow has no commands (a list after ---).");
  const env: Record<string, string> = {};
  if (header && typeof header.env === "object" && header.env !== null) {
    for (const [k, v] of Object.entries(header.env)) env[k] = String(v);
  }
  return { appId: typeof header?.appId === "string" ? header.appId : null, env, commands };
}

/** `${NAME}` in every string of `value`, from `env`. */
function substitute(value: unknown, env: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\$\{\s*([A-Za-z_]\w*)\s*\}/g, (all, name) => env[name] ?? all);
  if (Array.isArray(value)) return value.map((v) => substitute(v, env));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, env)]));
  }
  return value;
}

/** A Maestro text or id: the whole value, as a regular expression in any case, or exactly as written. */
function matcher(pattern: string) {
  let re: RegExp | null = null;
  try {
    re = new RegExp(`^(?:${pattern})$`, "is");
  } catch {
    re = null;
  }
  const lower = pattern.toLowerCase();
  return (v: string | null | undefined) =>
    typeof v === "string" && v !== "" && (re?.test(v) || v.toLowerCase() === lower);
}

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

/** The elements `sel` names that are on the screen, the innermost of nested matches, in screen order. */
export function findOnScreen(root: WdaNode, sel: Selector, screen: { width: number; height: number }): WdaNode[] {
  const text = sel.text !== undefined ? matcher(sel.text) : null;
  const id = sel.id !== undefined ? matcher(sel.id) : null;
  const hit = (n: WdaNode) =>
    n.type !== "Application" &&
    n.type !== "Window" &&
    (!text ||
      text(n.label) ||
      text(n.value) ||
      text(n.placeholderValue) ||
      (n.name !== n.rawIdentifier && text(n.name))) &&
    (!id || id(n.rawIdentifier) || id(n.name));
  const shown = (n: WdaNode) => {
    const r = n.rect;
    if (!r || r.width <= 0 || r.height <= 0) return false;
    if (n.isVisible !== undefined && !truthy(n.isVisible)) return false;
    return r.x < screen.width && r.y < screen.height && r.x + r.width > 0 && r.y + r.height > 0;
  };
  const out: WdaNode[] = [];
  const walk = (n: WdaNode): boolean => {
    let inner = false;
    for (const c of n.children ?? []) inner = walk(c) || inner;
    if (!inner && hit(n) && shown(n)) {
      out.push(n);
      return true;
    }
    return inner;
  };
  walk(root);
  return out.sort((a, b) => (a.rect as Rect).y - (b.rect as Rect).y || (a.rect as Rect).x - (b.rect as Rect).x);
}

/** `"50%, 80%"` or `"120,300"` as points on a screen this size. */
export function pointOf(spec: string, screen: { width: number; height: number }): { x: number; y: number } {
  const m = /^\s*(-?[\d.]+)\s*(%?)\s*,\s*(-?[\d.]+)\s*(%?)\s*$/.exec(String(spec));
  if (!m) throw new FlowStep(`"${spec}" isn't a point ("50%, 50%" or "120, 300")`);
  const x = Number(m[1]);
  const y = Number(m[3]);
  return { x: m[2] ? (screen.width * x) / 100 : x, y: m[4] ? (screen.height * y) / 100 : y };
}

const selectorOf = (v: unknown): Selector => {
  if (typeof v === "string" || typeof v === "number") return { text: String(v) };
  if (typeof v !== "object" || v === null) throw new FlowStep("it names no element (text, id or point)");
  const o = v as Record<string, unknown>;
  const sel: Selector = {};
  if (o.text !== undefined) sel.text = String(o.text);
  if (o.id !== undefined) sel.id = String(o.id);
  if (o.point !== undefined) sel.point = String(o.point);
  if (typeof o.index === "number") sel.index = o.index;
  if (sel.text === undefined && sel.id === undefined && sel.point === undefined) {
    throw new FlowStep("it names no element (text, id or point)");
  }
  return sel;
};

const describe = (sel: Selector) =>
  [sel.text !== undefined ? `"${sel.text}"` : "", sel.id !== undefined ? `id ${sel.id}` : "", sel.point ?? ""]
    .filter(Boolean)
    .join(" ");

/** A swipe's start and end on a screen this size, the finger moving `direction`. */
function swipeLine(direction: string, s: { width: number; height: number }) {
  const cx = s.width / 2;
  const cy = s.height / 2;
  switch (direction.toUpperCase()) {
    case "UP":
      return [cx, s.height * 0.7, cx, s.height * 0.3] as const;
    case "DOWN":
      return [cx, s.height * 0.3, cx, s.height * 0.7] as const;
    case "LEFT":
      return [s.width * 0.8, cy, s.width * 0.2, cy] as const;
    case "RIGHT":
      return [s.width * 0.2, cy, s.width * 0.8, cy] as const;
    default:
      throw new FlowStep(`"${direction}" isn't a direction (UP, DOWN, LEFT or RIGHT)`);
  }
}

const KEYS: Record<string, Parameters<typeof pressKey>[1]> = {
  enter: "enter",
  backspace: "delete",
  delete: "delete",
  home: "home",
  lock: "power",
  power: "power",
  back: "back",
  "volume up": "volume_up",
  "volume down": "volume_down",
};

export async function runIosFlow(text: string, screen: IosScreen, run: IosFlowRun): Promise<IosFlowResult> {
  const now = run.now ?? Date.now;
  const sleep = run.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lines: string[] = [];
  const screenshots: string[] = [];
  const parsed = parseIosFlow(text);
  const env = { ...parsed.env, ...run.env };
  let size: { width: number; height: number } | null = null;
  const window = async () => {
    size ??= await screen.windowSize();
    return size;
  };
  const appOf = (v: unknown) => {
    const app =
      typeof v === "string" ? v : typeof v === "object" && v !== null ? (v as { appId?: unknown }).appId : null;
    const id = typeof app === "string" && app ? app : parsed.appId;
    if (!id) throw new FlowStep("no app: give appId in the flow's header or the command");
    return id;
  };
  /** What `sel` names on the screen now. One slow look at a busy screen isn't the end: it's asked again until `until`. */
  const look = async (sel: Selector, until: number) => {
    try {
      return findOnScreen(await screen.source(), sel, await window());
    } catch (err) {
      if (!(err instanceof HelperSlow) || now() >= until || run.signal.aborted) throw err;
      return null;
    }
  };
  /** Polls the screen until `want` holds for `sel`'s elements, up to `ms`. */
  const lookup = async (sel: Selector, ms: number, want: (list: WdaNode[]) => boolean) => {
    const until = Math.min(now() + ms, run.deadline);
    for (;;) {
      const list = await look(sel, until);
      if (list && want(list)) return list;
      if (now() >= until || run.signal.aborted) return null;
      await sleep(POLL_MS);
    }
  };
  const tapOn = async (v: unknown) => {
    const sel = selectorOf(v);
    const s = await window();
    if (sel.point && sel.text === undefined && sel.id === undefined) {
      const p = pointOf(sel.point, s);
      return screen.tap(p.x, p.y);
    }
    const list = await lookup(sel, LOOKUP_MS, (l) => l.length > (sel.index ?? 0));
    const el = list?.[sel.index ?? 0];
    if (!el?.rect) throw new FlowStep(`${describe(sel)} isn't on the screen`);
    const r = el.rect;
    await screen.tap(r.x + r.width / 2, r.y + r.height / 2);
  };

  const commands: Record<(typeof IOS_FLOW_COMMANDS)[number], (v: unknown) => Promise<unknown>> = {
    launchApp: async (v) => {
      const app = appOf(v);
      const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
      if (o.clearState === true || o.clearKeychain === true) {
        throw new FlowStep("clearState and clearKeychain don't work on a real iPhone: reinstall the app instead");
      }
      if (o.stopApp !== false) await screen.terminate(app).catch(() => undefined);
      await screen.launch(app);
    },
    stopApp: (v) => screen.terminate(appOf(v)),
    tapOn: async (v) => {
      const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
      const times = typeof o.repeat === "number" ? Math.max(1, Math.min(50, o.repeat)) : 1;
      for (let i = 0; i < times; i++) {
        if (i > 0) await sleep(typeof o.delay === "number" ? o.delay : 100);
        await tapOn(v);
      }
    },
    inputText: (v) => screen.keys(String(v ?? "")),
    eraseText: (v) => {
      const n =
        typeof v === "number"
          ? v
          : typeof v === "object" && v !== null
            ? Number((v as { charactersToErase?: unknown }).charactersToErase)
            : 50;
      return screen.keys("\b".repeat(Math.max(1, Math.min(500, Number.isFinite(n) ? n : 50))));
    },
    assertVisible: async (v) => {
      const sel = selectorOf(v);
      if (!(await lookup(sel, LOOKUP_MS, (l) => l.length > 0)))
        throw new FlowStep(`${describe(sel)} isn't on the screen`);
    },
    assertNotVisible: async (v) => {
      const sel = selectorOf(v);
      if (!(await lookup(sel, LOOKUP_MS, (l) => l.length === 0)))
        throw new FlowStep(`${describe(sel)} is still on the screen`);
    },
    scrollUntilVisible: async (v) => {
      const o = (typeof v === "object" && v !== null ? v : { element: v }) as Record<string, unknown>;
      const sel = selectorOf(o.element ?? v);
      const direction = typeof o.direction === "string" ? o.direction.toUpperCase() : "DOWN";
      const until = Math.min(now() + (typeof o.timeout === "number" ? o.timeout : 20_000), run.deadline);
      // Content moving DOWN means the finger moving up.
      const finger = { DOWN: "UP", UP: "DOWN", LEFT: "RIGHT", RIGHT: "LEFT" }[direction] ?? direction;
      for (;;) {
        const s = await window();
        if (((await look(sel, until)) ?? []).length > 0) return;
        if (now() >= until || run.signal.aborted) throw new FlowStep(`${describe(sel)} didn't come into view`);
        const [x1, y1, x2, y2] = swipeLine(finger, s);
        await screen.swipe(x1, y1, x2, y2, 400);
        await sleep(POLL_MS);
      }
    },
    scroll: async () => {
      const [x1, y1, x2, y2] = swipeLine("UP", await window());
      await screen.swipe(x1, y1, x2, y2, 400);
    },
    swipe: async (v) => {
      const o = (typeof v === "object" && v !== null ? v : { direction: v }) as Record<string, unknown>;
      const s = await window();
      const ms = typeof o.duration === "number" ? o.duration : 400;
      if (o.start !== undefined && o.end !== undefined) {
        const a = pointOf(String(o.start), s);
        const b = pointOf(String(o.end), s);
        return screen.swipe(a.x, a.y, b.x, b.y, ms);
      }
      if (typeof o.direction !== "string") throw new FlowStep("give start and end, or a direction");
      let [x1, y1, x2, y2] = swipeLine(o.direction, s);
      if (o.from !== undefined) {
        const sel = selectorOf(o.from);
        const el = (await lookup(sel, LOOKUP_MS, (l) => l.length > 0))?.[0];
        if (!el?.rect) throw new FlowStep(`${describe(sel)} isn't on the screen`);
        const cx = el.rect.x + el.rect.width / 2;
        const cy = el.rect.y + el.rect.height / 2;
        [x2, y2] = [cx + (x2 - x1), cy + (y2 - y1)];
        [x1, y1] = [cx, cy];
      }
      return screen.swipe(x1, y1, x2, y2, ms);
    },
    back: async () => pressKey(screen, "back", await window()),
    pressKey: async (v) => {
      const key = KEYS[String(v ?? "").toLowerCase()];
      if (!key)
        throw new FlowStep(
          `the ${String(v)} key isn't on an iPhone (Enter, Backspace, Home, Lock, Volume Up or Volume Down)`,
        );
      return pressKey(screen, key, await window());
    },
    waitForAnimationToEnd: async (v) => {
      const ms =
        typeof v === "object" && v !== null && typeof (v as { timeout?: unknown }).timeout === "number"
          ? (v as { timeout: number }).timeout
          : 5000;
      const until = Math.min(now() + ms, run.deadline);
      let last = "";
      while (now() < until && !run.signal.aborted) {
        const hash = createHash("sha1")
          .update(await screen.screenshot())
          .digest("hex");
        if (hash === last) return;
        last = hash;
        await sleep(POLL_MS);
      }
    },
    takeScreenshot: async (v) => {
      const raw =
        typeof v === "string"
          ? v
          : typeof v === "object" && v !== null
            ? String((v as { path?: unknown }).path ?? "")
            : "";
      const name =
        raw
          .replace(/\.png$/i, "")
          .replace(/[^\w.-]+/g, "-")
          .replace(/^[-.]+/, "")
          .slice(0, 80) || "screenshot";
      screenshots.push(await run.save(name, await screen.screenshot()));
    },
  };

  for (const [i, raw] of parsed.commands.entries()) {
    const item = substitute(raw, env);
    const [name, value] =
      typeof item === "string"
        ? [item, null]
        : typeof item === "object" && item !== null
          ? (Object.entries(item)[0] ?? ["", null])
          : ["", null];
    const opts = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    const label =
      typeof opts.label === "string" ? opts.label : `${name}${typeof value === "string" ? ` ${value}` : ""}`;
    if (run.signal.aborted || now() >= run.deadline) {
      lines.push(`STOPPED before step ${i + 1} (${label}): out of time`);
      return { passed: false, output: lines.join("\n"), screenshots };
    }
    const command = commands[name as keyof typeof commands];
    if (!command) {
      lines.push(
        `FAILED  ${label}: ${name || "this step"} isn't supported on a real iPhone. These are: ${IOS_FLOW_COMMANDS.join(", ")}.`,
      );
      return { passed: false, output: lines.join("\n"), screenshots };
    }
    try {
      await command(value);
      lines.push(`OK      ${label}`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (truthy(opts.optional)) {
        lines.push(`SKIPPED ${label}: ${why} (optional)`);
        continue;
      }
      lines.push(`FAILED  ${label}: ${why}`);
      return { passed: false, output: lines.join("\n"), screenshots };
    }
  }
  lines.push(`Flow passed (${parsed.commands.length} steps)`);
  return { passed: true, output: lines.join("\n"), screenshots };
}
