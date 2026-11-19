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
- **`WorkItemType`** (tabela nova): `id` = **código estável** (p. ex. `VISITA`; não muda depois de criado), `name`,
  `icon`, `color`, `isSystem`, `active`, `sortOrder`. Sendo o id o código, o tipo por omissão é o valor por omissão
  da coluna (`typeId` = `TAREFA`), sem ser preciso procurá-lo.
  - A migração cria os 7 tipos da lista atual e um tipo **«Tarefa»** (`TAREFA`), que é o **tipo por omissão**. Os
    tipos de sistema estão também em código, e o arranque da aplicação repõe os que faltem (nunca altera os existentes).
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
- O código (id) é gerado a partir do nome ao criar e **não muda** depois (é o que os filtros guardados, as integrações e os
  módulos usam). Renomear muda só o `name`.
- O ícone vem de uma lista fechada (nomes do `lucide-react` que a interface conhece); a cor de uma paleta fechada.
  Nada de SVG ou CSS livre vindo da base de dados.
- Lista curta de configuração: devolvida completa, sem paginação (regra das listagens).

### API
- `GET /work-item-types` (todos; `?active=true` para os formulários), `POST`, `PATCH /:id`, `DELETE /:id`,
  `PATCH /work-item-types/order`.
- `/tasks`: o campo `type` (enum) passa a `typeId` na escrita e a `type { id, name, icon, color }` na leitura; filtro
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
  não se desativa, apagar com itens recusado, desativado recusado ao criar e aceite ao editar); código estável ao
  renomear; tarefas com `typeId` e filtro; estado cancelado fora de «atrasadas», «hoje», dashboard e regra de
  automação; timeline de cancelar; triggers (`searchText`, `dueSort`) a funcionar depois de renomear.
- **Prova por mutação** nas regras de tipos e no «em aberto».
- **Browser** (base de testes): página dos tipos, criar uma tarefa com um tipo novo, filtrar, cancelar.

### Execução do 2a (2026-11-19)
**Implementado como planeado**, com um acerto: o id do tipo é o próprio código estável (ver «Modelo»), em vez de um
id e de uma `key` à parte.
- **Migração** `20261119130000_itens_de_trabalho`, ensaiada numa cópia da base de desenvolvimento:
  - impressão digital de cada linha (título, prazo, estado, responsável, tipo, `searchText`, `dueSort`) igual antes e
    depois; tarefas com tipo mapeadas para o tipo com o mesmo código, as sem tipo para «Tarefa»;
  - lembretes e ligações intactos; o trigger renomeado continua a calcular a pesquisa e a ordem;
  - reversão (`prisma/rollbacks/20261119130000_itens_de_trabalho.down.sql`) até ao mesmo esquema, salvo a posição da
    coluna `type`, que passa a ser a última;
  - sem desvio face ao `schema.prisma`; aplicada à base de desenvolvimento, com cópia de segurança antes.
- **Os tipos de sistema** estão na migração e em código (`src/work-item-types/system-types.ts`). O arranque repõe os
  que faltem, e o `resetDatabase` dos testes também (limpa todas as tabelas).
- **e2e:** 12 novos em `test/work-items.e2e-spec.ts` e 1 em `test/automations.e2e-spec.ts` (cancelar a última tarefa
  em aberto dispara a regra «tarefas concluídas»). Total: 261 unitários e 407 e2e, todos a passar.
- **Prova por mutação:** 7 mutações, todas apanhadas: cancelada como «em aberto», apagar tipo do sistema, desativar o
  tipo por omissão, aceitar tipo desativado, código repetido, cancelar sem timeline, apagar tipo com tarefas.
- **Browser** (base de testes): criar o tipo «Instalação de rede» (código `INSTALACAO_DE_REDE`) e subi-lo na ordem;
  diálogos com as regras certas (sistema não se apaga, por omissão não se desativa, tipo com tarefas não se apaga);
  lista de tarefas com o tipo e filtro por tipo (incluindo desativados); o formulário de uma tarefa nova não mostra os
  desativados e começa em «Tarefa»; a de um tipo desativado mantém-no e cancela-se; calendário com a cor de cada tipo
  e as canceladas riscadas.

---

## Pacote 2b — Passos, campos e página por tipo (plano, 2026-11-19)

### Modelo
- **`WorkItemType.workflowId`** (opcional, único): um tipo **com passos** tem um `Workflow` próprio, de `entityType`
  `WORK_ITEM` (segunda entrada do registo de fluxos). Um tipo sem `workflowId` funciona como hoje (só estado).
- **`WorkItem.stepId`** (opcional, `onDelete: Restrict`, com índice). Num tipo com passos, todo o item tem passo e o
  **estado deriva da categoria do passo**, gravado na mesma escrita:
  `OPEN` → `PENDING`, `IN_PROGRESS` → `IN_PROGRESS`, `DONE` → `DONE`, `CANCELLED` → `CANCELLED`. As listas, o
  calendário, o dashboard e as automações continuam a olhar só para o estado (com os índices de hoje).
- **Integridade na base de dados:** um trigger em `WorkItem` recusa um passo que não seja do fluxo do tipo do item, ou um
  estado que não corresponda à categoria do passo. O serviço valida antes (400 com mensagem); o trigger é a rede de
  segurança contra um erro de programação.
- **`CustomField.scopeId`** (texto, `""` = sem âmbito): nos campos de `WORK_ITEM`, `""` = todas as tarefas e um id de
  tipo = só as tarefas desse tipo. A unicidade passa a `(entityType, scopeId, fieldName)`. Texto vazio e não `NULL`
  porque no Postgres um `NULL` não colide numa chave única (dois campos «Equipamento» em empresas passariam a ser
  aceites). O âmbito fixa-se ao criar (como o tipo de registo).

### Regras
- **Dar passos a um tipo** (`POST /work-item-types/:id/workflow`, Administrador): cria o fluxo com 4 passos por omissão
  («Por fazer» `OPEN`, «Em curso» `IN_PROGRESS`, «Concluída» `DONE`, «Cancelada» `CANCELLED`) e põe cada item no
  primeiro passo da categoria do seu estado, tudo numa transação. Os estados dos itens não mudam.
- **Tirar os passos** (`DELETE /work-item-types/:id/workflow`): os itens ficam sem passo e **mantêm o estado**; o fluxo
  é apagado. A interface pede confirmação.
- **Criar um item** num tipo com passos: com `stepId`, tem de ser um passo do fluxo do tipo; sem ele, vai para o
  primeiro passo (pela ordem) da categoria do estado pedido, ou para o primeiro `OPEN` se não pedir estado. Sem passo
  dessa categoria → 400.
- **Editar:** `stepId` muda o passo (e o estado); só `status` (o «Concluir» das listas) vai para o primeiro passo dessa
  categoria (400 se não houver); os dois juntos têm de bater certo. **Mudar de tipo** resolve o passo no tipo novo pela
  mesma regra (para um tipo sem passos, o item fica sem passo e mantém o estado).
- Concluir/cancelar por passo tem o mesmo efeito que pelo estado: timeline «Tarefa concluída/cancelada» e regra de
  automação «tarefas do negócio concluídas».
- **Mudar a categoria de um passo** com itens atualiza o estado desses itens na mesma transação (o registo de fluxos
  ganha esse gancho; nos negócios não faz nada, como hoje).
- **Apagar um passo** com itens exige destino do mesmo fluxo (como nas fases dos negócios); os itens ficam com o estado
  do destino. **O último passo de um fluxo não se apaga** (regra nova para todos os fluxos: um funil sem fases também
  não servia para nada).
- **Resultado** (`WON`/`LOST`): só onde o registo o permite (negócios); nos passos de tarefas é recusado.
- Apagar um tipo (só sem itens) apaga também o seu fluxo e os seus campos personalizados.
- Apagar uma tarefa apaga os valores dos seus campos personalizados (como nas outras fichas).

### API
- **Rotas genéricas de fluxos** (a regra de dois manda-as entrar agora, com o segundo tipo com fluxos):
  `GET /workflows/:id` (passos com a contagem de itens), `POST /workflows/:id/steps`, `PATCH /workflows/:id/steps/order`,
  `PATCH /workflow-steps/:id`, `DELETE /workflow-steps/:id?moveTo=`. Ler: todos; escrever: Administrador, com
  auditoria. Respeitam o módulo do tipo de registo (módulo desligado → 404). Servem qualquer tipo registado, negócios
  incluídos; a API `/pipelines` continua igual (fachada).
- `/work-item-types`: cada tipo traz `workflowId` e os passos (`id`, `name`, `order`, `category`), para os formulários.
- `/tasks`: `stepId` na escrita e no filtro; `step { id, name, category }` na leitura; `GET /tasks/board?typeId=`
  devolve o número de itens por passo com os mesmos filtros da lista (cabeçalho das colunas).
- `/custom-fields`: `entityType=WORK_ITEM` e `scopeId` ao criar; os valores só aceitam campos sem âmbito ou do tipo do
  item. Lista curta: devolve todos os campos de tarefas e a interface filtra pelo tipo.
- Tempo real: `workflows` como recurso (avisa tipos, tarefas e funis).

### Interface
- **Configurações > Tipos de tarefa**, no diálogo do tipo: secção «Passos» («Dar passos a este tipo»; depois editar
  nome e categoria, ordenar, acrescentar, apagar com destino, «Tirar os passos»).
- **Configurações > Campos personalizados:** «Tarefas» como tipo de registo, com o âmbito (todas ou um tipo).
- **Formulário da tarefa:** num tipo com passos, escolhe-se o passo em vez do estado; ao editar, os campos
  personalizados que se aplicam ao tipo (como nos negócios).
- **Página de cada tipo** (`/tarefas/tipo/:id`): lista (a de hoje, filtrada pelo tipo) e, se tiver passos, **quadro por
  passos**: arrastar muda o passo; dentro da coluna a ordem é a do prazo (sem ordem manual); paginação por coluna
  («Mostrar mais»), como no quadro dos negócios. Até ao menu configurável (2c), chega-se lá pela lista de tarefas
  (filtro por tipo) e pelas configurações dos tipos.

### Validação prevista
- Migração ensaiada numa cópia da base de desenvolvimento (contagens e impressão digital antes e depois; campos
  personalizados intactos com `scopeId` vazio), reversão testada e sem desvio face ao esquema.
- **e2e:** rotas genéricas (negócios e tarefas, permissões, módulo desligado, resultado recusado em tarefas, último
  passo); dar e tirar passos com itens; criar/editar/mudar de tipo com passos; concluir por passo regista na timeline e
  avalia a automação; mudar a categoria de um passo atualiza os itens; apagar passo com destino; trigger recusa
  incoerências; quadro (contagens e filtro por passo); campos com âmbito (criar, unicidade por âmbito, valores de outro
  tipo recusados, apagar tarefa apaga valores); lead cria a tarefa no primeiro passo quando «Tarefa» tem passos.
- **Prova por mutação** nas regras novas; **browser** (base de testes): dar passos a um tipo, quadro com arrastar,
  formulário com passo, campos de um tipo.

### Execução do 2b (2026-11-19)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- O trigger `WorkItem_passo_coerente` lê o tipo com `FOR SHARE`. Quem cria ou altera uma tarefa enquanto um administrador
  dá ou tira passos ao tipo espera pelo fim dessa operação e vê o resultado. Dar e tirar passos usam uma atualização
  condicional do tipo, para dois pedidos ao mesmo tempo não criarem dois fluxos.
- Pedir só um estado mantém a tarefa no passo atual se ele já for dessa categoria. Sem isto, um formulário que reenvia
  o mesmo estado moveria a tarefa para o primeiro passo da categoria.
- Mover tarefas em bloco (apagar um passo com destino, mudar a categoria de um passo) não regista na timeline nem avalia
  automações. É o mesmo que já acontecia com os negócios ao apagar uma fase.
- O nome de um campo personalizado não se repete entre campos que se aplicam às mesmas tarefas: um campo «de todas»
  colide com os de qualquer tipo.
- O fluxo de um tipo acompanha o nome do tipo ao renomear.
- **Migração** `20261119140000_passos_por_tipo`, ensaiada numa cópia da base de desenvolvimento:
  - impressão digital de tarefas, campos e valores, fluxos e passos, lembretes e negócios igual antes e depois;
  - todos os campos existentes ficaram com âmbito vazio e todas as tarefas sem passo;
  - a reversão (`prisma/rollbacks/20261119140000_passos_por_tipo.down.sql`) repõe exatamente o mesmo esquema e os mesmos
    dados;
  - sem desvio face ao `schema.prisma`; aplicada à base de desenvolvimento, com cópia de segurança antes.
- **e2e:** 20 novos em `test/work-item-steps.e2e-spec.ts` e 1 em `test/automations.e2e-spec.ts` (concluir pelo passo
  dispara a regra). Total: 263 unitários e 428 e2e, todos a passar. Os testes apanharam um erro: o `typeId` do quadro não era obrigatório (o `@IsOptional` herdado
  prevalecia), corrigido com `OmitType`.
- **Prova por mutação:** 11 mutações, todas apanhadas:
  - passo de outro tipo aceite;
  - categoria `OPEN` traduzida para o estado errado;
  - o último passo apaga-se;
  - resultado aceite em tarefas;
  - mudar a categoria de um passo não muda as tarefas;
  - campo de outro tipo aceite;
  - nome repetido entre âmbitos;
  - lead sem passo;
  - o passo atual não fica;
  - dar passos não move as tarefas;
  - quadro sem filtros.
- **Browser** (base de testes):
  - quadro da Assistência: contagens, ordem por prazo e «Mostrar mais»; arrastar um cartão mudou o passo, o estado e as
    contagens;
  - dar passos à Visita no diálogo do tipo, acrescentar um passo, apagar um passo com tarefas (pede o destino e move-as);
  - «Campos deste tipo» abre os campos de tarefas já no âmbito «Visita»; o campo criado aparece só nas visitas;
  - formulário da visita com «Passo» em vez de «Estado»; mudar o passo pelo formulário;
  - lista geral com o nome do passo na coluna do estado;
  - auditoria com as ações novas, sem erros na consola.

---

## Pacote 2c — Registo de contribuições e menu configurável (plano, 2026-11-19)

### Registo de contribuições (frontend)
- Pasta `apps/frontend/src/modules/`: um ficheiro por módulo (núcleo, leads, negócios, email, telefonia, automações)
  que declara as suas **contribuições**:
  - **itens de menu** (id estável, rótulo, ícone, destino, secção «principal» ou «configurações», módulo, quem vê);
  - **rotas**, com a página **carregada à parte** (`React.lazy`): um módulo desligado ou nunca aberto não pesa no
    arranque;
  - **cartões nas fichas** (empresa, contacto; negócio e lead ficam prontos para quando houver um cartão para eles).
- O núcleo (`App.tsx`, `AppShell.tsx`, fichas) passa a **ler o registo** em vez de listas escritas à mão: mostra cada
  contribuição só com o módulo ativo e a permissão (papel ou área de escrita, as mesmas de hoje). As guardas das rotas
  (`RequireModule`, `RequireRole`, `RequireWrite`) passam a vir da contribuição, por isso o menu e a rota não podem
  divergir.
- **Email e Chamadas** deixam de estar escritos nas fichas de empresa e contacto: são cartões registados pelos módulos
  `email` e `zadarma`. O botão de ligar dentro dos campos de telefone fica onde está (é uma ação do campo e já se
  esconde sem o módulo).
- **Widgets do dashboard e fontes da agenda:** os widgets ficam de fora (regra de dois): os indicadores do dashboard
  vêm de um único resumo do servidor que já respeita os módulos, e não há ainda um módulo com um gráfico próprio. As
  fontes da agenda entram com a agenda (2d).

### Menu configurável (decisão D5: define o Administrador)
- Configurável: **só a secção principal** (Dashboard, Leads, Funis, Tarefas, Email, Empresas, Contactos e os tipos de
  tarefa com «aparece no menu»). As configurações continuam fixas: são ferramentas de administração.
- O Administrador **ordena, renomeia, oculta e agrupa** (cabeçalhos de grupo: os itens a seguir a um cabeçalho ficam
  nesse grupo). «Repor» volta ao menu por omissão.
- **O servidor guarda só as preferências** (`MenuSetting`, uma linha com a lista ordenada de entradas: item `{id,
  rótulo?, oculto?}` ou grupo `{id, rótulo}`). Os itens e as rotas vivem no código do frontend; um item novo (de um
  módulo ou tipo novo) que ainda não esteja nas preferências aparece no fim; preferências de itens que já não existem
  ignoram-se. Desvio ao §3.10, que previa um `GET /menu` já filtrado: o servidor não conhece as rotas do frontend.
- **Ocultar não é proibir**: tira o item do menu, mas a página continua acessível a quem tem permissão (o backend
  continua a impor módulos e permissões em cada rota). Fica escrito no ecrã.
- **Tipos de tarefa no menu:** `WorkItemType.showInMenu` (caixa «Aparece no menu» no diálogo do tipo). O item leva à
  página do tipo (2b), com o ícone e o nome do tipo; renomear o item no menu não muda o nome do tipo.

### API
- `GET /menu-settings` (todos os utilizadores com sessão: o menu de cada um usa-as) e `PUT /menu-settings`
  (Administrador, auditado `menu_settings.updated`). Validação: no máximo 200 entradas, ids únicos com formato fechado
  (letras, números, `:`, `-`, `_`), rótulos até 60 caracteres e não vazios.
- `/work-item-types`: `showInMenu` na leitura e na escrita.
- Tempo real: `menu-settings` como recurso; o menu de todas as sessões atualiza-se quando o Administrador grava.

### Validação prevista
- Migração (tabela nova e uma coluna com valor por omissão) ensaiada, reversão testada, sem desvio face ao esquema.
- **e2e:** leitura por todos e escrita só do Administrador, auditada; validação (ids repetidos, formato, rótulos,
  tamanho); `showInMenu` nos tipos; tempo real.
- **Frontend** (sem executor de testes no projeto): a junção do menu (preferências + itens visíveis) é uma função pura,
  verificada com um script durante a validação; o resto no browser.
- **Browser** (base de testes): menu igual ao de hoje sem preferências; reordenar, renomear, ocultar, agrupar e repor;
  um tipo com «aparece no menu»; módulo desligado tira o item e os cartões da ficha; um Comercial vê o menu configurado
  mas não as configurações; as páginas dos módulos carregam à parte.

### Execução do 2c (2026-11-19)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- Registo em `apps/frontend/src/modules/`: `types.ts` (contratos), `core.ts` e `optional-modules.tsx` (as contribuições),
  `registry.ts` (junta-as; cada contribuição herda o módulo que a declara), `menu.ts` (junção do menu, funções puras) e
  `hooks.tsx` (quem vê o quê, menu, cartões das fichas).
- **Páginas carregadas à parte:** o pacote inicial passou de um só ficheiro com mais de 500 kB (o build avisava) para
  388 kB, com 49 ficheiros de JavaScript carregados a pedido.
- Os tipos de tarefa no menu entram, por omissão, logo a seguir a «Tarefas».
- Um item cujo destino é o início do de outro item (Tarefas e a página de um tipo) só fica marcado no endereço exato;
  sem isto, na página da Visita ficavam marcados os dois.
- O editor do menu mantém as entradas de itens indisponíveis (módulo desligado), para não perder a posição deles ao
  gravar.
- **Migração** `20261119150000_menu_configuravel` ensaiada numa cópia da base de desenvolvimento: dados iguais antes e
  depois, e a reversão (`prisma/rollbacks/20261119150000_menu_configuravel.down.sql`) repõe exatamente o mesmo esquema e
  os mesmos dados; sem desvio face ao `schema.prisma`; aplicada à base de desenvolvimento, com cópia de segurança antes.
- **e2e:** 5 novos em `test/menu-settings.e2e-spec.ts`. Total: 265 unitários e 433 e2e, todos a passar.
- **Junção do menu:** 7 verificações num script (o frontend não tem executor de testes), todas a passar.
- **Prova por mutação:** 9 mutações, todas apanhadas (e, sem mutações, tudo passa):
  - ids repetidos aceites;
  - qualquer papel grava o menu;
  - «oculto: falso» gravado;
  - «aparece no menu» não grava;
  - id sem formato fechado;
  - item oculto aparece no menu;
  - itens novos caem dentro do último grupo;
  - grupos vazios aparecem;
  - o editor perde os itens indisponíveis.
- **Browser** (base de testes):
  - sem preferências, o menu é igual ao de antes;
  - «Aparece no menu» na Visita põe-na no menu a seguir a Tarefas;
  - em Configurações > Menu: renomear Tarefas, ocultar Email, criar o grupo «Vendas» e gravar; o menu reflete tudo;
  - desligar a telefonia tira o cartão «Chamadas» da ficha da empresa e o item «Zadarma» das configurações, e o endereço
    direto mostra «Módulo desligado»;
  - o Comercial vê o menu configurado e nenhuma configuração; «Menu» dá «Sem permissão»; o Email oculto continua a
    abrir pelo endereço.

---

## Pacote 2d — Agenda (plano, 2026-11-19)

### Modelo
- **Horário marcado** opcional na tarefa: `WorkItem.scheduledStart` e `scheduledEnd`. Uma visita tem hora marcada;
  uma tarefa tem prazo. Restrição na base de dados: o fim exige início e não pode ser antes dele.
- **Momento na agenda** (`agendaAt`, coluna interna com índice, mantida pelo trigger que já calcula a pesquisa e a
  ordem): o início marcado quando existe, senão o prazo. A agenda e o calendário das tarefas passam a usá-lo, por isso
  uma visita marcada sem prazo também aparece. Não sai nas respostas (como `dueSort`).
- Um horário que atravessa vários dias aparece no dia em que começa (simplificação; mostra-se a hora de fim).

### Fontes da agenda
- **No servidor** (`src/agenda/agenda-sources.ts`), um registo de fontes, como os de fluxos e campos personalizados:
  - **Tarefas** (núcleo): pelo `agendaAt`, com o tipo (ícone e cor), o estado e o responsável; com horário marcado
    mostram início e fim, senão a hora do prazo.
  - **Próxima ação das leads** (módulo `leads`): leads em aberto (novo, contactado, sem resposta) com próxima ação no
    intervalo, como entradas de dia inteiro (a próxima ação é só uma data). Com o módulo desligado, a fonte não existe.
  - As férias e as visitas dos mapas juntam-se depois com uma linha cada.
- **No frontend**, a mesma fonte regista-se no registo de contribuições (2c): o nome do filtro e o que acontece ao abrir
  uma entrada (a tarefa abre o diálogo da tarefa; a lead abre o diálogo da lead).

### API
- `GET /agenda?from&to&tz&perDay&sources&typeId&assigneeId`: entradas de todas as fontes pedidas no intervalo, com o
  dia (no fuso do browser) e quantas há em cada dia.
  - Intervalo no máximo de 62 dias; `perDay` entre 1 e 50 (o mês pede 3, a semana 20, o dia 50); o resto aparece como
    «+N», como no calendário atual. Cada fonte devolve só as primeiras de cada dia, por isso a resposta tem um tamanho
    limitado seja qual for o volume.
  - `assigneeId` filtra o responsável nas duas fontes (ver a agenda de um colega); `typeId` só se aplica às tarefas e,
    quando vem, a fonte das leads não entra.
  - Todos os utilizadores com sessão leem (as tarefas e as leads já são visíveis a todos).
- `/tasks`: `scheduledStart` e `scheduledEnd` na escrita e na leitura; o calendário das tarefas passa a usar o momento na
  agenda.

### Interface
- Página **Agenda** (`/agenda`, item «Agenda» no menu principal, configurável como os outros):
  - vistas **mês** (a grelha atual), **semana** (7 colunas, entradas pela hora) e **dia** (lista pela hora);
  - navegação anterior/seguinte/hoje; filtros por responsável, por tipo de tarefa e por fonte;
  - clicar num dia vazio cria uma tarefa nesse dia (quem pode escrever).
- **Formulário da tarefa:** «Marcado para» (início e fim, opcionais) além do prazo.

### Validação prevista
- Migração ensaiada numa cópia da base de desenvolvimento (dados iguais; `agendaAt` = prazo em todas as tarefas
  existentes), reversão testada, sem desvio face ao esquema.
- **e2e:** horário marcado (gravar, limpar, fim antes do início recusado, também na base de dados); `agendaAt` segue o
  início marcado ou o prazo; agenda com as duas fontes, dias no fuso pedido, `perDay` e contagens, filtros
  (responsável, tipo, fontes), leads fechadas fora, módulo de leads desligado tira a fonte, intervalo e parâmetros
  inválidos recusados; o calendário das tarefas usa o horário marcado.
- **Prova por mutação** nas regras novas; **browser** (base de testes): as três vistas, filtros, abrir uma tarefa e uma
  lead a partir da agenda, marcar horário no formulário.

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 2b — Passos, campos e página por tipo
Plano detalhado acima («Pacote 2b»).

### 2c — Registo de contribuições e menu configurável
Plano detalhado acima («Pacote 2c»).

### 2d — Agenda
Plano detalhado acima («Pacote 2d»).

## Decisões assumidas (a rever)
- Renomear `Task` → `WorkItem` na base de dados e no código, mantendo `/tasks` e «Tarefas» para quem usa (como na 0c).
- Todo o item tem tipo; «Tarefa» é o tipo por omissão.
- Estado «cancelada» novo.
- Menu: o administrador define (D5); a personalização por utilizador fica para depois.
- Fora desta fase: âmbitos de permissão («só as minhas»), tarefas recorrentes, SLA e notificações (pacote P).
