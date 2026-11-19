/** Fuso horário IANA válido (o mesmo teste que o browser faz). O nome vai como parâmetro, nunca no texto do SQL. */
export function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return /^[A-Za-z0-9_+\-/]+$/.test(tz);
  } catch {
    return false;
  }
}

/** Dia (AAAA-MM-DD) de um instante num fuso. */
export function dayIn(date: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Erro do Postgres para um fuso que o Node conhece e ele não (tzdata diferente). */
export const isUnknownTimeZoneError = (err: unknown) => /time zone .* not recognized/i.test(String(err));
