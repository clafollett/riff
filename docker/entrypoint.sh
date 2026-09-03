#!/bin/sh
# The server founds a company when the installation is empty and resumes every
# company left running, so there is nothing to arrange here.
#
# This used to run init.ts and a scheduler of its own. Both are now the
# server's job, and running a second scheduler beside it would have woken
# every agent twice.
set -eu

# Fail loudly rather than writing a whole company somewhere it will not survive.
case "${RIFF_ROOT:-}" in
  /data*) ;;
  *) echo "RIFF_ROOT must live under the mounted volume; got '${RIFF_ROOT:-unset}'" >&2
     exit 1 ;;
esac

# Can we actually write to the mount?
#
# Docker Desktop maps ownership on bind mounts, so on macOS a directory owned
# by your account is writable by this container whatever uid it runs as. A
# rootful Linux daemon does no such mapping: the host directory keeps its own
# ownership, and this user cannot create anything in it. That surfaces as a
# confusing crash deep in a git call, so catch it here and say what to do.
if ! touch /data/.write-test 2>/dev/null; then
  cat >&2 <<MSG

  Cannot write to /data (running as uid $(id -u)).

  The host directory behind the mount is owned by someone else. On Linux,
  either give it to this user:

      sudo chown -R $(id -u):$(id -g) "\${RIFF_DATA:-\$HOME/.riff}"

  or run the container as yourself, by adding to docker/.env:

      UID=\$(id -u)
      GID=\$(id -g)

  and uncommenting the \`user:\` line on the factory service in compose.yaml.

MSG
  exit 1
fi
rm -f /data/.write-test

# Wait for the credentials record, when that is how this stack is being run.
#
# A bare token in CLAUDE_CODE_OAUTH_TOKEN can spend the subscription and cannot
# read what is left of it: the CLI has no subscription record to ask about, so
# every rate-limit window comes back empty and the throttle has nothing to pace
# on. The record carries the plan alongside the token and fixes that — but it
# only exists on a tmpfs that is created with this container, so `up.sh` has to
# push it in after we are already running.
#
# Starting the server first would mean the companies left running wake up,
# spend a shift with no credentials at all and log the failure. So block here.
# Nothing is running yet, and there is nothing to lose by waiting.
if [ "${RIFF_WAIT_FOR_CREDENTIALS:-}" = 1 ]; then
  creds="$HOME/.claude/.credentials.json"
  waited=0
  while [ ! -s "$creds" ]; do
    if [ "$waited" -ge 60 ]; then
      echo "riff: no credentials record after ${waited}s at $creds." >&2
      echo "  up.sh should have written one. Start again, or unset" >&2
      echo "  RIFF_WAIT_FOR_CREDENTIALS to run on CLAUDE_CODE_OAUTH_TOKEN alone." >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "riff: credentials record present after ${waited}s"
fi

exec "$@"
