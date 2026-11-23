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

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 5b — Stock
- `StockMovement` (produto, quantidade com sinal, tipo — stock inicial, entrada, saída, ajuste, devolução, consumo
  em assistência —, motivo, origem, quem, quando). **Só se acrescenta:** a base de dados recusa alterar ou apagar,
  como na auditoria. Corrigir é lançar o movimento contrário.
- **Stock atual = soma dos movimentos**, só nos produtos que controlam stock. Pode ficar negativo, com aviso:
  a faturação manda no stock e o CRM não bloqueia uma venda real.
- Ajuste manual com motivo obrigatório; stock mínimo com alerta (lista «abaixo do mínimo» e indicador); histórico
  por produto.

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
