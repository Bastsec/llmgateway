# Running LLMGateway with External PostgreSQL and Azure OpenAI

This guide explains how to run the unified LLMGateway container with an external PostgreSQL database and Azure OpenAI support.

## Prerequisites

- External PostgreSQL database (cloud-hosted or separate instance)
- Azure OpenAI resource with API access
- Docker and Docker Compose installed

## Setup Steps

### 1. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.unified.example .env
```

### 2. Configure External Database

Update the `DATABASE_URL` in your `.env` file:

```bash
DATABASE_URL=postgresql://username:password@your-db-host:5432/llmgateway
```

**Example for cloud databases:**

```bash
# Azure Database for PostgreSQL
DATABASE_URL=postgresql://admin@myserver:password@myserver.postgres.database.azure.com:5432/llmgateway?sslmode=require

# AWS RDS
DATABASE_URL=postgresql://admin:password@mydb.abc123.us-east-1.rds.amazonaws.com:5432/llmgateway

# DigitalOcean Managed Database
DATABASE_URL=postgresql://doadmin:password@mydb-do-user-123-0.db.ondigitalocean.com:25060/llmgateway?sslmode=require
```

### 3. Configure Azure OpenAI

Add your Azure OpenAI credentials to `.env`:

```bash
# Azure OpenAI API Key (from Azure Portal > Your Resource > Keys and Endpoint)
LLM_AZURE_API_KEY=your_azure_api_key_here

# Azure resource name (from your endpoint URL: https://<resource-name>.openai.azure.com)
LLM_AZURE_RESOURCE=your-resource-name

# API version (optional, defaults to 2024-10-21)
LLM_AZURE_API_VERSION=2024-10-21

# Deployment type (optional, defaults to ai-foundry)
# Options: "ai-foundry" (unified endpoint) or "openai" (deployment-based)
LLM_AZURE_DEPLOYMENT_TYPE=ai-foundry
```

#### Azure Deployment Types

**AI Foundry (Recommended):**

- Uses unified endpoint: `https://<resource>.openai.azure.com/openai/v1/chat/completions`
- Model name is sent in the request body
- Simpler configuration

**OpenAI (Traditional):**

- Uses deployment-specific endpoints: `https://<resource>.openai.azure.com/openai/deployments/<model>/chat/completions`
- Requires deployment names to match model names
- More granular control per deployment

### 4. Set Authentication Secret

Generate a secure random string for `AUTH_SECRET`:

```bash
# Generate a secure secret
openssl rand -base64 32
```

Add it to `.env`:

```bash
AUTH_SECRET=your_generated_secret_here
```

### 5. Initialize Database Schema

Before starting the container, ensure your external database has the required schema:

```bash
# If you have the repository locally, run migrations
pnpm install
pnpm run setup
```

Or manually run the SQL migrations from `packages/db/migrations/`.

### 6. Start the Gateway

Use the external database docker-compose file:

```bash
cd infra
docker compose -f docker-compose.unified.external-db.yml up -d
```

### 7. Verify Setup

Check the logs:

```bash
docker logs llmgateway -f
```

Access the services:

- UI: http://localhost:3002
- Playground: http://localhost:3003
- API: http://localhost:4002
- Gateway: http://localhost:4001
- Docs: http://localhost:3005

## Using Azure OpenAI Models

Once configured, Azure OpenAI models are available through the gateway. The system supports all Azure-hosted OpenAI models including:

- `gpt-4o-mini`
- `gpt-4o`
- `gpt-4`
- `gpt-35-turbo`
- `gpt-4-turbo`
- And other models available in your Azure deployment

### Making Requests

Use the OpenAI-compatible API with Azure models:

```bash
curl http://localhost:4001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "azure/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Note the `azure/` prefix in the model name to route requests to Azure OpenAI.

## Troubleshooting

### Database Connection Issues

1. Verify the `DATABASE_URL` format is correct
2. Ensure the database allows connections from your Docker host
3. Check firewall rules and security groups
4. For SSL connections, add `?sslmode=require` to the connection string

### Azure OpenAI Issues

1. **Invalid API Key**: Verify `LLM_AZURE_API_KEY` in Azure Portal
2. **Resource Not Found**: Check `LLM_AZURE_RESOURCE` matches your endpoint URL
3. **Deployment Not Found**: Ensure deployment type is correct (`ai-foundry` vs `openai`)
4. **API Version Error**: Try updating `LLM_AZURE_API_VERSION` to a supported version

### Container Logs

View detailed logs:

```bash
docker logs llmgateway --tail 100 -f
```

### Health Check

Test the gateway health endpoint:

```bash
curl http://localhost:4001/health
```

## Updating Configuration

To update environment variables:

1. Edit `.env` file
2. Restart the container:
   ```bash
   docker compose -f docker-compose.unified.external-db.yml restart
   ```

## Stopping the Gateway

```bash
docker compose -f docker-compose.unified.external-db.yml down
```

To remove volumes (Redis data):

```bash
docker compose -f docker-compose.unified.external-db.yml down -v
```

## Production Considerations

1. **Database Backups**: Ensure your external database has automated backups
2. **SSL/TLS**: Use `sslmode=require` for database connections
3. **Secrets Management**: Use Docker secrets or environment variable injection from your orchestration platform
4. **Monitoring**: Set up monitoring for both the gateway and database
5. **Resource Limits**: Configure Docker resource limits in production
6. **Reverse Proxy**: Use nginx or similar for SSL termination and load balancing
