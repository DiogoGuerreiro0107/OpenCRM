import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { forgotPasswordRequest } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const mutation = useMutation({
    mutationFn: () => forgotPasswordRequest(email),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Recuperar password</CardTitle>
          <CardDescription>Indica o teu email e enviamos um link para repores a password</CardDescription>
        </CardHeader>
        <CardContent>
          {mutation.isSuccess ? (
            <p className="text-sm text-muted-foreground">
              Se o email existir, foi enviado um link de recuperação. Verifica a tua caixa de entrada.
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "A enviar..." : "Enviar link"}
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
