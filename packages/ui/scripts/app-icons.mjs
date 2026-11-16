/**
 * Every app icon file, from the agent engine (ADR 0179): `node packages/ui/scripts/app-icons.mjs` from the repo's
 * root, then commit what changed. The first id is the icon the apps ship with; the others are what a person may pick
 * on their device. Nothing is drawn by hand: change a scene in app-icons/scenes.mjs and run this again.
 *
 * - Phone (apps/mobile/assets/app-icons/<id>/): iOS 1024 in light, dark and tinted; Android's front, back and
 *   one-color layers (1024 for the shipped icon, which Expo scales; 432, Android's largest, for the others, which the
 *   app-icons plugin copies as they are) and, for the others, the 192 icon of Android before 8; the picker's previews.
 * - Desktop: nothing here. Its build draws its own from the same scenes (apps/desktop/scripts/icons.ts: the bundle's
 *   master and each icon's Dock and window pictures), as its icons folder is never committed.
 * - Web (apps/web/public/): favicon.ico, apple-touch-icon.png, icon-512.png and the web app manifest's icon-192.png
 *   and icon-maskable-512.png (ADR 0189), app-icons/<id>.ico/.png for the
 *   pick (the tab's icon and the picker's preview), and app-icons/night-sky.png, the Night's sky without its agent,
 *   on which the web draws a workspace's agent picked as the icon.
 * - The skies of the icons a person makes on their phone (apps/mobile/assets/app-icons/made/<sky>.png, and
 *   <sky>-peek.png behind the leaning agent), on which
 *   its picker draws the agent; those icons' own files are drawn when the app is built (app-icons/made-files.mjs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gray, ico, png, render, resize } from "./app-icons/raster.mjs";
import {
  APP_ICON_IDS,
  backLayers,
  frontLayers,
  MADE_COLORS,
  MADE_LOOKS,
  MADE_POSES,
  MADE_SKIES,
  madeScene,
  monoLayers,
  SCENES,
  tiled,
} from "./app-icons/scenes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
function write(path, data) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  console.log(`${path} ${Math.round(data.length / 1024)} KB`);
}

/** Android's layers are 108 dp and the launcher shows the middle 72: the 1024 scene fills the middle two thirds. */
const android = (N) => ({ k: 1536 / N, ox: -256, oy: -256 });
/**
 * A maskable icon (the web app manifest's, ADR 0189) is safe in a circle 80% of its width: the 1024 scene fills that
 * middle 80%, as it fills the 72 dp Android shows, so a round mask shows what Android's round icon does.
 */
const maskable = (N) => ({ k: 1280 / N, ox: -128, oy: -128 });

for (const id of APP_ICON_IDS) {
  const scene = SCENES[id];
  const shipped = id === APP_ICON_IDS[0];
  const light = render(1024, scene.light());
  const dark = render(1024, scene.dark());
  const tile = render(1024, tiled(scene.light()));
  const fav16 = png(render(16, scene.favicon(16)));
  const fav32 = png(render(32, scene.favicon(32)));
  const favicon = ico([
    { size: 16, png: fav16 },
    { size: 32, png: fav32 },
    { size: 48, png: png(resize(tile, 48)) },
  ]);

  const phone = `apps/mobile/assets/app-icons/${id}`;
  write(`${phone}/ios.png`, png(light, { opaque: true }));
  write(`${phone}/ios-dark.png`, png(dark, { opaque: true }));
  write(`${phone}/ios-tinted.png`, png(gray(dark), { opaque: true }));
  const AN = shipped ? 1024 : 432;
  write(`${phone}/android-foreground.png`, png(render(AN, frontLayers(scene.light()), android(AN))));
  write(`${phone}/android-background.png`, png(render(AN, backLayers(scene.light()), android(AN)), { opaque: true }));
  write(`${phone}/android-monochrome.png`, png(render(AN, monoLayers(scene.light()), android(AN))));
  if (!shipped) write(`${phone}/android-legacy.png`, png(resize(tile, 192)));
  write(`${phone}/preview.png`, png(resize(light, 180), { opaque: true }));
  write(`${phone}/preview-dark.png`, png(resize(dark, 180), { opaque: true }));

  write(`apps/web/public/app-icons/${id}.ico`, favicon);
  write(`apps/web/public/app-icons/${id}.png`, png(resize(light, 160), { opaque: true }));

  if (shipped) {
    // The Night's sky without its agent: the web draws a workspace's agent on it (apps/web/src/lib/agent-app-icon.ts).
    const sky = scene.light().filter((l) => l.part !== "agent" && l.part !== "eyes");
    write("apps/web/public/app-icons/night-sky.png", png(render(512, sky, { k: 2 }), { opaque: true }));
    write("apps/web/public/favicon.ico", favicon);
    write("apps/web/public/apple-touch-icon.png", png(resize(light, 180), { opaque: true }));
    write("apps/web/public/icon-512.png", png(resize(light, 512), { opaque: true }));
    // The web app manifest's other two: the same at 192, and the maskable one, Android's back and front layers as one.
    write("apps/web/public/icon-192.png", png(resize(light, 192), { opaque: true }));
    const adaptive = [...backLayers(scene.light()), ...frontLayers(scene.light())];
    write("apps/web/public/icon-maskable-512.png", png(render(512, adaptive, maskable(512)), { opaque: true }));
  }
}

for (const pose of MADE_POSES)
  for (const sky of MADE_SKIES) {
    const back = backLayers(madeScene({ sky, color: MADE_COLORS[0], look: MADE_LOOKS[0], pose }));
    const name = pose === "peek" ? `${sky}-peek` : sky;
    write(`apps/mobile/assets/app-icons/made/${name}.png`, png(render(360, back, { k: 1024 / 360 }), { opaque: true }));
  }
