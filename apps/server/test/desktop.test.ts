import { afterEach, expect, test } from "bun:test";
import { MACHINE_PROTOCOL_VERSION, type ServerFrame } from "@agenteschat/adapters";
import { parseReleaseBody, parseSha256 } from "../src/routes/desktop";
import { browser, createTestServer, pairComputer, seedOrg, signUp, type TestServer } from "./harness";

let t: TestServer | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});
/** The current test's server (set by the test). */
const server = () => {
  if (!t) throw new Error("no server");
  return t;
};

const SUM = "a".repeat(64);
const MANIFEST = '{"version":"1.4.0","pgMajor":18,"pglite":"0.5.8","files":{}}\n';
const ASSETS = "https://api.github.com/repos/agentes-chat/agentes-chat/releases/assets";
const asset = (name: string) => ({ name, url: `${ASSETS}/${name}` });
const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `desktop-v${version}`,
  body: "Melhorias.\nmin-version: 0.1.0\n",
  published_at: "2026-10-17T12:00:00Z",
  assets: [asset(`agentes_${version}_universal.dmg`), asset(`agentes_${version}_universal.dmg.sha256`)],
  ...extra,
});

/** A fake GitHub: releases newest first; assets redirect to a "signed" URL that must not get our token. */
function fakeGithub(releases: Record<string, unknown>[]) {
  const calls: { url: string; auth: string | null }[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url, auth });
    if (url.startsWith("https://signed.example/")) {
      if (auth) return new Response("two auth mechanisms", { status: 400 });
      const name = url.slice("https://signed.example/".length);
      if (name.endsWith(".sha256")) return new Response(`${SUM}  agentes.dmg\n`);
      if (name.endsWith(".sig")) return new Response("SIGNATURE-BASE64\n");
      if (name.endsWith(".json")) return new Response(MANIFEST);
      const headers = { "content-type": "application/x-apple-diskimage", "content-length": "9" };
      return new Response("DMG-BYTES", { headers });
    }
    if (auth !== "Bearer ghp_test") return new Response("no", { status: 401 });
    if (url.endsWith("/releases?per_page=30")) return Response.json(releases);
    const tag = url.match(/\/releases\/tags\/(.+)$/)?.[1];
    if (tag) {
      const found = releases.find((r) => r.tag_name === decodeURIComponent(tag));
      return found ? Response.json(found) : new Response("not found", { status: 404 });
    }
    const name = url.match(/\/releases\/assets\/(.+)$/)?.[1];
    if (name) return new Response(null, { status: 302, headers: { location: `https://signed.example/${name}` } });
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch: fakeFetch, calls };
}

test("release body and checksum parsing", () => {
  expect(parseReleaseBody("Novidades\n\nmin-version: v0.2.0\n- item")).toEqual({
    notes: "Novidades\n\n- item",
    minVersion: "0.2.0",
  });
  expect(parseReleaseBody(null)).toEqual({ notes: "" });
  // The first-open steps the CI adds are for the release page, not the app's update notes.
  expect(parseReleaseBody("- item\n\n<!-- install -->\n## Installing (first open)\nmin-version: 9.9.9")).toEqual({
    notes: "- item",
  });
  expect(parseSha256(`${SUM.toUpperCase()}  file.dmg`)).toBe(SUM);
  expect(parseSha256("nope")).toBeNull();
});

test("without a token the desktop endpoints answer 404", async () => {
  const github = fakeGithub([release("0.2.0")]);
  t = await createTestServer({ desktopFetch: github.fetch });
  expect((await server().app.request("/api/desktop/latest?target=darwin&arch=arm64")).status).toBe(404);
  expect((await server().app.request("/api/desktop/download/0.2.0/agentes_0.2.0_universal.dmg")).status).toBe(404);
  expect(github.calls).toEqual([]);
});

test("latest: the newest desktop-v* release with its dmg and checksum, cached, open to the web view", async () => {
  const github = fakeGithub([
    { tag_name: "v9.9.9", assets: [] },
    release("0.3.0", { draft: true }),
    release("0.2.0"),
    release("0.1.0"),
  ]);
  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: github.fetch });
  const res = await server().app.request("/api/desktop/latest?target=darwin&arch=arm64", {
    headers: { origin: "tauri://localhost" },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(await res.json()).toEqual({
    version: "0.2.0",
    url: "http://localhost:3000/api/desktop/download/0.2.0/agentes_0.2.0_universal.dmg",
    sha256: SUM,
    notes: "Melhorias.",
    publishedAt: "2026-10-17T12:00:00Z",
    minVersion: "0.1.0",
  });
  // Both architecture spellings; one universal build.
  for (const arch of ["aarch64", "x64", "x86_64"]) {
    expect((await server().app.request(`/api/desktop/latest?target=darwin&arch=${arch}`)).status).toBe(200);
  }
  expect((await server().app.request("/api/desktop/latest?target=windows&arch=x64")).status).toBe(404);
  // Cached: GitHub's release list was read once.
  expect(github.calls.filter((c) => c.url.endsWith("/releases?per_page=30"))).toHaveLength(1);
  // The signed asset URL never gets our token.
  expect(github.calls.filter((c) => c.url.startsWith("https://signed.example/")).every((c) => c.auth === null)).toBe(
    true,
  );
  const preflight = await server().app.request("/api/desktop/latest", { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
});

test("update: Tauri's format for signed builds, 204 when the release has no updater bundle", async () => {
  const signed = release("0.3.0", {
    assets: [
      asset("agentes_0.3.0_universal.dmg"),
      asset("agentes_0.3.0_universal.dmg.sha256"),
      asset("agentes_0.3.0_universal.app.tar.gz"),
      asset("agentes_0.3.0_universal.app.tar.gz.sig"),
    ],
  });
  const github = fakeGithub([signed]);
  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: github.fetch });
  const res = await server().app.request("/api/desktop/update?target=darwin&arch=aarch64&current=0.2.0");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    version: "0.3.0",
    notes: "Melhorias.",
    pub_date: "2026-10-17T12:00:00Z",
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_universal.app.tar.gz",
    signature: "SIGNATURE-BASE64",
  });
  // The web view's endpoint doesn't carry the updater fields.
  const latest = (await (await server().app.request("/api/desktop/latest?target=darwin")).json()) as object;
  expect("updater" in latest).toBe(false);
  expect((await server().app.request("/api/desktop/update?target=windows&arch=x64")).status).toBe(204);

  const old = fakeGithub([release("0.2.0")]);
  await t.close();
  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: old.fetch });
  expect((await server().app.request("/api/desktop/update?target=darwin&arch=x86_64")).status).toBe(204);
});

test("Windows and Linux: each platform's own files, from the newest release that has them", async () => {
  const all = (v: string) => [
    asset(`agentes_${v}_universal.dmg`),
    asset(`agentes_${v}_universal.dmg.sha256`),
    ...["x64", "arm64"].flatMap((arch) => [
      asset(`agentes_${v}_${arch}-setup.exe`),
      asset(`agentes_${v}_${arch}-setup.exe.sha256`),
      asset(`agentes_${v}_${arch}-setup.exe.sig`),
    ]),
    ...["amd64", "arm64"].flatMap((arch) => [
      asset(`agentes_${v}_${arch}.deb`),
      asset(`agentes_${v}_${arch}.deb.sha256`),
      asset(`agentes_${v}_${arch}.AppImage`),
      asset(`agentes_${v}_${arch}.AppImage.sha256`),
      asset(`agentes_${v}_${arch}.AppImage.sig`),
    ]),
  ];
  // 0.4.0 was a Mac-only build: Windows and Linux keep 0.3.0.
  const github = fakeGithub([release("0.4.0"), release("0.3.0", { assets: all("0.3.0") })]);
  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: github.fetch });
  const latest = async (query: string) => {
    const res = await server().app.request(`/api/desktop/latest?${query}`);
    return res.status === 200
      ? ((await res.json()) as { version: string; url: string; appImage?: { url: string; sha256: string } })
      : res.status;
  };
  // Only Linux has a second download.
  const mac = await latest("target=darwin&arch=arm64");
  expect(mac).toMatchObject({ version: "0.4.0" });
  expect(mac).not.toHaveProperty("appImage");
  const windows = await latest("target=windows&arch=x86_64");
  expect(windows).toMatchObject({
    version: "0.3.0",
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_x64-setup.exe",
  });
  expect(windows).not.toHaveProperty("appImage");
  // A deb is the first download on Linux; the AppImage, which updates itself, is offered beside it for a
  // distribution that takes no deb.
  expect(await latest("target=linux&arch=x64")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_amd64.deb",
    appImage: {
      url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_amd64.AppImage",
      sha256: SUM,
    },
  });
  // ARM64 has builds of its own on Windows and Linux; a chip with none gets nothing.
  expect(await latest("target=windows&arch=arm64")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_arm64-setup.exe",
  });
  expect(await latest("target=linux&arch=aarch64")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_arm64.deb",
    appImage: { url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_arm64.AppImage" },
  });
  expect(await latest("target=linux&arch=armv7")).toBe(404);
  expect(await latest("target=freebsd&arch=x64")).toBe(404);

  const update = async (query: string) => {
    const res = await server().app.request(`/api/desktop/update?${query}`);
    return res.status === 200 ? ((await res.json()) as { url: string; signature: string }) : res.status;
  };
  expect(await update("target=windows&arch=x86_64&current=0.2.0")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_x64-setup.exe",
    signature: "SIGNATURE-BASE64",
  });
  expect(await update("target=linux&arch=x86_64&current=0.2.0&bundle=appimage")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_amd64.AppImage",
  });
  expect(await update("target=windows&arch=aarch64&current=0.2.0")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_arm64-setup.exe",
  });
  expect(await update("target=linux&arch=aarch64&current=0.2.0&bundle=appimage")).toMatchObject({
    url: "http://localhost:3000/api/desktop/download/0.3.0/agentes_0.3.0_arm64.AppImage",
  });
  expect(await update("target=linux&arch=aarch64&current=0.2.0&bundle=deb")).toBe(204);
  // A deb install can't take the AppImage (the updater would refuse it after the whole download): it downloads
  // the new deb instead, and so does an app that doesn't say which it is.
  expect(await update("target=linux&arch=x86_64&current=0.2.0&bundle=deb")).toBe(204);
  expect(await update("target=linux&arch=x86_64&current=0.2.0")).toBe(204);
  // The Mac's newest release has no updater bundle: nothing to install.
  expect(await update("target=darwin&arch=aarch64&current=0.2.0")).toBe(204);
});

test("download links are on PUBLIC_URL, whatever address the request came in on", async () => {
  const signed = release("0.6.0", {
    assets: [
      asset("agentes_0.6.0_universal.dmg"),
      asset("agentes_0.6.0_universal.dmg.sha256"),
      asset("agentes_0.6.0_universal.app.tar.gz"),
      asset("agentes_0.6.0_universal.app.tar.gz.sig"),
    ],
  });
  t = await createTestServer({
    env: { DESKTOP_RELEASES_TOKEN: "ghp_test", PUBLIC_URL: "https://app.agentes.chat" },
    desktopFetch: fakeGithub([signed]).fetch,
  });
  const links = async (site: string) => {
    const latest = await server().app.request(`${site}/api/desktop/latest?target=darwin&arch=arm64`);
    const update = await server().app.request(`${site}/api/desktop/update?target=darwin&arch=aarch64&current=0.5.5`);
    return [((await latest.json()) as { url: string }).url, ((await update.json()) as { url: string }).url];
  };
  const onPublicUrl = [
    "https://app.agentes.chat/api/desktop/download/0.6.0/agentes_0.6.0_universal.dmg",
    "https://app.agentes.chat/api/desktop/download/0.6.0/agentes_0.6.0_universal.app.tar.gz",
  ];
  expect(await links("https://agentes.chat")).toEqual(onPublicUrl);
  expect(await links("https://app.agentes.chat")).toEqual(onPublicUrl);
});

test("download streams an asset of a desktop-v* release, as an attachment; nothing else", async () => {
  const github = fakeGithub([release("0.2.0"), { tag_name: "v1.0.0", assets: [asset("secret.txt")] }]);
  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: github.fetch });
  const res = await server().app.request("/api/desktop/download/0.2.0/agentes_0.2.0_universal.dmg");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toBe('attachment; filename="agentes_0.2.0_universal.dmg"');
  expect(res.headers.get("content-type")).toBe("application/x-apple-diskimage");
  expect(await res.text()).toBe("DMG-BYTES");
  expect((await server().app.request("/api/desktop/download/0.2.0/other.dmg")).status).toBe(404);
  expect((await server().app.request("/api/desktop/download/1.0.0/secret.txt")).status).toBe(404);
  expect((await server().app.request("/api/desktop/download/..%2F..%2Fx/a.dmg")).status).toBe(404);
});

test("native packages: the newest v* release's manifest and signature, never a desktop-v* one", async () => {
  const nativeRelease = (version: string, extra: Record<string, unknown> = {}) => ({
    tag_name: `v${version}`,
    assets: [asset("native.json"), asset("native.json.sig"), asset(`agentes-native-${version}-linux-x64.tar.gz`)],
    ...extra,
  });
  const github = fakeGithub([
    release("9.0.0", { assets: [...release("9.0.0").assets, asset("native.json"), asset("native.json.sig")] }),
    nativeRelease("1.5.0", { draft: true }),
    nativeRelease("1.4.0"),
    nativeRelease("1.3.0"),
  ]);
  const first = await createTestServer({ desktopFetch: github.fetch });
  expect((await first.app.request("/api/native/latest")).status).toBe(404);
  await first.close();
  expect(github.calls).toEqual([]);

  t = await createTestServer({ env: { DESKTOP_RELEASES_TOKEN: "ghp_test" }, desktopFetch: github.fetch });
  const res = await server().app.request("/api/native/latest");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ version: "1.4.0", manifest: MANIFEST, signature: "SIGNATURE-BASE64" });
  await server().app.request("/api/native/latest");
  expect(github.calls.filter((c) => c.url.endsWith("/releases?per_page=30"))).toHaveLength(1);

  const tarball = await server().app.request("/api/native/download/1.4.0/agentes-native-1.4.0-linux-x64.tar.gz");
  expect(tarball.status).toBe(200);
  expect(tarball.headers.get("content-disposition")).toBe(
    'attachment; filename="agentes-native-1.4.0-linux-x64.tar.gz"',
  );
  // The desktop app's releases aren't the server's, and the other way round.
  expect((await server().app.request("/api/native/download/9.0.0/native.json")).status).toBe(404);
  expect((await server().app.request("/api/desktop/download/1.4.0/native.json")).status).toBe(404);
});

test("reduce over HTTP: admins or the pairer, only removing or turning off", async () => {
  t = await createTestServer({ env: { ALLOW_SIGNUP: "true" }, reply: () => ({ chunks: ["ok"] }) });
  const owner = browser(server());
  await signUp(owner, "owner@example.com");
  const { orgId } = await seedOrg(owner);
  const api = (path: string, init?: Parameters<typeof owner>[1]) =>
    owner(`/api/app/organizations/${orgId}${path}`, init);
  const RUNNER = {
    hostname: "mac",
    os: "darwin",
    arch: "arm64",
    version: "0.9.0",
    protocol: MACHINE_PROTOCOL_VERSION,
    workspace: "/Users/a/agentes",
  };
  const paired = await pairComputer(server(), api, { ...RUNNER, exec: true });
  let access = {
    folders: [{ path: "/Users/a/Projects", agents: [] as string[] }],
    tools: { claude: true, codex: false, commands: true },
  };
  const hub = server().engine.machineHub;
  const sent: ServerFrame[] = [];
  const conn = hub.open({
    send(text: string) {
      const frame = JSON.parse(text) as ServerFrame;
      sent.push(frame);
      if (frame.type !== "request" || frame.op !== "access.reduce") return;
      if (frame.disableTool) access = { ...access, tools: { ...access.tools, [frame.disableTool]: false } };
      if (frame.removeFolder) access = { ...access, folders: [] };
      const result = JSON.stringify({ type: "result", id: frame.id, ok: true, data: { access } });
      setTimeout(() => void hub.message(conn, result), 1);
    },
    close() {},
  });
  await hub.message(conn, JSON.stringify({ type: "hello", token: paired.token, ...RUNNER, exec: true, access }));

  const list = (await (await api("/machines")).json()) as { machines: { access: unknown; protocol: number }[] };
  expect(list.machines[0]).toMatchObject({ access, protocol: MACHINE_PROTOCOL_VERSION });
  // Never widens: nothing but removing a folder or turning a tool off is accepted.
  const widen = await api(`/machines/${paired.machineId}/access/reduce`, { json: { addFolder: { path: "/" } } });
  expect(widen.status).toBe(400);
  const res = await api(`/machines/${paired.machineId}/access/reduce`, { json: { disableTool: "commands" } });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { access: typeof access }).access.tools.commands).toBe(false);
  expect(sent.some((s) => s.type === "request" && s.op === "access.reduce" && s.disableTool === "commands")).toBe(true);
  const offCursor = await api(`/machines/${paired.machineId}/access/reduce`, { json: { disableTool: "cursor" } });
  expect(offCursor.status).toBe(200);
  expect(((await offCursor.json()) as { access: { tools: { cursor?: boolean } } }).access.tools.cursor).toBe(false);
  const offOpencode = await api(`/machines/${paired.machineId}/access/reduce`, { json: { disableTool: "opencode" } });
  expect(offOpencode.status).toBe(200);
  expect(((await offOpencode.json()) as { access: { tools: { opencode?: boolean } } }).access.tools.opencode).toBe(
    false,
  );
  // A sign-up and a pairing on a fresh database: seconds on a loaded runner, and the preload's longer
  // default timeout reaches only the first test file of a run.
}, 30_000);
