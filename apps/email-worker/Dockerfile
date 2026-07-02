FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY apps/email-worker ./apps/email-worker
RUN pnpm install --frozen-lockfile --filter email-worker...

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/apps/email-worker ./apps/email-worker
COPY --from=deps /app/node_modules ./node_modules
WORKDIR /app/apps/email-worker
CMD ["node", "src/index.mjs"]
