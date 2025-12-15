#!/bin/bash
set -e

echo "Starting LLMGateway external database container..."

# Ensure DATABASE_URL is provided
if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set"
    exit 1
fi

# Create node user if it doesn't exist
if ! id "node" &>/dev/null; then
    adduser --system --shell /bin/sh --no-create-home node
fi

# Log directories already created at build time

# Wait for external database to be ready
echo "Waiting for external database to be ready..."
timeout=${DB_WAIT_TIMEOUT_SECONDS:-180}
while [ "$timeout" -gt 0 ]; do
    if command -v pg_isready >/dev/null 2>&1; then
        if pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
            echo "External database is ready!"
            break
        fi
    fi

    if command -v psql >/dev/null 2>&1; then
        if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
            echo "External database is ready!"
            break
        fi
    fi

    echo "Waiting for external database... ($timeout seconds remaining)"
    sleep 2
    timeout=$((timeout - 2))
done

if [ $timeout -le 0 ]; then
    echo "ERROR: External database failed to become ready within ${DB_WAIT_TIMEOUT_SECONDS:-180} seconds"
    exit 1
fi

echo "Database connection verified. Migrations will be run by the API service."

# Start supervisord which will manage all processes
echo "Starting all services with supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
