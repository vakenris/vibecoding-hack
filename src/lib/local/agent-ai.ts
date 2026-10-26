import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { AppError } from "../errors";
import { modelJSON } from "../ai/provider";
import {
  factsGuide,
  goalGuide,
  choosePlanGuide,
  stepEstimatesGuide,
} from "../ai/prompts";
import { type AppState, type Task } from "../domain";
import type { GoalEvidence, PlanMeta, SourceRef, StepEstimate } from "./types";
import type { TextPart } from "./documents";

const sourceSchema = z.object({
  location: z.string().min(1).max(100),
  quote: z.string().min(3).max(500),
});
const goalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  deadline: z.string().nullable(),
  deadlineSource: sourceSchema.nullable(),
  requirements: z
    .array(z.object({ text: z.string().max(500), source: sourceSchema }))
    .max(30),
  clarification: z.string().min(1).max(1000).nullable(),
});
const factSchema = z.object({
  facts: z
    .array(z.object({ text: z.string().max(500), source: sourceSchema }))
    .max(30),
  possibleGoal: z.string().max(1000),
});
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
export function validateSource(source: SourceRef, parts: TextPart[]) {
  if (
    !normalize(source.quote) ||
    !parts.some(
      (p) =>
        p.location === source.location &&
        normalize(p.text).includes(normalize(source.quote)),
    )
  )
    throw new AppError(
      "AI_SOURCE_INVALID",
      "AI указал источник, которого нет в документе. Повторите разбор.",
      502,
      true,
    );
}
function dateMentioned(date: string, quote: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  let parsed;
  try {
    parsed = Temporal.PlainDate.from(date);
  } catch {
    return false;
  }
  const year = parsed.year,
    month = parsed.month,
    day = parsed.day;
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const currentYear = Temporal.Now.zonedDateTimeISO(timezone).year;
  return (
    quote.includes(date) ||
    new RegExp(
      `\\b${day.toString().padStart(2, "0")}\\.${month.toString().padStart(2, "0")}\\.${year}\\b`,
    ).test(quote) ||
    new RegExp(
      `(?:^|\\s)${day}\\s+${months[month - 1]}\\s+${year}(?:\\D|$)`,
      "i",
    ).test(quote) ||
    (year === currentYear &&
      new RegExp(`(?:^|\\s)${day}\\s+${months[month - 1]}(?:\\s|$)`, "i").test(
        quote,
      ))
  );
}
export async function understandGoal(
  task: Task,
  meta: PlanMeta,
  document: TextPart[],
  timezone: string,
  check: () => void,
): Promise<GoalEvidence> {
  const userPart = {
    location: "Описание задачи и пояснение",
    text: [task.title, task.description, meta.userContext]
      .filter(Boolean)
      .join("\n"),
  };
  const parts = [...document, userPart];
  const chunks: TextPart[][] = [];
  let current: TextPart[] = [],
    length = 0;
  for (const part of document) {
    for (let i = 0; i < part.text.length; i += 7000) {
      const piece = {
        location: part.location,
        text: part.text.slice(i, i + 7000),
      };
      if (length + piece.text.length > 10000 && current.length) {
        chunks.push(current);
        current = [];
        length = 0;
      }
      current.push(piece);
      length += piece.text.length;
    }
  }
  if (current.length) chunks.push(current);
  const facts = [];
  if (chunks.length > 1) {
    for (const chunk of chunks) {
      check();
      const result = await modelJSON(
        factsGuide,
        { documentContent: chunk, userExplanation: userPart.text },
        factSchema,
        4000,
      );
      result.facts.forEach((f) => validateSource(f.source, parts));
      facts.push(result);
    }
  }
  check();
  const goal = await modelJSON(
    goalGuide,
    {
      documentContent: chunks.length <= 1 ? document : undefined,
      extractedFacts: facts.length ? facts : undefined,
      userExplanation: userPart,
      explicitDeadline: meta.explicitDeadline || null,
      currentDate: Temporal.Now.zonedDateTimeISO(timezone)
        .toPlainDate()
        .toString(),
    },
    goalSchema,
    5000,
  );
  goal.requirements.forEach((r) => validateSource(r.source, parts));
  if (goal.deadline && !meta.explicitDeadline) {
    if (!goal.deadlineSource)
      throw new AppError(
        "AI_SOURCE_INVALID",
        "AI указал срок без источника",
        502,
        true,
      );
    validateSource(goal.deadlineSource, parts);
    if (!dateMentioned(goal.deadline, goal.deadlineSource.quote, timezone)) {
      goal.deadline = null;
      goal.deadlineSource = null;
      goal.clarification =
        "Уточните точную дату срока: исходный текст не позволяет однозначно подтвердить дату.";
    }
  }
  if (meta.explicitDeadline) {
    Temporal.PlainDate.from(meta.explicitDeadline);
    goal.deadline = meta.explicitDeadline;
    goal.deadlineSource = {
      location: "Срок пользователя",
      quote: meta.explicitDeadline,
    };
  }
  return goal;
}
export async function choosePlan(
  state: AppState,
  task: Task,
  meta: PlanMeta,
  defaultMinutes: number,
  check: () => void = () => {},
) {
  const nodes = new Map(task.tree!.nodes.map((node) => [node.id, node]));
  const candidates: {
    leafId: string;
    path: NonNullable<Task["tree"]>["nodes"];
  }[] = [];
  const visit = (id: string, path: NonNullable<Task["tree"]>["nodes"]) => {
    const node = nodes.get(id)!;
    const next = [...path, node];
    if (!node.children.length) {
      candidates.push({ leafId: id, path: next });
      return;
    }
    const selected = task.selected[id];
    for (const child of node.children)
      if (!selected || selected === child) visit(child, next);
  };
  visit(task.tree!.rootId, []);
  if (!candidates.length)
    throw new AppError(
      "CONFLICT",
      "Не найден путь, совместимый с вашим выбором",
      409,
    );
  const budget = 3000;
  let chosen = candidates[0];
  let explanation =
    "Текущий выбранный путь сохранён. Длительности действий оценены отдельно.";
  if (candidates.length > 1) {
    const response = await modelJSON(
      choosePlanGuide,
      {
        title: task.title,
        description: task.description,
        goals: state.profile.goals,
        requirements: meta.goal?.requirements,
        deadline: meta.explicitDeadline || meta.goal?.deadline || null,
        userContext: meta.userContext,
        candidates: candidates.map((candidate) => {
          const leaf = candidate.path.at(-1)!;
          return {
            leafId: candidate.leafId,
            path: candidate.path.slice(1).map((node) => node.title),
            pros: leaf.pros,
            risks: leaf.risks,
            steps: leaf.steps.map((step) => step.title),
          };
        }),
      },
      z.object({
        leafId: z.enum(
          candidates.map((candidate) => candidate.leafId) as [
            string,
            ...string[],
          ],
        ),
        explanation: z.string().min(1).max(2000),
      }),
      budget,
    );
    chosen = candidates.find(
      (candidate) => candidate.leafId === response.leafId,
    )!;
    explanation = response.explanation;
  }
  const selected = { ...task.selected };
  check();
  for (let i = 0; i < chosen.path.length - 1; i++)
    selected[chosen.path[i].id] = chosen.path[i + 1].id;
  const steps = chosen.path.at(-1)!.steps;
  const stepIds = steps.map((step) => step.id);
  const estimateSchema = z
    .object({
      estimates: z
        .array(
          z.object({
            stepId: z.enum(stepIds as [string, ...string[]]),
            minutes: z.number().int().min(5).max(240).nullable(),
            preference: z.enum(["any", "morning", "afternoon", "evening"]),
            businessHours: z.boolean(),
          }),
        )
        .length(steps.length),
    })
    .refine(
      (value) =>
        new Set(value.estimates.map((estimate) => estimate.stepId)).size ===
        steps.length,
      "Нужна одна оценка для каждого действия",
    );
  const response = await modelJSON(
    stepEstimatesGuide,
    {
      title: task.title,
      defaultMinutes,
      path: chosen.path.map((node) => node.title),
      steps,
      deadline: meta.explicitDeadline || meta.goal?.deadline || null,
      userContext: meta.userContext,
    },
    estimateSchema,
    budget,
  );
  const estimates: StepEstimate[] = steps.map((step) => {
    const estimate = response.estimates.find(
      (item) => item.stepId === step.id,
    )!;
    return {
      ...estimate,
      minutes: estimate.minutes ?? defaultMinutes,
      businessHours:
        estimate.businessHours ||
        /позвон|звонок|позвони|обратит[ьс]|связат[ьс]|при[её]мн|организаци|банк|деканат|поликлиник/i.test(
          `${step.title} ${step.hint}`,
        ),
    };
  });
  return { selected, explanation, estimates, path: chosen.path };
}
