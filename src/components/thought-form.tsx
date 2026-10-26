"use client";
import { useId, useRef } from "react";
import { ArrowUpRight, FileText, Paperclip, X } from "lucide-react";
import type { LifePilotController } from "@/hooks/use-life-pilot";
type Props = { local: boolean } & Pick<
  LifePilotController,
  | "createThought"
  | "attachment"
  | "thought"
  | "setThought"
  | "busy"
  | "setError"
  | "setAttachment"
  | "demo"
>;
function fileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toLocaleString("ru", { maximumFractionDigits: 1 })} МБ`
    : `${Math.max(1, Math.ceil(bytes / 1024))} КБ`;
}
export function ThoughtForm({
  local,
  createThought,
  attachment,
  thought,
  setThought,
  busy,
  setError,
  setAttachment,
  demo,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return (
    <>
      <form onSubmit={createThought} className="thought-form">
        <label className="sr-only" htmlFor="thought">
          Твой вопрос или проблема
        </label>
        <input
          id="thought"
          required={!attachment}
          maxLength={200}
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          placeholder="Например: хочу сменить работу…"
        />
        <button
          disabled={busy || (!thought.trim() && !attachment)}
          type="submit"
        >
          Разобрать <ArrowUpRight size={22} />
        </button>
      </form>
      {local && !demo && (
        <div className="attachment-control">
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.docx,.txt"
            aria-label="Прикрепить документ"
            aria-describedby={hintId}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Selection lives in React; reset the picker so replacing/removing
              // and choosing the same file still emits a change event.
              event.target.value = "";
              if (!file) return;
              if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
                setError("Выберите PDF, DOCX или TXT");
                return;
              }
              if (!file.size) {
                setError("Файл пустой. Выберите другой документ.");
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                setError("Файл превышает 5 МБ");
                return;
              }
              setError("");
              setAttachment(file);
            }}
          />
          {attachment && (
            <div
              className="attachment-file"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="attachment-icon" aria-hidden="true">
                <FileText size={22} />
              </span>
              <div className="attachment-info">
                <span className="sr-only">Выбран файл: </span>
                <strong title={attachment.name}>{attachment.name}</strong>
                <small>
                  {attachment.name.split(".").at(-1)?.toUpperCase()} ·{" "}
                  {fileSize(attachment.size)}
                </small>
              </div>
              <button
                type="button"
                className="attachment-remove"
                aria-label="Убрать вложение"
                disabled={busy}
                onClick={() => {
                  if (input.current) input.current.value = "";
                  setAttachment(null);
                  setError("");
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="attachment-actions">
            <button
              type="button"
              className="attachment-trigger"
              disabled={busy}
              aria-describedby={hintId}
              onClick={() => input.current?.click()}
            >
              <Paperclip size={17} aria-hidden="true" />
              {attachment ? "Заменить файл" : "Прикрепить файл"}
            </button>
            <span id={hintId} className="attachment-hint">
              PDF до 50 страниц, DOCX, TXT · до 5 МБ
            </span>
          </div>
        </div>
      )}
    </>
  );
}
