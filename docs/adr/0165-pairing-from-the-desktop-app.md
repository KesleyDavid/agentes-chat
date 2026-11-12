# 0165. Pairing a computer from the desktop app, Cloud included

- Status: Accepted
- Date: 2026-11-09
- Supersedes: ADR 0066 §3 ("a link never pairs this computer") and §4/§5 (agentes.chat is a plain client, agents
  here only for your own server), for the devices people bring
- Extends: ADR 0025 (connected computers), ADR 0036 (desktop app), ADR 0066 (one desktop app)
- Code: engine `device-links.ts` (`connectLinkInfo`); server `routes/devices.ts` (`registerConnectLinkInfo`,
  `GET /api/machines/connect-links/{code}`); client `lib/server.ts` (`pairLink`), `lib/devices.ts` (`newComputerOf`);
  web `components/devices/ConnectDialog.tsx`, `components/ThisMac.tsx`; phone
  `features/devices/ConnectScreen.tsx`; desktop `main_window.rs` (`agents_here`), the `agenteschat://pair` handler and
  its confirm, Preferences › This Mac; runner control `pair.start` with `link` (`packages/adapters/src/runner-control.ts`);
  the open defaults and Prepare this Mac: desktop `control/this-mac.ts` (`pairTools`, `firstTools`), `windows/Pair.tsx`
  (`ToolSwitches`, `Prepare`), `control/permissions.ts`, `ui/permissions.tsx`, `src-tauri/src/prepare.rs`

## Context

ADR 0066 made agentes.chat a plain client in the desktop app: every Cloud workspace had a computer of its own, so the
app never paired the computer it runs on there, and a link could never pair it. Since then people bring their own
computers and phones to every workspace, the Cloud included, through a line pasted in a terminal (`curl … | sh`,
a connect link that works once for 10 minutes and only asks to join). That is fine for a server and hard for everyone
else, while the app already pairs this computer in one click behind the system's own Allow dialog, only not on Cloud.

## Decision

1. **Agents here on Cloud too.** `agents_here(origin, server_here)` drops its agentes.chat exclusion: the app may pair
   this computer with any server, except one on this computer itself (a loopback address, the server the app runs
   here), which is set up with it already. The site's `useAgentsHere` follows the app's answer, so "This computer"
   in the connect dialog is the one-click button on Cloud as on a self-hosted server.
2. **The app's own ways in.** After sign-in, once per workspace with no home here, a card asks "Let {{org}}'s agents
   use this {{device}}?" with who can use it and Open at login; Allow pairs it (the card is the ask), Not now is
   remembered. Preferences › This Mac lists every workspace the person is signed in to with a switch each. Pairing
   from the app turns on Open at login unless the person unchecks it: agents of a brought computer work while the app
   runs.
3. **A link may pair this computer, after the person confirms in the app.** `agenteschat://pair?server=<origin>&link=<code>`
   (`pairLink`): `server` validated as `agenteschat://connect`'s, `link` a connect link's code with or without its
   dash, any case. The app never pairs from it without asking: its own confirm names the workspace, who made the
   link, the server and this computer, with Not now and Connect. Connect asks to join with the link (`pair.start`
   with `link`, posting `/api/machines/device` as `agentes-runner pair --link` does), and the link's maker still lets
   it in on the web, with its name and who can use it. The app never confirms a link's device code itself. Anything
   invalid is ignored; unknown parameters too.
4. **What the confirm reads.** `GET /api/machines/connect-links/{code}`, with no session and no CSRF (it only reads):
   `{ org: { name }, by: { name }, kind, expiresAt }` while the link waits for its computer, and the same
   `404 { "error": "link_expired" }` for a code that is unknown, used or expired, so a guess learns nothing about which.
   Codes stay hashed at rest and are looked up by hash, as `/i/{code}` does, with the same limit per address (30 a
   minute).
5. **The web's connect dialog** offers This computer, Another computer and A server or VPS on every setup. This
   computer in a browser makes a connect link (kind computer) and offers "Open the agentes.chat app" (the link above)
   for as long as it waits, with the downloads for after installing, the waiting line, today's join card, and one
   line for a terminal as the way out. Only where the app takes such a link (`appPairsWith`: https, not on this
   computer); a page served over plain http or from this computer itself offers the one line, as before. Another
   computer lists the app's steps and waits, live, for a computer of the
   person's that wasn't in the devices list when the dialog opened (the list and its events, no new endpoint), then
   says "Connected: {{name}}" with its page; one line for a terminal stays the way out. A server's flow is unchanged.
6. **The phone** offers this phone, another computer through its app (the same steps and live wait, no button to
   open the app, which a phone can't do for another computer) and a server or VPS.
7. **Open defaults, shown before Allow.** A computer paired from the app starts with commands on, the browser on, and
   Claude Code and Codex on, found here or not (one installed later then works, where the site would otherwise say it
   is turned off on this computer); folders none, added later in Preferences › Folders. This overrides
   ADR 0036 §8 ("commands off") for pairing from the app; a terminal pairing was already open unless `--no-exec`. The
   card after sign-in and a pair link's confirm show these as switches under "What agents can do here", prefilled,
   so the person changes them before Allow or Connect; Claude Code and Codex rows show only once a runner here has
   found them. The runner still starts a pairing with commands off (`pair.start`), and the app sets the chosen tools
   right after `pair.done` with `tools.set`, as it always set the first tools. The site's This computer pairs behind
   the system's dialog, which has no switches: it says what agents get, and the defaults apply. Only a new home gets
   them: a home refused by its organization that pairs again keeps the access its runner kept. A new workspace on a
   computer that already works for others copies their Claude Code, Codex and browser switches (they are for the
   whole computer) and gets commands on. The server this app runs here gets the same for its own homes, overriding
   ADR 0060 §3's "commands off on a Mac" for the app: commands there run as the person and can reach the server's
   files, which Preferences › Tools turns off.
8. **Prepare this Mac.** On a Mac, right after Allow (or Connect, or the site's This computer), the same window goes on
   to one step, unless nothing is left to ask: Screen Recording, Full Disk Access and Local Network, each with what it
   lets agents do, its live state and one button. Agents keep taking screenshots with `screencapture` through
   commands, no screen tool of their own: the runner is the app's child, so the system asks for, and grants to, the
   app. Screen Recording's button is Allow the first time (the system's prompt), then Open Settings; its row says macOS
   asks again about once a month. Full Disk Access replaces per-folder grants (Desktop, Documents, Downloads), whose
   prompts stopped agents mid-task: no prompt can ask for it, so its button always opens System Settings on its list
   (`Privacy_AllFiles`) and the row says to turn agentes.chat on there. Its state comes from opening the privacy
   database (`TCC.db`, the user's or else the system's), which opens only with it and never prompts. Local Network
   (macOS 15 and later, no row before that) covers adb, the runner's child, finding and connecting Android phones over
   Wi-Fi (mDNS and the TCP connect). macOS has no call that reads it: Allow raises its prompt with a short Bonjour
   browse from the app, then the button opens System Settings (`Privacy_LocalNetwork`), and the row says only "Not
   asked yet" or "Asked", never On. `Info.plist` names its Bonjour types and keeps the folder usage strings, which
   still word any folder prompt. States are read again whenever the window comes to the front. Skip for now and
   Continue both close it, and the pairing never depends on it. Preferences › General › Permissions lists the same
   rows. Windows and Linux skip the step.
9. **Resume after Quit & Reopen.** Screen Recording and Full Disk Access apply only once the app opens again, so macOS
   offers to quit and reopen it. While the step shows, the app keeps it in its data folder (`setup.json`: the step,
   the workspace, the time and the main window's page). Opened again within 30 minutes, not at login, the app opens
   the main window on that page and the step over it, with fresh states and a line that the changes took effect;
   Preferences comes back the same way when the person asked from there. Finishing, skipping or closing the window forgets it;
   quitting doesn't.

## Consequences

- A person brings a computer to a Cloud workspace without a terminal: the app, an Allow, and it is theirs.
- A link from the web reaches only the app's confirm, and the maker's approval is still the gate: a link that leaks
  joins nothing by itself, and a person who didn't ask chooses Not now.
- The link info endpoint names a workspace and a person to whoever holds a live code; codes are short-lived,
  single-use and rate-limited per address.
- An app built before this still refuses Cloud and doesn't know `agenteschat://pair`: the web keeps the terminal line
  as the way out there.
- Agents of a newly paired computer can run commands from the start, which reach the rest of the computer, not only
  the allowed folders: the pairing sheets say so under Commands, and the person turns it off there or in Preferences.
- Nothing interrupts agents later for a Mac permission the person already gave, and a refused one has its way out in
  the app, never a terminal command.
- An ad-hoc signed Mac app loses every one of these grants with each update (macOS ties them to the build's
  signature), and what was asked is forgotten with the version, so Preferences › General › Permissions shows them off
  again and is where people turn them back on. A Developer ID signature keeps them across updates.
