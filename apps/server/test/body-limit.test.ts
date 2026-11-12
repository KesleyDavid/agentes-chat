import { afterEach, describe, expect, test } from "bun:test";
import { ARTIFACT_LIMITS, IMPORT_LIMITS } from "@agenteschat/engine";
import { API_BODY_BYTES, apiBodyMax } from "../src/http/body-limit";
import { createTestServer, ORIGIN, type TestServer } from "./harness";

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const post = (path: string, type: string, body: string) =>
  (t as TestServer).app.request(path, {
    method: "POST",
    headers: { "content-type": type, "content-length": String(body.length), origin: ORIGIN },
    body,
  });
const FORM = "application/x-www-form-urlencoded";
const JSON_TYPE = "application/json";

describe("a request body past its path's limit is refused before any route reads it", () => {
  test("the token and revocation forms take 64 KiB", async () => {
    t = await createTestServer();
    const big = "x".repeat(2_000_000);
    expect((await post("/api/oauth/revoke", FORM, `token=${big}`)).status).toBe(413);
    expect((await post("/api/oauth/revoke", JSON_TYPE, JSON.stringify({ token: big }))).status).toBe(413);
    expect((await post("/api/oauth/token", FORM, `grant_type=authorization_code&code=${big}`)).status).toBe(413);
    // What a client really sends still gets its own answer.
    expect((await post("/api/oauth/revoke", FORM, "token=nothing")).status).toBe(200);
    expect((await post("/api/oauth/token", FORM, "grant_type=authorization_code&code=nothing")).status).not.toBe(413);
  });

  test("signing in takes 256 KiB", async () => {
    t = await createTestServer();
    const body = (password: string) => JSON.stringify({ email: "ana@example.com", password });
    const refused = await post("/api/auth/sign-in/email", JSON_TYPE, body("x".repeat(2_000_000)));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "too_large" } });
    expect((await post("/api/auth/sign-in/email", JSON_TYPE, body("not-her-password"))).status).not.toBe(413);
  });

  test("any other route takes 8 MiB, signed in or not", async () => {
    t = await createTestServer();
    const body = (size: number) => JSON.stringify({ email: "ana@example.com", pad: "x".repeat(size) });
    const refused = await post("/api/app/invitations/none/code", JSON_TYPE, body(API_BODY_BYTES));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toMatchObject({ error: { code: "too_large" } });
    // A table as large as the Drive keeps is under it.
    const fits = await post("/api/app/invitations/none/code", JSON_TYPE, body(ARTIFACT_LIMITS.tableBytes));
    expect(fits.status).not.toBe(413);
  });

  test("large uploads keep the limits their own routes set", () => {
    const org = "/api/app/organizations/org_1";
    expect(apiBodyMax(`${org}/channels`)).toBe(API_BODY_BYTES);
    expect(apiBodyMax("/api/auth/sign-up/email")).toBe(256 * 1024);
    // Read as they arrive, each against its own size.
    for (const path of [
      `${org}/artifacts/files`,
      `${org}/artifacts/art_1/files`,
      `${org}/imports`,
      `${org}/imports/files`,
      `${org}/vault/import`,
      `${org}/channels/ch_1/voice`,
      "/api/app/feedback/files",
      "/api/machines/uploads/3f2b8c1e-0000-4000-8000-000000000000",
      "/api/webhooks/composio",
      "/api/webhooks/github/ep_1",
      "/api/hooks/token",
      "/api/github-app/webhook",
      "/api/git/org_1/conn_1/acme/site.git/git-receive-pack",
    ])
      expect(apiBodyMax(path)).toBeNull();
    // Raised for the JSON that carries a whole folder.
    expect(apiBodyMax(`${org}/skills/import`)).toBeGreaterThan(IMPORT_LIMITS.bodyBytes);
    // The web app's batch is 8 Mi characters, each up to 3 bytes.
    expect(apiBodyMax(`${org}/wiki/import`)).toBeGreaterThanOrEqual(3 * 8 * 1024 * 1024);
    // Signing in keeps its limit whatever the path ends with.
    expect(apiBodyMax("/api/auth/x/feedback/files")).toBe(256 * 1024);
    expect(apiBodyMax("/api/auth/x/organizations/y/imports")).toBe(256 * 1024);
  });
});
