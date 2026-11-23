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

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 5c — Peças ligadas a produtos
- A peça da assistência pode vir do catálogo (preenche descrição e referência; o texto livre continua para peças
  avulsas).
- Com o módulo de stock ligado e o produto a controlar stock, a peça gasta stock: adicionar lança uma saída, mudar
  a quantidade lança a diferença e retirar lança a devolução. Tudo com a origem na assistência.
- «Peças mais usadas» passa a agrupar pelo produto quando existe.

## Decisões assumidas (a rever)
- **Reservas** passam para a Fase 6: só as encomendas reservam stock. As peças de assistência gastam diretamente.
- **Um só armazém**, sem localizações, lotes nem números de série no stock.
- **Stock negativo permitido** (com aviso), porque a faturação manda no stock (D3).
- **Fornecedores são empresas** marcadas como tal, para não duplicar contactos, NIF e moradas.
- **Referências em maiúsculas.**
- **Custos e margens só para quem escreve no catálogo.**
- Preços sem IVA, com a taxa por produto. Ainda não há listas de preços por cliente nem descontos.
