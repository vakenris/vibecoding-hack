"use client";
import { isTaskDone, type Task } from "@/lib/domain";
export function TaskStatus({
  task,
  busy = false,
  onChange,
}: {
  task: Task;
  busy?: boolean;
  onChange: (done: boolean) => void;
}) {
  return (
    <label className="task-status">
      <input
        type="checkbox"
        aria-label={`Сделано: ${task.title}`}
        checked={isTaskDone(task)}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{isTaskDone(task) ? "Сделано" : "Не сделано"}</span>
    </label>
  );
}
