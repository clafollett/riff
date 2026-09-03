#!/bin/sh
# The filter was compiled into the image at build time, so this only reports
# what the wall lets through and starts the proxy. Nothing here writes to the
# filesystem, which is what lets the container run read-only.
set -eu

echo "egress denylist ($(wc -l < /etc/tinyproxy/filter.re | tr -d ' ') hosts refused, everything else allowed):"
sed 's/^/  /' /etc/tinyproxy/filter.re

exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
