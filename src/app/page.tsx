import { LifePilot } from "@/components/lifepilot";
import { supabaseServer } from "@/lib/supabase/server";
import { cloudConfigured, aiConfigured, localMode } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { mutateState } from "@/lib/store";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  let state = null;
  let localSnapshot;
  if (localMode()) {
    const { readLocalState } = await import("@/lib/local-store");
    state = readLocalState();
    localSnapshot = (await import("@/lib/local/snapshot")).localSnapshot();
  }
  let error = (await searchParams).auth_error
    ? "Ссылка недействительна или истекла. Запросите новую."
    : "";
  if (!localMode() && cloudConfigured()) {
    try {
      const client = await supabaseServer();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (user)
        state = await mutateState(user.id, { type: "tick", demo: false });
    } catch (e) {
      error = publicError(e).message;
    }
  }
  return (
    <LifePilot
      local={localMode()}
      cloud={cloudConfigured()}
      ai={aiConfigured()}
      initialState={state}
      initialLocalSnapshot={localSnapshot}
      initialError={error}
    />
  );
}
