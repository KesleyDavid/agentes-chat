import { expect, test } from "bun:test";
import type { ExecFileOptions, execFile } from "node:child_process";
import { parseRunnerFrame } from "@agenteschat/adapters/machine-protocol";
import { EgressObservation, parseEgress, probeEgress, publicAddress } from "../../runner/egress";

test("egress accepts only public IPv4 and IPv6, including mapped forms", () => {
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(publicAddress(ip)).toBe(true);
  for (const ip of [
    "no",
    "999.1.1.1",
    "127.0.0.1",
    "10.0.0.1",
    "172.31.1.2",
    "192.168.1.1",
    "100.64.1.1",
    "169.254.1.1",
    "0.0.0.0",
    "224.1.1.1",
    "198.18.1.1",
    "198.19.1.1",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:7f00:1",
  ])
    expect(publicAddress(ip)).toBe(false);
  expect(parseEgress({ ip: "8.8.8.8", country: "US", secret: "ignored" })).toEqual({ ip: "8.8.8.8", country: "US" });
  expect(parseEgress({ ip: "8.8.8.8", country: "XX" })).toEqual({ ip: "8.8.8.8" });
});
test("two failures keep an observation; three clear it, a new route restores it", () => {
  const seen = new EgressObservation();
  const first = seen.record({ ip: "8.8.8.8", country: "US" });
  expect(seen.record({ ip: "8.8.8.8", country: "US" })).toBe(first);
  expect(seen.record(null)).toBe(first);
  expect(seen.record({ ip: "127.0.0.1" })).toBe(first);
  expect(seen.record(null)).toEqual({ ip: null });
  expect(seen.record({ ip: "1.1.1.1" })).toEqual({ ip: "1.1.1.1" });
  seen.reset();
  expect(seen.current).toBeNull();
});
test("single-user probe sends no machine token and never follows a redirect", async () => {
  let init: RequestInit | undefined;
  const get = (async (url: URL, opts: RequestInit) => {
    expect(url.href).toBe("https://example.test/api/machines/ip");
    init = opts;
    return Response.json({ ip: "8.8.8.8", country: "US" });
  }) as typeof fetch;
  expect(await probeEgress("https://example.test/", undefined, get)).toEqual({ ip: "8.8.8.8", country: "US" });
  expect(init?.headers).toBeUndefined();
  expect(init?.redirect).toBe("error");
});
test("pong parses an observation and its explicit removal without trusting extra fields", () => {
  expect(
    parseRunnerFrame(
      JSON.stringify({ type: "pong", at: 1, egress: { ip: "8.8.8.8", country: "US", token: "ignored" } }),
    ),
  ).toEqual({ type: "pong", at: 1, egress: { ip: "8.8.8.8", country: "US" } });
  expect(parseRunnerFrame(JSON.stringify({ type: "pong", at: 2, egress: { ip: null } }))).toEqual({
    type: "pong",
    at: 2,
    egress: { ip: null },
  });
  expect(parseRunnerFrame(JSON.stringify({ type: "pong", at: 3, egress: { ip: "<script>" } }))).toEqual({
    type: "pong",
    at: 3,
  });
});

test("system probe ignores user curl settings and inherited proxy or loader variables", async () => {
  let captured: { file: string; args: string[]; options: ExecFileOptions } | undefined;
  const run = ((
    file: string,
    args: string[],
    options: ExecFileOptions,
    done: (err: null, stdout: string, stderr: string) => void,
  ) => {
    captured = { file, args, options };
    done(null, JSON.stringify({ ip: "8.8.8.8" }), "");
    return {};
  }) as unknown as typeof execFile;
  const user = { id: "agent1", user: "ag-a1b2c3d4", uid: 21000 };
  expect(await probeEgress("https://example.test", user, fetch, run, false)).toEqual({ ip: "8.8.8.8" });
  expect(captured?.options.env?.AGENTES_NETWORK_OBSERVATION).toBe("1");
  expect(captured?.file).toBe("/usr/sbin/runuser");
  expect(captured?.args.slice(0, 7)).toEqual(["-u", user.user, "--", "/usr/bin/curl", "-q", "--noproxy", "*"]);
  await probeEgress("https://example.test", user, fetch, run, true);
  expect(captured?.file).toBe("/usr/bin/systemd-run");
  expect(captured?.args).toContain("--slice=agents-21000.slice");
  expect(captured?.args).toContain("/usr/bin/curl");
  // A host with rootless Podman adds the agent's containers service (CONTAINER_HOST, DOCKER_HOST, XDG_RUNTIME_DIR).
  const containers = new Set(["CONTAINER_HOST", "DOCKER_HOST", "XDG_RUNTIME_DIR"]);
  const keys = Object.keys(captured?.options.env ?? {}).filter((k) => !containers.has(k));
  expect(keys.sort()).toEqual([
    "AGENTES_NETWORK_OBSERVATION",
    "AGENTES_SHARED_BIN",
    "ANDROID_ADB_SERVER_PORT",
    "GRADLE_OPTS",
    "HOME",
    "LANG",
    "LOGNAME",
    "PATH",
    "SHELL",
    "USER",
  ]);
});
