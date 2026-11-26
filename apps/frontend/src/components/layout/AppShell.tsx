import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { PasswordDialog } from "@/components/PasswordDialog";
import { changeOwnPassword } from "@/lib/users-api";
import { cn } from "@/lib/utils";
import { useMainMenu, useSettingsMenu } from "@/modules/hooks";
import { TimerIndicator } from "@/components/TimerIndicator";
import { JobAlertsBanner } from "@/components/JobAlertsBanner";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
  );

/**
 * Moldura da aplicação. O menu vem do registo de contribuições (src/modules/, Fase 2c): a secção principal com as
 * preferências do Administrador (Configurações > Menu), as configurações fixas. Cada item só aparece com o módulo
 * ativo e a permissão.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const mainMenu = useMainMenu();
  const settingsItems = useSettingsMenu();
  // Um item cujo destino é o início do de outro item (Tarefas → Visita em /tarefas/tipo/VISITA) só fica ativo no
  // endereço exato; senão ficavam os dois marcados. Os outros continuam ativos nas subpáginas (/empresas/:id).
  const allTargets = mainMenu.flatMap((s) => s.items.map((i) => i.to));
  const exact = (to: string) => allTargets.some((other) => other !== to && other.startsWith(`${to}/`));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-border bg-background">
        <div className="px-4 py-5">
          <span className="text-lg font-semibold">OpenCRM</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2" aria-label="Menu principal">
          {mainMenu.map((section) => (
            <div key={section.group?.id ?? "sem-grupo"} role={section.group ? "group" : undefined} aria-label={section.group?.label} className="space-y-1">
              {section.group && <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.group.label}</p>}
              {section.items.map(({ id, to, label, icon: Icon }) => (
                <NavLink key={id} to={to} end={exact(to)} className={linkClass}>
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          {settingsItems.length > 0 && <div className="my-2 border-t border-border" />}
          {settingsItems.map(({ id, to, label, icon: Icon }) => (
            <NavLink key={id} to={to} className={linkClass}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <TimerIndicator />
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
        <JobAlertsBanner />
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
