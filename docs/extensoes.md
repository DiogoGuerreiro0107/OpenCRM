# Extensões instaladas (guia para quem as escreve)

Uma extensão instalada é **código da tua equipa** que corre **dentro do backend** do CRM, com acesso a tudo o que o
backend acede (dados, segredos, rede). É a «forma B» do [desenho de extensões](plano-extensoes-e-api.md) (§3 e §9).
Para código de terceiros, usa a **API pública** e os **webhooks** a partir de um serviço à parte ([api-publica.md](api-publica.md)).

## Instalar

1. Põe a pasta da extensão em `extensions/<id>/` no servidor (no Docker, `./extensions`, montada só de leitura). O
   nome da pasta é o `id` da extensão.
2. Em **Configurações → Módulos e extensões → Extensões instaladas**, carrega em **Procurar de novo**.
3. Confere o manifesto, as permissões declaradas e a **impressão digital** (SHA-256 de todos os ficheiros) e
   **aprova**. A aprovação é dessa impressão digital: se um ficheiro mudar, a extensão deixa de carregar até ser
   aprovada de novo.
4. **Liga-a.** Se tiver definições, preenche-as em **Definições** (os segredos ficam cifrados e nunca se mostram).

Tudo fica na auditoria. Uma pasta que desaparece fica «em falta»; os dados (definições e estado) ficam.

## A pasta

```
extensions/
  ola-mundo/
    extension.json
    index.js
```

### `extension.json`

```json
{
  "id": "ola-mundo",
  "name": "Olá mundo",
  "description": "Conta as leads criadas.",
  "version": "1.0.0",
  "sdk": "^1.0.0",
  "origin": "installed",
  "dependsOn": { "leads": "^1.0.0" },
  "provides": [],
  "permissions": ["secrets:own"],
  "defaultEnabled": false,
  "settings": [
    { "key": "saudacao", "label": "Saudação", "type": "text", "default": "Olá" },
    { "key": "token", "label": "Token", "type": "secret" }
  ],
  "server": "index.js"
}
```

- `id`: minúsculas, dígitos e hífens; não pode ser o de um módulo do CRM.
- `sdk`: o intervalo de versões do contrato que a extensão aceita (o CRM está na **1.0.0**).
- `dependsOn`: módulos do CRM (ou outras extensões) e o intervalo de versões; têm de estar ligados.
- `permissions`: o que a extensão **declara** precisar (o Administrador vê-o antes de aprovar). Vocabulário:
  `data:<área>:write`, `net:egress:<domínio>`, `net:egress:configured`, `secrets:own`, `webhooks:emit`,
  `jobs:schedule`. Um campo `secret` nas definições exige `secrets:own`. **Não são uma barreira**: o código corre
  com acesso total.
- `settings`: campos `text`, `secret`, `select` (com `options`) e `boolean`; o CRM gera o formulário.
- `server`: o ficheiro JavaScript (CommonJS), dentro da pasta. Sem ele, a extensão só tem definições.
- Limites: até 2000 ficheiros e 20 MB, sem ligações simbólicas. Empacota as dependências (ex.: com `esbuild`).

### O código

```js
module.exports = {
  async activate(ctx) {
    const { saudacao, token } = await ctx.settings.get();
    ctx.events.on("lead.created", async (event) => {
      const state = await ctx.state.get();
      await ctx.state.set({ leads: (state.leads || 0) + 1, ultimaLead: event.data.name });
    });
    ctx.log.info(`${saudacao}!`);
    return {
      async deactivate() {
        /* fechar ligações, temporizadores... */
      },
    };
  },
};
```

O contexto (tipos em `apps/backend/src/extensions/sdk.ts`):

| | |
|---|---|
| `ctx.id`, `ctx.version` | o id e a versão da extensão |
| `ctx.settings.get()` | as definições, com os valores por omissão e os segredos decifrados |
| `ctx.state.get()`, `ctx.state.set(patch)` | estado interno (JSON pequeno; `set` junta ao que existe) |
| `ctx.events.on(tipo, handler)` | os eventos do [catálogo dos webhooks](api-publica.md) (ou `"*"`), com o mesmo envelope: `{ id, type, version, occurred_at, data }` |
| `ctx.log.info/warn/error` | o registo do backend, com o nome da extensão |

## Regras de funcionamento

- `activate` e `deactivate` têm **10 s**; cada evento também. Um evento entregue a uma extensão nunca atrasa nem faz
  falhar a operação que o originou.
- **Disjuntor:** 5 falhas seguidas nos eventos desligam a extensão, com aviso a todos os Administradores e registo na
  auditoria. Volta a ligar-se à mão.
- Ao **arrancar**, o CRM procura a pasta e volta a ligar as extensões que estavam ligadas (se a impressão digital
  ainda for a aprovada; senão fica desligada, com aviso).
- O backend corre numa só instância: o código carregado fica em memória.
- Ainda não há tarefas agendadas, tabelas próprias nem migrações para extensões instaladas (entram quando a primeira
  precisar), nem instalação pela interface com pacotes assinados.
