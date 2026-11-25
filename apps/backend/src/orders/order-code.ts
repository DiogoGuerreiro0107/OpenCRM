/** Número interno da encomenda de cliente: «EN-0001» (sem valor fiscal). */
export const orderCode = (n: number) => `EN-${String(n).padStart(4, "0")}`;
