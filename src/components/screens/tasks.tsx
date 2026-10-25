"use client";
import type { AppState } from "@/lib/domain";
import type { LifePilotController } from "@/hooks/use-life-pilot";
import { Search, SlidersHorizontal } from "lucide-react";
import { categories, categoryIds, isTaskDone } from "@/lib/domain";
import { TaskList } from "../task-list";
type Props = { state: AppState } & Pick<
  LifePilotController,
  | "busy"
  | "filter"
  | "setFilter"
  | "search"
  | "setSearch"
  | "sort"
  | "setSort"
  | "setTaskId"
  | "mutate"
>;
export function TasksScreen({
  state,
  busy,
  filter,
  setFilter,
  search,
  setSearch,
  sort,
  setSort,
  setTaskId,
  mutate,
}: Props) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Мои задачи</h1>
        </div>
      </div>
      <div className="task-toolbar">
        <div className="filters">
          <button
            className={filter === "all" ? "chosen" : ""}
            onClick={() => setFilter("all")}
          >
            Все задачи <span>{state.tasks.length}</span>
          </button>
          {categoryIds.map((id) => (
            <button
              key={id}
              className={filter === id ? "chosen" : ""}
              onClick={() => setFilter(id)}
            >
              <span
                className="category-dot"
                style={{ background: categories[id].color }}
              />
              {categories[id].name}
              <span>{state.tasks.filter((t) => t.category === id).length}</span>
            </button>
          ))}
        </div>
        <div className="search-sort">
          <label className="search-box">
            <Search size={18} />
            <input
              aria-label="Найти задачу"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти задачу"
            />
          </label>
          <label className="sort-box">
            <SlidersHorizontal size={17} />
            <select
              aria-label="Сортировка задач"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="created">Сначала новые</option>
              <option value="date">По дате</option>
              <option value="completion">По выполнению</option>
            </select>
          </label>
        </div>
      </div>
      <TaskList
        tasks={state.tasks
          .filter(
            (t) =>
              (filter === "all" || t.category === filter) &&
              t.title
                .toLocaleLowerCase("ru")
                .includes(search.toLocaleLowerCase("ru")),
          )
          .toSorted((a, b) =>
            sort === "date"
              ? (a.date || "9999").localeCompare(b.date || "9999")
              : sort === "completion"
                ? Number(isTaskDone(b)) - Number(isTaskDone(a))
                : b.createdAt.localeCompare(a.createdAt),
          )}
        onOpen={setTaskId}
        busy={busy}
        onToggle={(id, done) => {
          mutate({ type: "setDone", taskId: id, done });
        }}
        empty="Здесь появятся твои задачи"
      />
    </>
  );
}
