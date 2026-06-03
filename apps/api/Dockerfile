# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build:
#   1) deps    — install workspace dependencies
#   2) builder — compile shared + API TypeScript artifacts
#   3) runtime — slim runtime node image with only production deps + dist
#
# Build context must be repository root.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ───────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Native build toolchain for bcrypt and any other native modules. Confined
# to this stage so the runtime image does not carry python/gcc.
RUN apk add --no-cache python3 make g++

# Copy lockfiles first for dependency cache efficiency.
COPY package.json package-lock.json ./
# Copy package manifests into their workspace locations.
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json

# Install ALL deps (including dev) so the next stage can run tsc.
RUN npm ci --workspaces --include-workspace-root


# ── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy node_modules from deps stage to skip a re-install
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy manifests and source required to build.
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

# Build all workspace outputs deterministically.
RUN cd packages/shared && npx tsc
RUN cd apps/api && npm run build

# Strip dev dependencies before copying node_modules into the runtime image.
# This drops typescript, ts-node, tsc-alias, vitest, eslint, @types/*, and
# other build-only deps that are pure bloat at runtime.
RUN npm prune --omit=dev --workspaces --include-workspace-root


# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Runtime needs only Node + the production node_modules. No build toolchain.
# We copy the manifests + production node_modules + compiled dist + the
# minimum static assets the API serves at runtime.

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Run as the unprivileged 'node' user that ships in node:20-alpine.
USER node

WORKDIR /app/apps/api

EXPOSE 4000

ENV NODE_ENV=production

# Direct node invocation against the compiled entry point. dotenv is loaded
# at runtime so .env files inside the container still work; in production
# the env vars usually come from the orchestrator (k8s, ECS, PM2) directly.
CMD ["node", "-r", "dotenv/config", "dist/src/index.js"]
