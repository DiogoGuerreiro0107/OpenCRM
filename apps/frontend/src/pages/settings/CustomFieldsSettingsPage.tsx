import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CustomField, CustomFieldEntityType } from "@opencrm/shared-types";
import { listCustomFields } from "@/lib/custom-fields-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CustomFieldDialog } from "./CustomFieldDialog";

const ENTITY_TABS: { value: CustomFieldEntityType; label: string }[] = [
  { value: "COMPANY", label: "Empresas" },
  { value: "CONTACT", label: "Contactos" },
  { value: "LEAD", label: "Leads" },
  { value: "DEAL", label: "Oportunidades" },
];

export function CustomFieldsSettingsPage() {
  const [entityType, setEntityType] = useState<CustomFieldEntityType>("COMPANY");
  const [dialogState, setDialogState] = useState<{ field: CustomField | null } | null>(null);

  const { data: fields, isLoading } = useQuery({
    queryKey: ["custom-fields", entityType],
    queryFn: () => listCustomFields(entityType),
  });

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
          field={dialogState.field}
        />
      )}
    </div>
  );
}
