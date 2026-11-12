import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Building2, CheckSquare, FileText, KanbanSquare, LayoutDashboard, KeyRound, Mail, Phone, Puzzle, ScrollText, Settings, UserCog, UserPlus, Users, Zap, type LucideIcon } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { PasswordDialog } from "@/components/PasswordDialog";
import { changeOwnPassword } from "@/lib/users-api";
import { cn } from "@/lib/utils";
import { ADMIN_ONLY, EMAIL_TEMPLATE_MANAGERS, hasRole } from "@/lib/permissions";
import { useModules } from "@/lib/useModules";
import type { ModuleId } from "@/lib/modules-api";
import type { Role } from "@opencrm/shared-types";

// `module`: módulo opcional de que o item depende (sem ele, o item não aparece).
const navItems: Array<{ to: string; label: string; icon: LucideIcon; module?: ModuleId }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: UserPlus, module: "leads" },
  { to: "/funis", label: "Funis", icon: KanbanSquare, module: "deals" },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/email", label: "Email", icon: Mail, module: "email" },
  { to: "/empresas", label: "Empresas", icon: Building2 },
  { to: "/contactos", label: "Contactos", icon: Users },
];

// `roles`: papéis que veem o item (têm de coincidir com as <RequireRole> em App.tsx e com o backend).
const settingsItems: Array<{ to: string; label: string; icon: LucideIcon; roles: Role[]; module?: ModuleId }> = [
  { to: "/configuracoes/campos-personalizados", label: "Campos Personalizados", icon: Settings, roles: ADMIN_ONLY },
  { to: "/configuracoes/templates-email", label: "Templates de Email", icon: FileText, roles: EMAIL_TEMPLATE_MANAGERS, module: "email" },
  { to: "/configuracoes/automacoes", label: "Automações", icon: Zap, roles: ADMIN_ONLY, module: "automations" },
  { to: "/configuracoes/utilizadores", label: "Utilizadores", icon: UserCog, roles: ADMIN_ONLY },
  { to: "/configuracoes/zadarma", label: "Zadarma", icon: Phone, roles: ADMIN_ONLY, module: "zadarma" },
  { to: "/configuracoes/modulos", label: "Módulos", icon: Puzzle, roles: ADMIN_ONLY },
  { to: "/configuracoes/chaves-api", label: "Chaves de API", icon: KeyRound, roles: ADMIN_ONLY },
  { to: "/configuracoes/auditoria", label: "Auditoria", icon: ScrollText, roles: ADMIN_ONLY },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const { enabled: enabledModules } = useModules();
  const moduleOn = (id?: ModuleId) => !id || enabledModules.has(id);
  const visibleNavItems = navItems.filter((item) => moduleOn(item.module));
  const visibleSettingsItems = settingsItems.filter((item) => hasRole(user?.role, item.roles) && moduleOn(item.module));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-background">
        <div className="px-4 py-5">
          <span className="text-lg font-semibold">OpenCRM</span>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
          {visibleSettingsItems.length > 0 && <div className="my-2 border-t border-border" />}
          {visibleSettingsItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.role}</p>
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setIsPasswordOpen(true)}>
            Alterar password
          </Button>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => logout()}>
            Terminar sessão
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-muted/20 p-6">
        <Outlet />
      </main>
      {isPasswordOpen && (
        <PasswordDialog
          open
          onClose={() => setIsPasswordOpen(false)}
          title="Alterar a minha password"
          description="As tuas outras sessões abertas terminam; esta continua."
          askCurrentPassword
          onSubmit={({ currentPassword, newPassword }) => changeOwnPassword(currentPassword, newPassword)}
        />
      )}
    </div>
  );
}
