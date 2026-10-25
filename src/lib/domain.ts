import { z } from "zod";

export const categoryIds = [
  "global",
  "career",
  "home",
  "social",
  "money",
] as const;
export type CategoryId = (typeof categoryIds)[number];
export const categories: Record<
  CategoryId,
  { name: string; color: string; tint: string; icon: string }
> = {
  global: {
    name: "Глобальные решения",
    color: "#8357c5",
    tint: "#f0e8fa",
    icon: "Compass",
  },
  career: {
    name: "Учёба и карьера",
    color: "#377ac5",
    tint: "#e9f1fc",
    icon: "GraduationCap",
  },
  home: { name: "Быт", color: "#bf641f", tint: "#fff0df", icon: "House" },
  social: {
    name: "Социальная жизнь",
    color: "#bd4775",
    tint: "#fbe9f0",
    icon: "Users",
  },
  money: { name: "Финансы", color: "#31835b", tint: "#e6f4ea", icon: "Wallet" },
};
const shortText = z.string().trim().min(1).max(200);
const dateSchema = z
  .string()
  .refine(
    (s) =>
      s === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !Number.isNaN(Date.parse(s + "T12:00:00Z")) &&
        new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s),
    "Некорректная дата",
  );
export const treeSchema = z
  .object({
    rootId: shortText,
    nodes: z
      .array(
        z.object({
          id: shortText,
          title: shortText,
          question: z.string().max(200).optional(),
          pros: z.array(shortText).max(4),
          risks: z.array(shortText).max(4),
          children: z.array(shortText).max(3),
          steps: z
            .array(
              z.object({
                id: shortText,
                title: shortText,
                hint: z.string().max(500),
              }),
            )
            .max(8),
        }),
      )
      .min(2)
      .max(40),
  })
  .superRefine((tree, ctx) => {
    const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
    const stepIds = tree.nodes.flatMap((n) => n.steps.map((s) => s.id));
    let bad =
      nodes.size !== tree.nodes.length ||
      new Set(stepIds).size !== stepIds.length;
    const seen = new Set<string>();
    const visit = (id: string, depth: number) => {
      const n = nodes.get(id);
      if (!n || seen.has(id) || depth > 6) {
        bad = true;
        return;
      }
      seen.add(id);
      if (
        (n.children.length > 0 && n.steps.length > 0) ||
        (!n.children.length && !n.steps.length)
      )
        bad = true;
      n.children.forEach((child) => visit(child, depth + 1));
    };
    visit(tree.rootId, 0);
    if (seen.size !== nodes.size) bad = true;
    if (bad)
      ctx.addIssue({
        code: "custom",
        message:
          "Дерево содержит недоступные узлы, цикл или некорректные действия",
      });
  });
export type DecisionTree = z.infer<typeof treeSchema>;
export type TreeNode = DecisionTree["nodes"][number];
export type Outcome = "independent" | "help" | "difficulty";
export interface Feedback {
  outcome: Outcome;
  text: string;
  at: string;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  date: string;
  time: string;
  reminder: boolean;
  source: "manual" | "thought" | "scenario" | "idea";
  scenarioId?: string;
  tree?: DecisionTree;
  selected: Record<string, string>;
  completed: string[];
  feedback?: Feedback;
  createdAt: string;
  awarded: string[];
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  mode: "live" | "demo";
}
export interface Idea {
  id: string;
  title: string;
  description: string;
  reason: string;
  category: CategoryId;
}
export interface Notice {
  id: string;
  taskId: string;
  text: string;
  kind: "before" | "after";
}
export interface AppState {
  version: 1;
  profile: {
    name: string;
    goals: string;
    interests: CategoryId[];
    level: string;
    timezone: string;
    onboarded: boolean;
    proactive: boolean;
    reminders: boolean;
    frequency: "daily" | "weekly";
  };
  tasks: Task[];
  messages: Record<string, Message[]>;
  ideas: Idea[];
  dismissedIdeas: string[];
  points: number;
  achievements: string[];
  notices: Notice[];
  delivered: string[];
  aiRequests: number[];
}
// Validate persisted documents as well as incoming commands. Unknown versions fail closed.
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(5000),
  at: z.string(),
  mode: z.enum(["live", "demo"]),
});
export const stateSchema: z.ZodType<AppState> = z.object({
  version: z.literal(1),
  profile: z.object({
    name: z.string().max(60),
    goals: z.string().max(1000),
    interests: z.array(z.enum(categoryIds)),
    level: z.string(),
    timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat("ru", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }),
    onboarded: z.boolean(),
    proactive: z.boolean(),
    reminders: z.boolean(),
    frequency: z.enum(["daily", "weekly"]),
  }),
  tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        title: shortText,
        description: z.string().max(2000),
        category: z.enum(categoryIds),
        date: dateSchema,
        time: z.string(),
        reminder: z.boolean(),
        source: z.enum(["manual", "thought", "scenario", "idea"]),
        scenarioId: z.string().optional(),
        tree: treeSchema.optional(),
        selected: z.record(z.string(), z.string()),
        completed: z.array(z.string()),
        feedback: z
          .object({
            outcome: z.enum(["independent", "help", "difficulty"]),
            text: z.string().max(2000),
            at: z.string(),
          })
          .optional(),
        createdAt: z.string(),
        awarded: z.array(z.string()),
      }),
    )
    .max(500),
  messages: z.record(z.string(), z.array(messageSchema).max(100)),
  ideas: z.array(
    z.object({
      id: z.string(),
      title: shortText,
      description: z.string().max(1000),
      reason: z.string().max(500),
      category: z.enum(categoryIds),
    }),
  ),
  dismissedIdeas: z.array(z.string()),
  points: z.number().int().nonnegative(),
  achievements: z.array(z.string()),
  notices: z.array(
    z.object({
      id: z.string(),
      taskId: z.string(),
      text: z.string(),
      kind: z.enum(["before", "after"]),
    }),
  ),
  delivered: z.array(z.string()),
  aiRequests: z.array(z.number()),
});
export function emptyState(): AppState {
  return {
    version: 1,
    profile: {
      name: "",
      goals: "",
      interests: [...categoryIds],
      level: "Осваиваю",
      timezone: "Europe/Moscow",
      onboarded: false,
      proactive: false,
      reminders: true,
      frequency: "daily",
    },
    tasks: [],
    messages: {},
    ideas: [],
    dismissedIdeas: [],
    points: 0,
    achievements: [],
    notices: [],
    delivered: [],
    aiRequests: [],
  };
}
export function dateKey(date = new Date(), timezone?: string): string {
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function activePath(task: Task): TreeNode[] {
  if (!task.tree) return [];
  const path: TreeNode[] = [];
  let node = task.tree.nodes.find((n) => n.id === task.tree!.rootId);
  while (node && path.length < 8) {
    path.push(node);
    const next = task.selected[node.id];
    node = node.children.includes(next)
      ? task.tree.nodes.find((n) => n.id === next)
      : undefined;
  }
  return path;
}
export function activeSteps(task: Task) {
  return activePath(task).at(-1)?.steps ?? [];
}
export function progress(task: Task): number {
  const steps = activeSteps(task);
  return steps.length
    ? Math.round(
        (steps.filter((s) => task.completed.includes(s.id)).length /
          steps.length) *
          100,
      )
    : 0;
}
export function skill(state: AppState, scenarioId: string): string {
  const attempts = state.tasks.filter(
    (t) => t.scenarioId === scenarioId && t.feedback,
  );
  const independent = attempts.filter(
    (t) => t.feedback?.outcome === "independent",
  ).length;
  return independent >= 2
    ? "Закреплено"
    : independent === 1
      ? "Делаю самостоятельно"
      : attempts.length
        ? "Осваиваю"
        : "Не пробовал";
}
const taskIdSchema = z.string().uuid();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("profile"),
    name: z.string().trim().min(1).max(60),
    goals: z.string().max(1000),
    interests: z.array(z.enum(categoryIds)).min(1),
    level: z.enum(["Не пробовал", "Осваиваю", "Делаю самостоятельно"]),
    timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat("ru", { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }),
    proactive: z.boolean(),
  }),
  z.object({
    type: z.literal("settings"),
    proactive: z.boolean(),
    reminders: z.boolean(),
    frequency: z.enum(["daily", "weekly"]),
  }),
  z.object({
    type: z.literal("create"),
    id: taskIdSchema,
    title: shortText,
    description: z.string().max(2000),
    category: z.enum(categoryIds),
    date: dateSchema,
    time: z.string().regex(/^(|([01]\d|2[0-3]):[0-5]\d)$/),
    reminder: z.boolean(),
    source: z.enum(["manual", "thought"]),
  }),
  z.object({
    type: z.literal("scenario"),
    id: taskIdSchema,
    scenarioId: shortText,
    date: dateSchema,
  }),
  z.object({
    type: z.literal("select"),
    taskId: taskIdSchema,
    parent: shortText,
    child: shortText,
  }),
  z.object({
    type: z.literal("complete"),
    taskId: taskIdSchema,
    stepId: shortText,
  }),
  z.object({
    type: z.literal("feedback"),
    taskId: taskIdSchema,
    outcome: z.enum(["independent", "help", "difficulty"]),
    text: z.string().max(2000),
  }),
  z.object({ type: z.literal("dismissIdea"), id: shortText }),
  z.object({
    type: z.literal("acceptIdea"),
    id: shortText,
    taskId: taskIdSchema,
  }),
  z.object({ type: z.literal("dismissNotice"), id: shortText }),
  z.object({ type: z.literal("tick"), demo: z.boolean().default(false) }),
  z.object({ type: z.literal("clearHistory") }),
  z.object({
    type: z.literal("mentorDemo"),
    taskId: taskIdSchema,
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({ type: z.literal("deleteTask"), taskId: taskIdSchema }),
  z.object({
    type: z.literal("category"),
    taskId: taskIdSchema,
    category: z.enum(categoryIds),
  }),
]);
export type Command = z.infer<typeof commandSchema>;

// Used only by the server after validating an AI response; never accepted as a public command.
export type TrustedCommand =
  | Command
  | { type: "tree"; taskId: string; tree: DecisionTree }
  | { type: "message"; taskId: string; message: Message }
  | { type: "ideas"; ideas: Idea[] }
  | { type: "reserveAI" };
export interface Scenario {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  duration: string;
  tree: DecisionTree;
}

export function applyCommand(
  input: AppState,
  command: TrustedCommand,
  scenarios: Scenario[],
  now = new Date(),
): AppState {
  const state = structuredClone(input);
  const task =
    "taskId" in command
      ? state.tasks.find((t) => t.id === command.taskId)
      : undefined;
  if ("taskId" in command && command.type !== "acceptIdea" && !task)
    throw new Error("Задача не найдена");
  const makeTask = (
    id: string,
    title: string,
    category: CategoryId,
    description: string,
    source: Task["source"],
  ): Task => ({
    id,
    title,
    category,
    description,
    source,
    date: "",
    time: "",
    reminder: true,
    createdAt: now.toISOString(),
    selected: {},
    completed: [],
    awarded: [],
  });
  switch (command.type) {
    case "profile":
      state.profile = {
        ...state.profile,
        name: command.name,
        goals: command.goals,
        interests: command.interests,
        level: command.level,
        timezone: command.timezone,
        proactive: command.proactive,
        onboarded: true,
      };
      break;
    case "settings":
      state.profile = {
        ...state.profile,
        proactive: command.proactive,
        reminders: command.reminders,
        frequency: command.frequency,
      };
      if (!command.proactive) state.notices = [];
      break;
    case "create":
      if (!state.tasks.some((t) => t.id === command.id))
        state.tasks.unshift({
          ...makeTask(
            command.id,
            command.title,
            command.category,
            command.description,
            command.source,
          ),
          date: command.date,
          time: command.time,
          reminder: command.reminder,
        });
      break;
    case "scenario": {
      if (state.tasks.some((t) => t.id === command.id)) break;
      const scenario = scenarios.find((s) => s.id === command.scenarioId);
      if (!scenario) throw new Error("Сценарий не найден");
      state.tasks.unshift({
        ...makeTask(
          command.id,
          scenario.title,
          scenario.category,
          scenario.description,
          "scenario",
        ),
        date: command.date,
        scenarioId: scenario.id,
        tree: structuredClone(scenario.tree),
      });
      break;
    }
    case "category":
      if (task!.feedback || task!.source === "scenario")
        throw new Error("Категория готового прохождения не меняется");
      task!.category = command.category;
      break;
    case "select": {
      if (task!.feedback)
        throw new Error("Результат уже сохранён. Начните новое прохождение.");
      const parent = activePath(task!).find((n) => n.id === command.parent);
      if (!parent?.children.includes(command.child))
        throw new Error("Выберите доступную ветку");
      task!.selected[command.parent] = command.child;
      break;
    }
    case "complete": {
      if (task!.feedback) throw new Error("Результат уже сохранён");
      if (!activeSteps(task!).some((s) => s.id === command.stepId))
        throw new Error("Действие не принадлежит выбранному пути");
      if (!task!.completed.includes(command.stepId))
        task!.completed.push(command.stepId);
      if (!task!.awarded.includes(command.stepId)) {
        task!.awarded.push(command.stepId);
        state.points += 10;
      }
      break;
    }
    case "feedback": {
      if (task!.feedback) break;
      if (progress(task!) !== 100)
        throw new Error("Сначала выполните действия выбранного пути");
      task!.feedback = {
        outcome: command.outcome,
        text: command.text,
        at: now.toISOString(),
      };
      state.points += 20;
      state.notices = state.notices.filter((n) => n.taskId !== task!.id);
      if (!state.achievements.includes("first-result"))
        state.achievements.push("first-result");
      if (
        state.tasks.filter((t) => t.feedback).length >= 2 &&
        !state.achievements.includes("two-results")
      )
        state.achievements.push("two-results");
      break;
    }
    case "tree":
      if (task!.tree) throw new Error("Дерево уже создано");
      task!.tree = treeSchema.parse(command.tree);
      task!.tree.nodes.find((n) => n.id === task!.tree!.rootId)!.title =
        task!.title;
      break;
    case "mentorDemo": {
      const next = activeSteps(task!).find(
        (s) => !task!.completed.includes(s.id),
      );
      const text =
        progress(task!) === 100
          ? "Ты отметил все действия. Как прошла попытка: самостоятельно, с помощью или возникли трудности? Сохрани результат под чек-листом."
          : next
            ? `Ближайшее действие: ${next.title}. ${next.hint} После попытки отметь выполнение и расскажи о результате.`
            : "Сначала выбери подход в дереве. Посмотри на преимущества и ограничения каждого варианта: какой подходит тебе сейчас?";
      state.messages[command.taskId] = [
        ...(state.messages[command.taskId] ?? []),
        {
          id: crypto.randomUUID(),
          role: "user",
          text: command.text,
          at: now.toISOString(),
          mode: "demo",
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          at: now.toISOString(),
          mode: "demo",
        },
      ].slice(-100) as Message[];
      break;
    }
    case "message":
      state.messages[command.taskId] = [
        ...(state.messages[command.taskId] ?? []),
        command.message,
      ].slice(-100);
      break;
    case "ideas": {
      const seen = new Set(
        state.tasks.map((t) => t.title.trim().toLocaleLowerCase("ru")),
      );
      state.ideas = command.ideas.filter((i) => {
        const title = i.title.trim().toLocaleLowerCase("ru");
        if (seen.has(title) || state.dismissedIdeas.includes(`title:${title}`))
          return false;
        seen.add(title);
        return true;
      });
      break;
    }
    case "reserveAI": {
      const recent = state.aiRequests.filter((t) => now.getTime() - t < 60000);
      if (recent.length >= 6)
        throw new Error("Слишком много запросов. Повторите через минуту.");
      state.aiRequests = [...recent, now.getTime()];
      break;
    }
    case "dismissIdea": {
      const idea = state.ideas.find((i) => i.id === command.id);
      if (idea)
        state.dismissedIdeas.push(
          `title:${idea.title.trim().toLocaleLowerCase("ru")}`,
        );
      state.ideas = state.ideas.filter((i) => i.id !== command.id);
      break;
    }
    case "acceptIdea": {
      const idea = state.ideas.find((i) => i.id === command.id);
      if (!idea) throw new Error("Идея уже добавлена или отклонена");
      state.tasks.unshift(
        makeTask(
          command.taskId,
          idea.title,
          idea.category,
          idea.description,
          "idea",
        ),
      );
      state.ideas = state.ideas.filter((i) => i.id !== command.id);
      state.dismissedIdeas.push(
        `title:${idea.title.trim().toLocaleLowerCase("ru")}`,
      );
      break;
    }
    case "deleteTask":
      state.tasks = state.tasks.filter((t) => t.id !== command.taskId);
      delete state.messages[command.taskId];
      state.notices = state.notices.filter((n) => n.taskId !== command.taskId);
      break;
    case "dismissNotice":
      state.notices = state.notices.filter((n) => n.id !== command.id);
      break;
    case "clearHistory":
      state.messages = {};
      state.tasks.forEach((t) => {
        if (t.feedback) t.feedback.text = "";
      });
      state.notices = [];
      break;
    case "tick": {
      if (!state.profile.proactive) break;
      const today = dateKey(now, state.profile.timezone);
      const lastDate = state.delivered
        .findLast((x) => x.startsWith("day:"))
        ?.slice(4);
      if (!command.demo && lastDate === today) break;
      if (
        !command.demo &&
        state.profile.frequency === "weekly" &&
        lastDate &&
        Date.parse(today) - Date.parse(lastDate) < 7 * 86400000
      )
        break;
      for (const t of state.tasks) {
        if (t.feedback) continue;
        const kind = progress(t) === 100 ? "after" : "before";
        if (
          !command.demo &&
          (!t.date ||
            (kind === "before" ? t.date !== today : t.date > today) ||
            !t.reminder ||
            !state.profile.reminders)
        )
          continue;
        const id = `${t.id}:${kind}`;
        if (state.delivered.includes(id)) continue;
        state.notices.push({
          id,
          taskId: t.id,
          kind,
          text:
            kind === "before"
              ? `«${t.title}»: что нужно подготовить? Откройте план и проверьте первый шаг.`
              : `«${t.title}»: как всё прошло? Расскажите о результате и трудностях.`,
        });
        state.delivered.push(id);
        if (!state.delivered.includes(`day:${today}`))
          state.delivered.push(`day:${today}`);
        if (!command.demo) break;
      }
      break;
    }
  }
  if (state.tasks.length > 500)
    throw new Error("Достигнут лимит в 500 задач. Удалите ненужные задачи.");
  return state;
}
