import * as crypto from "crypto";

/**
 * Número de dígitos finais usados para comparar números de telefone com os
 * guardados em Contact/Company — evita falhar por diferenças de formatação
 * (indicativo do país, espaços, "+"), sem precisar de uma biblioteca de
 * normalização de números completa.
 */
export const PHONE_MATCH_DIGITS = 9;

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-PHONE_MATCH_DIGITS);
}

/**
 * Assinatura da API da Zadarma (HMAC), conforme a documentação pública:
 * https://zadarma.com/en/support/api/
 *   1. ordenar os parâmetros alfabeticamente e montar uma query string
 *   2. md5_params = md5(query string)
 *   3. assinatura = base64(hmac_sha1(caminho + query_string + md5_params, apiSecret))
 *   4. header Authorization: "{apiKey}:{assinatura}"
 *
 * NOTA: implementado a partir da documentação pública, sem uma conta real para
 * confirmar em produção. Os testes (zadarma.utils.spec.ts) fixam o comportamento
 * atual contra regressões, mas NÃO provam compatibilidade com a Zadarma.
 */
export function signZadarmaRequest(apiKey: string, apiSecret: string, path: string, params: Record<string, string>) {
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys.map((key) => `${key}=${encodeURIComponent(params[key])}`).join("&");
  const md5Params = crypto.createHash("md5").update(queryString).digest("hex");
  const stringToSign = `${path}${queryString}${md5Params}`;
  const signature = crypto.createHmac("sha1", apiSecret).update(stringToSign).digest("base64");
  return { queryString, authorization: `${apiKey}:${signature}` };
}
