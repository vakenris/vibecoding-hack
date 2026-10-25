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
      .max(96),
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
export const generatedTreeSchema = treeSchema.superRefine((tree, ctx) => {
  const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
  let shallow = false;
  const visit = (id: string, depth: number) => {
    const node = nodes.get(id);
    if (!node || depth > 6) return;
    if (node.children.length) {
      if (node.children.length < 2 || !node.question?.trim()) shallow = true;
      node.children.forEach((child) => visit(child, depth + 1));
    } else if (
      depth < 3 ||
      node.steps.length < 4 ||
      node.steps.some((step) => step.hint.trim().length < 20)
    )
      shallow = true;
    if (id !== tree.rootId && (!node.pros.length || !node.risks.length))
      shallow = true;
  };
  // Structural validation already reports cycles; don't recurse into an invalid graph.
  if (!treeSchema.safeParse(tree).success) return;
  visit(tree.rootId, 0);
  if (shallow)
    ctx.addIssue({
      code: "custom",
      message:
        "Нужно подробное дерево: минимум три уровня решений, вопросы, плюсы, риски и четыре действия в каждом конечном плане",
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
  documentId?: string;
  agentJobId?: string;
  scenarioId?: string;
  scenarioVersion?: number;
  done?: boolean;
  tree?: DecisionTree;
  selected: Record<string, string>;
  completed: string[];
  feedback?: Feedback;
  feedbackHistory?: Feedback[];
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
        documentId: z.string().uuid().optional(),
        agentJobId: z.string().uuid().optional(),
        scenarioId: z.string().optional(),
        scenarioVersion: z.number().int().optional(),
        done: z.boolean().optional(),
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
        feedbackHistory: z
          .array(
            z.object({
              outcome: z.enum(["independent", "help", "difficulty"]),
              text: z.string().max(2000),
              at: z.string(),
            }),
          )
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
    type: z.literal("setDone"),
    taskId: taskIdSchema,
    done: z.boolean(),
  }),
  z.object({
    type: z.literal("toggleStep"),
    taskId: taskIdSchema,
    stepId: shortText,
    done: z.boolean(),
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
  | {
      type: "tree";
      taskId: string;
      tree: DecisionTree;
      expectedContext?: string;
    }
  | { type: "message"; taskId: string; message: Message }
  | { type: "ideas"; ideas: Idea[] }
  | {
      type: "reserveAI";
      taskId?: string;
      expectedContext?: string;
      operation?: "tree" | "mentor";
    }
  | {
      type: "mentorExchange";
      taskId: string;
      messages: [Message, Message];
      expectedContext: string;
    };
export interface Scenario {
  id: string;
  version: number;
  title: string;
  description: string;
  category: CategoryId;
  duration: string;
  tree: DecisionTree;
}
