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
