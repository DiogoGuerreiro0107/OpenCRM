# Fase 2 — Itens de trabalho, agenda e menu (plano, 2026-11-19)

Terceira fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.4 e §3.10), depois das Fases 0 e 1. Junta também
a peça §3.5 dos [módulos adicionais](plano-modulos-adicionais.md): o **registo de contribuições da interface**.

**Objetivo:** as tarefas passam a ser o «item de trabalho» (`WorkItem`) que a agenda e o menu veem. Os tipos de tarefa
(hoje uma lista fixa em código) passam a ser **configuráveis**, e cada tipo pode ter **passos**, **campos próprios** e
**página no menu**. As assistências (Fase 4), as encomendas (Fase 6) e as propostas internas (Fase 8) vão ser tipos de
item de trabalho com dados próprios ligados 1:1.

## O que existe hoje
- `Task`: título, descrição, estado (`PENDING`/`IN_PROGRESS`/`DONE`), tipo opcional de uma lista fixa (`TaskType`: chamada,
  email, visita, proposta, cobrança, assistência, outro), prioridade, resultado, prazo, responsável, ligação a
  empresa/contacto/negócio/lead e lembretes. Lista paginada com pesquisa e calendário do mês (pacote anterior).
- Quem usa as tarefas: a página Tarefas, as fichas (empresa, contacto, negócio, lead), as automações (regra «tarefas do
  negócio concluídas»), a criação de leads (cria a tarefa de primeiro contacto, também pela API pública), o dashboard
  (de hoje e atrasadas) e a timeline (concluir uma tarefa regista o evento nos registos ligados).
- O menu é uma lista fixa em `AppShell.tsx`, e as rotas em `App.tsx`. Os cartões de módulos nas fichas (Email,
  Chamadas) estão escritos à mão em cada ficha.
- Os fluxos genéricos (Fase 0c) só servem negócios; a regra de dois adiou as rotas genéricas `/workflows` até haver um
  segundo tipo com fluxos.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **2a — Tipos configuráveis e modelo `WorkItem`** | `Task` → `WorkItem`, tipos em tabela (`WorkItemType`) e configuráveis, estado «cancelada», página Configurações > Tipos de tarefa | Médio (renomeia a tabela das tarefas; a API não muda de caminho) |
| **2b — Passos, campos e página por tipo** | Passos opcionais por tipo (fluxo genérico), campos personalizados por tipo, quadro por passos e lista de cada tipo | Médio |
| **2c — Registo de contribuições e menu configurável** | Os módulos registam menu, rotas (carregadas à parte), cartões nas fichas e widgets; o administrador ordena, renomeia, agrupa e oculta itens do menu; tipos com «aparece no menu» | Médio (mexe em todas as páginas de módulo) |
| **2d — Agenda** | Página Agenda (mês, semana e dia), com horário marcado além do prazo, filtros por tipo e responsável, e uma segunda fonte (próxima ação das leads) | Baixo a médio |

A ordem é a da tabela: o 2b precisa dos tipos, o 2c do «aparece no menu» e o 2d das fontes de agenda do registo.

---

## Pacote 2a — Tipos configuráveis e modelo `WorkItem`

### Modelo
- **`Task` passa a `WorkItem`** (tabela, chaves, índices, triggers e `Reminder.taskId` → `workItemId`), numa só migração
  transacional e **sem copiar dados**: os ids mantêm-se, como em `Pipeline` → `Workflow` (0c).
  - **A API não muda de caminho:** `/tasks` continua a ser a rota dos itens de trabalho, e a interface continua a dizer
    «Tarefas». Na timeline, o tipo de registo continua a ser `TASK`.
- **`WorkItemType`** (tabela nova): `key` (código estável e único, p. ex. `VISITA`), `name`, `icon`, `color`,
  `isSystem`, `active`, `sortOrder`.
  - A migração cria os 7 tipos da lista atual e um tipo **«Tarefa»** (`TAREFA`), que é o **tipo por omissão**.
  - **Todo o item tem tipo** (`typeId` obrigatório): os que hoje não têm ficam «Tarefa». Simplifica filtros, cores e o menu,
    e é o que as assistências e encomendas vão precisar.
  - O enum `TaskType` desaparece (expandir → migrar → contrair na mesma migração; uma só instância).
- **Estado `CANCELLED`** («cancelada»), igual à categoria `CANCELLED` dos passos (0c): uma visita desmarcada não é uma
  tarefa concluída.
  - «Em aberto» passa a ser `PENDING` ou `IN_PROGRESS` em todo o lado: atrasadas, de hoje, dashboard, regra de
    automação «tarefas do negócio concluídas» (uma cancelada já não a bloqueia).
  - Cancelar **não** regista «Tarefa concluída» na timeline: regista «Tarefa cancelada».

### Regras dos tipos
- **Configuração só do Administrador** (como os campos personalizados), com auditoria. Ler a lista é para todos (os
  formulários precisam dela).
- Os tipos **de sistema** (os 8 da migração e, mais tarde, os criados por módulos) podem ser renomeados, mudar de ícone e
  de cor e ser **desativados**, mas **não apagados**; o tipo por omissão não se desativa.
- Um tipo personalizado só se apaga **sem itens**; com itens, desativa-se (como os campos personalizados).
- **Desativar** esconde o tipo dos formulários de criação; os itens existentes mantêm-no e continuam a aparecer e a
  filtrar-se.
- A `key` é gerada a partir do nome ao criar e **não muda** depois (é o que os filtros guardados, as integrações e os
  módulos usam). Renomear muda só o `name`.
- O ícone vem de uma lista fechada (nomes do `lucide-react` que a interface conhece); a cor de uma paleta fechada.
  Nada de SVG ou CSS livre vindo da base de dados.
- Lista curta de configuração: devolvida completa, sem paginação (regra das listagens).

### API
- `GET /work-item-types` (todos; `?active=true` para os formulários), `POST`, `PATCH /:id`, `DELETE /:id`,
  `PATCH /work-item-types/order`.
- `/tasks`: o campo `type` (enum) passa a `typeId` na escrita e a `type { id, key, name, icon, color }` na leitura; filtro
  `typeId`. Criar sem `typeId` usa o tipo por omissão. Um tipo desativado é recusado ao criar (400) e aceite em itens que
  já o têm.
- A API pública não expõe tarefas (nada muda nela). Os webhooks de saída também não têm eventos de tarefas.
- Tempo real: `work-item-types` como recurso novo; os formulários atualizam a lista sozinhos.

### Interface
- **Configurações > Tipos de tarefa** (Administrador): lista ordenável com nome, ícone, cor, ativo, número de itens;
  criar, editar, desativar e apagar (com a regra acima).
- Formulário da tarefa: o tipo passa a vir da lista ativa (com o tipo atual mesmo que desativado); estado «Cancelada».
- Lista de tarefas e calendário: o tipo aparece com o ícone e a cor; filtro por tipo.

### Validação prevista
- **Migração ensaiada numa cópia da base de desenvolvimento**, com contagens antes e depois (itens por tipo antigo =
  itens por tipo novo; lembretes, ligações e timeline intactos) e **reversão** testada (`prisma/rollbacks/`).
- Migração sem desvio face ao esquema (`prisma migrate diff`).
- **e2e:** CRUD dos tipos e permissões (só Administrador escreve; todos leem); regras (sistema não se apaga, por omissão
  não se desativa, apagar com itens recusado, desativado recusado ao criar e aceite ao editar); `key` estável ao
  renomear; tarefas com `typeId` e filtro; estado cancelado fora de «atrasadas», «hoje», dashboard e regra de
  automação; timeline de cancelar; triggers (`searchText`, `dueSort`) a funcionar depois de renomear.
- **Prova por mutação** nas regras de tipos e no «em aberto».
- **Browser** (base de testes): página dos tipos, criar uma tarefa com um tipo novo, filtrar, cancelar.

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 2b — Passos, campos e página por tipo
- `WorkItemType.workflowId` opcional: um tipo **com passos** usa um `Workflow` do tipo `WORK_ITEM` (segunda entidade
  do registo de fluxos → a regra de dois manda generalizar agora as rotas `/workflows`).
  - Num tipo com passos, o item tem `stepId` e o **estado deriva da categoria do passo**, gravado na mesma escrita (a
    agenda e as listas continuam a filtrar só pelo estado, com os índices de hoje).
  - Dar passos a um tipo com itens põe cada item no primeiro passo da categoria do seu estado; tirá-los mantém o estado.
- **Campos personalizados por tipo:** `CustomField` ganha um âmbito opcional (`scopeId` = tipo), e `WORK_ITEM` entra no
  registo de entidades com a área `dailyWork`.
- **Página de cada tipo:** lista (a de hoje, filtrada) e, se tiver passos, **quadro por passos** (arrastar muda o passo;
  sem ordem manual dentro da coluna, que fica por prazo). Paginação por coluna como no kanban.

### 2c — Registo de contribuições e menu configurável
- Cada módulo do frontend regista as suas **contribuições**: itens de menu, rotas (carregadas à parte), cartões nas
  fichas de empresa/contacto/negócio/lead e widgets do dashboard. O núcleo mostra-as só com o módulo ativo e a
  permissão. Os 5 módulos atuais passam a usá-lo (Email e Chamadas deixam de estar escritos nas fichas).
- **Menu configurável pelo Administrador** (decisão D5): ordem, nome, grupos e ocultar; os tipos com «aparece no menu»
  ganham um item. O servidor guarda só as preferências por id de item (`GET`/`PUT /menu-settings`); os itens e as rotas
  vivem no código do frontend, e o backend continua a impor módulos e permissões em cada rota. (Desvio ao §3.10, que
  previa um `GET /menu` já filtrado: o servidor não conhece as rotas do frontend.)

### 2d — Agenda
- **Horário marcado** opcional (`scheduledStart`, `scheduledEnd`) além do prazo: uma visita tem hora marcada, uma tarefa
  tem prazo. A agenda mostra o horário quando existe, senão o prazo.
- Página **Agenda**: mês (a grelha atual), semana e dia; filtros por tipo e responsável (ver a agenda de um colega).
  Intervalo limitado e número de itens por dia limitado com «+N», como no calendário atual.
- **Fontes da agenda** no registo de contribuições: os itens de trabalho e a **próxima ação das leads** (segunda fonte
  real; as férias e as visitas dos mapas juntam-se depois).

## Decisões assumidas (a rever)
- Renomear `Task` → `WorkItem` na base de dados e no código, mantendo `/tasks` e «Tarefas» para quem usa (como na 0c).
- Todo o item tem tipo; «Tarefa» é o tipo por omissão.
- Estado «cancelada» novo.
- Menu: o administrador define (D5); a personalização por utilizador fica para depois.
- Fora desta fase: âmbitos de permissão («só as minhas»), tarefas recorrentes, SLA e notificações (pacote P).
