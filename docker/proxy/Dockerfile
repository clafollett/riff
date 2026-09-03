# Egress proxy. Everything the factory reaches goes through here.
FROM alpine:3.22

RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY denylist.conf /etc/tinyproxy/denylist.conf
# The operator's own hosts, if they wrote any. The glob matches nothing when
# the file is absent, which is the whole point — COPY of a missing path fails.
COPY denylist.local.conf* /etc/tinyproxy/
COPY compile-denylist.sh /compile-denylist.sh
COPY entrypoint.sh /entrypoint.sh

# Compile the denylist into anchored regexes AT BUILD TIME.
#
# This used to happen on every start, which meant the proxy could not run on a
# read-only filesystem — it crash-looped trying to write its own filter. The
# list is baked into the image and never changes at run time, so there was
# never a reason to rebuild it on each boot.
RUN chmod +x /compile-denylist.sh /entrypoint.sh \
 && /compile-denylist.sh \
 && mkdir -p /var/log/tinyproxy \
 && chown -R tinyproxy:tinyproxy /var/log/tinyproxy /etc/tinyproxy

EXPOSE 8888
ENTRYPOINT ["/entrypoint.sh"]
