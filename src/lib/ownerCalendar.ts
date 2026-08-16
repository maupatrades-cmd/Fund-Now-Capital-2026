export const OWNER_TIME_ZONE = "Africa/Johannesburg";

export const CALENDAR_CATEGORIES = [
  "urgent",
  "submission",
  "submission_update",
  "consultation",
] as const;

export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];
export type CalendarVisibility = "private" | "busy" | "public";
export type BookingStatus = "requested" | "confirmed" | "declined" | "cancelled" | "completed";

export const CATEGORY_LABELS: Record<CalendarCategory, string> = {
  urgent: "Urgent",
  submission: "Submission",
  submission_update: "Submission update",
  consultation: "Consultation",
};

export function startOfCalendarDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfCalendarWeek(value: Date) {
  const date = startOfCalendarDay(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

export function addCalendarDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
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

export function isConsultationTimeAllowed(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start.getHours() >= 14 && (end.getHours() < 20 || (end.getHours() === 20 && end.getMinutes() === 0));
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
