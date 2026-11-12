# 0072. Asking to join proves the address

- Status: Accepted (built: server, web, the shared client and the phone app). Revised by ADR 0090: for an address with no account, an approval makes the account the proven ask chose a password for, confirmed
- Date: 2026-10-27
- Revises: ADR 0068 §2, §4, §7 and §8
- Code: `packages/engine/src/invite-requests.ts` (`sendJoinCode`, `checkJoinCode`, `askToJoin`, approval, prune), `packages/engine/src/jobs.ts` (`email.send`), `packages/engine/src/email/` (`join_code`, the `code` block), `apps/server/src/routes/app/invites.ts`, `apps/web/src/pages/InvitePage.tsx` (`EmailProof`), `apps/web/src/pages/MembersPage.tsx`, `apps/mobile/src/features/auth/InviteScreen.tsx` (`EmailProof`), `apps/mobile/src/features/members/JoinRequestsSheet.tsx`

## Context

With ADR 0068, whoever holds an invitation link types a name and an address and asks. The address was never proven: approving a typed request could only send an invitation, the admin's card had to say so on every request, and anyone could file requests in other people's names. A code emailed to the address and typed back on the page proves it before the request goes in.

## Decision

1. **Verify sits beside the email field** on the link's page. It emails a 6-digit code, typed back in place, and "Ask to join" stays off until the address is verified. A code and a proof belong to the address they were for: editing it starts over. Once an address is over its cap of codes, Verify and Resend stay off until the email changes. A signed-in account with a confirmed email needs no code. One whose email isn't confirmed verifies its own address the same way. A server that sends no email keeps ADR 0068's form and its unproven path.
2. **The code proves the request, never the account.** `users.email_verified` changes only through Better Auth's own confirmation link, so a guessed code can't confirm someone else's account.
3. **The code.** 10 minutes to type it and 5 wrong tries, then 30 minutes from typing it right to asking with it. A new code replaces one still waiting to be typed, never one already typed right. The ask carries the code (`POST …/requests` with `code`, checked first or not), and the server checks it, files the request with `verified_at` and deletes the code in one transaction. A proven ask hears where its address stands (`join.member`, `join.denied`, `join.full`, or the link's hour used up, `join.link_busy`), and those answers leave its code good. With no code sent, a check answers `join.code_wrong`, so nobody learns whether one went out.
4. **Limits, all counted in the database**, so a restart or a second process resets none. 60 s between two codes for one workspace and address (`join.code_wait` with `retryIn`). Per workspace and mailbox: 5 codes an hour, 10 a day, and after 10 wrong tries in a day no new code and no check (`join.code_limit`, `join.code_tries`). A wrong code counts even when only one typed right before is left, which still works. Per mailbox across workspaces: 20 codes a day. The whole server: 500 code emails an hour (`rate_limited`). The mailbox is the address in lower case, without a `+tag`, and without dots for Gmail (`mailboxOf`). Code sends and checks take one advisory lock, so every count holds. Per IP and per link, in memory like every rate limit here: 10 codes an hour per IP and 40 per link, 30 checks an hour per IP (`join.rate_limited` for an IP, `join.link_busy` for the link).
5. **What is kept.** `organization_join_codes`, one row per workspace and address, holds only sha256 hashes of `{orgId}:{email}:{code}`: the code waiting to be typed, and the one typed right. `organization_join_code_events` holds the sha256 of the mailbox, the kind (`sent` or `wrong`) and the time. It has no foreign key to the workspace, so deleting workspaces (or the account alone in them) resets no mailbox's or server's count. The code's email (`join_code`: the code first in the subject, large in a well, no button, since the page is already open) gets 3 tries within its first minute, and the `email.send` job deletes its outbox row once it is sent or failed for good. The daily tick deletes code rows a day after both their times pass, events after a day, and any code email a worker left behind.
6. **Approval.** A request joins at once when a confirmed, unblocked account has its address and the address was proven (a code, or that account asking). Anyone else gets ADR 0068's email invitation, an unconfirmed account with that address included.
7. **The admins' card** keeps who asks, the address, the note and the answer. The proof line and "Closes {date}" go: a request still closes after 14 days. `GET …/join-requests` gains `verified` (a code proved the address, or a confirmed account with it asked), and "Not verified" shows beside "Asked …" only where nobody proved it: a server without email, or a request typed before codes. `confirmed` stays, deprecated, meaning what approving does, for phone builds that read it.
8. **Words.** The answer emails lose "If you didn't ask to join, ignore this email": the address asked.

## Consequences

- A phone build from before this can't ask to join a server that sends email (`join.code_needed`) until it updates. On a server without email it asks as before. The requests it shows read `confirmed`.
- Requests typed before this stay unproven until they close: approving one sends an invitation.
- Every other email still keeps its address and content in the outbox. Only the code's email is deleted.
- The per-address limits protect the mailbox and the code, so they count every request for that address, whoever sends it. Anyone with the link and an address can use them up: from one IP, two codes a minute apart and 10 wrong tries, or 10 codes in about an hour, and that address gets no code for the workspace for a day (`join.code_limit`). It can still ask from a confirmed account. Counting the day's wrong tries per address and per IP address (/64 for IPv6) would make the first way cost more IP addresses, with a new column on `organization_join_code_events`. The codes a day stay per address: they keep the mailbox from being flooded.

## Alternatives considered

- Confirming the account with the same code: a lucky guess would confirm someone else's account.
- Limits in memory: every restart and every replica would reset them.
- A second token after the check: the code itself is the proof, and one tries counter covers checking and asking.
- A link to click instead of a code: the page is already open, and mail scanners open every link.

## Addendum (2026-11-11): no count that everyone shares

Two of the limits in point 4 counted every request, whoever sent it and through whichever workspace: 20 codes a day per mailbox, and 500 code emails an hour for the whole server. A count everyone shares is one anyone can use up: codes asked for someone else's address through other workspaces left that person without a code on every link for a day, and enough requests left the whole server without codes for an hour.

Both are gone. In their place, one sender (the IP address the other limits use, a /64 for IPv6) may ask at most 20 codes a day for one mailbox across workspaces (`join.code_limit`), counted in memory like the other per-IP limits. What bounds the emails now:

- Per workspace and mailbox, in the database: 5 codes an hour and 10 a day, as before. Someone can still use up an address's codes for one workspace, as the consequences above say, and never for another.
- Per sender: 10 codes an hour in all, and 20 a day for one mailbox.
- Per link: 40 codes an hour.
- The bot check, on a server that has one.

One sender can send a mailbox no more than before. Many senders together can send more than 20 a day to one mailbox, each through workspaces of their own: that is the price of nobody being able to lock an address out, and it takes an IP address and a passed bot check for every 20 emails.

Not chosen: keeping the shared counts and adding the per-sender one before them. The lockout would stay for anyone with a few IP addresses.
