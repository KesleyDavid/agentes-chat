import type { SignInProvider } from "@agenteschat/client";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import i18n from "i18next";
import { SCHEME } from "@/config";
import { prefixOf, serverUrl } from "./server";
import { cookieTo } from "./server-choice";
import { challengeOf, newVerifier } from "./sign-in-proof";

/**
 * Better Auth for the app (ADR 0035 §3): the session cookie lives in SecureStore (Expo plugin), social
 * sign-in goes through the system browser and comes back on `agenteschat://`. Every request says the app's
 * language in `Accept-Language`, as the web's does: an account made here keeps it, and its first emails come in it.
 */
const createClient = (server: string, storagePrefix: string) =>
  createAuthClient({
    baseURL: server,
    basePath: "/api/auth",
    fetchOptions: {
      headers: { "X-Agentes-Client": "mobile" },
      onRequest: (request) => {
        if (i18n.language) request.headers.set("accept-language", i18n.language);
      },
    },
    plugins: [expoClient({ scheme: SCHEME, storagePrefix, storage: SecureStore })],
  });

type AuthClient = ReturnType<typeof createClient>;

/** One client per server, each with its session under its own prefix (ADR 0154): every server stays signed in. */
const clients = new Map<string, AuthClient>();

/** A server's client (the current one's by default). */
export function authClient(server: string = serverUrl()): AuthClient {
  let client = clients.get(server);
  if (!client) {
    client = createClient(server, prefixOf(server));
    clients.set(server, client);
  }
  return client;
}

/**
 * Forgets the stored cookie and session without asking the server, for leaving a server nobody is signed in
 * to: the Expo plugin clears both as a sign-out starts, and this one's request is cancelled before it is sent.
 */
export async function forgetSession(server: string = serverUrl()): Promise<void> {
  const cancelled = new AbortController();
  cancelled.abort();
  await authClient(server)
    .signOut({ fetchOptions: { signal: cancelled.signal } })
    .catch(() => {});
}

/**
 * Trades a one-time sign-in for a session (a connect link's token, the claim of an approved request): false when it
 * was refused (expired or already used) or never reached the server. The session arrives a moment after the answer.
 */
export async function signInOneTime(token: string, server: string = serverUrl()): Promise<boolean> {
  const res = await authClient(server)
    .$fetch("/sign-in/one-time-token", { method: "POST", body: { token } })
    .catch(() => null);
  return Boolean(res && !res.error);
}

/**
 * A provider's sign-in through the system browser. The app keeps a verifier and sends its challenge with the request;
 * the browser comes back with a code in place of the session, and the two together get the session here. A link that
 * brings a code this app didn't ask for signs in nobody, and the code alone is worth nothing to whoever sees the link.
 * A server from before this sends the session in the link itself, as it always did, and has nothing to trade.
 */
export async function signInWithBrowser(
  request: {
    provider: SignInProvider;
    callbackURL: string;
    errorCallbackURL?: string;
    additionalData?: Record<string, unknown>;
  },
  server: string = serverUrl(),
) {
  const client = authClient(server);
  const verifier = newVerifier(getRandomBytes);
  const res = await client.signIn.social({
    ...request,
    additionalData: { ...request.additionalData, challenge: challengeOf(verifier) },
  });
  if (!res.error) await client.$fetch("/phone/redeem", { method: "POST", body: { verifier } }).catch(() => null);
  return res;
}

const cookies = new Map<string, string>();

/** A server's session cookie (the current one's by default), read fresh from SecureStore and kept for the synchronous callers. */
export async function readCookie(server: string = serverUrl()): Promise<string> {
  let cookie = "";
  try {
    cookie = await authClient(server).getCookie();
  } catch {
    cookie = "";
  }
  cookies.set(server, cookie);
  return cookie;
}

/** The last cookie read for a server (the WebSocket factory is synchronous). */
export const lastCookie = (server: string = serverUrl()) => cookies.get(server) ?? "";

/** Headers every app request carries (ADR 0035 §3: no `Origin`, the app header and the cookie). */
export function appHeaders(currentCookie: string): Record<string, string> {
  const headers: Record<string, string> = { "X-Agentes-Client": "mobile" };
  if (currentCookie) headers.Cookie = currentCookie;
  return headers;
}

/**
 * `fetch` with a server's session (the current one's by default): the cookie goes in a header and
 * `credentials: "omit"`, so the platform's own cookie jar never interferes (Better Auth's Expo guide). A session
 * only goes to its own server: an address anywhere else is fetched without it.
 */
export async function authedFetch(
  input: string,
  init: RequestInit = {},
  server: string = serverUrl(),
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = cookieTo(input, server, await readCookie(server));
  for (const [name, value] of Object.entries(appHeaders(cookie))) headers.set(name, value);
  return fetch(input, { ...init, headers, credentials: "omit" });
}
