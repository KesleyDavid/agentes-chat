# Self-hosting agentes.chat

agentes.chat runs as two containers: Postgres 18 with the pgvector extension, and the app, one Bun
process that serves the web app, the API and the WebSockets and runs the background workers. A
third, Tailscale, puts it on your private network with HTTPS. Migrations run when the app starts.
Everything it keeps is in Postgres, except uploaded files, which the compose file stores in a volume.

`PUBLIC_URL` must be the exact address people open, scheme, host and port included
(`https://agentes.tail1234.ts.net`, `https://chat.example.com`, or `http://localhost:3000` on your
own machine). The setup writes it for you. Sign-in cookies, the only browser origin allowed to change
anything, and every link the app sends come from it. Opened at any other address, sign-in fails with
"Invalid origin" and saving fails with `bad_origin`.

The server needs no model key of its own. Each organization adds its own keys (Claude, OpenAI,
Gemini, DeepSeek, Kimi, Z.ai, MiniMax or OpenRouter) in **Settings → AI and usage**. Keys are stored encrypted with a key derived from `AGENTES_SECRET` and are
never sent to browsers.

**Requirements**

- A 64-bit Linux server (amd64 or arm64), or a Mac with Docker Desktop, OrbStack or Colima for
  trying it. It runs on Docker Engine with the Compose v2 plugin (`docker compose`), 2.23.1 or
  newer, and on Linux the installer below installs both when they're missing (Docker after asking).
  Without Docker, it also runs as one program with its database built in (On this computer, without
  Docker).
- Nothing else: the installer fetches the Bun it runs the setup on. With Node.js 18 or newer,
  `npx @agenteschat/setup` is the same setup, and it also runs from the app's image.
- Sizing has not been measured yet. As a starting point for a small team: 2 vCPUs, 4 GB of RAM and
  20 GB of disk. The image is large (about 2 GB of dependencies), and the database and the files
  volume grow with use.
- A Tailscale account (signing up is free), for the default: private HTTPS, no domain and no open
  port. For a public instance instead, a domain whose DNS points at the server, and ports 80 and 443
  open.
- Outbound HTTPS to the model providers your organizations use, and to any service you turn on below.

<details open>
<summary><b>Quick start (about 10 minutes)</b></summary>

You end up with agentes.chat on your Tailscale network (your tailnet), at
`https://agentes.<your-tailnet>.ts.net` with a real certificate. Only devices signed in to your
tailnet can open it: no domain, no open port, nothing on the public internet.

1. **Tailscale.** No tailnet yet? Sign up at https://login.tailscale.com/start. Install Tailscale on
   the computer you'll use (https://tailscale.com/download) and sign in. Done when that computer is
   listed on https://console.tailscale.com/admin/machines.
2. **MagicDNS and HTTPS.** Open https://console.tailscale.com/admin/dns. If you see
   **Enable MagicDNS**, click it. Under **HTTPS Certificates**, click **Enable HTTPS** and confirm.
   The server's name and your tailnet's go into a public certificate log; the setup's `--hostname`
   names the server something other than `agentes`. Done when the page shows both on.
3. **An auth key.** Open https://console.tailscale.com/admin/settings/keys and click
   **Generate auth key**. Leave **Reusable** and **Ephemeral** off, turn **Pre-approved** on if you
   see it, and click **Generate key**. Copy the key (`tskey-auth-…`): it's shown once, and works once.
4. **Install.** On the server:

   ```sh
   curl -fsSL https://agentes.chat/install | sh
   ```

   It installs what's missing, then runs the setup in `/opt/agentes` (`~/agentes` for a user who
   can already use Docker). Press Enter for **Tailscale**, paste the key, and press Enter to skip
   email, or set it up (Email, under Configuration). Then Enter once more to make this server your
   agents' computer (This server as the agents' computer, under Agent computers), and once more for
   the usage statistics question (Optional services and what they receive). The setup checks
   Docker, writes `.env` with generated secrets (readable by you only), downloads
   `docker-compose.yml`, starts Tailscale, writes `PUBLIC_URL` from the address Tailscale gives the
   server, starts the app, waits for the certificate and `/api/health`, and sets up the agents'
   computer. The first time, it downloads about 2 GB, and the agents' computer takes a few minutes
   more. Done when it prints:

   ```
   ◇  On your tailnet as agentes.tail1234.ts.net
   ◇  .env: PUBLIC_URL=https://agentes.tail1234.ts.net
   ◇  HTTPS certificate ready
   ◇  agentes.chat <version> is up
   ◇  Agents' computer: this machine
   │
   ●  agentes.chat is up
   │    https://agentes.tail1234.ts.net
   │
   │    App:  agenteschat://connect?server=https%3A%2F%2Fagentes.tail1234.ts.net
   ```

   then that link's QR code for your phone, what to do next, and `└  Done`.
5. **Your account.** On a computer in your tailnet, open that address and sign up. The first account
   is always allowed and becomes the owner; after it, sign-up is closed and people join by
   invitation. Onboarding then creates your organization and asks for its model key.
6. **Key expiry.** The server leaves your tailnet when its Tailscale key expires (after 180 days,
   unless your tailnet sets otherwise), and the setup prints that date. On
   https://console.tailscale.com/admin/machines, open the server's **⋯** menu and choose
   **Disable Key Expiry**. A server added with an OAuth client secret (For AI agents) never expires.

**The installer** is [`install.sh`](install.sh), and every instance serves it at `/install`. It only
gets the computer ready, then hands over to the setup: on Linux, Docker (with Docker's own script,
once you say yes) and the Compose plugin; on a Mac, Docker when Docker Desktop, OrbStack or Colima
is running; and a pinned Bun (in `.runtime`) to run the setup with. Downloads are HTTPS, and the
pinned ones are checked against the SHA-256 in the script before anything runs them. Without root
and without access to Docker, it runs itself again with `sudo`, and a download cut short runs
nothing. To read it before it runs:

```sh
curl -fsSLo install.sh https://agentes.chat/install
less install.sh
sh install.sh
```

Options go after `sh -s --`, or after `sh install.sh`: `--plan` prints what it would do and does
nothing, `--yes` installs Docker without asking, `--dir <folder>` installs elsewhere, and every
option of the setup passes through (`--network local`, `--email skip`):

```sh
curl -fsSL https://agentes.chat/install | sh -s -- --plan
```

That's the installer's own plan: it runs nothing, not even the setup, so it can't show what the setup
would do. The setup writes and starts nothing until its last question is answered: for its plan, stop
it at its first question (Ctrl-C), then run the setup command the installer printed again with
`--dry-run` (with `sudo` if the installer ran itself again with `sudo`).

Without a terminal (cloud-init, a CI job) nothing is asked: the setup takes its defaults and the
options given, and Docker is installed only with `--yes`.

Without the installer, the same setup runs with `npx @agenteschat/setup` in an empty directory
(Node.js 18 or newer), or from the app's image, on the current directory:

```sh
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup
```

Inside a container it can't start the others, so it ends with the three commands to run; the second
reads the address from Tailscale and writes `PUBLIC_URL`.

**People you invite** need your tailnet too: invite them at https://console.tailscale.com/admin/users
(**Invite users**), or share only this server with their tailnet (its **⋯** menu on the Machines
page, **Share**). Then invite them in the app, from **Settings → Members and invitations**.

**Running the install again** is safe: the installer skips what's already there, and the setup
keeps `.env` and fills in only what's missing, asking with your current answers as defaults. A
`PUBLIC_URL` of your own (nginx, a tunnel) stays as it is. Choosing another way in removes the old
one's container (Caddy or Tailscale), which `docker compose up` alone would leave running.

`docker compose ps` shows the app as `healthy` once it answers `/api/health`, and
`docker compose logs -f agentes` shows what it is doing.

</details>

<details>
<summary><b>Your phone</b></summary>

1. Install the Tailscale app (https://tailscale.com/download/ios or
   https://tailscale.com/download/android) and sign in to the same tailnet. Done when it says
   **Connected**.
2. Install the agentes.chat app.
3. Point the phone's camera at a QR code for your instance. The setup prints one at the end; in the
   web app, **Open on your phone** (**Abrir no celular** in Portuguese) in **Settings › Your account**
   shows one that also signs you in. Or, on the app's sign-in screen, tap the server line
   (**Server: agentes.chat · Change**, or **Servidor: agentes.chat · Trocar**), then
   **Scan QR code** (**Escanear QR code**), or type the address and tap **Use this server**
   (**Usar este servidor**).
4. The app shows your server's address. Confirm, then sign in (the web app's code signs you in by
   itself).

If the app can't reach the server, open the Tailscale app, check that it's connected, and try again.
**Back to agentes.chat**, on the screen **Change** opens, goes back to agentes.chat Cloud.

The QR code is a link, `agenteschat://connect?server=<the address, URL-encoded>`, the one the setup
prints as **App**. The web app's adds `&token=<a one-time sign-in>`, which works once, within 3
minutes, for whoever scans it: show it to your own phone only.

</details>

<details>
<summary><b>Connect a computer</b></summary>

Agents run commands and code, drive a browser, and can think with Claude Code or Codex on computers
you connect (Agent computers, below). A computer must reach the instance, so on Tailscale, install
Tailscale on it and sign in to the same tailnet first.

The agentes.chat desktop app (macOS, Windows and Linux) opens your instance in a window of its own.
Download it from `/download` on your instance (or the latest `desktop-v*` release). It's in beta: the Mac
build isn't notarized by Apple yet and the Windows installer isn't signed, so the first open asks once (macOS:
**System Settings › Privacy & Security › Open Anyway**, right after you try to open it; Windows: **More info ›
Run anyway**). `/download` shows each step with pictures. Then:

1. On its first screen, under **Sign in to agentes.chat**, click **Use your own server**, then
   **Connect to my server**.
2. Type your address (`https://agentes.<your-tailnet>.ts.net`), or click **Use** next to one the app
   found: it looks on this computer and, when Tailscale is connected, on your tailnet. Plain http works
   only for an instance on the same computer (`http://127.0.0.1:…`), which the app then opens at the
   address it gives itself (`PUBLIC_URL`, such as `http://localhost:3000`): it accepts sign-ins only there.
3. Sign in, as in the browser. The link the setup prints at the end (`agenteschat://connect?…`) does
   steps 1 and 2 for you; the app shows the address in large type and asks before it connects.

**Servers** in the app's Preferences (and its menus) switches between instances; each keeps its own
sign-in.

- **Agents on that computer:** in the instance's onboarding or **Settings › Devices**, click **Use
  this Mac** (**Use this PC** on Windows, **Use this computer** on Linux). The app asks first, in its
  own dialog naming the instance and the organization. Its agents start with commands, the browser and
  Claude Code or Codex when the computer has them, and no folders of yours. Commands are on by
  default. Turn them off in the app's **Preferences › Tools**, where one switch counts for every
  workspace on the computer. Folders are added in **Preferences › Folders**. The app pairs a computer
  with agentes.chat Cloud the same way. Until you pair it,
  nothing of the computer is used. The app never offers the computer that runs the instance: its agents
  work there through the instance itself (This server as the agents' computer, below).
- **Linux, a server or a VM:** **Settings › Devices › Connect a device** shows the command, and
  Agent computers below explains it.

Unless it has builds of its own (`DESKTOP_RELEASES_TOKEN`), the page that offers the app (Settings ›
Devices, and onboarding's computer step) asks agentes.chat for its newest version as it opens, from
your browser or the app's window: the request names the system and, like any request a page makes to
another site, carries this instance's address (its `Origin` header) and the browser's IP. The app asks
agentes.chat for its own updates when it starts and every 6 hours, naming its system and processor (its
version too, when it installs one). On Linux the AppImage updates itself; a deb downloads the new deb.

</details>

<details>
<summary><b>Phones for agents</b></summary>

Agents use a phone through a computer you connected (Connect a computer, above): **Settings › Devices
› Connect a device**, then **Android phone** or **iPhone**. The steps follow what that computer sees.

- **Android by cable** (recommended): the computer needs Android platform-tools (`adb` on the PATH or
  in `ANDROID_HOME`, which Android Studio installs). On the phone, turn on Developer options and USB
  debugging, plug it in, check **Always allow from this computer** and tap **Allow**.
- **Android over Wi-Fi:** Android 14 or newer with the May 2026 security update, on the same network
  as the computer, which must find phones over mDNS (`adb mdns check` names its daemon). Only a
  computer you manage that doesn't run each agent as its own user pairs this way. On the phone, turn
  on **Developer options › Wireless debugging**, then scan the QR the computer shows from **Pair device
  with QR code** there, or type what **Pair device with pairing code** shows. Not with the camera: it
  reads the QR as a Wi-Fi network named `agentes-…`, which doesn't exist, and takes the phone off the
  computer's Wi-Fi, where it must stay. On a Mac, the agentes.chat app needs **System
  Settings › Privacy & Security › Local Network**, or the computer never hears the phone. Wireless
  debugging turns off when the phone restarts.
- **iPhone through a Mac:** an iPhone on iOS 17 or newer, and Xcode from the App Store with an Apple
  Account added in its **Settings › Apple Accounts** (a free one is enough: the Mac renews the test
  helper every 7 days). The Mac downloads the iOS tools, about 8 GB. Then plug the iPhone in, trust the
  Mac, and turn on Developer Mode and UI Automation. A newer iOS needs an Xcode that knows it: update
  Xcode when the iPhone updates.

Android's pairing QR aside, the steps show no QR code: one that opens them in the agentes.chat phone
app waits until the app is in the App Store and Google Play, since until then it would only open the
web page in the phone's browser.

</details>

<details>
<summary><b>For AI agents</b></summary>

A runbook for an AI agent, or a script, installing agentes.chat on a server where it can run
commands.

**What needs a person.** In the Tailscale admin console, once per tailnet: MagicDNS and HTTPS on
(Quick start, step 2), and a key for the server. That can be a one-off auth key for each install
(step 3), or an OAuth client secret, created once, which installs with nobody at the console:

1. On https://console.tailscale.com/admin/acls, add the tag under `"tagOwners"` and save:
   `"tag:agentes": ["autogroup:admin"]`.
2. On https://console.tailscale.com/admin/settings/trust-credentials, click **Credential**, choose
   **OAuth**, give **Auth Keys** Write access with the tag `tag:agentes`, and click
   **Generate credential**. The secret starts with `tskey-client-`.

A server added with it joins as `tag:agentes`, approved, with a key that never expires. If your
tailnet policy file limits who reaches what, let your people reach `tag:agentes` on port 443.

**The command**, in an empty directory on the server:

```sh
AGENTES_SETUP_TAILSCALE_KEY='tskey-client-…' npx -y @agenteschat/setup --network tailscale --email skip --json
```

No Node.js or Docker on the server? As root, the installer gets what's missing and then runs the
same setup: give it `--yes` and the same options. Its own lines go to stderr, so stdout is still
the setup's JSON; a failure before the setup starts is a line on stderr and exit code 1. Its
`--plan` (`--dry-run` too) prints the installer's plan and runs nothing, not even the setup. The
setup's plan as JSON comes from the setup itself, with `--dry-run --json`: through `npx`, or on a
server the installer set up, the setup command it printed, with `--dry-run --json`.

```sh
curl -fsSL https://agentes.chat/install | AGENTES_SETUP_TAILSCALE_KEY='tskey-client-…' sh -s -- --yes --network tailscale --email skip --json
```

- Every answer is a flag or an `AGENTES_SETUP_<OPTION>` variable; `--help` lists them, and a flag
  wins over a variable. With `--json` nothing is asked: a missing answer is a failed check, and the
  two yes/no questions take their defaults. The server becomes its agents' computer where it can be
  (on Linux as root, with systemd built with `BPF_FRAMEWORK`, apt-get and 4 GB of memory or more, in simple
  mode where systemd lacks `BPF_FRAMEWORK`, and on a Mac; `--computer no` says otherwise), what the agents
  need there is installed when missing (`--requirements none` says otherwise), and the usage statistics are
  on (`--telemetry off` says otherwise).
- stdout is one JSON object, and progress goes to stderr. Exit code 0: done; 1: a check failed;
  2: a wrong option.
- `--dry-run --json` returns the plan and changes nothing.
- After a failure, do what `fix` says and run the same command again: it keeps what's done.
- An OAuth client with another tag: `--tailscale-tag tag:<name>` (default `tag:agentes`).
- Without `--json` and without a terminal, answers are read from stdin, one per line; an empty line
  or the end of the input takes the default.

Done:

```json
{
  "ok": true,
  "network": "tailscale",
  "url": "https://agentes.tail1234.ts.net",
  "health": { "status": "ok", "version": "…", "edition": "selfhost" },
  "ownerExists": false,
  "appLink": "agenteschat://connect?server=https%3A%2F%2Fagentes.tail1234.ts.net",
  "phoneLink": "agenteschat://connect?server=https%3A%2F%2Fagentes.tail1234.ts.net",
  "computer": "on",
  "telemetry": "on",
  "nextSteps": ["On a computer or phone signed in to your tailnet, open https://agentes.tail1234.ts.net and create your account: the first one owns this instance.", "…"]
}
```

Give the person `url`, `appLink` (it opens the agentes.chat phone or desktop app on this server;
`null` for an http address, which the phone app doesn't open) and `nextSteps`: the first account,
created from a device in the tailnet, owns the instance. `computer` is `on` when this server is its
agents' computer, `off` when answered no, and `skipped` where it can't be.
A failure names the check, what happened and the fix:

```json
{
  "ok": false,
  "check": "tailscale.https",
  "error": "HTTPS certificates are off in your tailnet.",
  "fix": "Open https://console.tailscale.com/admin/dns, under \"HTTPS Certificates\" click \"Enable HTTPS\" and confirm."
}
```

**Checking each step yourself**, in the install directory:

| Step | Command | Done when |
| --- | --- | --- |
| Docker | `docker compose version --short` | `2.23.1` or newer |
| On the tailnet | `docker compose exec -T tailscale tailscale status --json` | `"BackendState": "Running"`, and the address under `"CertDomains"` |
| HTTPS proxy | `docker compose exec -T tailscale tailscale serve status` | `https://agentes.<tailnet>.ts.net`, with `/` proxied to `http://agentes:3000` |
| Address | `grep '^PUBLIC_URL=' .env` | `PUBLIC_URL=https://agentes.<tailnet>.ts.net` |
| App | `curl -fsS http://127.0.0.1:3000/api/health` | `{"status":"ok",…}` |
| End to end, from a device in the tailnet | `curl -fsS https://agentes.<tailnet>.ts.net/api/health` | the same |
| Containers | `docker compose ps` | `postgres`, `agentes` and `tailscale` up and `healthy` |

**Troubleshooting.** `check` names what failed:

| `check` | What happened | Fix |
| --- | --- | --- |
| `docker`, `docker.compose` | Docker, or Compose v2 2.23.1 or newer, is missing | Linux: the installer installs both (`curl -fsSL https://agentes.chat/install \| sh -s -- --yes`). Mac and Windows: Docker Desktop. |
| `docker.daemon`, `docker.permission` | Docker isn't running, or this user can't use it | `sudo systemctl start docker`; `sudo usermod -aG docker $USER`, then log in again. |
| `tailscale.key` | No key, or Tailscale refused it: expired, revoked, or a one-off key already used | A new auth key, or the OAuth client secret. |
| `tailscale.approval` | The server waits for device approval | Machines page: the server marked **Needs approval**, its **⋯** menu, **Approve**. A pre-approved key or an OAuth client secret skips this. |
| `tailscale.magicdns`, `tailscale.https` | MagicDNS or HTTPS certificates are off in the tailnet | Quick start, step 2. |
| `tailscale.tag` | Tailscale refused the OAuth client secret's tag | The tag under `tagOwners`, the one the OAuth client has, passed with `--tailscale-tag`. |
| `tailscale.serve`, `tailscale.cert` | The HTTPS proxy or its certificate didn't come up | `docker compose logs tailscale`. After many tries, Let's Encrypt makes one name wait. |
| `port` | Another program uses the app's port, or 80 and 443 for a public domain | `HOST_PORT=3001` in `.env`, or stop that program. |
| `app.config` | The app refused a value in `.env` | The values `error` names. |
| `app.health`, `tailscale.timeout` | Something didn't answer in time (`--timeout`, 300 s by default) | `docker compose logs agentes`, or `tailscale`. |
| `computer` | `--computer yes` on a machine that can't be the agents' computer: sign-up is open, a provisioner gives workspaces their computers, no root or no systemd on Linux, or it's already connected as a computer. Or one of the first two was turned on after a yes, and agentes.chat won't start with the token | What `fix` says, or `--computer no`. |
| `computer.install`, `computer.off`, `computer.token` | The agents' computer didn't install or wasn't accepted (agentes.chat itself is up, and the result still has `url` and `appLink`) | What `fix` says, then the same command again. Its log shows its state: `journalctl -u agentes-runner` on Linux, `~/.agentes-runner/runner.log` on a Mac. On any computer you connected, `agentes-runner doctor` lists what it gives agents (connections, agent apps, toolchains, phones) and what needs you, and waits there until each is fixed. |

</details>

<details>
<summary><b>A public domain instead (Caddy)</b></summary>

For an instance anyone on the internet can open. The setup's **A public domain** choice
(`--network domain --domain chat.example.com`) does what follows, owner account first. By hand:

Create the owner account first, over localhost or the SSH tunnel (This machine only, below): the
first sign-up becomes the owner, so it has to happen before the domain answers. Then point a DNS
record at the server, open ports 80 and 443, and add to `.env`:

```sh
DOMAIN=chat.example.com
PUBLIC_URL=https://chat.example.com
COMPOSE_PROFILES=https
```

and run `docker compose up -d`. The `caddy` service gets a Let's Encrypt certificate for `DOMAIN` and
renews it, redirects http to https, and passes everything to the app, WebSockets included. Its
certificates are kept in the `caddy-data` volume. Caddy sends the client's address as the only value
of `X-Forwarded-For`, which the app trusts as is, so leave `TRUSTED_PROXIES` empty. While the app
restarts or is down, Caddy answers with a page that says so and opens the app again once it's back.

</details>

<details>
<summary><b>Behind your own reverse proxy (nginx)</b></summary>

Create the owner account first, as for Caddy above. Keep the app on loopback (the default) and
point the proxy at `127.0.0.1:3000`. The proxy must:

- upgrade WebSockets on `/api/ws` (browsers), `/api/machines/connect` (connected computers), and
  `/api/desktop`, `/api/terminal` and `/api/machines/stream` (agents' screens and terminals);
- accept request bodies up to 100 MB: files for the Drive (50 MB each) and agents' git pushes (up to 100 MB);
- keep sockets open: the app and its clients exchange a ping at least every 30 s, so a read timeout
  of 60 s (nginx's default) or more works;
- send the client's address in `X-Forwarded-For`.

`/etc/nginx/conf.d/agentes.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name chat.example.com;

    client_max_body_size 110m;

    # AI apps' MCP endpoint (Apps de IA, below): small JSON requests only.
    location ~ ^/mcp/?$ {
        client_max_body_size 128k;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
    }
}
```

TLS and the http → https redirect in one line:

```sh
sudo certbot --nginx --redirect -d chat.example.com
```

Then set `PUBLIC_URL=https://chat.example.com` in `.env` and run `docker compose up -d`.

Optional: while the app restarts or is down, nginx can answer with the page Caddy shows, which opens
the app again once it's back. Download it from the app while it's up, and again after each upgrade
(straight from the app, since nginx then serves its own copy at that address):

```sh
sudo mkdir -p /var/www/agentes && sudo curl -fsSLo /var/www/agentes/unavailable.html http://127.0.0.1:3000/unavailable.html
```

Then add to the `server` block:

```nginx
    error_page 502 503 504 =503 /unavailable.html;

    location = /unavailable.html {
        root /var/www/agentes;
        add_header Cache-Control no-store always;
    }
```

Sign-in rate limits count per client address, read from `X-Forwarded-For`. A single value, as above,
is trusted as is, and the client can't forge it (nginx replaces whatever the client sent). With
another proxy or a CDN in front of nginx, send the chain instead (`$proxy_add_x_forwarded_for`) and
list those proxies' addresses or ranges in `TRUSTED_PROXIES`, comma-separated: the chain is read from
the right past every trusted hop, and the first other address is the client.

</details>

<details>
<summary><b>This machine only, and by hand</b></summary>

The setup's **This machine only** choice runs agentes.chat at http://localhost:3000, to try it on a
laptop. By hand, in an empty directory:

```sh
curl -fsSLO https://agentes.chat/install/docker-compose.yml
(umask 077 && printf 'AGENTES_SECRET=%s\nPOSTGRES_PASSWORD=%s\nPUBLIC_URL=http://localhost:3000\n' "$(openssl rand -base64 48)" "$(openssl rand -hex 24)" > .env)
docker compose up -d
```

The `umask` in parentheses makes `.env` readable by you alone without changing your shell's. Then
open http://localhost:3000 and create the owner account.

`.env` holds three values:

- `AGENTES_SECRET` signs sessions and encrypts every key organizations store (model providers,
  connectors, mailboxes, databases). Back it up apart from the database: a database restored without
  it has all of those keys unreadable.
- `POSTGRES_PASSWORD` goes into the database URL the compose file builds, so it stays hex.
- `PUBLIC_URL`, as above.

Tailscale by hand: add `COMPOSE_PROFILES=tailscale` and `TS_AUTHKEY=<the key>` to `.env`, and run
`docker compose up -d tailscale`. Once it has joined, this prints the server's address; put it in
`PUBLIC_URL` with `https://` in front, empty `TS_AUTHKEY`, and run `docker compose up -d`:

```sh
docker compose exec -T tailscale tailscale status --json | grep -A1 '"CertDomains"'
```

The app is published on `127.0.0.1:3000` only; `HOST_PORT` changes the port. To use it from other
machines, use Tailscale or put it behind HTTPS, or try it through an SSH tunnel first:
`ssh -L 3000:localhost:3000 your-server`. Don't serve it over plain http to other machines
(`BIND_ADDRESS=0.0.0.0`), not even on a LAN. Browsers treat http as a secure context only on
localhost, and parts of the web app need one. With no proxy in front, nothing sets
`X-Forwarded-For`, so the sign-in rate limits can't tell clients apart. And Docker opens a published
port past the host's firewall.

</details>

<details>
<summary><b>On this computer, without Docker</b></summary>

agentes.chat also runs as one program with its database built in, with nothing else to install: no
Docker, no Postgres to set up. The desktop app's **Run agentes.chat on this computer** does it with no
terminal (below). `install.sh` can't do it without Docker yet. On a Mac or a PC, use the app. By hand,
from a release package, further below.

- **The database is PGlite:** real Postgres compiled to WebAssembly, running inside that program,
  with pgvector. It's the same engine the tests run on, so the migrations and the queries are the
  same as with Docker.
- **Everything lives in one folder,** `~/.agentes`: the database in `db/`, uploaded files in `files/`
  (`FILES_DIR`), the settings in `.env`, the log in `logs/server.log`. Jobs already live in the
  database, and live updates run in memory.
- **Its limits:** one process, which answers queries one at a time, for a person or a small team,
  while that computer is on. It takes about 0.5 to 1 GB of memory. Each change reaches the disk before
  it's confirmed, as with Postgres, but nothing makes backups for you: copy the folder now and then,
  with it stopped (Backing up, below). Moving the database or upgrading it takes memory of about ten
  times its size (`du -sh ~/.agentes/db`): with 8 GB, up to about 500 MB. For a bigger team or a
  server that's always on, use the one-command install with Docker and full Postgres. Moving there
  later is a dump and a restore (below).

It listens on this computer only (`127.0.0.1`), and answers only at its own address (opened as
`localhost`, it sends the browser there). To reach it from your phone or a teammate's computer, put it
on your tailnet with `tailscale serve` (on this computer:
`tailscale serve --bg --https=443 http://127.0.0.1:4310`) and set `PUBLIC_URL` in `~/.agentes/.env` to
the `https://…ts.net` address it prints, then start it again. The desktop app does both with one
switch.

**From the desktop app** (macOS, Windows and Linux). On its first screen, click **Use your own server**,
then **Run agentes.chat on this Mac** (this PC on Windows, this computer on Linux). On Windows the folder is
`%USERPROFILE%\.agentes`. Your name comes from this computer; type
your email (your team sees it). **Reach it from your phone and teammates** puts it on your tailnet
(off; you can turn it on later), and **Send anonymous usage statistics** is on (it writes `TELEMETRY`
in `~/.agentes/.env`). **Start agentes.chat** then prepares the folder and the database (the first time
takes a little longer), starts it, creates your owner account, makes this computer your agents'
computer and opens agentes.chat, signed in.

- **It runs inside the app.** It starts with the app (Open at login turns on), starts again by itself
  if it stops, and stops when you quit the app (which asks first: nobody can use it until you open the
  app again). Its files come with the app and update with it; the previous version and a copy of the
  database stay in `~/.agentes`, and an update that doesn't answer within 3 minutes goes back to them by
  itself, and stays there until the next version.
- **Only its own answer counts.** Other programs and accounts on this computer can listen on its port,
  so the app trusts the server only once its own process answers there (it names itself in
  `~/.agentes/server.json`, which only you can write). Until then nothing of yours goes to that port: not
  your sign-in, not this computer's token, not your agents' connections (they pause while it is down).
  If something else holds the port when it starts, it moves to a free one. With reach on, Tailscale
  shares it only while it runs.
- **Agents with Commands on can reach everything on this Mac**, the server's data in `~/.agentes`
  included. Commands are on by default. Turn them off in the app's **Preferences › Tools**.
- **No password:** the app signs you in, and on its sign-in screen **Continue on this Mac** does it again
  whenever your session ends. For a browser on another device, add one in **Settings › Your account**, **Add
  a password**.
- **Preferences › Servers › agentes.chat on this Mac:** reach (Tailscale needs HTTPS turned on for your
  tailnet, which **Turn it on** opens; on Linux, connect Tailscale with `sudo tailscale up`, and run
  `sudo tailscale set --operator=$USER` once), the phone's QR code, usage statistics, **Back up now**
  (`~/.agentes/backups/agentes-<date>.tar.gz`, with the database, the files and `.env`), Restart, Stop,
  and **Stop running it here…**, which keeps its data and stops its agents here; **Start it here** there
  brings both back.
- **Something went wrong?** **Copy details** copies what the app knows, the setup's steps and the end of
  `~/.agentes/logs/server.log`.
- A server you installed in `~/.agentes` from the terminal stays the terminal's: while it runs, the app
  offers **Use it** instead, and opens its owner link while it waits for its owner; when it isn't
  running, start it the way you installed it.
- **Moving it to a server:** quit the app, dump the database with the app's own copy of the server,
  then follow Moving to Docker (below) from step 2. On a Mac:
  `BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql`
  (on Linux, the deb's `/usr/bin/agentes-runner` in its place).

**Usage statistics.** Like any self-hosted install, it sends agentes.chat an anonymous usage report
once a day (Optional services and what they receive lists every field in it). To turn it off, put
`TELEMETRY=off` in `~/.agentes/.env` and start it again (the desktop app's **Send anonymous usage
statistics** switch does that), or use the switch in **Settings → General → Usage statistics**.
Installed by hand, `agentes-server telemetry` prints the next report and sends nothing (with the server
stopped); while it runs, and from the desktop app, **See what is sent** there shows the same.

**By hand.** From the first `v<version>` release, each release has a package per computer, `agentes-native-<version>-<os>-<arch>.tar.gz`
(`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`), its Bun included, and `native.json`, which
names each package's SHA-256. Check it, then:

```sh
mkdir -p ~/.agentes/app
tar -xzf agentes-native-1.4.0-linux-x64.tar.gz -C ~/.agentes/app --strip-components 1
~/.agentes/app/1.4.0/bin/agentes-server --data ~/.agentes
```

The first start makes the folder (readable by you only) and its `.env`, with a new `AGENTES_SECRET`
and a free port from 4310, migrates the database and answers at `http://127.0.0.1:4310` (it prints the
address; `PORT` in `.env` changes it). Open it and create the owner account: the first account owns the
installation, unless `OWNER_CLAIM_SHA256` keeps it for an owner link (Configuration, Sign-up). `AGENTES_SECRET`
encrypts the keys organizations store: it travels with the folder in a backup, and changing it makes
them unreadable.

| Command (each takes `--data <folder>`, default `~/.agentes`) | Does |
| --- | --- |
| `agentes-server` | Runs it until Ctrl-C. In-progress agent runs get 20 seconds to finish. |
| `agentes-server service install` | Starts it with this computer: at login on macOS (launchd), from boot on Linux (a systemd user unit, kept after you log out). `uninstall` and `status` too. |
| `agentes-server migrate` | Updates the database to this version, then exits (every start does it too). |
| `agentes-server db dump --out agentes.sql` | The whole database as SQL. |
| `agentes-server db restore --in agentes.sql` | A dump into a folder with no database yet (or the upgrade, below). If it fails, the folder stays as it was. |
| `agentes-server db check` | Opens the database and prints what wrote it. |
| `agentes-server telemetry` | Prints the next usage report, exactly, and sends nothing. |
| `agentes-server version` | Its version, and its PGlite's and Postgres's. |

On a Mac the service starts when you log in, so a Mac mini that must come back by itself after a
power cut needs automatic login (System Settings › Users & Groups; FileVault turns it off) and **Start
up automatically after a power failure** (System Settings › Energy).

When it stops at once, its exit code says why: 3, another `agentes-server` (or another program) uses
that folder (the message names its process); 4, the database needs an upgrade (below); 5, another
program uses the port (set `PORT` in `.env`). Its log, `~/.agentes/logs/server.log`, says it too.

**Backing up.** Stop it (Ctrl-C, or `agentes-server service uninstall`), copy the whole folder
(`~/.agentes`, with the `AGENTES_SECRET` of its `.env`, which the keys stored in the database need),
then start it again (`service install`). To restore, put the folder back. A dump (`db dump`) is the
other way, for moving the data elsewhere; it holds the database, without `files/` or `.env`.

**Upgrading** is extracting the new version beside the old one, then running its `service install`
once, so the service starts the new version (by hand, start the new one on the same folder):

```sh
~/.agentes/app/1.5.0/bin/agentes-server service install --data ~/.agentes
```

When a version moves PGlite to a new Postgres major (its release notes say so), the new one refuses
the old folder with exit 4 until it is upgraded, with the server stopped: `db dump` with the old
version, then `db restore` with the new one, which keeps the old database in `backups/`, then the new
version's `service install`:

```sh
~/.agentes/app/1.4.0/bin/agentes-server service uninstall
~/.agentes/app/1.4.0/bin/agentes-server db dump --data ~/.agentes --out ~/agentes-upgrade.sql
~/.agentes/app/1.5.0/bin/agentes-server db restore --data ~/.agentes --in ~/agentes-upgrade.sql
~/.agentes/app/1.5.0/bin/agentes-server service install --data ~/.agentes
```

**Moving to Docker.** The dump restores into the Docker install's Postgres 18:

1. Stop it (`agentes-server service uninstall`, or Ctrl-C), then dump:
   `agentes-server db dump --data ~/.agentes --out agentes.sql`.
2. Install with Docker (Quick start, or This machine only, by hand), but don't start the app yet: in
   the new install's `.env`, put the `AGENTES_SECRET` of `~/.agentes/.env`, then start only the
   database, `docker compose up -d postgres`.
3. Restore into it, still empty:
   `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.
4. Start the app, `docker compose up -d`, copy the uploaded files into its volume, and give them to
   the app's user (the copy arrives as root's):
   `docker compose cp ~/.agentes/files/. agentes:/data/files/`, then
   `docker compose exec -u root agentes chown -R bun:bun /data/files`. Sign in as before.

</details>

<details>
<summary><b>AI apps (MCP)</b></summary>

Claude (claude.ai, Claude Desktop, the phone), Claude Code, ChatGPT, Cursor, VS Code and any other MCP client
can ask this server's agents for tasks: the person pastes the server's address, signs in as themselves,
picks a workspace, and the app can list agents and channels, send a task to an agent as that person, wait for
and read the reply, and see recent tasks. It acts with exactly the person's permissions, never approves an
agent's action (approvals stay with people in the chat) and changes no settings. It is on by default, with
nothing to configure: Settings → Apps de IA shows the address and the steps for each app.

- **The address** is `PUBLIC_URL` + `/mcp`, for example `https://chat.example.com/mcp` (`/mcp/` works too).
- **Sign-in** is OAuth 2.1 on this server itself (PKCE, the app registers on its own), which needs https
  except on `localhost`. A server reached over plain http on a LAN: use a **personal token** instead
  (Settings → Apps de IA → Tokens pessoais), sent as `Authorization: Bearer agp_…`. It works on `/mcp` only, in
  one workspace. One with no expiry takes a sign-in in the last 10 minutes.
- **Who calls from where**: claude.ai, the Claude apps and ChatGPT call from their own servers, so the server
  needs a public https address (a domain, or Tailscale Funnel: What needs a public URL). Claude Code, Cursor and
  VS Code call from the computer they run on.
- **Proxies**: the compose file's Caddy needs nothing more (answers are JSON, never streamed) and caps `/mcp`
  bodies at 128 KB. With nginx, add the `location ~ ^/mcp/?$` block shown above. Behind Cloudflare, never challenge
  `/mcp`, `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server`,
  `/.well-known/openid-configuration` and `/api/oauth/*` (a WAF skip rule: no Bot Fight Mode, no managed
  challenge, no rate limits there). On the free plan, which can't skip Bot Fight Mode per path, allow Claude's
  connector addresses (`160.79.104.0/21`) and ChatGPT's published ones with an IP Access rule.

Check it from any computer:

```sh
curl -s https://chat.example.com/.well-known/oauth-protected-resource/mcp
curl -si -XPOST https://chat.example.com/mcp | grep -i www-authenticate
npx @modelcontextprotocol/inspector --cli https://chat.example.com/mcp --transport http \
  --method tools/list --header "Authorization: Bearer agp_…"
```

The first prints the server's resource document, the second its sign-in challenge, the third the tools (with a
personal token).

</details>

<details>
<summary><b>What needs a public URL</b></summary>

On Tailscale, only devices in your tailnet reach the instance. Everything people do in the apps works
that way, and so do sign-in with Google, GitHub or Apple, connector sign-ins and connected computers:
they go through a browser or a device in the tailnet. A few services call the instance from the
internet instead, and need it public:

- Routines started by a GitHub or Sentry webhook (the address the routine shows, `/api/webhooks/…`).
- Routines started by a webhook of their own (the address on the routine's page, `/api/hooks/…`).
- A GitHub App's events (`/api/github-app/webhook`): what people write on the pull requests, issues and discussions
  agents worked on, or that name the app, wakes the agent. Without them agents don't hear GitHub, and the GitHub
  panel in **Settings → Connectors** checks the installations with GitHub when it opens.
- Composio's events (`/api/webhooks/composio`, with `COMPOSIO_API_KEY`): new mail for routines, and connector
  accounts that expired.
- AI apps that call from their own servers (Apps de IA, below): claude.ai, the Claude apps and ChatGPT reach
  `/mcp` from the internet. Claude Code, Cursor and VS Code on a computer that reaches the server don't need it.

**Tailscale Funnel** opens the same address to the internet, still with no domain and no open port.
The whole instance becomes public, as on a domain: sign-up stays closed (the default), and the owner
account must exist first.

1. On https://console.tailscale.com/admin/acls, expand the **Funnel** section and click
   **Add Funnel to policy**. It covers your members' devices. A server added with an OAuth client
   secret is tagged: add its tag to the rule's `"target"`, as in
   `{ "target": ["autogroup:member", "tag:agentes"], "attr": ["funnel"] }`.
2. Set `TAILSCALE_FUNNEL=true` in `.env` (exactly `true` or `false`: Compose refuses any other
   value) and run `docker compose up -d`.

Check it from outside the tailnet, a phone on mobile data with Tailscale off for example:
`https://agentes.<your-tailnet>.ts.net/api/health` answers `{"status":"ok",…}`. Public DNS for the
address can take up to 10 minutes. Without the policy rule, the address stays private with no error
anywhere, so that check is the one to trust. `TAILSCALE_FUNNEL=false` and `docker compose up -d`
make it private again.

</details>

<details>
<summary><b>Configuration</b></summary>

Settings are environment variables in `.env`; the compose file hands the whole file to the app. After
a change, `docker compose up -d` recreates the app with it. Every variable is documented in
[`.env.example`](.env.example). These are the
ones a self-hosted instance usually touches:

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:3000` | The exact address people open. |
| `AGENTES_SECRET` | required | Master secret, at least 32 characters. Never change it on an instance in use. |
| `POSTGRES_PASSWORD` | required | Database password. Read by the compose file only. |
| `AGENTES_IMAGE` | `ghcr.io/agentes-chat/agentes:latest` | The image to run. A version tag or a digest holds a version. |
| `BIND_ADDRESS`, `HOST_PORT` | `127.0.0.1`, `3000` | Where the compose file publishes the app. |
| `AGENTES_MEMORY` | `8g` | The most memory the app's container may take, swap included. Over it, the kernel stops the app alone and Docker restarts it, instead of the machine swapping until something else is killed. The speech server's is `SPEECH_MEMORY` (Voice messages). |
| `COMPOSE_PROFILES` | | How people reach it: `tailscale` (the setup's default), `https` (Caddy for `DOMAIN`), or neither (this machine only). Comma-separated, with other optional services: `backup` (Backups and restore), `speech` (Voice messages), `embeddings` (Search across languages). |
| `DOMAIN` | | The public domain Caddy gets a certificate for. |
| `TS_AUTHKEY` | | The auth key or OAuth client secret the server joins your tailnet with, read only until it has joined. The setup empties it then. |
| `TS_HOSTNAME` | `agentes` | The server's name in your tailnet: `https://<TS_HOSTNAME>.<tailnet>.ts.net`. After changing it, run the setup again to update `PUBLIC_URL`. |
| `TS_EXTRA_ARGS` | | More `tailscale up` flags. The setup puts `--advertise-tags` here for an OAuth client secret. |
| `TAILSCALE_FUNNEL` | `false` | `true` opens the instance to the internet at the same address (What needs a public URL). Only `true` or `false`. |
| `ALLOW_SIGNUP` | `false` | `true` lets anyone create an account. |
| `OWNER_CLAIM_SHA256` | | While no account exists, only the owner link made with it creates the first one (Sign-up, below). `OWNER_KEY_SHA256` is the desktop app's. |
| `TRUSTED_PROXIES` | | Proxies in front of your proxy (see nginx above). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | "Sign in with Google", redirect URI `{PUBLIC_URL}/api/auth/callback/google`. `GITHUB_*` and `APPLE_*` work the same way. |
| `APPLE_TEAM_ID` + `APPLE_APP_BUNDLE_ID`, `ANDROID_APP_PACKAGE` + `ANDROID_APP_CERT_SHA256` | | For a phone app you build yourself with `EXPO_PUBLIC_API_URL` set to this server: links to its pages (a conversation, a message, a thread, an agent, a task, a routine, an approval, the inbox, settings, invitations, password resets) open in the app instead of the browser. The server then publishes `/.well-known/apple-app-site-association` (also at `/apple-app-site-association`) and `/.well-known/assetlinks.json`; your proxy must pass them through as they are, with no redirect. Several bundle ids or packages are comma-separated. The fingerprints are the SHA-256 of Google Play's app signing key and of your upload key. Without them, links open the website, as before. |
| `TERMS_URL`, `PRIVACY_URL` | | Your terms and privacy policy, linked on the sign-in and sign-up screens when both are set. `/terms` and `/privacy` on this server go to them, or say it has none. |
| `LANDING_URL` | | The agentes.chat landing page's address, which turns on its waiting list. Leave it unset. |
| `SMTP_URL` | | Email through your SMTP server: `smtps://user:password@smtp.example.com:465`, or `smtp://` for STARTTLS on 587, which is then required (`?requireTLS=false` at the end allows a relay without TLS on a trusted network). |
| `MILLIONSEND_API_KEY`, `MILLIONSEND_API_URL` | `https://api.millionsend.com` for the URL | Email through a Resend-compatible API instead: MillionSend, your own MillionSend, or Resend (`https://api.resend.com`). |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | `agentes.chat <ping@HOST>`, HOST being the host of `PUBLIC_URL` | Sender of the app's emails. Its domain must be verified with your email provider. |
| `EMAIL_ART` | `auto` | Where emails get their pictures (the logo, agents' faces): from this server's `/email/` when its address is public, else attached to each message. `attach` always attaches them, for a public address people outside still can't open (an access proxy, a VPN, an IP allowlist). |
| `FILES_DIR` | `/data/files`, set by the compose file | Folder for uploaded files, on the `files` volume. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Files in an S3-compatible bucket instead, when all four are set. `S3_REGION` (default `auto`); `S3_PATH_STYLE=true` for MinIO and Garage. |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | `false` only if you run `docker compose run --rm agentes migrate` yourself before each start. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `TELEMETRY` | `on` | `off` stops the anonymous usage report (Optional services and what they receive). |
| `TYPESAFE_API_KEY` | | Your TypeSafe key for Jev (AI: plans and keys). Wins over the key added in Settings → AI and usage. |
| `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET` | | Your Composio project: Gmail and Outlook mailboxes and the services connected through Composio (below). |
| `COMPOSIO_AUTH_CONFIGS`, `COMPOSIO_CALLS_PER_MONTH` | `0` for the cap (none) | Auth configs of your own per toolkit (`googledrive=ac_…`), and the Composio calls a workspace may make per month. |

**Model keys.** Each organization adds its own keys (Claude, OpenAI, Gemini, DeepSeek, Kimi, Z.ai,
MiniMax or OpenRouter) in **Settings → AI and usage**, and each agent uses one of them. Usage and cost are recorded per agent.

**Your own models.** **Other provider** there takes any server that speaks OpenAI's Chat Completions or
Anthropic's Messages: an Ollama, vLLM, LM Studio or LiteLLM next to this server, or a gateway. Give its base
address as that API's SDK takes it (`http://localhost:11434/v1` for Ollama), a key if it asks for one, then
fetch or type its models and, if you like, their prices: each model gets one test call that checks it can use
tools. A model without prices costs nothing in budgets (its tokens are still counted). Private addresses and
`http://` are allowed on a self-hosted server, unless `ALLOW_SIGNUP=true` lets anyone in; set
`MODEL_ENDPOINTS_PRIVATE` to choose (`false` allows only public https ones, what agentes.chat Cloud does).

**Sign-up.** The first account is allowed unless an owner link or the desktop app's owner key holds
it (below). After it, with `ALLOW_SIGNUP=false` (the default), only invited people get in: invited by
email from **Settings → Members and invitations**. A workspace's invitation link lets nobody in by
itself, nor opens sign-up: whoever opens it asks to join, and an owner or admin approves each person.
With email set up, whoever asks first proves the address with a 6-digit code sent to it, unless
they're signed in with that address confirmed. Approving lets in at once a confirmed account with
that address when the code proved it or that account asked. Anyone else gets an email invitation
(without email, the admin gets its link to send). Keep sign-up closed on an instance reachable from
the internet. To keep the first account for its owner, set `OWNER_CLAIM_SHA256` to the SHA-256 (hex)
of a one-time token (the setup doesn't make one yet); then only `<PUBLIC_URL>/owner#claim=<token>`
creates it, with a password, and every other sign-up waits until it has. In the folder with `.env`:

```sh
token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
echo "OWNER_CLAIM_SHA256=$(printf %s "$token" | openssl dgst -sha256 | sed 's/^.*= //')" >> .env
docker compose up -d
echo "Owner link: <PUBLIC_URL>/owner#claim=$token"
```

The link works once, so treat it like a password until you've used it. `OWNER_KEY_SHA256` does the
same for the desktop app that runs the server on its own computer.

**Email.** Without `SMTP_URL` or `MILLIONSEND_API_KEY`, the app writes each email to its log instead
of sending it (`docker compose logs agentes | grep 'email (not sent'`), so an invitation link can
still be copied from there; email verification and password reset stay off. With either set, it
sends invitations, codes for asking to join through a link, email verification, password reset
links, and budget and approval alerts. `MILLIONSEND_API_KEY` wins when both are set.

**Password reset** needs email, so it shows only with `SMTP_URL` or `MILLIONSEND_API_KEY` set: "Forgot
my password" on the sign-in page emails a link to the web app's reset page (`/reset-password`).

**Voice messages.** People hold the microphone and send audio; agents read its words, and the audio's words stay hidden until someone opens them on that message. The microphone shows only with a speech engine. As the server's owner, pick a provider and paste its key in **Settings**, or set it in the environment: `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`, `SONIOX_API_KEY`, `GROQ_API_KEY`, `OPENAI_SPEECH_API_KEY` or `DEEPINFRA_API_KEY`, with `SPEECH_ENGINES` for the order they are tried. With any of these, the audio goes to that provider to become text. DeepInfra is the cheapest of them, with the same Whisper as Groq. `LOCAL_SPEECH_URL` points at a server of your own that speaks the OpenAI format (Speaches, a local Whisper or Parakeet), and the audio stays with you: `LOCAL_SPEECH_API_KEY` if it asks for a key, and `LOCAL_SPEECH_WARM=on` if it loads its model on demand and can start when someone presses the microphone (`POST <LOCAL_SPEECH_URL>/warm`). Every request to it names the workspace in `X-Agentes-Org`, and one that takes more than half a minute plus twice the recording goes to the next engine. A self-hosted server has no limit on minutes. Engines hear the language in the audio: the app's language goes only to Soniox, as a hint.

**Voice messages on this machine.** The `speech` profile runs NVIDIA's Parakeet on this server, as agentes.chat's Cloud does: add `speech` to `COMPOSE_PROFILES` and set `LOCAL_SPEECH_URL=http://speech:8000/v1`, then `docker compose up -d`. The first pull is about 1 GB, its models included; once it has started, it needs no internet, and its network reaches only the app. Parakeet knows 25 European languages and picks the one spoken, once a language guess gives them together at least `SPEECH_LANGUAGE_MIN` (0.7); another language, an unsure guess, a recording it hears no words in, or one that arrives when every worker is taken, goes to the next engine at once, so give it one: `SPEECH_ENGINES=local,deepinfra` with `DEEPINFRA_API_KEY`, for example. Without one, a recording in another language goes out as audio with no words, and a busy server's wait for the job's retries; `SPEECH_LANGUAGE_MIN=0` then gives Parakeet every recording, unsure ones included. By default it takes up to 4 CPUs and 4 GB of memory (`SPEECH_CPUS`, `SPEECH_MEMORY`; Docker refuses more CPUs than the machine has, so set `SPEECH_CPUS=2` on a 2-CPU server), runs 2 recordings at once on 2 threads each (`SPEECH_WORKERS`, `SPEECH_THREADS`) and lets 4 more wait up to 3 seconds each (`SPEECH_QUEUE`, `SPEECH_WAIT_SECONDS`); a short note takes a few seconds. `LOCAL_SPEECH_API_KEY`, when set, is the key both sides use. The service runs `ghcr.io/agentes-chat/speech`, published with each release under the app's tags, and `AGENTES_SPEECH_IMAGE` holds a version; from a checkout, `docker build -t agentes-speech:local deploy/speech` builds it (downloading the models from Hugging Face), with `AGENTES_SPEECH_IMAGE=agentes-speech:local`.

Recordings are kept with your files, outside the Drive, for `VOICE_RETENTION_DAYS` (90 by default; 0 keeps them forever). A daily sweep then deletes the audio; the message and its words stay for agents and search, and the player says the recording is gone.

**Search across languages.** Search matches words, so a request in Portuguese misses a memory saved in English, and one in other words misses it too. Before every run an agent searches its memory with the message that started it; with vectors it finds what it needs by meaning, in any language. Set `EMBEDDINGS_PROVIDER=openai` and `EMBEDDINGS_URL` to a server with OpenAI's embeddings API, with `EMBEDDINGS_API_KEY` if it asks for a key:

| Server | `EMBEDDINGS_URL` | `EMBEDDING_MODEL` |
| --- | --- | --- |
| DeepInfra, with its key | `https://api.deepinfra.com/v1/openai` | `Qwen/Qwen3-Embedding-0.6B` (the default, $0.01 per million tokens), `Qwen/Qwen3-Embedding-8B` (the same price, better scores) or `BAAI/bge-m3` |
| OpenAI, with its key | `https://api.openai.com/v1` | `text-embedding-3-small` or `text-embedding-3-large`, asked for 1024 numbers |
| This machine, below | `http://embeddings:8080/v1` | `Qwen/Qwen3-Embedding-0.6B`, `BAAI/bge-m3` or `ibm-granite/granite-embedding-311m-multilingual-r2` |
| Ollama, vLLM or llama.cpp of your own | its address, ending in `/v1` | the name it serves the model under |

The model may give at most 1024 numbers per vector; fewer are padded with zeros. The Qwen3 models get the instruction their queries need only under their names above, so a server that names them otherwise (Ollama's `qwen3-embedding`) gets plain queries. `EMBEDDINGS_KINDS` says what gets vectors: memories (`context_item`) by default; `context_item,wiki,file,issue,action` adds wiki pages, files, tasks and the team's actions, and `message` messages, which are most of what is indexed and whose vectors would take most of the disk. The rest is found by its words. At each start, every workspace's documents of those kinds that this model hasn't embedded get their vectors in the background, so turning vectors on, changing the model or adding a kind needs nothing else. A query waits at most `EMBEDDINGS_QUERY_TIMEOUT_MS` (1.5 seconds) for its vector; when the server is late or down, that search goes on with words alone, and three failures in a row go to error reports, once. Each workspace's usage shows the vectors' cost (kind `embedding`) at the model's list price, also when the model runs on a server of your own (granite, which DeepInfra doesn't host, costs nothing there). Without `EMBEDDINGS_PROVIDER`, search is full-text, as on any install with only Postgres.

**Search across languages on this machine.** The `embeddings` profile runs Hugging Face's text-embeddings-inference on this server's CPU: add `embeddings` to `COMPOSE_PROFILES`, set `EMBEDDINGS_PROVIDER=openai` and `EMBEDDINGS_URL=http://embeddings:8080/v1`, then `docker compose up -d`. It serves `EMBEDDING_MODEL`, Qwen3-Embedding-0.6B by default; `BAAI/bge-m3` gives vectors of the same size, and `ibm-granite/granite-embedding-311m-multilingual-r2` is about twice as fast on a CPU. Its first start downloads the model from Hugging Face into its volume (about 1.2 GB for Qwen3-Embedding-0.6B), so its network reaches the internet; what it embeds never leaves this machine. By default it takes up to 2 CPUs and 3 GB of memory (`EMBEDDINGS_CPUS`, `EMBEDDINGS_MEMORY`, with `EMBEDDINGS_THREADS` threads; Docker refuses more CPUs than the machine has), in batches of at most 2,048 tokens (`EMBEDDINGS_BATCH_TOKENS`). If `docker compose logs embeddings` shows it restarting for memory, give it `EMBEDDINGS_MEMORY=4g`. On a CPU a query's vector can take a second or more, and longer while it embeds a batch, so set `EMBEDDINGS_QUERY_TIMEOUT_MS=3000`: an agent's run then starts up to 3 seconds later when the server is busy, and past that its memory search goes on words. The image is for x86-64 servers only. Nothing waits for the service: while it starts, or if it is down, search goes on words alone.

**Files.** The compose file stores uploaded files (Drive files, attachments, photos) in the `files`
volume. With all four `S3_*` variables set they go to that bucket instead, and with neither, into
Postgres. Choose before the first upload: a file stays in the store it was written to. An
organization can also keep its files in a bucket of its own (**Settings → Storage**).

**Services through Composio (optional).** Google Drive, Google Calendar, Sheets and Docs, Slack,
Microsoft Teams, OneDrive, HubSpot, Salesforce, Zendesk, Instagram, Facebook Pages, LinkedIn, YouTube,
Pinterest, Reddit and WhatsApp Business have no server that connects to us directly;
Asana, Figma, Intercom, Dropbox and Square have one that doesn't let us in yet. With `COMPOSIO_API_KEY`
set to the key of a project of yours at https://composio.dev, they connect through it: people sign in on
Composio's page with Composio's own app (in English, and the service's consent screen says "Composio"),
with no key to paste. Without it they don't show in **Add connector**, and the ones waiting on their
vendor show as coming soon. Composio bills your project per tool call; `COMPOSIO_CALLS_PER_MONTH` caps
each workspace (0, the default, for none), and **Settings → Usage** shows each workspace its calls this
month. To use an OAuth app of your own instead of Composio's, add it to your Composio project as an auth
config for its toolkit and set `COMPOSIO_AUTH_CONFIGS=googledrive=ac_…` (several pairs separated by
commas). Point a Composio webhook subscription at `{PUBLIC_URL}/api/webhooks/composio` and set its
secret in `COMPOSIO_WEBHOOK_SECRET` so an expired account shows "Reconnect" right away. Disconnecting
deletes the account at Composio, without revoking it at the service. Instagram connects business and
creator accounts only, and WhatsApp a WhatsApp Business account, whose id Composio's page asks for.
Composio's own LinkedIn and YouTube apps share their rate limits and daily quota with all of Composio's
customers: with heavy use, give them OAuth apps of your own in `COMPOSIO_AUTH_CONFIGS`.

**Deleting workspaces and accounts.** An owner deletes a workspace in **Settings → General**, with a
code emailed to them (with no email set up, their password instead): it closes for everyone at once,
its agents stop, and it is deleted for good 7 days later. Until then any owner can restore it. An
account is deleted from **Settings → Your account**, or the account page on the phone, with the same
proof: it is signed out everywhere at once and deleted for good 7 days later, and signing in before
then restores it. The workspaces where it was the only member close at the same time and go on the
same date. With Sign in with Apple, register `EMAIL_FROM`'s domain in Apple Developer › Sign in with Apple for Email
Communication (SPF and DKIM passing): someone who hid their address gets mail only from senders
registered there, so without it they would get no code. What lives outside the server stays:
the agents' folders on connected computers until the runner is removed, files in a workspace's own
bucket, a GitHub App installed on GitHub, and your database dumps until `BACKUP_RETENTION_DAYS` drops
them. With email set up, the members hear when a workspace is deleted and when it comes back.

**Operator API (optional).** For your own automation: look up any workspace or account on the
instance. Off unless `OPERATOR_API_TOKEN` is set (at least 32 characters, `openssl rand -base64 48`);
then a second listener on `OPERATOR_API_PORT` (3001) serves `/api/operator/v1`, called with
`Authorization: Bearer <token>`, and its OpenAPI document is at `/api/operator/v1/openapi.json`. That
port reaches every workspace, so never publish it or put it behind your proxy: the compose file
doesn't publish it, and containers on the same Docker network reach it as `http://agentes:3001`.
With the token set, the server also keeps 90 days of events for it to read (`GET /events`: sign-ups
with their email, sign-ins with their IP address and browser, workspaces, invitations, agents, emails
sent and runs finished, as metadata), and `GET /review/...` shows what one run or task did, with
credentials masked; every such read is recorded as an event. `PUT /orgs/{orgId}/standing` puts a
workspace on hold (its agents stop) or suspends it (nobody can use it, and what its agents are doing
stops), and brings it back (with `SUPPORT_EMAIL` set, its people see where to write about it); `PUT /orgs/{orgId}/agents/{agentId}/hold` stops one agent, and
`PUT /users/{userId}/block` signs an account out everywhere and keeps it out until you unblock it.
`PUT /orgs/{orgId}/deletion-hold` keeps a workspace an owner deleted from going after its 7 days (a
legal hold), closed, with everything in it, without telling it.
`GET /analytics` and `GET /analytics/connectors/{connector}` say how much each connector is used,
by day, workspace and agent, in counts the server always keeps: never what a tool was sent or answered.
`GET /analytics/work` and `GET /analytics/work/orgs/{orgId}` say how much the agents work and spend:
turns by who started them and how they ended, waits for room on a computer, reply times, and tokens by
type and who pays, with what they would cost through the API, per workspace or per agent, never what anyone wrote.
`MACHINE_PROVISIONING=external` (with the token) is for giving every workspace a computer of its own
from a provisioner you run: it lists the workspaces still waiting (`GET /machine-requests`), says how
far each one is, and asks for a single-use code that the computer connects with
(`POST /orgs/{orgId}/machines`): write it to a file only the runner's user can read and run
`agentes-runner pair --server <url> --enroll-file <file>` there (or pass `--enroll-file` to the installer),
which removes the file as soon as it is read. Leave it `off` and people connect their own computers.

**Stall-and-noise report (optional).** With `OPS_REPORT_EMAIL` set (one address, or several separated by
commas) and email set up, the server emails the previous UTC day's report every day at about 01:00 UTC: for
each workspace, where agents stopped although someone waited on them (a mention that woke nobody, a run that
could only read, work an agent said it would do and didn't, a hand-off or a person left without an answer, a
limit, a background task that failed at its start) and where they acted for nothing (runs that ended without a
word, answered only a thanks, or were woken with nothing to do, with their tokens and cost), against the daily
average of the 7 days before. Workspace names and counts only, never what anyone wrote.
`docker compose exec agentes bun run report:autonomy` prints the same table at any time (`--day 2026-10-30`
for another day, `--org <workspace id>` for one workspace).

</details>

<details>
<summary><b>Optional services and what they receive</b></summary>

**The usage report.** The instance sends agentes.chat anonymous usage statistics: counts such as people,
agents, machine sizes, AI tokens used and how much data the agents' browsers send and receive, never
messages, files, names or sites. The first goes about an hour after the server first starts, then one a
day at that time, restarts or not (one that came due while the server was off goes about 10 minutes
after it starts again), as JSON in a POST to `TELEMETRY_URL` (`https://telemetry.agentes.chat/v1/report`).
It passes through Cloudflare, which sits in front of agentes.chat and decrypts it on the way.
A send that fails is tried again three times within about 2.5 hours, then dropped: the next day's
report replaces it. These are all its fields:

| Field | What it is |
| --- | --- |
| `report` | The report's format: `1`. |
| `instance` | A random id made at the server's first start. Nothing else in the report identifies the server. |
| `version`, `edition`, `install` | The server's version, as `/api/health` gives it (`0.0.0` while releases aren't numbered yet); `selfhost`; `docker`, `native` or `desktop`. |
| `os`, `arch`, `uptimeHours` | The server's system (`linux`, `darwin`), processor (`x64`, `arm64`) and hours since it started. |
| `host.size` | The machine the server runs on: its logical CPUs (`cpus`) and memory (`memoryGb`, to 0.5 GB), the disk holding the server's files (`diskGb`, to 1 GB: `FILES_DIR`, the data volume with Docker, else its working folder), and `limit` (`cpus`, `memoryGb`) when a container lets the server use less of the machine. |
| `host.container` | Whether the server runs in a container. |
| `host.load` | How busy that whole machine got over the last day, sampled every 5 minutes: the average and highest load per CPU (`loadAvg`, `loadPeak`: the 5-minute load average divided by the machine's CPUs, 1 is every CPU busy), the average and highest share of its memory in use (`memoryAvg`, `memoryPeak`, from 0 to 1), and the hours the samples cover (`hours`); `null` with no sample from the last day. |
| `organizations` | How many workspaces. |
| `people` | How many accounts (`total`), and how many used the server in the last 1, 7 and 30 days (`active1d`, `active7d`, `active30d`). |
| `agents` | How many agents, archived ones aside. |
| `computers` | The computers connected to the server and seen in the last 30 days, with agents or not (this server's own, once for all the workspaces it serves, plus the ones people connected and one given by a provisioner), one line for each `kind` (`host`, `connected`, `managed`), `os`, `arch` and `size` (as above, or `null` when their runner is too old to say), with how many computers are alike (`count`), how many `agents` use them, their last day's `load` (as above, their averages averaged and the highest peaks, or `null` when none said how busy it got in the last day), and `browserTraffic`: what the agents' browsers on them sent and received over the last day, as their Chrome counts each request's headers and body (`upMb`, `downMb`, in MB), the `hours` counted and how many of the line's computers said (`computers`), `null` when none did. Only the agents' browsers are counted, never the rest of the computer. The 50 lines with the most computers. |
| `lastDay.runs`, `lastDay.toolCalls` | Agent runs started, and tool calls they made, in the last 24 hours. |
| `lastDay.desktopMinutes`, `lastDay.terminalMinutes` | Minutes people watched or controlled agents' desktops, and had terminals open, in the last 24 hours. |
| `lastDay.models` | For each AI provider and model used in the last 24 hours (the 50 most used): `provider`, `model`, `calls`, `inputTokens` (cached ones included) and `outputTokens`. A model that isn't in agentes.chat's model list (a name someone typed, a deployment, a fine-tune) goes as `other`. |

It never holds messages, files, names, emails, hostnames, paths, prompts, IP addresses, the sites agents'
browsers visit, or ids of workspaces, people or computers (the request itself comes from your server's
address, as any request does). `docker compose run --rm agentes telemetry` (without Docker,
`agentes-server telemetry`) prints exactly the next report, whether it is on or off, and sends nothing.
In the app, **Settings → General → Usage statistics → See what is sent** shows the same. Turn it off
either way:

- `TELEMETRY=off` in `.env`, then `docker compose up -d` (the server reads it when it starts); without
  Docker, in `~/.agentes/.env`, then start it again. This wins over the switch below.
- The switch in **Settings → General → Usage statistics**. Only the installation's first account (the
  person who set it up) sees it.

**Downloads and updates.** Installing and updating fetch files from agentes.chat, and those requests
carry nothing about the instance beyond what any download does: the installer
(`curl -fsSL https://agentes.chat/install`), the compose file the setup fetches into a folder that has
none (`https://agentes.chat/install/docker-compose.yml`), the packages that run it without Docker
(`https://app.agentes.chat/api/native/latest` names them, `/api/native/download/…` serves them), and
the desktop app's own updates: a check at start and every 6 hours
(`https://app.agentes.chat/api/desktop/latest`, naming its system and processor) and, when it installs
one, `https://app.agentes.chat/api/desktop/update` (its version and package type too) and
`/api/desktop/download/…`. The page that offers the app asks
for its newest version from the browser (Connect a computer, above, says what that request carries).
The instance itself downloads nothing from agentes.chat.

**Help pages.** The app's help links ("How computers work", "About this computer") open the public docs at
`https://agentes.chat/docs`, in the reader's language (`/pt/docs`, `/zh/docs`, `/fr/docs`…), the same pages for
every server. They open in a new tab with no referrer and carry only the page, the language and the section, never
your server's address. An old link to `/help/<page>` on your server answers 301 to that page on the docs site
(`?lang=`, else the browser's language, else English), and the browser keeps the `#section`.

An agents' computer, this server's own included, downloads Bun from GitHub when it is set up, and, on
Linux, the packages agents' screens need from the system's own package sources; a Linux server set up
with `--system` also gets Google Chrome and its updates from Google's apt repository
(`dl.google.com`).

Besides that report and the model providers each organization chooses, the instance talks to a third
party only when you turn that service on:

| Service | Turned on by | What it receives |
| --- | --- | --- |
| Claude (Anthropic), OpenAI, Gemini (Google), DeepSeek, Kimi, Z.ai, MiniMax | An organization's key | What an agent reads to answer: its instructions, the organization's context, recent messages, and the files and tool results it opens. Summaries and memory upkeep use the same key. |
| Another provider (OpenAI- or Anthropic-compatible) | An organization's endpoint (Settings → AI and usage → Other provider) | What the other model providers receive, sent to the address the organization typed. When it is saved, the server also reads that address's model list and makes one small test call per model. |
| OpenRouter | An organization's key | What the other model providers receive, passed on by OpenRouter to the model's own provider (the organization's OpenRouter privacy settings decide which may keep it). While a workspace has an OpenRouter key, the server also reads OpenRouter's public model list, with no key: about once an hour, and up to once a minute while agents' runs ask for a model the list lacks. |
| OpenCode | Always on | Nothing of yours: the server reads OpenCode Go's public model list, with no key, at boot and about once an hour, so that plan's model picker stays current. If the list is out of reach, the picker uses the list built into this version. |
| TypeSafe Jev | `TYPESAFE_API_KEY`, or the key the owner adds in **Settings → AI and usage** (the variable wins). Either way it is your own TypeSafe key, so TypeSafe bills your account. | To pick which agent answers a message nobody @mentioned: the channel's name and topic, the message (up to 4,000 characters), recent messages (up to 800 each), and the name, role, description and tools of the channel's agents. To pick an agent's model or the tools it loads: its name, role and instructions (up to 1,500 characters), the message (up to 2,000) and recent messages (up to 400 each). Also the messages and memory items it is asked to judge (a request to stop, a hand-off, a permission change, whether to archive a memory), a long run's task and latest words with the tool calls and the start of the results it may set aside, a mission's commands it is asked to rate with the mission's goal and current step, the names and descriptions of a connector's tools, and, when a message meets no AI connected, that message (up to 4,000 characters), to tell whether it asks to connect one. On agents' computers, what is on the screen it is asked to look at: the page's address, its text and a screenshot. Without it, a small model on one of the organization's API keys picks and judges instead, each person's own plan picks for their own messages, and simple rules do the rest. Some memory and tool decisions go back to what they did before Jev, nothing guesses what to connect, and nothing is read from images. |
| Voyage AI, DeepInfra, OpenAI or another embeddings server | `EMBEDDINGS_PROVIDER=voyage` with `VOYAGE_API_KEY`, or `EMBEDDINGS_PROVIDER=openai` with `EMBEDDINGS_URL` | The text of what `EMBEDDINGS_KINDS` lists (memory items by default) as it is indexed, up to 8,000 characters each, and search queries. The `embeddings` profile keeps them on this machine. Without one, search is full-text only. |
| Web search for agents | Always on: DuckDuckGo's HTML page with no key, unless `BRAVE_SEARCH_API_KEY` (Brave Search) or `SEARXNG_URL` (your own SearXNG) is set; an agent with a browser on its computer searches there instead (Google, then Bing or DuckDuckGo) | The words an agent searches for (`web_search`). `web_fetch` opens the public pages an agent asks for, from this server: never an internal or private address. |
| Composio | `COMPOSIO_API_KEY` | Gmail and Outlook mailboxes for agents, and the services connected through it (Google Drive, Calendar, Sheets and Docs, Slack, Microsoft Teams, OneDrive, HubSpot, Salesforce, Zendesk, Asana, Figma, Intercom, Dropbox, Square, Instagram, Facebook, LinkedIn, YouTube, Pinterest, Reddit and WhatsApp Business): Composio holds those connections, and what agents read or write there passes through it, files included. IMAP mailboxes and the other connectors connect directly. |
| MillionSend or Resend | `MILLIONSEND_API_KEY` | Each email the app sends: recipients, subject and body, links included. `SMTP_URL` uses your own mail server instead. |
| Expo | An iPhone signed in to the instance | For each push to that iPhone: its push token, a title (up to 80 characters) and a line of text (up to 180), through Expo's push service. |
| agentes.chat push relay | An Android phone signed in to the instance, unless `FIREBASE_SERVICE_ACCOUNT` is set or `PUSH_SENDER` is `direct` or `off` | Once, to register the instance: its version. Then, for each push to that phone: its FCM token, a title (up to 80 characters), a line of text (up to 180) and what the notification opens (ids of the workspace, conversation or request), which the relay passes to Firebase Cloud Messaging without keeping them. |
| Firebase Cloud Messaging (Google) | An Android phone signed in to the instance (through the relay above, or directly with `FIREBASE_SERVICE_ACCOUNT`) | For each push to that phone: its FCM token, the title, the line of text and what the notification opens. Directly, also a request signed with the service account's key, for an access token. |
| Your browser's push service (Google, Mozilla, Apple, Microsoft) | Someone turns on **Notifications in this browser** (`WEB_PUSH=off` hides it) | For each push to that browser: the notification encrypted to that browser (RFC 8291), which the push service can't read, the instance's public key, and a contact for the instance: `PUBLIC_URL` when it is a public https address, else the `EMAIL_FROM` address, else agentes.chat's site. |
| A Sentry-compatible server you choose | `SENTRY_DSN`, `SENTRY_WEB_DSN`, `SENTRY_MOBILE_DSN` | Error reports, below. |
| Tailscale | `COMPOSE_PROFILES=tailscale`, or the desktop app's **Reach it from your phone and teammates** | Its coordination server keeps the server's name, tailnet addresses and public keys, as for any device in your tailnet. Connections are encrypted end to end (WireGuard), through Tailscale's relays when no direct path exists; with Funnel, visitors' connections pass through Tailscale's servers, still encrypted to this server. The HTTPS certificate comes from Let's Encrypt, which publishes the server's name in the public Certificate Transparency log. |

**Error reports (optional).** With `SENTRY_DSN` (a project's DSN on a Sentry-compatible server), the
server reports its unexpected errors: crashes, requests that fail with a 500, background jobs that fail,
socket handlers that fail, and a boot that fails. With `SENTRY_WEB_DSN`, the web app and the desktop app
report theirs, and a page that breaks shows the code of its report. The phone app reports its own to
`SENTRY_MOBILE_DSN`, else to `SENTRY_WEB_DSN`, including a view of an agent's screen that never opens. A report holds the error and its
stack, the version (`APP_VERSION`, else the server's own), `SENTRY_ENVIRONMENT`, the route as a pattern
(`/api/app/organizations/:orgId/channels`), the request id, the HTTP method and status, a job's kind and
attempt, and internal ids of the workspace, person, agent, run and computer. It never holds messages or
mail, files, prompts or what models answer, tool inputs or outputs, names, emails, IP addresses, cookies,
auth headers, request or response bodies, or keys and tokens: emails, addresses and anything like a key
are masked in error messages too, a failed database query keeps its SQL without its values, and a wiki
page's name in an address is masked. A 4xx or an expected refusal (a computer that is offline) is not an error. Errors
only: no traces, sessions or replays. Unset, nothing is reported and the reporting code isn't loaded.
Browsers send their reports straight to that server, which sees their addresses as any server they
reach does.

A Gemini key without billing lets Google use what it receives.

Connectors (MCP servers, GitHub, Linear and the others) receive what agents send them, within the
scopes you grant each agent. Installing a skill from a private GitHub repository downloads it from
GitHub on the server, with the workspace's GitHub connection (a token pasted in **Settings → Connectors** works
without an OAuth app) or the GitHub App.

</details>

<details>
<summary><b>GitHub as an app</b></summary>

Connected with a person's GitHub account, agents open pull requests and comment as that person. With the
GitHub App, they do it as the app: pull requests, issues, comments and commits come from the app's bot, each
body ends with one line naming the agent and the person it works for, and commits credit that person
(`Co-authored-by`) when they signed in with GitHub. Where the app isn't installed, the account connection is
used, as before.

There are two ways to set the app up:

- **From Settings.** The server's owner opens **Settings → Connectors** and, on the card **This server's GitHub
  app**, chooses **Create the app on GitHub**. GitHub creates the app under their GitHub account with everything
  filled in, and sends them back; the app's keys are kept sealed in the database (they open only with this
  `AGENTES_SECRET`). To own it under a GitHub organization, transfer it on GitHub afterwards. Only the server's
  owner sees the card. The phone app's **Create in the browser** opens it on the web.
- **With environment variables** (they win when set): register a GitHub App by hand and set `GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY` (the PEM, raw or base64), `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_CLIENT_SECRET` and, with a webhook, `GITHUB_APP_WEBHOOK_SECRET`. Register it with:
  - Callback URL `{PUBLIC_URL}/api/app/github-app/callback`, with **Request user authorization (OAuth) during
    installation** on.
  - Webhook URL `{PUBLIC_URL}/api/github-app/webhook`, optional: without it, agents don't hear what happens on
    GitHub, and the GitHub panel checks the installations with GitHub when it opens. Subscribe it to Issues, Issue
    comment, Pull request, Pull request review, Pull request review comment, Pull request review thread, Discussion
    and Discussion comment (an app made from Settings has them; one made before shows its owner which to tick, with
    its page on GitHub).
  - Repository permissions, read and write: Actions, Administration, Attestations, Checks, Code scanning alerts, Commit
    statuses, Contents, Custom properties, Dependabot alerts, Dependabot secrets, Deployments, Discussions,
    Environments, Issues, Merge queues, Packages, Pages, Projects (classic), Pull requests, Repository security
    advisories, Secret scanning alerts, Secrets, Variables, Webhooks and Workflows; Metadata read. Organization
    permissions: Members read, Projects read and write. Installable by any account.

Then an admin of each workspace installs it on the repositories its agents may use: connecting GitHub offers
**The agentes.chat app** first, and **GitHub repositories** in **Settings → Connectors** has **Install the agentes.chat
app** (on the web and the phone). Each account it's installed on has **Manage on GitHub**, GitHub's page where that
account's repositories are picked, and **Remove**, which also uninstalls the app from that GitHub account. Without a
GitHub account connected, the app alone is the workspace's GitHub (**Connect a GitHub account** adds one). GitHub
Projects on a personal account need an account. Admins who aren't the server's owner are told the owner can create
the app while it's missing. Only an installation made from a workspace's install links to it: one installed on GitHub
directly, or approved there from a member's request, is refused until it is removed on GitHub and installed again from
**Settings → Connectors**.

Each call an agent makes gets a token with only what its tool needs, and deleting a repository or adding a ruleset
asks a person first. An app created before has fewer permissions: add these on GitHub (the app's settings,
**Permissions & events**) and each installation's account accepts them there. Until then, what needs them goes
through the account connection, or tells the agent an admin must accept them.

</details>

<details>
<summary><b>Agent computers</b></summary>

Agents run commands and code, drive a browser, and can think with Claude Code or Codex on a
computer that runs the runner: this server itself (This server as the agents' computer, below) or
one you connect, a server, a VM or a laptop.

**Settings › Devices › Connect a device** shows the command for this instance:

```sh
curl -fsSL https://chat.example.com/api/machines/install.sh | sh
```

The computer must reach `PUBLIC_URL`: it downloads the runner from there, sends files back through
it, and clones and pushes the agents' GitHub repositories through it.
With the GitHub App set up (GitHub as an app, above) and installed for a repository, agents' computers fetch
that repository straight from github.com (a one-hour, read-only token for that repository alone)
and still push through your server, so the computer must reach github.com too; without the App,
clones go through your server. A computer runs at most two clones at once, and a clone goes on when
your server restarts. Clones fetched from github.com share a cache that is never pruned (checkouts
borrow its objects): `~/.agentes-runner/git-cache` on a single-user computer, `/var/cache/agentes-git`
on a computer that runs each agent as its own user (owned by a system user `agentes-git` the runner
makes; each agent reads only the repositories GitHub let it fetch, through an ACL, so install the
`acl` package there, or clones go without the cache). Remove a repository's folder there only once no
agent's checkout of it is left.
On Tailscale, install Tailscale on it and sign in to the same tailnet first. The runner runs on
Bun 1.3.5 or newer: the computer's own, or one the installer downloads into
`~/.agentes-runner/runtime` and checks against the SHA-256 in the script before running it (Linux
and macOS, x64 and arm64). Where it can't (another system, or no `unzip` or `python3` to unpack it),
it falls back to Node.js 22 or newer and says what that runner lacks: the agents' desktops and the
terminal. The installer prints a code and a link; open it signed in, confirm, and the computer joins
your organization. Then it installs a background service
(a systemd user unit or a launchd agent) where it can; otherwise run
`~/.agentes-runner/bin/agentes-runner start` and keep it running. Options go after `sh -s --`:
`--dir <folder>` (where agents work, default `~/agentes`), `--name <name>`, `--no-exec` (files only,
no commands) and `--no-service`.

That computer runs the commands agents execute, the browser they drive (the computer's own Google
Chrome, which must be installed there: get it from google.com/chrome; it keeps itself up to date, and
each agent uses a profile of its own, never yours), and Claude Code, Codex, Cursor's, OpenCode's, xAI's Grok
Build or Google's Antigravity CLI when an agent thinks with a subscription signed in there (OpenCode's free models need no sign-in at all).
Install the ones you want on that computer, as the user that runs the runner: Cursor's with
`curl https://cursor.com/install -fsS | bash` (it lands in `~/.local/bin`, which the runner's PATH must
include), OpenCode's with `npm install -g opencode-ai@1.19.5`, Grok Build with
`curl -fsSL https://x.ai/cli/install.sh | bash` (it puts `grok` in `~/.local/bin` too; agents think with it only
through a Grok account added in Settings, AI and usage, never the computer's own sign-in. On Linux its sandbox needs
bubblewrap, `sudo apt install -y bubblewrap`, or Grok Build refuses to start and every turn fails), Google's
Antigravity CLI with
`curl -fsSL https://antigravity.google/cli/install.sh | bash` (`agy` in `~/.local/bin`; Gemini accounts sign in on Linux
computers only, each in a folder of its own, and a personal Google plan used this way is against Google's terms for
consumer plans: Gemini Enterprise or an API key avoids that). A runner in system mode (each agent
its own system user) needs the CLI where every agent's user can run it, not in one user's home: install it
under a shared folder and link it into `/usr/local/bin`, for example
`sudo env HOME=/opt/cursor sh -c 'curl https://cursor.com/install -fsS | bash'`, then
`sudo chmod -R a+rX /opt/cursor` and `sudo ln -sf /opt/cursor/.local/bin/agent /usr/local/bin/agent`;
OpenCode's release binary (`opencode-linux-x64.tar.gz` of github.com/anomalyco/opencode's `v1.19.5`)
extracted to `/usr/local/bin/opencode`; Grok Build with
`sudo env HOME=/opt/grok sh -c 'curl -fsSL https://x.ai/cli/install.sh | bash'`, then
`sudo chmod -R a+rX /opt/grok` and `sudo ln -sf /opt/grok/.local/bin/grok /usr/local/bin/grok`. Grok's installer
also makes `~/.local/bin/agent`, Cursor's name: where both are installed, link Cursor's `agent` last. The Antigravity
CLI the same way: `sudo env HOME=/opt/agy sh -c 'curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --skip-path'`,
then `sudo chmod -R a+rX /opt/agy` and `sudo ln -sf /opt/agy/.local/bin/agy /usr/local/bin/agy`.
Commands run as the user that runs the runner, so give it a dedicated user or a VM.
`agentes-runner tools disable commands` (or `claude`, `codex`, `cursor`, `opencode`, `grok` or `antigravity`) turns a capability off on that
computer, and `agentes-runner folders allow <path>` shares a folder besides the agents' own.

On a Linux server, the installer's `--system` option (below) installs Google Chrome from Google's apt
repository (its signing key checked against its fingerprint) when the computer has none, with a
systemd timer (`agentes-chrome-update.timer`) that upgrades it, and nothing else, every 6 hours. With the command
above, install Google Chrome yourself (on Debian and Ubuntu, the `.deb` from google.com/chrome adds
Google's repository). Computers that ran Chrome for Testing for their agents move to Google Chrome when
the installer runs again (or the runner updates, outside `--system`), and the agents stay signed in.
Without root nothing installs Chrome for you: `agentes-runner update` and the installer say so, with
where to get it, and when a computer's runner connects without a Chrome, whoever connected it gets a
notification once (with the browser switched on there).

Google makes no Chrome for Linux on ARM, so there (an arm64 server or VM) the agents' browser is the
computer's Chromium: Debian's (`sudo apt install chromium`) or Ubuntu's snap (`sudo snap install chromium`).
`--system` installs Debian's with the same update timer, and agent-browser's arm64 build.

**Desktops and terminal (Linux).** On a Linux computer each agent can have a desktop of its own, with
its browser on it, that people watch live from the agent's page and take control of when it needs a
hand (to sign in, say); and people can open a terminal there, a shell as the agent. Both need the
runner on Bun 1.3.5 or newer (the installer's, above), and the desktop needs these packages (Debian
and Ubuntu names); then turn both on at that computer:

```sh
sudo apt install --no-install-recommends tigervnc-standalone-server xauth dbus-x11 xfce4-session \
  xfwm4 xfce4-panel xfdesktop4 xfce4-settings thunar xfce4-terminal adwaita-icon-theme \
  elementary-xfce-icon-theme fonts-noto-core fonts-noto-cjk
agentes-runner tools enable desktop terminal
```

Keep `--no-install-recommends`: without it every desktop gets a screen locker nobody can unlock, more
background services, and a set of empty folders in each agent's home. `agentes-runner status` says
whether each of the two can run there and, when one can't, what is missing. `fonts-noto-cjk` is for
Chinese, Japanese and Korean, which the agent's browser and apps otherwise show as empty boxes; it takes
about 91 MB on Debian 13 and on Ubuntu 24.04 (a download of 57 MB and 61 MB), and `--system --desktop`
installs it where apt has it.

`agentes-runner desktop-check --agent <handle>` starts that agent's desktop, logs in to it and opens a
terminal, then stops what it started (stop the runner first). Agents use their desktop with the
**Use its desktop** permission, which new agents have. A desktop takes about 0.2 GB of memory, 0.8 GB
with the agent's browser on it. It starts the first time the agent, or someone watching, needs it, and
then stays on, so what a person left open there is still there later. Only when the computer runs short
of memory (under 1.5 GB free) or of displays (50) does it close the desktops nobody touched for an hour,
least used first; each starts again at its next use. An agent's desktop stops when the agent leaves the
computer (archived, or moved to another one).

Each agent's desktop has the agentes.chat look: its wallpaper and a dock at the bottom center (the mark,
which opens the apps menu, then Browser, Files and Terminal), one workspace and no desktop icons; its
terminal's prompt shows the agent's name. Browser opens the agent's own browser on its desktop, the one
it browses with, so a person who signs in to a site there signs the agent in (the first time, unless
the runner installed it as it started, it is installed first, which takes about a minute). The runner
writes the look into that desktop's own settings (`<agent folder>/.agentes/home`, or the agent's own
home with `--system`), never your user's or the computer's, so your own desktop stays as it is. For
its rounded windows, also install Orchis and the SVG loader it draws its buttons with (Debian 12 and
13, Ubuntu 24.04; `--system --desktop` installs them where apt has them); without them the desktops
use GTK's and XFCE's own theme.
Orchis takes about 42 MB on Debian 13 with what it brings along (GTK 2's theme engines among them), and
its package alone about 84 MB on Ubuntu 24.04, where it carries every color variant (the desktops use
only Orchis-Light):

```sh
sudo apt install --no-install-recommends orchis-gtk-theme librsvg2-common
```

On Debian 13 and Ubuntu 25.04 or newer, also install the dock's plugin, so an app's open windows show on
its own icon in the dock (`--system --desktop` installs it where apt has it; Debian 12 and Ubuntu 22.04
and 24.04 don't have it, and there each open window gets a button of its own after the icons):

```sh
sudo apt install --no-install-recommends xfce4-docklike-plugin
```

What a person changes on a desktop (its theme, its panel) stays until the runner writes the look again:
for a new version of the look, once Orchis, the SVG loader or the dock's plugin is installed or removed
(running the installer again with `--desktop` installs them), when the agent is renamed, or when the
agent's folder moves (without `--system`, it is renamed with the agent's handle). The runner writes it
as a desktop starts, and into a desktop that is running once nobody watches it and its agent isn't using
it: its settings change in place and its dock starts over, so nothing open on it closes. A desktop whose
agent's folder moved keeps its look until its next start (after a reboot, say).

Admins, the agent's owner and whoever its current work is for can watch. Taking control and the
terminal are for the person who connected the computer, since they act as its user: by default every
agent runs as that one user, its desktop and terminal included, so whoever uses either can read the
other agents' folders, the sign-ins on that computer and the runner's token, as the agents' commands
can. Give the runner a user of its own, or a VM. On a Linux server, the installer's `--system` option
(as root) makes each agent its own user instead. Ubuntu's systemd can't do it (`--system` refuses
there): the setup's simple mode runs every agent as one shared user, `agentes`, which sees the other
agents' folders but not yours or the server's. On x64 it also installs `agent-browser` once for all
of them, in `/opt/agentes-runner/browser` (root's, checked against the SHA-256 in the installer;
running the installer again updates it), and Google Chrome from Google's apt repository when the
computer has none, kept current by the computer's package updates. If the installer can't download
them, it goes on: each agent downloads `agent-browser` at its browser's first use, and says so when
Chrome is missing. Since its agents run as the
person who connected it, a computer leaves the organization with them when they leave, are removed or
delete their account; one installed with `--system` is the team's and stays.

**What an agent reaches on its computer (`--system`).** Each agent reaches the local ports its own
processes open (any port, port 0 included, on 127.0.0.1, ::1 or the computer's own addresses), and
nobody else's: another agent's listeners refuse it at once, so two agents can run dev servers, test
databases or Gradle on the same computer without seeing each other. The computer's own services refuse
agents too, except DNS: a database, an Ollama or a proxy you run there for them takes
`sudo agentes-runner services allow tcp/11434` (also `list` and `remove`; it applies within 2 seconds).
The address the runner connects to, when it is this computer's loopback (`http://127.0.0.1:3000`), the
proxies the runner itself runs behind, and ports Docker publishes on the computer's other addresses
(Caddy's 80 and 443) stay open. agentes.chat reached through something running natively on this
computer (`tailscale serve`, an nginx or a Caddy outside Docker) takes
`sudo agentes-runner services allow tcp/443` too, or agents can't push to its git. Container and VM
networks on the computer are closed to agents, except ports published on an address other than
loopback. Each agent also has its own `/tmp`, `/dev/shm` and `/run/lock`, in memory as the computer's
are (a tmpfs of its own, which counts in the agents' memory), and its own `/var/tmp` on disk (in
`/var/lib/agentes-runner-tmp`), cleared of what is 10 days old (30 in `/var/tmp`), so a socket or file
another agent leaves there is out of its reach, and its own adb server port
(`ANDROID_ADB_SERVER_PORT`). Agents can't schedule cron or at jobs, which would run outside their own
folders: the runner adds their users to `/etc/cron.deny` and `/etc/at.deny` (a job one scheduled before
may keep running: `crontab -r -u ag-…` removes it). This needs Linux 5.13 or newer, nftables
(`--system` installs it) and systemd built with `BPF_FRAMEWORK` (`systemctl --version` shows
`+BPF_FRAMEWORK`, as on Debian 13; Ubuntu's doesn't, so `--system` refuses to install there): the runner
checks it at each agent's start and starts nothing of that agent's where it doesn't hold, and the
agent's work fails saying why. For Android builds, install with `--agent-uid-range 20000-20999`: that
leaves the Kotlin compile daemon's ports (17001-17999) free; with the default range it compiles inside
Gradle instead, slower. This server's own computer always keeps the default range, which its
organizations share, so Kotlin compiles inside Gradle there. Two things stay shared between agents: a
server an agent binds to `0.0.0.0` is as reachable from outside the computer as your firewall lets it
be, so agents should bind private servers to `127.0.0.1`; and abstract Unix sockets (a name, not a file)
have no owner, so a program an agent runs that listens on one without checking who connects is open to
the other agents, and an agent can take a name another agent's program wants. An X display's name taken
before a desktop starts sends that desktop to another display, but an agent holding all 50 stops every new
or restarted desktop on the computer, and on this server's own computer the names span its
organizations.

**Memory and CPUs.** With `--system` the agents share the computer: none has memory or CPUs of its own,
so one agent's build may use every CPU and all the memory the agents have; when several want the CPUs,
each gets an equal share. All of them together stop at 75% of the RAM (50% on this server's own
computer), plus swap for a third of that, which keeps the rest for the system, the runner and, here,
the server. At that limit the kernel stops one process, usually the biggest (Chrome's pages first), and
only that process: the command it belonged to fails, and the agent is told it was most likely memory
(with systemd 253 or newer; a desktop or a task already running when you update gets this when it next
starts).
`agentes-runner computer`, which any agent (or you) can run, prints what the computer has, what is free
for new work and which agents use the most; agents are told to run it before something heavy, to tell
the person when another agent's work leaves no room, and to stop what a finished build left running.
Gradle's and Kotlin's daemons exit after 5 idle minutes anyway (`GRADLE_OPTS` in each agent's environment).
Expo's default Android debug build fits an 8 GB computer this way, using nearly all the agents' memory.

**Containers (`--system`).** Agents can run `docker`, `docker compose` and `podman` on a computer where each is its
own user once Podman is there: `apt install --no-install-recommends podman crun uidmap passt catatonit netavark
aardvark-dns docker-compose`, and `podman-docker` for the `docker` command on a computer without Docker (where Docker
is, its `docker` talks to the agent's Podman, never to Docker's daemon), then restart the runner
(`systemctl restart agentes-runner`). Nobody joins a `docker` group, which
would make any agent root on the computer: each agent's containers are rootless Podman under its own user, run by a
containers service of its own (`agentes-containers-<uid>.service`, a systemd user manager in the agent's slice), its
images and volumes in its home, its limits the agent's share (one container's `--memory` and `--cpus` work inside
it). One that fails at every start stops after 5 tries in a minute, and the runner's log says `containers
unavailable:` and why (`journalctl -u agentes-containers-<uid>.service` has the rest); after a fix,
`systemctl reset-failed agentes-containers-<uid>.service` lets the agent's next request start it again. Each agent
gets the 65536 subordinate ids from `uid << 16` in `/etc/subuid` and `/etc/subgid`, the runner
replacing the range useradd gave it, and none if another range is in the way (the log says which). Their traffic
leaves as the agent's own uid, but a container on the host network (`--network host`) whose user inside isn't root
leaves as one of those ids: a firewall of yours that keys on the agents' uid range should treat every uid from 65536
up the same way. Containers stop when the computer restarts and come back, those with `restart: always`, with the
agent's next request. Agents on Codex, Cursor, Grok or Antigravity get none: their CLI's own sandbox is what holds
them, and the containers service runs outside it. [ADR 0169](docs/adr/0169-agents-containers.md) has the rest.

**The shared folder.** Every computer has one folder all of its agents read and write, so what one of
them downloads, clones or installs, the others use instead of fetching it again. With `--system` it is
`/srv/agentes/shared`, owned by root and the group `agentes-shared`, which the runner makes and adds
every agent's user to; each agent also finds it at `~/shared`, in its desktop's file manager, and its
`bin/` folder at the end of its `PATH`, so a command-line tool one agent installs there (without root)
works for all of them. A tool there runs as whichever agent calls it, with that agent's files, so only
agents you trust with each other's work should share a computer; the runner itself never starts Claude
Code or Codex from there. Install the `acl` package (`apt install acl`): with it, what an agent makes there
stays writable by the others whatever its umask; without it, it stays readable only, until the agent runs
`chmod g+w`. The runner never changes anything inside the folder. On this server's own computer each
organization gets a folder and a group of its own (`/srv/agentes/shared-<id>`), so nothing crosses between
organizations. Without `--system` it is `shared` in the runner's workspace. Agents are told to look there
before downloading anything big, to keep credentials, `.env` files and sign-in folders out of it, and to
check the free space first. **Settings › Devices** shows its path, its size (measured hourly) and the
free space on the disk, and the workspace's admins get a notification when that disk passes 85%.

Mac and Windows computers get no agents' desktops: the agent's browser runs headless, and its card
shows it live. A Mac connected with the command above opens terminals
(`agentes-runner tools enable terminal`); the desktop app doesn't have them yet.

Use HTTPS with a certificate from a public authority (Tailscale and the Caddy profile get one). Over
plain http the computer's token travels unencrypted, and the runner's background service doesn't
load extra CA certificates.

**Agents using apps on their desktops (Linux).** Besides being watched and controlled, an agent's
desktop is one it can use itself: open an app, click, type and read the screen, for apps with no API or
web version (web pages stay in its browser). It reads the screen through the desktop's accessibility
tree, so most elements have a name and a number, and finds the rest on a screenshot. Driving a desktop
runs anything as the agent, so it needs:

- each agent working as its own user on that computer (the installer's `--system` option, as root),
  never a desktop shared with the runner's user or with another agent;
- these packages (Debian and Ubuntu names), besides the desktops':

  ```sh
  sudo apt install --no-install-recommends python3 python3-gi python3-xlib xdotool scrot at-spi2-core
  ```

- the desktop and commands turned on at that computer (`agentes-runner tools enable desktop`, then
  `agentes-runner tools enable commands`);
- the agent's **Use its desktop** and **Run code** permissions, and the organization's code environment on.

The agents' desktops start with `ACCESSIBILITY_ENABLED=1` and `QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1`, so
GTK, Chromium and Electron apps show their buttons and fields; Qt apps, games and canvases are found on
the screenshot only. The computer's page in the app (**Apps on the agents' desktops**) says whether
agents can use their desktops there and, if not, what is missing and the command to run;
`agentes-runner desktop-check --agent <handle>` (with the runner stopped) times a look, an action, a
screenshot and a close-up on that agent's desktop.

With Jev (**Settings → AI and usage**, or `TYPESAFE_API_KEY`), agents name targets in words, small ones
are looked at again up close on the screenshot, and checks can look at the screen's image. Without it
they act by the numbers on the screen and exact names, checks use the organization's small model on the
screen's text when it has an API key, and nothing is found on images. Each step an agent takes shows on
its message, and every app or file it opens is in the organization's audit log. Programs on one desktop
aren't isolated from each other: code the agent runs there can see its screen and keys, so agents never
type passwords into desktop apps; a person signs in with take control, and the sign-in stays in the
agent's home. Mac and Windows computers have no desktop use.

**This server as the agents' computer.** The machine agentes.chat runs on can be a computer too, for
the organizations the installation's first account made and is an owner or an admin of. The setup
does it by default, after asking: on Linux each agent gets a user of its own with a screen (as root,
with systemd built with `BPF_FRAMEWORK`: yes by default with apt-get and 4 GB of memory or more, no by
default otherwise, saying why; where systemd lacks `BPF_FRAMEWORK`, as on Ubuntu, it offers **simple
mode** instead: every agent works as one user, `agentes`, made without sudo, so they see each other's
folders but not yours or the server's; its service is a user unit kept running with
`loginctl enable-linger`, with its own copy of the token in `/home/agentes/host-computer-token`),
and on a Mac agents work as you, in folders of their own, with a browser, Claude Code and Codex, and
commands on unless you say no. It writes `HOST_COMPUTER_TOKEN` to `.env` and to
`host-computer-token` beside it (readable by you only), installs what runs the agents there from the
address the app is published on (`BIND_ADDRESS` and `HOST_PORT`), and waits for it to answer, up to
90 seconds. Running the setup again leaves it running while it answers and is up to date, and sets it
up again when agentes.chat brings a newer version. Answering no leaves `HOST_COMPUTER_TOKEN=` empty,
so the setup doesn't ask again; `--computer yes` on a later run turns it on, and `--computer no`
after a yes empties the token, removes `host-computer-token` and prints the command that removes the
service. It's skipped, saying why, while sign-up is open (`ALLOW_SIGNUP=true`) or a provisioner gives
every workspace its computer (`MACHINE_PROVISIONING=external`), since the server won't start with the
token then; on Linux without root or systemd; inside the image; and on a machine already connected as
a computer, whose connection stays as it is.

**What the agents need there.** On Linux the setup then checks what the agents use on that machine:
their browser (Google Chrome, or Chromium on ARM, where Google makes none), the packages for their
screens (Xtigervnc and XFCE), Claude Code and Codex. It says what's there and asks about each one missing,
yes by default (`--requirements all`, `none` or a list such as `browser,claude` answers for all; without
a terminal, yes). System mode's installer brings the browser and the screens itself, so only Claude Code
and Codex are asked about there. It installs them as root with the computers' installer
(`curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --requirements browser,desktop,claude,codex`,
which also works by hand): Chromium from Debian's apt, or Ubuntu's snap where apt has none; Claude Code
with Anthropic's installer, copied to `/usr/local/bin`; Codex from the latest release of OpenAI's
`codex` on GitHub, to `/usr/local/bin`. Running the setup again installs nothing that's there; Claude
Code and Codex update themselves where they can, or with that command.

By hand on Linux (a server set up before, say): set a token in `.env` and give the same one to the
agents' computer, as root, in the folder with `.env` (3000 is the app's port, `HOST_PORT` if you
changed it):

```sh
(umask 077 && openssl rand -base64 48 | tr -d '\n' > /root/host-computer-token)
echo "HOST_COMPUTER_TOKEN=$(cat /root/host-computer-token)" >> .env
docker compose up -d
curl -fsSL http://127.0.0.1:3000/api/machines/install.sh | sh -s -- --system --desktop \
  --server http://127.0.0.1:3000 --host-token-file /root/host-computer-token
```

Within a minute it shows as "This server's computer" in each of those organizations, and agents
without a computer start using it; admins stop it per organization there. `HOST_COMPUTER_TOKEN` can't
be set with `ALLOW_SIGNUP=true`, and a new token retires the old one's connections when the server
restarts. Its agents reach the app at the address the runner connects to and the ports Docker publishes
on public addresses (Caddy's 80 and 443), never Postgres or the containers' network; a service you run
natively on this machine for them takes `sudo agentes-runner services allow tcp/<port>` (`tcp/443` for
agentes.chat behind a `tailscale serve`, an nginx or a Caddy outside Docker). The Kotlin compile daemon
doesn't run there: the computer keeps the default uid range, and Kotlin compiles inside Gradle.

The agent browser opens an offline new tab in its responsible person's language, with no outside request.
A computer on your server never measures or reports its public address: only a workspace's managed computer
(`MACHINE_PROVISIONING=external`) does. The system runner's network options for integrators are in
[ADR 0030](docs/adr/0030-runner-isolation.md#addendum-browser-start-page-and-network-options).

</details>

<details>
<summary><b>AI: plans and keys</b></summary>

**API keys.** Each organization adds its own provider keys in **Settings → AI and usage**. They are
stored encrypted with a key derived from `AGENTES_SECRET`, never sent back to a browser, and every
model call goes through the server, which records its usage and cost per agent.

**Jev (optional).** Jev is a fast model by TypeSafe that agentes.chat asks small questions: who should
answer a message nobody @mentioned, how a new memory relates to the old ones, where a button is on an
agent's screen. With it, unmentioned messages are routed even when agents think only with plans,
memory spots repeats said in other words, and agents find buttons from a description and on
screenshots. The person who set up the server adds the key in **Settings → AI and usage** (the setup
asks once), or puts it in `.env` as `TYPESAFE_API_KEY`, which wins. It is stored encrypted like
provider keys and never sent back to a browser. TypeSafe bills your account: US$ 0.042 per million
tokens read, about US$ 0.0001 per routed message. Without it, see https://agentes.chat/docs/jev#without.

**Plans.** An agent can think with a Claude or ChatGPT subscription instead of a key, on a connected
computer: Claude Code or Codex signs in there with the provider's own flow. Each account is a folder
on that computer, `<runner home>/accounts/<kind>/<id>` (`~/.agentes-runner/accounts/…` for a runner
installed with the command), and its sign-in never leaves it. The server keeps only the account's
name, email, plan, status and usage (how much of each limit is used, and when it resets, as the CLI
there says it). The code pasted when signing in from a browser is encrypted there to a
key made on the computer and relayed without being stored, so the server can't read it. A personal
plan is meant for its owner: answering other people with it may go against the provider's terms.
With no Jev and no API key that has a small model, a plan also picks who answers its owner's own
messages that mention nobody: Claude Code or Codex reads the message and the few before it on that
computer, with every tool off, in a few seconds, and only while nothing else runs on that sign-in. It
never picks for other people's messages, a sign-in made with an API key never picks, and a Windows
computer doesn't pick yet.

**Coding plans.** A GLM Coding Plan, Kimi Code, MiniMax or OpenCode Go key thinks through Claude Code
on that computer, in its own account folder: the key is encrypted in the browser to the computer and
kept only in the folder (`provider.json`, mode 600); the server keeps its last 4 characters. Where a
turn's requests go comes from the runner's own list of plans, not from anything a project can set.
Each person adds them in **Settings → AI and usage**.

**One sign-in for all of your agents.** An account signed in once on a computer thinks for every agent
you give it there, with no other sign-in (**Use for…** in **Settings → AI and usage**, or the account
in an agent's **Who thinks**). With every agent running as the runner's own user, that is any account.
With `install.sh --system`, a Claude sign-in made for all agents is `claude setup-token`'s token,
kept in the account's folder (`token.json`, mode 600), which only root opens, and a coding plan's key
stays in `provider.json` there the same way. Each turn's Claude Code runs in a folder of that agent's
own and reads the token on a file descriptor as it starts, never from its environment, so the
commands it runs don't get it; a key goes in its environment. When the agent moves to another account
or brain, or the account is disconnected, the processes that had it close. A ChatGPT sign-in there
still thinks for one agent. Disconnecting a Claude account deletes its token from the computer: to
end it on Claude too, revoke it in Claude's settings.

**Who can reach an account.** With every agent running as the runner's own user (the default
install), any agent on that computer could reach every account folder there; the runner keeps them
out of what agents read, but the OS doesn't. With `install.sh --system` each agent is its own user:
a sign-in made for all agents stays root's, and its token or key reaches only the turns of the agents
that think with it; any other account folder belongs to the user of the agent that thinks with it,
only while it does. Taking control of an agent's desktop or opening its terminal is a shell as that
user: in the default install only the person who paired the computer can, and with `--system` admins
and the agent's owner can, but only its owner while the agent thinks with their plan.

**Backups.** Leave `<runner home>/accounts`, and the CLIs' own `~/.claude` and `~/.codex`, out of the
computer's backups: they hold sign-ins. The server's database never has them.

</details>

<details>
<summary><b>Upgrades</b></summary>

Download the compose file again with each release, since a release can change it, then pull and
restart. Take it from the release's tag (here `v1.2.3`, the newest on the
[releases page](https://github.com/agentes-chat/agentes-chat/releases)), so it matches the image:

```sh
curl -fsSLO https://raw.githubusercontent.com/agentes-chat/agentes-chat/v1.2.3/docker-compose.yml
docker compose pull
docker compose up -d
```

`https://agentes.chat/install/docker-compose.yml`, the one the setup downloads, is the file of the
build agentes.chat runs, which follows `main` and can be ahead of the latest release.

Keep your settings in `.env` and never edit `docker-compose.yml`, so replacing it loses nothing.
Anything a variable can't set goes in a `docker-compose.override.yml` beside it, which Compose merges
on its own.

Migrations run when the new version starts, so that is the whole upgrade for a small instance. The
compose file runs `ghcr.io/agentes-chat/agentes:latest`, the latest release, for amd64 and arm64;
`:1.2.3` and `:1.2` tags exist alongside it, and `:edge` is built from every push to `main` that
passes CI. To hold a version, set `AGENTES_IMAGE` in `.env` to a version tag or a digest
(`ghcr.io/agentes-chat/agentes@sha256:…`), and keep that version's compose file. This prints the digest you have:

```sh
docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/agentes-chat/agentes:latest
```

For a big jump, migrate first from a throwaway container. If a migration fails, the running version
keeps serving instead of a new one that won't start:

```sh
docker compose pull
docker compose run --rm agentes migrate
docker compose up -d
```

Migrations only go forward, and a version refuses to start on a database that a newer one migrated.
Take a dump before a big jump (Backups below): rolling back is the previous pin plus that dump.

The compose file pins the Postgres image too, by version and digest, so the database image changes
only when a release's compose file moves that pin. The new file, `docker compose pull` and
`docker compose up -d` then recreate the `postgres` container on the new image, keeping the `pgdata`
volume. That covers Postgres 18 minor releases and pgvector updates; a new Postgres major version
can't open the old data directory, so moving to one takes a dump and a restore into a new volume.

</details>

<details>
<summary><b>Rebooting the server</b></summary>

A reboot stops every container at once, so Postgres can go before the app saves the runs in
progress. Stop the app first: runs get up to 20 s to finish, and the rest are saved and go on when it
starts again.

```sh
docker compose stop agentes
sudo reboot
```

A container stopped by hand stays stopped after the reboot. Start it again in the install directory:

```sh
docker compose up -d
```

An uptime check from outside the server on `https://<your address>/api/health` is worth having: it
answers 200 only while the app and its database are up, so it tells you when the server doesn't come
back. On Tailscale, run it from another device in your tailnet.

</details>

<details>
<summary><b>More at once: worker processes</b></summary>

The app runs its jobs (agents' runs, routines, messages' routing, notifications, emails) in its own
process: 48 at once to start with, 12 of them kept for the quick ones. While jobs wait for a slot, it
gives itself more, every 30 seconds: agents' runs as far as half of its memory holds them, about 4 MB
each while they wait on their model or their computer, and quick jobs up to 4 per database connection
(`DATABASE_POOL_MAX`), never while its processor, its database or its memory is what jobs wait on. Its
memory is its container's limit when it has one; beside Postgres and the speech server on one computer,
it counts only what it holds and what was free there when it started.
Workspaces take turns, so one workspace's burst of routines makes only that workspace wait. When jobs
keep waiting anyway, the log says so, with `add a worker process`, and so do the error reports when
they are on (`SENTRY_DSN`).

A worker process runs jobs only: it answers its health check and nothing else over HTTP, and leaves
pushes to the app, the process that knows who has the app open. Add one next to `agentes` in the
compose file, with the same image and settings. It leaves the migrations to the app and starts once the
app is up:

```yaml
  agentes-worker:
    image: "${AGENTES_IMAGE:-ghcr.io/agentes-chat/agentes:latest}"
    env_file: .env
    environment:
      DATABASE_URL: "postgres://agentes:${POSTGRES_PASSWORD}@postgres:5432/agentes"
      FILES_DIR: /data/files
      SERVER_ROLE: worker
      RUN_MIGRATIONS_ON_BOOT: "false"
    volumes:
      - files:/data/files
    depends_on:
      postgres:
        condition: service_healthy
      agentes:
        condition: service_healthy
    networks: [default, speech]
    restart: unless-stopped
    stop_grace_period: 40s
    init: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    read_only: true
    tmpfs:
      - /tmp
```

Then `docker compose up -d`. Every process takes jobs from the same queue in Postgres, each job on one
process at a time (a job whose process stopped mid-way runs again once its lease ends, which jobs are
written for), so each worker adds as many jobs at once as the app runs. Each process keeps up to
`DATABASE_POOL_MAX` connections (20), plus one it listens on: keep their sum under Postgres's
`max_connections` (100 in the compose file's Postgres). Before a reboot, stop the worker with the app
(`docker compose stop agentes agentes-worker`). A worker on another computer needs the app's files
where it can reach them (`S3_*`, or Postgres without `FILES_DIR`), and one on the app's computer
outside Docker a `PORT` of its own. The built-in database (on this computer, without Docker) belongs
to one process and takes no worker.

</details>

<details>
<summary><b>From source</b></summary>

To run your own changes, or before anything is published to GHCR and npm, build the image and the
setup from a checkout. You need Git, Docker and [Bun](https://bun.sh) (`packageManager` in
package.json names the version):

```sh
git clone https://github.com/agentes-chat/agentes-chat.git
cd agentes-chat
bun install
bun run --filter '@agenteschat/setup' build
docker build -t ghcr.io/agentes-chat/agentes:latest .
mkdir -p ~/agentes && cp docker-compose.yml ~/agentes/
AGENTES_INSTALL_SETUP=$PWD/packages/setup/dist/index.js sh install.sh --dir ~/agentes
```

The image gets the tag the compose file runs, so Compose finds it on this machine and pulls nothing
for it. The compose file copied from the checkout matches the image you built; the setup keeps a
compose file it finds and downloads one only when the folder has none. `AGENTES_INSTALL_SETUP` makes
install.sh run your build of the setup with its pinned Bun instead of the published package. When
Docker needs root on Linux, run that line as `sudo env AGENTES_INSTALL_SETUP=… sh install.sh …`:
sudo drops the variable otherwise. For the backup profile, build its image too:
`docker build -t ghcr.io/agentes-chat/backup:latest deploy/backup`.

To upgrade, `git pull`, build the image again, copy `docker-compose.yml` again, then
`docker compose up -d` in `~/agentes`. Skip `docker compose pull` with a local image: it replaces it
with the registry's (or fails while nothing is published). `docker compose pull postgres` updates
the database image alone. The build installs every workspace's dependencies and builds the web app,
so it needs more memory than running the image. The image keeps the checkout's file permissions and
runs as an unprivileged user, so on a host whose umask is stricter than 022, clone and pull under
`umask 022` (for example `(umask 022 && git pull)`).

</details>

<details>
<summary><b>Backups and restore</b></summary>

An instance is three things: the database, the `files` volume (uploaded files, with the compose
file's `FILES_DIR`), and `AGENTES_SECRET`. Keep the secret apart from the dumps: a dump restored
without it has every stored key (model providers, connectors, mailboxes, databases) unreadable, and
anyone who holds both can read those keys.

**Every day, to a bucket.** The `backup` service dumps the database at 03:00 UTC to a bucket on
Cloudflare R2 or another S3-compatible store, and deletes dumps older than `BACKUP_RETENTION_DAYS`
(14 by default). To lose less than a day if the server is lost, dump more often:
`BACKUP_INTERVAL_HOURS=6` dumps at 03:00, 09:00, 15:00 and 21:00 UTC, and `1` every hour. Each dump is
the whole database, so with hourly dumps a shorter `BACKUP_RETENTION_DAYS` keeps the bucket small. While
a dump runs, an upgrade's migration that changes a table waits for it to end, and the app's requests to
that table wait behind the migration: once a dump takes minutes, upgrade between dumps.
Create a private bucket for the dumps alone, since they hold every message, and a key that can read,
write and delete in it. Then add to `.env`:

```sh
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BACKUP_BUCKET=agentes-backups
```

Add `backup` to `COMPOSE_PROFILES` too, comma-separated: `COMPOSE_PROFILES=tailscale,backup` on
Tailscale (the setup's default), `https,backup` with Caddy, or `backup` alone. Running the setup
again keeps it. Run `docker compose up -d`: the first dump runs right away, unless the bucket has one
from the last 26 hours (the interval plus 2), and `docker compose logs backup` shows each one. These
`S3_*` values also serve file storage when `S3_BUCKET` is set, so the key then needs both buckets.
Outside R2, set `S3_PROVIDER` to rclone's name for the store (`AWS`, `Minio`, `Other` and so on) and
`S3_REGION` if it needs one. The service runs `ghcr.io/agentes-chat/backup`, published with each
release under the app's tags; `AGENTES_BACKUP_IMAGE` holds a version the way `AGENTES_IMAGE` does.

```sh
docker compose run --rm backup now     # a dump right away, before a big upgrade for example
docker compose run --rm backup list    # the dumps in the bucket
```

The dumps cover the database, files kept in Postgres included. Files in an S3 bucket stay there;
files in the `files` volume need the commands below.

**By hand**, on the server:

```sh
(
  umask 077
  docker compose exec -T postgres pg_dump -U agentes -Fc agentes > agentes-$(date +%F).dump
  docker compose run --rm --no-deps -T --entrypoint tar agentes czf - -C /data/files . > files-$(date +%F).tar.gz
)
```

The `umask` makes both files readable by you alone: they hold every message and file. The dump is
consistent while the app runs. Schedule both and copy the results off the server (in a crontab,
start the line with `cd /path/to/compose/dir && umask 077;` and write `\%F`).

**Restore** with the app stopped, so nothing writes in between, into an emptied database: tables that
a newer version added aren't in an older dump and would keep it from replacing the rest. A dump in
the bucket comes down to the server first, under a name from `list`:

```sh
(umask 077 && docker compose run --rm -T backup fetch agentes-20261020-030000.dump > agentes-2026-10-20.dump)
```

Then:

```sh
docker compose stop agentes
docker compose exec -T postgres dropdb -U agentes --force agentes
docker compose exec -T postgres createdb -U agentes agentes
docker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes-2026-10-20.dump
docker compose run --rm --no-deps -T --entrypoint tar agentes xzf - -C /data/files < files-2026-10-20.tar.gz
```

Only when both restores finish without an error, start the app:

```sh
docker compose start agentes
```

On a new server: the compose file and the old `.env`, `docker compose up -d --wait postgres`, the
restore commands above (with the old `.env`, `list` and `fetch` reach the bucket from there too), then
`docker compose up -d`. Restore into the version that took the dump or a newer one.

On Tailscale, the new server needs a key of its own: its login stays in the old server's
`tailscale-state` volume. On https://console.tailscale.com/admin/machines, remove the old server
(its **⋯** menu, **Remove**) so the new one gets the same name, then run the setup in the restored
directory instead of the last `docker compose up -d`. It asks for an auth key (or takes
`--tailscale-key`) and writes `PUBLIC_URL` again if the name changed.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

**"Invalid origin" when signing in, or `bad_origin` ("Cross-origin request refused") when saving.**
`PUBLIC_URL` differs from the address in the browser: scheme, host and port must all match. Fix it in
`.env` and run `docker compose up -d`. In production the log warns at every start while `PUBLIC_URL`
is still `http://localhost:3000`. On Tailscale, open the `ts.net` address the setup printed, not the
server's short name or its `100.x` address.

**The address doesn't open on a device in the tailnet.** Tailscale must be connected on that device,
signed in to the same tailnet. On the server, `docker compose ps` shows `tailscale` as `healthy`, and
`docker compose exec -T tailscale tailscale serve status` lists the address. If your tailnet policy
file limits who reaches what, let that person reach the server on port 443. The setup's checks and
their fixes are in For AI agents, above.

**Messages don't appear live, and the browser's WebSocket closes with code 1006.** A proxy in front
doesn't pass the upgrade. It needs the `Upgrade` and `Connection` headers for `/api/ws` (and
`/api/machines/connect` for computers; `/api/desktop`, `/api/terminal` and `/api/machines/stream`
for the agents' desktops and terminals), HTTP/1.1 to the app, and a read timeout of at least 60 s
(see the nginx section). A 403 "Cross-origin WebSocket refused" is the `PUBLIC_URL` mismatch above.

**An agent's desktop or terminal "isn't available on this computer".** Run `agentes-runner status` on
that computer: its `Desktops` and `Terminal` lines say what is missing (the runner on Bun 1.3.5 or
newer, the packages, or the switch), as in Agent computers above.

**An agent says "Google Chrome isn't installed on this computer".** Install Google Chrome there
(google.com/chrome), or Chromium on Linux on ARM (as the message says); on a computer installed with
`--system`, run that same install command again.
The next request works, no restart needed. "Google Chrome didn't start" names the system libraries it
lacks when that is why, and the runner's log keeps what Chrome printed. Each of these is also sent to
your error reports when `SENTRY_DSN` is set.

**`extension "vector" is not available` at the first start.** The database is a Postgres without
pgvector. Use the compose file's `pgvector/pgvector` image; on a database of your own, install
pgvector for its Postgres version (15 or newer).

**`refusing to migrate: the database's migrations don't match this build`, then the app exits.** The
`reason` in that log line says which case. "It was migrated by a newer version": the image is older
than the database, after a rollback; run that version or a newer one, or restore the dump taken
before the upgrade. "Migration … was changed after it was applied": the image was built from edited
migrations, and committed migrations never change.

**`Invalid configuration`, then restarts.** A required value is missing or malformed in `.env`; the
log lists each one.

**Emails don't arrive.** At every start the log line `transactional email` names the sender in use.
`log` means none is configured, and each email is only written to the log. With `smtp` or
`millionsend`, check that the domain of `EMAIL_FROM` is verified with your provider.

**"This address points to an internal network".** Connectors, databases, mailboxes and an
organization's own bucket must be reachable at public addresses: private, loopback and link-local
addresses are refused, so nobody can turn the server against its own network. Reach internal services
through a connected computer instead.

</details>
