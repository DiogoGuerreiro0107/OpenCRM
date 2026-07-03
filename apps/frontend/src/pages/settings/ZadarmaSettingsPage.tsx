import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getZadarmaAccount, saveZadarmaAccount } from "@/lib/zadarma-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ZadarmaSettingsPage() {
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useQuery({ queryKey: ["zadarma-account"], queryFn: getZadarmaAccount });

  const [form, setForm] = useState({
    apiKey: "",
    apiSecret: "",
    callerExtension: "",
    active: true,
  });

  useEffect(() => {
    if (account) {
      setForm((prev) => ({ ...prev, callerExtension: account.callerExtension ?? "", active: account.active }));
    }
  }, [account]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveZadarmaAccount({
        apiKey: form.apiKey,
        apiSecret: form.apiSecret,
        callerExtension: form.callerExtension || undefined,
        active: form.active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zadarma-account"] });
      setForm((prev) => ({ ...prev, apiKey: "", apiSecret: "" }));
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold">Zadarma</h1>
      <p className="text-sm text-muted-foreground">
        Integração de telefonia — chamadas com um clique e sincronização de histórico/gravações. O histórico é
        atualizado periodicamente (a cada 10 minutos), não em tempo real.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Ligação à conta</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">A carregar...</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate();
              }}
            >
              {account?.hasCredentials && (
                <p className="text-sm text-muted-foreground">
                  Conta já configurada. Última sincronização:{" "}
                  {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString("pt-PT") : "ainda não correu"}.
                  Preenche os campos abaixo apenas se quiseres substituir a API key/secret.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key {account?.hasCredentials ? "(deixar em branco para manter)" : "*"}</Label>
                <Input
                  id="apiKey"
                  value={form.apiKey}
                  onChange={handleChange("apiKey")}
                  required={!account?.hasCredentials}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiSecret">
                  API Secret {account?.hasCredentials ? "(deixar em branco para manter)" : "*"}
                </Label>
                <Input
                  id="apiSecret"
                  type="password"
                  value={form.apiSecret}
                  onChange={handleChange("apiSecret")}
                  required={!account?.hasCredentials}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="callerExtension">A tua extensão/número Zadarma</Label>
                <Input
                  id="callerExtension"
                  value={form.callerExtension}
                  onChange={handleChange("callerExtension")}
                  placeholder="ex: 100 ou +351912345678"
                />
                <p className="text-xs text-muted-foreground">
                  Ao clicar em "ligar" num número, a Zadarma toca primeiro para esta extensão/número e só depois liga
                  automaticamente para o cliente.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={handleChange("active")} />
                Ativa
              </label>

              {saveMutation.isError && (
                <p className="text-sm text-red-600">Não foi possível guardar. Verifica os dados e tenta novamente.</p>
              )}
              {saveMutation.isSuccess && (
                <p className="text-sm text-green-700">Configuração guardada com sucesso.</p>
              )}

              <div className="flex justify-end">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "A guardar..." : "Guardar"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
