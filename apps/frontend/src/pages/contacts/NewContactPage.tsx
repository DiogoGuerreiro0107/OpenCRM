import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PreferredChannel } from "@opencrm/shared-types";
import { createContact } from "@/lib/contacts-api";
import { listCompanies } from "@/lib/companies-api";
import { listUsers } from "@/lib/tasks-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  TELEFONE: "Telefone",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  PRESENCIAL: "Presencial",
};

export function NewContactPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { data: companies } = useQuery({ queryKey: ["companies"], queryFn: () => listCompanies() });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    mobilePhone: "",
    jobTitle: "",
    department: "",
    preferredChannel: "" as PreferredChannel | "",
    isDecisionMaker: false,
    marketingConsent: false,
    notes: "",
    companyId: searchParams.get("companyId") ?? "",
    ownerId: "",
  });

  const mutation = useMutation({
    mutationFn: () =>
      createContact({
        ...form,
        companyId: form.companyId || undefined,
        ownerId: form.ownerId || undefined,
        preferredChannel: form.preferredChannel || undefined,
      }),
    onSuccess: (contact) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate(`/contactos/${contact.id}`);
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function handleCheckbox(field: "isDecisionMaker" | "marketingConsent") {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.checked }));
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Novo contacto</h1>
      <Card>
        <CardHeader>
          <CardTitle>Dados do contacto</CardTitle>
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
              <Label htmlFor="company">Empresa</Label>
              <Select id="company" value={form.companyId} onChange={handleChange("companyId")}>
                <option value="">Sem empresa</option>
                {companies?.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Cargo</Label>
                <Input id="jobTitle" value={form.jobTitle} onChange={handleChange("jobTitle")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Departamento</Label>
                <Input id="department" value={form.department} onChange={handleChange("department")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={handleChange("email")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobilePhone">Telemóvel</Label>
                <Input id="mobilePhone" value={form.mobilePhone} onChange={handleChange("mobilePhone")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="preferredChannel">Canal preferencial</Label>
                <Select id="preferredChannel" value={form.preferredChannel} onChange={handleChange("preferredChannel")}>
                  <option value="">Não definido</option>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
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
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isDecisionMaker} onChange={handleCheckbox("isDecisionMaker")} />
                Decisor
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.marketingConsent}
                  onChange={handleCheckbox("marketingConsent")}
                />
                Consentimento de marketing
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea id="notes" value={form.notes} onChange={handleChange("notes")} />
            </div>
            {mutation.isError && (
              <p className="text-sm text-red-600">Não foi possível criar o contacto. Tenta novamente.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate("/contactos")}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending || !form.name.trim()}>
                {mutation.isPending ? "A criar..." : "Criar contacto"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
