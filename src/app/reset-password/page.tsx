import { redirect } from "next/navigation";
import { cloudConfigured, supabaseServer } from "@/lib/supabase/server";
import { ResetPassword } from "@/components/reset-password";
export const dynamic = "force-dynamic";
export default async function ResetPasswordPage() {
  if (!cloudConfigured()) redirect("/");
  const client = await supabaseServer();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user?.email) redirect("/?auth_error=1");
  return <ResetPassword email={user.email} />;
}
