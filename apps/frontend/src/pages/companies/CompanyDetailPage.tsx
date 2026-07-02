import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteCompany, getCompany, updateCompany } from "@/lib/companies-api";
import { createActivity } from "@/lib/activity-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { EmailSection } from "@/components/email/EmailSection";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: company, isLoading } = useQuery({
    queryKey: ["companies", id],
    queryFn: () => getCompany(id!),
    enabled: !!id,
  });

  const [form, setForm] = useState({ name: "", website: "", phone: "", taxId: "", address: "", notes: "" });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name,
        website: company.website ?? "",
        phone: company.phone ?? "",
        taxId: company.taxId ?? "",
        address: company.address ?? "",
        notes: company.notes ?? "",
      });
    }
  }, [company]);

  const updateMutation = useMutation({
    mutationFn: () => updateCompany(id!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies", id] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCompany(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      navigate("/empresas");
    },
  });

  const activityMutation = useMutation({
    mutationFn: (input: { type: import("@opencrm/shared-types").ActivityType; content: string }) =>
      createActivity({ ...input, companyId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["companies", id] }),
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (!company) return <p className="text-muted-foreground">Empresa não encontrada.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{company.name}</CardTitle>
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
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (confirm("Eliminar esta empresa?")) deleteMutation.mutate();
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

        <Card>
          <CardHeader>
            <CardTitle>Campos personalizados</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomFieldsSection entityType="COMPANY" entityId={company.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contactos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {company.contacts.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem contactos associados.</p>
            )}
            {company.contacts.map((contact) => (
              <Link
                key={contact.id}
                to={`/contactos/${contact.id}`}
                className="block rounded-md border border-border p-2 text-sm hover:bg-muted/30"
              >
                <span className="font-medium text-primary">{contact.name}</span>
                {contact.jobTitle && <span className="text-muted-foreground"> · {contact.jobTitle}</span>}
              </Link>
            ))}
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link to={`/contactos/novo?companyId=${company.id}`}>Adicionar contacto</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline
              activities={company.activities}
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
            <EmailSection companyId={company.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
