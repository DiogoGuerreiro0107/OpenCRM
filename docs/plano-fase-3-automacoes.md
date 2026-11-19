# Fase 3 — Automações generalizadas (plano, 2026-11-19)

Quarta fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.8 «criação automática de tarefas» e tabela
de fases). Depende das Fases 0 (fluxos genéricos, módulos) e 2 (itens de trabalho com tipos e passos).

**Objetivo:** o motor de automações deixa de servir só negócios. Qualquer tipo de registo com automações (negócios,
tarefas, leads; mais tarde assistências e encomendas) declara os seus **gatilhos**, **campos para condições** e
**ações**, e o administrador monta regras «quando X acontece e as condições se verificam → fazer Y», **sem linguagem de
programação**. A ação nova mais importante é **criar uma tarefa** (item de trabalho) a partir de um modelo.

## O que existe hoje
- `AutomationRule` com `pipelineId`/`stageId` (funil e fase de negócios), gatilho e ação em enums, e configurações em
  JSON livre (sem validação: uma regra mal configurada grava-se e simplesmente não faz nada).
- **Gatilhos** (só negócios): `STAGE_IDLE_TIME` (parado X dias numa fase, de hora a hora), `TASK_COMPLETED` (todas as
  tarefas do negócio fechadas), `FIELD_CHANGED` (valor, probabilidade, tipo ou margem passa a cumprir uma condição).
- **Ações**: `MOVE_STAGE` (mover o negócio) e `TRIGGER_WEBHOOK` (evento para o n8n).
- Cada serviço chama um método específico (`evaluateTaskCompletedRules`, `evaluateFieldChangedRules`); não há registo do
  que correu (só um aviso no log em caso de erro).
- **Comportamentos escritos à mão que são, na prática, automações:**
  - criar uma lead cria a tarefa «Contactar lead: …» para o dia seguinte (`LeadsService.create`);
  - entrar na fase «Proposta enviada» (detetada pelo nome) dispara o webhook `deal.proposal_sent`; o seguimento a +2 dias
    úteis ficava a cargo do n8n.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **3a — Motor genérico** | Regras por tipo de registo; registos de gatilhos, ações e campos; condições genéricas validadas; despacho de eventos único com proteção contra ciclos; histórico de execuções. Comportamento das regras atuais **igual** | Médio (migra as regras existentes) |
| **3b — Gatilhos e ações novos** | Tarefas e leads como tipos de registo; gatilhos «criado», «entrou no passo», «fechado»; ações «criar tarefa» (modelo com variáveis e prazo em dias úteis), «atribuir»; condições sobre campos personalizados; a tarefa da lead nova passa a regra editável | Médio |
| **3c — Interface** | Editor de regras genérico (tipo de registo → gatilho → condições → ação) e página do histórico de execuções | Baixo a médio |

A ordem é a da tabela: o 3b usa os registos do 3a, e o 3c precisa dos dois.

Fora desta fase: **notificar** (depende do pacote P de notificações), várias ações numa só regra (uma regra = uma ação;
duas ações = duas regras, regra de dois), feriados nos dias úteis (só fins de semana; os feriados entram com um
calendário configurável), gatilhos de módulos que ainda não existem (cronómetro, peças).

---

## Pacote 3a — Motor genérico

### Modelo
- `AutomationRule` ganha **`entityType`** (tipo de registo: `DEAL` nas regras existentes) e passa a ter
  **`workflowId`/`stepId`** em vez de `pipelineId`/`stageId` (renomear colunas, chaves e índices, sem copiar dados: os
  fluxos e passos são os mesmos desde a 0c).
- **Gatilho e ação passam a texto** validado por registo (como `entityType` dos campos personalizados), em vez de enums:
  um módulo novo junta gatilhos e ações sem migração. Os códigos ficam genéricos, com a mesma semântica:
  `STAGE_IDLE_TIME` → `IDLE_IN_STEP`, `TASK_COMPLETED` → `ALL_TASKS_CLOSED`, `FIELD_CHANGED` mantém-se,
  `MOVE_STAGE` → `MOVE_TO_STEP`, `TRIGGER_WEBHOOK` → `WEBHOOK`.
- **Condições** (`conditions`, lista de `{ campo, operador, valor }`, todas têm de se verificar) separadas do gatilho. A
  condição que hoje vive dentro do `FIELD_CHANGED` passa para esta lista; o gatilho guarda só o campo que mudou.
- **`AutomationRun`** (histórico, só de acrescentar): regra, tipo e id do registo, gatilho, resultado
  (`SUCCEEDED`, `SKIPPED` com motivo, `FAILED` com erro), profundidade na cadeia e quando. Guarda os últimos 90 dias
  (limpeza diária); serve para o administrador perceber porque é que uma regra fez ou não fez alguma coisa.

### Registos (backend, `src/automations/registry/`)
- **Tipos de registo com automações** (`automation-entities.ts`): módulo de que dependem, como carregar o registo,
  **campos para condições** (nome, rótulo, tipo: número, texto, lista de opções, utilizador, data; operadores
  permitidos por tipo) e, no 3b, variáveis para modelos. No 3a: só `DEAL`, com os campos que o `FIELD_CHANGED` já
  aceitava (valor, probabilidade, tipo, margem) mais o responsável.
- **Gatilhos** (`automation-triggers.ts`): tipos de registo a que se aplicam, configuração (validada) e se precisam de
  passo. No 3a: os três atuais.
- **Ações** (`automation-actions.ts`): tipos de registo, configuração (validada) e execução. No 3a: as duas atuais.
- Testes estruturais conferem cada linha dos três registos (como nos outros registos).

### Despacho e execução
- **Um único ponto de entrada**, `AutomationsService.dispatch(evento)`, com `{ tipo de registo, id, gatilho, contexto }`,
  chamado pelos serviços (negócios, tarefas) em vez dos métodos específicos de hoje. O agendado de hora a hora passa a
  percorrer as regras `IDLE_IN_STEP` de todos os tipos de registo.
- **Proteção contra ciclos:** uma ação pode gerar eventos (mover um negócio, no 3b criar uma tarefa) que disparam outras
  regras. A cadeia tem profundidade máxima 3 e a mesma regra não corre duas vezes para o mesmo registo na mesma
  cadeia; o que for cortado fica no histórico como `SKIPPED` com o motivo.
- **Uma falha numa ação não desfaz a operação que a causou** (como hoje): fica no histórico como `FAILED`.
- **Módulos:** o módulo «Automações» deixa de depender do de negócios (as regras de negócios só correm com o módulo de
  negócios ativo; as de outros tipos com o seu).

### Validação das regras
- Ao criar ou alterar: tipo de registo conhecido e com o módulo ativo; gatilho e ação deste tipo de registo; passo e
  fluxo coerentes (o passo é do fluxo, e o fluxo é deste tipo de registo); configuração de cada um válida (ex.: dias >
  0; passo de destino existe e é do mesmo tipo de registo); condições com campos e operadores conhecidos e valores do
  tipo certo. Hoje tudo isto se grava sem verificação.
- As regras existentes na base de dados que não passem a validação (configuração em falta) **não se apagam**: a
  migração converte-as, e o motor regista `SKIPPED` com o motivo quando as encontra.

### API
- `/automation-rules`: `entityType`, `workflowId`, `stepId`, `trigger`, `triggerConfig`, `conditions`, `action`,
  `actionConfig` (a interface atual adapta-se no mesmo pacote; a API pública não expõe automações).
- `GET /automation-rules/catalog`: o que os registos oferecem (tipos de registo ativos, gatilhos, ações, campos e
  operadores), para a interface montar o editor sem listas repetidas no frontend.
- `GET /automation-runs` (Administrador): histórico paginado, filtrável por regra, resultado e registo.

### Validação prevista
- **Migração ensaiada** numa cópia da base de desenvolvimento: cada regra existente convertida com o mesmo
  comportamento (contagem e conteúdo antes/depois), reversão testada, sem desvio face ao esquema.
- **e2e:** os testes de automações atuais passam (adaptados só nos nomes dos campos) — é a prova de que o
  comportamento não mudou; validação das regras (cada caso acima); histórico (sucesso, condição não cumprida, falha);
  ciclos cortados; módulo de negócios desligado; catálogo.
- **Prova por mutação** nas regras novas; **browser:** a página de automações atual continua a criar e editar as três
  regras de sempre.

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 3b — Gatilhos e ações novos
- **Tipos de registo** `WORK_ITEM` (tarefas, com tipo e passo) e `LEAD`.
- **Gatilhos:** `CREATED` (criado), `ENTERED_STEP` (entrou num passo; nas tarefas e negócios), `CLOSED` (tarefa
  concluída/cancelada, negócio ganho/perdido, lead convertida/perdida), mais os do 3a para os novos tipos onde fizer
  sentido.
- **Ações:** `CREATE_WORK_ITEM` (tipo, título com variáveis como `{nome}` e `{empresa}`, responsável — o do registo, quem
  fez a ação ou um utilizador fixo —, prazo relativo em dias ou dias úteis, ligado ao registo de origem) e `ASSIGN`.
- **Condições sobre campos personalizados** marcados «disponível em automações» (`isAutomationEnabled`, que já existe).
- **A tarefa automática da lead nova passa a regra** criada pela migração com o mesmo efeito (desativável e editável),
  em vez de código fixo. A regra «proposta enviada → seguimento a +2 dias úteis» fica disponível como exemplo a
  criar pelo administrador (não se cria sozinha, para não mudar o comportamento de quem a tem no n8n).

### 3c — Interface
- Editor de regras genérico: escolher o tipo de registo, o gatilho (e o passo, quando se aplica), as condições
  (campo, operador, valor — listas, sem texto livre onde há opções) e a ação com a sua configuração; pré-visualização
  da frase «Quando … e … então …».
- Página **Histórico de automações** (Configurações): o que correu, o que foi ignorado e porquê, falhas.

## Decisões assumidas (a rever)
- Uma regra = uma ação.
- Dias úteis = segunda a sexta (sem feriados, por agora).
- O histórico de execuções guarda 90 dias.
- A tarefa da lead nova vira regra; o seguimento de propostas não se cria sozinho.
