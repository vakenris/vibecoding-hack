import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const client = await supabaseServer();
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const next =
    url.searchParams.get("next") === "/reset-password" || type === "recovery"
      ? "/reset-password"
      : "/";
  let success = false;
  if (token_hash && ["signup", "recovery", "email"].includes(type ?? "")) {
    const { error } = await client.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    success = !error;
  } else if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    success = !error;
  }
  return NextResponse.redirect(
    new URL(success ? next : "/?auth_error=1", url.origin),
  );
}
