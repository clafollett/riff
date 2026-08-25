#!/bin/sh
# The server founds a company when the installation is empty and resumes every
# company left running, so there is nothing to arrange here.
#
# This used to run init.ts and a scheduler of its own. Both are now the
# server's job, and running a second scheduler beside it would have woken
# every agent twice.
set -eu

# Fail loudly rather than writing a whole company somewhere it will not survive.
case "${HELMSTED_ROOT:-}" in
  /data*) ;;
  *) echo "HELMSTED_ROOT must live under the mounted volume; got '${HELMSTED_ROOT:-unset}'" >&2
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

      sudo chown -R $(id -u):$(id -g) "\${HELMSTED_DATA:-\$HOME/.helmsted}"

  or run the container as yourself, by adding to docker/.env:

      UID=\$(id -u)
      GID=\$(id -g)

  and uncommenting the \`user:\` line on the factory service in compose.yaml.

MSG
  exit 1
fi
rm -f /data/.write-test

exec "$@"
