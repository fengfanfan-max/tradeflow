# Build stage.
#
# The whole workspace is copied rather than just apps/api, because the API
# depends on @tradeflow/shared through the pnpm workspace — a filtered install
# cannot resolve a workspace dependency it does not have on disk.
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# Manifests first so the dependency layer is cached independently of source
# changes. This is the difference between a 20-second rebuild and a 3-minute one.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @tradeflow/api... --filter @tradeflow/shared

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# The Prisma client is generated into apps/api/src/generated and is not committed,
# so it has to be produced here, before the TypeScript build that imports it.
RUN pnpm --filter @tradeflow/shared build \
 && pnpm --filter @tradeflow/api exec prisma generate \
 && pnpm --filter @tradeflow/api exec nest build \
 && pnpm --filter @tradeflow/api --prod deploy --legacy /app

# Runtime stage.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run, App Runner and ECS all inject a port; 3001 is the local default.
ENV PORT=3001

# dumb-init reaps the child process and forwards signals, so `docker stop` does
# not wait out the full timeout.
RUN apk add --no-cache dumb-init

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
# prisma.config.ts and the migrations are read by `prisma migrate deploy`, which
# runs as a release step before the container starts serving.
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=build /repo/apps/api/package.json ./package.json

# Do not run as root.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/auth/session').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# Migrations run on the way up. `migrate deploy` is a no-op when the history is
# already current, so this is safe on every restart, and it removes a release
# step that App Runner has nowhere to put. It needs the Prisma CLI, which is why
# `prisma` is a dependency rather than a devDependency.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
