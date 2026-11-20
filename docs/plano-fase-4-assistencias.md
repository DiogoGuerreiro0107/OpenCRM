# Fase 4 — Assistências (plano, 2026-11-20)

Quinta fase da [reorganização modular](plano-reorganizacao-modular.md) (§3.8 e tabela de fases). Depende das Fases 0
(módulos, fluxos, campos personalizados), 2 (itens de trabalho com tipos, passos, página do tipo e agenda) e 3
(automações).

**Objetivo:** um **módulo opcional «Assistências»** para os pedidos de reparação e suporte técnico. Uma assistência é
um **item de trabalho do tipo «Assistência»** (aparece na agenda, nas listas, no quadro por passos e nas automações)
com **dados próprios**: o equipamento, o problema reportado, o diagnóstico e a resolução, o **tempo gasto** (cronómetro
e registos manuais) e as **peças usadas**.

## O que existe hoje
- O tipo de tarefa de sistema «Assistência» (`ASSISTENCIA`, Fase 2a): passos opcionais, campos personalizados por
  tipo, página do tipo com quadro por passos, agenda e automações já funcionam para ele.
- Não há dados próprios (equipamento, diagnóstico), nem registo de tempo, nem peças, nem ficha de assistência.
- Produtos e stock ainda não existem (Fase 5): as peças, por agora, são texto e quantidade.

## Pacotes (cada um com PR próprio)

| Pacote | Entrega | Risco |
|---|---|---|
| **4a — Módulo e ficha da assistência** | Módulo `assistencias`; dados próprios ligados 1:1 ao item de trabalho; passos por omissão; página «Assistências» e ficha com os dados, campos personalizados e timeline; campos próprios nas automações | Médio |
| **4b — Cronómetro e registo de tempo** | Registos de tempo com o servidor como fonte de verdade; um cronómetro ativo por utilizador; entrada manual; edição com motivo; totais; gatilho «cronómetro parado» | Médio |
| **4c — Peças e indicadores** | Peças usadas (texto e quantidade, prontas a ligar a produtos na Fase 5); indicadores do módulo (tempo por técnico, tempo médio, abertas por passo) | Baixo |

Fora desta fase: **equipamentos como registo próprio** com histórico por série e contratos (Fase 9, §4 da
reorganização — por agora os dados do equipamento vivem na assistência), SLA e escalonamento, entrada por email,
portal do cliente, faturação do tempo.

---

## Pacote 4a — Módulo e ficha da assistência

### Modelo
- **Módulo opcional `assistencias`** («Assistências»), ativo por omissão como os outros. Desligado: as rotas próprias dão
  404, o menu e a ficha somem; as tarefas do tipo «Assistência» continuam a existir como tarefas (os dados ficam
  guardados).
- **`ServiceCase`** (tabela nova), **1:1 com o item de trabalho** (`workItemId` é a chave; apagar a tarefa apaga-a):
  - equipamento: **marca**, **modelo**, **número de série**, **em garantia** (sim/não/não sei);
  - **problema reportado** (obrigatório ao criar), **diagnóstico**, **resolução**;
  - número da assistência legível (`AS-0001`), sequencial.
- **Só itens do tipo «Assistência»** têm estes dados (o serviço recusa o resto). Os itens desse tipo que já existam ganham
  a linha na migração (com o problema reportado = descrição da tarefa, ou «(sem descrição)»).
- **Passos por omissão:** ao ligar o módulo (ou no arranque, se o tipo ainda não tiver passos), o tipo «Assistência»
  recebe os passos *Recebida → Diagnóstico → À espera de peças → Em reparação → Resolvida / Sem reparação*. Se o
  administrador já lhe deu passos, ficam os dele.

### Regras
- **Criar uma assistência** cria o item de trabalho (tipo «Assistência», cliente = empresa e/ou contacto, responsável,
  prazo/horário) e os dados próprios numa só operação, pelo serviço das tarefas (passo, eventos de automação, timeline).
- Alterar o diagnóstico ou a resolução regista na timeline da assistência («Diagnóstico atualizado»).
- Permissões: as mesmas das tarefas (área «trabalho do dia-a-dia»); ler é para todos.

### Automações
- As regras de tarefas já servem as assistências (condição «Tipo de tarefa = Assistência»). Para as condições poderem
  usar os dados próprios, o tipo de registo das tarefas ganha os campos **Em garantia** e **Marca** (vazios nas tarefas
  que não são assistências). Exemplo que passa a ser possível: «quando uma assistência entra em *Diagnóstico* e Em
  garantia = não → criar a tarefa *Orçamento para {titulo}* para o comercial».

### API
- `GET /service-cases` (lista paginada com pesquisa por número, cliente, série, marca/modelo; filtros por passo/estado
  e responsável), `GET /service-cases/:id`, `POST /service-cases`, `PATCH /service-cases/:id`. A tarefa continua a
  editar-se em `/tasks/:id` (estado, passo, responsável, prazo).
- Tempo real: `service-cases` como recurso.

### Interface
- Item de menu **«Assistências»** (contribuição do módulo) → lista com pesquisa e filtros, e o quadro por passos (o da
  página do tipo, reaproveitado); botão «Nova assistência» (cliente, equipamento, problema, responsável, prazo).
- **Ficha da assistência** (`/assistencias/:id`): cabeçalho (número, cliente, passo, responsável), equipamento, problema,
  diagnóstico e resolução editáveis, campos personalizados do tipo, timeline. No 4b junta-se o tempo e no 4c as peças.
- O cartão «Assistências» na ficha da empresa e do contacto (contribuição do módulo): as do cliente, mais recentes
  primeiro, com link para a ficha.
- Abrir uma tarefa do tipo «Assistência» na lista de tarefas, no quadro ou na agenda leva à ficha.

### Validação prevista
- Migração ensaiada numa cópia da base de desenvolvimento (itens «Assistência» existentes ganham a linha; nada mais
  muda), reversão testada, sem desvio face ao esquema.
- **e2e:** criar (com e sem empresa/contacto; problema obrigatório; número sequencial sem repetir em criações
  simultâneas); só itens do tipo «Assistência»; editar e timeline; lista com pesquisa e filtros (paginada); módulo
  desligado (404, dados guardados, tarefa continua); passos por omissão (sem pisar os do administrador); permissões;
  campos próprios nas automações.
- **Prova por mutação** nas regras; **browser** (base de testes): menu, lista, nova assistência, ficha, cartão na
  empresa, abrir pela agenda.

### Execução do 4a (2026-11-20)
**Implementado como planeado**, com estes pormenores decididos na implementação:
- **Toda a tarefa do tipo «Assistência» tem os dados próprios**, venha de onde vier: a ficha nova, o diálogo da tarefa,
  uma automação («criar tarefa») ou uma tarefa que passa a esse tipo. Sem dados, o serviço das tarefas cria-os com o
  problema = descrição (ou título). É a mesma regra da migração para as que já existiam. Assim, abrir qualquer
  assistência leva sempre a uma ficha.
- **Uma assistência não muda de tipo** (400): os dados próprios só fazem sentido nesse tipo.
- **Número sem buracos:** a primeira versão gravava com «ON CONFLICT DO NOTHING», que gasta um valor da sequência mesmo
  quando não insere. A suite apanhou números saltados; passou a ver primeiro se existe.
- Os passos por omissão são dados no arranque e antes de cada criação, só com o módulo ligado e o tipo sem passos.
- **Interface:** contribuição do módulo (menu «Assistências», rotas `/assistencias` e `/assistencias/:id`, cartão nas
  fichas de empresa e contacto). A lista tem pesquisa, responsável e estado (em aberto, fechadas, todas). O botão
  «Quadro por passos» leva à página do tipo. Na ficha, a tarefa (passo, responsável, prazo) edita-se no diálogo da
  tarefa. Na lista de tarefas (lista, quadro e calendário) e na agenda, uma assistência abre na ficha, com o módulo
  ligado.
- **Tempo real:** recurso `service-cases`. O formulário da ficha copia a assistência só ao abri-la ou ao gravar, para
  uma atualização a meio não apagar o que se está a escrever (a mesma razão das fichas de empresa e contacto).
- **Testes:** 9 e2e novos em `test/service-cases.e2e-spec.ts` e o módulo acrescentado em `test/modules.e2e-spec.ts`.
  Total: 284 unitários e 478 e2e. Na suite completa, alguns testes de outras áreas falharam por tempo na limpeza da
  base de testes (`TRUNCATE` acima de 30 s, com a suite a demorar 15 min em vez do habitual). Passam todos sozinhos e
  nenhuma asserção falhou. A primeira volta apanhou o erro dos números saltados (acima).
- **Prova por mutação:** 16 mutações, todas apanhadas: criar e mudar para o tipo sem dados próprios, problema sem a
  descrição, sem ver se já existe (números saltados), assistência a mudar de tipo, pesquisa sem série e sem número,
  fechadas = abertas, apagar o diagnóstico registado como atualizado, sem «campo alterado», marca sem limpar espaços,
  problema vazio aceite, rota sem módulo e sem área de escrita, garantia fora das automações, filtro por empresa
  ignorado. A prova mostrou um teste instável: as duas notas do mesmo pedido têm a mesma hora, e a ordem entre elas
  deixou de contar no teste.
- **Migração:** ensaiada numa cópia da base de desenvolvimento com duas assistências acrescentadas (uma com
  descrição e outra sem): ganharam a linha (AS-0001 e AS-0002, problema = descrição ou título) e os restantes dados
  ficaram iguais (mesma impressão digital). Sem desvio face ao esquema. A reversão repôs o esquema e os dados de
  antes. A base de desenvolvimento foi migrada depois de uma cópia de segurança.
- **Browser** (base de testes): menu «Assistências»; lista com pesquisa por série e por número; ficha (gravar o diagnóstico vai à
  timeline e o formulário mantém o texto); mudar o passo no diálogo da tarefa (o cabeçalho atualiza); cartão na
  empresa e «Nova assistência» a partir dele (com a empresa preenchida, abre a ficha nova); abrir uma assistência pela
  lista de tarefas, pelo quadro do tipo e pela agenda leva à ficha, também a criada como tarefa comum. Acerto feito
  no browser: o campo da garantia passou a «Em garantia» com opções curtas (Sim, Não, Por confirmar), porque o texto
  não cabia.

---

## Pacotes seguintes (esboço; cada um terá plano detalhado antes de começar)

### 4b — Cronómetro e registo de tempo
- `TimeEntry` (item de trabalho, utilizador, início, fim, nota, faturável, manual, motivo da última edição).
  **O servidor é a fonte de verdade:** «iniciar» grava o início, «parar» grava o fim; o contador no ecrã é só
  apresentação (sobrevive a fechar o browser ou mudar de computador).
- **Um cronómetro ativo por utilizador**, garantido pela base de dados; iniciar outro para o primeiro (com aviso).
- Entrada manual; edição de um registo com motivo (auditoria); totais por assistência e por técnico; aviso de
  cronómetro esquecido (aberto há mais de X horas) no ecrã.
- Gatilho de automação «cronómetro parado».
- Serve qualquer item de trabalho (o cronómetro não é exclusivo das assistências), mas a interface começa pela ficha da
  assistência e um indicador global do cronómetro ativo na barra.

### 4c — Peças e indicadores
- Peças usadas (descrição, referência opcional, quantidade), com a ligação a produtos preparada para a Fase 5 (stock).
- Indicadores do módulo: abertas por passo, tempo médio até resolver, tempo por técnico, resolvidas sem reparação.

## Decisões assumidas (a rever)
- Os dados do equipamento vivem na assistência até haver equipamentos como registo próprio (Fase 9).
- «Em garantia» tem três valores (sim, não, não sei), porque muitas vezes não se sabe ao receber.
- As peças são texto até existirem produtos (Fase 5).
- O cronómetro serve qualquer item de trabalho.
