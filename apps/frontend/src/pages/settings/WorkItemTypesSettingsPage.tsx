import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { WorkItemType } from "@opencrm/shared-types";
import {
  createWorkItemType,
  deleteWorkItemType,
  listWorkItemTypes,
  reorderWorkItemTypes,
  updateWorkItemType,
} from "@/lib/work-item-types-api";
import { errorMessage } from "@/lib/errors";
import { WORK_ITEM_COLORS, WORK_ITEM_ICONS, WorkItemTypeBadge } from "@/components/WorkItemTypeBadge";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WorkItemStepsSection } from "./WorkItemStepsSection";

/**
 * Configurações > Tipos de tarefa (Fase 2a, docs/plano-fase-2-itens-de-trabalho.md). Só o Administrador.
 * Os tipos do sistema renomeiam-se e desativam-se, mas não se apagam; um tipo com tarefas desativa-se.
 */
export function WorkItemTypesSettingsPage() {
  const queryClient = useQueryClient();
  // Guarda-se o id (não uma cópia do tipo): o diálogo mostra sempre o tipo atual (p. ex. depois de lhe dar passos).
  const [editing, setEditing] = useState<{ typeId: string | null } | null>(null);
  const { data: types = [], isLoading } = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes() });

  const reorder = useMutation({
    mutationFn: reorderWorkItemTypes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-item-types"] }),
  });
  const move = (index: number, delta: number) => {
    const ids = types.map((t) => t.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tipos de tarefa</h1>
          <p className="text-sm text-muted-foreground">Os tipos aparecem no formulário da tarefa, nos filtros e no calendário, pela ordem desta lista.</p>
        </div>
        <Button onClick={() => setEditing({ typeId: null })}>Novo tipo</Button>
      </div>
      {reorder.isError && <p className="text-sm text-red-600">{errorMessage(reorder.error, "Não foi possível reordenar.")}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="w-20 px-4 py-2 font-medium">Ordem</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Código</th>
              <th className="px-4 py-2 font-medium">Tarefas</th>
              <th className="px-4 py-2 font-medium">Passos</th>
              <th className="px-4 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {types.map((type, index) => (
              <tr key={type.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <button type="button" aria-label={`Subir ${type.name}`} disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)} className="rounded p-1 hover:bg-muted disabled:opacity-30">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Descer ${type.name}`} disabled={index === types.length - 1 || reorder.isPending} onClick={() => move(index, 1)} className="rounded p-1 hover:bg-muted disabled:opacity-30">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <button type="button" className="text-left" onClick={() => setEditing({ typeId: type.id })}>
                    <WorkItemTypeBadge type={type} className={cn(!type.active && "opacity-50")} />
                  </button>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{type.id}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  <Link className="hover:underline" to={`/tarefas/tipo/${encodeURIComponent(type.id)}`}>
                    {type.itemCount}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{type.steps.length > 0 ? type.steps.map((s) => s.name).join(" → ") : "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {!type.active && <Badge>Desativado</Badge>}
                    {type.isDefault && <Badge>Por omissão</Badge>}
                    {type.isSystem && <Badge>Sistema</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <WorkItemTypeDialog type={editing.typeId ? (types.find((t) => t.id === editing.typeId) ?? null) : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WorkItemTypeDialog({ type, onClose }: { type: WorkItemType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", icon: "check-square", color: "blue", active: true });
  useEffect(() => {
    setForm({ name: type?.name ?? "", icon: type?.icon ?? "check-square", color: type?.color ?? "blue", active: type?.active ?? true });
    // Só ao abrir outro tipo: a lista refaz-se em tempo real e não deve apagar o que se está a escrever.
  }, [type?.id]);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["work-item-types"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      type
        ? updateWorkItemType(type.id, { name: form.name, icon: form.icon, color: form.color, active: form.active })
        : createWorkItemType({ name: form.name, icon: form.icon, color: form.color }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => deleteWorkItemType(type!.id), onSuccess: done });
  const canDelete = type && !type.isSystem && type.itemCount === 0;

  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{type ? `Editar «${type.name}»` : "Novo tipo de tarefa"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="type-name">Nome *</Label>
          <Input id="type-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {type && <p className="text-xs text-muted-foreground">Código: {type.id} (não muda ao renomear).</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Ícone</legend>
          <div className="grid grid-cols-10 gap-1">
            {Object.entries(WORK_ITEM_ICONS).map(([name, Icon]) => (
              <button
                key={name}
                type="button"
                aria-label={`Ícone ${name}`}
                aria-pressed={form.icon === name}
                onClick={() => setForm({ ...form, icon: name })}
                className={cn("flex h-8 items-center justify-center rounded border", form.icon === name ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Cor</legend>
          <div className="flex flex-wrap gap-2">
            {Object.entries(WORK_ITEM_COLORS).map(([name, color]) => (
              <button
                key={name}
                type="button"
                aria-label={`Cor ${color.label}`}
                aria-pressed={form.color === name}
                title={color.label}
                onClick={() => setForm({ ...form, color: name })}
                className={cn("h-7 w-7 rounded-full border-2", color.dot, form.color === name ? "border-foreground" : "border-transparent")}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Pré-visualização:</span>
          <WorkItemTypeBadge type={{ id: type?.id ?? "", name: form.name || "Novo tipo", icon: form.icon, color: form.color }} />
        </div>

        {type && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} disabled={type.isDefault} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Ativo (aparece ao criar tarefas)
            {type.isDefault && <span className="text-xs text-muted-foreground">— o tipo por omissão está sempre ativo</span>}
          </label>
        )}
        {type && !canDelete && (
          <p className="text-xs text-muted-foreground">
            {type.isSystem ? "Tipo do sistema: pode ser desativado, mas não apagado." : `Tem ${type.itemCount} tarefa(s): desativa-o em vez de o apagar.`}
          </p>
        )}

        {(save.isError || remove.isError) && (
          <p className="text-sm text-red-600">{errorMessage(save.error ?? remove.error, "Não foi possível guardar.")}</p>
        )}

        <div className="flex justify-between gap-2">
          <div>
            {canDelete && (
              <Button type="button" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Apagar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? "A guardar..." : "Guardar"}
            </Button>
          </div>
        </div>
      </form>
      {/* Fora do <form> (os passos gravam-se cada um por si; formulários aninhados não são válidos). */}
      {type && (
        <div className="mt-4 max-h-[45vh] overflow-y-auto pr-1">
          <WorkItemStepsSection type={type} />
        </div>
      )}
    </Dialog>
  );
}
