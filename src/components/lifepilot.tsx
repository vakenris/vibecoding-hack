"use client";
import { HomeScreen } from "./screens/home";
import { ProfileScreen } from "./screens/profile";
import { IdeasScreen } from "./screens/ideas";
import { TasksScreen } from "./screens/tasks";

import { useLifePilot, type LifePilotProps } from "@/hooks/use-life-pilot";
import {
  House,
  ListTodo,
  Sparkles,
  Settings,
  ChevronRight,
  Leaf,
  LogOut,
  X,
  CheckCheck,
  Trash2,
  ChevronDown,
  CircleHelp,
} from "lucide-react";
import { Brand, Modal } from "./ui";
import { AuthScreen, Onboarding } from "./auth";
import { TaskDetail } from "./task-detail";
import { SettingsForm } from "./settings";
import { LocalSettings } from "./local-settings";

export function LifePilot(props: LifePilotProps) {
  const { local, cloud, ai } = props;
  const {
    state,
    demo,
    tab,
    setTab,
    setTaskId,
    busy,
    error,
    setError,
    toast,
    setToast,
    calendarDate,
    setCalendarDate,
    thought,
    setThought,
    attachment,
    setAttachment,
    localSnapshot,
    savedDemo,
    setSavedDemo,
    filter,
    setFilter,
    search,
    setSearch,
    sort,
    setSort,
    confirmDelete,
    setConfirmDelete,
    activeTask,
    liveAI,
    aiNotice,
    mutate,
    callAI,
    enterDemo,
    navigate,
    startScenario,
    createThought,
    logout,
    localAction,
    deleteAttachment,
    login,
    removeAccount,
  } = useLifePilot(props);
  if (!state)
    return (
      <AuthScreen
        local={local}
        cloud={cloud}
        error={error}
        onDemo={enterDemo}
        onLogin={login}
      />
    );
  const firstName = state.profile.name.split(" ")[0];
  const importPrompt =
    local &&
    !demo &&
    savedDemo &&
    !state.tasks.length &&
    !localSnapshot?.importedDemo ? (
      <aside className="local-import">
        <p>
          В этом браузере есть сохранённое демо. Перенести его в пустой
          локальный профиль? Копия в браузере сохранится.
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            if (await localAction({ action: "import", state: savedDemo }))
              setSavedDemo(null);
          }}
        >
          Перенести демо
        </button>
        <button className="secondary" onClick={() => setSavedDemo(null)}>
          Начать с пустого профиля
        </button>
      </aside>
    ) : null;
  if (!state.profile.onboarded)
    return (
      <>
        {importPrompt}
        <Onboarding
          state={state}
          demo={demo}
          busy={busy}
          error={error}
          onSave={mutate}
          onBack={logout}
        />
      </>
    );

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
              aria-label={item.label}
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
            aria-label="Настройки"
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
            {local && !demo && (
              <span className="demo-label">Локальный профиль</span>
            )}
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
          {importPrompt}
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
              onRestart={() => {
                if (activeTask.scenarioId) startScenario(activeTask.scenarioId);
              }}
              localSnapshot={local && !demo ? localSnapshot : undefined}
              onLocalAction={localAction}
              onDeleteDocument={deleteAttachment}
              aiNotice={aiNotice}
              onDelete={async () => {
                if (await mutate({ type: "deleteTask", taskId: activeTask.id }))
                  setTaskId(null);
              }}
            />
          ) : (
            <>
              {tab === "home" && (
                <HomeScreen
                  state={state}
                  local={local}
                  busy={busy}
                  calendarDate={calendarDate}
                  setCalendarDate={setCalendarDate}
                  thought={thought}
                  setThought={setThought}
                  attachment={attachment}
                  setAttachment={setAttachment}
                  setError={setError}
                  createThought={createThought}
                  localSnapshot={localSnapshot}
                  demo={demo}
                  mutate={mutate}
                  setTaskId={setTaskId}
                  setFilter={setFilter}
                  navigate={navigate}
                />
              )}
              {tab === "tasks" && (
                <TasksScreen
                  state={state}
                  busy={busy}
                  filter={filter}
                  setFilter={setFilter}
                  search={search}
                  setSearch={setSearch}
                  sort={sort}
                  setSort={setSort}
                  setTaskId={setTaskId}
                  mutate={mutate}
                />
              )}
              {tab === "ideas" && (
                <IdeasScreen
                  state={state}
                  busy={busy}
                  liveAI={liveAI}
                  callAI={callAI}
                  mutate={mutate}
                  setTaskId={setTaskId}
                  setTab={setTab}
                  startScenario={startScenario}
                />
              )}
              {tab === "profile" && <ProfileScreen state={state} />}
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
                  {local && !demo && localSnapshot && (
                    <LocalSettings
                      aiConfigured={ai}
                      snapshot={localSnapshot}
                      busy={busy}
                      onAction={localAction}
                    />
                  )}
                  <section className="settings-card">
                    <h2>История и аккаунт</h2>
                    <p className="muted">
                      Очистка истории удаляет диалоги, текст обратной связи и
                      текущие уведомления. Задачи и отметки выполнения
                      сохраняются.
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
                        {demo
                          ? "Удалить демо-данные"
                          : local
                            ? "Удалить локальный профиль"
                            : "Удалить аккаунт"}
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
          title={
            demo
              ? "Удалить демо-данные?"
              : local
                ? "Удалить локальный профиль?"
                : "Удалить аккаунт?"
          }
          onClose={() => setConfirmDelete(false)}
        >
          <p>
            Задачи, диалоги и отметки выполнения будут удалены без возможности
            восстановления.
          </p>
          {local && !demo && (
            <p>
              Созданные события останутся во внешнем календаре. Их связи с этим
              профилем будут удалены.
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </button>
            <button className="danger" disabled={busy} onClick={removeAccount}>
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
