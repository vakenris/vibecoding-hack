"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>Не удалось открыть страницу</h1>
      <p>Попробуйте ещё раз. Сохранённые задачи останутся в аккаунте.</p>
      <button onClick={reset}>Повторить</button>
      <Link href="/">На главную</Link>
    </main>
  );
}
