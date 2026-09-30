export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAY_MS = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Treat a YYYY-MM-DD string as a UTC calendar day, so day arithmetic never meets DST. */
function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD that names a real day (2026-02-30 is not). */
export function isRealDate(iso: string): boolean {
  return ISO_DATE.test(iso) && addDays(iso, 0) === iso;
}

export function isSunday(iso: string): boolean {
  return new Date(utc(iso)).getUTCDay() === 0;
}

export function shortDate(iso: string): string {
  const d = new Date(utc(iso));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });

/** The Europe/London calendar day an instant falls on, as YYYY-MM-DD. */
export function londonISO(d: Date): string {
  return LONDON_DAY.format(d);
}

export function nextSunday(now: Date): string {
  const today = londonISO(now);
  const dow = new Date(utc(today)).getUTCDay();
  return addDays(today, dow === 0 ? 0 : 7 - dow);
}
