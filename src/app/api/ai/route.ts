import { requireUser } from "@/lib/supabase/server";
import { localMode } from "@/lib/config";
import { assertLocalRequest } from "@/lib/local/http";
import { assertSameOrigin, handleRequest, readJSON } from "@/lib/http";
import { aiInputSchema, executeAI } from "@/lib/server/ai";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handleRequest("ai.generate", async () => {
    if (localMode()) assertLocalRequest(request, true);
    else assertSameOrigin(request);
    const userId = localMode() ? "local" : (await requireUser()).user.id;
    const input = await readJSON(request, aiInputSchema, 16000);
    return Response.json({ state: await executeAI(userId, input) });
  });
}
