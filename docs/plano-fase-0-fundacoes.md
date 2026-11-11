# Fase 0 — Fundações (2026-11-06)

Primeira fase do [desenho da reorganização modular](plano-reorganizacao-modular.md). Objetivo: acrescentar as peças genéricas **sem mudar o comportamento atual** — no fim de cada pacote, a aplicação faz exatamente o mesmo que antes, mas já está preparada para os módulos seguintes. Plano escrito antes de qualquer alteração.

## Os 4 pacotes (cada um é um PR independente, por esta ordem)

| Pacote | Entrega | Risco para os dados | Estado |
|---|---|---|---|
| **0a — Registo de módulos** | Ligar/desligar módulos (leads, funis/negócios, email, telefonia, automações), menu e rotas dependentes do que está ativo, dependências, página de definições | **Nenhum** (só acrescenta uma tabela) | a fazer agora |
| **0b — Campos personalizados genéricos** | `entityType` deixa de ser um enum fechado; âmbito por tipo | Baixo (conversão de enum para texto, valores iguais) | depois |
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

## Pacotes 0b, 0c, 0d
Serão detalhados no seu próprio plano quando chegar a vez de cada um, com a mesma regra: plano → implementação → validação → PR → só então o seguinte. O 0c (fluxos) é o mais delicado e terá um plano de migração específico com **teste sobre uma cópia da base real**.

## Registo de execução
- [x] 0a — Registo de módulos (PR #27)
- [ ] 0b — Campos personalizados genéricos
- [ ] 0c — Fluxos genéricos
- [ ] 0d — Permissões em base de dados
