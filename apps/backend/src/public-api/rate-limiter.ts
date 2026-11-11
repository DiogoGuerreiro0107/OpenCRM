/**
 * Limite de pedidos por chave: janela deslizante de 60 s, em memória (o backend corre numa só instância, como está
 * documentado; mais de uma exigiria um armazenamento partilhado). Perde-se ao reiniciar, o que só abranda abusos.
 * O relógio é injetável para os testes não dependerem de esperar.
 */
const WINDOW_MS = 60_000;

export interface RateDecision {
  allowed: boolean;
  /** Segundos até haver espaço (só quando recusado). */
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(id: string, limit: number): RateDecision {
    const now = this.now();
    const recent = (this.hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);

    if (recent.length >= limit) {
      this.hits.set(id, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
    }

    recent.push(now);
    this.hits.set(id, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Esquece chaves sem pedidos recentes (chamado de vez em quando, para a memória não crescer sem fim). */
  prune(): void {
    const now = this.now();
    for (const [id, times] of this.hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) this.hits.delete(id);
    }
  }
}
