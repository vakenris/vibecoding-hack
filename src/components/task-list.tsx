"use client";
import { ChevronRight, Clock3 } from "lucide-react";
import { type Task, categories, isTaskDone } from "@/lib/domain";
import { CategoryIcon, Tag, Empty } from "./ui";
import { TaskStatus } from "./task-status";
import { formatDate } from "@/lib/format";
export function TaskList({
  tasks,
  onOpen,
  onToggle,
  busy,
  empty,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
  busy: boolean;
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
      {tasks.map((task) => (
        <div
          className={`task-row ${isTaskDone(task) ? "task-done" : ""}`}
          key={task.id}
        >
          <button className="task-open" onClick={() => onOpen(task.id)}>
            <span
              className="task-symbol"
              style={{
                background: categories[task.category].tint,
                color: categories[task.category].color,
              }}
            >
              <CategoryIcon id={task.category} size={25} />
            </span>
            <span className="task-copy">
              <strong>{task.title}</strong>
              <span className="task-meta">
                <Tag id={task.category} />
                <span>
                  <Clock3 size={13} />
                  {task.date ? formatDate(task.date) : "Без даты"}
                  {task.time ? `, ${task.time}` : ""}
                </span>
              </span>
            </span>
            <ChevronRight size={19} className="muted" />
          </button>
          <TaskStatus
            task={task}
            busy={busy}
            onChange={(done) => onToggle(task.id, done)}
          />
        </div>
      ))}
    </div>
  );
}
