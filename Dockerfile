FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1
WORKDIR /app

# Copy installed node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY tsconfig.json ./

# These directories are written to at runtime — mount volumes to persist them
RUN mkdir -p transcripts data && chown -R bun:bun transcripts data

USER bun

CMD ["bun", "run", "src/index.ts"]
