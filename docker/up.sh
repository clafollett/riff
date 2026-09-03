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
#   RIFF_TOKEN_CMD="pass show riff/claude-token"        # or op / keepassxc-cli
#   RIFF_TOKEN_CMD="secret-tool lookup service riff account claude"
#
# That line is not a secret, which is the point — it can sit in a config file
# without the file needing to be protected, backed up carefully, or kept out of
# a directory you might one day zip up and send to someone.
#
# WHICH TOKEN, and it decides whether the throttle works at all. A token from
# `claude setup-token` is long-lived and carries `user:inference` without
# `user:profile`, so the container can spend the subscription and cannot read
# what is left of it — every rate-limit window comes back empty, the throttle
# has nothing to pace on, and a run gets judged on token counts nobody is
# billed for. Your own login session has `user:profile`. Reading it instead
# costs an expiry: the access token lasts hours, so a run outliving it needs
# `up.sh` again, which picks up a fresh one.
#
#   macOS    RIFF_TOKEN_CMD='security find-generic-password \
#                              -s "Claude Code-credentials" -w \
#                            | jq -r .claudeAiOauth.accessToken'
#   Linux    RIFF_TOKEN_CMD='jq -r .claudeAiOauth.accessToken \
#                              "$HOME/.claude/.credentials.json"'
#   WSL      as Linux, against the credentials file inside WSL.
#
# The command is the portable part; only the store differs. Riff records
# `planVisible: no` on every shift taken with a token it cannot read the plan
# through, so this is visible rather than silent.
#
# WHERE THAT LINE LIVES, in increasing precedence:
#
#   docker/.env                repo-local and gitignored. Fine, because it
#                              holds a pointer rather than a credential.
#   $RIFF_ENV              any path you like, outside the checkout. Set it
#                              in your shell profile and the repository holds
#                              no configuration of yours at all.
#   the environment            CLAUDE_CODE_OAUTH_TOKEN or RIFF_TOKEN_CMD
#                              already exported wins over both files.
#
# Both files are handed to compose, later winning, so ordinary settings like
# RIFF_DATA can live in either.
#
# WHAT THIS DOES NOT DO, and it matters: once the container is running the
# token is in its environment, and the staff have a shell. Anything in that box
# can read it, and so can `docker inspect` on the host. Secrecy is not the
# control. The control is that the factory sits on a network with no route to
# the internet except an allowlisted proxy. See SECURITY.md.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
local_env="$here/.env"
outside_env=${RIFF_ENV:-}

if [ -n "$outside_env" ] && [ ! -f "$outside_env" ]; then
  echo "riff: RIFF_ENV points at $outside_env, which does not exist." >&2
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

# The credentials RECORD, when one is configured. Preferred over a bare token:
# it carries the subscription, which is what lets the runtime read how much of
# the plan is left instead of guessing from token counts nobody is billed for.
#
# Held in a variable and pushed onto the container's tmpfs after start. It is
# never written to host disk, never echoed, and dies with the container.
record=
if [ "$needs_token" = yes ]; then
  # Exported wins over both files, and that includes exporting it EMPTY: that
  # is how a caller says "not this way" without editing the operator's config.
  # Without it a test harness, or anyone with a record in docker/.env, cannot
  # exercise the bare-token path at all — and a test that reaches past its
  # fixtures into the real config resolves the operator's real credential.
  if [ -n "${RIFF_CREDENTIALS_CMD+set}" ]; then
    rcmd=${RIFF_CREDENTIALS_CMD}
  else
    rcmd=
    [ -n "$outside_env" ] && rcmd=$(from_file "$outside_env" RIFF_CREDENTIALS_CMD)
    [ -n "$rcmd" ] || rcmd=$(from_file "$local_env" RIFF_CREDENTIALS_CMD)
  fi
  if [ -n "$rcmd" ]; then
    if ! record=$(eval "$rcmd"); then
      echo "riff: RIFF_CREDENTIALS_CMD failed, so there is no credential." >&2
      echo "  command: $rcmd" >&2
      exit 1
    fi
    case $record in
      *claudeAiOauth*) ;;
      *) echo "riff: RIFF_CREDENTIALS_CMD printed something without a" >&2
         echo "  claudeAiOauth record in it. Expected the contents of" >&2
         echo "  ~/.claude/.credentials.json." >&2
         exit 1 ;;
    esac
    # Length only, same as the token path: enough to tell a credential from an
    # error message without putting any of it on your screen.
    echo "riff: credentials record resolved (${#record} characters)"
    RIFF_WAIT_FOR_CREDENTIALS=1
    export RIFF_WAIT_FOR_CREDENTIALS
  fi
fi

if [ "$needs_token" = yes ] && [ -z "$record" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  cmd=${RIFF_TOKEN_CMD:-}
  [ -n "$cmd" ] || { [ -n "$outside_env" ] && cmd=$(from_file "$outside_env" RIFF_TOKEN_CMD); }
  [ -n "$cmd" ] || cmd=$(from_file "$local_env" RIFF_TOKEN_CMD)

  if [ -n "$cmd" ]; then
    # Runs with your shell and your tty, so a vault that wants a passphrase can
    # ask for one. Failure here must stop everything: starting without a token
    # gets you a company that wakes up, fails every shift, and logs it.
    if ! token=$(eval "$cmd"); then
      echo "riff: RIFF_TOKEN_CMD failed, so there is no token." >&2
      echo "  command: $cmd" >&2
      exit 1
    fi
    # Trim a trailing newline; most vault tools add one and the SDK will not.
    token=$(printf '%s' "$token" | tr -d '\r\n')
    if [ -z "$token" ]; then
      echo "riff: RIFF_TOKEN_CMD printed nothing." >&2
      echo "  command: $cmd" >&2
      exit 1
    fi
    CLAUDE_CODE_OAUTH_TOKEN=$token
    export CLAUDE_CODE_OAUTH_TOKEN
    # Length only. Enough to tell "the vault gave me something" from "the vault
    # gave me an error message", without putting any of it on your screen.
    echo "riff: token resolved from RIFF_TOKEN_CMD (${#token} characters)"
  fi
fi

# `check` exists so you can prove the wiring before trusting it with an
# overnight run: it does everything a start does right up to the point of
# starting anything. It prints a length, never a token.
if [ "$subcommand" = check ]; then
  if [ -n "$record" ]; then
    echo "riff: a credentials record is available (${#record} characters)."
    echo "  The plan's own windows will be readable, so the throttle has a"
    echo "  figure to govern on. Nothing was started."
    exit 0
  fi
  if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    echo "riff: no credential, and nothing configured to fetch one." >&2
    echo "  Set RIFF_CREDENTIALS_CMD (preferred) or RIFF_TOKEN_CMD in" >&2
    echo "  $local_env${outside_env:+ or $outside_env}." >&2
    exit 1
  fi
  echo "riff: a bare token is available (${#CLAUDE_CODE_OAUTH_TOKEN} characters)."
  echo "  The plan will NOT be readable with it: rate limits come back empty,"
  echo "  the throttle has nothing to govern on, and shifts record"
  echo "  planVisible: no. Set RIFF_CREDENTIALS_CMD to fix that."
  echo "  Nothing was started."
  exit 0
fi

# Anything still unset is left to compose, which has its own message pointing
# at `claude setup-token`. A literal CLAUDE_CODE_OAUTH_TOKEN in either file
# still works — a command is a better default, not the only way.
#
# Naming any --env-file replaces the automatic docker/.env, so when both exist
# both are named. Spelling the three cases out keeps every path quoted, which
# matters the moment someone's home directory has a space in it.
# With a record to push, this cannot `exec` — there is work after compose
# returns, and the entrypoint is blocked waiting for exactly that work.
if [ -n "$record" ]; then
  compose() { docker compose -f "$here/compose.yaml" "$@"; }
else
  compose() { exec docker compose -f "$here/compose.yaml" "$@"; }
fi

run_compose() {
  if [ -n "$outside_env" ] && [ -f "$local_env" ]; then
    compose --env-file "$local_env" --env-file "$outside_env" "$@"
  elif [ -n "$outside_env" ]; then
    compose --env-file "$outside_env" "$@"
  else
    compose "$@"
  fi
}

run_compose "$@" || exit $?

# Push the record in. The home directory is a tmpfs created with the container,
# so this cannot happen before start — the entrypoint waits for it rather than
# letting companies wake with no credentials.
if [ -n "$record" ]; then
  waited=0
  until printf '%s' "$record" \
      | run_compose exec -T factory sh -c \
          'mkdir -p "$HOME/.claude" && cat > "$HOME/.claude/.credentials.json" \
           && chmod 600 "$HOME/.claude/.credentials.json"' 2>/dev/null; do
    waited=$((waited + 1))
    if [ "$waited" -ge 30 ]; then
      echo "riff: could not hand the credentials record to the factory." >&2
      exit 1
    fi
    sleep 1
  done
  echo "riff: credentials delivered to the factory (tmpfs only, never on disk)"
fi
