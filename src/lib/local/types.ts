import { z } from "zod";

export const scheduleSettingsSchema = z
  .object({
    startHour: z.number().int().min(0).max(23).default(9),
    endHour: z.number().int().min(1).max(24).default(21),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .default([1, 2, 3, 4, 5, 6, 7]),
    horizonDays: z.number().int().min(1).max(60).default(14),
    defaultMinutes: z.number().int().min(5).max(240).default(30),
    breakMinutes: z.number().int().min(0).max(120).default(10),
  })
  .refine(
    (s) => s.endHour > s.startHour,
    "Конец рабочего окна должен быть позже начала",
  );
export type ScheduleSettings = z.infer<typeof scheduleSettingsSchema>;
export const defaultSchedule = scheduleSettingsSchema.parse({});
export type Phase =
  | "queued"
  | "extracting"
  | "understanding"
  | "tree"
  | "choosing"
  | "finding"
  | "creating"
  | "ready"
  | "needs_input"
  | "awaiting_calendar"
  | "error";
export const phaseLabels: Record<Phase, string> = {
  queued: "В очереди",
  extracting: "Извлекаю текст",
  understanding: "Понимаю цель",
  tree: "Строю дерево",
  choosing: "Выбираю путь",
  finding: "Ищу время",
  creating: "Создаю события",
  ready: "Готово",
  needs_input: "Нужно уточнение",
  awaiting_calendar: "Подключите календарь",
  error: "Ошибка",
};
export interface SourceRef {
  location: string;
  quote: string;
}
export interface GoalEvidence {
  title: string;
  description: string;
  deadline: string | null;
  deadlineSource: SourceRef | null;
  requirements: { text: string; source: SourceRef }[];
  clarification: string | null;
}
export interface StepEstimate {
  stepId: string;
  minutes: number;
  preference: "any" | "morning" | "afternoon" | "evening";
  businessHours: boolean;
}
export interface PlanMeta {
  sourceRemoved?: boolean;
  goal?: GoalEvidence;
  explanation?: string;
  estimates?: StepEstimate[];
  userContext?: string;
  explicitDeadline?: string;
}
export interface LocalPlan {
  taskId: string;
  version: number;
  phase: Phase;
  message: string;
  meta: PlanMeta;
  logs: { phase: string; message: string; at: string }[];
}
export interface LocalEvent {
  taskId: string;
  stepId: string;
  title: string;
  start: string;
  end: string;
  status:
    | "pending"
    | "active"
    | "delete"
    | "deleted"
    | "external_deleted"
    | "conflict";
}
export interface LocalDocument {
  id: string;
  taskId: string;
  name: string;
  status: string;
  error: string;
}
export interface CalendarInfo {
  url: string;
  name: string;
}
export interface PublicConnection {
  url: string;
  username: string;
  enabled: boolean;
  calendars: CalendarInfo[];
  writeUrl: string;
  busyUrls: string[];
}
export interface LocalSnapshot {
  plans: LocalPlan[];
  events: LocalEvent[];
  documents: LocalDocument[];
  connection: PublicConnection | null;
  settings: ScheduleSettings;
  importedDemo: boolean;
}
