import { LifePilot } from "@/components/lifepilot";
import {
  cloudConfigured,
  aiConfigured,
  supabaseServer,
} from "@/lib/supabase/server";
import { mutateState } from "@/lib/store";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  let state = null;
  let error = (await searchParams).auth_error
    ? "Ссылка недействительна или истекла. Запросите новую."
    : "";
  if (cloudConfigured()) {
    try {
      const client = await supabaseServer();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (user)
        state = await mutateState(user.id, { type: "tick", demo: false });
    } catch (e) {
      error = e instanceof Error ? e.message : "Не удалось загрузить данные";
    }
  }
  return (
    <LifePilot
      cloud={cloudConfigured()}
      ai={aiConfigured()}
      initialState={state}
      initialError={error}
    />
  );
}
