# Coolify-compatible Dockerfile (no experimental syntax)
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

# Single unified builder stage (builds everything at once)
FROM base-builder AS unified-builder
WORKDIR /app

# Copy package files first for better caching
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build all applications
RUN pnpm run build --filter=api --force && \
    pnpm run build --filter=gateway --force && \
    pnpm run build --filter=ui --force && \
    pnpm run build --filter=playground --force && \
    pnpm run build --filter=docs --force && \
    pnpm run build --filter=worker --force

# Prepare production deployments
RUN pnpm --filter=api --prod deploy --legacy /app/api-dist && \
    pnpm --filter=gateway --prod deploy --legacy /app/gateway-dist && \
    pnpm --filter=worker --prod deploy --legacy /app/worker-dist

# Runtime base
FROM debian:12-slim AS runtime

# Install base runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    supervisor \
    redis-server \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy asdf and tini from builder
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /usr/bin/tini /tini
COPY --from=base-builder /app/.tool-versions ./.tool-versions

ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}

WORKDIR /app

# Configure PATH to use asdf shims
ENV PATH="${ASDF_DIR}:${ASDF_DIR}/shims:$PATH"

ENTRYPOINT ["/tini", "--"]

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Final unified stage for external DB
FROM runtime AS unified-external-db

# Ensure redis user exists
RUN id redis >/dev/null 2>&1 || adduser --system --group --no-create-home redis

# Copy asdf environment
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /app/.tool-versions /app/.tool-versions

# Copy API
COPY --from=unified-builder /app/api-dist /app/api
COPY --from=unified-builder /app/packages/db/migrations /app/api/migrations

# Copy Gateway
COPY --from=unified-builder /app/gateway-dist /app/gateway

# Copy Worker
COPY --from=unified-builder /app/worker-dist /app/worker

# Copy UI (Next.js standalone)
COPY --from=unified-builder /app/apps/ui/.next/standalone /app/ui

# Copy Playground (Next.js standalone)
COPY --from=unified-builder /app/apps/playground/.next/standalone /app/playground

# Copy Docs (Next.js standalone)
COPY --from=unified-builder /app/apps/docs/.next/standalone /app/docs

# Copy supervisor configuration
COPY infra/supervisord.external-db.conf /etc/supervisor/conf.d/supervisord.conf

# Copy startup script
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
