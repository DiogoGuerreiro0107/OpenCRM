import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listCompanies } from "@/lib/companies-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CompaniesListPage() {
  const [search, setSearch] = useState("");
  const { data: companies, isLoading } = useQuery({
    queryKey: ["companies", search],
    queryFn: () => listCompanies(search || undefined),
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
        placeholder="Pesquisar por nome..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Website</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Contactos</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {!isLoading && companies?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
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
                <td className="px-4 py-2 text-muted-foreground">{company._count.contacts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
