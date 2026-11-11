/**
 * The pixel sky: an ordered-dither (Bayer 4×4) field over a short list of
 * tones, with pixel-art agents drifting up and blinking, a light that follows
 * the pointer, and calm zones behind text (the field settles on one tone there
 * and the sprites pass behind). Faces and pills on a sky are clear zones: no
 * pixel agent is drawn near them. Ported from the landing page's sky (now in lp-agentes.chat)
 * and made palette-agnostic: any agent color, faded from any surface token.
 *
 * One animation loop runs for every sky on the page, about 30 frames a
 * second, and only while a sky moves: a sky off screen costs nothing, and the
 * browser holds the loop while the page is hidden. With reduced motion a sky
 * is drawn once (and again on resize or a theme change), with no loop between,
 * and nothing in it moves between those frames, the pointer included.
 * Without a 2D context (tests, old browsers) nothing is drawn and the
 * element's CSS background shows.
 */
import { onScreenNow } from "../device";
import {
  blobsAt,
  type CalmZone,
  calmAt,
  ditherIndex,
  drawSprite,
  lightToward,
  pixelOf,
  placeSprite,
  riseColumn,
  SKY_FRAME_MS,
  type SkyBlob,
  type SkyFrame,
  spriteNear,
  spriteTone,
} from "./math";

export { drawSprite, type SkyBlob, type SkyFrame, SPRITE } from "./math";

/** What a sky draws, read again on every frame (so it can change live). */
export interface SkyOptions {
  /** Screen pixels per sky pixel (default 4). */
  pixel?: number;
  /** Tones from deep (0) to light; a function gets the surface color (see `surface`). */
  palette: readonly string[] | ((surface: string) => readonly string[]);
  /** CSS custom property of the surface behind the sky (default `--bg`), resolved on the canvas. */
  surface?: string;
  /** The field at (u, v) in 0..1, at time t (seconds): 0 = first tone, 1 = last. */
  base: (u: number, v: number, t: number) => number;
  blobs?: (t: number) => SkyBlob[];
  /** Time multiplier (default 1): a working agent's sky runs faster. */
  speed?: number;
  /** Pixel agents: a count, or one per `area` sky pixels up to `max`. */
  sprites?: number | { area: number; max: number };
  /** Share of near (double size) sprites (default 0.3). */
  near?: number;
  /** Share of the far sprites drawn as faint light silhouettes (default 0.5); the rest take `body`. */
  faint?: number;
  /** Rise speed multiplier (default 1). */
  rise?: number;
  /** Sprites leave above this fraction of the height (default: the top edge). */
  ceil?: number;
  /** The sprites' body color (their eyes are always white), e.g. `spriteTone(color)`. */
  body?: string;
  /** The pointer light's strength (default 0.22; 0 turns it off) and radius (share of the height). */
  light?: number;
  lightR?: number;
  /** Elements whose box stays calm (text over the sky). */
  calm?: () => (Element | null | undefined)[];
  /**
   * Faces and pills on the sky: no pixel agent is drawn within `CLEAR_PX` of their box, nor of a face's accessories
   * drawn past its tile (an `.ac-avatar__canvas` inside).
   */
  clear?: () => (Element | null | undefined)[];
  /** Field value inside calm zones (default 6/7) and the fade around them, in sky pixels. */
  calmV?: number;
  calmPad?: number;
  /** The first tone paints nothing: what's behind shows, whatever the surface (a card's gradient, a tile). */
  seeThrough?: boolean;
  /** Draws over the field (e.g. one sprite of its own) before the frame is shown. */
  after?: (frame: SkyFrame) => void;
}

const WHITE = pixelOf("#ffffff");

/** How far (CSS pixels) a pixel agent keeps from a face or a pill, and one standing still from another. */
export const CLEAR_PX = 12;

/* ---------- shared state: pointer, theme, motion, one loop ---------- */

const pointer = { x: 0, y: 0 };
let pointerUsers = 0;
const onPointer = (e: PointerEvent) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
};
function trackPointer(): () => void {
  if (typeof window === "undefined") return () => {};
  if (pointerUsers++ === 0) {
    pointer.x = window.innerWidth * 0.7;
    pointer.y = window.innerHeight * 0.4;
    window.addEventListener("pointermove", onPointer, { passive: true });
  }
  return () => {
    if (--pointerUsers === 0) window.removeEventListener("pointermove", onPointer);
  };
}

/** Bumps when the theme changes, so skies re-read their surface color. */
let themeVersion = 0;
let themeWatch: MutationObserver | null = null;
function watchTheme() {
  if (themeWatch || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  themeWatch = new MutationObserver(() => {
    themeVersion++;
    redrawSkies();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
}

const REDUCE = "(prefers-reduced-motion: reduce)";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE).matches;

/** Every sky held still (`holdSkies`), and what each live sky does when that changes. */
let held = false;
const onHold = new Set<() => void>();

/**
 * Holds every sky still, as with reduced motion: drawn once, and again on a resize or a theme change. For the Linux
 * app, whose WebKitGTK paints without the GPU there (its DMA-BUF renderer is off, apps/desktop/src-tauri/src/main.rs):
 * each frame of a moving sky repainted it and everything over it in software, 30 times a second, which kept a core
 * busy and made clicks slow.
 */
export function holdSkies(hold = true) {
  if (held === hold) return;
  held = hold;
  for (const changed of onHold) changed();
}

interface Sky {
  dirty: boolean;
  /** It draws on a coming frame: it moves and is on screen, or it is still and was asked to draw again. */
  wanted(): boolean;
  step(dt: number): void;
}
const live = new Set<Sky>();
let raf = 0;
let last = 0;
const hasRaf = () => typeof requestAnimationFrame === "function";
function tick(now: number) {
  if (now - last >= SKY_FRAME_MS) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const s of live) s.step(dt);
  }
  // With nothing to draw the loop stops; a sky that has something again wakes it (`wake`).
  raf = hasRaf() && [...live].some((s) => s.wanted()) ? requestAnimationFrame(tick) : 0;
}
function wake() {
  if (raf || !hasRaf()) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    const ctx = canvas.getContext("2d");
    return ctx && typeof ctx.createImageData === "function" ? ctx : null;
  } catch {
    return null;
  }
}

interface Sprite {
  x: number;
  y: number;
  k: number;
  vy: number;
  ph: number;
  blink: number;
  ghost: boolean;
}

/** Starts a sky on `canvas` (sized to its parent); `get` is read on every frame. Returns the cleanup. */
export function startSky(canvas: HTMLCanvasElement, get: () => SkyOptions): () => void {
  const ctx = context2d(canvas);
  const parent = canvas.parentElement;
  if (!ctx || !parent) return () => {};
  const host: HTMLElement = parent;
  const motion = typeof window.matchMedia === "function" ? window.matchMedia(REDUCE) : null;
  let reduced = held || motion?.matches === true;
  let w = 0;
  let h = 0;
  let px = 0;
  let img: ImageData | null = null;
  let buf = new Uint32Array(0);
  let visible = true;
  let t = Math.random() * 50;
  const flock: Sprite[] = [];
  // The first frame stands the agents about the sky; after it they rise from below (with reduced motion, all stand).
  let first = true;
  // A new size: the agents it leaves outside the sky make way on the next frame.
  let refit = false;
  // With reduced motion, the sky has no room for one more at this size: a redraw adds no one until a new size.
  let full = false;
  const light = { x: 0.5, y: 0.5 };
  let surfaceAt = -1;
  let surface = "";
  let toneKey = "";
  let tones: number[] = [];

  /**
   * A new pixel agent. With `avoid`: standing where `placeSprite` finds room clear of those boxes, drawn exactly there
   * on this frame (its sway and the parallax `mx` taken back out), else waiting below. Without: rising from below on
   * a column whose path keeps clear of `clear`.
   */
  const spawn = (o: SkyOptions, avoid: CalmZone[] | null, clear: CalmZone[], pad: number, mx: number): Sprite => {
    const near = Math.random() < (o.near ?? 0.3);
    const k = near ? 2 : 1;
    const ph = Math.random() * 6.28;
    const top = o.ceil ? h * o.ceil : 0;
    const at = avoid ? placeSprite(Math.random, w, h, k, top, avoid, pad) : null;
    return {
      // Sway and parallax can carry a rising one 10 sprite pixels sideways: its column keeps that much more room.
      x: at ? at[0] - Math.sin(ph) * 2 * k + mx * 10 * k : riseColumn(Math.random, w, k, top, clear, pad + 10 * k),
      y: at ? at[1] : h + 12,
      k,
      vy: near ? 7 : 3.5 + Math.random() * 2,
      ph,
      blink: Math.random() * 6,
      ghost: !near && Math.random() < (o.faint ?? 0.5),
    };
  };
  const wanted = (o: SkyOptions) => {
    const s = o.sprites;
    if (!s) return 0;
    if (typeof s === "number") return s;
    return Math.min(s.max, Math.round((w * h) / s.area));
  };
  const resize = () => {
    const r = host.getBoundingClientRect();
    const o = get();
    const P = o.pixel ?? 4;
    const nw = Math.max(4, Math.ceil(r.width / P));
    const nh = Math.max(4, Math.ceil(r.height / P));
    if (!r.width || (nw === w && nh === h && P === px && img)) return;
    w = nw;
    h = nh;
    px = P;
    canvas.width = w;
    canvas.height = h;
    img = ctx.createImageData(w, h);
    buf = new Uint32Array(img.data.buffer);
    // The agents keep their places: a new size (a scrollbar, a font arriving) never moves them about.
    refit = true;
    sky.dirty = true;
  };
  /** The elements' boxes in sky pixels of `r` (the host's box). */
  const boxesOf = (els: readonly (Element | null | undefined)[], r: DOMRect) => {
    const out: CalmZone[] = [];
    for (const el of els) {
      if (!el) continue;
      const e = el.getBoundingClientRect();
      if (e.right > e.left)
        out.push([(e.left - r.left) / px, (e.top - r.top) / px, (e.right - r.left) / px, (e.bottom - r.top) / px]);
    }
    return out;
  };

  function draw(dt: number) {
    if (!img) return;
    const o = get();
    if ((o.pixel ?? 4) !== px) resize();
    t += dt * (o.speed ?? 1);
    // Tones: the surface is read from the tokens once per theme.
    if (typeof o.palette === "function") {
      if (surfaceAt !== themeVersion) {
        surfaceAt = themeVersion;
        surface =
          getComputedStyle(canvas)
            .getPropertyValue(o.surface ?? "--bg")
            .trim() || "#808080";
      }
    }
    const list = typeof o.palette === "function" ? o.palette(surface) : o.palette;
    const key = list.join();
    if (key !== toneKey) {
      toneKey = key;
      tones = list.map((tone, i) => (o.seeThrough && i === 0 ? 0 : pixelOf(tone)));
    }
    const levels = tones.length - 1;
    const r = host.getBoundingClientRect();
    const tx = (pointer.x - r.left) / (r.width || 1);
    const ty = (pointer.y - r.top) / (r.height || 1);
    // Paced by time: still with reduced motion, whose frames take no time.
    light.x = lightToward(light.x, tx, dt);
    light.y = lightToward(light.y, ty, dt);
    const blobs = o.blobs ? o.blobs(t) : [];
    const nb = blobs.length;
    const inv = 1 / h;
    const lk = o.light ?? 0.22;
    const lx = light.x * w;
    const ly = light.y * h;
    const lr = (o.lightR ?? 0.32) * h;
    const lr2 = 1 / (lr * lr);
    const zones = boxesOf(o.calm?.() ?? [], r);
    const PAD = o.calmPad ?? 22;
    const calmV = o.calmV ?? 6 / 7;
    // Per pixel: the base field, the blobs, the pointer light, the calm zones; then the dither (./math).
    for (let y = 0; y < h; y++) {
      const v = y * inv;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let f = o.base(x / w, v, t);
        if (nb) f = blobsAt(blobs, x, y, w, h, f);
        if (lk) {
          const ldx = x - lx;
          const ldy = y - ly;
          f += lk * Math.exp(-(ldx * ldx + ldy * ldy) * lr2);
        }
        if (zones.length) {
          const k = calmAt(zones, PAD, x, y);
          if (k) f += (calmV - f) * k;
        }
        buf[row + x] = tones[ditherIndex(f, levels, x, y)] as number;
      }
    }
    // Pixel agents drifting up, with a little parallax (none with reduced motion) and an occasional blink.
    const mx = reduced ? 0 : Math.min(0.8, Math.max(-0.8, tx - 0.5));
    const at = (p: Sprite): CalmZone => {
      const x = Math.round(p.x + Math.sin(p.ph) * 2 * p.k - mx * 10 * p.k);
      const y = Math.round(p.y);
      return [x, y, x + 9 * p.k, y + 9 * p.k];
    };
    const pad = Math.ceil(CLEAR_PX / px);
    const clear = boxesOf(
      (o.clear?.() ?? []).flatMap((el) => (el ? [el, ...el.querySelectorAll(".ac-avatar__canvas")] : [])),
      r,
    );
    const top = o.ceil ? h * o.ceil : 0;
    if (refit) {
      refit = false;
      full = false;
      // Those still wholly inside stay put; the rest give way to new ones, placed (or rising) as below.
      const inside = flock.filter((p) => {
        const [x0, y0, x1, y1] = at(p);
        return x0 >= 0 && y0 >= top && x1 <= w && y1 <= h;
      });
      flock.splice(0, flock.length, ...inside);
    }
    const want = wanted(o);
    if (flock.length > want) flock.length = want;
    if (flock.length < want && !full) {
      // Standing: off the faces, apart from each other, and out of the text's calm (where they'd show cut).
      const fade = Math.ceil(PAD * 0.6);
      const avoid =
        first || reduced
          ? [
              ...clear,
              ...zones.map((z): CalmZone => [z[0] - fade, z[1] - fade, z[2] + fade, z[3] + fade]),
              ...flock.map(at),
            ]
          : null;
      while (flock.length < want) {
        const p = spawn(o, avoid, clear, pad, mx);
        // Nothing rises with reduced motion: one with no room to stand is left out.
        if (reduced && p.y > h) {
          full = true;
          break;
        }
        flock.push(p);
        avoid?.push(at(p));
      }
    }
    first = false;
    const body = pixelOf(o.body ?? spriteTone("sky"));
    // Far agents are faint light silhouettes; near ones are solid, both with white eyes.
    const ghostBody = tones[Math.max(0, levels - 1)] as number;
    const rise = (o.rise ?? 1) * (o.speed ?? 1);
    const skip = zones.length ? (x: number, y: number) => calmAt(zones, PAD, x, y) > 0.35 : undefined;
    for (let i = 0; i < flock.length; i++) {
      const p = flock[i] as Sprite;
      p.y -= p.vy * rise * dt;
      p.ph += dt * 0.7;
      p.blink -= dt;
      if (p.blink < -0.16) p.blink = 3 + Math.random() * 6;
      if (p.y < -12 * p.k || (top && p.y < top)) {
        flock[i] = spawn(o, null, clear, pad, mx);
        continue;
      }
      const [ox, oy] = at(p);
      // Never on a face or a pill: one passing by shows again once it is clear.
      if (spriteNear(clear, ox, oy, p.k, pad)) continue;
      drawSprite({ buf, w, h }, ox, oy, p.k, p.ghost ? ghostBody : body, WHITE, p.blink < 0, skip);
    }
    o.after?.({ buf, w, h, t, tones });
    ctx?.putImageData(img, 0, 0);
  }

  const sky: Sky = {
    dirty: true,
    wanted: () => visible && (!reduced || sky.dirty),
    step(dt) {
      if (!visible || !canvas.isConnected || canvas.offsetParent === null) return;
      // Behind a full-screen menu (MenuOverlay) the app is blurred: hold still there.
      if (document.documentElement.dataset.menuOverlay !== undefined && !canvas.closest(".ac-mo")) return;
      if (!img) resize();
      if (reduced && !sky.dirty) return;
      draw(reduced ? 0 : dt);
      sky.dirty = false;
    },
  };

  const untrack = trackPointer();
  watchTheme();
  // The setting can change while the page is open: a still sky starts moving, a moving one stops.
  const onMotion = () => {
    reduced = held || motion?.matches === true;
    sky.dirty = true;
    wake();
  };
  motion?.addEventListener?.("change", onMotion);
  onHold.add(onMotion);
  resize();
  const observers: { disconnect(): void }[] = [];
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      resize();
      wake();
    });
    ro.observe(host);
    observers.push(ro);
  }
  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((entries) => {
      visible = onScreenNow(entries) ?? true;
      if (visible) wake();
    });
    io.observe(host);
    observers.push(io);
  }
  live.add(sky);
  wake();
  sky.step(0);
  return () => {
    live.delete(sky);
    untrack();
    motion?.removeEventListener?.("change", onMotion);
    onHold.delete(onMotion);
    for (const o of observers) o.disconnect();
  };
}

/** Marks every sky for a redraw (reduced motion draws only on demand). */
export function redrawSkies() {
  for (const s of live) s.dirty = true;
  wake();
}
