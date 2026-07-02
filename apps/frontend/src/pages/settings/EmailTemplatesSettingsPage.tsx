import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmailTemplate } from "@opencrm/shared-types";
import { listEmailTemplates } from "@/lib/email-templates-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmailTemplateDialog } from "./EmailTemplateDialog";

export function EmailTemplatesSettingsPage() {
  const [dialogState, setDialogState] = useState<{ template: EmailTemplate | null } | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: listEmailTemplates,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates de Email</h1>
        <Button onClick={() => setDialogState({ template: null })}>Novo modelo</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Categoria</th>
              <th className="px-4 py-2 font-medium">Assunto</th>
              <th className="px-4 py-2 font-medium">Estado</th>
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
            {!isLoading && templates?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum modelo de email criado.
                </td>
              </tr>
            )}
            {templates?.map((template) => (
              <tr
                key={template.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                onClick={() => setDialogState({ template })}
              >
                <td className="px-4 py-2 font-medium">{template.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{template.category ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{template.subject}</td>
                <td className="px-4 py-2">
                  <Badge className={template.active ? "bg-green-100 text-green-800 border-green-200" : ""}>
                    {template.active ? "Ativo" : "Inativo"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && (
        <EmailTemplateDialog open onClose={() => setDialogState(null)} template={dialogState.template} />
      )}
    </div>
  );
}
