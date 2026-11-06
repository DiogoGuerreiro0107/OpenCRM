import { isAxiosError } from "axios";

/**
 * Mensagem de um erro de pedido à API, para mostrar ao utilizador. O backend responde com `message`
 * (texto) ou, em erros de validação, uma lista de textos; sem resposta usa-se `fallback`.
 */
export function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message) return message;
    if (Array.isArray(message) && message.length > 0) return message.join(" ");
    if (!error.response) return "Não foi possível contactar o servidor.";
  }
  return fallback;
}
