import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, sign as signWithKey } from "node:crypto";
import type { HumanAction, HumanCheck, PubSub, RateLimiter } from "@agenteschat/adapters";
import { nameIsPassword } from "@agenteschat/client/lib/text";
import type { Config } from "@agenteschat/config";
import { and, type Database, eq, ne, schema } from "@agenteschat/db";
import {
  accountBlock,
  announceProfile,
  countUsers,
  deriveSecret,
  EARLY_ACCESS_HEADER,
  EARLY_ACCESS_TOKEN,
  earlyAccessLink,
  emailLocale,
  enqueueAccountContact,
  ForbiddenError,
  holdsInvitation,
  INVITATION_MAIL_HEADER,
  INVITATION_TOKEN_HEADER,
  isAgentesCloud,
  onUserCreated,
  queueEmail,
  recordSession,
  recordSignUp,
  requestLocale,
  revokeUserApps,
  type SignupPolicy,
  sha256,
  signupAdmission,
  signupOpenToAll,
  spendDeletionCode,
  TooManyError,
  useEarlyAccess,
  type WorkspacePolicy,
} from "@agenteschat/engine";
import { expo } from "@better-auth/expo";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
  getOAuthState,
  isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { listOf } from "./app-links";
import { desktopSignIn, FRESH_SIGN_IN_MS } from "./desktop-sign-in";
import { humanCheckRefusal } from "./http/human-check";
import type { Logger } from "./logger";
import { ownerSignIn } from "./owner-claim";
import { phoneBrowserSignIn, phoneFlowStarted } from "./phone-browser-sign-in";

/**
 * Sign-in for people, built on Better Auth (ADR 0006):
 * Better Auth owns users, sessions, passwords and social sign-in; agentes.chat
 * owns organizations, memberships, roles and invitations
 * (`@agenteschat/engine` organizations). Agents are not users.
 * See docs/adr/0006-auth-and-tenancy.md.
 *
 * Mounted at `/api/auth/*`. The web app is served from the same origin, so
 * the session is an HttpOnly cookie — no tokens in the browser. The phone
 * app (ADR 0035) signs in through the Expo plugin: its scheme
 * `agenteschat://` is trusted, it keeps the cookie in the device's secure
 * store and sends it back in a `Cookie` header with `X-Agentes-Client: mobile`.
 * The Mac app's window loads the site itself and signs in like the web; for
 * Google and Apple it borrows the browser (`desktop-sign-in.ts`, ADR 0036).
 */
export function createAuth(deps: {
  db: Database;
  config: Config;
  log: Logger;
  emailDelivers?: boolean;
  /** Counts the reset and confirmation emails per address. */
  rateLimiter: RateLimiter;
  /** The bot check of the email forms (ADR 0075); absent: none. */
  humanCheck?: HumanCheck | null;
  /** Tells a person's workspaces their name changed. */
  pubsub?: PubSub;
}) {
  const { db, config, log, rateLimiter } = deps;
  const emailEnabled = deps.emailDelivers === true;
  // Better Auth answers the same whether an email went out, so a flood from many addresses only stops quietly.
  const emailAllowed = async (kind: "reset-email" | "verify-email", email: string) =>
    (await rateLimiter.consume(`${kind}:${sha256(email.toLowerCase())}`, EMAILS_PER_ADDRESS)).allowed;

  const policy = signupPolicy(config);
  // An invitation link never opens sign-up (ADR 0068): only an email invitation to that address, or an early-access
  // link sent to it (ADR 0078), does.
  const assertSignupAllowed = async (email: string, access: string | null) => {
    const admission = await signupAdmission(db, email, policy, { access });
    if (admission) return admission;
    if (policy.ownerByLink && (await countUsers(db)) === 0) {
      throw new APIError("FORBIDDEN", {
        code: OWNER_CLAIM_REQUIRED,
        message: "This server waits for its owner: open its owner link.",
      });
    }
    // Only whoever holds the link learns it is for another address, and never which one.
    const link = await earlyAccessLink(db, access);
    if (link && link.expiresAt > new Date() && link.email !== email.trim().toLowerCase()) {
      throw new APIError("FORBIDDEN", {
        code: EARLY_ACCESS_OTHER_EMAIL,
        message: "This invitation is for another address. Sign up with the address it was sent to.",
      });
    }
    throw new APIError("FORBIDDEN", {
      code: SIGNUP_CLOSED,
      message: "Sign-up is closed on this server. If you were invited, open the link in the invitation email.",
    });
  };

  const devOrigins = config.NODE_ENV === "development" ? ["http://localhost:5173"] : [];
  // The phone app (ADR 0035); Expo Go and dev builds use `exp://` outside production.
  const appOrigins = [APP_SCHEME, ...(config.NODE_ENV !== "production" ? ["exp://", "exp://**"] : [])];
  const apple = appleSignIn(config);
  const authorizations = socialAuthorizations(config, apple?.clientId ?? null);

  return betterAuth({
    appName: "agentes.chat",
    baseURL: config.PUBLIC_URL,
    basePath: "/api/auth",
    // Over HTTP each would tell any session whether a password is right, with none of the limit `deletionProof` keeps:
    // a stolen session could guess the account's password there, then sign in with it anywhere, or delete with it on
    // a server that sends no email. No app calls them, `deletionProof` calls `verifyPassword` in this process (which
    // this leaves open), and a forgotten password is reset by email.
    disabledPaths: ["/verify-password", "/change-password"],
    // Derived from AGENTES_SECRET so self-hosters manage a single secret.
    secret: deriveSecret(config.AGENTES_SECRET, "sessions"),
    // Apple posts the sign-in result back from its own origin (`response_mode=form_post`).
    trustedOrigins: [config.PUBLIC_URL, ...devOrigins, ...appOrigins, ...(apple ? [APPLE_ORIGIN] : [])],
    plugins: [
      expo(),
      phoneSignIn,
      phoneBrowserSignIn(),
      desktopSignIn(),
      ownerSignIn({ db, config, log, mint: (adapter, userId) => mintSignIn(adapter, `${FOR_USER}${userId}`) }),
    ],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    user: {
      additionalFields: { locale: { type: "string", required: false, input: false } },
    },
    session: {
      additionalFields: { activeOrganizationId: { type: "string", required: false, input: false } },
      // Signed cookie cache: most requests don't hit the sessions table.
      // Trade-off: signing out elsewhere takes up to 5 minutes to propagate.
      // Permissions are still checked against the database on every request.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      // The reset email says the link works for an hour.
      resetPasswordTokenExpiresIn: 60 * 60,
      // Only when a real email sender is configured (MillionSend or SMTP); sent through the outbox.
      ...(emailEnabled
        ? {
            sendResetPassword: async (
              {
                user,
                token,
              }: {
                user: { email: string; locale?: string | null };
                url: string;
                token: string;
              },
              request?: Request,
            ) => {
              if (!(await emailAllowed("reset-email", user.email))) return;
              // Straight to our page (not Better Auth's redirect): the same link opens the phone app when it is
              // installed (universal link / App Link, app-links.ts) and the website otherwise; both reset with it.
              const url = `${config.PUBLIC_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
              // An account with no language yet (made by the owner link, or before sign-up kept one): the request's.
              const locale = emailLocale(user.locale ?? requestLocale(request?.headers.get("accept-language")));
              await queueEmail(db, {
                orgId: null,
                key: `password-reset:${sha256(token)}`,
                to: [user.email],
                template: { kind: "password_reset", locale, url },
              });
            },
          }
        : {}),
      onPasswordReset: async ({ user }: { user: { id: string } }) => {
        // An emailed link reached the mailbox, as a confirmation link would, and the password nobody proved is gone
        // with every session: the address counts as confirmed, so a provider can join the account (ADR 0006). A link
        // an owner made on a server without email proves nothing about the mailbox (ADR 0158).
        if (emailEnabled) {
          await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, user.id));
        }
        // A new password cuts off every AI app and personal token the old one let in (ADR 0119).
        await revokeUserApps(db, user.id);
      },
    },
    ...(emailEnabled
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            // The onboarding says the link works for an hour (`onboarding.confirmation.sent`).
            expiresIn: 60 * 60,
            sendVerificationEmail: async (
              {
                user,
                url,
                token,
              }: {
                user: { email: string; locale?: string | null };
                url: string;
                token: string;
              },
              request?: Request,
            ) => {
              // Signing up from an email invitation's page opened from its email (`x-invitation-token` and the proof
              // only the message carries, `x-invitation-mail`): accepting it confirms the address (ADR 0090), so no
              // "confirm your email" follows. From a copied link, another address's invitation, or asked for later, it
              // goes as always.
              const signingUp = request ? new URL(request.url).pathname.endsWith("/sign-up/email") : false;
              const invitation = request?.headers.get(INVITATION_TOKEN_HEADER);
              const mail = { secret: config.AGENTES_SECRET, proof: request?.headers.get(INVITATION_MAIL_HEADER) };
              if (signingUp && invitation && (await holdsInvitation(db, user.email, invitation, mail))) return;
              if (!(await emailAllowed("verify-email", user.email))) return;
              const locale = emailLocale(user.locale ?? requestLocale(request?.headers.get("accept-language")));
              await queueEmail(db, {
                orgId: null,
                key: `verify-email:${sha256(token)}`,
                to: [user.email],
                template: { kind: "verify_email", locale, url: confirmationLanding(url) },
              });
            },
          },
        }
      : {}),
    socialProviders: {
      ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
              mapProfileToUser: noteProviderEmail,
            },
          }
        : {}),
      ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: config.GITHUB_CLIENT_ID,
              clientSecret: config.GITHUB_CLIENT_SECRET,
              mapProfileToUser: noteProviderEmail,
            },
          }
        : {}),
      ...(apple ? { apple: { ...apple, mapProfileToUser: noteProviderEmail } } : {}),
    },
    rateLimit: {
      enabled: config.NODE_ENV !== "test",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 15 * 60, max: 10 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        // The app opens one hand-over request per sign-in; keep it cheap for an unauthenticated caller.
        "/desktop/open": { window: 60, max: 10 },
        "/desktop/request": { window: 60, max: 30 },
        // The app's window asks every 2 s while the browser signs in.
        "/desktop/redeem": { window: 60, max: 40 },
        "/desktop/handoff": { window: 60, max: 10 },
        // The phone app trades once per sign-in through the browser.
        "/phone/redeem": { window: 60, max: 10 },
        "/owner-claim": { window: 60, max: 10 },
        "/owner-key": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { trustedProxies: config.TRUSTED_PROXIES },
    },
    // Better Auth answers what its endpoints throw with a 500 of its own, so the app's onError never sees it: this
    // is that error's log line, and its report (ADR 0104). Its refusals (below 500) stay quiet, as before.
    onAPIError: {
      // A sign-in that failed (a provider's refusal, an expired state) lands on our sign-in page, which says why:
      // never Better Auth's own page (it shows outside production, where native installs set NODE_ENV too late),
      // nor production's silent `/?error=`.
      errorURL: signInPageUrl(config.PUBLIC_URL),
      onError: (error) => {
        if (!isAPIError(error) || error.statusCode >= 500) log.error("auth request failed", { error });
      },
    },
    hooks: {
      // Checked before the endpoint runs so the person sees the real reason.
      // The database hook below also guards social sign-in.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === EXPO_PROXY_PATH) {
          const target =
            (ctx.query as { authorizationURL?: unknown } | undefined)?.authorizationURL ??
            (ctx.request ? new URL(ctx.request.url).searchParams.get("authorizationURL") : undefined);
          if (
            !expoProxyAllowed(target, authorizations, ctx.context.baseURL) ||
            !(await phoneFlowStarted(ctx.context, target))
          ) {
            throw new APIError("BAD_REQUEST", { message: "Invalid authorizationURL" });
          }
        }
        const action = HUMAN_ACTIONS[ctx.path];
        // Before the sign-up policy: a bot gets the cheap refusal first.
        if (action && ctx.headers) {
          const refused = await humanCheckRefusal(deps.humanCheck, ctx.headers, action, config.TRUSTED_PROXIES);
          if (refused) throw new APIError("FORBIDDEN", refused);
        }
        if (ctx.path !== "/sign-up/email") return;
        const { email, name, password } = (ctx.body ?? {}) as { email?: unknown; name?: unknown; password?: unknown };
        if (typeof name === "string" && typeof password === "string" && nameIsPassword(name, password)) {
          throw new APIError("BAD_REQUEST", { code: NAME_IS_PASSWORD, message: NAME_IS_PASSWORD_MESSAGE });
        }
        if (typeof email !== "string") return;
        await assertSignupAllowed(email, await accessOf(ctx));
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Social sign-up too (the phone's Apple sign-in from an invitation).
          before: async (user, context) => {
            const admission = await assertSignupAllowed(user.email, await accessOf(context));
            // An early-access link opens sign-up for one address: a provider must vouch for it.
            if (admission === "early_access" && isSocial(context) && user.emailVerified !== true) {
              throw new APIError("FORBIDDEN", {
                code: EARLY_ACCESS_EMAIL_UNVERIFIED,
                message:
                  "Your sign-in provider hasn't confirmed this address. Confirm it there, or sign up with a password.",
              });
            }
            // The sign-up's own language from the start: the confirmation email goes out before any other choice.
            const locale = requestLocale(context?.headers?.get("accept-language"));
            return { data: { ...user, email: user.email.toLowerCase(), ...(locale ? { locale } : {}) } };
          },
          // After the account is committed: a failure is logged and never fails the sign-up.
          after: async (user, context) => {
            try {
              await onUserCreated(db, user.id);
            } catch (error) {
              log.error("post-signup setup failed", { userId: user.id, error });
            }
            await enqueueAccountContact(db, user.id).catch((error) =>
              log.error("account contact not queued", { userId: user.id, error }),
            );
            const access = await accessOf(context);
            if (access && (!isSocial(context) || user.emailVerified === true)) {
              await useEarlyAccess(db, { access, email: user.email, userId: user.id }).catch((error) =>
                log.error("early access not recorded", { userId: user.id, error }),
              );
            }
          },
        },
        update: {
          // Their name (`/update-user`, from the web or the phone): open apps show the new one at once.
          after: async (user) => {
            await announceProfile(db, deps.pubsub, user.id).catch((error) =>
              log.error("profile change not announced", { userId: user.id, error }),
            );
          },
        },
      },
      // The operator API's events feed (ADR 0056). These run after the sign-in has committed: a failure
      // here is logged and never fails the sign-in.
      account: {
        create: {
          after: async (account) => {
            await recordSignUp(db, account).catch((error) =>
              log.error("operator event failed", { type: "user.signed_up", error }),
            );
          },
        },
      },
      session: {
        create: {
          // A blocked account (ADR 0056 §9) gets no session, whatever the sign-in method. The code also
          // makes a social sign-in's callback send the person back to the sign-in page. On agentes.chat Cloud the
          // body adds the block's kind, never its reason.
          before: async (session) => {
            const block = await accountBlock(db, session.userId);
            if (block) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_BLOCKED",
                message: "This account can't sign in.",
                ...block,
              });
            }
          },
          after: async (session) => {
            await recordSession(db, session).catch((error) =>
              log.error("operator event failed", { type: "session.created", error }),
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The address a provider gave during this request's sign-in (`noteProviderEmail`), read by `authHandler`. */
const providerEmail = new AsyncLocalStorage<{ email?: string }>();

/** Every provider's `mapProfileToUser`: notes the address, changes nothing. */
function noteProviderEmail(profile: { email?: unknown }) {
  const seen = providerEmail.getStore();
  if (seen && typeof profile.email === "string") seen.email = profile.email;
  return {};
}

/**
 * Better Auth's handler. Better Auth refuses a provider sign-in to an existing account as `ACCOUNT_NOT_LINKED` when
 * that account's address isn't confirmed, and also when the provider hasn't confirmed its own. The first comes back to
 * the sign-in page with the provider's address, so the page can offer that account a new password by email; the
 * second as `PROVIDER_EMAIL_UNVERIFIED`, since a new password changes nothing there.
 */
export function authHandler(auth: Auth, db: Database) {
  return (request: Request) => {
    const seen: { email?: string } = {};
    return providerEmail.run(seen, async () => {
      const res = await auth.handler(request);
      const location = res.headers.get("location");
      if (!seen.email || !location) return res;
      const back = new URL(location, "http://localhost");
      if (back.searchParams.get("error") !== ACCOUNT_NOT_LINKED) return res;
      const [account] = await db
        .select({ emailVerified: schema.users.emailVerified })
        .from(schema.users)
        .where(eq(schema.users.email, seen.email.toLowerCase()));
      if (account && !account.emailVerified) back.searchParams.set("email", seen.email);
      else back.searchParams.set("error", PROVIDER_EMAIL_UNVERIFIED);
      const headers = new Headers(res.headers);
      headers.set("location", location.startsWith("/") ? `${back.pathname}${back.search}${back.hash}` : back.href);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    });
  };
}

export type SessionUser = { id: string; name: string; email: string; image?: string | null };

/** The web app's sign-in page (`/login`), with `query` (`error`, `redirect`) when given. */
export function signInPageUrl(publicUrl: string, query?: Record<string, string>) {
  const page = `${publicUrl.replace(/\/$/, "")}/login`;
  return query ? `${page}?${new URLSearchParams(query)}` : page;
}

/** Resolves the signed-in person from request headers (cookie), or null. Used by HTTP and WebSocket. */
export async function sessionUser(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  return session ? (session.user as SessionUser) : null;
}

/**
 * Whether this request's session, as `userId`, signed in within `FRESH_SIGN_IN_MS`, as adding a password requires.
 * Read from the database: a cached cookie can't vouch for it. A session minted from another keeps that one's sign-in
 * time.
 */
export async function signedInLately(auth: Auth, headers: Headers, userId: string) {
  const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (current?.user.id !== userId) return false;
  return Date.now() - new Date(current.session.createdAt).getTime() < FRESH_SIGN_IN_MS;
}

/** Passwords an account may try in 15 minutes to prove it's them. */
const PROOF_TRIES = { limit: 5, windowMs: 15 * 60_000 };

/**
 * Proof that the person at this session is the account's own, before deleting the workspace `orgId`, or their account
 * when it is null (ADR 0088 §2): the code emailed to them (`spendDeletionCode`). On a server that sends no email, their
 * password instead, with 5 tries per 15 minutes per account (429 after). Throws `reauth.code` without a code, and
 * `reauth.password` without a password or with a wrong one.
 */
export async function deletionProof(
  auth: Auth,
  deps: { db: Database; rateLimiter: RateLimiter; emailDelivers: boolean },
  headers: Headers,
  userId: string,
  orgId: string | null,
  proof: { code?: string; password?: string },
) {
  if (deps.emailDelivers) {
    if (!proof.code) throw new ForbiddenError("Type the code we emailed you", "reauth.code");
    return spendDeletionCode(deps, userId, orgId, proof.code);
  }
  const { password } = proof;
  if (!password) throw new ForbiddenError("Give your password to confirm it's you", "reauth.password");
  // Counted before the check: a guess past the limit learns nothing.
  if (!(await deps.rateLimiter.consume(`deletion-proof:${userId}`, PROOF_TRIES)).allowed) {
    throw new TooManyError("Too many tries. Try again in a few minutes.");
  }
  const right = await auth.api.verifyPassword({ body: { password }, headers }).then(
    () => true,
    () => false,
  );
  if (!right) throw new ForbiddenError("That password isn't right", "reauth.password");
}

/**
 * The Expo plugin's `/expo-authorization-proxy` (the phone app's social sign-in, ADR 0035) redirects to any
 * https address and signs that address's `state` into the visitor's state cookie: an open redirect, and a way
 * to move someone else's sign-in into the visitor's browser. It only goes on to a configured provider's own
 * authorization endpoint, for our client id and our callback, so the provider sends the person nowhere but back
 * here (`expoProxyAllowed`), and only with the state of a sign-in a phone app started, which leaves no session in
 * the browser (`phoneFlowStarted`, phone-browser-sign-in.ts).
 */
const EXPO_PROXY_PATH = "/expo-authorization-proxy";

export interface SocialAuthorization {
  id: string;
  /** Better Auth's authorization endpoint for the provider (origin + path). */
  endpoint: string;
  clientId: string;
}

function socialAuthorizations(config: Config, appleClientId: string | null): SocialAuthorization[] {
  const list: SocialAuthorization[] = [];
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    const endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    list.push({ id: "google", endpoint, clientId: config.GOOGLE_CLIENT_ID });
  }
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    const endpoint = "https://github.com/login/oauth/authorize";
    list.push({ id: "github", endpoint, clientId: config.GITHUB_CLIENT_ID });
  }
  if (appleClientId) {
    list.push({ id: "apple", endpoint: "https://appleid.apple.com/auth/authorize", clientId: appleClientId });
  }
  return list;
}

/** Whether the proxy may go on to `target` (`EXPO_PROXY_PATH`). `authBaseURL`: Better Auth's, with its path. */
export function expoProxyAllowed(
  target: unknown,
  allowed: SocialAuthorization[],
  authBaseURL: string,
): target is string {
  if (typeof target !== "string" || target.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const one = (name: string) => {
    const values = url.searchParams.getAll(name);
    return values.length === 1 ? values[0] : null;
  };
  const endpoint = `${url.origin}${url.pathname}`;
  const base = authBaseURL.replace(/\/$/, "");
  return allowed.some(
    (p) =>
      p.endpoint === endpoint && one("client_id") === p.clientId && one("redirect_uri") === `${base}/callback/${p.id}`,
  );
}

/** Better Auth's paths that a bot check guards (ADR 0075), with the action their widget runs. */
const HUMAN_ACTIONS: Record<string, HumanAction> = {
  "/sign-in/email": "sign-in",
  "/sign-up/email": "sign-up",
  "/request-password-reset": "password-reset",
};

/** Reset and confirmation emails to one address in an hour. */
const EMAILS_PER_ADDRESS = { limit: 3, windowMs: 3600_000 };

/** A sign-up whose name is its password: the name step got the password (mirrored in packages/client errors.ts). */
export const NAME_IS_PASSWORD = "NAME_IS_PASSWORD";
export const NAME_IS_PASSWORD_MESSAGE = "Is this your name? It's the same as the password you typed.";
/** `APIError` code of a sign-up refused because the first account waits for its owner's link or key. */
export const OWNER_CLAIM_REQUIRED = "OWNER_CLAIM_REQUIRED";
/**
 * `APIError` code of a sign-up refused because sign-up is closed, the same for an address invited to early access
 * that came without its link. A provider's callback sends a refusal to `/login?error=` only when it has a code.
 */
export const SIGNUP_CLOSED = "SIGNUP_CLOSED";
/** An early-access link used to sign up another address than the one it was sent to (ADR 0078). */
export const EARLY_ACCESS_OTHER_EMAIL = "EARLY_ACCESS_OTHER_EMAIL";
/** An early-access sign-up through a provider that hasn't confirmed the address (ADR 0078). */
export const EARLY_ACCESS_EMAIL_UNVERIFIED = "EARLY_ACCESS_EMAIL_UNVERIFIED";
/**
 * Better Auth's refusal of a provider sign-in to an address whose password account isn't confirmed yet: it links
 * none, since whoever made that account may not own the address (mirrored in packages/client errors.ts).
 */
export const ACCOUNT_NOT_LINKED = "account_not_linked";
/**
 * Ours for Better Auth's `ACCOUNT_NOT_LINKED` when the account here is confirmed: the provider hasn't confirmed its own
 * address, so it joins no account (`authHandler`, mirrored in packages/client errors.ts).
 */
export const PROVIDER_EMAIL_UNVERIFIED = "provider_email_unverified";

/** Every sign-up but the password form's is through a provider (the redirect's callback, or the phone's id token). */
const isSocial = (context: { path?: string } | null | undefined) => context?.path !== "/sign-up/email";

/**
 * The early-access link's token on a sign-up (ADR 0078): the password form's header, else what the web put in a
 * provider sign-in's state. Untrusted either way, so only the token's shape is kept, and the rule checks the rest.
 */
async function accessOf(context: { headers?: Headers | null } | null | undefined): Promise<string | null> {
  const value =
    context?.headers?.get(EARLY_ACCESS_HEADER) ??
    // Outside a request (the adapter called directly) there is no state to read.
    (await getOAuthState().catch(() => null))?.earlyAccess;
  return typeof value === "string" && EARLY_ACCESS_TOKEN.test(value) ? value : null;
}

/**
 * The confirmation link, landing on `/?email_confirmed=1`, where the web app says how it went
 * (apps/web/src/lib/email-confirmation.ts), whenever the request named no other page: the phone app's sign-up
 * and a new link asked for later name none.
 */
function confirmationLanding(verifyUrl: string): string {
  const url = new URL(verifyUrl);
  const back = url.searchParams.get("callbackURL");
  if (!back || back === "/") url.searchParams.set("callbackURL", "/?email_confirmed=1");
  return url.toString();
}

/** Who may sign up here (ADR 0006; the owner's link or key, ADR 0060 §6). */
export function signupPolicy(config: Config): SignupPolicy {
  return {
    allowSignup: config.ALLOW_SIGNUP,
    ownerByLink: Boolean(config.OWNER_CLAIM_SHA256 || config.OWNER_KEY_SHA256),
    hostComputer: Boolean(config.HOST_COMPUTER_TOKEN),
  };
}

/**
 * Whether anyone may sign up now (`users`: how many accounts exist): the first account unless the owner's link or key
 * makes it, then `ALLOW_SIGNUP` or the operator's live mode (ADR 0078).
 */
export async function signupOpen(db: Database, config: Config, users: number) {
  const policy = signupPolicy(config);
  return users === 0 ? !policy.ownerByLink : signupOpenToAll(db, policy);
}

/** Whether making a workspace needs an account early access allowed (ADR 0078 §4): only on agentes.chat Cloud. */
export const workspacePolicy = (config: Config): WorkspacePolicy => ({
  paidMachines: config.MACHINE_PROVISIONING === "external" && isAgentesCloud(config.PUBLIC_URL),
  allowSignup: config.ALLOW_SIGNUP,
});

/** Sign-in options the login and sign-up pages need to render. */
export function authUiConfig(config: Config) {
  return {
    socialProviders: {
      google: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
      github: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
      apple: appleConfigured(config),
    },
    termsUrl: config.TERMS_URL ?? null,
    privacyUrl: config.PRIVACY_URL ?? null,
    supportEmail: config.SUPPORT_EMAIL ?? null,
    feedback: Boolean(config.FEEDBACK_EMAIL),
  };
}

/** How long the sign-in in "Abrir no celular" (the web app's QR code) lasts. */
const PHONE_SIGN_IN_TTL_MS = 3 * 60_000;
const phoneSignInKey = (token: string) => `phone-sign-in:${sha256(token)}`;
/** A minted sign-in for a user rather than for a session's user (the owner key's, `owner-claim.ts`). */
const FOR_USER = "user:";

/** Single use, a few minutes long, stored as a hash: for the session with this token, or `user:<id>`. */
async function mintSignIn(
  adapter: { createVerificationValue: (v: { identifier: string; value: string; expiresAt: Date }) => Promise<unknown> },
  value: string,
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PHONE_SIGN_IN_TTL_MS);
  await adapter.createVerificationValue({ identifier: phoneSignInKey(token), value, expiresAt });
  return { token, expiresIn: PHONE_SIGN_IN_TTL_MS / 1000 };
}

/**
 * A one-time sign-in for the phone, minted from a signed-in session: void once that session ends
 * (signing out on the web voids a QR code still on screen).
 */
export async function mintPhoneSignIn(auth: Auth, sessionToken: string) {
  const { internalAdapter } = await auth.$context;
  return mintSignIn(internalAdapter, sessionToken);
}

/**
 * A one-time sign-in for an account an approved request made (ADR 0090), traded by the page that asked through
 * `POST /api/auth/sign-in/one-time-token`, as the phone's.
 */
export async function mintUserSignIn(auth: Auth, userId: string) {
  const { internalAdapter } = await auth.$context;
  return mintSignIn(internalAdapter, `${FOR_USER}${userId}`);
}

/** The password hash Better Auth would store for `password` (ADR 0090: a request keeps it until an approval). */
export async function hashPassword(auth: Auth, password: string) {
  const context = await auth.$context;
  return context.password.hash(password);
}

/**
 * A new password in place of the account's own, after a fresh sign-in (ADR 0158 §4: the server's owner after
 * Continue on this Mac, or anyone who just signed in). As a reset does: every other session ends and every AI app
 * and personal token the old password let in is cut off (ADR 0119); the session that asked stays.
 */
export async function replacePassword(auth: Auth, db: Database, userId: string, password: string, keepToken: string) {
  const context = await auth.$context;
  await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
  await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), ne(schema.sessions.token, keepToken)));
  await revokeUserApps(db, userId);
}

/**
 * `POST /api/auth/sign-in/one-time-token { token }`: the phone trades the token for a session of its own.
 * Better Auth's `oneTimeToken` plugin would hand it the browser's session instead, so signing out on one
 * device would sign out the other.
 */
const phoneSignIn = {
  id: "phone-sign-in",
  endpoints: {
    signInOneTimeToken: createAuthEndpoint(
      "/sign-in/one-time-token",
      { method: "POST", body: z.object({ token: z.string().min(1).max(200) }), use: [formCsrfMiddleware] },
      async (ctx) => {
        const { internalAdapter } = ctx.context;
        const minted = await internalAdapter.consumeVerificationValue(phoneSignInKey(ctx.body.token));
        let user: Awaited<ReturnType<typeof internalAdapter.findUserById>> = null;
        let signedIn: Date | undefined;
        if (minted?.value.startsWith(FOR_USER))
          user = await internalAdapter.findUserById(minted.value.slice(FOR_USER.length));
        else if (minted) {
          const from = await internalAdapter.findSession(minted.value);
          if (from && from.session.expiresAt >= new Date()) {
            user = from.user;
            signedIn = from.session.createdAt;
          }
        }
        if (!user) throw new APIError("UNAUTHORIZED", { message: "This code expired or was already used" });
        // Minted from a session, it signed in when that one did: it proves no fresher sign-in (`signedInLately`).
        const session = signedIn
          ? await internalAdapter.createSession(user.id, undefined, { createdAt: signedIn }, true)
          : await internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email } });
      },
    ),
  },
} satisfies BetterAuthPlugin;

/** The phone app's URL scheme (deep links back from social sign-in). */
export const APP_SCHEME = "agenteschat://";
export const APPLE_ORIGIN = "https://appleid.apple.com";
/** Apple accepts a client secret valid for at most 6 months; we sign one per boot for 150 days. */
const APPLE_SECRET_TTL_S = 150 * 24 * 3600;

const appleConfigured = (config: Config) =>
  Boolean(config.APPLE_CLIENT_ID && config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY);

/**
 * "Sign in with Apple" (App Store 4.8), when its four variables are set. The
 * client secret Apple wants is an ES256 JWT signed with the Sign in with
 * Apple key (iss = team, sub = services id, aud = appleid.apple.com).
 * `APPLE_APP_BUNDLE_ID` lets the iOS app sign in natively (its id tokens
 * carry the bundle id as audience).
 */
export function appleSignIn(config: Config, now = Date.now()) {
  if (!appleConfigured(config)) return null;
  const clientId = config.APPLE_CLIENT_ID as string;
  // Several bundle ids (the store's app and its preview builds, for app links): the first, the store's, signs in.
  const [bundle] = listOf(config.APPLE_APP_BUNDLE_ID);
  return {
    clientId,
    clientSecret: appleClientSecret({
      clientId,
      teamId: config.APPLE_TEAM_ID as string,
      keyId: config.APPLE_KEY_ID as string,
      privateKey: config.APPLE_PRIVATE_KEY as string,
      now,
    }),
    ...(bundle ? { appBundleIdentifier: bundle } : {}),
  };
}

/** The ES256 client secret JWT for Apple's token endpoint. */
export function appleClientSecret(input: {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  now?: number;
}): string {
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = `${encode({ alg: "ES256", kid: input.keyId, typ: "JWT" })}.${encode({
    iss: input.teamId,
    iat,
    exp: iat + APPLE_SECRET_TTL_S,
    aud: APPLE_ORIGIN,
    sub: input.clientId,
  })}`;
  // JWS wants the raw r||s signature, not DER.
  const signature = signWithKey("sha256", Buffer.from(signingInput), {
    key: input.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** Revokes one Apple token (best effort; throws on failure, callers swallow it). */
export type AppleTokenRevoker = (token: { value: string; hint: "refresh_token" | "access_token" }) => Promise<void>;

/**
 * Apple's token revocation (required when an account that signed in with
 * Apple is deleted), with the same client secret as sign-in, signed fresh
 * for each call. Null when Sign in with Apple isn't configured. Tests
 * inject a fake instead (`AppExtras.appleRevoke`).
 */
export function appleTokenRevoker(config: Config, http: typeof fetch = fetch): AppleTokenRevoker | null {
  if (!appleConfigured(config)) return null;
  const clientId = config.APPLE_CLIENT_ID as string;
  return async (token) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: appleClientSecret({
        clientId,
        teamId: config.APPLE_TEAM_ID as string,
        keyId: config.APPLE_KEY_ID as string,
        privateKey: config.APPLE_PRIVATE_KEY as string,
      }),
      token: token.value,
      token_type_hint: token.hint,
    });
    const res = await http(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Apple refused the token revocation (${res.status})`);
  };
}
