// A budget period runs from monthStartDay of one month to the day before it in the next.
// With monthStartDay = 15, "October 2026" is 2026-10-15 .. 2026-11-14.

export interface Period {
  year: number;
  month: number; // 1-12, the month the period starts in
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function today() {
  return iso(new Date());
}

export function periodOf(year: number, month: number, startDay: number): Period {
  const from = new Date(year, month - 1, startDay);
  const to = new Date(year, month, startDay - 1);
  return { year, month, from: iso(from), to: iso(to) };
}

export function currentPeriod(startDay: number, now = new Date()): Period {
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  if (now.getDate() < startDay) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return periodOf(year, month, startDay);
}

export function shiftPeriod(p: Period, delta: number, startDay: number): Period {
  const d = new Date(p.year, p.month - 1 + delta, 1);
  return periodOf(d.getFullYear(), d.getMonth() + 1, startDay);
}
