import { useEffect, useState } from "react";
import { blankToNull } from "@/lib/forms";
import { errorMessage } from "@/lib/errors";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanySource, CompanyStatus } from "@opencrm/shared-types";
import { deleteCompany, getCompany, updateCompany } from "@/lib/companies-api";
import { UserPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimelineSection } from "@/components/TimelineSection";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { CallButton } from "@/components/CallButton";
import { RecordPanels } from "@/modules/hooks";
import { CompanyContactsSection } from "@/components/CompanyContactsSection";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { ReadOnlyFieldset } from "@/components/ReadOnly";

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

export function CompanyDetailPage() {
  const canEditCompany = useCanWrite("companies");
  const canAddContact = useCanWrite("contacts");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: company, isLoading } = useQuery({
    queryKey: ["companies", id],
    queryFn: () => getCompany(id!),
    enabled: !!id,
  });

  const productsOn = useModuleEnabled("produtos");
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
    isSupplier: false,
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name,
        legalName: company.legalName ?? "",
        website: company.website ?? "",
        phone: company.phone ?? "",
        email: company.email ?? "",
        taxId: company.taxId ?? "",
        address: company.address ?? "",
        postalCode: company.postalCode ?? "",
        city: company.city ?? "",
        country: company.country ?? "",
        status: company.status,
        source: company.source ?? "",
        ownerId: company.ownerId ?? "",
        notes: company.notes ?? "",
        isSupplier: company.isSupplier,
      });
    }
  }, [company]);

  const updateMutation = useMutation({
    mutationFn: () =>
      // Campos opcionais apagados vão como null (limpam no servidor; um email vazio deixava de ser recusado).
      updateCompany(id!, { ...blankToNull(form), name: form.name, status: form.status }),
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

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
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
<ReadOnlyFieldset disabled={!canEditCompany}>
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
                  <div className="flex items-center gap-2">
                    <Input id="phone" value={form.phone} onChange={handleChange("phone")} />
                    <CallButton phoneNumber={form.phone} companyId={company.id} />
                  </div>
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
                <UserPicker id="ownerId" value={form.ownerId} onChange={(id) => setForm((prev) => ({ ...prev, ownerId: id }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" value={form.notes} onChange={handleChange("notes")} />
              </div>
              {productsOn && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isSupplier} onChange={(e) => setForm((prev) => ({ ...prev, isSupplier: e.target.checked }))} />
                  Fornecedor (aparece nos fornecedores dos produtos)
                </label>
              )}
              {updateMutation.isError && (
                <p className="text-sm text-red-600">{errorMessage(updateMutation.error, "Não foi possível guardar a empresa.")}</p>
              )}
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
            </ReadOnlyFieldset>
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
            <CompanyContactsSection companyId={company.id} total={company._count.contacts} />
            {canAddContact && (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <Link to={`/contactos/novo?companyId=${company.id}`}>Adicionar contacto</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineSection entityType="COMPANY" entityId={company.id} />
          </CardContent>
        </Card>

        {/* Cartões dos módulos (Email, Chamadas...), pelo registo de contribuições (Fase 2c). */}
        <RecordPanels entity="company" companyId={company.id} isSupplier={company.isSupplier} />
      </div>
    </div>
  );
}
