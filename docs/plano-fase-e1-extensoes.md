# Fase E1 — Base de extensões (plano, 2026-11-26)

Faixa de extensões do [desenho de extensões e API](plano-extensoes-e-api.md) (§4, §5, §8 e §10). Vem **antes da Fase 7**
(faturação): o adaptador do programa de faturação vai ser uma extensão, e o núcleo tem de saber o que é uma extensão,
como se liga, que definições tem e que trabalho agendado faz. Depende da faixa E0 (API pública, chaves, auditoria,
webhooks, **segredos cifrados**) e do registo de módulos (0a), tudo feito.

**Objetivo:** um único conceito de **extensão** para os módulos que vêm no CRM («embutidas») e para os que se instalam
depois, com **manifesto validado**, **definições geradas a partir de um esquema** (com segredos cifrados), **tarefas
agendadas do núcleo** com registo e disjuntor, e um **carregador de extensões da pasta `extensions/`** (forma B: código
da equipa, de confiança total). Nada de código de terceiros dentro do processo (§9 do desenho).

## O que existe hoje
- **Registo de módulos** (0a): 10 manifestos em código (`modules/module-manifest.ts`: id, nome, descrição,
  dependências, ativo por omissão), estado e opções em `ModuleSetting`, `@RequireModule` + `ModuleGuard` (404 com o
  módulo desligado), página Configurações → Módulos. As opções de um módulo já existem (`ModuleSetting.options`), mas
  cada módulo tem a sua página própria (o modo das leads, a Zadarma).
- **Contribuições da interface** (2c): cada módulo declara no frontend os itens de menu, as rotas e os cartões.
- **Segredos cifrados em repouso** (E0a, AES-256-GCM com `SECRETS_KEY`), auditoria (E0b), webhooks com catálogo de
  eventos (E0d).
- **Tarefas agendadas espalhadas:** cinco `@Cron` em serviços diferentes (automações por tempo e limpeza, entrega de
  webhooks, sincronização da Zadarma, limpeza da idempotência), sem registo de execuções nem forma de ver que a
  sincronização da Zadarma falha há dias (só nos logs).
- `integrations/` com contratos vazios (Bitrix, Gmail, Graph, MailProvider, WhatsApp), sem uso.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Consumidores reais | Risco |
|---|---|---|---|
| **E1.1 — Manifesto e página das extensões** | Formato do manifesto (§4) com esquema e validação (versões *semver*, compatibilidade com o SDK do núcleo, dependências por intervalo de versão, permissões declaradas de um vocabulário fechado); os 10 módulos passam a manifestos de extensões **embutidas** (uma só fonte de verdade); validação ao arrancar; `GET /extensions`; a página «Módulos» passa a «Módulos e extensões» com origem, versão, dependências e o que cada uma declara (rede, segredos) | os 10 módulos | Baixo |
| **E1.2 — Tarefas agendadas do núcleo** | Registo de tarefas (o agendador é do núcleo, §5.5): cada execução fica registada (início, fim, erro), com limite de tempo, interruptor e **disjuntor** (N falhas seguidas → pausa e aviso ao Administrador); página com o estado de cada tarefa e «correr agora» | os 5 `@Cron` atuais | Médio |
| **E1.3 — Definições por esquema; Zadarma como adaptador** | Definições de uma extensão descritas por esquema JSON → formulário gerado; campos `secret` cifrados com o contexto da extensão e nunca devolvidos; contrato `TelephonyProvider` (§5.1) com a Zadarma como primeiro adaptador (sai do núcleo para o contrato); o modo das leads passa a definição do esquema | modo das leads, credenciais da Zadarma | Médio |
| **E1.4 — Carregador da pasta `extensions/` e SDK** | Pacote `@opencrm/extension-sdk` (tipos do manifesto, `defineExtension`, subscrição de eventos, tarefas, fornecedores de contratos); carregador de extensões da pasta (forma B), **só com soma de verificação aprovada** pelo Administrador; ciclo de vida (validar → instalar → ligar/desligar → desinstalar, dados mantidos); auditoria; extensão de exemplo no repositório para os testes | extensão de exemplo + as embutidas | Alto |

Depois da E1: **E3 / Fase 7 — contrato de faturação** (`BillingProvider`, *outbox*, reconciliação, adaptador simulado
e por ficheiros). Os pacotes de confiança (assinatura, carregar pela interface — E1b do desenho) e o *runner* isolado
para código de terceiros (E1c do desenho) ficam para depois, quando houver uma extensão de terceiros para os justificar.

## Decisões assumidas (a rever)
- **Regra de dois:** cada peça entra com consumidores reais. Por isso a E1 não traz páginas de extensão nem painéis
  nas fichas (§5.4): o frontend continua com o registo de contribuições (2c), e uma extensão da pasta só contribui
  definições, tarefas, eventos e fornecedores de contratos.
- **Os módulos continuam a ser módulos.** «Extensão embutida» é o mesmo conceito com origem diferente; `ModuleId`,
  `@RequireModule` e `ModuleSetting` ficam (são o interruptor de qualquer extensão). Não se renomeia nada na base.
- **`permissions` são declaração e auditoria, não *sandbox*** (§4 e §9 do desenho): mostram ao Administrador o que a
  extensão diz precisar; para código da forma B não são impostas. A página di-lo.
- **Versão das embutidas = versão do CRM**; o núcleo tem uma versão de SDK (`1.0.0`) que as extensões declaram aceitar.
- **Sem dependências novas:** o *semver* cobre só os formatos usados (`1.2.3`, `^1.2.0`, `~1.2.0`, `>=1.2.0`, `*`), e a
  validação do manifesto é escrita à mão (é pequena e dá mensagens em português com o caminho do campo), com testes.

## Pacote E1.1 — Manifesto e página das extensões

### Manifesto
```ts
interface ExtensionManifest {
  id: string;            // minúsculas, dígitos e hífens; único
  name: string;
  description: string;
  version: string;       // semver; nas embutidas, a versão do CRM
  sdk: string;           // intervalo de versões do SDK do núcleo que aceita (embutidas: "^1.0.0")
  origin: "builtin" | "installed";
  dependsOn: Record<string, string>;  // id → intervalo de versões
  provides: string[];    // contratos que implementa (vocabulário fechado; vazio por agora)
  permissions: string[]; // o que declara precisar (vocabulário fechado, abaixo)
  defaultEnabled: boolean;
}
```
- **Vocabulário das permissões** (fechado, com descrição em português para a página): `data:<área>:write` (as áreas
  de escrita da 0d: leads, negócios, encomendas…), `net:egress:<domínio>` (fala com um serviço externo),
  `net:egress:configured` (fala com servidores que o utilizador configura — IMAP/SMTP), `secrets:own` (guarda
  segredos próprios, cifrados), `webhooks:emit` (emite eventos), `jobs:schedule` (tem tarefas agendadas).
- **Validação** (forma e regras): campos obrigatórios e desconhecidos, formatos de id e versão, intervalo do SDK
  compatível com o do núcleo, dependências existentes e com a versão dentro do intervalo, sem ciclos, permissões do
  vocabulário. Erros com o caminho do campo e uma mensagem clara.
- **Embutidas:** os 10 manifestos de módulos passam a ter os campos novos; `MODULE_MANIFESTS` continua a existir
  (é a vista que o resto do código usa) e é derivado da mesma lista. Ao arrancar, o backend valida-os e **recusa
  arrancar** com um manifesto inválido (é erro de programação); um teste unitário faz o mesmo no CI.

### API e página
- `GET /extensions` (Administrador): cada extensão com o manifesto, o estado (ligada/desligada, do `ModuleSetting`),
  quem depende dela e as permissões com a descrição. Ligar/desligar continua em `PATCH /modules/:id` (com as mesmas
  regras de dependências e a auditoria).
- Configurações → «Módulos e extensões»: o que existe hoje (ligar/desligar, dependências, modo das leads) mais a origem
  («Embutida»), a versão e as permissões declaradas («Fala com api.zadarma.com», «Guarda segredos cifrados»…), com a
  nota de que as permissões são o que a extensão declara.

### Validação prevista
- Unitários: o validador (cada regra, com manifestos certos e errados), o *semver* (formatos e limites), as embutidas
  válidas e coerentes com `ModuleId`, o grafo de dependências.
- e2e: `GET /extensions` (Administrador sim, outros papéis 403, conteúdo e estado após ligar/desligar).
- Prova por mutação; sem migração (nada muda na base); browser na base de testes.

### Execução do E1.1 (2026-11-26)
**Implementado como planeado**, com estes pormenores:
- **Código** em `apps/backend/src/extensions/`: `manifest.ts` (formato, `SDK_VERSION = 1.0.0`, validação de um manifesto
  e de um conjunto), `semver.ts`, `permissions.ts` (vocabulário com a descrição em português), `builtin.ts` (os
  módulos como embutidas, derivados de `MODULE_MANIFESTS`) e `GET /extensions`. Os manifestos dos módulos ganharam
  `permissions`.
- **Permissões declaradas dos módulos:** leads (leads, empresas, contactos, eventos), negócios (negócios, eventos),
  email (enviar email, modelos, servidores configurados, segredos), Zadarma (ligar, `api.zadarma.com`, segredos,
  tarefas agendadas), automações (negócios, trabalho do dia-a-dia, servidores configurados, eventos, tarefas
  agendadas), assistências (trabalho do dia-a-dia), produtos (catálogo), stock (movimentos), encomendas (encomendas,
  empresas e contactos pela API, eventos), compras (compras). O email não declara tarefas agendadas: a sincronização
  é do `email-worker`, um serviço à parte.
- **Validação escrita à mão** em vez do `ajv` (sem dependências novas): mensagens em português com o campo, e as regras
  de conjunto (ids repetidos, dependências, versões, ciclos) que um esquema JSON não exprime.
- **Ao arrancar**, um conjunto de embutidas inválido impede o backend de arrancar; o teste unitário verifica o mesmo
  conjunto no CI.
- **Página:** Configurações → «Módulos e extensões» (o item do menu mudou de nome; a rota é a mesma), com «Embutida ·
  versão 1.0.0 · declara N permissões» em cada módulo, a abrir a lista, e a nota de que é uma declaração e não uma
  barreira.

**Validação:**
- Unitários novos (`extensions.spec.ts`: *semver*, permissões, manifesto, conjunto, embutidas) e 1 e2e novo
  (`GET /extensions`: Administrador, 403, 401, conteúdo, estado depois de desligar). Bateria completa: 557 e2e e 339
  unitários.
- **Prova por mutação:** 27 mutações, todas apanhadas. Escapou uma na primeira corrida (o id aceitar maiúsculas: o
  teste só usava «Faturação», recusado pelo «ç»), que passou a ser apanhada com ids só com maiúsculas e hífens.
  Não coberto por teste: a recusa de arrancar com manifestos inválidos (o teste unitário verifica a mesma lista).
- **Sem migração** (nada muda na base).
- **Browser** (base de testes, Administrador): a página com os 10 módulos como embutidas; a Telefonia (Zadarma) mostra
  as 4 permissões («Liga-se a api.zadarma.com», «Guarda segredos próprios… cifrados»…); desligar e voltar a ligar
  mantém o detalhe; nenhum pedido falhado.

## Pacote E1.2 — Tarefas agendadas do núcleo
Detalhado a 2026-11-26, depois do merge do E1.1.

### O que muda
- **Catálogo de tarefas em código** (`jobs/job-catalog.ts`): id, nome, descrição, a extensão dona (ou o núcleo), o horário
  (a expressão e o texto em português), o limite de tempo, quantas falhas seguidas a põem em pausa e se as passagens
  sem trabalho ficam no registo. As seis tarefas:

  | Tarefa | Dona | Horário | Pausa ao fim de |
  |---|---|---|---|
  | Entrega de webhooks | núcleo | 30 em 30 s (as passagens sem nada para entregar não ficam no registo) | 20 falhas (10 min) |
  | Sincronização das chamadas da Zadarma | `zadarma` | 10 em 10 min | 6 falhas (1 h) |
  | Automações por tempo | `automations` | de hora a hora | 3 falhas |
  | Limpeza do histórico das automações | `automations` | 3:00 | 3 falhas |
  | Limpeza da idempotência da API | núcleo | 3:00 | 3 falhas |
  | Limpeza do registo das tarefas (nova) | núcleo | 3:30 | 3 falhas |

- **Um só caminho de execução** (`JobsService.trigger(id)`): os `@Cron` continuam a marcar a hora, mas só chamam o
  registo; o trabalho de cada tarefa é registado pelo serviço dono ao arrancar. O registo:
  - **salta** com a extensão dona desligada, com a tarefa desligada, em pausa, ou com uma passagem anterior ainda a
    correr (uma só instância do backend);
  - **regista** cada passagem (`ScheduledJobRun`: início, fim, resultado `SUCCESS`/`FAILED`/`TIMEOUT`, resumo, erro
    encurtado, automática ou manual e por quem) e o estado (`ScheduledJobState`: ligada, em pausa e porquê, falhas
    seguidas, última passagem, último sucesso, último erro);
  - **limite de tempo:** passado o limite, a passagem conta como falha (`TIMEOUT`); o trabalho não se pode
    interromper, por isso a seguinte só começa quando ele acabar;
  - **disjuntor:** ao fim de N falhas seguidas a tarefa fica **em pausa**; fica na auditoria (`job.paused`, sem
    utilizador) e os Administradores veem um aviso no topo da aplicação até a retomarem.
- **Para isso as tarefas passam a falhar de verdade:** a sincronização da Zadarma e a fila de webhooks deixam de
  esconder o erro (continua a ir para os logs).
- **Página Configurações → «Tarefas agendadas»** (Administrador): cada tarefa com a dona, o horário, o estado, a
  última passagem e o último erro; «Correr agora», «Desligar/Ligar» e «Retomar»; as últimas passagens de cada uma.
  Correr à mão uma tarefa em pausa e correr bem tira-a da pausa. Tudo na auditoria.
- **Retenção:** as passagens com mais de 30 dias apagam-se (a tarefa nova).
- **Teste estrutural:** todo o `@Cron` só chama o registo, toda a tarefa do catálogo tem trabalho registado, e as
  extensões donas de tarefas declaram `jobs:schedule` (e só elas).

### Migração
Duas tabelas novas (`ScheduledJobState`, `ScheduledJobRun`) e dois enums; nenhum dado existente é tocado. Ensaio numa
cópia da base de desenvolvimento, reversão e comparação, como sempre.

### Validação prevista
- Unitários: o registo com um relógio e tarefas falsas (saltos, sucesso, falha, limite de tempo, disjuntor, retomar,
  sem sobreposição, passagens sem trabalho), o teste estrutural.
- e2e: as rotas (Administrador; outros 403), «Correr agora» de cada tarefa real, o módulo desligado, a pausa e o
  aviso, a auditoria; os testes que já chamavam as tarefas continuam a passar.
- Prova por mutação; ensaio da migração; browser na base de testes.

### Execução do E1.2 (2026-11-26)
**Implementado como planeado**, com estes pormenores:
- **Código** em `apps/backend/src/jobs/`: `job-catalog.ts` (as seis tarefas), `jobs.service.ts` (registo, saltos,
  limite de tempo, disjuntor, gestão), `jobs.scheduler.ts` (o único sítio com `@Cron`: um método por tarefa que só a
  passa ao registo) e `jobs.controller.ts` (`GET /jobs`, `GET /jobs/alerts`, `GET /jobs/:id/runs`,
  `POST /jobs/:id/run`, `PATCH /jobs/:id`, `POST /jobs/:id/resume`, só Administrador, com auditoria).
- **Donos do trabalho:** a fila de webhooks, a Zadarma e as automações registam-no no construtor. A limpeza da
  idempotência saiu do interceptor para um serviço próprio (`IdempotencyCleanupService`): o Nest cria o interceptor
  uma vez por controller que o usa, e uma tarefa tem um só dono (o arranque recusou-o logo, com «já tem trabalho
  registado»).
- **As tarefas passaram a dizer o que fizeram** («3 entregas», «0 chamadas novas», «2 registos apagados») e a falhar
  de verdade: a Zadarma e a fila de webhooks deixaram de esconder o erro. As automações por tempo continuam a
  guardar a falha de cada regra no seu histórico, sem parar as outras.
- **Passagens em pausa só por falhas automáticas ou manuais;** retomar tira da pausa sem correr. Uma passagem
  automática bem-sucedida nunca encontra a tarefa em pausa (não corre), por isso só a manual tira da pausa.
- **Aviso** no topo da aplicação, só para Administradores, com o link para a página; atualiza-se em tempo real quando
  uma tarefa entra em pausa ou é retomada.
- Configurações → «Tarefas agendadas»: cada tarefa com o estado (ativa, desligada, em pausa, módulo desligado, a
  correr), o horário, a dona, a última passagem e o último erro, «Correr agora», «Desligar/Ligar», «Retomar» e as
  últimas 20 passagens.

**Validação:**
- 9 e2e novos (`jobs.e2e-spec.ts`) e testes estruturais (`jobs-structure.spec.ts`: só o agendador tem `@Cron`, um por
  tarefa com o horário do catálogo, cada tarefa com trabalho registado uma vez, donas = quem declara
  `jobs:schedule`). Os testes que já chamavam as tarefas passam sem mudar o que verificam. Bateria completa: 566 e2e
  e 345 unitários.
- **Prova por mutação:** 27 mutações, 26 apanhadas e 1 equivalente (uma passagem automática tirar da pausa: em pausa
  a automática não corre). Duas escaparam na primeira corrida e passaram a ser apanhadas: a limpeza apagar também as
  recentes e a ordem das passagens.
- **Migração** ensaiada numa cópia da base de desenvolvimento: as duas tabelas, o CHECK das falhas, a chave
  estrangeira e os enums recusam valores inválidos; sem desvio; a reversão deixou dados e esquema iguais (impressões
  digitais 4392755f… e 56b74e29…). Cópia apagada. Base de desenvolvimento migrada depois de uma cópia de segurança.
- **Browser** (base de testes, Administrador): com a sincronização da Zadarma em pausa (6 falhas), o aviso aparece em
  todas as páginas; a página mostra o motivo, o último erro e as 6 passagens falhadas; «Retomar» tirou o aviso; a
  entrega de webhooks passou a correr de 30 em 30 s (11:06:00, 11:06:30…); «Correr agora» na limpeza do registo deu
  «correu bem · 0 passagens apagadas»; nenhum pedido falhado. Acerto feito: os botões passaram a ficar sempre por
  baixo da descrição (antes, conforme o tamanho do texto, ficavam ao lado ou por baixo).
