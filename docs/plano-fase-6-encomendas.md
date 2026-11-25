# Fase 6 — Encomendas, compras e transporte (plano, 2026-11-24)

Sétima fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.7 e tabela de fases). Depende das Fases
0–3 (módulos, campos personalizados, permissões, itens de trabalho, automações), da Fase 5 (produtos e stock) e da
faixa E0 (API pública com chaves, idempotência, ligações externas e webhooks — [plano-e0-api-publica.md](plano-e0-api-publica.md)).

**Objetivo:** registar as **encomendas dos clientes** (à mão ou vindas de uma loja online pela API), **reservar stock**
para elas, **comprar ao fornecedor** o que falta e saber quando há tudo para preparar, e **registar a expedição**
(transportadora e seguimento). O CRM **não emite faturas nem orçamentos** (D2 revista): os valores das encomendas são
indicativos, para a equipa; a fatura sai do programa de faturação (Fase 7), que manda no stock (D3).

## O que existe hoje
- Produtos com preço, IVA e fornecedores com custo (5a); stock como livro de movimentos, com stock atual por trigger e
  movimentos em fila por produto (5b); peças das assistências a gastar stock (5c).
- A API pública `/api/v1` com chaves por âmbito, `Idempotency-Key`, ligações externas (`ExternalLink`) e webhooks de
  saída com catálogo de eventos.
- Ainda não há reservas: o stock atual é só o que está em armazém.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **6a — Encomendas de cliente** | Módulo `encomendas` (depende de `produtos`); encomenda com cliente, linhas de produto (preço do catálogo, desconto, IVA) e totais indicativos; estados rascunho → confirmada → enviada → entregue, ou cancelada (com motivo); lista com pesquisa e filtros, ficha, cartão na empresa, timeline, campos personalizados | Médio |
| **6b — Reservas e saída de stock** | Com o `stock` ligado: confirmar reserva o que há, por linha; disponível = em stock − reservado; linhas «a aguardar stock»; enviar lança as saídas e liberta as reservas; cancelar liberta | Alto |
| **6c — Compras a fornecedor** | Compra a fornecedor com linhas de produto (custo do catálogo); sugestões do que comprar para as encomendas à espera; receção (parcial) lança as entradas e reserva para as encomendas à espera; tarefa «Preparar encomenda» quando uma encomenda à espera fica completa | Alto |
| **6d — Expedições** | Transportadoras configuráveis (link de seguimento com `{codigo}`); expedição com código, volumes e custo; envio parcial opcional; eventos de webhook da mudança de estado | Médio |
| **6e — API de encomendas** | `POST /api/v1/orders` (âmbito `orders:write`, idempotente por origem + id externo), produtos por referência, cliente por NIF ou email; `GET /api/v1/products` (`products:read`); estado de volta à loja por webhook | Médio |

Fora desta fase: faturação e reconciliação com o programa de faturação (Fase 7); integrações com cada transportadora
(o seguimento é um link); preços por cliente, promoções e portes calculados; devoluções de clientes com nota de
crédito (fica a devolução de stock do 5b); múltiplos armazéns.

## Decisões assumidas (a rever)
- **Os estados da encomenda são fixos (código), não passos configuráveis.** Desvio ao §3.7, que previa um
  `WorkflowStep` por passo: os estados mexem em stock (reservas, saídas) e essa lógica tem de ser código (§6 do plano
  geral). O trabalho das pessoas (preparar, ligar ao cliente) continua a ser feito com itens de trabalho, com os
  passos e as automações que já existem.
- **Preços sem IVA**, com a taxa por linha (copiada do produto, editável). Totais por linha arredondados a cêntimos e
  somados; são indicativos — a fatura é emitida noutro programa.
- **Cliente = empresa e/ou contacto** já existentes no CRM (pelo menos um dos dois). A API de entrada (6e) cria ou
  liga o cliente pelo NIF ou pelo email.
- **Linhas sem produto** permitidas (serviços, portes, artigos avulsos), como nas peças das assistências; só as linhas
  com produto que controla stock reservam e gastam stock (6b).
- **Numeração interna** «EN-0001», sem valor fiscal.
- **Quem:** área de escrita nova «Encomendas», por omissão Administrador, Comercial e Backoffice. Ver é para todos.

---

## Pacote 6a — Encomendas de cliente
Detalhado com o plano da fase (2026-11-24).

### Modelo
- Módulo opcional **`encomendas`**, que depende de `produtos`.
- **`SalesOrder`**:
  - número (`EN-0001`, sequência própria), estado, cliente (`companyId` e/ou `contactId`, pelo menos um — CHECK),
    responsável (opcional), referência do cliente (o n.º de encomenda dele), morada de entrega (texto) e
    observações;
  - totais indicativos (sem IVA, IVA e total), recalculados pelo servidor sempre que as linhas mudam;
  - datas de cada estado (confirmada, enviada, entregue, cancelada), motivo do cancelamento, quem criou;
  - texto de pesquisa (número, referência do cliente, nomes do cliente) por trigger, como nas outras listas.
- **`SalesOrderLine`**: posição, produto (opcional, `Restrict`), referência e descrição (copiadas do produto,
  editáveis), quantidade (> 0), preço unitário sem IVA (≥ 0), desconto % (0–100), taxa de IVA (0–100) e total da linha
  sem IVA. CHECKs para os limites. No máximo 200 linhas por encomenda.

### Regras
- **Estados:**

  | De | Para | Quando |
  |---|---|---|
  | rascunho | confirmada | tem pelo menos uma linha e cliente |
  | confirmada | enviada | — |
  | enviada | entregue | — |
  | rascunho ou confirmada | cancelada | com motivo |

  Não se volta atrás (corrige-se cancelando e criando outra). Cada mudança fica na timeline da encomenda e, na
  confirmação e no cancelamento, também na auditoria.
- **As linhas só se alteram em rascunho.** O cabeçalho (responsável, referência, morada, observações) altera-se até
  ser entregue ou cancelada; o cliente só em rascunho.
- **Produto:** só ativos, e com o módulo `produtos` ligado; a linha copia a referência, o nome, o preço de venda e o
  IVA do produto.
- **Apagar:** só rascunhos. Um produto usado em linhas de encomenda não se apaga (409, como nas peças).
- **Quem:** área de escrita «Encomendas» (Administrador, Comercial, Backoffice). Ver é para todos.
- Campos personalizados no tipo de registo **Encomenda**; timeline própria (tipo de registo novo na timeline).

### API
- `GET /orders` (paginada, mais recentes primeiro; pesquisa, filtros por estado, empresa, contacto e responsável),
  `POST /orders` (cria o rascunho), `GET/PATCH/DELETE /orders/:id`.
- `POST /orders/:id/lines`, `PATCH/DELETE /orders/:id/lines/:lineId` (só em rascunho).
- `POST /orders/:id/confirm`, `/ship`, `/deliver`, `/cancel` (com `reason`).
- Tempo real: recurso `orders`.

### Interface
- **Menu «Encomendas»** com a lista: número, cliente, estado, total, data; pesquisa, filtro por estado e cliente,
  paginação.
- **Encomenda nova:** diálogo com o cliente (empresa e/ou contacto); abre a ficha do rascunho.
- **Ficha:**
  - cabeçalho com o cliente, responsável, referência do cliente, morada e observações;
  - linhas: produto do catálogo (seletor com pesquisa) ou texto livre, quantidade, preço, desconto e IVA, com os
    totais em baixo; em rascunho editáveis, depois só de leitura;
  - botões do estado seguinte («Confirmar», «Marcar como enviada», «Marcar como entregue», «Cancelar» com motivo);
  - nota «valores indicativos — a fatura é emitida no programa de faturação»;
  - campos personalizados e timeline.
- **Cartão «Encomendas»** na ficha da empresa e do contacto (as últimas, com ligação à lista filtrada).

### Validação prevista
- **e2e:**
  - criar, linhas do catálogo e avulsas, totais (desconto e IVA, arredondamentos), limites e validações;
  - estados e transições inválidas; linhas só em rascunho; cancelar com motivo; apagar só rascunhos;
  - cliente obrigatório (CHECK); produto inativo, módulo de produtos desligado; produto com linhas não se apaga;
  - pesquisa e filtros, paginação; permissões e área nova; módulo desligado e a dependência de `produtos`;
  - timeline e campos personalizados.
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento, com reversão e sem desvio de esquema.
- **Browser** (base de testes): encomenda nova, linhas do catálogo e avulsa com desconto, totais, confirmar, enviar,
  entregar; cancelar outra com motivo; cartão na empresa; Técnico só a ver.

### Execução do 6a (2026-11-24)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Cálculo:**
  - feito com decimais exatos (`Prisma.Decimal`), sem vírgula flutuante;
  - cada linha é arredondada a cêntimos (meio cêntimo para cima), o IVA de cada linha também, e os totais são a soma;
  - uma CHECK garante que total = sem IVA + IVA.
- **Na base de dados:**
  - CHECKs: cliente obrigatório; cancelada ⇔ motivo e data; totais; limites das linhas;
  - o cliente e o produto têm chave estrangeira `Restrict`, e apagar uma empresa, um contacto ou um produto com
    encomendas dá 409 com mensagem;
  - pesquisa: número («EN-0007» ou «7»), referência do cliente e o texto de pesquisa da empresa e do contacto (nome,
    NIF, email), que já existia.
- **Encomenda bloqueada** em cada linha e mudança de estado (`SELECT … FOR UPDATE`): com 8 linhas acrescentadas em
  simultâneo, os totais e as posições batem certo. A fila com espera alargada e o 409 «tenta de novo» passaram para
  um utilitário comum (`common/locked-transaction.ts`), que o stock (5b) também usa.
- **Linhas:** do catálogo copiam a referência, o nome, o preço e o IVA (o pedido prevalece); um produto sem preço
  obriga a indicar o preço. A linha avulsa pede descrição, preço e IVA.
- **Timeline e auditoria:**
  - timeline nova para o tipo de registo «Encomenda» (`ORDER`), com cada linha («3 × Toner (TN-2420) a 45,90 € −10%»)
    e cada estado;
  - na auditoria: confirmar, cancelar (com o motivo) e apagar rascunhos.
- **Primeiro módulo com dois dependentes nos produtos:** desligar os produtos exige desligar antes o stock e as
  encomendas. Os testes estruturais (dependências, áreas, matriz de permissões, tipos de campos personalizados)
  foram atualizados de propósito, e dois testes que usavam «ORDER» como exemplo de tipo desconhecido passaram a usar
  outro.
- **Erro apanhado no browser:** uma linha avulsa sem referência dava 500, porque a interface envia `sku: null` e o
  servidor fazia `.trim()` sobre `null`. O servidor passou a aceitar `null` (sem referência) e o caso entrou nos e2e.
- **Testes:**
  - 7 e2e novos em `test/orders.e2e-spec.ts` e 7 unitários (`orders.spec.ts`); total: 522 e2e e 300 unitários;
  - na suite completa, 4 testes de outras áreas falharam:
    - um era real e foi corrigido (o exemplo «ORDER» dos campos personalizados);
    - os outros 3 (auditoria e utilizadores) falharam por tempo, a mesma lentidão intermitente da base de testes, e
      passam sozinhos.
- **Prova por mutação:** 21 mutações, todas apanhadas:
  - cálculo: desconto ignorado, sem arredondar, totais não recalculados;
  - estados e edição: linhas fora de rascunho, confirmar sem linhas, transição sem verificar o estado, cancelar depois
    de enviada, apagar fora de rascunho, cliente a mudar depois do rascunho, entregue ainda editável;
  - validações: contacto de outra empresa, produto inativo, preço do produto ignorado;
  - concorrência e pesquisa: sem bloquear a encomenda, pesquisa sem o cliente;
  - acessos e auditoria: sem área, sem módulo, sem auditoria;
  - apagar empresa, contacto ou produto com encomendas.
- **Migração:** ensaiada numa cópia da base de desenvolvimento, com uma empresa e uma entrada antiga na timeline:
  - em SQL, numa transação desfeita: o número e o texto de pesquisa por trigger («en-0001 po-acao 7»), a timeline
    `ORDER`, as quatro CHECKs, o `Restrict` da empresa e as linhas apagadas em cascata;
  - sem desvio de esquema;
  - a reversão, com uma encomenda, uma entrada `ORDER` na timeline e um campo personalizado gravados, repôs os dados e
    o esquema (o enum da timeline é recriado sem `ORDER`);
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes):
  - como Comercial:
    - «Nova encomenda» com a empresa e a referência abriu o rascunho EN-0001;
    - «Do catálogo…» preencheu o toner (45,9 € e IVA de 23%);
    - linha avulsa «Portes de envio» a 12,50 € com 10% de desconto = 11,25 €; totais 148,95 € + 34,26 € = 183,21 €;
    - confirmar (as linhas e o cliente ficaram bloqueados), enviar e entregar, com as datas no cabeçalho;
    - cancelar a EN-0002 com motivo;
    - cartão «Encomendas» na ficha da empresa;
  - como Técnico: a ficha só de leitura, sem botões de estado.

## Pacote 6b — Reservas e saída de stock
Detalhado a 2026-11-24, depois do merge do 6a.

### Modelo
- **Reserva = quantidade reservada na própria linha** (`SalesOrderLine.reservedQuantity`, 0 até à quantidade da
  linha). Desvio ao esboço, que previa uma tabela `StockReservation`: cada linha só reserva um produto e no máximo uma
  vez, por isso uma tabela só repetia a chave. O histórico das reservas fica na timeline da encomenda.
  - CHECK: `0 ≤ reservado ≤ quantidade`, e só linhas com produto reservam.
- **`Product.reserved`**: soma do reservado nas linhas, mantida por trigger nas linhas (como o stock atual, 5b).
  - CHECK `reserved ≥ 0`.
  - **Disponível = em stock − reservado**: calculado na resposta, não se guarda.
  - O alerta «abaixo do mínimo» continua a olhar para o stock físico.

### Regras
- **Quando há reservas:** encomenda confirmada, produto que controla stock, e os módulos `stock` e `encomendas`
  ligados. Linhas avulsas e produtos sem controlo de stock nunca reservam nem aguardam.
- **Confirmar** reserva, por linha, o que está disponível (até à quantidade); o resto da linha fica **«a aguardar
  stock»**. A timeline da encomenda diz o que ficou reservado e o que aguarda.
- **Entradas de stock reservam para quem aguarda:**
  - depois de cada movimento (manual ou das peças das assistências) e de cada reserva libertada (cancelar, enviar), o
    disponível desse produto vai para as linhas à espera;
  - ordem: as encomendas confirmadas há mais tempo primeiro (data de confirmação, número, posição da linha);
  - cada encomenda servida recebe uma nota na timeline («Stock reservado: 2 × Toner (TN-2420)»), e outra quando fica
    com tudo reservado.
- **O stock pode descer abaixo do reservado** (acerto de contagem, saída manual, peça de assistência). As reservas não
  se desfazem: o disponível fica negativo e o produto mostra «reservado acima do stock». A faturação manda no stock
  (D3); quem gere acerta ou cancela.
- **Enviar:**
  - se alguma linha ainda aguarda stock, o servidor recusa (409, com as linhas em falta), a não ser que o pedido diga
    «enviar mesmo assim» (`allowShortage`); a interface pergunta antes;
  - lança uma saída `SALE_OUT` por linha com produto que controla stock, pela quantidade toda da linha, com origem na
    encomenda (`SALES_ORDER`) e o motivo «EN-0001: encomenda enviada»;
  - liberta as reservas das linhas;
  - com o módulo `stock` desligado, não lança saídas (como as peças, 5c) e só liberta.
- **Cancelar** liberta as reservas, e o que fica disponível vai para quem aguarda.
- **Encomendas confirmadas antes do 6b** (ou com o stock desligado na confirmação) não reservam na migração. Na ficha
  aparece **«Reservar stock»**, que reserva o disponível para as linhas à espera dessa encomenda; as entradas seguintes
  tratam-nas também, por ordem.
- **Deixar de controlar stock** num produto com stock reservado: recusado (409), como já é com o stock diferente de zero.
- **Módulos desligados:** as reservas ficam guardadas (e escondidas), mas não se reserva nada de novo até voltarem.
- **Bloqueios, sempre pela mesma ordem**, para não haver impasses: primeiro a encomenda, depois os produtos (por id),
  e só então as linhas. Um movimento de stock bloqueia o produto e só toca nas linhas, nunca bloqueia encomendas.
  Antes de mexer nas linhas, relê-se o que está gravado.

### API
- `POST /orders/:id/ship` aceita `{ allowShortage?: boolean }`; `POST /orders/:id/reserve` (área «Encomendas», só
  confirmadas).
- `GET /orders`: filtros novos `waiting=true` («a aguardar stock») e `productId`.
- Encomenda: em cada linha, o reservado e o que aguarda; na encomenda, quantas linhas aguardam. Produto: `reserved` e
  `available`.
- **Tempo real:** as encomendas passam a atualizar também os produtos e o stock; o stock e as assistências atualizam
  as encomendas.

### Interface
- **Ficha da encomenda:**
  - em rascunho, cada linha do catálogo mostra o disponível do produto;
  - confirmada, mostra «reservado 3» ou «reservado 1 · aguarda 2»;
  - aviso no topo com as linhas à espera e o botão «Reservar stock»;
  - «Marcar como enviada» com linhas à espera pede confirmação («o stock fica negativo»).
- **Produto:** o cartão «Stock» mostra reservado e disponível, e a lista das encomendas que reservam ou aguardam esse
  produto. Na lista de produtos aparece a coluna «Disponível».
- **Lista de encomendas:** filtro «a aguardar stock» e a marca «aguarda stock» nas confirmadas.
- **Movimentos de stock** com origem numa encomenda abrem a encomenda.
- Tudo isto só com os dois módulos ligados.

### Validação prevista
- **e2e:**
  - confirmar com stock suficiente, parcial e sem stock;
  - entradas a servir as encomendas por ordem; peça retirada de uma assistência devolve stock e reserva;
  - enviar: saídas, reservas libertadas, recusa com linhas à espera e «enviar mesmo assim»;
  - cancelar liberta e passa a outra encomenda;
  - «Reservar stock» numa encomenda confirmada sem reservas; módulo de stock desligado (sem reservas nem saídas);
  - produto sem controlo de stock e linhas avulsas; deixar de controlar stock com reservas (409);
  - concorrência: duas encomendas a confirmar ao mesmo tempo com stock para uma (nunca reserva acima do disponível),
    e uma entrada ao mesmo tempo que um cancelamento;
  - filtros `waiting` e `productId`; reservado e disponível no produto.
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento (com encomendas confirmadas do 6a), com reversão e sem
  desvio de esquema.
- **Browser** (base de testes): confirmar uma encomenda com stock parcial, ver a linha à espera, dar entrada de stock
  e ver a reserva; enviar com saída de stock; cartão do produto com o reservado; filtro na lista.

### Execução do 6b (2026-11-24)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Uma só regra de distribuição** (`stock/reservations.ts`, `allocateWaiting`): confirmar, «Reservar stock», cada
  movimento de stock (manual ou das peças) e cada reserva libertada chamam-na para os produtos em causa. Dá o
  disponível às linhas à espera pela data de confirmação. Por isso «Reservar stock» pode servir primeiro uma encomenda
  mais antiga que também aguarde.
- **Notas na timeline da encomenda:**
  - «Stock reservado: 2 × Toner (TN-2420)», «Todo o stock da encomenda está reservado» e «A aguardar stock: …»;
  - no envio, «Saída de stock: …» e, se faltava stock, «Enviada sem stock reservado para: …»;
  - no cancelamento, «Reservas libertadas: …».
- **Auditoria:** o envio passou a ficar registado (`order.shipped`, com `allowShortage`), além de confirmar, cancelar
  e apagar.
- **Base de dados:**
  - trigger nas linhas que só toca no produto quando a reserva muda (os rascunhos não bloqueiam o produto);
  - CHECKs `0 ≤ reservado ≤ quantidade`, só linhas com produto, e `Product.reserved ≥ 0`.
- **Ordem das notas:** várias notas da mesma ação (ex.: «Encomenda enviada» e «Saída de stock: …») caíam no mesmo
  milissegundo e o desempate pelo id (uuid) baralhava-as; no CI, mais rápido, isso fez falhar um teste. As notas das
  encomendas passaram a usar um relógio monótono (`common/monotonic-clock.ts`: cada nota é pelo menos 1 ms posterior
  à anterior). Um e2e com o relógio parado prova a ordem; as duas mutações (`new Date()` nas notas da encomenda e nas
  das reservas) são apanhadas.
- **Bloqueios:** encomenda → produtos (por id) → linhas; os movimentos de stock bloqueiam o produto e as linhas à
  espera (`FOR UPDATE OF`), nunca a encomenda.
- **Interface:** na lista de produtos, o disponível aparece por baixo do stock (quando há reservas), em vez de uma
  coluna nova; na ficha do produto, as encomendas confirmadas com esse produto.
- **Testes:**
  - 8 e2e novos em `test/order-reservations.e2e-spec.ts` e 2 unitários (`monotonic-clock.spec.ts`); um e2e do 6a passou
    a esperar também o envio na auditoria;
  - total: 530 e2e e 302 unitários;
  - na suite completa, 3 testes de outras áreas (módulos e utilizadores) falharam por tempo na limpeza da base de
    testes, que nessa altura partilhava o servidor com o ensaio da migração; passam sozinhos.
- **Prova por mutação:** 22 mutações, todas apanhadas (mais as 2 da ordem das notas):
  - reservas: confirmar sem reservar, ordem invertida, reservar acima do disponível, entradas e peças devolvidas sem
    reservar, confirmar sem bloquear os produtos (concorrência);
  - envio: ignorar as linhas à espera, sem saídas, sem libertar, saída de produto sem stock, sem auditoria;
  - cancelamento: sem libertar, sem passar à seguinte;
  - módulos e estados: reservar com o stock desligado, «Reservar stock» num rascunho ou com o stock desligado;
  - produto: deixar de controlar stock com reservas, disponível sem descontar o reservado;
  - lista: filtros «a aguardar» e por produto, linhas à espera na lista, rascunho a contar como à espera.
- **Migração:** ensaiada numa cópia da base de desenvolvimento, com uma encomenda confirmada do 6a (linha de produto
  e avulsa):
  - as linhas antigas ficam com 0 reservado;
  - em SQL, numa transação desfeita: o trigger (reservar, mudar, outra coluna, inserir e apagar linhas, apagar a
    encomenda em cascata) e as CHECKs;
  - sem desvio de esquema;
  - a reversão, com uma reserva gravada, repôs os dados e o esquema;
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes; 4 toners em stock):
  - como Comercial:
    - em rascunho, a linha mostra «Disponível: 4»;
    - confirmar a EN-0001 (3 toners) reservou 3;
    - confirmar a EN-0002 (5 toners e portes) reservou 1, ficou «aguarda stock: 4» com o aviso e «Reservar stock»;
    - «Marcar como enviada» pediu confirmação (recusada);
    - o filtro «A aguardar stock» e a marca na lista;
    - no produto, «disponível 0» na lista e «Reservado para encomendas: 4 · disponível 0» na ficha, com as duas
      encomendas;
  - como Administrador:
    - entrada de 10 completou a EN-0002 (stock 14, reservado 8, disponível 6);
    - enviar a EN-0002 lançou a saída de 5 (stock 9, reservado 3);
    - o movimento abre a encomenda, e a timeline conta a história toda.

## Pacote 6c — Compras a fornecedor
Detalhado em 2026-11-25, antes de começar.

### Modelo
- Módulo opcional novo **`compras`**, que depende de `produtos` e de `stock` (sem stock, receber não teria efeito).
  As sugestões a partir das encomendas precisam também de `encomendas`.
- **`PurchaseOrder`**:
  - número (`CF-0001`, sequência própria), estado, fornecedor (empresa marcada como fornecedor, `Restrict`);
  - referência do fornecedor (o n.º da encomenda ou da proposta dele), data prevista de entrega, observações;
  - total indicativo (custo sem IVA), recalculado pelo servidor quando as linhas mudam;
  - datas de cada estado (enviada, recebida, fechada, cancelada), motivo de fechar ou cancelar, quem criou;
  - texto de pesquisa (número, referência do fornecedor, nome do fornecedor) por trigger.
- **`PurchaseOrderLine`**: posição, produto (obrigatório, `Restrict`; um produto no máximo uma vez por compra),
  referência e nome copiados do produto, referência do fornecedor, quantidade (> 0), custo unitário (≥ 0, 4 casas,
  como no catálogo), total da linha e **quantidade recebida** (0 até à quantidade — CHECK). No máximo 200 linhas.
- **Em compra** de um produto = o que falta receber nas compras em rascunho ou enviadas (calculado, não guardado).
- **`WorkItem.salesOrderId`** (opcional, `SetNull`): a tarefa «Preparar encomenda» fica ligada à encomenda. Tipo de
  item de sistema novo **«Preparar encomenda»** (`PREPARAR_ENCOMENDA`, ícone pacote).
- Timeline: tipo de registo novo `PURCHASE_ORDER`.

### Regras
- **Estados:**

  | De | Para | Quando |
  |---|---|---|
  | rascunho | enviada | tem pelo menos uma linha (o CRM não envia nada ao fornecedor: marca que foi feita) |
  | enviada | recebida | automático, quando a última linha fica recebida por completo |
  | enviada (com alguma receção) | fechada | com motivo: o resto já não vem e deixa de contar como «em compra» |
  | rascunho ou enviada (sem receções) | cancelada | com motivo |

  As linhas só se alteram em rascunho; o fornecedor também. Referência, data prevista e observações até ficar
  recebida, fechada ou cancelada. Apagar: só rascunhos.
- **Receção** (só em enviadas): quantidades por linha, cada uma > 0 e até ao que falta (receber a mais é recusado — o
  excesso entra como movimento manual), e uma nota opcional (ex.: a guia do fornecedor):
  - por linha de produto que controla stock, uma entrada `PURCHASE_IN` com origem na compra
    (`sourceType = PURCHASE_ORDER`) e o motivo «CF-0001: receção»;
  - com as reservas ativas (6b), cada entrada serve as encomendas à espera **pela regra única do 6b** (das
    confirmadas há mais tempo para as mais recentes). A compra não fica presa a linhas de venda: é por produto, e por
    isso nunca há duas regras a decidir quem recebe;
  - nota na timeline da compra («Receção: 4 × Toner (TN-2420)», com a nota) e, nas encomendas, as notas do 6b.
- **Tarefa «Preparar encomenda EN-0001»:** quando uma encomenda **que estava à espera** fica com tudo reservado
  (por qualquer entrada: receção, movimento manual, peça devolvida, reserva libertada, «Reservar stock»), cria-se uma
  tarefa do tipo «Preparar encomenda», ligada à encomenda e ao cliente, com prazo hoje, para o responsável da
  encomenda (ou quem a criou; senão quem fez a entrada). Não se cria outra se já houver uma em aberto para a mesma
  encomenda. Uma encomenda que fica completa logo ao confirmar não cria tarefa (quem confirma já sabe). A tarefa é
  criada depois de gravada a entrada (as automações das tarefas correm como sempre).
- **Sugestões do que comprar** (com `encomendas`): por produto que controla stock, **a comprar = a aguardar nas
  encomendas confirmadas + reservado acima do stock − em compra**. Fornecedor: o preferido do produto, senão o único;
  sem nenhum, aparece «sem fornecedor». «Criar compras» volta a calcular com os produtos bloqueados e junta as linhas
  ao rascunho mais recente desse fornecedor (ou cria um), com o custo do catálogo; o que já está coberto não se repete.
  A compra regista na timeline as encomendas que a motivaram.
- **Custos:** só quem tem a área «Catálogo de produtos» vê os custos e totais das compras (a regra que já existe nos
  produtos); os outros veem quantidades e datas. Sem essa área, as linhas levam o custo do catálogo e não se altera.
- **Quem:** área de escrita nova «Compras a fornecedor», por omissão Administrador e Backoffice. Ver é para todos.
- **Bloqueios**, na ordem do 6b: compra → produtos (por id) → linhas da compra → linhas das encomendas à espera.
- **Auditoria:** compra enviada, recebida (cada receção), fechada, cancelada, apagada e compras criadas a partir das
  sugestões.
- **Na encomenda:** filtro «Pronta a preparar» (confirmada, sem linhas à espera); nas linhas à espera, «em compra: N».

### API
- `GET /purchase-orders` (paginada, mais recentes primeiro; pesquisa, filtros por estado, fornecedor e produto),
  `POST /purchase-orders` (cria o rascunho), `GET/PATCH/DELETE /purchase-orders/:id`.
- `POST /purchase-orders/:id/lines`, `PATCH/DELETE /purchase-orders/:id/lines/:lineId` (só em rascunho).
- `POST /purchase-orders/:id/send`, `/receive` (`{ lines: [{ lineId, quantity }], note }`), `/close` e `/cancel`
  (com `reason`).
- `GET /purchase-orders/suggestions` e `POST /purchase-orders/generate` (`{ productIds }`).
- `GET /products/:id` passa a ter `onOrder`; `GET /orders?ready=true`; `GET /tasks` aceita `salesOrderId`.
- Tempo real: recurso `purchases`.

### Interface
- **Menu «Compras»** com a lista: número, fornecedor, estado (com «recebida em parte»), data prevista, total (só com
  custos); pesquisa, filtros por estado e fornecedor (seletor com pesquisa), paginação.
- **Compra nova:** diálogo com o fornecedor (só empresas fornecedoras); abre a ficha do rascunho.
- **Ficha:** cabeçalho; linhas (produto com pesquisa, quantidade, custo, recebido/falta); botões «Marcar como
  enviada», «Registar receção» (diálogo com o que falta por linha, editável, e a nota), «Fechar com falta» e
  «Cancelar» com motivo, «Apagar»; os movimentos de stock da compra; timeline.
- **Sugestões** («O que comprar», na página das compras): produtos com a quantidade a comprar, o fornecedor, as
  encomendas à espera e o que já está em compra; escolher e «Criar compras».
- **Produto:** «Em compra: N» na ficha (cartão do stock), com as compras abertas; os movimentos com origem numa compra
  abrem a compra.
- **Encomenda:** «em compra: N» nas linhas à espera, ligação «O que comprar» no aviso, filtro «Pronta a preparar»;
  na ficha, as tarefas «Preparar encomenda». No diálogo da tarefa, a ligação à encomenda.
- **Cartão «Compras»** na ficha das empresas fornecedoras.

### Validação prevista
- **e2e:**
  - criar, linhas (custo do catálogo, produto repetido, limites), totais; estados e transições inválidas; linhas só
    em rascunho; apagar só rascunhos; fornecedor tem de ser fornecedor;
  - receção parcial e completa (entradas `PURCHASE_IN`, recebido, estado automático), a mais recusada, produto sem
    stock; fechar com falta e cancelar; «em compra»;
  - reservas: a receção serve pela ordem da confirmação; tarefa «Preparar encomenda» (só quando estava à espera,
    sem repetir, responsável); filtro «Pronta a preparar»;
  - sugestões (fórmula, fornecedor preferido/único/nenhum, junta ao rascunho, não repete) e concorrência;
  - custos escondidos sem a área do catálogo; permissões e área nova; módulo desligado e dependências;
  - pesquisa, filtros, paginação; timeline e auditoria.
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento, com reversão e sem desvio de esquema.
- **Browser** (base de testes): sugestões a partir de uma encomenda à espera, criar a compra, enviar, receção parcial
  e completa, a encomenda fica completa e a tarefa aparece; fechar outra com falta; Comercial sem custos; Técnico só
  a ver.

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 6d — Expedições
- `Carrier` (nome, link de seguimento com `{codigo}`, ativo) em Configurações; `Shipment` (encomenda, transportadora,
  código, volumes, peso, custo, data). Marcar como enviada pede a expedição (opcional).
- Envio parcial como opção por encomenda.
- Eventos `order.created`, `order.status_changed`, `order.shipped` no catálogo dos webhooks.

### 6e — API de encomendas
- `POST /api/v1/orders` (âmbito `orders:write`, `Idempotency-Key`, e o id externo da loja numa `ExternalLink` para
  não duplicar), cliente por NIF ou email (cria empresa ou contacto se não existir), linhas por referência do
  produto; nasce confirmada ou em rascunho conforme a chave.
- `GET /api/v1/products` (`products:read`) com preço e disponível.
- OpenAPI atualizada e testes de contrato.
