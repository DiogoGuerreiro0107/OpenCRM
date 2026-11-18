/**
 * Normalização do termo pesquisado, igual à das colunas `searchText` (lower(unaccent(...)), mantidas por triggers —
 * migração 20261119100000_pesquisa_sem_acentos). Assim «joao» encontra «João» e «GRAFICA» encontra «Gráfica».
 * Um e2e (test/record-search.e2e-spec.ts) confirma que dá o mesmo que o Postgres para as letras latinas U+00C0–U+017F.
 */
const LETTERS: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ħ: "h", ı: "i", ĳ: "ij", ŀ: "l", ŉ: "'n", ŋ: "n", ſ: "s", ŧ: "t",
  // assim faz o unaccent do Postgres (kra groenlandês)
  ĸ: "q",
};
const SPECIAL = new RegExp(`[${Object.keys(LETTERS).join("")}]`, "g");

export function foldSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // marcas diacríticas (acentos, cedilha, til)
    .replace(SPECIAL, (c) => LETTERS[c]);
}
