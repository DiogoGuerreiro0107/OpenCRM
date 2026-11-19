import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { saveMenuSettings } from "@/lib/menu-settings-api";
import { errorMessage } from "@/lib/errors";
import { useMainMenuItems, useMenuSettings } from "@/modules/hooks";
import { editorRows, rowsToEntries, type EditorRow } from "@/modules/menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Id novo para um grupo (só tem de ser único na lista). */
const newGroupId = () => `group:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Configurações > Menu (Fase 2c, decisão D5): o Administrador ordena, renomeia, oculta e agrupa os itens do menu
 * principal de todos. As configurações não entram (são fixas). Ocultar não tira o acesso à página.
 */
export function MenuSettingsPage() {
  const queryClient = useQueryClient();
  const items = useMainMenuItems();
  const settings = useMenuSettings();
  const known = useMemo(() => items.map((i) => ({ id: i.id, label: i.label })), [items]);
  const [rows, setRows] = useState<EditorRow[] | null>(null);
  const [saved, setSaved] = useState(false);

  // A lista começa nas preferências gravadas; depois é a que se está a editar (não se refaz a meio da edição).
  useEffect(() => {
    if (rows === null && settings.data) setRows(editorRows(known, settings.data.entries));
  }, [rows, settings.data, known]);

  const save = useMutation({
    mutationFn: (entries: Parameters<typeof saveMenuSettings>[0]) => saveMenuSettings(entries),
    onSuccess: (data) => {
      queryClient.setQueryData(["menu-settings"], data);
      setRows(editorRows(known, data.entries));
      setSaved(true);
    },
  });

  const edit = (next: EditorRow[]) => {
    setRows(next);
    setSaved(false);
  };
  const update = (index: number, patch: Partial<EditorRow>) => edit(rows!.map((r, i) => (i === index ? ({ ...r, ...patch } as EditorRow) : r)));
  const move = (index: number, delta: number) => {
    const next = [...rows!];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    edit(next);
  };

  if (!rows) return <p className="text-muted-foreground">A carregar...</p>;
  const groupsInvalid = rows.some((r) => r.type === "group" && !r.label.trim());

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Menu</h1>
        <p className="text-sm text-muted-foreground">
          Ordem, nomes e grupos do menu principal, para todos os utilizadores. Cada pessoa vê só os itens dos módulos ativos e com permissão.
          Ocultar tira o item do menu, mas a página continua acessível a quem tem permissão.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <ul className="divide-y divide-border">
          {rows.map((row, index) => (
            <li key={row.id} className={cn("flex items-center gap-2 px-3 py-2", row.type === "group" && "bg-muted/40")}>
              <div className="flex gap-1">
                <button type="button" aria-label={`Subir ${row.type === "group" ? row.label || "grupo" : row.defaultLabel}`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-1 hover:bg-muted disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Descer ${row.type === "group" ? row.label || "grupo" : row.defaultLabel}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="rounded p-1 hover:bg-muted disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
              {row.type === "group" ? (
                <>
                  <span className="w-28 text-xs font-semibold uppercase text-muted-foreground">Grupo</span>
                  <Input aria-label="Nome do grupo" value={row.label} maxLength={60} placeholder="Nome do grupo" onChange={(e) => update(index, { label: e.target.value })} className="flex-1" />
                  <Button type="button" variant="outline" size="sm" aria-label={`Apagar o grupo ${row.label}`} onClick={() => edit(rows.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className={cn("w-28 truncate text-sm", (!row.available || row.hidden) && "text-muted-foreground line-through")} title={row.defaultLabel}>
                    {row.defaultLabel}
                  </span>
                  <Input aria-label={`Nome de ${row.defaultLabel}`} value={row.label} maxLength={60} placeholder={row.defaultLabel} onChange={(e) => update(index, { label: e.target.value })} className="flex-1" disabled={!row.available} />
                  {row.available ? (
                    <label className="flex items-center gap-1 text-sm">
                      <input type="checkbox" checked={row.hidden} onChange={(e) => update(index, { hidden: e.target.checked })} />
                      Ocultar
                    </label>
                  ) : (
                    <Badge title="Módulo desligado ou tipo que já não aparece no menu: a posição guarda-se para quando voltar.">Indisponível</Badge>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar o menu.")}</p>}
      {saved && <p className="text-sm text-green-700">Menu guardado.</p>}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => edit([{ type: "group", id: newGroupId(), label: "" }, ...rows])}>
            + Grupo
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              if (confirm("Repor o menu por omissão? Perdem-se a ordem, os nomes, os grupos e os itens ocultos.")) save.mutate([]);
            }}
          >
            Repor menu por omissão
          </Button>
        </div>
        <Button type="button" disabled={save.isPending || groupsInvalid} onClick={() => save.mutate(rowsToEntries(rows))}>
          {save.isPending ? "A guardar..." : "Guardar"}
        </Button>
      </div>
      {groupsInvalid && <p className="text-xs text-muted-foreground">Dá um nome a cada grupo antes de guardar.</p>}
      <p className="text-xs text-muted-foreground">
        Um grupo junta os itens que estão por baixo dele, até ao grupo seguinte. Itens novos (de um módulo ligado ou de um tipo de tarefa com «aparece no
        menu») entram no fim.
      </p>
    </div>
  );
}
