import { type AppState, type Task, dateKey, emptyState } from "./domain";
import { scenarios } from "./scenarios";
export function demoState(): AppState {
  const state = emptyState();
  const today = dateKey();
  state.profile.name = "Саша";
  state.tasks = scenarios.slice(0, 5).map((s, i): Task => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    title: s.title,
    description: s.description,
    category: s.category,
    date: i < 2 ? today : dateKey(new Date(Date.now() + i * 86400000)),
    time: i === 0 ? "16:00" : "",
    reminder: true,
    source: "scenario",
    scenarioId: s.id,
    scenarioVersion: s.version,
    done: false,
    tree: structuredClone(s.tree),
    selected: {},
    completed: [],
    awarded: [],
    createdAt: new Date().toISOString(),
  }));
  return state;
}
