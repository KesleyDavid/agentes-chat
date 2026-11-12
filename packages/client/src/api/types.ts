/** Types of the private web-app API (`/api/app/*`, apps/server/src/routes/app). */

import type { ChatPrefs } from "../lib/chat-look";
import type { RoleId } from "../lib/new-agent";
import type { OnboardingStepId } from "../lib/onboarding";
import type { Permission } from "../lib/permissions";
import type { AudienceChoice } from "../lib/who-sees";

/** Whether a person owns the workspace (ADR 0085); what anyone may do comes from their roles (`OrgRole`). */
export type Role = "owner" | "member";
export type Edition = "selfhost" | "cloud";

export interface Health {
  status: "ok" | "degraded";
  version: string;
  edition: Edition;
}

/** The usage report's switch, for the installation's owner (`GET /api/app/telemetry`). */
export interface ServerTelemetry {
  /** The owner's switch. */
  enabled: boolean;
  /** `TELEMETRY=off` on the server: nothing is sent, whatever the switch says. */
  envOff: boolean;
  /** Exactly what the next report sends (shown as is). */
  report: Record<string, unknown>;
}

/** The installation's Jev key, for its pinned owner on a self-hosted server (`GET /api/app/jev`, ADR 0073). */
export interface JevKey {
  /** `env`: `TYPESAFE_API_KEY`, read-only here. `settings`: added in Settings. Null: none. */
  source: "env" | "settings" | null;
  /** The key's last 4 characters (the key itself is never returned). */
  hint: string | null;
  /** What its owner can fix: TypeSafe refused the key, or its account is out of credit. Else `ok`. */
  state: "off" | "ok" | "invalid" | "no_credit";
  /** Jev's calls this month (UTC), every workspace together. */
  month: { decisions: number; costUsd: number };
}

/**
 * The installation's GIPHY key, for its pinned owner on a server that isn't agentes.chat's own (`GET
 * /api/app/gif-key`, ADR 0091): with it, every workspace has GIFs (`OrgSettings.gifsAvailable`).
 */
export interface GifKey {
  /** `env`: `GIPHY_API_KEY`, read-only here. `settings`: added in Settings. Null: none. */
  source: "env" | "settings" | null;
  /** The key's last 4 characters (the key itself is never returned). */
  hint: string | null;
  /** `invalid`: a saved key this server can't read, or one in `GIPHY_API_KEY` that can't be a key. */
  state: "off" | "ok" | "invalid";
}

/** Who can turn voice into text on this server (ADR 0100). */
export type SpeechProvider = "assemblyai" | "elevenlabs" | "soniox" | "groq" | "openai" | "local" | "deepinfra";

/**
 * The installation's speech engine, for its pinned owner on a server that isn't agentes.chat's own (`GET
 * /api/app/speech-key`, ADR 0100): with one, every workspace has voice messages (`OrgSettings.voiceAvailable`).
 */
export interface SpeechKey {
  /** The one chosen in Settings. Null: none. */
  provider: SpeechProvider | null;
  /** The key's last 4 characters, or the server's address (the key itself is never returned). */
  hint: string | null;
  /** `invalid`: a saved key this server can't read. */
  state: "off" | "ok" | "invalid";
  /** Engines set in the server's environment. */
  envProviders: SpeechProvider[];
}

/** What `PUT /api/app/speech-key` takes: tried with the provider before it is kept. */
export interface SpeechKeyInput {
  provider: SpeechProvider;
  apiKey?: string;
  /** `local`: the address of a server speaking the OpenAI format. */
  baseUrl?: string;
  model?: string;
}

/**
 * A device that hears pushes (`POST /api/app/push/devices`): the phone app's Expo token (ADR 0035), or this
 * browser's Web Push subscription (ADR 0071: its endpoint and keys, from `PushSubscription.toJSON()`).
 */
export type PushDeviceInput =
  | { platform: "ios" | "android"; token: string; locale: string }
  | { platform: "web"; endpoint: string; keys: { p256dh: string; auth: string }; locale: string };

/** What the feedback form sends (`POST /api/app/feedback`): `id` is made by the app, so a retry goes once. */
export interface FeedbackInput {
  id: string;
  text: string;
  /** The workspace the person is in. */
  orgId?: string;
  /** The screen they are on (a path), and the app that sends it. */
  where?: string;
  app?: string;
  /** The thing the feedback is about (a right click's), and what it says, as the form showed it. */
  about?: FeedbackAbout;
  /** What the app knows of where the person is, label and value, as the form listed it. */
  facts?: [string, string][];
  /** Files added with `uploadFeedbackFile`. */
  files?: string[];
}

/**
 * `message.meta.feedbackOffer` (server-made): a report about the app the agent offered on its own, under its reply.
 * Only `forUserId` sees its row and decides it (`decideFeedbackOffer`); `auto`: it went with the reply, because they
 * chose Always send.
 */
export interface FeedbackOffer {
  id: string;
  forUserId: string;
  /** The problem in a few words, as the row's one line. */
  summary: string;
  /** The report, as the email carries it. */
  text: string;
  state: "offered" | "sent" | "dismissed";
  auto?: true;
  decidedAt?: string;
}

export interface FeedbackAbout {
  /** The app's own word for the thing: `message`, `card`, `button`… */
  kind: string;
  /** Its name on screen: an author, a title. */
  label?: string;
  text?: string;
}

/** A picture or a video added to the feedback being written (`POST /api/app/feedback/files`). */
export interface FeedbackFile {
  id: string;
  name: string;
  size: number;
  kind: "image" | "video";
  contentType: string;
}

export interface AuthConfig {
  socialProviders: { google: boolean; github: boolean; apple?: boolean };
  signupOpen: boolean;
  firstRun: boolean;
  /** No account yet, and the first one only through the owner link (`/owner#claim=…`; absent: false). */
  ownerClaim?: boolean;
  /** "Esqueci a senha" can send its e-mail. */
  passwordReset?: boolean;
  /** Linked on the sign-in screen; the line shows only when both are set. */
  termsUrl?: string | null;
  privacyUrl?: string | null;
  /** Where people write to whoever runs this server (a workspace on hold or suspended); null: not given. */
  supportEmail?: string | null;
  /** The server takes feedback (`POST /api/app/feedback`): the apps show the form; absent: a server too old to. */
  feedback?: boolean;
  /** Every workspace gets a computer of its own (the Cloud); absent: a server too old to say. */
  workspaceComputer?: boolean;
  /** The billing service (ADR 0079): owners and admins open a workspace's plan there; null or absent: no billing. */
  billingUrl?: string | null;
  /** One of agentes.chat's own servers (`Instance.cloud`); absent: a self-hosted server too old to say. */
  cloud?: boolean;
  /** The bot check's site key (Cloudflare Turnstile, ADR 0075); null or absent: no check, nothing from Cloudflare. */
  turnstileSiteKey?: string | null;
  /** Where the app reports its own errors (a Sentry-compatible server, ADR 0104); null or absent: nowhere. */
  errorReports?: ErrorReportsConfig | null;
  /** The same for the phone app; null or absent (a server from before it): nowhere. */
  mobileErrorReports?: ErrorReportsConfig | null;
}

export interface ErrorReportsConfig {
  dsn: string;
  environment: string;
  release: string;
}

/** A workspace's use against its limits (ADR 0079, `GET …/limits`), for any member; a null limit: none. */
export interface WorkspaceLimits {
  /**
   * `limit`: the seats paid for. `max`: the most the plan takes with seats added (null: not said), below which
   * `canAddSeats`. `payer`: who pays, the only one who adds seats or changes plans (null: not said); `name` only to
   * anyone else who manages billing, while the payer is in the workspace. All absent from servers older than them.
   */
  members: {
    used: number;
    limit: number | null;
    max?: number | null;
    canAddSeats?: boolean;
    payer?: { you: boolean; name: string | null } | null;
  };
  /** `ownStorage`: new files go to the workspace's own bucket, which no limit counts. */
  storage: { usedBytes: number; limitBytes: number | null; ownStorage: boolean };
  uploads: { usedBytes24h: number; limitBytesPerDay: number | null };
}

/** Where in the app a billing link is opened from: the billing service opens on what it came for (ADR 0079). */
export type BillingFrom =
  | "settings"
  | "hold"
  | "onboarding"
  | "new_workspace"
  | "invite_full"
  | "upload_full"
  | "storage";

export type SignInProvider = "google" | "github" | "apple";

/** How an e-mail signs in: the sign-in screen asks for the e-mail first (`account.signInOptions`). */
export interface SignInOptions {
  account: boolean;
  /** The account has a password. */
  password: boolean;
  /** Social sign-ins linked to the account. */
  providers: SignInProvider[];
  /** No account, and this e-mail may create one. */
  canSignUp: boolean;
  /** The page's early-access link is for this address, and it expired. */
  accessExpired?: true;
}

/** `GET /api/instance`: what the phone and desktop apps check before using a server. Public, nothing secret. */
export interface Instance {
  /** Always "agentes.chat". */
  name: string;
  version: string;
  /** The app API contract the server speaks, and the oldest one it still serves. */
  api: number;
  minApi: number;
  /** The server's own address (`PUBLIC_URL`), the only one its realtime accepts. */
  url: string;
  /** Where to get the server's source code (AGPL-3.0 section 13; absent: an older server). */
  sourceUrl?: string;
  signIn: { email: boolean; google: boolean; github: boolean; apple: boolean };
  signup: "open" | "invite";
  /** No account yet, and the first one only through the owner link the setup printed (absent: false). */
  ownerClaim?: boolean;
  /** One of agentes.chat's own servers: `/terms` and `/privacy` are agentes.chat Cloud's (absent: an older server). */
  cloud?: boolean;
}

/** "Abrir no celular": a sign-in for the phone, single use, a few minutes long. */
export interface PhoneSignIn {
  token: string;
  /** The server's own address (`PUBLIC_URL`). */
  server: string;
  /** Seconds it lasts from the answer: counted on the device's clock, which may disagree with the server's. */
  expiresIn: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Signs in with a password (false: only Google or Apple, or the desktop app that runs the server). */
  hasPassword?: boolean;
  /** Opened the link that confirms the email address. */
  emailVerified?: boolean;
  /**
   * A new workspace would be made for them (false on agentes.chat Cloud while sign-up is by invitation, unless early
   * access allowed them; `org.create_refused` and `org.create_unpaid` can still refuse it).
   */
  canCreateWorkspace?: boolean;
  /** They deleted this account: the apps show only its waiting screen. `dueAt` is null once the date passed. */
  deletion?: { dueAt: string | null; requestedAt: string | null };
  /** The app's language for emails, pushes and every device (ADR 0122); null before any app said one. */
  locale?: string | null;
  /** The language follows each device's own (Automático) until the person picks one. */
  localeAuto?: boolean;
  /** Their own area, asked once during the onboarding (`WORK_AREAS`), or `skipped`; null until asked. */
  workArea?: string | null;
}

/** ADR 0056 §8: `hold` pauses the agents, `suspended` closes the workspace. */
export type StandingState = "active" | "hold" | "suspended";

/** What a member is told of the workspace's standing: `reason` only when the people who run the server show it. */
export interface OrgStanding {
  state: StandingState;
  reason: string | null;
  /** agentes.chat Cloud: a reason reads with how to contest it, and `review` as the automatic hold's line. */
  cloud?: boolean;
}

export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
  /**
   * Everything the person may do here, resolved by the server from their roles (ADR 0085): read it with `can`
   * (lib/permissions). Absent: nothing past reading.
   */
  permissions?: string[];
  /** Their highest role's position (0 the top), null with none: they manage the roles and people below it. */
  rank?: number | null;
  /** The workspace logo (`/api/app/org-logos/…`); null or absent = the agent mark. */
  logo?: string | null;
  /** From `GET /me`: when it was made. Absent from older servers. */
  createdAt?: string;
  /** From `GET /me`; absent from older servers (active). Changes come as `org.standing` events. */
  standing?: OrgStanding;
  /**
   * From `GET /me`, to its owner only, while they haven't finished setting it up: the apps open its onboarding,
   * which resumes it, instead of the workspace. Absent: finished, not theirs to set up, or an older server.
   */
  onboarding?: OrgOnboarding;
  /** From `GET /me` while an owner's deletion is pending, set at once by `org.deleting`: the workspace is closed. */
  deletion?: OrgDeletion;
  /** From `GET /me`: what opens when the app starts here (ADR 0108). Absent from older servers: the home. */
  start?: StartChoice;
  /** From `GET /me`: whether I see what agents did under each reply. Absent (an older server): off. */
  showActivity?: boolean;
  /** How agents talk to me here (ADR 0147): null until I pick (they talk simply); absent from an older server. */
  agentStyle?: AgentStyle | null;
  /** How conversations look to me here: only what I chose (`chatLookOf`); absent from an older server. */
  chatPrefs?: ChatPrefs;
  /**
   * Who the workspace is for (ADR 0159): `team` or `personal`. Read it with `isPersonal` (lib/workspace-mode); absent
   * from an older server, which is a team's.
   */
  mode?: WorkspaceMode;
}

/** Who a workspace is for (ADR 0159): the server's `WORKSPACE_MODES`. */
export const WORKSPACE_MODES = ["team", "personal"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

/** How agents talk to a person (ADR 0147): the server's `AGENT_STYLES`. */
export const AGENT_STYLES = ["simple", "technical"] as const;
export type AgentStyle = (typeof AGENT_STYLES)[number];

/** What opens when the app starts in a workspace (ADR 0108): the app's home, where the person was, or a channel. */
export type StartPage = "home" | "last" | "channel";

export interface StartChoice {
  page: StartPage;
  /** With `channel`, else null. */
  channelId: string | null;
}

/** A workspace being deleted. Any owner restores it until `dueAt`. */
export interface OrgDeletion {
  /** When it goes for good; null once that date passed, while it is only being deleted. */
  dueAt: string | null;
  requestedAt: string | null;
  /** Who deleted it; null once their account is gone. */
  requestedBy: { id: string; name: string } | null;
}

/** What proves it's me before deleting (ADR 0088 §2): the code emailed to me, or my password where no email goes. */
export interface DeletionProofInput {
  code?: string;
  password?: string;
}

/** `GET /account/deletion`: what deleting my account would close, leave and remove. */
export interface AccountDeletionPlan {
  /**
   * Only I am in them: they close now and are deleted for good 7 days later. One being deleted already keeps its date
   * (`deletion.dueAt`, null once it passed).
   */
  closes: {
    id: string;
    name: string;
    /** What it holds, unless it's being deleted already. Absent from older servers. */
    agents?: number;
    messages?: number;
    deletion?: { dueAt: string | null };
  }[];
  /** Others are in them: I leave. */
  leaves: { id: string; name: string; role: Role }[];
  /** I'm their only owner, others are in them and they aren't being deleted: the account can't go yet (`sole_owner`). */
  soleOwner: { id: string; name: string }[];
  /** Computers I connected in the workspaces I leave, not in system mode: removed with the account. */
  computers: { orgId: string; id: string; name: string }[];
  /** Keys, connections and mailboxes I added to the workspaces I leave: the workspace's, so they stay. */
  staysBehind: { orgId: string; kind: "key" | "connection" | "mailbox"; name: string }[];
  /** I set up this server: its own settings will have no owner here, only in its environment (ADR 0073). */
  serverOwner: boolean;
}

/** Where a workspace's onboarding stands. */
export interface OrgOnboarding {
  /** The furthest step reached: where it resumes. */
  step: OnboardingStepId;
  /** #general, where the onboarding puts the agents and posts the first message. */
  generalChannelId: string;
}

export interface Me {
  user: User;
  organizations: OrgSummary[];
}

export interface Organization extends OrgSummary {
  context?: string;
}

/** What removing a member (or leaving) does (`GET …/members/{userId}/removal`). */
export interface RemovalPreview {
  /** Who answers for their agents from then on: whoever removes them, or the longest-standing other owner. */
  heir: { userId: string; name: string } | null;
  /** The agents they answer for. */
  agents: { id: string; name: string }[];
  /** Agents that think with a plan they signed in (or on their computer): they lose it. */
  losePlan: { id: string; name: string }[];
  /** The computers they connected here: removed. */
  computers: { id: string; name: string }[];
  /** Their routines still on: paused. */
  routines: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** The photo uploaded here (`PUT …/me/avatar`); wins over `image`. */
  avatarUrl?: string | null;
  role: Role;
  /** Their roles (`OrgRole` ids), not `everyone`. */
  roleIds?: string[];
  joinedAt: string;
  /** `@ana`: unique in the organization; mentions resolve by it. */
  handle: string;
  /** IANA zone (the organization's if the person didn't pick one). */
  timezone: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  /** Roles they get on accepting. */
  roleIds?: string[];
  expiresAt: string;
}

/** One of a workspace's roles (ADR 0085, `GET …/roles`). */
export interface OrgRole {
  id: string;
  /** `everyone`: the base every member holds ("Todos"), always last. */
  kind: "custom" | "everyone";
  name: string;
  /** A `ROLE_ICONS` icon name. */
  icon: string;
  /** One of the agents' colors (not sky): the role's mark is drawn in it. */
  color: string;
  /** 0 the highest. */
  position: number;
  /** Its keys; `administrator` grants every other one. */
  permissions: string[];
  mentionable: boolean;
  hoist: boolean;
  people: number;
  /** Whether you may change it (you manage roles and it is below your own). */
  editable: boolean;
  /** Whether you may give it to people: it is below your own. */
  givable: boolean;
}

/** A permission area: its "use" keys and every key (its "manage" level). */
export interface PermissionArea {
  id: string;
  use: string[];
  keys: string[];
}

export interface OrgRoles {
  roles: OrgRole[];
  areas: PermissionArea[];
  colors: string[];
  icons: string[];
}

export interface RoleInput {
  name: string;
  icon?: string;
  color?: string;
  permissions?: string[];
  mentionable?: boolean;
  hoist?: boolean;
}

export interface InvitationPreview {
  orgName: string;
  /** Empty for an org-wide invite link. */
  email: string;
  role: Role;
  kind?: "email" | "link";
  /** Who invited (their name), when known. */
  invitedBy?: string | null;
  /**
   * Who the workspace is for (ADR 0159): a personal one's page speaks of the person who invited, not of a team or of
   * its name. Absent from an older server and on one that no longer works: a team's words.
   */
  mode?: WorkspaceMode;
  /**
   * The workspace's logo, served for this invitation or link only (absent without one, or while it is paused or
   * being deleted).
   */
  logo?: string;
  /** The organization's first agents ("Theo, Ada, Lia e Atlas já trabalham lá"). */
  agents?: { id: string; name: string; appearance: { color: string; eyes: string; accessory: string } | null }[];
  /** How many more agents work there than `agents` names ("… e mais 2 já trabalham lá"). */
  moreAgents?: number;
  /**
   * A link turned off, expired, or whose workspace is paused, or an invitation to a workspace paused or being
   * deleted: nobody can ask or join with it (ADR 0068).
   */
  closed?: true;
  /** A link opened signed in: where that person stands (on a link that no longer works, only a member's). */
  you?: JoinStatus;
  /** An email invitation: until when it works. */
  expiresAt?: string;
  /** An email invitation: how its address signs in, so the page asks only what is missing (ADR 0090). */
  account?: { exists: boolean; password: boolean; providers: ("google" | "github" | "apple")[] };
  /** An email invitation to a workspace with no seat left, said before anyone makes an account (ADR 0090). */
  full?: true;
}

/** An email invitation that no longer opens (ADR 0090): accepted, or expired and who to ask. */
export type InvitationState =
  | { state: "accepted"; orgId: string; orgName: string; at: string }
  | { state: "expired"; orgName: string; invitedBy: string | null; at: string };

/** A signed-in person and a workspace's invitation link: in or not, and their latest request with its answer. */
export interface JoinStatus {
  member: boolean;
  /** Only when they are a member. */
  orgId?: string;
  email: string;
  request: { status: "pending" | "approved" | "denied"; reason: string | null } | null;
}

/** `invites.ask`: asking is all a link does; the admins answer. `emailed`: this server sends email. */
export interface AskToJoinResult {
  status: "pending";
  email: string;
  emailed: boolean;
  /** Asked with a `password` (ADR 0090): what this page keeps to sign in once approved (`invites.claim`). */
  key?: string;
}

/**
 * Where the request a page made stands (ADR 0090): waiting, in (once: `signIn` for the one-time sign-in), denied,
 * or closed (run out, turned off, or approved for an address that signs in as it always did).
 */
export type JoinClaim =
  | { status: "pending" }
  | { status: "in"; orgId: string; signIn: string }
  | { status: "denied"; reason: string | null }
  | { status: "closed" };

/** A suggestion a member made that still waits for the admins (ADR 0090). */
export interface MySuggestion {
  id: string;
  email: string;
  note: string | null;
  createdAt: string;
}

/**
 * A code emailed to `email` (ADR 0072's `invites.sendCode`, ADR 0088's deletion codes); another can go after `resendIn`
 * seconds.
 */
export interface CodeSent {
  email: string;
  resendIn: number;
}

/** A workspace's invitation link people can still ask with (admins). */
export interface InviteLink {
  id: string;
  /** Null for a link made before links could be shown again: it can only be turned off. */
  url: string | null;
  expiresAt: string;
  createdAt: string;
  /** Who made it (their name). */
  createdBy: string | null;
  /** Requests made through it, still waiting. */
  waiting: number;
}

/** Someone who asked to join through a link, waiting for an admin (ADR 0068). */
export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  /** Their words: shown here only, never in an email or a push. */
  note: string | null;
  /**
   * A code proved the address, or a confirmed account with it asked (ADR 0072). False only on a server without
   * email, or for a request typed before codes: approving can't add anyone at once then.
   */
  verified: boolean;
  /** @deprecated Read `verified`. Kept for phone builds from before it: approving lets an account in at once. */
  confirmed: boolean;
  /** The member who suggested this person (their name, ADR 0090): it came through no link. */
  suggestedBy?: string | null;
  createdAt: string;
  /** Closes unanswered after this. */
  expiresAt: string;
}

/** An approval: in at once, or an invitation to the address (`emailed: false`: hand them `url` yourself). */
export type JoinApproval = { outcome: "joined" } | { outcome: "invited"; url: string; emailed: boolean };

export interface Credential {
  id: string;
  /** "anthropic", "openai", …, "custom" (a workspace's own endpoint). */
  provider: string;
  label: string;
  keyHint: string;
  /** Last characters of the Anthropic workspace the key is scoped to, if set. */
  workspaceIdHint?: string | null;
  /** `custom` (ADR 0146): the endpoint's address, API and models. */
  endpoint?: { style: EndpointStyle; baseURL: string; models: EndpointModel[] };
  /** The agents that think with it, in a list of keys: what removing it would change. */
  usedBy?: { id: string; name: string }[];
  /** On a key just saved: `ok` a real call passed, `unchecked` the provider didn't say. */
  check?: "ok" | "unchecked";
  createdAt: string;
  revokedAt: string | null;
}

/** The API a workspace's own endpoint speaks: OpenAI's Chat Completions or Anthropic's Messages. */
export type EndpointStyle = "openai" | "anthropic";

/** Per million tokens, in US dollars. A cache price left out is the input's. */
export interface EndpointPrices {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** The last test call of a model: it called a tool, answered without one, or failed. */
export type EndpointCheckResult = "ok" | "no_tools" | "failed";

export interface EndpointModel {
  id: string;
  label?: string;
  /** Absent: unpriced (its calls cost 0, so no budget limits them). */
  prices?: EndpointPrices;
  check?: EndpointCheckResult;
}

export interface EndpointCheck {
  model: string;
  check: EndpointCheckResult;
  /** The server's words, when it failed. */
  error?: string;
}

/** Who can talk to an agent: everyone, some people, or only its owner. */
export type AudienceMode = "everyone" | "people" | "owner";

export interface AgentAudience {
  mode: AudienceMode;
  /** For `people` (the owner can always talk to it). */
  userIds: string[];
  /** For `people`: whoever holds one of these roles at the time (not `everyone`). Older servers leave it out. */
  roleIds?: string[];
  /** Other agents may consult it for people outside the audience (it answers them only). Absent = on. */
  consultable?: boolean;
}

/** A mailbox someone else gave the agent, which a wider audience takes from it (only its owner gives it again). */
export interface ForeignMailbox {
  accountId: string;
  address: string;
  ownerUserId: string | null;
  ownerName: string | null;
}

export interface Agent {
  id: string;
  name: string;
  handle: string;
  /** Handles it had before a rename: mentions still reach it by them, and no one else may take them. */
  previousHandles?: string[];
  role: string;
  instructions: string;
  model: string;
  ownerUserId: string | null;
  hasCredential: boolean;
  /** Admins only: its own monthly budget; null = the workspace default. Absent for members. */
  monthlyBudgetUsd?: number | null;
  /** This month's spend over its budget, in % (agent list). */
  budgetUsedPercent?: number;
  createdAt: string;
  /** Expected from the backend; absent = everyone. */
  audience?: AgentAudience;
  audienceMode?: AudienceMode;
  /** Whether I can talk to it (absent = yes). */
  canTalk?: boolean;
  /**
   * Whether I see how it works (its owner, who manages agents, whoever it answers); absent = yes (an older server).
   * Without it `instructions` is empty and its tools, memory, usage and activity are refused: only its public card.
   */
  seesDetails?: boolean;
  /** Its look (color, eyes, accessory), from the backend's allow-list. */
  appearance?: AgentLookInput;
  /** Who thinks for it (ADR 0032): the brain, a computer brain's model label, its computer (owner and admins). */
  brain?: AgentBrainLine;
  /** A built-in agent the product ships (ADR 0137): `right_hand`, the team's right hand. Null or absent for the others. */
  builtin?: "right_hand" | null;
  /** Responde a (ADR 0148 addendum): the agent it reports to; null or absent = its owner, else its setor's lead. */
  reportsToAgentId?: string | null;
  /** No longer in the team (ADR 0082): only its name, role and look, from `FormerAgent`. */
  former?: "archived" | "deleted";
  /**
   * It may send a sticker or a GIF (ADR 0091): when someone asks for one, and after a light reply as often as the
   * workspace allows. Absent: on (the default).
   */
  mediaReplies?: boolean;
  /** Its autonomy brakes (ADR 0131); absent from an older server (the defaults). */
  brakes?: AgentBrakes;
  /**
   * Its setup checklist at the top of its chat (ADR 0155 §2): the ready-made role it started from and the steps a
   * person confirmed. Null or absent: an agent made before it (none shows).
   */
  setup?: AgentSetupChecklist | null;
}

/**
 * A step of a new agent's setup checklist (ADR 0155 §2), in `SETUP_STEPS`' order, or of the right hand's first run
 * (§6: `about`, `team`, `ai`, `apps`, `people`, in `FIRST_RUN_STEPS`' order). Both in lib/setup-checklist.
 */
export type SetupStep = AgentSetupStep | "about" | "team" | "people";
/** A new agent's own steps (ADR 0155 §2). */
export type AgentSetupStep = "ai" | "apps" | "where" | "who" | "how";

/** A new agent's setup checklist (ADR 0155 §2). */
export interface AgentSetupChecklist {
  /** The ready-made role it started from (a `RoleId`, "support"); null: from scratch or made elsewhere. */
  role: string | null;
  /** The steps a person confirmed (chose in its dialog, or skipped). */
  done: SetupStep[];
  /** How it introduced itself on its card, in its own voice (ADR 0164): its first message says it. */
  hello?: string;
  /** The personal starter it began as ("clara", ADR 0159 §3): its first tasks. */
  starter?: string;
  /** The apps it was made to use (catalog connector ids) at their levels (ADR 0164): its checklist suggests them. */
  apps?: Record<string, "read" | "write">;
}

/** A costly step unrequested work needs a person's go for (ADR 0131 §3). */
export type CostKind = "pr" | "install" | "long";

/** What an agent may start that nobody asked for directly, and which agents it may call (ADR 0131). */
export interface AgentBrakes {
  /** Costly work nobody asked for: `ask` proposes it first, `go` does it. */
  costly: "ask" | "go";
  go: CostKind[];
  never: CostKind[];
  maxUnrequested: number;
  maxPrsPerHour: number;
  callAgents: "all" | "some" | "none";
  callAgentIds: string[];
  project: string;
  otherProjects: boolean;
}

/** The brakes an agent has when none were set (`autonomySettings`' defaults on the server). */
export const BRAKES_DEFAULTS: AgentBrakes = {
  costly: "go",
  go: [],
  never: [],
  maxUnrequested: 2,
  maxPrsPerHour: 3,
  callAgents: "all",
  callAgentIds: [],
  project: "",
  otherProjects: false,
};

/** An agent no longer in the team (archived or deleted): what its messages and reports still show. */
export interface FormerAgent {
  id: string;
  name: string;
  role: string;
  appearance: AgentLookInput | null;
  /** Deleted for good; false: archived (an admin may still delete it). */
  deleted: boolean;
}

/**
 * A named group of the workspace's agents (ADR 0083), shared by everyone in it: the sidebar's sections, shown as a
 * setor (ADR 0148). The list comes in the workspace's order; `agentIds` in the group's. An agent is in one group at
 * most.
 */
export interface AgentGroup {
  id: string;
  name: string;
  agentIds: string[];
  /** One of the roles' colors; absent from an older server (graphite). */
  color?: string;
  /** One of the roles' icons; absent from an older server. */
  icon?: string;
  /** Who leads it: its agents with no owner report to them on the org chart. */
  leadUserId?: string | null;
  /** Who covers for the lead. */
  backupUserId?: string | null;
}

/** What a setor's look and people may change to; null clears a person. */
export interface AgentGroupPatch {
  name?: string;
  index?: number;
  color?: string;
  icon?: string;
  leadUserId?: string | null;
  backupUserId?: string | null;
}

/** An agent on the team screen: what it can do. What it does comes from its instructions (`Agent`). */
export interface TeamAgent {
  id: string;
  name: string;
  handle: string;
  role: string;
  appearance: AgentLookInput | null;
  ownerUserId: string | null;
  /** Responde a: the agent it reports to (absent from an older server). */
  reportsToAgentId?: string | null;
  /** What it can do, as stable group keys (`drive`, `github`, `calendar`, `custom`…). */
  capabilities: string[];
  /** Working on something right now. */
  busy: boolean;
  /** The channels it is in that I may see, in the sidebar's order; absent from an older server. */
  channelIds?: string[];
  canTalk: boolean;
  /** Whether I see how it works (absent = yes); without it `capabilities` is empty. */
  seesDetails?: boolean;
}

/** Responde a: one agent and the agent it reports to (null: nobody, its owner then). */
export interface AgentLineChange {
  agentId: string;
  reportsToAgentId: string | null;
}

/** One agent asked another (`ask_agent`); the question itself stays private. */
export interface TeamConsultation {
  id: string;
  askerAgentId: string;
  targetAgentId: string;
  status: string;
  createdAt: string;
}

/** The team screen: agents, the people responsible for them, the last day's consultations. */
export interface Team {
  agents: TeamAgent[];
  people: { id: string; name: string; image: string | null }[];
  consultations: TeamConsultation[];
}

/** `Agent.brain`: shown next to its name instead of the API model when a computer thinks. */
export interface AgentBrainLine {
  kind: BrainKind;
  /** A computer brain's model ("Sonnet"); null for the model brain. */
  model: string | null;
  computer?: string;
  /** A plan account's provider (`zai`, `kimi`…), whose mark replaces the brain's; absent for the CLI's own sign-in. */
  provider?: string | null;
  /** On a plan: the account it thinks with ("Claude Team 2"; a computer's own sign-in by its plan, "Claude Max"). */
  account?: string;
  /** On a plan: that account's limits as last reported; absent: not known yet. */
  usage?: PlanUsage;
  /** Set to Rápida where that applies to what it thinks with; absent: standard speed. */
  speed?: "fast";
  /** An API brain on Automático: the maker its models come from, whose logo shows beside it. */
  maker?: string;
}

/** `appearance` as stored: the UI only draws known values. */
export interface AgentLookInput {
  color?: string;
  eyes?: string;
  accessory?: string;
}

export interface AgentInput {
  name: string;
  handle: string;
  role?: string;
  instructions?: string;
  model?: string;
  credentialId?: string | null;
  ownerUserId?: string | null;
  monthlyBudgetUsd?: number | null;
  audience?: AgentAudience;
  /** With `audience`: the mailboxes the person agreed it loses; losing another refuses the save (409). */
  mailLossSeen?: string[];
  appearance?: AgentLookInput;
  /** Created from an agent's proposal (its card's message id, ADR 0081): the card is marked created. */
  proposal?: string;
  /** Its stickers and GIFs after a light reply (ADR 0091); same permission as editing the agent. */
  mediaReplies?: boolean;
  /** The Autonomia it starts with (the last setup's, ADR 0094): only an admin or its own owner sends it. */
  autonomy?: CommandApproval;
  /** Editing only: its autonomy brakes (ADR 0131); the fields given change. */
  brakes?: Partial<AgentBrakes>;
  /**
   * Creating only: the ready-made role it starts from, for its setup checklist (ADR 0155 §2), and what its card said
   * (ADR 0164): how it introduced itself, the personal starter it began as, the apps it will use at their levels.
   */
  setup?: { role: RoleId | null; hello?: string; starter?: string; apps?: Record<string, "read" | "write"> };
}

/** A person's answer to an agent's proposal of costly work nobody asked for (ADR 0131 §3). */
export type CostlyDecision = "go" | "not_now" | "never" | "always";

/**
 * The AI a proposed agent starts with (ADR 0081): an account of the person it was proposed for that thinks for
 * no agent, else the workspace's model (it has a key), else none (connected after it is created).
 */
export type SuggestedAi =
  | {
      kind: "account";
      brain: "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";
      machineId: string;
      accountId: string;
      label: string;
    }
  | { kind: "model" }
  | { kind: "none" };

/** What an agent proposes, as "Criar agente" takes it. */
export interface AgentDraft {
  name: string;
  handle: string;
  role: string;
  instructions: string;
  appearance: Required<AgentLookInput> | null;
  /** Channels it joins: public ones, and private ones everyone who reads the card is in. */
  channelIds: string[];
  /** Its level on the workspace's connections (the connected apps' ids). */
  access: { connectionId: string; level: "read" | "write" }[];
  /** Mailboxes of the person who asked: only a mailbox's owner gives an agent access to it. */
  mail?: { accountId: string; address: string; level: "read" | "write"; ownerUserId: string }[];
  /** A routine of its own, created with it. */
  routine?: ProposedRoutine | null;
  ai: SuggestedAi;
}

/** The routine a proposal comes with, its schedule read when proposed (`rule`, else `cron`). */
export interface ProposedRoutine {
  name: string;
  prompt: string;
  /** As the agent wrote it. */
  schedule: string;
  rule: ApiRule | null;
  cron: string;
  timezone: string;
  /** English (the agent's); the apps say `rule` in the reader's language. */
  description: string;
  report: RoutineReport;
  access: RoutineAccess;
  /** The channel it reports in, which the agent must be in first (null: the creator's DM; absent on older cards). */
  reportsIn?: string | null;
}

/** What "Criar" on the card gave the agent of its draft (ids); the rest waits for who may give it. */
export interface ProposalApplied {
  channelIds: string[];
  connectionIds: string[];
  mailAccountIds: string[];
}

/** One agent on the right hand's team card (ADR 0137 §10). */
export interface TeamAgentDraft {
  name: string;
  handle: string;
  role: string;
  line: string;
  instructions: string;
  appearance: Required<AgentLookInput> | null;
  /** The channel it lives in, by name; empty: it lives in its DM with the person (a personal template, ADR 0159). */
  channel: string;
  routines: ProposedRoutine[];
  firstTask: string | null;
}

export interface TeamSkillDraft {
  name: string;
  title: string;
  description: string;
  body: string;
  /** Handles of the team's agents that get it. */
  agents: string[];
}

export interface TeamPlan {
  lead: string;
  agents: TeamAgentDraft[];
  /** Channel names the team creates. */
  newChannels: string[];
  skills: TeamSkillDraft[];
  /** The right hand's own weekly check. */
  weekly: ProposedRoutine | null;
  approvals: string;
  /** People named as working there, invited after. */
  invite: string[];
  template?: string;
}

/** The right hand's team card (`meta.actionCard`): several agents created in one click ("Criar o time"). */
export interface TeamProposalCard {
  kind: "team_proposal";
  forUserId: string | null;
  params: TeamPlan;
  state: "pending" | "creating" | "created" | "denied" | "superseded" | "undone";
  decidedByUserId: string | null;
  decidedAt: string | null;
  expiresAt: string;
  created?: {
    agentIds: string[];
    channelIds: string[];
    routineIds: string[];
    skillIds: string[];
    skipped: ("skills" | "weekly")[];
    noAi: string[];
  };
  /** The last try failed at `step`, creating nothing: `reason` in English, `status`/`code`/`params` to translate. */
  error?: { step: string; reason: string; status?: number; code?: string; params?: Record<string, unknown> } | null;
  undoneAt?: string;
}

/** A team template by business type ("Ver modelos de time"), in the person's language. */
export interface TeamTemplate {
  id: string;
  name: string;
  sub: string;
  description: string;
  team: TeamPlan;
}

/** `meta.replyChips` of a right hand's question: answers to tap, each sent as the person's own message. */
export interface ReplyChips {
  choices: string[];
  multiple: boolean;
  step: number;
  of: number;
}

/** An agent's proposal of a new agent (`meta.actionCard` of its card, ADR 0081). A person creates it or says no. */
export interface AgentProposalCard {
  kind: "agent_proposal";
  /** The right hand looked at it for the person it is for (ADR 0139 §2). */
  delegate?: CardDelegate | null;
  /** The person behind the run that proposed it. */
  forUserId: string | null;
  /** `firstTask`: what "Criar e testar" puts in the composer of the clicker's DM with the new agent (ADR 0137). */
  params: { draft: AgentDraft; why: string; firstTask?: string };
  /** `creating`: a person is creating it right now; `superseded`: a newer card for the same handle took its place. */
  state: "pending" | "creating" | "created" | "denied" | "superseded";
  /** When the person it is for, who can't create agents, sent it to whoever may ("Pedir a um admin"). */
  askedAt?: string;
  agentId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  /** Past it, a pending one is expired. */
  expiresAt: string;
  /** Created in one click: what it got. Absent when it was created from the review. */
  applied?: ProposalApplied;
  /** The routine made with it. */
  routineId?: string | null;
}

/** What a person decided on a proposal: all that `agent.proposal.updated` carries of its card. */
export type AgentProposalDecision = Pick<
  AgentProposalCard,
  "state" | "agentId" | "decidedByUserId" | "decidedAt" | "applied" | "routineId" | "askedAt"
>;

/** `GET …/agent-proposals/{messageId}`: the card, where it is and what the viewer may do. */
export interface AgentProposal extends AgentProposalCard {
  messageId: string;
  channelId: string;
  threadId: string | null;
  proposedByAgentId: string;
  expired: boolean;
  canDecide: boolean;
}

export interface Model {
  id: string;
  label: string;
  provider: string;
  /** Its context window in tokens: which context limits are worth offering with it. */
  contextWindow?: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** The workspace can use it (has a key for the provider). Expected from the backend; derived until then. */
  available?: boolean;
  /** In a long list (OpenRouter's): `true` is a good pick, shown first. Absent: a catalog model. */
  pick?: boolean;
  /** The size Automático uses it for on its provider's key, by default. */
  tier?: ModelTier;
  /** A workspace endpoint's model (ADR 0146): whose credential, under what name. */
  endpoint?: { credentialId: string; name: string };
  /** No prices known: its calls cost 0, so a budget can't count money for it. */
  unpriced?: boolean;
}

export interface AgentUsage {
  agentId: string;
  handle: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Channel {
  id: string;
  name: string;
  topic: string;
  visibility: "public" | "private";
  /** Private and limited to these roles (departments, ADR 0125): their people see it and may join. Empty or absent: public or invite only. */
  audienceRoleIds?: string[];
  isMember: boolean;
  /** Listed only because I'm an administrator (ADR 0151): off the sidebar until I open or join it. */
  seenAsAdmin?: boolean;
  createdAt: string;
  /** Who created it: may change it and its members, like admins. */
  createdByUserId?: string | null;
  /** Its sidebar category (ADR 0080); null or absent: on top, with none. */
  categoryId?: string | null;
  /** Order inside its category, from 0. */
  position?: number;
  /**
   * Channel list only (`chat.channels`): messages since you last read it
   * (since you joined, if never), not yours; a thread reply counts only in a
   * thread you follow. At most 100 (show "99+"); 0 when not a member.
   */
  unreadCount?: number;
  /** Channel list only: of `unreadCount`, the messages that mention you (counted even while muted). */
  mentionCount?: number;
  /** Channel list only: where the unread starts (when you last read it, or joined); null when not a member. */
  lastReadAt?: string | null;
  /** Channel list only: you muted it, so it never looks unread. */
  muted?: boolean;
  /** Channel list only: the latest top-level message; null when empty or not a member. */
  lastMessage?: ChannelLastMessage | null;
  /**
   * Channel list only: what I may do here with its exceptions (ADR 0134): send messages, wake its agents, manage it.
   * Absent (an older server): the workspace's keys decide.
   */
  can?: { post: boolean; callAgents: boolean; manage: boolean };
}

/** A key a channel may change for a role or a person (ADR 0134). */
export type ChannelKey = "post" | "talk_to_agents" | "manage_channels";
export const CHANNEL_KEYS: readonly ChannelKey[] = ["post", "talk_to_agents", "manage_channels"];

/** One exception of a channel: for a role (`everyone`, "Todos", too) or a person. */
export interface ChannelOverride {
  target: { type: "role" | "person"; id: string };
  allow: ChannelKey[];
  deny: ChannelKey[];
}

/** Who may join a channel, on creating it or changing it later. */
export interface ChannelInput {
  topic?: string;
  visibility?: "public" | "private";
  /** Private only: limits it to people holding one of these roles (ADR 0125); empty: invite only. */
  audienceRoleIds?: string[];
}

/** A `#channel` link's card (`chat.card`): what the channel is and who is in it. */
/** A pasted message link's pill (`GET …/messages/{id}/card`): where the message is and who wrote it, never its text. */
export interface MessageCard {
  id: string;
  channelId: string;
  /** The thread a reply is in; null for any other message. */
  threadId: string | null;
  kind: "channel" | "dm";
  /** The channel's name, or who else is in the DM. */
  name: string;
  author: string;
}

/** An archived channel the viewer may bring back (`GET …/archived-channels`). */
export interface ArchivedChannel {
  id: string;
  name: string;
  topic: string;
  visibility: "public" | "private";
  archivedAt: string;
}

/**
 * What an internal id written in a text names (`chat.idRef`), as its pill shows it: a file, a task, or a message (a
 * run's id: its reply; a background work's: its card). Only what the viewer may see; anything else is a 404 and the
 * text stays as written.
 */
export type IdRef =
  | {
      kind: "file";
      id: string;
      title: string;
      artifactKind: string;
      fileName: string | null;
      contentType: string | null;
    }
  | { kind: "task"; id: string; number: number; title: string }
  | { kind: "message"; message: MessageCard };

export interface ChannelCard {
  id: string;
  name: string;
  topic: string;
  visibility: "public" | "private";
  /** As on `Channel`. */
  audienceRoleIds?: string[];
  isMember: boolean;
  archived: boolean;
  /** People in it. */
  people: number;
  /** Agents in it. */
  agents: number;
}

/** A named group of channels in the sidebar, the same for everyone in the organization (ADR 0080). */
export interface ChannelCategory {
  id: string;
  name: string;
  /** Order in the sidebar, from 0. */
  position: number;
}

/** A channel's latest top-level message, for the conversation list. */
export interface ChannelLastMessage {
  id: string;
  authorType: "person" | "agent";
  authorId: string | null;
  /** Null when the author was deleted. */
  authorName: string | null;
  /** Plain text, at most 140 characters. */
  preview: string;
  /** A body the server wrote: show it in the reader's language (`previewBody`). Null for a plain message. */
  meta?: PreviewMeta | null;
  /** It was a GIF or a sticker (ADR 0091): with no text, `previewBody` says which. */
  mediaKind?: MediaKind | null;
  createdAt: string;
}

/**
 * A last-message preview's `meta` (channels, DMs, threads): the keys the chat reads to show a body the
 * server wrote in the reader's language (`bodyCode` + `bodyParams`, a cut-off run's notes, memory lines).
 */
export type PreviewMeta = Record<string, unknown>;

export type AuthorType = "person" | "agent";

export interface ChannelMember {
  type: AuthorType;
  id: string;
}

export interface Message {
  id: string;
  channelId: string;
  threadId: string | null;
  author: { type: AuthorType; id: string | null };
  body: string;
  mentionedAgentIds: string[];
  agentRunId: string | null;
  /** Attachments, e.g. `{ approvalId }` on an approval card. */
  meta?: Record<string, unknown>;
  /** Echo of the id the client sent, to reconcile an optimistic message (expected from the backend). */
  clientId?: string | null;
  /** Agent receipts on a person's message (expected from the backend). */
  receipts?: MessageReceipts;
  /** Reaction counts (expected from the backend in the message list; else loaded on hover). */
  reactions?: ReactionCount[];
  /** In lists: true when pinned in its channel (absent: not pinned); live via `message.pinned` / `message.unpinned`. */
  pinned?: boolean;
  /** Agents' messages: what the agent changed with it, as receipts with Undo; live via `message.actions`. */
  actions?: AgentAction[];
  /** A long work's anchor (`meta.longWork`, ADR 0121): its line; live via `agent.work`. */
  longWork?: WorkView;
  /** Client only: an optimistic message waiting for the server, or one that failed to send. */
  local?: "pending" | "failed";
  createdAt: string;
}

/** How an agent's question to another agent (`ask_agent`), or the work it handed it (`tell_agent`), ended. */
export type ConsultationStatus = "answered" | "expired" | "failed";

/**
 * A question to another agent (`ask_agent`), or work handed to one (`note`, `tell_agent`). Absent from servers
 * before notes were tracked: a question.
 */
export type ConsultationKind = "question" | "note";

/** `message.meta.consulted` on the asking agent's reply: one entry per agent it asked. */
export interface MessageConsultation {
  agentId: string;
  consultationId: string;
  /** A `consult_reply` notice of work handed off carries `note`. */
  kind?: ConsultationKind;
  status: ConsultationStatus;
  question: string;
  /** Only when answered. */
  answer: string | null;
}

/** Which agents saw a person's message, picked it up, and how their runs ended. */
export interface MessageReceipts {
  seenBy: string[];
  pickedBy: string[];
  handled: {
    agentId: string;
    runId?: string;
    status: RunStatus | "waiting_input" | "canceled";
    /** `no_ai`: it couldn't answer, it has no AI connected. */
    reason?: string;
    /** `failed` for another reason: why, as a run's error is worded (`runErrorText`). */
    errorCode?: string;
    errorParams?: Record<string, string>;
    /** `waiting_input` because its AI provider is down: it retries by itself. */
    outage?: true;
    /** `waiting_input` for its computer: in line for room (`queued`) or for it to come back (`away`). */
    computer?: "queued" | "away" | "line";
    /** `waiting_input` on its plan's limit or its budget: it answers when that renews. */
    usage?: "plan" | "budget";
    /** It ended without answering: passed and posted nothing, or canceled before it started. */
    passed?: true;
  }[];
  /** Agents it mentions that won't answer (they don't reply to this person). */
  blocked?: string[];
  /** Agents it only references as part of the request to another agent: no run, by design. */
  referenced?: string[];
  /** Nobody was asked: the organization has no AI connected. */
  noAi?: boolean;
  /** With `noAi`: it came in on a billing hold, to be answered after the plan. */
  kept?: boolean;
  /** Nobody was asked: the workspace used up its platform AI for the month, so only @mentions start agents. */
  platformCap?: boolean;
  /** Who picked the agents for it (ADR 0074); absent on a decision from before. */
  decidedBy?: DecidedBy;
  /** No step could read it and no rule fit: only a mention reaches an agent. */
  reason?: "mention_needed";
}

/**
 * Which step picked the agents for a message nobody mentioned (ADR 0074): Jev, the organization's small model
 * (its catalog id and provider), the author's own plan (`ownerId`: the author), or a rule. `coordinator` is only in
 * decisions stored before ADR 0137 retired the team's coordinator: the apps read it as `default`.
 */
export type DecidedBy =
  | { step: "jev" }
  | { step: "model"; model: string; provider: string }
  | { step: "plan"; brand: "claude" | "chatgpt"; ownerId: string }
  | { step: "rule"; rule: "reply" | "only_agent" | "follow_up" | "coordinator" | "default" | "alone" };

/**
 * Who picks the agents for a message nobody mentioned (`ai-status`, ADR 0074): `by` for the workspace, `mine` for
 * the person asking (a plan picks only for its owner's own messages). `off`: only mentions. `model`: the small
 * model while it picks. `noSmallModel`: with `rules`, the default key's provider, which has none (Kimi).
 */
export interface AiRouting {
  by: "jev" | "model" | "plans" | "rules" | "off";
  mine: "jev" | "model" | "plan" | "rules" | "off";
  model: string | null;
  noSmallModel: string | null;
}

/** What a person who met "no AI" asked for (Jev): a Connect dialog step; `any` and `task` open its first step. */
export type ConnectIntent = "claude" | "chatgpt" | "api_key" | "any" | "task";

/** `GET …/ai-status` (ADR 0061): whether each agent has an AI to think with, and whether the organization has any. */
export interface AiStatus {
  /** An agent that isn't archived is ready, or waits for its computer. */
  any: boolean;
  /** Who picks the agents (absent from an older server). */
  routing?: AiRouting;
  /** The organization has a key of its own, or the server's own Claude key. */
  apiKey?: boolean;
  /** Memory reflects on finished conversations: there is a summary model it can call (absent from an older server). */
  reflection?: boolean;
  agents: {
    agentId: string;
    /** `waiting`: its computer is away for now (not "no AI"). */
    state: "ready" | "no_ai" | "waiting";
    reason?:
      | "no_key"
      | "not_signed_in"
      | "no_computer"
      | "cli_missing"
      | "computer_away"
      | "computer_failed"
      | "cli_failed"
      | "plan_limit"
      | "model_limit"
      | "model_region"
      | "model_off"
      | "plan_inactive"
      | "commands_off"
      | "plan_not_shared"
      | "runner_outdated"
      | "plan_tools";
    /** Ready on an API key with Automático: the maker of the key it thinks with (`autoMakerOf`). */
    provider?: string;
  }[];
}

export type RunStatus = "queued" | "running" | "waiting_approval" | "done" | "failed";

/** What became of a person's message that reached a waiting run (`agent.run.wait_message`). */
export type WaitMessageOutcome = "resolved" | "woke" | "held";

/** A run the server still considers active in a channel (`GET …/channels/{id}/active-runs`). */
/** A question an agent asked from a conversation, still out (`GET …/active-runs`): the working line's "asking…". */
export interface OpenConsult {
  /** The asking run (it may have ended: the answer wakes the agent). */
  runId: string;
  agentId: string;
  consultedAgentId: string;
  channelId: string;
  threadId: string;
  /** When the question went out (ISO). */
  since: string;
}

/**
 * What a consulted agent waits on before it can answer: an approval, or a person's answer or secret (a person);
 * `computer`: its computer coming back (no one to ask); `agents`: its part done, what it handed on to other agents.
 */
export type ConsultationWait = "approval" | "input" | "computer" | "agents" | "outage";

/**
 * A question an agent asked another agent from a conversation, or work it handed one (`GET
 * …/channels/{id}/consultations`): drawn as one row before the reply of the run that asked ("Theo ⇄ Atlas · 2 min"),
 * with where each is and, once closed, the answer (shown only when opened).
 */
export interface RunConsultation {
  id: string;
  kind?: ConsultationKind;
  /** The asking run: its reply (`agentRunId`) shows the list. */
  runId: string;
  agentId: string;
  consultedAgentId: string;
  /** The consulted agent's run: the cards it posts here carry it (`agentRunId`), "ajudando o Theo". */
  consultedRunId: string | null;
  status: "open" | ConsultationStatus;
  /** Open, and the consulted agent waits: on a person, or for its computer to come back. */
  waiting: ConsultationWait | null;
  question: string;
  /** The answer once answered; why it couldn't once failed. */
  answer: string | null;
  /** Open: what the consulted agent posted in the agents' DM so far (ADR 0097). Older servers send none. */
  progress?: { posts: number; latest: string; at: string } | null;
  createdAt: string;
  answeredAt: string | null;
  expiresAt: string;
}

/**
 * One question opened beside the conversation that asked it ("Theo ⇄ Iris", `GET …/consultations/{id}`): the
 * question as it went into the agents' DM, the consulted agent's messages there and the cards it posted where the
 * person asked, oldest first. Read only.
 */
export interface ConsultationConversation {
  consultation: RunConsultation;
  messages: Message[];
}

export interface ActiveRun {
  runId: string;
  agentId: string;
  channelId: string;
  threadId: string;
  status: RunStatus;
  /** The message that started it (the live row goes right after it). */
  triggerMessageId?: string | null;
  startedAt?: string | null;
  /** Last sign of life from the worker. */
  heartbeatAt?: string | null;
  createdAt?: string;
  /**
   * How long the work it is doing now has taken, in milliseconds, as the server counts it (since it last went back
   * to work or last posted, else since it was created). A length, not a time: "thinking for …" counts on from it by
   * this device's clock. Absent on a server from before it.
   */
  workingMs?: number;
  /** Messages sent to it while it works that it hasn't read yet (the others steered into it, it read). */
  pendingMessageIds?: string[];
  /** A routine's run working in the background: it holds no conversation and shows no "trabalhando". */
  background?: boolean;
}

/** Real-time channel events (packages/engine/src/events.ts, docs/adr/0010-realtime.md). */
export type ChannelEvent =
  /** `message` is left out when too big for the server's pub/sub (read it over HTTP); its thread and run still come. */
  | {
      type: "message.created";
      channelId: string;
      messageId: string;
      message?: Message;
      threadId?: string | null;
      agentRunId?: string | null;
    }
  /** Someone joined or left, or an agent's way of replying changed (agents carry `autoReply`). */
  | {
      type: "channel.member_added" | "channel.member_removed" | "channel.member_updated";
      channelId: string;
      member: { type: "person" | "agent"; id: string; autoReply?: boolean };
    }
  /** Someone reacted or took it back: the message's reactions now (replace). */
  | { type: "message.reactions"; channelId: string; messageId: string; reactions: ReactionCount[] }
  /** A vote came in or the poll closed (ADR 0113). */
  | { type: "poll.updated"; channelId: string; poll: Poll }
  /** Someone changed what a live block shows, for everyone (ADR 0113): keep the newest `rev`. */
  | { type: "block.state"; channelId: string; block: BlockState }
  /** A choice card was answered (ADR 0124). */
  | { type: "choices.updated"; channelId: string; choices: Choices }
  /** A long work changed (ADR 0121): moved, updated, waiting, queued or ended. Its anchor's line redraws. */
  | {
      type: "agent.work";
      channelId: string;
      threadId: string | null;
      agentId: string;
      runId: string | null;
      work: WorkView;
    }
  /** An agent message's receipts changed (linked to it, undone or redone): its whole list now (replace). */
  | { type: "message.actions"; channelId: string; threadId: string | null; messageId: string; actions: AgentAction[] }
  /** A message was pinned here (`pins.list` has them all, newest first). */
  | {
      type: "message.pinned";
      channelId: string;
      messageId: string;
      threadId: string | null;
      pinnedByUserId: string;
      pinnedAt: string;
    }
  /** A message was unpinned. */
  | { type: "message.unpinned"; channelId: string; messageId: string }
  /** A person read this DM up to `lastReadAt` (DMs between people only: "Visto"). */
  | { type: "channel.read"; channelId: string; userId: string; lastReadAt: string }
  /**
   * A thread's state, title or context changed (ADR 0029). `thread` is the fresh view when the
   * server had it (its `canManage` is always false: read yours from the API). `messageIds`: messages
   * that left the channel (`moved`) or came back (`returned`).
   */
  | {
      type: "thread.updated";
      channelId: string;
      threadId: string;
      change: ThreadChange;
      state?: ThreadState;
      thread?: ThreadInfo;
      messageIds?: string[];
    }
  | ArtifactEvent
  /** From a server that still streams a reply's words: read only as "it writes" (the reply shows whole, once posted). */
  | {
      type: "agent.delta";
      channelId: string;
      threadId: string;
      runId: string;
      agentId: string;
      seq: number;
      text: string;
    }
  | {
      type: "agent.run";
      channelId: string;
      threadId: string;
      runId: string;
      agentId: string;
      status: RunStatus;
      error?: string;
      /** A failed run's reason by its code, as `run.finished` says it (`runErrorDetail`). */
      errorCode?: string;
      errorParams?: Record<string, string>;
      /** The message that started the run (anchors its live row). */
      triggerMessageId?: string | null;
      startedAt?: string | null;
      /** A routine's background run: never the conversation's working indicator. */
      background?: boolean;
      /** `waiting_input` parked on a provider outage: it retries by itself, nobody is asked. */
      outage?: true;
      /** `waiting_input` for its computer: in line for room (`queued`) or for it to come back (`away`). */
      computer?: "queued" | "away" | "line";
      /** `waiting_input` on its plan's limit or its budget: it answers when that renews, nobody is asked. */
      usage?: "plan" | "budget";
    }
  | { type: "approval.created" | "approval.decided"; channelId: string; approval: Approval }
  /** An agent's proposal of a new agent was decided (ADR 0081): the decision on its card (`meta.actionCard`). */
  | ({
      type: "agent.proposal.updated";
      channelId: string;
      threadId: string | null;
      messageId: string;
    } & AgentProposalDecision)
  /** An agent's event proposal was confirmed or dismissed: its card (`meta.calendarProposal`) as it is now. */
  | {
      type: "calendar.proposal.updated";
      channelId: string;
      threadId: string | null;
      messageId: string;
      proposal: CalendarProposal;
    }
  /** A report an agent offered was sent or turned down: its row (`meta.feedbackOffer`) as it is now. */
  | {
      type: "feedback_offer.updated";
      channelId: string;
      threadId: string | null;
      messageId: string;
      offer: FeedbackOffer;
    }
  /** The right hand's team card changed (ADR 0137 §10): the whole card. */
  | {
      type: "team.proposal.updated";
      channelId: string;
      threadId: string | null;
      messageId: string;
      card: TeamProposalCard;
    }
  /** A right hand's card of a workspace change was applied, dismissed or sent to whoever may: the whole card. */
  | {
      type: "action_card.updated";
      channelId: string;
      threadId: string | null;
      messageId: string;
      card: WorkspaceActionCard;
    }
  /** The right hand looked at a card for someone (ADR 0139): its `meta.actionCard.delegate` now. */
  | {
      type: "card.delegate";
      channelId: string;
      threadId: string | null;
      messageId: string;
      delegate: CardDelegate | null;
    }
  // ── Chat latency batch (packages/engine/src/events.ts) ──────────────────────
  /** An agent will answer: show "thinking" at once. `runId` is null when announced at post time. */
  | {
      type: "agent.thinking";
      channelId: string;
      threadId: string;
      agentId: string;
      runId: string | null;
      /** A routine's background run: never the conversation's working indicator. */
      background?: boolean;
    }
  /**
   * An agent asked another agent (`ask_agent`) and waits for it: "Dev está perguntando ao Infra…". `note`: it
   * handed it work (`tell_agent`): the reply that handed it shows it, not the working line.
   */
  | {
      type: "agent.consulting";
      channelId: string;
      threadId: string;
      runId: string;
      agentId: string;
      consultedAgentId: string;
      kind?: "note";
    }
  /** That question, or that work (`note`), came back (answered, expired or failed). */
  | {
      type: "agent.consulted";
      channelId: string;
      threadId: string;
      runId: string;
      agentId: string;
      consultedAgentId: string;
      status: ConsultationStatus;
      kind?: "note";
    }
  /**
   * A question or a hand-off still out changed without closing (the consulted agent waits on a person, is back at
   * work, or got more time while still at it): reload the list.
   */
  | {
      type: "agent.consultation";
      channelId: string;
      threadId: string;
      runId: string;
      consultationId: string;
    }
  /** A browser command waits for a shared browser profile another holds (ADR 0110); `wait: null` once it ended. */
  | {
      type: "agent.browser.waiting";
      channelId: string;
      threadId: string;
      agentId: string;
      runId: string;
      wait: BrowserProfileWait | null;
    }
  /** The agent's first words arrived. */
  | { type: "agent.typing"; channelId: string; threadId: string; agentId: string; runId: string }
  /** The agent stopped (done, failed or waiting for approval). */
  | { type: "agent.idle"; channelId: string; threadId: string; agentId: string; runId: string }
  | {
      type: "run.finished";
      channelId: string;
      threadId: string;
      agentId: string;
      runId: string;
      status: "done" | "failed" | "waiting_approval" | "waiting_input" | "canceled";
      /** `waiting_input` parked on a provider outage. */
      outage?: true;
      /** `waiting_input` for its computer: in line for room (`queued`) or for it to come back (`away`). */
      computer?: "queued" | "away" | "line";
      /** `waiting_input` on its plan's limit or its budget: it answers when that renews, nobody is asked. */
      usage?: "plan" | "budget";
      /** It ended without answering: on every message the run answers (a steered one too), as `message.handled`. */
      passed?: true;
      error?: string;
      /** The error as a code (`run.org_paused`…) and its values, to say it in the person's language. */
      errorCode?: string;
      errorParams?: Record<string, string>;
    }
  // ── Chat delivery (packages/engine/src/events.ts) ───────────────────────────
  /**
   * Handed to a computer brain mid-turn (Claude Code reads it at its next tool boundary), not
   * confirmed read yet: "Ada recebeu". `agent.run.read` follows once it is read.
   */
  | {
      type: "agent.run.delivered";
      channelId: string;
      threadId: string | null;
      agentId: string;
      runId: string;
      messageIds: string[];
    }
  /** Messages a run took but never read (it ended, failed, was stopped) went to a run of their own. */
  | {
      type: "agent.run.redispatched";
      channelId: string;
      threadId: string | null;
      agentId: string;
      runId: string;
      newRunId: string;
      messageIds: string[];
    }
  /** The run ended without posting (nobody called it by name and it had nothing to add): drop its row now. */
  | { type: "agent.passed"; channelId: string; threadId: string | null; agentId: string; runId: string }
  /**
   * A person's message reached a run that was waiting (browser help, another agent's answer, an approval).
   * `resolved`: it ended the wait; `woke`: the run stopped waiting and reads it now; `held`: it waits for
   * the decision on a card.
   */
  | {
      type: "agent.run.wait_message";
      channelId: string;
      threadId: string | null;
      agentId: string;
      runId: string;
      messageId: string;
      waitKind: string;
      outcome: WaitMessageOutcome;
    }
  /** A person is typing; drop it after `ttlMs`. */
  | { type: "user.typing"; channelId: string; threadId: string | null; userId: string; ttlMs: number }
  /** Who saw a message and who will answer. */
  | {
      type: "message.routed";
      channelId: string;
      messageId: string;
      seenBy: string[];
      pickedBy: string[];
      /** The run each picked agent answers with (new, steered into, or resumed by an answer). */
      runs?: { agentId: string; runId: string }[];
      /** Agents it mentions that won't answer. */
      blocked?: string[];
      /** Agents it only references (part of the request to another agent): no run, by design. */
      referenced?: string[];
      strategy?: "mention" | "dm" | "router" | "none";
      /**
       * `no_ai`: the organization has no AI connected. `mention_needed`: no step could pick an agent (no Jev, no
       * small model, no plan of the author, no rule): a mention still calls one. `platform_cap`: the workspace used
       * up its platform AI for the month, so only a mention gets one.
       */
      reason?: string;
      /** Who picked (ADR 0074). */
      decidedBy?: DecidedBy;
      /** With `no_ai`: the Connect step the message asked for, and whether it opens by itself (Jev ≥ 0.9). */
      intent?: ConnectIntent;
      provider?: string;
      autoOpen?: boolean;
    }
  /** The author's own plan is picking who answers (seconds): until `message.routed`. */
  | { type: "message.routing"; channelId: string; messageId: string; step: "plan" }
  | { type: "message.claimed"; channelId: string; messageId: string; agentId: string; runId?: string }
  | {
      type: "message.handled";
      channelId: string;
      messageId: string;
      agentId: string;
      runId?: string;
      status?: "done" | "failed" | "waiting_approval" | "waiting_input" | "canceled";
      /** `no_ai`: the agent has no AI to think with. */
      reason?: string;
      /** `failed`: why, as a run's error is worded (`runErrorText`). */
      errorCode?: string;
      errorParams?: Record<string, string>;
      /** `waiting_input` parked on a provider outage. */
      outage?: true;
      /** `waiting_input` for its computer: in line for room (`queued`) or for it to come back (`away`). */
      computer?: "queued" | "away" | "line";
      /** `waiting_input` on its plan's limit or its budget: it answers when that renews, nobody is asked. */
      usage?: "plan" | "budget";
      /** It ended without answering: passed and posted nothing, or canceled before it started. */
      passed?: true;
    }
  /** An agent asked a person something and waits (expected: `ask_user` tool; shape to confirm). */
  | {
      type: "question.asked" | "question.answered";
      channelId: string;
      threadId: string | null;
      question: AgentQuestion;
    }
  /** An agent asked a person for a secret, or the request closed (ADR 0027). */
  | {
      type: "secret.requested" | "secret.updated";
      channelId: string;
      threadId: string | null;
      secretRequest: SecretRequest;
    }
  /** An agent's browser request changed (ADR 0040 §6): someone took control, or it ended. The card is `meta.browserHandoff`. */
  | {
      type: "browser.handoff.updated";
      channelId: string;
      threadId: string | null;
      handoff: BrowserHandoff;
    }
  /** An agent changed its memory because a person asked (with an undo), or proposed a change. */
  | {
      type: "memory.updated";
      channelId: string;
      threadId: string;
      agentId: string;
      runId: string;
      update: MemoryUpdate;
    }
  /** A background task on a connected computer changed (`task` is its whole view: replace). */
  | { type: "machine.task"; channelId: string; threadId: string | null; task: MachineTask }
  /** A mission changed (ADR 0029): `change` says what; refetch the mission for the rest. */
  | {
      type: "mission.updated";
      channelId: string;
      threadId: string;
      missionId: string;
      status: MissionStatus;
      change: string;
      decision?: MissionDecision;
      review?: MissionReview;
      messageId?: string;
      planVersion?: number;
      file?: string;
    };

/**
 * Something landed on a task's activity (packages/engine/src/issues.ts): a comment or an event. It comes on the
 * task's channel, or as an org broadcast (no `channelId`) for a task with none.
 */
export type IssueActivityEvent = {
  type: "issue.comment";
  channelId?: string;
  issueId: string;
  activity: IssueActivity;
};

/** You followed or unfollowed a thread (on any of your devices). */
export type ThreadFollowEvent = { type: "thread.follow" } & ThreadFollow;

/** Events for one person (`{ type: "event", scope: "user" }` frames), e.g. approvals they can decide. */
export type UserEvent =
  | { type: "approval.created" | "approval.decided"; approval: Approval }
  | BudgetEvent
  | NotificationEvent
  | ThreadFollowEvent
  | VoiceDroppedEvent
  | { type: string };

// ── Approvals, connectors, scopes ─────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "refused" | "expired" | "canceled";

/** A sensitive action waiting for a person (apps/server/src/routes/app/approvals.ts). */
export interface Approval {
  id: string;
  /** Null when a mission's executor asked (`missionId`). */
  runId: string | null;
  /** A mission's executor asked (ADR 0029). */
  missionId?: string | null;
  agentId: string;
  channelId: string;
  /** Where its card is; null: the channel's main timeline. */
  threadId: string | null;
  /** The approval card in the chat. */
  messageId: string | null;
  tool: string;
  scope: string;
  /** "Merge PR #42 into main" (from the connector catalog). */
  title: string;
  detail: string;
  /** Exactly what will run if approved. */
  params: Record<string, unknown>;
  status: ApprovalStatus;
  expiresAt: string;
  createdAt: string;
  decidedByUserId: string | null;
  /** Decided by someone covering this person (ADR 0139): "Aprovado por Bruno, cobrindo Ana". */
  decidedForUserId?: string | null;
  decidedAt: string | null;
  reason: string | null;
  /** You are the agent's owner or an admin, and it is pending. */
  canDecide: boolean;
  /** The agent's owner (they and admins may decide). */
  ownerUserId?: string | null;
  /** When the approved action ran; null while it runs (or if it never did). */
  executedAt?: string | null;
  /** What the action returned once it ran (raw tool output, short). */
  result?: { ok: boolean; text: string } | null;
  /** The connector it goes through ("github") and its account. */
  connector?: string | null;
  connectorAccount?: string | null;
  /** The email itself, for mail drafts and sends; null for every other action. */
  email?: ApprovalEmail | null;
  /** Why it asks (ADR 0053 §8): what the agent found and why this action. Shown above the action. */
  why?: string | null;
  /** Asked while nobody watched: by a routine (its name) or by an unattended run. Null: a person was there. */
  origin?: ApprovalOrigin | null;
  issue?: { id: string; number: number; title: string } | null;
  /** One approval only: what the agent said at each turn before asking. */
  trail?: { text: string; at: string }[];
  /**
   * "Aprovar sempre" is offered: approving with `always` lets the agent run this server tool (each of these wrapped
   * actions; none: the tool itself) without asking again, with any values. Null or absent: not offered.
   */
  approveAlways?: { tool: string; actions: string[]; routineId?: string } | null;
  /** Approved ahead (`schedule_action`): when the routine's run does it by itself; null: it runs once approved. */
  runAt?: string | null;
  /** The routine whose run at `runAt` it is for. */
  routineId?: string | null;
  /** Approved ahead and not run yet, and you may withdraw it (`approvals.cancel`). */
  canCancel?: boolean;
  /**
   * Asked with `request_approval` (ADR 0126): who decides, in words ("Diretoria"), and whose request it was, who
   * decides it only as an approver by role (`requesterDecides`). Null or absent: any other approval.
   */
  approvers?: { label: string; requestedByUserId: string | null; requesterDecides: boolean } | null;
}

/** A kind of call the agent runs without asking, approved for good by someone who decides its approvals. */
export interface ApprovalRule {
  id: string;
  /** Null: a command on the agent's computer (`tool` is `command`, `action` its kind: `gh issue create`). */
  connectionId: string | null;
  /** The connection's name ("Composio"); null for a command. */
  server: string | null;
  /** The server's own tool name. */
  tool: string;
  /** How the workspace labelled that tool. */
  toolLabel: string;
  /** The wrapped action (`GITHUB_CREATE_AN_ISSUE_COMMENT`); empty: the tool itself. */
  action: string;
  createdByUserId: string | null;
  createdAt: string;
}

/** The email a mail approval writes (draft, send, reply, forward), as its card shows it. */
export interface ApprovalEmail {
  verb: "draft" | "send" | "reply" | "forward";
  /** The mailbox it goes through and its provider ("iCloud", "Gmail"; null: unknown). */
  mailbox: string;
  provider: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** The text, cut after 1500 characters. */
  body: string;
  /** The message it answers or forwards (its sender may be unknown). */
  original: { subject: string; from: string | null } | null;
}

/** Who asked when nobody was watching (`approvals.origin`). */
export type ApprovalOrigin = { kind: "routine"; routineId: string; routineName: string } | { kind: "unattended" };

export interface ScopeInfo {
  id: string;
  label: string;
  description: string;
  /** Using it always becomes an approval request. */
  sensitive: boolean;
}

/** Catalog groups: Desenvolvimento, Produto, Docs, Pagamentos, Suporte, Marketing, Automação, Redes sociais. */
export type ConnectorCategory =
  | "dev"
  | "product"
  | "docs"
  | "data"
  | "payments"
  | "sales"
  | "support"
  | "marketing"
  | "automation"
  | "social";

/** A connector agentes.chat knows (`GET /connectors/catalog`: ours and the one-click MCP servers, one per service). */
export interface ConnectorDef {
  id: string;
  label: string;
  description: string;
  /**
   * `catalog`: our connector with its own scopes (GitHub, Sentry, Linear);
   * `remote_mcp`: a server connected by its address in one click, the vendor's
   * official MCP server or the service through Composio (`via`), then the same
   * tools review as a custom server.
   */
  kind: "catalog" | "remote_mcp";
  category: ConnectorCategory;
  auth: ("oauth" | "api_key")[];
  /** Signs in with OAuth here: our OAuth app, the vendor's MCP OAuth, or Composio's. */
  oauthConfigured: boolean;
  /** Can be connected on this server; `false` shows "Em breve". */
  available: boolean;
  /** The vendor hasn't approved agentes.chat yet: greyed out with a lock, nothing to open. Older servers leave it out. */
  soon?: boolean;
  /** Connects through Composio (ADR 0107): its page signs in. Unavailable on a server without Composio. */
  via?: "composio";
  /** Where it connects, by the way this server picked (a `remote_mcp` entry's address). */
  serverUrl: string;
  /** Brand icon served by this app, null for a monogram: one color (`/connectors/github.svg`) or its maker's colors (`/brands/paypal.svg`). */
  iconUrl: string | null;
  /** Tint of the icon; null = the ink. */
  brandColor: string | null;
  scopes: ScopeInfo[];
  tools: { name: string; scope: string; sensitive: boolean }[];
}

export interface ConnectorCatalog {
  connectors: ConnectorDef[];
  builtinScopes: ScopeInfo[];
}

/** The organization's connection to a connector (no secrets). */
export interface Connection {
  id: string;
  connector: string;
  label: string;
  serverUrl: string;
  authType: string;
  accountLabel: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** OAuth scopes this sign-in lacks that the connector asks for now (GitHub's `project`). Older servers leave it out. */
  reconnectAdds?: string[];
  /** `needs_reconnect`: its sign-in stopped working, no tools until Reconectar. Older servers leave it out. */
  status?: "active" | "needs_reconnect";
}

/** An installation of our GitHub App bound to the organization (repository access for git and PRs). */
export interface GitHubAppInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  /** `all` or `selected` repositories. */
  repositorySelection: string;
  suspended: boolean;
  /** GitHub's page where that account's admins choose its repositories. Absent from an older server. */
  manageUrl?: string;
  createdAt: string;
}

/** The server's own GitHub App (ADR 0156), for its pinned owner: from env (read-only here), made from Settings, or none. */
export interface GitHubAppSetup {
  source: "env" | "settings" | null;
  slug: string | null;
  /** The app's page on GitHub. */
  htmlUrl: string | null;
  /** `invalid`: a saved app this server can't open (another `AGENTES_SECRET`). */
  state: "off" | "ok" | "invalid";
  /** No app yet: the manifest flow makes one. */
  canCreate: boolean;
  /**
   * The events agents hear that the app isn't subscribed to on GitHub (by GitHub's names), and its page there where
   * they're ticked. Absent when it has them all, or GitHub didn't answer.
   */
  events?: { missing: string[]; url: string };
}

/** `GET …/github-app`: whether the app can be installed here, the organization's installations, the server's app. */
export interface GitHubAppInfo {
  installable: boolean;
  installations: GitHubAppInstallation[];
  /** The server's pinned owner only; null for everyone else and on agentes.chat. */
  setup?: GitHubAppSetup | null;
  /** The server has no app and its owner can make one in Settings (never on agentes.chat). */
  ownerCreates?: boolean;
}

/** A repository the organization's GitHub reaches. */
export interface GitHubRepository {
  /** `owner/name`. */
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  updatedAt: string | null;
}

/** The repositories the organization's GitHub reaches (its connection and the app's installations), by account. */
export interface GitHubRepositories {
  connected: boolean;
  accounts: { login: string; type: string; repositories: GitHubRepository[] }[];
  truncated: boolean;
}

/** The organizations the GitHub connection reaches now (`null`: GitHub didn't answer) and GitHub's page to grant more. */
export interface GitHubOrgAccess {
  orgs: string[] | null;
  manageUrl: string | null;
}

/** One permission of an agent: a built-in scope (`connectionId: null`) or a connection's scope. */
export interface ScopeGrant {
  connectionId: string | null;
  scope: string;
}

/** `rule`: a lasting rule a person gave the agent (a permission, where to send things); `origin` says who and when. */
export type MemoryKind = "fact" | "decision" | "lesson" | "preference" | "rule";

export interface Memory {
  id: string;
  agentId: string;
  kind: MemoryKind;
  text: string;
  /** A lesson from something a person refused or corrected: `text` is what it is about (`memoryLine`). */
  how?: "refused" | "corrected" | null;
  /** "Written by Walter in #eng · Oct 12" (the server's English; `origin` has the parts). */
  source: string;
  origin?: {
    by: "person" | "app" | "agent" | "lesson" | "recorded";
    name: string | null;
    channel: string | null;
    at: string;
  };
  uses: number;
  lastUsedAt: string | null;
  pinned: boolean;
  archived: boolean;
  /** Came from an external, untrusted source (e.g. a public GitHub comment). */
  lowTrust: boolean;
  /** Backed by an outcome or a person; agent claims alone are not. */
  verified: boolean;
  /** The text this one replaced, if any. */
  supersedes: string | null;
  /** Set when a person edited it ("Editado por você · agora"). */
  editedByUserId: string | null;
  /** What the agent learned itself ("Aprendizados"); older servers leave it out. */
  learned?: boolean;
  /** A how-to it worked out. */
  howTo?: boolean;
  /** One plain line to show first; `text` holds the detail. */
  summary?: string | null;
  /** Its own how-tos, lessons and notes ("Como ela trabalha"): no receipt in the chat. */
  playbook?: boolean;
  /** Another memory says otherwise, until a person decides. */
  disputed?: boolean;
  /** Where it was learned. */
  channelId?: string | null;
  /** A `rule` the viewer may remove: its giver, the agent's owner or an admin. */
  removable?: boolean;
  updatedAt: string;
  /** `about: "me"` only: the viewer's message it came from ("Você disse hoje, nesta conversa"). */
  from?: { messageId: string; channelId: string; threadId: string | null; dm: boolean; at: string } | null;
}

export type ProposalStatus = "pending" | "accepted" | "refused";

/** An app a proposal turns on or off for an agent, as `request_permission` names it (`label` in English). */
export interface ProposalAccessLine {
  /** A built-in scope (`browser:use`) or `connector:<connectionId>`. */
  id: string;
  label: string;
  on: boolean;
}

/** A setting the right hand's card changes on an agent (ADR 0137). */
export type ProposalSettingField =
  | "model"
  | "ai_account"
  | "budget"
  | "owner"
  | "audience"
  | "channel_add"
  | "channel_remove"
  | "reply_mode"
  | "name"
  | "look"
  | "reports_to"
  | "archive"
  | "delete";

/**
 * One line of a settings card: `model` a model id; `ai_account` `{ brain, accountId }`; `budget` nano-USD a month or
 * null (the workspace's default); `owner` a user id; `audience` `{ mode, userIds, roleIds }`; `channel_add` /
 * `channel_remove` / `reply_mode` its seat in `channelId` (null: not in it, else whether it answers without a
 * mention); `name` its name; `look` `{ color, eyes, accessory }`; `reports_to` an agent id or null (Responde a);
 * `archive` true. `label`: the server's names for ids.
 */
export interface ProposalSettingLine {
  field: ProposalSettingField;
  from: unknown;
  to: unknown;
  channelId?: string;
  label?: { from?: string; to?: string };
}

export interface Proposal {
  id: string;
  /** The agent it changes; empty for the org context. */
  agentId: string;
  /** The agent that proposed it (older servers leave it out: `agentId`). */
  proposedByAgentId?: string;
  target:
    | { type: "agent_instructions"; agentId: string }
    | { type: "org_context" }
    | { type: "agent_role"; agentId: string }
    | { type: "agent_access"; agentId: string }
    | { type: "agent_settings"; agentId: string }
    | { type: "skill"; agentId: string; skillId: string; name: string };
  /** `agent_access`: each app turned on or off. */
  access?: ProposalAccessLine[] | null;
  /** `agent_settings` (the right hand's card, ADR 0137): each setting then and proposed. */
  settings?: ProposalSettingLine[] | null;
  /** The person who asked for it in conversation (null: memory promotions, older rows). */
  requestedBy?: { userId: string; name: string } | null;
  /** When the person who asked sent it to whoever may decide it ("Pedir a um admin"). */
  askedAt?: string | null;
  /** `agent_settings` once applied: its receipt, for Desfazer (`agentActions.undo`). */
  undoActionId?: string | null;
  title: string;
  why: string;
  /** How it came, said by `proposalWhy` in the person's language; `why` holds the words it is about, if any. */
  whyCode?: "refused" | "corrected" | "seen" | "skill" | "asked" | "budget" | "no_channel" | null;
  /** `type` names the source for translation; `where` is the server's English text. */
  evidence: {
    where: string;
    what: string;
    channelId?: string | null;
    type?: "outcome" | "human" | "agent" | "app" | "self";
  }[];
  /** `agent_role`: the role then and the one proposed; `agent_access`: both empty. */
  before: string;
  after: string;
  status: ProposalStatus;
  /** What it was made against changed since (or its agent left): it can no longer be accepted. */
  stale: boolean;
  /** You may make this change on the agent's page (the org context: you review memory). */
  canDecide: boolean;
  /** Who decides besides admins: the agent's owner, for its instructions and for access it only takes away. */
  decider: { type: "user"; userId: string; name: string } | { type: "admins" } | { type: "account_owner" };
  createdAt: string;
  decidedBy: { userId: string; name: string } | null;
  decidedAt: string | null;
}

// ── Management (apps/server/src/routes/app/management.ts) ────────────────────

export interface OrgSettings {
  name: string;
  /** Shared with every agent of the organization (start of every prompt). */
  context: string;
  /** Key that pays for router and summaries. */
  defaultCredentialId: string | null;
  routerModel: string | null;
  summaryModel: string | null;
  timezone: string;
  /** Admins only: monthly budget of every agent without its own (US$). Absent for members. */
  defaultAgentBudgetUsd?: number;
  /** Agents check what the team already did before acting outside (ADR 0064). On by default. */
  actionCheck: boolean;
  /** Per provider, the models Automático picks per tier where the workspace chose its own (ADR 0087). */
  autoModels: Partial<Record<string, Partial<Record<ModelTier, string>>>>;
  /** People can send GIFs in chat (ADR 0091); only with `gifsAvailable` too. On by default. */
  gifs: boolean;
  /** The most a GIF may be rated. */
  gifRating: GifRating;
  /** The agents' own stickers in the picker. On by default. */
  agentStickers: boolean;
  /** How often agents follow a light reply with a sticker or a GIF. */
  agentMedia: AgentMediaLevel;
  /** People can send voice messages (ADR 0100); only with `voiceAvailable` too. On by default. */
  voiceMessages: boolean;
  /** Read only: this server has a speech engine. */
  voiceAvailable: boolean;
  /** Read only: this server can search GIFs (it has a GIF provider). */
  gifsAvailable: boolean;
  /** Read only: this server can decide when agents send one (agents send none on their own without it). */
  agentMediaAvailable: boolean;
  /** Who the workspace is for (ADR 0159); absent from an older server, which is a team's. */
  mode?: WorkspaceMode;
}

/** `OrgSettings` the server works out itself: never in a PATCH. */
export type ReadOnlyOrgSettings = "gifsAvailable" | "agentMediaAvailable" | "voiceAvailable";

/** Automático's sizes: quick tasks, everyday work, hard work. */
export type ModelTier = "small" | "medium" | "large";

/** Sidebar counts. */
export interface OrgOverview {
  name: string;
  role: Role;
  people: number;
  agents: number;
  /** What the workspace's agents spent this month over the sum of their budgets, in %. */
  budgetUsedPercent: number;
  approvalsWaitingForMe: number;
  /** Open proposals the viewer can see and decide. */
  proposalsWaitingForMe?: number;
}

export interface Person {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  /** The photo uploaded here (`PUT …/me/avatar`); wins over `image`. */
  avatarUrl?: string | null;
  role: Role;
  /** Their roles (`OrgRole` ids), not `everyone`. */
  roleIds?: string[];
  joinedAt: string;
  lastSeenAt: string | null;
  /** Seen as connected: `presence` is online, away or busy. */
  online: boolean;
  /** `hidden` only for yourself; everyone else sees a hidden person as `offline` (ADR 0084). */
  presence: MemberPresence;
  /** What the person wrote they are doing; null = nothing (or its time is up). */
  status: MemberStatus | null;
  /** Only on your own row: what you picked (your `presence` reads offline while you aren't connected). */
  availability?: Availability;
  handle: string;
  timezone: string;
}

/** A person as others see them (ADR 0084). */
export type MemberPresence = "online" | "away" | "busy" | "out" | "hidden" | "offline";
/** What a person picks: `auto` = online while connected, `away`, `busy`, or `hidden` (offline to everyone else). */
export type Availability = "auto" | "away" | "busy" | "out" | "hidden";

export interface MemberStatus {
  text: string;
  emoji: string | null;
  /** ISO; null = until changed. */
  until: string | null;
}

/** `PUT …/me/status`: either part may be left out; `status: null` clears the line. */
export interface StatusInput {
  availability?: Availability;
  status?: { text: string; emoji?: string | null; until?: string | null } | null;
}

/**
 * An agent's presence, from its work (ADR 0084); an agent with no AI is drawn `offline` by the apps. `out`: out of
 * office (§12), its plan at its limit or its monthly budget spent until `status.until`.
 */
export type AgentPresence = "online" | "busy" | "away" | "out" | "offline";

/** What an agent's line says when the server picked it (ADR 0084 §8); worded by the app (`presence.agent.*`). */
export type AgentStatusKind =
  | "task"
  | "routine"
  | "mission"
  | "channel"
  | "browsing"
  | "coding"
  | "files"
  | "wiki"
  | "planning"
  | "data"
  | "mail"
  | "connector"
  | "computer"
  | "waiting_approval"
  | "waiting_answer"
  | "waiting_computer"
  | "queued_computer"
  | "waiting_plan"
  | "waiting_budget"
  /** Out of office (§12): its plan hit its limit; `until` when it is back. */
  | "out_of_plan"
  /** Out of office (§12): its monthly budget is spent; `until` the next month. */
  | "out_of_budget"
  | "provider_down"
  /** Background work (ADR 0121): `subject` its title where everyone may read it, `count` how many. */
  | "work";

/** An agent's line: its own words (`by: "self"`, `text`), or one the server picked for the run (`kind` + `subject`). */
export interface AgentStatusLine {
  by: "self" | "auto" | "wait";
  text: string | null;
  kind: AgentStatusKind | null;
  /** The task's title, the routine's name, the public channel, the connector… */
  subject: string | null;
  emoji: string | null;
  /** ISO; null = until the run ends. */
  until: string | null;
  /** Background work: since when. */
  since?: string;
  /** Background work: how many at once. */
  count?: number;
  /** Background work: a second title. */
  second?: string | null;
  /** One background work that waits: on what. */
  wait?: "approval" | "answer" | "plan" | "computer" | "line";
}

/** A long work (ADR 0121): the line under its anchor, its card's block and its agent's status. */
export interface WorkView {
  id: string;
  agentId: string;
  channelId: string;
  title: string;
  status: "queued" | "live" | "done" | "failed" | "canceled";
  /** While live: what its run does now. */
  state: "working" | "waiting_approval" | "waiting_input" | "paused" | "waiting_computer" | "queued" | null;
  how: "agent" | "auto";
  anchorMessageId: string;
  /** Where its updates are. */
  threadId: string | null;
  /** Where it was asked: its report is there. */
  homeThreadId: string | null;
  runId: string | null;
  requestedByUserId: string | null;
  startedAt: string;
  finishedAt: string | null;
  nextUpdateAt: string | null;
  lastUpdate: { text: string; at: string; seq: number } | null;
  /** Waiting on an answer: what its run asked, the message that holds the card, and who it is for. */
  question?: { text: string; messageId: string | null; requestedForUserId?: string | null } | null;
  plan: { id: string; text: string; state: "todo" | "doing" | "done" }[];
  issue: { id: string; number: number } | null;
  resultMessageId: string | null;
  queuePosition: number | null;
  pausedUntil: string | null;
  canceledByUserId: string | null;
  errorCode: string | null;
}

/** `GET …/agent-status`: one agent's presence and its line. */
export interface AgentStatus {
  agentId: string;
  presence: AgentPresence;
  status: AgentStatusLine | null;
  /** Its last run's end (now while one is going); null = it never worked. */
  activeAt: string | null;
  /** Something of its own thinks now (a run, or long work at work). Absent from older servers. */
  working?: boolean;
}

export interface InvitationWithStatus {
  id: string;
  email: string;
  role: Role;
  roleIds?: string[];
  /** Channels it adds them to, besides #general (ADR 0090). */
  channelIds?: string[];
  status: "pending" | "expired";
  expiresAt: string;
  createdAt: string;
  /** Who sent it (their name). */
  invitedBy?: string | null;
  /** Its link, the same as the email's, to copy at any time (ADR 0090); null for one sent before that. */
  url?: string | null;
}

/** What the invite dialog sends (ADR 0090): each address with its roles, the channels and the note for all. */
export interface InviteBatch {
  emails?: string[];
  invites?: { email: string; roleIds?: string[] }[];
  roleIds?: string[];
  channelIds?: string[];
  note?: string;
}

export interface BatchInviteResult {
  email: string;
  status: "invited" | "already_member" | "invalid_email" | "already_invited";
  invitationId?: string;
  url?: string;
}

export interface AgentChannel {
  id: string;
  name: string;
  /** Answers without a mention in this channel. */
  autoReply: boolean;
}

export interface AgentDetail {
  id: string;
  name: string;
  handle: string;
  role: string;
  instructions: string;
  model: string;
  ownerUserId: string | null;
  /** Null = platform key (Cloud). */
  credentialId: string | null;
  /** This month's spend over its budget (its own, else the workspace default), in %. */
  budgetUsedPercent: number;
  /** Admins only: its own budget; null = the workspace default. Absent for members. */
  monthlyBudgetUsd?: number | null;
  /** Admins only, when it follows the default: the workspace default budget. */
  defaultBudgetUsd?: number;
  tokensThisMonth: number;
  runsThisMonth: number;
  failuresThisMonth: number;
  /** This month's runs and failures per day of the month (UTC); only days with runs. */
  runsByDay: { day: number; runs: number; failed: number }[];
  pendingApprovals: number;
  channels: AgentChannel[];
  createdAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  channelId: string;
  threadId: string;
  trigger: string;
  status: string;
  error: string | null;
  /** The error as a code (`run.budget_exceeded`…) and its values, to say it in the person's language. */
  errorCode?: string;
  errorParams?: Record<string, string>;
  /** Start of the message that started the run; empty when `private`. */
  what: string;
  /** The viewer isn't in the run's conversation: no `what` and no steps, only its numbers (older servers: absent). */
  private?: boolean;
  /** Started by one of the agent's routines, also when `private` (older servers: absent). */
  routine?: boolean;
  turns: number;
  /** Every input token, cache included. */
  inputTokens: number;
  /** How much of `inputTokens` was read from the prompt cache (older servers: absent). */
  cachedTokens?: number;
  outputTokens: number;
  createdAt: string;
  finishedAt: string | null;
  /** The GitHub repository it worked in (`owner/name`). */
  repo?: string | null;
  /** A GitHub repository it was refused (not in the agent's repositories). */
  deniedRepo?: string | null;
}

export interface RunStep {
  seq: number;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface UsageReport {
  since: string;
  /** Budget of agents without their own. */
  defaultAgentBudgetUsd: number;
  totalUsd: number;
  byKind: {
    kind: "agent" | "router" | "embedding" | "summary";
    calls: number;
    partialCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  agents: {
    agentId: string;
    handle: string;
    name: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    /** Its effective budget (own or the default). */
    monthlyBudgetUsd: number;
    budgetIsDefault: boolean;
    budgetUsedPercent: number;
  }[];
}

export interface RosterMember {
  type: AuthorType;
  id: string;
  name: string;
  handle: string | null;
  /** Agents: answers without a mention here. */
  autoReply: boolean | null;
  joinedAt: string;
}

/** `budget.warning` (80%) / `budget.exhausted` (100%), sent to the agent's owner. */
export interface BudgetEvent {
  type: "budget.warning" | "budget.exhausted";
  agentId: string;
  /** Share of the budget used (no money: owners may be members). */
  percent: number;
}

// ── Custom MCP servers (apps/server/src/routes/app/connectors-custom.ts) ─────

/** How a tool of a custom server may be used. `null` = not classified yet (hidden from agents). */
export type ToolAccess = "read" | "write" | "approval";
/** An admin's decision on a tool: how it may be used, or `off` (never offered, not asked again). */
export type ToolDecision = ToolAccess | "off";

export interface CustomTool {
  name: string;
  /** As the server describes it. */
  description: string;
  /** The server's `readOnlyHint` annotation, when it sends one. */
  readOnlyHint: boolean | null;
  /** Our suggestion until an admin decides (read-only → read, destructive/write-like → approval, else write). */
  suggestedAccess?: ToolAccess | null;
  access: ToolDecision | null;
  /** The decision, else the suggestion. */
  level?: ToolDecision;
  /** Where the suggestion came from: the server's hints, the name's verb, or the judge (ambiguous names). */
  suggestionSource?: "annotation" | "verb" | "preset" | "judge" | "judge_failed" | null;
  /** Why we suggest it, as a code (`spends_money`, `unknown`…): `toolReview.reason.*`. */
  suggestionReason?: string | null;
  /** Deletes, sends, pays…: only "Pede aprovação" or "Desligada". */
  sensitive?: boolean;
  /** The name couldn't decide it and no one confirmed the suggestion yet ("Precisam da sua decisão"). */
  pending?: boolean;
  off?: boolean;
  /** The readable name's parts (English words; the web says them in the person's language). */
  nameParts?: { verb: string | null; words: string[] };
  /** The resource it is about (`campaign`): tools are grouped by it. */
  subject?: string;
  /** Shown to people (approval cards, permissions), in pt-BR. */
  label: string;
  firstSeenAt: string;
}

export interface CustomServer {
  id: string;
  serverUrl: string;
  /** The account's name here ("Stripe (Acme)", "Stripe 2"): admins rename it. */
  label: string;
  /** The account as the provider names it ("Acme"), when it says. */
  accountLabel?: string | null;
  authType: "oauth" | "api_key";
  /** The server's own icon, kept and served by the backend (`/api/app/connector-icons/…`); null = a monogram. */
  iconUrl?: string | null;
  /** A service through Composio (ADR 0107): its address means nothing to people. */
  via?: "composio";
  /** `needs_reconnect`: its Composio account stopped working; no tools until Reconectar. Older servers leave it out. */
  status?: "active" | "needs_reconnect";
  /** Why its tools couldn't be read the last time they were listed (short); null or absent when they were. */
  toolsError?: string | null;
  tools: CustomTool[];
  /** What routines can wait on from it (ADR 0130). Older servers leave it out. */
  events?: RoutineConnectorTrigger["event"][];
  /** Last time an admin saved the classification; null = never (nothing exposed). */
  reviewedAt: string | null;
  createdAt: string;
}

/** The workspace's Composio calls this month (UTC): connectors and mailboxes together (ADR 0107 §7). */
export interface ComposioUsage {
  calls: number;
  /** The month's cap; null: none. */
  limit: number | null;
  /** `2026-11`. */
  month: string;
}

/** What connecting did: a new account, a new sign-in for one ("Reconectar"), or the same account again. */
export type ConnectOutcome = "connected" | "reconnected" | "same_account";

/** What connecting to a URL needs: OAuth (discovery + dynamic client registration) or an API key. */
export type CustomConnectStart =
  /** `outcome`: absent from an older server. */
  | { status: "connected"; server: CustomServer; outcome?: ConnectOutcome }
  | { status: "oauth"; authorizeUrl: string }
  /**
   * `not_approved`: it has OAuth but only lets in apps it approved, and agentes.chat isn't one yet. `detail`: how it
   * refused our registration, in its own words (`error: error_description`, short).
   */
  | { status: "needs_key"; reason?: "not_approved"; detail?: string };

// ── Knowledge (phase 5: apps/server/src/routes/app/knowledge.ts) ─────────────

export type SearchKind = "message" | "context_item" | "issue" | "file" | "wiki" | "action";

export interface SearchHit {
  kind: SearchKind;
  /** The message id, context item id, … */
  sourceId: string;
  channelIds: string[];
  title: string;
  snippet: string;
  score: number;
  createdAt: string;
  /** Message hits: who wrote it; action hits: the agent that did it. */
  author?: { type: AuthorType; id: string; name: string } | null;
  /** Message hits: the message (open it there) and its thread (null = the main timeline). */
  messageId?: string | null;
  threadId?: string | null;
  /** Message hits in a thread: its title (else its root message's first line); null on the main timeline. */
  threadTitle?: string | null;
  /** Message hits: a voice message (its snippet is empty, ADR 0100), a GIF or a sticker. `hitText` says which. */
  mediaKind?: MediaKind;
}

/** What a message has (ADR 0123): a link, a file, an image (an image file, a GIF, a sticker), a card. */
export type SearchHas = "link" | "file" | "image" | "card";
/** `relevance`: the best matches; `newest` / `oldest`: by date. */
export type SearchSort = "relevance" | "newest" | "oldest";

/** Search filters as the API takes them (ADR 0123; `lib/search-filters.ts` builds them from chips). */
export interface SearchFilterInput {
  in?: string[];
  fromUsers?: string[];
  fromAgents?: string[];
  mentionsUsers?: string[];
  mentionsAgents?: string[];
  has?: SearchHas[];
  author?: "person" | "agent";
  pinned?: boolean;
  /** ISO times: at or after, before. */
  after?: string;
  before?: string;
  sort?: SearchSort;
}

/**
 * `message.meta.teamChecks` (ADR 0064, server-made): outside actions the agent didn't repeat because the
 * team already did them. `agentId` null = it happened where the agent can't see: only "someone" and when.
 */
export interface TeamCheck {
  id: string;
  tool: string;
  /** What it touched, as people read it (`ana@acme.com`, `acme/app#212`). */
  targets: string[];
  matches: {
    agentId: string | null;
    agentName: string | null;
    channelId: string | null;
    channelName: string | null;
    summary: string | null;
    at: string;
  }[];
}

/** `message.meta.replyTo`: the message a quote reply answers, as it was when quoted (server-made). */
export interface ReplyRef {
  messageId: string;
  /** Its thread (null = the main timeline). */
  threadId: string | null;
  author: { type: AuthorType; id: string | null };
  authorName: string;
  excerpt: string;
  /** What it quotes was a GIF or a sticker (ADR 0091): the quote says so where its excerpt is empty. */
  media?: MediaKind;
  /** The original is gone: the server keeps nothing of it here. */
  deleted?: boolean;
}

// ── GIFs and stickers in chat (ADR 0091) ──────────────────────────────────────

/** A message's media: a GIF or one of an agent's stickers. */
export type MediaKind = "gif" | "sticker" | "voice";

/**
 * `message.meta.voice` (ADR 0100): the message is this recording. `message.body` holds its words for the agents; people
 * read them only by opening them in the player.
 */
export interface MessageVoice {
  clipId: string;
  durationMs: number;
  /** The wave, from 0 to 1. */
  peaks: number[];
  /** When the recording goes. The server may also answer 410 `voice.expired` before that. */
  expiresAt?: string;
  /** No engine could make out the words: there are none to open. */
  noWords?: boolean;
}

/** A recording I sent didn't become a message: nothing was said, or the conversation refused it. */
export interface VoiceDroppedEvent {
  type: "voice.dropped";
  clientId: string;
  channelId: string;
  reason: "silent" | "refused";
}

/** The agents' stickers, one animation per mood (`STICKER_MOODS` in `lib/media.ts`). */
export type StickerMood = "celebrate" | "love" | "deal" | "thinking" | "wow" | "dizzy" | "wave";

/** The GIF picker's chips (`GIF_CATEGORY_IDS` in `lib/media.ts`); the server searches each with its own words. */
export type GifCategory =
  | "celebrate"
  | "thanks"
  | "ok"
  | "applause"
  | "wow"
  | "coffee"
  | "good_morning"
  | "bye"
  | "friday"
  | "oops"
  | "thinking";

/** Which file of a GIF the server sends: a small one for the picker, the one a message shows, or a still frame. */
export type GifSize = "preview" | "full" | "still";

/** The most a GIF may be rated in the workspace: `g` (any age) or `pg` (up to 13). */
export type GifRating = "g" | "pg";

/** How often the workspace's agents follow a light reply with a sticker or a GIF. */
export type AgentMediaLevel = "never" | "sometimes" | "often";

/** `meta.media` of a GIF message: what the app needs to draw it, never a URL (the file comes from our server). */
export interface GifMedia {
  kind: "gif";
  provider: "giphy";
  id: string;
  /** The provider's title (outside text). */
  title: string;
  width: number;
  height: number;
}

/** `meta.media` of a sticker: each app draws it from the agent's look. */
export interface StickerMedia {
  kind: "sticker";
  agentId: string;
  mood: StickerMood;
}

/** `message.meta.media`: a message may have media and no text. */
export type MessageMedia = GifMedia | StickerMedia;

/** What `chat.post` takes for a message's media: the server looks a GIF up again and writes the real `meta.media`. */
export type PostMedia = { kind: "gif"; id: string } | { kind: "sticker"; agentId: string; mood: StickerMood };

/** A GIF the search found (`GET …/gifs`). */
export interface Gif {
  id: string;
  /** The provider's title (outside text). */
  title: string;
  /** Of the `full` file, in pixels. */
  width: number;
  height: number;
}

/** A page of GIFs; `next` is the offset of the next page (null: no more). */
export interface GifPage {
  gifs: Gif[];
  next: number | null;
}

/** A GIF search: free text, a category, or neither (what is trending); `lang` is the person's (two letters). */
export interface GifQuery {
  q?: string;
  category?: GifCategory | null;
  offset?: number;
  limit?: number;
  lang?: string;
}

/**
 * Act with undo (ADR 0037 round 2): what an agent changed with its reply,
 * shown as a receipt under the message. Say it with `agentActions.{kind}`
 * (pt-BR and en) and `params`. The same list as the engine's `AGENT_ACTION_KINDS`
 * (a test keeps them so), but a newer server can still send a kind this build doesn't know.
 */
export const AGENT_ACTION_KINDS = [
  "issue.created",
  "issue.updated",
  "issue.assigned",
  "memory.saved",
  "memory.updated",
  "memory.forgotten",
  "routine.created",
  "routine.updated",
  "routine.deleted",
  "channel.agent_added",
  "channel.created",
  "wiki.page_created",
  "wiki.page_edited",
  "thread.renamed",
  "thread.closed",
  "skill.created",
  "skill.updated",
  "agent.settings_changed",
  "pr.merged",
  "workspace.changed",
] as const;
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

/**
 * The right hand's catalog actions this build can word (`workspace.changed` receipts, its cards): the engine's
 * `WORKSPACE_ACTIONS` (a test keeps them the same). A newer server's action reads the plain sentence.
 */
export const WORKSPACE_ACTION_IDS = [
  "create_role",
  "update_role",
  "delete_role",
  "move_role",
  "set_member_roles",
  "set_channel_permissions",
  "set_my_status",
  "set_notifications",
  "set_my_timezone",
  "update_channel",
  "archive_channel",
  "channel_people",
  "delete_channel",
  "revoke_invitation",
  "resend_invitation",
  "set_invitation_roles",
  "decide_join_request",
  "stop_work",
  "continue_work",
  "update_workspace",
  "set_action_check",
] as const;

/** What the change was made to (link it: issue → Issues, wiki_page → Wiki, routine → Rotinas…). */
export interface AgentActionTarget {
  type:
    | "issue"
    | "memory"
    | "routine"
    | "channel"
    | "wiki_page"
    | "thread"
    | "skill"
    | "agent"
    | "repository"
    | "role"
    | "person"
    | "workspace";
  id: string;
  /** Issues. */
  number?: number;
  /** Issue, routine, wiki page or thread title; channel name (without `#`). */
  title?: string;
  /** Wiki pages. */
  slug?: string;
}

/**
 * Values for the sentence, by kind:
 * - `issue.created`: `number`, `title`
 * - `issue.updated`: `number`, `title`, `fields` (any of title, description, status, priority,
 *   assignee, labels, dueDate, criteria) and the new `status`, `priority`, `dueDate`, `labels`,
 *   `assigneeType`/`assigneeId`/`assigneeName`/`assigneeIsSelf` for the fields that changed
 * - `issue.assigned`: `number`, `title`, `assigneeType`, `assigneeId`, `assigneeName`, `assigneeIsSelf`
 * - `memory.saved`: `text` (and `previousText` when it replaced one); `memory.updated`: `text`, `previousText`;
 *   `memory.forgotten`: `text`
 * - `routine.created`: `name`, `rule` (an `ApiRule`, said in the person's language), `schedule` (the server's
 *   English words, never shown), `active`; `routine.updated`: `name`,
 *   `fields` (name, prompt, target, schedule, active), `active`, `schedule`
 * - `channel.agent_added`: `agentId`, `agentName`, `agentHandle`, `channel`
 * - `channel.created`: `name` (undo archives it)
 * - `pr.merged`: `repo`, and `number` (a pull request) or `ref` (a branch); nothing undoes it
 * - `wiki.page_created` / `wiki.page_edited`: `title`, `slug`
 * - `thread.renamed`: `from`, `to`; `thread.closed`: `title`
 * - `agent.settings_changed` (ADR 0137): `agentName`, `fields`, `proposalId` (the right hand's card, applied by the
 *   person who clicked: Undo puts each setting back; or one row applied at once from what they asked, `fields` then
 *   `instructions`, `role` or `apps`, ADR 0092 §5)
 */
export type AgentActionParams = Record<string, string | number | boolean | null | string[] | ApiRule>;

export interface AgentAction {
  id: string;
  kind: AgentActionKind;
  agentId: string;
  messageId: string | null;
  /** The person the agent worked for: they, admins and the agent's owner may undo (see `lib/actions`). */
  requestedByUserId: string | null;
  target: AgentActionTarget;
  params: AgentActionParams;
  createdAt: string;
  /** Desfazer (or Refazer, once undone) works until then; every undo or redo moves it 5 minutes ahead. */
  undoableUntil: string;
  /** Set while undone ("Desfeito por …", Refazer). */
  undoneAt: string | null;
  undoneByUserId: string | null;
  redoneAt: string | null;
}

/** One line of "O que fez por você" (`GET …/agents/{id}/for-you`). */
export type AgentForYouItem =
  | { type: "action"; at: string; channelId: string; action: AgentAction }
  | {
      type: "file";
      at: string;
      file: { id: string; kind: ArtifactKind; title: string; channelId: string | null; threadId: string | null };
    }
  | {
      type: "approval";
      at: string;
      approval: {
        id: string;
        title: string;
        status: ApprovalStatus;
        channelId: string;
        /** Where its card is; null: the main timeline. */
        threadId: string | null;
        /** Pending, and the viewer may decide it ("espera seu ok"). */
        waitingOnYou: boolean;
      };
    };

/** What an agent did for the viewer: their receipts, its files where both are, approvals on them; newest first. */
export interface AgentForYou {
  items: AgentForYouItem[];
  /** Items since the first day of this month. */
  monthCount: number;
}

/**
 * The right hand's card of a workspace change (`workspace_action`): an action of its catalog (`create_role`…) for whoever
 * may make it, applied as them. Its receipt, with Desfazer, lands on the card's message.
 */
export interface WorkspaceActionCard {
  kind: "workspace_action";
  forUserId: string;
  params: {
    /** The sentence: `rightHand.action.{action}` with `words`; done, `agentActions.workspace.changed_{action}`. */
    action: string;
    input: Record<string, unknown>;
    words: Record<string, string>;
    /** The key its screen asks for (the server checks it again); null: anyone. */
    needs: Permission | null;
    why: string;
    /** The person it was for tried and the screen's own rule refused them: they send it on, not apply it. */
    refused?: boolean;
    /** It changes whoever applies it (their own status…): only the person it was for may. */
    self?: boolean;
  };
  state: "pending" | "applied" | "dismissed";
  decidedByUserId: string | null;
  decidedAt: string | null;
  /** Sent to whoever may ("Pedir a quem pode"). */
  askedAt?: string | null;
}

/** `GET …/action-cards/{messageId}`: the card where it is, for its conversation or the inbox it was sent to. */
export interface WorkspaceActionCardView {
  messageId: string;
  channelId: string;
  threadId: string | null;
  card: WorkspaceActionCard;
}

/** `POST …/messages/{messageId}/actions/undo` (Desfazer tudo). */
export interface UndoAllResult {
  /** The message's receipts now. */
  actions: AgentAction[];
  /** Changes that could not be undone, with the error code (`action.changed_since`, …). */
  failed: { id: string; code: string; message: string }[];
}

export interface ReactionCount {
  /** `+1` / `-1` on agent replies are feedback for the agent. */
  reaction: string;
  /** People and agents together. */
  count: number;
  /** People who reacted. */
  userIds: string[];
  /** Agents who reacted instead of replying (the `react` tool). Older payloads may lack it. */
  agentIds?: string[];
}

/** A memory change an agent made because a person asked, or a proposal it made (`memory.updated`). */
export interface MemoryUpdate {
  action: "remembered" | "forgot" | "updated" | "proposed";
  itemId: string;
  text: string;
  previousText?: string | null;
  requestedByUserId: string;
  /** Undo: `POST …/memories/{itemId}/revert`. Absent for proposals. */
  undo?: { method: "POST"; path: string };
  /** For `proposed`: the proposal to decide inline (a card of several: the first). */
  proposalId?: string;
  /** For `proposed`: every proposal on the card, one per agent and kind of change. */
  proposalIds?: string[];
  canDecide?: boolean;
}

/** Who a direct message is with. */
export type DmTarget = { agentId: string } | { userId: string };

/** A direct conversation (`GET …/dms`). */
/** Where another person of a DM stopped reading ("Visto"). */
export interface DmRead {
  userId: string;
  lastReadAt: string;
}

export interface DirectMessage {
  channelId: string;
  with: { type: AuthorType; id: string; name: string; handle: string | null };
  /** `meta`: a body the server wrote, shown in the reader's language (`previewBody`); `mediaKind`: a GIF or a sticker. */
  lastMessage: {
    id: string;
    body: string;
    meta?: PreviewMeta | null;
    mediaKind?: MediaKind | null;
    createdAt: string;
    authorType: string;
  } | null;
  unread: number;
  /** Where the unread starts: when I last read it; null when I never did. Absent from an older server. */
  lastReadAt?: string | null;
  /** False until this person first reads it (server side, so on every device): the right hand waves then. */
  everRead?: boolean;
  /** When the DM began: where it sorts until its first message. Absent from an older server. */
  openedAt?: string;
}

/**
 * A question an agent asked (`ask_user`). Expected shape, to confirm when the
 * backend lands it: carried by `question.asked` and by the question message
 * (`meta.question` or `meta.questionId`).
 */
export interface AgentQuestion {
  id: string;
  agentId: string;
  channelId: string;
  /** The person message the agent's run answers (receipts: "esperando uma resposta"). */
  threadId: string | null;
  messageId: string | null;
  /** The run that asked: the receipt finds the message it answers (a channel question has no thread). */
  runId?: string | null;
  text: string;
  /** Buttons to answer with; null = free answer in the composer. */
  choices: string[] | null;
  /** The one person who may answer it; null or absent (an older server): anyone in the conversation. */
  requestedForUserId?: string | null;
  status: "open" | "answered";
  answer: string | null;
  answeredByUserId: string | null;
  /** The agent took it back: it no longer needs an answer. */
  withdrawn?: true;
  /** A person (`answeredByUserId`) skipped it: the agent went on without an answer. */
  dismissed?: true;
}

/**
 * Where a secret goes on the agent's computer (ADR 0027): a variable of its commands, a file in its folder, or
 * (`site`) only its browser's typing on that site (`https://host`), never its commands.
 */
export type SecretTarget = { kind: "env" } | { kind: "file"; path: string } | { kind: "site"; site: string };

/**
 * An agent asked a person for a secret for its computer (`request_secret`,
 * ADR 0027): carried by `meta.secretRequest` and `secret.requested` /
 * `secret.updated`. Never the value.
 */
export interface SecretRequest {
  id: string;
  agentId: string;
  channelId: string;
  threadId: string | null;
  messageId: string | null;
  /** The only person who can answer. */
  requestedForUserId: string;
  /** The agent's own name for it, for the box's binding: never shown. */
  name: string;
  /** What people read, in the agent's words. Null or absent: `secretLabel` derives one. */
  label?: string | null;
  purpose: string;
  target: SecretTarget;
  /** For a browser password: the only site it may be typed on (`https://host`). */
  site?: string | null;
  /** The connected machine that holds it. */
  machineId: string | null;
  /** The computer's key for this request; null once it is closed. */
  publicKey: string | null;
  status: "pending" | "delivered" | "declined" | "expired" | "canceled";
  expiresAt: string;
  deliveredAt: string | null;
  removed: boolean;
  /** The agent took it back: it no longer needs it. */
  withdrawn?: true;
  /** Why it closed with nobody answering. Null or absent: answered, expired, or closed before this was kept. */
  endReason?: "run_stopped" | "withdrawn" | "person_left" | "superseded" | "computer_changed" | null;
  /** The newer request that took its place. */
  supersededBy?: string | null;
  /** The agent already held this name on this computer: a delivery replaces that value. */
  replaces?: boolean;
  /**
   * A site's password: the username the agent will type with it, prefilled in the card's "Save to the Vault"
   * (ADR 0144). Absent on cards from before the Vault.
   */
  username?: string | null;
  /** A verification code: how many digits (one box each). Never saved to the Vault. Null or absent otherwise. */
  codeDigits?: number | null;
}

/** A secret on an agent's computer, by name (the agent page). */
export interface AgentSecret {
  /** What removing it goes by, never shown: people read `label`. */
  name: string;
  label: string;
  target: SecretTarget;
  machineId: string | null;
  deliveredAt: string;
  deliveredByUserId: string;
}

/** The value sealed in the browser to the request's key (`lib/secret-box.ts`). */
export interface SecretBox {
  v: 1;
  epk: string;
  iv: string;
  ct: string;
}

// ── File storage (expected: `GET/PUT …/storage`, `POST …/storage/test`, `…/storage/migrate`) ──

export type StorageKind = "agentes" | "s3";

/** What an admin types for "Seu próprio bucket". Keys empty = keep the stored ones. */
export interface S3Input {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string | null;
  pathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Where the server keeps the files of workspaces without a bucket of their own: its disk, its database or the bucket
 * its operator set. `folder`: that disk's folder, absolute, only where the server isn't in a container.
 */
export interface StoragePlatform {
  kind: "disk" | "database" | "bucket";
  folder: string | null;
}

/** What the workspace's files take, summed from the sizes recorded as they were written. */
export interface StorageUsage {
  /** On this server's storage (`platform`), files in the trash left out. */
  platformBytes: number;
  /** In the workspace's own buckets, the trash left out too. */
  ownBucketBytes: number;
  /**
   * The disk holding this server's files folder: its size and what is free. Null without a folder, and on the Cloud,
   * where that disk is every workspace's.
   */
  disk: { sizeBytes: number; freeBytes: number } | null;
}

export interface StorageConfig {
  kind: StorageKind;
  /** The bucket in use (keys never come back: only their last characters). */
  s3: (Omit<S3Input, "accessKeyId" | "secretAccessKey"> & { accessKeyIdHint: string; secretHint: string }) | null;
  migration: StorageMigration | null;
  platform: StoragePlatform;
  /** Absent from an older server. */
  usage?: StorageUsage;
}

export type StorageStep = "write" | "read" | "list" | "delete";

export interface StorageTestResult {
  ok: boolean;
  steps: { step: StorageStep; ok: boolean; error?: string | null }[];
}

export interface StorageMigration {
  status: "running" | "failed" | "done";
  copied: number;
  total: number;
  error?: string | null;
}

// ── Artifacts (expected: `…/artifacts`, events `artifact.created` / `artifact.updated`, `meta.artifacts`) ──

export type ArtifactKind = "document" | "table" | "diff" | "diagram" | "html" | "file" | "block" | "poll" | "choices";

/**
 * An uploaded file as is (ADR 0025): metadata only; the bytes come from the
 * download link. `text`: small UTF-8 text files only.
 */
export interface ArtifactFileContent {
  kind: "file";
  name: string;
  contentType: string;
  /** Bytes. */
  size: number;
  sha256: string;
  text?: string;
}

export interface ArtifactAuthor {
  type: "agent" | "person";
  id: string;
}

/** One file of a code change: a unified patch (`@@ -1,3 +1,4 @@` hunks). */
export interface ArtifactDiffFile {
  path: string;
  patch: string;
}

export type ArtifactContent =
  | { kind: "document"; markdown: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "diff"; files: ArtifactDiffFile[] }
  | { kind: "diagram"; mermaid: string }
  | { kind: "html"; html: string }
  /**
   * Parts the apps draw (`spec`, checked and drawn by `@agenteschat/ui/blocks/spec`), or the agent's own page (`html`),
   * which runs only when a person asks (ADR 0113). Exactly one of the two.
   */
  | { kind: "block"; spec?: Record<string, unknown>; html?: string; subtitle?: string }
  | { kind: "poll"; question: string; options: string[]; multiple: boolean }
  | { kind: "choices"; questions: ChoiceQuestion[] }
  | ArtifactFileContent;

/** One question of a choice card (ADR 0124): its options show as A, B, C…, then "Outra resposta". */
export interface ChoiceQuestion {
  question: string;
  options: { label: string; description?: string }[];
}

/**
 * A choice card's answer, once someone picked (`choices.updated`): the option of each question, in order; one past a
 * question's last option is a written answer, its text in `others` at that place.
 */
export interface Choices {
  id: string;
  answer: {
    userId: string;
    picks: number[];
    messageId: string | null;
    at: string;
    others?: (string | null)[];
  } | null;
}

/** Who set a block's value last; `drawn`: the server picked it among that many options. */
export interface BlockChange {
  by: string;
  name: string;
  at: string;
  drawn?: number;
}

/** What a live block shows, the same for everyone in its conversation (ADR 0113). */
export interface BlockState {
  id: string;
  version: number;
  state: Record<string, unknown>;
  changes: Record<string, BlockChange>;
  /** Goes up on every change: the newest one wins. */
  rev: number;
}

/** One person's mark in a poll: a row per option they chose. */
export interface PollVote {
  userId: string;
  option: number;
}

/** A vote among the people of a conversation (ADR 0113); its question and options are the artifact's content. */
export interface Poll {
  id: string;
  closesAt: string;
  closedAt: string | null;
  /** How many people can answer. */
  people: number;
  votes: PollVote[];
}

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** Latest version number (1, 2, …). */
  version: number;
  channelId: string | null;
  threadId: string | null;
  createdBy: ArtifactAuthor;
  updatedBy: ArtifactAuthor;
  createdAt: string;
  updatedAt: string;
  /** The viewer may save new versions (documents and tables; uploaded files by uploading again). */
  canEdit: boolean;
  /** HTML: render only in a sandboxed iframe (we always do). */
  untrusted: boolean;
  /** The creator, who asked the agent, the agent's owner and admins may delete it. */
  canDelete?: boolean;
  /** False for a block or a poll, which live in their conversation until someone keeps a block (ADR 0113). */
  inDrive?: boolean;
  /** Who can see it, from the conversation it came from (ADR 0111). */
  audience: ArtifactAudience;
  /** Who sees it on top of that conversation (ADR 0157); absent from an older server. */
  sharing?: ArtifactSharing;
  /** I may change `sharing`: it lives in a conversation not everyone reads, and I read it there. */
  canShare?: boolean;
}

/**
 * Who sees a file past where it lives (ADR 0157): nobody more (`conversation`), the people and roles listed and
 * administrators (`people`), or the whole workspace (`everyone`).
 */
export interface ArtifactSharing {
  mode: "conversation" | "people" | "everyone";
  userIds: string[];
  roleIds: string[];
}

export type ArtifactAudience =
  | { kind: "workspace" }
  /**
   * A public channel's files: anyone in the workspace may open them. `outside`: I don't read the channel, the file was
   * shared with me (ADR 0157), so there's no way into it.
   */
  | { kind: "channel"; name: string; private: boolean; outside?: true }
  /**
   * `with`: the other participant of the DM; `gone`: an archived agent or a person who left (the DM can't open).
   * `between`: I'm not in it, the file was shared with me (ADR 0157): its sides, no `with`, no way into it.
   */
  | { kind: "dm"; with: ArtifactAuthor | null; gone?: true; between?: ArtifactAuthor[] };

/** `GET …/artifacts-trash`: deleted files, kept for 30 days. */
export interface TrashedArtifact extends Artifact {
  deletedAt: string;
  /** After this it can't be restored (409 `artifact.purged`). */
  purgeAt: string;
}

export interface ArtifactVersion {
  version: number;
  author: ArtifactAuthor;
  /** "Corrigi os números de março". */
  note: string | null;
  createdAt: string;
}

/** An artifact at one version, with its content. */
export interface ArtifactDetail extends Artifact {
  /** The version shown (may be older than `version`). */
  shownVersion: number;
  content: ArtifactContent;
  /** It keeps versions (a history, "Enviar nova versão"): false for a snapshot such as a screenshot (ADR 0019). */
  versioned?: boolean;
}

/** `message.meta.artifacts`: what the agent created or changed in that reply. */
export interface ArtifactRef {
  id: string;
  version?: number;
  /** The file was deleted: the card shows "Arquivo removido". */
  deleted?: boolean;
  title?: string;
}

export interface ArtifactFilters {
  /** Words in the title, the text or the conversation's name. */
  q?: string;
  kind?: ArtifactKind;
  /** Any of these kinds. */
  kinds?: ArtifactKind[];
  channelId?: string;
  /** In any of these conversations. */
  channelIds?: string[];
  author?: ArtifactAuthor;
  /** `author` made or changed it (any version), not only made it. */
  changed?: boolean;
  /** Made or last changed by any of them. */
  authors?: ArtifactAuthor[];
  /** Made by an agent or by a person. */
  who?: "agents" | "people";
  /** Newest update first (default), by name, or by kind. */
  sort?: "recent" | "name" | "kind";
}

/** A page of the Drive: the next one starts at `nextCursor`; the first also counts the files per kind. */
export interface ArtifactPage {
  artifacts: Artifact[];
  nextCursor: string | null;
  /** First page only (older servers leave it out): how many files each kind has for the filters, kinds left out. */
  counts?: Partial<Record<ArtifactKind, number>>;
}

/** Channel event: an artifact was created or got a new version. */
export type ArtifactEvent = {
  type: "artifact.created" | "artifact.updated";
  channelId: string;
  artifact: Artifact;
};

// ── Issues, routines and calendar ───────────────────────────────────────────

/** A person or an agent (issues, routines, calendar). */
export type Actor = ArtifactAuthor;

export type IssueStatus = "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type IssuePriority = "low" | "normal" | "high";

export interface IssueCriterion {
  id: string;
  text: string;
  done: boolean;
  /** Who checked it (an agent shows its face next to it). */
  doneBy?: Actor | null;
}

/**
 * The assigned agent's work on an issue, from its runs: live (`running`,
 * waiting on a person) or `stalled` (in progress with the agent, no run alive).
 */
export interface IssueWork {
  agentId: string;
  runId: string | null;
  state: "running" | "waiting_approval" | "waiting_input" | "stalled";
  since: string;
  /** The run's last tool calls, oldest first; a computer command's check says when it was refused or waits. */
  steps: { tool: string; detail?: string; at: string; outcome?: "refused" | "waiting" }[];
  reason?: "failed" | "canceled" | "budget";
}

export interface Issue {
  id: string;
  /** Per organization: #131. */
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  /** Its board column, always one of its stage. */
  columnId: string | null;
  /** Order inside the column, lowest first. */
  boardRank: number;
  priority: IssuePriority;
  assignee: Actor | null;
  labels: string[];
  /** Day only, `YYYY-MM-DD`. */
  dueDate: string | null;
  criteria: IssueCriterion[];
  createdBy: Actor;
  /** Where it came from: "a partir de uma mensagem no #produto". */
  source:
    | { type: "manual" }
    | { type: "message"; channelId: string; messageId: string }
    | { type: "agent"; agentId: string }
    | { type: "webhook"; provider: string };
  /** The channel it lives in (from a message, or chosen). */
  channelId: string | null;
  /**
   * Who sees it besides administrators (ADR 0151). `channelId`: those people are whoever is in that conversation now.
   * Absent on an older server: as `everyone`.
   */
  audience?: { mode: "everyone" | "people"; userIds: string[]; channelId: string | null };
  pullRequests: { number: number; url: string; openedBy: Actor | null }[];
  /** The GitHub issue or pull request it is about: only a link, nothing syncs. */
  githubUrl: string | null;
  artifacts: { id: string; title: string; createdBy: Actor }[];
  work?: IssueWork | null;
  /** Background work stopped on something (ADR 0121): a badge, the card stays in its stage. */
  blocked?: { reason: string; since: string; text?: string } | null;
  /** The agent's background work this card tracks: its plan, last update and line (ADR 0121). */
  backgroundWork?: WorkView | null;
  /** Its conversation (ADR 0145), once opened or written: a thread of its own channel. */
  conversation?: IssueConversation | null;
  /** The issue this one is a sub-issue of. */
  parentIssueId?: string | null;
  /** On the detail: its sub-issues. */
  subIssues?: { id: string; number: number; title: string; status: IssueStatus; assignee: Actor | null }[];
  createdAt: string;
  updatedAt: string;
}

/** Where a task's conversation lives (ADR 0145): the chat's routes read and post to this thread. */
export interface IssueConversationRef {
  channelId: string;
  rootId: string;
}

/** A task's conversation as its card and dialog show it: its messages, who took part, an agent at work now. */
export interface IssueConversation extends IssueConversationRef {
  count: number;
  lastAt: string | null;
  /** The first ones to write, oldest first (at most 5). */
  participants: Actor[];
  working: boolean;
}

export interface IssueActivity {
  id: string;
  kind: "comment" | "event";
  author: Actor;
  /** Comment body, or the event in words ("asked Ada to implement"; English, the fallback). */
  text: string;
  /** Machine form of an event (`status_changed`, `assigned`, `agent_asked`, …). */
  event?: string;
  /** The event in the app's words: `issues.event.{textCode}` with `textParams`. */
  textCode?: string;
  textParams?: Record<string, string>;
  /** The system moved it on its own (the agent's runs, a linked PR). */
  auto?: boolean;
  /** Files attached to a comment (Drive). */
  attachments?: { id: string; title: string }[];
  createdAt: string;
}

export interface IssueInput {
  title: string;
  description?: string;
  criteria?: string[];
  assignee?: Actor | null;
  priority?: IssuePriority;
  dueDate?: string | null;
  labels?: string[];
  githubUrl?: string | null;
  /** Drive files uploaded from the new-issue box (only on create): linked to the issue. */
  attachmentIds?: string[];
  /** Who sees it (ADR 0151). Left out: the whole workspace. */
  audience?: AudienceChoice;
}

export type IssuePatch = Partial<
  Pick<
    Issue,
    "title" | "description" | "status" | "priority" | "assignee" | "dueDate" | "labels" | "boardRank" | "githubUrl"
  >
> & {
  /** Move to a board column: the issue takes that column's stage. */
  columnId?: string;
  /**
   * The whole list of acceptance criteria, in order (edited in place): an `id` keeps that criterion and its check,
   * one without is new, one left out is removed.
   */
  criteria?: { id?: string; text: string }[];
};

/** A board column: it sits in a fixed stage; `name` null shows the stage's own name. */
export interface IssueColumn {
  id: string;
  stage: IssueStatus;
  name: string | null;
  position: number;
}

export type RoutineEvent = "sentry.issue_created" | "github.pr_opened" | "issue.created" | "deploy.succeeded";

/**
 * The rule as the API sends it: monthly/yearly positions are in `byWeekday`
 * ("2TU", "-1FR"); yearly may carry `byMonth`; `"once"` means no repeat.
 */
export interface ApiRule {
  freq: "once" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  byWeekday?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number | null;
  times?: string[];
  timezone: string;
  start?: string | null;
  until?: string | null;
  count?: number | null;
}

/** `POST …/routines/parse-rule` and `…/describe-rule`. */
export type RuleInfo =
  | { ok: true; rule: ApiRule; description: string; cron: string; nextRuns: string[] }
  /** `code`: stable, for the app to say it in the UI language (`error` is the English fallback). */
  | { ok: false; error: string; code?: string };

export type RoutineTrigger =
  | {
      type: "schedule";
      /** Set when it was written as a phrase; routines made with the picker have only `rule`. */
      phrase?: string | null;
      rule?: ApiRule | null;
      cron: string;
      timezone: string;
      description: string;
    }
  | { type: "event"; event: RoutineEvent }
  /** A one-off (reminders, "amanhã às 9h"): fires once at `at`, then the routine is inactive. */
  | { type: "once"; at: string; timezone: string; description: string }
  | RoutineEmailTrigger
  | RoutineWebhookTrigger
  | RoutineConnectorTrigger;

/** A connector's event (ADR 0130): "Quando chegar um e-mail no MillionSend", from an inbox or all of them. */
export interface RoutineConnectorTrigger {
  type: "connector";
  connectionId: string;
  event: "millionsend.email.received";
  /** Null: every inbox of the team. */
  inboxId: string | null;
  /** `to`: the inbox's address ("Quando chegar um e-mail em vendas@…"). */
  filter: Pick<RoutineEmailFilter, "from" | "subject"> & { to?: string };
  /** `error`: the service refused the webhook (`lastError`); saving the routine again retries. */
  status: "active" | "error";
  lastError: string | null;
}

/**
 * "Quando o webhook for chamado" (ADR 0106): a call to the routine's own address starts it. `url` only for who may
 * manage it (null for everyone else); `signed`: calls must carry a signature of their body.
 */
export interface RoutineWebhookTrigger {
  type: "webhook";
  url: string | null;
  signed: boolean;
  /** The HTTP methods its address answers (POST by default; GET passes its query string as the run's data). */
  methods: RoutineHookMethod[];
}

export const ROUTINE_HOOK_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RoutineHookMethod = (typeof ROUTINE_HOOK_METHODS)[number];

/** How a call to a routine's address ended: `duplicate` repeated an idempotency key within 24 hours. */
export type RoutineHookOutcome = "accepted" | "duplicate" | "bad_signature" | "too_large" | "rate_limited";

export interface RoutineHookCall {
  id: string;
  at: string;
  outcome: RoutineHookOutcome;
  /** The HTTP status it got. */
  status: number;
  bytes: number;
  /** The routine run it went into. */
  runId: string | null;
  /** Sent with Testar. */
  test: boolean;
}

/** `GET …/routines/{id}/hook`: the address, whether calls are signed, the latest calls (newest first). */
export interface RoutineHook {
  url: string;
  signed: boolean;
  methods: RoutineHookMethod[];
  calls: RoutineHookCall[];
}

/** A service whose webhook brings routine events (`EVENT_WEBHOOK`). */
export type WebhookProvider = "github" | "sentry";

/** `GET …/webhooks/{provider}`: whether the service's webhook works here, and where and with what to set it up. */
export interface WebhookSetup {
  provider: WebhookProvider;
  /** Null: none made yet. */
  id: string | null;
  /** Where the service sends its events (who sets webhooks up). */
  url: string | null;
  /** GitHub's secret, to paste there (who sets webhooks up). Sentry signs with its own. */
  secret: string | null;
  /** The last call with a valid signature: it works. */
  receivedAt: string | null;
  /** The last call whose signature didn't match. */
  refusedAt: string | null;
  /** Sentry: its integration's Client Secret was pasted here. */
  secretSet: boolean;
  canManage: boolean;
  /** GitHub: the server may add the webhook to a repository itself (`addWebhookToRepo`). */
  oneClick: boolean;
}

/** "Quando chegar um email" (ADR 0038): new mail in a folder of a connected mailbox, optionally filtered. */
export interface RoutineEmailTrigger {
  type: "email";
  accountId: string;
  folder: string;
  filter: RoutineEmailFilter;
  /** The mailbox needs reconnecting (or the watch failed): the routine shows "Precisa reconectar". */
  status?: "active" | "needs_reconnect" | "error";
}

export interface RoutineEmailFilter {
  /** Addresses or `@domain`s. */
  from?: string[];
  /** Subject contains. */
  subject?: string;
  /** Body contains. */
  text?: string;
}

/** Where a routine created here delivers. */
export type RoutineTargetInput = { type: "channel"; channelId: string } | { type: "dm" } | { type: "artifact" };

/**
 * Also `conversation`: a thread or DM, from an agent's `schedule_reminder` or
 * `create_routine` in the chat. `reminder`: a plain reminder (the agent's
 * message mentioning `forUserId`, no run).
 */
export type RoutineTarget =
  | RoutineTargetInput
  | { type: "conversation"; channelId: string; threadId: string | null; reminder?: boolean; forUserId?: string }
  /** A widget's own routine (ADR 0135): it redoes the widget in place; changed from the widget, not here. */
  | { type: "widget"; widgetId: string; dashboardId: string };

/** Every routine acts with its agent's own permissions (ADR 0109); `read` is an old stored value the server reads as `act`. */
export type RoutineAccess = "read" | "act";
/** When a routine speaks: on every run (`always`), or only when there is news (`when_new`). */
export type RoutineReport = "always" | "when_new";

/**
 * Where a routine stands (ADR 0053 §11): `paused` (with `pausedReason`), `running` (a run working now),
 * `waiting_computer` (its run waits for the agent's computer: `waitingFor`), `waiting_person` (an approval
 * or an answer), `usage_paused` (its run waits on its plan or budget: `usagePause`), `failing` (its last runs failed: `failuresInRow`), `needs_webhook` (its event comes through a
 * GitHub or Sentry webhook the workspace doesn't have: it can't run yet).
 */
export type RoutineState =
  | "active"
  | "paused"
  | "running"
  | "waiting_computer"
  | "waiting_person"
  | "usage_paused"
  | "failing"
  | "needs_webhook";

/** Why the server paused a routine (the app says it, with its one-tap fix); null: a person paused it. */
export type RoutinePausedReason =
  | "creator_left"
  | "creator_no_access"
  | "agent_archived"
  | "agent_not_in_channel"
  | "audience"
  | "failing";

export interface Routine {
  id: string;
  name: string;
  agentId: string;
  /** What it does; null when the viewer may not see it (only its outcomes). */
  prompt: string | null;
  target: RoutineTarget;
  trigger: RoutineTrigger;
  active: boolean;
  /** Null when paused or event-driven. */
  nextRunAt: string | null;
  createdAt: string;
  access: RoutineAccess;
  report: RoutineReport;
  /** Connected-app actions its runs do without asking: the job its creator set it up for. Absent from older servers. */
  ownActions?: string[];
  /** A coded reason (`RoutinePausedReason`); anything else is shown as a plain pause. */
  pausedReason: string | null;
  failuresInRow: number;
  state: RoutineState;
  /** Its run waits for this computer since `since` (state `waiting_computer`). */
  waitingFor: { machineId: string; machineName: string; since: string } | null;
  /**
   * Its run waits on its plan or budget (state `usage_paused`, ADR 0118): paused near the limit, or stopped at it
   * (`limit`: nothing to continue). It picks up at `resetsAt` (null: not known yet); `plan` is the plan's name. `extraOff`: the plan's window is used up and the agent's long work may not use paid
   * extra usage, so Continuar agora is refused; `extraUsedUp`: the same with the switch on but no extra usage left.
   * Who may press it: `canManage`.
   */
  usagePause?: {
    source: "plan" | "budget";
    resetsAt: string | null;
    limit?: boolean;
    plan?: string | null;
    extraOff: boolean;
    extraUsedUp?: boolean;
  } | null;
  /** Who thinks for it, and on which computer (`machineName` null for the API). */
  brain: { kind: BrainKind; machineName: string | null };
  /**
   * The last 7 days: `ok` counts runs that reported; `skipped` slots that didn't run (replaced ones too);
   * `total` their sum, without the runs a person stopped.
   */
  health: { ok: number; silent: number; failed: number; skipped: number; missed: number; total: number };
  /** The viewer sees its prompt, records and reports (else only outcomes, without text). */
  canSeeDetails: boolean;
  /** The viewer may change, pause, run, stop or delete it. */
  canManage: boolean;
  /** Its creator, whose reach it has (kept on edit); null once they left. Absent from older servers. */
  createdByUserId?: string | null;
  lastRun: RoutineRun | null;
  /** The last runs, newest first (at most 14): the row's pixel strip and the horizon. */
  recentRuns: RoutineRun[];
  /** The last 7 days: tokens on a plan (Claude Code, Codex), cost on the API. */
  usage: { runs: number; tokens: number; costNanoUsd: number; billedTo: "api" | "plan" | "mixed" };
  /** Actions prepared for its runs that may still run (waiting for a person, or approved ahead), soonest first. */
  ahead?: RoutineAhead[];
  /**
   * A widget's routine (ADR 0135, target `widget`): the widget's title and board, to tag the row and open the widget
   * (its schedule and instructions are changed there). Absent for any other routine and from older servers.
   */
  widget?: { id: string; dashboardId: string; title: string } | null;
}

/** An action prepared ahead for one of a routine's runs (`schedule_action`): its approval, in short. */
export interface RoutineAhead {
  /** The approval. */
  id: string;
  tool: string;
  scope: string;
  title: string;
  params: Record<string, unknown>;
  status: "pending" | "approved";
  /** When its run does it by itself. */
  runAt: string;
  /** You may withdraw it. */
  canCancel: boolean;
}

/**
 * A routine run's state (`routine_runs`): working (`queued`, `running`, `waiting` for a person or the
 * computer), then one end: `reported` (it told people), `silent` (nothing new), `failed`, `canceled`
 * (a person stopped it), `superseded` (the next slot took its place), `missed` (too late to run) or
 * `skipped` (the slot never started a run).
 */
export type RoutineRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "reported"
  | "silent"
  | "failed"
  | "canceled"
  | "superseded"
  | "missed"
  | "skipped";

export interface RoutineRun {
  id: string;
  at: string;
  status: RoutineRunStatus;
  /** Why it ended this way (`stopped`, `previous_running`, `budget_exceeded`…): the app says it. */
  code: string | null;
  /** Values for the code's words (`stopped`: `by`, the person who stopped it). */
  codeParams?: Record<string, string>;
  /** The agent's own words for this run; '' when the viewer may not see text. */
  summary: string;
  /** Recent runs only: cost as a share (0–1) of the priciest recent run; never money. */
  weight?: number;
  /** The brain that ran it (`claude_code`, `codex`, `model`). */
  brain: string | null;
  /** The agent's message people saw ("Abrir na conversa"). */
  link: { channelId: string; threadId: string | null; messageId: string } | null;
  /** Waiting for this approval ("Esperando sua aprovação"). */
  approvalId?: string | null;
  finishedAt: string | null;
}

export interface RoutineInput {
  name?: string;
  agentId: string;
  prompt: string;
  target: RoutineTargetInput;
  trigger:
    | { type: "schedule"; phrase: string; timezone?: string }
    | { type: "schedule"; rule: ApiRule }
    | { type: "event"; event: RoutineEvent }
    | { type: "once"; at: string; timezone?: string }
    | Omit<RoutineEmailTrigger, "status">
    | { type: "webhook"; methods?: RoutineHookMethod[] }
    | Omit<RoutineConnectorTrigger, "status" | "lastError">;
  /** Ignored: every routine acts (ADR 0109). */
  access?: RoutineAccess;
  /** Default `when_new` ("Só quando tiver novidade"). */
  report?: RoutineReport;
}

/** `PATCH …/routines/{id}`: only what changed (`active: true` also clears a pause reason and a failure streak). */
export type RoutinePatch = Partial<Omit<RoutineInput, "name">> & {
  name?: string;
  active?: boolean;
  /** Replaces its own actions: taking one away is what undoes "Sempre nesta rotina". */
  ownActions?: string[];
};

/** Natural language → cron, in the workspace time zone (the backend decides). */
export type ScheduleParse =
  | { ok: true; cron: string; description: string; timezone: string }
  | { ok: false; error: string };

export type Recurrence = "none" | "weekdays" | "weekly" | "monthly";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  recurrence: Recurrence;
  participants: Actor[];
  /** Each invited person's answer. */
  rsvp: (Actor & { status: "needs_action" | "accepted" | "declined" })[];
  channelId: string | null;
  issueId: string | null;
  createdBy: Actor;
  /** Structured recurrence (`freq` once = a single event); day and time come from the event. */
  rule?: ApiRule | null;
  location?: string | null;
  /** All-day events: `YYYY-MM-DD`, the end inclusive. */
  startDate?: string | null;
  endDate?: string | null;
  /** An occurrence of a series: the series' id and this occurrence's original start. */
  seriesId?: string | null;
  occurrenceStart?: string | null;
  /** Days left out of the series (`YYYY-MM-DD`). */
  exdates?: string[];
}

/** Which occurrences an edit of a recurring event changes. */
export type SeriesScope = "this" | "following" | "all";

export type CalendarEventPatch = Partial<
  Pick<
    CalendarEventInput,
    | "title"
    | "description"
    | "start"
    | "end"
    | "allDay"
    | "startDate"
    | "endDate"
    | "timezone"
    | "participants"
    | "rule"
    | "location"
  >
>;

/** An agent's suggested slot; a person confirms before anyone is invited. */
export interface CalendarProposal {
  id: string;
  agentId: string;
  /** Who asked: they confirm it (or who configures the workspace). Absent on an older server. */
  requesterUserId?: string;
  title: string;
  start: string;
  end: string;
  participants: Actor[];
  /** "livre para todos". */
  note: string | null;
  status: "pending" | "confirmed" | "dismissed";
}

export interface CalendarReminder {
  id: string;
  message: string;
  at: string;
  forUserId: string;
  channelId: string;
  threadId: string | null;
  /** The agent that posts it. */
  agentId: string;
  /** The person who set it. */
  createdBy: string | null;
  canCancel: boolean;
}

export interface CalendarRange {
  events: CalendarEvent[];
  /** Scheduled routine runs in the range. */
  routines: { routineId: string; name: string; agentId: string; at: string; target: RoutineTarget }[];
  /** Pending reminders the viewer may see (absent on an older server). */
  reminders?: CalendarReminder[];
  /** Issues due in the range (all-day), with who has each (absent on an older server). */
  deadlines: { issueId: string; number: number; title: string; date: string; assignee?: Actor | null }[];
  proposals: CalendarProposal[];
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay?: boolean;
  /** IANA zone of the times (defaults to the workspace's). */
  timezone?: string;
  recurrence: Recurrence;
  participants: Actor[];
  channelId?: string | null;
  issueId?: string | null;
  rule?: ApiRule | null;
  location?: string | null;
  /** All-day: `YYYY-MM-DD`, the end inclusive. */
  startDate?: string | null;
  endDate?: string | null;
}

// ── Agent access (apps/server/src/routes/app/access.ts) ──────────────────────

/** `granted` explicitly, `inherited` from a broader grant ("all", the connector, the scope), `denied`, `off`. */
export type AccessState = "granted" | "inherited" | "denied" | "off";

export interface AccessTool {
  /** As exposed to the model ("github_merge_pull_request"). */
  name: string;
  /** Human name (pt-BR when the backend has one). */
  label: string;
  description: string;
  /** Only reads (built-in `:read` scopes, MCP `readOnlyHint`, or classified as read). */
  readOnly: boolean;
  connectionId: string | null;
  scope: string;
  /** Always asks a person, whatever the grant. */
  sensitive: boolean;
  state: AccessState;
}

export interface AccessScope {
  scope: string;
  /** pt-BR. */
  label: string;
  state: AccessState;
  tools: AccessTool[];
}

/** `GET …/agents/{id}/access`: built-ins, then connectors with their scopes and tools. */
export interface AgentAccess {
  /** "Todas as ferramentas (atuais e futuras)". */
  all: boolean;
  builtins: AccessScope[];
  connectors: {
    connectionId: string;
    connector: string;
    label: string;
    custom: boolean;
    state: AccessState;
    scopes: AccessScope[];
  }[];
}

export interface ToolRef {
  connectionId: string | null;
  name: string;
}

/** `PUT …/agents/{id}/access`: replaces the agent's grants. */
export interface AccessInput {
  all: boolean;
  /** Connection id → "all tools of this connector" (also future ones). */
  connectors: Record<string, boolean>;
  scopes: { connectionId: string | null; scope: string }[];
  tools: { allow: ToolRef[]; deny: ToolRef[] };
}

// ── Skills (apps/server/src/routes/app/skills.ts) ────────────────────────────

/** How it was installed: a zip, a link (GitHub), or written here. */
export type SkillSourceKind = "upload" | "url" | "manual";

export interface Skill {
  id: string;
  name: string;
  /** From SKILL.md's front matter: when to use it. */
  description: string;
  /** Every edit is a new version (1, 2, …). */
  version: number;
  source: SkillSourceKind;
  /** The link it came from (`url` skills). */
  sourceUrl: string | null;
  /** Which of the workspace's GitHub connections read its private repository; updating reads through it first. */
  sourceVia?: SkillVia | null;
  /** Turned on for agents created from now on. */
  defaultForNewAgents: boolean;
  metadata: Record<string, unknown>;
  /** `agent`: made from an agent's own how-tos (older servers leave it out). */
  origin?: "person" | "agent";
  ownerAgentId?: string | null;
  /** Agents can't change it; never archived for disuse. */
  locked?: boolean;
  useCount?: number;
  lastUsedAt?: string | null;
  /** "Atualizar sozinha": read from its link every day (older servers leave these out). */
  autoUpdate?: boolean;
  /** When its link was last read to update it. */
  checkedAt?: string | null;
  /**
   * An update from its link waiting for who manages skills: it adds or changes files that run (`scripts`), or would
   * replace what agents changed since (`edited`, left out by older servers).
   */
  pendingUpdate?: {
    scripts: string[];
    at: string;
    dismissed: boolean;
    /** When a person kept the skill as it is (`dismissed`); Desfazer makes it wait again (`reopenUpdate`). */
    dismissedAt?: string | null;
    edited?: boolean;
  } | null;
  /** Why its last update from its link failed: a code (`skill.no_skill_md`, `skill.connection_gone`…). */
  updateError?: string | null;
  /** Its last update from its link, or an agent's last change to it (`agentId`), while Desfazer can take it back. */
  lastUpdate?: {
    fromVersion: number;
    at: string;
    agentId?: string | null;
    /** A person chose this update while it waited: Desfazer makes it wait again. */
    waited?: boolean;
  } | null;
  /** "Agentes melhoram as skills sozinhos" set for this skill; null: the workspace's setting. */
  agentsImprove?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An update from a skill's link: `waiting` when it adds or changes files that run (`scripts`), which a person who
 * manages skills applies or refuses.
 */
export interface SkillSourceUpdate {
  status: "unchanged" | "updated" | "waiting";
  skill: SkillDetail;
  scripts?: string[];
}

export interface SkillFile {
  path: string;
  size: number;
  mime: string;
  /** `script`: runs on the agent's PC; `ignored`: listed only, past what a skill keeps or from an older import. */
  status: "stored" | "ignored" | "script";
}

/** A changed file that runs in a waiting update: `before` null for a new file; texts null when `large`. */
export interface SkillPendingFile {
  path: string;
  before: string | null;
  after: string | null;
  large: boolean;
}

/** The waiting update's content (`SkillDetail.pending`). */
export interface SkillPending {
  body: string;
  description: string;
  /** What its link last wrote before agents changed it; null: not known (changed before servers kept it). */
  base: { body: string; description: string; at: string } | null;
  files: SkillPendingFile[];
}

/** An agent's change to a skill's text, newest first. */
export interface SkillAgentChange {
  id: string;
  agentId: string;
  at: string;
  before: string;
  after: string;
  undone: boolean;
}

export interface SkillDetail extends Skill {
  /** SKILL.md without the front matter (Markdown). */
  body: string;
  files: SkillFile[];
  /** The waiting update's content (older servers leave it out). */
  pending?: SkillPending | null;
  /** The agents' changes to its text, the last 20 (older servers leave it out). */
  changes?: SkillAgentChange[];
}

/** A skill a GitHub link holds, offered to pick when it holds several. */
export interface SkillChoice {
  /** Its folder from the repository's root: what `importPicked` sends back. */
  path: string;
  name: string;
  description: string;
}

/** A skill a GitHub link holds that can't be installed: its folder and the server's refusal. */
export interface SkillSkipped {
  path: string;
  code: string;
  /** English fallback. */
  message: string;
  params?: Record<string, unknown>;
}

/** A GitHub link holding several skills: the ones to pick from, and those that can't be installed, with why. */
export interface SkillPick {
  choices: SkillChoice[];
  skipped?: SkillSkipped[];
  /** Which of the workspace's GitHub connections read it, when the repository is private. */
  via?: SkillVia;
}

/** How a private repository was read: the GitHub App installed on its account, or the workspace's GitHub connection. */
export type SkillVia = "github_app" | "github";

/** `GET …/agents/{id}/skills`: every skill of the library, with whether this agent has it. */
export interface AgentSkill extends Skill {
  enabled: boolean;
}

/** "Escrever": a skill made here. */
export interface SkillInput {
  name: string;
  description: string;
  body: string;
  defaultForNewAgents?: boolean;
}

/** An edit (new version unless only the flag changes). */
export interface SkillPatch {
  description?: string;
  body?: string;
  defaultForNewAgents?: boolean;
  /** Freeze it: agents can't change it. */
  locked?: boolean;
  /** Update it from its link every day, with the rights of whoever turns it on. */
  autoUpdate?: boolean;
  /** Agents improve it by themselves; null follows the workspace. */
  agentsImprove?: boolean | null;
}

/** The workspace's skill settings: "Agentes melhoram as skills sozinhos" (on by default). */
export interface SkillSettings {
  agentsImprove: boolean;
}

/** A skill an agent made from its own how-tos (ADR 0120), archived ones too. */
export interface LearnedSkill extends Skill {
  body: string;
  archived: boolean;
  /** The viewer may lock it and undo its changes (who manages agents, or the agent's owner). */
  canChange: boolean;
  /** It has a change of its own to undo (Desfazer última mudança). */
  canRevert: boolean;
}

// ── Agent computer and Run code settings: apps/server/src/routes/app/sandboxes.ts ──

export interface SandboxSettings {
  enabled: boolean;
  execTimeoutSeconds: number;
  maxTimeoutSeconds: number;
  /** Ask a person before running code. */
  requireApproval: boolean;
}

export type SandboxSettingsInput = Partial<Pick<SandboxSettings, "enabled" | "execTimeoutSeconds" | "requireApproval">>;

/** `GET …/agents/{id}/computer`: which computer the agent uses (ADR 0025). */
export interface AgentComputer {
  target: ComputerTarget;
}

// ── Connected computers (ADR 0025; apps/server/src/routes/machines.ts) ──────

/** No computer, or a machine someone connected with the runner. */
export type ComputerTarget = { kind: "none" } | { kind: "machine"; machineId: string; name: string; online: boolean };

export type MachineOs = "linux" | "darwin" | "windows" | "other";

/** `connected`: a person paired it; `host`: the server's own; `managed`: the workspace's own (ADR 0056 §10). */
export type MachineKind = "connected" | "host" | "managed";

/** `GET …/machines`: a computer connected with `agentes-runner`. */
export interface Machine {
  id: string;
  /** The public address measured through an agent process, absent on older runners. */
  egress?: { ip: string; country?: string; at: string } | null;
  networkTransition?: { state: "draining" | "restart_required"; deadline: string; agents: string[] } | null;
  /**
   * The workspace's own computer, online, has its agents waiting for their way out: none of the proxies its network
   * requires works now, so their connections are refused for a while. Absent from an older server: they don't wait.
   */
  egressWaiting?: boolean;
  name: string;
  /**
   * Absent from a server that doesn't say: `connected`. A `managed` one can't be removed, and its hostname,
   * OS and arch are blank.
   */
  kind?: MachineKind;
  /** Runner connected now (`machine.status` events). */
  online: boolean;
  /**
   * ADR 0161: the workspace's own computer is asleep in standby, offline by design: it wakes when something wants it,
   * and opens as it does. Absent from an older server: not in standby.
   */
  standby?: boolean;
  lastSeenAt: string | null;
  hostname: string;
  /** `linux`, `darwin`, `windows` or `other` (`MachineOs`). */
  os: string;
  arch: string;
  /** `system`: each agent works as its own OS user, in its own folder (ADR 0057). Absent on older servers: `single`. */
  mode?: "system" | "single";
  runnerVersion: string;
  /** ADR 0110: its runner can hold browser profiles; `false`: update the computer. */
  browserProfiles?: boolean;
  /** `false`: started with `--no-exec` (files and uploads only). */
  execAllowed: boolean;
  pairedBy: { id: string; name: string } | null;
  agents: { id: string; name: string; handle: string }[];
  /** Workspace folder on the machine; null unless admin or the person who paired it. */
  workspace: string | null;
  /** This person may rename or remove it (an admin or whoever connected it); they may also reduce its access. */
  canManage: boolean;
  createdAt: string;
  /** ADR 0036 §6: the owner paused it on the machine; nothing new starts until it resumes. Null or absent: not paused. */
  paused?: MachinePause | null;
  /** ADR 0036 §8 (protocol 10): what the machine allows, as last reported. Absent until the machine reports it. */
  access?: MachineAccess | null;
  /** ADR 0040 (protocol 12): whether the agent browser can run there; null or absent when its runner doesn't say. */
  browser?: MachineBrowser | null;
  /**
   * ADR 0062 (protocol 21): whether agents can use their own desktops there (only where each agent is its own OS
   * user); `reason`, in the runner's words, says what is missing. Null or absent when its runner doesn't say.
   */
  desktopUse?: { available: boolean; reason: string | null; code?: string | null } | null;
  /**
   * ADR 0115: its workspace disk (free GB, share in use) and the shared folder's size (GB, measured hourly), as its
   * runner last said; null or absent for people who don't manage it, or when its runner doesn't say.
   */
  disk?: { freeGb: number; use: number | null; sharedGb: number | null } | null;
}

/** Whether the organization uses the server's own computer (`GET …/machines/host`). */
export interface HostComputer {
  machineId: string;
  /** false: an admin stopped it in this organization. */
  on: boolean;
}

/** The provisioner's steps while the workspace's own computer is being prepared (ADR 0056 §10), in order. */
export type ComputerSetupStep = "reserving" | "starting" | "installing" | "connecting";

/**
 * `GET …/computer-setup` (every member): `pair` where people connect their own computers (the rest null);
 * `external` where the workspace gets its own computer, and how far it is. `machine.provisioning` events carry
 * the same fields but `mode`.
 */
export interface ComputerSetup {
  mode: "external" | "pair";
  /** With `external`, null while the workspace is on hold and its computer isn't ready: it waits for none. */
  state: "preparing" | "waiting" | "problem" | "ready" | null;
  /** While `preparing`. */
  step: ComputerSetupStep | null;
  /**
   * While `preparing`, when the provisioner says: what it is doing within its step (`updating`, `restarting`…), in
   * its own word; one the app has no words for reads as its step. Absent from an older server.
   */
  stage?: string | null;
  /** While `waiting`: `capacity` (no computer on its way yet). */
  reason: "capacity" | null;
  since: string | null;
  /** When people started waiting: the workspace's creation, or the computer's last revoke. */
  requestedAt: string | null;
  /** The earliest ready time this wait was told, never moved later; null while the provisioner can't say. */
  expectedReadyAt: string | null;
  /** `expectedReadyAt` less the server's clock when it answered (negative once past), so a device's clock doesn't matter. */
  secondsLeft: number | null;
  /** The server's clock when it answered less `requestedAt`, for the same reason. */
  secondsWaited: number | null;
  /** The server sends email: the workspace's owners get one when it's ready after a wait. */
  notifyByEmail: boolean;
  specs: { cpus: number; memoryGb: number; diskGb: number } | null;
  /** The computer itself, once the provisioner made it. */
  machineId: string | null;
}

/** The agent browser on a computer, as its runner reports it. Turned on at the computer (`access.tools.browser`). */
export interface MachineBrowser {
  available: boolean;
  version: string | null;
  chrome: string | null;
  /** Why it can't run yet, in the runner's words (English). */
  reason: string | null;
  /** That reason as a code the apps word (`machineReasonText`); absent from older servers, null from older runners. */
  code?: string | null;
}

/**
 * The pause the machine reported. The server sends `{ until }` (present = paused) or null;
 * `paused: false` is also understood. `until` null: until the owner resumes.
 */
export interface MachinePause {
  paused?: boolean;
  until?: string | null;
}

/** A tool the person turns on or off on the machine. */
export type MachineToolName = "claude" | "codex" | "cursor" | "opencode" | "grok" | "antigravity" | "commands";

/** A folder allowed on the machine and the agents (ids) that may use it; empty: allowed, no agent yet. */
export interface MachineFolderGrant {
  path: string;
  agents: string[];
}

/** What the machine allows (the runner's `RunnerAccess`). Granting only ever happens on the machine. */
export interface MachineAccess {
  folders: MachineFolderGrant[];
  /**
   * `browser` (ADR 0040): the agent browser; absent on runners before protocol 12 (off). `desktop` and
   * `terminal` (ADR 0058): the agents' desktops and terminals; absent before protocol 18 (off).
   */
  tools: Record<Exclude<MachineToolName, "cursor" | "opencode" | "grok" | "antigravity">, boolean> & {
    /** Protocol 36 (ADR 0114): Cursor's CLI; absent on older runners, where it follows Codex's. */
    cursor?: boolean;
    /** Protocol 39 (ADR 0132): OpenCode's CLI; absent on older runners, where it follows Codex's. */
    opencode?: boolean;
    /** Protocol 43 (ADR 0142): Grok Build; absent on older runners, where it follows Codex's. */
    grok?: boolean;
    /** Protocol 44 (ADR 0143): the Antigravity CLI; absent on older runners, where it follows Codex's. */
    antigravity?: boolean;
    browser?: boolean;
    desktop?: boolean;
    terminal?: boolean;
  };
}

/** `POST …/machines/{id}/access/reduce`: the site can only take away, never grant. */
export interface MachineAccessReduce {
  /** Without `agentId`: the folder for everyone. */
  removeFolder?: { path: string; agentId?: string };
  disableTool?: MachineToolName | "browser" | "desktop" | "terminal";
}

/** Approximate location of the computer that asked for a code (best effort, from its IP). */
export type DeviceLocation = string | { city?: string | null; region?: string | null; country?: string | null };

/** `GET /api/app/machines/device/{userCode}` (ADR 0036 §5): the computer waiting for someone to confirm it. */
export interface DeviceRequest {
  name: string;
  os: string;
  arch: string;
  hostname: string;
  version: string;
  approxLocation?: DeviceLocation | null;
  createdAt: string;
  expiresAt: string;
  /** The code brings back this machine (same name, permissions and agents); only for people who may manage it. */
  reconnect?: { machineId: string; name: string; orgId: string; orgName: string };
}

/** `GET /api/desktop/latest?target=&arch=` (ADR 0036 §9): the newest app build. */
export interface DesktopRelease {
  version: string;
  /** Download link (`/api/desktop/download/{version}/{file}`), relative or absolute. */
  url: string;
  sha256: string;
  notes?: string | null;
  publishedAt: string;
  minVersion?: string | null;
  /** Bytes, when the server knows it. */
  size?: number | null;
  /** Linux only: the AppImage, for a distribution that takes no deb (it runs as it is and updates itself). */
  appImage?: { url: string; sha256: string } | null;
}

/** A computer brain that runs on a connected machine. */
export type ComputerBrain = "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";

/** An agent waiting for an offline computer, and what it has waiting. */
export interface OutageAgent {
  agentId: string;
  name: string;
  brain: ComputerBrain;
  waiting: { routines: number; conversations: number };
}

/** A connected computer that went offline while agents' brains run on it. */
export interface MachineOutage {
  machineId: string;
  name: string;
  /** The machine's `os` (`darwin`, `windows`, `linux`…); `other` for the workspace's own computer. */
  platform: string;
  /** The workspace's own computer (ADR 0056 §10). */
  managed?: boolean;
  offlineSince: string;
  agents: OutageAgent[];
  /** Runs parked until the computer (or another one) can take them. */
  waitingRuns: number;
}

/** Where waiting agents may move: another connected machine. */
export type OutageTarget = {
  kind: "machine";
  machineId: string;
  name: string;
  platform: string;
  /** The workspace's own computer (ADR 0056 §10). */
  managed?: boolean;
  online: boolean;
  brains: ComputerBrain[];
  /** Why it can't take them now, or null. */
  reasonOff: "offline" | "paused" | null;
};

/** What a turn on a computer is for, never its content. Ids are null when the author is gone. */
export type QueuePurpose =
  | { kind: "person"; userId: string | null }
  | { kind: "agent"; agentId: string | null }
  | { kind: "routine" }
  | { kind: "work" };

export interface QueueWhere {
  channelId: string;
  threadId: string | null;
  /** Two agents' private conversation, said only to who may see that work. */
  agents?: boolean;
}

/** What you may do with a row of the line (absent on an older server: nothing). */
export interface QueueAccess {
  /** You see it in the task manager: the row opens it. */
  canOpen?: boolean;
  /** You may stop it. */
  canStop?: boolean;
}

export interface QueueWorking extends QueueAccess {
  runId: string;
  agentId: string;
  purpose: QueuePurpose;
  where: QueueWhere;
  startedAt: string;
  /** An estimate (the agent's typical turn), never exact; null with no basis or past it. */
  estimatedEndAt: string | null;
  /** Past its typical turn: there is no honest end to give. */
  overdue?: boolean;
}

export interface QueueWaiting extends QueueAccess {
  runId: string;
  agentId: string;
  purpose: QueuePurpose;
  where: QueueWhere;
  /** A person waits on it: it goes first. */
  people: boolean;
  /** 1 = next. */
  position: number;
  estimatedStartAt: string | null;
  /** Who it waits for: for the head, the running turn expected to end first; behind it, the agents ahead in line. */
  after: string[];
}

/** `GET …/machines/{machineId}/queue`: a computer's line; `computer.queue` org events say it changed. */
/** One conversation (or routine, or long work) an agent picks up when its plan or budget is back (ADR 0118). */
export interface UsageQueueRow {
  runId: string;
  kind: "conversation" | "routine" | "work";
  channelId: string;
  threadId: string | null;
  channelKind: string;
  /** Null for a DM. */
  channelName: string | null;
  /** What it answers ("Ver conversa" opens it). */
  messageId: string;
  /** Who asked (people's ids): the trigger's author, then whoever joined. */
  askers: string[];
  /** When it first paused. */
  since: string;
  /** What was posted after it in its conversation. */
  after: { count: number; names: string[] };
  state: "queued" | "answering";
  /** A routine's or a long work's title. */
  title: string | null;
  /** The viewer may say not to run it. */
  mayStop: boolean;
}

/** What an agent picks up when its plan or budget is back, in order (`GET …/agents/{agentId}/usage-queue`). */
export interface UsageQueue {
  agentId: string;
  reason: "plan" | "budget" | null;
  plan: string | null;
  resetsAt: string | null;
  /** Other agents in the same plan's line. */
  sharedWith: string[];
  rows: UsageQueueRow[];
  /** Waiting in conversations the viewer can't read. */
  hidden: number;
  /** "Don't run any": the agent's owner and admins. */
  mayStopAll: boolean;
  /** Skipped in the last day as already handled (ADR 0136), newest first. */
  closed: UsageQueueClosedRow[];
}

/** Why a catch-up was skipped (`meta.usageWait.closed`), and who may answer it anyway. */
export interface CatchUpClosed {
  reason: "solved" | "withdrawn" | "task_canceled" | "mixed";
  who?: { name: string; userId?: string; agentId?: string };
  askers: string[];
  at: string;
}

export interface UsageQueueClosedRow {
  runId: string;
  channelId: string;
  threadId: string | null;
  channelKind: string;
  channelName: string | null;
  /** The skipped note ("Ver conversa" opens it). */
  messageId: string;
  closed: CatchUpClosed;
  /** Someone asked it to answer anyway. */
  continuedRunId: string | null;
  /** The viewer may press "Responder mesmo assim". */
  mayAnswer: boolean;
}

export interface ComputerQueue {
  machineId: string;
  name: string;
  working: QueueWorking[];
  waiting: QueueWaiting[];
}

/** `GET …/machines/outages`. */
export interface MachineOutages {
  outages: MachineOutage[];
  targets: OutageTarget[];
}

/** `POST …/machines/{machineId}/move-agents`. */
export interface MoveAgentsInput {
  agentIds: string[];
  target: { kind: "machine"; machineId: string };
}

export interface MoveAgentsResult {
  moved: string[];
  skipped: { agentId: string; reason: string }[];
  /** Waiting runs that started again on the new computer. */
  resumed: number;
  /** Runs that keep waiting for the old computer (they already changed files there). */
  stillWaiting: number;
}

/** Org events about connected computers. */
export type MachineEvent =
  | { type: "machine.status"; machineId: string; online: boolean }
  | { type: "machine.paired"; machineId: string; name: string }
  | {
      type: "machine.updated";
      machineId: string;
      name?: string;
      paused?: MachinePause | null;
      /** `true`: what it allows changed; refetch the list (each person sees only what they may). */
      access?: MachineAccess | null | true;
      /** `true`: its Claude Code / Codex accounts changed (ADR 0041); refetch the agents' brain settings. */
      accounts?: true;
      /** `true`: the coding CLIs it found changed (protocol 41); refetch the agents' brain settings. */
      executors?: true;
    }
  /** ADR 0036: a new pause state or access reported by the machine (also accepted inside `machine.updated`). */
  | { type: "machine.state"; machineId: string; paused?: MachinePause | null }
  | { type: "machine.access"; machineId: string; access?: MachineAccess | null }
  | { type: "machine.deleted"; machineId: string }
  /** Waiting agents moved off an offline computer ("Trocar computador"). */
  | { type: "machine.agents_moved"; machineId: string };

// ── Wiki (expected from the backend; the fake defines the shapes) ────────────

/** Who wrote a version: a person, or an agent (and the person who asked it). */
export interface WikiAuthor {
  type: "person" | "agent";
  id: string;
  /** For agents: "por Theo, a pedido de Walter". */
  onBehalfOf?: string | null;
}

/** Who sees a restricted wiki page besides owners: roles (`OrgRole` ids) and people. */
export interface WikiAudience {
  roleIds: string[];
  userIds: string[];
}

/** A wiki folder's audience: `audience` null = every member, `agentIds` null = every agent. */
export interface WikiFolderAudience {
  folder: string;
  audience: WikiAudience | null;
  agentIds: string[] | null;
  editors: WikiAudience | null;
  agentEditorIds: string[] | null;
}

export interface WikiPageSummary {
  id: string;
  /** URL key ("processos/onboarding"); changes when the page is renamed. */
  slug: string;
  title: string;
  /** "Processos/Vendas" ("" = the root). */
  folder: string;
  tags: string[];
  /** Bumped on every save. */
  version?: number;
  /** Only admins edit it. */
  locked?: boolean;
  /** "Fixadas": at the top of the wiki for everyone. */
  pinned?: boolean;
  /** "Sempre no contexto dos agentes": in every run of an agent that reads it (at most 3 per workspace). */
  agentContext?: boolean;
  /** Limited to these roles and people (owners always read it); null or missing = every member. */
  audience?: WikiAudience | null;
  /** Limited to these agents; null or missing = every agent. */
  agentIds?: string[] | null;
  /** Who edits among those who see it and hold `edit_wiki`; null or missing = all of them. */
  editors?: WikiAudience | null;
  /** The agents that edit it, among those that read it; null or missing = all of them. */
  agentEditorIds?: string[] | null;
  /** The folder whose audience it follows. */
  audienceFolder?: string | null;
  /** The start of the text, plain, for cards. */
  excerpt?: string;
  /** `obsidian` for an imported page. */
  sourceType?: string | null;
  /** An imported page: the vault's name. */
  sourceName?: string | null;
  /** The import that brought it (null for pages imported before imports had ids). */
  importId?: string | null;
  updatedAt: string;
  updatedBy: WikiAuthor;
  /** In the trash since then (the trash's list). */
  deletedAt?: string | null;
}

/** Agents that used pages (in their context or reading them), last 7 days. */
export interface WikiAgentReads {
  total: number;
  agents: { agentId: string; count: number }[];
}

/** "What the agents read most" on the wiki's home. */
export interface WikiTopRead extends WikiAgentReads {
  slug: string;
  title: string;
}

/** A note of an Obsidian vault, read by the app, sent to `POST …/wiki/import`. */
export interface WikiImportNote {
  title: string;
  folder?: string;
  body: string;
  tags?: string[];
  aliases?: string[];
  /** Embedded attachments already in the Drive: name as written in `![[…]]` → artifact id. */
  attachments?: Record<string, string>;
}

export interface WikiImportInput {
  source: { type: "obsidian"; name: string };
  notes: WikiImportNote[];
  folder?: string;
  onConflict: "keep_both" | "skip";
  /** The same for every batch and retry of one import. */
  importId?: string;
}

/** What "Apagar" reaches: chosen pages, a folder with its subfolders, or one import (by id, or by vault for older ones). */
export type WikiBulkTarget =
  | { ids: string[] }
  | { folder: string }
  | { importId: string }
  | { source: { type: string; name: string } };

/** Pages a bulk change couldn't reach, with the error code. */
export type WikiBulkFailed = { id: string; title: string; code: string }[];

export interface WikiImportResult {
  created: WikiPageSummary[];
  skipped: string[];
  failed: { title: string; reason: "title" | "too_long" }[];
}

/**
 * Everything an import can create, in one shape for every source (ADR 0055).
 * The app parses another product's files into it where the person is (their
 * browser); `POST …/imports` plans it (`dryRun`) and applies the picked items;
 * `GET …/export` returns this workspace as one. Keys are the source's own ids:
 * they only link items to each other and tell a re-import what it created.
 * Never carries keys, tokens or passwords.
 */
export interface MigrationBundle {
  format: "agenteschat.bundle";
  version: 1;
  source: {
    /** The app it came from: an import source id ("openmausbot", "openclaw"…) or "agenteschat". */
    app: string;
    /** Stable id of the package or workspace in that app; with `app`, which earlier import an item belongs to. */
    ref: string;
    /** For the header ("Equipe de vendas", "~/.openclaw"). */
    name: string;
    files: string[];
  };
  agents: BundleAgent[];
  skills: BundleSkill[];
  channels: BundleChannel[];
  routines: BundleRoutine[];
  notes: BundleNote[];
  /** What the person does afterwards: connect an app, add a key, sign in. */
  todo: BundleTodo[];
  /** What doesn't come along, as labels only. */
  leftOut: { kind: string; label: string }[];
}

export interface BundleAgent {
  key: string;
  name: string;
  handle: string;
  role: string;
  instructions: string;
  /** A model id of our catalog, else null (the workspace's suggestion). */
  model: string | null;
  appearance: { color?: string; eyes?: string; accessory?: string };
  /** Keys in `skills` this agent had on. */
  skills: string[];
}

export interface BundleSkill {
  key: string;
  /** The whole SKILL.md: frontmatter with `name` and `description`, then the body. */
  markdown: string;
}

export interface BundleChannel {
  key: string;
  name: string;
  topic: string;
  agents: { key: string; autoReply: boolean }[];
}

export interface BundleRoutine {
  key: string;
  name: string;
  /** Key of the agent that runs it. */
  agent: string;
  prompt: string;
  /** Key of a channel in the bundle; null posts in the importer's DM with the agent. */
  channel: string | null;
  trigger: { cron: string; timezone: string | null } | { rule: ApiRule } | { at: string };
}

export interface BundleNote {
  key: string;
  /** Key of the agent it belongs to; null for the whole workspace. */
  agent: string | null;
  kind: "fact" | "preference" | "decision" | "note" | "lesson";
  title?: string;
  content: string;
}

export interface BundleTodo {
  kind: "connection" | "app" | "secret" | "model" | "file";
  label: string;
  url?: string;
  /** Keys of the agents it matters to. */
  agents: string[];
}

export type ImportItemKind = "agent" | "skill" | "channel" | "routine" | "note";

export type ImportSkipReason =
  | "exists"
  | "model_not_in_catalog"
  | "invalid_skill"
  | "schedule_unsupported"
  | "schedule_in_past"
  | "secret_like"
  | "agent_not_picked"
  /** A routine whose channel isn't coming (unpicked, or a private channel with that name exists). */
  | "channel_not_picked"
  | "invalid"
  | "failed"
  /** A note on a created routine: its agent already had the most active routines, so it arrived paused. */
  | "too_many_routines";

export interface ImportItemResult {
  kind: ImportItemKind;
  key: string;
  label: string;
  action: "create" | "update" | "unchanged" | "skip";
  /**
   * Why it is skipped. On a create or update, a note: `model_not_in_catalog` (the workspace's
   * default model instead), `exists` (a public channel with that name: the agents join it).
   */
  reason?: ImportSkipReason;
  /** Fields cut to fit our limits. */
  trimmed?: string[];
  /** The @handle an agent gets (or got) when it isn't the bundle's: that one was taken, or is an id. */
  renamedTo?: string;
  /** The row created or updated (after an apply). */
  targetId?: string;
}

export interface ImportInput {
  bundle: MigrationBundle;
  dryRun: boolean;
  /**
   * `kind:key` of the items to apply; default every item (items left out aren't in the plan). One
   * apply creates or updates at most 200 (`import.too_many_items`): apply a big import in chunks,
   * in the plan's order (each call is safe to repeat).
   */
  pick?: string[];
}

export interface ImportPlan {
  items: ImportItemResult[];
}

/** One of an imported agent's own files, copied into its folder in the Drive (`POST …/imports/files`). */
export interface ImportFileInput {
  file: Blob;
  /** The file's name, for its download. */
  name: string;
  /** The agent the import made (or an earlier one did). */
  agentId: string;
  /** Where it goes in the agent's folder, keeping the source's folders. */
  path: string;
  /** For its first version (the importer's language). */
  note?: string;
}

export interface ImportedFile {
  /** `exists`: the folder had a file with that name already, and it stays as it was. */
  status: "created" | "exists";
  artifactId: string;
  /** `<folder>/<path>`. */
  title: string;
  /** The agent's folder in the Drive: its name. */
  folder: string;
}

/** A source package this workspace brought things from, with how many of each kind came. */
export interface ImportedSource {
  app: string;
  ref: string;
  counts: Record<ImportItemKind, number>;
}

/** Where a page is mentioned: other pages, messages, issues. */
export type WikiBacklink =
  | { kind: "page"; slug: string; title: string; excerpt?: string }
  | {
      kind: "message";
      channelId: string;
      messageId: string;
      channelName: string;
      /** In a direct conversation: who it is with (a DM's name is an internal key). */
      dm?: { type: "agent" | "person"; id: string } | null;
      excerpt: string;
      at: string;
    }
  | { kind: "issue"; number: number; title: string };

export interface WikiPage extends WikiPageSummary {
  body: string;
  version: number;
  createdAt: string;
  createdBy: WikiAuthor;
  /** Everyone who wrote it, most recent first. */
  authors: WikiAuthor[];
  backlinks: WikiBacklink[];
  /** The closest limited folder: this page can only be narrower. */
  folderAudience?: WikiFolderAudience | null;
  /** False when its editors' list leaves this reader out (a locked page or a missing `edit_wiki` still stop them). */
  canEdit?: boolean;
  /** Where it came from; an import keeps its attachments (name → Drive artifact id). */
  source?: { type: string; id: string; channelId?: string; attachments?: Record<string, string> } | null;
  /** Agents that used it in the last 7 days; the channel only when public. */
  reads?: WikiAgentReads & {
    last: { agentId: string; channelId: string | null; channelName: string | null; at: string } | null;
  };
}

export interface WikiVersion {
  version: number;
  at: string;
  author: WikiAuthor;
  note: string | null;
  /** A note the server wrote ("created the page"), translated as `wiki.note.{noteCode}`. */
  noteCode?: string;
  noteParams?: Record<string, string>;
}

export interface WikiPageInput {
  title: string;
  folder?: string;
  tags?: string[];
  body: string;
  /** Who sees it (ADR 0151), inside its folder's audience. */
  audience?: AudienceChoice;
}

/** `PUT …/wiki/pages/{slug}`: `baseVersion` is the version edited (409 `version_conflict` if it moved). */
export interface WikiUpdateInput {
  body: string;
  baseVersion: number;
  title?: string;
  folder?: string;
  tags?: string[];
  note?: string;
}

export interface WikiGraph {
  nodes: {
    slug: string;
    title: string;
    folder: string;
    tags: string[];
    agentId?: string | null;
    sourceType?: string | null;
  }[];
  edges: { from: string; to: string }[];
}

// ── Threads (ADR 0029; apps/server/src/routes/app/threads.ts) ──────────────────

export type ThreadState = "open" | "closed" | "archived";
export type ThreadTab = "all" | "working" | "missions" | "closed" | "archived";
export type ThreadChange =
  | "created"
  | "title"
  | "context"
  | "moved"
  | "returned"
  | "closed"
  | "reopened"
  | "archived"
  | "unarchived"
  | "deleted";

/** A person or an agent in a thread (`id` null: someone who left). */
export interface ThreadActor {
  type: AuthorType;
  id: string | null;
}

/** The range of a conversation a thread was made from. */
export interface ThreadContext {
  channelId: string;
  firstMessageId: string;
  lastMessageId: string;
  excludedMessageIds: string[];
  /** The range left the channel (a stub stays there). */
  moved: boolean;
  /** Messages in the range now (deleted and excluded ones don't count). */
  count: number;
}

/** A task's conversation with something I haven't read (`GET …/unread-tasks`, ADR 0145). */
export interface UnreadTask {
  issueId: string;
  /** Replies I haven't read: every one where I follow the conversation, else only those that mention me. */
  unread: number;
  mentions: number;
}

export interface ThreadInfo {
  /** The root message id (what replies carry as `threadId`). */
  id: string;
  channelId: string;
  channelName: string;
  channelKind: "channel" | "dm" | "task";
  /** Null: show `rootText`. */
  title: string | null;
  rootText: string;
  rootAuthor: ThreadActor;
  state: ThreadState;
  createdBy: string | null;
  closedBy: string | null;
  closedAt: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
  context: ThreadContext | null;
  replyCount: number;
  lastActivityAt: string;
  /** `meta`: a body the server wrote, shown in the reader's language (`previewBody`). */
  lastMessage: {
    author: ThreadActor;
    excerpt: string;
    meta?: PreviewMeta | null;
    /** A GIF or a sticker (ADR 0091): with no text, `previewBody` says which. */
    mediaKind?: MediaKind | null;
    createdAt: string;
  } | null;
  participants: ThreadActor[];
  /** An agent run is in progress (or waiting) in this thread. */
  working: boolean;
  needsYou: boolean;
  /** Open, and a model judged its matter done after its last message: offer one-click close. Never closes by itself. */
  /**
   * When "Responder" opened it (its first reply from the thread panel): replies from then on live in
   * the panel and the channel shows one line. Null: the channel shows its replies in the timeline.
   */
  openedByReplyAt: string | null;
  suggestedResolved: boolean;
  /** You may close, archive, rename or change the context. */
  canManage: boolean;
  /**
   * You follow it: notified of its replies, which count as unread in the
   * channel. By default whoever started it or wrote in it. Always sent by the
   * API; absent in `thread.updated` events (it is per person).
   */
  following?: boolean;
  /**
   * Replies you haven't read in a thread you follow (0 otherwise), at most 100. Always sent by the API; absent in
   * `thread.updated` events (it is per person).
   */
  unread?: number;
  /** The thread's mission, in short (details: `GET …/threads/{id}/mission`). */
  mission?: ThreadMissionSummary | null;
  createdAt: string;
}

export interface ThreadMissionSummary {
  id: string;
  /** The mission's agent (the row's avatar). */
  agentId: string;
  status: MissionStatus;
  planDone: number;
  planTotal: number;
  /** Plan items waiting for people, pending decisions and reviews; command cards for whoever answers them. */
  waitingYou: number;
}

export interface ThreadPage {
  threads: ThreadInfo[];
  nextCursor: string | null;
}

export interface ThreadFilters {
  tab?: ThreadTab;
  channelId?: string;
  agentId?: string;
  needsYou?: boolean;
  mine?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ThreadCreateInput {
  /** Where the thread lives. */
  channelId: string;
  /** Where the range comes from (default: `channelId`). */
  contextChannelId?: string;
  firstMessageId: string;
  lastMessageId: string;
  excludedMessageIds?: string[];
  title?: string | null;
}

export interface ThreadPatch {
  /** Empty or null: no title of its own. */
  title?: string | null;
  firstMessageId?: string;
  lastMessageId?: string;
  excludedMessageIds?: string[];
}

export type ThreadAction = "move" | "return" | "close" | "reopen" | "archive" | "unarchive";

/** `meta.threadStart` on the root of a thread made from a range: the channel shows it as a marker. */
export interface ThreadStartMeta {
  title: string;
  contextChannelId: string;
  firstMessageId: string;
  lastMessageId: string;
  count: number;
  moved: boolean;
  movedCount: number;
}

// ── Missions (ADR 0029; apps/server/src/routes/app/missions.ts) ────────────────

/** `awaiting_close`: every plan item is done and nothing runs; the owner (or a decider) concludes it. */
export type MissionStatus = "proposed" | "active" | "paused" | "awaiting_close" | "done" | "canceled";
export type MissionRole = "owner" | "decide" | "comment" | "none";
export type PlanItemStatus = "todo" | "doing" | "waiting_you" | "done" | "dropped";

export interface PlanItem {
  id: string;
  title: string;
  status: PlanItemStatus;
  note?: string;
}

/** Who programs a mission: Claude Code, Codex or the agent itself with its own tools. */
export type MissionExecutor = "claude" | "codex" | "agent";

/**
 * What the agent found before proposing a mission (ADR 0037 round 2), shown on the plan card:
 * `read` = code or files it read (icon: search), `data` = numbers from analytics, logs or errors
 * (icon: chart), `decision` = the one open question left for the person (icon: help; at most one).
 * `refs`: files with lines (`ReviewPrompt.swift:41`), links or ids it cites.
 */
export interface MissionFinding {
  kind: "read" | "data" | "decision";
  text: string;
  refs?: string[];
}

export interface Mission {
  id: string;
  /** The home thread (root message id). */
  threadId: string;
  channelId: string;
  agentId: string;
  ownerId: string | null;
  /** "claude" | "codex" | "agent". */
  executor: string;
  title: string;
  goal: string;
  /** What the agent found before proposing it (read only); empty when a person started it and planning found nothing yet. */
  findings: MissionFinding[];
  /** The `decision` finding's text: the one question left for the person (null: none). */
  openQuestion: string | null;
  status: MissionStatus;
  repoDir: string;
  resumeTasks: boolean;
  /** Autonomia: when the mission stops to ask a person before a command. */
  commandApproval: CommandApproval;
  plan: {
    version: number;
    done: number;
    total: number;
    waiting: number;
    /** Items in progress now. */
    doing: number;
    /** The latest plan in order (at most 40), for the strip. */
    items: Pick<PlanItem, "id" | "title" | "status">[];
  };
  pending: {
    decisions: number;
    provisional: number;
    reviews: number;
    suggestions: number;
    /** Requests to join (0 unless you can answer them). */
    joinRequests: number;
    /** Command cards waiting for an answer (0 unless you can answer them). */
    commands: number;
    /** Delivery cards waiting for you to conclude (0 unless you can answer them). */
    deliveries?: number;
  };
  /** You asked to join and nobody answered yet. */
  joinRequested: boolean;
  runningTasks: number;
  machine: {
    id: string;
    name: string;
    online: boolean;
    lentBy: string | null;
    /** Who can program on that computer (the plan card switches before Start). */
    executors: MissionExecutor[];
    /** Codex is installed but too old for missions. */
    codexTooOld: boolean;
  } | null;
  /** Handed over without a computer: the owner sets one. */
  needsComputer: boolean;
  /** Your role in it. */
  role: MissionRole;
  /** You may start work, decide, review, pause and stop. */
  canAct: boolean;
  /** You may close it and change who takes part. */
  canManage: boolean;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  wikiPageId: string | null;
  /** ADR 0044: the mission's own branch in its copy of the project (null until it is prepared). */
  branch?: string | null;
  /** The branch it started from ("a partir de main"). */
  baseBranch?: string | null;
  baseSha?: string | null;
  /** Its copy of the project: being prepared, ready, failed (`worktreeError`), or removed at close. */
  worktreeState?: MissionWorktreeState;
  /** Why preparing failed (the last lines of the output). */
  worktreeError?: string | null;
  /** Why it is `failed` (`branch_missing`: the branch is gone, trying again starts over); null otherwise. */
  worktreeFailReason?: MissionSetupMeta["reason"] | null;
}

export type MissionWorktreeState = "none" | "preparing" | "ready" | "failed" | "removed";

/** `meta.missionSetup`: preparing the mission's copy of the project failed ("Tentar de novo"). */
export interface MissionSetupMeta {
  state: "failed";
  /** `branch_missing`: the mission's branch is gone from the computer; trying again starts over from the base. */
  reason: "setup" | "ensure" | "branch_missing";
  error: string;
  branch?: string;
  /** The thread's mission is used when absent. */
  missionId?: string;
}

export type MissionListStatus = "open" | "closed" | "waiting_you" | MissionStatus;

/** `GET …/missions` filters (the server's; the Missões tab sends them). */
export interface MissionListQuery {
  status?: MissionListStatus;
  channelId?: string;
  agentId?: string;
  /** Words of the title or the goal. */
  q?: string;
  limit?: number;
}

/** Same filters, any status: the tabs and the sidebar's count. */
export interface MissionCounts {
  active: number;
  waitingYou: number;
  closed: number;
}

export interface MissionList {
  missions: Mission[];
  counts: MissionCounts;
}

/** "Pedir para participar": answered by the owner and those who decide. */
export interface MissionJoinRequest {
  id: string;
  missionId: string;
  userId: string;
  name: string;
  status: "pending" | "accepted" | "declined";
  role: MissionParticipantRole | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** Why an agent can't run a mission for you. */
export type MissionIneligibleReason = "no_computer" | "exec_off" | "runner_outdated" | "not_in_audience";

/** An agent for "Nova missão": whether it can run a mission for you, and why not. */
export interface MissionEligibleAgent {
  agentId: string;
  handle: string;
  name: string;
  /** Older servers only listed eligible agents (absent = eligible). */
  eligible?: boolean;
  reason?: MissionIneligibleReason | null;
  /** You can choose its computer (an admin or its owner). */
  canManage?: boolean;
  machine: { id: string; name: string; online: boolean } | null;
  ready: boolean;
  /** Who can program on its computer ("Quem programa"), and the default. */
  executors: MissionExecutor[];
  defaultExecutor: MissionExecutor | null;
  codexTooOld: boolean;
  /** The autonomy its new missions start with ("Usar como padrão"); absent on older servers. */
  commandApproval?: CommandApproval;
}

/** A command allowed for the whole mission ("Aprovar sempre"), in "O que já foi liberado". */
export interface MissionCommandRule {
  id: string;
  /** `Bash(swift build *)`. */
  rule: string;
  /** Who allowed it (user id). */
  by: string | null;
  createdAt: string;
}

/** "Configurações da missão": what the dialog reads besides the mission itself. */
export interface MissionSettings {
  missionId: string;
  rules: MissionCommandRule[];
  /** "Nesta missão: N liberados automaticamente · N perguntados · N bloqueados". */
  stats: { auto: number; asked: number; blocked: number };
  /** "Próximas missões do <agente>". */
  agentDefault: { commandApproval: CommandApproval; canSet: boolean; ownerId: string | null };
}

/** "Quem pensa" (ADR 0032): the API, or Claude Code / Codex on the agent's computer with a person's plan. */
export type BrainKind = "model" | "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";

/** Why a computer brain can't be chosen now. */
export type BrainUnavailable =
  | "no_computer"
  | "exec_off"
  | "runner_old"
  | "tool_off"
  | "not_installed"
  | "outdated"
  /** Its runner hasn't said which CLIs it has yet. */
  | "not_reported";

export interface BrainModelOption {
  /** What is stored (`opus`, `sonnet`, `haiku`, a Codex model). */
  value: string;
  label: string;
  modelId?: string;
  recommended?: boolean;
  /** Its context window in tokens. */
  contextWindow?: number;
  /** Cursor (ADR 0114): its CLI said the person's plan includes it; absent: it didn't say. */
  inPlan?: boolean;
  /** OpenCode (ADR 0132): a model of OpenCode's free tier (no key, no cost). */
  free?: boolean;
}

export interface BrainOption {
  kind: BrainKind;
  available: boolean;
  reason?: BrainUnavailable;
  models: BrainModelOption[];
  defaultModel: string | null;
}

/** A computer the caller may give an agent, with what it offers. */
export interface BrainMachine {
  machineId: string;
  name: string;
  online: boolean;
  options: BrainOption[];
}

/** `GET …/agents/{id}/brain` (its owner or an admin; the team's right hand's `mine`, anyone). */
export interface AgentBrain {
  agentId: string;
  /**
   * The team's right hand only (ADR 0137 §11): `mine`, the viewer's own AI for their DM with it (`brain` `model`: none,
   * it thinks with the workspace's); `workspace`, what every DM thinks with while its person has none.
   */
  scope?: BrainScope;
  /** With `mine`: the workspace's AI (`model`: an API key), and whether it thinks for the viewer. */
  workspaceAi?: {
    brain: BrainKind;
    ownerId: string | null;
    servesYou: boolean;
    /** On a key: the workspace's key it thinks with; null with none (the server's own key may serve). */
    key?: { provider: string; label: string } | null;
  };
  brain: BrainKind;
  /** As stored; null = the brain's default. */
  model: string | null;
  effectiveModel: string | null;
  /** If the computer isn't available, answer through the API (counts against the budget). */
  fallback: boolean;
  /** Long work may go on into the plan's paid extra usage where the provider reports it on (ADR 0118). */
  extraUsage: boolean;
  computer: { machineId: string; name: string; online: boolean } | null;
  options: BrainOption[];
  /** Every computer the caller may give the agent, with what each offers ("Vai para o Mac mini"). */
  machines: BrainMachine[];
  canEdit: boolean;
  /** ADR 0041: the account on the agent's computer it thinks with; null = "Conta deste computador". */
  account: string | null;
  /** How much it thinks before answering; `auto` = picked per task; null = the brain's default. */
  effort: BrainEffortSetting | null;
  /** How fast it answers in conversations; kept whatever it thinks with, applied only where `speedFits`. */
  speed: BrainSpeed;
  /** The most context it reads, in tokens (200K, 400K or 1M), any brain; null = its model's window. */
  contextTokens?: number | null;
  /**
   * The agent's owner's accounts on its computer (both kinds) and the one it thinks with; "Conta deste
   * computador" isn't listed. A plan thinks only for its owner's agents (ADR 0059).
   */
  accounts: MachineAccount[];
  /** The viewer may add an account there for this agent: its owner, on a computer where they add accounts. */
  canManageAccounts: boolean;
  /** False while the app on the computer is too old for accounts (nothing about them shows). */
  accountsSupported: boolean;
  /** Nobody but the agent's owner talks to it ("Atende outras pessoas" off). */
  onlyOwner: boolean;
  /** The viewer owns the agent: only they connect its plan and turn its paid extra usage on or off. */
  canUsePlans: boolean;
  /**
   * The viewer may use other people's plans (`use_others_plans`, ADR 0059 §3): `accounts` has every plan on its
   * computer, and they may give it any of them. Absent on older servers.
   */
  canUseOthersPlans?: boolean;
  /** "Conta deste computador" can think for it: whoever connected the computer owns the agent. */
  ownSignIn: boolean;
  /** "Conta deste computador"'s plan usage, by brain (absent: not known). */
  ownUsage: Partial<Record<MachineAccountKind, PlanUsage>>;
  /** Its Autonomia (its new missions' autonomy), copied with its setup (ADR 0094); absent on older servers. */
  autonomy?: CommandApproval;
}

/** The team's right hand's AIs: the viewer's own, or the workspace's (admins). */
export type BrainScope = "mine" | "workspace";

/** ADR 0041 §5: `xhigh` may be stored; the page offers low, medium, high and max. */
export type BrainEffort = "low" | "medium" | "high" | "xhigh" | "max";
/** A level, or "Automático" (each run picks low, medium or high with the model). */
export type BrainEffortSetting = BrainEffort | "auto";

export type BrainSpeed = "standard" | "fast";

export type MachineAccountKind = "claude_code" | "codex" | "cursor" | "opencode" | "grok" | "antigravity";

/** ADR 0041 §3, ADR 0059: a Claude Code or Codex account signed in on a connected computer (metadata only). */
export interface MachineAccount {
  id: string;
  kind: MachineAccountKind;
  label: string;
  /** Only for its owner. */
  email: string | null;
  /** `pro`, `max`, `ultra`, `team`… from what the CLI says (`planWordOf` names it). */
  plan: string | null;
  status: "active" | "signed_out";
  /** False: the computer's last look at its sign-in said nothing for sure; `status` is the last known (older servers leave it out). */
  statusKnown?: boolean;
  /** Whose it is (the person who signed it in); null: nobody's. */
  ownerId: string | null;
  ownerName: string | null;
  /** The viewer owns it: only they rename it or pick it for an agent. */
  mine: boolean;
  /** Names of the agents that think with it (one at most, unless `shared`). */
  usedBy: string[];
  /** Their ids, in the same order (absent: an older server). */
  usedByIds?: string[];
  /** Its plan's usage limits; null: not known yet. */
  usage: PlanUsage | null;
  /** A key account's coding plan (`zai`, `kimi`, `minimax`, `opencode`); null: the CLI's own sign-in. */
  provider: string | null;
  /** The last 4 of a key account's key (its owner only). */
  keyHint: string | null;
  /** It thinks for every agent its owner gives it on that computer, with no new sign-in (absent: an older server). */
  shared?: boolean;
  /** Claude's organization it is signed in to (opaque), its owner's eyes only; null or absent: not known. */
  providerOrgId?: string | null;
}

/** `GET …/ai-accounts`: the viewer's AI accounts on the organization's computers, and where they can add one. */
export interface AiAccounts {
  accounts: (MachineAccount & { machineId: string; computer: string })[];
  computers: AiComputer[];
}

export interface AiComputer {
  machineId: string;
  name: string;
  online: boolean;
  /** The viewer connected it. */
  mine: boolean;
  /** The viewer adds accounts there (they connected it, or nobody did), on a runner that knows accounts. */
  canAdd: boolean;
  /** Its runner takes coding plans' keys. */
  keys: boolean;
  /** A new sign-in there thinks for all of the viewer's agents on it (absent: an older server). */
  shares?: {
    claude_code: boolean;
    codex: boolean;
    cursor?: boolean;
    opencode?: boolean;
    grok?: boolean;
    antigravity?: boolean;
    key: boolean;
  };
  /** Why a CLI of `brains` can't think there (absent: an older server). */
  off?: Partial<Record<MachineAccountKind, BrainUnavailable>>;
  /** What it can think with now: Claude Code (Claude and the coding plans) and Codex (ChatGPT). */
  brains: {
    claude_code: boolean;
    codex: boolean;
    cursor?: boolean;
    opencode?: boolean;
    grok?: boolean;
    antigravity?: boolean;
  };
  /**
   * "Conta deste computador": each CLI's own sign-in there, on a computer the viewer connected (absent: a server
   * too old to say). Its plan and usage when the computer reported them.
   */
  own?: Partial<Record<MachineAccountKind, { plan?: string; usage?: PlanUsage }>>;
}

/** A plan's usage window: how much of it is used (0–100) and when it resets. */
export interface PlanWindow {
  kind: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "monthly" | "other";
  /** `other`: the provider's name for it ("Extra usage", a model's name). */
  label?: string;
  usedPercent: number;
  resetsAt?: string;
}

/** A plan's usage limits, as the CLI on its computer said them (`at`); no token is ever read. */
export interface PlanUsage {
  windows: PlanWindow[];
  /** The plan refused a request for its limit (until a window resets). */
  limited?: boolean;
  source: "turn" | "probe";
  at: string;
  /**
   * Models at a limit of their own, by model id: until `until` (absent: unknown), `region` the model needs, or `off`
   * the plan refused it for the key.
   */
  models?: Record<string, { at: string; until?: string; region?: true; off?: true; inactive?: true }>;
}

export interface AgentBrainInput {
  /** The team's right hand: the viewer's own AI (`mine`, the server's default) or the workspace's (admins). */
  scope?: BrainScope;
  brain?: BrainKind;
  model?: string | null;
  fallback?: boolean;
  /** Off: long work pauses at 95% of the plan even with its paid extra usage on. */
  extraUsage?: boolean;
  /**
   * "Atende outras pessoas" turned off: false lets in whoever its "who can talk" list allows (everyone with no list).
   */
  onlyOwner?: boolean;
  /** One of the viewer's own accounts; null = "Conta deste computador". */
  account?: string | null;
  /** The account thinks for another agent: take it from that one. */
  moveAccount?: boolean;
  effort?: BrainEffortSetting | null;
  speed?: BrainSpeed;
  /** 200K, 400K or 1M tokens; null = the model's window; omitted = keep. */
  contextTokens?: number | null;
}

/** One agent's "Quem pensa" as a value, to use on other agents (ADR 0094, `POST …/agent-setup`). */
export interface AgentSetup {
  brain: BrainKind;
  /** The API brain: the agent's model (`auto` included). A computer brain: its model as stored (null: the default). */
  model: string | null;
  /** The API brain's key; null = the workspace's default; omitted = each agent keeps its own. */
  key?: string | null;
  /** A computer brain: the computer it thinks on, and its account there (null: that computer's own sign-in). */
  machineId?: string | null;
  account?: string | null;
  effort?: BrainEffortSetting | null;
  /** Omitted = each agent keeps its own. */
  speed?: BrainSpeed;
  contextTokens?: number | null;
  fallback?: boolean;
  /** "Atende outras pessoas" off, for the agents that move onto the plan. */
  onlyOwner?: boolean;
  /** Its Autonomia, wherever the caller may set it by hand, whatever the AI takes; omitted = each keeps its own. */
  autonomy?: CommandApproval;
}

/** Why an agent can't take a setup. */
export type AgentSetupReason =
  | "not_allowed"
  | "admins_only"
  | "account_owner"
  | "account_single"
  | "other_computer"
  | "model_missing"
  | "failed";

/** What a setup does to one agent (in a preview, would do). */
export interface AgentSetupResult {
  agentId: string;
  /** Its AI. `same`: it already thinks this way; `skipped`: it takes none of the AI (`reason`), maybe the Autonomia. */
  status: "applied" | "same" | "skipped";
  /** It keeps the account it has (another person's plan) and takes the rest: its name; null = its computer's own. */
  keeps?: { account: string | null };
  reason?: AgentSetupReason;
  /** `owner` (account_owner, not the caller's), `agent` (account_single), `computer`, `plan` and `model`. */
  params?: Record<string, string>;
  /** Its Autonomia changes, whatever its AI does: wherever the caller may set it by hand, `skipped` agents too. */
  autonomy?: { from: CommandApproval; to: CommandApproval };
  /** It lets more people talk to it on its owner's plan, someone else's: the apps ask first (`setupPlanQuestion`). */
  opensPlan?: true;
}

/** `GET …/agent-setup`: what a new agent starts thinking with (the last setup saved or used on others). */
export interface NewAgentSetup {
  brain: BrainKind;
  model: string | null;
  /** The API brain's key, still the workspace's; null = the workspace's default. */
  key: string | null;
  contextTokens: number | null;
  /** A computer brain: where it thinks. */
  computer?: { machineId: string; name: string };
  /** Its account there; null = that computer's own sign-in. */
  account?: { id: string; label: string; provider: string | null; mine: boolean; free: boolean } | null;
  /** The computer's own sign-in thinks for the caller's agents there (they connected it). */
  ownSignIn?: boolean;
  effort?: BrainEffortSetting | null;
  fallback?: boolean;
  /** Its Autonomia; null or absent = the default. */
  autonomy?: CommandApproval | null;
}

/** `POST …/machines/{id}/account-logins` (201): what the person needs to sign in. */
export interface AccountLoginStart {
  loginId: string;
  kind: MachineAccountKind;
  /** The provider's own page (Claude's sign-in, the device page for Codex, or where a plan's key is made). */
  url: string;
  /** A coding plan's key account. */
  provider?: string;
  /** Claude Code: the computer's one-time key the pasted code is sealed to. */
  publicKey?: string;
  /** Codex: the one-time code to type on the device page. */
  userCode?: string;
  expiresAt: string;
}

/** Why a sign-in ended on the computer (mirror of `ACCOUNT_LOGIN_FAILURES` in `@agenteschat/adapters`). */
export type AccountLoginFailure =
  | "not_installed"
  | "no_tty"
  | "network"
  | "bad_code"
  | "cli_exit"
  | "not_signed_in_after_login"
  | "status_unknown"
  | "no_token"
  | "not_kept"
  | "timeout"
  | "canceled";

/** `GET …/account-logins/{loginId}`. */
export interface AccountLoginStatus {
  state: "waiting" | "done" | "failed" | "expired";
  account?: MachineAccount;
  error?: string;
  /** `failed` or `expired` on the computer: why (an older runner sends none). */
  code?: AccountLoginFailure;
  /** With `code`: what the CLI itself said, in English. */
  message?: string;
  /** `failed`: the viewer already has this account on that computer, named `label` (an older server sends no `account`). */
  duplicate?: { label: string; account?: MachineAccount };
  /** `failed`: signing in again came back as another account, this email; the account stays signed out. */
  signedInAs?: string;
}

/** `GET …/missions/{id}/brain`: who does the work and with which model. */
export interface MissionBrain {
  missionId: string;
  /** The override; null = from the executor. */
  brain: BrainKind | null;
  model: string | null;
  effectiveBrain: BrainKind;
  effectiveModel: string | null;
  options: BrainOption[];
  canSetBrain: boolean;
  canSetModel: boolean;
}

/** "Ver saída": the last lines of a task, from the computer or what the server kept. */
export interface TaskOutput {
  taskId: string;
  status: MachineTaskStatus;
  source: "computer" | "saved";
  lines: string[];
  truncated: boolean;
}

/** Autonomia ("Pergunta sempre", "Só o que é arriscado", "Não pergunta"): every command, only the risky ones (low-risk ones allowed automatically), or never (but the blocked ones). */
export type CommandApproval = "always" | "low_risk_auto" | "never";

/** `meta.missionAutoApproved`: a command allowed without a card (one quiet line, Revogar). */
export interface MissionAutoApprovedMeta {
  missionId: string;
  taskId: string;
  tool: string;
  command: string;
  reason: "low_risk" | "never";
}

export interface MissionCreateInput {
  agentId: string;
  goal: string;
  title?: string;
  /** Where it starts (a new thread there). */
  channelId?: string;
  /** Or the thread that becomes its home. */
  threadId?: string;
  /** The repository on the computer, relative to the agent's folder. */
  folder?: string;
  /** Default: Claude Code when the computer has it, else the agent itself. */
  executor?: MissionExecutor;
  /** Default: low_risk_auto. */
  commandApproval?: CommandApproval;
}

export interface MissionDecision {
  id: string;
  missionId: string;
  taskId: string | null;
  messageId: string | null;
  question: string;
  options: string[];
  recommendation: string | null;
  why: string | null;
  impact: string | null;
  blocking: boolean;
  status: "pending" | "provisional" | "taken";
  chosen: string | null;
  chosenBy: string | null;
  chosenAt: string | null;
  opinions: { userId: string; option: string; at: string }[];
  createdAt: string;
}

export interface MissionReview {
  id: string;
  missionId: string;
  taskId: string | null;
  messageId: string | null;
  title: string;
  summary: string;
  prUrl: string | null;
  artifactIds: string[];
  status: "pending" | "approved" | "changes_requested";
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export type MissionParticipantRole = "decide" | "comment";

export interface MissionParticipants {
  owner: { userId: string; name: string } | null;
  participants: {
    userId: string;
    name: string;
    role: MissionParticipantRole;
    addedBy: string | null;
    createdAt: string;
  }[];
}

export type MachineTaskStatus = "queued" | "running" | "interrupted" | "done" | "failed" | "canceled";

/** A background task on a connected computer (one session of a mission's executor). */
export interface MachineTask {
  id: string;
  agentId: string;
  machineId: string;
  channelId: string;
  threadId: string | null;
  missionId: string | null;
  title: string;
  executor: string;
  status: MachineTaskStatus;
  exitCode: number | null;
  seconds: number | null;
  lastLine: string | null;
  files: string[];
  /** A pull request it opened (detected by the server). */
  prUrl?: string | null;
  branch: string | null;
  cwd: string | null;
  resumedFromId: string | null;
  resumedTaskId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  createdAt: string;
  /** ADR 0044 (missions): writes in the mission's copy, only reads, or prepares the copy. */
  mode?: "write" | "read" | "setup" | null;
  /** The commits it started from and ended at ("O que mudou" per session). */
  startSha?: string | null;
  endSha?: string | null;
}

export type MissionFileName = "mission.md" | "decisions.md" | "notes.md";

export interface MissionFile {
  name: MissionFileName | string;
  content: string | null;
  source: string | null;
  writtenAt: string | null;
  updatedAt: string | null;
}

/** A `.agentes/` file edited on the machine: we kept the approved version. */
export interface MissionFileEdit {
  id?: string;
  name?: string;
  approved?: string;
  edited?: string;
  diff?: string;
  at?: string;
  [key: string]: unknown;
}

export interface MissionFiles {
  files: MissionFile[];
  editedOnMachine: MissionFileEdit[];
}

/** `/summary`: where it stands, from the database. */
export interface MissionSummary {
  missionId: string;
  text: string;
  plan: { done: number; total: number; doing: number; waiting: number };
  running: number;
  pendingDecisions: number;
  provisionalDecisions: number;
  pendingReviews: number;
}

export interface MissionPlanVersion {
  version: number;
  items: PlanItem[];
  source: string;
  taskId: string | null;
  createdAt: string;
}

/** `/plan`: the latest version and the history. */
export interface MissionPlan {
  missionId: string;
  current: MissionPlanVersion | null;
  history: MissionPlanVersion[];
}

export type MissionControl = "start" | "pause" | "resume" | "stop";

/** `meta.missionPlan`: the plan card (Começar / Mudar algo). */
/** `meta.missionLink` on an agent's reply: the mission it proposed, whose thread lives elsewhere. */
export interface MissionLinkMeta {
  missionId: string;
  threadId: string;
}

export interface MissionPlanMeta {
  missionId: string;
  title: string;
  goal: string;
  computer: string;
  executor: string;
}

/** `meta.missionReport`: a report the executor wrote in the thread. */
export interface MissionReportMeta {
  missionId: string;
  taskId: string;
  status: string;
  executor: string;
  computer: string | null;
  main: boolean;
}

/** `meta.missionPlanChange`: one line per plan change. */
export interface MissionPlanChangeMeta {
  missionId: string;
  version: number;
  added: { id: string; title: string }[];
  removed: { id: string; title: string }[];
  changed: { id: string; title: string; from: PlanItemStatus; to: PlanItemStatus; renamedFrom?: string }[];
}

/** `meta.missionSuggestion`: a person without the right to ask for work addressed the agent. */
export interface MissionSuggestionMeta {
  status: "pending" | "accepted" | "declined";
  missionId: string;
  by?: string;
  at?: string;
}

/** `meta.machineTask`: the notice when a background task ended. */
export interface MachineTaskMeta {
  id: string;
  title: string;
  status: MachineTaskStatus;
  exitCode: number | null;
  seconds: number;
  computer: string;
  executor: string;
  branch?: string;
  lastLine?: string;
  files?: string[];
  result?: string;
  missionId?: string;
  /** Commands it was refused with nobody to ask ("Bloqueado", "Liberar e repetir"). */
  blocked?: { tool: string; command: string }[];
}

/** `meta.missionCommand`: the executor asks to run a command off its allow list (the command card). */
/**
 * The end of a mission (`complete_mission`, or `auto` when every plan item
 * is done and nothing runs): what was delivered, what to check (per-person
 * checks), Concluir missão / Pedir ajustes.
 */
export interface MissionDelivery {
  id: string;
  missionId: string;
  taskId: string | null;
  messageId: string | null;
  auto: boolean;
  summary: string;
  artifactIds: string[];
  paths: string[];
  checklist: { id: string; text: string; checkedBy: string[] }[];
  status: "pending" | "accepted" | "changes_requested" | "superseded";
  note: string | null;
  saveToWiki: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** `meta.missionDelivery` on the delivery card's message. */
export interface MissionDeliveryMeta {
  missionId: string;
  id: string;
}

export interface MissionCommandMeta {
  id: string;
  missionId: string;
  taskId: string;
  tool: string;
  command: string;
}

/** A command the executor asked to run, and what became of it. */
export interface MissionCommand {
  id: string;
  missionId: string;
  taskId: string;
  tool: string;
  command: string;
  state: "pending" | "allowed" | "denied" | "expired";
  /** "Aprovar sempre": the rules it adds (`Bash(swift *)`). */
  rules: string[];
  decidedBy: string | null;
  decidedAt: string | null;
  always: boolean;
  /** "Aprovar sempre para o agente" is offered: the kind of command it keeps (`gh issue create`). Older servers leave it out. */
  agentKind?: string | null;
  /** The person chose it. */
  forAgent?: boolean;
  createdAt: string;
  expiresAt: string;
}

/** A mission command card's answer: `always` for the rest of the mission, `agent` that kind for the agent for good. */
export type MissionCommandDecision = "allow" | "deny" | "always" | "agent";

// ── Notifications (contract: one inbox per person per organization) ─────────────

export type NotificationKind =
  | "mention"
  | "thread_reply"
  | "dm"
  | "agent_reply"
  | "agent_question"
  | "issue_assigned"
  | "issue_comment"
  | "issue_status"
  | "approval"
  | "mission_finished"
  | "mission_stopped"
  /** ADR 0053: the agent told people what a routine found. Opens its message (`source.channelId`, `messageId`). */
  | "routine_finished"
  /** A routine's failure streak began (one per streak; the next good run resolves it). Opens it in Rotinas. */
  | "routine_failed"
  /** ADR 0097: an agent's run in a conversation failed for good (`latest.reason` coded). Opens that conversation. */
  | "run_failed"
  /** The server paused a routine (`latest.reason`: its coded `pausedReason`). Opens it in Rotinas. */
  | "routine_paused"
  /** A routine waits for its computer (once per outage; `source.machineId`). Opens it in Rotinas. */
  | "routine_stalled"
  /**
   * A routine set to act couldn't call an agent its creator can't talk to (the agent's owner, else who manages
   * agents). Opens the agent's page; `source.userId` is the creator, whom its action lets talk to it.
   */
  | "agent_unreached"
  /** A routine's run waits for its agent's plan to reset (once per outage). Opens it in Rotinas. */
  | "routine_waiting_plan"
  | "plan_reset_unknown"
  /** ADR 0136: an agent back from its plan or budget skipped catch-ups that looked handled (its owner; `count`). */
  | "catch_up_closed"
  /** ADR 0136: who asked, when their catch-up was skipped crediting someone else (`latest.title` who, `latest.reason`). */
  | "catch_up_closed_asker"
  | "reaction"
  /** ADR 0036 §5: a new computer joined the organization (admins). `source.machineId`; `source.label` = its name. */
  | "machine_connected"
  /** A computer ran a connect link and asks to join (its maker). `source.requestId`; `source.label` = its name. */
  | "device.join_request"
  /** Someone else's agent uses this person's device (once per run). `source.phoneId` or `machineId`; Stop. */
  | "device.in_use"
  /** An agent asks to use this person's device. `source.requestId`; Allow once, Always, No. */
  | "device.access_request"
  /** Someone's agent waits for this person's device to come back. `source.phoneId` or `machineId`. */
  | "device.waiting"
  /** ADR 0040 §6: an agent needs a person in its browser (sign in, a code). `source.handoffId`. */
  | "browser_handoff"
  /**
   * ADR 0027: an agent waits for a secret only this person can give (`latest.title` its name, `latest.text` what it
   * is for, `latest.expiresAt`). Opens the conversation at its card, where it is typed: never answered in the inbox.
   */
  | "secret_request"
  /**
   * ADR 0056 §8: the workspace was held, suspended or restored (owners and admins). `latest.statusTo`, `latest.text`:
   * why. On agentes.chat Cloud also an agent held (`statusTo: "agent_hold"`, `latest.holdKind`, `source.agentId`).
   */
  | "org_standing"
  /** ADR 0056 §10: the workspace's own computer is ready (owners). `source.machineId`; `source.label` = its name. */
  | "computer_ready"
  /**
   * ADR 0068: someone asks to join through the invitation link (owners and admins). Waiting; no actor;
   * `latest.title` the newest name, `count` how many asked while it was unread. Opens Members.
   */
  | "join_request"
  /**
   * ADR 0090: someone accepted the email invitation this person sent. The person as actor, `latest.title` their
   * name, `source.label` the workspace's. Inbox only. Opens Members.
   */
  | "invitation_accepted"
  /** ADR 0107 §7: the workspace used its Composio calls for the month (connector admins). `latest.title`: the month. */
  | "composio_limit"
  /**
   * ADR 0110: an agent's owner asks for one more browser profile for it (the people who grant profiles). Waiting;
   * `source.agentId` and its name in `source.label`. Opens the agent's page.
   */
  | "browser_profile_request"
  /** ADR 0115: a computer's disk passed 85% in use (admins). `source.machineId`; `latest.diskUse`, `latest.diskFreeGb`. */
  | "computer_disk_full"
  /** ADR 0133: a computer has no Google Chrome for its agents' browsers (who connected it). `source.machineId`. */
  | "computer_no_chrome"
  /** ADR 0059 §8: someone else took control of the person's agent's desktop. Once a day per agent; `source.agentId`. */
  | "desktop_taken"
  /**
   * ADR 0059 §3: someone gave an agent the person's plan (`use_others_plans`). One per agent and account;
   * `source.agentId`, `source.accountId`, `latest.plan`. "Tirar de volta" (`takeBackPlan`) makes it done.
   */
  | "plan_lent"
  /**
   * A model an agent thinks with left its plan's live list, so its turns run another (the agent's owner, once per agent
   * and model). `source.agentId`, the model in `latest.title`, the plan in `latest.plan`, what runs now in
   * `latest.nowModel`. Choosing another model makes it done.
   */
  | "plan_model_dropped"
  /**
   * ADR 0119: an AI app connected as this person created things for them. One per connection while unread;
   * `latest.title` the app's name, `latest.created` how many of each kind; opens `source.agentId` or `source.routineId`.
   */
  | "app_created"
  /**
   * ADR 0135: a widget's alert condition was met (whoever turned its alert on). Waiting; `source.widgetId`,
   * `source.dashboardId`, `source.agentId`, the widget's title in `source.label`, what the agent saw in `latest.text`.
   * Opens the widget.
   */
  | "widget_alert"
  /**
   * ADR 0135: a widget stopped updating (its creator), once per failure streak. `latest.reason` the coded reason
   * (`widgetFailureKey`); `agent_reported`: the agent's words in `latest.text`. Inbox only. Opens the widget.
   */
  | "widget_failed"
  /**
   * ADR 0135: an agent asks to show a board to more people (the person it made it for). Waiting; `source.dashboardId`,
   * `source.agentId`, the board's title in `source.label`, `latest.statusTo` `workspace` or `roles` (the roles' names
   * in `latest.names`), the agent's reason in `latest.text`. Opens the board, where Publish / Keep only for me are.
   */
  | "dashboard_proposal"
  /**
   * An update of a skill from its link: `latest.statusTo` `updated`, `waiting` (it changes files that run: who manages
   * skills, waiting, the files in `latest.title`) or `failed` (`latest.reason` its code). `source.skillId`, its name in
   * `source.label`. Opens the skill.
   */
  | "skill_update"
  /**
   * ADR 0137: someone asked the right hand for a change only others decide and sent it ("Pedir a um admin"). Waiting;
   * `source.proposalId` (or `source.messageId` for a new agent's card), `source.agentId` and `label` the agent,
   * `latest.text` why. Done once someone decides.
   */
  | "change_request"
  | "proposal_waiting"
  /**
   * ADR 0141: a person's monthly AI limit, `source.userId` the person, `latest.statusTo`: `warning` (80%, the
   * person), `reached` (who decides; `reached_notify` to the person when the limit only notifies), `request` (who
   * decides, waiting, with `raiseToUsd`), `raised` or `refused` (the person). The person's own carry a percent only.
   */
  | "usage_limit"
  /**
   * ADR 0139: someone chose this person to approve for them (`latest.statusTo` `always` or `while_out`,
   * `latest.expiresAt` its end), or the covered person hears the cover said no (`declined`) or an admin ended it
   * (`ended`). The other person is the actor. Inbox only. Opens Configurações › Aprovações.
   */
  | "approval_cover"
  /**
   * ADR 0139 §2: the right hand approved cards for this person today (`count` how many, `latest.title` the newest
   * one's agent, `source.agentId` the right hand, its name in `label`). Inbox only.
   */
  | "right_hand_decided"
  /** ADR 0139 §2: three of its decisions undone in a week stopped it. Waiting until it is turned back on. */
  | "right_hand_paused";

/** "O Gerente aprova por você" (ADR 0139 §2): what the person let the workspace's right hand approve. */
export interface RightHandApprovals {
  enabled: boolean;
  /** Creating agents other agents propose (no apps, open channels). */
  newAgents: boolean;
  /** Model on the same AI account, budget and open channels of an existing agent. */
  agentChanges: boolean;
  /** What it may add to one agent's budget in a month. */
  budgetCapNanoUsd: number;
  guidance: string;
  /** Three decisions undone in a week stopped it. */
  pausedAt: string | null;
  rightHand: { id: string; name: string } | null;
  /** What the person may decide themselves now: a kind they can't is greyed. */
  mayDecide: { newAgents: boolean; agentChanges: boolean };
  caps: { decisionsPerDay: number; newAgentsPerDay: number; monthNanoUsd: number };
  used: { decisionsToday: number; newAgentsToday: number; monthNanoUsd: number };
}

export type RightHandApprovalsInput = Partial<
  Pick<RightHandApprovals, "enabled" | "newAgents" | "agentChanges" | "budgetCapNanoUsd" | "guidance">
>;

/**
 * `meta.actionCard.delegate` (ADR 0139 §2): the right hand looked at the card for `forUserId`. Deciding, approved
 * (Desfazer until `undoUntil`, "Por quê?" reads `reason`), passed with its reason, out of reach, its own chain, a cap
 * reached, or undone.
 */
export interface CardDelegate {
  agentId: string;
  forUserId: string;
  state: "deciding" | "approved" | "passed" | "outside" | "own" | "limit" | "undone";
  reason?: string;
  decisionId?: string;
  at: string;
  undoUntil?: string;
  undoneByUserId?: string;
}

/** "Quem aprova por mim" (ADR 0139): how one cover reads, from either side. */
export interface ApprovalCoverView {
  /** Who covers me (`cover`), or whom I cover (`covering`). */
  userId: string;
  /** `while_out`: only while the covered person's status says out of office. */
  mode: "always" | "while_out";
  /** Merge, deploy and other high-risk actions are in. */
  risky: boolean;
  endsAt: string | null;
  /** Deciding now. */
  active: boolean;
}

export interface ApprovalCovers {
  cover: ApprovalCoverView | null;
  covering: ApprovalCoverView[];
}

export interface ApprovalCoverInput {
  userId: string;
  mode: "always" | "while_out";
  risky: boolean;
  endsAt: string | null;
}

/** Who did it; names and avatars come from the directory. */
export interface NotificationActor {
  type: "user" | "agent";
  id: string;
}

/** Where it lives: only the relevant ids are set. */
export interface NotificationSource {
  channelId?: string;
  threadId?: string;
  messageId?: string;
  dmId?: string;
  issueId?: string;
  issueNumber?: number;
  topicId?: string;
  approvalId?: string;
  questionId?: string;
  missionId?: string;
  routineId?: string;
  /** `skill_update`: the skill. */
  skillId?: string;
  /** `plan_lent`: the plan's account. */
  accountId?: string;
  /** `machine_connected`: the computer. */
  machineId?: string;
  /** Bring your own devices: the join or access request, and the phone. */
  requestId?: string;
  phoneId?: string;
  /** `browser_handoff`: the request (its chat card has the same id). */
  handoffId?: string;
  /** `change_request`: the proposal to decide. */
  proposalId?: string;
  /** `change_request` of a right hand's card of a workspace change (`messageId`): the action. */
  action?: string;
  /** `browser_handoff`: the agent's screen it is on, when not its browser (ADR 0058: `desktop`). */
  screen?: ScreenKind;
  /** `agent_unreached`: the routine's creator, whom the agent's owner may let talk to `agentId`. */
  userId?: string;
  /** `org_standing` to `agent_hold`: the agent held (its name in `label`); a widget's or board's agent. */
  agentId?: string;
  /** `widget_alert`, `widget_failed`, `dashboard_proposal`: the board (ADR 0135). */
  dashboardId?: string;
  /** `widget_alert`, `widget_failed`: the widget. */
  widgetId?: string;
  /** Channel name, thread title, issue title, topic title, mission or routine name (or the computer's name). */
  label?: string;
}

/** What the card shows (plain text; only @mentions are highlighted). */
export interface NotificationLatest {
  /** Snippet of the latest message, comment, question or summary (≤ 280 chars); an approval's why. */
  text?: string;
  /** The latest message was a GIF or a sticker (ADR 0091): with no `text`, the card names what it was. */
  media?: MediaKind;
  /** A body the server wrote: `text` in the reader's language by `latestText`. */
  meta?: PreviewMeta;
  /** Issue title, the approval's action title, the topic's question. */
  title?: string;
  /** Reactions: distinct emojis (≤ 5) and my message's snippet. */
  emojis?: string[];
  quote?: string;
  statusFrom?: string;
  statusTo?: string;
  /** `org_standing`: the billing hold put on (ADR 0079), in place of `text`. */
  billingHold?: string;
  /** Missions and routines. */
  steps?: { done: number; total: number; failedAt?: number };
  /** An agent's question with options. */
  suggestions?: string[];
  /** Approvals. */
  expiresAt?: string;
  /**
   * `routine_paused`: why (a `RoutinePausedReason`); `routine_failed`: its failed run's code (`routines.code.*`).
   * Both said in the person's language.
   */
  reason?: string;
  /** `approval`: asked while nobody watched, by a routine or an unattended run (ADR 0053 §8). */
  origin?: ApprovalOrigin;
  /** `org_standing` to `agent_hold` (agentes.chat Cloud): `network` or `operator`, never the hold's reason. */
  holdKind?: string;
  /** `org_standing` on agentes.chat Cloud: `text` is the reason a restriction reads with (`restrictionOf`). */
  cloud?: boolean;
  /** `join_request`: the first two people who asked, in the order they asked (`count` says how many in all). */
  names?: string[];
  /** `join_request` from a member's suggestion (ADR 0090): who suggested. */
  suggestedBy?: string;
  /** `computer_disk_full`: the share of the disk in use (0 to 1) and the GB left. */
  diskUse?: number;
  diskFreeGb?: number;
  /** `app_created`: how many of each kind (`agent`, `routine`, `skill`, `memory`, `channel`). */
  created?: Record<string, number>;
  /** `run_failed`: every run the row stands for, failed for one cause close together (`latest.reason`). */
  failures?: RunFailure[];
  /** `run_failed` on a computer brain: the plan's name its cause names ("Claude"). */
  plan?: string;
  /** `plan_model_dropped`: the model the agent's turns run now. */
  nowModel?: string;
  /** `usage_limit`: the share of the person's limit used. */
  percent?: number;
  /** `usage_limit` to who decides: the limit, the raise offered, where the limit comes from, this month's requests. */
  limitUsd?: number;
  raiseToUsd?: number;
  limitFrom?: string;
  runs?: number;
  /** `usage_limit`: the share of the requests made with the agent named in `title`. */
  share?: number;
}

/** A run a `run_failed` row lists: its agent and where it failed (`key` names both). */
export interface RunFailure {
  key: string;
  agentId: string;
  channelId: string;
  threadId?: string;
  messageId: string;
  label?: string;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** Goes into "Esperando você": it blocks an agent or a decision. */
  waiting: boolean;
  /** Most recent first, at most 10. */
  actors: NotificationActor[];
  /** Events merged into it (replies, comments, reactions). */
  count: number;
  source: NotificationSource;
  latest: NotificationLatest;
  readAt: string | null;
  doneAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Audit (Configurações › Auditoria) ────────────────────────────────────────

export type AuditOutcome = "done" | "failed" | "refused" | "pending";

/**
 * One row of the org's audit log (`GET …/audit`, admins): an agent's tool call
 * (`action: "tool.call"`, with an `outcome`) or a change (`approval.approved`,
 * `routine.created`…; `outcome` null).
 */
export interface AuditRow {
  id: string;
  at: string;
  actor: { type: "person" | "agent" | "system"; id: string | null; name: string | null };
  action: string;
  target: { type: string; id: string | null };
  /**
   * A tool call's: `kind`, `connector`, `title` (the call in words), `behind` (`person`, `routine`,
   * `unattended`), `routine` ({ id, name }), `input` (secrets masked), `reason`, `approvalId`, `secretRequestId`.
   */
  details: Record<string, unknown>;
  runId: string | null;
  channelId: string | null;
  channel: { id: string; name: string; kind: "channel" | "dm" | "task" } | null;
  onBehalfOf: { id: string; name: string | null } | null;
  outcome: AuditOutcome | null;
  /** The approval the call waited for or ran after, as it stands now. */
  approval: { id: string; status: string; decidedBy: { id: string; name: string | null } | null } | null;
  /** The secret the call waited for (`request_secret`), as it stands now. */
  secret: { id: string; status: "pending" | "delivered" | "declined" | "expired" | "canceled" } | null;
}

export interface AuditPage {
  rows: AuditRow[];
  next: string | null;
}

export interface AuditQuery {
  actorType?: "person" | "agent" | "system";
  actorId?: string;
  /** An agent's id: what it did, and what people applied from its cards. */
  via?: string;
  outcome?: AuditOutcome[];
  /** Only calls whose approval or secret nobody has answered yet. */
  waiting?: boolean;
  kind?: "tool" | "change";
}

/** `done`: "Concluídas", what I marked done in the last 30 days, the latest first (not counted). */
export type NotificationFilter = "all" | "mentions" | "waiting" | "unread" | "reactions" | "done";

export type NotificationCounts = Record<Exclude<NotificationFilter, "done">, number>;

/** `GET …/notifications`: visible ones (not done, not snoozed), waiting first, then newest. */
export interface NotificationPage {
  items: AppNotification[];
  counts: NotificationCounts;
  nextCursor: string | null;
}

/** The sidebar badge (`GET …/notifications/count`, `notification.counts`). */
/**
 * What reaches my devices as a notification, by category (ADR 0071 §8): the phone's and the browser's pushes and
 * the desktop app's banners. The inbox keeps everything either way.
 */
export type NoticeCategory =
  | "waiting"
  | "replies"
  | "mentions"
  | "threads"
  | "tasks"
  | "routines"
  | "computers"
  | "reactions";

export interface NoticePrefs {
  /** Every category, in the order the settings show them. */
  categories: { id: NoticeCategory; on: boolean }[];
  /** My phones that get pushes (the phone app). */
  phones: number;
}

/** A tool at the top of the sidebar (`SIDEBAR_ITEMS` in packages/engine/src/sidebar-items.ts). */
export type SidebarItem =
  | "approvals"
  | "proposals"
  | "threads"
  | "issues"
  | "wiki"
  | "drive"
  | "routines"
  | "calendar"
  | "team"
  | "dashboards"
  | "taskManager";
/** `always` in the list, `more` only in the More menu, `auto` in the list while its count is above zero. */
export type SidebarPlace = "always" | "more" | "auto";
/** Where I put each tool I moved, in one workspace (`GET …/me/sidebar`); the others keep their default. */
export type SidebarItems = Partial<Record<SidebarItem, SidebarPlace>>;
/** A section of the sidebar, in the order I put them (`SIDEBAR_SECTIONS` in packages/engine/src/sidebar-items.ts). */
export type SidebarSection = "tools" | "channels" | "agents" | "people";
/** How AGENTES orders each group (`AGENT_SORTS` in packages/engine/src/sidebar-items.ts). */
export type AgentSort = "workspace" | "mine" | "working";
/** "Fixar no topo": agent, channel and user ids on top of their own section, in order. */
export interface SidebarPins {
  agents: string[];
  channels: string[];
  people: string[];
}
/** How my sidebar shows the agents, and what I pinned, in one workspace (`GET …/me/sidebar/view`). */
export interface SidebarView {
  agentSort: AgentSort;
  /** Who manages agents also lists the ones that don't talk to them. */
  showAllAgents: boolean;
  /** Never saved: the apps pin my own agents (`dayOnePins`). */
  pins: SidebarPins | null;
}

/**
 * How I look at Tarefas in one workspace (`GET …/me/issues-view`), on every device: `ISSUES_VIEW_DEFAULT` in
 * packages/client/src/lib/issues-view.ts until I change it. The search is never kept.
 */
export interface IssuesView {
  layout: "board" | "list";
  group: "stage" | "assignee" | "priority";
  /** `manual`: the board's own order (what people drag); by priority (high first) or by due date (soonest first). */
  sort: "manual" | "priority" | "due";
  /** What the cards show besides their number and title. */
  fields: Record<IssueCardField, boolean>;
  /** Only tasks with one of these assignees: `agent:<id>`, `person:<id>` or `none` (empty: every task). */
  assignees: string[];
  /** Only tasks with one of these priorities (empty: every task). */
  priorities: IssuePriority[];
  showCanceled: boolean;
}
export type IssueCardField = "assignee" | "priority" | "due" | "criteria" | "pullRequest" | "label";

export interface NotificationCount {
  unread: number;
  waiting: number;
}

/** Per person (user scope): created or merged, auto-resolved, and the new counts. */
export type NotificationEvent =
  | {
      type: "notification.upserted";
      notification: AppNotification;
      /** Whether it reaches my devices as a notification, by my choices (ADR 0071 §8); absent from older servers. */
      alert?: boolean;
    }
  | { type: "notification.removed"; id: string }
  | ({ type: "notification.counts" } & NotificationCount);

// ── Phone app: pins, following threads, working now, reminders ─────────────────

/** Your explicit choice about a thread (`threadFollows.follow` / `unfollow`). */
export interface ThreadFollow {
  threadId: string;
  channelId: string;
  following: boolean;
}

/**
 * Unread marks on my own topic: a message in a conversation I'm in (no content: the lists read again), and my
 * reads and mutes from any device.
 */
export type UnreadEvent =
  | { type: "channel.activity"; channelId: string; threadId: string | null; dm?: boolean }
  | { type: "channel.read"; channelId: string; userId: string; lastReadAt: string }
  | { type: "channel.muted"; channelId: string; muted: boolean }
  | { type: "thread.read"; threadId: string; channelId: string; lastReadAt: string };

/** A pinned message (`GET …/channels/{id}/pins`, newest pin first). */
export interface MessagePin {
  messageId: string;
  channelId: string;
  /** The message's thread (null: the main timeline). */
  threadId: string | null;
  /** Null when that person was deleted. */
  pinnedByUserId: string | null;
  pinnedAt: string;
  message: Message;
}

/** "Trabalhando agora": an agent run in progress in a conversation you are in (`GET …/active-runs`). */
export interface WorkingRun {
  runId: string;
  agentId: string;
  channelId: string;
  channelKind: "channel" | "dm";
  /** Null for a DM. */
  channelName: string | null;
  /** Null: the main timeline (DMs are flat). */
  threadId: string | null;
  status: "queued" | "running" | "waiting_approval" | "waiting_input";
  startedAt: string | null;
  createdAt: string;
  /** What it works on: the thread's title (≤ 80 chars), never its first message's words; null: say where. */
  label: string | null;
  /** Messages sent to it while it works that it hasn't read yet. */
  pendingMessageIds?: string[];
  /** A routine's run working in the background: it holds no conversation and shows no "trabalhando". */
  background?: boolean;
  /** Long work in the background (ADR 0121): its title, plan and start. */
  work?: { id: string; title: string; plan: { done: number; total: number } | null; since: string } | null;
}

/** What a task uses right now: its latest tool call, as the chat's live chip says it (ADR 0128). */
export interface TaskNow {
  tool: string;
  detail: string | null;
  connector: string | null;
  service: string | null;
  serviceIcon: string | null;
  at: string;
}

/** Who asked a task in agents' private conversation, and what started the chain. */
export interface TaskDelegation {
  agentId: string;
  origin: { kind: "person"; userId: string; name: string } | { kind: "routine"; name: string } | { kind: "agent" };
}

/** One task in the task manager (`GET …/task-manager`, ADR 0128): a run still on. No cost. */
export interface ManagedTask {
  runId: string;
  agentId: string;
  channelId: string;
  channelKind: "channel" | "dm";
  /** Null for a DM (and a routine's room). */
  channelName: string | null;
  /** A conversation only agents are in: nobody can open it, its steps say what happens there. */
  betweenAgents?: boolean;
  /** Null: the main timeline. */
  threadId: string | null;
  status: "queued" | "running" | "waiting_approval" | "waiting_input";
  startedAt: string | null;
  createdAt: string;
  /** What it works on (≤ 80): its work's title, else its thread's, never its first message's words; null: say where. */
  label: string | null;
  /** A routine's background run. */
  background: boolean;
  routine: { id: string; name: string } | null;
  /** Long work (ADR 0121): its plan's progress. */
  plan: { done: number; total: number } | null;
  /** Who asked (a person); null for another agent, a routine or an event. */
  requester: { userId: string; name: string } | null;
  /** Another agent asked it, in their private conversation (absent on an older server). */
  delegation?: TaskDelegation | null;
  /** What it asked of other agents and is still on or not started, all the way down. */
  helpers?: number;
  /** `model`, `claude_code`, `codex`, `cursor`; null before its first turn. */
  brain: string | null;
  /** The agent's computer. */
  machine: { id: string; name: string } | null;
  now: TaskNow | null;
  /** Tool calls so far. */
  steps: number;
  pendingMessageIds: string[];
  /** You may stop it (who asked, the agent's owner, an admin). */
  canStop: boolean;
  /** What it waits on when it isn't a person: its computer (full or away), its plan's limit, the budget. */
  held?: "computer_busy" | "computer_offline" | "plan" | "budget" | null;
  /** Its place in its computer's line for room (people's turns first, then the longest wait). */
  line?: {
    machineId: string;
    position: number;
    of: number;
    people: boolean;
    /** When it should start (the line's estimate); null with no basis. */
    estimatedStartAt: string | null;
  } | null;
  /** Why a `waiting_input` run waits (absent on an older server). */
  wait?: TaskWait | null;
}

/** What a task waits on, in the words the apps need to say why. */
export interface TaskWait {
  /** `usage_pause`, `plan_limit`, `budget`, `busy`, `work_queue`, or what keeps its computer away. */
  code: string;
  /** Runs with the same key wait on the same plan or budget. */
  key: string | null;
  /** The plan in words ("Claude"); null for a budget. */
  plan: string | null;
  /** A wait on one model's refusal (its own limit, the region it needs, switched off): the model's name, and which. */
  model: string | null;
  scope: "model" | "region" | "off" | "inactive" | null;
  /** Paused near a limit: how far along, and the plan's window. */
  percent: number | null;
  window: string | null;
  /** When the limit resets; null when unknown. */
  resetsAt: string | null;
  /** When it began waiting on its plan or budget; null when unknown (absent on an older server). */
  since?: string | null;
  /** You may press Continuar agora. */
  canContinue: boolean;
}

/** A computer with turns running or waiting for room (counts only). */
export interface ComputerSummary {
  id: string;
  name: string;
  working: number;
  inLine: number;
}

/** A task that ended (`ended` of the task manager). */
export interface EndedTask {
  runId: string;
  agentId: string;
  channelId: string;
  channelKind: "channel" | "dm";
  channelName: string | null;
  betweenAgents?: boolean;
  threadId: string | null;
  status: "done" | "failed" | "canceled";
  label: string | null;
  background: boolean;
  routine: { id: string; name: string } | null;
  startedAt: string | null;
  finishedAt: string;
  /** Stopped by a person: who. */
  stoppedBy: { userId: string; name: string } | null;
}

/** A task's steps (`GET …/task-manager/{runId}/steps`): the chat chip's fields per call, how each ended. */
export interface TaskSteps {
  run: { createdAt: string; finishedAt: string | null };
  steps: RunStep[];
}

/** The workspace's work you may not see: how much, never what. */
export interface HiddenTasks {
  total: number;
  /** Of them, running now. */
  working: number;
  /** Per agent: its tasks still on. */
  byAgent: Record<string, number>;
}

export interface TaskManagerView {
  tasks: ManagedTask[];
  ended: EndedTask[];
  /** Absent on an older server. */
  hidden?: HiddenTasks;
  /** Computers with turns running or waiting for room (absent on an older server). */
  computers?: ComputerSummary[];
  /** Per agent with work in the last hour: tool calls per minute, 60 points, oldest first. */
  activity: Record<string, number[]>;
}

/** A one-off reminder in a conversation (`reminders.*`; also a routine in Rotinas). */
export interface Reminder {
  id: string;
  message: string;
  /** When it fires; null once done. */
  at: string | null;
  timezone: string;
  /** When, in English ("tomorrow, Oct 16, at 09:00 (…)"): show `at` in the app's words instead. */
  description: string;
  forUserId: string;
  channelId: string;
  threadId: string | null;
  done: boolean;
}

/**
 * "Lembrar": at `at` (ISO with offset) an agent of the conversation posts
 * "@you Reminder: …" where the message is. Agent: `agentId`, else the
 * message's agent author, else the first agent there you can talk to
 * (`reminder.no_agent` when none). Errors: `when.past`, `when.too_far`.
 */
export interface ReminderInput {
  channelId: string;
  threadId?: string | null;
  messageId?: string | null;
  agentId?: string | null;
  at: string;
  text?: string | null;
  timezone?: string | null;
}

// ── Mailboxes (ADR 0038) ────────────────────────────────────────────────────

/** A preset for our IMAP/SMTP connector (iCloud, Locaweb, Hostinger, Zoho…). */
export interface MailPreset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** What to log in with: the whole address, or only the part before the @. */
  username: "address" | "local";
  /** Where the person creates an app password; null = none to link. */
  appPasswordUrl: string | null;
}

/** `GET …/mail/providers`: which ways in this server offers. */
export interface MailProviders {
  /** Gmail and Outlook (through Composio). */
  composio: boolean;
  /** iCloud and any other mailbox (IMAP/SMTP). */
  imap: boolean;
  presets: MailPreset[];
}

export type MailLevel = "read" | "read_write";

/** A mailbox the organization connected (never its password). */
export interface MailAccount {
  id: string;
  provider: "gmail" | "outlook" | "imap";
  via: "composio" | "imap";
  address: string;
  label: string;
  status: "pending" | "active" | "needs_reconnect";
  lastError: string | null;
  /** The IMAP preset (`icloud`, `locaweb`…); null for Gmail/Outlook or a custom server. */
  preset: string | null;
  createdAt: string;
  /** Actions turned off in this mailbox for every agent ("O que faz"). */
  offActions: MailActionName[];
  /** Actions that always ask a person in this mailbox (`draft`, `organize`). */
  askActions: MailActionName[];
  /** Other addresses of this mailbox: a reply goes out from the one the email arrived at. */
  aliases: string[];
  /** What new emails go out from; null = `address`. */
  defaultFrom: string | null;
  /** Who connected it: the only person who gives agents access to it (absent on older servers). */
  ownerUserId?: string | null;
  /** Agents with access, and how much. */
  agents: { agentId: string; level: MailLevel; canDelete: boolean }[];
}

/** What can be turned on or off for a mailbox; each of the agents' email tools belongs to one. */
export type MailActionName =
  | "search"
  | "read"
  | "folders"
  | "draft"
  | "organize"
  | "send"
  | "reply"
  | "forward"
  | "delete";

/** Why an IMAP mailbox didn't connect (`422 { error }`). */
export type MailConnectError = "auth" | "imap_unreachable" | "smtp_unreachable" | "tls" | "blocked_host" | "unknown";

/** What a mailbox's PATCH changes (each field optional). */
export interface MailAccountUpdate {
  label?: string;
  /** A new app password (IMAP): tested first, a `422` carries `MailConnectError`. */
  password?: string;
  offActions?: MailActionName[];
  askActions?: MailActionName[];
  /** The mailbox's other addresses (replaces the list). */
  aliases?: string[];
  /** One of `address` or `aliases`; null = `address`. */
  defaultFrom?: string | null;
}

export interface MailImapInput {
  preset: string;
  address: string;
  password: string;
  label?: string;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export interface MailFolder {
  id: string;
  name: string;
  /** `inbox`, `sent`, `drafts`, `trash`, `archive`, `junk`… */
  role?: string;
}

/** An agent's rules for one mailbox. */
export interface MailPolicy {
  /** Folders it may read; empty = all. */
  folders: string[];
  /** Only mail from these addresses or `@domain`s; empty = anyone. */
  senders: string[];
  /** Only mail from the last N days; null = no limit. */
  windowDays: number | null;
  /** Only send to these addresses or `@domain`s; empty = anyone (always asking). */
  allowedRecipients: string[];
  dailySendCap: number;
  /** Sends without asking (only with `allowedRecipients`). */
  sendWithoutAsking: boolean;
  /** The only address this agent sends from (one of the mailbox's); null = automatic (replies from where the email arrived). */
  fromAddress: string | null;
}

/** An agent's access to one mailbox. */
export interface AgentMailbox {
  accountId: string;
  level: "none" | MailLevel;
  canDelete: boolean;
  policy: MailPolicy;
}

export interface AgentMailboxInput {
  level: "none" | MailLevel;
  canDelete: boolean;
  policy: MailPolicy;
}

// ── Databases (ADR 0039) ────────────────────────────────────────────────────

/** Where the database lives (only for the help when connecting). */
export type DatabaseProvider = "supabase" | "neon" | "railway" | "rds" | "render" | "other";

/** What can be turned on or off for a database; one of the agents' database tools each. */
export type DatabaseActionName = "list_tables" | "describe_table" | "query";

/** A Postgres database the organization connected (never its password). */
export interface DatabaseConnection {
  id: string;
  label: string;
  provider: DatabaseProvider;
  host: string;
  port: number;
  /** On a whole server, the sample database (where the rules' tables come from). */
  database: string;
  /** Agents read every database of the server, one per call. */
  wholeServer: boolean;
  /** Whole server: only the databases whose names start with this; null = every one. */
  databasePrefix: string | null;
  /** Whole server: how many databases agents see, when read in the last minutes; else null. */
  databaseCount: number | null;
  username: string;
  sslmode: "require" | "disable";
  status: "active" | "needs_reconnect";
  lastError: string | null;
  /** The user can change data: the app recommends a read-only one (agents only read anyway). */
  canWrite: boolean;
  createdAt: string;
  offActions: DatabaseActionName[];
  /** Columns hidden by default in agents' rules (`schema.table.column`). */
  suggestedHidden: string[];
  /** Agents that can read it. */
  agents: { agentId: string }[];
}

/** Why a database didn't connect (`422 { error }`). */
export type DatabaseConnectError = "auth" | "unreachable" | "blocked_host" | "tls" | "no_databases" | "unknown";

export interface DatabaseConnectionInput {
  label?: string;
  provider?: DatabaseProvider;
  /** `postgres://user:password@host:5432/database`; the fields win over it. */
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslmode?: "require" | "disable";
  /** Every database of the server; the database, if given, is where the rules' tables come from. */
  wholeServer?: boolean;
  /** Whole server: only the databases whose names start with this. */
  databasePrefix?: string;
}

export interface DatabaseTable {
  schema: string;
  name: string;
  kind: string;
  rowsEstimate: number;
}

/** An agent's rules for one database. */
export interface DatabasePolicy {
  /** `schema.table`; empty = every table. */
  tables: string[];
  /** `schema.table.column`, never read. */
  hiddenColumns: string[];
  /** Queries per day; null = no cap. */
  dailyQueryCap: number | null;
  /** Each query is cancelled past this. */
  timeoutSeconds: number;
  /** Whole-server connections: the only databases it reads; absent or empty = every one. */
  databases?: string[];
}

/** An agent's access to one database. */
export interface AgentDatabase {
  connectionId: string;
  level: "none" | "read";
  policy: DatabasePolicy;
}

export interface AgentDatabaseInput {
  level: "none" | "read";
  policy: DatabasePolicy;
}

// ── Agent browser (ADR 0040) ─────────────────────────────────────────────────

export type BrowserHandoffStatus = "pending" | "active" | "done" | "failed" | "expired" | "cancelled" | "withdrawn";

/** The screens of an agent that people watch and take over: one open handoff per agent and screen. */
export type ScreenKind = "browser" | "desktop";

/**
 * A person's turn on one of an agent's screens: the agent asked (`ask`, with a
 * chat card `meta.browserHandoff` whose message id is this id) or someone
 * watching took over (`takeover`: no card of its own; its browser card stays
 * with the run it is bound to, `runId`).
 */
/** Where the person in control sends the agent's page: an address they typed, or the address bar's arrows and reload. */
export type PageTarget = string | { go: "back" | "forward" | "reload" | "normalSize" };

export interface BrowserHandoff {
  id: string;
  agentId: string;
  runId: string | null;
  machineId: string;
  /** Absent from servers older than screens: the browser (`handoffScreen`). */
  screen?: ScreenKind;
  kind: "ask" | "takeover";
  instructions: string;
  status: BrowserHandoffStatus;
  requestedForUserId: string | null;
  /** Who is in control now (null: nobody yet). */
  controllerUserId: string | null;
  /** What the person told the agent when it ended ("Não consegui"'s reason, or a note on "Pronto"/"Devolver"). */
  note: string | null;
  /** While nobody has opened it: when it expires. Null once someone is in control (no deadline then). */
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Why an agent can't use its browser now (codes for the app's own text). */
export type BrowserUnavailableReason =
  | "no_machine"
  | "machine_removed"
  | "outdated"
  | "switched_off"
  | "not_installed"
  | "not_reported";

/** `GET …/agents/{id}/browser`: whether its computer serves the browser, and the sites it may open. */
export interface AgentBrowserSettings {
  /** Null: any site. `*.example.com` covers the domain too. */
  allowedDomains: string[] | null;
  available: boolean;
  reason: BrowserUnavailableReason | null;
  /** The computer's own words, when it said why. */
  detail: string | null;
  machine: { id: string; name: string } | null;
  /** Its default browser: a shared browser profile it may use (ADR 0110); null or absent = its own. */
  profileId?: string | null;
}

/** `GET …/agents/{id}/desktop` (ADR 0058): the agent's desktop as this person sees it. */
export interface DesktopStatus {
  /** Whether it can be shown now, else why (`reason`). */
  available: boolean;
  /** `no_desktop`, `no_computer`, `offline`, `other_server`, `runner_outdated`, `not_allowed` (its switch is off), `desktop_unavailable`. */
  reason: string | null;
  /** What the computer says it lacks (what to install). */
  detail: string | null;
  running: boolean;
  startedAt: string | null;
  /** Who is in control (of the desktop, or of the browser showing the same window), and that handoff. */
  controllerUserId: string | null;
  handoff: BrowserHandoff | null;
  viewers: number;
  /** This person may take control. */
  canControl: boolean;
  /**
   * Why not: `pairer` (only who connected the computer), `owner_plan` (only the agent's owner and admins who manage
   * agents while it thinks with the owner's plan), `role` (their roles give them the agents' browsers, not the whole
   * computer), `not_allowed` (neither an admin nor its owner). Absent from older servers.
   */
  controlRefusal?: "pairer" | "owner_plan" | "role" | "not_allowed" | null;
  /** The agent is held, or the workspace is on hold: people watch, nobody takes control. */
  held: boolean;
  /** The agent's browser runs on this desktop (ADR 0058 §7). Absent from older servers. */
  browserOnDesktop?: boolean;
}

/** `GET …/desktop/picture`: a recent picture of the agent's screen, or why there is none. */
export interface DesktopPictureView {
  picture: {
    /** A JPEG, base64. */
    data: string;
    width: number;
    height: number;
    capturedAt: string;
  } | null;
  /** `stopped`: its screen isn't running. `hidden`: someone else is in control. */
  reason: "stopped" | "hidden" | "unavailable" | null;
}

/** A plan window with each agent's estimated part of it (the usage views, ADR 0063). */
export interface PlanWindowParts extends PlanWindow {
  /**
   * The window's percent × each agent's API-priced share of the account's use since it started, biggest
   * first; null for a window of unknown length (no estimate).
   */
  agents: { agentId: string; name: string; percent: number }[] | null;
}

/** A plan account as the usage views name it. */
export interface PlanAccountInfo {
  /** `machineId:kind:accountId`, or `…:computer` for the computer's own sign-in. */
  key: string;
  machineId: string;
  machineName: string;
  kind: MachineAccountKind;
  /** Null: the computer's own sign-in ("Conta deste computador"). */
  accountId: string | null;
  label: string | null;
  plan: string | null;
  /** A key account's coding plan (`zai`, `kimi`…). */
  provider: string | null;
  /** Its owner, or the person who connected the computer for its own sign-in. */
  ownerName: string | null;
  /** The viewer owns it. */
  mine: boolean;
  /** Only for its owner. */
  email: string | null;
  signedOut: boolean;
}

export interface PlanAccountUsage extends PlanAccountInfo {
  /** Its windows as last reported, each with the agents' parts; null: not known yet. */
  usage: (Omit<PlanUsage, "windows"> & { windows: PlanWindowParts[] }) | null;
  /** This month per agent; `now`: it thinks with this account today. */
  agents: { agentId: string; name: string; tokens: number; now: boolean }[];
  monthTokens: number;
  /** `view_usage` only: what the month's tokens would cost through the API (null: no price). */
  equivalentUsd?: number | null;
}

/** `GET …/usage/plans`: every plan account by computer, and the API per agent this month. */
export interface OrgPlanUsage {
  /** `YYYY-MM`. */
  month: string;
  /** The viewer sees money. */
  money: boolean;
  accounts: PlanAccountUsage[];
  api: {
    agentId: string;
    name: string;
    tokens: number;
    budgetPercent: number;
    costUsd?: number;
    budgetUsd?: number;
    budgetIsDefault?: boolean;
  }[];
}

export interface AgentUsageSource {
  /** An account's key, `plan:<kind>` (before accounts were recorded) or `api`. */
  key: string;
  type: "plan" | "api";
  kind: MachineAccountKind | null;
  /** Null: the API, a removed account, or plan usage from before accounts were recorded. */
  account: PlanAccountInfo | null;
  /** A plan account that is no longer there. */
  removed: boolean;
  tokens: number;
  /** Share of the agent's month, 0–100. */
  share: number;
  /** `YYYY-MM-DD`. */
  lastDay: string | null;
  /** The account it thinks with now. */
  now: boolean;
  /** Plan: what it would cost through the API (money only). */
  equivalentUsd?: number | null;
  /** API: what it cost (money only). */
  costUsd?: number;
  /** API: this month's spend over the agent's budget. */
  budgetPercent?: number;
}

/** `GET …/agents/{id}/usage`: an agent's month by account and day, and the account it thinks with now. */
export interface AgentPlanUsage {
  month: string;
  money: boolean;
  tokens: number;
  equivalentUsd?: number | null;
  sources: AgentUsageSource[];
  /** Every day of the month so far: tokens per source key. */
  days: { date: string; tokens: Record<string, number> }[];
  current: PlanAccountUsage | null;
}

// ── AI apps (ADR 0119): this server as a remote MCP server ──

/**
 * What a connected app or a personal token may do: `read` only reads, `write` also sends tasks, `manage` also creates
 * and edits agents, routines and skills.
 */
export type AppAccess = "read" | "write" | "manage";

/**
 * How an app is shown, from the address its codes go back to: `verified` (its metadata document was fetched from
 * `host`), `https` (a site that says its own name), `loopback` (a program on this computer), `app_scheme` (Cursor).
 */
export type AppDisplayKind = "verified" | "https" | "loopback" | "app_scheme";

/** `GET /api/app/authorize/{req}`: what the consent page shows. */
export interface AppConsent {
  request: {
    id: string;
    expiresAt: string;
    access: { requested: AppAccess[] };
    client: {
      displayKind: AppDisplayKind;
      /** As the app calls itself: text, never markup. */
      name: string;
      host: string | null;
      /** `claude`, `openai`, `cursor`, `vscode`: only from an address the app proved. */
      brand: string | null;
      /** Where the browser goes back to: a host, or `scheme://host`. */
      returnsTo: string;
      reservedNameWarning: boolean;
    };
  };
  account: { name: string; email: string };
  workspaces: {
    id: string;
    name: string;
    logo: string | null;
    paused: boolean;
    current: boolean;
    /** Tells apart two with the same name. Absent from older servers. */
    createdAt?: string;
    /** While it's being deleted, when it goes. Absent from older servers. */
    deletion?: { dueAt: string };
  }[];
}

export interface AppConsentDecision {
  decision: "allow" | "deny";
  orgId?: string;
  access?: AppAccess;
}

export interface ConnectedApp {
  id: string;
  kind: "oauth";
  displayKind: AppDisplayKind;
  name: string;
  host: string | null;
  brand: string | null;
  access: AppAccess;
  /** Only in the whole workspace's list. */
  person?: { id: string; name: string };
  connectedAt: string;
  lastUsedAt: string | null;
}

export interface PersonalToken {
  id: string;
  name: string;
  access: AppAccess;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  person?: { id: string; name: string };
}

/** `GET …/apps`: this server's `/mcp`, the connected apps and the personal tokens. */
export interface AppsList {
  serverUrl: string;
  /** Apps that call from their own servers (claude.ai, ChatGPT) can reach it: https on a public name. */
  serverPublic: boolean;
  apps: ConnectedApp[];
  tokens: PersonalToken[];
}

export interface PersonalTokenInput {
  name: string;
  access: AppAccess;
  expiresInDays: 30 | 90 | 365 | null;
}

/** `POST …/tokens`: `secret` is shown once. */
export interface CreatedPersonalToken {
  token: { id: string; name: string; access: AppAccess; expiresAt: string | null };
  secret: string;
}

/** Who has a shared browser profile now (ADR 0110): an agent's run or a person in control. */
export type BrowserProfileHolder =
  | { type: "agent"; agentId: string; since: string }
  | { type: "person"; userId: string; since: string };

/** A browser profile (ADR 0110): named, shared logins on one computer that the agents granted it use. */
export interface BrowserProfile {
  id: string;
  machineId: string;
  name: string;
  createdAt: string;
  agentIds: string[];
  holder: BrowserProfileHolder | null;
  lastUsedAt: string | null;
}

/** What an agent's browser command waits for. */
export interface BrowserProfileWait {
  profileId: string;
  name: string;
  holder: BrowserProfileHolder;
}

/** Where a person's work happened, as the viewer may see it (ADR 0141): never a DM's content. */
export interface UsagePlace {
  kind: "channel" | "private" | "hidden" | "routine";
  channelId?: string;
  channelName?: string;
  routineName?: string;
}

export interface PersonLimitView {
  percent: number | null;
  state: "none" | "ok" | "near" | "at";
  requested: boolean;
  reachedAt: string | null;
  /** With money (`view_usage`) only. */
  monthUsd?: number;
  limitUsd?: number | null;
  limitFrom?: "raised" | "person" | "role" | "default" | "owner" | "none";
  limitRoleId?: string | null;
  raiseToUsd?: number | null;
}

export interface PersonLiveWork {
  personId: string | null;
  agentId: string;
  routine: boolean;
  place: UsagePlace;
  title: string | null;
  startedAt: string;
}

/** `GET …/usage/people`: Uso › Pessoas (ADR 0141), for who sees money. */
export interface PeopleUsage {
  month: string;
  since: string;
  until: string;
  totalUsd: number;
  plansOnly: boolean;
  limitsOn: boolean;
  people: (Required<Omit<PersonLimitView, "limitRoleId">> & {
    limitRoleId: string | null;
    userId: string;
    name: string;
    image: string | null;
    owner: boolean;
    roleIds: string[];
    runs: number;
    costUsd: number;
    estimated: boolean;
    agents: { agentId: string; share: number }[];
    caresFor: string[];
    created: number;
    lastActiveAt: string | null;
    now: { agentId: string; place: UsagePlace; title: string | null; startedAt: string } | null;
  })[];
  live: PersonLiveWork[];
}

export type PersonUsageRecent =
  | {
      kind: "work";
      agentId: string;
      place: UsagePlace;
      title: string | null;
      startedAt: string;
      minutes: number;
      amount: number;
    }
  | { kind: "private" | "hidden"; agentId: string; runs: number; amount: number; lastAt: string };

/** `GET …/usage/people/{userId}`: a person's month; `money` false: amounts are percentages of their limit. */
export interface PersonUsage {
  userId: string;
  name: string;
  image: string | null;
  roleIds: string[];
  owner: boolean;
  money: boolean;
  /** Some of it was use on a plan, priced at the API's list price ("≈"). */
  estimated: boolean;
  renewsAt: string;
  since: string;
  until: string;
  limit: PersonLimitView;
  total: number;
  days: { date: string; agents: Record<string, number> }[];
  agents: { agentId: string; runs: number; amount: number }[];
  recent: PersonUsageRecent[];
  created: { agentId: string; createdAt: string }[];
}

/** The monthly AI limits per person, in US$ (null: no limit); a role not in `roles` uses the default. */
export interface PersonLimits {
  defaultUsd: number | null;
  roles: Record<string, number | null>;
  people: Record<string, number | null>;
  onLimit: "block" | "notify";
  warn: boolean;
}

/** `meta.actionCard` of the card an agent posts when the person behind its run is at their limit (ADR 0141). */
export interface PersonLimitCard {
  kind: "person_limit";
  state: "limited" | "raised" | "refused";
  userId: string | null;
  agentId: string;
  runId: string;
  renewsAt: string;
  byUserId?: string;
}

/** Bring your own devices: who may point their agents at a device (the words of an agent's audience). */
export interface DeviceAudience {
  mode: "everyone" | "people" | "owner";
  userIds: string[];
  roleIds: string[];
}

/** A device's state, worded by the apps. Reason codes: `PhoneReason` in the machine protocol, plus the server's own. */
export type DeviceStatus =
  | { kind: "ready" }
  | {
      kind: "in_use";
      agentId: string | null;
      agentName: string | null;
      userId: string | null;
      userName: string | null;
      label?: string;
      since: string;
    }
  | { kind: "busy"; running: number; max: number }
  | { kind: "needs_you"; reason: string }
  | { kind: "preparing"; reason: string }
  | { kind: "paused"; until: string | null }
  | { kind: "offline"; lastSeenAt: string | null; withHost?: boolean }
  | { kind: "unsupported"; reason: string };

export interface PhoneDevice {
  id: string;
  platform: "android" | "ios";
  phoneKind: "device" | "emulator" | "simulator";
  name: string;
  model: string;
  osVersion: string;
  hostMachineId: string | null;
  ownerUserId: string | null;
  /** null: it follows its host's rule (an iPhone). */
  audience: DeviceAudience | null;
  status: DeviceStatus;
  transport: "usb" | "wifi" | "local" | null;
  lastSeenAt: string | null;
  mayUse: boolean;
  mayManage: boolean;
}

export interface ComputerDevice {
  id: string;
  machineKind: "connected" | "host" | "managed";
  name: string;
  os: string;
  arch: string;
  hostname: string;
  cpus: number | null;
  memoryGb: number | null;
  ownerUserId: string | null;
  belongsToWorkspace: boolean;
  systemMode: boolean;
  audience: DeviceAudience;
  status: DeviceStatus;
  maxTasks: number | null;
  toolchains: Record<string, string>;
  lastSeenAt: string | null;
  mayUse: boolean;
  mayManage: boolean;
  phones: PhoneDevice[];
}

/**
 * A computer that ran a connect link and waits for the link's maker to let it join. Not `JoinRequest`, a person's
 * request to join the workspace: two interfaces of one name would merge into one.
 */
export interface DeviceJoinRequest {
  id: string;
  linkId: string;
  name: string;
  hostname: string;
  os: string;
  arch: string;
  ip: string;
  location: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface DevicesList {
  devices: ComputerDevice[];
  requests: DeviceJoinRequest[];
}

/** A one-line install: works once, for a few minutes, and the computer still asks to join. */
export interface ConnectLink {
  id: string;
  code: string;
  expiresAt: string;
  commands: { unix: string; windows: string };
}

export interface ConnectLinkState {
  status: "waiting" | "asking" | "joined" | "denied" | "expired";
  request?: DeviceJoinRequest;
  machineId?: string;
}

/** Pairing an Android phone over Wi-Fi with a computer: where it stands. */
export interface WifiPairing {
  id: string;
  way: "qr" | "code";
  state: "waiting" | "pairing" | "connecting" | "connected" | "failed";
  /** Why it failed; `update`: the computer's agentes.chat is too old for it. */
  reason?: WifiPairFailure;
  /** Only when it starts: Android's QR text for Wireless debugging. */
  qr?: string;
  /** Connected: the phone in the devices list. */
  phoneId?: string;
  expiresAt: string;
}

export type WifiPairFailure =
  | "mdns_off"
  | "same_wifi"
  | "refused"
  | "timed_out"
  | "outdated"
  | "adb_missing"
  | "canceled"
  | "failed"
  | "update";

export interface ComputerDeviceInput {
  name?: string;
  audience?: DeviceAudience;
  belongsToWorkspace?: boolean;
  maxTasks?: number;
}

export interface PhoneDeviceInput {
  name?: string;
  audience?: DeviceAudience;
}
