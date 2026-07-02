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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/empresas" replace />} />
          <Route path="/empresas" element={<CompaniesListPage />} />
          <Route path="/empresas/novo" element={<NewCompanyPage />} />
          <Route path="/empresas/:id" element={<CompanyDetailPage />} />
          <Route path="/contactos" element={<ContactsListPage />} />
          <Route path="/contactos/novo" element={<NewContactPage />} />
          <Route path="/contactos/:id" element={<ContactDetailPage />} />
          <Route path="/funis" element={<DealsBoardPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
