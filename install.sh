#!/bin/sh
# agentes.chat installer: a self-hosted agentes.chat on this computer, in one command.
#
#   curl -fsSL https://agentes.chat/install | sh
#   curl -fsSL https://agentes.chat/install | sh -s -- --plan      prints what it would do, does nothing
#
# --plan (--dry-run too) is this installer's own plan: it runs nothing, the setup included. The setup
# writes and starts nothing until its last question is answered: for its plan, stop it at its first
# question (Ctrl-C), then run the setup command this printed again with --dry-run (with sudo if this
# ran itself again with sudo).
#
# To read it before it runs: curl -fsSLo install.sh https://agentes.chat/install, then sh install.sh.
#
# It gets this computer ready, then hands over to the setup (@agenteschat/setup), which asks its few
# questions, writes .env and starts everything. On Linux it makes sure of Docker and its Compose
# plugin, and starts the engine when it's stopped. On a Mac it starts the Docker it finds (Docker
# Desktop, OrbStack or Colima), or installs Colima with Homebrew; each after asking (--yes doesn't
# ask). On both it fetches a pinned Bun to run the setup with. Downloads are HTTPS only, and the pinned ones are checked
# against the SHA-256 below before anything runs them.
#
# Everything is inside main, which the last line calls, so a download cut short runs nothing.

main() {
  set -eu

  # The setup this installer hands over to, the Bun it runs on, and the Compose plugin it installs
  # when Docker has none (or one older than the 2.23.1 the compose file needs).
  SETUP_VERSION=0.1.1
  BUN_VERSION=1.4.4
  COMPOSE_VERSION=5.5.1
  MIN_COMPOSE=2.23.1
  INSTALL_URL=https://agentes.chat/install
  GUIDE=https://agentes.chat/docs/install-on-a-server
  DOCKER_DOCS=https://docs.docker.com/engine/install/
  BREW_INSTALL=https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh

  # Refusals below go to stderr, drawn for stdout until the options say where the rest goes.
  t_init 1
  PLAN=0 YES=0 DIR='' DIR_FLAG='' OUT=1 COMPUTER='' prev=''
  n=$#
  while [ "$n" -gt 0 ]; do
    arg=$1
    shift
    n=$((n - 1))
    # The setup's --computer, read here too: yes needs root on Linux (below). The last one given wins, as there.
    case $prev in --computer) COMPUTER=$arg ;; esac
    case $arg in --computer=*) COMPUTER=${arg#--computer=} ;; esac
    prev=$arg
    case $arg in
      --plan | --dry-run) PLAN=1 ;;
      --yes | -y) YES=1 ;;
      --native)
        die "This installer can't run agentes.chat without Docker yet (--native)." \
          "On a Mac, the agentes.chat app runs it without Docker (Use your own server, then Run agentes.chat on this Mac). Or use Docker: Docker Desktop, OrbStack or Colima on a Mac. On Linux, this installer sets it up."
        ;;
      --dir)
        [ "$n" -gt 0 ] || die "--dir needs a folder, like --dir /srv/agentes."
        DIR=$1 DIR_FLAG=$1
        shift
        n=$((n - 1))
        ;;
      --dir=*) DIR=${arg#--dir=} DIR_FLAG=${arg#--dir=} ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        # The setup's own options, passed on in order. With --json its stdout is for the result
        # alone, so this installer talks on stderr.
        if [ "$arg" = --json ]; then OUT=2; fi
        set -- "$@" "$arg"
        ;;
    esac
  done
  t_init "$OUT"

  OS=$(uname -s)
  ARCH=$(uname -m)
  COMPOSE_ASSET='' COMPOSE_SHA256=''
  case "$OS-$ARCH" in
    Linux-x86_64 | Linux-amd64)
      PLATFORM="Linux on x64"
      # Baseline: server CPUs may lack AVX2.
      BUN_TARGET=linux-x64-baseline
      BUN_SHA256=e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76
      COMPOSE_ASSET=docker-compose-linux-x86_64
      COMPOSE_SHA256=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
      ;;
    Linux-aarch64 | Linux-arm64)
      PLATFORM="Linux on arm64"
      BUN_TARGET=linux-aarch64
      BUN_SHA256=baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e
      COMPOSE_ASSET=docker-compose-linux-aarch64
      COMPOSE_SHA256=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
      ;;
    Darwin-x86_64)
      PLATFORM="macOS on Intel"
      BUN_TARGET=darwin-x64-baseline
      BUN_SHA256=d4a155adfbfd09155eb3ba05c9e3a544f39297d7a68616d3c7759f67ab5c47dc
      ;;
    Darwin-arm64)
      PLATFORM="macOS on Apple silicon"
      BUN_TARGET=darwin-aarch64
      BUN_SHA256=c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510
      ;;
    *)
      die "agentes.chat installs on macOS or Linux, on x64 or arm64, and this is $OS on $ARCH." \
        "On Windows, run it in WSL 2. Elsewhere, the manual steps: $GUIDE"
      ;;
  esac
  if [ "$OS" = Linux ]; then
    case "$(ldd --version 2>&1 || :)" in
      *musl*)
        die "This Linux uses musl (Alpine, say), which the installer doesn't support." \
          "The manual steps work there: $GUIDE"
        ;;
    esac
  fi

  IS_ROOT=0
  if [ "$(id -u)" = 0 ]; then
    IS_ROOT=1
    # cloud-init can run scripts without HOME, and Bun keeps its downloads under it.
    if [ -z "${HOME:-}" ]; then
      HOME=/root
      export HOME
    fi
  fi

  # [ -r /dev/tty ] is true with no terminal at all (cloud-init, CI), where opening it fails, so
  # opening it is the test. Under curl | sh, stdin is the rest of this script: the setup reads the
  # terminal, or nothing (its defaults and the options given).
  TTY=/dev/null
  if (exec </dev/tty) 2>/dev/null; then TTY=/dev/tty; fi
  # The setup reads that terminal by its own name: Bun on macOS can't wait for keys on /dev/tty itself.
  # Only where the name opens: after su, the device still belongs to the first user, and only /dev/tty does.
  SETUP_IN=$TTY DEVICE=''
  if [ "$TTY" = /dev/tty ]; then
    if [ -t 2 ]; then
      DEVICE=$(tty <&2 2>/dev/null) || DEVICE=''
    elif [ -t 1 ]; then
      { DEVICE=$(tty <&3 2>/dev/null) || DEVICE=''; } 3>&1
    fi
    case $DEVICE in
      /dev/tty | '' | *[!/0-9A-Za-z]*) ;;
      *) if (exec <"$DEVICE") 2>/dev/null; then SETUP_IN=$DEVICE; fi ;;
    esac
  fi

  if [ "$PLAN" = 1 ]; then
    WORK='<tmp>'
  else
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/agentes-install.XXXXXX")
    T_LOGS=$WORK
    trap 'rm -rf "$WORK"' EXIT
  fi

  # Linux without root runs this again as root before drawing anything, so the root run is the one that shows
  # the logo: without access to Docker, and for --computer yes, whose users and service the setup makes as root
  # only. --plan runs nothing again: it draws first.
  DOCKER_VERSION='' ROOT_WHY='' ROOT_FIX=''
  if [ "$OS" = Linux ]; then
    if command -v docker >/dev/null 2>&1; then DOCKER_VERSION=$(docker_version) || DOCKER_VERSION=''; fi
    if [ "$IS_ROOT" = 0 ] && [ -z "$DOCKER_VERSION" ]; then
      ROOT_WHY="Docker needs root here"
      ROOT_FIX="Run this as root, or install Docker yourself ($DOCKER_DOCS) and add your user to the docker group."
    elif [ "$IS_ROOT" = 0 ] && [ "$COMPUTER" = yes ]; then
      ROOT_WHY="Making this machine your agents' computer (--computer yes) needs root"
      ROOT_FIX="Run this as root, or leave out --computer yes and connect a computer later in Settings › Devices."
    fi
  fi
  if [ -n "$ROOT_WHY" ] && [ "$PLAN" = 0 ]; then as_root "$@"; fi

  if [ "$PLAN" = 1 ]; then t_intro "install plan (--plan: nothing runs)"; else t_intro install; fi
  if [ "$IS_ROOT" = 1 ]; then t_step "$PLATFORM, as root"; else t_step "$PLATFORM"; fi
  if [ "$TTY" = /dev/tty ]; then
    t_step "A terminal: the setup asks its questions there"
  else
    t_step "No terminal: the setup takes its defaults and the options given"
  fi
  if [ -n "$ROOT_WHY" ]; then as_root "$@"; fi

  if [ "$OS" = Linux ]; then
    linux_docker
  else
    mac_docker
  fi

  if [ -z "$DIR" ]; then
    if [ "$IS_ROOT" = 1 ]; then DIR=/opt/agentes; else DIR=$HOME/agentes; fi
  fi
  case $DIR in /*) ;; *) DIR=$PWD/$DIR ;; esac

  SETUP="@agenteschat/setup@$SETUP_VERSION"
  if [ -n "${AGENTES_INSTALL_SETUP:-}" ]; then
    case $AGENTES_INSTALL_SETUP in /*) ;; *) AGENTES_INSTALL_SETUP=$PWD/$AGENTES_INSTALL_SETUP ;; esac
    [ -f "$AGENTES_INSTALL_SETUP" ] ||
      die "AGENTES_INSTALL_SETUP is $AGENTES_INSTALL_SETUP, which isn't a file." \
        "Point it at a build of the setup (packages/setup/dist/index.js), or unset it."
    SETUP=$AGENTES_INSTALL_SETUP
  fi

  get_bun

  if [ -n "${AGENTES_INSTALL_SETUP:-}" ]; then
    set -- "$BUN" "$SETUP" "$@"
  else
    set -- "$BUN" x --bun "$SETUP" "$@"
  fi
  if [ "$PLAN" = 1 ]; then
    t_step "The setup, in $DIR:"
    t_shell "mkdir -p $DIR"
    t_shell "cd $DIR"
    t_shell "$* <$TTY"
    t_gap
    t_end "Nothing ran. For the setup's own plan, run its command above with --dry-run."
    return 0
  fi
  run mkdir -p "$DIR"
  t_gap
  t_step "The setup, in $DIR:"
  t_cmd "$*"
  t_gap
  rm -rf "$WORK"
  trap - EXIT
  cd "$DIR"
  # The setup draws in this frame: no logo or ┌ of its own, and it closes the frame (packages/setup/src/term.ts).
  AGENTES_FRAME=1
  export AGENTES_FRAME
  exec "$@" <"$SETUP_IN"
}

usage() {
  printf '%s\n' "agentes.chat installer: a self-hosted agentes.chat on this computer, in one command.

Usage: curl -fsSL https://agentes.chat/install | sh -s -- [options] [setup options]
       sh install.sh [options] [setup options]

  --dir <folder>      Where agentes.chat lives: /opt/agentes as root, ~/agentes otherwise.
  --yes               Start or install Docker without asking first: on Linux with Docker's own
                      script; on a Mac the Docker Desktop, OrbStack or Colima it finds, or
                      Colima with Homebrew.
  --plan              Print what it would do, and do nothing (--dry-run too). Not the setup's
                      plan: stop the setup at its first question (Ctrl-C), then run the setup
                      command this printed again with --dry-run (with sudo if this ran itself
                      again with sudo).
  -h, --help

Every other option goes to the setup, like --network local or --email skip (the setup's own
--help lists them). On Linux, --computer yes (this machine as your agents' computer) needs root:
without it, this runs itself again with sudo. The guide: $GUIDE

AGENTES_INSTALL_SETUP=<file> runs that build of the setup instead of the published one."
}

die() {
  t_fail "$@"
  exit 1
}

# Runs a command, its output kept: a failure shows the command and the end of its output, and stops.
# With --plan it only shows the command.
run() {
  if [ "$PLAN" = 1 ]; then
    t_shell "$*"
    return 0
  fi
  "$@" >"$WORK/run.log" 2>&1 </dev/null || {
    t_shell "$*"
    t_tail "$WORK/run.log"
    die "That command failed." "Fix what its last lines say, then run this again."
  }
}

# fetch URL FILE LABEL: an HTTPS download, under a spinner with LABEL; with --plan only the command.
fetch() {
  if [ "$PLAN" = 1 ]; then
    t_shell "curl -fsSL --proto =https --retry 3 -o $2 $1"
    return 0
  fi
  t_run "$3" curl -fsSL --proto =https --retry 3 -o "$2" "$1" || {
    t_shell "curl -fsSL --proto =https --retry 3 -o $2 $1"
    t_tail "$T_LOG"
    die "Couldn't download $1." "Check this computer's internet connection, then run this again."
  }
}

verify() {
  if [ "$PLAN" = 1 ]; then return 0; fi
  if command -v sha256sum >/dev/null 2>&1; then
    sum=$(sha256sum "$1")
  else
    sum=$(shasum -a 256 "$1")
  fi
  if [ "${sum%% *}" != "$2" ]; then
    rm -f "$1"
    die "The download of ${1##*/} isn't the file this installer expects (its SHA-256 differs), so it was deleted, not run." \
      "Run this again. If it happens again, open an issue: https://github.com/agentes-chat/agentes-chat/issues"
  fi
}

# Whether version $1 is $2 or newer, number by number ("v" and anything after "-" or "+" ignored).
version_at_least() {
  va=${1#v} vb=${2#v}
  va=${va%%[-+]*} vb=${vb%%[-+]*}
  while [ -n "$va$vb" ]; do
    xa=${va%%.*} xb=${vb%%.*}
    case $xa in '' | *[!0-9]*) xa=0 ;; esac
    case $xb in '' | *[!0-9]*) xb=0 ;; esac
    if [ "$xa" -ne "$xb" ]; then
      [ "$xa" -gt "$xb" ]
      return
    fi
    case $va in *.*) va=${va#*.} ;; *) va='' ;; esac
    case $vb in *.*) vb=${vb#*.} ;; *) vb='' ;; esac
  done
}

# The Docker engine's version, when it answers within 5 seconds: a Docker Desktop that is still
# starting can hang without ever answering.
docker_version() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info --format '{{.ServerVersion}}' </dev/null 2>/dev/null &
  probe=$!
  (sleep 5 && kill "$probe") </dev/null >/dev/null 2>&1 &
  watchdog=$!
  status=0
  wait "$probe" || status=$?
  kill "$watchdog" 2>/dev/null || :
  return "$status"
}

# As root here: a non-root run without Docker ran itself again as root before this.
linux_docker() {
  if [ -n "$DOCKER_VERSION" ]; then
    t_step "Docker $DOCKER_VERSION"
    compose_plugin
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    agree "Docker is installed, but its engine isn't running. Start it now (systemctl enable --now docker)?" \
      "Docker is installed, but its engine doesn't answer." \
      "Start it (systemctl start docker) and run this again, or pass --yes to start it."
    start_engine "the Docker engine" systemctl enable --now docker
    compose_plugin
    return 0
  fi

  if [ "$YES" = 1 ]; then
    t_step "Docker isn't installed: installing it with Docker's own script (--yes)"
  elif [ "$TTY" = /dev/null ]; then
    die "Docker isn't installed, and with no terminal to ask, this installer won't install it on its own." \
      "Pass --yes to install it with Docker's script (get.docker.com), or install Docker yourself: $DOCKER_DOCS"
  elif [ "$PLAN" = 1 ]; then
    t_step "Docker isn't installed: installing it with Docker's own script, once you say yes (--yes doesn't ask)"
  else
    t_gap
    t_ask "Docker isn't installed. Install it now with Docker's own script (get.docker.com)?" ||
      die "agentes.chat runs on Docker here." "Install Docker yourself ($DOCKER_DOCS) and run this again."
  fi
  fetch https://get.docker.com "$WORK/get-docker.sh" "Downloading Docker's install script"
  if [ "$PLAN" = 1 ]; then
    t_shell "sh $WORK/get-docker.sh"
    t_step "Compose comes with it"
    return 0
  fi
  t_run "Installing Docker with Docker's own script" sh "$WORK/get-docker.sh" || {
    t_tail "$T_LOG"
    die "Docker's install script failed (its last lines above)." \
      "Install Docker by hand ($DOCKER_DOCS), then run this again."
  }
  if DOCKER_VERSION=$(docker_version); then
    t_step "Docker $DOCKER_VERSION, installed with Docker's own script"
  else
    start_engine "the Docker engine" systemctl enable --now docker
  fi
  compose_plugin
}

# agree QUESTION ERROR FIX: yes with --yes, asked on a terminal (no stops with ERROR and FIX), ERROR and FIX with no
# terminal to ask. --plan asks nothing (the caller shows what it would do), and stops where the real run would.
agree() {
  if [ "$YES" = 1 ]; then return 0; fi
  if [ "$TTY" = /dev/null ]; then die "$2" "$3"; fi
  if [ "$PLAN" = 1 ]; then return 0; fi
  t_gap
  t_ask "$1" || die "$2" "$3"
}

# start_engine NAME COMMAND…: COMMAND starts Docker's engine (NAME), then the wait until it answers, up to 3 minutes:
# Docker Desktop and a new Colima take a while the first time. With --plan only the command.
start_engine() {
  e_name=$1
  shift
  if [ "$PLAN" = 1 ]; then
    t_shell "$*"
    t_step "Then waits for Docker to answer"
    return 0
  fi
  t_run "Starting $e_name" "$@" || {
    t_tail "$T_LOG"
    die "Starting $e_name failed (its last lines above)." "Start it yourself, then run this again."
  }
  t_run "Waiting for Docker to answer" wait_docker ||
    die "$e_name started, but Docker still doesn't answer after 3 minutes." \
      "Open $e_name and see what it says, then run this again."
  DOCKER_VERSION=$(docker_version) || DOCKER_VERSION='?'
  case $e_name in
    "the Docker engine") t_step "Docker $DOCKER_VERSION, started" ;;
    *) t_step "Docker $DOCKER_VERSION, started ($e_name)" ;;
  esac
}

# Up to 3 minutes for the engine to answer.
wait_docker() {
  w_i=0
  while [ "$w_i" -lt 90 ]; do
    if docker_version >/dev/null; then return 0; fi
    sleep 2
    w_i=$((w_i + 1))
  done
  return 1
}

# A Mac's Docker: the engine this Mac has (Docker Desktop, OrbStack or Colima), started when it isn't running; with
# none, Colima (open source, no window to keep open) installed with Homebrew, and Homebrew first when it's missing.
# Each change after asking (--yes doesn't ask).
mac_docker() {
  # Where those put the docker command, often not on the PATH a piped script gets.
  for d in /opt/homebrew/bin "$HOME/.orbstack/bin" /Applications/Docker.app/Contents/Resources/bin; do
    if [ -d "$d" ]; then PATH=$PATH:$d; fi
  done
  export PATH
  if DOCKER_VERSION=$(docker_version); then
    t_step "Docker $DOCKER_VERSION"
    return 0
  fi
  if [ -d /Applications/OrbStack.app ] || [ -d "$HOME/Applications/OrbStack.app" ]; then
    mac_start OrbStack open -g -a OrbStack
  elif [ -d /Applications/Docker.app ] || [ -d "$HOME/Applications/Docker.app" ]; then
    mac_start "Docker Desktop" open -g -a Docker
  elif command -v colima >/dev/null 2>&1; then
    mac_start Colima colima start
  elif command -v docker >/dev/null 2>&1; then
    die "Docker is on this Mac, but it doesn't answer." "Start it (Docker Desktop, OrbStack or Colima) and run this again."
  else
    mac_colima
  fi
}

# mac_start NAME COMMAND…: a Docker this Mac has but isn't running, started after asking.
mac_start() {
  m_name=$1
  agree "$m_name is on this Mac, but it isn't running. Start it now?" \
    "Docker is on this Mac, but it doesn't answer." \
    "Start it ($m_name) and run this again, or pass --yes to start it."
  if [ "$PLAN" = 1 ]; then t_step "$m_name isn't running: starting it, once you say yes (--yes doesn't ask)"; fi
  start_engine "$@"
}

# No Docker at all: Colima, its docker command and Compose with Homebrew (Homebrew first), then Colima started.
mac_colima() {
  agree "This Mac has no Docker. Install Colima (Docker's engine, open source, no window) with Homebrew and start it?" \
    "This installer runs agentes.chat on Docker, and this Mac doesn't have it." \
    "Install Docker Desktop, OrbStack or Colima, start it, and run this again (--yes installs Colima with Homebrew). Or, with no Docker, open the agentes.chat app: Use your own server, then Run agentes.chat on this Mac."
  BREW=$(command -v brew 2>/dev/null) || BREW=''
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -z "$BREW" ] && [ -x "$b" ]; then BREW=$b; fi
  done
  if [ "$PLAN" = 1 ]; then
    t_step "No Docker: installing Colima with Homebrew and starting it, once you say yes (--yes doesn't ask)"
  fi
  if [ -z "$BREW" ]; then
    if [ "$TTY" = /dev/null ]; then
      die "Installing Colima needs Homebrew, and Homebrew's installer needs a terminal to ask for your password." \
        "Run this in Terminal, or install Homebrew (https://brew.sh) or Docker Desktop, OrbStack or Colima, then run this again."
    fi
    fetch "$BREW_INSTALL" "$WORK/brew-install.sh" "Downloading Homebrew's install script"
    if [ "$PLAN" = 1 ]; then
      t_shell "/bin/bash $WORK/brew-install.sh"
      BREW=/opt/homebrew/bin/brew
    else
      t_info "Homebrew first: its installer asks for your password, and may install Apple's command line tools"
      /bin/bash "$WORK/brew-install.sh" </dev/tty >&"$T_FD" 2>&1 ||
        die "Homebrew's installer stopped (its output above)." "Install Homebrew (https://brew.sh), then run this again."
      BREW=/opt/homebrew/bin/brew
      if [ ! -x "$BREW" ]; then BREW=/usr/local/bin/brew; fi
      [ -x "$BREW" ] || die "Homebrew's installer ended, but brew isn't there." "Open a new Terminal and run this again."
      t_step "Homebrew, installed"
    fi
  fi
  PATH=${BREW%/brew}:$PATH
  export PATH
  if [ "$PLAN" = 1 ]; then
    t_shell "$BREW install colima docker docker-compose"
    t_shell "ln -sfn <brew>/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose"
  else
    t_run "Installing Colima, Docker's command line and Compose (Homebrew)" "$BREW" install colima docker docker-compose || {
      t_tail "$T_LOG"
      die "Homebrew couldn't install Colima (its last lines above)." "Fix what it says, then run this again."
    }
    # Docker finds Compose among its plugins.
    mkdir -p "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
    ln -sfn "$("$BREW" --prefix)/opt/docker-compose/bin/docker-compose" \
      "${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins/docker-compose"
    t_step "Colima, Docker's command line and Compose, installed with Homebrew"
  fi
  start_engine Colima colima start
}

# Docker's install script includes Compose, but distribution packages often don't (Debian 13's
# docker.io), or ship one older than the compose file needs.
compose_plugin() {
  have=$(compose_version)
  if [ -n "$have" ] && version_at_least "$have" "$MIN_COMPOSE"; then
    t_step "Compose $have"
    return 0
  fi
  if [ "$IS_ROOT" = 1 ]; then
    plugins=/usr/local/lib/docker/cli-plugins
  else
    plugins=${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins
  fi
  if [ "$PLAN" = 0 ]; then
    if [ -n "$have" ]; then t_warn "Compose $have is older than the $MIN_COMPOSE agentes.chat needs"; fi
  elif [ -n "$have" ]; then
    t_step "Compose $have is older than $MIN_COMPOSE: installing Compose $COMPOSE_VERSION (SHA-256 checked) in $plugins"
  else
    t_step "Docker has no Compose plugin: installing Compose $COMPOSE_VERSION (SHA-256 checked) in $plugins"
  fi
  fetch "https://github.com/docker/compose/releases/download/v$COMPOSE_VERSION/$COMPOSE_ASSET" "$WORK/docker-compose" \
    "Downloading Compose $COMPOSE_VERSION"
  verify "$WORK/docker-compose" "$COMPOSE_SHA256"
  run chmod 755 "$WORK/docker-compose"
  run mkdir -p "$plugins"
  run mv "$WORK/docker-compose" "$plugins/docker-compose"
  if [ "$PLAN" = 1 ]; then return 0; fi
  version_at_least "$(compose_version)" "$MIN_COMPOSE" ||
    die "Compose doesn't answer after installing it in $plugins." "See what docker compose version says, then run this again."
  t_step "Compose $COMPOSE_VERSION, installed in $plugins (SHA-256 checked)"
}

compose_version() {
  version=$(docker compose version --short </dev/null 2>/dev/null || :)
  version=${version#v}
  # Without the plugin, docker answers with its own usage.
  case $version in [0-9]*.[0-9]*) printf '%s' "$version" ;; esac
}

# Docker, or the agents' computer, needs root (ROOT_WHY, and ROOT_FIX without sudo): the same install again, as
# root. Under curl | sh, $0 is the shell and there is no file to run again, so it downloads the published installer.
as_root() {
  command -v sudo >/dev/null 2>&1 || die "$ROOT_WHY, and this computer has no sudo." "$ROOT_FIX"
  script=$0
  if is_installer "$script"; then
    t_info "$ROOT_WHY: running this installer again as root"
  else
    script=$WORK/install.sh
    t_info "$ROOT_WHY: downloading this installer to run it again as root"
    fetch "$INSTALL_URL" "$script" "Downloading this installer"
  fi
  # An install this user has keeps its folder: as root, the default folder is another one.
  if [ -z "$DIR_FLAG" ] && [ -f "${HOME:-}/agentes/.env" ]; then DIR_FLAG=$HOME/agentes; fi
  if [ -n "$DIR_FLAG" ]; then set -- --dir "$DIR_FLAG" "$@"; fi
  if [ "$YES" = 1 ]; then set -- --yes "$@"; fi
  t_shell "sudo sh $script $*"
  if [ "$PLAN" = 1 ]; then
    t_gap
    t_end "With --plan it stops here. As root, --plan shows the rest."
    exit 0
  fi
  if [ "$script" = "$0" ]; then rm -rf "$WORK"; fi
  exec sudo sh "$script" "$@"
}

# Whether $1 is this file (sh install.sh) rather than the shell reading it from a pipe.
is_installer() {
  [ -f "$1" ] || return 1
  { IFS= read -r _ && IFS= read -r second; } <"$1" || return 1
  [ "$second" = "# agentes.chat installer: a self-hosted agentes.chat on this computer, in one command." ]
}

get_bun() {
  if command -v bun >/dev/null 2>&1; then
    have=$(bun --version </dev/null 2>/dev/null || :)
    if version_at_least "$have" "$BUN_VERSION"; then
      BUN=$(command -v bun)
      t_step "Bun $have ($BUN)"
      return 0
    fi
  fi
  BUN=$DIR/.runtime/bun
  if [ -x "$BUN" ] && [ "$("$BUN" --version </dev/null 2>/dev/null || :)" = "$BUN_VERSION" ]; then
    t_step "Bun $BUN_VERSION ($BUN)"
    return 0
  fi
  if [ "$PLAN" = 1 ]; then
    t_step "Bun $BUN_VERSION, to run the setup: downloading it (SHA-256 checked) into $DIR/.runtime"
  fi
  fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$BUN_TARGET.zip" "$WORK/bun.zip" \
    "Downloading Bun $BUN_VERSION"
  verify "$WORK/bun.zip" "$BUN_SHA256"
  if [ "$PLAN" = 1 ] || command -v unzip >/dev/null 2>&1; then
    run unzip -q -o "$WORK/bun.zip" -d "$WORK"
  elif command -v python3 >/dev/null 2>&1; then
    run python3 -m zipfile -e "$WORK/bun.zip" "$WORK"
  else
    die "Unpacking Bun needs unzip or python3, and this computer has neither." \
      "Install unzip (apt-get install unzip, say) and run this again."
  fi
  run chmod 755 "$WORK/bun-$BUN_TARGET/bun"
  run mkdir -p "$DIR/.runtime"
  run mv "$WORK/bun-$BUN_TARGET/bun" "$BUN"
  if [ "$PLAN" = 1 ]; then return 0; fi
  [ "$("$BUN" --version </dev/null 2>/dev/null || :)" = "$BUN_VERSION" ] ||
    die "Bun $BUN_VERSION doesn't start on this computer." "The manual steps don't need it: $GUIDE"
  t_step "Bun $BUN_VERSION for the setup, in $DIR/.runtime (SHA-256 checked)"
}

# --- term.sh: packages/setup/src/term-sh.ts, kept equal by a test ---
# The agentes.chat look for the POSIX installers, as packages/setup/src/term.ts draws it: plain where a
# terminal can't take it (no color with NO_COLOR or TERM=dumb, ASCII marks and no logo on the Linux console), and
# no line, logo or animation when the output isn't a terminal (cloud-init, CI, the setup reading it). Only
# function definitions, so a download cut short runs nothing.

# t_init FD: everything goes to FD (1, or 2 when stdout is for --json), drawn for what that terminal shows.
t_init() {
  T_FD=$1 T_FRAME=0 T_OPEN=0 T_DEPTH=0 T_UNI=1 T_COLS=80 T_FOLD=0 T_LOG=''
  # A link in prose, without the punctuation after it.
  T_URL='https?://[^ <>"]*[^ <>".,:;)]'
  E=$(printf '\033')
  if [ "${TERM:-}" = linux ]; then T_UNI=0; fi
  if [ -t "$T_FD" ] && [ "${TERM:-dumb}" != dumb ]; then
    # A log keeps each line whole, for grep; a terminal gets them wrapped at its width.
    if command -v fold >/dev/null 2>&1; then T_FOLD=1; fi
    T_FRAME=1
    if [ -z "${NO_COLOR+x}" ]; then
      case ${COLORTERM:-} in
        truecolor | 24bit) T_DEPTH=24 ;;
        *) case ${TERM:-} in *256color*) T_DEPTH=256 ;; *) T_DEPTH=16 ;; esac ;;
      esac
    fi
    T_COLS=$( (stty size </dev/tty | cut -d ' ' -f 2) 2>/dev/null) || :
  fi
  case $T_COLS in '' | *[!0-9]*) T_COLS=80 ;; esac
  if [ "$T_COLS" -gt 80 ]; then T_COLS=80; fi
  if [ "$T_COLS" -lt 20 ]; then T_COLS=20; fi
  t_style
}

# The marks and the SGR codes for what t_init found; the line (T_B) once t_intro opens the frame.
t_style() {
  if [ "$T_UNI" = 1 ]; then
    M_START=┌ M_BAR=│ M_END=└ M_DONE=◇ M_ASK=◆ M_INFO=● M_WARN=▲ M_FAIL=■ M_SPIN=◒
  else
    M_START=+ M_BAR='|' M_END=+ M_DONE=o M_ASK='?' M_INFO='*' M_WARN='!' M_FAIL=x M_SPIN=-
  fi
  C_BOLD='' C_DIM='' C_ACC='' C_OK='' C_WARN='' C_FAIL='' C_OFF='' C_BADGE=''
  if [ "$T_DEPTH" != 0 ]; then
    C_BOLD="${E}[1m" C_DIM="${E}[2m" C_OK="${E}[32m" C_WARN="${E}[33m" C_FAIL="${E}[31m" C_OFF="${E}[0m"
    case $T_DEPTH in
      24) C_ACC="${E}[38;2;43;116;230m" C_BADGE="${E}[48;2;0;99;209;97m" ;;
      256) C_ACC="${E}[38;5;32m" C_BADGE="${E}[48;5;26;38;5;231m" ;;
      *) C_ACC="${E}[94m" C_BADGE="${E}[44;97m" ;;
    esac
  fi
  T_B=' '
  if [ "$T_OPEN" = 1 ]; then T_B="$C_DIM$M_BAR$C_OFF"; fi
}

# t_say MARK STYLE TEXT…: the mark, then the text wrapped under the line, in STYLE, its URLs in the accent.
t_say() {
  t_m=$1 t_s=$2
  shift 2
  printf '%s\n' "$*" | t_fold | while IFS= read -r t_l; do
    t_l=${t_l% }
    if [ -n "$C_ACC" ] && t_k=$( (printf '%s\n' "$t_l" | sed -E "s#$T_URL#$C_ACC&$C_OFF$t_s#g") 2>/dev/null); then
      t_l=$t_k
    fi
    if [ -z "$t_l" ]; then printf '%s\n' "$t_m"; else printf '%s  %s%s%s\n' "$t_m" "$t_s" "$t_l" "${t_s:+$C_OFF}"; fi
    t_m=$T_B
  done >&"$T_FD"
}

# t_fold [LEFT]: lines onto the width left beside the line, or beside LEFT columns (as they are, on a computer
# without fold).
t_fold() {
  if [ "$T_FOLD" = 1 ]; then
    fold -s -w $((T_COLS - ${1:-3}))
  else
    while IFS= read -r t_l; do printf '%s\n' "$t_l"; done
  fi
}

t_step() { t_say "$C_OK$M_DONE$C_OFF" '' "$*"; }   # ◇ done or checked
t_info() { t_say "$C_ACC$M_INFO$C_OFF" "$C_BOLD" "$*"; }   # ● to read or do
t_warn() { t_say "$C_WARN$M_WARN$C_OFF" '' "$*"; }   # ▲ not as hoped, but it goes on
t_line() { t_say "$T_B" '' "$*"; }   # prose under the line
t_note() { t_say "$T_B" "$C_DIM" "$*"; }   # quieter prose
# t_cmd COMMAND [LABEL]: a command or a link to copy, on a line of its own, never wrapped.
t_cmd() { printf '%s    %s%s%s%s\n' "$T_B" "${2:+$C_DIM$2$C_OFF  }" "$C_ACC" "$1" "$C_OFF" >&"$T_FD"; }
# t_shell COMMAND: a command this runs (--plan, a failure), whole.
t_shell() { printf '%s  %s$ %s%s\n' "$T_B" "$C_DIM" "$*" "$C_OFF" >&"$T_FD"; }
t_gap() { if [ "$T_OPEN" = 1 ]; then printf '%s\n' "$T_B"; else printf '\n'; fi >&"$T_FD"; }

# t_fail ERROR [FIX]: ■ what failed, then how to fix it, and the end of the frame. On stderr.
t_fail() {
  t_fd=$T_FD T_FD=2
  t_say "$C_FAIL$M_FAIL$C_OFF" "$C_BOLD" "$1"
  if [ $# -gt 1 ]; then t_say "$T_B" '' "$2"; fi
  t_stop
  T_FD=$t_fd
}

# └ Stopped where the frame is drawn. A log ends on the failure itself, so whatever reads its last line for
# the reason (the setup, a provisioner) finds it there.
t_stop() { if [ "$T_OPEN" = 1 ]; then t_end Stopped; fi; }

# t_end [TEXT]: └ and TEXT once the frame is open, which closes it; a log gets TEXT alone.
t_end() {
  if [ "$T_OPEN" = 1 ]; then
    T_OPEN=0 T_B=' '
    t_say "$C_DIM$M_END$C_OFF" '' "${1:-}"
  elif [ "$T_FRAME" = 0 ] && [ -n "${1:-}" ]; then
    printf '%s\n' "$1" >&"$T_FD"
  fi
}

# t_intro TITLE: the logo where it fits, then ┌ and the badge, and the line from here on. A log gets the title.
t_intro() {
  if [ "$T_FRAME" = 0 ]; then
    printf 'agentes.chat %s\n' "$1" >&"$T_FD"
    return 0
  fi
  if [ "$T_UNI" = 1 ] && [ "$T_COLS" -ge 64 ]; then t_logo; fi
  t_b=agentes.chat
  if [ "$T_DEPTH" != 0 ]; then t_b="$C_BADGE agentes.chat $C_OFF"; fi
  T_OPEN=1
  t_style
  # The title beside the badge's columns, its wrap under the line.
  t_m="$C_DIM$M_START$C_OFF  $t_b"
  printf '%s\n' "$1" | t_fold 18 | while IFS= read -r t_l; do
    printf '%s %s\n' "$t_m" "${t_l% }"
    t_m="$T_B "
  done >&"$T_FD"
  printf '%s\n' "$T_B" >&"$T_FD"
}

# The logo. The mark: the agent of packages/ui/src/agent/engine.js on the 12×12 grid of the web's LogoMark,
# rows of pixels where 0-4 are its body's tones (deep to light), w its eyes and . nothing. Beside it,
# "agentes" in pixels after Funnel Display Light. Two rows of pixels make one line of ▀▄█.
t_logo() {
  printf '\n' >&"$T_FD"
  t_row=0
  set -- ..43434343.. .3333333332. '                         ▄' \
    333333333233 232323232223 ' ▄▄▄   ▄▄▄▄  ▄▄▄  ▄ ▄▄  ▄█▄▄  ▄▄▄   ▄▄▄▄' \
    3232w23w3222 2222w22w2212 ' ▄▄▄█ █   █ █▄▄▄█ █▀  █  █   █▄▄▄█ ▀▄▄▄' \
    2222w22w2122 121212121112 '█   █ █   █ █     █   █  █   █         █' \
    212121212111 111111111101 ' ▀▀▀▀  ▀▀▀█  ▀▀▀▀ ▀   ▀   ▀▀  ▀▀▀▀ ▀▀▀▀' \
    11111111101. 0101010100.. '       ▀▀▀'
  while [ $# -ge 3 ]; do
    t_top=$1 t_bot=$2 t_word=$3
    shift 3
    t_line=''
    while [ -n "$t_top" ]; do
      t_cell "${t_top%"${t_top#?}"}" "${t_bot%"${t_bot#?}"}"
      t_line=$t_line$t_c
      t_top=${t_top#?} t_bot=${t_bot#?}
    done
    t_row=$((t_row + 1))
    if [ "$t_row" = 5 ]; then t_word="$t_word $C_DIM.chat$C_OFF"; fi
    printf '  %s%s   %s\n' "$t_line" "$C_OFF" "$t_word" >&"$T_FD"
  done
  printf '\n' >&"$T_FD"
}

# t_cell TOP BOTTOM: two pixels as one character, in $t_c.
t_cell() {
  if [ "$T_DEPTH" = 0 ]; then
    # One color: the body, its eyes left out (the mono logo).
    case $1$2 in
      [0-4][0-4]) t_c='█' ;;
      [0-4]?) t_c='▀' ;;
      ?[0-4]) t_c='▄' ;;
      *) t_c=' ' ;;
    esac
    return 0
  fi
  case $1$2 in
    ..) t_c=' ' ;;
    ?.) t_tone 38 "$1" && t_c="${E}[0;${t_n}m▀" ;;
    .?) t_tone 38 "$2" && t_c="${E}[0;${t_n}m▄" ;;
    *)
      t_tone 38 "$1"
      t_f=$t_n
      t_tone 38 "$2"
      if [ "$t_n" = "$t_f" ]; then
        t_c="${E}[0;${t_f}m█"
      else
        t_tone 48 "$2"
        t_c="${E}[0;$t_f;${t_n}m▀"
      fi
      ;;
  esac
}

# t_tone LAYER PIXEL: the SGR parameter of a pixel's tone as foreground (38) or background (48), in $t_n.
t_tone() {
  case $T_DEPTH in
    24)
      case $2 in
        0) t_n='0;61;130' ;; 1) t_n='0;99;209' ;; 2) t_n='70;147;232' ;; 3) t_n='140;195;255' ;;
        4) t_n='198;225;255' ;; *) t_n='255;255;255' ;;
      esac
      t_n="$1;2;$t_n"
      ;;
    256)
      case $2 in 0) t_n=25 ;; 1) t_n=26 ;; 2) t_n=68 ;; 3) t_n=111 ;; 4) t_n=189 ;; *) t_n=231 ;; esac
      t_n="$1;5;$t_n"
      ;;
    *)
      # Blue for the deep tones, bright blue for the light ones, bright white for the eyes.
      case $1$2 in
        380 | 381) t_n=34 ;; 38w) t_n=97 ;; 38?) t_n=94 ;; 480 | 481) t_n=44 ;; 48w) t_n=107 ;; *) t_n=104 ;;
      esac
      ;;
  esac
}

# t_ask QUESTION: yes or no on the terminal (Enter is yes); it stays as ◇ QUESTION Yes or No.
t_ask() {
  t_fd=$T_FD T_FD=3
  {
    t_say "$C_ACC$M_ASK$C_OFF" "$C_BOLD" "$1"
    printf '%s  %s(Y/n)%s ' "$C_ACC$M_BAR$C_OFF" "$C_DIM" "$C_OFF" >&3
  } 3>/dev/tty
  T_FD=$t_fd
  read -r t_a </dev/tty || t_a=n
  case $t_a in '' | [Yy]*) t_a=Yes ;; *) t_a=No ;; esac
  if [ "$T_FRAME" = 1 ]; then
    t_n=$(printf '%s\n' "$1" | t_fold | wc -l) || t_n=1
    printf '%s[%dA\r%s[J' "$E" $((t_n + 1)) "$E" >/dev/tty
  fi
  t_say "$C_OK$M_DONE$C_OFF" '' "$1 $t_a"
  [ "$t_a" = Yes ]
}

# t_run LABEL COMMAND…: COMMAND under a spinner with the seconds beside LABEL, its output kept in $T_LOG (in
# $T_LOGS when set) for t_tail; its exit status. The spinner turns beside COMMAND, not COMMAND beside it: a
# command sent to the background ignores Ctrl-C, which this way reaches COMMAND as from the terminal, then stops
# this with "Canceled". Without a terminal: LABEL once, and COMMAND's output in the log as it comes.
t_run() {
  t_label=$1
  shift
  if [ "$T_FRAME" = 0 ]; then
    t_say "$M_SPIN" '' "$t_label"
    "$@" >&"$T_FD" 2>&1 </dev/null
    return
  fi
  T_LOG=$(mktemp "${T_LOGS:-${TMPDIR:-/tmp}}/agentes-log.XXXXXX" 2>/dev/null) || T_LOG=/dev/null
  t_spin "$$" "$t_label" &
  t_sp=$!
  trap 't_unspin; t_say "$C_FAIL$M_FAIL$C_OFF" "" Canceled; t_end; exit 130' INT TERM HUP
  t_rc=0
  "$@" >"$T_LOG" 2>&1 </dev/null || t_rc=$?
  trap - INT TERM HUP
  t_unspin
  if [ "$t_rc" = 0 ] && [ "$T_LOG" != /dev/null ]; then rm -f "$T_LOG"; fi
  return "$t_rc"
}

t_unspin() {
  kill "$t_sp" 2>/dev/null || :
  wait "$t_sp" 2>/dev/null || :
  printf '\r%s[2K' "$E" >&"$T_FD"
}

# t_spin PID LABEL: the spinner, drawn every 0.2 s while PID (the installer) runs.
t_spin() {
  t_i=0 t_t0=$(date +%s)
  t_lab=$(printf '%s' "$2" | cut -c "1-$((T_COLS - 12))")
  while kill -0 "$1" 2>/dev/null; do
    case $T_UNI$((t_i % 4)) in
      10) t_f=◒ ;; 11) t_f=◐ ;; 12) t_f=◓ ;; 13) t_f=◑ ;; 00) t_f=- ;; 01) t_f=\\ ;; 02) t_f='|' ;; *) t_f=/ ;;
    esac
    t_s=$(($(date +%s) - t_t0)) t_time=''
    if [ "$t_s" -ge 60 ]; then
      t_time="  $C_DIM$((t_s / 60))m $((t_s % 60 / 10))$((t_s % 10))s$C_OFF"
    elif [ "$t_s" -ge 3 ]; then
      t_time="  $C_DIM${t_s}s$C_OFF"
    fi
    printf '\r%s[2K%s  %s%s' "$E" "$C_ACC$t_f$C_OFF" "$t_lab" "$t_time" >&"$T_FD"
    sleep 0.2 2>/dev/null || sleep 1
    t_i=$((t_i + 1))
  done
}

# t_tail FILE: the last lines of a failed command's output, quiet, under the line.
t_tail() {
  if [ -f "$1" ]; then tail -n 12 "$1" | tr -d '\r' | while IFS= read -r t_l; do t_note "$t_l"; done; fi
}
# --- end of term.sh ---

main "$@"
