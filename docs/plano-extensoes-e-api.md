# Extensões (add-ons/plugins) e API pública: proposta de desenho (2026-11-11)

**Estado: proposta para revisão. Nada disto está implementado.** Complementa a [reorganização modular](plano-reorganizacao-modular.md) e o [registo de módulos](plano-fase-0-fundacoes.md) (Fase 0a, já feito).

**Pedido:** (1) o CRM deve ter uma **API** a que se possam ligar sistemas externos, em particular sistemas de **faturação**, sem alterar o núcleo; (2) deve existir um **sistema de gestão de módulos/add-ons/plugins** que permita criar extensões que alargam as funcionalidades. O programa de faturação concreto **não importa agora**: o que importa é o contrato.

Estrutura: §1 resumo e decisões · §2 o ponto de partida · §3 as três formas de estender · §4 o manifesto · §5 pontos de extensão · §6 a API pública · §7 faturação · §8 ciclo de vida · §9 segurança (com limites ditos às claras) · §10 fases · §11 riscos · §12 fontes.

---

## 1. Resumo

**A ideia central:** "plugin" quer dizer três coisas diferentes, com riscos muito diferentes. Em vez de um único mecanismo que serve mal todas, proponho **três formas de estender**, da mais segura para a mais poderosa:

| Forma | O que é | Onde corre | Segurança | Serve para |
|---|---|---|---|---|
| **A. Integração externa** | Um serviço à parte que fala com o CRM pela **API pública** e por **eventos/webhooks** | **Fora** do CRM (outro processo, container ou o teu **n8n**) | **Alta**: só faz o que a chave de API permite | Conectores de faturação, lojas online, transportadoras, tudo o que venha de terceiros |
| **B. Extensão interna** | Pacote TypeScript carregado **dentro** do backend (módulo Nest dinâmico) | No processo do CRM | **Confiança total**: pode fazer tudo o que o núcleo faz | Módulos nossos (encomendas, assistências), adaptadores que precisam da base de dados ou do agendador |
| **C. Extensão declarativa** | Só **dados**: campos, fluxos, tipos de tarefa, regras de automação, itens de menu, modelos | No núcleo (validada contra esquemas) | **Alta**: não executa código | Configurações partilháveis, "pacotes de assistência típica" |

Uma extensão real pode combinar as três (um manifesto C + código B + um serviço A). **Os módulos que já existem** (leads, negócios, email, telefonia, automações) passam a ser **extensões "embutidas"** com o mesmo manifesto — assim um módulo nosso e um módulo instalado são o mesmo conceito, só com origem diferente.

**A verdade desconfortável que condiciona tudo:** não existe forma fiável de correr **código de terceiros** dentro de um processo Node com segurança (§9). Por isso a regra do desenho é: **código em que não confias → forma A (fora do CRM). Código em que confias → forma B.** Não vou fingir que as "permissões" da forma B são uma *sandbox*.

### Decisões que preciso de ti

| # | Decisão | A minha recomendação |
|---|---|---|
| E1 | **Quem escreve extensões?** Só tu/a tua equipa, ou também terceiros e clientes que instalam código de outros? | Só a equipa na forma B; **tudo o que venha de terceiros na forma A**. Muda o nível de segurança exigido |
| E2 | **Como se instalam?** Pasta no servidor (v1), carregar um pacote pela interface, ou um catálogo/mercado | Pasta no servidor primeiro; carregar pela UI só quando houver assinatura de pacotes |
| E3 | **Dados das extensões:** só um armazenamento fornecido pelo SDK (coleções), ou também tabelas SQL próprias? | SDK por omissão; tabelas próprias só para a forma B, com prefixo e migrações registadas |
| E4 | **Segredos em claro na base de dados.** Hoje `EmailAccount.password` e `ZadarmaAccount.apiSecret` estão guardados sem cifra. As extensões vão guardar chaves de terceiros | **Cifrar em repouso já** (chave `SECRETS_KEY` fora da base de dados) — antes de haver extensões |
| E5 | **Faturação:** um só programa ativo, ou vários (por filial/empresa)? | Um só por instalação; o contrato permite vários mais tarde |
| E6 | O **n8n** (que já usas) é um tempo de execução oficial da forma A, com modelos prontos? | Sim: é o caminho mais barato para integrações pontuais |

### Respostas do utilizador (2026-11-11) e consequências

| # | Resposta | Consequência para o desenho |
|---|---|---|
| E1 | **Também terceiros/clientes** | O código de terceiros **não pode** correr no processo do CRM (§9). Nova forma **D — extensão empacotada com *runner* isolado** (§3.4): o código corre **fora** do backend, sem acesso à base de dados nem aos segredos do núcleo |
| E2 | **Carregar pela interface** | Exige **pacotes assinados** (assinatura verificada contra chaves de editores que o administrador aprova), soma de verificação, pré-visualização das permissões antes de aceitar e **registo de auditoria**. Sem assinatura válida, o pacote não instala |
| E3 | Coleções do SDK; tabelas próprias só na forma B | Mantém-se; a forma D **só** tem coleções do SDK |
| E4 | Cifrar segredos em repouso na fase E0 | Mantém-se; passa a **pré-requisito** de qualquer instalação de pacotes |
| E5, E6 | **Por responder** | Assumidos: um programa de faturação ativo por instalação; n8n como tempo de execução suportado |

**Isto aumenta bastante o âmbito.** «Terceiros + carregar pela UI» é o caso mais exigente, e deve ser feito **por camadas**: primeiro a infraestrutura de confiança (assinatura, auditoria, âmbitos) e os pacotes que **não executam código** (forma C), depois o *runner* para código de terceiros (forma D). O ponto de partida continua a ser a API pública (E0), de que tudo depende.

---

## 2. O ponto de partida

| Já existe | Limite para extensões |
|---|---|
| Registo de módulos (0a): `ModuleSetting`, `@RequireModule`, manifestos **em código** | Os manifestos são fixos no código; não há descoberta, versões, permissões nem ciclo de vida |
| Webhooks de saída para o n8n (`WebhooksService`) | Um **único URL** para todos os eventos, sem assinatura, sem repetição nem registo de entregas |
| Canal de tempo real (Socket.io) | Só serve a interface; não há bus de eventos de domínio |
| Chave interna para o `email-worker` | Não há **chaves de API por integração**, nem âmbitos |
| `Zadarma` e `email` acoplados ao núcleo | Não implementam nenhum contrato; trocar de fornecedor exige alterar o núcleo |
| Segredos de integrações | **Em claro** na base de dados |
| Nenhuma API pública documentada | Sem OpenAPI, sem versionamento, sem política de compatibilidade |

---

## 3. As três formas de estender

### Forma A — Integração externa (a que recomendo por omissão)
Um serviço separado, escrito em qualquer linguagem, que:
- **lê e escreve** no CRM pela **API pública** (§6), autenticado com uma **chave de API com âmbitos**;
- **reage** a eventos do CRM por **webhooks assinados** (§5), com repetição e registo de entregas.

Vantagens: isolamento real (um conector que rebenta não derruba o CRM nem lê dados fora do seu âmbito), ciclo de vida independente (atualiza-se sem reiniciar o CRM), qualquer linguagem. **O n8n que já tens é um tempo de execução natural para isto.** Desvantagem: mais uma peça a operar; latência de rede; não acede a nada que a API não exponha.

### Forma B — Extensão interna (confiança total)
Um pacote TypeScript com um manifesto, carregado pelo backend como módulo Nest dinâmico. Pode registar rotas, serviços, tarefas agendadas, gatilhos e ações de automação, fornecedores de contratos (§5) e usar o SDK para aceder ao núcleo.

**Limite assumido (§9):** corre no mesmo processo, com acesso à base de dados e aos segredos. É **tão confiável quanto o código do núcleo**. Só se instala código que se escreveu ou reviu.

### Forma C — Extensão declarativa (sem código)
Um manifesto de dados que contribui: campos personalizados, tipos de item de trabalho, fluxos e passos, regras de automação, itens de menu, formulários de definições (gerados a partir de um esquema JSON), modelos de email/documentos. Como **não executa código**, é segura por construção e é a forma ideal de partilhar "um pacote de assistências para impressoras".

### 3.4 Forma D — Extensão empacotada com *runner* isolado (para código de terceiros)

Resposta à decisão E1: terceiros podem entregar **código**, mas ele **nunca corre no backend**.

- O pacote (`.zip` com `extension.json` + código + assinatura) é carregado pela UI, validado e guardado.
- Um serviço à parte, o **`extension-runner`** (contentor próprio, utilizador sem privilégios, sistema de ficheiros só de leitura, **sem credenciais da base de dados**, limites de CPU/memória, saída de rede **limitada aos domínios declarados** no manifesto), executa o código de cada extensão **num processo próprio**.
- A extensão só comunica com o CRM pela **API pública** com uma **chave de âmbitos** criada para ela, e recebe eventos por RPC/webhook interno. É, na prática, a **forma A gerida pelo CRM**: mesmo modelo de segurança, mas instalável pela UI.
- O CRM **não** monta o `docker.sock` nem lança contentores por pedido (daria controlo do servidor a quem comprometesse o backend): o *runner* é um serviço fixo que o administrador ativa no `docker-compose`; sem *runner* configurado, a UI aceita só pacotes sem código (forma C).
- **Limite assumido:** isolamento de contentor é bem mais forte do que `vm`/*worker threads*, mas **não é perfeito** (depende do *kernel* e da configuração). É aceitável para extensões de editores aprovados, não para código anónimo. A ativação do *runner* deve vir com um aviso claro ao administrador.
- A confirmar na implementação (não verifiquei): se o modelo de permissões do Node (`--permission`) está estável na versão usada (Node 22) e se serve como camada adicional dentro do *runner*.

---

## 4. O manifesto de extensão

Cada extensão (embutida ou instalada) tem um `extension.json`:

```jsonc
{
  "id": "faturacao-exemplo",            // único, minúsculas e hífens
  "name": "Faturação — Exemplo",
  "version": "1.2.0",                    // semver da extensão
  "sdk": "^1.0.0",                       // intervalo do SDK do CRM com que é compatível
  "origin": "installed",                 // "builtin" (vem no CRM) | "installed"
  "dependsOn": { "orders": "^1.0.0" },   // módulos/extensões de que precisa
  "provides": ["billing"],               // contratos que implementa (§5)
  "permissions": ["orders:read", "stock:write", "net:egress:api.exemplo.pt", "secrets:own"],
  "settings": { /* esquema JSON → formulário gerado; campos "secret": true ficam cifrados */ },
  "menu": [ { "label": "Faturação", "target": "settings:faturacao-exemplo" } ],
  "contributes": { "customFields": [], "workflows": [], "automationRules": [], "workItemTypes": [] },
  "server": "dist/index.js",             // forma B (opcional)
  "migrations": "migrations/"            // só forma B; ver E3
}
```

- O núcleo **valida** o manifesto contra um esquema antes de instalar (campos desconhecidos, ids repetidos, dependências em falta, intervalo de SDK incompatível → recusa com mensagem clara).
- Substitui os manifestos em código do registo de módulos (0a): o que hoje é `module-manifest.ts` passa a ser o manifesto **embutido** de cada módulo.
- **Aviso honesto sobre `permissions`:** são um **contrato e uma ajuda de auditoria** (o administrador vê o que a extensão declara precisar, e o SDK recusa operações fora do declarado). Para código da forma B **não são uma sandbox**: código que importe o Prisma diretamente contorna o SDK. Só são **impostas de verdade** na forma A (âmbitos da chave de API) e C (sem código).

---

## 5. Pontos de extensão (os "contratos")

### 5.1 Fornecedores de capacidade (o padrão que torna os conectores trocáveis)
O núcleo define um **contrato** por capacidade e um **registo** onde as extensões se inscrevem. O resto do CRM só fala com o contrato.

| Contrato | O que o núcleo faz | O que o adaptador faz | Já temos |
|---|---|---|---|
| `BillingProvider` | motor de sincronização, mapeamento, reconciliação, UI de erros (§7) | tradução e transporte para o programa X | — |
| `TelephonyProvider` | botão de ligar, histórico, sincronização periódica | falar com a Zadarma/outro | **Zadarma**, hoje acoplado → vira o 1.º adaptador |
| `CarrierProvider` | expedições, seguimento | etiquetas/seguimento de uma transportadora | — |
| `ShopConnector` | encomendas de entrada, estado de saída | falar com uma loja online | — |
| `MailTransport` | caixa de email, envio | IMAP/SMTP, Graph, Gmail | email (IMAP/SMTP), `integrations/` já tem contratos vazios |

Cada contrato traz uma **suite de conformidade** (testes que qualquer adaptador executa contra um servidor simulado): quem escreve o adaptador do programa de faturação X sabe que está correto quando a suite passa. É o que "torna fácil acrescentar" um adaptador novo.

### 5.2 Eventos de domínio e webhooks
- Um **bus de eventos** interno (`order.created`, `deal.stage_changed`, `service_case.closed`, `stock.low`, …) com envelope versionado `{ id, tipo, versão, ocorridoEm, dados }`. O `id` permite **deduplicar** no consumidor.
- **Subscrições de webhook** configuráveis: URL, eventos, **segredo para assinatura HMAC**, repetição com recuo exponencial, **registo de entregas** e repetição manual. Generaliza o `WebhooksService` atual (um URL, sem assinatura).
- Forma B subscreve diretamente no bus; forma A recebe webhooks.
- **Os eventos não levam dados sensíveis desnecessários** (mesmo princípio do tempo real): levam identificadores e o mínimo, e o consumidor vai buscar o resto à API com a sua chave (assim as permissões da chave valem sempre).

### 5.3 Automações, fluxos e menu
Extensões contribuem **gatilhos**, **ações** (`billing.emitirDocumento`), **portões** de fluxo (`faturação confirmada`) e **itens de menu**, todos declarados no manifesto e registados no motor de automações generalizado (Fase 3 da reorganização).

### 5.4 Interface
- **Declarativa (v1):** menu, formulários de definições gerados do esquema, painéis simples nas fichas (tabela, pares chave-valor, botão que chama uma ação). O núcleo desenha-os: nenhum código de terceiros corre no browser.
- **Páginas personalizadas (mais tarde):** numa `iframe` com `sandbox`, a falar com o núcleo por `postMessage` com um SDK mínimo. Só depois de existirem assinatura e revisão de pacotes (E2).
- Deliberadamente **não** se permite que uma extensão injete JavaScript no frontend principal: é o caminho clássico para roubar a sessão (o token de acesso vive no `localStorage`).

### 5.5 Tarefas agendadas
A extensão regista tarefas; **o agendador é do núcleo**. Cada execução fica registada (início, fim, erro), com limite de tempo e **interruptor** para a desligar. Uma extensão não cria os seus próprios `setInterval`.

---

## 6. A API pública (a base de tudo o que é forma A)

**Separada da API da interface.** Hoje a API é a "API da UI" (JWT de utilizador, sem garantias de estabilidade). A API pública é um produto à parte:

- **Prefixo `/api/v1/…`** e **política de compatibilidade**: dentro da `v1` só se acrescenta; remoções e mudanças incompatíveis exigem `v2` e um período de descontinuação anunciado (cabeçalho `Deprecation`/`Sunset`).
- **Chaves de API por integração:** guardadas com *hash* (nunca em claro), **âmbitos** granulares (`orders:read`, `orders:write`, `stock:read`, `products:read`, `webhooks:manage`…), data de criação/último uso/expiração, revogação imediata, **limite de pedidos por chave**, registo de utilização. **Nunca** aceita JWT de utilizador e **nunca** devolve dados fora do âmbito da chave.
- **Idempotência:** todo o `POST` aceita `Idempotency-Key`; repetir o mesmo pedido devolve o mesmo resultado sem duplicar (essencial para uma loja que repete uma encomenda por timeout).
- **Sincronização eficiente:** `updated_since`, paginação por cursor, `ETag`/`If-None-Match`, e **ids externos** (`externalId` + `source`) em todas as entidades sincronizáveis, para os conectores casarem registos sem tabelas auxiliares.
- **Documentação gerada:** especificação **OpenAPI** a partir do código (`@nestjs/swagger`), publicada em `/api/docs`, e um **cliente TypeScript** gerado dela (o SDK da forma A).
- **Erros** num formato único e estável (`código`, `mensagem`, `detalhes`).
- **Segurança:** HTTPS obrigatório fora da rede local; as chaves veem-se **uma só vez** ao criar; limites e *throttling* próprios; testes e2e de abuso (chave revogada, âmbito insuficiente, repetição, corpo gigante).
- **Quando HTTPS ainda não existe** (hoje o CRM corre em `http://IP`): chaves de API em HTTP são legíveis por quem estiver na rede. É o mesmo argumento a favor de resolver HTTPS antes de expor integrações — ver o backlog.

---

## 7. Faturação: o que o núcleo faz e o que o adaptador faz

**Regra que não deve ser quebrada:** em Portugal a emissão de faturas tem de ser feita por **programa certificado pela AT** *(confirma isto com o teu contabilista; é a minha leitura e não aconselhamento fiscal)*. Por isso o CRM **nunca emite documentos fiscais**: pede ao programa de faturação que os emita e guarda a referência.

### O que o núcleo fornece (igual para qualquer programa)
- **Modelo canónico** `DocumentoFaturação` (tipo: orçamento, encomenda, fatura, nota de crédito; cliente com NIF, morada; linhas com referência, quantidade, preço, IVA, desconto) e `ClienteFaturação`. O adaptador traduz de/para o formato do programa.
- **`LigaçãoExterna`** (`entidade`, `idCRM`, `fornecedor`, `idExterno`, `última sincronização`, `hash`): é assim que se sabe que "a encomenda 42 é a fatura FT 2026/118 no programa X".
- **Fila de saída transacional (*outbox*):** a alteração no CRM e o pedido ao programa de faturação são gravados **na mesma transação**; um processo à parte entrega e confirma. Nunca se perde um pedido por o programa estar em baixo.
- **Idempotência** com chave derivada `(fornecedor, entidade, id, versão)`: repetir não duplica documentos no programa de faturação.
- **Repetição num só sítio** (não em camadas empilhadas), com recuo exponencial e orçamento limitado; depois de N falhas o item vai para **quarentena** com o erro à vista e botão "tentar de novo". **Não se repete às cegas um pedido de criação cujo resultado é desconhecido** (podia criar duas faturas): reconcilia-se primeiro.
- **Reconciliação** (distinta da repetição): uma tarefa periódica compara stock, preços e estados entre o CRM e o programa e produz um **relatório de divergências** — nunca corrige em silêncio.
- **Stock com a faturação como fonte de verdade** (decisão D3): o adaptador **lê** o stock; o CRM guarda reservas e movimentos próprios e compara.
- **UI de operação:** fila (pendentes, enviados, em quarentena), registo de erros, relatório de divergências, botão de teste de ligação.

### O que o adaptador faz (e só isto)
Implementa `BillingProvider`: `testarLigação()`, `enviarDocumento(doc)`, `lerStock(refs?)`, `lerClientes(desde?)`, e declara `capacidades` (suporta webhook? suporta ajuste de stock? paginação?). Nada de filas, repetições ou reconciliação: isso é do núcleo.

### Dois adaptadores de referência (para provar o contrato)
Como **não há programa concreto**, o contrato valida-se com dois adaptadores que servem **qualquer** programa:
1. **Servidor de faturação simulado** (para a suite de conformidade e a documentação).
2. **Adaptador por ficheiros (CSV/JSON/SAF-T de exportação-importação)** — muitos programas de faturação só têm importação por ficheiro, sem API. Este adaptador cobre-os e é o mais útil na prática.

Quando souberes o programa, o adaptador dele é um pacote pequeno que passa na mesma suite.

---

## 8. Ciclo de vida de uma extensão

`descobrir → validar → instalar → ligar → (atualizar) → desligar → desinstalar`

- **Descobrir:** pasta `extensions/` no servidor (volume Docker) **e carregamento de pacote pela UI** (resposta E2, exige pacote assinado — fase E1b). Nada se descarrega da internet sozinho.
- **Validar:** manifesto contra o esquema, compatibilidade de SDK, dependências, **soma de verificação** contra uma lista de permitidas definida pelo administrador.
- **Instalar:** regista a extensão (`Extension`: id, versão, origem, estado, soma de verificação), corre as suas migrações. **Dados da extensão (E3):** por omissão no armazenamento do SDK (coleções em JSON, com índices nos campos declarados); a forma B pode ter tabelas próprias com o prefixo `ext_<id>_`, **nunca** a tocar nas do núcleo, com migrações registadas e ordenadas.
- **Ligar/desligar:** reaproveita o registo de módulos (0a): rotas 404, tarefas não correm, gatilhos inativos, **dados mantidos**. Exige dependências.
- **Atualizar:** instala a nova versão, corre migrações em frente; recusa se o SDK não for compatível; guarda cópia da versão anterior para reverter.
- **Desinstalar:** desliga; **os dados ficam por omissão**; "apagar dados" é uma ação separada, com confirmação e **exportação prévia**.
- **Saúde:** contador de erros por extensão; **disjuntor** (depois de N falhas seguidas desliga-se sozinha e avisa o administrador); registo de execuções.
- **UI: Configurações > Extensões** — lista (embutidas e instaladas), estado, versão, permissões declaradas, formulário de definições, fila/registos, ligar/desligar/atualizar/desinstalar.

---

## 9. Segurança: o que se garante e o que NÃO se garante

| Superfície | Garantia | Como |
|---|---|---|
| **Forma A** (integração externa) | **Real** | Chave com âmbitos, limites, revogação, assinatura dos webhooks; o conector corre fora |
| **Forma C** (declarativa) | **Real** | Sem código; dados validados contra esquema |
| **Forma D** (código de terceiros no *runner*) | **Forte, não perfeita** | Contentor sem privilégios, sem acesso à base de dados, rede limitada, chave de API com âmbitos; assinatura de pacotes. Mais fraca do que a forma A numa máquina à parte |
| **Forma B** (código no processo) | **Nenhuma contra código malicioso** | Corre com os privilégios do backend: lê a base de dados, os segredos e a rede. Mitigação é **de confiança**, não técnica: só pasta controlada pelo administrador, lista de somas de verificação, revisão de código, e as `permissions` declaradas como auditoria |
| Segredos das extensões | **Real, a implementar (E4)** | Campos `secret` cifrados em repouso (AES-GCM) com `SECRETS_KEY` fora da base de dados; nunca devolvidos pela API; mascarados na UI |
| Falha de uma extensão | **Parcial** | `try/catch` e tempos-limite nas chamadas; disjuntor. **Não** protege de um ciclo infinito ou de consumo de memória (mesmo processo) |
| Cadeia de fornecimento (dependências npm da extensão) | **Fraca** | A auditoria do CI cobre o núcleo, não as extensões instaladas |

**Porque não proponho uma *sandbox* para a forma B:** as fontes consultadas são consistentes — o módulo `vm` e o `vm2` não são mecanismos de segurança (`vm2` está descontinuado com várias CVEs), o `isolated-vm` é o mais forte dentro do processo mas está em modo de manutenção e exige cuidado nas fronteiras, e as *worker threads* são isolamento e não uma fronteira rígida (partilham processo; com `SharedArrayBuffer` e módulos nativos há saídas). O que as fontes recomendam para código realmente não confiável é **separação por processo/contentor** — que é exatamente a **forma A**. Por isso a regra: *se não escreveste ou reviste o código, corre-o fora (A)*.

**Também a propor, por ser pré-requisito:** (1) **cifrar em repouso** `EmailAccount.password` e `ZadarmaAccount.apiSecret` (hoje em claro); (2) **registo de auditoria** de ações de administração (instalar/ligar/desligar extensões, criar/revogar chaves) — quem fez o quê.

---

## 10. Fases propostas (e onde encaixam na reorganização)

Regra de ouro contra o *over-engineering*: **só se desenha um contrato depois de ter duas implementações reais** (*rule of two*) — por isso o primeiro "cliente" do sistema de extensões é o **Zadarma que já existe**, e o segundo é o adaptador de faturação por ficheiros.

| Fase | Entrega | Depende de | Decisão |
|---|---|---|---|
| **E0 — API pública e eventos** | `/api/v1` + OpenAPI; **chaves de API** com âmbitos; idempotência; bus de eventos de domínio; **subscrições de webhook** assinadas com repetição e registo; `LigaçãoExterna`; **cifra de segredos em repouso**; registo de auditoria | 0a (feito) | E4 |
| **E1 — Framework de extensões** | Manifesto + esquema; carregador (embutidas e da pasta `extensions/`); ciclo de vida; formulários de definições; SDK (`@opencrm/extension-sdk`); página **Extensões**; disjuntor | E0 | E1, E2, E3 |
| **E1b — Confiança e pacotes** (decorre de E1/E2 do utilizador) | **Assinatura de pacotes** e lista de editores aprovados; carregar pacote **pela UI**; pré-visualização de permissões; auditoria; pacotes **declarativos** (forma C) instaláveis pela UI | E1 | E1, E2 |
| **E1c — *Runner* isolado** | Serviço `extension-runner` (contentor), chaves de API por extensão, RPC de eventos, limites de recursos e de rede; **só depois** aceita pacotes com código de terceiros (forma D) | E1b | E1 |
| **E2 — Dogfooding** | O **Zadarma** passa a adaptador de `TelephonyProvider`; os módulos embutidos passam a manifestos | E1 | — |
| **E3 — Contrato de faturação** | Modelo canónico, *outbox*, reconciliação, UI de operação, **suite de conformidade**, adaptadores de referência (simulado e por ficheiros) | E1 + encomendas | E5 |
| **E4 — Outros contratos** | `CarrierProvider`, `ShopConnector` (liga-se à API de encomendas), `MailTransport` | E1 | — |

**Como se encaixa com as fases já planeadas** ([reorganização §5](plano-reorganizacao-modular.md)): E0 antes do módulo de **Encomendas** (a API de entrada de lojas precisa das chaves e da idempotência); E1 antes de **Faturação**; E2 pode correr em paralelo com Assistências. As Fases 0b–0d, Leads, Itens de trabalho e Assistências **não dependem** das extensões e mantêm a ordem.

---

## 11. Riscos

| Risco | Porque importa | Mitigação |
|---|---|---|
| **Abstração prematura** | Um sistema de plugins desenhado com zero plugins é um palpite | *Rule of two*; começar pelo Zadarma e por um adaptador real; contratos mínimos que crescem |
| **Falsa sensação de segurança** | "Permissões" e "sandbox" que não o são enganam quem instala | Dizer às claras o que é imposto e o que é só confiança (§9); código não confiável só na forma A |
| **Quebrar integrações ao evoluir a API** | Um conector parte e ninguém repara | `v1` só acrescenta; suite de conformidade e testes de contrato no CI; descontinuação anunciada |
| **Segredos de terceiros em claro** | Agravam o problema que já existe | Cifra em repouso **antes** de haver extensões (E4) |
| **Uma extensão a derrubar o CRM** | Mesmo processo na forma B | Disjuntor, tempos-limite, modo "arrancar sem extensões" (variável de ambiente) para recuperar |
| **Complexidade operacional** | Mais peças (extensões, conectores, filas) | UI de operação desde o primeiro dia; registos e interruptores |
| **Código de terceiros instalado pela UI** | É o caminho típico de comprometer o servidor (pacote malicioso, cadeia de fornecimento) | Forma D (fora do processo), assinatura obrigatória, editores aprovados, auditoria; sem *runner* só pacotes sem código |
| **Âmbito** | Isto é um produto dentro do produto | Fases independentes; só E0–E1 são pré-requisito geral |
| **HTTP sem TLS** | Chaves de API legíveis na rede | Resolver HTTPS antes de expor integrações fora da máquina |

## 12. Fontes consultadas

- Isolamento de código não confiável em Node.js: [Simon Willison — JavaScript sandboxing research (2026)](https://simonwillison.net/2026/Mar/22/javascript-sandboxing-research), [vm2](https://cdn.jsdelivr.net/npm/vm2@3.11.5/README.md), [isolated-vm](https://groups.google.com/g/nodejs/c/ydCpOwhw_aE), [Node.js `vm` — riscos](https://mainwebsite-26a.pages.dev/blog/nodejs-vm-module-security-risks/), [Executar código não confiável em Node.js](https://besthub.dev/articles/how-to-safely-execute-untrusted-code-in-node-js-from-new-function-to-vm-and-worker-threads-bb3bdac6d597), [Motrix — plugins em Worker + QuickJS/WASM](https://instagit.com/agalwood/Motrix/motrix-quickjs-plugin-sandbox-apis/), [OpenWA — plugin sandboxing por níveis de confiança](https://wademo.run.place/openwa/docs/23-plugin-sandboxing.md).
- Arquiteturas de extensões: [Strapi vs Directus](https://strapi.io/headless-cms/comparison/strapi-vs-directus), [Odoo — arquitetura de módulos](https://www.odoo.com/documentation/latest/developer/tutorials/server_framework_101/01_architecture.html), [Twenty — custom objects](https://twenty.com/developers/section/backend-development/custom-objects).
- Integração com ERP/faturação (idempotência, *outbox*, repetição, reconciliação): [StackSync — repetição e reprocessamento](https://www.stacksync.com/blog/two-way-sync-error-handling-retries-replay.md), [Creatuity — arquitetura de integração](https://creatuity-com.pages.dev/insights/adobe-commerce-integration-architecture-operations-first), [SysGenPro — padrões de middleware](https://sysgenpro.com/integration/logistics-api-middleware-patterns-for-reliable-event-driven-erp-synchronization), [Osher — boas práticas de integração](https://new.osher.com.au/blog/system-integration-best-practices), [Cleverence — idempotência](https://www.cleverence.com/amp/articles/sage-dev-documentation/idempotency-sage-developer-4382/).

> **Notas sobre as fontes:** são sobretudo blogs, documentação de fornecedores e resumos, não normas nem documentação oficial; as afirmações sobre `isolated-vm` em manutenção e `SharedArrayBuffer` devem ser confirmadas na documentação oficial antes de dependermos delas. **Nenhuma cobriu faturação em si** (numeração, IVA, estados de pagamento, certificação): a regra da AT na §7 é a minha leitura e deve ser validada com o teu contabilista. A pesquisa sobre ciclo de vida de plugins (migrações, desinstalação, versões) **não devolveu nada útil**: esses pontos (§8) são desenho meu, não prática documentada.
