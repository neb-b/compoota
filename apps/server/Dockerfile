FROM oven/bun:1-debian

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
RUN mkdir -p /data

EXPOSE 8787

CMD ["bun", "src/index.ts"]
