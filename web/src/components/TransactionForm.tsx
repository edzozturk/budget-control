import { useState, type FormEvent } from 'react';
import { api, ApiError, type Transaction, type TransactionKind } from '../lib/api';
import { useData } from '../lib/data';
import { useT } from '../lib/i18n';
import { decimalsOf, toInput, toMinor } from '../lib/money';
import { today } from '../lib/period';
import { Button, cx, ErrorText, Field, Input, Modal, Select } from './ui';

export function TransactionForm({ initial, onClose, onSaved }: { initial?: Transaction; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useT();
  const { accounts, categories, currencies, members, settings, reload } = useData();
  // Accounts in the base currency come first, so the default account is the everyday one.
  const active = accounts
    .filter((a) => !a.archived || a.id === initial?.accountId || a.id === initial?.toAccountId)
    .sort((a, b) => Number(b.currency === settings.baseCurrency) - Number(a.currency === settings.baseCurrency));

  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? 'expense');
  const [date, setDate] = useState(initial?.date ?? today());
  const [accountId, setAccountId] = useState(initial?.accountId ?? active[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? active.find((a) => a.id !== accountId)?.id ?? '');
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const dec = decimalsOf(currencies, account?.currency ?? 'TRY');
  const toDec = decimalsOf(currencies, toAccount?.currency ?? 'TRY');
  const [amount, setAmount] = useState(initial ? toInput(initial.amount, dec, locale) : '');
  const [toAmount, setToAmount] = useState(initial?.toAmount != null ? toInput(initial.toAmount, toDec, locale) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [memberId, setMemberId] = useState(initial?.memberId ?? '');
  const memberOptions = members.filter((m) => !m.archived || m.id === initial?.memberId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const crossCurrency = kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency;
  const kindCategories = categories.filter((c) => c.kind === kind && (!c.archived || c.id === initial?.categoryId));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const minor = toMinor(amount, dec);
    if (!minor || minor <= 0) return setError(t('tx.invalidAmount'));
    const toMinorAmount = crossCurrency ? toMinor(toAmount, toDec) : null;
    if (crossCurrency && (!toMinorAmount || toMinorAmount <= 0)) return setError(t('tx.invalidAmount'));

    const body = {
      kind,
      date,
      accountId,
      amount: minor,
      note,
      memberId: memberId || null,
      categoryId: kind === 'transfer' ? null : categoryId || null,
      toAccountId: kind === 'transfer' ? toAccountId : null,
      toAmount: kind === 'transfer' ? (crossCurrency ? toMinorAmount : minor) : null,
    };
    setBusy(true);
    try {
      if (initial) await api.put(`/transactions/${initial.id}`, body);
      else await api.post('/transactions', body);
      await reload();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !confirm(t('common.confirmDelete'))) return;
    await api.del(`/transactions/${initial.id}`);
    await reload();
    onSaved();
  }

  if (active.length === 0) {
    return (
      <Modal title={t('tx.add')} onClose={onClose}>
        <p className="text-sm">{t('tx.needAccount')}</p>
      </Modal>
    );
  }

  return (
    <Modal title={initial ? t('tx.edit') : t('tx.add')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['expense', 'income', 'transfer'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setCategoryId('');
              }}
              className={cx(
                'min-h-9 rounded-md text-sm font-medium',
                kind === k ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('tx.amount')}${account ? ` (${account.currency})` : ''}`}>
            <Input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required />
          </Field>
          <Field label={t('tx.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label={kind === 'transfer' ? t('tx.fromAccount') : t('tx.account')}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'transfer' ? (
          <>
            <Field label={t('tx.toAccount')}>
              <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {active
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
              </Select>
            </Field>
            {crossCurrency && (
              <Field label={`${t('tx.toAmount')} (${toAccount!.currency})`}>
                <Input inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} required />
              </Field>
            )}
          </>
        ) : (
          <Field label={t('tx.category')}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {memberOptions.length > 0 && (
          <Field label={t('common.member')}>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {memberOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('tx.note')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          {initial && (
            <Button type="button" variant="danger" onClick={remove}>
              {t('common.delete')}
            </Button>
          )}
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
