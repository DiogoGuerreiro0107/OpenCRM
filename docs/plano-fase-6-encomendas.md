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
| **6d — Expedições** | Transportadoras configuráveis (link de seguimento com `{codigo}`); cada envio é uma expedição com transportadora, código, volumes, peso e custo; envio parcial (por linha e quantidade); eventos de webhook da encomenda | Alto |
| **6e — API de encomendas** | `POST /api/v1/orders` (âmbito `orders:write`, idempotente, id externo da loja), produtos por referência, cliente por NIF ou email (liga ou cria), nasce em rascunho ou confirmada; `GET /api/v1/products` (`products:read`) com o disponível; `GET /api/v1/orders` (`orders:read`); estado de volta à loja pelos webhooks do 6d | Médio |

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

### Execução do 6c (2026-11-25)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Custo por omissão:** o do fornecedor no catálogo; sem ele, 0 (editável por quem vê custos). As notas da timeline
  nunca levam custos (a timeline é para todos).
- **«Criar compras»** trata os produtos pela referência (linhas e notas por uma ordem que se lê) e escreve na compra
  «Para as encomendas à espera (EN-0001, EN-0002): …». Produtos sem fornecedor, com vários e nenhum preferido, ou já
  cobertos voltam na resposta com o motivo.
- **A tarefa «Preparar encomenda»** é criada por `OrderPreparationService` (usado pelo stock, pelas peças, pelas
  encomendas e pelas compras) depois de gravada a transação; volta a ver se a encomenda está completa e reclama
  `SalesOrder.preparationTaskAt` com um `UPDATE … WHERE … IS NULL`. Uma falha ao criar a tarefa fica no registo e
  desfaz a reclamação, mas não desfaz a entrada de stock.
- **Limitação conhecida (do 6b):** a nota «Todo o stock da encomenda está reservado» é escrita dentro da transação;
  com duas entradas simultâneas de produtos diferentes da mesma encomenda, pode não sair. A tarefa não depende dela
  (é decidida depois de gravar).
- **Interface:** menu «Compras» (com «O que comprar» quando as encomendas estão ligadas), ficha com receção em diálogo
  (por omissão o que falta), «Recebida em parte» como marca, cartão «Compras» nas empresas fornecedoras, «Em compra»
  e as compras abertas no cartão do stock do produto, «em compra: N» nas linhas à espera, ligação «O que comprar» no
  aviso da encomenda, filtro «Pronta a preparar», cartão «Tarefas» na encomenda e a ligação à encomenda no diálogo da
  tarefa.
- **Testes:**
  - 7 e2e novos em `test/purchases.e2e-spec.ts`; nos e2e do 6b, as notas e as tarefas das encomendas completadas por
    entradas, devoluções, peças retiradas, cancelamentos e «Reservar stock»; os testes que desligam o stock desligam
    antes as compras;
  - total: 537 e2e e 302 unitários, todos a passar na volta completa;
  - numa volta seguinte só com as compras e as reservas, 2 testes das reservas falharam uma vez (sem detalhe guardado);
    não se repetiu em 6 voltas seguidas (5 só das reservas e 1 das duas).
- **Prova por mutação:** 42 mutações, 40 apanhadas:
  - receção: sem entrada de stock, a mais, sem ficar recebida, sem servir as encomendas, entrada de produto sem stock,
    sem atualizar o recebido, sem auditoria;
  - tarefa: sem ver se está completa, repetida (sem as duas proteções; e só sem a reclamação, com 10 pedidos em
    simultâneo), ao confirmar a própria, por movimento manual, «Reservar stock», peça retirada e cancelamento, sempre
    para quem fez a entrada, sem nota ao fechar, filtro por encomenda;
  - em compra e sugestões: sem rascunhos, sem descontar o recebido, sem o reservado acima do stock, sem descontar o em
    compra, sem o fornecedor único, sem juntar ao rascunho, sem bloquear os produtos, na linha da encomenda e no
    produto;
  - estados e linhas: enviar sem linhas, linhas depois de enviar, cancelar com receções, fechar sem receções,
    fornecedor que não é fornecedor, produto repetido;
  - custos, apagar, pesquisa, módulo: custos sem a área do catálogo, custo alterado sem ela, produto e fornecedor com
    compras apagam-se, pesquisa pelo fornecedor, compras sem depender do stock, filtro «pronta a preparar»;
  - as 2 que escaparam são equivalentes: tirar só a verificação inicial da tarefa (a reclamação no `UPDATE` impede a
    segunda) e tirar a verificação do tipo desativado (`tasks.create` já recusa um tipo desativado e a reclamação é
    desfeita).
- **Migração:** ensaiada numa cópia da base de desenvolvimento (copiada por pipe, sem ficheiro no contentor), com
  fornecedor, cliente, produto, encomenda confirmada e tarefa de antes:
  - as colunas novas ficam vazias; o tipo «Preparar encomenda» é criado;
  - em SQL, numa transação desfeita: pesquisa («cf-0001 prop-acao»), CHECKs (recebido acima da quantidade,
    quantidade 0, custo negativo, fechada sem motivo, motivo sem estado, total negativo), produto repetido, produto e
    fornecedor com compras não se apagam, cancelada com motivo aceite, timeline da compra, linhas em cascata, tarefa
    fica sem encomenda quando esta é apagada;
  - sem desvio de esquema;
  - a reversão, com uma compra, uma linha, uma nota, a ligação da tarefa e `preparationTaskAt` gravados, repôs os dados
    e o esquema (md5 iguais);
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança (`/tmp/opencrm-antes-6c.dump` no contentor).
- **Browser** (base de testes; 2 × TN-2420 em stock; EN-0001 com 3 e EN-0002 com 4 TN-2420 e 1 CF259A, confirmadas):
  - como Administrador:
    - «O que comprar» mostrou TN-2420 (5, para EN-0001 e EN-0002) e CF259A (1), do fornecedor preferido, com custos;
      «Criar compras» criou o rascunho CF-0001 e a lista ficou vazia;
    - na ficha: referências e custos do fornecedor, total 204,95 €, notas; data prevista e referência guardadas;
      «Marcar como enviada»;
    - receção de 2 TN-2420 com a guia: «Recebida em parte»; a EN-0001 ficou completa, com a tarefa «Preparar encomenda
      EN-0001» para a Comercial que a criou, a nota na atividade e o filtro «Pronta a preparar»; o diálogo da tarefa
      liga à encomenda;
    - receção do resto: «Recebida», entradas de stock na ficha; a EN-0002 ficou completa com a tarefa; no produto, as
      entradas «CF-0001: receção» abrem a compra e o «em compra» desapareceu;
    - compra nova CF-0002 (só fornecedores no seletor; papel 10 × 3,10 €), enviada, receção de 12 recusada no diálogo
      («só falta 10»), receção de 4, «Fechar com falta» com o motivo e a nota «não vem: 6 × …»;
  - como Comercial: na encomenda à espera, «aguarda stock: 2 · em compra: 2» e a ligação «O que comprar»; nas compras,
    sem custos, totais nem botões; cartão «Compras» na empresa fornecedora.

## Pacote 6d — Expedições
Detalhado a 2026-11-25, depois do merge do 6c. Risco revisto para **alto**: o envio parcial mexe na regra das reservas
do 6b (o que aguarda stock passa a ser o que falta enviar menos o reservado).

### Modelo
- **`Carrier`** (transportadora): nome (único, sem distinguir maiúsculas), link de seguimento opcional com `{codigo}`,
  ativa, ordem. Lista curta de configuração (vem inteira).
  - CHECK: o link, quando existe, tem `{codigo}`.
  - Com expedições, desativa-se em vez de apagar (409), como as categorias de produtos.
- **`Shipment`** (expedição): encomenda, transportadora (opcional), código de seguimento, volumes, peso (kg), custo,
  notas, data de envio, quem registou.
  - CHECKs: volumes ≥ 1, peso ≥ 0 e custo ≥ 0, quando preenchidos.
- **`ShipmentLine`**: expedição, linha da encomenda, quantidade (> 0); uma vez por linha em cada expedição.
- **`SalesOrderLine.shippedQuantity`** (enviado) e **`unshippedQuantity`** (por enviar = quantidade − enviado, mantido
  por trigger, para os filtros poderem comparar com o reservado).
  - CHECKs: `0 ≤ enviado ≤ quantidade` e `reservado ≤ por enviar` (substitui `reservado ≤ quantidade`).
- **Migração:** cada encomenda já enviada ou entregue fica com as linhas enviadas por inteiro e com **uma expedição**
  (data do envio, sem transportadora, com a nota «Registada na migração»). Assim vale sempre: enviada ⇔ nada por
  enviar, e o enviado de cada linha = soma das expedições.

### Regras
- **Enviar** (`POST /orders/:id/ship`, encomenda confirmada) cria sempre uma expedição:
  - **sem linhas no pedido**, envia tudo o que falta (como hoje);
  - **com linhas** (`[{ lineId, quantity }]`), é um **envio parcial**: cada linha da encomenda no máximo uma vez, com
    quantidade > 0 e até ao que falta enviar dessa linha;
  - **falta de stock:** numa linha de produto que controla stock (com as reservas ativas), enviar mais do que o
    reservado pede `allowShortage`. Sem ele, 409 com o que falta; o stock fica negativo;
  - por linha: saída de stock `SALE_OUT` da quantidade enviada (produtos que controlam stock, com o módulo `stock`
    ligado), o reservado desce até ao que fica por enviar e o enviado sobe;
  - com tudo enviado a encomenda passa a **enviada**; senão continua **confirmada** («parcialmente enviada») e as linhas
    que faltam continuam a reservar e a aguardar stock como antes, pela ordem de sempre;
  - timeline da encomenda: «Encomenda enviada» ou «Envio parcial: …», com transportadora e código, e a saída de stock.
- **Transportadora:** tem de estar ativa ao registar. O link de seguimento é o da transportadora com `{codigo}`
  trocado pelo código (codificado para URL); sem código ou sem link, não há link.
- **Corrigir a expedição** (`PATCH /orders/:id/shipments/:shipmentId`): transportadora, código, volumes, peso, custo e
  notas, em qualquer estado da encomenda (o código chega muitas vezes depois). As quantidades não se corrigem: o stock
  já saiu (acerta-se com um movimento de stock). Fica na timeline.
- **Dar por enviada sem o resto** (`POST /orders/:id/finish`, com motivo): numa encomenda confirmada com parte enviada,
  passa a enviada, liberta as reservas do que não vai e o disponível vai para quem aguarda. Sem nada enviado, 409
  (cancela-se).
- **Cancelar** uma encomenda com parte enviada: recusado (409, «dá-a por enviada sem o resto»).
- **Entregue** continua a ser da encomenda inteira (só enviada → entregue).
- **Bloqueios:** os de sempre (encomenda → produtos por id → linhas).
- **O que aguarda stock** passa a ser «por enviar − reservado» em todo o lado: distribuição das entradas (6b), «Reservar
  stock», tarefa «Preparar encomenda» e sugestões de compra (6c), filtros «a aguardar stock» e «pronta a preparar».
- **Webhooks** (catálogo, depois de gravar; nunca falham a operação):
  - `order.created`: encomenda criada;
  - `order.status_changed`: confirmada, enviada, entregue, cancelada, com o estado de onde veio e, quando há, o motivo;
  - `order.shipped`: cada expedição (também as parciais, com `partial`), com transportadora, código, link de
    seguimento, volumes, peso e linhas. **Sem o custo**, que é interno;
  - `order.shipment_updated`: expedição corrigida (para a loja receber o código quando chega mais tarde).
- **Quem:** a área «Encomendas» envia, corrige expedições e configura as transportadoras. Ver é para todos, incluindo o
  custo da expedição (não é preço de fornecedor).

### API
- `GET/POST/PATCH/DELETE /carriers` (módulo `encomendas`; escrever com a área «Encomendas»), com o número de
  expedições de cada uma.
- `POST /orders/:id/ship` aceita também `lines`, `carrierId`, `trackingCode`, `packages`, `weightKg`, `cost`, `notes`.
- `PATCH /orders/:id/shipments/:shipmentId`; `POST /orders/:id/finish { reason }`.
- Encomenda: em cada linha, `shippedQuantity` e `unshippedQuantity`; na ficha, `shipments` (com `trackingUrl`); na
  ficha e na lista, `partiallyShipped`. Filtro novo `partiallyShipped=true`.
- **Tempo real:** as transportadoras emitem `carriers`; as expedições vão com as encomendas.

### Interface
- **Configurações → Transportadoras** (com a área «Encomendas»): lista, criar/editar (nome, link com `{codigo}` e um
  exemplo do link), ativar/desativar, apagar quando não tem expedições.
- **Ficha da encomenda:**
  - «Marcar como enviada» abre um diálogo: transportadora (seletor com pesquisa, só ativas), código, volumes, peso,
    custo, notas; «Enviar só parte» mostra as linhas com a quantidade a enviar (por omissão o reservado nas linhas de
    stock e o que falta nas outras). Falta de stock: aviso no diálogo e «Enviar mesmo assim»;
  - cartão **«Expedições»**: data, transportadora, código com o link de seguimento, volumes, peso, custo, linhas, e
    «Corrigir»;
  - linhas com «enviado 2 de 5»; marca «Parcialmente enviada» e o botão «Dar por enviada sem o resto».
- **Lista de encomendas:** marca «parcialmente enviada» e o filtro.
- **Webhooks:** os eventos novos aparecem no catálogo da página de webhooks (vêm do servidor).

### Validação prevista
- **e2e** (`order-shipments.e2e-spec.ts`):
  - transportadoras: CRUD, nome repetido, link sem `{codigo}`, apagar com expedições (409), inativa recusada;
  - envio total com transportadora e link; envio parcial com stock reservado (reservado e enviado nas linhas, saída de
    stock, continua confirmada) e depois o resto;
  - quantidades acima do que falta, linha repetida ou de outra encomenda (400); falta de stock com e sem
    `allowShortage`;
  - entradas de stock depois de um envio parcial servem só o que falta enviar; tarefa «Preparar encomenda» e sugestões
    de compra com envio parcial;
  - «Dar por enviada sem o resto» (reservas libertadas para outra encomenda), cancelar com parte enviada (409);
  - corrigir a expedição; módulo `stock` desligado (expedições sem movimentos);
  - webhooks: entregas criadas para `order.created`, `order.status_changed`, `order.shipped` (com `partial`, sem custo)
    e `order.shipment_updated`;
  - concorrência: dois envios parciais da mesma linha ao mesmo tempo nunca passam da quantidade.
- Os testes do 6b e do 6c continuam a passar sem mudar o que verificam.
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento (com encomendas enviadas e entregues): expedições criadas,
  enviado = quantidade, reversão e sem desvio de esquema.
- **Browser** (base de testes): criar transportadora; envio parcial com transportadora e código; ver o link, o cartão
  «Expedições» e a marca na lista; corrigir o código; enviar o resto; «Dar por enviada sem o resto» noutra encomenda.

### Execução do 6d (2026-11-25)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Sem módulo novo:** as expedições e as transportadoras fazem parte de «Encomendas» (todo o envio passa a criar uma
  expedição). As transportadoras ficam em Configurações → Transportadoras, com a área «Encomendas».
- **Primeiro sai o reservado:** num envio, o reservado da linha desce o que sai (até 0); enviar mais do que o
  reservado é a «falta de stock» que pede «enviar mesmo assim». A mensagem de recusa é a do 6b.
- **Parcial = fica alguma coisa por enviar.** Um envio com linhas que leva tudo o que falta fecha a encomenda como o
  envio total (o motivo da saída de stock é «EN-0001: encomenda enviada»; nos parciais, «EN-0001: envio parcial»).
- **Depois de «dar por enviada sem o resto»** a encomenda fica enviada com linhas ainda «por enviar» (é o que não
  foi). A ficha mostra «enviado 1 de 4 · não foi: 3». Na migração, só as encomendas já enviadas por inteiro.
- **Timeline:** a nota do transporte («Expedição: CTT · código … · 2 volumes») só aparece com algum dado do
  transporte, para os envios sem dados ficarem como no 6b. Uma correção sem mudanças não escreve nada nem dispara o
  webhook.
- **Webhooks** com os estados como estão na API (`CONFIRMED`, `SHIPPED`…). `order.created` sai também para os rascunhos
  (a loja da 6e vai precisar). Documentados em [api-publica.md](api-publica.md).
- **O teste de concorrência** falhou uma vez quando corria depois do teste dos webhooks: as primeiras tentativas de
  entrega (para um endereço que recusa) ainda escreviam quando o teste seguinte limpava a base. O teste dos webhooks
  passou a esperar por elas. Depois disso: 8 voltas do teste sozinho e 3 do ficheiro inteiro sem falhas.
- **Testes que falhavam de vez em quando na bateria completa (também antes do 6d):** a limpeza da base entre testes
  (`TRUNCATE` de ~80 tabelas) chegava a demorar mais do que os 30 s do `beforeEach`, e o teste seguinte falhava a
  criar o utilizador. Vigiando a base durante a bateria, o `TRUNCATE` estava à espera do disco
  (`IO / DataFileImmediateSync`): reconstrói todos os índices e grava cada um com `fsync`, lento no Docker do Windows,
  e cada pacote acrescenta tabelas. A limpeza (`test/helpers.ts`) passou a usar `DELETE` com as chaves estrangeiras e
  os triggers desligados nessa transação (`session_replication_role = replica`, que o superutilizador da base de
  testes, local e do CI, pode usar) e a recomeçar as sequências; sem esse direito, volta ao `TRUNCATE`. Explica
  provavelmente a falha de «compras + reservas» do 6c. Duas baterias completas seguidas sem falhas, em 7–8 min em vez
  de 16–17.
- **Consequência, vista no CI do PR:** depois de um `DELETE`, o Postgres reaproveita o espaço das tabelas e uma
  consulta sem `ORDER BY` deixa de devolver as linhas pela ordem em que foram escritas (com o `TRUNCATE` era assim por
  acaso). Um teste do 6a comparava as entradas da auditoria sem ordenar e falhou no CI; passou a ordenar pela data.
  Revi as outras consultas dos testes sem `orderBy`: ou ordenam antes de comparar, ou verificam uma só linha, ou
  procuram por id. **Regra:** um teste que compara uma lista tem de a ordenar.

**Validação:**
- 9 e2e novos (`order-shipments.e2e-spec.ts`) e 3 unitários novos; os testes do 6a, 6b e 6c passam sem mudar o que
  verificam. Bateria completa: 546 e2e e 305 unitários.
- **Prova por mutação:** 36 mutações, 35 apanhadas e 1 equivalente (a distribuição do stock escolher as linhas pela
  quantidade em vez do «por enviar»: a quantidade dada já vem do «por enviar», por isso essas linhas recebem 0 e são
  saltadas). Uma escapou (a nota «Todo o stock da encomenda está reservado» depois de um envio parcial) e passou a ser
  apanhada com uma verificação nova. Antes da corrida reforcei três pontos que previ que escapariam: o `from` ao
  cancelar um rascunho, a correção sem mudanças a disparar o webhook e a marca da lista depois do envio total.
- **Migração** ensaiada numa cópia da base de desenvolvimento (`opencrm_ensaio_6d`, copiada sem ficheiro intermédio),
  com encomendas em todos os estados: uma expedição por cada enviada/entregue (a entregue sem data de envio ficou com a
  data da última alteração), enviado = quantidade nessas e 0 nas outras, o trigger do «por enviar» (também contra uma
  escrita à mão), todos os CHECKs, chaves únicas e estrangeiras; sem desvio de esquema; a reversão deixou os dados e o
  esquema iguais (impressões digitais 658292c4… e 9a0a0061…). Cópia apagada.
- **Browser** (base de testes, como Administrador e Técnico):
  - Configurações → Transportadoras: «CTT Expresso» com link de exemplo e «Entrega própria» sem link;
  - EN-0001 (5 toners com 3 em stock, 1 HP, portes): «Enviar só parte» propõe o reservado; envio de 3 toners + 1 HP
    com CTT, código «RR 123/PT», 2 volumes, 3,5 kg, 7,90 €. Fica confirmada com «Parcialmente enviada», «enviado 3
    de 5 · aguarda stock: 2», cartão «Expedições» com o link (`RR%20123%2FPT`); «Corrigir» para «RR123456789PT»
    atualizou o link e a timeline;
  - entrada de 2 toners: a ficha atualizou-se sozinha (reservado 2) e nasceu a tarefa «Preparar encomenda EN-0001»;
    «Enviar mais» mandou o resto e a encomenda passou a enviada, com a 2.ª expedição;
  - EN-0002 (3 resmas, 1 em stock): o diálogo recusou 4 («só falta enviar 3»); envio parcial de 1; «Cancelar»
    desapareceu; filtro «Parcialmente enviada» na lista; «Dar por enviada sem o resto» com motivo → enviada,
    «enviado 1 de 3 · não foi: 2»;
  - os quatro eventos `order.*` no formulário de webhooks;
  - como Técnico: vê as expedições e o link, sem «Corrigir» nem «Transportadoras»;
  - acertos feitos na verificação: largura mínima das colunas na página das transportadoras e o custo com duas casas
    no «Corrigir».

## Pacote 6e — API de encomendas
Detalhado a 2026-11-25, depois do merge do 6d. Último pacote da fase: a loja online passa a criar encomendas no CRM e a
saber o que há de cada produto; o estado volta à loja pelos webhooks do 6d.

### Âmbitos novos das chaves de API
- `products:read` — ler produtos (preço, IVA, stock disponível).
- `orders:read` — ler encomendas (estado, linhas, expedições com o link de seguimento).
- `orders:write` — criar encomendas.

### Produtos — `GET /api/v1/products`, `GET /api/v1/products/:id`
- Lista com a mesma sincronização das empresas e contactos (`updated_since` + `cursor`, por data de alteração) e o
  filtro `sku` (referência exata, sem distinguir maiúsculas).
- Campos: `id`, `sku`, `name`, `barcode`, `unit`, `sale_price`, `vat_rate`, `active`, `tracks_stock`, `category`; com
  o módulo «Stock» ligado, `stock_on_hand`, `reserved` e `available` (null sem controlo de stock). **Nunca os custos
  nem os fornecedores.**
- Só com o módulo «Produtos» ligado (404 sem ele, como as outras rotas de módulos).
- Nota: o stock muda sem mudar a data de alteração do produto; para o stock atual a loja lê o produto (ou a lista
  completa) — a sincronização por data é para o catálogo.

### Encomendas — `POST /api/v1/orders` (`orders:write`)
- `Idempotency-Key` obrigatório (como os leads). `external_id` opcional: o número da encomenda na loja, guardado numa
  `ExternalLink` da chave (`entityType = "order"`); repetido → 409 com o id da encomenda que já existe, mesmo fora da
  janela de 24 h da idempotência.
- **Cliente** (`customer`): `tax_id`, `email`, `company_name`, `name` (pessoa), `phone`. Pelo menos um de NIF, email
  ou nome.
  - **Empresa:** com NIF, a que tiver o mesmo NIF (normalizado como na conversão de leads: «PT 123 456 789» =
    «123456789»); senão, com `company_name`, cria-se (com o NIF).
  - **Contacto:** com email, o que tiver o mesmo email (sem distinguir maiúsculas); senão, com `name` ou email, cria-se
    (na empresa da encomenda, se houver).
  - Um contacto encontrado que é de **outra empresa** não entra na encomenda (a encomenda fica com a empresa; o email
    da loja vai para a timeline). Um contacto sem empresa ganha a da encomenda, como na conversão de leads.
  - O que foi criado fica na timeline de cada registo («Criada pela API: <chave>»).
- **Linhas** (`lines`, 1 a 200): por `sku` (produto ativo do catálogo; desconhecido ou desativado → 422 com a linha) ou
  livres (`description` + `unit_price` + `vat_rate`, ex.: portes). `quantity` > 0; `unit_price` opcional nas linhas
  de produto (sem ele, o preço do catálogo; com ele, o preço da loja — promoções), `discount_pct` opcional. IVA do
  produto. Os totais são calculados pelo CRM (como na interface).
- **Outros campos:** `customer_reference` (por omissão o `external_id`), `delivery_address`, `notes`.
- **`confirm`** (booleano, por omissão `false`): com `true` a encomenda nasce confirmada e **reserva stock** (regra do
  6b; o que falta fica a aguardar e entra nas sugestões de compra). Com `false` fica em rascunho para a equipa rever.
  Uma encomenda paga na loja vem normalmente com `true`. *Desvio ao esboço* («conforme a chave»): pedido a pedido é
  mais claro e não pede configuração nova.
- **Quem:** a encomenda fica criada por quem criou a chave (uma chave não é uma pessoa), como nos leads; sem
  responsável.
- Faz o mesmo que na interface: timeline, webhooks (`order.created` e, ao confirmar, `order.status_changed`), tempo
  real; com reservas, a tarefa «Preparar encomenda» segue as regras de sempre.
- Tudo ou nada: se uma linha falhar, nada fica criado (nem empresa, nem contacto, nem encomenda), e o id externo é
  libertado.
- Precisa dos módulos «Encomendas» e «Produtos» (404 sem eles).

### Encomendas — `GET /api/v1/orders`, `GET /api/v1/orders/:id` (`orders:read`)
- Lista com a sincronização por data de alteração e o filtro `external_id` (o da chave).
- Campos: `id`, `code`, `status`, `partially_shipped`, `customer` (`company_id`, `contact_id`), `customer_reference`,
  `delivery_address`, `subtotal`, `vat_total`, `total`, datas (`confirmed_at`, `shipped_at`, `delivered_at`,
  `cancelled_at`, `cancel_reason`), `external_id`, `lines` (`id`, `sku`, `description`, `quantity`, `unit_price`,
  `discount_pct`, `vat_rate`, `line_total`, `shipped_quantity`) e `shipments` (`id`, `shipped_at`, `carrier`,
  `tracking_code`, `tracking_url`, `packages`, `weight_kg`, `lines`). **Sem o custo das expedições** (como nos
  webhooks) nem as notas internas.

### Contrato
- OpenAPI (`/api/v1/openapi.json`) com as rotas e os esquemas novos; `docs/api-publica.md` com exemplos.
- Erros no formato da v1 (`{ error: { code, message, details } }`); 422 para linhas inválidas, com o índice da linha.
- Testes estruturais: cada rota com `@Scopes`, e os testes de contrato a validar as respostas contra o OpenAPI.

### Validação prevista
- **e2e** (`public-api-orders.e2e-spec.ts`):
  - produtos: lista, sincronização, `sku`, stock com e sem o módulo, sem custos, âmbito em falta (403), módulo
    desligado (404);
  - criar encomenda: cliente por NIF (normalizado) e por email, cliente novo (empresa + contacto), contacto de outra
    empresa, linhas por SKU e livres, preço da loja vs catálogo, totais, rascunho vs `confirm` com reservas e linha à
    espera, SKU desconhecido/desativado (422 e nada criado), `external_id` repetido (409 com o id), idempotência
    (mesma chave → mesma resposta; corpo diferente → 422), webhooks `order.created`/`order.status_changed`;
  - ler encomendas: estado, expedições com link e sem custo, `external_id`, sincronização;
  - concorrência: o mesmo `external_id` em dois pedidos ao mesmo tempo cria uma só encomenda.
- Testes de contrato com o OpenAPI; prova por mutação.
- Sem migração prevista (os âmbitos são código; a `ExternalLink` já existe). Se for precisa, ensaio como sempre.
- **Browser:** criar uma chave com os âmbitos novos; criar encomendas por `curl` (base de testes) e vê-las na lista e
  na ficha (origem «API»), com a empresa/contacto ligados ou criados.

### Execução do 6e (2026-11-26)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Tudo numa transação** (`OrdersService.createFromIntake`, regras do cliente e das linhas em
  `orders/order-intake.ts`): primeiro a ligação ao id externo (um pedido simultâneo com o mesmo `external_id` espera
  aí e recebe 409 quando o primeiro grava), depois o cliente, as linhas, a encomenda e, com `confirm`, a confirmação
  com as reservas (o mesmo código da interface, extraído para `confirmLocked`). Uma falha desfaz tudo, também a
  ligação.
- **Cliente — um acerto ao plano:** sem NIF mas com `company_name`, se o contacto encontrado pelo email já tem
  empresa, a encomenda fica com essa empresa em vez de criar outra (uma loja sem NIF voltava a criar a mesma empresa
  a cada encomenda). Com NIF desconhecido e sem nome de empresa não se cria empresa; o NIF fica na timeline.
  Sem empresa nem contacto possível → 422 (`details.field: "customer"`).
- **Clientes iguais ao mesmo tempo:** a criação de cliente é serializada por NIF e por email (trincos da transação do
  Postgres, sempre pela mesma ordem), para duas encomendas simultâneas de um cliente novo não criarem duas empresas.
- **Linhas:** o `sku` compara sem maiúsculas (a referência exata primeiro); nas linhas de produto o preço, o desconto
  e o IVA do pedido prevalecem, como na interface (o plano dizia «IVA do produto»: é o valor por omissão). Linhas
  livres sem descrição, preço ou IVA → 400 (pedido mal formado); referência desconhecida, produto desativado ou sem
  preço → 422 `unprocessable` com `line_index` e `reason`. `unprocessable` é um código de erro novo da v1 (acrescento).
- **Webhooks:** `order.created` sai com `status: "DRAFT"` mesmo com `confirm`, seguido de `order.status_changed`
  (`DRAFT` → `CONFIRMED`): a mesma sequência de quando se cria e confirma na interface.
- **Sincronização das encomendas:** um envio parcial e a correção de uma expedição passam a mudar a data de alteração
  da encomenda (antes não mudavam, e `updated_since` não os via).
- **Origem na ficha:** «Veio pela API: <nome da chave> n.º <external_id>», a partir da ligação ao id externo (sem
  coluna nova). Apagar o rascunho liberta o `external_id`, como nos leads.
- **Sem migração:** os âmbitos são código e a `ExternalLink` já existia; o esquema não mudou (sem desvio).
- **Produtos:** inclui também a `description`; os campos de stock vêm a null sem o módulo «Stock» ou num produto sem
  controlo de stock.

**Validação:**
- 10 e2e novos (`public-api-orders.e2e-spec.ts`), com todas as respostas validadas contra o OpenAPI; os testes
  estruturais (âmbitos de cada rota, OpenAPI = código) cobrem as rotas novas. Bateria completa: 556 e2e e
  305 unitários.
- **Prova por mutação:** 44 mutações, todas apanhadas. Na primeira corrida escaparam 6, que passaram a ser apanhadas com verificações
  novas: NIF desconhecido com nome de empresa e um contacto de outra empresa (cria a empresa do NIF), os dois
  trincos de cliente em separado (encomendas simultâneas só com o mesmo NIF, ou só com o mesmo email), a mensagem do
  cliente vazio, o disponível depois de reservar (na API de produtos) e «parcialmente enviada» depois do envio total.
  O ficheiro novo passou 3 vezes seguidas sem falhas.
- **Um teste frágil, apanhado na bateria completa:** para confirmar que o custo da expedição (7,90) não sai na
  API, o teste procurava «7.9» no texto da resposta, e uma data («…57.965Z») tinha-o por acaso. Passou a verificar
  os nomes dos campos (`cost`, `notes`); o mesmo nos produtos. Depois disso, 3 voltas do ficheiro e a bateria completa
  sem falhas.
- **Browser** (base de testes, como Administrador), com as encomendas enviadas por um script com uma chave
  «Loja online (teste)»:
  - WEB-1001 (cliente novo com NIF, 5 toners a 42,50 € com 3 em stock + portes, `confirm`) → EN-0001 confirmada,
    267,41 €, «Aguarda stock» na lista; a ficha mostra «Veio pela API: Loja online (teste) n.º WEB-1001», reservado
    3 · aguarda 2, e a timeline (criada pela API, cliente criado, linhas, confirmada, reservas);
  - a empresa «Papelaria Central, Lda.» criada com o contacto «Marta Ribeiro», «criada pela API … com a encomenda
    EN-0001» na timeline e a encomenda na ficha;
  - WEB-1002 (NIF «509 999 990» da Distribuidora Ibérica) → EN-0002 em rascunho, ligada à empresa existente;
  - WEB-1001 outra vez → 409 com o id da existente; referência desconhecida → 422 com a mensagem da linha; na API
    de produtos o TN-2420 ficou com stock 3, reservado 3, disponível 0;
  - Configurações → Chaves de API: a chave com os três âmbitos e o diálogo «Nova chave» com as descrições novas.
