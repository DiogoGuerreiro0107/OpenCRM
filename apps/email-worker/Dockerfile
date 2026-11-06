FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/email-worker/package.json apps/email-worker/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --prod --filter email-worker...
COPY apps/email-worker apps/email-worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/apps/email-worker ./apps/email-worker
COPY --from=deps /app/node_modules ./node_modules
WORKDIR /app/apps/email-worker
CMD ["node", "src/index.mjs"]
