"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authenticate } from "@/app/actions";
export function ResetPassword({ email }: { email: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    if (form.get("password") !== form.get("confirm")) {
      setError("Пароли не совпадают");
      setBusy(false);
      return;
    }
    try {
      const result = await authenticate({
        mode: "update",
        email,
        password: form.get("password"),
      });
      if (result.error) setError(result.error);
      else setDone(true);
    } catch {
      setError(
        "Нет связи с сервером. Повторите после восстановления соединения.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="standalone">
      <h1>Новый пароль</h1>
      {done ? (
        <>
          <p>Пароль изменён.</p>
          <Link href="/">В моё пространство</Link>
        </>
      ) : (
        <form className="stack-form" onSubmit={submit}>
          <label>
            Пароль
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Повтори пароль
            <input
              name="confirm"
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} type="submit">
            {busy ? "Сохраняем…" : "Сохранить пароль"}
          </button>
        </form>
      )}
    </main>
  );
}
