#!/bin/sh
# Compile the human-readable allowlist into anchored regexes.
# Anchoring matters: an unanchored "github.com" would also match
# "github.com.evil.example", which is the classic allowlist bypass.
set -eu

: > /etc/tinyproxy/filter.re
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  host=$(printf '%s' "$line" | tr -d '[:space:]')
  [ -z "$host" ] && continue
  escaped=$(printf '%s' "$host" | sed 's/\./\\./g')
  printf '^%s$\n' "$escaped" >> /etc/tinyproxy/filter.re
done < /etc/tinyproxy/allowlist.conf
