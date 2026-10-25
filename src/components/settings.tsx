"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import { type AppState, type Command } from "@/lib/domain";
export function SettingsForm({
  state,
  busy,
  onSave,
  onMessage,
}: {
  state: AppState;
  busy: boolean;
  onSave: (c: Command) => Promise<AppState | null>;
  onMessage: (s: string) => void;
}) {
  const [proactive, setProactive] = useState(state.profile.proactive);
  const [reminders, setReminders] = useState(state.profile.reminders);
  const [frequency, setFrequency] = useState(state.profile.frequency);
  return (
    <>
      <form
        className="settings-card stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          if (
            await onSave({
              type: "profile",
              name: String(form.get("name")),
              goals: String(form.get("goals")),
              timezone: String(form.get("timezone")),
              interests: state.profile.interests,
              level: state.profile.level as "Осваиваю",
              proactive: state.profile.proactive,
            })
          )
            onMessage("Профиль сохранён");
        }}
      >
        <h2>О тебе</h2>
        <div className="form-columns">
          <label>
            Имя
            <input
              name="name"
              required
              defaultValue={state.profile.name}
              maxLength={60}
            />
          </label>
          <label>
            Часовой пояс
            <input
              name="timezone"
              required
              defaultValue={state.profile.timezone}
              placeholder="Europe/Moscow"
            />
          </label>
        </div>
        <label>
          Ближайшие цели
          <textarea
            name="goals"
            defaultValue={state.profile.goals}
            maxLength={1000}
          />
        </label>
        <button type="submit" disabled={busy}>
          Сохранить профиль
        </button>
      </form>
      <form
        className="settings-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave({ type: "settings", proactive, reminders, frequency })
          )
            onMessage("Настройки сохранены");
        }}
      >
        <h2>Поддержка в твоём темпе</h2>
        <label className="toggle-row">
          <span>
            <strong>Инициативные вопросы</strong>
            <small>Подготовка до события и обратная связь после него</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={proactive}
            onChange={(e) => setProactive(e.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>
            <strong>Напоминания</strong>
            <small>Показывать внутри приложения, когда ты его открываешь</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={reminders}
            onChange={(e) => setReminders(e.target.checked)}
          />
        </label>
        <label className="frequency-label">
          Частота вопросов
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="daily">Не чаще раза в день</option>
            <option value="weekly">Не чаще раза в неделю</option>
          </select>
        </label>
        <div className="settings-actions">
          <button type="submit" disabled={busy}>
            Сохранить настройки
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !state.profile.proactive}
            onClick={async () => {
              if (await onSave({ type: "tick", demo: true }))
                onMessage(
                  "Демо-событие обработано. Сообщения появятся на главной.",
                );
            }}
          >
            <Bell size={17} />
            Проверить демо-событие
          </button>
        </div>
      </form>
    </>
  );
}
