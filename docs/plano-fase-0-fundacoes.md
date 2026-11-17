# Fase 0 — Fundações (2026-11-06)

Primeira fase do [desenho da reorganização modular](plano-reorganizacao-modular.md). Objetivo: acrescentar as peças genéricas **sem mudar o comportamento atual** — no fim de cada pacote, a aplicação faz exatamente o mesmo que antes, mas já está preparada para os módulos seguintes. Plano escrito antes de qualquer alteração.

## Os 4 pacotes (cada um é um PR independente, por esta ordem)

| Pacote | Entrega | Risco para os dados | Estado |
|---|---|---|---|
| **0a — Registo de módulos** | Ligar/desligar módulos (leads, funis/negócios, email, telefonia, automações), menu e rotas dependentes do que está ativo, dependências, página de definições | **Nenhum** (só acrescenta uma tabela) | a fazer agora |
| **0b — Campos personalizados genéricos** | `entityType` deixa de ser um enum fechado (registo de tipos); validação dos valores; limpeza ao apagar; permissões por tipo de registo | Baixo (conversão de enum para texto, valores iguais) | a fazer agora |
| **0c — Fluxos genéricos** | `Pipeline`/`Stage` → `Workflow`/`WorkflowStep`, com categorias, transições e portões | **Médio** (migra dados reais: negócios e regras de automação apontam para as fases) | depois |
| **0d — Permissões em base de dados** | Matriz por módulo/tipo guardada na BD, com os valores atuais por omissão; o frontend deixa de ter uma cópia | Baixo | depois |

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

### Pacotes 0c, 0d
Serão detalhados no seu próprio plano quando chegar a vez de cada um. O 0c (fluxos) é o mais delicado e terá um plano de migração específico com **teste sobre uma cópia da base real**.

## Registo de execução
- [x] 0a — Registo de módulos (ver decisoes.md)
- [ ] 0b — Campos personalizados genéricos
- [ ] 0c — Fluxos genéricos
- [ ] 0d — Permissões em base de dados
