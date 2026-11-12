# 0159. Personal mode: the same workspace, shaped for one person

- Status: Accepted (being built: the server, the shared client, the web and the phone app, in one change)
- Date: 2026-11-09
- Amends: ADR 0137 §6 (the onboarding asks what the workspace is for; the right hand's first run has a personal set of
  rows), ADR 0155 §6 (the first-run checklist), ADR 0147 (a conversation's default look follows the mode)

## Context

agentes.chat is built for teams: channels, people, roles, approvals, audit, a sidebar and a settings page sized for a
company. People who want agents for themselves (their calendar, bills, training, studies) meet all of that on the first
screen, and most of it means nothing to them. The features are still useful to them, so nothing should go away; what
they see first, and the words, should fit one person.

## Decision

### 1. One switch per workspace

`organization_settings.mode` is `team` (the default) or `personal`. It changes defaults, words and what is in sight,
never what exists or who may do what: every route, permission, table and tool works the same in both modes. Anyone with
`configure` changes it in Settings, both ways, at any time; the change is audited. A personal workspace may have other
members (a family): the mode is for the whole workspace, so everyone in it sees the personal shape.

### 2. Onboarding

The first question is what the workspace is for: "For me" or "For my company or team", two cards side by side, each
drawn with the app's own faces over the cards' horizon: the person signing up (their account's photo, else their
initials) in the middle of their agents, or on top of a small org chart of people and agents. "For me" asks no name or
logo: the workspace is created as personal, named in the person's language ("Personal"), with the browser's time zone.
"For my company" shows today's name, logo and time zone.

The right hand's first-run card (ADR 0155 §6) has four rows in personal mode: what the person wants help with (areas of
life, saved as the workspace's context), their agents, an AI, their apps. The people row is left out.

### 3. The apps in personal mode

The web app and the phone app read the same mode and the same shared helpers (`packages/client`), so both show the
same shape.

- **Sidebar:** the person's face and name on top (their menu: account, settings, switch workspace, sign out), with
  notifications and collapse beside it. Agents come first, with "New agent" under them: it asks in one sentence what
  the agent should do and sends it to the right hand, which proposes the agent (the full form stays one link away).
  Channels show as "Group conversations": with none to show, the section holds one row, "New group conversation"
  (for who may create one), and after the first the header's + creates the next. "More" closes the list: Home, "Go to…" and
  every tool start there (approvals show in the list while one waits); the sidebar's existing per-person choices still
  win.
- **A family:** every workspace has `#general`, and a personal one hides it, and the people with their direct messages,
  only while the person is its only member. Once others join, `#general` and the people show again.
- **Defaults from the server:** the server answers a person's sidebar order and tool places for the workspace's mode
  (the agents before the group conversations, the tools' personal order), in the same shape as a team's. Only a
  person's own choices are stored, so a workspace that changes mode shows the new defaults for anything nobody moved,
  and an order someone saved never reads as a default.
- **Chat:** every conversation opens in bubbles (DMs already did); a person's own choice still wins. The panels on the
  right of a conversation (the agent's panel beside its DM, a channel's members column) start closed at every width;
  the person's own toggle is remembered and wins.
- **Settings:** six sections in one list (Your account, About you, AI and usage, Connectors, Vault, Computers) and
  the rest under Advanced, collapsed. AI and usage also holds the plan and billing. People joins the list once others are members. Every section still opens by its
  address, from ⌘K and from the right hand's cards.
- **An agent's page:** its bar is Overview, Instructions, Memory, "Can use" (its apps and mailboxes), Settings (name,
  look and budget) and Advanced, with no "More". Advanced holds the rest, whole: Activity, Files and Usage a click away,
  then its owner and who it reports to, who may talk to it, its brakes, conversations, computer, archive and delete,
  and its built-in areas, databases, rules and skills. Every tab and section keeps its address: one that points into
  Advanced opens it there.
- **On the phone:** the same, from the same shared numbers and helpers: the first question's two cards side by side
  with the same drawings (`@agenteschat/client/lib/purpose-scene`); an agent's brakes, who it reports to, its rules
  for good, its repositories and deleting it on an Advanced screen of its own, a row away from its edit screen and its
  access; creating one starts from the same personal agents.
- **Creating an agent by hand:** four steps (role, identity, instructions, review). Its apps, where and who, and its AI
  start filled in (every app, only its owner, Automático) and are passed over; the review still opens each one. The
  starting points are the right hand's personal agents (calendar, bills, training, meals, studies, writing, home,
  travel, clients), not a company's roles.
- **Roles and permissions:** only the view is simpler. Inviting asks one plain question (they use the agents, or help
  you run the workspace, which is the highest role the inviter may give that holds `administrator`), says which agents
  will answer the new person, and pickers of who may talk to or see something offer people, with roles only when a role
  other than the base and administrator ones exists or one is already picked. The access levels keep their words, and
  every granular control stays where it was (the page's own advanced part, or Settings › Advanced). What anyone may do
  never changes.
- **Words:** a personal workspace's name ("Personal") says nothing to anyone, so the apps never show it where it would
  stand for the workspace: an invitation's page goes by whose workspace it is (the invitation's preview carries the
  `mode`), the workspace's context reads as what the agents know about the person, and the workspace's own computer is
  named for the person's agents in every language. Channels are called group conversations in the sidebar, ⌘K and
  the dialog that makes one.

### 3a. The agents in personal mode

- A new agent answers only its owner unless an audience is given (`createAgent`): someone who joins later is not
  answered, nor shown its details, by every agent made while the person was alone. Agents already there keep theirs,
  and the right hand still answers everyone.
- The right hand's proposals speak of the person's agents: each agent it proposes lives in its DM with the person,
  where its routines report, so `propose_team` and `propose_agent` leave the channel out unless the person asked for a
  group conversation. In a team's workspace each agent of `propose_team` still names its channel.
- A new agent starts with broad access (`createAgent`): every app connected in the workspace (`connector:*`, as a new
  connection gives every agent) and its calendar, when whoever creates it may give access (`manage_agents`), so a
  family member's own agent starts as a team's does. The form's custom servers start at write too. Sensitive tools
  still ask a person on every call; mail, databases and the computer keep their own switches.
- Prompts, tool descriptions, emails, pushes and notices speak of one person and their agents. Names, schemas and what
  each tool does are the same in both modes, except that `propose_team`'s channel is optional in personal.

### 4. Switching

Settings shows the mode with a button to switch. Personal → team asks only for the workspace's name and says what
appears (channels and people, invitations and roles, delegated approvals and audit) and that nothing else changes.
Team → personal says what changes and that nothing is lost; when other people are members it says they will see the
personal shape too. Inviting someone in personal mode asks whether to stay personal or switch to team.

## Consequences

- One code path: components read `isPersonal(org)` and pick defaults or words; there is no second app.
- The phone app changes in the same change as the web app; a client that predates the mode reads every workspace as a
  team's, since every new field is optional.
- Strings are i18n keys in every language, personal variants included.

## Alternatives considered

- **A mode per person:** two people in one workspace would see different apps for the same data. Rejected: the
  workspace is the unit people set up and talk about.
- **A separate personal product:** two apps to keep in step for the same features. Rejected.
- **Hiding features in personal mode:** the user asked to keep every feature; only what is in sight changes.

## Amended 2026-11-09

Opening a personal workspace with no start place chosen (ADR 0108, "Início") lands on the last conversation that
browser showed there, else on the right hand's; the home only when there is neither. A chosen channel or "where I left
off" works as in a team workspace (web `routes/org.$orgId.index.tsx`).


## Amendment (2026-11-10): "New agent" opens the card (§3)

ADR 0164: the sidebar's "New agent" opens the same card as a team's, with the personal starters; the one-sentence ask
sent to the right hand is gone.

## Amendment (2026-11-10): the personal onboarding (§2)

"For me" no longer opens the workspace at once. It still creates the workspace as personal, named in the person's
language, and then goes through the onboarding's rail (ADR 0162, amended 2026-11-10) in its own words and with no
business step: its agents (bringing them from another app, or "Seguir sem agentes"), the plan where the workspace waits
for its first one, and connecting an AI, then the right hand's DM. On a billing hold the card's first row is "Ligue os
seus agentes.", before the four rows above.
