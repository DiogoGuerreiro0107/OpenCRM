import { Company, Contact, Lead } from "@prisma/client";

/**
 * Representações PÚBLICAS (contrato da v1). Escritas à mão, em snake_case, em vez de devolver o modelo da base de
 * dados: uma mudança interna não quebra integrações, e nada sai por engano. Dentro da v1 só se ACRESCENTAM campos.
 */
const iso = (d: Date) => d.toISOString();

export function publicCompany(c: Company) {
  return {
    id: c.id,
    name: c.name,
    legal_name: c.legalName,
    tax_id: c.taxId,
    website: c.website,
    phone: c.phone,
    email: c.email,
    address: c.address,
    postal_code: c.postalCode,
    city: c.city,
    country: c.country,
    status: c.status,
    source: c.source,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export function publicContact(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    mobile_phone: c.mobilePhone,
    job_title: c.jobTitle,
    department: c.department,
    preferred_channel: c.preferredChannel,
    is_decision_maker: c.isDecisionMaker,
    marketing_consent: c.marketingConsent,
    company_id: c.companyId,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export function publicLead(l: Lead) {
  return {
    id: l.id,
    name: l.name,
    company_name: l.companyName,
    phone: l.phone,
    email: l.email,
    source: l.source,
    interest: l.interest,
    status: l.status,
    notes: l.notes,
    created_at: iso(l.createdAt),
    updated_at: iso(l.updatedAt),
  };
}
