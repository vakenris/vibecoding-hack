import {
  generatedTreeSchema,
  type CategoryId,
  type AppState,
  type Task,
  type Message,
  type TrustedCommand,
  type Scenario,
} from "./schemas";
import {
  normalizeState,
  dateKey,
  isTaskDone,
  checklistComplete,
  updateAchievements,
  archiveFeedback,
} from "./tasks";
import { activePath, activeSteps } from "./tree";
import { AppError } from "../errors";
import { assertTaskContext } from "./context";
export function applyCommand(
  input: AppState,
  command: TrustedCommand,
  scenarios: Scenario[],
  now = new Date(),
): AppState {
  const state = normalizeState(input, scenarios);
  const task =
    "taskId" in command
      ? state.tasks.find((t) => t.id === command.taskId)
      : undefined;
  if (
    "expectedContext" in command &&
    command.expectedContext &&
    "taskId" in command &&
    command.taskId
  )
    assertTaskContext(state, command.taskId, command.expectedContext);
  if (
    "taskId" in command &&
    command.taskId &&
    command.type !== "acceptIdea" &&
    !task
  )
    throw new AppError("NOT_FOUND", "Задача не найдена", 404);
  if (
    command.type === "reserveAI" &&
    command.operation === "tree" &&
    (task?.tree || (task && isTaskDone(task)))
  )
    throw new AppError(
      "CONFLICT",
      "Дерево уже создано или задача выполнена",
      409,
    );
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
    done: false,
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
      if (!scenario) throw new AppError("CONFLICT", "Сценарий не найден", 409);
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
        scenarioVersion: scenario.version,
        tree: structuredClone(scenario.tree),
      });
      break;
    }
    case "category":
      if (task!.feedback || task!.source === "scenario")
        throw new AppError(
          "CONFLICT",
          "Категория готового прохождения не меняется",
          409,
        );
      task!.category = command.category;
      break;
    case "select": {
      if (isTaskDone(task!))
        throw new AppError(
          "CONFLICT",
          "Снимите отметку «Сделано», чтобы изменить путь",
          409,
        );
      const parent = activePath(task!).find((n) => n.id === command.parent);
      if (!parent?.children.includes(command.child))
        throw new AppError("CONFLICT", "Выберите доступную ветку", 409);
      task!.selected[command.parent] = command.child;
      task!.done = checklistComplete(task!);
      break;
    }
    case "setDone": {
      const steps = activeSteps(task!);
      task!.done = command.done;
      if (command.done)
        task!.completed = [
          ...new Set([...task!.completed, ...steps.map((s) => s.id)]),
        ];
      else {
        archiveFeedback(task!);
        const ids = new Set(steps.map((s) => s.id));
        task!.completed = task!.completed.filter((id) => !ids.has(id));
      }
      break;
    }
    case "complete":
    case "toggleStep": {
      if (!activeSteps(task!).some((s) => s.id === command.stepId))
        throw new AppError(
          "CONFLICT",
          "Действие не принадлежит выбранному пути",
          409,
        );
      const checked = command.type === "complete" || command.done;
      if (checked)
        task!.completed = [...new Set([...task!.completed, command.stepId])];
      else {
        archiveFeedback(task!);
        task!.completed = task!.completed.filter((id) => id !== command.stepId);
      }
      task!.done = checklistComplete(task!);
      break;
    }
    case "feedback": {
      if (task!.feedback) break;
      if (!isTaskDone(task!))
        throw new AppError(
          "CONFLICT",
          "Сначала отметьте задачу сделанной",
          409,
        );
      task!.feedback = {
        outcome: command.outcome,
        text: command.text,
        at: now.toISOString(),
      };
      state.notices = state.notices.filter((n) => n.taskId !== task!.id);
      break;
    }
    case "tree":
      if (task!.tree) throw new AppError("CONFLICT", "Дерево уже создано", 409);
      task!.tree = generatedTreeSchema.parse(command.tree);
      task!.tree.nodes.find((n) => n.id === task!.tree!.rootId)!.title =
        task!.title;
      break;
    case "mentorDemo": {
      const next = activeSteps(task!).find(
        (s) => !task!.completed.includes(s.id),
      );
      const text = isTaskDone(task!)
        ? "Задача отмечена сделанной. Как прошла попытка: самостоятельно, с помощью или возникли трудности? Сохрани результат под чек-листом."
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
    case "mentorExchange":
      state.messages[command.taskId] = [
        ...(state.messages[command.taskId] ?? []),
        ...command.messages,
      ].slice(-100);
      break;
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
        throw new AppError(
          "RATE_LIMITED",
          "Слишком много запросов. Повторите через минуту.",
          429,
          true,
        );
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
      if (!idea)
        throw new AppError("CONFLICT", "Идея уже добавлена или отклонена", 409);
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
        t.feedbackHistory?.forEach((f) => {
          f.text = "";
        });
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
        const kind = isTaskDone(t) ? "after" : "before";
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
    throw new AppError(
      "CONFLICT",
      "Достигнут лимит в 500 задач. Удалите ненужные задачи.",
      409,
    );
  updateAchievements(state);
  return state;
}
