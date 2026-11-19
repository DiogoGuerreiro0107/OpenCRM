# Paginação e pesquisa nas listagens (plano, 2026-11-19)

Pedido: **onde houver, ou puder vir a haver, listagens muito compridas, introduzir paginação e pesquisa.** Continua o
pacote dos seletores com pesquisa (docs/plano-seletores-com-pesquisa.md): ali deixaram de se descarregar listas
completas para *escolher* um registo; aqui deixam de se descarregar para as *ver*.

## Levantamento

| Listagem | Hoje | Cresce com |
|---|---|---|
| Empresas (página) | `GET /companies` devolve todas | clientes |
| Contactos (página e ficha da empresa) | `GET /contacts` devolve todos; a ficha da empresa inclui todos os contactos dela | clientes |
| Tarefas (lista e calendário) | `GET /tasks` devolve todas, incluindo as concluídas de sempre | tempo |
| Negócios (kanban) | `GET /deals?pipelineId` devolve todos os do funil, incluindo ganhos e perdidos de sempre; sem `pipelineId` devolve **todos** | tempo |
| Email (caixa e secção da ficha) | `GET /email/messages` devolve todas as mensagens | tempo |
| Timeline (ficha de cada registo) | `GET /timeline` devolve todo o histórico do registo | tempo |
| Chamadas (ficha) | `GET /zadarma/calls` devolve todas | tempo |
| Dashboard (por funil) | lê **todos** os negócios para os contar em memória | tempo |

Já paginadas: leads (1b), auditoria, entregas de webhooks, API pública. Ficam completas por serem configuração curta:
funis e fases, utilizadores, chaves de API, campos personalizados, modelos de email, automações, subscrições de webhooks.

## Desenho

**Contrato único.** As rotas mantêm o caminho, mas passam **sempre** a devolver uma página
`{ items, nextCursor }`, com `limit` (1–100, por omissão 50) e `cursor`. Nenhuma rota de listagem fica sem limite.
- Cursor opaco por **chave** (os valores da ordenação + id), como nas leads, para que a página 100 custe o mesmo que a primeira. Um cursor inválido devolve a primeira página.
- No frontend, um hook comum sobre `useInfiniteQuery` e o botão «Carregar mais» (como nas leads), com o número de linhas mostradas.
- A pesquisa nas páginas tem atraso de 300 ms; o cache em tempo real continua a funcionar, porque as chaves continuam a começar pelo nome da entidade.

**Por listagem:**
- **Empresas e contactos:** ordem (nome, id). Pesquisa e filtros como hoje, sem acentos.
  - Os seletores passam a usar `items` da primeira página.
  - A ficha da empresa deixa de trazer os contactos todos e mostra-os pela rota paginada, com pesquisa (`companyId`).
- **Tarefas:** lista por (prazo, sem prazo no fim; criação mais recente; id), com **pesquisa** (título e descrição, sem acentos).
  - O calendário usa uma rota própria limitada ao intervalo visível: `GET /tasks/calendar?from&to`, com o intervalo obrigatório e no máximo 62 dias.
- **Kanban:** cada coluna é paginada à parte (ordem da coluna, id), 30 cartões de cada vez, com «Mostrar mais» no fundo.
  - Os totais da coluna (número e valor) vêm do servidor (`GET /deals/summary`), não da soma do que está carregado.
  - **Pesquisa** no quadro (título do negócio, empresa, contacto, sem acentos).
  - Com pesquisa ativa não se arrasta: a posição de um cartão só faz sentido na coluna completa.
  - Arrastar com a coluna incompleta funciona: os cartões carregados são sempre o início da coluna, por isso a posição largada é a mesma na coluna toda.
  - **Os negócios novos entram no topo da coluna** (hoje entram no fundo), para aparecerem logo, mesmo numa coluna com muitas páginas.
  - `pipelineId` passa a ser obrigatório.
- **Email:** por (data, id) decrescente, com pesquisa na caixa (assunto, remetente e destinatários, sem acentos).
- **Timeline e chamadas:** por data decrescente, com «Ver mais».
  - Sem pesquisa: são o histórico de um só registo, lido por ordem cronológica.
- **Dashboard:** contagens por funil com `groupBy` na base de dados, em vez de ler os negócios todos.

**Base de dados** (migração `20261119110000_paginacao_listagens`):
- Colunas `searchText` mantidas por trigger (como empresas e contactos) em `Task` (título, descrição), `Deal` (título) e `EmailMessage` (assunto, remetente, nome, destinatários), com índice GIN `pg_trgm`. Ficam escondidas da API pela omissão global do Prisma.
- Índices para a ordem de cada lista:
  - `Company(name, id)` e `Contact(name, id)`
  - `Task(dueDate, createdAt, id)`
  - `Deal(stageId, order, id)`
  - `EmailMessage(sentAt, id)`
  - `TimelineEvent(entityType, entityId, createdAt, id)`
  - `CallRecord(startedAt, id)`

## Validação prevista
- **e2e por listagem:**
  - Percorrer todas as páginas sem repetir nem saltar linhas, incluindo empates na chave (nomes iguais, prazos iguais, sem prazo).
  - Cursor inválido devolve a primeira página; `limit` fora de 1–100 dá 400.
  - Pesquisa sem acentos; o calendário recusa intervalos em falta ou maiores do que 62 dias.
  - Kanban: resumo por fase e mover dentro de uma coluna parcialmente carregada.
- **Prova por mutação** na chave dos cursores.
- **Medição** com muitas linhas na base de testes (tempo da primeira página e de uma página funda).
- **Browser:** cada ecrã com «Carregar mais», a pesquisa e o kanban (mostrar mais, arrastar, criar).

## Fora deste pacote
- `ZadarmaService` lê todos os contactos para identificar o número de uma chamada recebida. É uma pesquisa interna, não uma listagem, e fica anotada para quando a integração for revista.

## Execução (2026-11-19)

**Implementado como planeado**, com estes acertos encontrados na medição e no browser:
- **Contagem de contactos por empresa:** o `_count` do Prisma agregava a tabela de contactos inteira em cada página (156 ms com 200 000 contactos). Passou a contar só as empresas da página (15 ms).
- **Calendário:** 6 semanas podiam trazer milhares de tarefas (4 451 no ensaio, 434 ms), para a grelha mostrar 3 por dia.
  - O servidor devolve só as 3 primeiras de cada dia e a contagem de cada dia (para o «+N»), no fuso horário do browser (47 ms).
  - Acrescentou-se o filtro por responsável à lista e ao calendário.
- **Pesquisa no quadro:** o Prisma juntava empresa e contacto com `LEFT JOIN … OR`, o que percorria a coluna inteira (143 ms).
  - O `searchText` do negócio passou a incluir o da empresa e o do contacto (migração `20261119120000_pesquisa_negocios_empresa_contacto`), mantido por triggers quando estes mudam de nome, são desligados ou apagados (61 ms).
- **Mover no quadro:** renumerar a coluna fazia um UPDATE por cartão e mexia no `updatedAt` de todos os negócios da coluna, o que estragava as «oportunidades paradas» do dashboard. Passou a ser uma só instrução SQL que só muda o `order`.
- **dnd-kit:** desligar o arrasto trocava o array de sensores, o que dá aviso do React. Passou a desligar-se nos cartões (`SortableContext disabled`).

**Medição** (`scripts/bench-listagens`, por HTTP, ~1 milhão de linhas, mediana / p95 em ms; no Windows os tempos vêm em degraus de ~15,6 ms):

| Pedido | Mediana | p95 |
|---|---|---|
| Empresas, 1.ª página / página funda (10 000) | 15 / 30 | 21 / 34 |
| Empresas, pesquisa «sao joao» / seletor (20) | 32 / 31 | 32 / 33 |
| Ficha da empresa com 2 000 contactos | 15 | 23 |
| Contactos, 1.ª página / da empresa grande / pesquisa | 15 / 15 / 63 | 21 / 20 / 64 |
| Tarefas, 1.ª página / funda / atrasadas / pesquisa | 30 / 31 / 31 / 29 | 33 / 39 / 32 / 36 |
| Calendário (6 semanas, 129 tarefas devolvidas) | 47 | 58 |
| Kanban, coluna de 100 000 (30) / funda / resumo / pesquisa | 15 / 31 / 46 / 61 | 18 / 32 / 49 / 68 |
| Emails, 1.ª página / pesquisa | 15 / 15 | 22 / 21 |
| Timeline (50 000 do registo), 1.ª / funda | 15 / 30 | 22 / 33 |
| Chamadas, 1.ª página | 15 | 17 |
| Dashboard (contagens) | 109 | 134 |

**Validação:**
- **e2e:** 16 novos em `test/pagination.e2e-spec.ts`.
  - Percorrer todas as páginas de cada lista sem repetir nem saltar linhas, com empates na chave.
  - Pesquisa sem acentos.
  - Calendário: intervalo, 3 por dia, contagens, fuso e responsável.
  - Kanban: topo, resumo, mover numa coluna parcial sem mexer no `updatedAt`, pesquisa a acompanhar mudanças da empresa e do contacto.
  - Dashboard, limites e cursores inválidos.
  - `record-search` e `modules` atualizados ao novo formato.
- 4 testes unitários do cursor.
- **Prova por mutação:** 5 mutações, todas apanhadas (cursor `gte`, direção ignorada, chave das tarefas, negócios novos no fundo, renumerar pelo Prisma).
- Migrações sem desvio face ao esquema; aplicadas à base de desenvolvimento, com cópia de segurança antes.
- **Browser** (base de testes), em cada ecrã:
  - Empresas: 50 → 100 → 121, sem repetidos; pesquisa sem acentos.
  - Ficha da empresa: contactos, timeline e email com «Ver mais», e pesquisa nos 30 contactos.
  - Kanban: totais do servidor e «Mostrar mais»; pesquisa por empresa; arrasto bloqueado com pesquisa e ativo sem ela, para uma coluna parcial; negócio novo no topo.
  - Tarefas: lista paginada e pesquisa; calendário com «+N» e filtro por responsável.
  - Caixa de email: paginada e com pesquisa.
  - Contactos: paginados. Seletores a funcionar.
