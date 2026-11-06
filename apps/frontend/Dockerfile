FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/email-worker/package.json apps/email-worker/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter frontend...

FROM deps AS build
# No Vite, VITE_API_URL é lida na COMPILAÇÃO e fica embutida no JavaScript: tem de ser um argumento de build
# (definir só em runtime não tem efeito). Deve ser o endereço do backend visto a partir do BROWSER.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
COPY packages/shared-types packages/shared-types
COPY apps/frontend apps/frontend
RUN pnpm --filter frontend run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/apps/frontend/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
