FROM oven/bun:1
WORKDIR /app

COPY . .
RUN bun install
RUN bun run --cwd ./artifacts/api-server build

ENV NODE_ENV=production
ENV DATA_STORE=sql
EXPOSE 8080

CMD ["bun", "--cwd", "./artifacts/api-server", "start"]
