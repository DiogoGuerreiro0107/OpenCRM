import {
  Banknote, Bell, Briefcase, Building2, Calendar, Camera, CheckSquare, CircleDot, ClipboardList, Clock, FileText, Flag,
  Hammer, Handshake, Headphones, Laptop, Mail, MapPin, MessageSquare, Monitor, Package, Phone, Printer, Receipt,
  ShoppingCart, Star, Truck, User, Users, Wrench, type LucideIcon,
} from "lucide-react";
import type { WorkItemTypeSummary } from "@opencrm/shared-types";
import { cn } from "@/lib/utils";

/**
 * Ícones e cores dos tipos de tarefa (Fase 2a). Listas fechadas, iguais às do backend
 * (src/work-item-types/system-types.ts): a base de dados guarda só o nome, nunca SVG ou CSS.
 */
export const WORK_ITEM_ICONS: Record<string, LucideIcon> = {
  "check-square": CheckSquare, phone: Phone, mail: Mail, "map-pin": MapPin, "file-text": FileText, banknote: Banknote,
  wrench: Wrench, "circle-dot": CircleDot, calendar: Calendar, clock: Clock, truck: Truck, package: Package,
  "clipboard-list": ClipboardList, users: Users, user: User, star: Star, flag: Flag, "shopping-cart": ShoppingCart,
  printer: Printer, monitor: Monitor, laptop: Laptop, "building-2": Building2, handshake: Handshake,
  headphones: Headphones, hammer: Hammer, receipt: Receipt, bell: Bell, briefcase: Briefcase,
  "message-square": MessageSquare, camera: Camera,
};

/** Classes por cor (escritas por extenso para o Tailwind as encontrar). */
export const WORK_ITEM_COLORS: Record<string, { label: string; badge: string; dot: string }> = {
  slate: { label: "Ardósia", badge: "bg-slate-100 text-slate-800 border-slate-200", dot: "bg-slate-500" },
  gray: { label: "Cinzento", badge: "bg-gray-100 text-gray-800 border-gray-200", dot: "bg-gray-500" },
  red: { label: "Vermelho", badge: "bg-red-100 text-red-800 border-red-200", dot: "bg-red-500" },
  orange: { label: "Laranja", badge: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  amber: { label: "Âmbar", badge: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  yellow: { label: "Amarelo", badge: "bg-yellow-100 text-yellow-800 border-yellow-200", dot: "bg-yellow-500" },
  green: { label: "Verde", badge: "bg-green-100 text-green-800 border-green-200", dot: "bg-green-500" },
  teal: { label: "Azul-petróleo", badge: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  blue: { label: "Azul", badge: "bg-blue-100 text-blue-800 border-blue-200", dot: "bg-blue-500" },
  indigo: { label: "Índigo", badge: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  violet: { label: "Violeta", badge: "bg-violet-100 text-violet-800 border-violet-200", dot: "bg-violet-500" },
  pink: { label: "Rosa", badge: "bg-pink-100 text-pink-800 border-pink-200", dot: "bg-pink-500" },
};

export function workItemIcon(name: string): LucideIcon {
  return WORK_ITEM_ICONS[name] ?? CircleDot;
}

export function workItemColor(name: string) {
  return WORK_ITEM_COLORS[name] ?? WORK_ITEM_COLORS.gray;
}

/** Etiqueta do tipo de uma tarefa: ícone e nome, na cor do tipo. */
export function WorkItemTypeBadge({ type, className }: { type: WorkItemTypeSummary; className?: string }) {
  const Icon = workItemIcon(type.icon);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium", workItemColor(type.color).badge, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {type.name}
    </span>
  );
}
