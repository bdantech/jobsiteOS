# ─────────────────────────────────────────────────────────────────────────────
# @jobsiteos/worker — imagem multi-stage, ciente do workspace pnpm.
#
# The worker does NOT stand alone: it imports packages/core (the filter engine,
# the schemas, notify()). And core ships TypeScript source — it has no build step
# and no dist — so a Dockerfile that copied only apps/worker would produce an
# image that fails at `tsc` with "cannot find module". The workspace root
# manifests and packages/core come along, and pnpm links them exactly as it does
# on a laptop.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ─── deps: só os manifests, para o cache do Docker sobreviver a mudanças de código
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY apps/worker/package.json ./apps/worker/
# --filter …^... traz o worker E suas dependências de workspace (core).
RUN pnpm install --frozen-lockfile --filter @jobsiteos/worker...

# ─── build: tsc emite dist/apps/worker/** e dist/packages/core/**
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY apps/worker ./apps/worker
RUN pnpm --filter @jobsiteos/worker build

# ─── deploy: só produção
FROM base AS runner
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile --prod --filter @jobsiteos/worker...

COPY --from=build /app/apps/worker/dist ./apps/worker/dist

# Downloads are cached here. Railway mounts a volume on it — without one, a
# container restart in hour three of a Receita run starts the download from zero.
#
# We run as ROOT on purpose. Railway mounts the volume at runtime OVER this
# directory, owned by root:root — so a build-time `chown node:node` is shadowed
# by the mount and a non-root process gets EACCES the moment it tries to mkdir a
# month folder inside the volume. Dropping to `node` while writing to a
# root-owned volume is the two things not agreeing. This is an internal worker
# with no untrusted input reaching the filesystem (it downloads RFB zips and
# reads them), so running as root is an acceptable, standard Railway tradeoff.
ENV DOWNLOAD_DIR=/data/receita
RUN mkdir -p /data/receita

EXPOSE 8080

# Node runs the emitted JS. The relative import of packages/core resolves inside
# dist, which is why rootDir is the repo root (see apps/worker/tsconfig.json).
WORKDIR /app/apps/worker
CMD ["node", "dist/apps/worker/src/index.js"]
