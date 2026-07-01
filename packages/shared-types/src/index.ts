export type Role = "ADMIN" | "GESTOR" | "COMERCIAL";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ActivityType = "NOTE" | "CALL" | "EMAIL" | "MEETING" | "FILE";

export interface ActivityLog {
  id: string;
  type: ActivityType;
  content: string;
  contactId: string | null;
  companyId: string | null;
  authorId: string;
  author: { id: string; name: string };
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  taxId: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySummary extends Company {
  _count: { contacts: number };
}

export interface CompanyDetail extends Company {
  contacts: ContactSummary[];
  activities: ActivityLog[];
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  notes: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactSummary extends Contact {
  company?: { id: string; name: string } | null;
}

export interface ContactDetail extends Contact {
  company: { id: string; name: string } | null;
  activities: ActivityLog[];
}
