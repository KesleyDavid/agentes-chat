import { base64url } from "@agenteschat/client/lib/base64url";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * What ties a sign-in through the browser to the app that started it (ADR 0035, addendum 2026-11-11): the app keeps
 * the verifier and sends only its SHA-256 with the request; the browser brings back a code that signs in nobody
 * without the verifier. Pure: `random` gives secure random bytes (the app's is `expo-crypto`).
 */
export const newVerifier = (random: (n: number) => Uint8Array) => base64url(random(32));

/** The verifier's SHA-256 (base64url), as the server computes it. */
export const challengeOf = (verifier: string) => base64url(sha256(new TextEncoder().encode(verifier)));
