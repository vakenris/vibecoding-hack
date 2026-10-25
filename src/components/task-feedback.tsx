"use client";
import { useState } from "react";
import { Check, CheckCheck } from "lucide-react";
import { type Task, type Command } from "@/lib/domain";
export function TaskFeedback({
  task,
  busy,
  onMutate,
}: {
  task: Task;
  busy: boolean;
  onMutate: (command: Command) => Promise<unknown>;
}) {
  const [outcome, setOutcome] = useState<"independent" | "help" | "difficulty">(
    "independent",
  );
  const [text, setText] = useState("");
  if (task.feedback)
    return (
      <section className="task-result saved-feedback">
        <CheckCheck size={25} />
        <div>
          <h3>Результат сохранён</h3>
          <p>
            {
              {
                independent: "Получилось самостоятельно",
                help: "Получилось с помощью",
                difficulty: "Возникли трудности",
              }[task.feedback.outcome]
            }
          </p>
          {task.feedback.text && <p>{task.feedback.text}</p>}
          <small>
            Снятие отметки «Сделано» откроет задачу заново. Этот отзыв останется
            в истории.
          </small>
        </div>
      </section>
    );
  return (
    <form
      className="task-result feedback-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await onMutate({ type: "feedback", taskId: task.id, outcome, text });
      }}
    >
      <h3>Как всё прошло?</h3>
      <p>Если хочешь, сохрани результат и то, что было сложно.</p>
      <label>
        Результат
        <select
          aria-label="Результат выполнения"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        >
          <option value="independent">Получилось самостоятельно</option>
          <option value="help">Получилось с помощью</option>
          <option value="difficulty">Возникли трудности</option>
        </select>
      </label>
      <label>
        Что получилось и что было сложно?
        <textarea
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Можно коротко, своими словами"
        />
      </label>
      <button disabled={busy} type="submit">
        Сохранить результат
        <Check size={18} />
      </button>
    </form>
  );
}
