import { useState } from "react";
import { Link } from "react-router-dom";
import { listContacts } from "@/lib/contacts-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { Input } from "@/components/ui/input";

/**
 * Contactos de uma empresa na ficha dela, paginados e com pesquisa (docs/plano-paginacao-listagens.md): uma empresa
 * grande pode ter centenas de contactos, e a ficha já não os traz todos.
 */
export function CompanyContactsSection({ companyId, total }: { companyId: string; total: number }) {
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const list = usePagedList(["contacts", "of-company", companyId, term], (cursor) =>
    listContacts({ companyId, search: term || undefined, cursor, limit: 20 }),
  );

  return (
    <div className="space-y-2">
      {total > 10 && (
        <Input aria-label="Pesquisar contactos da empresa" placeholder={`Pesquisar nos ${total} contactos...`} value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      {list.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      {list.isSuccess && list.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{term ? `Nenhum contacto para «${term}».` : "Sem contactos associados."}</p>
      )}
      {list.items.map((contact) => (
        <Link key={contact.id} to={`/contactos/${contact.id}`} className="block rounded-md border border-border p-2 text-sm hover:bg-muted/30">
          <span className="font-medium text-primary">{contact.name}</span>
          {contact.jobTitle && <span className="text-muted-foreground"> · {contact.jobTitle}</span>}
        </Link>
      ))}
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["contacto", "contactos"]} label="Ver mais" />
    </div>
  );
}
