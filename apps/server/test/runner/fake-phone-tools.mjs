#!/usr/bin/env node
// Fake adb, xcrun, xcode-select, maestro, scrcpy, bundletool, plutil and idevicesyslog for the phone tests:
// `fake-phone-tools.mjs <tool> args…`. Answers come from $FAKE_PHONE_STATE (JSON, read on every call); every call
// is logged to $FAKE_PHONE_LOG as one JSON line, [tool, ...args]. State:
//   adbDevices: what `adb devices -l` prints
//   facts: { serial: what the facts shell prints }   keyguard: { serial: what the lock screen check prints }
//   install: adb install's answer (installFail: its error, exit 1)   monkey, logcat, pidof: { app: pid }
//   simctl, devicectl: the JSON each lists   launchFail: devicectl's error   simlog: `log show`'s text
//   devicectlFail: `devicectl list devices` fails with it   sdk: the iPhone SDK's version   lockState: devicectl says the iPhone asks for its passcode
//   wdaLocked: WDA says the lock screen shows   wdaRefuse: WDA's error for a tap
//   maestroExit, maestroOutput   javaMissing: maestro says JAVA_HOME isn't set
//   videoFirst: maestro answers once a flow's recording (`*-flow.mp4`, not empty) sits beside its YAML, as on a phone
//   where the recorder is up before the flow ends (on a loaded machine maestro's process could end before the
//   recorder's has written a byte, and the flow came back with no video)
//   wait: recorders (scrcpy, simctl recordVideo, idevicesyslog) run until SIGINT instead of ending at once
//   xcodebuild: build-for-testing writes an .xctestrun (wdaBuildFail: prints it, exit 65); test-without-building
//   serves a fake WebDriverAgent on TEST_RUNNER_USE_PORT and its MJPEG stream on TEST_RUNNER_MJPEG_SERVER_PORT (a
//   real iPhone's 8100 and 9100: $FAKE_WDA_PORT and $FAKE_MJPEG_PORT) until SIGTERM (wdaRunFail: prints it, exit 65). wdaTree: its screen tree
//   (wdaTrees: one per `source` call, the last kept). Its requests are logged as ["wda", method, path, body].
//   ffmpeg: reads stdin to its end, then writes MP4DATA to its last argument
//   changing: each screen capture differs from the last (a live screen)   big: screen captures over 2 MB
//   mdnsOff: `adb mdns check` fails   mdns: what `adb mdns services` lists after its heading
//   pair: what `adb pair` prints (pairFail: on stderr, exit 1)
//   connectable: { "host:port": "the adb devices -l line `adb connect` adds" }
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const [tool, ...args] = process.argv.slice(2);
appendFileSync(process.env.FAKE_PHONE_LOG, `${JSON.stringify([tool, ...args])}\n`);
const state = existsSync(process.env.FAKE_PHONE_STATE)
  ? JSON.parse(readFileSync(process.env.FAKE_PHONE_STATE, "utf8"))
  : {};
// Written, then exited: a pipe's write is asynchronous on macOS and would be cut short by an exit.
const out = (text, code = 0) => process.stdout.write(text, () => process.exit(code));
const fail = (text) => process.stderr.write(text, () => process.exit(1));
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
// A 1080×2400 PNG's first bytes: what the size is read from.
const png = () => {
  const b = Buffer.alloc(state.big ? (2 << 20) + 64 : 33);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(b);
  b.writeUInt32BE(1080, 16);
  b.writeUInt32BE(2400, 20);
  if (state.changing) b.writeUInt32BE(Math.floor(Math.random() * 2 ** 32), 29);
  return b;
};
// A 1206×2622 JPEG's first bytes: SOI, then SOF0 with the size.
const jpeg = () => Buffer.from("ffd8ffc0001108" + "0a3e" + "04b6" + "03012200021101031101", "hex");
/** A recorder: the file now, then until SIGINT (`wait`) or at once. */
const recorder = (file) => {
  writeFileSync(file, "MP4DATA");
  if (!state.wait) process.exit(0);
  process.on("SIGINT", () => process.exit(0));
  setInterval(() => {}, 1000);
};

if (tool === "adb") {
  let serial = null;
  if (args[0] === "-s") serial = args.splice(0, 2)[1];
  const [cmd, ...rest] = args;
  if (cmd === "devices") out(state.adbDevices ?? "List of devices attached\n\n");
  else if (cmd === "version") out("Android Debug Bridge version 1.0.41\nVersion 36.0.2-14143358\n");
  else if (cmd === "mdns" && rest[0] === "check")
    state.mdnsOff
      ? fail("ERROR: mdns daemon unavailable\n")
      : out("mdns daemon version [Openscreen discovery 0.0.0]\n");
  else if (cmd === "mdns") out(`List of discovered mdns services\n${state.mdns ?? ""}\n`);
  else if (cmd === "pair") state.pairFail ? fail(state.pairFail) : out(state.pair ?? "");
  else if (cmd === "connect") {
    const line = state.connectable?.[rest[0]];
    if (!line) out(`failed to connect to '${rest[0]}': Connection refused\n`);
    else {
      const listed = state.adbDevices ?? "List of devices attached\n";
      writeFileSync(process.env.FAKE_PHONE_STATE, JSON.stringify({ ...state, adbDevices: `${listed}${line}\n` }));
      out(`connected to ${rest[0]}\n`);
    }
  } else if (cmd === "disconnect") out(`disconnected ${rest[0]}\n`);
  else if (cmd === "install")
    state.installFail ? fail(state.installFail) : out(state.install ?? "Performing Streamed Install\nSuccess\n");
  else if (cmd === "exec-out") process.stdout.write(png(), () => process.exit(0));
  else if (cmd === "logcat") out(state.logcat ?? "11-09 04:00:00.000  1234  1234 I Acme: hello\n");
  else if (cmd === "pull") {
    writeFileSync(rest[1], "MP4DATA");
    out(`${rest[0]}: 1 file pulled\n`);
  } else if (cmd === "shell") {
    const line = rest.join(" ");
    if (line.includes('echo "model=')) out(state.facts?.[serial] ?? "");
    else if (line.includes("dumpsys window")) out(state.keyguard?.[serial] ?? "");
    else if (line.startsWith("settings get global stay_on_while_plugged_in")) out("0\n");
    else if (line.startsWith("monkey")) out(state.monkey ?? "Events injected: 1\n");
    else if (line.startsWith("am start")) out("Starting: Intent { cmp=com.acme.app/.Main }\n");
    else if (line.startsWith("pidof ")) {
      const pid = state.pidof?.[line.slice(6)];
      pid ? out(`${pid}\n`) : out("", 1);
    } else out("");
  } else out("");
} else if (tool === "xcode-select") out("/Applications/Xcode.app/Contents/Developer\n");
else if (tool === "xcrun" && args[0] === "xcodebuild") {
  const at = (flag) => args[args.indexOf(flag) + 1];
  if (args[1] === "-version") out("Xcode 26.3\nBuild version 17C529\n");
  else if (args[1] === "build-for-testing") {
    if (state.wdaBuildFail) out(state.wdaBuildFail, 65);
    else {
      const products = path.join(at("-derivedDataPath"), "Build", "Products");
      mkdirSync(products, { recursive: true });
      const sim = at("-destination").includes("Simulator");
      writeFileSync(
        path.join(products, `WebDriverAgentRunner_${sim ? "iphonesimulator" : "iphoneos"}26.2-arm64.xctestrun`),
        "",
      );
      out("** TEST BUILD SUCCEEDED **\n");
    }
  } else if (args[1] === "test-without-building") {
    if (state.wdaRunFail) out(state.wdaRunFail, 65);
    else fakeWda();
  } else out("", 1);
} else if (tool === "xcrun") {
  const line = args.join(" ");
  const json = args[args.indexOf("--json-output") + 1];
  if (line.startsWith("simctl list devices")) out(JSON.stringify(state.simctl ?? { devices: {} }));
  else if (line === "--sdk iphoneos --show-sdk-version") state.sdk ? out(`${state.sdk}\n`) : fail("no SDK\n");
  else if (line.startsWith("devicectl device info lockState")) {
    writeFileSync(json, JSON.stringify({ result: { passcodeRequired: state.lockState === true } }));
    out("");
  } else if (line.startsWith("devicectl list devices") && state.devicectlFail) fail(state.devicectlFail);
  else if (line.startsWith("devicectl list devices")) {
    writeFileSync(json, JSON.stringify(state.devicectl ?? { result: { devices: [] } }));
    out("");
  } else if (line.startsWith("devicectl device install app")) {
    if (state.launchFail) fail(state.launchFail);
    else {
      writeFileSync(json, JSON.stringify({ result: { installedApplications: [{ bundleID: "com.acme.app" }] } }));
      out("");
    }
  } else if (line.startsWith("devicectl device process launch")) {
    state.launchFail ? fail(state.launchFail) : out("Launched application with com.acme.app bundle identifier.\n");
  } else if (line.includes(" screenshot ") && args.at(-1) === "-") {
    process.stdout.write(jpeg(), () => process.exit(0));
  } else if (line.includes(" screenshot ")) {
    writeFileSync(args.at(-1), png());
    out("Wrote screenshot\n");
  } else if (line.includes(" recordVideo ")) recorder(args.at(-1));
  else if (line.startsWith("simctl launch")) out(`${args.at(-1)}: 4242\n`);
  else if (line.startsWith("simctl get_app_container")) out("/tmp/Acme.app\n");
  else if (line.startsWith("simctl spawn")) out(state.simlog ?? "one\ntwo\nthree\n");
  else out("");
} else if (tool === "maestro") {
  if (args[0] === "--version") out("2.11.0\n");
  else if (state.javaMissing) fail("ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.\n");
  else if (state.videoFirst) {
    const dir = path.dirname(args.at(-1));
    const recorded = () =>
      readdirSync(dir).some((f) => f.endsWith("-flow.mp4") && statSync(path.join(dir, f)).size > 0);
    const until = Date.now() + 15_000;
    const answer = () =>
      recorded() || Date.now() > until
        ? out(state.maestroOutput ?? "Flow passed\n", state.maestroExit ?? 0)
        : setTimeout(answer, 20);
    answer();
  } else out(state.maestroOutput ?? "Flow passed\n", state.maestroExit ?? 0);
} else if (tool === "scrcpy") {
  if (args[0] === "--version") out("scrcpy 4.0 <https://github.com/Genymobile/scrcpy>\n");
  else recorder(flag("record"));
} else if (tool === "bundletool") {
  const output = flag("output");
  if (output) writeFileSync(output, "APKS");
  out("");
} else if (tool === "plutil") out(args[1] === "CFBundleExecutable" ? "Acme\n" : "com.acme.app\n");
else if (tool === "idevicesyslog") {
  process.stdout.write("Nov  9 04:00:00 iPhone Acme(UIKitCore)[42] <Notice>: com.acme.app hello\n");
  process.on("SIGINT", () => process.exit(0));
  setInterval(() => {}, 1000);
} else if (tool === "ffmpeg") {
  if (args.includes("-encoders")) out(" V....D h264_videotoolbox    VideoToolbox H.264 Encoder\n");
  else {
    process.stdin.on("data", () => {});
    process.stdin.on("end", () => {
      writeFileSync(args.at(-1), "MP4DATA");
      process.exit(0);
    });
  }
} else out("", 1);

/** WebDriverAgent as far as the runner talks to it, and its MJPEG stream (one tiny JPEG every 50 ms). */
function fakeWda() {
  // A real iPhone's ports (8100, 9100) are reached through the fake usbmuxd at $FAKE_WDA_PORT and $FAKE_MJPEG_PORT.
  const env = process.env;
  const port = Number(env.TEST_RUNNER_USE_PORT === "8100" ? env.FAKE_WDA_PORT : env.TEST_RUNNER_USE_PORT);
  const mjpeg = Number(
    env.TEST_RUNNER_MJPEG_SERVER_PORT === "9100" ? env.FAKE_MJPEG_PORT : env.TEST_RUNNER_MJPEG_SERVER_PORT,
  );
  let sources = 0;
  http
    .createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        appendFileSync(
          process.env.FAKE_PHONE_LOG,
          `${JSON.stringify(["wda", req.method, req.url, body ? JSON.parse(body) : null])}\n`,
        );
        const now = JSON.parse(readFileSync(process.env.FAKE_PHONE_STATE, "utf8"));
        const send = (value, extra = {}) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ value, ...extra }));
        };
        if (req.url === "/status") send({ ready: true });
        else if (req.url === "/wda/locked") send(now.wdaLocked === true);
        else if (now.wdaRefuse && req.url.endsWith("/wda/tap"))
          send({ error: "unknown error", message: now.wdaRefuse });
        else if (req.url === "/session") send({ sessionId: "s1" }, { sessionId: "s1" });
        else if (req.url === "/screenshot") send(png().toString("base64"));
        else if (req.url.endsWith("/window/size")) send({ width: 390, height: 844 });
        else if (req.url.includes("/source")) {
          const trees = now.wdaTrees;
          send(
            trees
              ? trees[Math.min(sources++, trees.length - 1)]
              : (now.wdaTree ?? { type: "Application", children: [] }),
          );
        } else send(null);
      });
    })
    .listen(port, "127.0.0.1");
  const jpeg = Buffer.from("ffd8ffc0001108000a001403012200021101031101ffd9", "hex");
  net
    .createServer((sock) => {
      sock.once("data", () => {
        sock.write("HTTP/1.0 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=--BoundaryString\r\n\r\n");
        const timer = setInterval(() => {
          sock.write(`--BoundaryString\r\nContent-type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
          sock.write(Buffer.concat([jpeg, Buffer.from("\r\n\r\n")]));
        }, 50);
        sock.on("close", () => clearInterval(timer));
        sock.on("error", () => clearInterval(timer));
      });
    })
    .listen(mjpeg, "127.0.0.1");
  process.stdout.write("ServerURLHere->http://127.0.0.1:8100<-ServerURLHere\n");
  process.on("SIGTERM", () => process.exit(0));
}
