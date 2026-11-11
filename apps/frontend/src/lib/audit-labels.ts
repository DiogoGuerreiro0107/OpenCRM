/** Texto em português para cada ação do registo. Uma ação desconhecida mostra-se com o identificador. */
const ACTION_LABELS: Record<string, string> = {
  "user.created": "Utilizador criado",
  "user.updated": "Utilizador alterado",
  "user.password_set_by_admin": "Password definida pelo Administrador",
  "auth.password_changed": "Password alterada pelo próprio",
  "auth.password_reset_requested": "Recuperação de password pedida",
  "auth.password_reset": "Password redefinida por recuperação",
  "module.toggled": "Módulo ligado/desligado",
  "zadarma.account_saved": "Conta Zadarma guardada",
  "custom_field.created": "Campo personalizado criado",
  "custom_field.updated": "Campo personalizado alterado",
  "custom_field.deleted": "Campo personalizado eliminado",
  "pipeline.created": "Funil criado",
  "pipeline.updated": "Funil alterado",
  "pipeline.deleted": "Funil eliminado",
  "pipeline.stage_added": "Fase adicionada",
  "pipeline.stages_reordered": "Fases reordenadas",
  "pipeline.stage_updated": "Fase alterada",
  "pipeline.stage_deleted": "Fase eliminada",
  "automation.created": "Automação criada",
  "automation.updated": "Automação alterada",
  "automation.deleted": "Automação eliminada",
  "secrets.encrypted": "Segredos cifrados (comando do sistema)",
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

/** Grupos para o filtro (prefixo da ação). */
export const ACTION_GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: "user.", label: "Utilizadores" },
  { prefix: "auth.", label: "Passwords e acesso" },
  { prefix: "module.", label: "Módulos" },
  { prefix: "zadarma.", label: "Telefonia (Zadarma)" },
  { prefix: "pipeline.", label: "Funis" },
  { prefix: "custom_field.", label: "Campos personalizados" },
  { prefix: "automation.", label: "Automações" },
  { prefix: "secrets.", label: "Segredos (sistema)" },
];
