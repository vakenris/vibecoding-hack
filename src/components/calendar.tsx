"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Task, categories, categoryIds, dateKey } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import type { LocalEvent } from "@/lib/local/types";
export function Calendar({
  tasks,
  today,
  onSelect,
  events = [],
  timezone,
}: {
  tasks: Task[];
  today: string;
  onSelect: (date: string) => void;
  events?: LocalEvent[];
  timezone?: string;
}) {
  const [month, setMonth] = useState(() => new Date(today + "T12:00:00"));
  const [selected, setSelected] = useState(today);
  const year = month.getFullYear();
  const m = month.getMonth();
  const offset = (new Date(year, m, 1).getDay() + 6) % 7;
  const days = new Date(year, m + 1, 0).getDate();
  return (
    <section className="calendar" aria-label="Календарь задач">
      <header>
        <h2>
          {new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" })
            .format(month)
            .replace(" г.", "")}
        </h2>
        <div>
          <button
            className="icon-button"
            aria-label="Предыдущий месяц"
            onClick={() => setMonth(new Date(year, m - 1, 1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Следующий месяц"
            onClick={() => setMonth(new Date(year, m + 1, 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>
      <div className="calendar-grid">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <span className="weekday" key={d}>
            {d}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = dateKey(new Date(year, m, i + 1));
          const ids = [
            ...new Set(
              tasks
                .filter(
                  (t) =>
                    t.date === date ||
                    events.some(
                      (e) =>
                        e.taskId === t.id &&
                        ["active", "pending"].includes(e.status) &&
                        dateKey(new Date(e.start), timezone) === date,
                    ),
                )
                .map((t) => t.category),
            ),
          ];
          return (
            <button
              className={`calendar-day ${date === today ? "today" : ""} ${date === selected ? "selected" : ""}`}
              key={date}
              aria-label={`${formatDate(date)}, задач: ${tasks.filter((t) => t.date === date).length}, шагов: ${events.filter((e) => ["active", "pending"].includes(e.status) && dateKey(new Date(e.start), timezone) === date).length}`}
              aria-pressed={date === selected}
              onClick={() => {
                setSelected(date);
                onSelect(date);
              }}
            >
              <span>{i + 1}</span>
              <span className="day-dots">
                {ids.map((id) => (
                  <i key={id} style={{ background: categories[id].color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        {categoryIds.map((id) => (
          <span key={id} title={categories[id].name}>
            <i style={{ background: categories[id].color }} />
            {
              {
                global: "Решения",
                career: "Учёба",
                home: "Быт",
                social: "Общение",
                money: "Финансы",
              }[id]
            }
          </span>
        ))}
      </div>
    </section>
  );
}
