import { useState } from 'react';
import { Money } from '../components/Money';
import { PeriodPicker } from '../components/PeriodPicker';
import { TransactionForm } from '../components/TransactionForm';
import { TransactionRow } from '../components/TransactionRow';
import { Button, Card, Dot, Empty, PageHeader } from '../components/ui';
import { query, type Summary, type Transaction } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';
import { currentPeriod, shiftPeriod } from '../lib/period';

export function Dashboard({ navigate }: { navigate: (page: string) => void }) {
  const { t } = useT();
  const { settings, accounts, categories } = useData();
  const [period, setPeriod] = useState(() => currentPeriod(settings.monthStartDay));
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const summary = useResource<Summary>(`/summary${query({ from: period.from, to: period.to })}`);
  const recent = useResource<{ items: Transaction[] }>(`/transactions${query({ from: period.from, to: period.to, limit: 8 })}`);

  const refresh = () => {
    summary.refresh();
    recent.refresh();
  };

  const totals = summary.data?.totals ?? {};
  const currenciesShown = Object.keys(totals).length ? Object.keys(totals) : [settings.baseCurrency];
  const expenses = (summary.data?.byCategory ?? []).filter((c) => c.kind === 'expense');
  const activeAccounts = accounts.filter((a) => !a.archived);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.dashboard')} action={<PeriodPicker period={period} onChange={(d) => setPeriod(shiftPeriod(period, d, settings.monthStartDay))} />} />

      {currenciesShown.map((cur) => {
        const s = totals[cur] ?? { income: 0, expense: 0, net: 0 };
        return (
          <div key={cur} className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
            {(
              [
                ['dashboard.income', s.income, 'text-emerald-700 dark:text-emerald-400'],
                ['dashboard.expense', s.expense, 'text-red-600 dark:text-red-400'],
                ['dashboard.net', s.net, ''],
              ] as const
            ).map(([label, value, color]) => (
              <Card key={label} className={`!p-3 sm:!p-4 ${label === 'dashboard.net' ? 'col-span-2 sm:col-span-1' : ''}`}>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(label)}</p>
                <Money amount={value} currency={cur} className={`mt-1 block truncate text-base font-semibold sm:text-xl ${color}`} />
              </Card>
            ))}
          </div>
        );
      })}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('dashboard.accounts')} action={<Button variant="ghost" onClick={() => navigate('accounts')}>›</Button>}>
          {activeAccounts.length === 0 ? (
            <div className="space-y-3 py-2 text-center">
              <Empty>{t('dashboard.noAccounts')}</Empty>
              <Button onClick={() => navigate('accounts')}>{t('account.add')}</Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {activeAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {a.name} <span className="text-xs text-slate-500">· {t(`accountType.${a.type}`)}</span>
                  </span>
                  <Money amount={a.balance} currency={a.currency} className="font-semibold" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('dashboard.topExpenses')}>
          {expenses.length === 0 ? (
            <Empty>{t('common.empty')}</Empty>
          ) : (
            <ul className="space-y-3">
              {expenses.slice(0, 6).map((row) => {
                const cat = categories.find((c) => c.id === row.categoryId);
                const max = expenses.filter((e) => e.currency === row.currency)[0]?.total || 1;
                return (
                  <li key={`${row.categoryId}-${row.currency}`} className="text-sm">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Dot color={cat?.color ?? '#94a3b8'} />
                        {cat?.name ?? t('dashboard.uncategorized')}
                      </span>
                      <Money amount={row.total} currency={row.currency} />
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-1.5 rounded-full" style={{ width: `${(row.total / max) * 100}%`, background: cat?.color ?? '#94a3b8' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('dashboard.recent')} action={<Button onClick={() => setEditing('new')}>+ {t('tx.add')}</Button>}>
        {recent.data?.items.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {recent.data.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onClick={() => setEditing(tx)} />
            ))}
          </ul>
        ) : (
          <Empty>{t('common.empty')}</Empty>
        )}
      </Card>

      {editing && (
        <TransactionForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
