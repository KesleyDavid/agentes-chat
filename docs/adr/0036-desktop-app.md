# 0036. Desktop app: Tauri in the menu bar, the runner as its child process

- Status: Accepted; its menu-bar-first model, "the runner ships and starts in every install" and §11's "the main window loads agentes.chat only" are superseded by ADR 0066 (one app for agentes.chat and your own server, a plain client first)
- Date: 2026-10-17
- Extends: ADR 0025 (connected computers), ADR 0029 (missions and background tasks), ADR 0030 (isolation), ADR 0035 (shared client packages)

## Context

A computer joins an organization through `agentes-runner`, a JavaScript file run by Node 22+ or Bun. It is installed with a shell one-liner, paired with a code created on the site, and kept alive as an OS service (launchd, systemd user unit, Task Scheduler). Settings live in `~/.agentes-runner/config.json` and are edited by hand. `agentes-runner update` downloads the latest `.mjs` from our server.

That works for developers and servers. It does not work for the people the product is for (teams in general, not only developers): they don't have Node, don't open a terminal, can't see what the agents are doing on their computer, can't pause them, and have no place to grant access. "Permissions only widen on the machine" (machine folder access) currently means "copy this command into a terminal".

## Decision

### 1. A Tauri 2 app in `apps/desktop`, living in the menu bar / tray

- Tauri 2 shell with a React + Vite web view. The UI imports `@agenteschat/ui` (components, the agent engine, the sky), `@agenteschat/i18n`, the tokens (`tokens.css`) and, when it talks to the server, `@agenteschat/client`. Same rules as the web: no DOM-free constraint, no `ee/` imports, no keys in the client.
- Not React Native for desktop: `react-native-macos`/`-windows` are not Expo, lack the modules the phone app uses (blur, SecureStore, notifications), have weak tray support and no Linux, and would not reuse the DOM design system. Not Electron: the runner as a child process gives us what an in-process Node would, at a tenth of the size and memory for an app that is always open.
- The app is a tray icon plus small windows: the popover (now, pause, open site, preferences, quit), first run, Preferences (General, Folders, Tools, Updates, Activity, Advanced). The UI never says "runner", "MCP" or "protocol"; the app is called "agentes".
- Rust stays thin: tray and window positioning, spawning the runner, single instance, autostart, updater, native dialogs and notifications. Product logic lives in the runner (TypeScript) so the CLI gets it too.

### 2. The runner is the same code, compiled, and run as the app's child process

- CI compiles `apps/server/runner` with `bun build --compile` into one binary per target (first `aarch64-apple-darwin` and `x86_64-apple-darwin`) and ships it inside the app as a Tauri sidecar. People need no Node or Bun.
- **Desktop mode has no OS service.** The app starts at login (Tauri autostart) and spawns the runner; quitting the app stops it. If the runner exits unexpectedly the app restarts it with backoff (1 s, 2 s, 4 s… capped at 60 s) and shows the state in the tray.
- Background tasks and missions are unaffected: they already run detached under a wrapper and survive runner restarts (ADR 0029), and Claude Code resumes with `--resume`.
- Accepted trade-off: with the app closed, agents can't use the computer. The Quit dialog says so.
- **Both modes stay.** The app is the way for people on a Mac (Settings → Computers leads with "Baixar o app para Mac"). The shell installer, Node/Bun and the OS service stay for servers, computers without a screen, and Windows/Linux until the app gets there ("Outras formas: servidor ou Linux"). Later the installer can fetch the compiled binary instead of the `.mjs`, dropping the Node requirement and leaving one way to ship the runner.
- Paths that pointed at "runtime + script" (the service definition, the `agentes-runner mcp` command written into Claude Code's MCP config) resolve to the compiled binary when there is no separate runtime (`process.execPath === script`).

### 3. App ↔ runner: stdio for live state, the config file for settings

- The app spawns `agentes-runner app`. In this mode stdout carries only JSON lines of a small control protocol; logs go to `~/.agentes-runner/logs/` (rotated). Only the parent can talk to it: no socket, no port, nothing another process can reach.
- Requests (app → runner) and replies/events (runner → app), each with an `id` for replies:
  - `status` → paired, server, org, machine name, connection state, versions, executors (Claude Code / Codex with login), pause state.
  - `jobs` and live `job.started` / `job.finished` events (agent, short summary, folder, command if any).
  - `pause { until | null }`, `resume`.
  - `activity { before?, limit, agent? }`.
  - `config.get` / `config.set` for the non-secret fields (name, limits, workspace). The token is never sent over the channel.
  - `pair.start` / `pair.cancel` (section 5), `unpair`.
  - `diagnostics` → a redacted bundle (versions, OS, recent log lines with secrets removed).
  - `org.logo` → the organization's logo as a `data:` URL (PNG/JPEG/WebP) or null. The runner fetches it after each `welcome` from `GET /api/machines/org-logo` (machine token, ETag/304), caches it in `<home>/org-logo.json` (at most 512 KB) and reports `status.org.logoEtag`, so the app asks again only when it changes. The token never reaches the web view.
  - v0.2: `folders.*`, `tools.*` and the `access.requested` event (section 8).
- **The config file stays the single source of settings.** The runner watches `config.json` and reloads on change, so `agentes-runner` commands in a terminal and the app edit the same thing. Writes stay atomic with mode 600.
- The protocol has its own version in `hello` between app and runner; the app refuses a runner it doesn't understand (can't happen when both ship together, but guards development builds).

### 4. Single instance; no migration

- One runner per OS user and runner home: a lock file (`~/.agentes-runner/runner.lock` with PID, checked for liveness) taken by `start` and `app`. A second one exits with a clear message. Tauri's single-instance plugin keeps one app.
- The app never adopts a terminal install, and there is no migration: to move a computer to the app, disconnect it and connect again from the app.
- Homes the app creates carry `"managedBy": "desktop"`; there `agentes-runner update` and `service install` from a terminal refuse and point to the app, so the two modes can't fight over the same home.

### 4b. More than one organization on one computer

- A computer can join several organizations, and several agents of each can use it (agents already get one folder each).
- **One runner per organization**, each with its own home and workspace: `~/.agentes-runner/orgs/<orgId>/` (config, token, lock, tasks, logs, activity) and `~/agentes/<org-slug>/` (agent folders). The app spawns one child per organization and shows them grouped in the popover. Today's runner code works unchanged per home (`AGENTES_RUNNER_HOME`).
- Why not one process with several connections: separate processes keep one organization's ops, tasks and tokens out of another's memory and journal, and need no refactor of the runner.
- "Adicionar organização" in the popover and in Preferences runs the same sign-in (section 5) into a new home. Leaving one organization stops and removes only its home (agent folders stay on disk).
- Honest limit: file tools keep each organization in its own folders, but commands run as the same OS user and can reach the other organization's folders (ADR 0030). Protected mode (ADR 0030 level 2) closes that; until then the Tools tab says so.
- Limits (background tasks, Claude Code processes) apply per organization in v0.1. A computer-wide cap comes later if several organizations compete for the same machine.

### 5. Connecting a computer: one device-code flow for the app and the terminal

The code is now created by the computer, like OAuth's device flow, and the person confirms it on the site with their normal session (email, Google, Apple). Nobody types a code: it is shown on both sides only to compare. **This replaces the old code created on the site** (`POST /organizations/{orgId}/machines/pairings`, `POST /api/machines/pair`, `install.sh --code`), for the app and for the terminal alike (MVP, one path). The runner drives the flow (`agentes-runner pair --server <url> [--name <name>]` prints the code and the URL), so a server without a screen is confirmed from any device.

- `POST /api/machines/device` (no session, rate limited per IP, at most 10 pending codes per IP), body `{ name, os, arch, hostname, version }`: returns `{ deviceCode, userCode, verificationUrl, expiresIn: 600, interval: 3 }`. `deviceCode` is 32 random bytes (base64url), stored only as a SHA-256; `userCode` is 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `K7Q·4ZP`; `verificationUrl` is `<PUBLIC_URL>/conectar?code=K7Q4ZP`.
- `POST /api/machines/device/token { deviceCode }`: `400 { error: "authorization_pending" }` until confirmed, `"slow_down"` when polled faster than `interval`, `"access_denied"` after "Não fui eu", `"expired_token"` after 10 minutes or once the token was taken; on success `200 { token, machineId, name, org: { id, name } }` exactly once. The token is today's `agm_…` machine token.
- Web: the page `/conectar?code=…` (signed in, or after sign-in) calls `GET /api/app/machines/device/{userCode}` → `{ name, os, arch, hostname, version, approxLocation?, createdAt, expiresAt }` (approximate location from the requesting IP, best effort), shows the code, the computer and the warning "Só confirme se você acabou de abrir isso no seu computador", lets the person pick the organization (only those where they may connect computers, as today) and the computer's name, then `POST /api/app/organizations/{orgId}/machines/device/{userCode}/confirm { name? }` (201, the machine) or `POST /api/app/machines/device/{userCode}/deny` (204).
- Against a link sent by someone else (device-code phishing): 10 minutes, single use, the page shows name/OS/approximate location, admins get a notification for every new computer, the computer can be disconnected at once, and **a new computer gets no agents** until an admin or an agent's owner points one at it (`setAgentComputerTarget`).
- The token goes straight into the runner's config; the app's web view never sees it.
- The installer (`install.sh`) loses `--code`: it downloads the runner, runs `pair` (which prints the URL and code and waits) and installs the service.
- **Reconnecting (2026-10-18).** A computer the server refused (`invalid_token`, `revoked`, `replaced`: removed from the organization or its token revoked) comes back as the same machine instead of a new one. The runner keeps `machineId` in its config after a refusal and after "leave" (unpair), and sends it as `previousMachineId` on `POST /api/machines/device` when pairing again with the same server (the app's "Reconectar este Mac" in the refused banner, or `agentes-runner pair` by default; `--new` opts out). On confirm, when that machine belongs to the chosen organization and the confirming person may manage it (admin with `configure`, or who paired it), the row is reused: hostname/OS/arch/version refreshed, `deleted_at` cleared, the old token revoked at once (any socket still holding it is closed) and the new one issued on the next poll; name, folders and tools stay; the agents that used it when it was removed (`machines.previous_agent_ids`, set by the removal) get it back if they still have no computer. Audited as `machine.reconnected`; admins are notified as for a new computer. The confirm page shows "Reconectar o {nome}?" only to people who may manage that machine (`reconnect` in the code's view). Anything else (another organization, no permission, unknown id) is an ordinary new computer. A confirmed reconnect the computer never collects is not dropped (it stays offline, with its agents).
  - *Proof (2026-10-29).* Machine ids are visible to every member, so an id alone no longer reconnects: the runner also sends `previousToken`, the token it had for that machine (kept after a refusal; after "leave" kept as `previousToken` in its config, used for nothing else), and the server records `previousMachineId` on the code only when that token's hash matches the machine's. Removing a connected computer keeps its token hash for this (a removed row never authenticates); the workspace's own computers (`host`, `managed`) are never reconnect targets. Without the proof the code is an ordinary new computer.
- **Guessing codes (2026-10-29).** Looking up, confirming and denying a code share one budget per person (30 per 10 minutes) and per address (60), and an unknown or expired code costs 5 of it: a few typos are fine, guessing 6 characters (about 887M codes) stops after a handful of tries.

### 6. Pause

- `pause { until }` sets a runner state (`paused`, `until`), persisted so a restart keeps it, and the runner reports it to the server (protocol 9: a `runner.state` message and the field in `hello`).
- The server treats a paused machine like an offline one for new work: new ops and new tasks are refused with `machine_paused` (with `until`), and the agent says in the chat that the owner paused the computer. Work already running finishes. Agents whose engine is this computer's Claude Code (ADR 0032) follow the choice already stored on the agent (`agents.brainFallback`): with fallback on they answer through the API model, with it off they say the computer is paused and wait. Nothing new to configure.
- The web shows "Pausado até 16:24" on the computer page.

### 7. Activity log

- Each runner appends to `activity.jsonl` in its home. When the file reaches 5 MB it becomes `activity.1.jsonl` and a new one starts; at most 3 files are kept (about 15 MB, weeks of normal use), the oldest is deleted. Each line holds: time, agent (id and display name, sent with each op from protocol 9), kind (file read/write, command, task, access change, update), a short summary, the command line with secrets redacted (ADR 0027), and the result (ok, failed, refused).
- Local only. The server keeps its own audit; this is what the person sees about their own computer.

### 8. Folders and tools on the machine (v0.2, protocol 10)

The machine-side access model, built in the runner and shown in the app and on the site.

- **Config** (`config.json`, per organization home): `access: { folders: [{ path, agents: [agentId] }], tools: { claude, codex, commands } }`. Defaults for a new pairing from the app: no folders, `claude` on only if the person chose it at first run, `codex` likewise, `commands` off. A terminal pairing keeps today's behaviour (`--no-exec` → `commands` off, otherwise on).
- **Enforcement in the runner:** a request's paths stay relative to the agent's folder, or may be absolute when inside a folder allowed for that agent (`not_allowed` otherwise; symlinks resolved before checking). `exec` and `shell` tasks need `commands`; `claude`/`codex` tasks and brain turns need their tool. Claude Code and Codex get each allowed folder of that agent (`--add-dir` / Codex's writable roots). System folders (`/`, the home itself, `/System`, `/Library`…) are refused when adding.
- **Reporting:** `hello.access` and `access.changed` (after any change, from the app, the CLI or a config edit). The server stores the last report per machine (`machines.access`, jsonb) and shows it on the computer page and the agent page; the site can only reduce (`access.reduce`).
- **Requests:** a tool `request_folder_access { path, reason }` for agents on a connected computer. The server sends `access.request`; the runner answers `pending` (or `granted` when already allowed), keeps the request (24 h) and raises `access.requested` to the app, which shows a macOS notification and the request in the popover. "Liberar" (this agent / all agents) or "Agora não" → `access.decided` (+ `access.changed`). The server posts the outcome in the agent's thread and wakes the agent (as a background task's end does). A request on a machine without the app (terminal) shows the exact `agentes-runner folders allow …` command in the chat card.
- **CLI:** `agentes-runner folders [list|allow <path> [--agent <handle>]…|remove <path> [--agent <handle>]]` and `agentes-runner tools [list|enable <tool>|disable <tool>]`, editing the same config.
- Granting never comes from the server.

### 9. Updates (automatic since 2026-10-19)

- The app checks `GET /api/desktop/latest?target=darwin&arch=<arch>` every 6 hours and at start: `{ version, url, sha256, notes, publishedAt, minVersion? }`. When newer, the tray shows "Versão nova" and Preferences → Atualizações shows the notes and "Atualizar e reabrir". Below `minVersion`, or when a runner reports `outdated`, it says "Atualize para continuar".
- "Atualizar e reabrir" runs the Tauri updater (`update_install`): it reads `GET /api/desktop/update?target=…&arch=…&current=…` (Tauri's format; 204 when the release has no updater bundle), downloads `agentes_<version>_universal.app.tar.gz` through our download route, checks its minisign signature against the public key built into the app, replaces the app, stops the runners as when quitting, and relaunches. The private updater key lives only in the `TAURI_SIGNING_PRIVATE_KEY` secret (and an offline backup): losing it means no further automatic updates.
- Update and reopen shows the download with Cancel. Nothing is installed until the download is whole, and a download that receives nothing for 60 seconds fails into the manual way. The check gets 30 seconds, and Check now 15.
- Fallback (an old release without the bundle, a failed download): the download link and the three manual steps (quit, delete, install); pairing and settings live in `~/.agentes-runner`, so nothing is lost. Builds from before the updater (0.1.x, ad-hoc signed) update by hand once.
- **Builds per chip (2026-11-11).** One universal Mac build; Windows and Linux each for x64 and ARM64, built on a runner of that architecture (`windows-11-arm`, `ubuntu-22.04-arm`; variables override the labels) so each build still runs what it makes. Files: `agentes_<v>_{x64,arm64}-setup.exe`, `agentes_<v>_{amd64,arm64}.deb` and `.AppImage`. `/api/desktop/latest` and the updater take `arch` (`aarch64`/`arm64` or `x86_64`/`x64`; none = x64, as older apps ask). agent-browser has no Windows ARM build, so Windows on ARM carries the x64 one, which Windows runs emulated, and the site offers a Windows on ARM the x64 build while ARM64 has no release. A browser's user agent says x64 on Windows on ARM: the site asks the browser for the chip (`navigator.userAgentData`) where it can, and the `/download` page and Other systems offer the other architecture either way.
- **Where builds live.** This repository's CI publishes a GitHub Release (private). The server reads it with a fine-grained token (`DESKTOP_RELEASES_TOKEN`, read-only contents on this repo; without it the endpoints answer 404): `GET /api/desktop/latest` (cached 5 minutes) and `GET /api/desktop/download/{version}/{file}` (streams the asset). The site's download button and the page's SHA-256 come from the same release.
- Since the runner ships inside the app, installing a new app updates the runner.

### 10. Signing and notarization (macOS)

- Since 2026-10-19 macOS builds are signed with our Developer ID Application certificate, with the hardened runtime, and notarized by Apple (App Store Connect API key); the ticket is stapled to the app. The bundled runner (a compiled Bun binary) is signed with the same entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`); a signed and notarized Bun binary was checked to run and be accepted before switching.
- CI secrets: `APPLE_CERTIFICATE` (.p12, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. With them, the build verifies the signature, the stapled ticket and Gatekeeper (`spctl`) before publishing.
- The six Apple secrets are optional, so a release can go out while there is no Developer ID: with none of them the macOS app is ad-hoc signed, without the hardened runtime (`tauri.adhoc.conf.json`: with an ad-hoc signature it keeps WebKit's content process from starting) and not notarized; the first open from the `.dmg` asks for System Settings › Privacy & Security › "Open Anyway", and every update asks again for folder access (the ad-hoc identity changes with each build). Updates still install on their own: the updater checks its own minisign key, not Apple's, and the files it writes carry no quarantine mark. Some but not all of the six fail the build. The updater key is always required.
- Renew the Developer ID certificate before it expires (apps already notarized keep opening; new builds need the new one).
- The identity is now the same on every build, so macOS stops asking again for Documents/Desktop/Downloads access after an update.
- Windows (later): SmartScreen's "Mais informações → Executar assim mesmo" until we sign.
- First open, shown wherever the app is downloaded (2026-11-11): while the Mac build is ad-hoc and the Windows installer unsigned, nobody finds the "Open Anyway" button alone (it shows in Privacy & Security only right after a blocked open, for about an hour). So the steps go with every download: under "Download for …" in Connect a device (this computer and another computer), frames that move on by themselves, one drawing per step with the button to click ringed (`apps/web/src/components/install/`); a public `/download` page on every server (`/baixar` redirects) with the build for the reader's system, why it asks (beta) and every step with its drawing, plus the `xattr` line for a Mac that never shows the button; and the release body, where the desktop CI appends `.github/desktop-install.md` after an `<!-- install -->` mark that the server cuts from the notes the app shows on an update (`parseReleaseBody`). The drawings are HTML with the systems' own words in each language, not screenshots, so they translate and follow the theme. When the builds get signed and notarized, these steps and that file go.
- CI: `.github/workflows/desktop.yml`, manual or on a `desktop-v*` tag, on a macOS runner: compile the runner for both architectures, build a universal `.app` + `.dmg` with `tauri-action`, publish a GitHub Release with the SHA-256. Pull requests run the build without publishing. The UI can be iterated in a browser against a fake runner (`apps/desktop/src/dev/fake-runner.ts`).

### 11. Security

- The machine token stays in `config.json` (mode 600, folder 700). The web view never receives it; Tauri capabilities allow only our sidecar, autostart, notifications, the folder dialog and opening our own URLs. No general filesystem or shell access from the web view.
- A click in the app is an action on the machine, so the rule "access only widens on the machine" holds. The server can show and reduce, never grant.
- The control channel exists only between the app and its child.
- The web view loads only the app's own bundle, with a strict CSP. It never loads agentes.chat or any remote page with access to the app's commands; the site opens in the person's browser. *Amended 2026-10-21:* the main window does load agentes.chat, with no app command and no Mac access: its capability (`main.json`, remote https://agentes.chat only) allows dragging and zooming the window and one bridge command, `this_mac`, which Rust checks and rebuilds before relaying to the popover: which organizations this Mac is in, connecting it to one (the site confirms the runner's code with its own session; the token stays with the runner), and opening Preferences on Folders or Tools. Granting access still happens only in the app's own windows. The app's own windows (popover, welcome, Preferences, notch) keep the rule above. *Amended 2026-10-26:* the sign-in page can ask `this_mac` for `servers`, which only shows the app's own first-run window (the same as Servers › Add a server…); the page passes nothing, and the person picks and confirms the server there. The app says it takes it (`window.__agentesDesktop.servers`), so the link stays hidden on older apps. *Amended 2026-10-27:* the app's plugins add a click script to every page that takes `target="_blank"` links and asks over IPC, which the main window may not do. The opener's is off; the shell plugin's can't be turned off, so the site sends those links to `window.open` first (`routeNewWindowLinks`), and `on_new_window` routes them: a page of the server to the window, anything else to the browser. *Amended 2026-10-27 (connectors):* a connector's OAuth started in the main window opens the provider in the browser, which has no session of ours, so it used to land on the site signed out. The window starts it with `returnTo: "desktop:" + path` (only when the app says it takes the return, `window.__agentesDesktop.connectorReturn`); the callback hands `org`, `state` and `code` to `agenteschat://desktop/connectors/oauth`, `deep_link.rs` opens `/desktop/connector` with only those fields in the main window on the server open now (never the welcome window), and the page finishes with the window's session (`POST …/connectors/oauth/complete`, the phone app's route: the state stays bound to the person who started it, so a code that reaches someone else's app is refused), then lands where it started with `?connected=`. *Amended 2026-10-27 (files):* Settings › Storage's "Show the folder" asks `this_mac` for `files` on the server the app runs here. The page passes nothing: Rust refuses it from any other page and marks that server's own page `local`, and the popover, which also refuses it without `local`, shows `files` in its folder (the folder itself until the first upload) in Finder or the file manager. The app says it takes it (`window.__agentesDesktop.files`), so the button stays hidden on older apps. *Amended 2026-10-29 (other schemes):* a navigation or new window that leaves the window goes to the system only for `http`, `https`, `mailto` and the app's own `agenteschat` links; any other scheme (`file:`, `smb:`, `tel:`, another app's links) is dropped, so a link in a message can't launch a local app or open a file share (`main_window.rs` `outside_or_drop`). *Amended 2026-10-31 (mailboxes):* Gmail and Outlook (ADR 0038) started in the main window ask for the same return (`desktop: true`, on the same `connectorReturn`). Composio's callback needs no session: it only copies Composio's state onto the mailbox, found by its random id, as the reconcile does, reads Composio only while that sign-in is pending, and is limited per address. It then hands `org`, `state=mail` and `code=connected|failed` to the same link, in the fields the shipped apps already pass on, and `/desktop/connector` opens Connectors with `?mail=…`, which opens "O que faz" for the mailbox.
- Without Apple notarization, the OS doesn't vouch for the download: someone could pass around a fake "agentes". The app is downloaded only from agentes.chat over HTTPS, and the page shows the SHA-256 of each build. Signed, verified updates come with notarization.
- Not new, but now reachable by non-technical people: commands run as the person's OS user (ADR 0030). Safe defaults matter more: no extra folders, commands off, and Claude Code on only when found and chosen at first run.

### 12. Order

- **v0.1 (Mac):** compiled runner, `agentes-runner app` with the stdio protocol (`packages/adapters/src/runner-control.ts`), lock file, device-code connection for app and terminal (replacing the old code), pause and the `agents` frame (protocol 9), activity log, the app (tray, popover grouped by organization, first run, Preferences), autostart, "Versão nova" check, several organizations, CI and a download entry in Settings → Computers.
- **v0.2:** folders and tools on the machine (protocol 10), access requests with notifications, the CLI `folders`/`tools`, access shown and reduced on the site.
- **v0.3:** Windows and Linux (tray quirks, WebView2 visual QA, SmartScreen), then signing, notarization and the automatic updater.

## Resolved in review (2026-10-17)

- Updates: built and released by this repository's CI (macOS only for now); served through our server (section 9). Manual (delete the old app, install the new one) until notarization brings the automatic updater.
- Connecting: one device-code flow for the app and the terminal; the old site-created code goes away (section 5).
- Several organizations and several agents per computer: yes (section 4b).
- Pause with brain-engine agents: the agent's existing fallback choice decides (section 6).

## Consequences

- People connect a computer without a terminal, see and pause what agents do there, and grant access with a click on the machine.
- The runner gains an app mode, a lock, config watching, pause and an activity log; all of it also serves the terminal install.
- Two install modes coexist (desktop-managed and service-managed), kept apart by `managedBy` and the lock.
- Unsigned builds add a one-time OS warning and possible repeated permission prompts on macOS until we sign.
- A Rust toolchain enters CI (macOS runner minutes cost more than Linux).
