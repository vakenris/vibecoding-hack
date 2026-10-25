"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  ArrowUpRight,
  House,
  ListTodo,
  Sparkles,
  Settings,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  Leaf,
  LogOut,
  X,
  CheckCheck,
  Clock3,
  Trophy,
  Bell,
  Trash2,
  ChevronDown,
  CircleHelp,
} from "lucide-react";
import {
  type AppState,
  type Command,
  type CategoryId,
  categories,
  categoryIds,
  applyCommand,
  progress,
  dateKey,
  skill,
  stateSchema,
} from "@/lib/domain";
import { scenarios } from "@/lib/scenarios";
import { demoState } from "@/lib/demo";
import {
  dispatchCommand,
  loadState,
  signOut,
  deleteAccount,
} from "@/app/actions";

import { Brand, CategoryIcon, Tag, Spinner, Modal } from "./ui";
import { AuthScreen, Onboarding } from "./auth";
import { Calendar } from "./calendar";
import { TaskList } from "./task-list";
import { TaskDetail } from "./task-detail";
import { SettingsForm } from "./settings";
import { formatDate } from "@/lib/format";
import { BrandArt } from "./brand-art";

const DEMO_KEY = "lifepilot-demo-v1";
type Tab = "home" | "tasks" | "ideas" | "settings" | "profile";
type Props = {
  cloud: boolean;
  ai: boolean;
  initialState: AppState | null;
  initialError: string;
};
export function LifePilot({ cloud, ai, initialState, initialError }: Props) {
  const [state, setState] = useState<AppState | null>(initialState);
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(initialError);
  const [toast, setToast] = useState("");
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [thought, setThought] = useState("");
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeTask = state?.tasks.find((t) => t.id === taskId);
  const liveAI = ai && !demo;
  const onboarded = state?.profile.onboarded ?? false;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, taskId, onboarded]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function persist(updated: AppState) {
    if (demo) {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(updated));
      } catch {
        setError(
          "Не удалось сохранить демо в браузере. Освободите место или разрешите локальное хранение.",
        );
      }
    }
    setState(updated);
  }
  async function mutate(command: Command): Promise<AppState | null> {
    if (!state || busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        let updated = applyCommand(state, command, scenarios);
        if (command.type !== "tick" && command.type !== "clearHistory")
          updated = applyCommand(
            updated,
            { type: "tick", demo: false },
            scenarios,
          );
        persist(updated);
        return updated;
      }
      const result = await dispatchCommand(command);
      if (result.error || !result.data)
        throw new Error(result.error || "Не удалось сохранить");
      persist(result.data);
      return result.data;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить изменения",
      );
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function callAI(input: Record<string, string>) {
    if (busyRef.current) return;
    if (!liveAI) {
      setError(
        "Для индивидуальных деревьев и рекомендаций нужен подключённый AI API. Готовые сценарии доступны в «Идеях».",
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(65000),
      });
      const result = await response.json();
      if (!response.ok || !result.state)
        throw new Error(result.error || "Не удалось получить ответ");
      persist(result.state);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Время ожидания истекло. Задача сохранена; обновите страницу перед повторным запросом."
          : e instanceof Error
            ? e.message
            : "Ошибка соединения",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function enterDemo() {
    let next = demoState();
    try {
      const saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? "null");
      if (saved) next = stateSchema.parse(saved);
    } catch {
      setError(
        "Демо-данные в браузере имеют неподдерживаемый формат. Откройте демо в другом профиле браузера или удалите ключ lifepilot-demo-v1 через настройки сайта.",
      );
      return;
    }
    next = applyCommand(next, { type: "tick", demo: false }, scenarios);
    setDemo(true);
    setState(next);
    setError("");
  }
  function navigate(next: Tab) {
    setTab(next);
    setTaskId(null);
    setCalendarDate(null);
    setError("");
  }
  async function startScenario(id: string) {
    const taskId = crypto.randomUUID();
    if (
      await mutate({
        type: "scenario",
        id: taskId,
        scenarioId: id,
        date: dateKey(new Date(), state!.profile.timezone),
      })
    ) {
      setTaskId(taskId);
      setTab("tasks");
    }
  }
  async function createThought(e: FormEvent) {
    e.preventDefault();
    if (!thought.trim()) return;
    const id = crypto.randomUUID();
    if (
      await mutate({
        type: "create",
        id,
        title: thought.trim(),
        description: "",
        category: state?.profile.interests[0] ?? "global",
        date: "",
        time: "",
        reminder: true,
        source: "thought",
      })
    ) {
      setThought("");
      setTab("tasks");
      setTaskId(id);
    }
  }
  async function logout() {
    if (!demo) {
      try {
        const result = await signOut();
        if (result.error) {
          setError(result.error);
          return;
        }
      } catch {
        setError("Нет связи с сервером. Не удалось выйти из аккаунта.");
        return;
      }
    }
    setState(null);
    setDemo(false);
    setTaskId(null);
    setTab("home");
  }
  if (!state)
    return (
      <AuthScreen
        cloud={cloud}
        error={error}
        onDemo={enterDemo}
        onLogin={async () => {
          const result = await loadState();
          if (result.data) {
            setState(result.data);
            setDemo(false);
          } else setError(result.error ?? "Не удалось загрузить профиль");
        }}
      />
    );
  if (!state.profile.onboarded)
    return (
      <Onboarding
        state={state}
        demo={demo}
        busy={busy}
        error={error}
        onSave={mutate}
        onBack={logout}
      />
    );

  const today = dateKey(new Date(), state.profile.timezone);
  const firstName = state.profile.name.split(" ")[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand-button"
          onClick={() => navigate("home")}
          aria-label="LifePilot — главная"
        >
          <Brand />
        </button>
        <nav aria-label="Основная навигация">
          {(
            [
              { id: "home", label: "Главная", icon: House },
              { id: "tasks", label: "Мои задачи", icon: ListTodo },
              { id: "ideas", label: "Идеи", icon: Sparkles },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {item.id === "tasks" && <small>{state.tasks.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={21} />
            <span>Настройки</span>
          </button>
          <button className="profile-link" onClick={() => navigate("profile")}>
            <span className="avatar">
              <Leaf size={26} />
            </span>
            <span>
              <strong>{state.profile.name}</strong>
              <small>Мой профиль</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="top-actions">
            {demo && <span className="demo-label">Демо · в этом браузере</span>}
            <button
              className="top-profile"
              aria-label="Открыть мой профиль"
              onClick={() => navigate("profile")}
            >
              <span className="avatar small">
                <Leaf size={19} />
              </span>
              <strong>{firstName}</strong>
              <ChevronDown size={14} />
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert" role="alert">
              <CircleHelp size={20} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Скрыть сообщение"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {activeTask ? (
            <TaskDetail
              key={activeTask.id}
              task={activeTask}
              state={state}
              busy={busy}
              liveAI={liveAI}
              onBack={() => {
                setTaskId(null);
                setTab("tasks");
              }}
              onMutate={mutate}
              onAI={callAI}
              onDelete={async () => {
                if (await mutate({ type: "deleteTask", taskId: activeTask.id }))
                  setTaskId(null);
              }}
            />
          ) : (
            <>
              {tab === "home" && (
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
                      <form onSubmit={createThought} className="thought-form">
                        <label className="sr-only" htmlFor="thought">
                          Твой вопрос или проблема
                        </label>
                        <input
                          id="thought"
                          required
                          maxLength={200}
                          value={thought}
                          onChange={(e) => setThought(e.target.value)}
                          placeholder="Например: хочу сменить работу…"
                        />
                        <button
                          disabled={busy || !thought.trim()}
                          type="submit"
                        >
                          Разобрать <ArrowUpRight size={22} />
                        </button>
                      </form>
                      <div className="thought-orbit" aria-hidden>
                        <BrandArt />
                      </div>
                    </section>
                    <Calendar
                      tasks={state.tasks}
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
                        tasks={state.tasks.filter(
                          (t) => t.date === calendarDate,
                        )}
                        onOpen={setTaskId}
                        empty="На этот день задач нет"
                      />
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
                            onClick={() =>
                              mutate({ type: "dismissNotice", id: n.id })
                            }
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
                            {
                              state.tasks.filter((t) => t.category === id)
                                .length
                            }{" "}
                            задач <ArrowUpRight size={16} />
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}
              {tab === "tasks" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Мои задачи</h1>
                    </div>
                  </div>
                  <div className="task-toolbar">
                    <div className="filters">
                      <button
                        className={filter === "all" ? "chosen" : ""}
                        onClick={() => setFilter("all")}
                      >
                        Все задачи <span>{state.tasks.length}</span>
                      </button>
                      {categoryIds.map((id) => (
                        <button
                          key={id}
                          className={filter === id ? "chosen" : ""}
                          onClick={() => setFilter(id)}
                        >
                          <span
                            className="category-dot"
                            style={{ background: categories[id].color }}
                          />
                          {categories[id].name}
                          <span>
                            {
                              state.tasks.filter((t) => t.category === id)
                                .length
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="search-sort">
                      <label className="search-box">
                        <Search size={18} />
                        <input
                          aria-label="Найти задачу"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Найти задачу"
                        />
                      </label>
                      <label className="sort-box">
                        <SlidersHorizontal size={17} />
                        <select
                          aria-label="Сортировка задач"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="created">Сначала новые</option>
                          <option value="date">По дате</option>
                          <option value="progress">По прогрессу</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <TaskList
                    tasks={state.tasks
                      .filter(
                        (t) =>
                          (filter === "all" || t.category === filter) &&
                          t.title
                            .toLocaleLowerCase("ru")
                            .includes(search.toLocaleLowerCase("ru")),
                      )
                      .toSorted((a, b) =>
                        sort === "date"
                          ? (a.date || "9999").localeCompare(b.date || "9999")
                          : sort === "progress"
                            ? progress(b) - progress(a)
                            : b.createdAt.localeCompare(a.createdAt),
                      )}
                    onOpen={setTaskId}
                    empty="Здесь появятся твои задачи"
                  />
                </>
              )}
              {tab === "ideas" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Идеи для тебя</h1>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => callAI({ action: "ideas" })}
                    >
                      {busy ? <Spinner /> : <Sparkles size={18} />}Предложить
                      идеи
                    </button>
                  </div>
                  <section className="recommendation-section">
                    {!liveAI && (
                      <p className="inline-note">
                        <CircleHelp size={18} />
                        Персональные рекомендации появятся после подключения AI.
                        Ниже — готовые сценарии.
                      </p>
                    )}
                    {liveAI && !state.ideas.length && (
                      <p className="inline-note">
                        Нажми «Предложить идеи», чтобы получить рекомендации по
                        своим целям.
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
                              onClick={() =>
                                mutate({ type: "dismissIdea", id: idea.id })
                              }
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
              )}
              {tab === "profile" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Мой прогресс</h1>
                      <p className="lead">
                        Опыт складывается из реальных попыток.
                      </p>
                    </div>
                    <span className="points-pill">
                      <Trophy size={23} />
                      {state.points} баллов
                    </span>
                  </div>
                  <p className="inline-note">
                    Статусы основаны на твоих отметках и обратной связи. Это
                    самоотчёт, а не независимая проверка навыка.
                  </p>
                  <div className="skills-grid">
                    {scenarios.map((s) => (
                      <article className="skill-card" key={s.id}>
                        <span style={{ color: categories[s.category].color }}>
                          <CategoryIcon id={s.category} />
                        </span>
                        <div>
                          <h3>{s.title}</h3>
                          <p>{skill(state, s.id)}</p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Новое прохождение: ${s.title}`}
                          disabled={busy}
                          onClick={() => startScenario(s.id)}
                        >
                          <Plus size={20} />
                        </button>
                      </article>
                    ))}
                  </div>
                  <h2 className="spaced-heading">Маленькие победы</h2>
                  <div className="achievement-row">
                    {[
                      {
                        id: "first-result",
                        title: "Первый опыт",
                        text: "Завершить сценарий и поделиться результатом",
                      },
                      {
                        id: "two-results",
                        title: "Двигаюсь вперёд",
                        text: "Сохранить результаты двух прохождений",
                      },
                    ].map((a) => (
                      <div
                        className={`achievement ${state.achievements.includes(a.id) ? "earned" : ""}`}
                        key={a.id}
                      >
                        <Trophy size={28} />
                        <h3>{a.title}</h3>
                        <p>{a.text}</p>
                        <small>
                          {state.achievements.includes(a.id)
                            ? "Получено"
                            : "Впереди"}
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {tab === "settings" && (
                <>
                  <div className="page-heading">
                    <div>
                      <h1>Настройки</h1>
                    </div>
                  </div>
                  <SettingsForm
                    state={state}
                    busy={busy}
                    onSave={mutate}
                    onMessage={setToast}
                  />
                  <section className="settings-card">
                    <h2>История и аккаунт</h2>
                    <p className="muted">
                      Очистка истории удаляет диалоги, текст обратной связи и
                      текущие уведомления. Задачи и прогресс сохраняются.
                    </p>
                    <div className="settings-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={async () => {
                          if (await mutate({ type: "clearHistory" }))
                            setToast("История общения очищена");
                        }}
                      >
                        <Trash2 size={17} />
                        Очистить историю
                      </button>
                      <button className="secondary" onClick={logout}>
                        <LogOut size={17} />
                        Выйти
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => setConfirmDelete(true)}
                      >
                        {demo ? "Удалить демо-данные" : "Удалить аккаунт"}
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>LifePilot</span>
          <span>Каждый шаг имеет значение.</span>
        </footer>
      </div>
      {confirmDelete && (
        <Modal
          title={demo ? "Удалить демо-данные?" : "Удалить аккаунт?"}
          onClose={() => setConfirmDelete(false)}
        >
          <p>
            Задачи, диалоги и прогресс будут удалены без возможности
            восстановления.
          </p>
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (demo) {
                  localStorage.removeItem(DEMO_KEY);
                  setConfirmDelete(false);
                  await logout();
                } else {
                  setBusy(true);
                  try {
                    const result = await deleteAccount();
                    if (result.error) setError(result.error);
                    else {
                      setConfirmDelete(false);
                      setState(null);
                      setTaskId(null);
                    }
                  } catch {
                    setError(
                      "Нет связи с сервером. Удаление аккаунта не подтверждено.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              Удалить
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          {toast}
        </div>
      )}
    </div>
  );
}
