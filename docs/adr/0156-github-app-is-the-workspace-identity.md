# 0156. The GitHub App is the workspace's GitHub identity

- Status: Accepted
- Date: 2026-11-07
- Amends: 0033 (the app is a connection by itself, removing an installation uninstalls it, the panel reconciles, only
  an installation made from agentes.chat links),
  0024 (the proxy's upstream permissions), 0116 (agents' commits are the app's bot's)
- Code: `packages/engine/src/git/github-app.ts` (tokens by permission sets, `installationToken`, `botIdentity`,
  `uninstallInstallation`, `installationStatus`, `installationOrigin`), `github-app-installs.ts` (binding, removal,
  reconcile, webhook),
  `github-app-settings.ts` (the server's app: env or made with GitHub's manifest flow, the manifest, its state),
  `github-call.ts` (`githubCallAuth`, `githubListingHeaders`, `appPermissionsFor`), `signature.ts`;
  `connectors/connections.ts` (`syncGitHubAppConnection`, `GITHUB_APP_AUTH`, `revokeConnection`), `connectors/mcp.ts`,
  `connectors/catalog.ts` (`sign`); `git/machine.ts` (bot author, the turn's credit line), `git/proxy.ts`, `git/tools.ts`;
  `apps/server/src/routes/github-app.ts`; migration 0242; screens: `packages/client/src/lib/github-app.ts` (what the
  panel shows, shared by the web and the phone), `apps/web/src/components/GitHubAppPanel.tsx` (the panel and the
  server's app card), `ConnectFlow.tsx`, `Connectors.tsx`, `apps/mobile/src/features/connectors/GitHubApp.tsx`

## Context

In a shared workspace GitHub was connected by one person (an OAuth app, or a pasted token), so every agent opened pull
requests, issues and comments as that person: a member's agents wrote with another member's account. ADR 0033 had
built a public GitHub App, but only the git proxy, direct fetches and four of our own tools used its tokens, and only
next to a person's connection. GitHub's MCP tools, which do most of the writing, always went as the person.

## Decision

1. **Where a workspace's installation of the app covers what a GitHub call names, the call goes as the app.** Every
   GitHub MCP tool call asks for its token per call (`githubCallAuth`): one repository named, a token for that
   repository alone with the permissions of the tool's scope (`appPermissionsFor`); an account, or several
   repositories of one account, the installation's token; nothing named, the workspace's connection. Our own tools,
   proxy pushes and fetches already did. Pull requests, issues, comments, reviews, merges and API commits then come
   from `<slug>[bot]`. Where no installation covers the call, the workspace's account connection is used, as before.
   Permission sets are asked most first: a push asks for `workflows: write` and falls back to contents alone on an
   installation that lacks it; `actions.run` asks for `actions: write`, which an installation that hasn't accepted it
   yet refuses, and the account runs it. A person's Projects never go through the app (GitHub Apps can't reach
   them); an organization's do since the addendum below.
2. **The app alone is a GitHub connection.** Binding a workspace's first installation without a GitHub connection
   makes one (`auth_type = github_app`, no secret, the installations' accounts as `account_label`), every agent's
   like any first connection, so grants, "Aprovar sempre", the proxy URL, repository lists and approvals work
   unchanged. Its tools are listed with an installation's token. Connecting an account later replaces it (grants
   and rules move, as on Reconectar). Disconnecting an account while installations remain keeps
   the row as the app alone (same id, secret cleared, the token still revoked at GitHub); disconnecting the app alone
   unbinds every installation and uninstalls them. The last installation unbound ends it, as disconnecting does.
3. **Signature.** Every body an agent writes to GitHub ends with one line, in the workspace owner's language, naming
   the agent and the person it works for (who asked, a routine's creator, else the agent's responsável; members only):
   "Theo, agente de Ana no agentes.chat", inside `<sub>` after the marker `<!-- agentes.chat -->`, names escaped so
   they never mention or link anyone. An edit takes our earlier line out (the marker on a line of its own and the
   line under it), nothing else: a signed comment quoted in a reply stays the reply's text. It is added whichever
   token the call goes with, when the call runs: approval cards show the agent's own words. The tools that sign say so in the
   catalog (`sign`); a pull request without a body gets the line alone.
4. **Commit credit.** Commits credit the person (`Co-authored-by: Name <id+login@users.noreply.github.com>`) only when
   they linked GitHub to sign in: the id from that sign-in, the login GitHub has for it now (cached for a day). Never
   their email; no linked account or no answer, no trailer. API commits (`push_files`, `create_or_update_file`) get it
   in their message; on agents' computers each turn says it next to where the turn starts, for the person behind the
   turn's run as the signature names them.
5. **Agents' computers.** With an installation bound, commits are authored as `{agent} (agentes.chat)` at the bot's
   noreply address, so GitHub shows them as the app's; pushes already went through the proxy with the app's token.
   Fetch tokens stay read-only. No token is handed to `gh` (below).
6. **The server's own app.** `GITHUB_APP_*` win. Without them the server's pinned owner, never on agentes.chat, creates
   the app from Settings with GitHub's manifest flow: a server page posts the manifest (agentes.chat's own app's
   permissions, in the addendum below; its addresses from `PUBLIC_URL`; the webhook off without https) to GitHub,
   which creates the app under their account and returns a code; `POST /app-manifests/{code}/conversions` gives its
   id, slug, client id and secret, private key and webhook secret, kept sealed in `instance_secrets` (`github_app`,
   AAD `instance-secret|github_app`, the slug as hint) and read again a minute after the last read. The flow is bound to the owner's session: a leaked
   state with someone else's code can't plant their app. The owner's account deletion removes it, like the Jev key.
7. **Remove means uninstall.** Removing an installation from a workspace also uninstalls the app from that GitHub
   account (`DELETE /app/installations/{id}`, best effort; the response says when GitHub didn't). Deleting the
   workspace uninstalls its installations with its other outside grants (`org.delete` retries one GitHub refused).
   A personal account's installation binds only for that account itself: collaborators on its repositories see it in
   `GET /user/installations` too.
8. **No webhook needed.** Reading the panel asks GitHub about each installation, at most once a minute per
   workspace: uninstalled there, it is unbound as `installation.deleted` does; otherwise its account, selection and
   suspension are refreshed. The webhook still works when set up; a suspension event follows what GitHub says of the
   installation then, so a delivery sent again later changes nothing. A repository change made on GitHub's own page
   comes back without our state and lands on the web app with nothing to finish.

9. **The app first, in every place GitHub is connected.** Where the server has the app, connecting GitHub (Settings ›
   Conectores, an agent's connect card, the phone's sheet) offers **O app agentes.chat** (recommended) before **Uma
   conta do GitHub**, which stays for what the app can't reach (a personal account's GitHub Projects).
   **Repositórios do GitHub** lists each account the app is installed on with its reach, **Gerenciar no GitHub** (GitHub's page of the installation, where
   its repositories are picked) and **Remover** (asked first, it uninstalls, and says when GitHub didn't confirm,
   with its page as the way out); a workspace using an account sees who agents act as today. GitHub through the app
   alone has no Reconectar and offers **Conectar uma conta do GitHub**; Desconectar says what happens to the app. The
   phone does the same: the install opens GitHub in the browser and comes back to the app, which finishes it. The
   server's own app is a card for its pinned owner (`setup`), made in the web's browser session; the other admins
   are told the owner can make it (`ownerCreates`, false on agentes.chat).

10. **Only an installation made from agentes.chat links.** Seeing an installation proves little:
    `GET /user/installations` shows an organization's installation to every member who can read one of its
    repositories, so a read-only member could link one made on GitHub itself (or kept there when its uninstall was
    refused) to their own workspace and write to every repository it covers. A new link therefore also needs GitHub's
    own word on the installation (`GET /app/installations/{id}`, signed as the app, `installationOrigin`): made at or
    after the install's state was issued (`oauth_states.created_at`, two minutes allowed for the clocks and GitHub's
    whole seconds), on the account the person sees. `setup_action=update` (an existing installation whose
    repositories changed) only refreshes one already linked to this workspace, never links one. Anything else is
    refused as `github_app.installed_outside` (`github_app_error=installed_outside`), whose words give the way out:
    remove the app on GitHub and install it again from Conectores › GitHub. An install that comes back without a
    state of ours (started on GitHub's own page, or approved there) is told the same. The phone's return doesn't carry
    `setup_action`, so there the creation time alone decides, which already refuses every installation older than
    the state.
    - **Why not Members: read.** The other way was to ask GitHub for the organization permission Members (read) and
      link only for an owner of the organization. Every installation would have to accept a new permission before it
      linked, and a role says who may install, not that this installation was meant for this workspace. The state,
      issued to this person in this workspace minutes before GitHub made the installation, says exactly that, with no
      new permission, and it covers personal accounts and refused uninstalls the same way.
    - **The request flow.** A member without rights on the account asks its owner (`setup_action=request`). The owner
      approves later on GitHub, after the member's state expired, so that installation is older than every state and
      never links: an owner starting the install from agentes.chat is shown the existing installation and refused. The
      account's owner installs from Conectores › GitHub in the workspace instead (as one of its admins), after
      removing an installation already approved on GitHub. The member's notice says who installs it and where.

## Consequences

- An agent's writing on GitHub says whose agent it is, on repositories the app doesn't cover too.
- One GitHub account's installation still belongs to one workspace (ADR 0033); a second one is refused with
  `other_workspace`.
- An installation made on GitHub itself never links, configured from agentes.chat or not (ADR 0033 bound it then): it
  is removed on GitHub and installed again from agentes.chat. So is one whose uninstall GitHub refused, or one approved
  from a request.
- The server's clock must stay within two minutes of GitHub's, or fresh installations are refused as made outside.
- Branch protections that restrict who may push or merge must allow the app.
- Display names are public in signatures on public repositories.
- The remote MCP server must accept installation tokens (github-mcp-server#1610, fixed 2025-12-17): checked with one
  real call before the Cloud turns it on.

## Not done

- **`gh` as the bot.** It would need a token with pull requests and issues but never contents (which would let a push
  skip the proxy), one installation per turn (gh takes one token per host), a way to hand it over without an
  environment variable (the agent user's own `hosts.yml`, system mode only), an optional `gh` field in `git.sync` with
  a protocol bump, and it could never be signed. Brains already reach the signed tools through the bridge.
- Assigning the pull request to the person, and listing repositories per installation in searches.
- A `prepare-commit-msg` hook for the computer's credit, if the instruction proves unreliable.

## Addendum (2026-11-08): agents work on GitHub on their own, as the app

Agents read and write on GitHub without a person in the loop, within their grants, as the app. The app holds wide
permissions; each call still gets a token with only what its tool needs, and what is destructive asks a person.

- **The app's permissions** (agentes.chat's own app, and `githubAppManifest` for a server's): on repositories,
  Actions, Administration, Attestations, Checks, Code scanning alerts (`security_events`), Commit statuses
  (`statuses`), Contents, Custom properties (`repository_custom_properties`), Dependabot alerts
  (`vulnerability_alerts`), Dependabot secrets, Deployments, Discussions, Environments, Issues, Merge queues, Packages,
  Pages, Projects (classic) (`repository_projects`), Pull requests, Repository security advisories
  (`repository_advisories`), Secret scanning alerts, Secrets, Variables (`actions_variables`, not `variables`),
  Webhooks (`repository_hooks`) and Workflows, write; Metadata read; on organizations, Members read and Projects
  (`organization_projects`) write. Not asked: Codespaces (agents have their own computers, and Codespaces bill the
  organization) and an organization's administration, member management, secrets, variables, runners and webhooks.
  GitHub asks each installation's account to accept new permissions; until it does, calls that need them fall back
  (below). A server's app made before keeps its permissions until its owner adds them on GitHub.
- **Least privilege per call** (`github-call.ts`): the token is minted for the call's repository alone (or the account
  it names) with its tool's permissions (`TOOL_PERMISSIONS`), else its scope's (`SCOPE_PERMISSIONS`), sets asked most
  first. An installation that hasn't accepted a permission refuses that set and the next is asked; with none granted
  the account connection runs the call, and through the app alone the agent is told an admin accepts the new
  permissions on GitHub (Manage on GitHub) or connects an account. The new scopes and what they mint:
  - `repo.admin` (Manage repositories): `administration: write`.
  - `discussions.read`, `discussions.write`: `discussions` read, write.
  - `security.read` (Read security alerts): one permission per tool, the kind of alert it reads: code scanning
    `security_events`, Dependabot `vulnerability_alerts`, secret scanning `secret_scanning_alerts`, a repository's
    advisories `repository_advisories: read` (an organization's list is `write`: GitHub shows it only to who may
    write them).
  - `org.read` (Read teams): `members: read`.
  - `projects.read`, `projects.write`: `organization_projects` with issues and pull requests read (an item's title and
    fields are its issue's or pull request's), then `organization_projects` alone.
  - `repository_ruleset_read` (in `repo.read`): `administration: read` (rule suites), then metadata.
- **Organizations only.** GitHub Apps can't reach a person's Projects and create repositories only in an
  organization: a Projects call or `create_repository` goes as the app only on an organization's installation it
  names (`owner`, `org` or `organization`); on a personal account's, or naming none, it goes as the account, and
  through the app alone the agent is told it needs one. Projects' tools are no longer hidden through the app alone.
- **Toolsets** (`X-MCP-Toolsets`): `discussions`, `labels`, `code_security`, `dependabot`, `secret_protection`,
  `security_advisories` and `governance` besides the earlier ones (an unknown one is ignored by the server). The
  catalog takes the tools that use the new permissions: discussions (`list_discussions`, `get_discussion`,
  `get_discussion_comments`, `list_discussion_categories`, `discussion_comment_write`, signed), labels (`list_label`,
  `label_write`), security alerts (`list_`/`get_code_scanning_alert(s)`, `…_dependabot_alert(s)`,
  `…_secret_scanning_alert(s)`, `list_repository_security_advisories`, `list_org_repository_security_advisories`),
  rulesets (`repository_ruleset_read`, `create_repository_ruleset`), repositories (`create_repository`,
  `delete_repository`) and `get_team_members`. A tool the catalog doesn't list is still never exposed.
- **Approvals.** Deleting a repository and creating a ruleset (branch protection: who may push or merge from then on)
  are sensitive, like merges, workflow runs and reviews: every call asks a person, with its own title. Reads and
  ordinary writes run on the agent's grant: comments, issues, pull requests, labels, discussions, and creating a
  repository (GitHub's server makes it private unless the agent says otherwise).
- **Not done.** GitHub's MCP server has no tools for secrets, variables, webhooks, deployments, environments, Pages,
  packages, Dependabot secrets, merge queues or attestations, nor for dismissing an alert, classic branch protection,
  deleting a branch (our `delete_branches` asks a person) or a repository's visibility: the app holds the permissions
  for when it does. Notifications, gists and stars are a person's, which GitHub gives no app. Custom properties,
  forks, the global advisory database, Copilot and Code Quality wait for a need. An account connection's sign-in asks
  no new scope, so deleting a repository as an account fails (GitHub wants `delete_repo`). GitHub's REST schema for
  installation tokens doesn't list `repository_advisories` (its permissions reference does): one real advisory call
  checks that GitHub mints it.

## Addendum (2026-11-08): what happens on GitHub wakes the agent

The app subscribes to `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`,
`pull_request_review_thread`, `discussion` and `discussion_comment` (`GITHUB_APP_EVENTS`, in `githubAppManifest`). An
app made before keeps the events it was made with: the server's owner sees in Settings › Connectors which to tick, with
its page on GitHub (`missingGitHubAppEvents`, from `GET /app`). `git/github-events.ts` does the rest.

- **Intake.** The webhook checks the signature, keeps installation events as before, and queues any other event agents
  hear as one job (`github_app.event`) per `X-GitHub-Delivery` (the outbox's dedupe key, kept with the finished row),
  so it answers at once and GitHub's Redeliver adds nothing. An event for an installation no workspace bound is dropped.
- **What agents hear.** A comment (issue, pull request, review comment, discussion), a submitted review with a body or
  a verdict, the app's bot asked to review, a pull request, issue or discussion opened naming the app (`@slug`), a pull
  request merged or closed, an issue closed. Never a bot's text (the app's own included) nor a body that ends with our
  signature line (an agent writing through an account's connection); a close by the app itself is an agent's own.
- **Which agent.** `github_items` keeps each item (repository and number: issues, pull requests and discussions share
  them) an agent opened or wrote on through its GitHub tools (the signed ones, and `open_pull_request`), with the
  conversation it worked from (a routine's run: where it reports) and the run (the last one on a task: a run GitHub
  woke, with none, keeps the one before, so a merge still names the task). The agent that opened an item keeps it;
  one only written on goes to whichever agent wrote last. Events on an item go to its agent, in that conversation; a
  merge or a close only to the agent that opened it. An agent taken out of that conversation since isn't brought back
  there, as a mention wouldn't be: the event is dropped, and so is "Pedir resposta" on an older notice
  (`github_event.agent_not_here`). A mention of the app on an item no agent worked on goes to the
  right hand, to hand on: in the DM of the member who wrote it, or for anyone else in the DM of whoever connected that
  GitHub account here (the installation's `createdByUserId`, while a member), where it wakes nobody until they ask.
- **Who is behind it.** A commenter whose GitHub account is a member's sign-in (`accounts`, `providerId` `github`), who
  reads that conversation (work handed to the agent in the agents' DM, which no person reads: who belongs to the
  workspace) and may talk to the agent, wakes it with them behind the run (the notice's server-set `refs.personId`,
  which `messageRoot` follows). Anyone else leaves a notice that wakes nobody (`refs.outside`), with
  "Pedir resposta" for whoever reads the conversation and may talk to the agent: once, a second notice with that person
  behind it wakes the agent. A merge or a close wakes the agent whoever did it, with nobody behind it but a member.
- **What the agent reads.** A `github_event` notice: the server's line ("Ana commented on PR #12 (acme/app) on GitHub",
  with the link), the GitHub text inside the outside-content envelope, and what to do: answer there with its GitHub
  tools (signed as always) and keep the conversation short; hand an unowned item on; bring its task in line with a
  merge or a close. A notice with GitHub text is outside content (`meta.readOutside`, ADR 0117), a member's own words
  included: the run it wakes posts and learns as one that read outside (low trust, ADR 0120), and so does a later run
  of that conversation. People see the same line in their language, the text and the link on "Ver". Conversation lists and
  notifications show that line with what they wrote (`previewMeta`, `bodyCode` `github_event`), never their words
  alone under the agent's name, and a push never quotes it.
- **Not done.** `pull_request_review_thread` (resolved threads) is subscribed but wakes nobody. Who wrote a review the
  bot left isn't known from a reply to it: the item's agent hears it. An edit to a comment wakes nobody.

## Addendum (2026-11-11): an organization's installation links only for one of its owners

Decision 10 ties a new link to an install started here, by time: GitHub made the installation after the state was
issued. Time alone doesn't say who made it. A member whose own install can't go through (GitHub turns it into a request
to the owners) still holds a fresh state while an owner makes the installation on GitHub, and
`GET /user/installations` shows it to them the moment it exists.

- **The rule.** Linking an installation on anything but a personal account also needs GitHub to say the authorizing
  person owns that organization: `GET /user/memberships/orgs/{org}` with their token from the callback, `state`
  `active` and `role` `admin`. Anyone else (a member, a billing manager, an invitation not yet accepted, an outside
  collaborator, whom GitHub answers 404) is refused as `github_app.owner_required`
  (`github_app_error=owner_required`), told what the request flow already says: the account's owner installs it from
  Conectores › GitHub in this workspace. The personal account rule and the time rule stay as they are. A return for
  an installation already linked to this workspace (a refresh) links nothing new and asks no owner. Nothing changes
  for agents: tokens are minted as before once it is linked.
- **The permission.** The call is made with the organization permission Members (read), which agentes.chat's app and
  `githubAppManifest` already ask (first addendum of 2026-11-08): no installation accepts anything new. Whether
  GitHub answers it to an app without that permission isn't in its documentation and wasn't probed. This revisits
  "Why not Members: read" in decision 10: the role is asked besides the state, not instead of it, and of the person,
  not of the installation.
- **When GitHub won't say.** A 403 links nothing (`github_app.owner_unknown`, `github_app_error=owner_unknown`):
  GitHub refused the app the answer. The likely cause is a server's own app made before it asked for Members, so the
  words tell whoever runs the server to add the permission on the app's page on GitHub and install again; an
  organization that blocked the app answers the same. Any other failure (GitHub down, a rate limit) links nothing
  either and reads as the plain "try again".
- **Not done.** Who made an installation isn't in what GitHub says of it (`GET /app/installations/{id}`), and the
  `installation.created` delivery that names its sender needs the webhook, which a server may run without (decision 8):
  the owner's role is what can always be asked.
