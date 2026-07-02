import type { Task } from "@opencrm/shared-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildMonthGrid(current: Date): Date[] {
  const first = startOfMonth(current);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstWeekday);

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    return day;
  });
}

interface MonthCalendarProps {
  month: Date;
  tasks: Task[];
  onMonthChange: (month: Date) => void;
  onDayClick: (dayKey: string) => void;
  onTaskClick: (task: Task) => void;
}

export function MonthCalendar({ month, tasks, onMonthChange, onDayClick, onTaskClick }: MonthCalendarProps) {
  const days = buildMonthGrid(month);
  const tasksByDay = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = toDayKey(new Date(task.dueDate));
    tasksByDay.set(key, [...(tasksByDay.get(key) ?? []), task]);
  }

  const monthLabel = month.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  const todayKey = toDayKey(new Date());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          ←
        </Button>
        <h2 className="text-sm font-semibold capitalize">{monthLabel}</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {WEEKDAYS.map((day) => (
          <div key={day} className="bg-muted/50 p-2 text-center font-medium text-muted-foreground">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const key = toDayKey(day);
          const dayTasks = tasksByDay.get(key) ?? [];
          const isCurrentMonth = day.getMonth() === month.getMonth();
          return (
            <button
              type="button"
              key={key}
              onClick={() => onDayClick(key)}
              className={cn(
                "min-h-24 space-y-1 bg-background p-1.5 text-left align-top hover:bg-muted/30",
                !isCurrentMonth && "bg-muted/20 text-muted-foreground",
              )}
            >
              <span className={cn("text-xs", key === todayKey && "font-bold text-primary")}>{day.getDate()}</span>
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(task);
                    }}
                    className={cn(
                      "truncate rounded px-1 py-0.5 text-[11px]",
                      task.status === "DONE"
                        ? "bg-green-100 text-green-800 line-through"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {task.title}
                  </div>
                ))}
                {dayTasks.length > 3 && (
                  <span className="text-[11px] text-muted-foreground">+{dayTasks.length - 3}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
