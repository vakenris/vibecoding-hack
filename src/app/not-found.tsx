import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <h1>Здесь пока ничего нет</h1>
      <Link href="/">Вернуться в LifePilot</Link>
    </main>
  );
}
