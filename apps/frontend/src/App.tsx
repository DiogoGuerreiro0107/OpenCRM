import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { CompaniesListPage } from "@/pages/companies/CompaniesListPage";
import { NewCompanyPage } from "@/pages/companies/NewCompanyPage";
import { CompanyDetailPage } from "@/pages/companies/CompanyDetailPage";
import { ContactsListPage } from "@/pages/contacts/ContactsListPage";
import { NewContactPage } from "@/pages/contacts/NewContactPage";
import { ContactDetailPage } from "@/pages/contacts/ContactDetailPage";
import { DealsBoardPage } from "@/pages/deals/DealsBoardPage";
import { TasksListPage } from "@/pages/tasks/TasksListPage";
import { EmailInboxPage } from "@/pages/email/EmailInboxPage";
import { LeadsListPage } from "@/pages/leads/LeadsListPage";
import { CustomFieldsSettingsPage } from "@/pages/settings/CustomFieldsSettingsPage";
import { EmailTemplatesSettingsPage } from "@/pages/settings/EmailTemplatesSettingsPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/empresas" element={<CompaniesListPage />} />
          <Route path="/empresas/novo" element={<NewCompanyPage />} />
          <Route path="/empresas/:id" element={<CompanyDetailPage />} />
          <Route path="/contactos" element={<ContactsListPage />} />
          <Route path="/contactos/novo" element={<NewContactPage />} />
          <Route path="/contactos/:id" element={<ContactDetailPage />} />
          <Route path="/funis" element={<DealsBoardPage />} />
          <Route path="/tarefas" element={<TasksListPage />} />
          <Route path="/email" element={<EmailInboxPage />} />
          <Route path="/leads" element={<LeadsListPage />} />
          <Route path="/configuracoes/campos-personalizados" element={<CustomFieldsSettingsPage />} />
          <Route path="/configuracoes/templates-email" element={<EmailTemplatesSettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
