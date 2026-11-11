# 0033. A public GitHub App: installations belong to the organization that installed them

- Status: Accepted (built)
- Date: 2026-10-17
- Extends: ADR 0024 (git proxy), ADR 0007 (credentials)

## Context

ADR 0024 lets the git proxy and `open_pull_request` use a GitHub App installation token when the app is installed on the repository, falling back to the organization's GitHub connection. The token was found by repository name only (`GET /repos/{owner}/{repo}/installation`). With the app installable by any account, that is a cross-tenant leak: organization B installs the app on `b/secret`; an agent of organization A (any GitHub connection, a broad repository scope) asks the proxy for `b/secret` and gets a token minted from B's installation.

## Decision

**An installation counts only for the organization that installed it from agentes.chat.**

1. `github_app_installations` (`org_id`, unique `installation_id`, account, repository selection, `suspended_at`). One installation belongs to one organization.
2. **Install flow.** An admin starts it in Settings → Conectores (`POST /api/app/organizations/{orgId}/github-app/install`): a random, single-use, 10-minute `state` bound to the person and org (stored hashed in `oauth_states`, `connector = 'github_app'`), sent to `github.com/apps/{slug}/installations/new?state=…`. The app has "Request user authorization (OAuth) during installation" on, so GitHub returns to `/api/app/github-app/callback` with `code`, `installation_id` and `state`. The callback checks the state (same person, still an admin), exchanges the code for the person's user token and requires `installation_id` to be in `GET /user/installations`: an installation id alone, which anyone can guess or see, is not enough. Then it binds the installation; one already bound to another organization is refused.
3. **Tokens.** `appTokenForRepo` takes the organization: it resolves the repository's installation and mints a token only when that installation is bound to the org and not suspended. Otherwise it returns null and the caller uses the org's own connection (unchanged). The cache is keyed by org and rechecks the binding on every hit.
4. **Webhook** `POST /api/github-app/webhook` (`X-Hub-Signature-256`, constant-time compare, `GITHUB_APP_WEBHOOK_SECRET`): `installation.deleted` unbinds, `suspend`/`unsuspend` set `suspended_at`, `installation_repositories` updates the repository selection; each drops cached tokens. Installations nobody bound are ignored: binding only happens through the flow.
5. Config: `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET` next to `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` (PEM, PEM with `\n`, or base64 of the PEM file; anything else fails boot).

## Consequences

- An installation made directly on GitHub (not from the app) gives no access until an admin installs/configures it from the app, which binds it.
- The user token from the callback is used once and never stored.
- Unbinding in the app doesn't uninstall on GitHub (the app can't); the UI says so.
- If GitHub redirects with an error, or the callback fails before the state is known, the person lands on `/?github_app_error=…` rather than the settings page.

Amended by ADR 0156. An installation made on GitHub itself never binds, configured from the app or not: a new binding also needs GitHub to say (`GET /app/installations/{id}`, signed as the app) that it made the installation after the install's state was issued, and an `update` only refreshes one already bound to the organization. One made outside is refused as `github_app.installed_outside`: it is removed on GitHub and installed again from the app. Removing an installation now also uninstalls it from GitHub. An organization's installation binds only for one of its owners on GitHub (`github_app.owner_required`, ADR 0156's addendum of 2026-11-11).
