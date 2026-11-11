# Reorganização modular do OpenCRM: proposta de desenho (2026-11-06)

**Estado: desenho aprovado nas decisões D1, D2, D3 e D8 (ver abaixo); implementação a começar pela Fase 0.** Pedido: tornar o CRM o mais flexível possível, com **todos os módulos opcionais**, suporte a leads ligadas a empresas e/ou a pessoas, módulo de encomendas (com API de entrada, stock, fornecedores, transporte e faturação), módulo de assistências (passos e campos personalizáveis, cronómetro, automação de tarefas), tarefas unificadas numa agenda com páginas configuráveis na barra de navegação, e levantamento de mais fluxos comuns.

Estrutura: §1 resumo e decisões que preciso de ti · §2 o que existe hoje · §3 desenho · §4 mais fluxos · §5 fases · §6 riscos · §7 fontes.

---

## 1. Resumo

**A ideia central:** quase tudo o que descreves é o mesmo problema visto de ângulos diferentes — *coisas que passam por passos* (leads, negócios, encomendas, assistências, orçamentos), *com campos próprios*, *que geram trabalho* (tarefas) e *que aparecem numa agenda e no menu*. Em vez de construir três módulos independentes, proponho **quatro peças genéricas** que os módulos reutilizam:

| Peça genérica | O que resolve | Já existe em parte? |
|---|---|---|
| **1. Registo de módulos** | ligar/desligar módulos, dependências, menu e permissões de cada um | não |
| **2. Fluxos (workflows) genéricos** | passos configuráveis, adicionáveis e removíveis, com "portões" e ações automáticas | só para negócios (`Pipeline`/`Stage`) |
| **3. Campos personalizados genéricos** | campos próprios por módulo *e* por tipo | só para 4 entidades fixas |
| **4. Item de trabalho (`WorkItem`)** | o "supertipo" que une tarefas, assistências, encomendas e orçamentos na agenda e no menu | só tarefas simples |

Os módulos (Leads, Negócios, Produtos, Stock, Encomendas, Compras, Assistências, Orçamentos…) são depois **configuração + regras de domínio** sobre estas quatro peças.

**O que recomendo e onde discordo do teu primeiro esboço (com argumentos em §3.5):**
- **Leads:** *uma* tabela com um discriminador (`pessoa`/`empresa`), não duas — a "página mais importante" fica muito mais simples e rápida. Mas proponho **medir os dois** com dados de teste antes de decidir, porque custa pouco.
- **"Tudo configurável"** tem um preço (§6): é a armadilha do *inner platform effect*. Proponho configurar o que pediste (passos, campos, tipos de tarefa, menu) e **manter em código** a lógica que tem de ser exata (stock, totais, impostos, cronómetros).

### Decisões

**Tomadas pelo utilizador (2026-11-06):**

| # | Decisão | Resposta |
|---|---|---|
| D1 | Leads: uma ou duas tabelas | **Uma tabela** com tipo empresa/pessoa, **com teste de carga** (200 mil leads sintéticas) antes de fechar o formato |
| D2 | Orçamentos vs `globaltoner-orcamentos` | **Revista (2026-11-11):** o CRM **não emite orçamentos nem faturas**, só documentos internos. Guarda uma **versão interna da proposta** (linhas, valores, margem, estado) para a equipa; o orçamento ao cliente continua a sair do `globaltoner-orcamentos` ou do programa de faturação. Deixa de «substituir» esse projeto |
| D3 | Stock e faturação | **A faturação manda** no stock; o CRM guarda reservas e movimentos e reconcilia com relatório de divergências. **Falta saber qual é o programa de faturação** |
| D8 | Por onde começar | **Fase 0 — Fundações** |

**Atualização (2026-11-11):** o **programa de faturação concreto é irrelevante** nesta fase. O que importa é uma **API pública** estável e um **sistema de extensões** (add-ons/plugins), de modo a que o adaptador de qualquer programa de faturação seja um módulo à parte. Isto está desenhado em [plano-extensoes-e-api.md](plano-extensoes-e-api.md) (proposta, a rever) e **substitui** a dependência da decisão D3 («falta saber qual é o programa») pelo contrato `BillingProvider`. A regra «a faturação manda no stock» mantém-se.

**Assumidas por mim (as recomendações), a rever:** D4 ligar/desligar módulos **por instalação** · D5 menu definido pelo administrador · D6 controlo de stock **opcional por produto** · D7 API de encomendas com formato neutro + adaptador por loja.

### Decisões que ainda faltam / estavam em aberto

| # | Decisão | A minha recomendação |
|---|---|---|
| D1 | **Leads:** uma tabela com discriminador, ou duas tabelas + vista que as junta? | Uma tabela; medir as duas antes de fechar (§3.5) |
| D2 | **Orçamentos:** já tens o projeto `globaltoner-orcamentos`. O CRM deve integrar-se com ele, substituí-lo, ou ficar sem orçamentos? | Perguntar-te antes de desenhar mais (depende de §3.9) |
| D3 | **Qual é o programa de faturação** e **quem manda no stock** (CRM, faturação, ou o CRM só lê)? | O faturação manda; o CRM guarda reservas e movimentos e reconcilia (§3.7) |
| D4 | **Ligar/desligar módulos** é uma opção **por instalação** (um administrador escolhe), ou também **por utilizador/papel**? | Por instalação; a visibilidade por papel já resulta das permissões |
| D5 | O **menu** é configurado só pelo administrador, ou cada utilizador pode personalizar o seu? | Administrador define; utilizador só reordena/oculta (fase posterior) |
| D6 | **Stock** é obrigatório para vender produtos, ou há produtos "sem stock" (serviços, revenda direta)? | Opcional por produto (`controla stock` sim/não) |
| D7 | Que **transportadoras** e que **lojas online** vão ligar-se à API de encomendas? (para escolher o formato) | Formato neutro + adaptador por loja (§3.7) |
| D8 | **Ordem de prioridade** dos módulos | Fundações → Leads → Tarefas/Agenda → Assistências → Encomendas (§5) |

---

## 2. O que existe hoje (e o que impede a flexibilidade)

Lido do código atual, não suposto:

| Área | Hoje | Limite |
|---|---|---|
| Módulos | todos sempre ativos; o menu está escrito à mão no `AppShell.tsx` | não há como desligar nada |
| Fluxos | `Pipeline`/`Stage` só servem para `Deal`; `StageType` = `OPEN`/`WON`/`LOST` | uma encomenda ou assistência não pode ter passos próprios |
| Campos personalizados | `CustomFieldEntityType` é um *enum* com 4 valores (`COMPANY`, `CONTACT`, `LEAD`, `DEAL`) | cada tipo novo exige migração e código |
| Tarefas | `Task` com chaves fixas para contacto/empresa/negócio/lead; `TaskType` é um *enum* | não representa assistências nem encomendas; tipos não personalizáveis |
| Leads | `Lead.companyName` é **texto livre**; a conversão cria `Company` + `Contact` + `Deal` | não liga a empresas existentes; modelo único (nem só-empresa nem só-pessoa) |
| Automações | gatilhos e ações **só sobre negócios** (`STAGE_IDLE_TIME`, `TASK_COMPLETED`, `FIELD_CHANGED`; `MOVE_STAGE`, `TRIGGER_WEBHOOK`) | não criam tarefas, não reagem a outros módulos |
| Permissões | matriz **fixa em código** (`auth/permissions.ts`), espelhada no frontend com um teste de desvio | um módulo/tipo novo exige alterar código nos dois lados |
| Produtos / stock / fornecedores / encomendas / equipamentos | **não existem** | — |
| API para sistemas externos | só utilizadores com JWT + uma chave interna para o email-worker | não há chaves de API por integração |
| Base já útil | motor de campos personalizados, timeline genérica (`entityType`+`entityId`), webhooks, tempo real, testes e2e | reaproveitar |

---

## 3. Desenho proposto

### 3.1 Registo de módulos (a base de "tudo opcional")

Cada módulo declara um **manifesto**: identificador, dependências, entradas de menu, permissões, páginas de definições e as suas regras de automação.

```
core (sempre ativo): utilizadores, papéis, empresas, contactos, timeline, campos personalizados,
                     fluxos, itens de trabalho/agenda, definições, módulos
opcionais:           leads · negócios · produtos · stock · fornecedores/compras · encomendas ·
                     transporte · assistências · orçamentos · email · telefonia (Zadarma) ·
                     automações · integração de faturação · API de entrada
dependências:        encomendas → produtos · stock → produtos · compras → fornecedores+produtos ·
                     assistências (peças) → produtos (e stock, se ativo) · transporte → encomendas
```

**O que "desligar" significa** (a decisão de desenho mais importante, porque toca em dados reais):
- Os **dados ficam** (nunca se apagam ao desligar); desligar só **esconde e bloqueia**.
- As **tabelas existem sempre** na base de dados (um único *schema* Prisma e um único conjunto de migrações); um módulo desligado são tabelas vazias. Alternativa — schema condicional por módulo — foi rejeitada: o Prisma não suporta e multiplica as combinações a testar.
- **Backend:** um `@RequireModule("encomendas")` devolve `404` nas rotas de módulos desligados (como se não existissem); os gatilhos de automação desse módulo ficam inativos; o interceptor de tempo real ignora-os.
- **Frontend:** o menu e as rotas são construídos a partir de `GET /modules` (o que está ativo **e** o que o papel pode ver).
- **Dependências:** não se desliga um módulo de que outro ativo depende (a UI diz qual). Ligar um ativa as dependências com confirmação.
- **Configuração** numa tabela `ModuleSetting` (`módulo`, `ativo`, `opções` JSON validado por módulo). Primeira instalação: assistente com perguntas ("vendem produtos? fazem assistências? leads de empresas, de pessoas ou ambas?") que liga os módulos certos.

**Custo a aceitar:** o número de combinações dos módulos cresce; por isso o CI corre a suite **com todos os módulos ligados e com o conjunto mínimo**, e há um teste estrutural (como o das permissões) que falha se uma rota de um módulo opcional ficar sem `@RequireModule`.

### 3.2 Fluxos genéricos (`Workflow` / `WorkflowStep`)

Generaliza o que hoje é `Pipeline`/`Stage` (que só serve para negócios).

- `Workflow` pertence a **um tipo de coisa** (negócio, encomenda, assistência, orçamento, tipo de tarefa…) e tem **passos** ordenados.
- Cada `WorkflowStep` tem uma **categoria** fixa (`ABERTO`, `EM_CURSO`, `CONCLUÍDO`, `CANCELADO`) — é isso que permite relatórios e a agenda tratarem passos de qualquer fluxo da mesma forma, sem saberem o nome que o utilizador lhe deu — e um **nome livre**.
- **"Adicionar e retirar passos como sendo genéricos"**: o utilizador cria, renomeia, reordena e remove passos. Remover um passo com itens obriga a escolher para onde os mover (como já fazemos hoje, em que o backend recusa apagar uma fase com negócios).
- **Transições** opcionais: por omissão qualquer passo → qualquer passo; pode restringir-se (ex.: "Enviada" só depois de "Pronta").
- **Portões** (*gates*): condições **de código** que um passo pode exigir, escolhidas de uma lista fechada (não escritas pelo utilizador): `todas as linhas com stock`, `peças recebidas`, `orçamento aprovado`, `campo X preenchido`, `motivo de perda`. As fontes sobre assistências recomendam exatamente isto: peças e direito de garantia como portões duros, não como comentários soltos (§7).
- **Ações ao entrar/sair** de um passo: criar item de trabalho, notificar, chamar webhook, mover para outro passo — é o motor de automações atual, **generalizado** (§3.8).
- **Migração:** `Pipeline`→`Workflow`, `Stage`→`WorkflowStep` com cópia dos ids (os negócios e as regras de automação existentes continuam a apontar para os mesmos registos). `StageType` `OPEN`/`WON`/`LOST` passa para a categoria (`WON`/`LOST` → `CONCLUÍDO` + um marcador de resultado).

### 3.3 Campos personalizados genéricos

- `CustomField.entityType` deixa de ser um *enum* e passa a **texto** (`"lead"`, `"encomenda"`, `"assistencia"`…) mais um **âmbito opcional por tipo** (`typeId`): campos só das assistências do tipo "Impressoras", por exemplo.
- Os valores já são polimórficos (`entityType` + `entityId`); mantêm-se.
- **Pesquisa e filtros** por campos personalizados: hoje existem `isSearchable`/`isFilterable` no modelo; passam a alimentar as listagens dos novos módulos.
- **Aviso honesto:** valores em tabela chave-valor são fáceis de configurar e lentos de filtrar em grandes volumes. Para esta escala está bem; se uma listagem filtrar muito por campo personalizado, cria-se um índice ou uma coluna materializada **depois** de medir, não antes.

### 3.4 Item de trabalho (`WorkItem`) — as tarefas unificadas na agenda

O requisito "assistências, encomendas e orçamentos são tarefas, para a agenda" resolve-se com um **supertipo**:

```
WorkItem  (a "tarefa" que a agenda e o menu veem)
  id · tipo (WorkItemType) · título · passo do fluxo (+ categoria) · prioridade
  responsável · prazo/início/fim · cor · empresa? · contacto? · origem (módulo + id)
        ▲ 1:1 (opcional)
        ├── ServiceCase   (assistência: equipamento, tempo, peças…)
        ├── Order         (encomenda: linhas, transporte…)
        ├── Quote         (orçamento)
        └── (nada)        ← tarefa simples / tipo personalizado: só campos personalizados
```

- **`WorkItemType`** é o tipo **personalizável** ("Chamada", "Visita", "Entrega", "Instalação", "Assistência", "Encomenda"…): nome, ícone, cor, fluxo (`Workflow`) associado, campos personalizados do tipo, e **se aparece como página do menu**. Os tipos "Assistência", "Encomenda" e "Orçamento" são **criados pelos módulos** respetivos quando ligados (e não se apagam enquanto o módulo estiver ativo).
- **Agenda e listas** consultam **só `WorkItem`** (uma tabela, índices por responsável, prazo e categoria do passo) — por isso juntar tudo é barato e não depende de quantos módulos existem.
- **Consistência:** o `WorkItem` e a linha do módulo (`Order`, `ServiceCase`…) criam-se e atualizam-se **na mesma transação**; o passo e o responsável vivem num só sítio (o `WorkItem`) para nunca divergirem.
- **Alternativa rejeitada — tudo numa só tabela com um JSON "extra":** é a mais flexível e a pior para stock, totais, relatórios e integridade (não há chaves estrangeiras para linhas de encomenda, peças, movimentos…). Mantém-se só para tipos **simples** (campos personalizados).
- **Migração da `Task` atual:** passa a ser um `WorkItem` de um tipo "Tarefa" por omissão; `TaskType` (*enum*) vira `WorkItemType`; lembretes (`Reminder`) mantêm-se ligados ao `WorkItem`.

### 3.5 Leads: um modelo que suporta empresa, pessoa, ou ambos

**Requisito:** configurável — leads ligadas a empresas, a pessoas de uma empresa, ou ambos ao mesmo tempo; uma **página única** que junta tudo, e **eficiente**.

**Definição na configuração do módulo Leads:** `modo` ∈ { `EMPRESA`, `PESSOA`, `AMBOS` }. Controla o que a UI oferece ao criar e como converte; não muda a base de dados.

Comparação das duas formas de guardar:

| | **A. Duas tabelas** (`LeadEmpresa`, `LeadPessoa`) + vista que as junta | **B. Uma tabela** `Lead` com `tipo` (`EMPRESA`/`PESSOA`) e chaves opcionais |
|---|---|---|
| Página única | `UNION ALL` de duas tabelas; ordenar e paginar **sobre a união** (ordenação global exige juntar antes de cortar); filtros e contagens duplicados | uma consulta, **paginação por cursor** (keyset) com um índice composto |
| Pesquisa e filtros | duplicados nas duas tabelas e na vista; qualquer campo novo tem de ser acrescentado em dois sítios | um só conjunto de colunas e índices |
| Estados por separador (contagens) | duas contagens somadas | uma agregação `GROUP BY estado` |
| Campos que diferem entre os tipos | cada tabela só tem o que lhe interessa (**vantagem real**) | colunas anuláveis (`nif`, `cargo`…) — poucas, e o resto são campos personalizados **por tipo** |
| Conversão | dois caminhos de código | um caminho com ramos |
| Ordem "última atividade" / próxima ação | atravessa as duas tabelas | trivial |
| Escala (milhares de leads) | ambas rápidas | ambas rápidas |

**Recomendação: B**, porque a única vantagem real de A (campos diferentes) é pequena e já é coberta pelos campos personalizados **por tipo** (§3.3), enquanto o custo de A **aparece exatamente na página que dizes ser a mais importante**. Não é uma questão de desempenho em bruto — com milhares de leads qualquer das duas é rápida — é de **simplicidade e de ter filtros, ordenações e pesquisa coerentes** numa página só.

**Mas a escolha deve ser baseada em medição, não em opinião** (e custa pouco): antes de implementar, gerar 200 mil leads sintéticas nos dois formatos e medir a página (filtro por estado + responsável, ordenada por próxima ação, pesquisa de texto, contagem por separador). Se A e B ficarem dentro da mesma ordem de grandeza — o que espero — fica B pela simplicidade.

**Desenho de B para a página eficiente:**
- Colunas: `tipo`, `estado` (passo do fluxo de leads), `responsavelId`, `proximaAcaoEm`, `criadoEm`, `empresaId?`, `contactoId?`, nome/telefone/email **desnormalizados** da lead (a lead existe *antes* de haver empresa/contacto), `origem`.
- **Ligação a registos existentes:** `empresaId`/`contactoId` opcionais (hoje a empresa é só texto). Lead de empresa → `empresaId`; lead de pessoa → `contactoId` e, opcionalmente, a empresa dessa pessoa. Pode também existir só com dados soltos (prospeção fria) e ligar-se depois.
- **Índices:** `(estado, responsavelId, proximaAcaoEm)`, `(responsavelId, criadoEm)`, `(tipo, estado)`; pesquisa de texto com `pg_trgm` (índice GIN) em nome/empresa/email/telefone.
- **Listagem:** paginação por **cursor** (`proximaAcaoEm`, `id`), nunca `OFFSET` profundo; devolve só as colunas da lista; contagens por separador numa única consulta agregada (e em cache curto).
- **Em tempo real:** já existe o canal de eventos (§ tempo real); a lista só refaz a consulta.
- **Conversão** (`modo`): lead de empresa → cria/liga `Empresa` (+ `Contacto` opcional) + `Negócio`; lead de pessoa → cria/liga `Contacto` (+ `Empresa` opcional) + `Negócio`; usar sempre **numa transação** (já é assim desde o pacote C) e **ligar a registos existentes** quando o NIF/email/telefone coincidirem (deteção de duplicados — §4).

### 3.6 Produtos e stock

- **`Produto`** (módulo `produtos`): referência/SKU, nome, descrição, preço, taxa de IVA, unidade, ativo, `controlaStock` (sim/não — D6), fornecedor(es) com a sua referência e preço de custo, categorias, campos personalizados. É a "listagem de produtos dentro do CRM" que pedes.
- **Stock como livro de movimentos** (`MovimentoStock`: produto, quantidade com sinal, tipo — entrada de compra, saída de encomenda, ajuste, devolução, reserva —, origem). O **stock atual é a soma dos movimentos**, nunca um número editado à mão; isto dá auditoria e permite reconciliar com a faturação. **Reservas** (`reservado`) separadas do disponível.
- **Disponibilidade** = em stock − reservado (+ em encomenda a fornecedor, mostrado à parte). A **lógica de stock é código, não configuração** (§6).

### 3.7 Encomendas, compras, transporte e faturação

**Fluxo base** (cada passo é um `WorkflowStep` — podes adicionar e retirar passos): `Recebida → Validada → [Em compra ao fornecedor] → Pronta para envio → Enviada → Entregue`, com `Cancelada`/`Devolvida` como saídas.

- **Estado por linha, não só por encomenda:** as fontes consultadas (Walmart, Oracle) tratam o estado ao nível da linha; é necessário porque uma encomenda pode ter linhas em stock e linhas à espera do fornecedor. `LinhaEncomenda.estado`: `disponível`, `reservada`, `a aguardar fornecedor`, `recebida`, `enviada`, `cancelada`.
- **Revenda com receção do fornecedor** (o teu caso): se a linha não tem stock, gera-se (ou associa-se) uma **linha de encomenda a fornecedor** (`EncomendaCompra`/`LinhaCompra`) e a linha de venda fica `a aguardar fornecedor` — o padrão *back-to-back* descrito na pesquisa (a linha de venda espera a **receção** da compra, e só então pode ser enviada). Ao registar a receção, o stock entra, a reserva é feita e **o sistema avisa que há stock para preparar** (notificação + item de trabalho "Preparar encomenda X").
- **Portão "pronta para envio":** todas as linhas `reservada` (ou a encomenda permite envio parcial — opção). É o "informar quando há stock suficiente".
- **Transporte:** `Transportadora` configurável (nome, URL de seguimento com `{codigo}`, custo por defeito) e `Expedição` (encomenda, transportadora, código de seguimento, peso/volumes, custo, data). **Seguimento = link**, não integração com cada transportadora, na primeira versão (integrações por transportadora são um adaptador futuro). *(Decisão D7.)*
- **Entrada manual e por API:**
  - Manual: formulário no CRM.
  - **API de entrada** (`POST /api/v1/orders`): **chaves de API por integração** (guardadas com hash, com âmbitos — p. ex. só "criar encomendas" e "ler produtos" — revogáveis, com data de último uso), **idempotência** por `(origem, idExterno)` para uma loja poder repetir o pedido sem duplicar, validação estrita, `429` por chave, ligação de produtos por SKU e do cliente por NIF/email (criando ou ligando) e **webhooks de saída** quando o estado muda (a loja fica a saber que foi enviada). Documentada com OpenAPI.
  - **Segurança:** a API de integração é **separada** da API da interface (outras credenciais, outro conjunto de rotas e limites); nunca aceita JWT de utilizador; nunca devolve dados além do âmbito da chave.
- **Faturação (D3):** definir uma **interface de adaptador** `ProvedorFaturacao` (empurrar encomenda/fatura, **ler stock**, **emitir ajustes**) e escrever o adaptador do **programa que usas** quando soubermos qual é. Regra de reconciliação: **uma fonte de verdade para o stock** (recomendo a faturação), o CRM guarda reservas e movimentos e uma **tarefa periódica** compara e **gera um relatório de divergências** em vez de corrigir silenciosamente. **Atualização (2026-11-11):** não é preciso saber o programa. O CRM define o contrato (`BillingProvider`, modelo canónico, *outbox*, reconciliação, suite de conformidade) e o adaptador de cada programa é uma **extensão** — ver [plano-extensoes-e-api.md](plano-extensoes-e-api.md) §7.

### 3.8 Assistências

- **`Assistência`** (módulo `assistencias`) = `WorkItem` + dados próprios: cliente, **equipamento** (opcional; série, marca, garantia — §4), problema reportado, **passos e campos personalizáveis por tipo de assistência** (§3.2/§3.3), responsável.
- **Cronómetro e registo do trabalho:**
  - `RegistoTempo` (assistência, utilizador, início, fim, nota, faturável sim/não). **O servidor é a fonte de verdade**: "iniciar" grava `inicio`; "parar" grava `fim`; o contador no ecrã é só apresentação. Assim sobrevive a fechar o browser ou trocar de computador.
  - **Um cronómetro ativo por utilizador** (iniciar outro para o primeiro, com aviso). Cronómetros esquecidos: aviso ao fim de X horas e edição manual do tempo (guardando o motivo).
  - **Entrada manual** de tempo além do cronómetro; total por assistência e por técnico.
  - **O que foi feito:** notas por registo de tempo e entradas na **timeline** da assistência (já existe o mecanismo genérico).
  - **Peças usadas** (`PeçaUsada`: produto, quantidade) que geram o movimento de stock respetivo quando o módulo stock está ativo.
- **Criação automática de tarefas (ex.: "criar orçamento para X"):** extensão do motor de automações para qualquer módulo:
  - **Gatilhos**: `ENTROU_NO_PASSO`, `CRIADO`, `CAMPO_ALTERADO`, `TEMPO_PARADO`, `CRONÓMETRO_PARADO`, `ITEM_CONCLUÍDO`, `RECEBIDA_PEÇA`…
  - **Ações**: `CRIAR_ITEM_DE_TRABALHO` (com modelo: tipo, título com variáveis, responsável, prazo relativo), `MOVER_PARA_PASSO`, `NOTIFICAR`, `WEBHOOK`, `ATRIBUIR`.
  - **Condições** simples (campo ⟷ valor) escolhidas de uma lista, **sem linguagem de programação** para o utilizador.
  - Exemplo: "quando uma assistência do tipo *Impressora* entra em `Diagnóstico concluído` **e** o campo *Reparável* = não → criar item de trabalho do tipo *Orçamento* para o comercial responsável, prazo +2 dias úteis".

### 3.9 Orçamentos (decisão D2 pendente)

> **Resolvido (2026-11-11), interpretação (a):** o CRM **não emite orçamentos nem faturas**. O `WorkItem` «Proposta interna» guarda linhas de produto, valores, margem e estado (rascunho → preparada → enviada pelo canal externo → aceite/rejeitada) **só para uso da equipa**, marcado como «documento interno — sem valor comercial ou fiscal», sem numeração nem PDF para o cliente. O orçamento que o cliente recebe continua a ser emitido pelo `globaltoner-orcamentos` ou pelo programa de faturação, e o CRM pode guardar a **ligação/referência** a esse documento (`LigaçãoExterna`). Consequência: o CRM **não substitui** o `globaltoner-orcamentos`; falta apenas analisar o que partilham (catálogo de produtos, preços) para não duplicar dados.

Tratam-se como `WorkItem` do tipo "Orçamento" (passos: rascunho → enviado → aceite/rejeitado) com linhas de produto e totais. **Antes de os desenhar preciso de saber o que o `globaltoner-orcamentos` já faz** e se o CRM o deve substituir, alimentar ou consumir; de outro modo arrisco construir um segundo gerador de propostas.

### 3.10 Menu configurável

- `ItemDeMenu`: rótulo, ícone, **destino** (um `WorkItemType`, uma página de módulo, ou uma vista guardada), ordem, papéis que o veem, agrupamento.
- Um `WorkItemType` com "aparece no menu" cria o seu item automaticamente (lista, quadro por passos e calendário); o administrador reordena, renomeia, agrupa e oculta.
- O menu fixo atual do `AppShell` passa a vir de `GET /menu` (já filtrado por módulos ativos e por papel).

### 3.11 Permissões

Hoje a matriz é fixa em código. Com módulos e tipos configuráveis isso não escala. Proposta: **permissões por módulo e por tipo de item** (`ver`, `criar`, `editar`, `eliminar`) por papel, guardadas em base de dados com **valores por omissão** iguais à matriz atual, e **um só avaliador no backend** (o espelho do frontend passa a consumir `GET /me/permissions` em vez de uma cópia mantida à mão — o que **elimina** o risco de desvio que hoje tem um teste a vigiá-lo).

---

## 4. Mais fluxos comuns que vale a pena considerar

**Honestidade sobre a origem:** a pesquisa sobre CRMs, encomendas e assistências devolveu material útil (§7); a sobre o teu setor específico (impressão/informática/POS) foi **fraca** — vem sobretudo de contratos-modelo e páginas de fornecedores. As sugestões marcadas com ◇ são **inferências minhas** a partir das áreas de negócio que já tens no sistema (`impressão`, `software`, `informática`, `papelaria`, `POS`, `assistência`) e devem ser confirmadas por ti, que conheces o negócio.

| Fluxo | Porque costuma importar | Módulo / peça |
|---|---|---|
| **Equipamentos e garantias** | Cada assistência liga-se a um equipamento do cliente (série, marca, data de compra, garantia); histórico por equipamento; garantia como **portão** ("sem garantia → pedir orçamento") | `Equipamento` (opcional) |
| **Devolução ao fornecedor (RMA)** ◇ | A pesquisa recomenda guardar o nº de RMA do fabricante na ficha e um estado "fora para reparação"; relevante para quem revende | passo + campo na assistência/compra |
| **Contratos e reposição de consumíveis** ◇ | Em impressão gerida: leitura de contadores (páginas) que fecha a faturação mensal; reposição automática de toner; limites por série; estimativa quando falta a leitura | `Contrato` + `Leitura` + automação "toner a baixo → encomenda" |
| **SLA e escalonamento** | Prazos por tipo/prioridade; alerta e escalonamento quando falta cumprir; métricas (tempo até resolução, "resolvido à primeira") que as fontes sobre assistências destacam como dependentes de **datas de passo fiáveis** | `WorkflowStep` com temporizador |
| **Entrada por email** | O módulo de email já existe: um email de `assistencia@` cria uma assistência, de `encomendas@` uma encomenda; anexos já vão para o MinIO | regra de email → item de trabalho |
| **Tarefas recorrentes** | Visitas de manutenção periódicas, renovações de contrato | recorrência no `WorkItem` |
| **Visitas e agendamentos** | Marcar técnico/visita na agenda, conflitos de horário, deslocação | agenda com intervalos + recursos |
| **Listas de verificação (checklists)** | Passos a cumprir por tipo de assistência/instalação | campo "checklist" no tipo |
| **Devoluções e notas de crédito** | Fecham o ciclo da encomenda | passos + linhas negativas |
| **Cobranças** | O papel `FINANCEIRO` e o tipo de tarefa "cobrança" já existem | fluxo de cobrança com prazos |
| **Aprovações** | Orçamento acima de X precisa de aprovação (a pesquisa cita estados "à espera de aprovação" acima de um valor) | portão de aprovação |
| **Listas de preços** | Preços por cliente/grupo e descontos | `ListaPreços` |
| **Deteção e junção de duplicados** | Qualidade de dados de empresas, contactos e leads; evita criar a mesma empresa duas vezes (relevante na conversão de leads) | utilitário transversal |
| **Importação/exportação CSV** | Migração do Bitrix24 e da faturação; relatórios | utilitário transversal |
| **Registo de auditoria** | Quem mudou o quê (estados, preços, stock); exigido assim que há dinheiro e stock | transversal |
| **Relatórios por módulo** | Margem por encomenda, tempo médio de assistência, backlog por passo | painéis por módulo |
| **Portal do cliente** (mais tarde) | O cliente vê o estado da assistência/encomenda por link | fase posterior |

---

## 5. Fases propostas (sem "big bang": cada fase deixa a aplicação a funcionar)

Cada fase usa o padrão **expandir → migrar → contrair** (acrescentar o novo, copiar os dados, só depois remover o antigo), com testes e2e antes e depois, e migrações que preservam os dados existentes.

| Fase | Entrega | Depende de | Decisões |
|---|---|---|---|
| **0 — Fundações** | Registo de módulos + `ModuleSetting` + assistente inicial; `Workflow`/`WorkflowStep` (migração de `Pipeline`/`Stage`); campos personalizados genéricos; permissões em base de dados | — | D4 |
| **1 — Leads** | Nova `Lead` (tipo, ligação a empresa/contacto, índices, `pg_trgm`), modo `EMPRESA/PESSOA/AMBOS`, página única por cursor, conversão por modo, **teste de carga A vs B antes de fechar** | 0 | D1 |
| **2 — Itens de trabalho, agenda e menu** | `WorkItem`/`WorkItemType`, migração de `Task`, agenda unificada, `ItemDeMenu` configurável | 0 | D5 |
| **3 — Automações generalizadas** | Gatilhos/ações para qualquer módulo (incl. `CRIAR_ITEM_DE_TRABALHO`) | 0, 2 | — |
| **4 — Assistências** | `Assistência`, cronómetro servidor, registos de tempo, peças, tipos com passos/campos próprios, automações | 0–3 | — |
| **5 — Produtos, fornecedores e stock** | Catálogo, movimentos, reservas | 0 | D6 |
| **6 — Encomendas, compras e transporte** | Encomendas por linha, compras com receção, avisos de "pronto a preparar", expedições, **API de entrada com chaves** | 0–3, 5 | D7 |
| **7 — Faturação** | Adaptador do teu programa, reconciliação com relatório de divergências | 5, 6 | **D3** |
| **8 — Propostas internas** | `WorkItem` «Proposta interna» (linhas, margem, estado, referência externa ao orçamento emitido); **sem** PDF nem numeração; análise prévia do `globaltoner-orcamentos` só para partilhar catálogo/preços | 2, 5 | D2 (revista) |
| **9 — Extras** | os que escolheres de §4 (equipamentos/garantias, contratos e contadores, SLA, duplicados, CSV, auditoria…) | conforme | D8 |

As fases 0–2 **não dependem** das decisões D2, D3 e D7, por isso podem começar assim que aprovares o desenho geral.

**Faixa de extensões (proposta, ver [plano-extensoes-e-api.md](plano-extensoes-e-api.md) §10)** — corre em paralelo e encaixa assim: **E0** (API pública `/api/v1`, chaves de API, eventos e webhooks, cifra de segredos) **antes** da Fase 6 (a API de encomendas usa as chaves e a idempotência); **E1** (framework de extensões) **antes** da Fase 7; **E2** (Zadarma como primeiro adaptador) pode correr com a Fase 4. A Fase 7 passa a ser «contrato de faturação + adaptadores de referência», já não «adaptador do teu programa».

---

## 6. Riscos e como os reduzir

| Risco | Porque importa | Mitigação |
|---|---|---|
| **Efeito de "plataforma dentro da plataforma"** (*inner platform effect*) | Tornar tudo configurável acaba por reconstruir uma ferramenta *low-code* pior do que as existentes | Configurável **só** o que pediste (passos, campos, tipos de tarefa, menu, módulos). **Em código**: stock, totais, impostos, cronómetros, idempotência, integrações |
| Combinações de módulos a testar | 2^N configurações | CI com "tudo ligado" e "mínimo"; testes estruturais; dependências explícitas |
| Migração de dados existentes | `Pipeline`→`Workflow`, `Task`→`WorkItem`, leads com `companyName` em texto | Expandir→migrar→contrair; migrações escritas à mão (como já fizemos nas revisões), testadas com cópia da base real |
| Desempenho das listagens genéricas | A agenda e as listas misturam tipos | `WorkItem` numa tabela com índices próprios; paginação por cursor; medir antes de otimizar |
| Dinheiro e stock | Erros aqui custam caro | Livro de movimentos (nada de "stock editado"), transações, reconciliação com relatório, testes de propriedade nos cálculos |
| Segurança da API de entrada | É a primeira superfície **de máquinas** exposta | Chaves por integração com âmbito, hash, revogação, limites por chave, idempotência, registo; testes e2e de abuso |
| Complexidade da UI de configuração | Muitos ecrãs de definições | Assistente inicial, valores por omissão sensatos, modelos prontos ("fluxo de assistência típico") |
| Âmbito | Isto é meses de trabalho | Fases independentes; cada uma entrega valor sozinha |

## 7. Fontes consultadas

- Estados de encomendas e fluxos de venda/compra: [Oracle — Order Management Statuses](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25b/fauom/order-management-statuses.html), [Oracle — How Drop Ship Works](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/25b/faiom/how-drop-ship-works-in-order-management.html), [IBM — Purchase order statuses](https://www.ibm.com/docs/en/SSGTJF/productconcepts/c_PurchaseOrderStatuses.html), [Walmart — Drop Ship Vendor order API (estado por linha)](https://developer.walmart.com/suppliers/docs/drop-ship-vendor-dsv-order-management-api-overview), [Radial — Order fulfillment workflow](https://docs.radial.com/Content/rom-general-topics/order-fulfillment-workflow.htm), [Geins — Order statuses](https://www.geins.io/docs/core-features/orders/statuses).
- Assistências, tempo, peças e RMA: [Fieldcode](https://manual.fieldcode.com/?p=976), [Siebel Field Service — Repairs](https://docs.oracle.com/cd/E05554_01/books/FieldServ/FieldServRepair2.html), [Freshservice community — SLA para assistências](https://community.freshworks.com/how-do-i-11341/using-freshservice-sla-workflows-for-field-service-repair-businesses-best-practices-45275), [Tractian — Status of Repair](https://tractian.com/en/glossary/status-of-repair), [RepairQ](https://repairq.io/repair).
- Modelo de leads (B2B/B2C): [RevBlack — HubSpot vs Salesforce data model](https://www.revblack.com/articles/data-model-differences-hubspot-salesforce), [Vantage Point — diferenças de modelo](https://vantagepoint.io/blog/integrations/hubspot-salesforce-integration-data-model-differences), [Open View — Leads e Contacts no Salesforce](https://openviewpartners.com/blog/using-leads-and-contacts-in-salesforce-com/), [ShareCRM — B2B vs B2C](https://www.sharecrm.com/blog/b2b-crm-vs-b2c-crm-key-differences-use-cases-and-how-to-choose/).
- CRMs configuráveis por metadados: [Twenty — custom objects](https://twenty.com/developers/section/backend-development/custom-objects), [Twenty — metadata engine](https://pyshine.com/Twenty-Metadata-Engine-Source-Tour/), [EspoCRM](https://openapps.pro/apps/espocrm).
- Impressão gerida e PSA (cobertura **fraca**, ver §4): [Stratix — leitura automática de contadores e reposição de toner](https://stratixsystems.com/?p=6666), [Canon — acordo MPS de exemplo](https://bidopportunities.iowa.gov/Home/ShowContractDocument/70eaff3d-e2e7-45e7-94fe-171dc2f164cd), [TechTarget — PSA](https://www.techtarget.com/it-strategy/definition/What-is-professional-services-automation-PSA).

> Nota sobre as fontes: são sobretudo documentação de fornecedores e artigos de consultores, não normas. Os limiares concretos (por exemplo "menos de 15 estados") são orientações, não regras.
