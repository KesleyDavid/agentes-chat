import { SKILL_LIMITS } from "@agenteschat/engine";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { MULTIPART_PATHS } from "../routes/app/context";
import { apiError } from "./errors";

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * The most an `/api/*` request may send unless its path says otherwise below. Above the largest thing the apps send
 * as plain JSON (a table of `ARTIFACT_LIMITS.tableBytes`), so no route has to ask for it.
 */
export const API_BODY_BYTES = 8 * MIB;

/**
 * Routes that cap their own body: the uploads and imports with their own answer when it is too large, the webhooks
 * and a computer's upload, which count the bytes as they read them, and the git proxy, which passes a push through
 * without holding it.
 */
const OWN_LIMIT = [
  ...MULTIPART_PATHS,
  /\/organizations\/[^/]+\/imports$/,
  /\/organizations\/[^/]+\/vault\/import$/,
  /^\/api\/machines\/uploads\//,
  /^\/api\/webhooks\//,
  /^\/api\/hooks\//,
  /^\/api\/github-app\/webhook$/,
  /^\/api\/git\//,
];

/** A skill's folder as a base64 zip: what the import's own schema accepts, and the fields around it. */
const SKILL_ZIP_BYTES = Math.ceil(((SKILL_LIMITS.maxBytes + SKILL_LIMITS.assetBytes) * 4) / 3) + 2 * MIB;

/**
 * Paths with a limit of their own, first match wins, and before the routes that cap themselves: nothing under
 * `/api/auth/` is left without a limit by how its path ends. A new route with a large JSON body gets a line here.
 */
const LIMITS: [RegExp, number][] = [
  // Signing in and up: read before anyone is known, and never more than a few fields.
  [/^\/api\/auth\//, 256 * KIB],
  [/\/organizations\/[^/]+\/skills\/import$/, SKILL_ZIP_BYTES],
  // A batch of notes: the web app keeps one under 8 Mi characters of JSON, and a character is up to 3 bytes on the wire.
  [/\/organizations\/[^/]+\/wiki\/import$/, 32 * MIB],
];

/** The most a request to `path` may send, or null where the route caps it itself. */
export function apiBodyMax(path: string): number | null {
  const own = LIMITS.find(([p]) => p.test(path))?.[1];
  if (own !== undefined) return own;
  return OWN_LIMIT.some((p) => p.test(path)) ? null : API_BODY_BYTES;
}

const tooLarge = (c: Context) => apiError(c, 413, "too_large", "The request is too large");
const limiters = new Map<number, ReturnType<typeof bodyLimit>>();
const limiter = (maxSize: number) => {
  const made = limiters.get(maxSize) ?? bodyLimit({ maxSize, onError: tooLarge });
  limiters.set(maxSize, made);
  return made;
};

/**
 * Refuses a body past its path's limit before any route reads it: without it a request nobody signed could make the
 * server hold as much as the HTTP server accepts.
 */
export const apiBodyLimit = createMiddleware((c, next) => {
  const max = apiBodyMax(c.req.path);
  return max === null ? next() : limiter(max)(c, next);
});
