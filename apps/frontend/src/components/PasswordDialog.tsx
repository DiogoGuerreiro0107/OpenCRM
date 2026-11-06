import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";

export const MIN_PASSWORD_LENGTH = 8;

interface PasswordDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Pede a password atual (alteração da própria password). O Administrador a definir a de outro não precisa. */
  askCurrentPassword?: boolean;
  onSubmit: (values: { currentPassword: string; newPassword: string }) => Promise<void>;
}

/** Diálogo partilhado: alterar a própria password e o Administrador definir a de outro utilizador. */
export function PasswordDialog({ open, onClose, title, description, askCurrentPassword, onSubmit }: PasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setDone(false);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => onSubmit({ currentPassword, newPassword }),
    onSuccess: () => setDone(true),
  });

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const canSubmit =
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirm &&
    (!askCurrentPassword || currentPassword.length > 0);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </DialogHeader>

      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-green-700">Password alterada com sucesso.</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
        >
          {askCurrentPassword && (
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Password atual</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="newPassword">Nova password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className={tooShort ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>
              Mínimo de {MIN_PASSWORD_LENGTH} caracteres.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar nova password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {mismatch && <p className="text-xs text-red-600">As passwords não coincidem.</p>}
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">
              {errorMessage(mutation.error, "Não foi possível alterar a password.")}
            </p>
          )}

          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? "A guardar..." : "Guardar"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
