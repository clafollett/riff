#!/bin/sh
# Compile the human-readable denylist into anchored regexes.
#
# Anchoring still matters, in the other direction now: an unanchored
# "pastebin.com" would also match "notpastebin.com.example", refusing a host
# nobody meant to refuse. It no longer guards a bypass — it guards a surprise.
set -eu

: > /etc/tinyproxy/filter.re

# denylist.local.conf is the operator's own additions. It is gitignored, and
# optional — an installation that never writes one behaves exactly as before.
for src in /etc/tinyproxy/denylist.conf /etc/tinyproxy/denylist.local.conf; do
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
