FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared-types ./packages/shared-types
COPY apps/backend ./apps/backend
RUN pnpm install --frozen-lockfile --filter backend...

FROM deps AS build
RUN pnpm --filter backend run prisma:generate
RUN pnpm --filter backend run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
