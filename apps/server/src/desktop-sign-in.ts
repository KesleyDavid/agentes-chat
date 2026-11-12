import { createHash, randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

/**
 * Social sign-in for the Mac app's window (ADR 0036). Google and Apple refuse
 * embedded web views, so the window opens the sign-in in the person's browser
 * and waits. The hand-over is a device-style exchange so that a sign-in is only
 * ever moved to a window the person is actually using, never to one chosen by
 * whoever crafted the link:
 *
 * 1. The window asks the server to `open` a request, sending only the challenge
 *    (the SHA-256 of a verifier it keeps). It gets back a random `requestId` and
 *    a short human `code`, and shows the code.
 * 2. The window opens the browser at `/desktop/sign-in?request=<requestId>` and
 *    polls `/desktop/redeem` with the verifier.
 * 3. After the provider sign-in, the browser reads the request's `code`, shows it,
 *    and asks the person to confirm it matches the code on their computer. Only
 *    then does it call `/desktop/handoff` with the request id.
 * 4. `handoff` accepts only a request that a window opened, still pending and not
 *    expired, and only from a fresh, still-live browser session. It consumes the
 *    request and records that source session for the challenge. `redeem` checks
 *    it is still live before returning a session to the window with the verifier.
 *
 * Nothing is handed over on its own: a link that jumps straight to the page still
 * stops at the confirmation, and the verifier never leaves the window, so the
 * request id and code alone cannot sign anyone in.
 */
export const HANDOFF_PREFIX = "desktop-handoff:";
export const REQUEST_PREFIX = "desktop-request:";
/** How long the window has to pick the session up once handed over. */
const HANDOFF_TTL_MS = 10 * 60_000;
/** How long a request stays open for the browser to confirm. */
const REQUEST_TTL_MS = 10 * 60_000;
/** How recent a sign-in must be to hand it over to the app, or to add a password (`signedInLately`). */
export const FRESH_SIGN_IN_MS = 10 * 60_000;
/** 32 random bytes and their SHA-256, both base64url (43 characters): challenge, verifier and request id. */
export const KEY = /^[A-Za-z0-9_-]{43}$/;
/** Unambiguous code alphabet (no I/O/0/1) for the match the person reads off both screens. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export const desktopChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** A short code the person compares between the app window and the browser (`KQ7M-3XPF`). */
export function newConfirmationCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (i === CODE_LENGTH / 2) code += "-";
    code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  }
  return code;
}

type RequestRecord = { challenge: string; code: string };

function parseRequest(value: string | undefined): RequestRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RequestRecord;
    if (typeof parsed?.challenge === "string" && typeof parsed?.code === "string") return parsed;
  } catch {
    // A malformed record is treated as no request.
  }
  return null;
}

export function desktopSignIn() {
  return {
    id: "desktop-sign-in",
    endpoints: {
      // The window opens a request bound to its challenge and gets the id and the code to show.
      desktopOpen: createAuthEndpoint(
        "/desktop/open",
        { method: "POST", body: z.object({ challenge: z.string().regex(KEY) }) },
        async (ctx) => {
          const requestId = randomBytes(32).toString("base64url");
          const code = newConfirmationCode();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: REQUEST_PREFIX + requestId,
            value: JSON.stringify({ challenge: ctx.body.challenge, code } satisfies RequestRecord),
            expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
          });
          return ctx.json({ requestId, code });
        },
      ),
      // The browser reads the request's code to show it; it is for the person to match, not a secret.
      desktopRequestCode: createAuthEndpoint(
        "/desktop/request",
        { method: "POST", body: z.object({ requestId: z.string().regex(KEY) }) },
        async (ctx) => {
          const found = await ctx.context.internalAdapter.findVerificationValue(REQUEST_PREFIX + ctx.body.requestId);
          const request = found && found.expiresAt >= new Date() ? parseRequest(found.value) : null;
          return ctx.json({ code: request?.code ?? null });
        },
      ),
      // After the person confirms the code, the fresh browser session hands itself over for the window's challenge.
      desktopHandoff: createAuthEndpoint(
        "/desktop/handoff",
        { method: "POST", body: z.object({ requestId: z.string().regex(KEY) }), use: [sessionMiddleware] },
        async (ctx) => {
          const { session } = ctx.context.session;
          if (Date.now() - new Date(session.createdAt).getTime() > FRESH_SIGN_IN_MS) {
            throw new APIError("FORBIDDEN", { message: "Sign in again to continue in the app" });
          }
          // sessionMiddleware may use the signed five-minute cookie cache. A session
          // revoked in the database must not mint a new device session through it.
          const source = await ctx.context.internalAdapter.findSession(session.token);
          if (!source || source.session.userId !== session.userId || source.session.expiresAt <= new Date()) {
            throw new APIError("UNAUTHORIZED", { message: "Sign in again to continue in the app" });
          }
          const found = await ctx.context.internalAdapter.consumeVerificationValue(REQUEST_PREFIX + ctx.body.requestId);
          const request = found && found.expiresAt >= new Date() ? parseRequest(found.value) : null;
          if (!request) return ctx.json({ ok: false });
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: HANDOFF_PREFIX + request.challenge,
            value: session.token,
            expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
          });
          return ctx.json({ ok: true });
        },
      ),
      desktopRedeem: createAuthEndpoint(
        "/desktop/redeem",
        { method: "POST", body: z.object({ verifier: z.string().regex(KEY) }) },
        async (ctx) => {
          const found = await ctx.context.internalAdapter.consumeVerificationValue(
            HANDOFF_PREFIX + desktopChallenge(ctx.body.verifier),
          );
          if (!found || found.expiresAt < new Date()) return ctx.json({ signedIn: false });
          // The source browser may have signed out or been revoked after handoff.
          const source = await ctx.context.internalAdapter.findSession(found.value);
          if (!source || source.session.expiresAt <= new Date()) return ctx.json({ signedIn: false });
          const { user } = source;
          // It signed in when the browser's session did: it proves no fresher sign-in (`signedInLately`).
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            undefined,
            { createdAt: source.session.createdAt },
            true,
          );
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ signedIn: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
