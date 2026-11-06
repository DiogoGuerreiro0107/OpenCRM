# Plano: imagens Docker e arranque de produção (2026-11-06)

Seguimento do [plano de endurecimento](plano-endurecimento.md), onde se descobriu que **as imagens Docker nunca foram construíveis** — só o modo `pnpm dev` foi validado. Plano escrito antes de qualquer alteração.

## 1. Problemas encontrados (por leitura dos ficheiros)

| # | Problema | Consequência |
|---|---|---|
| 1 | Os 3 `Dockerfile` não copiam o `pnpm-lock.yaml`, mas usam `--frozen-lockfile` | O build falha |
| 2 | Imagens `node:20`; o `packageManager` pede pnpm 11.9, que exige Node ≥ 22.13 | `corepack`/pnpm não arrancam |
| 3 | Não existe `.dockerignore`; `COPY apps/backend` copia a pasta inteira | O `.env` (segredos) e `node_modules`/`dist` do Windows iriam **dentro da imagem** |
| 4 | Só se copiam alguns `package.json` do workspace | O `--frozen-lockfile` pode falhar por importers em falta |
| 5 | Nada aplica as migrações Prisma no compose | O backend arranca sobre uma base vazia e rebenta |
| 6 | Não há como criar o utilizador inicial no compose | Ninguém consegue entrar |
| 7 | `VITE_API_URL` é variável de **build** no Vite, mas o compose passa-a só em runtime | O frontend ficaria sempre a apontar a `http://localhost:3000` |
| 8 | Links de download de anexos assinados com o endereço interno `minio:9000` | O browser não resolve `minio` → anexos não abrem |
| 9 | Postgres publicado em `0.0.0.0:5432` com a password de exemplo | Base de dados acessível a toda a rede local |
| 10 | Portas fixas no compose | Impossível testar a stack de produção ao lado do ambiente de desenvolvimento |

## 2. Alterações

- **`.dockerignore`** na raiz: exclui `.env*`, `node_modules`, `dist`, `.git`, testes, docs (resolve #3).
- **Dockerfiles** (`node:22-alpine`): camada de dependências copia o `pnpm-lock.yaml` + os `package.json` de todo o workspace antes do código (resolve #1, #2, #4); backend corre `prisma generate` + `nest build`; frontend recebe `VITE_API_URL` como `ARG` de build (#7).
- **Migrações e seed:** serviço one-shot `migrate` no compose (imagem do estágio de build, que tem a CLI do Prisma) que corre `prisma migrate deploy`; o backend só arranca depois de concluir com sucesso (#5). O utilizador inicial cria-se com um comando documentado (`docker compose run --rm migrate pnpm --filter backend prisma:seed`) — não é automático para não ficar uma password por omissão em produção (#6).
- **Anexos:** novo `MINIO_PUBLIC_URL` (opcional) — o link de download é assinado com o endereço que o browser alcança; sem ele usa o endereço interno, como hoje (#8).
- **Rede:** Postgres passa a `127.0.0.1:5432` (o `pnpm dev` continua a funcionar; a rede local deixa de ver a base de dados) (#9); portas configuráveis por variável (`POSTGRES_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`) (#10).
- **CI:** novo job que constrói as 3 imagens, para os Dockerfiles não voltarem a apodrecer sem ninguém reparar.

## 3. Validação prevista

Subir a stack completa com um projeto compose à parte (`-p`), volumes novos, portas alternativas e um ficheiro de ambiente com **segredos gerados aleatoriamente** (fora do repositório; o `.env` do utilizador não é tocado): build das 3 imagens → migrações → seed → login via API → `GET` autenticado → frontend servido e a apontar ao backend certo → anexo: URL assinado com o endereço público. No fim, remover o projeto de teste e os seus volumes.

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Mexer no compose parte o `pnpm dev` | O `pnpm dev:setup` é re-executado no fim para confirmar que continua a funcionar |
| O teste de stack mexe nos contentores/dados reais do utilizador | Projeto compose com outro nome, outros volumes e outras portas; nada do `opencrm` real é tocado |
| Build lento / sem rede | Só se constrói localmente uma vez; o resto fica para o CI |

## 5. Fora de âmbito

HTTPS/Nginx e domínio interno, cópias de segurança dos volumes, atualização de imagens `latest` do MinIO para versões fixas, healthchecks dos serviços da app, gestão de utilizadores pela UI.

## 6. Registo de execução

- [ ] Alterações aplicadas
- [ ] Stack de produção validada de ponta a ponta
- [ ] PR
