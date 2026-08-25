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

exec "$@"
