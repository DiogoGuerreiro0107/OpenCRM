import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CustomField, CustomFieldEntityType } from "@opencrm/shared-types";
import { listCustomFields } from "@/lib/custom-fields-api";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CustomFieldDialog } from "./CustomFieldDialog";

const ENTITY_TABS: { value: CustomFieldEntityType; label: string }[] = [
  { value: "COMPANY", label: "Empresas" },
  { value: "CONTACT", label: "Contactos" },
  { value: "LEAD", label: "Leads" },
  { value: "DEAL", label: "Oportunidades" },
  { value: "WORK_ITEM", label: "Tarefas" },
];

const isEntityTab = (value: string | null): value is CustomFieldEntityType => ENTITY_TABS.some((t) => t.value === value);

/**
 * Configurações > Campos personalizados. Nas tarefas (Fase 2b), cada campo aplica-se a todas ou só a um tipo de tarefa
 * (âmbito). `?entidade=WORK_ITEM&ambito=VISITA` abre diretamente os campos de um tipo (ligação nos tipos de tarefa).
 */
export function CustomFieldsSettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("entidade");
  const entityType: CustomFieldEntityType = isEntityTab(requested) ? requested : "COMPANY";
  const scopeId = entityType === "WORK_ITEM" ? (params.get("ambito") ?? "") : "";
  const setEntityType = (value: CustomFieldEntityType) => setParams(value === "COMPANY" ? {} : { entidade: value }, { replace: true });
  const setScopeId = (value: string) => setParams(value ? { entidade: "WORK_ITEM", ambito: value } : { entidade: "WORK_ITEM" }, { replace: true });
  const [dialogState, setDialogState] = useState<{ field: CustomField | null } | null>(null);

  const { data: allFields, isLoading } = useQuery({
    queryKey: ["custom-fields", entityType],
    queryFn: () => listCustomFields(entityType),
  });
  const { data: types = [] } = useQuery({
    queryKey: ["work-item-types", "all"],
    queryFn: () => listWorkItemTypes(),
    enabled: entityType === "WORK_ITEM",
  });
  // Lista curta: vêm todos os campos do tipo de registo e mostram-se os do âmbito escolhido.
  const fields = allFields?.filter((f) => f.scopeId === scopeId);
  const scopeLabel = entityType !== "WORK_ITEM" ? undefined : scopeId ? `tarefas do tipo «${types.find((t) => t.id === scopeId)?.name ?? scopeId}»` : "todas as tarefas";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campos Personalizados</h1>
        <Button onClick={() => setDialogState({ field: null })}>Novo campo</Button>
      </div>

      <div className="flex gap-2 border-b border-border">
        {ENTITY_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setEntityType(tab.value)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab.value === entityType
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {entityType === "WORK_ITEM" && (
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="cf-scope" className="text-muted-foreground">
            Campos de
          </label>
          <Select id="cf-scope" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="w-64">
            <option value="">Todas as tarefas</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                Só «{t.name}»
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Secção</th>
              <th className="px-4 py-2 font-medium">Propriedades</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {!isLoading && fields?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum campo personalizado para esta entidade.
                </td>
              </tr>
            )}
            {fields?.map((field) => (
              <tr
                key={field.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                onClick={() => setDialogState({ field })}
              >
                <td className="px-4 py-2 font-medium">{field.fieldLabel}</td>
                <td className="px-4 py-2 text-muted-foreground">{field.fieldType}</td>
                <td className="px-4 py-2 text-muted-foreground">{field.sectionName ?? "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {field.isRequired && <Badge>Obrigatório</Badge>}
                    {!field.isVisible && <Badge>Oculto</Badge>}
                    {field.isSearchable && <Badge>Pesquisável</Badge>}
                    {field.isFilterable && <Badge>Filtrável</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && (
        <CustomFieldDialog
          open
          onClose={() => setDialogState(null)}
          entityType={entityType}
          scopeId={scopeId}
          scopeLabel={scopeLabel}
          field={dialogState.field}
        />
      )}
    </div>
  );
}
