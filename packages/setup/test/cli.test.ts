import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../src/cli.ts");

/** The setup as inside the app image (no Docker to drive), in an empty folder, its answers piped in. */
async function setup(args: string[], answers: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "agentes-setup-"));
  try {
    const script = `const { main } = await import(${JSON.stringify(CLI)});
process.exitCode = await main(${JSON.stringify(args)}, { image: true });`;
    const child = Bun.spawn([process.execPath, "-e", script], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", HOME: dir, NO_COLOR: "1" },
      stdin: new Blob([answers.map((a) => `${a}\n`).join("")]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { out: out + err, code, written: readdirSync(dir) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a secret answer piped to the setup leaves only marks in its output", async () => {
  // The second answer is no choice at all: the setup stops there, before it writes anything.
  const { out, code, written } = await setup(["--network", "tailscale"], ["tskey-auth-EXAMPLE00000000", "9"]);
  expect(out).toContain("Paste the auth key");
  expect(out).toContain("▪▪▪▪▪▪▪▪");
  expect(out).not.toContain("tskey-auth-E");
  expect(out).not.toContain("EXAMPLE");
  expect(code).toBe(1);
  expect(written).not.toContain(".env");
}, 60_000);
