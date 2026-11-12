import { randomUUID } from "expo-crypto";
import { useSyncExternalStore } from "react";
import { API_URL, APP_VARIANT, STORAGE_PREFIX } from "@/config";
import {
  claimedPrefixes,
  currentServer,
  perServerName,
  prefixesFrom,
  savedServer,
  serverListFrom,
  serverToReturn,
  withoutServer,
  withPrefix,
  withServer,
} from "./server-choice";
import { readValueSync, STORED, writeValue, writeValueSync } from "./storage";

/** Not in `STORED`: signing out of a server doesn't leave it. */
const SERVER = "server";
/** The servers this phone is signed in to (JSON list, ADR 0154). */
const SIGNED_IN = "servers";
/** Each server's session prefix (JSON by server, ADR 0154). */
const PREFIXES = "session-prefixes";

/** Development builds may use http, on localhost or the local network only. */
export const ALLOW_HTTP = APP_VARIANT === "development";

let server = currentServer(readValueSync(SERVER), API_URL);
const listeners = new Set<() => void>();

/** The server the app talks to, read at call time: it changes while the app runs. */
export const serverUrl = () => server;

/** The server, for what must follow a change (the providers). */
export function useServer() {
  return useSyncExternalStore(subscribe, serverUrl);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server the app was on before the last change: where the sign-in of a newly added one goes back to. */
let came: string | null = null;

/** Points the app at `next`. Every server stays signed in (ADR 0154): its session waits under its own prefix. */
export async function setServer(next: string) {
  if (next !== server) came = server;
  server = next;
  await writeValue(SERVER, savedServer(next, API_URL));
  for (const listener of listeners) listener();
}

// ── Sessions per server (ADR 0154) ──────────────────────────────────────────────

let signedIn = serverListFrom(readValueSync(SIGNED_IN));

const rawPrefixes = readValueSync(PREFIXES);
let prefixes = claimedPrefixes(prefixesFrom(rawPrefixes, server, STORAGE_PREFIX), signedIn, STORAGE_PREFIX);
if (JSON.stringify(prefixes) !== rawPrefixes) writeValueSync(PREFIXES, JSON.stringify(prefixes));

/**
 * Where a server's session (cookie and cached session) is stored. A server met for the first time gets a random
 * prefix (`withPrefix`), saved as its own before anything is stored under it.
 */
export function prefixOf(target: string): string {
  const saved = prefixes[target];
  if (saved) return saved;
  prefixes = withPrefix(prefixes, target, STORAGE_PREFIX, randomUUID);
  writeValueSync(PREFIXES, JSON.stringify(prefixes));
  return prefixes[target] ?? "";
}

/** The name a per-server value is remembered under (`perServerName`). */
export const perServer = (name: string, target: string) => perServerName(name, prefixOf(target), STORAGE_PREFIX);

/** The remembered workspace on a server. */
export const orgValueName = (target: string) => perServer(STORED.org, target);

const signedInListeners = new Set<() => void>();

/** The servers this phone is signed in to, in the order they were added. */
export const signedInServers = () => signedIn;

/** The servers signed in to, for screens that list them (Workspaces). */
export function useSignedInServers() {
  return useSyncExternalStore((listener) => {
    signedInListeners.add(listener);
    return () => {
      signedInListeners.delete(listener);
    };
  }, signedInServers);
}

function saveSignedIn(next: string[]) {
  if (next.length === signedIn.length && next.every((s, i) => s === signedIn[i])) return;
  signedIn = next;
  writeValueSync(SIGNED_IN, JSON.stringify(next));
  for (const listener of signedInListeners) listener();
}

/** A session arrived on `target` (signing in, or an older install's saved one read at launch). */
export const markSignedIn = (target: string) => saveSignedIn(withServer(signedIn, target));

/** Signed out of `target`: off the list. */
export const markSignedOut = (target: string) => saveSignedIn(withoutServer(signedIn, target));

/**
 * Where the sign-in screen's back and "Voltar para …" go: the server the app came from while still signed in there,
 * else another one signed in to; null on a first sign-in.
 */
export function useServerToReturn() {
  return serverToReturn(useSignedInServers(), useServer(), came);
}
