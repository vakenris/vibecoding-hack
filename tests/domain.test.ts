import { describe, expect, it } from "vitest";
import {
  applyCommand,
  activePath,
  activeSteps,
  commandSchema,
  emptyState,
  progress,
  skill,
  treeSchema,
  type AppState,
  type TrustedCommand,
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
  taskId = id,
  route = "route-0",
  leaf = "leaf-0-0",
) {
  state = apply(state, {
    type: "select",
    taskId,
    parent: "root",
    child: route,
  });
  return apply(state, { type: "select", taskId, parent: route, child: leaf });
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
describe("scenario and progress invariants", () => {
  it("validates every prepared scenario", () => {
    for (const s of scenarios)
      expect(treeSchema.safeParse(s.tree).success).toBe(true);
  });
  it.each(["exam", "laundry"])(
    "finishes %s and preserves the result through a storage roundtrip",
    (scenarioId) => {
      let state = choose(start(scenarioId));
      expect(progress(state.tasks[0])).toBe(0);
      state = finish(state);
      const saved = JSON.parse(JSON.stringify(state));
      expect(progress(saved.tasks[0])).toBe(100);
      expect(skill(saved, scenarioId)).toBe("Делаю самостоятельно");
      expect(saved.points).toBe(50);
      expect(saved.achievements).toEqual(["first-result"]);
    },
  );
  it("does not award twice for retried completion and feedback requests", () => {
    let state = choose(start());
    const command = {
      type: "complete",
      taskId: id,
      stepId: activeSteps(state.tasks[0])[0].id,
    } as const;
    state = apply(apply(state, command), command);
    expect(state.points).toBe(10);
    state = finish(state);
    const retry = apply(state, {
      type: "feedback",
      taskId: id,
      outcome: "difficulty",
      text: "Повторный запрос",
    });
    expect(retry).toEqual(state);
  });
  it("preserves earlier branches but calculates only the active checklist", () => {
    let state = choose(start());
    state = apply(state, {
      type: "complete",
      taskId: id,
      stepId: "step-0-0-0",
    });
    state = apply(state, {
      type: "select",
      taskId: id,
      parent: "root",
      child: "route-1",
    });
    expect(progress(state.tasks[0])).toBe(0);
    expect(state.tasks[0].completed).toEqual(["step-0-0-0"]);
    state = apply(state, {
      type: "select",
      taskId: id,
      parent: "root",
      child: "route-0",
    });
    expect(progress(state.tasks[0])).toBe(33);
    expect(activePath(state.tasks[0]).map((n) => n.id)).toEqual([
      "root",
      "route-0",
      "leaf-0-0",
    ]);
  });
  it("rejects hidden actions, unreachable branches and early feedback", () => {
    const state = choose(start());
    expect(() =>
      apply(state, { type: "complete", taskId: id, stepId: "step-1-0-0" }),
    ).toThrow();
    expect(() =>
      apply(state, {
        type: "select",
        taskId: id,
        parent: "route-1",
        child: "leaf-1-0",
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
  it("requires a second distinct successful attempt for reinforcement", () => {
    let state = finish(choose(start()));
    expect(skill(state, "exam")).toBe("Делаю самостоятельно");
    state = finish(choose(start("exam", state, second), second), second);
    expect(skill(state, "exam")).toBe("Закреплено");
    expect(state.achievements).toContain("two-results");
  });
  it("does not call an assisted attempt independent", () => {
    let state = choose(start());
    for (const step of activeSteps(state.tasks[0]))
      state = apply(state, { type: "complete", taskId: id, stepId: step.id });
    state = apply(state, {
      type: "feedback",
      taskId: id,
      outcome: "help",
      text: "",
    });
    expect(skill(state, "exam")).toBe("Осваиваю");
  });
  it("does not mutate its input and ignores retried creation", () => {
    const input = emptyState();
    const state = start("exam", input);
    expect(input.tasks).toHaveLength(0);
    expect(start("exam", state).tasks).toHaveLength(1);
  });
});
describe("validation and AI boundaries", () => {
  it("rejects invalid dates without throwing, invalid timezones and forged progress commands", () => {
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
        type: "profile",
        name: "Саша",
        goals: "",
        interests: ["home"],
        level: "Осваиваю",
        timezone: "wrong",
        proactive: false,
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
  it("rejects cycles, orphan nodes, shared children and duplicate step ids", () => {
    const cycle = structuredClone(scenarios[0].tree);
    cycle.nodes[1].children = ["root"];
    expect(treeSchema.safeParse(cycle).success).toBe(false);
    const orphan = structuredClone(scenarios[0].tree);
    orphan.nodes[0].children.pop();
    expect(treeSchema.safeParse(orphan).success).toBe(false);
    const duplicate = structuredClone(scenarios[0].tree);
    duplicate.nodes[3].steps[0].id = duplicate.nodes[2].steps[0].id;
    expect(treeSchema.safeParse(duplicate).success).toBe(false);
  });
  it("accepts and dismisses AI ideas without requiring an existing task", () => {
    let state = apply(emptyState(), {
      type: "ideas",
      ideas: [
        {
          id: "idea",
          title: "Квартира",
          description: "Уточнить критерии",
          reason: "Твоя цель",
          category: "global",
        },
      ],
    });
    state = apply(state, { type: "acceptIdea", id: "idea", taskId: id });
    expect(state.tasks[0].title).toBe("Квартира");
    expect(state.ideas).toHaveLength(0);
    expect(() =>
      apply(state, { type: "acceptIdea", id: "idea", taskId: second }),
    ).toThrow();
  });
  it("limits model requests per user", () => {
    let state = emptyState();
    for (let i = 0; i < 6; i++) state = apply(state, { type: "reserveAI" });
    expect(() => apply(state, { type: "reserveAI" })).toThrow(/минуту/);
  });
});
describe("consent and privacy", () => {
  it("does not initiate without consent or duplicate the same event", () => {
    let state = start();
    state = apply(state, { type: "tick", demo: true });
    expect(state.notices).toHaveLength(0);
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
  it("respects daily frequency and disabled reminders", () => {
    let state = start("laundry", start(), second);
    state.profile.proactive = true;
    state = apply(apply(state, { type: "tick", demo: false }), {
      type: "tick",
      demo: false,
    });
    expect(state.notices).toHaveLength(1);
    state = start();
    state.profile.proactive = true;
    state.profile.reminders = false;
    expect(apply(state, { type: "tick", demo: false }).notices).toHaveLength(0);
  });
  it("clears saved demo conversations and feedback text but keeps progress", () => {
    let state = finish(choose(start()));
    state = apply(state, {
      type: "mentorDemo",
      taskId: id,
      text: "Что дальше?",
    });
    expect(state.messages[id]).toHaveLength(2);
    state = apply(state, { type: "clearHistory" });
    expect(state.messages).toEqual({});
    expect(state.tasks[0].feedback?.text).toBe("");
    expect(state.points).toBe(50);
  });
});
