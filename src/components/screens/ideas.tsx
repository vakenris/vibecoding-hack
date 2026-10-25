"use client";
import type { AppState } from "@/lib/domain";
import type { LifePilotController } from "@/hooks/use-life-pilot";
import {
  ArrowUpRight,
  Sparkles,
  CircleHelp,
  Plus,
  X,
  Clock3,
} from "lucide-react";
import { categories } from "@/lib/domain";
import { scenarios } from "@/lib/scenarios";
import { Tag, Spinner, CategoryIcon } from "../ui";
type Props = { state: AppState } & Pick<
  LifePilotController,
  | "busy"
  | "liveAI"
  | "callAI"
  | "mutate"
  | "setTaskId"
  | "setTab"
  | "startScenario"
>;
export function IdeasScreen({
  state,
  busy,
  liveAI,
  callAI,
  mutate,
  setTaskId,
  setTab,
  startScenario,
}: Props) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Идеи для тебя</h1>
        </div>
        <button disabled={busy} onClick={() => callAI({ action: "ideas" })}>
          {busy ? <Spinner /> : <Sparkles size={18} />}Предложить идеи
        </button>
      </div>
      <section className="recommendation-section">
        {!liveAI && (
          <p className="inline-note">
            <CircleHelp size={18} />
            Персональные рекомендации появятся после подключения AI. Ниже —
            готовые сценарии.
          </p>
        )}
        {liveAI && !state.ideas.length && (
          <p className="inline-note">
            Нажми «Предложить идеи», чтобы получить рекомендации по своим целям.
          </p>
        )}
        <div className="idea-grid">
          {state.ideas.map((idea) => (
            <article className="idea-card" key={idea.id}>
              <Tag id={idea.category} />
              <h3>{idea.title}</h3>
              <p>{idea.description}</p>
              <div className="idea-reason">
                <Sparkles size={16} />
                {idea.reason}
              </div>
              <div className="card-actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    const id = crypto.randomUUID();
                    if (
                      await mutate({
                        type: "acceptIdea",
                        id: idea.id,
                        taskId: id,
                      })
                    ) {
                      setTaskId(id);
                      setTab("tasks");
                    }
                  }}
                >
                  Добавить в задачи
                  <Plus size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Отклонить: ${idea.title}`}
                  disabled={busy}
                  onClick={() => mutate({ type: "dismissIdea", id: idea.id })}
                >
                  <X size={19} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h2>Готовые жизненные сценарии</h2>
          <span className="muted">Выбери, с чего начать</span>
        </div>
        <div className="scenario-grid">
          {scenarios.map((s) => (
            <article className="scenario-card" key={s.id}>
              <div className="scenario-top">
                <span
                  className="scenario-symbol"
                  style={{
                    color: categories[s.category].color,
                    background: categories[s.category].tint,
                  }}
                >
                  <CategoryIcon id={s.category} size={28} />
                </span>
                <span className="duration">
                  <Clock3 size={14} />
                  {s.duration}
                </span>
              </div>
              <Tag id={s.category} />
              <h3>{s.title}</h3>
              <p>{s.description}</p>
              <button
                className="scenario-start"
                disabled={busy}
                onClick={() => startScenario(s.id)}
              >
                Начать сценарий
                <ArrowUpRight size={21} />
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
