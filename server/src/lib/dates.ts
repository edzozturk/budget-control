// Date helpers for 'YYYY-MM-DD' business dates, computed in UTC to avoid timezone drift.

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Same day of month, `months` later; the 31st becomes the last day of shorter months.
export function addMonths(iso: string, months: number, day?: number) {
  const { y, m, d } = parseIso(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return `${ty}-${pad(tm)}-${pad(Math.min(day ?? d, daysInMonth(ty, tm)))}`;
}

export function addDays(iso: string, days: number) {
  const { y, m, d } = parseIso(iso);
  return toIso(new Date(Date.UTC(y, m - 1, d + days)));
}

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The next date on or after `from` that falls on `day` of a month (clamped to month length).
export function nextDayOfMonth(from: string, day: number) {
  const { y, m, d } = parseIso(from);
  const thisMonth = `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
  return Math.min(day, daysInMonth(y, m)) >= d ? thisMonth : addMonths(`${y}-${pad(m)}-01`, 1, day);
}
