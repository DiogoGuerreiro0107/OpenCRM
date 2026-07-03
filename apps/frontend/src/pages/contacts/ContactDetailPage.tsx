import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PreferredChannel } from "@opencrm/shared-types";
import { deleteContact, getContact, updateContact } from "@/lib/contacts-api";
import { listCompanies } from "@/lib/companies-api";
import { listUsers } from "@/lib/tasks-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimelineSection } from "@/components/TimelineSection";
import { EmailSection } from "@/components/email/EmailSection";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { CallButton } from "@/components/CallButton";
import { CallHistorySection } from "@/components/CallHistorySection";

const CHANNEL_LABELS: Record<PreferredChannel, string> = {
  TELEFONE: "Telefone",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  PRESENCIAL: "Presencial",
};

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contacts", id],
    queryFn: () => getContact(id!),
    enabled: !!id,
  });
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
    companyId: "",
    ownerId: "",
  });

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        mobilePhone: contact.mobilePhone ?? "",
        jobTitle: contact.jobTitle ?? "",
        department: contact.department ?? "",
        preferredChannel: contact.preferredChannel ?? "",
        isDecisionMaker: contact.isDecisionMaker,
        marketingConsent: contact.marketingConsent,
        notes: contact.notes ?? "",
        companyId: contact.companyId ?? "",
        ownerId: contact.ownerId ?? "",
      });
    }
  }, [contact]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateContact(id!, {
        ...form,
        companyId: form.companyId || undefined,
        ownerId: form.ownerId || undefined,
        preferredChannel: form.preferredChannel || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts", id] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteContact(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      navigate("/contactos");
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

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (!contact) return <p className="text-muted-foreground">Contacto não encontrado.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{contact.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate();
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
              {contact.company && (
                <Link to={`/empresas/${contact.company.id}`} className="text-xs text-primary hover:underline">
                  Ver ficha da empresa
                </Link>
              )}
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
                <div className="flex items-center gap-2">
                  <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
                  <CallButton phoneNumber={form.phone} contactId={contact.id} companyId={contact.companyId ?? undefined} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobilePhone">Telemóvel</Label>
                <div className="flex items-center gap-2">
                  <Input id="mobilePhone" value={form.mobilePhone} onChange={handleChange("mobilePhone")} />
                  <CallButton
                    phoneNumber={form.mobilePhone}
                    contactId={contact.id}
                    companyId={contact.companyId ?? undefined}
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="preferredChannel">Canal preferencial</Label>
                <Select
                  id="preferredChannel"
                  value={form.preferredChannel}
                  onChange={handleChange("preferredChannel")}
                >
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
            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (confirm("Eliminar este contacto?")) deleteMutation.mutate();
                }}
              >
                Eliminar
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "A guardar..." : "Guardar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Campos personalizados</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomFieldsSection entityType="CONTACT" entityId={contact.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineSection entityType="CONTACT" entityId={contact.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
          </CardHeader>
          <CardContent>
            <EmailSection contactId={contact.id} defaultTo={contact.email ?? undefined} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chamadas</CardTitle>
          </CardHeader>
          <CardContent>
            <CallHistorySection contactId={contact.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
