import { expect, test } from "bun:test";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");

/** Safari on iOS ignores the favicon: the home-screen icon is the page's apple-touch-icon and the name its own meta, else the long <title>. */
test("the page gives iOS a 180x180 opaque apple-touch-icon and a short home-screen name", async () => {
  const html = await Bun.file(join(WEB, "index.html")).text();
  expect(html).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/apple-touch-icon\.png"\s*\/>/);
  expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-title"\s+content="agentes\.chat"\s*\/>/);

  // The file the link points at is served from the build of `public/`; a missing one falls through to the page's HTML.
  const png = new Uint8Array(await Bun.file(join(WEB, "public/apple-touch-icon.png")).arrayBuffer());
  expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = new DataView(png.buffer, png.byteOffset);
  expect(header.getUint32(16)).toBe(180);
  expect(header.getUint32(20)).toBe(180);
  // Color type 2 is RGB: iOS paints transparent pixels black, so the icon must carry no alpha (6 is RGBA).
  expect(png[25]).toBe(2);
});
