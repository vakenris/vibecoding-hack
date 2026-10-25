import { assertLocalRequest } from "@/lib/local/http";
import { handleRequest } from "@/lib/http";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refresh auth cookies before Server Components read them. Do not cache private responses.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (process.env.LIFEPILOT_MODE === "local") {
    try {
      assertLocalRequest(request);
    } catch (error) {
      return handleRequest("local.access", async () => {
        throw error;
      });
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/reset-password", "/api/:path*"] };
