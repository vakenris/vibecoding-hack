import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import yauzl from "yauzl";

const MAX_CHARS = 100000;
globalThis.fetch = async () => {
  throw new Error("Загрузка внешних ссылок запрещена");
};
const fail = (message) => {
  throw new Error(message);
};
function checkText(pages) {
  if (pages.reduce((n, p) => n + p.text.length, 0) > MAX_CHARS)
    fail("В документе больше 100 000 символов. Сократите документ.");
  if (!pages.some((p) => p.text.trim()))
    fail("В документе нет извлекаемого текста. Сканы и OCR не поддерживаются.");
  return pages;
}
async function checkDocx(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(new Error("Повреждённый DOCX"));
        let count = 0,
          total = 0;
        const names = new Set();
        zip.on("error", reject);
        zip.on("end", () => {
          if (
            !names.has("word/document.xml") ||
            !names.has("[Content_Types].xml")
          )
            reject(new Error("Файл не является DOCX"));
          else resolve();
        });
        zip.on("entry", (entry) => {
          count++;
          names.add(entry.fileName);
          if (
            count > 2000 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            total + entry.uncompressedSize > 25 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1 ||
            /(^|\/)\.\.(\/|$)|vbaProject\.bin$/i.test(entry.fileName)
          ) {
            zip.close();
            reject(
              new Error(
                "DOCX зашифрован, содержит макросы или превышает лимит распаковки (25 МБ / 2000 записей)",
              ),
            );
            return;
          }
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) {
              zip.close();
              reject(new Error("Повреждённый DOCX"));
              return;
            }
            const xml = [];
            let size = 0;
            stream.on("error", reject);
            stream.on("data", (chunk) => {
              size += chunk.length;
              total += chunk.length;
              if (size > 10 * 1024 * 1024 || total > 25 * 1024 * 1024) {
                stream.destroy();
                zip.close();
                reject(new Error("DOCX превышает лимит распаковки 25 МБ"));
              }
              if (entry.fileName.endsWith(".xml")) xml.push(chunk);
            });
            stream.on("end", () => {
              if (
                xml.length &&
                /<!DOCTYPE|<!ENTITY/i.test(Buffer.concat(xml).toString("utf8"))
              ) {
                zip.close();
                reject(
                  new Error("DOCX содержит неподдерживаемые XML-сущности"),
                );
                return;
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
try {
  const buffer = await readFile(workerData.path);
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    fail("Файл должен быть не пустым и не больше 5 МБ");
  let pages;
  if (workerData.kind === "txt") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (
      /[\x00-\x08\x0e-\x1f]/.test(text) ||
      buffer.subarray(0, 4).toString() === "%PDF" ||
      buffer.subarray(0, 2).toString() === "PK"
    )
      fail("TXT должен содержать обычный текст UTF-8");
    pages = text
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .map((text, i) => ({ location: `Абзац ${i + 1}`, text: text.trim() }));
  } else if (workerData.kind === "pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      fail("Содержимое файла не является PDF");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
      disableFontFace: true,
    });
    try {
      const info = await parser.getInfo();
      if (info.total > 50) fail("В PDF больше 50 страниц");
      const result = await parser.getText();
      pages = result.pages.map((p) => ({
        location: `Страница ${p.num}`,
        text: p.text.trim(),
      }));
    } finally {
      await parser.destroy();
    }
  } else if (workerData.kind === "docx") {
    if (buffer.readUInt32LE(0) !== 0x04034b50)
      fail("Содержимое файла не является DOCX");
    await checkDocx(buffer);
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText(
      { buffer },
      { externalFileAccess: false },
    );
    pages = result.value
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .map((text, i) => ({ location: `Абзац ${i + 1}`, text: text.trim() }));
  } else fail("Поддерживаются только PDF, DOCX и TXT");
  parentPort.postMessage({ pages: checkText(pages) });
} catch (error) {
  let message =
    error instanceof Error ? error.message : "Не удалось извлечь текст";
  if (/password|encrypted/i.test(message))
    message = "PDF защищён паролем. Такие документы не поддерживаются.";
  else if (/Invalid PDF|Invalid character|Invalid encoded|utf-8/i.test(message))
    message = "Повреждённый документ или TXT не в UTF-8";
  parentPort.postMessage({ error: message.slice(0, 500) });
}
