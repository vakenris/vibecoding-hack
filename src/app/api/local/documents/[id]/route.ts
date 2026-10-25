import { handleRequest } from "@/lib/http";
import { z } from "zod";
import { assertLocalRequest } from "@/lib/local/http";
import { deleteDocument, downloadDocument } from "@/lib/local/documents";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRequest("document.download", async () => {
    assertLocalRequest(request);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const { row, data } = await downloadDocument(id);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRequest("document.delete", async () => {
    assertLocalRequest(request, true);
    await deleteDocument(
      z
        .string()
        .uuid()
        .parse((await context.params).id),
    );
    return Response.json({ ok: true });
  });
}
