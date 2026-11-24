# Fase 5 — Produtos, fornecedores e stock (plano, 2026-11-23)

Sexta fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.6 e tabela de fases). Depende da Fase 0
(módulos, campos personalizados, permissões) e liga-se à Fase 4 (peças das assistências).

**Objetivo:** um **catálogo de produtos** dentro do CRM (referência, nome, preço, IVA, unidade, categoria,
fornecedores com a sua referência e preço de custo) e um **stock** guardado como **livro de movimentos**, nunca como
um número editado à mão. Prepara as Fases 6 (encomendas e compras) e 7 (faturação, em que **a faturação manda no
stock** e o CRM reconcilia — decisão D3).

## O que existe hoje
- As empresas não distinguem clientes de fornecedores.
- As peças das assistências (Fase 4c) são texto e quantidade, sem produto nem stock.
- O registo de campos personalizados é genérico (basta acrescentar um tipo de registo), e as permissões de escrita
  são por área configurável (Configurações > Permissões).

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **5a — Catálogo de produtos e fornecedores** | Módulo `produtos`; produto (referência, nome, preço, IVA, unidade, categoria, controla stock); categorias; empresas marcadas como fornecedor e fornecedores por produto (referência e custo); lista com pesquisa, ficha, campos personalizados; preços na auditoria | Médio |
| **5b — Stock** | Módulo `stock` (depende de `produtos`); movimentos só de acrescentar (entrada, saída, ajuste com motivo, devolução, stock inicial); stock atual = soma; stock mínimo e alerta; histórico por produto | Médio |
| **5c — Peças ligadas a produtos** | Peça de assistência escolhida do catálogo; com o stock ligado, gasta stock (e devolve ao retirar); peças mais usadas por produto | Baixo |

Fora desta fase: **reservas** (só fazem sentido com encomendas — vão para a Fase 6), armazéns/localizações
múltiplas, lotes e números de série no stock, importação do catálogo (CSV ou do `globaltoner-orcamentos` — Fase 9),
preços por cliente ou por quantidade, leitura de produtos pela API pública (Fase 6, com as encomendas).

---

## Pacote 5a — Catálogo de produtos e fornecedores

### Modelo
- **`Product`**:
  - **referência** (SKU, obrigatória e única; guardada em maiúsculas e sem espaços nas pontas, para «abc-1» e
    «ABC-1» serem a mesma) e **código de barras** (EAN, opcional, único quando existe);
  - **nome** (obrigatório) e **descrição**;
  - **unidade** (lista fechada: un, cx, pack, kg, m, l, h);
  - **preço de venda** sem IVA (opcional: sem preço = «sob consulta») e **taxa de IVA** (%; por omissão 23; atalhos
    para as taxas do continente e das ilhas);
  - **categoria** (opcional), **ativo** e **controla stock** (D6: sim por omissão; não para serviços e revenda
    direta);
  - **stock mínimo** (opcional; usado no 5b);
  - pesquisa sem acentos nem maiúsculas (coluna mantida por trigger, como nas empresas).
- **`ProductCategory`**: nome (único sem distinguir maiúsculas), ordem, ativa. Lista simples, sem hierarquia.
- **Fornecedores:**
  - `Company.isSupplier` (sim/não). Uma empresa pode ser cliente e fornecedor; a lista de empresas filtra por
    fornecedor.
  - `ProductSupplier`: produto, fornecedor (empresa), referência do fornecedor, preço de custo (até 4 casas
    decimais) e **preferido** (no máximo um por produto). Ligar uma empresa a um produto marca-a como fornecedor.

### Regras
- Preço e custo ≥ 0; IVA entre 0 e 100.
- **Apagar** um produto só enquanto nada o usa. Na 5a ainda nada o usa; a partir da 5c (peças) e da Fase 6
  (encomendas), um produto usado só se desativa. Os desativados não aparecem nos seletores, mas continuam nos
  registos antigos.
- **Preços na auditoria:** criar e alterar produtos, e mudar custos de fornecedor, ficam na auditoria (Configurações
  > Auditoria) com os valores novos.
- **Quem:**
  - Nova área de escrita **«Catálogo de produtos»** (Configurações > Permissões), por omissão Administrador,
    Backoffice e Financeiro. Ler o catálogo é para todos.
  - **Os preços de custo e a margem só aparecem a quem pode escrever no catálogo.** O servidor não os envia aos
    outros.
- Uma categoria em uso não se apaga; desativa-se.

### API
- `GET /products`: paginada por cursor; pesquisa por referência, nome, código de barras, descrição e referência do
  fornecedor; filtros por categoria, ativo, controla stock e fornecedor.
- `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`.
- `POST /products/:id/suppliers`, `PATCH /products/:id/suppliers/:supplierId`,
  `DELETE /products/:id/suppliers/:supplierId`.
- `GET /product-categories` (lista curta, inteira), `POST`, `PATCH /:id`, `DELETE /:id`.
- **Empresas:** `isSupplier` no formulário e o filtro `?supplier=true` (na lista e no seletor).
- Tempo real: `products`, `product-categories`.

### Interface
- Item de menu **«Produtos»** (contribuição do módulo): lista com pesquisa, filtros (categoria, ativos ou todos,
  controla stock, fornecedor), preço com e sem IVA, e «Novo produto».
- **Ficha do produto** (`/produtos/:id`): dados, preço com IVA calculado, fornecedores (referência, custo,
  preferido, margem com o preferido — só para quem escreve no catálogo) e campos personalizados.
- **Configurações > Categorias de produtos** (área «Catálogo de produtos»).
- **Ficha da empresa:** opção «Fornecedor». Nos fornecedores, um cartão «Produtos fornecidos».
- Campos personalizados: tipo de registo **«Produto»** em Configurações > Campos personalizados.

### Validação prevista
- **e2e:**
  - produtos: referência única e normalizada, código de barras único, validações, pesquisa e filtros paginados,
    apagar e desativar;
  - categorias;
  - fornecedores: liga e marca a empresa, um só preferido, custo escondido a quem não escreve no catálogo;
  - permissões e área nova; auditoria dos preços; módulo desligado; campos personalizados do produto.
- Prova por mutação nas regras.
- Migração ensaiada numa cópia da base de desenvolvimento, com reversão e sem desvio de esquema.
- **Browser** (base de testes): criar produto, fornecedor com custo e margem, categorias, pesquisa e filtros, vista
  sem permissão (sem custos).

### Execução do 5a (2026-11-23)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Um só preferido, garantido pela base de dados:** com o padrão do cronómetro (coluna única `preferredFor` + CHECK),
  em vez de um índice parcial que o Prisma não descreve. O primeiro fornecedor ligado fica preferido; tornar outro
  preferido tira o anterior. Retirar o preferido deixa o produto sem preferido.
- **Apagar uma empresa** tira-a dos fornecedores dos produtos.
- **Categorias:** sem acentos nem maiúsculas no nome único (`nameKey`). Uma categoria desativada continua nos produtos
  que a têm, mas não se escolhe em produtos novos ou alterados.
- **Interface:**
  - o cartão «Produtos fornecidos» só aparece nas empresas marcadas como fornecedor. Para isso, as contribuições de
    cartões ganharam uma condição (`when`);
  - a opção «Fornecedor» na empresa e o separador «Produtos» nos campos personalizados só aparecem com o módulo
    ligado;
  - ligar um fornecedor aceita qualquer empresa e marca-a como fornecedor; o filtro de fornecedor da lista de produtos
    usa só fornecedores.
- **Permissões:** área nova «Catálogo de produtos» (Administrador, Backoffice, Financeiro). Os testes estruturais da
  matriz e das áreas do frontend foram atualizados de propósito.
- **Testes:** 8 e2e novos em `test/products.e2e-spec.ts`; atualizados os testes de módulos, permissões e campos personalizados. Total: 502 e2e e 289 unitários. Na suite completa, alguns testes falharam por tempo na limpeza da base de testes (e um em cadeia, por o utilizador da limpeza falhada ter ficado); passam sozinhos.
- **Prova por mutação:** 20 mutações, todas apanhadas (referência, custos à vista, margem, preferido, marca de fornecedor, categorias, filtros, pesquisa, código de barras, preço com IVA, auditoria, área de escrita, módulo, filtro de fornecedores nas empresas). A M5 foi confirmada isoladamente, porque na primeira volta coincidiu com um tempo esgotado noutro teste.
- **Migração:** ensaiada numa cópia da base de desenvolvimento:
  - em SQL, o trigger de pesquisa tirou os acentos («Tôner» → «toner») e a base de dados recusou IVA de 150%, preço
    negativo, referência repetida e um «preferido» de outro produto;
  - sem desvio de esquema;
  - a reversão repôs o esquema e os dados (as mesmas linhas);
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes): lista e menus; produto novo com referência em minúsculas (fica em maiúsculas) e preço «12,5»; fornecedor ligado com custo «7,9» (preferido, margem 36,8%); cartão «Produtos fornecidos» só no fornecedor; como Técnico, ficha só de leitura, sem custos nem margem. Acerto: as colunas da ficha ficaram iguais, para a referência do fornecedor caber.

---

## Pacote 5b — Stock
Detalhado depois do 5a (2026-11-23).

### Modelo
- Módulo opcional **`stock`**, que depende de `produtos`.
- **`StockMovement`**:
  - produto, quantidade com sinal (decimal, nunca zero) e tipo;
  - motivo, nota, origem (tipo e id, ex.: a assistência na 5c), quem e quando;
  - **só se acrescenta**: um trigger recusa alterar ou apagar, como na auditoria. Corrigir é lançar outro movimento.
- **Tipos e sinal** (garantidos por CHECK):

  | Tipo | Sinal | Notas |
  |---|---|---|
  | stock inicial | + | uma vez, antes de qualquer outro movimento do produto |
  | entrada (compra) | + | |
  | saída | − | |
  | devolução | + | |
  | acerto de contagem | + ou − | com motivo obrigatório |
  | consumo em assistência | − ou + | 5c: lançado pelo sistema |

- **Stock atual** = soma dos movimentos, guardado em `Product.stockOnHand` e mantido por um trigger em cada movimento
  novo. É o que permite filtrar e ordenar sem somar tudo; um teste confirma que é igual à soma.

### Regras
- Só há movimentos em produtos que **controlam stock**.
  - Deixar de controlar stock só com o stock a zero.
  - Um produto com movimentos já não se apaga; desativa-se.
- **Acerto de contagem:** indica-se a quantidade contada e o servidor lança a diferença, com a linha do produto
  bloqueada para dois acertos ao mesmo tempo não se pisarem. Contagem igual ao atual → 400. Motivo obrigatório.
- Nas entradas, saídas e devoluções indica-se a quantidade positiva; o servidor aplica o sinal.
- **O stock pode ficar negativo**, com aviso, porque a faturação manda no stock (D3).
- **Alertas:**
  - «abaixo do mínimo»: o stock atual é menor do que o mínimo definido;
  - «negativo»: o stock atual é menor do que zero.

  Ambos são filtros na lista de produtos e contagens no topo da página.
- **Quem:** área de escrita nova **«Movimentos de stock»**, por omissão Administrador e Backoffice. Ver o stock é para
  todos. Os movimentos são o próprio registo (quem, quando, motivo), por isso não vão à auditoria.

### API
- `GET /stock/movements`: paginada, mais recentes primeiro; filtros por produto, tipo e período.
- `POST /stock/movements`: tipos manuais (stock inicial, entrada, saída, devolução, acerto com `countedQuantity`).
- `GET /stock/summary`: quantos produtos estão abaixo do mínimo e quantos estão negativos.
- **Produtos:**
  - `stockOnHand` vem em cada produto;
  - filtro `?stock=below_min|negative`.
- Tempo real: recurso `stock`.

### Interface
- **Cartão «Stock» na ficha do produto** (módulo ligado e produto que controla stock):
  - stock atual com o mínimo e o aviso;
  - botões «Entrada», «Saída», «Devolução», «Acertar contagem» e «Stock inicial» (só sem movimentos);
  - histórico paginado.
- **Lista de produtos:** coluna «Stock» (em destaque se estiver abaixo do mínimo ou negativo), filtro e contagens no
  topo.

### Validação prevista
- **e2e:**
  - tipos e sinais; stock inicial uma só vez; acerto pela contagem (também em simultâneo);
  - só em produtos que controlam stock; não apagar nem deixar de controlar stock com stock;
  - imutabilidade (a base de dados recusa alterar e apagar);
  - `stockOnHand` igual à soma;
  - filtros e contagens; permissões e área nova; módulo desligado (e a dependência de `produtos`).
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento, com reversão e sem desvio de esquema.
- **Browser** (base de testes): stock inicial, entrada, saída, acerto com motivo, histórico, alerta e filtro na
  lista.

### Execução do 5b (2026-11-23)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Triggers:** stock atual somado a cada movimento novo (`StockMovement_soma_no_produto`); «abaixo do mínimo»
  recalculado sempre que o produto muda (`Product_abaixo_do_minimo`); movimentos só de acrescentar
  (`StockMovement_sem_update_delete`). A migração calcula o «abaixo do mínimo» dos produtos que já tinham mínimo.
- **Movimentos simultâneos no mesmo produto:** a linha fica bloqueada e os pedidos esperam em fila. O primeiro ensaio
  com 8 saídas simultâneas deu 500, porque o Prisma só espera 2 s por uma transação. Esta transação passou a esperar
  até 15 s, e se mesmo assim não começar responde 409 («tenta de novo») em vez de 500.
- **Primeira dependência real entre módulos:** `stock` → `produtos`. Desligar os produtos com o stock ligado é
  recusado (400), por isso o teste dos produtos desliga primeiro o stock. Os testes estruturais (dependências, áreas,
  matriz de permissões) foram atualizados de propósito.
- **No ecrã:**
  - antes do primeiro movimento, o cartão «Stock» oferece «Stock inicial»; depois, «Entrada», «Saída», «Devolução»
    e «Acertar contagem», que mostra a diferença antes de lançar;
  - na lista, a coluna «Stock» destaca os produtos abaixo do mínimo ou com stock negativo, e as contagens no topo
    filtram a lista com um clique.
- **Testes:** 7 e2e novos em `test/stock.e2e-spec.ts`; atualizados os testes de produtos (o módulo desliga-se depois do stock), módulos e permissões. Total: 509 e2e e 289 unitários. Na suite completa, alguns testes de outras áreas falharam por tempo na limpeza da base de testes; passam sozinhos.
- **Prova por mutação:** 13 mutações, todas apanhadas: produtos sem stock, acerto sem motivo, acerto igual aceite, acerto a somar a contagem, stock inicial repetido, saída sem sinal, sem bloquear a linha (apanhada pelo teste das contagens simultâneas), alertas com desativados, filtro abaixo do mínimo, deixar de controlar com stock, apagar com movimentos, sem área de escrita, sem módulo.
- **Migração:** ensaiada numa cópia da base de desenvolvimento, com dois produtos acrescentados (um com mínimo e outro
  sem):
  - o «abaixo do mínimo» foi calculado na migração;
  - em SQL, numa transação desfeita, o stock somou (7, depois 4, abaixo do mínimo 5) e a base de dados recusou
    alterar, apagar e lançar com o sinal errado;
  - sem desvio de esquema;
  - a reversão repôs o esquema e os dados;
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes): stock inicial 10, saída 8, mínimo 5 (aviso «Abaixo do mínimo»), acerto de contagem para 3 com motivo (o diálogo mostrou a diferença «+1»), histórico com sinais e motivo; na lista, a coluna «Stock» em destaque e a contagem «1 abaixo do mínimo», que filtra a lista com um clique.

---

## Pacote 5c — Peças ligadas a produtos
Detalhado depois do 5b (2026-11-24).

### Modelo
- **`ServicePart.productId`** (opcional): o produto do catálogo de onde a peça veio. O produto não se apaga enquanto
  houver peças com ele (chave estrangeira `Restrict`, e 409 com mensagem antes disso).
- **`ServicePart.stockTaken`** (decimal, ≥ 0 por CHECK, 0 por omissão): quanto esta peça tirou do stock, líquido. É o
  que se devolve ao retirar e o que limita o que se devolve ao baixar a quantidade.
- Os movimentos de stock das peças têm o tipo **«consumo em assistência»** (`SERVICE_PART`, já previsto no 5b), a
  origem na assistência (`sourceType = SERVICE_CASE`, `sourceId` = a assistência) e o motivo com o número dela
  («AS-0007: peça adicionada»).

### Regras
- **Escolher do catálogo:** só ao adicionar, com o módulo `produtos` ligado e o produto ativo. A descrição e a
  referência vêm do produto (nome e referência), mas ficam como texto editável, como antes. O texto livre continua
  para peças avulsas. Trocar o produto de uma peça é retirá-la e adicionar outra.
- **A peça mexe no stock** quando o módulo `stock` está ligado **e** o produto controla stock:
  - adicionar: sai a quantidade;
  - mudar a quantidade: sai ou volta a diferença, mas nunca volta mais do que a peça tirou
    (`novo tirado = max(0, tirado + nova − antiga)`);
  - retirar a peça: volta o que ela tirou.

  Caso contrário a peça não mexe no stock (e o que já tirou fica registado na peça). Ou seja, com o stock desligado
  as peças não gastam nem devolvem; quem religar o stock acerta a contagem.
- Tudo na mesma transação que a peça, com a linha do produto bloqueada (o `lockProduct` do 5b) e a da peça também,
  para duas alterações à mesma peça não se pisarem.
- **Quem:** quem já escreve nas peças (área «Trabalho diário»). Os movimentos são lançados pelo sistema em nome de
  quem mexeu na peça; não pedem a área «Movimentos de stock».
- **Apagar a tarefa de uma assistência** com peças que tiraram stock → 409 («retira primeiro as peças, para o stock
  voltar»). Sem isto, o apagar em cascata das peças deixava o stock por devolver.
- **Peças mais usadas** (indicadores): agrupadas pelo produto quando existe (com o nome e a referência atuais do
  produto); as avulsas continuam agrupadas pela descrição e referência.

### API
- `POST /service-cases/:id/parts` aceita `productId`; a descrição passa a ser opcional quando há produto.
- As peças vêm com `productId`, `product` (referência, nome, se controla stock e o stock atual) e `stockTaken`.
- `topParts` dos indicadores ganha `productId`.
- Tempo real: mexer nas peças também atualiza produtos e stock no ecrã.

### Interface
- **Peças da assistência:**
  - com os produtos ligados, um seletor «Do catálogo» (com pesquisa; mostra a referência e, com o stock ligado, o
    stock atual) preenche a descrição e a referência;
  - as peças do catálogo mostram a referência com ligação ao produto e, quando tiraram stock, a indicação «saiu do
    stock».
- **Histórico de stock do produto:** os consumos em assistência ligam à assistência.
- **Indicadores:** as peças mais usadas ligam ao produto.

### Validação prevista
- **e2e:**
  - peça do catálogo preenche descrição e referência; produto inativo ou módulo de produtos desligado → 400;
  - com o stock: adicionar, mudar a quantidade (para cima e para baixo, sem devolver mais do que tirou) e retirar
    lançam os movimentos certos, com a origem, e o stock bate certo;
  - sem o stock (módulo desligado ou produto sem controlo de stock): nada se lança;
  - apagar a tarefa com peças que tiraram stock → 409; apagar o produto com peças → 409;
  - técnico (sem a área de stock) gasta stock pelas peças;
  - peças mais usadas agrupadas pelo produto.
- Prova por mutação.
- Migração ensaiada numa cópia da base de desenvolvimento, com reversão e sem desvio de esquema.
- **Browser** (base de testes): escolher do catálogo, ver o stock a sair, mudar a quantidade, retirar, histórico do
  produto com a ligação à assistência.

### Execução do 5c (2026-11-24)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Na base de dados:** uma CHECK (`ServicePart_stock_tirado`) garante que o que a peça tirou nunca é negativo e que só
  uma peça do catálogo tira stock; a chave estrangeira para o produto é `Restrict`.
- **Transação:** a peça, o movimento de stock e a nota na timeline ficam na mesma transação, com a linha do produto
  bloqueada (a mesma fila dos movimentos manuais do 5b, com o 409 «tenta de novo»). A peça é relida e bloqueada dentro
  dela; para as peças do catálogo é a linha do produto que põe as alterações em fila.
- **Movimentos com o motivo legível:** «AS-0001: peça adicionada», «… quantidade da peça alterada», «… peça retirada»,
  em nome de quem mexeu na peça. No histórico do produto, o consumo em assistência liga à assistência.
- **Peças mais usadas:** as do catálogo aparecem com o nome e a referência atuais do produto (ligam à ficha); as
  avulsas continuam como no 4c. A resposta ganhou `productId`.
- **No ecrã:** por cima da linha «Adicionar», o seletor «Do catálogo…» (pesquisa no servidor, só produtos ativos, com a
  referência e o stock); depois de escolher, diz se a peça «Sai do stock (atual N)» ou «Não mexe no stock». As peças
  mostram «saiu do stock: N» e a referência liga ao produto.
- **Testes:** 6 e2e novos em `test/service-parts-stock.e2e-spec.ts` e 4 unitários (`service-parts.spec.ts`);
  atualizado o teste das peças mais usadas do 4c (o `productId`). Total: 515 e2e e 293 unitários. Na suite completa,
  dois testes da paginação falharam por tempo na limpeza da base de testes (o mesmo problema dos pacotes anteriores);
  sozinhos passam. Sem carga, essa limpeza demora cerca de 0,6 s, e não havia ligações presas a segurar bloqueios.
- **Prova por mutação:** 15 mutações, todas apanhadas: adicionar sem tirar stock, ignorar o módulo de stock, ignorar se
  o produto controla stock, devolver mais do que a peça tirou, sinal trocado ao mudar a quantidade, retirar sem
  devolver, aceitar com os produtos desligados, aceitar produto inativo, descrição e referência que não vêm do produto,
  movimento sem origem, apagar a tarefa com stock tirado, apagar o produto usado em peças, e as duas regras das peças
  mais usadas (nome atual do produto e agrupar pelo produto).
- **Migração:** ensaiada numa cópia da base de desenvolvimento, com uma assistência e duas peças avulsas
  acrescentadas:
  - as peças antigas ficaram sem produto e com 0 tirado;
  - em SQL, numa transação desfeita, a base de dados recusou o tirado negativo, o tirado sem produto e apagar um
    produto usado numa peça;
  - sem desvio de esquema;
  - a reversão repôs o esquema e os dados;
  - a base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes, como Técnico): na assistência AS-0001, «Do catálogo…» mostrou «TN-2420 · stock 10»;
  escolher preencheu a descrição e a referência e disse «Sai do stock (atual 10)»; 2 unidades → «saiu do stock: 2»;
  mudar para 3 → stock 7; na ficha do produto, o histórico mostrou os dois consumos com o motivo, o autor e a ligação
  à assistência, sem botões de movimento para o Técnico; retirar a peça → «+3 … peça retirada» e o stock voltou a 10.

## Decisões assumidas (a rever)
- **Reservas** passam para a Fase 6: só as encomendas reservam stock. As peças de assistência gastam diretamente.
- **Um só armazém**, sem localizações, lotes nem números de série no stock.
- **Stock negativo permitido** (com aviso), porque a faturação manda no stock (D3).
- **Fornecedores são empresas** marcadas como tal, para não duplicar contactos, NIF e moradas.
- **Referências em maiúsculas.**
- **Custos e margens só para quem escreve no catálogo.**
- Preços sem IVA, com a taxa por produto. Ainda não há listas de preços por cliente nem descontos.
