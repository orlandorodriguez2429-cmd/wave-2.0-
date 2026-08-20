# Wave 2.0 — single-container app image.
# Build:  docker compose build
# Run:    docker compose up   (see docker-compose.yml; brings Postgres too)
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first so Docker layer-caches them.
COPY package.json package-lock.json ./
# postinstall runs `prisma generate`, which needs the schema + config.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# Build the app. The dummy DATABASE_URL only satisfies module initialization
# at build time — nothing connects until runtime, where compose injects the
# real one.
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate && npm run build

# Runtime: wait for the DB, apply migrations, seed (idempotent), serve.
EXPOSE 3000
CMD ["sh", "scripts/docker-start.sh"]
