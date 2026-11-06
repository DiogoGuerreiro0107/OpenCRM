# Plano: esconder no ecrã o que o papel não pode fazer (2026-11-06)

Seguimento do [pacote B do endurecimento](plano-endurecimento.md), que ficou com esta limitação documentada: *"os restantes botões de escrita (ex.: «Novo contacto») continuam visíveis para papéis sem permissão e, ao usá-los, o backend responde 403 e a UI mostra um erro genérico."* Agora há 6 papéis reais; um Técnico ou alguém de "Leitura apenas" vê "Nova empresa", abre o formulário, preenche tudo, e só ao guardar recebe um erro. Plano escrito antes de qualquer alteração.

## 1. Princípio
A segurança continua a ser **só do backend**. Isto é conforto de utilização: não mostrar o que vai falhar. Se o ecrã ficar desatualizado em relação ao backend, o pior que acontece é um botão visível que devolve "sem permissão" — como hoje.

## 2. Desenho

- **Uma só fonte de verdade no frontend**: `lib/permissions.ts` ganha um espelho da matriz `WRITE_ACCESS` do backend e `canWrite(papel, área)`; hook `useCanWrite(área)`. As listas `ADMIN_ONLY`/`EMAIL_TEMPLATE_MANAGERS` já existentes passam a derivar dela.
- **Contra o desvio entre as duas matrizes** (o risco real de um espelho): um teste no backend importa a matriz do frontend e falha se houver qualquer diferença. Sem isto, alguém altera uma e esquece-se da outra.
- **Formulários e diálogos em modo só de leitura** com `<fieldset disabled>` (o HTML desativa de uma vez todos os campos e botões lá dentro, sem tocar em cada um) e uma faixa a explicar "O teu papel só pode consultar isto". Os diálogos continuam a abrir — consultar é permitido.
- **Esconder** os botões de criar ("Nova empresa", "Novo contacto", "Novo lead", "Nova tarefa", "+ Negócio", "Novo email", "Adicionar contacto") e o botão de ligar.
- **Kanban**: sem arrastar para quem não pode mexer em negócios (hoje o arrasto falha no backend e a UI volta atrás).
- **Secções embebidas** (timeline, campos personalizados, email, chamadas) decidem por si, porque têm permissões diferentes da ficha onde estão: um Técnico não edita a empresa mas escreve notas na timeline dela. Por isso, nos diálogos que as contêm, os `fieldset` envolvem só os campos próprios, nunca as secções (um `fieldset disabled` aninhado não se volta a ativar).

| Área | Quem escreve | Onde se aplica |
|---|---|---|
| `companies` | Admin, Comercial, Backoffice, Financeiro | lista + ficha de empresa |
| `contacts` | Admin, Comercial, Backoffice | lista + ficha de contacto + "Adicionar contacto" |
| `leads` | Admin, Comercial, Backoffice | lista + diálogo (incl. Converter) |
| `deals` | Admin, Comercial, Backoffice | "+ Negócio", diálogo, arrastar |
| `dailyWork` | todos menos Leitura | tarefas, notas na timeline, valores de campos personalizados |
| `sendEmail` | Admin, Comercial, Backoffice | "Novo email" |
| `makeCall` | Admin, Comercial, Técnico, Backoffice | botão de ligar |

## 3. Validação
- Teste de desvio entre as duas matrizes (e prova por mutação de que falha).
- Browser com 3 utilizadores de teste (Leitura apenas, Técnico, Comercial): o que cada um vê e consegue clicar em cada página; o Administrador continua a ver tudo. Utilizadores de teste removidos no fim.
- Builds, 90 unitários + 181 e2e e auditoria inalterados.

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Um `fieldset disabled` desativar sem querer botões de uma secção que o papel pode usar (ex.: notas) | Os `fieldset` só envolvem os campos próprios; verificado no browser com o Técnico |
| O espelho desalinhar do backend | Teste automático (acima) |
| Esconder demasiado e o utilizador não perceber porquê | Faixa explicativa nos formulários em modo só de leitura |

## 5. Fora de âmbito
Esconder opções dentro de dropdowns, permissões por registo (ex.: só o responsável edita), mensagens de erro de permissão traduzidas em todas as ações (o helper `errorMessage` do pacote de utilizadores cobre os diálogos novos; os antigos ficam para outra altura).

## 6. Registo de execução

- [x] Matriz espelhada + hook + teste de desvio
- [x] Aplicado às páginas e diálogos
- [x] Validado no browser com 3 papéis
- [ ] PR
