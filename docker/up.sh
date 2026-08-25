#!/bin/sh
# Start the stack, resolving the Claude token at launch.
#
#   docker/up.sh [--build] [any other compose arguments]
#   docker/up.sh down
#
# The problem this solves: compose needs CLAUDE_CODE_OAUTH_TOKEN, and the
# obvious way to give it one is to write the token into docker/.env. That file
# is gitignored, but it is still a long-lived credential sitting in plaintext
# inside a source tree — swept up by backups, by editor crash recovery, by
# whatever syncs your home directory, and by the next person who tars the repo
# to send it somewhere.
#
# So docker/.env holds a COMMAND instead. This runs it, captures what it
# prints, and hands that to compose through the environment. Nothing is
# written to disk, the token is never an argument so it stays out of `ps`, and
# it is never typed so it stays out of shell history.
#
# What this does NOT do, and it matters: once the container is running, the
# token is in its environment, and the staff have a shell. Anything in that box
# can read it. The thing that stops it leaving is not secrecy — it is that the
# factory sits on an internal network with no route to the internet except an
# allowlisted proxy. See SECURITY.md.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$here/.env"

# Read one key out of .env without sourcing it. Sourcing would execute
# whatever else is in there, and a config file should not be a program.
from_env_file() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" "$env_file" | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  cmd=${HELMSTED_TOKEN_CMD:-$(from_env_file HELMSTED_TOKEN_CMD)}

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

# Anything still unset is left to compose, which has its own message pointing
# at `claude setup-token`. A literal CLAUDE_CODE_OAUTH_TOKEN in docker/.env
# still works — this is a better default, not the only way.
exec docker compose -f "$here/compose.yaml" "$@"
