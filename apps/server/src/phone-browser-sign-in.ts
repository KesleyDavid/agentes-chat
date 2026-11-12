import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, formCsrfMiddleware, getOAuthState } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { desktopChallenge, KEY } from "./desktop-sign-in";

/**
 * The phone app's provider sign-in through the system browser (ADR 0035, addendum 2026-11-11). The browser that runs
 * the provider's page is not the app, and anyone can be sent a link into it, so a sign-in is tied to both ends:
 *
 * 1. The app keeps a verifier and starts the sign-in with its challenge (the verifier's SHA-256), which is stored
 *    with the sign-in's state.
 * 2. The browser's first stop, the Expo plugin's proxy, goes on only for a state a phone app started
 *    (`phoneFlowStarted`): a sign-in started on the web is never moved into another browser.
 * 3. The callback leaves no session in that browser. It goes back to the app with a one-time code, which the app
 *    trades with its verifier for the session (`/phone/redeem`). The code alone, as any app that takes the link sees
 *    it, signs in nobody; neither does the verifier of whoever started a sign-in someone else finished elsewhere.
 *
 * App builds from before the challenge get the session in the link, as they always did, while `LEGACY_PHONE_SIGN_IN`
 * is on; the browser keeps no session for them either.
 */

/**
 * Whether a sign-in started without a challenge still completes, with the session in the link back to the app. On
 * while app builds from before the challenge are in use; off, the proxy refuses their sign-ins and no link ever
 * carries a session.
 */
export const LEGACY_PHONE_SIGN_IN = true;

/** Better Auth's key for a sign-in's stored state (its `state.ts`, the database strategy). */
const STATE_PREFIX = "auth-state:";
const PHONE_CODE_PREFIX = "phone-code:";
/** How long the app has to trade the code: it does so as soon as the browser closes. */
const CODE_TTL_S = 5 * 60;

type CodeRecord = { challenge: string; token: string };

function parseRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type TrustsOrigins = { isTrustedOrigin(url: string): boolean };

/** A link into the app (`agenteschat://…`), never a web address. */
function isAppLink(context: TrustsOrigins, link: unknown): link is string {
  if (typeof link !== "string") return false;
  try {
    const { protocol } = new URL(link);
    return protocol !== "http:" && protocol !== "https:" && context.isTrustedOrigin(link);
  } catch {
    return false;
  }
}

const challengeOf = (state: object | null | undefined) => {
  const challenge = (state as { challenge?: unknown } | null | undefined)?.challenge;
  return typeof challenge === "string" && KEY.test(challenge) ? challenge : null;
};

/**
 * Whether the proxy may plant the state of `authorizationURL` in the visitor's browser: only a pending sign-in that
 * comes back to the app, and, without `legacy`, only one that carries a challenge.
 */
export async function phoneFlowStarted(
  context: TrustsOrigins & {
    internalAdapter: {
      findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null | undefined>;
    };
  },
  authorizationURL: string,
  legacy: boolean = LEGACY_PHONE_SIGN_IN,
): Promise<boolean> {
  const state = new URL(authorizationURL).searchParams.get("state");
  if (!state) return false;
  const found = await context.internalAdapter.findVerificationValue(STATE_PREFIX + state);
  const stored = found && found.expiresAt >= new Date() ? parseRecord(found.value) : null;
  // Every way back, not only the usual one: the callback sends a first-time account to `newUserURL`.
  const back = (link: unknown) => link === undefined || link === null || isAppLink(context, link);
  return (
    isAppLink(context, stored?.callbackURL) &&
    back(stored?.newUserURL) &&
    back(stored?.errorURL) &&
    (legacy || challengeOf(stored) !== null)
  );
}

export function phoneBrowserSignIn() {
  return {
    id: "phone-browser-sign-in",
    hooks: {
      after: [
        {
          matcher: (context) => Boolean(context.path?.startsWith("/callback")),
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.context.responseHeaders;
            if (!headers) return;
            const location = headers.get("location");
            const state = await getOAuthState().catch(() => null);
            const toApp = isAppLink(ctx.context, location);
            // Decided by how the sign-in started, not by where this answer goes: a sign-in a phone app started
            // leaves no session in the browser even when the callback ends at a web address.
            if (!toApp && !isAppLink(ctx.context, state?.callbackURL)) return;
            // The Expo plugin's own hook copies these into the link; whichever of the two runs first, the browser
            // gets none and the link carries only what is decided here.
            const cookies = headers.get("set-cookie");
            headers.delete("set-cookie");
            if (!toApp) return;
            const back = new URL(location);
            back.searchParams.delete("cookie");
            const challenge = challengeOf(state);
            const token = ctx.context.newSession?.session.token;
            if (challenge) {
              if (token) {
                const code = randomBytes(32).toString("base64url");
                await ctx.context.internalAdapter.createVerificationValue({
                  identifier: PHONE_CODE_PREFIX + code,
                  value: JSON.stringify({ challenge, token } satisfies CodeRecord),
                  expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
                });
                // In the shape of a cookie, where the app's sign-in already reads what the link brings: it keeps
                // the code and sends it with its next request, the trade.
                const { name } = ctx.context.createAuthCookie("phone_code");
                back.searchParams.set("cookie", `${name}=${code}; Max-Age=${CODE_TTL_S}`);
              }
            } else if (cookies && LEGACY_PHONE_SIGN_IN) back.searchParams.set("cookie", cookies);
            headers.set("location", back.toString());
          }),
        },
      ],
    },
    endpoints: {
      phoneRedeem: createAuthEndpoint(
        "/phone/redeem",
        { method: "POST", body: z.object({ verifier: z.string().regex(KEY) }), use: [formCsrfMiddleware] },
        async (ctx) => {
          const cookie = ctx.context.createAuthCookie("phone_code");
          const code = ctx.getCookie(cookie.name);
          if (!code || !KEY.test(code)) return ctx.json({ signedIn: false });
          ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
          // Spent whatever the verifier: a code is tried once.
          const found = await ctx.context.internalAdapter.consumeVerificationValue(PHONE_CODE_PREFIX + code);
          const kept = found && found.expiresAt >= new Date() ? parseRecord(found.value) : null;
          if (!kept || typeof kept.token !== "string" || kept.challenge !== desktopChallenge(ctx.body.verifier)) {
            return ctx.json({ signedIn: false });
          }
          // The session the callback made, which no browser was given.
          const source = await ctx.context.internalAdapter.findSession(kept.token);
          if (!source || source.session.expiresAt <= new Date()) return ctx.json({ signedIn: false });
          await setSessionCookie(ctx, source);
          return ctx.json({ signedIn: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
