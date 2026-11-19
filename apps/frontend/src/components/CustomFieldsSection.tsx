import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomFieldEntityType, CustomFieldValue } from "@opencrm/shared-types";
import { getCustomFieldValues, listCustomFields, saveCustomFieldValues } from "@/lib/custom-fields-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { useCanWrite } from "@/lib/useCanWrite";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { errorMessage } from "@/lib/errors";
import type { WriteArea } from "@/lib/permissions";

/**
 * Quem pode preencher os campos personalizados de cada tipo de registo: a MESMA regra que edita o próprio registo
 * (o backend aplica-a em custom-fields/entity-registry.ts; isto é só para a interface não oferecer o que vai falhar).
 */
const WRITE_AREA_BY_ENTITY: Record<CustomFieldEntityType, WriteArea> = {
  COMPANY: "companies",
  CONTACT: "contacts",
  LEAD: "leads",
  DEAL: "deals",
  WORK_ITEM: "dailyWork",
};

interface CustomFieldsSectionProps {
  entityType: CustomFieldEntityType;
  entityId: string;
  /** Âmbito do registo (nas tarefas, o tipo): mostra os campos de todos e os deste âmbito. */
  scopeId?: string;
}

export function CustomFieldsSection({ entityType, entityId, scopeId = "" }: CustomFieldsSectionProps) {
  const queryClient = useQueryClient();
  const canEdit = useCanWrite(WRITE_AREA_BY_ENTITY[entityType]);
  const { data: fields } = useQuery({
    queryKey: ["custom-fields", entityType],
    queryFn: () => listCustomFields(entityType),
  });
  const { data: values } = useQuery({
    // O âmbito entra na chave: mudar o tipo de uma tarefa muda os campos que se lhe aplicam.
    queryKey: ["custom-field-values", entityType, entityId, scopeId],
    queryFn: () => getCustomFieldValues(entityType, entityId),
  });

  const [form, setForm] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!values) return;
    const map: Record<string, unknown> = {};
    for (const v of values) map[v.customFieldId] = v.value;
    setForm(map);
  }, [values]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: CustomFieldValue[] = Object.entries(form).map(([customFieldId, value]) => ({
        customFieldId,
        value: value as CustomFieldValue["value"],
      }));
      return saveCustomFieldValues(entityType, entityId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-field-values", entityType, entityId] });
    },
  });

  const visibleFields = fields?.filter((f) => f.isVisible && (f.scopeId === "" || f.scopeId === scopeId)) ?? [];
  if (visibleFields.length === 0) return null;

  function setValue(fieldId: string, value: unknown) {
    setForm((prev) => ({ ...prev, [fieldId]: value }));
  }

  return (
    // Não é um <form> propositadamente — este componente é usado dentro de outros
    // formulários (ex: LeadDialog, DealDialog), e <form> aninhados são inválidos em
    // HTML: o browser associa o botão de submit ao formulário exterior em vez deste.
    <ReadOnlyFieldset disabled={!canEdit}>
      {visibleFields.map((field) => {
        const value = form[field.id];
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>
              {field.fieldLabel}
              {field.isRequired && " *"}
            </Label>
            {field.fieldType === "TEXTAREA" && (
              <Textarea
                id={field.id}
                value={(value as string) ?? ""}
                onChange={(e) => setValue(field.id, e.target.value)}
                required={field.isRequired}
              />
            )}
            {(field.fieldType === "TEXT" || field.fieldType === "EMAIL" || field.fieldType === "PHONE" || field.fieldType === "URL") && (
              <Input
                id={field.id}
                type={field.fieldType === "EMAIL" ? "email" : "text"}
                value={(value as string) ?? ""}
                onChange={(e) => setValue(field.id, e.target.value)}
                required={field.isRequired}
              />
            )}
            {(field.fieldType === "NUMBER" || field.fieldType === "CURRENCY") && (
              <Input
                id={field.id}
                type="number"
                step={field.fieldType === "CURRENCY" ? "0.01" : "1"}
                value={(value as number) ?? ""}
                onChange={(e) => setValue(field.id, e.target.value ? Number(e.target.value) : null)}
                required={field.isRequired}
              />
            )}
            {field.fieldType === "DATE" && (
              <Input
                id={field.id}
                type="date"
                value={value ? String(value).slice(0, 10) : ""}
                onChange={(e) => setValue(field.id, e.target.value || null)}
                required={field.isRequired}
              />
            )}
            {field.fieldType === "BOOLEAN" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => setValue(field.id, e.target.checked)}
                />
                Sim
              </label>
            )}
            {field.fieldType === "SELECT" && (
              <Select
                id={field.id}
                value={(value as string) ?? ""}
                onChange={(e) => setValue(field.id, e.target.value || null)}
                required={field.isRequired}
              >
                <option value="">Selecionar...</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )}
            {field.fieldType === "MULTISELECT" && (
              <div className="flex flex-wrap gap-3">
                {field.options?.map((option) => {
                  const selected = Array.isArray(value) ? (value as string[]) : [];
                  return (
                    <label key={option} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.includes(option)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected, option]
                            : selected.filter((o) => o !== option);
                          setValue(field.id, next);
                        }}
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {saveMutation.isError && (
        <p className="text-sm text-red-600">{errorMessage(saveMutation.error, "Não foi possível guardar os campos.")}</p>
      )}
      {canEdit && (
        <Button type="button" size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "A guardar..." : "Guardar campos"}
        </Button>
      )}
    </ReadOnlyFieldset>
  );
}
