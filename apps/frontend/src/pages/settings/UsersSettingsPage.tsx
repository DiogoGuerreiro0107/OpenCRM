import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ManagedUser } from "@opencrm/shared-types";
import { listManagedUsers, setUserPassword } from "@/lib/users-api";
import { ROLE_LABELS } from "@/lib/roles";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PasswordDialog } from "@/components/PasswordDialog";
import { UserDialog } from "./UserDialog";

export function UsersSettingsPage() {
  const { user: currentUser } = useAuth();
  const [dialogState, setDialogState] = useState<{ user: ManagedUser | null } | null>(null);
  const [passwordFor, setPasswordFor] = useState<ManagedUser | null>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ["users", "manage"], queryFn: listManagedUsers });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Utilizadores</h1>
          <p className="text-sm text-muted-foreground">
            Quem pode entrar no CRM e o que pode fazer. Utilizadores desativados não entram, mas o histórico mantém-se.
          </p>
        </div>
        <Button onClick={() => setDialogState({ user: null })}>Novo utilizador</Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Papel</th>
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
            {users?.map((u) => (
              <tr
                key={u.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                onClick={() => setDialogState({ user: u })}
              >
                <td className="px-4 py-2 font-medium">
                  {u.name}
                  {u.id === currentUser?.id && <span className="ml-2 text-xs text-muted-foreground">(tu)</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-2">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-2">
                  <Badge className={u.active ? "bg-green-100 text-green-800 border-green-200" : ""}>
                    {u.active ? "Ativo" : "Desativado"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && (
        <UserDialog
          open
          onClose={() => setDialogState(null)}
          user={dialogState.user}
          currentUserId={currentUser?.id}
          onSetPassword={(u) => {
            setDialogState(null);
            setPasswordFor(u);
          }}
        />
      )}

      {passwordFor && (
        <PasswordDialog
          open
          onClose={() => setPasswordFor(null)}
          title={`Nova password para ${passwordFor.name}`}
          description="As sessões abertas deste utilizador terminam."
          onSubmit={({ newPassword }) => setUserPassword(passwordFor.id, newPassword)}
        />
      )}
    </div>
  );
}
