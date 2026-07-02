import { NavLink, Outlet } from "react-router-dom";
import { Building2, CheckSquare, KanbanSquare, LayoutDashboard, Mail, Settings, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leads", label: "Leads", icon: UserPlus },
  { to: "/funis", label: "Funis", icon: KanbanSquare },
  { to: "/tarefas", label: "Tarefas", icon: CheckSquare },
  { to: "/email", label: "Email", icon: Mail },
  { to: "/empresas", label: "Empresas", icon: Building2 },
  { to: "/contactos", label: "Contactos", icon: Users },
];

const settingsItems = [
  { to: "/configuracoes/campos-personalizados", label: "Campos Personalizados", icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-background">
        <div className="px-4 py-5">
          <span className="text-lg font-semibold">OpenCRM</span>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {navItems.map(({ to, label, icon: Icon }) => (
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
          <div className="my-2 border-t border-border" />
          {settingsItems.map(({ to, label, icon: Icon }) => (
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
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => logout()}>
            Terminar sessão
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-muted/20 p-6">
        <Outlet />
      </main>
    </div>
  );
}
