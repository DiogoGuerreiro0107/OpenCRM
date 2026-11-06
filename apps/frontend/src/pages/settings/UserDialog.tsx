import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ManagedUser, Role } from "@opencrm/shared-types";
import { createUser, updateUser } from "@/lib/users-api";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { errorMessage } from "@/lib/errors";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { MIN_PASSWORD_LENGTH } from "@/components/PasswordDialog";

interface UserDialogProps {
  open: boolean;
  onClose: () => void;
  /** Utilizador a editar; sem isto, o diálogo cria um novo. */
  user?: ManagedUser | null;
  /** Id de quem está com a sessão iniciada: não pode desativar-se nem mudar o próprio papel (o backend também recusa). */
  currentUserId?: string;
  onSetPassword?: (user: ManagedUser) => void;
}

export function UserDialog({ open, onClose, user, currentUserId, onSetPassword }: UserDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", role: "COMERCIAL" as Role, password: "", active: true });
  const isSelf = !!user && user.id === currentUserId;

  useEffect(() => {
    if (!open) return;
    setForm({
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: user?.role ?? "COMERCIAL",
      password: "",
      active: user?.active ?? true,
    });
  }, [open, user]);

  const saveMutation = useMutation({
    mutationFn: () =>
      user
        ? updateUser(user.id, { name: form.name, role: form.role, active: form.active })
        : createUser({ name: form.name, email: form.email, role: form.role, password: form.password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
  });

  const passwordOk = !!user || form.password.length >= MIN_PASSWORD_LENGTH;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{user ? "Editar utilizador" : "Novo utilizador"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="user-name">Nome *</Label>
          <Input
            id="user-name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-email">Email *</Label>
          <Input
            id="user-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            disabled={!!user}
            required
          />
          {user && <p className="text-xs text-muted-foreground">O email não se altera depois de criado.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-role">Papel</Label>
          <Select
            id="user-role"
            value={form.role}
            onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as Role }))}
            disabled={isSelf}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          {isSelf && <p className="text-xs text-muted-foreground">Não podes alterar o teu próprio papel.</p>}
        </div>

        {!user && (
          <div className="space-y-2">
            <Label htmlFor="user-password">Password inicial *</Label>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              required
            />
            <p className="text-xs text-muted-foreground">
              Mínimo de {MIN_PASSWORD_LENGTH} caracteres. Comunica-a ao utilizador, que a pode alterar depois.
            </p>
          </div>
        )}

        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={isSelf}
              onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
            />
            Ativo
            <span className="text-xs text-muted-foreground">
              {isSelf ? "(não podes desativar a tua própria conta)" : "(desativado: não consegue entrar, mantém o histórico)"}
            </span>
          </label>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(saveMutation.error, "Não foi possível guardar o utilizador.")}</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            {user && onSetPassword && (
              <Button type="button" variant="outline" onClick={() => onSetPassword(user)}>
                Definir nova password
              </Button>
            )}
          </div>
          <Button type="submit" disabled={saveMutation.isPending || !form.name.trim() || !passwordOk}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
