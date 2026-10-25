import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { cloudConfigured } from "../config";
import { AppError } from "../errors";
export { cloudConfigured, localMode, aiConfigured } from "../config";
export async function supabaseServer() {
  if (!cloudConfigured())
    throw new AppError(
      "CLOUD_CONFIGURATION",
      "Облачное хранение ещё не настроено. Откройте демо-режим.",
      503,
    );
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            /* Server Components cannot write; actions refresh cookies. */
          }
        },
      },
    },
  );
}
export function supabaseAdmin() {
  if (!cloudConfigured())
    throw new AppError(
      "CLOUD_CONFIGURATION",
      "Облачное хранение ещё не настроено.",
      503,
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function requireUser() {
  const client = await supabaseServer();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    throw new AppError(
      "UNAUTHORIZED",
      "Войдите в аккаунт, чтобы продолжить.",
      401,
    );
  return { user, client };
}
