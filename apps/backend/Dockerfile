# pnpm 11 exige Node >= 22.13. O openssl é necessário ao motor do Prisma em Alpine.
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && apk add --no-cache openssl

# Dependências: camada em cache enquanto os manifestos e o lockfile não mudarem.
# Copiam-se os package.json de TODO o workspace para o --frozen-lockfile bater certo com o pnpm-lock.yaml.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/email-worker/package.json apps/email-worker/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter backend...

# Build. Este estágio também é usado pelo serviço "migrate" do compose (tem a CLI do Prisma e o ts-node).
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/backend apps/backend
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
