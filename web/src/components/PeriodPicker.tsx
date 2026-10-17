import { monthLabel, useT } from '../lib/i18n';
import type { Period } from '../lib/period';

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (delta: number) => void }) {
  const { locale } = useT();
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onChange(-1)} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="‹">
        ‹
      </button>
      <span className="min-w-32 text-center text-sm font-medium capitalize">{monthLabel(period.year, period.month, locale)}</span>
      <button onClick={() => onChange(1)} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="›">
        ›
      </button>
    </div>
  );
}
