import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteContact, getContact, updateContact } from "@/lib/contacts-api";
import { listCompanies } from "@/lib/companies-api";
import { createActivity } from "@/lib/activity-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { EmailSection } from "@/components/email/EmailSection";

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

  const [form, setForm] = useState({ name: "", email: "", phone: "", jobTitle: "", notes: "", companyId: "" });

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        jobTitle: contact.jobTitle ?? "",
        notes: contact.notes ?? "",
        companyId: contact.companyId ?? "",
      });
    }
  }, [contact]);

  const updateMutation = useMutation({
    mutationFn: () => updateContact(id!, { ...form, companyId: form.companyId || undefined }),
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

  const activityMutation = useMutation({
    mutationFn: (input: { type: import("@opencrm/shared-types").ActivityType; content: string }) =>
      createActivity({ ...input, contactId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contacts", id] }),
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
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
            <div className="space-y-2">
              <Label htmlFor="jobTitle">Cargo</Label>
              <Input id="jobTitle" value={form.jobTitle} onChange={handleChange("jobTitle")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={handleChange("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
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
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline
              activities={contact.activities}
              onAdd={(input) => activityMutation.mutateAsync(input).then(() => undefined)}
              isSubmitting={activityMutation.isPending}
            />
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
      </div>
    </div>
  );
}
