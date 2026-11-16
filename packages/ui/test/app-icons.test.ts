import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_ICONS,
  MADE_ICON_ACCESSORIES,
  MADE_ICON_COLORS,
  MADE_ICON_FACES,
  MADE_ICON_POSES,
  MADE_ICON_SKIES,
  madeIconId,
  madeIcons as madeIconList,
} from "../../client/src/lib/app-icons";
import { ico, png, render, resize } from "../scripts/app-icons/raster.mjs";
import {
  APP_ICON_IDS,
  MADE_ACCESSORIES,
  MADE_COLORS,
  MADE_FACES,
  MADE_POSES,
  MADE_SKIES,
  madeIcons,
  madeId,
  madeScene,
  monoLayers,
  SCENES,
} from "../scripts/app-icons/scenes.mjs";

const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path));
/** A PNG's width and height (its IHDR). */
const sizeOf = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
/** An .ico's images' sizes (0 is 256). */
const icoSizes = (bytes: Buffer) => Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => bytes[6 + 16 * i] || 256);

describe("app icons (ADR 0179)", () => {
  test("the generator, the apps and the desktop app list the same icons", () => {
    expect(APP_ICON_IDS).toEqual([...APP_ICONS]);
    const rust = readFileSync(join(ROOT, "apps/desktop/src-tauri/src/app_icon.rs"), "utf8");
    expect([...rust.matchAll(/icon!\("(\w+)"\)/g)].map((m) => m[1])).toEqual([...APP_ICONS]);
  });

  test("every icon's files are there, at their sizes", () => {
    for (const id of APP_ICONS) {
      const phone = `apps/mobile/assets/app-icons/${id}`;
      for (const look of ["ios", "ios-dark", "ios-tinted"])
        expect(sizeOf(read(`${phone}/${look}.png`))).toEqual([1024, 1024]);
      expect(sizeOf(read(`${phone}/preview.png`))).toEqual([180, 180]);
      expect(sizeOf(read(`apps/web/public/app-icons/${id}.png`))).toEqual([160, 160]);
      expect(icoSizes(read(`apps/web/public/app-icons/${id}.ico`))).toEqual([16, 32, 48]);
    }
    expect(icoSizes(read("apps/web/public/favicon.ico"))).toEqual([16, 32, 48]);
    expect(sizeOf(read("apps/web/public/apple-touch-icon.png"))).toEqual([180, 180]);
    expect(sizeOf(read("apps/web/public/app-icons/night-sky.png"))).toEqual([512, 512]);
    // The web app manifest's (ADR 0189), all opaque (a PNG's color type 2: RGB, no alpha).
    for (const [name, size] of [
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["icon-maskable-512.png", 512],
    ] as const) {
      const bytes = read(`apps/web/public/${name}`);
      expect(sizeOf(bytes)).toEqual([size, size]);
      expect(bytes[25]).toBe(2);
    }
  });

  test("the icons a person makes: the generator and the apps list the same parts", () => {
    expect(MADE_SKIES).toEqual([...MADE_ICON_SKIES]);
    expect(MADE_COLORS).toEqual([...MADE_ICON_COLORS]);
    expect(MADE_FACES).toEqual([...MADE_ICON_FACES]);
    expect(MADE_ACCESSORIES).toEqual([...MADE_ICON_ACCESSORIES]);
    expect(MADE_POSES).toEqual([...MADE_ICON_POSES]);
    expect(madeIcons().map(madeId)).toEqual(madeIconList().map(madeIconId));
    for (const sky of MADE_SKIES)
      for (const name of [sky, `${sky}-peek`])
        expect(sizeOf(read(`apps/mobile/assets/app-icons/made/${name}.png`))).toEqual([360, 360]);
  });

  test("a made icon's agent leans in as the Peeking icons' agent, in its color and with its face", () => {
    const picture = (icon: { sky: string; color: string; look: string; pose?: string }) =>
      [...render(64, madeScene(icon), { k: 16 }).px].join();
    // The shipped color and face, leaning in the night, is the Peeking at night icon.
    expect(picture({ sky: "night", color: "sky", look: "round", pose: "peek" })).toBe(
      [...render(64, SCENES.peekNight.light(), { k: 16 }).px].join(),
    );
    const leaning = picture({ sky: "night", color: "rose", look: "heart", pose: "peek" });
    expect(leaning).not.toBe(picture({ sky: "night", color: "rose", look: "heart" }));
    expect(leaning).not.toBe(picture({ sky: "night", color: "rose", look: "round", pose: "peek" }));
    expect(leaning).not.toBe(picture({ sky: "night", color: "teal", look: "heart", pose: "peek" }));
    expect(leaning).not.toBe(picture({ sky: "sky", color: "rose", look: "heart", pose: "peek" }));
  });

  test("a made icon draws its face or its accessory on the agent", () => {
    /** How many of a 64 px picture's pixels are fully `hex`. */
    const count = (icon: { sky: string; color: string; look: string }, hex: [number, number, number]) => {
      const { px } = render(64, madeScene(icon), { k: 16 });
      let n = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i] === hex[0] && px[i + 1] === hex[1] && px[i + 2] === hex[2] && px[i + 3] === 1) n++;
      return n;
    };
    const white: [number, number, number] = [255, 255, 255];
    // Every face has its eyes, and they are not all the plain pills (a 64 px picture tells most apart by size).
    const faces = MADE_FACES.map((look) => count({ sky: "night", color: "rose", look }, white));
    expect(faces.every((n) => n > 0)).toBe(true);
    expect(new Set(faces).size).toBeGreaterThanOrEqual(6);
    // The crown's gold is on the icon that wears it and on no other.
    const gold: [number, number, number] = [0xf2, 0xc1, 0x4e];
    expect(count({ sky: "night", color: "rose", look: "crown" }, gold)).toBeGreaterThan(0);
    expect(count({ sky: "night", color: "rose", look: "round" }, gold)).toBe(0);
    // The one-color icon keeps the accessory's shape.
    const mono = (look: string) =>
      render(64, monoLayers(madeScene({ sky: "night", color: "rose", look })), { k: 16 })
        .px.filter((_, i) => i % 4 === 3)
        .reduce((a, b) => a + b, 0);
    expect(mono("crown")).not.toBe(mono("hat"));
  });

  test("the peeking agent leans to the left: its right eye sits higher than its left", () => {
    for (const look of ["light", "dark"] as const) {
      const N = 128;
      const { px } = render(N, SCENES.peekNight[look](), { k: 1024 / N });
      // Each row's fully white pixels: the eyes.
      const eyes: number[][] = [];
      for (let y = 0; y < N; y++) {
        const row: number[] = [];
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) row.push(x);
        }
        if (row.length) eyes.push(row);
      }
      const middle = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(eyes.length).toBeGreaterThan(10);
      // The topmost row is the right eye's and the lowest the left eye's.
      expect(middle(eyes[0] ?? [])).toBeGreaterThan(middle(eyes[eyes.length - 1] ?? []) + 4);
      // It comes in from the bottom right: that corner is the agent, the one across is the sky.
      const at = (x: number, y: number) => [...px.slice((y * N + x) * 4, (y * N + x) * 4 + 3)];
      expect(at(N - 1, N - 1)).not.toEqual(at(0, N - 1));
      expect(at(0, 0)).toEqual(at(0, 0).map((v) => Math.min(v, 0x60)));
    }
  });

  test("the 16 px favicon's eyes sit on whole pixels", () => {
    const { px } = render(16, SCENES.night.favicon(16));
    let white = 0;
    for (let i = 0; i < px.length; i += 4)
      if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255 && px[i + 3] === 1) white++;
    // Two eyes of 1 × 4 pixels, fully white, nothing half covered.
    expect(white).toBe(8);
  });
});

describe("the rasterizer", () => {
  const half = [{ mask: (x: number) => x < 2, color: () => "#ff0000" }];

  test("covers whole pixels inside a shape and averages on its edge", () => {
    const { px } = render(4, half);
    expect([...px.slice(0, 4)]).toEqual([255, 0, 0, 1]);
    expect([...px.slice(8, 12)]).toEqual([0, 0, 0, 0]);
    const edge = render(1, half, { k: 4 }).px;
    expect(edge[3]).toBeCloseTo(0.5);
  });

  test("scales down by averaging what each pixel covers", () => {
    const { px } = resize(render(4, half), 1);
    expect(px[0]).toBeCloseTo(127.5);
    expect(px[3]).toBeCloseTo(0.5);
  });

  test("writes PNG and ICO files", () => {
    const image = png(render(4, half));
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(sizeOf(image)).toEqual([4, 4]);
    expect(image[25]).toBe(6);
    expect(png(render(4, half), { opaque: true })[25]).toBe(2);
    expect(icoSizes(ico([{ size: 4, png: image }]))).toEqual([4]);
  });
});
