# Seletores de registos com pesquisa (plano, 2026-11-18)

Pedido depois da Fase 1c: **escolher uma empresa deve ter pesquisa, e o mesmo em situações semelhantes**. Hoje a
interface escolhe registos com um `<select>` que carrega a lista **inteira** (todas as empresas, todos os contactos),
o que deixa de ser utilizável com milhares de registos e obriga a descarregar tudo para abrir um diálogo.

## Levantamento (o que muda)

| Registo | Onde se escolhe hoje com lista completa |
|---|---|
| **Empresa** | diálogo de negócio, diálogo de tarefa, diálogo de lead (empresa existente), ficha e novo contacto |
| **Contacto** | diálogo de negócio, diálogo de tarefa, diálogo de lead (contacto existente / principal) |
| **Utilizador** (responsável) | ficha e nova empresa, ficha e novo contacto, diálogo de tarefa, diálogo de lead; filtros da lista de leads e da auditoria |

Ficam como estão (não são «registos a escolher», são configuração curta e ordenada): funis e fases (negócios,
automações), estados, tipos, interesses.

## Desenho

- **Um componente só** (`RecordPicker`): caixa de texto que abre uma lista de resultados enquanto se escreve.
  - Teclado: setas, Enter, Escape. Botão para limpar a escolha.
  - Acessível: `combobox` + `listbox`/`option`.
  - Cada resultado mostra um pormenor que ajuda a distinguir: NIF da empresa; empresa e email do contacto; papel do utilizador.
  - Ao editar, mostra o nome do registo já escolhido. Se não o souber, pede esse registo pelo id.
- **Empresas e contactos: pesquisa no servidor**, com atraso de 250 ms e **no máximo 20 resultados**. Ao abrir sem texto, mostra os primeiros 20 por ordem alfabética.
  - Novo parâmetro `limit` (1–100) em `GET /companies` e `GET /contacts`. Sem `limit` tudo fica igual, porque as páginas de listagem continuam a usar a rota sem limite.
  - Pesquisa como já existe: empresa por nome, nome fiscal, NIF, telefone e email; contacto por nome, email, telefone e telemóvel.
  - O contacto pode ser filtrado pela empresa (`companyId`, já suportado). É o caso do contacto principal de uma lead de empresa.
- **Utilizadores: pesquisa local.** A lista de utilizadores da empresa é curta e já vem toda numa só chamada. Muda só a forma de escolher, e fica igual à dos outros seletores.
- **Opção vazia** com o significado de cada sítio: «Eu», «Sem responsável», «Todos os responsáveis», «Nenhuma».

## Validação prevista
- e2e do `limit` e do filtro por empresa nas duas rotas, com a regra de que sem `limit` nada muda.
- **No browser**, em cada ecrã do levantamento:
  - Pesquisar e escolher.
  - Limpar a escolha.
  - Abrir um registo existente e ver o nome já escolhido.
  - Usar o teclado.
- Contar os pedidos de rede para confirmar que nenhum diálogo descarrega a lista completa.

## Fora deste pacote
- Paginação das **páginas de listagem** de empresas e contactos, que continuam a carregar tudo. Fica para quando forem revistas, como as leads foram no 1c.

## Pesquisa sem acentos (acrescento, 2026-11-19)

Pedido: a pesquisa no servidor deve ignorar acentos («joao» encontra «João», «grafica» encontra «Gráfica»).

- **Colunas de pesquisa mantidas pela base de dados**, como `Lead.searchText` no 1b: `Company.searchText` (nome, nome fiscal, NIF, telefone, email) e `Contact.searchText` (nome, email, telefone, telemóvel).
  - Guardam `lower(unaccent(...))`, preenchidas por um trigger em qualquer escrita, com índice GIN `pg_trgm`.
  - Usa-se um trigger e não um índice sobre uma expressão porque `unaccent` não é `IMMUTABLE` e porque o Prisma não representa índices sobre expressões.
  - O `Lead.searchText` passa a usar também `unaccent`; as linhas existentes são recalculadas na migração.
- **Extensão `unaccent`** (vem com o Postgres; a imagem `postgres:16-alpine` já a inclui), ativada por migração.
- **O termo pesquisado é normalizado em TypeScript da mesma forma** (`foldSearch`: minúsculas, sem marcas diacríticas, e um pequeno mapa para letras como ß→ss, æ→ae, ø→o).
  - Medido antes de implementar: em 190 letras latinas (U+00C0–U+017F) só uma diferia de `unaccent`, e foi acertada.
  - Um e2e compara as duas normalizações para todo esse intervalo, para não se afastarem.
- **A coluna não sai na API:** é escondida globalmente no cliente Prisma (pré-funcionalidade `omitApi` do Prisma 5.22), para não aparecer em nenhuma resposta que inclua empresas ou contactos.
- A pesquisa continua a ser «contém». Além de ignorar acentos, passa a usar o índice: antes era `ILIKE` em várias colunas, sem índice.

## Execução (2026-11-19)

**Implementado como planeado.** Pormenores:
- **Componente `RecordPicker`** e três seletores: `CompanyPicker`, `ContactPicker` (com filtro opcional por empresa) e `UserPicker` (com `includeInactive` para a auditoria).
  - Aplicados em todos os ecrãs do levantamento.
  - A lista abre em posição fixa no ecrã: dentro dos diálogos com scroll ficava cortada. Abre para cima quando falta espaço em baixo.
  - Com texto escrito, fica destacado o primeiro resultado, e um Enter antes de chegarem os resultados novos não escolhe nada.
- **Encontrado e corrigido na verificação** (já existia antes):
  - Limpar uma ligação ao editar (empresa, contacto, responsável) não ficava guardado, porque se enviava `undefined`.
  - Uma empresa sem email não se podia guardar: enviava-se `email: ""`, o servidor recusava e a página não mostrava erro.
  - Os formulários passam a enviar `null` para campos opcionais vazios (`blankToNull`), e as fichas de empresa e contacto mostram o erro quando o servidor recusa.
- **Pesquisa sem acentos:** migração `20261119100000_pesquisa_sem_acentos`, aplicada também à base de desenvolvimento, com cópia de segurança antes.
  - As colunas existentes foram recalculadas; as leads também passaram a ignorar acentos.

**Validação:**
- 10 e2e novos em `test/record-search.e2e-spec.ts`:
  - `limit` e filtro por empresa;
  - limpar ligações com `null`;
  - pesquisa sem acentos em empresas, contactos e leads;
  - a coluna interna não sai nas respostas (listas, fichas e includes);
  - normalização TS = Postgres para as 188 letras de U+00C0 a U+017F.
- 3 testes unitários de `foldSearch`. Migração sem desvio face ao esquema.
- **Prova por mutação:** 3 mutações (termo só em minúsculas, sem omissão global, sem o mapa de letras especiais), todas apanhadas.
- **Browser** (base de testes, 300 empresas): pesquisa por NIF e por nome, teclado, rato, limpar, reabrir com o nome já escolhido, e a empresa preenchida a partir do contacto escolhido, com o nome pedido ao servidor. Só há pedidos com `limit=20`; abrir um diálogo já não descarrega listas.
