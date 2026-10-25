"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  type AppState,
  type Task,
  type Command,
  type CategoryId,
  categories,
  categoryIds,
  activePath,
  activeSteps,
  progress,
} from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { Tag, Spinner, Modal } from "./ui";
import { BrandArt } from "./brand-art";
export function TaskDetail({
  task,
  state,
  busy,
  liveAI,
  onBack,
  onMutate,
  onAI,
  onDelete,
}: {
  task: Task;
  state: AppState;
  busy: boolean;
  liveAI: boolean;
  onBack: () => void;
  onMutate: (command: Command) => Promise<AppState | null>;
  onAI: (input: Record<string, string>) => Promise<void>;
  onDelete: () => void;
}) {
  const path = activePath(task);
  const steps = activeSteps(task);
  const percentage = progress(task);
  const [mentor, setMentor] = useState(false);
  const [message, setMessage] = useState("");
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [outcome, setOutcome] = useState<"independent" | "help" | "difficulty">(
    "independent",
  );
  const [feedback, setFeedback] = useState("");
  const messages = state.messages[task.id] ?? [];
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    if (liveAI) {
      const text = message;
      setMessage("");
      await onAI({ action: "mentor", taskId: task.id, message: text });
    } else {
      if (
        await onMutate({ type: "mentorDemo", taskId: task.id, text: message })
      )
        setMessage("");
    }
  }
  return (
    <div className="task-detail">
      <div className="detail-top">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} />
          Ко всем задачам
        </button>
        <div className="detail-top-actions">
          <Tag id={task.category} />
          {task.date && (
            <span className="muted detail-date">
              <CalendarDays size={15} />
              {formatDate(task.date)}
            </span>
          )}
        </div>
        <button
          className="icon-button detail-delete"
          aria-label="Удалить задачу"
          onClick={() => setDeletePrompt(true)}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <section className="progress-panel">
        <div>
          <strong>Твой прогресс</strong>
          <span>
            <b>{percentage}</b> из 100%
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Прогресс задачи"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <span style={{ width: `${percentage}%` }} />
        </div>
      </section>
      <div className="section-heading tree-heading">
        <h2>Дерево решений</h2>
        <button
          className="secondary compact"
          onClick={() => setMentor(!mentor)}
        >
          <Sparkles size={17} />
          Наставник{mentor ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>
      {task.tree ? (
        <section className="decision-tree" aria-label="Дерево решений">
          <div className="tree-root">
            <BrandArt />
            <h1>{task.title}</h1>
          </div>
          {path
            .filter((n) => n.children.length > 0)
            .map((node, index) => (
              <div className="tree-level" key={node.id} data-level={index}>
                <div className="tree-connector" aria-hidden />
                {node.question && (
                  <p className="branch-question">{node.question}</p>
                )}
                <div className="branch-grid">
                  {node.children.map((id) => {
                    const child = task.tree!.nodes.find((n) => n.id === id)!;
                    const selected = task.selected[node.id] === id;
                    return (
                      <button
                        key={id}
                        disabled={busy || Boolean(task.feedback)}
                        className={`branch-card ${selected ? "selected" : ""} ${task.selected[node.id] && !selected ? "not-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() =>
                          onMutate({
                            type: "select",
                            taskId: task.id,
                            parent: node.id,
                            child: id,
                          })
                        }
                      >
                        <div className="branch-title">
                          <h3>{child.title}</h3>
                          <span className="choice-mark">
                            {selected ? (
                              <Check size={17} />
                            ) : (
                              <ArrowUpRight size={19} />
                            )}
                          </span>
                        </div>
                        {child.pros.length > 0 && (
                          <div className="branch-copy">
                            <span className="branch-label">Что хорошего</span>
                            {child.pros.map((p) => (
                              <p key={p}>
                                <span className="plus">+</span>
                                {p}
                              </p>
                            ))}
                          </div>
                        )}
                        {child.risks.length > 0 && (
                          <div className="branch-copy">
                            <span className="branch-label">
                              Риски и сложности
                            </span>
                            {child.risks.map((r) => (
                              <p key={r}>
                                <span className="minus">−</span>
                                {r}
                              </p>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          {steps.length > 0 && (
            <section className="checklist">
              <div className="section-heading">
                <div>
                  <p className="date-line">Твой план действий</p>
                  <h2>Теперь — по шагам</h2>
                </div>
                <span className="step-count">
                  {steps.filter((s) => task.completed.includes(s.id)).length} /{" "}
                  {steps.length}
                </span>
              </div>
              {steps.map((step, index) => (
                <div
                  className={`checklist-row ${task.completed.includes(step.id) ? "done" : ""}`}
                  key={step.id}
                >
                  <button
                    className="step-check"
                    aria-label={`Выполнено: ${step.title}`}
                    aria-pressed={task.completed.includes(step.id)}
                    disabled={
                      busy ||
                      task.completed.includes(step.id) ||
                      Boolean(task.feedback)
                    }
                    onClick={() =>
                      onMutate({
                        type: "complete",
                        taskId: task.id,
                        stepId: step.id,
                      })
                    }
                  >
                    {task.completed.includes(step.id) ? (
                      <Check size={20} />
                    ) : (
                      index + 1
                    )}
                  </button>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.hint}</p>
                  </div>
                </div>
              ))}
              {percentage === 100 &&
                (task.feedback ? (
                  <div className="saved-feedback">
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
                        Для следующей попытки начни новое прохождение в «Идеях».
                      </small>
                    </div>
                  </div>
                ) : (
                  <form
                    className="feedback-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      onMutate({
                        type: "feedback",
                        taskId: task.id,
                        outcome,
                        text: feedback,
                      });
                    }}
                  >
                    <h3>Как всё прошло?</h3>
                    <p>Твоя оценка поможет увидеть собственный опыт.</p>
                    <label>
                      Результат
                      <select
                        value={outcome}
                        onChange={(e) =>
                          setOutcome(e.target.value as typeof outcome)
                        }
                      >
                        <option value="independent">
                          Получилось самостоятельно
                        </option>
                        <option value="help">Получилось с помощью</option>
                        <option value="difficulty">Возникли трудности</option>
                      </select>
                    </label>
                    <label>
                      Что получилось и что было сложно?
                      <textarea
                        maxLength={2000}
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="Можно коротко, своими словами"
                      />
                    </label>
                    <button disabled={busy} type="submit">
                      Сохранить результат
                      <Check size={18} />
                    </button>
                  </form>
                ))}
            </section>
          )}
        </section>
      ) : (
        <section className="unbuilt-task">
          <div className="tree-root">
            <BrandArt />
            <h1>{task.title}</h1>
          </div>
          <p>
            {task.description ||
              "Из одного вопроса может вырасти понятный план."}
          </p>
          <form
            className="clarification-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              onAI({
                action: "tree",
                taskId: task.id,
                clarification: `Желаемый результат: ${data.get("goal")}. Срок: ${data.get("deadline")}. Ограничения: ${data.get("limits")}.`,
              });
            }}
          >
            <h2>Что важно учесть?</h2>
            <label>
              Сфера жизни
              <select
                aria-label="Сфера жизни"
                value={task.category}
                disabled={busy}
                onChange={(e) =>
                  onMutate({
                    type: "category",
                    taskId: task.id,
                    category: e.target.value as CategoryId,
                  })
                }
              >
                {categoryIds.map((id) => (
                  <option value={id} key={id}>
                    {categories[id].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Какой результат хочешь получить?
              <input
                name="goal"
                required
                maxLength={1000}
                placeholder="Опиши, что будет хорошим результатом"
              />
            </label>
            <div className="form-columns">
              <label>
                Когда это нужно?
                <input
                  name="deadline"
                  required
                  maxLength={200}
                  placeholder="Например, через две недели"
                />
              </label>
              <label>
                Какие есть ограничения?
                <input
                  name="limits"
                  required
                  maxLength={1000}
                  placeholder="Время, бюджет, опыт…"
                />
              </label>
            </div>
            {!liveAI && (
              <p className="inline-note">
                Индивидуальное дерево требует подключённого AI. Задача уже
                сохранена; пока можно пройти готовый сценарий в «Идеях».
              </p>
            )}
            <button type="submit" disabled={busy || !liveAI}>
              {busy ? <Spinner /> : <Sparkles size={18} />}Построить дерево
              решений
            </button>
          </form>
        </section>
      )}
      {mentor && (
        <section className="mentor-panel">
          <header>
            <div>
              <Sparkles size={21} />
              <h2>Твой наставник</h2>
            </div>
            <span className="demo-label">
              {liveAI
                ? "AI · контекст этой задачи"
                : "Демо · подготовленные ответы"}
            </span>
          </header>
          <p className="muted">
            {percentage === 100
              ? "Поделись результатом и обсуди следующий шаг."
              : "Спроси о подготовке или ближайшем действии."}
          </p>
          <div className="messages" aria-live="polite">
            {messages.map((m, i) => (
              <div className={`message ${m.role}`} key={i}>
                <small>{m.role === "user" ? "Ты" : "LifePilot"}</small>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={send}>
            <label className="sr-only" htmlFor="mentor-message">
              Сообщение наставнику
            </label>
            <input
              id="mentor-message"
              value={message}
              maxLength={2000}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Что хочется уточнить?"
              required
            />
            <button
              aria-label="Отправить сообщение"
              disabled={busy || !message.trim()}
              type="submit"
            >
              {busy ? <Spinner /> : <Send size={19} />}
            </button>
          </form>
        </section>
      )}
      {deletePrompt && (
        <Modal title="Удалить задачу?" onClose={() => setDeletePrompt(false)}>
          <p>
            План и диалог этой задачи будут удалены. Уже заработанные баллы
            сохранятся.
          </p>
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setDeletePrompt(false)}
            >
              Отмена
            </button>
            <button className="danger" disabled={busy} onClick={onDelete}>
              Удалить задачу
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
