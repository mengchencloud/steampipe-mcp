# ---- Build Stage ----
FROM node:20-slim AS builder

# Use Chinese mirrors for npm
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /app

# Install dependencies first (layer caching)
# --ignore-scripts to prevent prepare/build from running before source is copied
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Runtime Stage ----
FROM node:20-slim

# Use Aliyun mirror for apt (China region)
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources

# Install curl for healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Use Chinese npm mirror in runtime too
RUN npm config set registry https://registry.npmmirror.com

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser

WORKDIR /app

# Install production deps only (ignore prepare/build since we copy dist)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R appuser:appuser /app
USER appuser

# Environment defaults (override at runtime)
ENV MCP_PORT=3000
ENV STEAMPIPE_MCP_WORKSPACE_DATABASE=postgresql://steampipe@localhost:9193/steampipe
ENV NODE_ENV=production

EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:${MCP_PORT}/health || exit 1

# Use node directly (not npm start) for proper signal forwarding
CMD ["node", "dist/index.js", "--http"]
