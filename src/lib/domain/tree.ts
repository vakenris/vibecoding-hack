import type { Task, TreeNode } from "./schemas";
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
