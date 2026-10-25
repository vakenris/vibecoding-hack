import ICAL from "ical.js";
import { Temporal } from "@js-temporal/polyfill";
import type { Interval } from "./scheduler";

function instant(time: ICAL.Time, timezone: string, tzid?: string): number {
  if (time.zone.tzid === "UTC") return time.toJSDate().getTime();
  if (time.zone.component) return time.toJSDate().getTime();
  return Temporal.ZonedDateTime.from(
    {
      timeZone:
        tzid || (time.zone.tzid !== "floating" ? time.zone.tzid : timezone),
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.isDate ? 0 : time.hour,
      minute: time.isDate ? 0 : time.minute,
      second: time.isDate ? 0 : time.second,
    },
    { disambiguation: "compatible" },
  ).epochMilliseconds;
}
function component(data: string) {
  const calendar = new ICAL.Component(ICAL.parse(data));
  if (calendar.name !== "vcalendar") throw new Error("Некорректный iCalendar");
  for (const zone of calendar.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(new ICAL.Timezone(zone));
  }
  return calendar;
}
export function busyIntervals(
  data: string,
  start: number,
  end: number,
  timezone: string,
): Interval[] {
  const calendar = component(data);
  const components = calendar.getAllSubcomponents("vevent");
  const masters = new Set(
    components
      .filter((c) => !c.hasProperty("recurrence-id"))
      .map((c) => String(c.getFirstPropertyValue("uid"))),
  );
  const result: Interval[] = [];
  for (const c of components) {
    if (
      c.hasProperty("recurrence-id") &&
      masters.has(String(c.getFirstPropertyValue("uid")))
    )
      continue;
    const event = new ICAL.Event(c);
    const add = (item: ICAL.Event, from: ICAL.Time, to: ICAL.Time) => {
      if (
        item.component.getFirstPropertyValue("status") === "CANCELLED" ||
        item.component.getFirstPropertyValue("transp") === "TRANSPARENT"
      )
        return;
      const a = instant(
        from,
        timezone,
        item.component.getFirstProperty("dtstart")?.getParameter("tzid") as
          string | undefined,
      );
      const b = instant(
        to,
        timezone,
        (item.component.getFirstProperty("dtend")?.getParameter("tzid") ||
          item.component.getFirstProperty("dtstart")?.getParameter("tzid")) as
          string | undefined,
      );
      if (a < end && b > start) result.push({ start: a, end: b });
    };
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    let exhausted = false;
    for (let count = 0; count < 50000; count++) {
      const next = iterator.next();
      if (!next) {
        exhausted = true;
        break;
      }
      const occurrence = event.getOccurrenceDetails(next);
      const at = instant(
        occurrence.startDate,
        timezone,
        c.getFirstProperty("dtstart")?.getParameter("tzid") as
          string | undefined,
      );
      if (at >= end) {
        exhausted = true;
        break;
      }
      add(occurrence.item, occurrence.startDate, occurrence.endDate);
    }
    if (!exhausted)
      throw new Error(
        "Слишком сложное повторяющееся событие. Не удалось безопасно проверить занятость.",
      );
    // Moved exceptions can fall into the range even when their original date does not.
    for (const exception of Object.values(event.exceptions))
      add(exception, exception.startDate, exception.endDate);
  }
  return result;
}
export interface OwnedIdentity {
  uid: string;
  task_id: string;
  step_id: string;
  connection_key: string;
}
export function ownedEvent(data: string, identity: OwnedIdentity) {
  const events = component(data).getAllSubcomponents("vevent");
  if (events.length !== 1)
    throw new Error(
      "Собственное событие изменено извне: несколько компонентов",
    );
  const c = events[0];
  if (
    c.getFirstPropertyValue("uid") !== identity.uid ||
    c.getFirstPropertyValue("x-lifepilot-task-id") !== identity.task_id ||
    c.getFirstPropertyValue("x-lifepilot-step-id") !== identity.step_id ||
    c.getFirstPropertyValue("x-lifepilot-owner") !== identity.connection_key ||
    c.hasProperty("rrule") ||
    c.hasProperty("recurrence-id")
  )
    throw new Error(
      "Идентификаторы события изменены. Изменение календаря остановлено.",
    );
  const event = new ICAL.Event(c);
  return {
    start: new Date(
      instant(
        event.startDate,
        "UTC",
        c.getFirstProperty("dtstart")?.getParameter("tzid") as
          string | undefined,
      ),
    ).toISOString(),
    end: new Date(
      instant(
        event.endDate,
        "UTC",
        (c.getFirstProperty("dtend")?.getParameter("tzid") ||
          c.getFirstProperty("dtstart")?.getParameter("tzid")) as
          string | undefined,
      ),
    ).toISOString(),
  };
}
export function makeEvent(
  input: OwnedIdentity & {
    title: string;
    instruction: string;
    start: string;
    end: string;
  },
) {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.updatePropertyWithValue("version", "2.0");
  calendar.updatePropertyWithValue("prodid", "-//LifePilot//Local Agent//RU");
  const c = new ICAL.Component("vevent");
  const event = new ICAL.Event(c);
  event.uid = input.uid;
  event.summary = `LifePilot · ${input.title}`;
  event.description = `${input.instruction}\nЗадача: ${input.task_id}\nШаг: ${input.step_id}`;
  event.startDate = ICAL.Time.fromJSDate(new Date(input.start), true);
  event.endDate = ICAL.Time.fromJSDate(new Date(input.end), true);
  c.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  c.updatePropertyWithValue("x-lifepilot-task-id", input.task_id);
  c.updatePropertyWithValue("x-lifepilot-step-id", input.step_id);
  c.updatePropertyWithValue("x-lifepilot-owner", input.connection_key);
  calendar.addSubcomponent(c);
  return calendar.toString();
}
