import { AppError } from "../errors";
import { limitedBody } from "../http";
import { DAVClient } from "tsdav";
import type { DAVCalendar, DAVCalendarObject } from "tsdav";
import { database } from "./database";
import { connectionKey, decryptPassword, encryptPassword } from "./credentials";
import { assertWorkerLease, Superseded } from "./state";
import type { PublicConnection } from "./types";

export class CalendarFailure extends AppError {
  constructor(message: string, temporary = false) {
    super("CALDAV_FAILURE", message, temporary ? 503 : 502, temporary);
  }
  get temporary() {
    return this.retryable;
  }
}
export function validateCalendarURL(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("INVALID_REQUEST", "Укажите корректный URL CalDAV", 400);
  }
  if (url.username || url.password || url.hash || url.search)
    throw new AppError(
      "INVALID_REQUEST",
      "Укажите URL CalDAV без пароля, параметров и фрагментов",
    );
  const test = process.env.LOCAL_CALDAV_HTTP_URL;
  const isLocalTest =
    test &&
    url.origin === new URL(test).origin &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalTest))
    throw new AppError(
      "INVALID_REQUEST",
      "CalDAV требует HTTPS. HTTP разрешён только для локального сервера из LOCAL_CALDAV_HTTP_URL.",
    );
  return url;
}
export function storedConnection() {
  const row = database()
    .prepare(
      "SELECT config,secret,revision FROM calendar_connection WHERE id=1",
    )
    .get() as { config: string; secret: string; revision: number } | undefined;
  if (!row) return null;
  const config = JSON.parse(row.config) as PublicConnection;
  return {
    config,
    revision: row.revision,
    key: connectionKey(config.url, config.username),
    password: () => decryptPassword(row.secret),
  };
}
export function publicConnection() {
  return storedConnection()?.config ?? null;
}
export function assertConnection(revision: number) {
  assertWorkerLease();
  const connection = storedConnection();
  if (!connection?.config.enabled || connection.revision !== revision)
    throw new Superseded("Подключение календаря изменено");
}
export function saveConnection(config: PublicConnection, password?: string) {
  const previous = database()
    .prepare("SELECT secret FROM calendar_connection WHERE id=1")
    .get() as { secret: string } | undefined;
  const secret =
    password !== undefined ? encryptPassword(password) : previous?.secret;
  if (!secret) throw new AppError("INVALID_REQUEST", "Нужен пароль приложения");
  database()
    .prepare(
      "INSERT INTO calendar_connection(id,config,secret,revision) VALUES(1,?,?,1) ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret,revision=calendar_connection.revision+1",
    )
    .run(JSON.stringify(config), secret);
}
export async function calendarSession(
  config: Pick<PublicConnection, "url" | "username">,
  password: string,
  revision?: number,
) {
  const server = validateCalendarURL(config.url);
  const guardedFetch: typeof fetch = async (input, init) => {
    if (revision !== undefined) assertConnection(revision);
    const target = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      server,
    );
    if (target.origin !== server.origin)
      throw new CalendarFailure(
        "CalDAV перенаправил запрос на другой сервер. Укажите прямой URL подключения.",
      );
    validateCalendarURL(target.href);
    try {
      const response = await fetch(target, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(20000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
      if (response.status >= 500 || response.status === 429)
        throw new CalendarFailure(
          "Календарь временно недоступен. Повторю запрос.",
          true,
        );
      if (response.status === 401 || response.status === 403)
        throw new CalendarFailure(
          "CalDAV отклонил доступ. Проверьте логин, пароль приложения и права календаря.",
        );
      if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024)
        throw new CalendarFailure(
          "Ответ календаря превышает 10 МБ. Сузьте список календарей.",
        );
      const bytes = response.body
        ? await limitedBody(
            response,
            10 * 1024 * 1024,
            new CalendarFailure(
              "Ответ календаря превышает 10 МБ. Сузьте список календарей.",
            ),
          )
        : null;
      if (revision !== undefined) assertConnection(revision);
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (error instanceof CalendarFailure || error instanceof Superseded)
        throw error;
      throw new CalendarFailure(
        "Не удалось связаться с CalDAV. Проверьте адрес и сеть.",
        true,
      );
    }
  };
  const client = new DAVClient({
    serverUrl: server.href,
    credentials: { username: config.username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
    fetch: guardedFetch,
  });
  await client.login();
  const calendars = (await client.fetchCalendars()).filter(
    (c) => !c.components || c.components.includes("VEVENT"),
  );
  for (const calendar of calendars) {
    calendar.url = new URL(calendar.url, server).href;
    if (new URL(calendar.url).origin !== server.origin)
      throw new CalendarFailure("Календарь находится на другом сервере");
  }
  const request = (url: string, init?: RequestInit) =>
    guardedFetch(url, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.username}:${password}`).toString("base64")}`,
        ...init?.headers,
      },
    });
  return { client, calendars, request };
}
export type CalendarSession = Awaited<ReturnType<typeof calendarSession>>;
export async function readObject(
  session: CalendarSession,
  url: string,
): Promise<DAVCalendarObject | null> {
  const response = await session.request(url);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new CalendarFailure(
      `Не удалось прочитать событие (HTTP ${response.status})`,
    );
  const data = new TextDecoder().decode(
    await limitedBody(
      response,
      2 * 1024 * 1024,
      new CalendarFailure("Событие слишком велико"),
    ),
  );
  return { url, data, etag: response.headers.get("etag") ?? undefined };
}
export function selectedCalendar(
  session: CalendarSession,
  url: string,
): DAVCalendar {
  const calendar = session.calendars.find((c) => c.url === url);
  if (!calendar)
    throw new CalendarFailure(
      "Выбранный календарь больше недоступен. Обновите подключение в настройках.",
    );
  return calendar;
}
