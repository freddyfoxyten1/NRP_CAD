FROM oven/bun:1
WORKDIR /app

COPY . .
RUN bun install
RUN bun run --cwd ./artifacts/api-server build

ENV NODE_ENV=production
ENV DATA_STORE=sql

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "./scripts/start-production-api.mjs"]
