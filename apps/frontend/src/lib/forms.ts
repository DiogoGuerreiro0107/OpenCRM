/** Campos que, ao editar, podem ser limpos: `null` apaga o valor no servidor (`undefined` deixa-o como estava). */
export type Clearable<T> = { [K in keyof T]?: T[K] | null };

/**
 * Texto vazio → `null`, para enviar um formulário de edição: um campo opcional apagado no ecrã fica apagado no
 * servidor (e um email vazio não falha a validação de email).
 */
export function blankToNull<T extends Record<string, unknown>>(values: T): { [K in keyof T]: T[K] extends string ? Exclude<T[K], ""> | null : T[K] } {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" ? null : value])) as never;
}
