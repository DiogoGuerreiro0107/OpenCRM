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
