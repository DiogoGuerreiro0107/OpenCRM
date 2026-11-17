# Fase 0 — Fundações (2026-11-06)

Primeira fase do [desenho da reorganização modular](plano-reorganizacao-modular.md). Objetivo: acrescentar as peças genéricas **sem mudar o comportamento atual** — no fim de cada pacote, a aplicação faz exatamente o mesmo que antes, mas já está preparada para os módulos seguintes. Plano escrito antes de qualquer alteração.

## Os 4 pacotes (cada um é um PR independente, por esta ordem)

| Pacote | Entrega | Risco para os dados | Estado |
|---|---|---|---|
| **0a — Registo de módulos** | Ligar/desligar módulos (leads, funis/negócios, email, telefonia, automações), menu e rotas dependentes do que está ativo, dependências, página de definições | **Nenhum** (só acrescenta uma tabela) | a fazer agora |
| **0b — Campos personalizados genéricos** | `entityType` deixa de ser um enum fechado (registo de tipos); validação dos valores; limpeza ao apagar; permissões por tipo de registo | Baixo (conversão de enum para texto, valores iguais) | feito |
| **0c — Fluxos genéricos** | `Pipeline`/`Stage` → `Workflow`/`WorkflowStep` (renomeados, mesmos ids), categoria + resultado, apagar passo movendo os itens | **Médio** (migra dados reais: negócios e regras de automação apontam para as fases) | feito |
| **0d — Permissões em base de dados** | Matriz por módulo/tipo guardada na BD, com os valores atuais por omissão; o frontend deixa de ter uma cópia | Baixo | a fazer agora |

Cada pacote só avança depois de o anterior estar integrado.

---

## Pacote 0a — Registo de módulos

### Que módulos são opcionais hoje

Dos módulos existentes, uns são o **núcleo** (sem eles o CRM não faz sentido) e outros passam a opcionais:

| Núcleo (sempre ativo) | Opcionais (podem ser desligados) | Depende de |
|---|---|---|
| utilizadores, papéis, empresas, contactos, timeline, tarefas, campos personalizados, dashboard, definições, módulos | **leads** | — |
| | **funis e negócios** (`deals`) | — |
| | **email** (inclui templates) | — |
| | **telefonia** (`zadarma`) | — |
| | **automações** | funis e negócios (as regras atuais só atuam sobre negócios) |

Os módulos novos (produtos, stock, encomendas, assistências, orçamentos…) entram no mesmo registo à medida que forem criados.

**Por omissão tudo fica ativo**, para que instalar este pacote não altere nada a ninguém.

### O que "desligado" significa (decisões)

- **Os dados nunca se apagam**: desligar esconde e bloqueia; voltar a ligar devolve tudo.
- As tabelas existem sempre (um só *schema*); o estado vive numa tabela nova `ModuleSetting (moduleId, enabled, options, updatedAt)`. **Sem linha = valor por omissão do manifesto** (ativo).
- **Backend:** rotas de módulos desligados respondem `404` (como se não existissem), só depois de autenticar (um utilizador sem sessão continua a receber `401`, para não revelar que módulos existem). O guard corre **depois** do `JwtAuthGuard` e do `RolesGuard`.
- **Efeitos fora das rotas** (o que faz um módulo desligado ser mesmo desligado):
  - tarefas agendadas (cron de automações por tempo parado, sincronização de chamadas da Zadarma) **não correm**;
  - os gatilhos de automação ligados a eventos (campo alterado, tarefa concluída) **não disparam**;
  - a **conversão de lead sem o módulo de negócios** cria só empresa e contacto, sem negócio nem exigir um funil;
  - o **dashboard** deixa de calcular e de mostrar os indicadores dos módulos desligados;
  - o **email-worker** continua a correr mas o `POST /email/ingest` responde `404`: passa a tratar isso como "módulo desligado" (uma linha de aviso, sem tempestade de erros).
- **Dependências:** não se desliga um módulo de que outro **ativo** depende (a resposta diz qual); ligar um módulo exige as suas dependências ativas (a resposta diz quais).
- **Só o Administrador** liga e desliga. **Todos** os utilizadores autenticados podem ler quais estão ativos (o menu precisa disso).
- O estado muda **em tempo real** nas sessões abertas (o interceptor de tempo real já avisa de qualquer escrita em `/modules`).

### Desenho técnico

**Backend**
- `modules/module-manifest.ts`: lista de manifestos em código (`id`, `label`, `description`, `dependsOn`, `defaultEnabled`) — é a fonte de verdade de *que módulos existem*; a base de dados só guarda *se estão ativos*.
- `ModulesService`: lê as definições para uma cache em memória (uma só instância do backend, como já está documentado) e atualiza-a em cada escrita; `isEnabled(id)`, `list()`, `setEnabled(id, enabled)` com as regras de dependência.
- `@RequireModule(id)` + `ModuleGuard`. Aplicados a todos os controllers de módulos opcionais.
- **Teste estrutural** (como o das permissões): cada controller tem de estar na lista de *núcleo* **ou** ter `@RequireModule` — um controller novo sem decisão faz falhar o teste. Impede que um módulo novo fique "ligado para sempre" por esquecimento.
- Rotas: `GET /modules` (todos os autenticados: módulos ativos), `GET /modules/manage` (Administrador: lista completa com dependências) e `PATCH /modules/:id` (Administrador).

**Frontend**
- `useModules()` (React Query, chave `["modules"]`, atualizada em tempo real) e `useModuleEnabled(id)`.
- Menu, rotas, botões e secções dependentes passam a filtrar por módulo (`<RequireModule>` como o `<RequireRole>` que já existe).
- Nova página **Configurações > Módulos** (só Administrador): lista, interruptor, descrição, dependências, e a mensagem do backend quando uma operação é recusada.
- Enquanto a lista de módulos carrega, os itens opcionais **ficam escondidos** (nunca piscam e desaparecem).

### Testes e validação
- **Unitários:** regras de dependência (ligar/desligar), módulos inexistentes, valores por omissão, manifestos coerentes (sem dependências em ciclo nem para módulos que não existem).
- **E2E (Postgres real):** com cada módulo ligado a rota funciona; desligado → `404` (e **sem sessão continua `401`**); o núcleo nunca é afetado; dependências recusadas; só o Administrador altera; a cache reflete a alteração de imediato; dashboard sem os indicadores desligados; conversão de lead sem negócios; cron de automações e da Zadarma não correm desligados.
- **Estrutural:** todos os controllers classificados.
- **Suite com "tudo ligado" e com "mínimo"** (só núcleo) no CI — a combinação que o desenho prevê.
- **Browser:** desligar cada módulo e ver o menu, as rotas, o dashboard e os botões a reagirem sem recarregar; ligar de novo.
- Prova por mutação de que os testes falham se o guard for removido.

### Riscos
| Risco | Mitigação |
|---|---|
| Desligar um módulo "a meio" deixar comportamento órfão (cron, gatilhos, webhooks) | Lista explícita acima + testes dos efeitos fora das rotas |
| Cache desatualizada | Atualizada em cada escrita (uma só instância); teste e2e |
| O frontend mostrar algo de um módulo desligado | `<RequireModule>` nas rotas **e** filtros nos botões/secções; verificação no browser |
| Esquecer um controller novo | Teste estrutural |
| Instalações existentes mudarem de comportamento | Tudo ativo por omissão; sem linhas na tabela = igual a hoje |

### Fora de âmbito deste pacote
Assistente de primeira instalação (fica para depois dos módulos novos existirem, porque as perguntas dependem deles); opções por módulo (a coluna `options` existe mas só é usada a partir do módulo de leads, na Fase 1).

---

## Pacote 0b — Campos personalizados genéricos (plano, 2026-11-17)

### O que existe hoje
- `CustomField.entityType` e `CustomFieldValue.entityType` são um **enum fechado** (`COMPANY`, `CONTACT`, `LEAD`, `DEAL`): cada módulo novo (encomendas, assistências...) exigiria alterar o enum e o código em vários sítios.
- Na base de desenvolvimento: 1 campo e 1 valor (empresas), sem inconsistências.

**Problemas encontrados na revisão do código** (corrigidos neste pacote, porque é o mesmo código):
1. **Guardar valores não confirma que o campo pertence a esse tipo de registo:** é possível gravar um campo das empresas num negócio.
2. **Os valores não são validados pelo tipo do campo:** número com texto (fica `NaN`), data inválida (erro 500), opção que não existe numa lista, email/URL mal formados, «obrigatório» ignorado.
3. **Não se confirma que o registo existe:** podem gravar-se valores para ids inexistentes.
4. **Apagar uma empresa/contacto/lead/negócio deixa os valores para trás** (órfãos; a tabela é polimórfica, sem chave estrangeira).
5. **Permissões inconsistentes:** quem não pode editar empresas (Técnico) pode editar os campos personalizados delas, porque os valores usam a permissão genérica «trabalho do dia-a-dia».
6. **Mudar o tipo de um campo que já tem valores** (p. ex. texto → número) torna esses valores ilegíveis (ficam na coluna errada).

### Desenho
1. **Registo de tipos de registo em código** (`custom-fields/entity-registry.ts`): para cada tipo que aceita campos personalizados — `COMPANY`, `CONTACT`, `LEAD`, `DEAL` — diz **a que módulo pertence** (leads e negócios são opcionais), **quem pode editar** (a mesma matriz que já protege a edição do próprio registo: `WRITE_ACCESS.companies`, `.contacts`, `.leads`, `.deals`) e **como confirmar que um registo existe**. Um módulo novo junta uma linha aqui; nada mais muda. Um teste estrutural garante que cada tipo registado tem módulo, permissões e verificação de existência.
2. **Enum → texto**, **com os mesmos valores** (`COMPANY`, ...): a migração converte as colunas sem tocar nos dados. A validação passa a ser «é um tipo registado» em vez de «é um valor do enum». A API e a interface continuam a usar os mesmos identificadores (não muda nada para quem já usa).
3. **Módulo desligado:** pedir campos ou valores de `LEAD` com o módulo de leads desligado → `404`, tal como as rotas do módulo.
4. **Validação dos valores por tipo**, com mensagem a dizer qual campo falhou (400): número finito; data válida; sim/não só `true`/`false`; lista só com uma opção existente; seleção múltipla só com opções existentes e sem repetições; email e URL (`http`/`https`) bem formados; texto até 5000 caracteres. **Obrigatório:** não se pode esvaziar um campo obrigatório (criar o registo sem o preencher continua possível; isso fica para quando os formulários de criação incluírem os campos).
5. **O campo tem de pertencer ao tipo** do registo, e **o registo tem de existir** (404 se não existir).
6. **Permissões por tipo de registo:** escrever valores exige poder editar esse tipo de registo. **Muda o comportamento** num caso: o **Técnico** deixa de poder editar campos personalizados de **empresas, contactos, leads e negócios** (já não podia editar esses registos). A interface passa a esconder a edição a quem não pode, pela mesma regra.
7. **Apagar um registo apaga os seus valores** (na mesma transação). Órfãos **antigos** não são apagados pela migração (não há nenhum na base de desenvolvimento; apagar dados em massa numa migração seria arriscado); ficam inofensivos (nunca são mostrados).
8. **Mudar o tipo de um campo com valores** é recusado (400, com o número de valores). Sem valores, pode mudar-se. Mudar as **opções** de uma lista continua permitido; um valor antigo que já não esteja nas opções continua guardado e é mostrado, mas não se pode voltar a escolher.

### Fora de âmbito (ver «Fora» em cada ponto)
- **Âmbito por tipo** (campos só para assistências do tipo «Impressoras»): só faz sentido quando existirem tipos (`WorkItemType`, Fase 2). Regra de dois: a coluna entra com o primeiro uso.
- **Pesquisa e filtros por campos personalizados** nas listagens (`isSearchable`/`isFilterable` já existem no modelo): entram com as listagens dos módulos novos e com medição de desempenho, como dizia o desenho.
- Campos personalizados na API pública.

### Testes e validação
- **Unitários:** validação de cada tipo de campo (aceita/recusa), registo de tipos (estrutural: todos com módulo, permissões e existência).
- **E2E:** campo de outro tipo de registo recusado; registo inexistente 404; cada tipo de valor inválido 400; esvaziar obrigatório 400; opção inexistente 400; Técnico 403 nas empresas e Comercial 200; módulo de leads desligado 404 em campos e valores de `LEAD`; apagar empresa/contacto/lead/negócio apaga os valores; mudar tipo com valores 400 e sem valores 200; os valores existentes continuam a ler-se depois da migração.
- **Migração sobre dados reais:** aplicar na base de desenvolvimento e confirmar que o campo e o valor existentes continuam iguais e visíveis na ficha.
- **Prova por mutação:** retirar a verificação de tipo de registo, a validação de números e a limpeza ao apagar.
- **Browser:** ficha de empresa como Administrador (edita) e como Técnico (só vê); valor inválido mostra o erro.

### Riscos
| Risco | Mitigação |
|---|---|
| Quebrar a leitura dos valores existentes | Mesmos identificadores; teste de leitura depois da migração; migração aplicada primeiro na base de desenvolvimento |
| Técnicos que hoje editam campos de empresas deixam de poder | É a correção de uma inconsistência; dito no PR e nas decisões. Se for preciso, a matriz `WRITE_ACCESS.companies` é que deve incluir o Técnico |
| Validação mais estrita recusar valores que a interface envia | A interface já envia os formatos certos; e2e com os formatos da interface |

### Execução do pacote 0b (2026-11-17)

**Implementado como planeado.** Pormenores:
- O registo de tipos está em `apps/backend/src/custom-fields/entity-registry.ts`; a validação dos valores em `custom-field-values.ts` (funções puras).
- Gravar valores é **tudo ou nada**: todos os valores são validados antes de gravar algum. Enviar o mesmo campo duas vezes no mesmo pedido é recusado.
- Ler valores devolve só os de campos do próprio tipo de registo (um valor gravado por engano noutro tipo, antes desta correção, não aparece).
- Datas impossíveis (ex.: 2026-02-30) são recusadas em vez de «corrigidas» para outro dia.
- A interface passa a mostrar o erro do servidor quando a gravação falha (antes falhava em silêncio).

**Validação:**
- 246 unitários e 324 e2e a passar; migração sem desvio contra o `schema.prisma`; builds OK.
- **Migração com dados reais** (base de desenvolvimento: 1 campo «Segmento» e 1 valor «Grossista»): as colunas passaram de enum a texto e os dados ficaram **idênticos** (comparação antes/depois).
- **Prova por mutação:** retirar a verificação do tipo de registo, a validação de números e a limpeza ao apagar uma empresa → falham os três testes correspondentes. (Uma primeira tentativa de mutação partiu a compilação e não provava nada; foi refeita com mutações que compilam.)
- **Browser** (base de testes): como Administrador, um URL sem `https://` mostra ««Portal»: tem de ser um endereço http:// ou https://» e, corrigido, grava; como Técnico, a ficha mostra os valores mas sem edição nem botão de guardar.

**Não testado:** a interface com leads/negócios desligados (só a API, por e2e); a edição de campos personalizados dentro dos diálogos de lead e negócio (o componente é o mesmo).

## Pacote 0c — Fluxos genéricos (plano, 2026-11-17)

### O que existe hoje
- `Pipeline` (funil) e `Stage` (fase, com `type` = `OPEN`/`WON`/`LOST`) só servem negócios. `Deal` e `AutomationRule` apontam para eles (`pipelineId`, `stageId`).
- O significado de `type` está espalhado: fecho do negócio (`closedAt`), motivo de perda obrigatório, indicadores do dashboard, conversão de leads (primeira fase aberta), automações, webhook `deal.stage_changed`, cores do Kanban.
- Base de desenvolvimento: 3 funis, 13 fases, 1 negócio, 0 regras de automação.

### Objetivo
Transformar funis/fases num **fluxo genérico** que os próximos módulos (assistências, encomendas, orçamentos, tipos de tarefa) reutilizam, **sem mudar nada do que os utilizadores veem** nos negócios.

### Desenho
1. **Renomear, não copiar:** `Pipeline` → `Workflow`, `Stage` → `WorkflowStep` (tabelas, colunas, índices e chaves renomeados na mesma migração). **Os ids não mudam**, por isso negócios e regras de automação continuam a apontar para os mesmos registos, sem copiar dados. Nos negócios e nas regras as colunas mantêm os nomes `pipelineId`/`stageId` (é o vocabulário dos negócios).
2. **Fluxo pertence a um tipo de coisa:** `Workflow.entityType` (texto; hoje só `DEAL`), com um **registo em código** como o dos campos personalizados (módulo a que pertence, como contar e mover os itens de um passo). Todos os funis existentes ficam `DEAL`.
3. **Categoria + resultado em vez de `type`:**
   - `category`: `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED` — o que a agenda e os relatórios dos módulos futuros vão usar sem conhecer os nomes dados pelo utilizador;
   - `outcome` (só em passos `DONE`): `WON` ou `LOST`.
   - Conversão (como no desenho aprovado): `OPEN` → `OPEN`; `WON` → `DONE` + `WON`; `LOST` → `DONE` + `LOST`.
   - Regras únicas, num só sítio (`workflow-steps.ts`): «está aberto?» = categoria `OPEN` ou `IN_PROGRESS`; «ganho» = resultado `WON`; «perdido» = resultado `LOST`. Todos os sítios que hoje comparam `type` passam a usar estas regras.
4. **A API dos negócios não muda:** `/pipelines` e `/stages` continuam a devolver e a aceitar `type` (`OPEN`/`WON`/`LOST`), traduzido para categoria+resultado. As respostas **ganham** `category` e `outcome` (só acrescenta). O frontend dos negócios, o dashboard, as automações e o webhook `deal.stage_changed` (`to_stage_type`) continuam iguais.
5. **Serviço genérico `WorkflowsService`** (criar fluxo com passos por omissão, renomear, acrescentar/editar/reordenar/apagar passos) usado pelos funis; os módulos futuros usam-no com o seu `entityType`. **Sem rotas genéricas `/workflows` ainda** (regra de dois: só os negócios usam fluxos; as rotas entram com o segundo módulo).
6. **Apagar um passo com itens:** hoje é recusado. Passa a aceitar **«mover para»** outro passo do mesmo fluxo (os negócios são movidos e o passo apagado, na mesma transação). Sem destino continua recusado, com a contagem. A interface de gestão do funil passa a perguntar para onde mover.

### Fora de âmbito (com motivo)
- **Transições restritas e portões** (*gates*): não há nenhum caso que os use; entram com assistências/encomendas (regra de dois).
- **Ações ao entrar/sair de um passo:** já existem como automações dos negócios; generalizá-las é a Fase 3 (automações generalizadas).
- **Expor as categorias `IN_PROGRESS` e `CANCELLED` na interface dos negócios:** os negócios continuam com aberto/ganho/perdido; as novas categorias servem os módulos futuros.

### Migração (o mais delicado)
- **Uma só migração SQL, dentro de uma transação** (`BEGIN … COMMIT`): ou corre toda, ou nada muda.
- Passos: renomear tabelas, coluna `pipelineId` da fase → `workflowId`, chaves e índices (para os nomes coincidirem com os que o Prisma espera); criar os enums de categoria/resultado; acrescentar `entityType` (= `DEAL`), `category`, `outcome`; preencher a partir de `type`; **verificar** (a migração aborta se alguma fase ficar sem categoria ou se `WON`/`LOST` não tiver resultado); apagar `type` e o enum `StageType`.
- **Reversão escrita e testada:** um script `down.sql` (guardado junto da migração, **não** aplicado automaticamente) que repõe o esquema anterior a partir das categorias.
- **Ensaio sobre uma cópia da base real** antes de tocar na de desenvolvimento: copiar a base (`pg_dump`/`pg_restore` para uma base temporária), fotografar funis, fases, negócios e regras; aplicar a migração; confirmar que **nenhum id mudou**, que todos os negócios/regras apontam para os mesmos registos e que cada `type` foi convertido certo; aplicar o `down.sql` e confirmar que volta **exatamente** à fotografia inicial; apagar a cópia.
- **Em produção:** o serviço de cópias de segurança faz uma cópia ao arrancar; o guia de atualização diz para confirmar que existe uma cópia recente antes de atualizar.

### Testes e validação
- **Unitários:** regras de categoria/resultado e tradução `type` ↔ categoria+resultado (nos dois sentidos, para os três valores e para as categorias novas).
- **E2E:** forma das respostas de `/pipelines` igual à de antes (mais `category`/`outcome`); criar funil cria os passos por omissão com as categorias certas; mudar o `type` de uma fase; mover negócio para fase ganha/perdida (fecho, motivo de perda obrigatório); dashboard (abertos/ganhos/perdidos, valor em aberto, negócios parados); conversão de lead para a primeira fase aberta; automação que move para uma fase; apagar fase com negócios sem destino (400) e com destino (negócios movidos, fase apagada); destino de outro funil (400); webhook `deal.stage_changed` com `to_stage_type`.
- **Todos os e2e existentes** dos negócios, automações, leads e dashboard têm de passar sem alterações (são a prova de que nada mudou para quem usa).
- **Prova por mutação:** trocar a regra de «aberto», a conversão `WON`, e o mover-ao-apagar.
- **Browser:** Kanban igual (cores, colunas), arrastar para ganho/perdido, gerir funil (mudar tipo, apagar fase com negócios escolhendo o destino), dashboard.

### Riscos
| Risco | Mitigação |
|---|---|
| Migração falhar a meio e deixar a base inconsistente | Transação única; verificação dentro da migração; ensaio numa cópia |
| Algum sítio continuar a ler `type` e mudar de comportamento | Compilador (o campo deixa de existir); e2e existentes sem alterações; procura por `"WON"`/`"LOST"`/`"OPEN"` no código |
| Precisar de voltar atrás | `down.sql` testado na cópia; cópia de segurança antes de atualizar |
| Nomes de índices/chaves diferentes dos esperados pelo Prisma | `prisma migrate diff` contra a base migrada tem de dar «sem diferenças» |

### Execução do pacote 0c (2026-11-17)

**Implementado como planeado.** Código novo em `apps/backend/src/workflows/` (regras dos passos, registo de tipos, serviço genérico); `PipelinesService` passou a fachada da API dos negócios. Pormenores decididos na implementação:
- **Reordenar** passou a recusar ids de fases de outro funil (antes eram aceites em silêncio).
- **Mover ao apagar** respeita as regras dos negócios: fecho/reabertura (`closedAt`) conforme o destino, e destino de perda só se todos os negócios tiverem motivo de perda. **Não** dispara webhooks/automações por cada negócio movido (é uma operação de arrumação, como apagar uma fase).
- Um passo `DONE` sem resultado ou `CANCELLED` conta como «perdido» na visão dos negócios (coerente com «não está aberto»); hoje nenhum passo de negócios fica assim.
- A reversão ficou em `apps/backend/prisma/rollbacks/20261117170000_fluxos_genericos.down.sql` (fora da pasta de migrações, para o Prisma nunca a aplicar sozinho).

**Ensaio da migração numa cópia da base de desenvolvimento** (3 funis, 13 fases, 1 negócio): fotografia → migração → **nenhum id, nome, ordem, ligação ou tipo mudou**; `prisma migrate diff` sem diferenças; a restrição CHECK recusou um resultado num passo aberto; `down.sql` → dados iguais aos iniciais e **esquema idêntico** ao original (mesma impressão digital de colunas, índices e chaves); cópia apagada. A sessão foi interrompida a meio do primeiro ensaio; a cópia foi apagada e o ensaio repetido do início.

**Validação:**
- **Os 324 e2e que já existiam passam sem alterações nas expectativas** (só o *fixture* do teste dos campos personalizados, que criava um funil diretamente na base, foi adaptado aos nomes novos). Com os novos: 252 unitários e 339 e2e; builds OK.
- **Prova por mutação:** tirar `IN_PROGRESS` de «aberto», estragar a conversão de `WON` e não mover os itens ao apagar → falham seis testes.
- **Base de desenvolvimento migrada** com fotografia antes/depois igual (e uma cópia de segurança em `/tmp/opencrm-antes-0c.dump` dentro do contentor do Postgres).
- **Browser** (base de testes): Kanban com as cores de sempre; gerir funil → apagar fase com 2 negócios mostra a pergunta; destino «Perdido» recusado com a mensagem do motivo de perda; destino «Em negociação» move os negócios e apaga a fase; dashboard com os valores certos.

**Não testado:** arrastar cartões no Kanban no browser (coberto pelos e2e de `move`); a reversão na base de desenvolvimento (só na cópia).

## Pacote 0d — Permissões em base de dados (plano, 2026-11-17)

### O que existe hoje
- A matriz de **escrita por papel** (`WRITE_ACCESS` em `apps/backend/src/auth/permissions.ts`) está **fixa em código**: mudar quem pode editar empresas exige alterar código e publicar uma versão.
- O frontend tem uma **cópia à mão** da matriz (`apps/frontend/src/lib/permissions.ts`), vigiada por um teste que falha se divergirem.
- A leitura é aberta a todos os autenticados, exceto nas áreas de administração.
- Um caso concreto em aberto: no 0b, o **Técnico** deixou de poder preencher campos personalizados de empresas porque não pode editar empresas. Com o 0d, se o Técnico precisar, o Administrador dá-lhe essa permissão na interface.

### Desenho
1. **Mesma granularidade de hoje: «quem pode escrever» em cada área** (empresas, contactos, leads, negócios, trabalho do dia-a-dia, enviar email, ligar, modelos de email). **Desvio ao desenho da reorganização (§3.11)**, que falava em ver/criar/editar/eliminar por tipo de item: não há ainda nenhum caso que precise dessa divisão, e uma matriz de 4 ações × N tipos × 6 papéis seria difícil de gerir sem ganho. Fica preparado (a área é texto) para dividir quando um módulo novo o pedir.
2. **O que nunca é configurável:** a área de **administração** (utilizadores, módulos, permissões, chaves de API, webhooks, auditoria, automações, definição de campos, estrutura dos funis, Zadarma) é sempre **só do Administrador**. Tornar isto configurável permitiria a alguém dar-se a si próprio acesso à gestão de utilizadores.
3. **Invariantes impostas pelo backend:** o **Administrador está sempre** em todas as áreas (não se pode retirar — evita ficar sem ninguém que consiga corrigir); **Leitura apenas nunca** escreve.
4. **Armazenamento:** `PermissionSetting (area, roles, updatedAt)`. **Sem linha = valor por omissão** (a matriz atual, que fica em código como predefinição). Instalar este pacote **não muda nada** a ninguém. Cache em memória, atualizada a cada alteração (uma só instância do backend, como os módulos).
5. **Decorador por área:** as rotas passam de `@WriteRoles(...WRITE_ACCESS.companies)` (lista fixa) para `@WriteArea("companies")`, resolvido **em cada pedido** pelo `RolesGuard`. As de administração mantêm `@WriteRoles(ADMIN)`. Um decorador no método sobrepõe-se ao da classe (como hoje). Os testes estruturais continuam a exigir que toda a rota de escrita tenha política, e passam a exigir que as áreas existam.
6. **Serviços que verificam permissões** (campos personalizados por tipo de registo) passam a perguntar ao `PermissionsService` em vez de lerem a constante.
7. **API:**
   - `GET /me/permissions` (qualquer utilizador autenticado): as áreas em que o próprio pode escrever. O frontend **deixa de ter cópia da matriz** e usa isto; o teste de sincronização deixa de ser preciso.
   - `GET /permissions` (Administrador): a matriz com rótulos, descrições, valores atuais e predefinidos.
   - `PATCH /permissions/:area` e `DELETE /permissions/:area` (repor a predefinição): só o Administrador, **auditados**.
   - As alterações chegam às sessões abertas em **tempo real** (como os módulos).
8. **Interface: Configurações > Permissões** — tabela áreas × papéis com caixas de seleção; coluna do Administrador sempre marcada e bloqueada; Leitura apenas sem caixas; «Repor predefinição» por área; aviso de que a área de administração não é configurável.
9. **Ecrãs:** enquanto as permissões carregam, os botões de edição ficam escondidos (como os módulos); a ligação «Templates de Email» no menu passa a seguir a área configurável `emailTemplates`.

### Testes e validação
- **Unitários:** invariantes (Administrador sempre, Leitura apenas nunca, área desconhecida), resolução com e sem linha na base de dados.
- **E2E:** sem configuração, **todas as permissões ficam iguais às de hoje** (os e2e de permissões existentes têm de passar sem alterações); dar «empresas» ao Técnico → passa a poder criar empresas **e** preencher os campos personalizados delas, sem reiniciar; retirar → volta a 403; repor a predefinição; tentar retirar o Administrador ou dar escrita a Leitura apenas → 400; não-administrador não vê nem altera a matriz; `GET /me/permissions` reflete a mudança; auditoria das alterações.
- **Estruturais:** todas as rotas de escrita com política; todas as áreas usadas nas rotas existem; as rotas de administração não usam áreas configuráveis.
- **Prova por mutação:** ignorar a base de dados (usar sempre a predefinição); deixar retirar o Administrador.
- **Browser:** página de permissões; dar uma área ao Técnico e ver o botão aparecer na sessão dele sem recarregar.

### Riscos
| Risco | Mitigação |
|---|---|
| Alguém ficar sem acesso a nada que o deixe corrigir | Administrador sempre incluído; administração nunca configurável |
| Uma rota nova ficar sem política | Teste estrutural (como hoje) |
| Permissões alteradas não chegarem às sessões abertas | Tempo real + leitura por pedido no backend (o frontend é só conforto; o backend decide sempre) |
| Cache desatualizada | Atualizada a cada escrita; uma só instância |

## Registo de execução
- [x] 0a — Registo de módulos (ver decisoes.md)
- [x] 0b — Campos personalizados genéricos (ver «Execução do pacote 0b»)
- [x] 0c — Fluxos genéricos (ver «Execução do pacote 0c»)
- [ ] 0d — Permissões em base de dados
