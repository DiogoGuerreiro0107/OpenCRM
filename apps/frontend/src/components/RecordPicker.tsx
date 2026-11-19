import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/pagination";

/**
 * Seletor de um registo com pesquisa (docs/plano-seletores-com-pesquisa.md): caixa de texto que abre uma lista de
 * resultados enquanto se escreve. Substitui os <select> com a lista inteira de empresas, contactos ou utilizadores.
 * Acessível (combobox + listbox) e utilizável só com o teclado (setas, Enter, Escape).
 */
export interface RecordPickerProps<T> {
  id?: string;
  /** Id escolhido; "" = nenhum. */
  value: string;
  onChange: (id: string, item: T | null) => void;
  /** Procura registos (no servidor ou numa lista local). Recebe "" ao abrir sem texto. */
  search: (term: string) => Promise<T[]>;
  /** Chave da cache das pesquisas (o termo é acrescentado). */
  queryKey: readonly unknown[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  /** Pormenor que ajuda a distinguir registos com o mesmo nome (NIF, empresa, email…). */
  getDetail?: (item: T) => string | null | undefined;
  /** Nome do registo escolhido, se quem usa já o souber (evita um pedido). */
  selectedLabel?: string | null;
  /** Vai buscar o registo escolhido quando o nome não é conhecido (ex.: abrir um registo para editar). */
  resolve?: (id: string) => Promise<T>;
  /** O que significa «nenhum» neste sítio: «Nenhuma», «Eu», «Todos os responsáveis»… */
  emptyLabel: string;
  /** Sem esta opção, não se pode deixar vazio depois de escolher (o «nenhum» não aparece na lista). */
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
  /** Quantos resultados a pesquisa devolve no máximo (para a dica «escreve para afinar»). */
  pageSize?: number;
}

const LIST_MAX_HEIGHT = 256;

export function RecordPicker<T>({
  id,
  value,
  onChange,
  search,
  queryKey,
  getId,
  getLabel,
  getDetail,
  selectedLabel,
  resolve,
  emptyLabel,
  allowEmpty = true,
  placeholder = "Pesquisar...",
  disabled,
  className,
  pageSize = 20,
  ...aria
}: RecordPickerProps<T>) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  // Nome do último registo escolhido aqui (vale enquanto o valor não mudar por fora).
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const debouncedTerm = useDebounced(term.trim(), 250);
  // A lista fica em posição FIXA no ecrã: dentro de um diálogo com scroll, uma lista «absolute» ficava cortada.
  const [position, setPosition] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const up = below < LIST_MAX_HEIGHT + 8 && rect.top > below; // sem espaço em baixo: abre para cima
      setPosition({
        position: "fixed",
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(120, Math.min(LIST_MAX_HEIGHT, (up ? rect.top : below) - 8)),
        ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    // acompanha o scroll de qualquer contentor (captura) e o redimensionar da janela
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const results = useQuery({
    queryKey: [...queryKey, "picker", debouncedTerm],
    queryFn: () => search(debouncedTerm),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const knownLabel = picked?.id === value ? picked.label : selectedLabel;
  const resolved = useQuery({
    queryKey: [...queryKey, "picker-resolve", value],
    queryFn: () => resolve!(value),
    enabled: !!value && !knownLabel && !!resolve,
    staleTime: 60_000,
  });
  const label = value ? (knownLabel ?? (resolved.data ? getLabel(resolved.data) : resolved.isLoading ? "A carregar..." : "")) : "";

  const items = results.data ?? [];
  // A primeira opção é o «nenhum» (se permitido); depois os resultados.
  const options: Array<{ key: string; item: T | null }> = [
    ...(allowEmpty ? [{ key: "", item: null }] : []),
    ...items.map((item) => ({ key: getId(item), item })),
  ];

  // Destaque ao abrir e quando chegam resultados: com texto escrito, o primeiro resultado (Enter escolhe-o);
  // sem texto, o registo já escolhido.
  useEffect(() => {
    if (!open) return;
    const firstResult = allowEmpty && options.length > 1 ? 1 : 0;
    setActive(debouncedTerm ? firstResult : Math.max(0, options.findIndex((o) => o.key === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results.data]);

  function choose(option: { key: string; item: T | null }) {
    if (option.item) setPicked({ id: option.key, label: getLabel(option.item) });
    onChange(option.key, option.item);
    setOpen(false);
    setTerm("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + delta + options.length) % options.length : 0));
    } else if (e.key === "Enter") {
      if (open) {
        e.preventDefault(); // não submete o formulário
        // Resultados ainda da pesquisa anterior (o texto mudou há menos de 250 ms): não escolhe às cegas.
        const stale = term.trim() !== debouncedTerm || results.isPlaceholderData;
        if (!stale && options[active]) choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // fecha a lista, não o diálogo
        setOpen(false);
        setTerm("");
      }
    }
  }

  const activeId = open && options[active] ? `${listId}-${active}` : undefined;

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-label={aria["aria-label"]}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        disabled={disabled}
        value={open ? term : label}
        placeholder={open ? placeholder : emptyLabel}
        onChange={(e) => {
          setTerm(e.target.value);
          setActive(allowEmpty && e.target.value ? 1 : 0);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setTerm("");
        }}
        onKeyDown={onKeyDown}
        className="flex h-10 w-full rounded-md border border-border bg-background py-2 pl-3 pr-14 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-muted-foreground">
        {value && allowEmpty && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Limpar escolha"
            className="pointer-events-auto rounded p-0.5 hover:text-foreground"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setPicked(null);
              onChange("", null);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <ChevronDown className="h-4 w-4" />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          style={position ?? { display: "none" }}
          className="z-[60] overflow-y-auto rounded-md border border-border bg-background py-1 text-sm shadow-lg"
          // Clicar numa opção não pode tirar o foco à caixa antes de escolher.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((option, index) => {
            const detail = option.item && getDetail ? getDetail(option.item) : null;
            return (
              <li
                key={option.key || "(nenhum)"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.key === value}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={cn(
                  "cursor-pointer px-3 py-1.5",
                  index === active && "bg-muted",
                  option.key === value && "font-medium",
                  !option.item && "italic text-muted-foreground",
                )}
              >
                {option.item ? getLabel(option.item) : emptyLabel}
                {detail && <span className="ml-2 text-xs text-muted-foreground">{detail}</span>}
              </li>
            );
          })}
          {results.isFetching && items.length === 0 && <li className="px-3 py-1.5 text-muted-foreground">A pesquisar...</li>}
          {!results.isFetching && results.isSuccess && items.length === 0 && (
            <li className="px-3 py-1.5 text-muted-foreground">Sem resultados{debouncedTerm ? ` para «${debouncedTerm}»` : ""}.</li>
          )}
          {results.isError && <li className="px-3 py-1.5 text-red-600">Não foi possível pesquisar.</li>}
          {items.length >= pageSize && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">Mostra os primeiros {pageSize}; escreve para afinar.</li>
          )}
        </ul>
      )}
    </div>
  );
}
