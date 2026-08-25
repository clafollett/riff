# Egress allowlist proxy. Everything the factory reaches goes through here.
FROM alpine:3.22

RUN apk add --no-cache tinyproxy
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY allowlist.conf /etc/tinyproxy/allowlist.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /var/log/tinyproxy \
 && chown -R tinyproxy:tinyproxy /var/log/tinyproxy

EXPOSE 8888
ENTRYPOINT ["/entrypoint.sh"]
