#!/bin/sh
# Start the stack, resolving the Claude token at launch.
#
#   docker/up.sh up --build    start it
#   docker/up.sh check         prove the token wiring works, and start nothing
#   docker/up.sh logs -f       anything else compose understands
#
# WHERE THE TOKEN LIVES: in your password manager, and nowhere else. Not in
# this repository, not in a dotfile, not in your shell profile. What the
# configuration holds is a COMMAND that prints it:
#
#   HELMSTED_TOKEN_CMD="security find-generic-password -s helmsted -a claude -w"
#
# That line is not a secret, which is the point — it can sit in a config file
# without the file needing to be protected, backed up carefully, or kept out of
# a directory you might one day zip up and send to someone.
#
# WHERE THAT LINE LIVES, in increasing precedence:
#
#   docker/.env                repo-local and gitignored. Fine, because it
#                              holds a pointer rather than a credential.
#   $HELMSTED_ENV              any path you like, outside the checkout. Set it
#                              in your shell profile and the repository holds
#                              no configuration of yours at all.
#   the environment            CLAUDE_CODE_OAUTH_TOKEN or HELMSTED_TOKEN_CMD
#                              already exported wins over both files.
#
# Both files are handed to compose, later winning, so ordinary settings like
# HELMSTED_DATA can live in either.
#
# WHAT THIS DOES NOT DO, and it matters: once the container is running the
# token is in its environment, and the staff have a shell. Anything in that box
# can read it, and so can `docker inspect` on the host. Secrecy is not the
# control. The control is that the factory sits on a network with no route to
# the internet except an allowlisted proxy. See SECURITY.md.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
local_env="$here/.env"
outside_env=${HELMSTED_ENV:-}

if [ -n "$outside_env" ] && [ ! -f "$outside_env" ]; then
  echo "helmsted: HELMSTED_ENV points at $outside_env, which does not exist." >&2
  exit 1
fi

# Read one key out of a config file without sourcing it. Sourcing would execute
# whatever else is in there, and a config file should not be a program.
from_file() {
  [ -f "$1" ] || return 0
  sed -n "s/^[[:space:]]*$2=//p" "$1" | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Only the subcommands that actually START something need a real token. Asking
# a password manager to unlock so you can read `logs`, or `down` a stack that
# is already running, trains you to unlock it without reading the prompt —
# which is the habit the password manager exists to prevent. Compose still
# interpolates the variable for every subcommand, so the others get a
# placeholder that never reaches a running container.
needs_token=no
subcommand=
for a in "$@"; do
  case $a in
    -*) continue ;;
    *) subcommand=$a ;;
  esac
  break
done
case $subcommand in
  up|run|start|restart|create|check) needs_token=yes ;;
esac

if [ "$needs_token" = no ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  CLAUDE_CODE_OAUTH_TOKEN=not-needed-for-this-command
  export CLAUDE_CODE_OAUTH_TOKEN
fi

if [ "$needs_token" = yes ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  cmd=${HELMSTED_TOKEN_CMD:-}
  [ -n "$cmd" ] || { [ -n "$outside_env" ] && cmd=$(from_file "$outside_env" HELMSTED_TOKEN_CMD); }
  [ -n "$cmd" ] || cmd=$(from_file "$local_env" HELMSTED_TOKEN_CMD)

  if [ -n "$cmd" ]; then
    # Runs with your shell and your tty, so a vault that wants a passphrase can
    # ask for one. Failure here must stop everything: starting without a token
    # gets you a company that wakes up, fails every shift, and logs it.
    if ! token=$(eval "$cmd"); then
      echo "helmsted: HELMSTED_TOKEN_CMD failed, so there is no token." >&2
      echo "  command: $cmd" >&2
      exit 1
    fi
    # Trim a trailing newline; most vault tools add one and the SDK will not.
    token=$(printf '%s' "$token" | tr -d '\r\n')
    if [ -z "$token" ]; then
      echo "helmsted: HELMSTED_TOKEN_CMD printed nothing." >&2
      echo "  command: $cmd" >&2
      exit 1
    fi
    CLAUDE_CODE_OAUTH_TOKEN=$token
    export CLAUDE_CODE_OAUTH_TOKEN
    # Length only. Enough to tell "the vault gave me something" from "the vault
    # gave me an error message", without putting any of it on your screen.
    echo "helmsted: token resolved from HELMSTED_TOKEN_CMD (${#token} characters)"
  fi
fi

# `check` exists so you can prove the wiring before trusting it with an
# overnight run: it does everything a start does right up to the point of
# starting anything. It prints a length, never a token.
if [ "$subcommand" = check ]; then
  if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    echo "helmsted: no token, and nothing configured to fetch one." >&2
    echo "  Set HELMSTED_TOKEN_CMD in $local_env${outside_env:+ or $outside_env}." >&2
    exit 1
  fi
  echo "helmsted: a token is available (${#CLAUDE_CODE_OAUTH_TOKEN} characters). Nothing was started."
  exit 0
fi

# Anything still unset is left to compose, which has its own message pointing
# at `claude setup-token`. A literal CLAUDE_CODE_OAUTH_TOKEN in either file
# still works — a command is a better default, not the only way.
#
# Naming any --env-file replaces the automatic docker/.env, so when both exist
# both are named. Spelling the three cases out keeps every path quoted, which
# matters the moment someone's home directory has a space in it.
compose() { exec docker compose -f "$here/compose.yaml" "$@"; }

if [ -n "$outside_env" ] && [ -f "$local_env" ]; then
  compose --env-file "$local_env" --env-file "$outside_env" "$@"
elif [ -n "$outside_env" ]; then
  compose --env-file "$outside_env" "$@"
else
  compose "$@"
fi
