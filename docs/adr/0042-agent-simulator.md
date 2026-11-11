# 0042. The agent's phone simulator: Android first, iOS on Macs

- Status: Proposed. Superseded in part by ADR 0077 (2026-10-28): the Cloud's computers are no longer Daytona containers, and no computer time is metered or counted against daily minutes. Amended 2026-11-11: real iPhones through the test helper (see "Amendment")
- Date: 2026-10-20. Revised 2026-10-20: Android first, self-host first (an optional compose profile), Cloud next (KVM hosts only), iOS on Macs (see "Revision")
- Extends: ADR 0025 (connected computers), ADR 0031 §5 and §13 (computer use: simulator, explorations become tests), ADR 0040 (agent browser: tools, handoff, live view)
- Out of scope for now: real phones over USB, protected mode (ADR 0030), Cloud iOS for anything but developing and testing the customer's own app (§12)

## Revision (2026-10-20)

The first version (the same day) put iOS first on a rented Mac, Android after it, and left the Android live view open. Two things changed the order:

- The code is open source with a docker-compose self-host, so the machines self-hosters already run come first. Those are Linux servers: Android runs there with KVM, and iOS can't run there at all (it needs Apple hardware).
- Android also runs on bare-metal Macs (HVF) and Windows (WHPX), and CI can test it (GitHub's Linux runners have KVM). iOS depends on Xcode's private frameworks: Xcode 27 broke Orca's iOS simulator from 2026-07-29 to 2026-10-01 (Orca #11388 to #17587), and Orca's issue about Device Hub dropping input is still open (#23997).

Kept: two layers (§1), the iOS driver choice (§2), one screen shared with the browser (§4), the tools (§5), one device per agent locked lazily (§6). Changed: Android is the first driver, with a readiness guard (§3); the live view is decided (§7); testing (§8); the order. New: the self-host recipe (§9), Cloud (§10), Mac hosts (§11), iOS hosting (§12).

## Context

ADR 0031 §5 planned the simulator as `xcrun simctl` + `idb` (iOS) and `adb` (Android), with Maestro to save flows as tests. Since then we shipped the agent browser (ADR 0040): `browser_*` tools for every brain, a Cloudflare-style handoff, a JPEG live view relayed in memory, all in the chat card. The question was whether the simulator should be "Maestro" or "what Orca does", and whether it can reuse the browser's path.

### How others do it (checked 2026-10-20, code read, nothing run)

| | iOS | Android | Live view | Person takes over |
|---|---|---|---|---|
| **Orca** (Stably, MIT) | `simctl` for the device list and boot; **serve-sim** (Evan Bacon/Expo, Apache-2.0) for frames, input and the accessibility tree through Apple's private CoreSimulator/SimulatorKit (IOSurface capture, Indigo HID events) | `adb`, `emulator`, `uiautomator dump`; **scrcpy-server** 2.4 (Apache-2.0) for an H.264 stream; input still `adb shell input` | iOS: MJPEG from serve-sim, capped at 30 fps; Android: H.264 decoded with WebCodecs onto a canvas | Yes: the pane and the agent share one stream and one helper |
| **OpenMausBot** (Apache-2.0) | None | Physical USB phones only (emulators refused on purpose), bundled platform-tools, raw `adb` | A full PNG about every 0.85 s, desktop app only | No handoff; only a per-turn lock between agent threads |
| **OpenBot** (CopilotKit, MIT) | None | None | — | — |

What Orca gives the agent: an `orca emulator …` CLI (`list`, `attach`, `tap`, `gesture`, `type`, `button`, `rotate`, `ax`, …) taught by a skill file; the screen is read as an accessibility tree (at most 500 nodes, frames normalized 0..1), with no screenshot verb. OpenMausBot's `read_screen` is the same idea (at most 250 text lines with bounds, `tap_text` on a match, read again after every action). OpenMausBot first locked the phone for the whole turn as soon as the skill matched, which broke other turns running at the same time (their issue #1663); they now lock at the first real phone tool call. Orca is local only (Electron IPC; remote devices out of scope), runs one serve-sim on a fixed port, so a second attach mirrors the wrong simulator (#12893), and its `adb forward --remove-all` wiped every forward on the machine (#28769).

### Tools (checked 2026-10-20)

- **Maestro** (Apache-2.0) is a test format and runner (YAML flows). Good for saved tests; poor for live exploration: `maestro mcp` has no direct tap tool, each command pays JVM startup, and it has no live view we could relay.
- **serve-sim**: headless (no Simulator window) MJPEG or H.264 stream, a WebSocket for touches, buttons and typing (US keyboard only), and an accessibility bridge. Node, arm64. Proven in a shipped product (Orca).
- **Baguette** (Apache-2.0, v0.2.x): one Swift CLI for headless boot, 60 fps MJPEG/H.264, multi-touch, keyboard, buttons and `describe-ui` as JSON, plus a JS SDK. More complete than serve-sim but very young.
- **idb** (Meta, MIT): active again (Swift rewrite, Xcode 26 required), but a Python client plus a companion per device is a heavier install.
- **AXe** (MIT): good one-shot CLI, but `describe-ui` restarts `testmanagerd`, which ends every XCUITest session on the Mac (Maestro's iOS driver, other agents) (AXe issue #76). Not a primary driver.
- **mobilecli** is FSL-1.1 (no competing use): not embeddable, and mobile-mcp needs it. Appium/WebDriverAgent: heavy and slow for this.
- Android: `adb` + `uiautomator dump` + **scrcpy-server** (H.264, and a control socket faster than `adb input`). `adb shell input text` is ASCII only; scrcpy's UHID keyboard types every character.
- **agent-device** (Callstack, MIT): CLI, MCP and Node API with snapshot refs and device claims, no live view. A candidate structure-and-action layer for the spike.

Risks found:

- Every headless iOS tool uses Apple's private frameworks and can break with any Xcode release.
- **Xcode 27 replaces Simulator.app with Device Hub**, which can disconnect the legacy touch and keyboard services. serve-sim and Baguette ship a "repair input" that restarts SpringBoard (closes running apps). Clone simulators may not show in Device Hub.
- A simulator booted only with `simctl` may have no framebuffer until a tool attaches one (reported by an idb_companion user).
- No end-to-end latency numbers published anywhere; our server relay will dominate, as it does for the browser.

### Android hosts (checked 2026-10-20)

- The SDK emulator needs hardware acceleration with a system image of the host's CPU: KVM on Linux, HVF on macOS, WHPX on Windows. Without it, `-accel off` is "not supported and is very slow" and starts only with `ANDROID_I_WANT_MY_TCG=yes`. A missing KVM is the most likely cause of a gray screen in a cloud VM.
- Other documented gray or black screens: an ARM image on an x86 host (no acceleration), a GPU mode the host can't do, the Vulkan path (a gray "Starting up" hang that `-feature -Vulkan` fixes), a snapshot restored under software rendering ("not reliable"), too little memory or disk (an API 37 device needs 4 GB; under 5 GB of free disk the emulator won't start), and capturing a window that doesn't exist (`-no-window` has none: capture from the device).
- Emulator 37.2.12 is current. `-gpu software` (Lavapipe) arrived in 36.4.9, which deprecated `guest` and `swiftshader_indirect`.

| Host | Runs the emulator |
|---|---|
| Bare-metal Linux (Hetzner AX, OVHcloud Metal, AWS `.metal`) | Yes |
| AWS C7i, C8i, M7i, M8i, R7i, R8i, X8i, I7i, I7ie (and their flex/d variants) with `NestedVirtualization=enabled` | Yes, at no extra cost (since 2026-02, more types since 2026-06); AWS recommends bare metal for performance |
| GCP Intel VMs and N4D (not E2, Arm or memory-optimized), when the org policy allows nesting | Yes, at least 10% slower on CPU-bound work |
| Azure sizes that list nested virtualization (e.g. Dv5) | Yes |
| GitHub-hosted Linux runners (2+ vCPU, after a udev rule) | Yes: CI can test it |
| Hetzner Cloud VMs; Daytona containers (our Cloud computers); E2B (Firecracker); Fly.io | No |
| Daytona VM class; Modal VM sandboxes | Not documented, or on request: probe before relying on them |
| macOS VMs (GitHub's macOS runners, Tart, Orka) | No: arm64 macOS VMs don't nest, so HVF inside them fails |

- **redroid** runs Android in a container on the host's kernel, with no VM and so no KVM: `--privileged` and the host's `binder_linux` module (`ashmem_linux` before kernel 5.18). amd64 and arm64, no Google services, adb + scrcpy, a software GPU by default (15 fps). Its own README: "Should NOT expose adb port on public network". Privileged, so never for several tenants on one host.
- **Images.** Google publishes emulator container images only for API 28–30 (emulator 30.1.2, 2020): older than `-gpu software` (36.4.9) and today's API levels. Current ones are built with Google's scripts (google/android-emulator-container-scripts, Apache-2.0). The Android SDK license (§3.4) bars redistributing the SDK or any part of it, so nobody but Google may publish an image with the emulator or a system image in it.
- **Januscape** (CVE-2026-53359, disclosed 2026-07-06): a guest escapes to the host through KVM's nested virtualization on x86. The mitigation is `nested=0`.
- **Licenses to avoid:** budtmo/docker-android (a custom Apache license with mandatory data collection; headless mode and Android 15+ are paid), mobilecli and Tart (FSL-1.1), Argent (proprietary binaries, opt-out telemetry), Anbox Cloud (commercial).

### Live view (checked 2026-10-20)

- scrcpy 5.0.1 (Apache-2.0, 2026-10-08, signed `SHA256SUMS`): H.264 at 8 Mbps by default with an I-frame every 10 s, and a control socket (touch, clipboard paste, UHID keyboard, `RESET_VIDEO` since 3.0). Its protocol is internal, with no compatibility between versions.
- Tango (`yume-chan/ya-webadb`, MIT): `@yume-chan/scrcpy` speaks every scrcpy version through 5.0.1, next to `@yume-chan/adb` and `@yume-chan/scrcpy-decoder-webcodecs`. A better base than porting Orca's 2.4 parser.
- WebCodecs `VideoDecoder` is in Chromium and in Safari and WKWebView 16.4+.
- `RESET_VIDEO` restarts capture and encoding of the one shared stream, so every viewer stutters when someone joins. Orca caches the codec config (SPS/PPS) and the current GOP (at most 120 frames) and replays them to a late viewer instead.
- WebRTC only comes with a vendor or with Google's and Cuttlefish's gateways, and needs UDP and TURN. Our relay is a WebSocket (ADR 0040). Limrun's WebRTC viewer prefers VP9 and HEVC, so it can't feed an H.264 path either.

### iOS hosts and Apple's license (checked 2026-10-20)

- macOS Tahoe license: §2B(iii) allows up to 2 more copies of macOS in VMs per Mac, for development, testing, macOS Server or personal non-commercial use, and no service bureau or time-sharing outside §3. §3 allows leasing a Mac only in its entirety, for at least 24 consecutive hours, to one lessee's sole and exclusive use, only for "Permitted Developer Services" (continuous integration: building and automated testing during software development), after telling Apple. §3D: under a lease, only one of the lessor and the lessee uses the 2 VM copies.
- Hosts: EC2 Mac (24 h minimum allocation; mac-m4.metal about $1.23/h), Scaleway M4 (from €149/month), MacStadium M4 (from $149/month), all bare metal.
- About 4 GB of memory per booted simulator (0.9 GB trimmed): a 32 GB Mac holds about 4–6 (estimate).

## Decision

### 1. Two layers: live driving like Orca, Maestro only for saved tests

- **Live (exploration, live view, take over):** the runner drives the device itself, the Orca way.
- **Saved tests:** when a flow works, the agent writes it as a Maestro YAML in the project and a routine reruns it with almost no model (ADR 0031 §13). If Maestro's startup or fixed iOS driver ports block parallel runs, `maestro-runner` reads the same YAML.

### 2. iOS: `simctl` + one driver behind an interface

- `xcrun simctl` for create, boot, erase, install, launch, deep links, permissions, location, appearance, push.
- A **simulator driver** in the runner for frames, input and the accessibility tree. First choice **serve-sim** (proven in Orca, TypeScript/Node like the runner); **Baguette** as the second implementation of the same interface. Pinned versions, hash-checked, shipped like the `agent-browser` sidecar.
- AXe and idb are not used as the main driver (AXe kills XCUITest sessions; idb is a heavier install). idb stays a possible fallback.
- Comes after Android, on Macs only (§11, §12).

### 3. Android first: `adb` + scrcpy, and never a gray screen

- `adb` for install, launch, permissions and logs; `uiautomator dump` for the tree (a helper on the device, such as uiautomator2's server, if `dump`'s "could not get idle state" during animations gets in the way).
- Input: `adb shell input` for taps and swipes; text through scrcpy's UHID keyboard or an IME helper (`input text` is ASCII only). `phone_type_secret` never goes through the clipboard: any app can read it.
- scrcpy-server 5.0.1, pinned and checked against its signed SHA-256, pushed to the device by the runner; the runner speaks to it with `@yume-chan/scrcpy` and `@yume-chan/adb` (MIT).
- On a computer with the Android SDK (Linux with KVM, a bare-metal Mac, Windows), the runner creates one device per agent from a template, with its user data in the agent's folder: logins survive, and no snapshots (unreliable under software rendering). Launch: `emulator -avd <agent> -no-window -no-audio -no-boot-anim -no-snapshot-load -gpu software -feature -Vulkan`; `-gpu host` only on a machine with a real GPU.
- x86_64 system images on x86 hosts (ARM-only apps run through translation from API 30; some ARMv7 binaries fail), arm64-v8a on Apple silicon.
- About 2 vCPU and 4–6 GB of memory per emulator (estimate), and 5 GB of free disk to start.
- Ports picked at random per device; the runner removes only its own `adb forward`s, never `--remove-all`.

**Readiness guard:**

- **Before offering Android:** `emulator -accel-check` and, on Linux, a readable `/dev/kvm`. The runner reports the result in `hello.simulator` (`android: { sdk, accel: "ok" | "missing", reason }`). Without acceleration the server doesn't offer Android, and the computer's page says why in plain words ("this computer can't run Android: KVM is missing") with the ways out (a KVM host, or redroid in the compose recipe). Never a TCG fallback.
- **After each boot, before the first `phone_*` result:** `sys.boot_completed` is 1 (within 180 s), the launcher is in front, and a first frame isn't one flat color. Otherwise one retry with a cold boot, then the call fails with the cause (no acceleration; an ARM image on x86, from `ro.product.cpu.abi`; the GPU mode; low memory or disk) and the tail of the emulator's log.
- **While running:** a device that stops sending frames is restarted, not shown gray.

### 4. Same path as the browser: one "screen" for both

Most of ADR 0040 is reused. The browser-only names become a **screen** with a kind (`browser` | `simulator`; the virtual desktop later fits the same shape), instead of copying everything as `simulator*` (MVP: no compatibility layer, one relay and one handoff to maintain):

| From the browser | Change |
|---|---|
| Machine socket and hub (`machine-hub.ts`, `machine-protocol.ts`) | New ops only |
| Live relay (`browser/live.ts`, `StreamRelay`, `BrowserFrame`) | Generalized to screen frames with a `FrameSource` per kind and a codec per frame (`jpeg` \| `h264`, with key and config flags). JPEG keeps "newest frame wins"; H.264 is delivered in order, and a viewer that falls behind skips to the next keyframe. serve-sim's MJPEG is JPEG frames, so it fits as is. Still nothing in Postgres |
| Person's input (`realtime/browser.ts`, `BrowserInputEvent`, 25 ms batches) | Generalized; `touch` already exists, add hardware buttons and rotate |
| Handoff (`browser/handoff.ts`, `browser_handoffs`) | Same rules (10 min to open, 2 min grace, agent paused, re-reads after hand back), keyed by screen kind; new migration |
| Chat card that becomes the live view (web + mobile) | Same card, a phone frame instead of the address bar |
| Scope, tools for every brain, notifications, push | Same pattern |

### 5. Tools

- `phone_*` tools for every brain (Tool Gateway in the cloud, the `agentes` MCP for Claude Code/Codex), never the raw CLI: `phone_devices`, `phone_install`, `phone_open_app`, `phone_open_link`, `phone_read` (the screen as text with a number per element, coordinates 0..1), `phone_tap` (by number or text; a point only as fallback), `phone_type`, `phone_type_secret`, `phone_swipe` (by direction), `phone_button` (home, back, lock, rotate), `phone_wait`, `phone_screenshot` (visual checks), `phone_ask_person`, `phone_close`.
- The same tools on every host: a connected computer, the compose recipe (§9), a Cloud host (§10), a Mac (§11). Only the runner knows where the device runs.
- Structure first: the agent reads the tree after every action; screenshots are for visual checks.
- Sensitive actions (pay, delete, send on someone's behalf) become approval cards; screen text never grants permissions.

### 6. One device per agent, locked lazily

- Each agent gets its own device (own device ID, own driver process, ports picked at random) so two agents never install over each other's app; per-agent build caches (`xcodebuild -derivedDataPath` in the agent's folder).
- The device is claimed at the first real `phone_*` call and checked on every call, never for the whole turn on a guess (OpenMausBot #1663).
- Where devices are fixed (the compose recipe, §9), the runner binds an agent to a free one at its first call and keeps that binding, so the agent's logins stay in that device's data. With every device taken, the tool says so.
- The runner reports `simulator` (with platforms, runtimes and the readiness result) only where a device can run; the server only offers the tools there. Switch on the machine plus a scope per agent, as for the browser.

### 7. Live view

- **Android on the web:** scrcpy's H.264 relayed as is and decoded with WebCodecs onto a canvas (`@yume-chan/scrcpy-decoder-webcodecs`). Only while someone watches, as for the browser; capped at 1024 px, 15 fps and 2 Mbps.
- **A new viewer joins without a reset:** the runner keeps the codec config (SPS/PPS) and the frames since the last keyframe (capped like Orca's 120, with a keyframe interval short enough to fit) and sends them first, so the new viewer decodes at once and nobody else's stream restarts. `RESET_VIDEO` only when the runner has no keyframe to give (it just started the stream). The server stays a stateless byte copier.
- **Phone app:** still frames first (a device screenshot about once a second, only while someone watches). Then a WebView (`react-native-webview` is already in the app) decoding the same H.264 with WebCodecs (iOS 16.4+, Android's WebView), with still frames as the fallback. No video transcoding in the runner.
- **iOS:** serve-sim's MJPEG frames through the same relay (about 1 fps watching, 10–15 fps in control); its H.264 (`/stream.avcc`) can take the Android path later.

### 8. Testing: CI for Android, a rented Mac for iOS

- Android: unit tests with fakes (adb, a recorded scrcpy stream), and one manual CI job on a GitHub Linux runner with KVM that builds an image with Google's scripts, passes the readiness guard and does a read, tap and read round trip.
- iOS: the spike (serve-sim vs Baguette on Xcode 27 / iOS 27: headless boot, frames, touch, typing, tree, two simulators at once, Device Hub repair) runs on a **rented Mac paired as a connected computer** (already our test case for the desktop, ADR 0031), or a one-off manual macOS CI job if the rented Mac isn't ready. Nothing from the spike is committed.

### 9. Self-host: an optional compose profile

- The profile `android`, off by default (`COMPOSE_PROFILES=android`, which combines with `https`), adds two services to `docker-compose.yml`:
  - **`android`:** the emulator with `devices: [/dev/kvm]`. Its image is **built on the self-hoster's machine** from Google's emulator container scripts (a pinned commit), with a current x86_64 Google APIs system image (API 35–37), metrics off: the person accepts the Android SDK license during the build. We publish the recipe, never an image (SDK license §3.4), and Google's hosted 2020 images are too old (see "Android hosts").
  - **`phone-runner`:** our runner in a container, paired once like any connected computer (a pairing code from the web; the machine token in a volume), with `adb`. It reaches the emulator with `adb connect android:5555` over the compose network.
- Port 5555 is never published outside the compose network: adb on an emulator gives full control with no real authentication.
- Each emulator service is one device (§6); more agents with a phone means more copies of the service, each with its own data volume.
- Requirements, in `SELF_HOSTING.md`: Linux on x86_64 with KVM (bare metal, or a VM with nested virtualization; not Docker Desktop on macOS or Windows), about 2 vCPU and 4–6 GB of memory per emulator on top of the app, `-gpu software` by default and `-gpu host` with an NVIDIA GPU (Google's scripts build GPU images).
- **No KVM:** redroid as a second profile, `android-redroid` (`--privileged`, the host's `binder_linux` module; also on arm64 Linux). No Google services, so apps that need them don't run. Only on a host the self-hoster controls, never shared between organizations.
- We publish and recommend no image with telemetry or a non-free license (the list in "Android hosts"). The emulator and system images are Google's, under the SDK license, downloaded only on the person's machine.

### 10. Cloud: KVM hosts only

- Our Cloud computers (Daytona containers) can't run the emulator, and neither can E2B or Fly. Cloud Android runs only on KVM-capable hosts: bare metal (Hetzner AX, OVHcloud Metal, AWS `.metal`) or nested-virtualization instance families (the AWS types above, GCP Intel and N4D, Azure sizes that list it).
- The same runner, driver, tools and relay as self-host: on a host, one runner container per organization and one emulator per agent.
- `nested=0` (`kvm_intel`, `kvm_amd`) on every KVM host we run: emulator guests never need to nest, and Januscape escapes through nesting. Bare metal for a fleet, host kernels kept patched.
- Metered like the cloud computer (ADR 0021): device time as usage records with `org_id` and `agent_id`, counted in the agent's budget and the organization's daily minutes.
- **Stopgap:** a managed vendor (Limrun about $0.04–0.05 per Android minute, Genymotion $0.06) behind a Cloud adapter that hands our Cloud-side runner an adb endpoint. Video still comes from scrcpy through that tunnel and our relay. A provider interface only when a second provider is real.
- Hosting SDK emulators for others depends on the SDK license (§3.1, "solely to develop applications for compatible implementations of Android", and §3.4). redroid and Cuttlefish (AOSP) avoid it, without Google services.

### 11. Mac hosts

- Android on a Mac: arm64-v8a images with HVF, on bare-metal Macs only (the person's own, EC2 Mac, Scaleway, MacStadium). macOS VMs can't run the Android emulator, so neither GitHub's macOS runners nor Tart or Orka VMs can host it. Same driver as on Linux.
- iOS needs a Mac with Xcode. Xcode 26.x where possible while Device Hub breaks input; a logged-in GUI session; the runner checks Device Hub's `dtuhidd.active` flag and reports it.

### 12. iOS: the person's Mac first; Cloud only for their own app

- **Connected Macs first:** the person's own Mac running our runner (ADR 0025), with §2's driver. That is the only iOS a self-hosted install gets.
- **Cloud iOS only for developing and testing the customer's own app.** Apple's license allows leasing only a whole Mac, for at least 24 consecutive hours, to one customer's sole use, for Permitted Developer Services, with at most 2 macOS VMs on it. So: one Mac dedicated to an organization, running our runner as a managed connected computer, with Apple told beforehand; never a shared pool billed by the minute. Agents that use iOS apps for anything else stay on the customer's own Macs.
- Per-minute vendors (Limrun iOS about $0.08–0.10 per minute, Appetize) only for light use, as an exception to our relay (their own viewer).

## Amendment (2026-11-11): real iPhones through the test helper

Real iPhones a person plugs into their Mac run on WebDriverAgent (16.15.3, built and signed on that Mac, `apps/server/runner/wda.ts`), driven by our reader of Maestro's YAML (`ios-flow.ts`). An iPhone 14 Pro Max on iOS 27 with Xcode 26 showed where it broke, and an Xcode 27 Mac showed the Apple Account step stuck. What changed and why:

- **No idle wait.** WDA waited up to 10 s for an idle app before every look at the screen; `shouldWaitForQuiescence` does nothing without a bundle id, and a chat or a feed is never idle. Each session now sets `waitForIdleTimeout` and `animationCoolOffTimeout` to 0. The tree leaves out the attributes our lookups never read (`excluded_attributes`).
- **A slow look is asked again, a dead helper is started again.** One look has 20 s and a lookup polls until its own deadline. A call that times out while `/status` still answers is slow (`HelperSlow`): WDA answers `/status` on a queue of its own, beside the main queue that serves the rest. One that gets no answer drops the helper (`HelperGone`), and a flow reaches the helper through a getter, so it recovers once. A helper unused for 5 s is asked `/status` before it's handed out. The flow's abort reaches each call. When xcodebuild exits, the runner logs why and keeps the reason.
- **Code=41 in words.** "Not authorized for performing UI testing actions" is `ui_not_authorized`: the phone wants its passcode again, or UI Automation turned off and on. The helper is dropped so the next op opens a fresh test session.
- **Locked, too old, too new.** A flow first asks `/wda/locked` and refuses with `locked`; polls then read `devicectl device info lockState` until it's unlocked. An iPhone below iOS 17 (devicectl can't drive it; usbmuxd's list says it's plugged in when devicectl doesn't) is reported `unsupported` with `os_too_old`, never left out. An iOS newer than the Mac's iPhone SDK (`hello.toolchains.xcodeSdk`) turns nothing away by itself: it renames a stuck helper failure an old Xcode explains (`device_support`, `ui_not_authorized`) to `xcode_too_old`. Like the other helper reasons it stops only what needs the helper: devicectl still installs and opens apps.
- **A busy iPhone isn't dropped** because one Apple look missed it: devicectl failing keeps the last list, and an op under way keeps its hold.
- **The Apple team, read from four places.** Xcode's `IDEProvisioningTeamByIdentifier` is a cache that can be empty on Xcode 26.5 and 27 while Settings › Apple Accounts shows the account. One reader (`appleLook`) tries, read-only and in order: Xcode's settings, xcodebuild's copy, Xcode's development profiles (free when they last 8 days or less), then the keychain's Apple Development identities (team = the certificate's OU). Its answer is a team, `no_team` (an account with no team yet, new reason `apple_team_missing`) or `none`. A missing team found before xcodebuild ran is looked for again every minute, not after a growing wait.
- **Fresh within a minute.** On a Mac the runner looks at Xcode's part (version, SDK, team) every 60 s and sends `toolchains.changed` when it differs from what the server last heard; the server stores it like `hello` and tells the org. An older server drops the frame.
- **No signing while the Mac is locked.** One report has Xcode 27 dropping the account when it signs while the keychain is locked, so a build with `-allowProvisioningUpdates` waits for the screen to be unlocked, and an op that needs the helper meanwhile says so.
- Xcode's pane has been "Apple Accounts" since Xcode 26, and every mention says so.

Left for later: iPhones over Wi-Fi through CoreDevice's tunnel, and WDA 16.18.5.

## Order

0. Spike outside the repo: a KVM host (Hetzner AX, or an AWS M8i with nested virtualization), an image built with Google's scripts (API 35–37), `-gpu software` with and without `-feature -Vulkan`, scrcpy 5.0.1 through `@yume-chan/scrcpy` at 2 Mbps and 15 fps through our relay. Measure boot time, memory, CPU and `uiautomator dump` time; try redroid on a VM without KVM.
1. Generalize the browser's live relay, input and handoff to a screen kind, H.264 frames included (no behavior change for the browser).
2. Runner: the Android driver and the readiness guard (§3), `hello.simulator`, the next protocol version.
3. `phone_*` tools, the card with a phone frame (prototype first), handoff, the web live view (§7).
4. The compose profiles (`android`, `android-redroid`) and `SELF_HOSTING.md`; the manual CI job on a KVM runner (§8).
5. The phone app's live view: still frames, then WebView + WebCodecs.
6. Cloud Android: a managed vendor as a stopgap, then our own KVM hosts.
7. iOS on connected Macs: the spike (§8), `simctl` + driver, the same tools.
8. Saved flows as Maestro tests rerun by routines.
9. Cloud iOS on an organization's dedicated Mac, when a customer develops an iOS app with us.

## Consequences

- Phone app testing reuses the browser's live view and handoff instead of building a second set.
- Android works on the hosts self-hosters already run, and CI can test it. A host without KVM gets a clear reason, never a gray screen.
- We ship no Google binaries: self-hosters build the emulator image on their own machine, one step more than `docker compose up`.
- Cloud Android needs a new kind of host (KVM), outside Daytona, and SDK emulators there must fit the SDK license (§10).
- We depend on Apple's private simulator APIs through a third-party driver; two drivers behind one interface and pinned versions limit the damage of an Xcode update.
- iOS needs a Mac with Xcode and enough memory; agents without one don't get the iOS tools.
- Commands run as the OS user, and Seatbelt (protected mode) likely breaks `simctl`; isolation for a QA agent stays a dedicated OS user, a rented Mac or a macOS VM (ADR 0031 §5).

## Open questions

- Does Daytona's VM class expose KVM, or allow `binder_linux` for redroid?
- How many emulators fit a Hetzner AX41 at 15 fps with a software GPU?
- agent-device (MIT) as the structure-and-action layer, or a minimal driver of our own?
- Do Limrun's tokens come short-lived and per viewer?
- Does serve-sim's N-API addon load in our Bun-compiled runner?
