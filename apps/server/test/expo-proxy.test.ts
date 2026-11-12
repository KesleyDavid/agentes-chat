import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { setSignupMode } from "@agenteschat/engine";
import { desktopChallenge } from "../src/desktop-sign-in";
import { phoneFlowStarted } from "../src/phone-browser-sign-in";
import { type Browser, browser, createTestServer, fakeGoogle, ORIGIN, signUp, type TestServer } from "./harness";

/**
 * The phone app's provider sign-in through the system browser (ADR 0035): the app starts it, the browser goes
 * through the Expo plugin's proxy to the provider and back to the callback, and the link that closes the browser
 * brings the app what it trades for its session.
 */

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer({
    env: {
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_CLIENT_ID: "github-client",
      GITHUB_CLIENT_SECRET: "github-secret",
    },
  });
});
afterEach(() => t.close());

/** What the app's requests carry (no `Origin`, the app header, the Expo plugin's `expo-origin`). */
const PHONE = { origin: null, headers: { "expo-origin": "agenteschat://", "x-agentes-client": "mobile" } };
const APP = "agenteschat:///";

const pair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: desktopChallenge(verifier) };
};

/** A sign-in the phone app starts: the provider's address its browser opens through the proxy. */
async function phoneStart(
  provider: "google" | "github",
  challenge?: string,
  more: Record<string, string> = {},
  at: Browser = browser(t),
) {
  const body = { provider, callbackURL: APP, ...more, ...(challenge ? { additionalData: { challenge } } : {}) };
  const res = await at("/api/auth/sign-in/social", { json: body, ...PHONE });
  expect(res.status).toBe(200);
  return ((await res.json()) as { url: string }).url;
}

const proxy = (at: Browser, authorizationURL: string) =>
  at(`/api/auth/expo-authorization-proxy?${new URLSearchParams({ authorizationURL })}`, { origin: null });

/** The provider sends `at` back to the callback, having signed `email` in. */
async function callback(at: Browser, authorizationURL: string, email: string) {
  const state = new URL(authorizationURL).searchParams.get("state") ?? "";
  const real = globalThis.fetch;
  globalThis.fetch = fakeGoogle(email);
  try {
    return await at(`/api/auth/callback/google?code=c0de&state=${state}`, { origin: null });
  } finally {
    globalThis.fetch = real;
  }
}

const changed = (authorizationURL: string, params: Record<string, string>) => {
  const url = new URL(authorizationURL);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
};

/** What the link back to the app carries in `cookie`, as `name=value` pairs. */
const brought = (res: Response) => new URL(res.headers.get("location") ?? "").searchParams.get("cookie") ?? "";

/** The app trading what the link brought, with its verifier. */
const redeem = (app: Browser, verifier: string, cookie?: string) =>
  app("/api/auth/phone/redeem", {
    json: { verifier },
    origin: null,
    headers: { ...PHONE.headers, ...(cookie ? { cookie } : {}) },
  });

const email = async (at: Browser) =>
  ((await (await at("/api/app/me", PHONE)).json()) as { user?: { email?: string } }).user?.email;

test("the phone's sign-in proxy goes on to a configured provider, for our client and our callback", async () => {
  const google = await phoneStart("google");
  expect(new URL(google).searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
  const res = await proxy(browser(t), google);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(google);
  expect((await proxy(browser(t), await phoneStart("github"))).status).toBe(302);
});

test("anywhere else is refused, and no state cookie is set", async () => {
  const google = await phoneStart("google");
  const state = new URL(google).searchParams.get("state") ?? "";
  const refused = [
    // Another site: an open redirect on our domain, and a state cookie of someone else's choosing.
    `https://evil.example/?state=${state}`,
    // The provider, but someone else's app or callback (it would send the person, or the code, elsewhere).
    changed(google, { client_id: "other-client" }),
    changed(google, { redirect_uri: "https://evil.example/callback" }),
    `${google}&client_id=other-client`,
    // A provider that isn't configured here.
    `https://appleid.apple.com/auth/authorize?client_id=x&redirect_uri=x&state=${state}`,
    `https://accounts.google.com.evil.example/o/oauth2/v2/auth?state=${state}`,
    // The provider, for a sign-in nobody started.
    changed(google, { state: "made-up-state" }),
  ];
  for (const url of refused) {
    const res = await proxy(browser(t), url);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.getSetCookie().some((c) => c.includes("state="))).toBe(false);
  }
});

test("a sign-in started on the web is never moved into another browser through the proxy", async () => {
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await setSignupMode(t.db, "open");

  // Someone starts an ordinary web sign-in, finishes it at the provider as themselves and keeps the way back unopened.
  const start = await browser(t)("/api/auth/sign-in/social", { json: { provider: "google", callbackURL: "/" } });
  const theirs = ((await start.json()) as { url: string }).url;

  // Ana's browser is sent to the proxy with it, then to that way back.
  const res = await proxy(ana, theirs);
  expect(res.status).toBe(400);
  expect(res.headers.getSetCookie().some((c) => c.includes("state="))).toBe(false);
  const back = await callback(ana, theirs, "bia@example.com");
  expect(back.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);
  expect(await email(ana)).toBe("ana@example.com");
});

test("a sign-in that names a web address for a first-time account is not a phone's: refused, and no session in the browser", async () => {
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await setSignupMode(t.db, "open");

  const webWaysBack: Record<string, string>[] = [{ newUserCallbackURL: "/" }, { errorCallbackURL: "/" }];
  for (const more of webWaysBack) {
    const res = await proxy(ana, await phoneStart("google", pair().challenge, more));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.includes("state="))).toBe(false);
  }
  // The app's own links for both go on.
  const whole = await phoneStart("google", undefined, { newUserCallbackURL: APP, errorCallbackURL: APP });
  expect((await proxy(browser(t), whole)).status).toBe(302);

  // Its callback, in the one browser that holds its state without the proxy (the one that started it), ends at the
  // web address for a first-time account and still leaves no session there.
  const starter = browser(t);
  const own = await phoneStart("google", undefined, { newUserCallbackURL: "/" }, starter);
  const back = await callback(starter, own, "bia@example.com");
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/");
  expect(back.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);
  expect((await starter("/api/app/me")).status).toBe(401);
});

test("an app from before the challenge: the session comes back in the link, and the browser keeps none", async () => {
  const ana = browser(t);
  await signUp(ana, "ana@example.com");
  await setSignupMode(t.db, "open");

  // Started by someone else's app and finished in Ana's browser: her browser stays hers.
  const theirs = await phoneStart("google");
  expect((await proxy(ana, theirs)).status).toBe(302);
  const back = await callback(ana, theirs, "bia@example.com");
  expect(back.status).toBe(302);
  expect(back.headers.get("location")?.startsWith(APP)).toBe(true);
  expect(back.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);
  expect(await email(ana)).toBe("ana@example.com");

  // The app that started it still gets its session from the link.
  expect(brought(back)).toContain("session_token");

  // Once those builds are retired, the proxy takes only a sign-in that carries a challenge.
  const context = await t.auth.$context;
  const old = await phoneStart("google");
  const bound = await phoneStart("google", pair().challenge);
  expect(await phoneFlowStarted(context, old)).toBe(true);
  expect(await phoneFlowStarted(context, old, false)).toBe(false);
  expect(await phoneFlowStarted(context, bound, false)).toBe(true);
});

test("with a challenge: the link brings a code, and only the code with the app's verifier gets the session, once", async () => {
  await signUp(browser(t), "owner@example.com");
  await setSignupMode(t.db, "open");

  const signIn = async () => {
    const { verifier, challenge } = pair();
    const url = await phoneStart("google", challenge);
    const system = browser(t);
    expect((await proxy(system, url)).status).toBe(302);
    const back = await callback(system, url, "ana@example.com");
    expect(back.status).toBe(302);
    expect(back.headers.get("location")?.startsWith(APP)).toBe(true);
    // No session in the browser, none in the link: only the code.
    expect(back.headers.getSetCookie()).toEqual([]);
    expect((await system("/api/app/me")).status).toBe(401);
    const code = brought(back).split(";")[0] ?? "";
    expect(code).toMatch(/phone_code=[A-Za-z0-9_-]{43}$/);
    expect(brought(back)).not.toContain("session_token");
    return { verifier, code };
  };
  const signedIn = async (res: Response) => ((await res.json()) as { signedIn: boolean }).signedIn;

  // The code with someone else's verifier signs in nobody, and is spent.
  const first = await signIn();
  expect(await signedIn(await redeem(browser(t), pair().verifier, first.code))).toBe(false);
  expect(await signedIn(await redeem(browser(t), first.verifier, first.code))).toBe(false);

  // The verifier without the code (whoever started a sign-in that someone else finished) signs in nobody.
  const second = await signIn();
  const other = browser(t);
  expect(await signedIn(await redeem(other, second.verifier))).toBe(false);
  expect((await other("/api/app/me", PHONE)).status).toBe(401);

  // Both together: the app's session, once.
  const app = browser(t);
  expect(await signedIn(await redeem(app, second.verifier, second.code))).toBe(true);
  expect(await email(app)).toBe("ana@example.com");
  expect(await signedIn(await redeem(browser(t), second.verifier, second.code))).toBe(false);
});
