// Extensão de exemplo (Fase E1.4): cada evento falha, para o disjuntor a desligar.
exports.activate = (ctx) => {
  ctx.events.on("*", () => {
    throw new Error("rebentou");
  });
};
