import { assertLocalRequest, limitedBody } from "@/lib/local/http";
import { handleRequest } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { createDocument } from "@/lib/local/documents";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleRequest("document.upload", async () => {
    assertLocalRequest(request, true);
    const bytes = await limitedBody(request, 5 * 1024 * 1024 + 20000);
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
        body: bytes,
      }).formData();
    } catch {
      throw new AppError(
        "INVALID_REQUEST",
        "Не удалось прочитать форму загрузки",
        400,
      );
    }
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File))
      throw new AppError(
        "INVALID_REQUEST",
        "Прикрепите один PDF, DOCX или TXT",
      );
    const value = form.get("explanation");
    if (value !== null && typeof value !== "string")
      throw new AppError(
        "INVALID_REQUEST",
        "Пояснение должно быть текстом",
        400,
      );
    const explanation = value ?? "";
    if (explanation.length > 2000)
      throw new AppError(
        "INVALID_REQUEST",
        "Пояснение не должно превышать 2000 символов",
      );
    const taskId = await createDocument(
      Buffer.from(await files[0].arrayBuffer()),
      files[0].name,
      explanation,
    );
    return Response.json({ taskId });
  });
}
