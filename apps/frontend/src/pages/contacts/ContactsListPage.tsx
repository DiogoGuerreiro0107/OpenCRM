import { useState } from "react";
import { Link } from "react-router-dom";
import { listContacts } from "@/lib/contacts-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanWrite } from "@/lib/useCanWrite";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";

export function ContactsListPage() {
  const canCreate = useCanWrite("contacts");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  // Paginada por nome (docs/plano-paginacao-listagens.md): nunca descarrega a tabela inteira.
  const list = usePagedList(["contacts", "list", term], (cursor) => listContacts({ search: term || undefined, cursor }));
  const contacts = list.items;
  const isLoading = list.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contactos</h1>
        {canCreate && (
          <Button asChild>
            <Link to="/contactos/novo">Novo contacto</Link>
          </Button>
        )}
      </div>

      <Input
        aria-label="Pesquisar contactos"
        placeholder="Pesquisar por nome, email, telefone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Empresa</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
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
            {!isLoading && contacts?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum contacto encontrado.
                </td>
              </tr>
            )}
            {contacts?.map((contact) => (
              <tr key={contact.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Link to={`/contactos/${contact.id}`} className="font-medium text-primary hover:underline">
                    {contact.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{contact.company?.name ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{contact.email ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{contact.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={contacts.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["contacto", "contactos"]} />
    </div>
  );
}
