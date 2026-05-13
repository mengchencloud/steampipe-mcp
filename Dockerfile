FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

ENV MCP_PORT=3000
ENV STEAMPIPE_MCP_WORKSPACE_DATABASE=postgresql://steampipe@localhost:9193/steampipe

EXPOSE 3000

CMD ["node", "dist/index.js", "--http"]
