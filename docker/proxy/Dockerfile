# Egress allowlist proxy. Everything the factory reaches goes through here.
FROM alpine:3.22

RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY allowlist.conf /etc/tinyproxy/allowlist.conf
# The operator's own hosts, if they wrote any. The glob matches nothing when
# the file is absent, which is the whole point — COPY of a missing path fails.
COPY allowlist.local.conf* /etc/tinyproxy/
COPY compile-allowlist.sh /compile-allowlist.sh
COPY entrypoint.sh /entrypoint.sh

# Compile the allowlist into anchored regexes AT BUILD TIME.
#
# This used to happen on every start, which meant the proxy could not run on a
# read-only filesystem — it crash-looped trying to write its own filter. The
# allowlist is baked into the image and never changes at run time, so there was
# never a reason to rebuild it on each boot.
RUN chmod +x /compile-allowlist.sh /entrypoint.sh \
 && /compile-allowlist.sh \
 && mkdir -p /var/log/tinyproxy \
 && chown -R tinyproxy:tinyproxy /var/log/tinyproxy /etc/tinyproxy

EXPOSE 8888
ENTRYPOINT ["/entrypoint.sh"]
