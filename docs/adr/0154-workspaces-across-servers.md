# 0154. Workspaces across servers in the phone and desktop apps

- Status: Accepted
- Date: 2026-11-07
- Amends: 0035 (the phone app held one server and one session; moving to another signed out), 0036 (the desktop app's
  servers and workspaces were two separate lists)
- Code: server `routes/app/account.ts` (`GET /me/unread`), engine `notifications.ts` (`notificationCountsByOrg`),
  `push.ts` (`PushDeps.server`, `data.server`), `jobs.ts` (`pushServer`); client `api/http-client.ts`
  (`account.unread`); phone and desktop as below

## Context

People use more than one agentes.chat: a workspace on agentes.chat Cloud and their team's self-hosted server, say.
The phone app kept one server and one session: moving to another signed out, its server screen opened only while
signed out, and its workspace list showed the current server's alone. The desktop app kept a list of servers, each
signed in through the window's per-origin cookies, but its workspace menu (the web sidebar's) showed only the server
open in the window, with no unread counts, and notifications came only from the workspace open.

## Decision

One list of workspaces, grouped by server, in both apps; switching keeps every server signed in.

### 1. The server

- `GET /api/app/me/unread`: `{ organizations: [{ orgId, unread, waiting }] }`, the inbox counts of every workspace the
  person reads (`notificationCountsByOrg`), so an app asks each server once instead of once per workspace. Both apps
  show this `unread` as the workspace's number in the list.
- Phone pushes carry `server`, the origin of the server's `PUBLIC_URL`, so a phone signed in to several servers opens
  the push's workspace on the right one.

### 2. The phone

- One session per server: the auth client's `storagePrefix` is per server, the servers signed in to are a list in
  secure storage, and the session of the server saved before this change moves to its server's prefix once (no new
  sign-in). Only one account per server; another account on the same server is left for later.
- What belonged to the one server is per server: the remembered workspace, the push token's registrations, the chats
  snapshot and outboxes (a queued message or voice note goes to the server it was written on).
- **Workspaces** in Você is always there, with the total unread. Its screen lists every workspace of every server signed
  in to, under a header per server, each with its unread count (`/me/unread`, the current server's live from its own
  data). Tapping one on another server switches to it without signing out.
- **Adicionar workspace**, at the end, opens a pushed screen with two ways: a new workspace on agentes.chat (signed in
  there already: its creation; otherwise sign in or create an account there, then its creation), or the team's server
  by address or QR code. Adding a server makes it the current one: signed in there already, its workspaces; otherwise
  its sign-in, with a way back to the workspace before. Nothing signs out.
- Signing out of a server signs out of that one only: its push registration, session and per-server values go, the
  others and the phone's own preferences (theme, sounds) stay.
- Push: the phone registers its token with every server signed in to (again when the token changes). A tap reads
  `server`: on another server it switches there, then opens the workspace and place. A push without `server` (an older
  server) belongs to the current one.

### 3. The desktop

- The app reads every other server's workspaces and unread counts itself: Rust takes that server's session cookie from
  the webview's store (`cookies_for_url`, the same cookies the window uses) and calls `GET /api/app/me` and
  `GET /api/app/me/unread` like the phone does (no `Origin`, `X-Agentes-Client: mobile`), every minute and when the
  window gains focus. The server open in the window reports its own from the page.
- The web sidebar's **Seus workspaces** lists them grouped by server, with unread counts; "Adicionar workspace" (in
  place of "Novo workspace" in the desktop app) opens the welcome window in an add-a-workspace mode: a new workspace on
  agentes.chat, or the team's server. Choosing a workspace on another server switches the window there.
- New unread notifications on a server not open in the window show as the system's notification, named after the
  workspace and server (found by the minute's check, so up to a minute late); clicking it opens that workspace.
- Preferences › Servers lists each server's workspaces.

## Consequences

- A person on Cloud and a self-hosted server sees both in one list, on the phone and the desktop, without signing in
  again each time.
- The phone keeps a session per server and asks each one for its workspaces; the desktop asks each one every minute.
- Another account on the same server isn't supported yet.
- Self-hosted Android pushes still share the relay's cap per phone across all of its servers (ADR 0152).

## Addendum (2026-11-11): a session's prefix is random and has one owner

Replaces how a server's `storagePrefix` is chosen in decision 2. A prefix made from the server's address (a 32-bit hash) could be matched by another address, and the app would then send the first server's session to the second.

- A server the phone meets for the first time gets a random prefix, saved with its address before anything is stored under it. The saved list is the record of who owns each prefix: a prefix has one owner, and a second address saved with the same one is dropped and gets its own.
- What is kept per server (the remembered workspace, the chats snapshot, the outboxes) is named after the server's prefix, not its address.
- Installs from before this keep their sessions: at launch, each server the phone is signed in to that has no saved prefix keeps the one made from its address, now saved as its own. Where two such servers share one, the first signed in to keeps it and the other signs in again.
- `authedFetch` sends a server's cookie only to addresses on that server's origin.
