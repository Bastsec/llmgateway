#!/bin/bash
set -e

echo "Starting LLMGateway external database container..."

# Create node user if it doesn't exist
if ! id "node" &>/dev/null; then
    adduser --system --shell /bin/sh --no-create-home node
fi

# Log directories already created at build time

# Wait for external database to be ready
echo "Waiting for external database to be ready..."
timeout=60
while [ $timeout -gt 0 ]; do
    if command -v pg_isready >/dev/null 2>&1; then
        # Extract host and port from DATABASE_URL
        DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        
        if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U postgres >/dev/null 2>&1; then
            echo "External database is ready!"
            break
        fi
    else
        # Fallback: try to connect with psql
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
    echo "ERROR: External database failed to become ready within 60 seconds"
    exit 1
fi

echo "Database connection verified. Migrations will be run by the API service."

# Start supervisord which will manage all processes
echo "Starting all services with supervisord..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
