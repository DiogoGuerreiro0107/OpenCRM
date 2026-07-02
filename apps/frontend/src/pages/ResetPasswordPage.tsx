import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { resetPasswordRequest } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => resetPasswordRequest(token, newPassword),
    onSuccess: () => {
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    },
  });

  const passwordsMatch = newPassword === confirmPassword;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Definir nova password</CardTitle>
          <CardDescription>Escolhe uma nova password para a tua conta</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <p className="text-sm text-red-600">Link inválido. Pede um novo link de recuperação.</p>
          ) : mutation.isSuccess ? (
            <p className="text-sm text-muted-foreground">
              Password redefinida com sucesso. A redirecionar para o início de sessão...
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (passwordsMatch) mutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nova password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {!passwordsMatch && confirmPassword && (
                <p className="text-sm text-red-600">As passwords não coincidem.</p>
              )}
              {mutation.isError && (
                <p className="text-sm text-red-600">Não foi possível redefinir a password. O link pode ter expirado.</p>
              )}
              <Button type="submit" className="w-full" disabled={mutation.isPending || !passwordsMatch}>
                {mutation.isPending ? "A guardar..." : "Redefinir password"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">
              Voltar ao início de sessão
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
