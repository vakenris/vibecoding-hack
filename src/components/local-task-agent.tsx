"use client";
import type { LocalDocument, LocalEvent, LocalPlan } from "@/lib/local/types";
import { phaseLabels } from "@/lib/local/types";

export function LocalTaskAgent({
  taskId,
  plan,
  events,
  document,
  timezone,
  busy,
  onAction,
  onDeleteDocument,
}: {
  taskId: string;
  plan?: LocalPlan;
  events: LocalEvent[];
  document?: LocalDocument;
  timezone: string;
  busy: boolean;
  onAction: (input: Record<string, unknown>) => Promise<boolean>;
  onDeleteDocument: (id: string) => Promise<void>;
}) {
  const working =
    plan &&
    [
      "queued",
      "extracting",
      "understanding",
      "tree",
      "choosing",
      "finding",
      "creating",
    ].includes(plan.phase);
  const format = (value: string) =>
    new Intl.DateTimeFormat("ru", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  return (
    <section
      className="settings-card local-agent"
      aria-label="Агент и расписание"
    >
      <h2>{plan ? phaseLabels[plan.phase] : "Расписание шагов"}</h2>
      {plan?.message && <p role="status">{plan.message}</p>}
      {working && (
        <p className="muted" role="status">
          Можно закрыть вкладку: обработка продолжится, пока LifePilot запущен.
        </p>
      )}
      {plan?.meta.explanation && (
        <p>
          <strong>Почему выбран этот путь: </strong>
          {plan.meta.explanation}
        </p>
      )}
      {!plan && (
        <p className="muted">
          Существующая задача ещё не отправлена в календарь.
        </p>
      )}
      {!working && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => onAction({ action: "schedule", taskId })}
        >
          {plan ? "Повторить планирование" : "Запланировать шаги"}
        </button>
      )}
      {events.length > 0 && (
        <ul className="local-event-list">
          {events.map((event) => (
            <li key={`${event.stepId}-${event.start}`}>
              <strong>{event.title}</strong>
              <span>
                {format(event.start)} —{" "}
                {new Intl.DateTimeFormat("ru", {
                  timeStyle: "short",
                  timeZone: timezone,
                }).format(new Date(event.end))}
              </span>
              <small>
                {event.status === "external_deleted"
                  ? "Удалено во внешнем календаре · шаг не выполнен"
                  : event.status === "pending"
                    ? "Ожидает синхронизации"
                    : event.status === "conflict"
                      ? "Событие изменено извне: требуется проверка"
                      : "В календаре"}
              </small>
            </li>
          ))}
        </ul>
      )}
      {events.some((event) => event.status === "external_deleted") && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            onAction({ action: "schedule", taskId, restoreDeleted: true })
          }
        >
          Заново запланировать удалённые события
        </button>
      )}
      {(!working || plan?.phase === "needs_input") && (
        <details open={plan?.phase === "needs_input"}>
          <summary>Уточнить цель, срок или ограничения</summary>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void onAction({
                action: "schedule",
                taskId,
                userContext: String(data.get("context")),
                deadline: String(data.get("deadline")),
              });
            }}
          >
            <label>
              Пояснение
              <textarea
                name="context"
                defaultValue={plan?.meta.userContext ?? ""}
                maxLength={2000}
                placeholder="Что нужно получить, доступное время и ограничения"
              />
            </label>
            <label>
              Явный срок, если он есть
              <input
                name="deadline"
                type="date"
                defaultValue={
                  plan?.meta.explicitDeadline || plan?.meta.goal?.deadline || ""
                }
              />
            </label>
            <button disabled={busy}>Продолжить разбор</button>
          </form>
        </details>
      )}
      {plan?.meta.sourceRemoved && (
        <p className="muted">
          Исходный документ удалён. Цитаты из него удалены; задача и ранее
          подтверждённый срок сохранены.
        </p>
      )}
      {plan?.meta.goal && (
        <details>
          <summary>Источники требований и срока</summary>
          {plan.meta.goal.deadlineSource && (
            <p>
              <strong>Срок: {plan.meta.goal.deadline}</strong>
              <br />
              {plan.meta.goal.deadlineSource.location}: «
              {plan.meta.goal.deadlineSource.quote}»
            </p>
          )}
          {plan.meta.goal.requirements.map((item, index) => (
            <p key={index}>
              {item.text}
              <br />
              <small>
                {item.source.location}: «{item.source.quote}»
              </small>
            </p>
          ))}
          {!plan.meta.goal.requirements.length &&
            !plan.meta.goal.deadlineSource && (
              <p>Явные требования и срок не указаны.</p>
            )}
        </details>
      )}
      {document && (
        <div className="local-attachment">
          <strong>Источник: {document.name}</strong>
          <div className="settings-actions">
            <a
              className="text-button"
              href={`/api/local/documents/${document.id}`}
            >
              Скачать документ
            </a>
            <button
              className="danger-text"
              disabled={busy}
              onClick={() => onDeleteDocument(document.id)}
            >
              Удалить вложение
            </button>
          </div>
          {document.error && <p role="alert">{document.error}</p>}
        </div>
      )}
      {plan && plan.logs.length > 0 && (
        <details>
          <summary>Журнал работы</summary>
          <ol className="local-log">
            {plan.logs.map((log, index) => (
              <li key={index}>
                <strong>
                  {phaseLabels[log.phase as keyof typeof phaseLabels] ??
                    log.phase}
                </strong>
                {log.message && ` · ${log.message}`}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
