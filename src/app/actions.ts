"use server";
import { headers } from "next/headers";
import { commandSchema } from "@/lib/domain";
import { mutateState } from "@/lib/store";
import {
  requireUser,
  supabaseServer,
  supabaseAdmin,
} from "@/lib/supabase/server";
import { z } from "zod";

async function result<T>(fn: () => Promise<T>) {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Не удалось выполнить действие",
    };
  }
}
export async function loadState() {
  return result(async () => {
    const { user } = await requireUser();
    return mutateState(user.id, { type: "tick", demo: false });
  });
}
export async function dispatchCommand(input: unknown) {
  return result(async () => {
    const command = commandSchema.parse(input);
    const { user } = await requireUser();
    return mutateState(user.id, command);
  });
}
export async function authenticate(input: unknown) {
  return result(async () => {
    const data = z
      .object({
        mode: z.enum(["login", "signup", "forgot", "update"]),
        email: z.string().email(),
        password: z.string().max(128),
      })
      .parse(input);
    if (data.mode === "signup" || data.mode === "update")
      z.string()
        .min(8, "Пароль должен содержать не менее 8 символов")
        .parse(data.password);
    const client = await supabaseServer();
    const origin = (await headers()).get("origin");
    if (!origin) throw new Error("Не удалось определить адрес приложения");
    if (data.mode === "login") {
      const { error } = await client.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (error) throw new Error("Не удалось войти. Проверьте почту и пароль.");
      return { signedIn: true, message: "" };
    }
    if (data.mode === "signup") {
      const { data: auth, error } = await client.auth.signUp({
        email: data.email,
        password: data.password,
        options: { emailRedirectTo: `${origin}/auth/confirm` },
      });
      if (error)
        throw new Error(
          "Не удалось создать аккаунт. Проверьте данные или повторите позже.",
        );
      return {
        signedIn: Boolean(auth.session),
        message: "Проверьте почту: мы отправили ссылку подтверждения.",
      };
    }
    if (data.mode === "forgot") {
      const { error } = await client.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${origin}/auth/confirm?next=/reset-password`,
      });
      if (error)
        throw new Error("Не удалось отправить письмо. Повторите позже.");
      return {
        signedIn: false,
        message:
          "Если аккаунт существует, ссылка для восстановления придёт на почту.",
      };
    }
    await requireUser();
    const { error } = await client.auth.updateUser({ password: data.password });
    if (error)
      throw new Error("Не удалось обновить пароль. Запросите новую ссылку.");
    return { signedIn: true, message: "Пароль изменён" };
  });
}
export async function signOut() {
  return result(async () => {
    const client = await supabaseServer();
    const { error } = await client.auth.signOut();
    if (error) throw new Error("Не удалось выйти");
    return true;
  });
}
export async function deleteAccount() {
  return result(async () => {
    const { user, client } = await requireUser();
    const { error } = await supabaseAdmin().auth.admin.deleteUser(user.id);
    if (error) throw new Error("Не удалось удалить аккаунт. Повторите позже.");
    await client.auth.signOut();
    return true;
  });
}
