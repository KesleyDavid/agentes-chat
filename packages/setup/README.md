# @agenteschat/setup

The self-host setup for [agentes.chat](https://github.com/agentes-chat/agentes-chat), the open-source
workspace for people and AI agents. One command in an empty directory takes you to a running
instance: by default on your Tailscale network, at `https://agentes.<your-tailnet>.ts.net` with a
real certificate, no domain and no open port.

```sh
npx @agenteschat/setup            # asks for what it needs
npx @agenteschat/setup --dry-run  # prints the plan, changes nothing
npx @agenteschat/setup --help     # every option
```

It needs Node.js 18 or newer, and Docker with Compose 2.23.1 or newer. Neither on the server?
`curl -fsSL https://agentes.chat/install | sh` installs what's missing and runs this setup with
Bun, no Node.js needed (a Bun of its own in the setup's folder, when the computer has none). The
installer's `--plan` (`--dry-run` too) is its own plan and doesn't run the setup. The setup writes
and starts nothing until its last question is answered: for its plan, stop it at its first question
(Ctrl-C), then run the setup command the installer printed again with `--dry-run` (with `sudo` if
the installer ran itself again with `sudo`).

The same setup also ships in the app's image:

```sh
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup
```

## What it does

It looks at the current directory first and fills in only what's missing, so running it again is
safe. A `PUBLIC_URL` of your own (nginx, a tunnel) stays as it is, and choosing another way in
removes the old one's container.

1. **Docker:** checks Docker and Compose, and says how to install what's missing.
2. **How people reach it:** Tailscale (private HTTPS on your tailnet, recommended), a public domain
   (Caddy with a Let's Encrypt certificate, on ports 80 and 443), or this machine only.
3. **Tailscale:** shows the admin console steps, with their links (MagicDNS and HTTPS on, an auth
   key), and checks the key you paste. An OAuth client secret works too, for installs with nobody at
   the console.
4. **`.env`:** writes it readable by you only, with every secret generated, and keeps what's
   already there.
5. **Email** for invitations and password resets, optional: an SMTP server or a Resend-compatible
   API.
6. **The agents' computer:** this machine, by default where it can be (Linux as root with systemd built
   with `BPF_FRAMEWORK`, apt-get and 4 GB of memory or more, each agent a user of its own with a screen; on
   Linux without `BPF_FRAMEWORK`, such as Ubuntu, simple mode: every agent as one user, `agentes`, without
   sudo; a Mac, agents working as you with a browser, Claude Code and Codex, commands on unless you say no).
   Then **what the agents need there**: it checks for their browser (Google Chrome, or Chromium on ARM), the
   packages for their screens, Claude Code and Codex, says what's there, and asks about each one missing
   (yes by default; `--requirements all|none|<list>` answers for all).
7. **Usage statistics:** whether to send anonymous usage statistics to agentes.chat (yes by
   default), written to `.env` as `TELEMETRY=on|off`.
8. **Start:** downloads `docker-compose.yml` when the directory has none, runs `docker compose up -d`,
   waits for Tailscale, the HTTPS certificate and `/api/health`, writes `PUBLIC_URL` from the
   address Tailscale gives the server, and sets up the agents' computer.
9. **The end:** the address, the link that opens the agentes.chat phone or desktop app on it with its QR code
   (for an https address), and what to do next.

## For scripts and AI agents

Every answer is a flag or an `AGENTES_SETUP_<OPTION>` variable (`--tailscale-key` is
`AGENTES_SETUP_TAILSCALE_KEY`). With `--json` nothing is asked, stdout gets one JSON object (the
address, the app link, health and next steps, or the failed check and its fix), and progress goes to
stderr.
Without a terminal, answers are read from stdin one per line, and an empty line or the end of the
input takes the default.
`--typesafe-key` (or `AGENTES_SETUP_TYPESAFE_KEY`) adds your TypeSafe key for Jev after checking
it. Without it, the app asks the owner after setup.

```sh
AGENTES_SETUP_TAILSCALE_KEY='tskey-client-…' npx -y @agenteschat/setup --network tailscale --email skip --json
```

Exit code 0: done; 1: a check failed; 2: a wrong option.

The guide, with the phone app, backups and upgrades: https://agentes.chat/docs/install-on-a-server. The full reference, with a
runbook for agents and troubleshooting, is `SELF_HOSTING.md` in the agentes.chat repository.

## License

MIT. agentes.chat itself is AGPL-3.0-only.
