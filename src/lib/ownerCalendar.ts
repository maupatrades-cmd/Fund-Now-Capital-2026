export const OWNER_TIME_ZONE = "Africa/Johannesburg";

export const CALENDAR_CATEGORIES = [
  "urgent",
  "submission",
  "submission_update",
  "consultation",
  "presentation",
  "call",
  "paperwork_review",
] as const;

export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];
export type CalendarVisibility = "private" | "busy" | "public";
export type BookingStatus = "requested" | "confirmed" | "declined" | "cancelled" | "completed";

export const CATEGORY_LABELS: Record<CalendarCategory, string> = {
  urgent: "Urgent",
  submission: "Submission",
  submission_update: "Submission update",
  consultation: "Consultation",
  presentation: "Presentation",
  call: "Call",
  paperwork_review: "Paperwork review",
};

// Diary event types (owner, 18 Nov 2026): the booking types above plus four that are only for the Director's own
// diary. They are never offered as booking types. A Personal event is always private (the server forces it).
export const EVENT_CATEGORIES = [...CALENDAR_CATEGORIES, "meeting", "personal", "travel", "other"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  ...CATEGORY_LABELS,
  meeting: "Meeting",
  personal: "Personal",
  travel: "Travel",
  other: "Other",
};
// What someone filling in the Director's diary for her may use: every type except Personal.
export const DELEGATE_EVENT_CATEGORIES = EVENT_CATEGORIES.filter((c) => c !== "personal");

export function calendarDayKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: OWNER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDateFromKey(key: string) {
  // South Africa Standard Time is fixed at UTC+02:00 and does not observe DST.
  return new Date(`${key}T00:00:00+02:00`);
}

export function startOfCalendarDay(value: Date) {
  return calendarDateFromKey(calendarDayKey(value));
}

export function startOfCalendarWeek(value: Date) {
  const key = calendarDayKey(value);
  const calendarDate = new Date(`${key}T00:00:00Z`);
  const mondayOffset = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - mondayOffset);
  return calendarDateFromKey(calendarDate.toISOString().slice(0, 10));
}

export function addCalendarDays(value: Date, days: number) {
  const date = new Date(`${calendarDayKey(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarDateFromKey(date.toISOString().slice(0, 10));
}

export function calendarRange(anchor: Date, view: "day" | "week") {
  const start = view === "week" ? startOfCalendarWeek(anchor) : startOfCalendarDay(anchor);
  const end = addCalendarDays(start, view === "week" ? 7 : 1);
  return { start, end };
}

export function toLocalDateTimeInput(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isPresentationTimeAllowed(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: OWNER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeParts = (value: Date) => {
    const parts = formatter.formatToParts(value);
    return {
      hour: Number(parts.find((part) => part.type === "hour")?.value),
      minute: Number(parts.find((part) => part.type === "minute")?.value),
    };
  };
  const startTime = timeParts(start);
  const endTime = timeParts(end);
  return startTime.hour >= 14 && (endTime.hour < 20 || (endTime.hour === 20 && endTime.minute === 0));
}

export function formatCalendarTime(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: OWNER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatCalendarDay(value: Date | string, includeYear = false) {
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: OWNER_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(value));
}
