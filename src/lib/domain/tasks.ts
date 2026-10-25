import {
  categoryIds,
  type AppState,
  type Task,
  type Scenario,
} from "./schemas";
import { activeSteps } from "./tree";
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
export function checklistComplete(task: Task): boolean {
  const steps = activeSteps(task);
  return (
    steps.length > 0 && steps.every((step) => task.completed.includes(step.id))
  );
}
export function isTaskDone(task: Task): boolean {
  return task.done ?? (Boolean(task.feedback) || checklistComplete(task));
}
export const achievementCatalog = [
  {
    id: "first-choice",
    title: "Свой путь",
    description: "Выбрать вариант в дереве решений",
    icon: "GitBranch",
    color: "#377ac5",
    tint: "#e9f1fc",
  },
  {
    id: "first-result",
    title: "Первое дело",
    description: "Отметить одну задачу сделанной",
    icon: "Check",
    color: "#31835b",
    tint: "#e6f4ea",
  },
  {
    id: "two-results",
    title: "Два шага",
    description: "Выполнить две разные задачи",
    icon: "CheckCheck",
    color: "#bf641f",
    tint: "#fff0df",
  },
  {
    id: "three-categories",
    title: "Разные сферы",
    description: "Выполнить задачи в трёх категориях",
    icon: "Compass",
    color: "#8357c5",
    tint: "#f0e8fa",
  },
  {
    id: "five-results",
    title: "Пять побед",
    description: "Выполнить пять разных задач",
    icon: "Trophy",
    color: "#bd4775",
    tint: "#fbe9f0",
  },
] as const;
export function updateAchievements(state: AppState) {
  const done = state.tasks.filter(isTaskDone);
  const eligible = [
    state.tasks.some((t) => Object.keys(t.selected).length > 0),
    done.length >= 1,
    done.length >= 2,
    new Set(done.map((t) => t.category)).size >= 3,
    done.length >= 5,
  ];
  achievementCatalog.forEach((item, index) => {
    if (eligible[index] && !state.achievements.includes(item.id))
      state.achievements.push(item.id);
  });
}
export function archiveFeedback(task: Task) {
  if (task.feedback) {
    task.feedbackHistory = [
      ...(task.feedbackHistory ?? []),
      task.feedback,
    ].slice(-20);
    delete task.feedback;
  }
}
export function normalizeState(
  input: AppState,
  scenarios: Scenario[],
): AppState {
  const state = structuredClone(input);
  for (const task of state.tasks) {
    task.done = isTaskDone(task);
    const scenario = scenarios.find((s) => s.id === task.scenarioId);
    // Only untouched plans can be upgraded without losing a chosen path or result.
    if (
      scenario &&
      (task.scenarioVersion ?? 1) < scenario.version &&
      !task.done &&
      !Object.keys(task.selected).length &&
      !task.completed.length &&
      !task.feedback
    ) {
      task.tree = structuredClone(scenario.tree);
      task.description = scenario.description;
      task.scenarioVersion = scenario.version;
    }
  }
  updateAchievements(state);
  return state;
}
