"use client";
import { ArrowUpRight } from "lucide-react";
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
  return (
    <>
      {" "}
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
        <label className="local-file">
          Прикрепить PDF, DOCX или TXT
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            aria-label="Прикрепить документ"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && file.size > 5 * 1024 * 1024) {
                setError("Файл превышает 5 МБ");
                event.target.value = "";
                return;
              }
              setAttachment(file);
            }}
          />
          <small>
            {attachment
              ? attachment.name
              : "Один файл до 5 МБ · PDF до 50 страниц · текст без OCR"}
          </small>
          {attachment && (
            <button
              type="button"
              className="text-button"
              onClick={() => setAttachment(null)}
            >
              Убрать вложение
            </button>
          )}
        </label>
      )}
    </>
  );
}
