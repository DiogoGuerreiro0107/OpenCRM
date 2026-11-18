# Fase 1 — Leads por empresa e/ou pessoa (plano, 2026-11-18)

Segunda fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.5), depois da [Fase 0](plano-fase-0-fundacoes.md). Decisão já tomada (D1): **uma tabela**, mas **só depois de um teste de carga** com 200 mil leads sintéticas que compare as duas formas de guardar.

## O que existe hoje
- `Lead` com dados soltos (`name`, `companyName` em texto, `phone`, `email`, `source`, `interest`, `status`, `responsavelId`, `nextActionAt`, `notes`). Não se distingue lead de empresa de lead de pessoa, nem se liga a uma empresa ou contacto que já existam.
- **A listagem devolve todas as leads de uma vez** (sem paginação), ordenadas por data de criação; a pesquisa é `ILIKE` em quatro colunas sem índice. Com milhares de leads, a página mais importante fica lenta.
- A conversão cria sempre empresa (se houver nome de empresa) + contacto + negócio, sem procurar duplicados.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **1a — Teste de carga** | 200 mil leads sintéticas nas duas formas (A: duas tabelas + união; B: uma tabela com tipo), medição das consultas da página, decisão registada | Nenhum (base de dados temporária, apagada no fim) |
| **1b — Modelo e API** | Tipo (empresa/pessoa), ligação a empresa/contacto existentes, modo do módulo, listagem por cursor com pesquisa indexada e contagens por estado | Baixo (só acrescenta colunas; as leads existentes ficam como estão) |
| **1c — Página e conversão** | Página única com separadores e contagens, filtros, «carregar mais», criação por tipo, ligação a registos existentes, conversão por tipo com deteção de duplicados | Médio (muda a página mais usada) |

---

## Pacote 1a — Teste de carga

### O que se mede
Numa base de dados **temporária** (`opencrm_bench_leads`, apagada no fim), com **200 000 leads** realistas (≈50% empresa, ≈50% pessoa; estados com a distribuição típica — muitas novas/contactadas, poucas convertidas; ~10 responsáveis; nomes, emails e telefones portugueses sintéticos; 70% com próxima ação):

| Forma | Estrutura |
|---|---|
| **A** | `lead_empresa` + `lead_pessoa` (cada uma com os seus campos) e a página faz `UNION ALL` |
| **B** | `lead` única com `tipo` e colunas anuláveis |

As duas com os índices que o desenho prevê (compostos por estado/responsável/próxima ação e `pg_trgm` para pesquisa).

**Consultas da página** (as que a interface vai fazer):
1. Primeira página (50) de um separador: estado + responsável, ordenada por próxima ação.
2. Página «funda» (por cursor, depois de 10 000 linhas) da mesma lista — e, para comparação, a mesma com `OFFSET` (o que **não** se vai usar).
3. Pesquisa de texto (`nome/empresa/email/telefone` contém «silva»), primeira página.
4. Contagens por separador (todas as leads agrupadas por estado), com e sem filtro de responsável.
5. Lista de «todos os tipos» ordenada por próxima ação (a página única), primeira página.

**Como se mede:** cada consulta 20 vezes depois de aquecer a cache; mediana e p95 com `EXPLAIN (ANALYZE, BUFFERS)` (tempo de execução no Postgres, sem rede). Máquina: a de desenvolvimento, Postgres em Docker (registado no resultado — os números absolutos dizem pouco fora desta máquina; a **comparação** A vs B é o que interessa).

**Critério de decisão (fixado antes de medir):** fica **B** se, em todas as consultas, B não for **mais de 2× mais lento** do que A **e** a primeira página ficar abaixo de **50 ms** (mediana). Se B falhar o critério, a decisão volta a ti com os números.

**Entregável:** script reprodutível (`apps/backend/scripts/bench-leads/`), resultados e decisão em `docs/` (este ficheiro, secção «Resultado do 1a») e em `decisoes.md`.

---

## Pacote 1b — Modelo e API (desenho preliminar, a confirmar pelo 1a)

- **Tipo:** `kind` (`COMPANY` / `PERSON`). As leads existentes ficam `COMPANY` se tiverem `companyName`, senão `PERSON` (regra simples e reversível, registada na migração).
- **Ligação a registos existentes:** `companyId?` e `contactId?` (lead de empresa → empresa; lead de pessoa → contacto e, opcionalmente, a empresa desse contacto). Continua a poder existir só com dados soltos (prospeção fria) e ligar-se depois. Os dados soltos (`name`, `companyName`, `phone`, `email`) mantêm-se na lead: a lead existe antes de haver empresa/contacto.
- **Campos novos só onde fazem falta:** `taxId?` (NIF, para detetar duplicados de empresas) e `jobTitle?` (cargo, nas leads de pessoa). O resto vai para campos personalizados (já existem para `LEAD`).
- **Modo do módulo** (`options.mode` do módulo de leads, coluna que já existe desde a 0a): `COMPANY`, `PERSON` ou `BOTH` (por omissão `BOTH`, para não mudar nada). Controla o que a interface oferece ao criar e como converte; **não** muda os dados.
- **Estado:** mantém-se o enum atual (`NOVO`, `CONTACTADO`, `SEM_RESPOSTA`, `CONVERTIDO`, `PERDIDO`). Passar as leads para um fluxo configurável (Fase 0c) fica para quando for pedido: mudaria a conversão e as automações, e não é preciso para este objetivo.
- **Listagem:** `GET /leads` passa a **paginação por cursor** (`limit`, `cursor`), ordenação por próxima ação (sem data no fim) e depois criação, filtros por estado, tipo, responsável, pesquisa (`pg_trgm`), e `GET /leads/counts` com as contagens por estado para os separadores (respeitando os outros filtros). Compatibilidade: a forma da resposta muda (`{ items, nextCursor }`); a interface muda no mesmo PR (1c) — o 1b mantém, por isso, a rota antiga como está e acrescenta `GET /leads/page` (removida no 1c).
- **Índices:** os validados no 1a.
- **API pública:** `POST /api/v1/leads` aceita `kind` (opcional, por omissão conforme o modo) e `tax_id`. Só acrescenta.

## Pacote 1c — Página e conversão (desenho preliminar)
- **Página única** com separadores por estado e contagens, filtro de tipo (se o modo for `BOTH`), responsável e pesquisa; «carregar mais» por cursor; atualização em tempo real (já existe).
- **Criar/editar** conforme o tipo e o modo: lead de empresa (nome da empresa, NIF, contacto principal opcional); lead de pessoa (nome, cargo, empresa opcional). Escolher uma empresa/contacto **existentes** em vez de escrever o nome.
- **Conversão por tipo**, numa transação: se a lead já estiver ligada, usa os registos ligados; se não, **procura duplicados** (empresa pelo NIF; contacto pelo email ou telefone) e liga em vez de criar; senão cria. O negócio continua a depender do módulo de negócios (como hoje).

## Riscos
| Risco | Mitigação |
|---|---|
| Decidir o modelo por opinião | 1a com critério fixado antes de medir |
| Classificar mal as leads existentes como empresa/pessoa | Regra simples, visível e editável; nada se perde (os dados soltos ficam) |
| Página mais usada ficar pior durante a transição | 1b não toca na página; 1c muda página e API juntas, com e2e e verificação no browser |
| Duplicados na conversão | Procura por NIF/email/telefone antes de criar; ligação explícita na interface |
