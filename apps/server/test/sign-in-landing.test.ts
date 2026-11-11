import { afterEach, describe, expect, test } from "bun:test";
import { ConflictError, ForbiddenError, NotFoundError } from "@agenteschat/engine";
import { oauthFailure } from "../src/routes/app/context";
import { createTestServer, ORIGIN, type TestServer } from "./harness";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("a sign-in that didn't finish lands on the sign-in page, which says why", () => {
  test("Better Auth's error landing goes to /login with the code, never its own page nor a silent /?error=", async () => {
    t = await createTestServer();
    const res = await t.app.request("/api/auth/error?error=state_mismatch");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=state_mismatch`);
    // A provider's callback that fails before its state is read lands there straight away.
    const callback = await t.app.request("/api/auth/callback/github?state=forged&code=x");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toStartWith(`${ORIGIN}/login?error=`);
  });

  test("a browser's own navigation that failed on our side lands on server_error; what the app asked keeps its 500", async () => {
    t = await createTestServer();
    t.auth.handler = async () => new Response("boom", { status: 500 });
    const navigate = { "sec-fetch-mode": "navigate" };
    const landed = await t.app.request("/api/auth/callback/google?state=s&code=c", { headers: navigate });
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location")).toBe(`${ORIGIN}/login?error=server_error`);
    // The app's own requests, and a POST, read the answer themselves.
    expect((await t.app.request("/api/auth/get-session", { headers: { "sec-fetch-mode": "cors" } })).status).toBe(500);
    const posted = await t.app.request("/api/auth/sign-in/email", { method: "POST", headers: navigate });
    expect(posted.status).toBe(500);
    // A refusal below 500 is Better Auth's to say.
    t.auth.handler = async () => new Response(null, { status: 404 });
    expect((await t.app.request("/api/auth/nothing", { headers: navigate })).status).toBe(404);
  });
});

test("a provider's return that didn't connect is said by a code of what happened, never the error's words", () => {
  expect(oauthFailure(new ConflictError("This install link is invalid or expired", "oauth.link_expired"))).toBe(
    "expired",
  );
  expect(oauthFailure(new ConflictError("This install link was already used", "oauth.link_used"))).toBe("used");
  expect(oauthFailure(new ForbiddenError("Finish installing with…", "oauth.other_account"))).toBe("other_account");
  expect(oauthFailure(new ForbiddenError("Not visible", "github_app.not_visible"))).toBe("not_visible");
  expect(oauthFailure(new ForbiddenError("Owners only", "github_app.owner_required"))).toBe("owner_required");
  expect(oauthFailure(new ForbiddenError("GitHub didn't say", "github_app.owner_unknown"))).toBe("owner_unknown");
  expect(oauthFailure(new ForbiddenError())).toBe("not_allowed");
  expect(oauthFailure(new NotFoundError("Organization not found"))).toBe("failed");
  expect(oauthFailure(new TypeError("fetch failed"))).toBe("failed");
  expect(oauthFailure(null)).toBe("failed");
});
