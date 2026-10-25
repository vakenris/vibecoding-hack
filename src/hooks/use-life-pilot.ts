"use client";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
} from "react";
import {
  type AppState,
  type Command,
  type CategoryId,
  applyCommand,
  normalizeState,
  dateKey,
  stateSchema,
} from "@/lib/domain";
import { scenarios } from "@/lib/scenarios";
import { demoState } from "@/lib/demo";
import {
  dispatchCommand,
  loadState,
  signOut,
  deleteAccount,
} from "@/app/actions";
import type { LocalSnapshot } from "@/lib/local/types";
import { RequestScope, requestJSON } from "@/lib/client-request";
import { useLocalPolling, type LocalProfile } from "./use-local-polling";
export const DEMO_KEY = "lifepilot-demo-v1";
type Tab = "home" | "tasks" | "ideas" | "settings" | "profile";
export type LifePilotProps = {
  local: boolean;
  cloud: boolean;
  ai: boolean;
  initialState: AppState | null;
  initialError: string;
  initialLocalSnapshot?: LocalSnapshot;
};
export function useLifePilot({
  local,
  ai,
  initialState,
  initialError,
  initialLocalSnapshot,
}: LifePilotProps) {
  const [state, setState] = useState<AppState | null>(initialState);
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(initialError);
  const [toast, setToast] = useState("");
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [thought, setThought] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [localSnapshot, setLocalSnapshot] = useState<LocalSnapshot | undefined>(
    initialLocalSnapshot,
  );
  const [savedDemo, setSavedDemo] = useState<AppState | null>(null);
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeTask = state?.tasks.find((t) => t.id === taskId);
  const liveAI = ai && !demo;
  const aiNotice =
    demo && ai
      ? "AI настроен на сервере. В демо живые запросы выключены. Откройте локальный профиль или облачный аккаунт, чтобы использовать AI."
      : "Для индивидуальных деревьев и рекомендаций нужен подключённый AI API. Готовые сценарии доступны в «Идеях».";
  const onboarded = state?.profile.onboarded ?? false;

  const scope = useRef(new RequestScope());
  useEffect(() => {
    const current = scope.current;
    return () => current.invalidate();
  }, []);
  const receiveProfile = useCallback((profile: LocalProfile) => {
    setState(profile.state);
    setLocalSnapshot(profile.local);
  }, []);
  useLocalPolling(
    local && !demo && state !== null,
    busyRef,
    scope,
    receiveProfile,
  );
  useEffect(() => {
    if (!local || demo) return;
    const timer = setTimeout(() => {
      try {
        const value = localStorage.getItem(DEMO_KEY);
        if (value) setSavedDemo(stateSchema.parse(JSON.parse(value)));
      } catch {
        /* Invalid browser data must not block a local profile. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [local, demo]);

  async function localAction(input: Record<string, unknown>) {
    if (busyRef.current) return false;
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestJSON<LocalProfile>("/api/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: ticket.signal,
      });
      if (!ticket.isCurrent()) return false;
      setState(result.state);
      setLocalSnapshot(result.local);
      return true;
    } catch (error) {
      if (!ticket.isCurrent()) return false;
      setError(error instanceof Error ? error.message : "Ошибка соединения");
      return false;
    } finally {
      if (ticket.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
      ticket.close();
    }
  }
  async function deleteAttachment(id: string) {
    if (busyRef.current) return;
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = true;
    setBusy(true);
    try {
      await requestJSON<{ ok: boolean }>(`/api/local/documents/${id}`, {
        method: "DELETE",
        signal: ticket.signal,
      });
      if (!ticket.isCurrent()) return;
      setLocalSnapshot((previous) =>
        previous
          ? {
              ...previous,
              documents: previous.documents.filter((d) => d.id !== id),
            }
          : previous,
      );
    } catch (error) {
      if (!ticket.isCurrent()) return;
      setError(error instanceof Error ? error.message : "Ошибка соединения");
    } finally {
      if (ticket.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
      ticket.close();
    }
  }

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, taskId, onboarded]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function persist(updated: AppState) {
    if (demo) {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(updated));
      } catch {
        setError(
          "Не удалось сохранить демо в браузере. Освободите место или разрешите локальное хранение.",
        );
      }
    }
    setState(updated);
  }
  async function mutate(command: Command): Promise<AppState | null> {
    if (!state || busyRef.current) return null;
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        let updated = applyCommand(state, command, scenarios);
        if (command.type !== "tick" && command.type !== "clearHistory")
          updated = applyCommand(
            updated,
            { type: "tick", demo: false },
            scenarios,
          );
        persist(updated);
        return updated;
      }
      const result = await dispatchCommand(command);
      if (!ticket.isCurrent()) return null;
      if (result.error || !result.data)
        throw new Error(result.error || "Не удалось сохранить");
      persist(result.data);
      return result.data;
    } catch (e) {
      if (!ticket.isCurrent()) return null;
      setError(
        e instanceof Error ? e.message : "Не удалось сохранить изменения",
      );
      return null;
    } finally {
      if (ticket.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
      ticket.close();
    }
  }
  async function callAI(input: Record<string, string>) {
    if (busyRef.current) return;
    if (!liveAI) {
      setError(aiNotice);
      return;
    }
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestJSON<{ state: AppState }>("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: ticket.signal,
      });
      if (!ticket.isCurrent()) return;
      persist(result.state);
    } catch (e) {
      if (!ticket.isCurrent()) return;
      setError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Время ожидания истекло. Задача сохранена; обновите страницу перед повторным запросом."
          : e instanceof Error
            ? e.message
            : "Ошибка соединения",
      );
    } finally {
      if (ticket.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
      ticket.close();
    }
  }
  function enterDemo() {
    let next = demoState();
    try {
      const saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? "null");
      if (saved) next = normalizeState(stateSchema.parse(saved), scenarios);
    } catch {
      setError(
        "Демо-данные в браузере имеют неподдерживаемый формат. Откройте демо в другом профиле браузера или удалите ключ lifepilot-demo-v1 через настройки сайта.",
      );
      return;
    }
    next = applyCommand(next, { type: "tick", demo: false }, scenarios);
    scope.current.invalidate();
    busyRef.current = false;
    setBusy(false);
    setDemo(true);
    setState(next);
    setError("");
  }
  function navigate(next: Tab) {
    setTab(next);
    setTaskId(null);
    setCalendarDate(null);
    setError("");
  }
  async function startScenario(id: string) {
    const taskId = crypto.randomUUID();
    if (
      await mutate({
        type: "scenario",
        id: taskId,
        scenarioId: id,
        date: dateKey(new Date(), state!.profile.timezone),
      })
    ) {
      setTaskId(taskId);
      setTab("tasks");
    }
  }
  async function createThought(e: FormEvent) {
    e.preventDefault();
    if (attachment && local && !demo) {
      if (busyRef.current) return;
      scope.current.invalidate();
      const ticket = scope.current.begin();
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        const form = new FormData();
        form.append("file", attachment);
        form.append("explanation", thought);
        const result = await requestJSON<{ taskId: string }>(
          "/api/local/documents",
          {
            method: "POST",
            body: form,
            signal: ticket.signal,
          },
        );
        const profile = await requestJSON<LocalProfile>("/api/local", {
          cache: "no-store",
          signal: ticket.signal,
        });
        if (!ticket.isCurrent()) return;
        setState(profile.state);
        setLocalSnapshot(profile.local);
        setAttachment(null);
        setThought("");
        setTab("tasks");
        setTaskId(result.taskId);
      } catch (error) {
        if (!ticket.isCurrent()) return;
        setError(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить документ",
        );
      } finally {
        if (ticket.isCurrent()) {
          busyRef.current = false;
          setBusy(false);
        }
        ticket.close();
      }
      return;
    }
    if (!thought.trim()) return;
    const id = crypto.randomUUID();
    if (
      await mutate({
        type: "create",
        id,
        title: thought.trim(),
        description: "",
        category: state?.profile.interests[0] ?? "global",
        date: "",
        time: "",
        reminder: true,
        source: "thought",
      })
    ) {
      setThought("");
      setTab("tasks");
      setTaskId(id);
    }
  }
  async function logout() {
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = false;
    setBusy(false);
    if (!demo && !local) {
      try {
        const result = await signOut();
        if (!ticket.isCurrent()) {
          ticket.close();
          return;
        }
        if (result.error) {
          setError(result.error);
          ticket.close();
          return;
        }
      } catch {
        if (ticket.isCurrent())
          setError("Нет связи с сервером. Не удалось выйти из аккаунта.");
        ticket.close();
        return;
      }
    }
    ticket.close();
    scope.current.invalidate();
    setState(null);
    setDemo(false);
    setTaskId(null);
    setTab("home");
  }
  async function login() {
    scope.current.invalidate();
    const ticket = scope.current.begin();
    try {
      const result = await loadState();
      if (!ticket.isCurrent()) return;
      if (result.data) {
        setState(result.data);
        setDemo(false);
      } else setError(result.error ?? "Не удалось загрузить профиль");
    } catch {
      if (ticket.isCurrent())
        setError("Нет связи с сервером. Не удалось загрузить профиль.");
    } finally {
      ticket.close();
    }
  }
  async function removeAccount() {
    if (busyRef.current) return;
    if (demo) {
      localStorage.removeItem(DEMO_KEY);
      setConfirmDelete(false);
      await logout();
      return;
    }
    scope.current.invalidate();
    const ticket = scope.current.begin();
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await deleteAccount();
      if (!ticket.isCurrent()) return;
      if (result.error) setError(result.error);
      else {
        scope.current.invalidate();
        setConfirmDelete(false);
        setState(null);
        setTaskId(null);
        busyRef.current = false;
        setBusy(false);
      }
    } catch {
      if (ticket.isCurrent())
        setError("Нет связи с сервером. Удаление аккаунта не подтверждено.");
    } finally {
      if (ticket.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
      ticket.close();
    }
  }
  return {
    state,
    demo,
    tab,
    setTab,
    taskId,
    setTaskId,
    busy,
    error,
    setError,
    toast,
    setToast,
    calendarDate,
    setCalendarDate,
    thought,
    setThought,
    attachment,
    setAttachment,
    localSnapshot,
    savedDemo,
    setSavedDemo,
    filter,
    setFilter,
    search,
    setSearch,
    sort,
    setSort,
    confirmDelete,
    setConfirmDelete,
    activeTask,
    liveAI,
    aiNotice,
    mutate,
    callAI,
    enterDemo,
    navigate,
    startScenario,
    createThought,
    logout,
    localAction,
    deleteAttachment,
    login,
    removeAccount,
  };
}

export type LifePilotController = ReturnType<typeof useLifePilot>;
