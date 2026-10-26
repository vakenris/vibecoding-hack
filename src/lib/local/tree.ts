import { createHash } from "node:crypto";
import { z } from "zod";
import { modelJSON } from "../ai/provider";
import { aiSettings } from "../config";
import {
  PROMPT_VERSION,
  treeStructureGuide,
  leafPlansGuide,
} from "../ai/prompts";
import {
  treeSchema,
  generatedTreeSchema,
  type AppState,
  type Task,
  type DecisionTree,
} from "../domain";
import { database } from "./database";
import type { PlanMeta } from "./types";

const text = z.string().trim().min(1).max(200);
const structureSchema = z
  .object({
    rootId: text,
    nodes: z
      .array(
        z.object({
          id: text,
          title: text,
          question: z.string().max(200).optional(),
          pros: z.array(text).max(4),
          risks: z.array(text).max(4),
          children: z.array(text).max(3),
        }),
      )
      .min(15)
      .max(63),
  })
  .superRefine((tree, context) => {
    // Placeholder actions are used only for structural validation. They are never
    // written to a task or presented as a completed plan.
    const valid = treeSchema.safeParse({
      ...tree,
      nodes: tree.nodes.map((node) => ({
        ...node,
        steps: node.children.length
          ? []
          : [
              {
                id: `${node.id}:draft`,
                title: "Черновик",
                hint: "Требуется подробный конечный план",
              },
            ],
      })),
    });
    if (!valid.success) {
      context.addIssue({
        code: "custom",
        message: "Некорректная структура дерева",
      });
      return;
    }
    const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
    const visit = (id: string, depth: number) => {
      const node = nodes.get(id)!;
      if (
        depth > 5 ||
        (!node.children.length && depth < 3) ||
        (node.children.length > 0 &&
          (node.children.length < 2 || !node.question?.trim())) ||
        (id !== tree.rootId && (!node.pros.length || !node.risks.length))
      )
        context.addIssue({
          code: "custom",
          message:
            "Нужны 3–5 содержательных решений, вопросы, преимущества и риски",
        });
      node.children.forEach((child) => visit(child, depth + 1));
    };
    visit(tree.rootId, 0);
  });
type Structure = z.infer<typeof structureSchema>;
interface Draft {
  structure: Structure;
  plans: Record<string, { title: string; hint: string }[]>;
}

export async function generateLocalTree(
  state: AppState,
  task: Task,
  meta: PlanMeta,
  check: () => void,
  progress: (message: string) => void,
): Promise<DecisionTree> {
  const context = {
    title: task.title,
    description: task.description,
    goals: state.profile.goals,
    requirements: meta.goal?.requirements,
    deadline: meta.explicitDeadline || meta.goal?.deadline || null,
    clarification: meta.userContext,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ promptVersion: PROMPT_VERSION, context }))
    .digest("hex");
  const row = database()
    .prepare("SELECT context_hash,draft FROM tree_drafts WHERE task_id=?")
    .get(task.id) as { context_hash: string; draft: string } | undefined;
  let draft: Draft;
  if (row?.context_hash === fingerprint) draft = JSON.parse(row.draft);
  else {
    progress("Строю содержательные уровни выбора");
    const structure = await modelJSON(
      treeStructureGuide,
      context,
      structureSchema,
      aiSettings().maxTokens,
    );
    check();
    draft = { structure, plans: {} };
    database()
      .prepare(
        "INSERT INTO tree_drafts(task_id,context_hash,draft) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET context_hash=excluded.context_hash,draft=excluded.draft",
      )
      .run(task.id, fingerprint, JSON.stringify(draft));
  }
  const nodes = new Map(draft.structure.nodes.map((node) => [node.id, node]));
  const paths = new Map<string, Structure["nodes"]>();
  const visit = (id: string, path: Structure["nodes"]) => {
    const node = nodes.get(id)!;
    const next = [...path, node];
    if (!node.children.length) paths.set(id, next);
    else node.children.forEach((child) => visit(child, next));
  };
  visit(draft.structure.rootId, []);
  const missing = [...paths.keys()].filter((id) => !draft.plans[id]);
  for (let offset = 0; offset < missing.length; offset += 2) {
    check();
    const batch = missing.slice(offset, offset + 2);
    progress(
      `Детализирую конечные планы: сохранено ${Object.keys(draft.plans).length} из ${paths.size}`,
    );
    const schema = z
      .object({
        plans: z
          .array(
            z.object({
              leafId: z.enum(batch as [string, ...string[]]),
              steps: z
                .array(
                  z.object({
                    title: text,
                    hint: z.string().trim().min(20).max(500),
                  }),
                )
                .min(4)
                .max(6),
            }),
          )
          .length(batch.length),
      })
      .refine(
        (result) =>
          new Set(result.plans.map((plan) => plan.leafId)).size ===
          batch.length,
        "Нужен каждый указанный конечный план",
      );
    const result = await modelJSON(
      leafPlansGuide,
      {
        ...context,
        plans: batch.map((leafId) => ({ leafId, path: paths.get(leafId) })),
      },
      schema,
      4000,
    );
    check();
    result.plans.forEach((plan) => {
      draft.plans[plan.leafId] = plan.steps;
    });
    database()
      .prepare(
        "UPDATE tree_drafts SET draft=? WHERE task_id=? AND context_hash=?",
      )
      .run(JSON.stringify(draft), task.id, fingerprint);
  }
  check();
  return generatedTreeSchema.parse({
    ...draft.structure,
    nodes: draft.structure.nodes.map((node) => ({
      ...node,
      steps: node.children.length
        ? []
        : draft.plans[node.id].map((step, index) => ({
            ...step,
            id: `${node.id}.step.${index + 1}`,
          })),
    })),
  });
}
