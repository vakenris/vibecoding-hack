import { readLocalState } from "@/lib/local/state";
import { localSnapshot } from "@/lib/local/snapshot";
import { assertLocalRequest } from "@/lib/local/http";
import { handleRequest, readJSON } from "@/lib/http";
import { executeLocal, localInputSchema } from "@/lib/server/local-profile";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleRequest("local.snapshot", async () => {
    assertLocalRequest(request);
    return Response.json(
      { state: readLocalState(), local: localSnapshot() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
export async function POST(request: Request) {
  return handleRequest("local.command", async () => {
    assertLocalRequest(request, true);
    return Response.json(
      await executeLocal(
        await readJSON(request, localInputSchema, 2 * 1024 * 1024),
      ),
    );
  });
}
