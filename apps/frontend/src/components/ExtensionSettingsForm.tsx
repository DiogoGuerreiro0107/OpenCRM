import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getExtensionSettings, updateExtensionSettings, type SettingField, type SettingValue } from "@/lib/extensions-api";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Draft = Record<string, SettingValue>;

/** O que mudou em relação ao que está guardado (os segredos só se se escreveu alguma coisa). */
function changes(fields: SettingField[], draft: Draft, saved: Draft): Draft {
  const out: Draft = {};
  for (const f of fields) {
    const value = draft[f.key];
    if (f.type === "secret") {
      if (typeof value === "string" && value !== "") out[f.key] = value;
    } else {
      const normalized = f.type === "text" && value === "" ? null : (value ?? null);
      if (normalized !== (saved[f.key] ?? null)) out[f.key] = normalized;
    }
  }
  return out;
}

/**
 * Formulário gerado a partir das definições do manifesto de uma extensão (Fase E1.3). Os segredos nunca vêm do
 * servidor: mostra-se se estão preenchidos e escreve-se por cima para os substituir.
 */
export function ExtensionSettingsForm({ extensionId }: { extensionId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["modules", "settings", extensionId], queryFn: () => getExtensionSettings(extensionId) });
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    if (data) setDraft({ ...data.values });
  }, [data]);
  const save = useMutation({
    mutationFn: (patch: Draft) => updateExtensionSettings(extensionId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modules"] });
      // O modo das leads também se lê fora daqui (formulários das leads).
      if (extensionId === "leads") queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">A carregar...</p>;
  const pending = changes(data.fields, draft, data.values);
  const dirty = Object.keys(pending).length > 0;
  const set = (key: string, value: SettingValue) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate(pending);
      }}
    >
      {data.fields.map((f) => {
        const id = `ext-${extensionId}-${f.key}`;
        const secretSet = data.secretsSet.includes(f.key);
        return (
          <div key={f.key} className="space-y-1">
            {f.type === "boolean" ? (
              <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
                <input id={id} type="checkbox" checked={draft[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
              </label>
            ) : (
              <label htmlFor={id} className="block text-sm font-medium">
                {f.label}
                {f.required && <span className="text-red-600"> *</span>}
              </label>
            )}
            {f.type === "select" && (
              <Select id={id} className="max-w-xs" value={String(draft[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            {f.type === "text" && (
              <Input id={id} className="max-w-md" value={String(draft[f.key] ?? "")} maxLength={f.maxLength ?? 500} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.type === "secret" && (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                className="max-w-md"
                placeholder={secretSet ? "Preenchido — escreve para substituir" : "Por preencher"}
                value={String(draft[f.key] ?? "")}
                maxLength={f.maxLength ?? 500}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
          </div>
        );
      })}
      {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar as definições.")}</p>}
      {save.isSuccess && !dirty && <p className="text-sm text-green-700">Definições guardadas.</p>}
      <Button type="submit" size="sm" disabled={save.isPending || !dirty}>
        {save.isPending ? "A guardar..." : "Guardar definições"}
      </Button>
    </form>
  );
}
