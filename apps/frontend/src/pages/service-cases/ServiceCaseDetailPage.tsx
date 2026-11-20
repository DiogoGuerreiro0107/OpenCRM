import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServiceCase, ServiceWarranty } from "@opencrm/shared-types";
import { getServiceCase, updateServiceCase, WARRANTY_LABELS, WARRANTY_OPTIONS } from "@/lib/service-cases-api";
import { getTask } from "@/lib/tasks-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { TimelineSection } from "@/components/TimelineSection";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TaskDialog } from "@/pages/tasks/TaskDialog";

function formOf(sc: ServiceCase | null) {
  return {
    brand: sc?.brand ?? "",
    model: sc?.model ?? "",
    serialNumber: sc?.serialNumber ?? "",
    underWarranty: (sc?.underWarranty ?? "UNKNOWN") as ServiceWarranty,
    reportedProblem: sc?.reportedProblem ?? "",
    diagnosis: sc?.diagnosis ?? "",
    resolution: sc?.resolution ?? "",
  };
}

/**
 * Ficha da assistência (Fase 4a): cabeçalho (número, cliente, passo, responsável), equipamento, problema, diagnóstico e
 * resolução, campos personalizados do tipo e timeline. A tarefa (passo, responsável, prazo) edita-se no diálogo da tarefa.
 */
export function ServiceCaseDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("dailyWork");
  const { data: sc, isLoading, isError } = useQuery({ queryKey: ["service-cases", "one", id], queryFn: () => getServiceCase(id) });
  const [form, setForm] = useState(() => formOf(null));
  // O formulário copia a assistência só ao abri-la (ou ao gravar): o tempo real atualiza o resto da ficha sem apagar o
  // que se está a escrever (ver lib/realtime.ts).
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState(false);
  const task = useQuery({ queryKey: ["tasks", "one", id], queryFn: () => getTask(id), enabled: editingTask });

  useEffect(() => {
    if (!sc || sc.workItemId === loadedId) return;
    setForm(formOf(sc));
    setLoadedId(sc.workItemId);
  }, [sc, loadedId]);

  const save = useMutation({
    mutationFn: () =>
      updateServiceCase(id, {
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        serialNumber: form.serialNumber.trim() || null,
        underWarranty: form.underWarranty,
        reportedProblem: form.reportedProblem,
        diagnosis: form.diagnosis.trim() || null,
        resolution: form.resolution.trim() || null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["service-cases", "one", id], updated);
      setForm(formOf(updated));
      queryClient.invalidateQueries({ queryKey: ["service-cases", "list"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
    },
  });

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (isError || !sc) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Assistência não encontrada.</p>
        <Link to="/assistencias" className="text-sm text-primary hover:underline">Voltar às assistências</Link>
      </div>
    );
  }

  const field = (name: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [name]: e.target.value });
  const w = sc.workItem;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Link to="/assistencias" className="text-xs text-muted-foreground hover:underline">← Assistências</Link>
          <h1 className="text-2xl font-semibold">
            <span className="mr-2 font-mono text-base text-muted-foreground">{sc.code}</span>
            {w.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge>{w.step?.name ?? w.status}</Badge>
            <span>{WARRANTY_LABELS[sc.underWarranty]}</span>
            <span>· Responsável: {w.assignee.name}</span>
            {w.company && (
              <span>
                · <Link className="hover:underline" to={`/empresas/${w.company.id}`}>{w.company.name}</Link>
              </span>
            )}
            {w.contact && (
              <span>
                · <Link className="hover:underline" to={`/contactos/${w.contact.id}`}>{w.contact.name}</Link>
              </span>
            )}
            {w.dueDate && <span>· Prazo {new Date(w.dueDate).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</span>}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditingTask(true)}>
          {canEdit ? "Passo, responsável e prazo" : "Ver tarefa"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Equipamento e trabalho</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <ReadOnlyFieldset disabled={!canEdit}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="space-y-1">
                      <Label htmlFor="d-brand">Marca</Label>
                      <Input id="d-brand" value={form.brand} maxLength={120} onChange={field("brand")} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-model">Modelo</Label>
                      <Input id="d-model" value={form.model} maxLength={120} onChange={field("model")} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-serial">N.º de série</Label>
                      <Input id="d-serial" value={form.serialNumber} maxLength={120} onChange={field("serialNumber")} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="d-warranty">Em garantia</Label>
                      <Select id="d-warranty" value={form.underWarranty} onChange={field("underWarranty")}>
                        {Object.entries(WARRANTY_OPTIONS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="d-problem">Problema reportado *</Label>
                    <Textarea id="d-problem" value={form.reportedProblem} onChange={field("reportedProblem")} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="d-diagnosis">Diagnóstico</Label>
                    <Textarea id="d-diagnosis" value={form.diagnosis} onChange={field("diagnosis")} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="d-resolution">Resolução</Label>
                    <Textarea id="d-resolution" value={form.resolution} onChange={field("resolution")} />
                  </div>
                </ReadOnlyFieldset>
                {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar.")}</p>}
                {save.isSuccess && !save.isPending && <p className="text-sm text-green-700">Guardado.</p>}
                {canEdit && (
                  <Button type="submit" disabled={save.isPending || !form.reportedProblem.trim()}>
                    {save.isPending ? "A guardar..." : "Guardar"}
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Campos personalizados</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomFieldsSection entityType="WORK_ITEM" entityId={sc.workItemId} scopeId={w.typeId} />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineSection entityType="TASK" entityId={sc.workItemId} />
          </CardContent>
        </Card>
      </div>

      {editingTask && task.data && (
        <TaskDialog
          open
          task={task.data}
          onClose={() => {
            setEditingTask(false);
            queryClient.invalidateQueries({ queryKey: ["service-cases"] });
          }}
        />
      )}
    </div>
  );
}
