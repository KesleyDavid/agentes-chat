# 0035. Mobile app: Expo + React Native with shared logic

- Status: Accepted. Amended 2026-10-30 by ADR 0088 (§5: deleting an account takes proof that it's you and reads a preflight first, the web deletes accounts too, and the account's own workspaces close for 7 days), and 2026-10-31 by ADR 0088 (§5: the proof is a code emailed to the person)
- Date: 2026-10-17
- Extends: ADR 0007 (keys never reach clients), the in-app notifications (`packages/engine/src/notifications.ts`)

## Context

We want a phone app with the same identity and behavior as the web. Today all client logic (API types and client, TanStack queries, realtime, i18n, formatting and domain helpers) lives inside `apps/web`. The private API (`/api/app/*`) assumes a browser: a same-origin cookie session, and a CSRF check that refuses state-changing requests whose `Origin` is not ours. A native app sends no `Origin`. There is no push, no in-app account deletion and no Sign in with Apple, all of which the stores require.

## Decision

**1. Expo + React Native in `apps/mobile`. Logic is shared, UI is not.**
- Screens and components are native (Expo Router, `View`/`Text`) and follow the same design system. No react-native-web or universal UI kit.
- Verification runs in CI (lint, typecheck, unit tests on pure logic). Builds and device installs go through EAS (`.github/workflows/mobile.yml`, needs the `EXPO_TOKEN` secret).

**2. Shared packages.** The web imports them too and must not change behavior.
- `@agenteschat/client` (`packages/client`): API types, `ApiError`, the HTTP client, query keys, query options and the React Query hooks, realtime (`RealtimeConnection`, frames, streams, consultations), and the DOM-free helpers from `apps/web/src/lib`. React is allowed (hooks run on both platforms). DOM, `react-dom`, `window`, `document`, `localStorage` and `@agenteschat/ui` are not, and a guard test enforces this. Platform effects come in as options (for example `onAgentReaction` instead of calling `playAgentReaction`).
  - `createHttpApi({ baseUrl?, fetch?, headers? })`: `baseUrl` defaults to same origin; `headers` is a function called per request and merged into every request, JSON and files alike.
  - `realtimeUrl(base: string | { protocol: string; host: string }, orgId)` and `RealtimeConnection({ url, createSocket, ... })`, where `createSocket` is injected (the app passes a factory that adds headers).
  - Subpath exports: `@agenteschat/client` (root: api, types, keys, queries, realtime) and `@agenteschat/client/lib/<name>` for each moved helper.
- `@agenteschat/i18n` (`packages/i18n`): `ptBR`, `en`, `type Translations`, and `resources` (i18next shape, one namespace). It keeps the parity guard.
- `@agenteschat/tokens` (`packages/tokens`): `light` and `dark` color maps with the CSS variable names in camelCase (`bg`, `raised`, `sunken`, `glass`, `line`, `line2`, `ink`, `ink2`, `muted`, `faint`, `agent`, `agent2`, `ok`, `warn`, `danger`, …), `shadows` (`e1`, `e2`, `e3` as layer lists `{ x, y, blur, spread, color }`), `radius`, `fonts` (`sans` Onest, `display` Funnel Display, `dot` Doto) and `motion` (bezier curves, spring). `docs/design/design-system/tokens.css` stays the source of truth, and a test keeps the TS values equal to it.
- The agent engine stays single. `@agenteschat/ui` exports `./agent/engine` (the existing `engine.js`) and the DOM-free sky math. The app draws through a small adapter from the engine's `Ctx2D` subset to React Native Skia. The sky and the fuse in the app are a Skia shader whose output a test compares against the shared math.

**3. App sessions without browser CSRF.**
- The server adds Better Auth's Expo plugin (`@better-auth/expo`) and trusts the app scheme `agenteschat://`. The app signs in with `expoClient` (session in SecureStore, social sign-in through the system browser and a deep link back). A refusal there lands on the server's sign-in page in that browser, which says why (`onAPIError.errorURL`): the plugin keeps the browser's last address to itself, so the app learns nothing of it.
- The plugin's `/api/auth/expo-authorization-proxy`, where that browser starts, would redirect to any https address and sign that address's `state` into the visitor's state cookie (an open redirect, and a way to plant someone else's sign-in). It only goes on to a configured provider's authorization endpoint (Google, GitHub, Apple) with our client id and our own callback as `redirect_uri`; anything else is a 400 (`expoProxyAllowed` in `apps/server/src/auth.ts`).
- The app calls `/api/app/*` and `/api/ws` with the session cookie read from SecureStore (`authClient.getCookie()`) in a `Cookie` header, plus `X-Agentes-Client: mobile`, and no `Origin`.
- The CSRF rule in `routes/app/context.ts` becomes: with an `Origin`, it must be one of ours (unchanged). Without an `Origin`, the request must carry `X-Agentes-Client: mobile`. A browser cannot send that custom header cross-site without a CORS preflight, and we never allow one. Plain HTML forms always send an `Origin`. The WebSocket upgrade follows the same rule.
- React Native's WebSocket sends an `Origin` derived from the URL. It passes because the app's API URL is the server's `PUBLIC_URL`; a foreign `Origin` is refused even with the app header.
- Nothing new reaches the client: provider keys and MCP stay server-side (ADR 0007).

**4. Push notifications.**
- `push_devices` (migration 0066; per user, not per org: `user_id`, `token`, `platform` ios|android, `locale`, timestamps) with `POST /api/app/push/devices` (upsert, 204; the token moves to whoever is signed in; 10 devices per person, 30 registrations an hour) and `DELETE /api/app/push/devices/:token` (204, own tokens only).
- Delivery goes through the outbox as a `push.send` job, via a `PushSender` adapter (Expo Push API; a fake in tests). Unregistered tokens are removed.
  *Amended 2026-11-02 (ADR 0152):* Android phones register their FCM token and the server sends to Firebase Cloud Messaging directly (`FIREBASE_SERVICE_ACCOUNT`) or through agentes.chat's push relay (`PUSH_SENDER`); iPhones stay on the Expo Push API.
- What pushes (notification kinds): everything in "Esperando você" (approval, agent question), mention, DM from a person, an agent's answer to the person behind its run (ADR 0071 §7), and mission or routine stopped or failed. Muted or read items do not push. Grouped items push once per group while unread.
- Push text is the one exception to "server strings in English": the OS shows it as is. A small catalog (`push-messages.ts`, pt-BR and en, picked by the device locale) renders it. The payload carries `{ orgId, kind, notificationId, channelId?, threadId?, approvalId?, missionId? }` for the deep link.
- A high-risk approval is never approved from the notification. It opens the app, which asks to hold.

**5. Store requirements.**
- `DELETE /api/app/account` deletes the person's account (App Store 5.1.1(v)). It returns 204, or 409 `sole_owner` (with `params.organizations`) while they are the only owner of an organization that has other members, and the app says what to do. Organizations where they are the only member are deleted with them; their messages stay without an author.
  *Amended 2026-10-30, and 2026-10-31 for the code (ADR 0088 §2):* it takes proof that it's the person: the code `POST /api/app/account/deletion/code` emails them, in the body (`{ code }`; 403 `reauth.code` without one, `reauth.code_wrong`, `reauth.code_expired` or `reauth.code_tries` when refused), or on a server that sends no email the password (`{ password }`; 403 `reauth.password`, 429 after 5 tries in 15 minutes). The app reads the preflight first (`GET /api/app/account/deletion`): the workspaces that stop it, each with a button that opens the web page that unblocks it, or what closes, what they leave, the computers removed and what stays behind, each with a button that opens where it's disconnected on the web; then Send code and the code from the email (or the password where no email goes, which the web adds first to an account without one); then the hold to delete. It's also reached from the screens of a workspace being deleted or suspended, which open the account page over them; the first run opens the web's. `sole_owner` adds `params.orgIds` and no longer counts a workspace being deleted. The workspaces where they are the only member close at once and are deleted 7 days later. The web and the desktop app delete accounts too, from Settings › Your account. Old builds send no code: they show their generic failure, so the build that asks for the code ships with the server. A new build on a server from before the preflight (404) deletes as the old builds did. Deleting a workspace stays on the web: the app's row opens that page.
- Sign in with Apple is a social provider when `APPLE_CLIENT_ID`/`APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` are set, and `authConfig` lists it (App Store 4.8, required because we offer Google).
- The app sells nothing. Plans are bought on the web.

- Push receipts: each send that got tickets schedules a `push.receipts` job about 15 minutes later; it asks Expo (`/--/api/v2/push/getReceipts`) and deletes the tokens whose receipt says `DeviceNotRegistered`.
- Deleting an account that signed in with Apple revokes its Apple token (`https://appleid.apple.com/auth/revoke`, the refresh token when Better Auth kept one, else the access token), best effort, after the account is gone, with a client secret signed for the call.

**Known gaps (follow-ups):** the Apple client secret used for sign-in is signed at boot and lasts 150 days, so the server must restart within that window. A native iOS sign-in (id token only) stores no Apple token, so there is nothing to revoke for it.

## Consequences

- One place for API contracts, translations and tokens, so web and app cannot drift.
- The CSRF change widens `/api/app` to non-browser clients carrying a valid session. Sessions from the app show up in the session list and can be revoked.
- The app has two drawing paths for the sky (Canvas on the web, a shader in the app), held together by a test.
- `apps/mobile` brings React Native into the workspace install. CI installs it but tests only its pure logic. Builds run on EAS.

## Addendum (2026-11-11): a browser sign-in is tied to the app that started it

Adds to decision 3. The browser that runs a provider's page is not the app: it starts at a link (the Expo plugin's proxy) that anyone can be sent, and it ends at a link back into the app that any app registered for the scheme can take. So a sign-in through the browser now needs both ends.

- The app makes a random verifier, keeps it, and starts the sign-in with its challenge (the verifier's SHA-256, base64url) in the request's `additionalData`. It is stored with the sign-in's state on the server.
- The proxy goes on only with the state of a pending sign-in whose way back is a link into the app (`phoneFlowStarted` in `apps/server/src/phone-browser-sign-in.ts`), on top of the provider, client id and callback it already checked. A sign-in started on the web is never moved into another browser this way.
- The callback of a sign-in that goes back to the app sets no cookie in the browser: a session the app asked for is the app's alone.
- With a challenge, the link back carries a one-time code (5 minutes) in place of the session, in the `cookie` parameter the Expo client already reads, so the app keeps it and sends it with its next request. `POST /api/auth/phone/redeem { verifier }` trades the code and the verifier for the session the callback made. The code is spent on its first try. The code alone (what another app that takes the link sees) signs in nobody, and neither does the verifier alone (what someone holds who started a sign-in and sent another person its link).
- The app asks for the trade after every browser sign-in. A server from before this answers 404 and has already sent the session in the link, so a new app signs in on an old server as before.

**Apps from before the challenge.** They send none and expect the session in the link, so the server still sends it there while `LEGACY_PHONE_SIGN_IN` (same file) is `true`. Their browser gets no session either. What stays as it was for them: the link back carries the session, so another app on the same phone that takes the `agenteschat://` scheme could read it. Setting the constant to `false` retires them: the proxy refuses a sign-in without a challenge and no link carries a session; a person on an old build then updates the app or signs in another way. Apple's native sign-in on iOS never goes through the browser and is unchanged.
