"use client";
import type { AppState } from "@/lib/domain";
import type { LifePilotController } from "@/hooks/use-life-pilot";
import { ArrowUpRight, X, Bell, Sparkles } from "lucide-react";
import { categories, categoryIds } from "@/lib/domain";
import { Calendar } from "../calendar";
import { ThoughtForm } from "../thought-form";
import { TaskList } from "../task-list";
import { CategoryIcon } from "../ui";
import { formatDate } from "@/lib/format";
import { BrandArt } from "../brand-art";
import { dateKey } from "@/lib/domain";
type Props = { state: AppState; local: boolean } & Pick<
  LifePilotController,
  | "busy"
  | "calendarDate"
  | "setCalendarDate"
  | "thought"
  | "setThought"
  | "attachment"
  | "setAttachment"
  | "setError"
  | "createThought"
  | "localSnapshot"
  | "demo"
  | "mutate"
  | "setTaskId"
  | "setFilter"
  | "navigate"
>;
export function HomeScreen({
  state,
  local,
  busy,
  calendarDate,
  setCalendarDate,
  thought,
  setThought,
  attachment,
  setAttachment,
  setError,
  createThought,
  localSnapshot,
  demo,
  mutate,
  setTaskId,
  setFilter,
  navigate,
}: Props) {
  const today = dateKey(new Date(), state.profile.timezone);
  const firstName = state.profile.name.split(" ")[0];
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <p className="date-line">
            {new Intl.DateTimeFormat("ru", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: state.profile.timezone,
            }).format(new Date())}
          </p>
          <h1>
            Привет, {firstName}
            <span className="greeting-dot">.</span>
          </h1>
        </div>
      </div>
      <div className="home-grid">
        <section className="thought-panel">
          <h2>
            Что сейчас занимает
            <br className="desktop-break" /> твои мысли?
          </h2>
          <ThoughtForm
            local={local}
            createThought={createThought}
            attachment={attachment}
            thought={thought}
            setThought={setThought}
            busy={busy}
            setError={setError}
            setAttachment={setAttachment}
            demo={demo}
          />
          <div className="thought-orbit" aria-hidden>
            <BrandArt />
          </div>
        </section>
        <Calendar
          tasks={state.tasks}
          events={local && !demo ? localSnapshot?.events : undefined}
          timezone={state.profile.timezone}
          today={today}
          onSelect={setCalendarDate}
        />
      </div>
      {calendarDate && (
        <section className="date-tasks">
          <div className="section-heading">
            <div>
              <p className="date-line">Выбранный день</p>
              <h2>{formatDate(calendarDate)}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Скрыть задачи дня"
              onClick={() => setCalendarDate(null)}
            >
              <X />
            </button>
          </div>
          <TaskList
            tasks={state.tasks.filter((t) => t.date === calendarDate)}
            onOpen={setTaskId}
            busy={busy}
            onToggle={(id, done) => {
              mutate({ type: "setDone", taskId: id, done });
            }}
            empty="На этот день задач нет"
          />
          {local && !demo && (
            <div className="local-day-steps">
              {localSnapshot?.events
                .filter(
                  (event) =>
                    ["active", "pending"].includes(event.status) &&
                    dateKey(new Date(event.start), state.profile.timezone) ===
                      calendarDate,
                )
                .sort((a, b) => a.start.localeCompare(b.start))
                .map((event) => {
                  const parent = state.tasks.find(
                    (task) => task.id === event.taskId,
                  );
                  if (!parent) return null;
                  return (
                    <div
                      className="local-day-step"
                      key={`${event.taskId}-${event.stepId}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Выполнить шаг: ${event.title}`}
                        disabled={busy}
                        checked={parent.completed.includes(event.stepId)}
                        onChange={(change) =>
                          void mutate({
                            type: "toggleStep",
                            taskId: event.taskId,
                            stepId: event.stepId,
                            done: change.target.checked,
                          })
                        }
                      />
                      <button
                        className="text-button"
                        onClick={() => setTaskId(event.taskId)}
                      >
                        <strong>{event.title}</strong>
                        <small>
                          {new Intl.DateTimeFormat("ru", {
                            timeStyle: "short",
                            timeZone: state.profile.timezone,
                          }).format(new Date(event.start))}{" "}
                          · {parent.title}
                        </small>
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}
      {state.notices.length > 0 && (
        <section className="notices">
          <div className="section-heading">
            <h2>Небольшая поддержка</h2>
            <Bell size={20} />
          </div>
          {state.notices.map((n) => (
            <div className="notice" key={n.id}>
              <span className="notice-icon">
                <Sparkles size={20} />
              </span>
              <p>{n.text}</p>
              <button
                className="text-button"
                onClick={() => setTaskId(n.taskId)}
              >
                Открыть
              </button>
              <button
                className="icon-button"
                aria-label="Скрыть напоминание"
                onClick={() => mutate({ type: "dismissNotice", id: n.id })}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="category-section">
        <div className="section-heading">
          <h2>Пять сфер твоей жизни</h2>
          <span className="muted">Без сравнений и гонки</span>
        </div>
        <div className="category-grid">
          {categoryIds.map((id) => (
            <button
              className="category-card"
              key={id}
              style={
                {
                  "--category": categories[id].color,
                  "--tint": categories[id].tint,
                } as React.CSSProperties
              }
              onClick={() => {
                setFilter(id);
                navigate("tasks");
              }}
            >
              <span className="category-symbol">
                <CategoryIcon id={id} size={25} />
              </span>
              <strong>{categories[id].name}</strong>
              <span>
                {state.tasks.filter((t) => t.category === id).length} задач{" "}
                <ArrowUpRight size={16} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
