import { and, desc, type Executor, eq, inArray, isNull, or, schema, sql } from "@agenteschat/db";
import { type AuthorityRun, fedByRoutine, type RunAuthority, runAuthority } from "./authority";
import { caches, cachesEnabled } from "./cache";
import { postedBySql } from "./message-place";

const { agentRuns, agentRunSteps, messages } = schema;

/**
 * A computer brain's own calls that read from outside (`transcript.harnessTried` lines, `callLine`): Claude Code's
 * WebFetch and WebSearch, and a command that starts with curl, wget or gh.
 */
const HARNESS_OUTSIDE = /^(?:WebFetch|WebSearch)\b|^\w+\(\s*(?:curl|wget|gh)\s/;

export type OutsideRun = AuthorityRun;

/** How many of a channel's newest top-level messages count as a top-level run's conversation (`runReadOutside`). */
const CONVERSATION_WINDOW = 30;

/**
 * What a run read before it started, fixed for the run: a routine's reading feeds it, or its conversation relays
 * outside content (a message with `meta.readOutside` that woke it, in its thread, or among the channel's newest
 * top-level messages, which a thread's run reads too).
 */
async function conversationReadOutside(db: Executor, run: OutsideRun, authority?: RunAuthority): Promise<boolean> {
  if (fedByRoutine(authority ?? (await runAuthority(db, run)))) return true;
  const [trigger] = await db
    .select({
      meta: messages.meta,
      threadId: messages.threadId,
      channelId: messages.channelId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.orgId, run.orgId), eq(messages.id, run.triggerMessageId)));
  if (!trigger) return false;
  if (trigger.meta.readOutside === true) return true;
  const topLevel = inArray(
    messages.id,
    db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.orgId, run.orgId),
          eq(messages.channelId, trigger.channelId),
          isNull(messages.threadId),
          // What its context reads (`buildRunContext`).
          postedBySql(messages, { createdAt: trigger.createdAt, id: run.triggerMessageId }),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(CONVERSATION_WINDOW),
  );
  const inConversation = trigger.threadId
    ? or(eq(messages.id, trigger.threadId), eq(messages.threadId, trigger.threadId), topLevel)
    : topLevel;
  const [marked] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, run.orgId),
        eq(messages.channelId, trigger.channelId),
        isNull(messages.deletedAt),
        sql`${messages.meta}->>'readOutside' = 'true'`,
        inConversation,
      ),
    )
    .limit(1);
  return Boolean(marked);
}

/** Per run, once: what `conversationReadOutside` found (a run's conversation before it is fixed). */
export interface OutsideMemo {
  conversation?: boolean;
}

/**
 * Whether a run read content from outside the org (ADR 0117): its computer brain fetched the web itself, one of its
 * tool results came from outside (the gateway's `outside` mark), or its conversation already relays outside content
 * (`conversationReadOutside`). What such a run posts carries `meta.readOutside`, so the next agent reads it as
 * relayed and memory built from it stays low trust. It never stops, asks or refuses anything by itself. Once true it
 * stays true, so it is remembered per run (`caches.readOutsideRuns`); `memo` keeps the conversation's answer for the
 * rest of a run.
 */
export async function runReadOutside(
  db: Executor,
  run: OutsideRun,
  authority?: RunAuthority,
  memo: OutsideMemo = {},
): Promise<boolean> {
  const key = `${run.orgId}:${run.id}`;
  if (caches.readOutsideRuns.get(key)) return true;
  let read = await readOutsideItself(db, run);
  if (!read) {
    memo.conversation ??= await conversationReadOutside(db, run, authority);
    read = memo.conversation;
  }
  if (read && cachesEnabled()) caches.readOutsideRuns.set(key, true);
  return read;
}

/** What the run read with its own calls, its conversation aside. */
async function readOutsideItself(db: Executor, run: OutsideRun): Promise<boolean> {
  const tried = run.transcript?.harnessTried;
  return (
    (Array.isArray(tried) && tried.some((l) => typeof l === "string" && HARNESS_OUTSIDE.test(l))) ||
    stepReadOutside(db, run)
  );
}

async function stepReadOutside(db: Executor, run: OutsideRun): Promise<boolean> {
  const [step] = await db
    .select({ id: agentRunSteps.id })
    .from(agentRunSteps)
    .where(
      and(
        eq(agentRunSteps.runId, run.id),
        eq(agentRunSteps.kind, "tool_result"),
        sql`${agentRunSteps.data}->'data'->>'outside' = 'true'`,
      ),
    )
    .limit(1);
  return Boolean(step);
}

/** `readOutsideItself` by the tool context's run id: unlike `runReadOutside`, a person's new message starts clean. */
export async function runItselfReadOutside(db: Executor, orgId: string, runId: string): Promise<boolean> {
  const run = await outsideRun(db, orgId, runId);
  return run ? readOutsideItself(db, run) : false;
}

/**
 * What this turn brought in: its own calls (`readOutsideItself`) or a routine's reading that feeds it, without what
 * the conversation relayed before it. A rule a person writes in the message the run answers weighs only this (ADR
 * 0120, addendum 2026-11-11): one relayed message among the newest would refuse every rule they give, however often
 * they repeat it.
 */
export async function turnReadOutsideById(db: Executor, orgId: string, runId: string): Promise<boolean> {
  const run = await outsideRun(db, orgId, runId);
  if (!run) return false;
  return (await readOutsideItself(db, run)) || fedByRoutine(await runAuthority(db, run));
}

/** `runReadOutside` by the tool context's run id (false when the run is gone). */
export async function runReadOutsideById(db: Executor, orgId: string, runId: string): Promise<boolean> {
  const run = await outsideRun(db, orgId, runId);
  return run ? runReadOutside(db, run) : false;
}

async function outsideRun(db: Executor, orgId: string, runId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await db
    .select({
      id: agentRuns.id,
      orgId: agentRuns.orgId,
      triggerMessageId: agentRuns.triggerMessageId,
      background: agentRuns.background,
      transcript: agentRuns.transcript,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.id, runId)));
  return run ?? null;
}

/** The refusal code of a remembered rule naming an address no person wrote (`remember`). */
export const UNASKED_DESTINATION = "memory.unasked_destination";

/** How many of a conversation's newest person messages `personWords` reads. */
const PERSON_WORDS_LIMIT = 200;

/**
 * What people wrote in a conversation (its thread and the channel's top level), newest first, joined: an address,
 * handle or credential found here was written by a person, not read from outside. A person's message marked
 * `meta.readOutside` (sent through an AI app, ADR 0119) is left out.
 */
export async function personWords(
  db: Executor,
  orgId: string,
  channelId: string,
  threadId: string | null,
): Promise<string> {
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.orgId, orgId),
        eq(messages.channelId, channelId),
        eq(messages.authorType, "person"),
        isNull(messages.deletedAt),
        sql`coalesce(${messages.meta}->>'readOutside', '') <> 'true'`,
        threadId
          ? or(isNull(messages.threadId), eq(messages.id, threadId), eq(messages.threadId, threadId))
          : isNull(messages.threadId),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(PERSON_WORDS_LIMIT);
  return rows.map((r) => r.body).join("\n");
}

/** Defanged forms (`hxxps://evil[.]io`, `ana[at]x.io`) read as what they stand for. */
const refang = (text: string) =>
  text
    .replace(/\bhxxp(s?):\/\//gi, "http$1://")
    .replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/gi, ".")
    .replace(/\s*[[({]\s*at\s*[\])}]\s*/gi, "@");

const SCHEME_HOST = /\b(?:https?|ftp|wss?):\/\/(?:[^\s/@]*@)?(\[[0-9a-f:.]+\]|[^\s/:?#[\]]+)/giu;
const BARE_HOST =
  /(?<![\p{L}\p{N}@._-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(\p{L}{2,63}))(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/gu;
const IPV4 = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g;
const EMAIL = /[\p{L}\p{N}._%+-]+@((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,63})/giu;
const HANDLE = /(?<![\w.@])@([a-z0-9_][\w-]*)/gi;
/** A phone: a leading + or digit groups ending in four digits; never a date or a bare id. */
const PHONE = /(?<![\w+])(?:\+\d[\d\s().-]{6,}\d|\(?\d{2,4}\)?[\s.-]?\d{3,5}[\s.-]\d{4})(?![\w])/g;
const digits = (s: string) => s.replace(/\D/g, "");

/** Generic TLDs counted for a bare host (no scheme); any two-letter one counts too unless it is a file extension. */
const TLDS = new Set(
  "com net org io ai app dev co me info biz xyz site online tech store cloud link click top club live pro page email digital agency tools zone world space fun shop news blog today life website host run gov edu".split(
    " ",
  ),
);
const FILE_EXTENSIONS = new Set("js ts md py sh rb go rs cs db gz pl ps hs ml so el mk cc hh am in".split(" "));
const isTld = (tld: string) => {
  const t = tld.toLowerCase();
  return TLDS.has(t) || (/^[a-z]{2}$/.test(t) && !FILE_EXTENSIONS.has(t));
};

/**
 * Every host in `text` (a URL's, a bare domain with a known TLD, an IPv4 address), lowercased, without a trailing
 * dot. `anyTld`: a bare domain with any TLD counts (what a person wrote: reading more there only lets more through).
 */
function hostsIn(text: string, anyTld = false): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SCHEME_HOST)) out.push(m[1] ?? "");
  for (const m of text.replace(EMAIL, " ").matchAll(BARE_HOST)) if (anyTld || isTld(m[2] ?? "")) out.push(m[1] ?? "");
  for (const m of text.matchAll(IPV4)) out.push(m[0]);
  return out.map((h) => h.toLowerCase().replace(/\.$/, "")).filter(Boolean);
}

/**
 * The first address in `text` (a URL's host, a bare domain, an IP address, an email address, an @handle, a phone
 * number) that no person wrote in `words` (`personWords`), or null. Hosts and emails compare whole, without case; a
 * host counts as written when a person wrote it or a domain it belongs to, an email when a person wrote it or its
 * domain; a handle when a person wrote the name; a phone by its digits (a country code may be left out).
 */
export function unaskedDestination(text: string, words: string): string | null {
  const rule = refang(text);
  const said = refang(words);
  const saidHosts = new Set([
    ...hostsIn(said, true),
    ...[...said.matchAll(EMAIL)].map((m) => (m[1] ?? "").toLowerCase()),
  ]);
  const hostSaid = (host: string) => [...saidHosts].some((h) => host === h || host.endsWith(`.${h}`));
  const saidEmails = new Set([...said.matchAll(EMAIL)].map((m) => m[0].toLowerCase()));
  for (const m of rule.matchAll(EMAIL)) {
    if (!saidEmails.has(m[0].toLowerCase()) && !hostSaid((m[1] ?? "").toLowerCase())) return m[0];
  }
  for (const host of hostsIn(rule)) if (!hostSaid(host)) return host;
  const noEmails = rule.replace(EMAIL, " ");
  const saidNames = new Set(said.toLowerCase().split(/[^\w-]+/));
  for (const m of noEmails.matchAll(HANDLE)) if (!saidNames.has((m[1] ?? "").toLowerCase())) return m[0];
  const saidPhones = [...said.matchAll(PHONE)].map((m) => digits(m[0]));
  for (const m of noEmails.matchAll(PHONE)) {
    const d = digits(m[0]);
    if (d.length >= 8 && !saidPhones.some((p) => p.length >= 8 && (d.endsWith(p) || p.endsWith(d)))) return m[0].trim();
  }
  return null;
}
