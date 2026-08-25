#!/bin/sh
# First boot founds the company; every boot after that finds it already there.
# init.ts is idempotent, so this is safe to run unconditionally.
set -eu

node scripts/init.ts

# The Desk and the shifts are separate concerns and fail separately. If the
# scheduler dies the console must stay up, because the console is how you find
# out the scheduler died.
if [ "${HELMSTED_RUN_SHIFTS:-1}" = "1" ]; then
  node scripts/run-overnight.ts "${HELMSTED_UNTIL_HOUR:-}" "${HELMSTED_MAX_SHIFTS:-}" &
fi

exec "$@"
