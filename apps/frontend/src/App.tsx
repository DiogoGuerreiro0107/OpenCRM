import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequireRole } from "@/components/RequireRole";
import { RequireModule } from "@/components/RequireModule";
import { ModulesSettingsPage } from "@/pages/settings/ModulesSettingsPage";
import { ADMIN_ONLY, EMAIL_TEMPLATE_MANAGERS } from "@/lib/permissions";
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
import { AutomationsSettingsPage } from "@/pages/settings/AutomationsSettingsPage";
import { ZadarmaSettingsPage } from "@/pages/settings/ZadarmaSettingsPage";
import { UsersSettingsPage } from "@/pages/settings/UsersSettingsPage";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/esqueci-a-password" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-password" element={<ResetPasswordPage />} />

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
          <Route path="/funis" element={<RequireModule id="deals"><DealsBoardPage /></RequireModule>} />
          <Route path="/tarefas" element={<TasksListPage />} />
          <Route path="/email" element={<RequireModule id="email"><EmailInboxPage /></RequireModule>} />
          <Route path="/leads" element={<RequireModule id="leads"><LeadsListPage /></RequireModule>} />
          <Route path="/configuracoes/campos-personalizados" element={<RequireRole roles={ADMIN_ONLY}><CustomFieldsSettingsPage /></RequireRole>} />
          <Route path="/configuracoes/templates-email" element={<RequireRole roles={EMAIL_TEMPLATE_MANAGERS}><RequireModule id="email"><EmailTemplatesSettingsPage /></RequireModule></RequireRole>} />
          <Route path="/configuracoes/automacoes" element={<RequireRole roles={ADMIN_ONLY}><RequireModule id="automations"><AutomationsSettingsPage /></RequireModule></RequireRole>} />
          <Route path="/configuracoes/modulos" element={<RequireRole roles={ADMIN_ONLY}><ModulesSettingsPage /></RequireRole>} />
          <Route
            path="/configuracoes/utilizadores"
            element={
              <RequireRole roles={ADMIN_ONLY}>
                <UsersSettingsPage />
              </RequireRole>
            }
          />
          <Route path="/configuracoes/zadarma" element={<RequireRole roles={ADMIN_ONLY}><RequireModule id="zadarma"><ZadarmaSettingsPage /></RequireModule></RequireRole>} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
