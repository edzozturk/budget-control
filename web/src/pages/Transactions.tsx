import { useState } from 'react';
import { PeriodPicker } from '../components/PeriodPicker';
import { TransactionForm } from '../components/TransactionForm';
import { TransactionRow } from '../components/TransactionRow';
import { Button, Card, Empty, Input, PageHeader, Select } from '../components/ui';
import { query, type Transaction, type TransactionKind } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';
import { currentPeriod, shiftPeriod } from '../lib/period';

const PAGE = 50;

export function Transactions() {
  const { t } = useT();
  const { settings, accounts, categories } = useData();
  const [period, setPeriod] = useState(() => currentPeriod(settings.monthStartDay));
  const [kind, setKind] = useState<TransactionKind | ''>('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);

  const list = useResource<{ items: Transaction[]; total: number }>(
    `/transactions${query({ from: period.from, to: period.to, kind, accountId, categoryId, q: search, limit })}`,
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.transactions')} action={<Button onClick={() => setEditing('new')}>+ {t('common.add')}</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PeriodPicker period={period} onChange={(d) => setPeriod(shiftPeriod(period, d, settings.monthStartDay))} />
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-1 sm:justify-end">
            <Select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind | '')} className="sm:w-36">
              <option value="">{t('common.all')}</option>
              {(['expense', 'income', 'transfer'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="sm:w-44">
              <option value="">{t('nav.accounts')}: {t('common.all')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="sm:w-44">
              <option value="">{t('nav.categories')}: {t('common.all')}</option>
              {categories
                .filter((c) => !kind || c.kind === kind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
            <Input placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-44" />
          </div>
        </div>
        {list.data?.items.length ? (
          <>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} accountFilter={accountId || undefined} onClick={() => setEditing(tx)} />
              ))}
            </ul>
            {list.data.total > list.data.items.length && (
              <div className="mt-3 text-center">
                <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>
                  {list.data.items.length} / {list.data.total} ↓
                </Button>
              </div>
            )}
          </>
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
            list.refresh();
          }}
        />
      )}
    </div>
  );
}
