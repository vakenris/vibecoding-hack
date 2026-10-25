import type { Metadata } from "next";
import "@fontsource/manrope/cyrillic-400.css";
import "@fontsource/manrope/cyrillic-500.css";
import "@fontsource/manrope/cyrillic-600.css";
import "@fontsource/manrope/cyrillic-700.css";
import "@fontsource/manrope/cyrillic-800.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "LifePilot — твой следующий шаг",
  description:
    "Превращай жизненные вопросы в понятные планы. Решения, действия и прогресс в твоём темпе.",
  icons: {
    icon: {
      url: "/brand/lifepilot-symbol.png",
      type: "image/png",
      sizes: "1254x1254",
    },
    apple: { url: "/brand/lifepilot-symbol.png", type: "image/png" },
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
