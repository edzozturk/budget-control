import { useState, type FormEvent } from 'react';
import { Money } from '../components/Money';
import { Button, Card, cx, Empty, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Account, type AccountType } from '../lib/api';
import { useData } from '../lib/data';
import { useT } from '../lib/i18n';
import { decimalsOf, toInput, toMinor } from '../lib/money';

const TYPES: AccountType[] = ['bank', 'cash', 'credit_card', 'overdraft', 'savings', 'other'];

export function Accounts() {
  const { t } = useT();
  const { accounts } = useData();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.accounts')} action={<Button onClick={() => setEditing('new')}>+ {t('account.add')}</Button>} />
      <Card>
        {accounts.length === 0 ? (
          <Empty>{t('dashboard.noAccounts')}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.map((a) => (
              <li key={a.id}>
                <button onClick={() => setEditing(a)} className={cx('flex w-full items-center justify-between gap-3 py-3 text-left', a.archived && 'opacity-50')}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {t(`accountType.${a.type}`)} · {a.currency}
                      {a.last4 ? ` · •••• ${a.last4}` : ''}
                      {a.archived ? ` · ${t('common.archived')}` : ''}
                    </span>
                  </span>
                  <Money amount={a.balance} currency={a.currency} className="font-semibold" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <AccountForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountForm({ initial, onClose }: { initial?: Account; onClose: () => void }) {
  const { t, locale } = useT();
  const { currencies, settings, reload } = useData();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AccountType>(initial?.type ?? 'bank');
  const [currency, setCurrency] = useState(initial?.currency ?? settings.baseCurrency);
  const dec = decimalsOf(currencies, currency);
  const [opening, setOpening] = useState(initial ? toInput(initial.openingBalance, dec, locale) : '');
  const [limit, setLimit] = useState(initial?.creditLimit != null ? toInput(initial.creditLimit, dec, locale) : '');
  const [rate, setRate] = useState(initial?.interestRate != null ? String(initial.interestRate).replace('.', locale === 'tr' ? ',' : '.') : '');
  const [statementDay, setStatementDay] = useState(initial?.statementDay?.toString() ?? '');
  const [dueDay, setDueDay] = useState(initial?.dueDay?.toString() ?? '');
  const [last4, setLast4] = useState(initial?.last4 ?? '');
  const [error, setError] = useState('');
  const isCard = type === 'credit_card';
  const hasLimit = isCard || type === 'overdraft';

  async function save(e: FormEvent, patch: Partial<Account> = {}) {
    e.preventDefault();
    const openingBalance = opening.trim() ? toMinor(opening, dec) : 0;
    if (openingBalance === null) return setError(t('tx.invalidAmount'));
    const creditLimit = hasLimit && limit.trim() ? toMinor(limit, dec) : null;
    if (hasLimit && limit.trim() && creditLimit === null) return setError(t('tx.invalidAmount'));
    const interestRate = hasLimit && rate.trim() ? Number(rate.replace(',', '.')) : null;
    if (interestRate !== null && !(interestRate >= 0 && interestRate <= 100)) return setError(t('tx.invalidAmount'));
    const day = (v: string) => (isCard && v ? Number(v) : null);
    const body = {
      name,
      type,
      currency,
      openingBalance,
      creditLimit,
      interestRate,
      statementDay: day(statementDay),
      dueDay: day(dueDay),
      last4: isCard && last4 ? last4 : null,
      ...patch,
    };
    try {
      if (initial) await api.put(`/accounts/${initial.id}`, body);
      else await api.post('/accounts', body);
      await reload();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  async function remove() {
    if (!initial || !confirm(t('common.confirmDelete'))) return;
    try {
      await api.del(`/accounts/${initial.id}`);
      await reload();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'in_use' ? t('common.inUse') : t('common.error'));
    }
  }

  return (
    <Modal title={initial ? t('account.edit') : t('account.add')} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('account.type')}>
            <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`accountType.${ty}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.currency')}>
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('account.openingBalance')}>
          <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
        </Field>
        {hasLimit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('account.creditLimit')}>
              <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </Field>
            <Field label={t('account.interestRate')}>
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
        )}
        {isCard && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('account.statementDay')}>
                <Input type="number" min={1} max={31} value={statementDay} onChange={(e) => setStatementDay(e.target.value)} />
              </Field>
              <Field label={t('account.dueDay')}>
                <Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
              </Field>
            </div>
            <Field label={t('account.last4')} help={t('account.last4Help')}>
              <Input
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </Field>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          {initial && (
            <>
              <Button type="button" variant="danger" onClick={remove}>
                {t('common.delete')}
              </Button>
              <Button type="button" variant="secondary" onClick={(e) => save(e, { archived: !initial.archived })}>
                {initial.archived ? t('common.unarchive') : t('common.archive')}
              </Button>
            </>
          )}
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
