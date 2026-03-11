# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --prod=false

# ============================================
# Stage 2: Build
# ============================================
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/ apps/api/
COPY packages/shared/ packages/shared/

RUN pnpm --filter @sercofi/shared run build 2>/dev/null || true
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api run build

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./

ENV NODE_ENV=production
ENV PORT=3000

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main.js"]
