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
| **6c — Compras a fornecedor** | Encomenda a fornecedor com linhas (custo do catálogo), ligada às linhas de venda que espera; receção (parcial) lança as entradas e reserva para as encomendas à espera; aviso e tarefa «Preparar encomenda» quando uma encomenda fica completa | Alto |
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

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 6b — Reservas e saída de stock
- `StockReservation` por linha (quantidade reservada), `Product.reserved` mantido como o stock atual; disponível =
  em stock − reservado, na ficha e na lista de produtos.
- Confirmar reserva o que está disponível; o resto da linha fica «a aguardar stock». Entradas novas (manuais ou
  receções) reservam para as encomendas mais antigas à espera, por ordem.
- Enviar lança `SALE_OUT` (origem na encomenda) e liberta a reserva; cancelar liberta.
- Encomendas já confirmadas antes do 6b: reservam na migração? A decidir no plano detalhado (provavelmente não; um
  botão «reservar» resolve).

### 6c — Compras a fornecedor
- `PurchaseOrder`/`PurchaseOrderLine` (fornecedor = empresa marcada como fornecedor, custo do catálogo), estados
  rascunho → enviada → recebida (parcial) → fechada.
- Gerar a compra a partir das linhas «a aguardar stock» (agrupadas pelo fornecedor preferido).
- Receção: entradas `PURCHASE_IN` com origem na compra; reserva para as encomendas ligadas; quando uma encomenda fica
  completa, notificação e item de trabalho «Preparar encomenda EN-0001».

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
