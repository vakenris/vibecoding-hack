import { describe, expect, it } from "vitest";
import {
  applyCommand,
  activePath,
  activeSteps,
  commandSchema,
  emptyState,
  isTaskDone,
  normalizeState,
  stateSchema,
  treeSchema,
  generatedTreeSchema,
  achievementCatalog,
  type AppState,
  type TrustedCommand,
  type DecisionTree,
} from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
const id = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-25T10:00:00Z");
const apply = (s: AppState, c: TrustedCommand) =>
  applyCommand(s, c, scenarios, now);
function start(scenarioId = "exam", state = emptyState(), taskId = id) {
  return apply(state, {
    type: "scenario",
    id: taskId,
    scenarioId,
    date: "2026-10-25",
  });
}
function choose(
  state: AppState,
  choices = ["alone", "week", "written", "timed"],
  taskId = id,
) {
  for (const choice of choices) {
    const task = state.tasks.find((t) => t.id === taskId)!;
    const parent = activePath(task).at(-1)!;
    const child = parent.children.find((id) => id.endsWith(`-${choice}`))!;
    state = apply(state, { type: "select", taskId, parent: parent.id, child });
  }
  return state;
}
function finish(state: AppState, taskId = id) {
  for (const step of activeSteps(state.tasks.find((t) => t.id === taskId)!))
    state = apply(state, { type: "complete", taskId, stepId: step.id });
  return apply(state, {
    type: "feedback",
    taskId,
    outcome: "independent",
    text: "Получилось",
  });
}
const legacyTree: DecisionTree = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      title: "Старый план",
      pros: [],
      risks: [],
      children: ["old"],
      steps: [],
    },
    {
      id: "old",
      title: "Старый выбор",
      pros: [],
      risks: [],
      children: [],
      steps: [
        {
          id: "old-step",
          title: "Старое действие",
          hint: "Сохранённая инструкция",
        },
      ],
    },
  ],
};
describe("detailed scenarios", () => {
  it("has four meaningful decisions on every prepared path, with risks and concrete final actions", () => {
    for (const scenario of scenarios) {
      expect(
        generatedTreeSchema.safeParse(scenario.tree).success,
        scenario.id,
      ).toBe(true);
      const visit = (id: string, depth: number) => {
        const node = scenario.tree.nodes.find((n) => n.id === id)!;
        if (!node.children.length) {
          expect(depth).toBeGreaterThanOrEqual(4);
          expect(node.steps.length).toBeGreaterThanOrEqual(4);
        } else node.children.forEach((child) => visit(child, depth + 1));
      };
      visit(scenario.tree.rootId, 0);
    }
  });
  it("explains temperature tradeoffs and tailors the final laundry plan to the selected temperature", () => {
    const state = choose(start("laundry"), ["ordinary", "30", "stain", "flat"]);
    const temperature = activePath(state.tasks[0]).find((n) =>
      n.title.startsWith("30 °C"),
    )!;
    expect(temperature.risks.join(" ")).toContain("хуже");
    const steps = activeSteps(state.tasks[0]);
    expect(steps.some((s) => s.title.includes("30 °C"))).toBe(true);
    expect(steps.some((s) => s.title.includes("пятно"))).toBe(true);
    expect(steps.at(-1)!.title).toContain("горизонтально");
  });
  it.each([
    ["exam", ["alone", "week", "written", "timed"]],
    ["laundry", ["ordinary", "30", "light", "hang"]],
  ])("finishes %s without percentages or scores", (scenarioId, choices) => {
    let state = choose(start(scenarioId as string), choices as string[]);
    expect(isTaskDone(state.tasks[0])).toBe(false);
    state = finish(state);
    const saved = stateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(isTaskDone(saved.tasks[0])).toBe(true);
    expect(saved.tasks[0].feedback?.outcome).toBe("independent");
    expect(saved.achievements).toContain("first-result");
  });
});
describe("binary completion", () => {
  it("is idempotent when completion and feedback requests are retried", () => {
    let state = choose(start());
    const command = {
      type: "complete",
      taskId: id,
      stepId: activeSteps(state.tasks[0])[0].id,
    } as const;
    state = apply(apply(state, command), command);
    expect(state.tasks[0].completed).toHaveLength(1);
    state = finish(state);
    expect(
      apply(state, {
        type: "feedback",
        taskId: id,
        outcome: "difficulty",
        text: "Повтор",
      }),
    ).toEqual(state);
  });
  it("can mark any task done and undone without requiring an AI tree", () => {
    let state = apply(emptyState(), {
      type: "create",
      id,
      title: "Моя задача",
      description: "",
      category: "home",
      date: "",
      time: "",
      reminder: false,
      source: "thought",
    });
    state = apply(state, { type: "setDone", taskId: id, done: true });
    expect(isTaskDone(state.tasks[0])).toBe(true);
    state = apply(state, { type: "setDone", taskId: id, done: false });
    expect(isTaskDone(state.tasks[0])).toBe(false);
  });
  it("synchronizes the whole task checkbox with the active checklist", () => {
    let state = choose(start());
    state = apply(state, { type: "setDone", taskId: id, done: true });
    expect(
      activeSteps(state.tasks[0]).every((s) =>
        state.tasks[0].completed.includes(s.id),
      ),
    ).toBe(true);
    const stepId = activeSteps(state.tasks[0])[0].id;
    state = apply(state, {
      type: "toggleStep",
      taskId: id,
      stepId,
      done: false,
    });
    expect(isTaskDone(state.tasks[0])).toBe(false);
    state = apply(state, {
      type: "toggleStep",
      taskId: id,
      stepId,
      done: true,
    });
    expect(isTaskDone(state.tasks[0])).toBe(true);
    state = apply(state, { type: "setDone", taskId: id, done: false });
    expect(
      activeSteps(state.tasks[0]).some((s) =>
        state.tasks[0].completed.includes(s.id),
      ),
    ).toBe(false);
  });
  it("archives feedback when reopening instead of losing the previous result", () => {
    let state = finish(choose(start()));
    state = apply(state, { type: "setDone", taskId: id, done: false });
    expect(state.tasks[0].feedback).toBeUndefined();
    expect(state.tasks[0].feedbackHistory?.[0].text).toBe("Получилось");
    state = finish(state);
    expect(state.tasks[0].feedbackHistory).toHaveLength(1);
  });
  it("preserves earlier branches and only exposes the selected path", () => {
    let state = choose(start());
    const stepId = activeSteps(state.tasks[0])[0].id;
    state = apply(state, { type: "complete", taskId: id, stepId });
    state = apply(state, {
      type: "select",
      taskId: id,
      parent: "root",
      child: "root-together",
    });
    expect(activeSteps(state.tasks[0])).toHaveLength(0);
    expect(isTaskDone(state.tasks[0])).toBe(false);
    state = apply(state, {
      type: "select",
      taskId: id,
      parent: "root",
      child: "root-alone",
    });
    expect(state.tasks[0].completed).toContain(stepId);
    expect(activePath(state.tasks[0])).toHaveLength(5);
  });
  it("rejects hidden actions, unavailable branches and feedback before completion", () => {
    const state = choose(start());
    expect(() =>
      apply(state, { type: "complete", taskId: id, stepId: "hidden-step" }),
    ).toThrow();
    expect(() =>
      apply(state, {
        type: "select",
        taskId: id,
        parent: "root-together",
        child: "root-together-week",
      }),
    ).toThrow();
    expect(() =>
      apply(state, {
        type: "feedback",
        taskId: id,
        outcome: "independent",
        text: "",
      }),
    ).toThrow();
  });
});
describe("five achievements and legacy state", () => {
  it("has exactly five distinct achievements and never duplicates an earned one", () => {
    expect(achievementCatalog).toHaveLength(5);
    let state = emptyState();
    for (let i = 0; i < 5; i++) {
      const taskId = `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      state = start(
        ["exam", "laundry", "move", "interview", "savings"][i],
        state,
        taskId,
      );
      if (!i) state = choose(state);
      state = apply(state, { type: "setDone", taskId, done: true });
    }
    expect(
      achievementCatalog.every((a) => state.achievements.includes(a.id)),
    ).toBe(true);
    const repeated = apply(
      apply(state, { type: "setDone", taskId: id, done: false }),
      { type: "setDone", taskId: id, done: true },
    );
    expect(new Set(repeated.achievements).size).toBe(5);
  });
  it("preserves a started old tree, its results and historical score fields", () => {
    const state = start();
    const task = state.tasks[0];
    task.tree = legacyTree;
    delete task.scenarioVersion;
    delete task.done;
    task.selected = { root: "old" };
    task.completed = ["old-step"];
    state.points = 50;
    const migrated = normalizeState(state, scenarios);
    expect(isTaskDone(migrated.tasks[0])).toBe(true);
    expect(migrated.tasks[0].tree).toEqual(legacyTree);
    expect(migrated.points).toBe(50);
    expect(task.done).toBeUndefined();
  });
  it("upgrades only untouched prepared plans and accepts old documents", () => {
    const state = start();
    state.tasks[0].tree = legacyTree;
    delete state.tasks[0].scenarioVersion;
    delete state.tasks[0].done;
    expect(stateSchema.safeParse(state).success).toBe(true);
    const migrated = normalizeState(state, scenarios);
    expect(migrated.tasks[0].scenarioVersion).toBe(2);
    expect(migrated.tasks[0].tree).toEqual(scenarios[0].tree);
  });
});
describe("validation and privacy", () => {
  it("rejects shallow AI output but still reads old stored trees", () => {
    expect(treeSchema.safeParse(legacyTree).success).toBe(true);
    expect(generatedTreeSchema.safeParse(legacyTree).success).toBe(false);
  });
  it("rejects cycles, orphan nodes and duplicate actions", () => {
    const cycle = structuredClone(scenarios[0].tree);
    cycle.nodes[1].children = ["root"];
    expect(treeSchema.safeParse(cycle).success).toBe(false);
    const orphan = structuredClone(scenarios[0].tree);
    orphan.nodes[0].children.pop();
    expect(treeSchema.safeParse(orphan).success).toBe(false);
    const duplicate = structuredClone(scenarios[0].tree);
    const leaves = duplicate.nodes.filter((n) => n.steps.length);
    leaves[1].steps[0].id = leaves[0].steps[0].id;
    expect(treeSchema.safeParse(duplicate).success).toBe(false);
  });
  it("validates dates and refuses client-injected trees and scores", () => {
    expect(
      commandSchema.safeParse({
        type: "create",
        id,
        title: "Тест",
        description: "",
        category: "home",
        date: "2026-99-99",
        time: "",
        reminder: true,
        source: "manual",
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "tree",
        taskId: id,
        tree: scenarios[0].tree,
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({ type: "points", points: 1000 }).success,
    ).toBe(false);
  });
  it("accepts an idea once and limits AI requests", () => {
    let state = apply(emptyState(), {
      type: "ideas",
      ideas: [
        {
          id: "idea",
          title: "Квартира",
          description: "",
          reason: "",
          category: "global",
        },
      ],
    });
    state = apply(state, { type: "acceptIdea", id: "idea", taskId: id });
    expect(state.tasks[0].title).toBe("Квартира");
    expect(() =>
      apply(state, { type: "acceptIdea", id: "idea", taskId: second }),
    ).toThrow();
    for (let i = 0; i < 6; i++) state = apply(state, { type: "reserveAI" });
    expect(() => apply(state, { type: "reserveAI" })).toThrow(/минуту/);
  });
  it("requires consent, respects reminder settings and deduplicates events", () => {
    let state = start();
    expect(apply(state, { type: "tick", demo: true }).notices).toHaveLength(0);
    state.profile.proactive = true;
    state = apply(apply(state, { type: "tick", demo: true }), {
      type: "tick",
      demo: true,
    });
    expect(state.notices).toHaveLength(1);
    state = apply(state, {
      type: "settings",
      proactive: false,
      reminders: false,
      frequency: "daily",
    });
    expect(state.notices).toHaveLength(0);
  });
  it("clears both current and archived feedback text without changing completion", () => {
    let state = finish(choose(start()));
    state = apply(state, { type: "setDone", taskId: id, done: false });
    state = finish(state);
    state = apply(state, {
      type: "mentorDemo",
      taskId: id,
      text: "Что дальше?",
    });
    state = apply(state, { type: "clearHistory" });
    expect(state.messages).toEqual({});
    expect(state.tasks[0].feedback?.text).toBe("");
    expect(state.tasks[0].feedbackHistory?.[0].text).toBe("");
    expect(isTaskDone(state.tasks[0])).toBe(true);
  });
});
