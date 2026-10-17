# syntax=docker/dockerfile:1.7
# Multi-target image for the web app, the worker and one-off migrations.
#
#   docker build --target web     -t tamashagah-web .
#   docker build --target worker  -t tamashagah-worker .
#   docker build --target migrate -t tamashagah-migrate .
#
# Build-time secrets are NOT needed: SKIP_ENV_VALIDATION lets `next build` import modules without a full environment.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# All dependencies (incl. dev) — also runs `prisma generate` through the postinstall script.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_OUTPUT=standalone \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SESSION_SECRET=build-only-secret-build-only-secret-build-only-secret
RUN pnpm build && pnpm build:worker

# ---------------------------------------------------------------------------
# Production-only node_modules for the worker (native/external packages the esbuild bundle imports at runtime).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------------------------------------------------------------------------
# One-off migration runner: only the Prisma CLI (version read from package.json), not the whole dev toolchain.
FROM base AS migrate
COPY package.json /tmp/package.json
RUN PRISMA_VERSION="$(node -p "require('/tmp/package.json').devDependencies.prisma")" \
 && DOTENV_VERSION="$(node -p "require('/tmp/package.json').devDependencies.dotenv")" \
 && npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" "dotenv@${DOTENV_VERSION}" \
 && rm /tmp/package.json
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS worker
ENV NODE_ENV=production SERVICE_NAME=worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# dist/worker = the queue worker; dist/scripts = operator tools (promote-user, check-storage), e.g.
#   docker compose exec worker node dist/scripts/promote-user.mjs you@example.com admin
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Scratch space for transcoding (source download + HLS output). A disk-backed volume in Compose, not RAM.
RUN mkdir -p /var/tmp/tamashagah && chown node:node /var/tmp/tamashagah
ENV WORKER_TMP_DIR=/var/tmp/tamashagah
USER node
CMD ["node", "--enable-source-maps", "dist/worker/index.mjs"]
