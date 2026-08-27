#!/bin/sh
# Compile the human-readable allowlist into anchored regexes.
# Anchoring matters: an unanchored "github.com" would also match
# "github.com.evil.example", which is the classic allowlist bypass.
set -eu

: > /etc/tinyproxy/filter.re

# allowlist.local.conf is the operator's own additions. It is gitignored, and
# optional — an installation that never writes one behaves exactly as before.
for src in /etc/tinyproxy/allowlist.conf /etc/tinyproxy/allowlist.local.conf; do
  [ -f "$src" ] || continue
  # `|| [ -n "$line" ]` keeps a final line that has no trailing newline. Without
  # it the last host is silently dropped, which reads as "the proxy is broken"
  # a week later rather than as a missing \n.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    host=$(printf '%s' "$line" | tr -d '[:space:]')
    [ -z "$host" ] && continue
    escaped=$(printf '%s' "$host" | sed 's/\./\\./g')
    printf '^%s$\n' "$escaped" >> /etc/tinyproxy/filter.re
  done < "$src"
done

# Two files may name the same host; tinyproxy does not care, but a duplicate
# in the startup listing makes the wall look wrong when it is not.
sort -u -o /etc/tinyproxy/filter.re /etc/tinyproxy/filter.re
