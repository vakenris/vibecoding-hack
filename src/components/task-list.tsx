"use client";
import { ChevronRight, Clock3, CheckCheck } from "lucide-react";
import { type Task, categories, progress } from "@/lib/domain";
import { CategoryIcon, Tag, Empty } from "./ui";
import { formatDate } from "@/lib/format";
export function TaskList({
  tasks,
  onOpen,
  empty,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  empty: string;
}) {
  if (!tasks.length)
    return (
      <Empty title={empty}>
        Добавь свой вопрос на главной или выбери готовый сценарий в «Идеях».
      </Empty>
    );
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <button className="task-row" key={t.id} onClick={() => onOpen(t.id)}>
          <span
            className="task-symbol"
            style={{
              background: categories[t.category].tint,
              color: categories[t.category].color,
            }}
          >
            <CategoryIcon id={t.category} size={25} />
          </span>
          <span className="task-copy">
            <strong>{t.title}</strong>
            <span className="task-meta">
              <Tag id={t.category} />
              <span>
                <Clock3 size={13} />
                {t.date ? formatDate(t.date) : "Без даты"}
                {t.time ? `, ${t.time}` : ""}
              </span>
              {t.feedback && (
                <span className="result-badge">
                  <CheckCheck size={14} />
                  Результат сохранён
                </span>
              )}
            </span>
          </span>
          <span className="task-progress">
            <span className="mini-track">
              <span style={{ width: `${progress(t)}%` }} />
            </span>
            <span>{progress(t)}%</span>
          </span>
          <ChevronRight size={19} className="muted" />
        </button>
      ))}
    </div>
  );
}
