import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("../src/lib/ai/provider", () => ({ modelJSON: vi.fn() }));
vi.mock("../src/lib/config", () => ({
  aiSettings: () => ({ maxTokens: 16000 }),
}));
import { modelJSON } from "../src/lib/ai/provider";
import { generateLocalTree } from "../src/lib/local/tree";
import {
  applyCommand,
  emptyState,
  generatedTreeSchema,
} from "../src/lib/domain";
import { scenarios } from "../src/lib/scenarios";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifepilot-tree-"));
  process.env.LOCAL_DATA_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("incremental detailed tree generation", () => {
  it("resumes completed leaf batches and preserves the full detailed-tree gate", async () => {
    const state = applyCommand(
      emptyState(),
      {
        type: "scenario",
        id: "90789ba0-ceac-4056-94c4-ad48c5439866",
        scenarioId: scenarios[0].id,
        date: "",
      },
      scenarios,
    );
    const task = { ...state.tasks[0], tree: undefined };
    let batches = 0,
      failed = false;
    vi.mocked(modelJSON).mockImplementation(
      async (instruction, input, schema) => {
        if (instruction.includes("TASK: tree_structure"))
          return schema.parse(scenarios[0].tree);
        batches++;
        if (batches === 2 && !failed) {
          failed = true;
          throw new Error("temporary failure");
        }
        const context = input as { plans: { leafId: string }[] };
        return schema.parse({
          plans: context.plans.map((plan) => ({
            leafId: plan.leafId,
            steps: scenarios[0].tree.nodes
              .find((node) => node.id === plan.leafId)!
              .steps.map((step) => ({ title: step.title, hint: step.hint })),
          })),
        });
      },
    );
    await expect(
      generateLocalTree(
        state,
        task,
        {},
        () => {},
        () => {},
      ),
    ).rejects.toThrow("temporary failure");
    const result = await generateLocalTree(
      state,
      task,
      {},
      () => {},
      () => {},
    );
    expect(generatedTreeSchema.safeParse(result).success).toBe(true);
    expect(
      vi
        .mocked(modelJSON)
        .mock.calls.filter(([instruction]) =>
          instruction.includes("TASK: tree_structure"),
        ),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(modelJSON)
        .mock.calls.find(([instruction]) =>
          instruction.includes("TASK: tree_structure"),
        )?.[3],
    ).toBe(16000);
    expect(
      result.nodes
        .filter((node) => !node.children.length)
        .every(
          (node) =>
            node.steps.length >= 4 &&
            node.steps.every(
              (step) => step.hint.length >= 20 && step.title !== "Черновик",
            ),
        ),
    ).toBe(true);
    const leafCount = result.nodes.filter(
      (node) => !node.children.length,
    ).length;
    expect(batches).toBe(Math.ceil(leafCount / 2) + 1);
  });
});

it("rebuilds a partial draft created before prompt versioning", async () => {
  const { createHash } = await import("node:crypto");
  const { database } = await import("../src/lib/local/database");
  const state = applyCommand(
    emptyState(),
    {
      type: "scenario",
      id: crypto.randomUUID(),
      scenarioId: scenarios[0].id,
      date: "",
    },
    scenarios,
  );
  const task = { ...state.tasks[0], tree: undefined };
  const legacyHash = createHash("sha256")
    .update(
      JSON.stringify({
        title: task.title,
        description: task.description,
        goals: state.profile.goals,
        deadline: null,
      }),
    )
    .digest("hex");
  database()
    .prepare(
      "INSERT INTO tree_drafts(task_id,context_hash,draft) VALUES(?,?,?)",
    )
    .run(task.id, legacyHash, JSON.stringify({ structure: {}, plans: {} }));
  vi.mocked(modelJSON)
    .mockClear()
    .mockImplementation(async (instruction, input, schema) => {
      if (instruction.includes("TASK: tree_structure"))
        return schema.parse(scenarios[0].tree);
      const context = input as { plans: { leafId: string }[] };
      return schema.parse({
        plans: context.plans.map(({ leafId }) => ({
          leafId,
          steps: scenarios[0].tree.nodes
            .find((node) => node.id === leafId)!
            .steps.map(({ title, hint }) => ({ title, hint })),
        })),
      });
    });
  const result = await generateLocalTree(
    state,
    task,
    {},
    () => {},
    () => {},
  );
  expect(generatedTreeSchema.safeParse(result).success).toBe(true);
  expect(
    vi
      .mocked(modelJSON)
      .mock.calls.filter(([instruction]) =>
        instruction.includes("TASK: tree_structure"),
      ),
  ).toHaveLength(1);
});
