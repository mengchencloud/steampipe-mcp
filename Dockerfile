FROM public.ecr.aws/docker/library/node:20-slim

WORKDIR /app

# Copy everything (node_modules included from zip)
COPY . .

# Build TypeScript if dist doesn't exist
RUN if [ ! -d "dist" ]; then npm run build; fi

ENV MCP_PORT=3000
ENV STEAMPIPE_MCP_WORKSPACE_DATABASE=postgresql://steampipe@localhost:9193/steampipe

EXPOSE 3000

CMD ["node", "dist/index.js", "--http"]
