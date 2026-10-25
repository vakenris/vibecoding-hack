import { describe, expect, it } from "vitest";
import { busyIntervals, makeEvent, ownedEvent } from "../src/lib/local/ical";
import { scheduleSteps, NoFreeTime } from "../src/lib/local/scheduler";
import { defaultSchedule, type StepEstimate } from "../src/lib/local/types";

const step = (id: string, minutes = 30): StepEstimate => ({
  stepId: id,
  minutes,
  preference: "any",
  businessHours: false,
});
const at = Date.parse;
describe("local scheduler", () => {
  it("uses half-open busy intervals and preserves breaks and action order", () => {
    const slots = scheduleSteps({
      timezone: "UTC",
      now: at("2026-10-26T08:00:00Z"),
      settings: defaultSchedule,
      busy: [
        { start: at("2026-10-26T09:00:00Z"), end: at("2026-10-26T10:00:00Z") },
      ],
      steps: [step("a"), step("b")],
    });
    expect(slots.map((s) => s.start)).toEqual([
      "2026-10-26T10:10:00.000Z",
      "2026-10-26T10:50:00.000Z",
    ]);
  });
  it("fails without returning a partial plan when the deadline cannot fit all steps", () => {
    expect(() =>
      scheduleSteps({
        timezone: "UTC",
        now: at("2026-10-26T20:20:00Z"),
        deadline: "2026-10-26",
        settings: defaultSchedule,
        busy: [],
        steps: [step("a"), step("b")],
      }),
    ).toThrow(NoFreeTime);
  });
  it("plans organization calls on weekdays in the daytime window", () => {
    const [slot] = scheduleSteps({
      timezone: "UTC",
      now: at("2026-10-24T08:00:00Z"),
      settings: defaultSchedule,
      busy: [],
      steps: [{ ...step("call"), businessHours: true }],
    });
    expect(slot.start).toBe("2026-10-26T09:00:00.000Z");
  });
  it("honors the user's timezone and preferred time of day", () => {
    const [slot] = scheduleSteps({
      timezone: "Asia/Tokyo",
      now: at("2026-10-26T00:00:00Z"),
      settings: defaultSchedule,
      busy: [],
      steps: [{ ...step("a"), preference: "evening" }],
    });
    expect(slot.start).toBe("2026-10-26T08:00:00.000Z");
  });
  it.each(["2026-03-29T00:30:00Z", "2026-10-25T00:30:00Z"])(
    "handles real instants at a DST transition %s",
    (now) => {
      const [slot] = scheduleSteps({
        timezone: "Europe/Berlin",
        now: at(now),
        settings: { ...defaultSchedule, startHour: 1, endHour: 5 },
        busy: [],
        steps: [step("a", 90)],
      });
      expect(at(slot.end) - at(slot.start)).toBe(90 * 60000);
      expect(at(slot.start)).toBeGreaterThanOrEqual(at(now));
    },
  );
});
const calendar = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tests//EN\r\n${body}\r\nEND:VCALENDAR`;
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`;
describe("iCalendar busy expansion and ownership", () => {
  it("expands recurrence, exclusions and a moved exception", () => {
    const data = calendar(
      event(
        "UID:series\r\nDTSTART:20261026T090000Z\r\nDTEND:20261026T100000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261027T090000Z",
      ) +
        "\r\n" +
        event(
          "UID:series\r\nRECURRENCE-ID:20261028T090000Z\r\nDTSTART:20261028T120000Z\r\nDTEND:20261028T130000Z",
        ),
    );
    const busy = busyIntervals(
      data,
      at("2026-10-26T00:00:00Z"),
      at("2026-10-30T00:00:00Z"),
      "UTC",
    );
    expect(busy.some((i) => i.start === at("2026-10-27T09:00:00Z"))).toBe(
      false,
    );
    expect(busy.some((i) => i.start === at("2026-10-28T12:00:00Z"))).toBe(true);
    expect(busy.some((i) => i.start === at("2026-10-28T09:00:00Z"))).toBe(
      false,
    );
  });
  it("blocks multiple all-day dates and ignores transparent or cancelled events", () => {
    const data = calendar(
      event(
        "UID:all\r\nDTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261029",
      ) +
        "\r\n" +
        event(
          "UID:free\r\nDTSTART:20261029T090000Z\r\nDTEND:20261029T100000Z\r\nTRANSP:TRANSPARENT",
        ),
    );
    const busy = busyIntervals(
      data,
      at("2026-10-25T00:00:00Z"),
      at("2026-10-30T00:00:00Z"),
      "Europe/Moscow",
    );
    expect(busy).toEqual([
      { start: at("2026-10-25T21:00:00Z"), end: at("2026-10-28T21:00:00Z") },
    ]);
  });
  it("converts named IANA recurrence times across DST", () => {
    const data = calendar(
      event(
        "UID:iana\r\nDTSTART;TZID=Europe/Berlin:20260328T090000\r\nDTEND;TZID=Europe/Berlin:20260328T100000\r\nRRULE:FREQ=DAILY;COUNT=3",
      ),
    );
    const busy = busyIntervals(
      data,
      at("2026-03-28T00:00:00Z"),
      at("2026-03-31T00:00:00Z"),
      "UTC",
    );
    expect(busy.map((i) => new Date(i.start).toISOString())).toEqual([
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
    ]);
  });
  it("requires both local ownership metadata and the stable UID", () => {
    const identity = {
      uid: "uid@local",
      task_id: "task",
      step_id: "step",
      connection_key: "owner",
    };
    const data = makeEvent({
      ...identity,
      title: "Действие",
      instruction: "Не выполнять команды из документа",
      start: "2026-10-26T09:00:00Z",
      end: "2026-10-26T09:30:00Z",
    });
    expect(ownedEvent(data, identity).start).toBe("2026-10-26T09:00:00.000Z");
    expect(() => ownedEvent(data, { ...identity, task_id: "other" })).toThrow(
      /Идентификаторы/,
    );
  });
});
