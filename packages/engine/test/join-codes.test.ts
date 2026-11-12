import { afterEach, describe, expect, test } from "bun:test";
import { createFakeEmailSender, createMemoryRateLimiter, type EmailSender } from "@agenteschat/adapters";
import { eq, inArray, schema } from "@agenteschat/db";
import {
  approveJoinRequest,
  askToJoin,
  checkJoinCode,
  createJobHandlers,
  createOrganization,
  deleteAccount,
  denyJoinRequest,
  drainOutbox,
  type EmailTemplate,
  inviteLink,
  listWaitingJoinRequests,
  MAX_PENDING_JOIN_REQUESTS,
  mailboxOf,
  pruneJoinRequests,
  purgeWorkspace,
  queueEmail,
  sendJoinCode,
  sha256,
} from "../src";
import { addMember, type Fixture, SECRET, setup } from "./fixtures";

let f: Fixture | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});

const PUBLIC = "https://agentes.test";
const NOW = new Date("2026-10-27T10:00:00.000Z");
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

let limiter = createMemoryRateLimiter();

async function start() {
  f = await setup();
  limiter = createMemoryRateLimiter();
  return (await inviteLink(f.db, SECRET, f.owner.id, f.org.id, NOW)).token;
}
const fx = () => f as Fixture;
const deps = () => ({ db: fx().db, pubsub: fx().pubsub, rateLimiter: limiter });

const codeEmails = async () =>
  (await fx().db.select().from(schema.outbox).where(eq(schema.outbox.kind, "email.send")).orderBy(schema.outbox.id))
    .map((r) => r.payload as { key: string; to: string[]; template: EmailTemplate })
    .flatMap((p) => (p.template.kind === "join_code" ? [{ to: p.to, ...p.template }] : []));
/** A code to `email` from the link's page, signed out; the digits its email carries. */
async function send(token: string, email: string, now = NOW) {
  await sendJoinCode(deps(), PUBLIC, { token, user: null, email, locale: "en" }, now);
  return (await codeEmails()).at(-1)?.code ?? "";
}
const check = (token: string, email: string, code: string, now = NOW) =>
  checkJoinCode(deps(), { token, user: null, email, code }, now);
const ask = (token: string, input: { email: string; code?: string; name?: string; note?: string }, now = NOW) =>
  askToJoin(deps(), PUBLIC, { token, user: null, name: "Felipe Ramos", proofNeeded: true, ...input }, now);
/** Another code than `code`. */
const other = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
const codeRows = () => fx().db.select().from(schema.organizationJoinCodes);
const requestRows = () => fx().db.select().from(schema.organizationJoinRequests);
async function person(id: string, email: string, verified: boolean) {
  await fx()
    .db.insert(schema.users)
    .values({ id, name: `${id} Lima`, email, emailVerified: verified });
  return { id };
}

describe("a code proves the address", () => {
  test("only its hash is kept, its email carries it, and a new one a minute later replaces it", async () => {
    const token = await start();
    const first = await send(token, " Felipe@Example.com ");
    expect(first).toMatch(/^\d{6}$/);
    const [row] = await codeRows();
    expect(row).toMatchObject({
      orgId: fx().org.id,
      email: "felipe@example.com",
      codeHash: sha256(`${fx().org.id}:felipe@example.com:${first}`),
      tries: 0,
      sentAt: NOW,
      expiresAt: at(10 * MIN),
      verifiedHash: null,
    });
    expect(JSON.stringify(row)).not.toContain(first);
    expect(await codeEmails()).toEqual([
      { to: ["felipe@example.com"], kind: "join_code", locale: "en", orgName: "Acme", code: first, url: PUBLIC },
    ]);

    const soon = await sendJoinCode(deps(), PUBLIC, { token, user: null, email: "felipe@example.com" }, at(20_000))
      .then(() => null)
      .catch((e) => e);
    expect(soon).toMatchObject({ code: "join.code_wait", params: { retryIn: 40 } });
    const second = await send(token, "felipe@example.com", at(MIN));
    expect((await codeRows())[0]).toMatchObject({ tries: 0, expiresAt: at(11 * MIN) });
    const old = first === second ? other(first) : first;
    await expect(check(token, "felipe@example.com", old, at(MIN))).rejects.toMatchObject({ code: "join.code_wrong" });
    expect(await check(token, "felipe@example.com", second, at(MIN))).toEqual({ verified: true });
  });

  test("a wrong code counts a try, the fifth ends it, and a code runs out after 10 minutes", async () => {
    const token = await start();
    const code = await send(token, "felipe@example.com");
    const wrong = other(code);
    await expect(check(token, "felipe@example.com", wrong)).rejects.toMatchObject({ code: "join.code_wrong" });
    expect((await codeRows())[0]?.tries).toBe(1);
    for (let i = 2; i < 5; i++)
      await expect(check(token, "felipe@example.com", wrong)).rejects.toMatchObject({ code: "join.code_wrong" });
    await expect(check(token, "felipe@example.com", wrong)).rejects.toMatchObject({ code: "join.code_tries" });
    await expect(check(token, "felipe@example.com", code)).rejects.toMatchObject({ code: "join.code_tries" });

    const next = await send(token, "felipe@example.com", at(MIN));
    await expect(check(token, "felipe@example.com", next, at(11 * MIN))).rejects.toMatchObject({
      code: "join.code_expired",
    });
    // With no code sent, the answer is the same as a wrong one: nobody learns whether one went out.
    await expect(check(token, "nobody@example.com", "123456")).rejects.toMatchObject({ code: "join.code_wrong" });
  });

  test("typed right, it proves the address for 30 minutes, and a newer code doesn't undo it", async () => {
    const token = await start();
    const code = await send(token, "felipe@example.com");
    expect(await check(token, "felipe@example.com", code, at(MIN))).toEqual({ verified: true });
    expect((await codeRows())[0]).toMatchObject({
      codeHash: null,
      verifiedHash: sha256(`${fx().org.id}:felipe@example.com:${code}`),
      verifiedUntil: at(31 * MIN),
    });
    await send(token, "felipe@example.com", at(2 * MIN));
    expect(await check(token, "felipe@example.com", code, at(3 * MIN))).toEqual({ verified: true });
    await expect(check(token, "felipe@example.com", code, at(32 * MIN))).rejects.toMatchObject({
      code: "join.code_expired",
    });
  });

  test("it never confirms an account: signed in and unconfirmed, the code proves the request only", async () => {
    const token = await start();
    const cris = await person("u_cris", "cris@example.com", false);
    await sendJoinCode(deps(), PUBLIC, { token, user: cris }, NOW);
    const [mail] = await codeEmails();
    expect(mail?.to).toEqual(["cris@example.com"]);
    expect(await checkJoinCode(deps(), { token, user: cris, code: mail?.code ?? "" }, NOW)).toEqual({
      verified: true,
    });
    await askToJoin(deps(), PUBLIC, { token, user: cris, proofNeeded: true, code: mail?.code }, NOW);
    const [row] = await requestRows();
    expect(row).toMatchObject({ userId: "u_cris", email: "cris@example.com", verifiedAt: NOW });
    const [account] = await fx().db.select().from(schema.users).where(eq(schema.users.id, "u_cris"));
    expect(account?.emailVerified).toBe(false);
    // Whoever holds that account may not own the mailbox: approving sends an invitation to it.
    const approved = await approveJoinRequest(deps(), PUBLIC, fx().owner.id, fx().org.id, row?.id ?? "", [], NOW);
    expect(approved.outcome).toBe("invited");

    // A confirmed account asks as itself, with no code.
    const dani = await person("u_dani", "dani@example.com", true);
    await expect(sendJoinCode(deps(), PUBLIC, { token, user: dani }, NOW)).rejects.toMatchObject({
      code: "join.verified",
    });
  });
});

describe("the limits, all counted in the database", () => {
  test("5 an hour and 10 a day per workspace and address", async () => {
    const token = await start();
    const sendAt = (minutes: number) =>
      sendJoinCode(deps(), PUBLIC, { token, user: null, email: "felipe@example.com" }, at(minutes * MIN));
    for (const m of [0, 1, 2, 3, 4]) await sendAt(m);
    await expect(sendAt(5)).rejects.toMatchObject({ code: "join.code_limit" });
    for (const m of [61, 62, 63, 64, 65]) await sendAt(m);
    await expect(sendAt(200)).rejects.toMatchObject({ code: "join.code_limit" });
    await sendAt(24 * 60 + 1);
  });

  test("one sender gets 20 a day for a mailbox across workspaces, +tags and Gmail's dots as one", async () => {
    const token = await start();
    const tokens = [token];
    for (const name of ["Beta", "Gama"]) {
      const { organization } = await createOrganization(fx().db, fx().owner.id, { name });
      tokens.push((await inviteLink(fx().db, SECRET, fx().owner.id, organization.id, NOW)).token);
    }
    const from = "203.0.113.7";
    const addresses = ["ab+x@gmail.com", "a.b@gmail.com"];
    for (const [i, address] of addresses.entries()) {
      for (let n = 0; n < 10; n++) {
        const minutes = n < 5 ? n : 61 + n;
        await sendJoinCode(
          deps(),
          PUBLIC,
          { token: tokens[i] ?? "", user: null, email: address, from },
          at(minutes * MIN),
        );
      }
    }
    await expect(
      sendJoinCode(
        deps(),
        PUBLIC,
        { token: tokens[2] ?? "", user: null, email: "AB@googlemail.com", from },
        at(80 * MIN),
      ),
    ).rejects.toMatchObject({ code: "join.code_limit" });
    await sendJoinCode(
      deps(),
      PUBLIC,
      { token: tokens[2] ?? "", user: null, email: "abc@gmail.com", from },
      at(80 * MIN),
    );
    expect(mailboxOf(" A.B+news@GoogleMail.com")).toBe("ab@gmail.com");
    expect(mailboxOf("a.b+x@acme.com")).toBe("a.b@acme.com");
  });

  test("codes others asked for an address elsewhere never use up its owner's", async () => {
    const token = await start();
    for (const [i, name] of ["Beta", "Gama", "Delta"].entries()) {
      const { organization } = await createOrganization(fx().db, fx().owner.id, { name });
      const theirs = (await inviteLink(fx().db, SECRET, fx().owner.id, organization.id, NOW)).token;
      for (let n = 0; n < 10; n++) {
        const minutes = n < 5 ? n : 61 + n;
        await sendJoinCode(
          deps(),
          PUBLIC,
          { token: theirs, user: null, email: "lia@example.com", from: `198.51.100.${i}` },
          at(minutes * MIN),
        );
      }
    }
    await sendJoinCode(
      deps(),
      PUBLIC,
      { token, user: null, email: "lia@example.com", from: "203.0.113.7" },
      at(90 * MIN),
    );
    expect((await codeEmails()).at(-1)?.to).toEqual(["lia@example.com"]);
    expect(await codeEmails()).toHaveLength(31);
  });

  test("a busy hour of codes on the server refuses nobody else", async () => {
    const token = await start();
    const { organization } = await createOrganization(fx().db, fx().owner.id, { name: "Beta" });
    await fx()
      .db.insert(schema.organizationJoinCodeEvents)
      .values(
        Array.from({ length: 500 }, (_, i) => ({
          orgId: organization.id,
          mailbox: `m${i}`,
          kind: "sent" as const,
          at: NOW,
        })),
      );
    expect(await send(token, "felipe@example.com", at(MIN))).toMatch(/^\d{6}$/);
  });

  test("after 10 wrong tries in a day no new code goes out, and one typed right before still works", async () => {
    const token = await start();
    const right = await send(token, "felipe@example.com");
    await check(token, "felipe@example.com", right, at(MIN));
    for (const m of [2, 3]) {
      const code = await send(token, "felipe@example.com", at(m * MIN));
      for (let i = 0; i < 5; i++) await check(token, "felipe@example.com", other(code), at(m * MIN)).catch(() => null);
    }
    await expect(send(token, "felipe@example.com", at(4 * MIN))).rejects.toMatchObject({ code: "join.code_limit" });
    await expect(check(token, "felipe@example.com", other(right), at(4 * MIN))).rejects.toMatchObject({
      code: "join.code_tries",
    });
    expect(await check(token, "felipe@example.com", right, at(5 * MIN))).toEqual({ verified: true });
    expect(await ask(token, { email: "felipe@example.com", code: right }, at(5 * MIN))).toMatchObject({
      created: true,
    });
  });

  test("guesses at a code typed right count too, and that code keeps working", async () => {
    const token = await start();
    const right = await send(token, "felipe@example.com");
    await check(token, "felipe@example.com", right);
    const guess = (i: number) => String((Number(right) + i) % 1_000_000).padStart(6, "0");
    for (let i = 1; i <= 10; i++)
      await expect(check(token, "felipe@example.com", guess(i), at(MIN))).rejects.toMatchObject({
        code: "join.code_wrong",
      });
    await expect(check(token, "felipe@example.com", guess(11), at(MIN))).rejects.toMatchObject({
      code: "join.code_tries",
    });
    await expect(ask(token, { email: "felipe@example.com", code: guess(12) }, at(MIN))).rejects.toMatchObject({
      code: "join.code_tries",
    });
    expect(await check(token, "felipe@example.com", right, at(2 * MIN))).toEqual({ verified: true });
  });

  test("a deleted workspace's codes are forgotten after a day, like any other", async () => {
    const token = await start();
    const mia = await person("u_mia", "mia@example.com", true);
    const { organization } = await createOrganization(fx().db, mia.id, { name: "Um" });
    const { token: theirs } = await inviteLink(fx().db, SECRET, mia.id, organization.id, NOW);
    for (let m = 0; m < 5; m++)
      await sendJoinCode(deps(), PUBLIC, { token: theirs, user: null, email: "lia@example.com" }, at(m * MIN));
    // Her account goes, and with it her workspace, for good once its date passes.
    await deleteAccount(fx().db, mia.id);
    await fx()
      .db.update(schema.organizations)
      .set({ deletionDueAt: new Date(Date.now() - MIN) })
      .where(inArray(schema.organizations.id, [organization.id]));
    expect(await purgeWorkspace({ db: fx().db }, organization.id)).toBe(true);
    await send(token, "lia@example.com", at(10 * MIN));
    await pruneJoinRequests(deps(), at(DAY + 11 * MIN));
    expect(await fx().db.select().from(schema.organizationJoinCodeEvents)).toEqual([]);
  });

  test("counts written before a restart, or by another server process, hold the same", async () => {
    const token = await start();
    const mailbox = sha256(mailboxOf("felipe@example.com"));
    await fx()
      .db.insert(schema.organizationJoinCodeEvents)
      .values(Array.from({ length: 5 }, () => ({ orgId: fx().org.id, mailbox, kind: "sent" as const, at: NOW })));
    await expect(send(token, "felipe@example.com", at(MIN))).rejects.toMatchObject({ code: "join.code_limit" });
  });
});

describe("asking with the code", () => {
  test("needed, checked, used up, and the request filed at once as proven", async () => {
    const token = await start();
    await expect(ask(token, { email: "felipe@example.com" })).rejects.toMatchObject({ code: "join.code_needed" });
    const code = await send(token, "felipe@example.com");
    await expect(ask(token, { email: "felipe@example.com", code: other(code) })).rejects.toMatchObject({
      code: "join.code_wrong",
    });
    expect((await codeRows())[0]?.tries).toBe(1);
    // Right, even unchecked.
    expect(await ask(token, { email: "felipe@example.com", code, note: "Rafael's cousin" })).toEqual({
      status: "pending",
      email: "felipe@example.com",
      created: true,
      requestId: expect.any(String),
    });
    expect(await requestRows()).toEqual([
      expect.objectContaining({
        email: "felipe@example.com",
        name: "Felipe Ramos",
        note: "Rafael's cousin",
        userId: null,
        verifiedAt: NOW,
        status: "pending",
      }),
    ]);
    expect(await codeRows()).toEqual([]);
    const notices = await fx()
      .db.select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, "join_request"));
    expect(notices).toHaveLength(1);
    await expect(ask(token, { email: "felipe@example.com", code }, at(MIN))).rejects.toMatchObject({
      code: "join.code_wrong",
    });

    // Asked again: the waiting request takes the new name and note.
    const again = await send(token, "felipe@example.com", at(2 * MIN));
    expect(
      await ask(token, { email: "felipe@example.com", code: again, name: "Felipe R.", note: "Weekends" }, at(2 * MIN)),
    ).toMatchObject({ created: false });
    expect(await requestRows()).toEqual([expect.objectContaining({ name: "Felipe R.", note: "Weekends" })]);
  });

  test("a proven ask hears where its address stands, and its code stays good", async () => {
    const token = await start();
    const joao = await addMember(fx().db, fx().org.id, "member", "joao");
    const memberCode = await send(token, joao.email);
    await expect(ask(token, { email: joao.email, code: memberCode })).rejects.toMatchObject({ code: "join.member" });
    expect(await check(token, joao.email, memberCode)).toEqual({ verified: true });

    const code = await send(token, "felipe@example.com");
    await ask(token, { email: "felipe@example.com", code });
    const [row] = await requestRows();
    await denyJoinRequest(deps(), fx().owner.id, fx().org.id, row?.id ?? "", null, at(MIN));
    const denied = await send(token, "felipe@example.com", at(2 * MIN));
    await expect(ask(token, { email: "felipe@example.com", code: denied }, at(2 * MIN))).rejects.toMatchObject({
      code: "join.denied",
    });

    await fx()
      .db.insert(schema.organizationJoinRequests)
      .values(
        Array.from({ length: MAX_PENDING_JOIN_REQUESTS }, (_, i) => ({
          orgId: fx().org.id,
          email: `p${i}@example.com`,
          name: `P${i}`,
          expiresAt: at(DAY),
        })),
      );
    const full = await send(token, "gil@example.com", at(3 * MIN));
    await expect(ask(token, { email: "gil@example.com", code: full }, at(3 * MIN))).rejects.toMatchObject({
      code: "join.full",
    });
    expect(await check(token, "gil@example.com", full, at(3 * MIN))).toEqual({ verified: true });
  });
});

describe("approving a proven request", () => {
  test("a confirmed account with the address joins; no account, or an address nobody proved, gets an invitation", async () => {
    const token = await start();
    const bia = await person("u_bia", "bia@example.com", true);
    await ask(token, { email: "bia@example.com", code: await send(token, "bia@example.com") });
    await ask(token, { email: "rui@example.com", code: await send(token, "rui@example.com", at(MIN)) }, at(MIN));
    // A server without email: typed and filed by its job, unproven.
    await person("u_eva", "eva@example.com", true);
    await askToJoin(deps(), PUBLIC, { token, user: null, name: "Eva", email: "eva@example.com" }, NOW);
    await drainOutbox(fx().db, fx().handlers);

    const list = await listWaitingJoinRequests(fx().db, fx().owner.id, fx().org.id, NOW);
    expect(list.map((r) => [r.email, r.verified, r.confirmed])).toEqual([
      ["bia@example.com", true, true],
      ["rui@example.com", true, false],
      ["eva@example.com", false, false],
    ]);
    const approve = (email: string) =>
      approveJoinRequest(
        deps(),
        PUBLIC,
        fx().owner.id,
        fx().org.id,
        list.find((r) => r.email === email)?.id ?? "",
        [],
        NOW,
      );
    expect(await approve("bia@example.com")).toEqual({ outcome: "joined" });
    const [member] = await fx()
      .db.select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, bia.id));
    expect(member?.role).toBe("member");
    expect((await approve("rui@example.com")).outcome).toBe("invited");
    expect((await approve("eva@example.com")).outcome).toBe("invited");
  });

  test("a request from before codes, asked by a confirmed account, still lets that account in", async () => {
    await start();
    const gil = await person("u_gil", "gil@example.com", true);
    await fx()
      .db.insert(schema.organizationJoinRequests)
      .values({
        orgId: fx().org.id,
        userId: gil.id,
        email: "gil@example.com",
        name: "Gil Lima",
        verifiedAt: null,
        expiresAt: at(DAY),
      });
    const [row] = await listWaitingJoinRequests(fx().db, fx().owner.id, fx().org.id, NOW);
    expect(row).toMatchObject({ email: "gil@example.com", verified: true, confirmed: true });
    expect(await approveJoinRequest(deps(), PUBLIC, fx().owner.id, fx().org.id, row?.id ?? "", [], NOW)).toEqual({
      outcome: "joined",
    });
    const [member] = await fx()
      .db.select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, gil.id));
    expect(member?.orgId).toBe(fx().org.id);
  });
});

describe("the code's email", () => {
  test("its job's row is deleted once sent, and after its last failed try", async () => {
    const token = await start();
    const sender = createFakeEmailSender();
    const code = await send(token, "felipe@example.com");
    await drainOutbox(fx().db, createJobHandlers({ ...fx().jobDeps, email: sender }));
    expect(sender.sent.map((m) => [m.to, m.subject])).toEqual([
      [["felipe@example.com"], `${code} is your agentes.chat code`],
    ]);
    expect(sender.sent[0]?.text).toContain(`\n\n${code}\n\n`);
    expect(await codeEmails()).toEqual([]);

    await send(token, "rui@example.com");
    let tries = 0;
    const down: EmailSender = {
      id: "down",
      delivers: true,
      send: async () => {
        tries++;
        throw new Error("connect timeout");
      },
    };
    const handlers = createJobHandlers({ ...fx().jobDeps, email: down });
    await drainOutbox(fx().db, handlers, { now: at(DAY), maxBatches: 1 });
    expect(await codeEmails()).toHaveLength(1);
    // Each drain runs at its own time, so each runs one try: the second, then the last.
    await drainOutbox(fx().db, handlers, { now: at(2 * DAY) });
    await drainOutbox(fx().db, handlers, { now: at(3 * DAY) });
    expect(tries).toBe(3);
    expect(await codeEmails()).toEqual([]);
  });

  test("the daily prune drops codes a day after both their times, counts after a day, and a stray email", async () => {
    const token = await start();
    const code = await send(token, "felipe@example.com");
    await check(token, "felipe@example.com", code, at(MIN));
    await send(token, "rui@example.com");
    await fx()
      .db.insert(schema.outbox)
      .values({
        orgId: fx().org.id,
        kind: "email.send",
        payload: {},
        dedupeKey: "email:join-code:stray",
        createdAt: at(-2 * DAY),
      });
    await queueEmail(fx().db, {
      orgId: fx().org.id,
      key: "k-other",
      to: ["a@example.com"],
      template: { kind: "verify_email", url: "u" },
    });

    await pruneJoinRequests(deps(), at(DAY + 20 * MIN));
    // Felipe's proof lasts until 31 minutes in, Rui's code until 10: only Rui's is a day past both.
    expect((await codeRows()).map((r) => r.email)).toEqual(["felipe@example.com"]);
    expect(await fx().db.select().from(schema.organizationJoinCodeEvents)).toEqual([]);
    const left = await fx().db.select({ key: schema.outbox.dedupeKey }).from(schema.outbox);
    expect(left.map((r) => r.key)).not.toContain("email:join-code:stray");
    expect(left.map((r) => r.key)).toContain("email:k-other");
  });
});
