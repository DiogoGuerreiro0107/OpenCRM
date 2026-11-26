// Extensão de exemplo (Fase E1.4): cada evento demora mais do que o limite dos testes.
exports.activate = (ctx) => {
  ctx.events.on("lead.created", () => new Promise((resolve) => setTimeout(resolve, 600)));
};
