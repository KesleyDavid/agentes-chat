import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The web app manifest (ADR 0177): the name and icons a browser gives the site when it is installed or put on a
// home screen. Vite copies public/ to the build's root, so "/x.png" in the manifest is public/x.png.
const PUBLIC = join(import.meta.dir, "../public");
const INDEX = readFileSync(join(import.meta.dir, "../index.html"), "utf8");

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
}

const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as Manifest;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's size and colour type from its IHDR, and whether it carries a tRNS chunk (transparency). */
function png(path: string) {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual(SIGNATURE);
  expect(bytes.toString("latin1", 12, 16)).toBe("IHDR");
  const chunks: string[] = [];
  for (let at = 8; at + 8 <= bytes.length; at += 12 + bytes.readUInt32BE(at)) {
    chunks.push(bytes.toString("latin1", at + 4, at + 8));
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25], chunks };
}

describe("web app manifest", () => {
  test("index.html links it", () => {
    expect(INDEX).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  test("names the app and opens it standalone at the root", () => {
    expect(manifest.name).toBe("agentes.chat");
    expect(manifest.short_name).toBe("agentes.chat");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
    // The light theme's bar colour, the same as the page's own.
    expect(INDEX).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" media="(prefers-color-scheme: light)" />`,
    );
  });

  test("lists the 192 and 512 icons browsers ask for, and a maskable one", () => {
    const listed = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? "any"}`);
    expect(listed).toContain("192x192 any");
    expect(listed).toContain("512x512 any");
    expect(listed).toContain("512x512 maskable");
  });

  test.each(manifest.icons.map((icon) => [icon.src, icon] as const))(
    "%s is a PNG of its declared size",
    (src, icon) => {
      expect(src.startsWith("/")).toBe(true);
      expect(icon.type).toBe("image/png");
      const path = join(PUBLIC, src);
      expect(existsSync(path)).toBe(true);
      const [width, height] = icon.sizes.split("x").map(Number);
      const file = png(path);
      expect(file.width).toBe(width as number);
      expect(file.height).toBe(height as number);
    },
  );

  test("maskable icons are opaque, so the platform's mask never shows through", () => {
    const maskable = manifest.icons.filter((icon) => icon.purpose?.split(" ").includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) {
      const file = png(join(PUBLIC, icon.src));
      // Colour type 2 is RGB with no alpha channel; a tRNS chunk would still make one colour transparent.
      expect(file.colorType).toBe(2);
      expect(file.chunks).not.toContain("tRNS");
    }
  });
});
