# The factory floor.
#
# Agents get real tools here — bash, git, a package manager, a compiler — which
# is the only way they build anything worth reviewing. The safety is not a
# shrinking tool allowlist (agents route around those, and it becomes a
# blocklist you maintain forever); it is this boundary plus the egress proxy in
# compose.yaml.
FROM node:26-slim

# Build tooling the staff will actually need. Kept deliberately small — add per
# line of business rather than pre-installing a kitchen sink.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep jq less procps tini \
 && rm -rf /var/lib/apt/lists/*

# The Agent SDK drives the Claude Code runtime; install it in the image so no
# agent ever needs to fetch its own toolchain at run time.
RUN npm install -g --no-fund --no-audit @anthropic-ai/claude-code@latest

# Never root. An agent with a shell should not also have the box.
RUN useradd -m -u 10001 -s /bin/bash labs \
 && mkdir -p /world /app \
 && chown -R labs:labs /world /app

WORKDIR /app
COPY --chown=labs:labs package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit || npm install --omit=dev --no-fund --no-audit
COPY --chown=labs:labs . .

USER labs

ENV NODE_ENV=production \
    INN_HOME=/world \
    PORT=4173 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

EXPOSE 4173

# tini reaps the processes agents spawn; without it a runaway build leaves
# zombies behind for the life of the container.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/gateway/server.ts"]
