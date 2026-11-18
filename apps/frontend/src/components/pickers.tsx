import { useQuery } from "@tanstack/react-query";
import type { CompanySummary, ContactSummary, UserSummary } from "@opencrm/shared-types";
import { getCompany, listCompanies } from "@/lib/companies-api";
import { getContact, listContacts } from "@/lib/contacts-api";
import { listUsers } from "@/lib/tasks-api";
import { listManagedUsers } from "@/lib/users-api";
import { ROLE_LABELS } from "@/lib/roles";
import { RecordPicker } from "./RecordPicker";

/**
 * Seletores de empresa, contacto e utilizador, todos com pesquisa (docs/plano-seletores-com-pesquisa.md).
 * Empresas e contactos pesquisam no servidor (no máximo PAGE resultados); utilizadores são poucos e filtram-se aqui.
 */
const PAGE = 20;

interface PickerBase<T> {
  id?: string;
  value: string;
  onChange: (id: string, item: T | null) => void;
  /** Nome já conhecido do registo escolhido (evita pedi-lo ao servidor). */
  selectedLabel?: string | null;
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** A forma resumida (lista) e a completa (ficha) têm os campos que o seletor usa. */
type CompanyOption = Pick<CompanySummary, "id" | "name" | "taxId">;
type ContactOption = Pick<ContactSummary, "id" | "name" | "email" | "phone" | "mobilePhone" | "jobTitle" | "companyId" | "company">;

export function CompanyPicker({ emptyLabel = "Nenhuma", ...props }: PickerBase<CompanyOption>) {
  return (
    <RecordPicker<CompanyOption>
      {...props}
      emptyLabel={emptyLabel}
      placeholder="Nome, NIF ou email..."
      queryKey={["companies"]}
      search={(search) => listCompanies({ search: search || undefined, limit: PAGE })}
      resolve={getCompany}
      getId={(c) => c.id}
      getLabel={(c) => c.name}
      getDetail={(c) => (c.taxId ? `NIF ${c.taxId}` : null)}
      pageSize={PAGE}
    />
  );
}

/** `companyId`: só os contactos dessa empresa (ex.: contacto principal de uma lead de empresa). */
export function ContactPicker({ emptyLabel = "Nenhum", companyId, ...props }: PickerBase<ContactOption> & { companyId?: string | null }) {
  return (
    <RecordPicker<ContactOption>
      {...props}
      emptyLabel={emptyLabel}
      placeholder="Nome, email ou telefone..."
      queryKey={["contacts", companyId ?? null]}
      search={(search) => listContacts({ search: search || undefined, companyId: companyId || undefined, limit: PAGE })}
      resolve={getContact}
      getId={(c) => c.id}
      getLabel={(c) => c.name}
      getDetail={(c) => [companyId ? null : c.company?.name, c.email ?? c.phone ?? c.mobilePhone].filter(Boolean).join(" · ") || null}
      pageSize={PAGE}
    />
  );
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Utilizadores: lista curta, já carregada; a pesquisa é local (nome ou email, sem acentos).
 * `includeInactive` (só Administrador): também os desativados — ex.: filtro da auditoria, onde o autor pode já ter saído.
 */
export function UserPicker({
  emptyLabel = "Sem responsável",
  includeInactive = false,
  ...props
}: PickerBase<UserSummary & { active?: boolean }> & { includeInactive?: boolean }) {
  const { data: users } = useQuery<Array<UserSummary & { active?: boolean }>>({
    queryKey: includeInactive ? ["users", "manage"] : ["users"],
    queryFn: includeInactive ? listManagedUsers : listUsers,
    staleTime: 60_000,
  });
  const known = props.value ? users?.find((u) => u.id === props.value)?.name : null;
  return (
    <RecordPicker<UserSummary & { active?: boolean }>
      {...props}
      selectedLabel={props.selectedLabel ?? known}
      emptyLabel={emptyLabel}
      placeholder="Pesquisar utilizador"
      queryKey={["users", includeInactive, users?.length ?? 0]}
      search={async (term) => {
        const list = users ?? [];
        const t = fold(term);
        return t ? list.filter((u) => fold(`${u.name} ${u.email}`).includes(t)) : list;
      }}
      getId={(u) => u.id}
      getLabel={(u) => u.name}
      getDetail={(u) => (u.active === false ? `${ROLE_LABELS[u.role]} · desativado` : ROLE_LABELS[u.role])}
      pageSize={Number.POSITIVE_INFINITY}
    />
  );
}
