import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanySource, CompanyStatus } from "@opencrm/shared-types";
import { createCompany } from "@/lib/companies-api";
import { listUsers } from "@/lib/tasks-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABELS: Record<CompanyStatus, string> = {
  ATIVO: "Ativo",
  POTENCIAL: "Potencial",
  INATIVO: "Inativo",
  PERDIDO: "Perdido",
};

const SOURCE_LABELS: Record<CompanySource, string> = {
  SITE: "Site",
  LOJA: "Loja",
  CHAMADA: "Chamada",
  CAMPANHA: "Campanha",
  IMPORTACAO: "Importação",
  RECOMENDACAO: "Recomendação",
  OUTRO: "Outro",
};

export function NewCompanyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    website: "",
    phone: "",
    email: "",
    taxId: "",
    address: "",
    postalCode: "",
    city: "",
    country: "",
    status: "POTENCIAL" as CompanyStatus,
    source: "" as CompanySource | "",
    ownerId: "",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      createCompany({
        ...form,
        source: form.source || undefined,
        ownerId: form.ownerId || undefined,
      }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      navigate(`/empresas/${company.id}`);
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
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
              <Label htmlFor="name">Nome comercial *</Label>
              <Input id="name" value={form.name} onChange={handleChange("name")} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legalName">Nome fiscal</Label>
              <Input id="legalName" value={form.legalName} onChange={handleChange("legalName")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="taxId">NIF</Label>
                <Input id="taxId" value={form.taxId} onChange={handleChange("taxId")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={form.website} onChange={handleChange("website")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={handleChange("email")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Morada</Label>
              <Input id="address" value={form.address} onChange={handleChange("address")} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="postalCode">Código postal</Label>
                <Input id="postalCode" value={form.postalCode} onChange={handleChange("postalCode")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Localidade</Label>
                <Input id="city" value={form.city} onChange={handleChange("city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input id="country" value={form.country} onChange={handleChange("country")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="status">Estado</Label>
                <Select id="status" value={form.status} onChange={handleChange("status")}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="source">Origem</Label>
                <Select id="source" value={form.source} onChange={handleChange("source")}>
                  <option value="">Não definida</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownerId">Responsável</Label>
              <Select id="ownerId" value={form.ownerId} onChange={handleChange("ownerId")}>
                <option value="">Sem responsável</option>
                {users?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
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
