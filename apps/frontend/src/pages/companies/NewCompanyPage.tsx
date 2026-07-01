import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createCompany } from "@/lib/companies-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NewCompanyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", website: "", phone: "", taxId: "", address: "", notes: "" });

  const mutation = useMutation({
    mutationFn: () => createCompany(form),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      navigate(`/empresas/${company.id}`);
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Nova empresa</h1>
      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" value={form.name} onChange={handleChange("name")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">NIF</Label>
              <Input id="taxId" value={form.taxId} onChange={handleChange("taxId")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" value={form.website} onChange={handleChange("website")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Morada</Label>
              <Input id="address" value={form.address} onChange={handleChange("address")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea id="notes" value={form.notes} onChange={handleChange("notes")} />
            </div>
            {mutation.isError && (
              <p className="text-sm text-red-600">Não foi possível criar a empresa. Tenta novamente.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/empresas")}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
                {mutation.isPending ? "A criar..." : "Criar empresa"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
