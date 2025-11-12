# syntax=docker/dockerfile:1-labs
FROM debian:12-slim AS base-builder

# Install base dependencies including tini for better caching
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    curl \
    bash \
    tar \
    xz-utils \
    ca-certificates \
    tini \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && /usr/bin/tini --version

# Install asdf version manager
ENV ASDF_VERSION=v0.18.0
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}
ENV PATH="${ASDF_DIR}:${ASDF_DATA_DIR}/shims:$PATH"

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi && \
    wget -q https://github.com/asdf-vm/asdf/releases/download/${ASDF_VERSION}/asdf-${ASDF_VERSION}-linux-${ARCH}.tar.gz -O /tmp/asdf.tar.gz && \
    mkdir -p $ASDF_DIR && \
    tar -xzf /tmp/asdf.tar.gz -C $ASDF_DIR && \
    rm /tmp/asdf.tar.gz

# Create app directory
WORKDIR /app

COPY .tool-versions ./

# Install asdf plugins and tools
RUN cat .tool-versions | cut -d' ' -f1 | grep "^[^\#]" | xargs -i asdf plugin add  {} && \
    asdf install && \
    asdf reshim && \
    echo "Final versions installed:" && \
    node -v && \
    pnpm -v

# verify that pnpm store path
RUN STORE_PATH="/root/.local/share/pnpm/store" && \
    if [ "${STORE_PATH#/root/.local/share/pnpm/store}" = "${STORE_PATH}" ]; then \
        echo "pnpm store path mismatch: ${STORE_PATH}"; \
        exit 1; \
    fi && \
    echo "pnpm store path matches: ${STORE_PATH}"

# Builder for API
FROM base-builder AS api-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=api... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=api

# Builder for Gateway
FROM base-builder AS gateway-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=gateway... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=gateway

# Builder for UI
FROM base-builder AS ui-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=ui... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=ui

# Builder for Playground
FROM base-builder AS playground-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=playground... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=playground

# Builder for Worker
FROM base-builder AS worker-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=worker... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=worker

# Builder for Docs
FROM base-builder AS docs-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=docs... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=docs

FROM debian:12-slim AS runtime

# Install base runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    supervisor \
    redis-server \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy source code, asdf, nodejs, pnpm, and tini from base-builder stage
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /usr/bin/tini /tini
COPY --from=base-builder /app/.tool-versions ./.tool-versions
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}

# Set working directory and configure PATH to include tool directories
WORKDIR /app

# Configure PATH to use asdf shims
ENV PATH="${ASDF_DIR}:${ASDF_DIR}/shims:$PATH"

ENTRYPOINT ["/tini", "--"]

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# API preparation stage
FROM api-builder AS api-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=api --prod deploy --legacy /app/api-dist

# API runtime stage
FROM runtime AS api
WORKDIR /app
COPY --from=api-prep /app/api-dist ./
# copy migrations files for API service to run migrations at runtime
COPY --from=api-builder /app/packages/db/migrations ./migrations
COPY --from=base-builder /app/.tool-versions ./
EXPOSE 4002
ENV PORT=4002
ENV NODE_ENV=production
ENV TELEMETRY_ACTIVE=true
CMD ["node", "--enable-source-maps", "dist/serve.js"]

# Gateway preparation stage
FROM gateway-builder AS gateway-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=gateway --prod deploy --legacy /app/gateway-dist

# Gateway runtime stage
FROM runtime AS gateway
WORKDIR /app
COPY --from=gateway-prep /app/gateway-dist ./
COPY --from=base-builder /app/.tool-versions ./
EXPOSE 4001
ENV PORT=4001
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/serve.js"]

# UI preparation stage
FROM ui-builder AS ui-prep
WORKDIR /app
COPY --from=ui-builder /app/apps/ui/.next/standalone/ /app/ui-dist/

# UI runtime stage
FROM runtime AS ui
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=ui-prep /app/ui-dist ./

EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/ui
CMD ["node", "server.js"]

# Playground preparation stage
FROM playground-builder AS playground-prep
WORKDIR /app
COPY --from=playground-builder /app/apps/playground/.next/standalone/ /app/playground-dist/

# Playground runtime stage
FROM runtime AS playground
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=playground-prep /app/playground-dist ./

EXPOSE 3003
ENV PORT=3003
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/playground
CMD ["node", "server.js"]

# Docs preparation stage
FROM docs-builder AS docs-prep
WORKDIR /app
COPY --from=docs-builder /app/apps/docs/.next/standalone/ /app/docs-dist/

# Docs runtime stage
FROM runtime AS docs
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=docs-prep /app/docs-dist ./

EXPOSE 3005
ENV PORT=3005
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/docs
CMD ["node", "server.js"]

# Worker preparation stage
FROM worker-builder AS worker-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=worker --prod deploy --legacy /app/worker-dist

# Worker runtime stage
FROM runtime AS worker
WORKDIR /app
COPY --from=worker-prep /app/worker-dist ./
COPY --from=base-builder /app/.tool-versions ./
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/index.js"]

# Final unified stage for external DB
FROM runtime AS unified-external-db

# Install Redis for internal caching
RUN apt-get update && apt-get install -y --no-install-recommends redis-server && rm -rf /var/lib/apt/lists/* && \
    # Ensure redis user exists (should be created by package, but verify)
    id redis >/dev/null 2>&1 || adduser --system --group --no-create-home redis

# Copy asdf environment
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /app/.tool-versions /app/.tool-versions

# Copy all built applications
COPY --from=api /app /app/api
COPY --from=gateway /app /app/gateway
COPY --from=ui /app /app/ui
COPY --from=playground /app /app/playground
COPY --from=docs /app /app/docs
COPY --from=worker /app /app/worker

# Copy supervisor configuration
COPY infra/supervisord.external-db.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script
COPY infra/start.external-db.sh /start.sh
RUN chmod +x /start.sh

# Create necessary directories
RUN mkdir -p /var/log/supervisor /var/lib/redis && \
    chown redis:redis /var/lib/redis && \
    chmod 755 /var/lib/redis

# Expose all ports
EXPOSE 3002 3003 3005 4001 4002 6379

# Set asdf environment variables
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=/root/.asdf
ENV PATH="/root/.asdf:/root/.asdf/shims:$PATH"

# Set environment variables
ENV NODE_ENV=production
ENV REDIS_HOST=localhost
ENV REDIS_PORT=6379
ENV TELEMETRY_ACTIVE=true

# Use tini as init system
ENTRYPOINT ["/tini", "--"]

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Start services
CMD ["/start.sh"]

# Final unified stage for Azure Container Apps (external DB & Redis)
FROM runtime AS unified-azure

# Copy asdf environment
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /app/.tool-versions /app/.tool-versions

# Copy all built applications
COPY --from=api /app /app/api
COPY --from=gateway /app /app/gateway
COPY --from=ui /app /app/ui
COPY --from=playground /app /app/playground
COPY --from=docs /app /app/docs
COPY --from=worker /app /app/worker

# Use azure-specific supervisor configuration without bundled Redis
COPY infra/supervisord.azure.conf /etc/supervisor/conf.d/supervisord.conf

# Re-use startup script to wait for Postgres and launch supervisor
COPY infra/start.external-db.sh /start.sh
RUN chmod +x /start.sh && \
    mkdir -p /var/log/supervisor

# Expose application ports (Redis provided externally)
EXPOSE 3002 3003 3005 4001 4002

ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=/root/.asdf
ENV PATH="/root/.asdf:/root/.asdf/shims:$PATH"

ENV NODE_ENV=production
ENV TELEMETRY_ACTIVE=true

ENTRYPOINT ["/tini", "--"]

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

CMD ["/start.sh"]
