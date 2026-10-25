import { Temporal } from "@js-temporal/polyfill";
import type { ScheduleSettings, StepEstimate } from "./types";

export interface Interval {
  start: number;
  end: number;
}
export interface Slot {
  stepId: string;
  start: string;
  end: string;
}
export class NoFreeTime extends Error {}

export function deadlineInstant(value: string, timezone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Temporal.PlainDate.from(value)
      .add({ days: 1 })
      .toZonedDateTime(timezone).epochMilliseconds;
  }
  return Temporal.Instant.from(value).epochMilliseconds;
}

export function scheduleSteps(input: {
  steps: StepEstimate[];
  busy: Interval[];
  settings: ScheduleSettings;
  timezone: string;
  now?: number;
  deadline?: string | null;
  after?: number;
}): Slot[] {
  const { settings, timezone } = input;
  const now = input.now ?? Date.now();
  const firstDay = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const horizon = firstDay
    .add({ days: settings.horizonDays })
    .toZonedDateTime(timezone).epochMilliseconds;
  const until = Math.min(
    horizon,
    input.deadline ? deadlineInstant(input.deadline, timezone) : Infinity,
  );
  const pause = settings.breakMinutes * 60000;
  const busy = input.busy
    .filter((i) => i.end > now && i.start < until)
    .map((i) => ({ start: i.start - pause, end: i.end + pause }));
  let cursor = Math.max(now, input.after ?? now);
  const result: Slot[] = [];
  for (const step of input.steps) {
    if (
      !Number.isFinite(step.minutes) ||
      step.minutes < 5 ||
      step.minutes > 240
    )
      throw new Error("Недопустимая длительность действия");
    const duration = step.minutes * 60000;
    let found = false;
    // Iterate real instants: nonexistent local times are never generated, and the
    // repeated hour at the DST boundary remains two distinct intervals.
    for (
      let start = Math.ceil(cursor / 300000) * 300000;
      start + duration <= until;
      start += 300000
    ) {
      const end = start + duration;
      const local =
        Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(
          timezone,
        );
      const localEnd = Temporal.Instant.fromEpochMilliseconds(
        end - 1,
      ).toZonedDateTimeISO(timezone);
      if (
        !settings.days.includes(local.dayOfWeek) ||
        !local.toPlainDate().equals(localEnd.toPlainDate())
      )
        continue;
      let lo = settings.startHour * 60,
        hi = settings.endHour * 60;
      if (step.businessHours) {
        if (local.dayOfWeek > 5) continue;
        lo = Math.max(lo, 9 * 60);
        hi = Math.min(hi, 17 * 60);
      }
      if (step.preference === "morning") hi = Math.min(hi, 12 * 60);
      if (step.preference === "afternoon") {
        lo = Math.max(lo, 12 * 60);
        hi = Math.min(hi, 17 * 60);
      }
      if (step.preference === "evening") lo = Math.max(lo, 17 * 60);
      const minute = local.hour * 60 + local.minute;
      const endMinute =
        localEnd.hour * 60 + localEnd.minute + (localEnd.second + 1) / 60;
      if (minute < lo || endMinute > hi) continue;
      if (busy.some((i) => start < i.end && end > i.start)) continue;
      result.push({
        stepId: step.stepId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
      busy.push({ start: start - pause, end: end + pause });
      cursor = end + pause;
      found = true;
      break;
    }
    if (!found)
      throw new NoFreeTime(
        "До срока или в выбранном горизонте нет времени для всех шагов. Уточните срок, длительность или доступные часы.",
      );
  }
  return result;
}
