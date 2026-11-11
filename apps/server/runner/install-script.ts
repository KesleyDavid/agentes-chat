import {
  AGENT_BROWSER_SHA256,
  AGENT_BROWSER_VERSION,
  agentBrowserUrl,
  CHROME_NEEDED,
  CHROMIUM_LINUX,
  CHROMIUM_NEEDED,
} from "@agenteschat/adapters/machine-protocol";
import { TERM_SH } from "@agenteschat/setup/src/term-sh";
import { DEFAULT_AGENT_UID_RANGE, SYSTEM_RUNNER_HOME } from "./config";
import { WINDOWS_TASK } from "./service";

/** Quotes a value for POSIX sh (single quotes; a `'` becomes `'\''`). */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The Bun a system-mode runner runs on, and any runner whose computer has no
 * Bun with `Bun.Terminal` (1.3.5 or newer), which screens and terminals
 * need: the one the repo builds and tests with (`packageManager` in
 * package.json, kept equal by a test).
 */
export const RUNNER_BUN_VERSION = "1.4.4";
/** SHA-256 (hex) of each `bun-<target>.zip` of `RUNNER_BUN_VERSION`, checked before it is installed. */
export const RUNNER_BUN_SHA256 = {
  "linux-x64": "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c",
  "linux-x64-baseline": "e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76",
  "linux-aarch64": "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
  "darwin-x64-baseline": "d4a155adfbfd09155eb3ba05c9e3a544f39297d7a68616d3c7759f67ab5c47dc",
  "darwin-aarch64": "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
} as const;

/**
 * Debian/Ubuntu packages for the agents' screens (`--system --desktop`),
 * installed without recommends: those would add a screen locker nobody can
 * unlock, more daemons, and a set of folders in every agent's home.
 */
export const DESKTOP_APT_PACKAGES = [
  "tigervnc-standalone-server",
  "xauth",
  "dbus-x11",
  "xfce4-session",
  "xfwm4",
  "xfce4-panel",
  "xfdesktop4",
  "xfce4-settings",
  "thunar",
  "xfce4-terminal",
  "adwaita-icon-theme",
  "elementary-xfce-icon-theme",
  "fonts-noto-core",
] as const;

/**
 * The desktops' theme (ADR 0058 §15), installed after `DESKTOP_APT_PACKAGES` where apt has it (Debian 12 and
 * 13, Ubuntu 24.04 with universe; not Ubuntu 22.04): without it the desktops keep GTK's and xfwm4's own. Orchis
 * draws its window buttons from SVG files, so gdk-pixbuf's SVG loader comes with it.
 */
export const DESKTOP_LOOK_APT_PACKAGES = ["orchis-gtk-theme", "librsvg2-common"] as const;

/**
 * Chinese, Japanese and Korean for what the agents' desktops show (their browser among them): without it that
 * text is empty boxes. Installed after the theme where apt has it, on its own since Ubuntu 22.04 has no Orchis
 * (about 91 MB on Debian 13 and Ubuntu 24.04).
 */
export const DESKTOP_CJK_APT_PACKAGES = ["fonts-noto-cjk"] as const;

/**
 * The desktops' dock (ADR 0058 §15), each app's windows on its own launcher, installed after the fonts in an apt
 * call of its own, where apt has it: Debian 13 (0.4.3, about 0.5 MB with nothing else to bring) and Ubuntu 25.04
 * or newer (universe); not Debian 12 or Ubuntu 22.04 and 24.04, whose desktops keep the panel's own launchers and
 * window buttons.
 */
export const DESKTOP_DOCK_APT_PACKAGES = ["xfce4-docklike-plugin"] as const;

/**
 * What system mode's isolation runs (`--system`): `nft` for the loopback guard, which won't start without it, and
 * `ss` for the bind check.
 */
export const ISOLATION_APT_PACKAGES = ["nftables", "iproute2"] as const;

/** System mode: the runner and its Bun (root's, readable by the agents' users), and the command on the PATH. */
export const SYSTEM_RUNNER_DIR = "/opt/agentes-runner";
export const SYSTEM_LAUNCHER = "/usr/local/bin/agentes-runner";
/** System mode on x86_64 and arm64: `agent-browser-<version>`, root's, for every agent's user to run. */
export const SYSTEM_BROWSER_DIR = `${SYSTEM_RUNNER_DIR}/browser`;

/** Where Google Chrome stable's Linux package (`google-chrome-stable`) installs it. */
export const GOOGLE_CHROME_LINUX = "/opt/google/chrome/chrome";

/**
 * Google's apt repository for Chrome, set up as the `google-chrome-stable` package's own postinst sets it up
 * (Chrome 156): the same files with the same contents, so the package's setup and its daily check rewrite them as
 * they are, and apt never sees the repository twice with two keyrings (an error).
 */
export const GOOGLE_APT = {
  key: "https://dl.google.com/linux/linux_signing_key.pub",
  /** Google's Linux package signing key (`gpg --show-keys`, checked 2026-11-03): any other key is refused. */
  fingerprint: "EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796",
  keyring: "/usr/share/keyrings/google-chrome.gpg",
  sources: "/etc/apt/sources.list.d/google-chrome.sources",
  uri: "https://dl.google.com/linux/chrome-stable/deb/",
  /**
   * A systemd timer (`.timer`, `.service`) upgrading Chrome alone every 6 hours, written only when the installer
   * installed Chrome: a Debian without unattended upgrades would otherwise never update it.
   */
  updates: "/etc/systemd/system/agentes-chrome-update",
  /** `--desktop`: hides Chrome's own menu entry, so the agents' menus don't offer a second Chrome on the default profile. */
  desktopEntry: "/usr/local/share/applications/google-chrome.desktop",
} as const;

/**
 * `--desktop` on Linux on ARM, where the agents' browser is Debian's Chromium (ADR 0153): hides its own menu entry,
 * as `GOOGLE_APT.desktopEntry` hides Chrome's.
 */
export const CHROMIUM_DESKTOP_ENTRY = "/usr/local/share/applications/chromium.desktop";

/**
 * `--requirements` (the self-host setup's step, ADR 0153 §6): what it can install, as root, alone. The coding CLIs go
 * to /usr/local/bin, on every agent's PATH in either mode. On a Mac only the coding CLIs, for the person running it,
 * in ~/.local/bin (the runner's PATH there has it, login-path.ts): no root.
 */
export const REQUIREMENTS = ["browser", "desktop", "claude", "codex"] as const;
export type Requirement = (typeof REQUIREMENTS)[number];
/** Anthropic's installer for Claude Code (it checks what it downloads against its own manifest). */
export const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";
export const CLAUDE_EXE = "/usr/local/bin/claude";
/** OpenAI's Codex CLI: its latest release's static Linux build, `codex-<arch>-unknown-linux-musl.tar.gz`. */
export const CODEX_RELEASES = "https://github.com/openai/codex/releases/latest/download";
export const CODEX_EXE = "/usr/local/bin/codex";

/**
 * The installer served at `GET /api/machines/install.sh`:
 *
 *   curl -fsSL <publicUrl>/api/machines/install.sh | sh -s -- [--dir DIR] [--no-exec] [--name NAME] [--no-service]
 *
 * Picks the runtime, downloads the runner bundle from
 * `<publicUrl>/runner/agentes-runner.mjs`, writes a launcher in
 * `~/.agentes-runner/bin`, connects this computer with a device code
 * (`agentes-runner pair` prints a code and a link and waits for someone to
 * confirm it on the site, ADR 0036 §5) and installs the service. A home
 * that is already connected keeps its connection (running it again updates
 * the runner).
 *
 * The runtime is a Bun with `Bun.Terminal`, which the agents' screens and
 * terminals need (ADR 0058): the computer's own, else `RUNNER_BUN_VERSION`
 * fetched into `~/.agentes-runner/runtime` and checked against
 * `RUNNER_BUN_SHA256`. Only when that can't be had (another platform, no
 * unzip, no download) Node.js 22+ or an older Bun, and it says what that
 * runner lacks.
 *
 * `--system` (Linux, root) installs the runner for the whole computer, each
 * agent as its own OS user: `ISOLATION_APT_PACKAGES` (without apt it names
 * them), the pinned Bun and the bundle in
 * `SYSTEM_RUNNER_DIR`, on x86_64 and arm64 the pinned `agent-browser` in
 * `SYSTEM_BROWSER_DIR` (checked against its SHA-256, so no agent downloads it
 * at its browser's first use; one that can't be fetched is left to that first
 * use, warned about), Google Chrome stable from Google's apt repository
 * (`GOOGLE_APT`, its key checked against its fingerprint) when the computer
 * has none, or on arm64, where Google makes no Chrome, Debian's `chromium`
 * (ADR 0153), upgraded every 6 hours by a timer of its own, the launcher at
 * `SYSTEM_LAUNCHER`, the home
 * `SYSTEM_RUNNER_HOME` (0700) and the root unit (`service install --system`).
 * With `--no-pair` it doesn't connect, with `--no-start` it starts nothing,
 * `--desktop` adds `DESKTOP_APT_PACKAGES` (then `DESKTOP_LOOK_APT_PACKAGES`,
 * `DESKTOP_CJK_APT_PACKAGES` and `DESKTOP_DOCK_APT_PACKAGES`, each in an apt call
 * of its own, where apt has them), and `--agent-uid-range` sets the
 * agents' uids (default `DEFAULT_AGENT_UID_RANGE`). Everything runs from
 * `main`, so a download cut short runs nothing.
 *
 * `--runner-sha256 HEX` (any mode) installs the bundle only when it has that
 * SHA-256: whoever runs the installer for a fleet pins the runner it vouches
 * for, so a root runner never runs whatever the server happens to serve.
 *
 * `--server URL` is where this computer reaches the server, when that isn't
 * the address the script names (the server's own machine, say, reaching it at
 * `http://127.0.0.1:3000` while people use a tailnet name). With `--system`,
 * or alone on a Mac (agents working as the person there), `--host-token-file
 * PATH` makes this the server's own computer: the service runs `agentes-runner
 * host` with the server's `HOST_COMPUTER_TOKEN` from that file instead of
 * pairing, with `--no-exec` passed on. A computer already connected (its
 * home has a token) is refused: its service would be replaced.
 *
 * `--enroll-file FILE` (any mode) connects with a code issued for this
 * computer instead (`agentes-runner pair --enroll-file`, ADR 0056 §10),
 * connected before or not.
 *
 * `--host-token-file` alone on Linux as a user other than root is the
 * self-host setup's simple mode (ADR 0153 §5): this server's computer runs as
 * that user, its agents sharing it. `--requirements LIST` (alone, as root on
 * Linux) installs only what the agents need of `REQUIREMENTS` and stops: the
 * browser (`get_chrome`; on Linux on ARM Debian's Chromium, else Ubuntu's
 * snap), the packages for their screens, and Claude Code and Codex in
 * /usr/local/bin.
 *
 * `--link CODE` (any mode, baked in by `/i/<code>`, so `curl -fsSL <publicUrl>/i/<code> | sh` takes no arguments)
 * connects with a connect link's code instead (`agentes-runner pair --link`): the link's maker lets this computer
 * join. Run as root on Linux where systemd keeps agents apart (`+BPF_FRAMEWORK`), it installs the runner for the
 * whole computer as `--system` does; anywhere else, for the user who runs it.
 */
export function installScript(publicUrl: string, options: { link?: string } = {}): string {
  const server = shQuote(publicUrl.trim().replace(/\/+$/, ""));
  const uids = DEFAULT_AGENT_UID_RANGE.join("-");
  const shaCases = Object.entries(RUNNER_BUN_SHA256)
    .map(([target, sha]) => `    ${target}) BUN_SHA256=${shQuote(sha)} ;;`)
    .join("\n");
  return `#!/bin/sh
# agentes.chat runner installer: connects this computer to your organization.
# Usage: curl -fsSL <server>/api/machines/install.sh | sh -s -- [--dir DIR] [--no-exec] [--name NAME] [--no-service] [--enroll-file FILE | --link CODE]
# With a link made under Settings › Devices (the link's maker lets this computer join): curl -fsSL <server>/i/<code> | sh
# On a Linux server, as root, the runner for the whole computer with each agent as its own user:
#        curl -fsSL <server>/api/machines/install.sh | sh -s -- --system [--desktop] [--no-pair] [--no-start] [--agent-uid-range FIRST-LAST] [--enroll-file FILE]
set -eu

SERVER=${server}
LINK=${shQuote(options.link ?? "")}
BUN_VERSION=${shQuote(RUNNER_BUN_VERSION)}
ISOLATION_PACKAGES=${shQuote(ISOLATION_APT_PACKAGES.join(" "))}
DESKTOP_PACKAGES=${shQuote(DESKTOP_APT_PACKAGES.join(" "))}
LOOK_PACKAGES=${shQuote(DESKTOP_LOOK_APT_PACKAGES.join(" "))}
CJK_PACKAGES=${shQuote(DESKTOP_CJK_APT_PACKAGES.join(" "))}
DOCK_PACKAGES=${shQuote(DESKTOP_DOCK_APT_PACKAGES.join(" "))}
AB_VERSION=${shQuote(AGENT_BROWSER_VERSION)}
AB_SHA256=${shQuote(AGENT_BROWSER_SHA256["linux-x64"])}
AB_URL=${shQuote(agentBrowserUrl("linux-x64"))}
AB_SHA256_ARM=${shQuote(AGENT_BROWSER_SHA256["linux-arm64"])}
AB_URL_ARM=${shQuote(agentBrowserUrl("linux-arm64"))}
CHROME_EXE=${shQuote(GOOGLE_CHROME_LINUX)}
CHROMIUM_EXE=${shQuote(CHROMIUM_LINUX[0])}
CHROMIUM_SNAP=${shQuote(CHROMIUM_LINUX[1])}
CLAUDE_INSTALL_URL=${shQuote(CLAUDE_INSTALL_URL)}
CLAUDE_EXE=${shQuote(CLAUDE_EXE)}
CODEX_RELEASES=${shQuote(CODEX_RELEASES)}
CODEX_EXE=${shQuote(CODEX_EXE)}
CHROMIUM_DESKTOP=${shQuote(CHROMIUM_DESKTOP_ENTRY)}
CHROMIUM_NEEDED=${shQuote(CHROMIUM_NEEDED)}
CHROME_KEY_URL=${shQuote(GOOGLE_APT.key)}
CHROME_KEY_FPR=${shQuote(GOOGLE_APT.fingerprint)}
CHROME_KEYRING=${shQuote(GOOGLE_APT.keyring)}
CHROME_SOURCES=${shQuote(GOOGLE_APT.sources)}
CHROME_URI=${shQuote(GOOGLE_APT.uri)}
CHROME_UPDATES=${shQuote(GOOGLE_APT.updates)}
CHROME_DESKTOP=${shQuote(GOOGLE_APT.desktopEntry)}
CHROME_NEEDED=${shQuote(CHROME_NEEDED)}

DIR=""
NAME=""
NO_EXEC=0
NO_SERVICE=0
SYSTEM=0
DESKTOP=0
NO_PAIR=0
NO_START=0
UID_RANGE=""
RUNNER_SHA256=""
HOST_TOKEN_FILE=""
REQUIREMENTS=""
SERVER_FLAG=""
ENROLL_FILE=""

${TERM_SH}
die() {
  t_fail "$*"
  exit 1
}
need_value() { [ "$2" -ge 2 ] || die "$1 needs a value"; }
# The end, with how long it took as term.ts's elapsed() writes it: "Done in 52s", "Done in 1m 04s".
done_in() {
  D_S=$(($(date +%s) - T_START))
  if [ "$D_S" -ge 60 ]; then D_S="$((D_S / 60))m $((D_S % 60 / 10))$((D_S % 10))s"; else D_S="\${D_S}s"; fi
  t_end "Done in $D_S"
}
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\\\\\''/g")"; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d ' ' -f 1
}

usage() {
  printf '%s\\n' "Usage: sh install.sh [--dir DIR] [--no-exec] [--name NAME] [--no-service] [--enroll-file FILE]" \\
    "       sh install.sh --system [--desktop] [--no-pair] [--no-start] [--agent-uid-range FIRST-LAST] [--enroll-file FILE]" \\
    "" \\
    "  --system           Linux, as root: the runner for the whole computer, each agent as its own user" \\
    "  --desktop          with --system: also the packages for the agents' screens" \\
    "  --no-pair          with --system: don't connect it to the server now" \\
    "  --no-start         with --system: install or update without starting or restarting the service" \\
    "  --agent-uid-range  with --system: the uids agent users get (default ${uids})" \\
    "  --runner-sha256    install the runner only if its download has this SHA-256 (64 hex digits)" \\
    "  --server           where this computer reaches the server, if not at $SERVER" \\
    "  --host-token-file  with --system (alone on a Mac, or on Linux as another user): this server's own computer, with HOST_COMPUTER_TOKEN from this file" \\
    "  --requirements     alone, as root on Linux: install only these for the agents (${REQUIREMENTS.join(",")}), then stop" \\
    "  --enroll-file      connect with the code issued for this computer in FILE (removed once read), connected before or not" \\
    "  --link             connect with the code of a link made under Settings › Devices (its maker lets this computer join)"
}

download() {
  # GitHub's release downloads answer a 504 now and then: tried again before giving up.
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 --retry-delay 2 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --waitretry=2 -O "$2" "$1"
  else
    echo "curl or wget is needed to download the runner" >&2
    return 1
  fi
}

# The frame from here on, its runner commands drawing in it (AGENTES_FRAME=1): what the refusals above leave out.
start_frame() {
  t_intro "connect this computer"
  AGENTES_FRAME=1
  export AGENTES_FRAME
}

# Downloads the runner to $BUNDLE and writes $LAUNCHER (home $RUNNER_HOME, runtime $RUNTIME).
get_runner() {
  t_run "Downloading the runner from $SERVER" download "$SERVER/runner/agentes-runner.mjs" "$BUNDLE.download" || {
    t_tail "$T_LOG"
    die "download failed"
  }
  if [ -n "$RUNNER_SHA256" ] && [ "$(sha256 "$BUNDLE.download")" != "$RUNNER_SHA256" ]; then
    rm -f "$BUNDLE.download"
    die "the runner download didn't match --runner-sha256, so it was not installed"
  fi
  chmod 644 "$BUNDLE.download"
  mv -f "$BUNDLE.download" "$BUNDLE"
  {
    printf '#!/bin/sh\\n'
    printf 'AGENTES_RUNNER_HOME=%s\\n' "$(quote "$RUNNER_HOME")"
    printf 'export AGENTES_RUNNER_HOME\\n'
    printf 'exec %s %s "$@"\\n' "$(quote "$RUNTIME")" "$(quote "$BUNDLE")"
  } > "$LAUNCHER.new"
  chmod 755 "$LAUNCHER.new"
  mv -f "$LAUNCHER.new" "$LAUNCHER"
  t_step "The runner, from $SERVER"
}

# Connects this computer, unless it already is (and no code or link was issued for it) or --no-pair.
connect() {
  if [ -z "$ENROLL_FILE" ] && [ -z "$LINK" ] && [ -f "$RUNNER_HOME/config.json" ] && grep -q '"token"' "$RUNNER_HOME/config.json" 2>/dev/null; then
    t_step "This computer is already connected (runner updated). To connect it again:"
    t_cmd "$LAUNCHER pair --server $SERVER"
  elif [ "$NO_PAIR" -eq 0 ]; then
    # Prints a code and a link, and waits until someone confirms it on the site (an issued code needs nobody).
    set -- pair --server "$SERVER"
    if [ -n "$ENROLL_FILE" ]; then set -- "$@" --enroll-file "$ENROLL_FILE"; fi
    if [ -n "$LINK" ]; then set -- "$@" --link "$LINK"; fi
    if [ -n "$DIR" ]; then set -- "$@" --dir "$DIR"; fi
    if [ -n "$NAME" ]; then set -- "$@" --name "$NAME"; fi
    if [ "$NO_EXEC" -eq 1 ]; then set -- "$@" --no-exec; fi
    t_gap
    # Ctrl-C at the code reaches pair too, which says Canceled and exits 130. Caught here, so the installer waits
    # for those last lines (dash would stop at once, under them), then ends as canceled, not failed.
    trap : INT
    PAIRED=0
    "$LAUNCHER" "$@" || PAIRED=$?
    trap - INT
    if [ "$PAIRED" -eq 130 ]; then exit 130; fi
    [ "$PAIRED" -eq 0 ] || die "connecting this computer failed"
  fi
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive
  export DEBIAN_FRONTEND
  # A fresh server may be updating itself: wait for its lock instead of failing.
  apt-get -qq -o DPkg::Lock::Timeout=600 update || true
  apt-get -qq -o DPkg::Lock::Timeout=600 install -y --no-install-recommends "$@"
}

# $PACKAGES, then with --desktop the screens' theme, CJK fonts and dock, each in an apt call of its own:
# apt lacks some of them on some releases, and those are named in $NOT_INSTALLED.
apt_packages() {
  NOT_INSTALLED=''
  # shellcheck disable=SC2086
  apt_install $PACKAGES || return
  if [ "$DESKTOP" -eq 1 ]; then
    # shellcheck disable=SC2086
    apt-get -qq -o DPkg::Lock::Timeout=600 install -y --no-install-recommends $LOOK_PACKAGES ||
      NOT_INSTALLED="$NOT_INSTALLED look"
    # shellcheck disable=SC2086
    apt-get -qq -o DPkg::Lock::Timeout=600 install -y --no-install-recommends $CJK_PACKAGES ||
      NOT_INSTALLED="$NOT_INSTALLED cjk"
    # shellcheck disable=SC2086
    apt-get -qq -o DPkg::Lock::Timeout=600 install -y --no-install-recommends $DOCK_PACKAGES ||
      NOT_INSTALLED="$NOT_INSTALLED dock"
  fi
}

# What keeps the agents apart, and with --desktop the packages for their screens.
system_packages() {
  PACKAGES="$ISOLATION_PACKAGES" WHAT="the agents' isolation"
  if [ "$DESKTOP" -eq 1 ]; then
    PACKAGES="$PACKAGES $DESKTOP_PACKAGES" WHAT="the agents' isolation and screens"
  fi
  if command -v apt-get >/dev/null 2>&1; then
    t_run "Installing the packages for $WHAT" apt_packages || {
      t_tail "$T_LOG"
      die "installing the packages for $WHAT failed"
    }
    t_step "The packages for $WHAT"
    case $NOT_INSTALLED in *look*) t_warn "The agents' screens keep the stock theme: apt has no $LOOK_PACKAGES here" ;; esac
    case $NOT_INSTALLED in
      *cjk*) t_warn "The agents' screens show Chinese, Japanese and Korean text as boxes: apt has no $CJK_PACKAGES here" ;;
    esac
    case $NOT_INSTALLED in *dock*) t_warn "The agents' screens keep the panel's own dock: apt has no $DOCK_PACKAGES here" ;; esac
  else
    t_warn "For $WHAT, install these packages (Debian names) with this computer's package manager: $PACKAGES"
  fi
}

unpack() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$1" -d "$2"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$1" "$2"
  elif [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then
    apt_install unzip && unzip -q -o "$1" -d "$2"
  else
    return 1
  fi
}

# A Bun with Bun.Terminal (1.3.5 or newer): the agents' screens and the terminal need it.
has_terminal() { [ -x "$1" ] && "$1" -e 'process.exit("Terminal" in Bun ? 0 : 1)' >/dev/null 2>&1; }

# The pinned Bun at $1, kept when it is there at that version, checked against its SHA-256 before it is
# installed. Fails with WHY set where there's no pinned build or it can't be fetched or run here.
fetch_bun() {
  WHY=""
  if [ "$("$1" --version 2>/dev/null || true)" = "$BUN_VERSION" ]; then return 0; fi
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64|Linux-amd64)
      BUN_TARGET=linux-x64
      # Bun's default x64 build needs AVX2.
      grep -qw avx2 /proc/cpuinfo 2>/dev/null || BUN_TARGET=linux-x64-baseline ;;
    Linux-aarch64|Linux-arm64) BUN_TARGET=linux-aarch64 ;;
    Darwin-x86_64) BUN_TARGET=darwin-x64-baseline ;;
    Darwin-arm64) BUN_TARGET=darwin-aarch64 ;;
    *) WHY="there is no build of it for $(uname -s) on $(uname -m)"; return 1 ;;
  esac
  case "$BUN_TARGET" in
${shaCases}
  esac
  WORK=$(mktemp -d) || { WHY="no temporary folder for it"; return 1; }
  if ! t_run "Downloading Bun $BUN_VERSION" download "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$BUN_TARGET.zip" "$WORK/bun.zip"; then
    WHY="the download failed"
  elif [ "$(sha256 "$WORK/bun.zip")" != "$BUN_SHA256" ]; then
    WHY="the download didn't match its checksum, so it was not installed"
  elif ! unpack "$WORK/bun.zip" "$WORK"; then
    WHY="unpacking it needs unzip or python3"
  elif cp "$WORK/bun-$BUN_TARGET/bun" "$1.new" && chmod 755 "$1.new" &&
    [ "$("$1.new" --version 2>/dev/null || true)" = "$BUN_VERSION" ]; then
    mv -f "$1.new" "$1"
  else
    WHY="it doesn't run on this computer"
  fi
  rm -rf "$WORK" "$1.new"
  [ -z "$WHY" ]
}

# The pinned Bun in $SYSTEM_DIR/bin; never one from the PATH, which root would then run.
get_bun() {
  RUNTIME="$SYSTEM_DIR/bin/bun"
  fetch_bun "$RUNTIME" || die "no Bun $BUN_VERSION for the runner: $WHY"
  t_step "Bun $BUN_VERSION (SHA-256 checked)"
}

# In $1, every $2-<version> but $3 and the one installed last before it (a runner not restarted yet may still run
# that one), and whatever an interrupted install left (.$2-*).
prune() {
  KEEP=$(ls -1dt "$1/$2"-* 2>/dev/null | grep -vxF "$3" | head -n 1)
  for OLD in "$1/$2"-* "$1/.$2"-*; do
    case "$OLD" in "$3" | "$KEEP" | "$1/$2-*" | "$1/.$2-*") ;; *) rm -rf "$OLD" ;; esac
  done
}

# What of the agents' browser couldn't be installed here, each agent's runner installs at its browser's first use,
# so the install goes on; only a download that isn't the pinned one stops it.
browser_later() {
  t_tail "$T_LOG"
  t_warn "$1: each agent installs what's missing at its browser's first use"
}

# The agents' agent-browser in $BROWSER_DIR, for every agent's user to run and root alone to write, checked against
# its SHA-256 before it is installed, so no agent downloads it at its browser's first use. One already there at that
# checksum is kept. On x86_64 and arm64, the builds pinned here.
get_browser() {
  case "$(uname -m)" in
    x86_64 | amd64) ;;
    aarch64 | arm64) AB_SHA256=$AB_SHA256_ARM AB_URL=$AB_URL_ARM ;;
    *) return 0 ;;
  esac
  mkdir -p "$BROWSER_DIR"
  chown 0:0 "$BROWSER_DIR"
  chmod 755 "$BROWSER_DIR"
  AB="$BROWSER_DIR/agent-browser-$AB_VERSION"
  if [ ! -f "$AB" ] || [ "$(sha256 "$AB")" != "$AB_SHA256" ]; then
    TMP="$BROWSER_DIR/.agent-browser-$AB_VERSION.download"
    t_run "Downloading agent-browser $AB_VERSION" download "$AB_URL" "$TMP" || {
      rm -f "$TMP"
      browser_later "Downloading agent-browser $AB_VERSION failed"
      return 0
    }
    if [ "$(sha256 "$TMP")" != "$AB_SHA256" ]; then
      rm -f "$TMP"
      die "the agent-browser download didn't match its checksum, so it was not installed"
    fi
    chmod 755 "$TMP"
    mv -f "$TMP" "$AB"
  fi
  prune "$BROWSER_DIR" agent-browser "$AB"
  t_step "agent-browser $AB_VERSION (SHA-256 checked)"
}

# Google's key for its apt repository into $CHROME_KEYRING, refused unless its fingerprint is the one pinned here
# (BAD_KEY=1): apt then checks every package from that repository against it.
chrome_key() {
  command -v gpg >/dev/null 2>&1 || apt_install gpg || return 1
  KEY_DIR=$(mktemp -d) || return 1
  download "$CHROME_KEY_URL" "$KEY_DIR/key.asc" || { rm -rf "$KEY_DIR"; return 1; }
  FPR=$(GNUPGHOME="$KEY_DIR" gpg --batch --show-keys --with-colons "$KEY_DIR/key.asc" 2>/dev/null |
    sed -n 's/^fpr:*\\([0-9A-F]*\\):.*/\\1/p' | head -n 1)
  if [ "$FPR" != "$CHROME_KEY_FPR" ]; then
    rm -rf "$KEY_DIR"
    BAD_KEY=1
    return 1
  fi
  mkdir -p "$(dirname "$CHROME_KEYRING")"
  KEY_RC=0
  GNUPGHOME="$KEY_DIR" gpg --batch --yes --dearmor -o "$CHROME_KEYRING.new" "$KEY_DIR/key.asc" &&
    chmod 644 "$CHROME_KEYRING.new" && mv -f "$CHROME_KEYRING.new" "$CHROME_KEYRING" || KEY_RC=1
  rm -rf "$KEY_DIR"
  return "$KEY_RC"
}

# Google Chrome stable from Google's apt repository, set up as its own package sets it up, and upgraded every 6 hours by
# a timer of its own, whether or not this computer updates itself. Its sandbox helper never runs as root for the agents'
# users: Chrome sandboxes with user namespaces (which --system's Debian has), and dpkg keeps that mode across upgrades.
# The package makes itself the default web browser: the computer's own choice is put back.
install_chrome() {
  chrome_key || return 1
  SANDBOX="$(dirname "$CHROME_EXE")/chrome-sandbox"
  dpkg-statoverride --list "$SANDBOX" >/dev/null 2>&1 || dpkg-statoverride --add root root 0755 "$SANDBOX" || return 1
  ARCH=$(dpkg --print-architecture) || return 1
  mkdir -p "$(dirname "$CHROME_SOURCES")"
  printf '%s\\n' '### THIS FILE IS AUTOMATICALLY CONFIGURED ###' '# Changes to this file will not be preserved.' \\
    '# This file will not be recreated if removed.' 'X-Repolib-Name: Google Chrome' 'Types: deb' "URIs: $CHROME_URI" \\
    'Suites: stable' 'Components: main' "Architectures: $ARCH" "Signed-By: $CHROME_KEYRING" > "$CHROME_SOURCES"
  chmod 644 "$CHROME_SOURCES"
  WWW=$(update-alternatives --query x-www-browser 2>/dev/null | sed -n 's/^Value: //p')
  GNOME_WWW=$(update-alternatives --query gnome-www-browser 2>/dev/null | sed -n 's/^Value: //p')
  apt_install google-chrome-stable || return 1
  if [ -n "$WWW" ]; then update-alternatives --set x-www-browser "$WWW" || true; fi
  if [ -n "$GNOME_WWW" ]; then update-alternatives --set gnome-www-browser "$GNOME_WWW" || true; fi
  update_timer google-chrome-stable "Google Chrome"
}

# A systemd timer of its own that upgrades the package $1 (named $2) alone every 6 hours, whether or not this computer
# updates itself.
update_timer() {
  mkdir -p "$(dirname "$CHROME_UPDATES")"
  printf '%s\\n' '[Unit]' "Description=$2's updates for the agents' browsers" 'After=network-online.target' '' \\
    '[Service]' 'Type=oneshot' 'Environment=DEBIAN_FRONTEND=noninteractive' \\
    "ExecStart=/bin/sh -c 'apt-get -qq -o DPkg::Lock::Timeout=600 update; apt-get -qq -o DPkg::Lock::Timeout=600 install -y --only-upgrade --no-install-recommends $1'" \\
    > "$CHROME_UPDATES.service"
  printf '%s\\n' '[Unit]' "Description=$2's updates for the agents' browsers" '' '[Timer]' \\
    'OnCalendar=00/6:00' 'RandomizedDelaySec=1h' 'Persistent=true' '' '[Install]' 'WantedBy=timers.target' \\
    > "$CHROME_UPDATES.timer"
  chmod 644 "$CHROME_UPDATES.service" "$CHROME_UPDATES.timer"
  TIMER="\${CHROME_UPDATES##*/}.timer"
  systemctl daemon-reload || true
  systemctl enable --now "$TIMER" 2>/dev/null || systemctl enable "$TIMER" || true
}

# Linux on ARM, where Google makes no Chrome: the agents' browser is Chromium (ADR 0153).
on_arm_linux() {
  [ "$(uname -s)" = Linux ] || return 1
  case "$(uname -m)" in aarch64 | arm64) return 0 ;; esac
  return 1
}

# Debian's chromium (the arm64 build Debian keeps patched), upgraded by the same timer as Chrome. The package may make
# itself the default web browser: the computer's own choice is put back. Ubuntu has no chromium package of its own
# (apt's only installs the snap): there the snap, which refreshes itself (CHROMIUM_FROM=snap).
install_chromium() {
  WWW=$(update-alternatives --query x-www-browser 2>/dev/null | sed -n 's/^Value: //p')
  GNOME_WWW=$(update-alternatives --query gnome-www-browser 2>/dev/null | sed -n 's/^Value: //p')
  CHROMIUM_FROM=apt
  if ! apt_install chromium; then
    command -v snap >/dev/null 2>&1 || return 1
    CHROMIUM_FROM=snap
    snap install chromium || return 1
    return 0
  fi
  if [ -n "$WWW" ]; then update-alternatives --set x-www-browser "$WWW" || true; fi
  if [ -n "$GNOME_WWW" ]; then update-alternatives --set gnome-www-browser "$GNOME_WWW" || true; fi
  update_timer chromium Chromium
}

# The computer's Chromium: Debian's, else the snap.
chromium_exe() {
  if [ -x "$CHROMIUM_EXE" ]; then echo "$CHROMIUM_EXE"; elif [ -x "$CHROMIUM_SNAP" ]; then echo "$CHROMIUM_SNAP"; fi
}

chromium_version() { "$(chromium_exe)" --version 2>/dev/null | sed -n 's/^Chromium \\([0-9.]*\\).*/\\1/p'; }

# get_chrome on Linux on ARM: the computer's Chromium, else Debian's installed with apt (Ubuntu's snap where apt has
# none).
get_chromium() {
  if [ -n "$(chromium_exe)" ]; then
    V=$(chromium_version)
    t_step "Chromium\${V:+ $V}, updated by this computer's own updates"
  elif ! command -v apt-get >/dev/null 2>&1; then
    t_warn "$CHROMIUM_NEEDED"
    return 0
  else
    if ! t_run "Installing Chromium (Google makes no Chrome for Linux on ARM)" install_chromium; then
      t_tail "$T_LOG"
      t_warn "Installing Chromium failed: run this installer again. Until then the agents say their browser isn't installed"
      return 0
    fi
    V=$(chromium_version)
    if [ "$CHROMIUM_FROM" = snap ]; then
      t_step "Chromium\${V:+ $V} (snap), updated by snap"
    else
      t_step "Chromium\${V:+ $V}, upgraded every 6 hours"
    fi
  fi
  if [ "$DESKTOP" -eq 1 ]; then
    mkdir -p "$(dirname "$CHROMIUM_DESKTOP")"
    printf '%s\\n' '[Desktop Entry]' 'Type=Application' 'Name=Chromium' 'Exec=/usr/bin/chromium' 'NoDisplay=true' \\
      > "$CHROMIUM_DESKTOP"
    chmod 644 "$CHROMIUM_DESKTOP"
  fi
}

chrome_version() { "$CHROME_EXE" --version 2>/dev/null | sed -n 's/^Google Chrome \\([0-9.]*\\).*/\\1/p'; }

# The agents' browser is the computer's Google Chrome: installed when it has none (with apt), never pinned. A key that
# isn't Google's stops the install; anything else only says so, and each agent says so when it needs its browser.
get_chrome() {
  if on_arm_linux && [ ! -x "$CHROME_EXE" ]; then
    get_chromium
    return 0
  fi
  if [ -x "$CHROME_EXE" ]; then
    V=$(chrome_version)
    t_step "Google Chrome\${V:+ $V}, updated by this computer's own updates"
  elif ! command -v apt-get >/dev/null 2>&1; then
    t_warn "The agents' browser needs Google Chrome: install it (google.com/chrome) with this computer's package manager"
    return 0
  else
    BAD_KEY=0
    if ! t_run "Installing Google Chrome from Google's apt repository" install_chrome; then
      [ "$BAD_KEY" -eq 0 ] || die "Google's apt key didn't match its fingerprint, so Google Chrome was not installed"
      t_tail "$T_LOG"
      t_warn "Installing Google Chrome failed: run this installer again. Until then the agents say Chrome isn't installed"
      return 0
    fi
    V=$(chrome_version)
    t_step "Google Chrome\${V:+ $V}, upgraded every 6 hours"
  fi
  if [ "$DESKTOP" -eq 1 ]; then
    mkdir -p "$(dirname "$CHROME_DESKTOP")"
    printf '%s\\n' '[Desktop Entry]' 'Type=Application' 'Name=Google Chrome' 'Exec=/usr/bin/google-chrome-stable' \\
      'NoDisplay=true' > "$CHROME_DESKTOP"
    chmod 644 "$CHROME_DESKTOP"
  fi
}

# Without root nothing installs Chrome: a runner that updates here says what the agents' browser needs (the paths
# findChrome looks at, but Windows, which has no sh installer; Chromium's too on Linux on ARM).
chrome_or_warn() {
  for EXE in "$CHROME_EXE" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$EXE" ]; then return 0; fi
  done
  if ! on_arm_linux; then
    t_warn "$CHROME_NEEDED"
    return 0
  fi
  for EXE in ${CHROMIUM_LINUX.map(shQuote).join(" ")}; do
    if [ -x "$EXE" ]; then return 0; fi
  done
  t_warn "$CHROMIUM_NEEDED"
}

# --requirements' screens: the packages for the agents' screens alone (no isolation: that is --system's).
desktop_packages() {
  PACKAGES="$DESKTOP_PACKAGES"
  if ! command -v apt-get >/dev/null 2>&1; then
    t_warn "For the agents' screens, install these packages (Debian names) with this computer's package manager: $PACKAGES"
    return 0
  fi
  t_run "Installing the packages for the agents' screens" apt_packages || {
    t_tail "$T_LOG"
    t_warn "Installing the packages for the agents' screens failed: run this again"
    return 0
  }
  t_step "The packages for the agents' screens"
}

# Claude Code for every user (an agent's PATH is /usr/local/bin:/usr/bin:/bin): Anthropic's installer, run in a home
# of its own that is thrown away, then its binary copied to $CLAUDE_EXE. On a Mac, for this user: the installer as is,
# into ~/.local/bin.
install_claude() {
  command -v bash >/dev/null 2>&1 || return 1
  CL=$(mktemp -d) || return 1
  if [ "$(uname -s)" = Darwin ]; then
    if download "$CLAUDE_INSTALL_URL" "$CL/install.sh" && bash "$CL/install.sh" && [ -x "$CLAUDE_EXE" ]; then
      rm -rf "$CL"
      return 0
    fi
    rm -rf "$CL"
    return 1
  fi
  if download "$CLAUDE_INSTALL_URL" "$CL/install.sh" && HOME="$CL" CLAUDE_INSTALL_ALLOW_SUDO=1 bash "$CL/install.sh" &&
    BIN=$(readlink -f "$CL/.local/bin/claude") && [ -f "$BIN" ] && cp "$BIN" "$CLAUDE_EXE.new" &&
    chmod 755 "$CLAUDE_EXE.new" && mv -f "$CLAUDE_EXE.new" "$CLAUDE_EXE"; then
    rm -rf "$CL"
    return 0
  fi
  rm -rf "$CL" "$CLAUDE_EXE.new"
  return 1
}

# Codex for every user: the latest release's static build for this processor, into $CODEX_EXE (on a Mac, its build
# for macOS, for this user).
install_codex() {
  case "$(uname -m)" in
    x86_64 | amd64) CPU=x86_64 ;;
    aarch64 | arm64) CPU=aarch64 ;;
    *) return 1 ;;
  esac
  BUILD=$CPU-unknown-linux-musl
  if [ "$(uname -s)" = Darwin ]; then BUILD=$CPU-apple-darwin; fi
  CX=$(mktemp -d) || return 1
  mkdir -p "\${CODEX_EXE%/*}" || return 1
  if download "$CODEX_RELEASES/codex-$BUILD.tar.gz" "$CX/codex.tar.gz" &&
    tar -xzf "$CX/codex.tar.gz" -C "$CX" && cp "$CX/codex-$BUILD" "$CODEX_EXE.new" &&
    chmod 755 "$CODEX_EXE.new" && mv -f "$CODEX_EXE.new" "$CODEX_EXE"; then
    rm -rf "$CX"
    return 0
  fi
  rm -rf "$CX" "$CODEX_EXE.new"
  return 1
}

# $1 (claude or codex) at $2, named $3: kept when it is there (it updates itself), else installed with install_$1.
get_cli() {
  if [ -x "$2" ]; then
    t_step "$3 $("$2" --version 2>/dev/null | head -n 1 | sed 's/^[^0-9]*//; s/ .*//')"
    return 0
  fi
  if ! t_run "Installing $3" "install_$1"; then
    t_tail "$T_LOG"
    t_warn "Installing $3 failed: run this again, or install it yourself"
    return 0
  fi
  t_step "$3 $("$2" --version 2>/dev/null | head -n 1 | sed 's/^[^0-9]*//; s/ .*//'), in $2"
}

# --requirements: only what the agents need that was asked for, as root on Linux, then stop. The self-host setup runs
# it for the requirements the person said yes to. On a Mac: Claude Code and Codex alone, for this user, in ~/.local/bin.
install_requirements() {
  MAC_CLIS=0
  if [ "$(uname -s)" = Darwin ]; then
    MAC_CLIS=1
    CLAUDE_EXE="$HOME/.local/bin/claude" CODEX_EXE="$HOME/.local/bin/codex"
  else
    [ "$(id -u)" -eq 0 ] || die "--requirements installs packages: run it as root"
    [ "$(uname -s)" = Linux ] || die "--requirements is for Linux"
  fi
  # The list, split on its commas by the shell alone.
  R_LIST="" REST="$REQUIREMENTS,"
  while [ -n "$REST" ]; do
    R=\${REST%%,*} REST=\${REST#*,}
    [ -z "$R" ] || R_LIST="$R_LIST $R"
  done
  for R in $R_LIST; do
    case "$R" in
      browser | desktop) [ "$MAC_CLIS" = 0 ] || die "--requirements on a Mac takes claude and codex: not $R" ;;
    esac
    case "$R" in
      browser | claude | codex) ;;
      desktop) DESKTOP=1 ;;
      *) die "--requirements takes ${REQUIREMENTS.join(", ")}: not $R" ;;
    esac
  done
  start_frame
  for R in $R_LIST; do
    case "$R" in
      browser) get_chrome ;;
      desktop) desktop_packages ;;
      claude) get_cli claude "$CLAUDE_EXE" "Claude Code" ;;
      codex) get_cli codex "$CODEX_EXE" Codex ;;
    esac
  done
  t_gap
  t_end Done
}

# Chrome for Testing, which runners before Google Chrome used: removed once the runner restarted without it.
forget_testing_chrome() { rm -rf "$BROWSER_DIR"/chrome-* "$BROWSER_DIR"/.chrome-*; }

# This server's computer replaces the service a connected runner in $RUNNER_HOME runs as (the root unit,
# or the launchd agent's label), which would leave that connection's server without this computer.
not_connected_for_host() {
  if [ -n "$HOST_TOKEN_FILE" ] && [ -f "$RUNNER_HOME/config.json" ] && grep -q '"token"' "$RUNNER_HOME/config.json" 2>/dev/null; then
    die "this computer is already connected to agentes.chat as a computer, so it can't also be this server's own"
  fi
}

# The end of the frame: the command, by its name, then Done.
finish() {
  t_gap
  t_info "The agentes-runner command is $LAUNCHER. To check this computer's connection:"
  t_cmd "$1 status"
  t_gap
  done_in
}

install_system() {
  [ "$(id -u)" -eq 0 ] ||
    die "--system installs the runner for the whole computer: run it as root (curl -fsSL $SERVER/api/machines/install.sh | sudo sh -s -- --system)"
  [ "$(uname -s)" = Linux ] || die "--system is for Linux"
  # Each agent's slice keeps it off the others' browser ports with systemd's BPF programs: without them no agent's
  # process starts.
  systemctl --version 2>/dev/null | grep -q '+BPF_FRAMEWORK' ||
    die "--system needs systemd built with BPF_FRAMEWORK (systemctl --version shows +BPF_FRAMEWORK), as on Debian 13; Ubuntu's isn't, so agents can't work on this computer as users of their own"
  SYSTEM_DIR=${shQuote(SYSTEM_RUNNER_DIR)}
  BROWSER_DIR=${shQuote(SYSTEM_BROWSER_DIR)}
  RUNNER_HOME=${shQuote(SYSTEM_RUNNER_HOME)}
  not_connected_for_host
  start_frame
  system_packages
  BUNDLE="$SYSTEM_DIR/agentes-runner.mjs"
  LAUNCHER=${shQuote(SYSTEM_LAUNCHER)}
  mkdir -p "$SYSTEM_DIR/bin" "$RUNNER_HOME" "$(dirname "$LAUNCHER")"
  # Folders someone else made earlier would let them swap what root runs.
  chown 0:0 "$SYSTEM_DIR" "$SYSTEM_DIR/bin" "$RUNNER_HOME"
  chmod 755 "$SYSTEM_DIR" "$SYSTEM_DIR/bin"
  chmod 700 "$RUNNER_HOME"
  get_bun
  get_browser
  get_chrome
  get_runner
  set -- service install --system --no-start
  if [ -n "$UID_RANGE" ]; then set -- "$@" --agent-uid-range "$UID_RANGE"; fi
  "$LAUNCHER" "$@" || die "installing the service failed"
  if [ -n "$HOST_TOKEN_FILE" ]; then
    # Only root reads the token.
    chmod 600 "$HOST_TOKEN_FILE"
    set -- service install --host --server "$SERVER" --token-file "$HOST_TOKEN_FILE"
    if [ "$NO_START" -eq 1 ]; then set -- "$@" --no-start; fi
    if [ "$NO_EXEC" -eq 1 ]; then set -- "$@" --no-exec; fi
    "$LAUNCHER" "$@" || die "installing this server's computer failed"
  else
    connect
    if [ "$NO_START" -eq 0 ]; then "$LAUNCHER" service install --system || die "starting the service failed"; fi
  fi
  if [ "$NO_START" -eq 0 ]; then forget_testing_chrome; fi
  finish agentes-runner
}

install_user() {
  RUNNER_HOME="\${AGENTES_RUNNER_HOME:-$HOME/.agentes-runner}"
  BUNDLE="$RUNNER_HOME/agentes-runner.mjs"
  LAUNCHER="$RUNNER_HOME/bin/agentes-runner"
  if [ -f "$RUNNER_HOME/config.json" ] && grep -q '"managedBy": *"desktop"' "$RUNNER_HOME/config.json" 2>/dev/null; then
    die "this computer is connected by the agentes app, so manage it there (or set AGENTES_RUNNER_HOME to another folder)"
  fi
  not_connected_for_host
  start_frame
  mkdir -p "$RUNNER_HOME/bin" "$RUNNER_HOME/runtime"
  chmod 700 "$RUNNER_HOME"

  # This computer's Bun when it has Bun.Terminal, else the pinned one; Node.js 22+ (or an older Bun)
  # only when there is neither, since a runner there gets no screens and no terminal.
  RUNTIME=""
  for CANDIDATE in "$(command -v bun 2>/dev/null || true)" "$HOME/.bun/bin/bun"; do
    if [ -n "$CANDIDATE" ] && has_terminal "$CANDIDATE"; then
      RUNTIME=$CANDIDATE
      t_step "Bun $("$RUNTIME" --version 2>/dev/null || true) ($RUNTIME)"
      break
    fi
  done
  if [ -z "$RUNTIME" ]; then
    if fetch_bun "$RUNNER_HOME/runtime/bun"; then
      RUNTIME="$RUNNER_HOME/runtime/bun"
      t_step "Bun $BUN_VERSION (SHA-256 checked)"
    else
      t_warn "No Bun $BUN_VERSION: $WHY."
    fi
  fi
  if [ -z "$RUNTIME" ]; then
    if command -v node >/dev/null 2>&1; then
      NODE_MAJOR=$(node -v 2>/dev/null | sed 's/^v//; s/\\..*//')
      case "$NODE_MAJOR" in ''|*[!0-9]*) NODE_MAJOR=0 ;; esac
      if [ "$NODE_MAJOR" -ge 22 ]; then RUNTIME=$(command -v node); fi
    fi
    if [ -z "$RUNTIME" ] && command -v bun >/dev/null 2>&1; then RUNTIME=$(command -v bun); fi
    if [ -z "$RUNTIME" ] && [ -x "$HOME/.bun/bin/bun" ]; then RUNTIME="$HOME/.bun/bin/bun"; fi
    if [ -n "$RUNTIME" ]; then
      t_warn "The runner runs on $RUNTIME, so agents get no screens and no terminal on this computer: those need Bun 1.3.5 or newer."
    fi
  fi
  if [ -z "$RUNTIME" ]; then
    T_FD=2
    t_say "$C_FAIL$M_FAIL$C_OFF" "$C_BOLD" "The runner needs Bun 1.3.5 or newer, or Node.js 22 or newer. Install one, then run this again:"
    t_cmd "curl -fsSL https://bun.sh/install | bash" "Bun:  "
    t_cmd "brew install node" "macOS:"
    t_cmd "https://nodejs.org/en/download (or: curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22)" "Linux:"
    t_stop
    exit 1
  fi

  get_runner
  chrome_or_warn
  if [ -n "$HOST_TOKEN_FILE" ]; then
    chmod 600 "$HOST_TOKEN_FILE"
    set -- service install --host --server "$SERVER" --token-file "$HOST_TOKEN_FILE"
    if [ "$NO_EXEC" -eq 1 ]; then set -- "$@" --no-exec; fi
    "$LAUNCHER" "$@" || die "installing this server's computer failed"
    finish "$LAUNCHER"
    return 0
  fi
  connect

  SERVICE=0
  if [ "$NO_SERVICE" -eq 0 ]; then
    if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
      SERVICE=1
    elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
      SERVICE=1
    fi
  fi

  if [ "$SERVICE" -eq 1 ]; then
    if ! "$LAUNCHER" service install; then
      t_warn "Couldn't install the service. Start the runner yourself:"
      t_cmd "$LAUNCHER start"
    fi
  else
    t_gap
    t_info "Start the runner (keep it running, for example in tmux):"
    t_cmd "$LAUNCHER start"
  fi

  t_gap
  t_info "To use the agentes-runner command, add it to your PATH:"
  t_cmd "export PATH=\\"$RUNNER_HOME/bin:\\$PATH\\""
  t_gap
  done_in
}

main() {
  T_START=$(date +%s)
  t_init 1
  # The waits' output (t_run): kept for a failure's last lines, removed when the installer exits.
  T_LOGS=$(mktemp -d 2>/dev/null) || T_LOGS=''
  if [ -n "$T_LOGS" ]; then trap 'rm -rf "$T_LOGS"' EXIT; fi
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) need_value "$1" $#; DIR="$2"; shift 2 ;;
      --dir=*) DIR="\${1#--dir=}"; shift ;;
      --name) need_value "$1" $#; NAME="$2"; shift 2 ;;
      --name=*) NAME="\${1#--name=}"; shift ;;
      --no-exec) NO_EXEC=1; shift ;;
      --no-service) NO_SERVICE=1; shift ;;
      --system) SYSTEM=1; shift ;;
      --desktop) DESKTOP=1; shift ;;
      --no-pair) NO_PAIR=1; shift ;;
      --no-start) NO_START=1; shift ;;
      --agent-uid-range) need_value "$1" $#; UID_RANGE="$2"; shift 2 ;;
      --agent-uid-range=*) UID_RANGE="\${1#--agent-uid-range=}"; shift ;;
      --runner-sha256) need_value "$1" $#; RUNNER_SHA256="$2"; shift 2 ;;
      --server) need_value "$1" $#; SERVER_FLAG="$2"; shift 2 ;;
      --server=*) SERVER_FLAG="\${1#--server=}"; shift ;;
      --host-token-file) need_value "$1" $#; HOST_TOKEN_FILE="$2"; shift 2 ;;
      --host-token-file=*) HOST_TOKEN_FILE="\${1#--host-token-file=}"; shift ;;
      --runner-sha256=*) RUNNER_SHA256="\${1#--runner-sha256=}"; shift ;;
      --enroll-file) need_value "$1" $#; ENROLL_FILE="$2"; shift 2 ;;
      --enroll-file=*) ENROLL_FILE="\${1#--enroll-file=}"; shift ;;
      --link) need_value "$1" $#; LINK="$2"; shift 2 ;;
      --link=*) LINK="\${1#--link=}"; shift ;;
      --requirements) need_value "$1" $#; REQUIREMENTS="$2"; shift 2 ;;
      --requirements=*) REQUIREMENTS="\${1#--requirements=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  # Listed, not a range: shells may sort ranges by locale, letting capitals in.
  case "$RUNNER_SHA256" in
    *[!0123456789abcdef]*) die "--runner-sha256 takes the bundle's SHA-256 as 64 lowercase hex digits" ;;
  esac
  [ -z "$RUNNER_SHA256" ] || [ \${#RUNNER_SHA256} -eq 64 ] ||
    die "--runner-sha256 takes the bundle's SHA-256 as 64 lowercase hex digits"
  if [ -n "$SERVER_FLAG" ]; then
    SERVER=$(printf '%s' "$SERVER_FLAG" | sed 's:/*$::')
    case "$SERVER" in
      http://*|https://*) ;;
      *) die "--server takes the server's address, like http://127.0.0.1:3000" ;;
    esac
  fi
  [ -z "$HOST_TOKEN_FILE" ] || [ -r "$HOST_TOKEN_FILE" ] || die "--host-token-file: can't read $HOST_TOKEN_FILE"
  case "$LINK" in
    *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-]*) die "--link takes the code at the end of the link (like 7KQ2-M9XD)" ;;
  esac
  if [ -n "$LINK" ]; then
    [ -z "$ENROLL_FILE" ] || die "--link and --enroll-file each connect this computer: use one"
    [ "$NO_PAIR" -eq 0 ] || die "--link connects this computer, so it doesn't go with --no-pair"
    [ -z "$HOST_TOKEN_FILE" ] || die "--link doesn't go with --host-token-file: this server's own computer connects with its token"
    [ -z "$REQUIREMENTS" ] || die "--requirements goes alone: it only installs what the agents need"
    # As root on Linux, where systemd can keep agents apart, the computer is a server: the runner for all of it.
    if [ "$SYSTEM" -eq 0 ] && [ -z "$DIR" ] && [ "$(uname -s)" = Linux ] && [ "$(id -u)" -eq 0 ] &&
      systemctl --version 2>/dev/null | grep -q '+BPF_FRAMEWORK'; then
      SYSTEM=1
    fi
  fi
  [ -z "$ENROLL_FILE" ] || [ "$NO_PAIR" -eq 0 ] || die "--enroll-file connects this computer, so it doesn't go with --no-pair"
  [ -z "$ENROLL_FILE" ] || [ -z "$HOST_TOKEN_FILE" ] ||
    die "--enroll-file doesn't go with --host-token-file: this server's own computer connects with its token"
  if [ -n "$REQUIREMENTS" ]; then
    if [ "$SYSTEM" -eq 1 ] || [ -n "$HOST_TOKEN_FILE" ] || [ -n "$ENROLL_FILE" ]; then
      die "--requirements goes alone: it only installs what the agents need"
    fi
    install_requirements
    return 0
  fi
  # On a Mac this server's computer runs as the person (agents in folders of their own), so it needs no --system; on
  # Linux as another user it is the setup's simple mode, its agents sharing that user (ADR 0153 §5).
  USER_HOST=0
  if [ -n "$HOST_TOKEN_FILE" ] && { [ "$(uname -s)" = Darwin ] || [ "$(id -u)" -ne 0 ]; }; then USER_HOST=1; fi
  if [ "$SYSTEM" -eq 1 ]; then
    [ "$NO_SERVICE" -eq 0 ] || die "--system always installs the service (to leave it stopped, use --no-start)"
    [ -z "$DIR" ] || die "--dir doesn't go with --system: each agent works in its own user's home"
    install_system
  elif [ "$DESKTOP" -eq 1 ] || [ "$NO_PAIR" -eq 1 ] || [ "$NO_START" -eq 1 ] || [ -n "$UID_RANGE" ] ||
    { [ -n "$HOST_TOKEN_FILE" ] && [ "$USER_HOST" -eq 0 ]; }; then
    die "--desktop, --no-pair, --no-start, --agent-uid-range and --host-token-file go with --system (on a Mac, or on Linux as another user, --host-token-file goes alone)"
  else
    [ "$USER_HOST" -eq 0 ] || [ "$NO_SERVICE" -eq 0 ] ||
      die "--host-token-file installs the service: it's how this computer keeps up with the server"
    install_user
  fi
}

main "$@"
`;
}

/** What `/i/<code>` serves for a link that was used, expired or never existed. */
export const LINK_EXPIRED = "This link expired. Make a new one under Settings › Devices.";

/** The shell installer for a used or expired link: one line, exit 1. */
export function expiredLinkScript(): string {
  return `#!/bin/sh\nprintf '%s\\n' ${shQuote(LINK_EXPIRED)} >&2\nexit 1\n`;
}

/** Quotes a value for PowerShell (single quotes; a `'` becomes `''`). */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * PowerShell's text for `text`, ASCII only: `irm` decodes a script without a charset as Latin-1, so anything else
 * (Settings › Devices) is built from its code points.
 */
const psText = (text: string) =>
  [...text]
    .map((c) => (c.charCodeAt(0) < 128 ? psQuote(c) : `[char]0x${c.charCodeAt(0).toString(16).padStart(4, "0")}`))
    .reduce<string[]>((parts, part) => {
      const last = parts.at(-1);
      // Neighbouring ASCII characters stay one quoted string.
      if (last?.startsWith("'") && part.startsWith("'"))
        parts[parts.length - 1] = `${last.slice(0, -1)}${part.slice(1)}`;
      else parts.push(part);
      return parts;
    }, [])
    .join(" + ");

/** The PowerShell installer for a used or expired link: one line in red (no `exit`, which would close the window). */
export function expiredLinkScriptPowerShell(): string {
  return `Write-Host (${psText(LINK_EXPIRED)}) -ForegroundColor Red\n`;
}

/** SHA-256 (hex) of each Windows `bun-<target>.zip` of `RUNNER_BUN_VERSION` (x64: the baseline build, any CPU). */
export const RUNNER_BUN_WINDOWS_SHA256 = {
  "windows-x64-baseline": "0f20ce6674d4f2dbcc8c5d59fdf99f7ba45f8c3b367e0f5781cbfa30a1c78d99",
  "windows-aarch64": "2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09",
} as const;

/**
 * The installer served at `GET /i/<code>/ps`, for Windows:
 *
 *   irm <publicUrl>/i/<code>/ps | iex
 *
 * The shell installer's steps for one user, in PowerShell 5.1 or 7: the pinned Bun (`RUNNER_BUN_VERSION`, checked
 * against `RUNNER_BUN_WINDOWS_SHA256`) in `%USERPROFILE%\.agentes-runner\runtime`, kept when it is there at that
 * version; the runner bundle from `<publicUrl>/runner/agentes-runner.mjs`; a launcher `bin\agentes-runner.cmd`;
 * `agentes-runner pair --link <code>`, which waits for the link's maker to let this computer join; then a Scheduled
 * Task at sign-in that keeps `agentes-runner start` running hidden (restarted every minute if it stops), or, where
 * a user may not add tasks, a line in the Startup folder. A runner already running from that home is stopped first,
 * so the new one takes over. A home the agentes app manages is left alone. Everything runs from the last line, so a
 * download cut short runs nothing, and nothing calls `exit` (under `iex` it would close the window). The text is
 * ASCII only (`psText`).
 */
export function installScriptPowerShell(publicUrl: string, options: { link?: string } = {}): string {
  const server = psQuote(publicUrl.trim().replace(/\/+$/, ""));
  const sha = RUNNER_BUN_WINDOWS_SHA256;
  return `# agentes.chat runner installer for Windows: connects this computer to your organization.
# Usage, with a link made under Settings > Devices: irm <server>/i/<code>/ps | iex

function Install-AgentesRunner {
  $T0 = Get-Date
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $Server = ${server}
  $Link = ${psQuote(options.link ?? "")}
  $BunVersion = ${psQuote(RUNNER_BUN_VERSION)}
  $Task = ${psQuote(WINDOWS_TASK)}
  $Devices = ${psText("Settings › Devices")}
  $Bar = [char]0x2502
  function Say([string]$Mark, [string]$Text, [string]$Color) { Write-Host "$Mark  $Text" -ForegroundColor $Color }
  function Step([string]$Text) { Say ([char]0x25C7) $Text 'Green' }
  function Info([string]$Text) { Say ([char]0x25CF) $Text 'Cyan' }
  function Gap { Write-Host $Bar -ForegroundColor DarkGray }
  function Cmd([string]$Text) { Write-Host "$Bar    $Text" -ForegroundColor Cyan }
  function Q([string]$Text) { "'" + $Text.Replace("'", "''") + "'" }

  if (-not $Link) { throw "This installer needs a link. Make one under $Devices." }
  $Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($Arch) {
    'AMD64' { $Target = 'windows-x64-baseline'; $Sha = ${psQuote(sha["windows-x64-baseline"])} }
    'ARM64' { $Target = 'windows-aarch64'; $Sha = ${psQuote(sha["windows-aarch64"])} }
    default { throw "There's no runner for Windows on $Arch." }
  }
  $RunnerHome = if ($env:AGENTES_RUNNER_HOME) { $env:AGENTES_RUNNER_HOME } else { Join-Path $env:USERPROFILE '.agentes-runner' }
  $Config = Join-Path $RunnerHome 'config.json'
  if ((Test-Path $Config) -and ((Get-Content -Raw $Config) -match '"managedBy":\\s*"desktop"')) {
    throw 'This computer is connected by the agentes app, so manage it there.'
  }
  Write-Host ''
  Write-Host "$([char]0x250C)  agentes.chat: connect this computer" -ForegroundColor White
  Gap
  $Runtime = Join-Path $RunnerHome 'runtime'
  $Bin = Join-Path $RunnerHome 'bin'
  New-Item -ItemType Directory -Force -Path $Runtime, $Bin | Out-Null

  # The pinned Bun, kept when it is there at that version, checked against its SHA-256 before it is installed.
  $Bun = Join-Path $Runtime 'bun.exe'
  $Have = try { (& $Bun --version) } catch { '' }
  if ($Have -ne $BunVersion) {
    $Work = Join-Path ([IO.Path]::GetTempPath()) ('agentes-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $Work | Out-Null
    try {
      Info "Downloading Bun $BunVersion"
      $Zip = Join-Path $Work 'bun.zip'
      Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/bun-$Target.zip" -OutFile $Zip
      if ((Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower() -ne $Sha) {
        throw "The Bun download didn't match its checksum, so it was not installed."
      }
      Expand-Archive -Path $Zip -DestinationPath $Work -Force
      Copy-Item -Force (Join-Path $Work "bun-$Target\\bun.exe") $Bun
    } finally {
      Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
    }
  }
  Step "Bun $BunVersion (SHA-256 checked)"

  $Bundle = Join-Path $RunnerHome 'agentes-runner.mjs'
  Info "Downloading the runner from $Server"
  Invoke-WebRequest -UseBasicParsing -Uri "$Server/runner/agentes-runner.mjs" -OutFile "$Bundle.download"
  Move-Item -Force "$Bundle.download" $Bundle
  $Launcher = Join-Path $Bin 'agentes-runner.cmd'
  Set-Content -Path $Launcher -Encoding ASCII -Value @('@echo off', "set ""AGENTES_RUNNER_HOME=$RunnerHome""", """$Bun"" ""$Bundle"" %*")
  Step "The runner, from $Server"
  Gap

  # Waits until the link's maker lets this computer join (or says no). It draws in this frame.
  $env:AGENTES_RUNNER_HOME = $RunnerHome
  $env:AGENTES_FRAME = '1'
  & $Bun $Bundle pair --server $Server --link $Link
  $Paired = $LASTEXITCODE
  Remove-Item Env:AGENTES_FRAME -ErrorAction SilentlyContinue
  if ($Paired -eq 130) { return }
  if ($Paired -ne 0) { throw 'Connecting this computer failed.' }

  # A runner already running from this home (an earlier install) makes way for the new one.
  $Lock = Join-Path $RunnerHome 'runner.lock'
  if (Test-Path $Lock) {
    try { Stop-Process -Id ((Get-Content -Raw $Lock | ConvertFrom-Json).pid) -Force -ErrorAction SilentlyContinue } catch { }
  }
  $Start = Join-Path $Bin 'agentes-runner-start.ps1'
  Set-Content -Path $Start -Encoding ASCII -Value @("\`$env:AGENTES_RUNNER_HOME = $(Q $RunnerHome)", "& $(Q $Bun) $(Q $Bundle) start")
  $Run = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Start + '"'
  try {
    $Me = "$env:USERDOMAIN\\$env:USERNAME"
    $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Run
    $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Me
    $Principal = New-ScheduledTaskPrincipal -UserId $Me -LogonType Interactive -RunLevel Limited
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $Task -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
    Start-ScheduledTask -TaskName $Task
    Step "Runs in the background from sign-in (Task Scheduler: $Task)"
  } catch {
    # Some computers don't let a user add tasks: the Startup folder starts it at sign-in instead.
    $Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'agentes-runner.cmd'
    Set-Content -Path $Startup -Encoding ASCII -Value @('@echo off', "start """" /min powershell.exe $Run")
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $Run
    Step 'Runs in the background from sign-in (Startup folder)'
  }
  Gap
  Info "The agentes-runner command is $Launcher. To check this computer's connection:"
  Cmd "& $(Q $Launcher) status"
  Gap
  $S = [int][math]::Floor(((Get-Date) - $T0).TotalSeconds)
  $Took = if ($S -ge 60) { '{0}m {1:00}s' -f [math]::Floor($S / 60), ($S % 60) } else { "$($S)s" }
  Write-Host "$([char]0x2514)  Done in $Took" -ForegroundColor Green
}

try { Install-AgentesRunner } catch { Write-Host "$([char]0x25A0)  $($_.Exception.Message)" -ForegroundColor Red }
`;
}
