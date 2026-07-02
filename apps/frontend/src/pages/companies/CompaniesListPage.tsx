import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CompanyStatus } from "@opencrm/shared-types";
import { listCompanies } from "@/lib/companies-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_TABS: { value: CompanyStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "ATIVO", label: "Ativo" },
  { value: "POTENCIAL", label: "Potencial" },
  { value: "INATIVO", label: "Inativo" },
  { value: "PERDIDO", label: "Perdido" },
];

const STATUS_BADGE_CLASS: Record<CompanyStatus, string> = {
  ATIVO: "bg-green-100 text-green-800 border-green-200",
  POTENCIAL: "bg-blue-100 text-blue-800 border-blue-200",
  INATIVO: "",
  PERDIDO: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<CompanyStatus, string> = {
  ATIVO: "Ativo",
  POTENCIAL: "Potencial",
  INATIVO: "Inativo",
  PERDIDO: "Perdido",
};

export function CompaniesListPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | "ALL">("ALL");
  const { data: companies, isLoading } = useQuery({
    queryKey: ["companies", search, statusFilter],
    queryFn: () =>
      listCompanies({
        search: search || undefined,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Empresas</h1>
        <Button asChild>
          <Link to="/empresas/novo">Nova empresa</Link>
        </Button>
      </div>

      <Input
        placeholder="Pesquisar por nome, NIF, telefone, email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="flex gap-2 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab.value === statusFilter
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Website</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Contactos</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {!isLoading && companies?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            )}
            {companies?.map((company) => (
              <tr key={company.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link to={`/empresas/${company.id}`} className="font-medium text-primary hover:underline">
                    {company.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{company.website ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{company.phone ?? "—"}</td>
                <td className="px-4 py-2">
                  <Badge className={STATUS_BADGE_CLASS[company.status]}>{STATUS_LABELS[company.status]}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{company._count.contacts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
