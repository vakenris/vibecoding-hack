"use client";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check } from "lucide-react";
import {
  type AppState,
  type Command,
  type CategoryId,
  categories,
  categoryIds,
} from "@/lib/domain";
import { authenticate } from "@/app/actions";
import { Brand, CategoryIcon, Spinner } from "./ui";
import { AuthTree } from "./auth-tree";
export function AuthScreen({
  local,
  cloud,
  error,
  onDemo,
  onLogin,
}: {
  local: boolean;
  cloud: boolean;
  error: string;
  onDemo: () => void;
  onLogin: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await authenticate({
        mode,
        email: form.get("email"),
        password: form.get("password") ?? "",
      });
      if (result.error) setError(result.error);
      else if (result.data?.signedIn) await onLogin();
      else setMessage(result.data?.message ?? "");
    } catch {
      setError("Нет связи с сервером. Проверьте соединение и повторите.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="auth-copy">
          <h1>
            Твой путь
            <br />
            начинается
            <br />с решения.
          </h1>
          <p>
            Разложи важное по полочкам, посмотри на варианты и выбери свой
            следующий шаг.
          </p>
        </div>
        <AuthTree />
      </section>
      <section className="auth-form-panel">
        {local && (
          <div className="auth-form">
            <p className="form-intro">
              Локальный профиль хранится на этом компьютере. Регистрация и
              Supabase не нужны.
            </p>
            <button type="button" className="auth-submit" onClick={onLogin}>
              Открыть локальный профиль <ArrowRight size={18} />
            </button>
          </div>
        )}
        <form
          onSubmit={submit}
          className="auth-form"
          aria-label={
            mode === "login"
              ? "Вход"
              : mode === "signup"
                ? "Регистрация"
                : "Восстановление пароля"
          }
        >
          {mode !== "login" && (
            <button
              className="back-link"
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}
            >
              <ArrowLeft size={17} />
              Ко входу
            </button>
          )}
          {mode === "signup" && (
            <p className="form-intro">
              Создай аккаунт, чтобы сохранять свой путь.
            </p>
          )}
          {mode === "forgot" && (
            <p className="form-intro">
              Отправим ссылку для восстановления пароля.
            </p>
          )}
          <label>
            Электронная почта
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              required
              maxLength={254}
            />
          </label>
          {mode !== "forgot" && (
            <label>
              Пароль
              <input
                name="password"
                type="password"
                placeholder={
                  mode === "signup" ? "Не короче 8 символов" : "Твой пароль"
                }
                minLength={mode === "signup" ? 8 : 1}
                maxLength={128}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                required
              />
            </label>
          )}
          {mode === "login" && (
            <button
              type="button"
              className="forgot-link"
              onClick={() => {
                setMode("forgot");
                setMessage("");
              }}
            >
              Забыли пароль?
            </button>
          )}
          {(localError || error) && (
            <p className="form-error" role="alert">
              {localError || error}
            </p>
          )}
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          <button
            className="auth-submit"
            type="submit"
            disabled={busy || !cloud || local}
          >
            {busy ? (
              <Spinner />
            ) : (
              <>
                {mode === "login"
                  ? "Войти в LifePilot"
                  : mode === "signup"
                    ? "Создать аккаунт"
                    : "Отправить ссылку"}
                <ArrowUpRight size={23} />
              </>
            )}
          </button>
          {mode === "login" && (
            <button
              type="button"
              className="create-account"
              onClick={() => {
                setMode("signup");
                setMessage("");
              }}
            >
              Создать аккаунт
            </button>
          )}
          <div className="auth-divider">
            <span />
            или
            <span />
          </div>
          <button
            type="button"
            className="secondary demo-entry"
            onClick={onDemo}
          >
            Попробовать демо
            <ArrowRight size={18} />
          </button>
          <p className="auth-footnote">
            Демо хранит данные только в этом браузере.
            {!cloud && (
              <>
                <br />
                Облачный вход пока не настроен.
              </>
            )}
          </p>
        </form>
      </section>
    </div>
  );
}

export function Onboarding({
  state,
  demo,
  busy,
  error,
  onSave,
  onBack,
}: {
  state: AppState;
  demo: boolean;
  busy: boolean;
  error: string;
  onSave: (command: Command) => Promise<AppState | null>;
  onBack: () => void;
}) {
  const [interests, setInterests] = useState<CategoryId[]>(
    state.profile.interests,
  );
  const [name, setName] = useState(state.profile.name);
  const [goal, setGoal] = useState(state.profile.goals);
  return (
    <div className="onboarding">
      <Brand />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            type: "profile",
            name,
            goals: goal,
            interests,
            level: state.profile.level as "Осваиваю",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            proactive: state.profile.proactive,
          });
        }}
      >
        <p className="date-line">Начнём с тебя{demo ? " · Демо" : ""}</p>
        <h1>
          У каждого свой
          <br />
          старт.
        </h1>
        <p className="lead">Выбери то, чему хочешь уделить внимание.</p>
        <label>
          Как к тебе обращаться?
          <input
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Твоё имя"
          />
        </label>
        <fieldset>
          <legend>Что сейчас важно?</legend>
          <div className="interest-grid">
            {categoryIds.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={interests.includes(id)}
                className={
                  interests.includes(id) ? "interest selected" : "interest"
                }
                onClick={() =>
                  setInterests(
                    interests.includes(id)
                      ? interests.filter((x) => x !== id)
                      : [...interests, id],
                  )
                }
              >
                <CategoryIcon id={id} />
                <span>{categories[id].name}</span>
                {interests.includes(id) && <Check size={17} />}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Твоя ближайшая цель
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={1000}
            placeholder="Например, увереннее справляться с бытовыми делами"
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onBack}>
            Назад
          </button>
          <button disabled={busy || !interests.length} type="submit">
            {busy ? (
              <Spinner />
            ) : (
              <>
                В моё пространство
                <ArrowUpRight size={20} />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
