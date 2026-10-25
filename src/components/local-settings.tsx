"use client";
import { useState } from "react";
import type { LocalSnapshot } from "@/lib/local/types";

export function LocalSettings({
  snapshot,
  busy,
  onAction,
  aiConfigured,
}: {
  snapshot: LocalSnapshot;
  busy: boolean;
  onAction: (input: Record<string, unknown>) => Promise<boolean>;
  aiConfigured: boolean;
}) {
  const [message, setMessage] = useState("");
  const connection = snapshot.connection;
  return (
    <>
      <section className="settings-card">
        <h2>AI</h2>
        <p role="status">
          {aiConfigured
            ? "AI настроен. Новые задачи разбираются автоматически; ошибки запроса показываются в карточке задачи."
            : "AI не настроен. Подключите серверный AI API для автоматического разбора задач."}
        </p>
      </section>
      <section className="settings-card stack-form">
        <h2>Календарь CalDAV</h2>
        <p className="muted">
          Одно неповторяющееся событие на действие. После выполнения шага
          событие удаляется. Пароль приложения хранится только на этом
          компьютере.
        </p>
        <p role="status">
          {connection?.enabled ? "Подключено" : "Синхронизация отключена"}
        </p>
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            if (
              await onAction({
                action: "connect",
                url: String(data.get("url")),
                username: String(data.get("username")),
                password: String(data.get("password")),
              })
            ) {
              (form.elements.namedItem("password") as HTMLInputElement).value =
                "";
              setMessage(
                "Подключение проверено. Выберите календарь для записи и проверки занятости.",
              );
            }
          }}
        >
          <label>
            URL сервера
            <input
              name="url"
              type="url"
              required
              defaultValue={connection?.url}
              placeholder="https://calendar.example/dav/"
              autoComplete="off"
            />
          </label>
          <div className="form-columns">
            <label>
              Логин
              <input
                name="username"
                required
                defaultValue={connection?.username}
                autoComplete="off"
                maxLength={500}
              />
            </label>
            <label>
              Пароль приложения
              <input
                name="password"
                type="password"
                required
                autoComplete="new-password"
                maxLength={1000}
              />
            </label>
          </div>
          <button disabled={busy}>Проверить и подключить</button>
        </form>
        {connection && (
          <form
            key={JSON.stringify(connection)}
            className="stack-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              if (
                await onAction({
                  action: "calendars",
                  writeUrl: String(data.get("writeUrl")),
                  busyUrls: data.getAll("busyUrls").map(String),
                })
              )
                setMessage("Выбор календарей сохранён");
            }}
          >
            <label>
              Календарь для записи
              <select name="writeUrl" defaultValue={connection.writeUrl}>
                {connection.calendars.map((c) => (
                  <option key={c.url} value={c.url}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Проверять занятость</legend>
              {connection.calendars.map((c) => (
                <label className="local-check" key={c.url}>
                  <input
                    name="busyUrls"
                    type="checkbox"
                    value={c.url}
                    defaultChecked={connection.busyUrls.includes(c.url)}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
            <div className="settings-actions">
              <button disabled={busy}>Сохранить календари</button>
              <button
                type="button"
                className="secondary"
                disabled={busy || !connection.enabled}
                onClick={async () => {
                  if (await onAction({ action: "disconnect" }))
                    setMessage(
                      "Синхронизация остановлена. Созданные события сохранены в календаре.",
                    );
                }}
              >
                Отключить
              </button>
            </div>
          </form>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <form
        key={JSON.stringify(snapshot.settings)}
        className="settings-card stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          if (
            await onAction({
              action: "settings",
              settings: {
                startHour: Number(data.get("startHour")),
                endHour: Number(data.get("endHour")),
                days: data.getAll("days").map(Number),
                horizonDays: Number(data.get("horizonDays")),
                defaultMinutes: Number(data.get("defaultMinutes")),
                breakMinutes: Number(data.get("breakMinutes")),
              },
            })
          )
            setMessage("Настройки времени сохранены");
        }}
      >
        <h2>Время для шагов</h2>
        <div className="form-columns">
          <label>
            Начало дня, час
            <input
              name="startHour"
              type="number"
              min={0}
              max={23}
              required
              defaultValue={snapshot.settings.startHour}
            />
          </label>
          <label>
            Конец дня, час
            <input
              name="endHour"
              type="number"
              min={1}
              max={24}
              required
              defaultValue={snapshot.settings.endHour}
            />
          </label>
        </div>
        <fieldset>
          <legend>Дни недели</legend>
          <div className="local-days">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, i) => (
              <label className="local-check" key={day}>
                <input
                  name="days"
                  type="checkbox"
                  value={i + 1}
                  defaultChecked={snapshot.settings.days.includes(i + 1)}
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-columns">
          <label>
            Горизонт, дней
            <input
              name="horizonDays"
              type="number"
              min={1}
              max={60}
              required
              defaultValue={snapshot.settings.horizonDays}
            />
          </label>
          <label>
            Длительность по умолчанию, минут
            <input
              name="defaultMinutes"
              type="number"
              min={5}
              max={240}
              required
              defaultValue={snapshot.settings.defaultMinutes}
            />
          </label>
          <label>
            Перерыв, минут
            <input
              name="breakMinutes"
              type="number"
              min={0}
              max={120}
              required
              defaultValue={snapshot.settings.breakMinutes}
            />
          </label>
        </div>
        <p className="muted">
          Звонки и обращения планируются по будням в дневном окне 09:00–17:00.
          Реальные часы работы организации нужно проверить отдельно.
        </p>
        <button disabled={busy}>Сохранить время</button>
      </form>
    </>
  );
}
