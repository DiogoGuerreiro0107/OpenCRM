/**
 * Relógio monótono do processo: cada chamada devolve um instante estritamente posterior ao anterior (pelo menos 1 ms).
 *
 * Serve para as notas da timeline escritas em sequência na mesma ação (ex.: «Encomenda enviada» e depois «Saída de
 * stock: …»): com `@default(now())` caíam no mesmo milissegundo e o desempate pelo id (uuid) baralhava a ordem.
 */
let last = 0;

export function monotonicNow(): Date {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return new Date(last);
}
