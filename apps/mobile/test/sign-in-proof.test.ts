import { expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { challengeOf, newVerifier } from "../src/lib/sign-in-proof";

test("the phone's challenge is the one the server computes from its verifier", () => {
  const verifier = newVerifier((n) => new Uint8Array(randomBytes(n)));
  // The shape the server takes: 32 bytes as base64url.
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newVerifier((n) => new Uint8Array(randomBytes(n)))).not.toBe(verifier);
  const challenge = challengeOf(verifier);
  expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
});
