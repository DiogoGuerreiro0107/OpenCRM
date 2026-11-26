// Extensão de exemplo (Fase E1.4): conta as leads criadas, guarda o nome da última e lê as definições.
module.exports = {
  async activate(ctx) {
    const { saudacao, token } = await ctx.settings.get();
    await ctx.state.set({ ativadaCom: saudacao, token: token ? "lido" : null });
    ctx.events.on("lead.created", async (event) => {
      const state = await ctx.state.get();
      await ctx.state.set({ leads: (state.leads || 0) + 1, ultimaLead: event.data.name, tipo: event.type });
    });
    ctx.log.info(`${saudacao}!`);
    return {
      async deactivate() {
        await ctx.state.set({ desligada: true });
      },
    };
  },
};
