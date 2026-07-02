import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { getDashboardSummary } from "@/lib/dashboard-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

interface KpiCardProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function KpiCard({ label, value, highlight }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-semibold", highlight && "text-red-600")}>{value}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
    refetchInterval: 60000,
  });

  if (isLoading || !data) return <p className="text-muted-foreground">A carregar...</p>;

  const chartData = data.pipelines.map((p) => ({
    name: p.name,
    Abertos: p.open,
    Ganhos: p.won,
    Perdidos: p.lost,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Empresas" value={data.companiesTotal} />
        <KpiCard label="Contactos" value={data.contactsTotal} />
        <KpiCard label="Leads novos" value={data.leadsNew} />
        <KpiCard label="Valor em aberto" value={formatCurrency(data.openValue)} />
        <KpiCard label="Oportunidades abertas" value={data.dealsOpen} />
        <KpiCard label="Oportunidades ganhas" value={data.dealsWon} />
        <KpiCard label="Oportunidades perdidas" value={data.dealsLost} />
        <KpiCard
          label={`Paradas (>${data.staleDealDays}d)`}
          value={data.staleDeals}
          highlight={data.staleDeals > 0}
        />
        <KpiCard label="Tarefas de hoje" value={data.tasksToday} />
        <KpiCard label="Tarefas atrasadas" value={data.tasksOverdue} highlight={data.tasksOverdue > 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Oportunidades por funil</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda não existem funis.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Abertos" fill="hsl(222 89% 55%)" />
                  <Bar dataKey="Ganhos" fill="#16a34a" />
                  <Bar dataKey="Perdidos" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-4 space-y-1">
            {data.pipelines.map((p) => (
              <p key={p.id} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{p.name}</span>: taxa de conversão {p.conversionRate}%
                ({p.won} ganhas de {p.won + p.lost} fechadas)
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
