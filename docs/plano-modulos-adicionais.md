# Módulos adicionais (chat, atendimento, ponto, férias, mapas e rotas): viabilidade e plano (2026-11-11)

**Estado: proposta para revisão (M1–M4 respondidas, ver §11). Nada disto está implementado.** Complementa o [registo de módulos](plano-fase-0-fundacoes.md) (Fase 0a), a [reorganização modular](plano-reorganizacao-modular.md) e o [sistema de extensões](plano-extensoes-e-api.md).

**Pedido:** planear módulos novos (chat, atendimento, marcação de ponto, gestão de férias, mapas e rotas, «etc.»), todos **opcionais** e construídos sobre o sistema de módulos, e **confirmar se o sistema de módulos planeado os permite**.

Estrutura: §1 resposta curta · §2 o que o sistema atual cobre e o que falta · §3 as peças de plataforma a acrescentar · §4 o «contrato» de um módulo embutido · §5 a §9 um plano por módulo · §10 ordem · §11 decisões · §12 riscos · §13 fontes.

---

## 1. Resposta curta

**O sistema de módulos planeado permite estes módulos? Em parte.** O registo da Fase 0a resolve o essencial («ligar/desligar sem apagar dados», dependências, rotas que respondem 404, tarefas agendadas que não correm). Mas foi desenhado para **módulos de negócio com dados partilhados da empresa** (leads, negócios, encomendas), e estes cinco módulos são de outra natureza: **dados pessoais de colaboradores** (ponto, férias), **comunicação em tempo real** (chat, atendimento) e **geografia** (mapas). Faltam **sete capacidades de plataforma** (§2 e §3). Nenhuma exige deitar fora o que existe; são **acrescentos compatíveis** ao manifesto e ao núcleo, e quase todas já eram necessárias para os módulos da reorganização (notificações para assistências, tarefas agendadas para encomendas, permissões por âmbito para tarefas).

**Regra do desenho:** estes cinco módulos são **módulos embutidos** (código no repositório, mesmo manifesto, mesmo interruptor), **não** extensões instaláveis. Têm interface própria, tabelas próprias e tempo real, o que as formas de extensão de terceiros (A, C, D) não permitem por desenho. Os **fornecedores** que eles usam (geocodificação, encaminhamento, canais de atendimento) são, esses sim, pontos de extensão para terceiros (§3.7).

---

## 2. O sistema atual contra as necessidades

Legenda: ✅ já coberto · 🟡 planeado mas insuficiente · ❌ não existe nem está planeado.

| Necessidade | Estado | Notas |
|---|---|---|
| Ligar/desligar por instalação, dependências, 404 nas rotas, dados mantidos | ✅ | Fase 0a (PR #27, por integrar) |
| Tarefas agendadas que respeitam o módulo | 🟡 | Funciona nas automações e na Zadarma, mas cada uma verifica à mão; não há um **registo de tarefas** do módulo (necessário para acumulação de férias, fecho de pontos esquecidos, retenção do chat) |
| **Permissões por âmbito** (só os meus / a minha equipa / todos) | ❌ | A matriz (hoje em código, na Fase 0d em BD) é **papel × módulo × ação**. Ponto e férias exigem «o colaborador vê só o seu; o responsável vê a equipa». O chat exige «só os membros do canal». Não há conceito de **responsável direto** nem de **equipa** em `User` |
| **Privacidade acima do papel** | ❌ | Mensagens privadas e registos de ponto não devem ser visíveis a um Administrador só por ser Administrador. O modelo atual assume que Administrador vê tudo |
| **Tempo real dirigido** (por canal, por utilizador, com dados) | 🟡 | O canal atual emite `{recurso, ação}` para **todos** e sem dados de negócio (princípio correto para o resto). O chat precisa de salas por canal, autorização ao entrar, presença e contadores. Já existe `userRoom` por utilizador, que ajuda |
| **Notificações** (sino, email, mais tarde push) | ❌ | Não existe. Pedidos de férias, menções no chat, atribuição de atendimentos e visitas dependem disto |
| **Definições do módulo** com formulário | 🟡 | A coluna `options` existe, sem esquema nem interface. Regras de ponto, política de férias, fornecedor de mapas precisam de formulários validados |
| **Contribuições para a interface** (menu, páginas, cartões na ficha, itens na agenda, gráficos no dashboard) | 🟡 | O menu e as rotas estão fixos em `AppShell.tsx`/`App.tsx`; o menu configurável é a Fase 2. Falta o **registo de contribuições** para um módulo acrescentar um cartão «Mapa» à ficha da empresa sem alterar o código da ficha |
| **Dependências fracas** («melhora se existir») | ❌ | O manifesto só tem `dependsOn` (obrigatória). Os mapas melhoram com assistências e visitas, o atendimento com email e telefonia, as férias com a agenda, mas nenhum **exige** o outro |
| **Ciclo de vida dos dados pessoais** (conservação, exportação, anonimização, apagar) | ❌ | «Desligar nunca apaga» (decisão da 0a) é certo para negócio, mas conflita com prazos de conservação e direitos do titular nos dados de colaboradores (§12) |
| **Auditoria imutável** | 🟡 | Prevista na E0 só para ações de administração. Correções de ponto e aprovações de férias precisam de rasto **permanente e anexável** |
| Tabelas próprias do módulo | ✅ | Um só `schema.prisma`; as tabelas existem sempre (aceitável). Convenção: prefixo por módulo e teste estrutural que impede modelo «sem dono» |
| Armazenamento de ficheiros (anexos do chat) | ✅ | MinIO já integrado |
| IDs de módulo | 🟡 | `ModuleId` é uma união fixa em TypeScript. Serve para embutidos; as extensões (E1) passam a texto validado em tempo de execução |

---

## 3. As peças de plataforma a acrescentar

Todas pequenas, genéricas e **úteis também aos módulos da reorganização**. Cada uma é um pacote com plano, testes e PR próprios, como na Fase 0.

### 3.1 Manifesto de módulo enriquecido (compatível com o atual)
Acrescenta campos **opcionais** ao manifesto atual, sem partir os cinco módulos existentes:

```ts
interface ModuleManifest {
  // já existe
  id, label, description, dependsOn, defaultEnabled
  // novos (todos opcionais)
  enhancedBy?: ModuleId[]        // dependências fracas: usa se estiverem ativos
  permissions?: PermissionDef[]  // ações do módulo (ver, criar, aprovar...) e âmbitos permitidos
  settings?: SettingsSchema      // esquema JSON → formulário gerado (campos 'secret' cifrados)
  jobs?: JobDef[]                // tarefas agendadas, registadas no agendador do núcleo
  events?: { emits, listens }    // eventos de domínio publicados/subscritos
  notifications?: NotificationTypeDef[]
  data?: { personalData: boolean; retention?: RetentionPolicy; export?: boolean }
  ui?: { nav, routes, recordPanels, agendaSources, dashboardWidgets }   // ver 3.5
}
```
É o mesmo manifesto que a [E1](plano-extensoes-e-api.md#4-o-manifesto-de-extensão) prevê para extensões: os módulos embutidos são o primeiro cliente.

### 3.2 Permissões por âmbito (extensão da Fase 0d)
- Acrescenta à matriz o **âmbito** de cada permissão: `PROPRIO` (os meus registos), `EQUIPA` (os dos meus subordinados), `TODOS`.
- `User.managerId` (responsável direto) e, só se for preciso, `Team`. A **hierarquia** vem do `managerId`; o âmbito `EQUIPA` calcula-se a partir dela. Evita criar papéis novos («RH») para cada necessidade: um **sinalizador de capacidade** por utilizador (p. ex. «aprova férias de…») cobre os casos pequenos.
- **Um só avaliador no backend** que recebe `(utilizador, módulo, ação, registo)` e devolve sim/não; as consultas de lista aplicam o âmbito **na própria pergunta à base de dados** (nunca filtrar depois em memória).
- **Privacidade acima do papel:** permissões marcadas `restrita` (mensagens diretas, registos de ponto) **não** são concedidas ao Administrador por omissão; ver o conteúdo exige ação explícita, auditada.

### 3.3 Notificações (núcleo)
Serviço único `notify(utilizador, tipo, dados)` com **sino na interface** (lista, não lidas, marcar como lidas), **email opcional** pelo SMTP existente, preferências por utilizador e tipo, e entrega em tempo real. Os módulos declaram os seus tipos no manifesto. Push do navegador fica para depois.

### 3.4 Registo de tarefas agendadas (núcleo)
Os módulos declaram `jobs`; o **agendador do núcleo** executa-os, só se o módulo estiver ativo, com **registo de cada execução** (início, fim, erro), limite de tempo, interruptor e **uma só execução de cada vez** (há uma só instância do backend, mas um *job* lento não deve sobrepor-se a si próprio). Substitui os `@Cron` soltos de hoje.

### 3.5 Registo de contribuições da interface
Um módulo regista no frontend as suas **contribuições** (itens de menu, rotas, cartões na ficha de empresa/contacto/negócio, fontes da agenda, widgets do dashboard) e o núcleo mostra-as **só se o módulo estiver ativo e o utilizador tiver permissão**. As páginas de cada módulo carregam por *code-splitting* (um módulo desligado ou nunca usado não pesa no pacote inicial). O menu configurável da Fase 2 passa a consumir este registo.

### 3.6 Tempo real dirigido
Mantém-se o canal atual para o resto da aplicação. Acrescenta-se um **espaço de nomes** próprio (`/rt`) com **salas por recurso** (`chat:<canal>`, `user:<id>`), **autorização verificada ao entrar** (um cliente não escolhe salas por si) e eventos **com dados**, só para os membros autorizados da sala. Presença e «a escrever…» ficam em memória (não vão para a base de dados). Continua válido um só backend; mais de um exigiria um adaptador Redis (já documentado).

### 3.7 Contratos de fornecedor (pontos de extensão)
Seguindo o padrão da [E1](plano-extensoes-e-api.md#51-fornecedores-de-capacidade-o-padrão-que-torna-os-conectores-trocáveis): `GeocodingProvider`, `RoutingProvider` e `TileProvider` (mapas) e `ChannelProvider` (canais do atendimento: email, WhatsApp, telefone, formulário). O módulo só fala com o contrato; o adaptador concreto troca-se sem alterar o módulo. **Regra de dois:** cada contrato só se fixa depois de ter duas implementações reais (email + WhatsApp no atendimento; fornecedor público + auto-alojado nos mapas).

### 3.8 Ciclo de vida de dados pessoais e auditoria
Cada módulo com `data.personalData` declara **conservação** (prazo e o que acontece ao fim), **exportação** (o titular pede os seus dados), **anonimização** quando um colaborador sai, e **apagamento** explícito (ação separada, confirmada, depois de exportar). Um **registo de auditoria** geral, só de acrescentar (nunca edita nem apaga), regista aprovações, correções e acessos a dados restritos. Estende o registo de auditoria de administração previsto na E0.

### 3.9 Onde isto encaixa nas fases já aprovadas
| Peça | Entra em |
|---|---|
| 3.1 manifesto, 3.4 tarefas agendadas | Pacote **0a-bis** (pequeno; depois da integração do PR #27) |
| 3.2 âmbitos e hierarquia | Dentro do pacote **0d** (permissões em BD) |
| 3.3 notificações, 3.6 tempo real dirigido, 3.8 ciclo de vida e auditoria | Novo pacote **P** (plataforma), em paralelo com a E0 (partilha a auditoria e a cifra de segredos) |
| 3.5 contribuições da interface | **Fase 2** (menu configurável e agenda) |
| 3.7 contratos de fornecedor | Com o módulo que os usa (mapas, atendimento) e a E1 |

---

## 4. O «contrato» de um módulo embutido (lista de verificação)

Para qualquer módulo novo ser aceite no repositório (e para este plano ser repetível sem decisões ad hoc):

1. **Manifesto** completo (§3.1), com dependências fortes e fracas.
2. **Módulo NestJS** próprio numa pasta própria; **todos** os controllers com `@RequireModule("<id>")` (o teste estrutural existente falha se faltar).
3. **Modelos Prisma** com prefixo do módulo (`@@map("chat_message")`); teste estrutural: nenhum modelo sem dono.
4. **Permissões** declaradas (ação + âmbitos); o teste de cobertura de permissões abrange o módulo.
5. **Tarefas agendadas** só pelo registo (§3.4); **notificações** só pelo serviço (§3.3); **segredos** só cifrados.
6. **Comunicação entre módulos só por eventos de domínio e contratos** — um módulo nunca importa serviços de outro (isto é o que torna as dependências fracas seguras).
7. **Interface** só por contribuições (§3.5), com *code-splitting*.
8. **Testes:** e2e com o módulo ligado e desligado (404, tarefas paradas, nada na interface), com e sem as dependências fracas; âmbitos de permissão (um colaborador não vê o de outro); **prova por mutação** de que os testes falham se o guard ou o âmbito forem removidos.
9. **Dados pessoais:** conservação, exportação e anonimização implementadas e testadas (se `personalData`).
10. **Documentação:** secção em `docs/decisoes.md` e linha no README.

---

## 5. Módulo «Chat» (`chat`)

**Âmbito (v1):** conversa **interna** entre colaboradores.
- **Canais** públicos e privados, **mensagens diretas** (1-1 e grupos pequenos), anexos (MinIO), menções `@pessoa`, marcadores de leitura e **contadores de não lidas**, presença básica (online/ausente), editar/apagar a própria mensagem (com «editada»).
- **Ligação ao CRM:** uma conversa pode ser ligada a uma empresa, negócio ou (mais tarde) assistência; o cartão «Conversa» na ficha mostra-a (contribuição §3.5). É este o motivo para **construir** em vez de integrar um chat externo.
- **Fora da v1:** *threads*, pesquisa em texto completo, chamadas de voz/vídeo, encriptação ponta-a-ponta, *push* móvel, chat com clientes (ver «Atendimento»).

**Dados:** `chat_channel`, `chat_member` (com papel e último lido), `chat_message` (canal, autor, corpo, anexos, `clientMessageId` único para idempotência, índice `(canal, id)` para paginação por cursor), `chat_attachment`.

**Tempo real:** sala por canal; o envio é um `POST` (idempotente por `clientMessageId`), o servidor grava e difunde à sala; o cliente mostra a mensagem logo e reconcilia. Autorização ao entrar na sala = pertencer ao canal.

**Permissões:** ver/enviar só em canais de que se é membro; criar canais públicos conforme configuração; **Administrador não lê mensagens diretas nem canais privados** por omissão (privacidade acima do papel, §3.2). Moderação de canais públicos (apagar mensagem) sim.

**Conservação:** política configurável (p. ex. apagar mensagens com mais de N meses) corrida pelo registo de tarefas.

**Depende de:** núcleo + peças 3.2, 3.3, 3.6. **Melhora com:** empresas/negócios/assistências (ligação).

**Construir ou integrar?** As comparações consultadas (§13) apresentam Mattermost como opção simples para uma equipa numa só máquina e Matrix como a escolha para encriptação/federação, mas são blogs de fornecedores. Recomendo: **construir o mínimo acima** (uma só autenticação, ligação ao CRM, sem mais um serviço para operar) e **não perseguir a paridade com o Slack**. Quem quiser mais do que isto liga um Mattermost como **extensão da forma A** (ligação por webhooks), em vez de crescer o módulo.

**Riscos:** privacidade de mensagens (decisão sobre acesso do administrador), crescimento da tabela de mensagens (índice e retenção), expectativas de paridade com ferramentas dedicadas.

---

## 6. Módulo «Atendimento» (`service-desk`)

> **A palavra é ambígua e preciso que a esclareças** (decisão M1). Lê-se de duas formas: **(1) atendimento ao cliente por vários canais** (pedidos que chegam por email, WhatsApp, telefone e formulário, geridos numa fila com responsável e prazos), ou **(2) atendimento presencial no balcão** (a loja: ordem de chegada, quem está a ser atendido). Planeio a **(1)**, que é a que se liga ao que já existe (email, Zadarma, n8n/WAHA); a (2) seria um módulo bem mais pequeno.

**Âmbito (v1, leitura 1):**
- **Conversa de atendimento**: o fio de mensagens com um cliente, **independente do canal**. Cada pedido é um `WorkItem` do tipo «Pedido de atendimento» (fluxo e campos configuráveis, aparece na agenda e no menu como qualquer outro).
- **Caixa de entrada única** com fila por estado, atribuição (manual e por regra), prioridade, etiquetas, **respostas-modelo** (reutiliza os modelos de email) e notas internas.
- **Canais como fornecedores (`ChannelProvider`):** email (já existe: IMAP/SMTP), telefone (Zadarma: chamada perdida cria pedido), **WhatsApp** (entrada/saída pelo n8n + WAHA que já tens, via API pública com chave) e **formulário** (API pública). Regra de dois: **email + WhatsApp** definem o contrato.
- **SLA simples:** prazo de primeira resposta e de resolução por prioridade, alerta e escalonamento (reutiliza as automações generalizadas).
- **Conversão:** de um pedido para **lead**, **assistência** ou **encomenda** (em um clique, mantendo a ligação e o histórico).
- **Métricas:** tempo até à primeira resposta, tempo de resolução, volume por canal e por pessoa.

**Fora da v1:** *widget* de chat no site (exporia o CRM à internet; o CRM é só rede local), chatbots, pesquisa de satisfação, base de conhecimento.

**Dados:** `service_conversation`, `service_message` (canal, direção, corpo, anexos, id externo para deduplicar), `service_channel_account`; o pedido em si é `WorkItem` (Fase 2). Ligação do contacto por email/telefone/NIF ao contacto existente (cria um se não houver).

**Depende de:** núcleo, **itens de trabalho (Fase 2)**. **Melhora com:** email, telefonia, assistências, leads, automações, API pública (WhatsApp/formulário).

**Riscos:** duplicação de mensagens entre canais (idempotência por id externo), entrada de WhatsApp depende da fiabilidade do WAHA (não oficial; é uma dependência que já aceitaste), volume de email antigo na primeira ligação (importar só a partir de uma data).

---

## 7. Módulo «Marcação de ponto» (`timeclock`)

> **Aviso legal.** Em Portugal o registo dos tempos de trabalho é, segundo as fontes consultadas, uma obrigação do empregador, mas **o modo de registo é condicionado** pela proteção de dados: biometria exige notificação/autorização prévia da CNPD e é intrusiva; geolocalização tem deliberação própria da CNPD; no teletrabalho é proibido o controlo permanente por imagem ou som. As fontes são de divulgação jurídica, **não os textos legais**: **valida o desenho final com um jurista ou com a CNPD antes de pôr em produção**. Isto não é aconselhamento jurídico.

**Âmbito (v1):** **registo** de tempos, não processamento salarial.
- **Entrada/saída/pausa** pelo próprio colaborador autenticado (ou num **quiosque** partilhado na loja com PIN individual, decisão M3). Hora **sempre do servidor**, nunca do relógio do cliente.
- **Horários por colaborador** (fixo, flexível, isenção de horário), **tolerâncias** e **saldo de horas** (a mais/a menos) por dia, semana e mês.
- **Esquecimentos:** o registo de tarefas fecha, no fim do dia, entradas sem saída **como pendentes de correção** (nunca inventa uma hora).
- **Correções** pedidas pelo colaborador (hora e motivo) e **aprovadas pelo responsável direto**; a original nunca se apaga (rasto permanente, §3.8).
- **Mapa de assiduidade** mensal, exportável (CSV/PDF) para o contabilista ou para uma inspeção; o colaborador vê sempre o seu.
- **Integração com férias:** dias de férias/falta aprovados deixam de contar como falta de registo.

**Decisões de privacidade (recomendação, a validar):** **sem biometria; sem geolocalização contínua.** Opcional e desligado por omissão: **uma única posição no momento do registo**, só se o administrador ativar, com aviso ao colaborador. Sem capturas de ecrã, sem monitorização de atividade, sem fotografias.

**Dados:** `timeclock_entry` (utilizador, tipo, hora do servidor, origem, estado), `timeclock_correction` (pedido, motivo, aprovador, resultado), `timeclock_schedule`. **Imutável por desenho:** correções são novas linhas ligadas à original.

**Permissões (âmbito §3.2):** o colaborador vê e regista o **seu**; o responsável vê e aprova a **equipa**; o Administrador/Financeiro vê mapas agregados e exporta; **leitura individual detalhada por terceiros é auditada**.

**Conservação:** prazo a confirmar (jurista/contabilista); depois do prazo, anonimização ou apagamento por política.

**Depende de:** núcleo + 3.2, 3.3, 3.4, 3.8. **Melhora com:** férias (calendário comum de feriados), agenda.

**Não confundir com o cronómetro das assistências** (Fase 4): aquele serve para **custo do serviço**, este é um **registo legal**; partilham, no máximo, a regra «hora do servidor», não as tabelas.

**Riscos:** o maior é jurídico (acima); manipulação (por isso hora do servidor, rasto permanente e auditoria), quiosque partilhado (PIN fraco → bloqueio por tentativas, como o login), fusos/horário de verão (guardar UTC e converter para a hora de Lisboa).

---

## 8. Módulo «Gestão de férias» (`leave`)

> **Valores legais.** As fontes consultadas (guias de contratação e de software, sem texto legal) indicam **22 dias úteis** por ano, acumulação de **2 dias por mês no primeiro ano (até 20)**, gozo em pelo menos um bloco consecutivo, época por omissão entre 1 de maio e 31 de outubro, e **discordam** sobre o prazo para gozar férias não usadas (até 30 de abril vs. caducam a 1 de janeiro) e sobre feriados que calham ao fim de semana. Por isso **nada fica fixo em código**: tudo é **política configurável** com valores por omissão a rever contra o Código do Trabalho e o teu contrato coletivo.

**Âmbito (v1):**
- **Tipos de ausência** configuráveis (férias, falta justificada, doença, formação, outro), cada um com «conta como dia útil?», «precisa de aprovação?» e «desconta do saldo?».
- **Direito anual por colaborador** (política por omissão + exceções por pessoa/contrato coletivo), **saldo como livro de movimentos** (acumulação, gozo, ajuste, transporte), tal como o stock: nunca se edita um número, acrescenta-se um movimento.
- **Pedido → aprovação** pelo responsável direto (fluxo genérico da Fase 0c com portões: respeita o mínimo de pessoas presentes na equipa), com **notificação** (§3.3), cancelamento e meio-dia.
- **Cálculo de dias úteis** excluindo fins de semana e **feriados** (nacionais, **municipais por local de trabalho** e personalizados; regra de transferência configurável).
- **Calendário de equipa** (quem está ausente, conflitos, limite de ausências em simultâneo) e **mapa de férias anual** exportável.
- **Integração:** ausências aprovadas aparecem na **agenda** (fonte §3.5), avisam ao atribuir **assistências/visitas** a quem está ausente, e alimentam o **ponto**.

**Fora da v1:** processamento de salários, subsídios, baixas médicas (só registo de ausência), integração com software de salários (fica para uma extensão se for preciso).

**Dados:** `leave_type`, `leave_policy`, `leave_entitlement`, `leave_ledger_entry`, `leave_request`, `leave_holiday` (com âmbito local).

**Permissões (âmbito §3.2):** colaborador vê/pede o **seu**; responsável aprova e vê a **equipa**; Administrador/Backoffice configura políticas e feriados; motivos de doença são **dados sensíveis** (restritos, só o necessário visível ao responsável: «ausente», não o motivo).

**Depende de:** núcleo + 3.2, 3.3, 3.4, 3.8; fluxos genéricos (0c). **Melhora com:** agenda (Fase 2), ponto, assistências.

**Riscos:** regras legais mal modeladas (mitigação: política configurável + revisão por jurista/contabilista), dados de saúde (RGPD: minimização), feriados municipais em falta (calendário editável, não fixo).

---

## 9. Módulo «Mapas e rotas» (`maps`)

**Âmbito (v1):**
- **Geocodificação** das moradas de empresas, contactos e leads: guarda `latitude`, `longitude`, **precisão**, **origem** e data; fila em segundo plano com **limite de ritmo**; correção manual arrastando o marcador.
- **Vista de mapa** com filtros (empresas por estado/responsável, leads, assistências em aberto), agrupamento de marcadores e «perto de mim».
- **Rota do dia** de um técnico/comercial: pega nas **visitas da agenda** desse dia, ordena as paragens, mostra distância e duração e **abre na navegação externa** (ligação Google Maps/Waze, sem custo nem chave).
- **Zonas** (mais tarde): atribuir responsável por zona geográfica.

**Fornecedores (`GeocodingProvider`, `RoutingProvider`, `TileProvider`):** aqui está a decisão importante (M4). As fontes consultadas dizem que:
- os **mosaicos do openstreetmap.org** não devem usar-se em produção (só testes muito limitados): é preciso um fornecedor terceiro ou **mosaicos próprios**;
- o **Nominatim público** tem política de uso que o limita (o servidor público não é para uso intensivo; o auto-alojado não tem essa limitação);
- o servidor de demonstração do **OSRM** é «melhor esforço, sem garantias, pode ser retirado a qualquer momento».

Opções, da mais barata à mais robusta: **(a)** público, só para testes e volumes mínimos; **(b)** **auto-alojado** (Nominatim + OSRM/Valhalla + mosaicos, sobre um extrato de Portugal) — sem custos por pedido, **os endereços dos clientes não saem da tua rede**, mas é mais um serviço para operar; **(c)** fornecedor comercial (custo por utilização, chave de API). **Privacidade:** a geocodificação envia moradas de clientes ao fornecedor; para empresários em nome individual isto são dados pessoais, o que favorece (b). Recomendo desenhar já os contratos e começar com **(a) em desenvolvimento e (b) em produção**, validando o consumo de recursos do auto-alojamento antes de decidir (não tenho números fiáveis nas fontes).

**Frontend:** biblioteca de mapas open-source (Leaflet ou MapLibre GL), **só** carregada na página do módulo.

**Dados:** colunas de coordenadas nas moradas existentes **ou** tabela `maps_location` (entidade, id, lat, lng, precisão, origem, data) — **prefiro a tabela** para o módulo não alterar as tabelas do núcleo nem deixar de «desaparecer» quando desligado.

**Depende de:** núcleo. **Melhora com:** agenda e **assistências** (visitas), leads, férias (não planear rota a quem está ausente).

**Riscos:** custos/limites do fornecedor, qualidade das moradas portuguesas (geocodificação falha ou é imprecisa → mostrar a precisão e permitir correção), mosaicos exigem internet no navegador (o CRM é de rede local), consumo de recursos se auto-alojado.

---

## 10. Ordem e dependências

```
0a (feito) → 0a-bis (manifesto+jobs) → 0b → 0c → 0d (+âmbitos) ─┐
E0 (API pública, cifra, auditoria) ───────────────────────────┤
P  (notificações, tempo real dirigido, ciclo de vida) ─────────┤
                                                                ▼
 RH:        leave ⇄ timeclock      (partilham feriados, hierarquia, aprovações)
 Fase 2:    WorkItem/agenda/menu  → maps (rota do dia), service-desk
 Fase 4:    assistências         → maps (visitas), service-desk (conversão)
 chat:      só precisa de P
```

Recomendação de ordem entre os cinco (a rever, decisão M2): **1.º férias + ponto** juntos (partilham a hierarquia, os feriados e as aprovações, e são o que mais testa as peças novas de permissões por âmbito e privacidade), **2.º chat** (só precisa das peças P e é independente), **3.º mapas** (depois da agenda e das assistências, que lhe dão as visitas), **4.º atendimento** (depois dos itens de trabalho, e idealmente depois das assistências, para a conversão). Se a prioridade for outra, as peças de plataforma servem igual: o que muda é só a ordem dos módulos.

---

## 11. Decisões

**Respondidas pelo utilizador (2026-11-11):** M1 caixa multicanal de clientes (leitura 1) · M2 férias + ponto → chat → mapas → atendimento · M3 ponto pessoal + quiosque opcional, **sem biometria e sem localização** (a posição opcional fica fora até haver validação jurídica) · M4 mapas público em desenvolvimento e **auto-alojado em produção**. **Por responder:** M5 (chat: administrador não lê mensagens privadas e construir o mínimo — assumido), M6 (`managerId` + âmbitos — assumido), M7 (outros módulos).

| # | Decisão | A minha recomendação |
|---|---|---|
| M1 | **«Atendimento»**: (1) caixa multicanal de pedidos de clientes, ou (2) atendimento presencial no balcão? | (1); a (2) fica como módulo pequeno à parte, se também a quiseres |
| M2 | **Ordem** dos cinco módulos | Férias + ponto → chat → mapas → atendimento |
| M3 | **Ponto:** registo só pessoal, ou também **quiosque** partilhado com PIN? **Geolocalização/biometria:** nenhuma, ou uma posição opcional no registo? | Pessoal + quiosque opcional; **sem biometria**; posição opcional desligada por omissão (validar juridicamente) |
| M4 | **Mapas:** público (só testes), **auto-alojado** ou comercial? | Contratos agora; público em desenvolvimento, auto-alojado em produção |
| M5 | **Chat:** o Administrador pode ler mensagens privadas? **Construir** o mínimo ou integrar Mattermost? | Não lê por omissão; construir o mínimo (o Mattermost seria extensão da forma A) |
| M6 | **Responsável direto** em `User` e âmbitos «equipa» (em vez de papéis novos como «RH») | Sim: `managerId` + âmbitos + sinalizadores de capacidade |
| M7 | **Outros módulos** que já tens em mente («etc.») | Diz-me quais; passam pela mesma lista de verificação (§4) |

---

## 12. Riscos transversais

| Risco | Porque importa | Mitigação |
|---|---|---|
| **Dados pessoais de colaboradores** | Ponto, férias e chat têm obrigações diferentes dos dados de clientes (conservação, acesso do titular, minimização) | §3.8; auditoria; privacidade acima do papel; validação jurídica antes de produção |
| **«Desligar não apaga» vs conservação** | Dados que **têm** de ser conservados (ponto) ou **têm** de ser apagados (chat antigo) | Política de conservação por módulo, separada do interruptor |
| **Âmbitos mal aplicados** | Um colaborador ver o ponto/férias de outro | Âmbito aplicado na própria consulta, testes e2e com 3 utilizadores, prova por mutação |
| **Acoplamento entre módulos** | Cinco módulos a conhecerem-se tornam o interruptor inútil | Só eventos e contratos; teste que proíbe imports entre módulos |
| **Crescimento do pacote da interface** | Mais módulos, mais peso | *Code-splitting* por módulo |
| **Âmbito** | Cinco módulos são cinco produtos | Cada um com v1 pequena e «fora da v1» explícito; um de cada vez, com PR próprio |
| **Regras legais e de fornecedores** | Valores de férias, ponto e termos de mapas mudam | Política configurável; confirmar com jurista/contabilista; documentar a fonte |
| **Fornecedores de mapas** | Limites de uso e privacidade das moradas | Contratos de fornecedor; auto-alojado em produção |

---

## 13. Fontes consultadas

- **Ponto/privacidade (PT):** [CNPD — deliberação sobre biometria em acessos e assiduidade (2004)](https://www.uc.pt/site/assets/files/475840/20040226_deliberacao_cnpd_dados_biometricos_acessos_assiduidade.pdf), [CNPD — deliberação 1638/2013, controlo da utilização de tecnologias no trabalho](https://www.uc.pt/site/assets/files/475840/20130716_deliberacao_1638_2013_cnpd_controlo_utilizacao_tec_inf_contexto_laboral.pdf), [Legiscope — controlo à distância em teletrabalho](https://www.legiscope.com/blog/teletrabalho-controlo-distancia-portugal.html), [Legiscope — geolocalização de viaturas](https://www.legiscope.com/blog/geolocalizacao-viaturas-trabalho-portugal.html), [Legiscope — biometria, assiduidade e acessos](https://www.legiscope.com/blog/biometria-assiduidade-acessos-portugal.html), [HR Portugal — vigilância biométrica no trabalho](https://hrportugal.sapo.pt/direito-ao-essencial-vigilancia-biometrica-no-trabalho-o-reconhecimento-facial-e-a-recolha-das-impressoes-digitais-do-trabalhador-sao-legalmente-admissiveis/), [Cegid — registo de tempos de trabalho](https://www.cegid.com/ib/pt/blog/registo-tempos-trabalho/).
- **Férias (PT):** [Vacation Tracker — leis de férias em Portugal](https://vacationtracker.io/leave-laws/portugal), [Rivermate](https://www.rivermate.com/guides/portugal/leave), [Boundless](https://boundlesshq.com/guides/portugal/leave/), [ePortugal — Trabalhar em Portugal](https://eportugal.gov.pt/en/cidadaos-europeus-viajar-viver-e-fazer-negocios-em-portugal/trabalho-e-reforma-em-portugal/trabalhar-em-portugal).
- **Mapas:** [Nominatim — política de utilização](https://operations.osmfoundation.org/policies/nominatim/), [OSM — Developer FAQ (uso de mosaicos)](https://wiki.openstreetmap.org/wiki/Developer_FAQ), [OSM — política de mosaicos vetoriais](https://operations.osmfoundation.org/policies/vector/), [OSRM — política de utilização da API](https://github.com/Project-OSRM/osrm-backend/wiki/API%20Usage%20Policy), [OpenCage — alternativa a auto-alojar Nominatim](https://opencagedata.com/alternatives/self-hosting-nominatim).
- **Chat:** [CometChat — melhores servidores de chat auto-alojados 2026](https://www.cometchat.com/blog/best-self-hosted-chat-servers-in-2026), [Pumble — Mattermost vs Rocket.Chat](https://pumble.com/blog/mattermost-vs-rocketchat/), [WZ-IT — Matrix vs Mattermost vs Rocket.Chat](https://wz-it.com/en/blog/slack-alternative-matrix-mattermost-rocketchat-comparison/).

> **Notas sobre as fontes:** são blogs, guias de fornecedores e artigos de divulgação, **não** legislação nem documentação oficial dos produtos. **Os valores e regras de férias e ponto têm de ser validados contra o Código do Trabalho e o teu contrato coletivo**; as fontes **discordam** em pontos concretos (prazo de caducidade das férias, feriados ao fim de semana). A pesquisa sobre chat **não** cobriu escalabilidade de *websockets* nem a ligação a CRMs (o desenho do §5 é meu, assente no que já usamos: Socket.io e Postgres). A pesquisa sobre mapas **não** deu números de recursos do auto-alojamento nem confirmou limites numéricos do Nominatim público; o serviço de otimização de rotas do OSRM (`trip`) deve ser confirmado na documentação oficial antes de depender dele. A leitura (1) de «atendimento» é uma **suposição minha**, por confirmar (M1).
