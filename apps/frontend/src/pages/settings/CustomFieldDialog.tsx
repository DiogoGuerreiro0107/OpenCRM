import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CustomField, CustomFieldEntityType, CustomFieldType } from "@opencrm/shared-types";
import { createCustomField, deleteCustomField, updateCustomField } from "@/lib/custom-fields-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Texto curto",
  TEXTAREA: "Texto longo",
  NUMBER: "Número",
  CURRENCY: "Valor monetário",
  DATE: "Data",
  BOOLEAN: "Sim/Não",
  SELECT: "Lista de opções",
  MULTISELECT: "Seleção múltipla",
  EMAIL: "Email",
  PHONE: "Telefone",
  URL: "URL",
};

interface CustomFieldDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: CustomFieldEntityType;
  field?: CustomField | null;
}

export function CustomFieldDialog({ open, onClose, entityType, field }: CustomFieldDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fieldLabel: "",
    fieldType: "TEXT" as CustomFieldType,
    sectionName: "",
    optionsText: "",
    isRequired: false,
    isVisible: true,
    isSearchable: false,
    isFilterable: false,
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      fieldLabel: field?.fieldLabel ?? "",
      fieldType: field?.fieldType ?? "TEXT",
      sectionName: field?.sectionName ?? "",
      optionsText: field?.options?.join(", ") ?? "",
      isRequired: field?.isRequired ?? false,
      isVisible: field?.isVisible ?? true,
      isSearchable: field?.isSearchable ?? false,
      isFilterable: field?.isFilterable ?? false,
    });
  }, [open, field]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["custom-fields", entityType] });
  }

  const needsOptions = form.fieldType === "SELECT" || form.fieldType === "MULTISELECT";

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        fieldLabel: form.fieldLabel,
        fieldType: form.fieldType,
        sectionName: form.sectionName || undefined,
        options: needsOptions
          ? form.optionsText.split(",").map((o) => o.trim()).filter(Boolean)
          : undefined,
        isRequired: form.isRequired,
        isVisible: form.isVisible,
        isSearchable: form.isSearchable,
        isFilterable: form.isFilterable,
      };
      return field ? updateCustomField(field.id, payload) : createCustomField({ ...payload, entityType });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomField(field!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{field ? "Editar campo" : "Novo campo personalizado"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="fieldLabel">Nome do campo *</Label>
          <Input id="fieldLabel" value={form.fieldLabel} onChange={handleChange("fieldLabel")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fieldType">Tipo *</Label>
          <Select id="fieldType" value={form.fieldType} onChange={handleChange("fieldType")} disabled={!!field}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {needsOptions && (
          <div className="space-y-2">
            <Label htmlFor="optionsText">Opções (separadas por vírgula) *</Label>
            <Input
              id="optionsText"
              value={form.optionsText}
              onChange={handleChange("optionsText")}
              placeholder="Opção A, Opção B, Opção C"
              required
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="sectionName">Secção</Label>
          <Input
            id="sectionName"
            value={form.sectionName}
            onChange={handleChange("sectionName")}
            placeholder="ex: Informação fiscal"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isRequired} onChange={handleChange("isRequired")} />
            Obrigatório
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isVisible} onChange={handleChange("isVisible")} />
            Visível
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isSearchable} onChange={handleChange("isSearchable")} />
            Pesquisável
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isFilterable} onChange={handleChange("isFilterable")} />
            Filtrável
          </label>
        </div>

        {saveMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível guardar o campo. Verifica se o nome já existe.</p>
        )}

        <div className="flex justify-between pt-2">
          {field ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar este campo? Os valores guardados serão perdidos.")) deleteMutation.mutate();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saveMutation.isPending || !form.fieldLabel.trim()}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
