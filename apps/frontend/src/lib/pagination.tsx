import { useEffect, useState } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import type { Page } from "@opencrm/shared-types";
import { Button } from "@/components/ui/button";

/**
 * Listagens paginadas por cursor (docs/plano-paginacao-listagens.md): nenhuma lista descarrega a tabela inteira.
 * O servidor devolve `{ items, nextCursor }`; aqui junta-se as páginas e mostra-se «Carregar mais».
 */
export interface PageParams {
  limit?: number;
  cursor?: string | null;
}

/** Junta as páginas de uma listagem. `fetchPage` recebe o cursor (null na primeira). */
export function usePagedList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    ...options,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, items };
}

/** Texto pesquisado, com atraso (não pede ao servidor a cada tecla). */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Rodapé de uma lista paginada: quantos estão à vista e o botão para a página seguinte. */
export function LoadMore({
  shown,
  hasMore,
  loading,
  onMore,
  noun = ["registo", "registos"],
  label = "Carregar mais",
}: {
  shown: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  /** Singular e plural do que se lista (ex.: ["empresa", "empresas"]). */
  noun?: [string, string];
  label?: string;
}) {
  if (shown === 0 && !hasMore) return null;
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-sm text-muted-foreground">
      <span>
        A mostrar {shown} {shown === 1 ? noun[0] : noun[1]}
        {hasMore ? " (há mais)" : ""}
      </span>
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onMore} disabled={loading}>
          {loading ? "A carregar..." : label}
        </Button>
      )}
    </div>
  );
}
