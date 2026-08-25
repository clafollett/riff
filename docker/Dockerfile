# The factory floor.
#
# Agents get real tools here — bash, git, a package manager, a compiler — which
# is the only way they build anything worth reviewing. The safety is not a
# shrinking tool allowlist (agents route around those, and it becomes a
# blocklist you maintain forever); it is this boundary plus the egress proxy in
# compose.yaml.

# ---------------------------------------------------------------- desk build
# Vite and Vue live in devDependencies, and the runtime image installs
# production deps only. Building here keeps the toolchain out of the shipped
# image while still shipping a built console.
FROM node:26-slim AS desk
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-fund --no-audit
COPY desk ./desk
RUN npx vite build --config desk/vite.config.ts

# ------------------------------------------------------------------- runtime
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
 && mkdir -p /data /app \
 && chown -R labs:labs /data /app

WORKDIR /app
COPY --chown=labs:labs package*.json ./
RUN npm ci --omit=dev --no-fund --no-audit
COPY --chown=labs:labs . .
COPY --chown=labs:labs --from=desk /app/desk/dist ./desk/dist
COPY --chown=labs:labs docker/entrypoint.sh /entrypoint.sh

USER labs

# git refuses to commit without an identity, and the world is a git repo that
# every shift writes to. Individual commits are attributed per agent.
RUN git config --global user.name  "Helmsted" \
 && git config --global user.email "helmsted@localhost" \
 && git config --global init.defaultBranch main \
 && git config --global --add safe.directory '*'

# HELMSTED_ROOT is the INSTALLATION root — companies/ and archive/ live under
# it. It must point at the mounted volume: set to a path outside the mount and
# every company is written to the container's own filesystem and destroyed on
# the next restart, silently.
#
# HELMSTED_CONTAINED opens the shell. The runtime also requires a container
# marker file, so this variable on its own does nothing on someone's laptop.
ENV NODE_ENV=production \
    HELMSTED_ROOT=/data \
    HELMSTED_CONTAINED=1 \
    PORT=4173 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

EXPOSE 4173

# tini reaps the processes agents spawn; without it a runaway build leaves
# zombies behind for the life of the container.
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "src/gateway/server.ts"]
