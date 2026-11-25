import { useMemo, useState } from 'react';
import { useMoney } from '../components/Money';
import { Button, Card, cx, Dot, Empty, PageHeader } from '../components/ui';
import { query, type BreakdownRow } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';

type By = 'costCenter' | 'member' | 'category';
type Kind = 'expense' | 'income';

interface Group {
  key: string;
  groupId: string | null;
  currency: string;
  months: number[];
  total: number;
  byCategory: Map<string | null, number>;
}

export function Reports() {
  const { t, locale } = useT();
  const { categories, members, costCenters } = useData();
  const format = useMoney();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [by, setBy] = useState<By>('costCenter');
  const [kind, setKind] = useState<Kind>('expense');
  const [selected, setSelected] = useState<string | null>(null);
  const report = useResource<{ rows: BreakdownRow[] }>(`/reports/breakdown${query({ by, from: `${year}-01-01`, to: `${year}-12-31` })}`);

  const named = by === 'costCenter' ? costCenters : by === 'member' ? members : categories;
  const nameOf = (id: string | null) => (id ? (named.find((n) => n.id === id)?.name ?? '?') : t('reports.unassigned'));
  const colorOf = (id: string | null) => (id ? (named.find((n) => n.id === id)?.color ?? '#94a3b8') : '#cbd5e1');
  const monthNames = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { month: 'short' }).format(new Date(2000, m, 1)),
  );

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of report.data?.rows ?? []) {
      if (r.kind !== kind) continue;
      const key = `${r.groupId ?? '-'}|${r.currency}`;
      const g = map.get(key) ?? { key, groupId: r.groupId, currency: r.currency, months: Array(12).fill(0), total: 0, byCategory: new Map() };
      g.months[Number(r.month.slice(5, 7)) - 1] += r.total;
      g.total += r.total;
      g.byCategory.set(r.categoryId, (g.byCategory.get(r.categoryId) ?? 0) + r.total);
      map.set(key, g);
    }
    // Named groups first (largest total first), the unassigned remainder last.
    return [...map.values()].sort((a, b) => Number(a.groupId === null) - Number(b.groupId === null) || b.total - a.total);
  }, [report.data, kind]);

  const detail = groups.find((g) => g.key === selected);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.reports')}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={() => setYear(year - 1)} aria-label="‹">
              ‹
            </Button>
            <span className="w-14 text-center font-medium tabular-nums">{year}</span>
            <Button variant="ghost" onClick={() => setYear(year + 1)} aria-label="›">
              ›
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Segmented
          value={by}
          options={(['costCenter', 'member', 'category'] as const).map((v) => [v, t(`reports.by.${v}`)])}
          onChange={(v) => {
            setBy(v);
            setSelected(null);
          }}
        />
        <Segmented value={kind} options={(['expense', 'income'] as const).map((v) => [v, t(`kind.${v}`)])} onChange={setKind} />
      </div>

      <Card>
        {report.data && groups.length === 0 ? (
          <Empty>{t('common.empty')}</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                  <th className="sticky left-0 bg-white py-2 pr-3 font-medium dark:bg-slate-900">{t(`reports.by.${by}`)}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t('common.total')}</th>
                  {monthNames.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr
                    key={g.key}
                    onClick={() => setSelected(g.key === selected ? null : g.key)}
                    className={cx(
                      'cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
                      g.key === selected && 'bg-teal-50 dark:bg-teal-900/30',
                    )}
                  >
                    <td className="sticky left-0 whitespace-nowrap bg-white py-2 pr-3 dark:bg-slate-900">
                      <span className="flex items-center gap-2">
                        <Dot color={colorOf(g.groupId)} />
                        {nameOf(g.groupId)}
                        <span className="text-xs text-slate-400">{g.currency}</span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{format(g.total, g.currency)}</td>
                    {g.months.map((v, i) => (
                      <td key={i} className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {v ? format(v, g.currency).replace(/[.,]\d{2}(?!\d)/, '') : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {groups.length > 0 && !detail && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('reports.pickRow')}</p>}
      </Card>

      {detail && by !== 'category' && (
        <Card title={`${nameOf(detail.groupId)} · ${year}`}>
          <ul className="space-y-3">
            {[...detail.byCategory]
              .sort((a, b) => b[1] - a[1])
              .map(([categoryId, total]) => {
                const cat = categories.find((c) => c.id === categoryId);
                return (
                  <li key={categoryId ?? '-'} className="text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Dot color={cat?.color ?? '#94a3b8'} />
                        {cat?.name ?? t('dashboard.uncategorized')}
                      </span>
                      <span className="tabular-nums">{format(total, detail.currency)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-1.5 rounded-full" style={{ width: `${(total / detail.total) * 100}%`, background: cat?.color ?? '#94a3b8' }} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Segmented<V extends string>({ value, options, onChange }: { value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cx('min-h-8 rounded-md px-3 text-sm font-medium', value === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
