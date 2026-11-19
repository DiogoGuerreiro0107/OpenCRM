import { Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RequireRole } from "@/components/RequireRole";
import { RequireModule } from "@/components/RequireModule";
import { RequireWrite } from "@/components/RequireWrite";
import { AppShell } from "@/components/layout/AppShell";
import { ROUTE_CONTRIBUTIONS } from "@/modules/registry";
import type { RouteContribution } from "@/modules/types";

/**
 * As rotas das páginas vêm do registo de contribuições (src/modules/, Fase 2c): cada uma com as mesmas guardas que o
 * seu item de menu (módulo, papel ou área de escrita) e carregada à parte. O backend continua a impor tudo em cada pedido.
 */
function guarded({ page: Page, module, roles, writeArea }: RouteContribution): ReactNode {
  let element: ReactNode = <Page />;
  if (module) element = <RequireModule id={module}>{element}</RequireModule>;
  if (roles) element = <RequireRole roles={roles}>{element}</RequireRole>;
  if (writeArea) element = <RequireWrite area={writeArea}>{element}</RequireWrite>;
  return element;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/esqueci-a-password" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {ROUTE_CONTRIBUTIONS.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={<Suspense fallback={<p className="text-muted-foreground">A carregar...</p>}>{guarded(route)}</Suspense>}
            />
          ))}
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
