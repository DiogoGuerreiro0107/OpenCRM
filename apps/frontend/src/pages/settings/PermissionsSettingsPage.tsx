import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@opencrm/shared-types";
import { listPermissions, resetPermission, setPermission, type PermissionAreaView } from "@/lib/permissions-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Papéis que podem receber permissões de escrita (Leitura apenas nunca escreve; o Administrador está sempre). */
const ROLES: Array<{ role: Role; label: string }> = [
  { role: "ADMINISTRADOR", label: "Administrador" },
  { role: "COMERCIAL", label: "Comercial" },
  { role: "TECNICO", label: "Técnico" },
  { role: "BACKOFFICE", label: "Backoffice" },
  { role: "FINANCEIRO", label: "Financeiro" },
];

export function PermissionsSettingsPage() {
  const queryClient = useQueryClient();
  const permissions = useQuery({ queryKey: ["permissions", "manage"], queryFn: listPermissions });
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ["permissions"] });

  const update = useMutation({
    mutationFn: ({ area, roles }: { area: PermissionAreaView["area"]; roles: Role[] }) => setPermission(area, roles),
    onSuccess,
  });
  const reset = useMutation({ mutationFn: (area: PermissionAreaView["area"]) => resetPermission(area), onSuccess });

  function toggle(row: PermissionAreaView, role: Role, checked: boolean) {
    const roles = checked ? [...row.roles, role] : row.roles.filter((r) => r !== role);
    update.mutate({ area: row.area, roles });
  }

  const error = update.error ?? reset.error;
  const busy = update.isPending || reset.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Permissões</h1>
        <p className="text-sm text-muted-foreground">
          Quem pode <strong>alterar</strong> cada área (ver é aberto a todos). As alterações têm efeito imediato em todas as
          sessões. O Administrador tem sempre todas as permissões, e o papel <em>Leitura apenas</em> nunca altera nada.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        A administração (utilizadores, módulos, permissões, chaves de API, webhooks, auditoria, automações, definição de
        campos personalizados, estrutura dos funis e conta Zadarma) é sempre <strong>só do Administrador</strong> e não aparece
        aqui, para ninguém se poder dar a si próprio acesso à gestão de utilizadores.
      </p>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(error, "Não foi possível alterar.")}</p>
      )}
      {permissions.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}

      {permissions.data && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Área</th>
                  {ROLES.map((r) => (
                    <th key={r.role} className="px-2 py-2 text-center">
                      {r.label}
                    </th>
                  ))}
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {permissions.data.map((row) => (
                  <tr key={row.area} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        {row.label}
                        {!row.isDefault && <Badge className="border-amber-200 bg-amber-100 text-amber-800">Alterada</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{row.description}</div>
                    </td>
                    {ROLES.map(({ role, label }) => {
                      const isAdmin = role === "ADMINISTRADOR";
                      const isDefaultRole = row.defaultRoles.includes(role);
                      return (
                        <td key={role} className="px-2 py-3 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${label} pode alterar ${row.label}`}
                            checked={row.roles.includes(role)}
                            disabled={isAdmin || busy}
                            title={isAdmin ? "O Administrador tem sempre permissão" : isDefaultRole ? "Incluído na predefinição" : undefined}
                            onChange={(e) => toggle(row, role, e.target.checked)}
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      {!row.isDefault && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => reset.mutate(row.area)}>
                          Repor predefinição
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
