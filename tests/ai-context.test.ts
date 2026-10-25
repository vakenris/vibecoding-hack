import { expect, it } from "vitest";
import {
  applyCommand,
  emptyState,
  stateSchema,
  taskContextKey,
} from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
it("preserves context identity through a persisted JSON/schema round trip", () => {
  const id = crypto.randomUUID();
  const state = applyCommand(
    emptyState(),
    { type: "scenario", id, scenarioId: scenarios[0].id, date: "" },
    scenarios,
  );
  const expected = taskContextKey(state, id);
  const persisted = stateSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(taskContextKey(persisted, id)).toBe(expected);
  persisted.tasks[0].agentJobId = crypto.randomUUID();
  expect(taskContextKey(persisted, id)).toBe(expected);
  persisted.profile.goals = "Другая цель";
  expect(taskContextKey(persisted, id)).not.toBe(expected);
});
