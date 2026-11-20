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
- **Módulos:** as regras de cada tipo de registo só correm com o módulo desse tipo ativo (verificado no motor). O módulo
  «Automações» continua a depender do de negócios até ao 3b: enquanto só houver regras de negócios, sem eles não
  haveria nada a automatizar.

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

### Execução do 3a (2026-11-19)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Gatilho «campo alterado»:** só aceita os campos cuja mudança o serviço do registo comunica (`changeTracked`: valor,
  probabilidade, tipo, margem). O responsável serve para condições, mas não se muda pela edição do negócio.
- **Histórico e regras com várias condições:** cada regra vê o registo como está no momento em que corre (uma regra
  anterior pode tê-lo mudado), como antes. Nos gatilhos agendados, só sucessos e falhas vão ao histórico.
- **Webhook:** passa a levar `entityType` e `entityId`; nos negócios mantém o `dealId` de sempre.
- **Dependência do módulo:** «Automações» continua a depender de «Negócios» até ao 3b (ver «Despacho e execução»).
- **Migração** `20261119170000_automacoes_genericas`, ensaiada numa cópia da base de desenvolvimento com quatro regras
  no formato antigo, uma de cada caso:
  - campo alterado com condição: a condição passou para a lista e o passo saiu;
  - campo alterado sem operador: ficou desativada;
  - parado X dias: código e passo de destino convertidos;
  - tarefas concluídas com webhook: código convertido.
  - A reversão (`prisma/rollbacks/20261119170000_automacoes_genericas.down.sql`) repõe o esquema; só muda a posição de
    duas colunas. Não se desfazem as duas normalizações acima, que não mudam o comportamento.
  - Sem desvio face ao `schema.prisma`; aplicada à base de desenvolvimento, com cópia de segurança antes.
- **Testes:**
  - Os testes de automações de sempre passam, adaptados só nos nomes dos campos: é a prova de que o comportamento não
    mudou.
  - Novos: 10 e2e em `test/automation-engine.e2e-spec.ts` e 10 unitários (registos, condições e motor, incluindo
    ciclos com um registo de teste que se volta a disparar).
  - Total: 280 unitários e 454 e2e, todos a passar.
  - Nas duas primeiras voltas da suite completa falharam testes já existentes (paginação e outros), que passam sozinhos
    e passaram todos na terceira volta. A máquina estava carregada (ficheiros de 60 a 80 s): falhas por tempo, sem
    relação com o 3a.
- **Prova por mutação:** 13 mutações.
  - Na primeira volta escaparam duas: o limite estrito do «maior que» e o «campo alterado» reagir a qualquer campo.
  - Juntei os testes que faltavam e, na segunda volta, as 13 foram apanhadas (e, sem mutações, tudo passa).
- **Browser** (base de testes):
  - criar pela página atual uma regra «campo alterado» (valor > 1000 → mover) e outra «parado 5 dias» com webhook;
  - reabrir e alterar (o formulário carrega o que foi gravado);
  - subir o valor de um negócio no diálogo do funil moveu-o para «Em negociação», com sucesso no histórico e as três
    ações na auditoria.

---

## Pacote 3b — Gatilhos e ações novos (plano, 2026-11-19)

### Tipos de registo
- **`WORK_ITEM` (tarefas, núcleo):** campos para condições `typeId` (tipo de tarefa), `status`, `priority`,
  `assigneeId`; acompanha a mudança de estado, prioridade, responsável e tipo; âmbito pelo fluxo do tipo e pelo passo.
- **`LEAD` (módulo `leads`):** campos `status`, `kind` (empresa/pessoa), `interest`, `source`, `responsavelId`;
  acompanha a mudança de estado, interesse e responsável; sem fluxo (as regras de leads não têm passo).
- **`DEAL`:** como no 3a, mais os campos personalizados.
- **Campos personalizados nas condições:** os marcados «disponível em automações» (`isAutomationEnabled`, já existe), de
  todos os registos do tipo ou (nas tarefas) do tipo de tarefa. Texto, email, telefone e URL → texto; número e valor →
  número; lista de opções → opções; sim/não → opções «sim»/«não». Datas e seleção múltipla ficam de fora (os
  operadores atuais não servem para elas). Os campos passam a ser lidos da base de dados quando são precisos.
- **O módulo «Automações» deixa de depender de «Negócios»**: as regras de cada tipo de registo correm só com o módulo
  desse tipo ativo (como no 3a). Os testes das dependências entre módulos passam a usar manifestos de teste.

### Gatilhos novos
- **`CREATED`** (negócios, tarefas, leads): criado por uma pessoa, pela API pública ou por outra automação.
- **`ENTERED_STEP`** (negócios, tarefas; passo obrigatório): mudou para o passo da regra — ao arrastar, ao editar, ao
  mover um negócio ou por uma automação. Criar já num passo não conta como entrar (para isso, `CREATED` com o passo).
- **`CLOSED`** (negócios ganhos ou perdidos, tarefas concluídas ou canceladas, leads convertidas ou perdidas): as
  condições sobre o estado dizem qual.
- **`FIELD_CHANGED`** passa a servir também tarefas e leads.
- Cada evento leva **quem o causou** (`actorId`, quando há uma pessoa), para as ações que atribuem a quem fez.

### Ações novas
- **`CREATE_WORK_ITEM` (criar tarefa)**, em todos os tipos de registo, com um modelo:
  - **tipo** (ativo) e **título** com variáveis do registo de origem (negócio: `{titulo}`, `{empresa}`, `{contacto}`;
    tarefa: `{titulo}`, `{empresa}`, `{contacto}`; lead: `{nome}`, `{empresa}`, `{telefone}`, `{email}`). Uma
    variável sem valor fica vazia;
  - **responsável:** o do registo de origem (se não tiver, quem causou o evento), quem causou o evento (se não houver,
    o do registo), ou um utilizador fixo (ativo);
  - **prazo** opcional: daqui a N dias ou N dias úteis (segunda a sexta; feriados ficam para depois) ou N horas;
    prioridade opcional;
  - **ligada ao registo de origem** e às mesmas empresa, contacto, negócio e lead;
  - a tarefa nova entra no passo certo se o tipo tiver passos e **dispara o `CREATED` das tarefas** (cadeia, com a
    proteção do 3a).
- **`ASSIGN` (atribuir)**, em todos: muda o responsável para um utilizador fixo (ativo) e dispara `FIELD_CHANGED`.
- **`MOVE_TO_STEP`** passa a servir tarefas (com o estado derivado do passo) e dispara `ENTERED_STEP` (e `CLOSED` quando o
  passo fecha) — também nos negócios.

### A tarefa da lead nova passa a regra
- Hoje está escrita em `LeadsService.create`. Passa a **regra do sistema** «Primeiro contacto da lead» (`CREATED` em
  leads → criar tarefa «Contactar lead: {nome}», tipo por omissão, prazo daqui a 1 dia, responsável o da lead ou quem a
  criou): o mesmo efeito, mas desativável e editável.
  - As regras do sistema têm uma chave (`systemKey`) e o arranque cria as que faltem, como os tipos de tarefa do
    sistema; **não se apagam** (desativam-se), senão voltavam no arranque seguinte.
  - **Mudança assumida:** com o módulo «Automações» desligado, a lead nova deixa de criar a tarefa (desligar as
    automações desliga todas, incluindo esta). Fica escrito na descrição do módulo.
- O seguimento a +2 dias úteis depois de «Proposta enviada» fica como exemplo a criar pelo administrador
  (`ENTERED_STEP` na fase → criar tarefa), sem se criar sozinho.

### Validação prevista
- Migração (coluna `systemKey` e a regra do sistema) ensaiada e revertida; sem desvio face ao esquema.
- **e2e:** cada gatilho novo em cada tipo de registo (incluindo pela API pública e pelo arrastar no quadro); criar
  tarefa (variáveis, responsável nos três modos, prazo em dias, dias úteis e horas, passo do tipo, ligações, cadeia que
  dispara outra regra); atribuir; mover tarefas; condições sobre campos personalizados; a lead nova continua a criar a
  mesma tarefa (os testes de leads atuais passam sem mudanças) e deixa de a criar com a regra desativada; regra do
  sistema não se apaga; módulos (leads desligado, negócios desligado com regras de tarefas a correr).
- Unitários: dias úteis, variáveis, campos personalizados nas condições; prova por mutação; browser (a página atual
  continua a funcionar; as regras novas configuram-se pela API até ao editor do 3c).

### Execução do 3b (2026-11-19)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Escrita das tarefas pelo serviço das tarefas:** as ações «criar tarefa» e «mover» (nas tarefas) passam por
  `TasksService`, que se regista no serviço das automações ao arrancar (assim não há dependência circular). Por isso uma
  tarefa criada ou concluída por uma automação tem as mesmas regras e a mesma timeline que uma feita por uma pessoa, e
  os seus eventos entram na cadeia (com o limite de profundidade 3).
- **Negócios:** o resultado (ganho/perdido) entrou nos campos das condições, para o «fechado» distinguir os dois. O
  responsável passou a ser acompanhado (muda pela ação «atribuir»).
- **Ligações da tarefa criada a partir de uma lead:** só a lead, como a tarefa de primeiro contacto sempre fez.
- **Histórico:** cada execução é registada quando termina, por isso o que uma ação desencadeia aparece antes dela.
- **Página atual de automações:** mostra as regras novas (incluindo a do sistema), mas só as edita se forem das de
  sempre; as outras abrem só para ativar ou desativar, para não as estragar ao gravar.
- **Migração** `20261119180000_automacoes_regras_sistema` (coluna `systemKey`), ensaiada numa cópia da base de
  desenvolvimento:
  - dados iguais antes e depois;
  - a regra do sistema é criada uma só vez, mesmo correndo a criação duas vezes;
  - a reversão repõe o mesmo esquema e os mesmos dados;
  - sem desvio face ao `schema.prisma`; aplicada à base de desenvolvimento, com cópia de segurança antes.
- **Testes:**
  - Os testes de leads de sempre (incluindo a API pública) passam sem mudanças: a regra do sistema cria a mesma tarefa.
  - Os testes de dependências entre módulos passaram a usar uma dependência de teste.
  - Novos: 13 e2e em `test/automation-triggers.e2e-spec.ts` e 4 unitários (dias úteis, modelos, registos, nenhum
    módulo real com dependências).
  - Total: 284 unitários e 467 e2e, todos a passar.
  - Numa volta da suite completa falhou o contrato da API pública por tempo (passa sozinho e na volta seguinte).
- **Prova por mutação:** 15 mutações.
  - Na primeira volta escapou uma: entrar no passo sem mudar de passo. Outra só falhou por não compilar.
  - Juntei o teste que faltava e refiz a segunda com uma mutação que compila; as 15 ficaram apanhadas.
- **Browser** (base de testes):
  - a regra do sistema aparece na página e abre só para ativar ou desativar (sem apagar);
  - desativada, uma lead criada pela interface não teve tarefa;
  - reativada, nasceu «Contactar lead: …» para quem a criou, com sucesso no histórico e as alterações na auditoria.

---

## Pacote 3c — Interface (plano, 2026-11-20)

### Editor de regras genérico (Configurações > Automações)
- Substitui o editor atual (que só desenhava as três regras de negócios) por um que **lê o catálogo do servidor**
  (`GET /automation-rules/catalog`): o que aparece em cada lista vem dos registos, por isso um módulo novo aparece sem
  mudar o editor.
- **Quando:** tipo de registo → gatilho → âmbito (negócios: funil e fase; tarefas: tipo de tarefa com passos e passo;
  leads: sem âmbito), com o passo obrigatório quando o gatilho o pede; a configuração do gatilho (dias parado; campo
  que muda, só entre os acompanhados).
- **E se:** condições em linhas (campo, operador, valor). O valor é sempre escolhido de uma lista quando há opções
  (opções, utilizadores, tipos de tarefa) e é um número nos campos numéricos; os operadores dependem do tipo de campo.
- **Então:** a ação e a sua configuração — mover (passo de destino), webhook (nome do evento), criar tarefa (tipo,
  título com botões para inserir as variáveis do tipo de registo, responsável, prazo, prioridade) e atribuir
  (utilizador).
- **Frase de pré-visualização** («Quando uma lead é criada e Interesse é igual a POS, então atribuir a Rui») e os erros
  do servidor mostrados como vêm (a validação continua no servidor).
- As regras do sistema editam-se como as outras, mas não têm «Apagar».
- A lista de regras passa a resumir cada uma pela mesma frase, com o tipo de registo.

### Histórico de automações
- Página **Configurações > Automações > Histórico** (botão na página das automações, rota do módulo «Automações»):
  data, regra, registo, gatilho, resultado (sucesso, ignorada, falha) e a mensagem; filtros por regra e resultado;
  paginada («Mostrar mais»).
- O servidor passa a devolver também o **nome do registo** de cada execução (título do negócio, da tarefa, nome da
  lead), lido de uma vez para a página toda; um registo que já não exista aparece como «(apagado)».

### Servidor (pequenos acertos)
- **Tipo de tarefa nas condições passa a lista de opções** (os tipos que existem, lidos da base de dados), em vez de
  texto livre: o editor mostra uma lista e o servidor recusa um tipo que não existe.
- Os funis, as fases e os tipos de tarefa com os seus passos vêm das rotas que já existem (`/pipelines`,
  `/work-item-types`); o catálogo não os repete.

### Validação prevista
- **e2e:** tipo de tarefa como opção (recusa um tipo inexistente; o catálogo traz os tipos); nomes dos registos no
  histórico (negócio, tarefa, lead, apagado). Os testes de automações atuais continuam a passar.
- **Prova por mutação** nos dois acertos do servidor.
- **Browser** (base de testes): criar pelo editor uma regra de cada tipo de registo (incluindo «criar tarefa» com
  variáveis e «atribuir»), editar uma existente (o editor carrega tudo o que foi gravado), a regra do sistema sem
  «Apagar», disparar uma regra e vê-la no histórico com o nome do registo, filtros do histórico.

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 3b — Gatilhos e ações novos
Plano detalhado acima («Pacote 3b»).

### 3c — Interface
Plano detalhado acima («Pacote 3c»).

## Decisões assumidas (a rever)
- Uma regra = uma ação.
- Dias úteis = segunda a sexta (sem feriados, por agora).
- O histórico de execuções guarda 90 dias.
- A tarefa da lead nova vira regra; o seguimento de propostas não se cria sozinho.
