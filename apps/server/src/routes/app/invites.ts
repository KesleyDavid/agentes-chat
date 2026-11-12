import { nameIsPassword } from "@agenteschat/client/lib/text";
import {
  approveJoinRequest,
  askToJoin,
  CODE_LENGTH,
  cancelSuggestion,
  checkJoinCode,
  claimJoinRequest,
  denyJoinRequest,
  inviteLink,
  JOIN_NAME_MAX,
  JOIN_NOTE_MAX,
  JOIN_REASON_MAX,
  linkBusy,
  listInviteLinks,
  listMySuggestions,
  listWaitingJoinRequests,
  randomToken,
  renewInviteLink,
  requestLocale,
  requestNewInvitation,
  sendJoinCode,
  sha256,
  suggestPerson,
  turnOffInviteLink,
} from "@agenteschat/engine";
import { createRoute, z } from "@hono/zod-openapi";
import { hashPassword, mintUserSignIn, NAME_IS_PASSWORD, NAME_IS_PASSWORD_MESSAGE, sessionUser } from "../../auth";
import { requestLimitIp } from "../../http/client-ip";
import { apiError, errorResponse } from "../../http/errors";
import { humanCheckRefusal } from "../../http/human-check";
import {
  type AppDeps,
  body,
  createAppRouter,
  errors,
  json,
  noContent,
  OrgParams,
  requireSession,
  security,
} from "./context";

const tags = ["Organizations"];
/** Asks from one place (ADR 0068). A link's own count is the engine's (`askToJoin`). */
const ASKS_PER_IP = { limit: 10, windowMs: 3600_000 };
/** Codes that prove an address (ADR 0072): the per-address limits are the engine's, in the database. */
const CODES_PER_IP = { limit: 10, windowMs: 3600_000 };
const CODES_PER_LINK = { limit: 40, windowMs: 3600_000 };
const CHECKS_PER_IP = { limit: 30, windowMs: 3600_000 };
/** The page that asked checks every 15 s while open (ADR 0090): a few hours of it from one place. */
const CLAIMS_PER_IP = { limit: 600, windowMs: 3600_000 };
/** Suggestions from one member (ADR 0090). */
const SUGGESTIONS_PER_MEMBER = { limit: 20, windowMs: 3600_000 };
const TOO_MANY = "Too many requests from here. Try again in an hour.";
const Code = z.string().regex(new RegExp(`^\\d{${CODE_LENGTH}}$`));

const Token = z.object({ token: z.string().min(1).max(200) });
const LinkParams = OrgParams.extend({ linkId: z.uuid() });
const RequestParams = OrgParams.extend({ requestId: z.uuid() });
const InviteLink = z.object({
  id: z.uuid(),
  url: z.string().nullable().openapi({ description: "Null for a link made before links could be shown again." }),
  expiresAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string().nullable().openapi({ description: "Who made it (their name)." }),
  waiting: z.number().int().openapi({ description: "Requests made through it, still waiting." }),
});
const JoinRequest = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  note: z.string().nullable().openapi({ description: "Their words: shown in the app, never sent out." }),
  verified: z.boolean().openapi({
    description:
      "A code proved the address, or a confirmed account with it asked. False only on a server without email, " +
      "or for a request typed before codes.",
  }),
  confirmed: z.boolean().openapi({
    deprecated: true,
    description: "Approving lets an account in at once. Read `verified` instead.",
  }),
  suggestedBy: z.string().nullable().openapi({
    description: "The member who suggested this person (their name, ADR 0090): no link, no proof.",
  }),
  createdAt: z.string(),
  expiresAt: z.string(),
});

const Asked = z.object({
  status: z.literal("pending"),
  email: z.string(),
  emailed: z.boolean(),
  key: z.string().optional().openapi({
    description: "With a `password` (ADR 0090): what this page keeps to sign in once approved. Shown once.",
  }),
});

/**
 * The workspace's invitation link and the requests to join it brings (ADR 0068), suggestions from members and the
 * page that asked signing in once approved (ADR 0090), and "ask for a new invitation" from an expired email
 * invitation.
 */
export function inviteRoutes(deps: AppDeps) {
  const { db, config, adapters } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const events = { db, pubsub: adapters.pubsub };
  const linkUrl = (token: string) => `${config.PUBLIC_URL.replace(/\/$/, "")}/invite/${token}`;

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/invite-links",
      tags,
      security,
      summary: "The invitation links people can still ask with (admins)",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ links: z.array(InviteLink) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const links = await listInviteLinks(db, config.AGENTES_SECRET, c.get("user").id, orgId);
      return c.json(
        {
          links: links.map(({ token, ...l }) => ({
            ...l,
            url: token ? linkUrl(token) : null,
            expiresAt: l.expiresAt.toISOString(),
            createdAt: l.createdAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/invite-links",
      tags,
      security,
      summary: "The workspace's invitation link: the active one, or a new one (admins)",
      description:
        "Whoever opens it can only ask to join; an admin approves each person. It works for 30 days. Only a hash " +
        "of its token is stored, and the same link comes back every time.",
      request: { params: OrgParams },
      responses: {
        200: json(z.object({ id: z.uuid(), url: z.string(), expiresAt: z.string() }), "The active link"),
        201: json(z.object({ id: z.uuid(), url: z.string(), expiresAt: z.string() }), "Made"),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const { link, token, made } = await inviteLink(db, config.AGENTES_SECRET, c.get("user").id, orgId);
      return c.json({ id: link.id, url: linkUrl(token), expiresAt: link.expiresAt.toISOString() }, made ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/invite-links/{linkId}",
      tags,
      security,
      summary: "Turn an invitation link off (admins)",
      description: "Nobody new can ask with it, and the requests made through it close without emailing anyone.",
      request: { params: LinkParams },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, linkId } = c.req.valid("param");
      await turnOffInviteLink(events, c.get("user").id, orgId, linkId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/invite-links/{linkId}/renew",
      tags,
      security,
      summary: "Give an invitation link 30 more days (admins)",
      description: "The same link: whoever already has it keeps it (ADR 0090).",
      request: { params: LinkParams },
      responses: { 200: json(z.object({ expiresAt: z.string() })), ...errors },
    }),
    async (c) => {
      const { orgId, linkId } = c.req.valid("param");
      const { expiresAt } = await renewInviteLink(db, c.get("user").id, orgId, linkId);
      return c.json({ expiresAt: expiresAt.toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/join-requests/suggest",
      tags,
      security,
      summary: "Suggest someone to the people who may invite (any member, ADR 0090)",
      description:
        "Waits among the requests to join, with who suggested it. Approving it sends the person an email " +
        "invitation; denying it tells them nothing (they never asked). `join.member`, `join.invited` (an " +
        "invitation waits), `join.waiting` (already asked for), `join.full` (20 suggestions wait in the workspace, " +
        "or 5 of yours: apart from the asks through a link).",
      request: {
        params: OrgParams,
        body: body(z.object({ email: z.email().max(254), note: z.string().max(JOIN_NOTE_MAX).optional() })),
      },
      responses: { 201: json(z.object({ id: z.uuid() })), 429: errorResponse("Too many (`rate_limited`)"), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      const limit = await adapters.rateLimiter.consume(`suggest:${orgId}:${userId}`, SUGGESTIONS_PER_MEMBER);
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many suggestions. Try again later.");
      const input = c.req.valid("json");
      return c.json(await suggestPerson(events, userId, orgId, input), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/join-requests/mine",
      tags,
      security,
      summary: "The suggestions this member made that still wait (ADR 0090)",
      request: { params: OrgParams },
      responses: {
        200: json(
          z.object({
            suggestions: z.array(
              z.object({ id: z.uuid(), email: z.string(), note: z.string().nullable(), createdAt: z.string() }),
            ),
          }),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const rows = await listMySuggestions(db, c.get("user").id, c.req.valid("param").orgId);
      return c.json({ suggestions: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/organizations/{orgId}/join-requests/{requestId}",
      tags,
      security,
      summary: "Take back a suggestion that still waits (its author, ADR 0090)",
      request: { params: RequestParams },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, requestId } = c.req.valid("param");
      await cancelSuggestion(events, c.get("user").id, orgId, requestId);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/join-requests",
      tags,
      security,
      summary: "Requests to join waiting for an answer, oldest first (admins)",
      request: { params: OrgParams },
      responses: { 200: json(z.object({ requests: z.array(JoinRequest) })), ...errors },
    }),
    async (c) => {
      const rows = await listWaitingJoinRequests(db, c.get("user").id, c.req.valid("param").orgId);
      return c.json(
        {
          requests: rows.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/join-requests/{requestId}/approve",
      tags,
      security,
      summary: "Approve a request to join, with roles (who may invite people)",
      description:
        "A confirmed account with this address joins at once when the address was proven (a code from its " +
        "mailbox, or that account asking), and so does a proven ask with a password and no account, whose account " +
        "this makes (ADR 0090). Anyone else gets an email invitation to the address: in the answer to their ask, " +
        "or, for a member's suggestion, as the invitation email itself. `emailed: false` on a server that doesn't " +
        "send email: hand them `url` yourself.",
      request: {
        params: RequestParams,
        body: body(
          z.object({
            roleIds: z
              .array(z.string().uuid())
              .max(50)
              .optional()
              .openapi({ description: "Roles the person gets, below the approver's own (ADR 0085)." }),
          }),
        ),
      },
      responses: {
        200: json(
          z.discriminatedUnion("outcome", [
            z.object({ outcome: z.literal("joined") }),
            z.object({
              outcome: z.literal("invited"),
              url: z.string().openapi({ description: "The invitation, for that address only (7 days)." }),
              emailed: z.boolean(),
            }),
          ]),
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { orgId, requestId } = c.req.valid("param");
      const result = await approveJoinRequest(
        { ...events, secret: config.AGENTES_SECRET },
        config.PUBLIC_URL,
        c.get("user").id,
        orgId,
        requestId,
        c.req.valid("json").roleIds ?? [],
      );
      deps.wakeWorkers?.();
      return c.json(
        result.outcome === "invited" ? { ...result, emailed: adapters.email.delivers === true } : result,
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/join-requests/{requestId}/deny",
      tags,
      security,
      summary: "Deny a request to join (admins)",
      description:
        "The person is told by email, with the reason when one is given. A member's suggestion is denied " +
        "quietly: nobody at that address asked (ADR 0090).",
      request: {
        params: RequestParams,
        body: body(z.object({ reason: z.string().max(JOIN_REASON_MAX).optional() })),
      },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const { orgId, requestId } = c.req.valid("param");
      await denyJoinRequest(events, c.get("user").id, orgId, requestId, c.req.valid("json").reason);
      deps.wakeWorkers?.();
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/{token}/code",
      tags,
      summary: "Email a code that proves the address, before asking to join through a link",
      description:
        "Public. Signed out: the address typed. Signed in: the account's own, when it isn't confirmed. Every " +
        "address gets the same answer. 60 s between two codes for one address (`retryIn`), and a few an hour " +
        "and a day per address, all counted in the database. `join.no_email` on a server that sends no email. " +
        "Guarded by the bot check when this server has one (`human_check`, `human_check_blocked`).",
      request: { params: Token, body: body(z.object({ email: z.email().max(254).optional() })) },
      responses: {
        202: json(z.object({ email: z.string(), resendIn: z.number().int() }), "Sent"),
        429: errorResponse(
          "Too many (`join.code_wait` with `retryIn`, `join.code_limit`, `join.rate_limited` from here, " +
            "`join.link_busy` through the link, `rate_limited`)",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { token } = c.req.valid("param");
      const from = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
      const ip = await adapters.rateLimiter.consume(`join-code:ip:${from}`, CODES_PER_IP);
      if (!ip.allowed) return apiError(c, 429, "join.rate_limited", TOO_MANY);
      // Before the link's count, so refused bots don't spend what everyone asking through it shares.
      const refused = await humanCheckRefusal(
        adapters.humanCheck,
        c.req.raw.headers,
        "ask-code",
        config.TRUSTED_PROXIES,
      );
      if (refused) return apiError(c, 403, refused.code, refused.message);
      const link = await adapters.rateLimiter.consume(`join-code:link:${sha256(token)}`, CODES_PER_LINK);
      if (!link.allowed) throw linkBusy();
      if (adapters.email.delivers !== true) return apiError(c, 409, "join.no_email", "This server doesn't send email.");
      const { email } = c.req.valid("json");
      const user = await sessionUser(deps.auth, c.req.raw.headers);
      if (!user && !email) return apiError(c, 400, "invalid_request", "Your email is needed");
      const sent = await sendJoinCode({ ...events, rateLimiter: adapters.rateLimiter }, config.PUBLIC_URL, {
        token,
        user,
        email,
        from,
        locale: requestLocale(c.req.header("accept-language")),
      });
      deps.wakeWorkers?.();
      return c.json(sent, 202);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/{token}/code/check",
      tags,
      summary: "Check a code from the email: right, the address can ask for 30 minutes",
      description:
        "Public. `join.code_wrong` also when no code was sent. 5 wrong tries per code, 10 a day per address. " +
        "It never confirms an account.",
      request: {
        params: Token,
        body: body(z.object({ email: z.email().max(254).optional(), code: Code })),
      },
      responses: {
        200: json(z.object({ verified: z.literal(true) })),
        429: errorResponse("Too many checks from here (`join.rate_limited`)"),
        ...errors,
      },
    }),
    async (c) => {
      const ip = await adapters.rateLimiter.consume(
        `join-code-check:ip:${requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES)}`,
        CHECKS_PER_IP,
      );
      if (!ip.allowed) return apiError(c, 429, "join.rate_limited", TOO_MANY);
      const { email, code } = c.req.valid("json");
      const user = await sessionUser(deps.auth, c.req.raw.headers);
      if (!user && !email) return apiError(c, 400, "invalid_request", "Your email is needed");
      return c.json(await checkJoinCode(events, { token: c.req.valid("param").token, user, email, code }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/{token}/requests",
      tags,
      summary: "Ask to join through an invitation link",
      description:
        "Public. Signed out: a name, an email and an optional note, and no account is made. Signed in: the " +
        "account asks. On a server that sends email, an address that isn't a confirmed account's carries the " +
        "`code` from it (`…/code`), and a proven ask hears where it stands. On a server without email, a typed " +
        "request answers the same whatever the address. Limited per IP, and per link by the new requests filed " +
        "through it (every ask, on a server without email), so asks without a right code don't use up its hour.",
      request: {
        params: Token,
        body: body(
          z.object({
            name: z.string().trim().min(1).max(JOIN_NAME_MAX).optional(),
            email: z.email().max(254).optional(),
            note: z.string().max(JOIN_NOTE_MAX).optional(),
            code: Code.optional(),
            password: z
              .string()
              .min(8)
              .max(128)
              .optional()
              .openapi({
                description:
                  "Signed out, with a `code`: the password of the account an approval makes (ADR 0090). The answer " +
                  "then carries `key`, which this page trades for a sign-in once approved (`…/requests/claim`).",
              }),
          }),
        ),
      },
      responses: {
        200: json(Asked, "Already waiting"),
        201: json(Asked, "Sent"),
        429: errorResponse("Too many requests (`join.rate_limited` from here, `join.link_busy` through the link)"),
        ...errors,
      },
    }),
    async (c) => {
      const { token } = c.req.valid("param");
      const ip = await adapters.rateLimiter.consume(
        `join-request:ip:${requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES)}`,
        ASKS_PER_IP,
      );
      if (!ip.allowed) return apiError(c, 429, "join.rate_limited", TOO_MANY);
      const input = c.req.valid("json");
      const user = await sessionUser(deps.auth, c.req.raw.headers);
      if (!user && (!input.name || !input.email)) {
        return apiError(c, 400, "invalid_request", "Your name and your email are needed");
      }
      if (!user && input.name && input.password && nameIsPassword(input.name, input.password)) {
        return apiError(c, 400, NAME_IS_PASSWORD, NAME_IS_PASSWORD_MESSAGE);
      }
      // The password is hashed here, as Better Auth hashes one, and kept with the request until an approval.
      const keeps = !user && input.password && input.code;
      const secret = keeps ? randomToken(32) : null;
      const asked = await askToJoin({ ...events, rateLimiter: adapters.rateLimiter }, config.PUBLIC_URL, {
        token,
        user,
        name: input.name,
        email: input.email,
        note: input.note,
        locale: requestLocale(c.req.header("accept-language")),
        proofNeeded: adapters.email.delivers === true,
        code: input.code,
        ...(keeps && input.password && secret
          ? { passwordHash: await hashPassword(deps.auth, input.password), claimHash: sha256(secret) }
          : {}),
      });
      deps.wakeWorkers?.();
      const requestId = "requestId" in asked ? asked.requestId : null;
      const reply = {
        status: asked.status,
        email: asked.email,
        emailed: adapters.email.delivers === true,
        ...(secret && requestId ? { key: `${requestId}.${secret}` } : {}),
      };
      return c.json(reply, asked.created ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/{token}/requests/claim",
      tags,
      summary: "Where the request this page made stands, and its sign-in once approved (ADR 0090)",
      description:
        "Public: the `key` the ask answered is the proof. `in` once, with `signIn` for " +
        "`POST /api/auth/sign-in/one-time-token`, when the approval made the account; after that the key is spent " +
        "and reads `closed`. `closed` also for an approval of an address that already had an account (it signs in " +
        "as it always did), and for a request run out, turned off or closed by joining another way. 404 for a key " +
        "that matches nothing, and once the daily cleanup forgets a key, a day after the answer.",
      request: { params: Token, body: body(z.object({ key: z.string().min(10).max(200) })) },
      responses: {
        200: json(
          z.discriminatedUnion("status", [
            z.object({ status: z.literal("pending") }),
            z.object({ status: z.literal("in"), orgId: z.uuid(), signIn: z.string() }),
            z.object({ status: z.literal("denied"), reason: z.string().nullable() }),
            z.object({ status: z.literal("closed") }),
          ]),
        ),
        429: errorResponse("Too many checks from here (`rate_limited`)"),
        ...errors,
      },
    }),
    async (c) => {
      const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
      const limit = await adapters.rateLimiter.consume(`join-claim:${ip}`, CLAIMS_PER_IP);
      if (!limit.allowed) return apiError(c, 429, "rate_limited", TOO_MANY);
      const found = await claimJoinRequest(db, c.req.valid("param").token, c.req.valid("json").key);
      if (found.status !== "in") return c.json(found, 200);
      const { token } = await mintUserSignIn(deps.auth, found.userId);
      return c.json({ status: "in" as const, orgId: found.orgId, signIn: token }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/invitations/{token}/request-new",
      tags,
      summary: "Ask whoever invited you for a new invitation (the old one expired)",
      description: "Email invitations only: an invitation link answers 404.",
      request: { params: Token },
      responses: { 204: noContent[204], ...errors },
    }),
    async (c) => {
      const ip = requestLimitIp(c.req.raw.headers, config.TRUSTED_PROXIES);
      const limit = await adapters.rateLimiter.consume(`invite-request:${ip}`, { limit: 10, windowMs: 3600_000 });
      if (!limit.allowed) return apiError(c, 429, "rate_limited", "Too many requests. Try again later.");
      await requestNewInvitation(db, config.PUBLIC_URL, c.req.valid("param").token);
      deps.wakeWorkers?.();
      return c.body(null, 204);
    },
  );

  return app;
}
