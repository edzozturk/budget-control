import { useState, type FormEvent } from 'react';
import { Money, useMoney } from '../components/Money';
import { Button, Card, cx, Empty, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Loan } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';
import { decimalsOf, formatDate, toInput, toMinor } from '../lib/money';
import { today } from '../lib/period';

// Sums per currency, for totals across loans in different currencies.
function byCurrency(loans: Loan[], pick: (l: Loan) => number) {
  const totals = new Map<string, number>();
  for (const l of loans) totals.set(l.currency, (totals.get(l.currency) ?? 0) + pick(l));
  return [...totals];
}

export function Loans() {
  const { t } = useT();
  const loans = useResource<Loan[]>('/loans');
  const [editing, setEditing] = useState<Loan | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = loans.data ?? [];
  const active = list.filter((l) => !l.finished);
  const done = list.filter((l) => l.finished);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.loans')} action={<Button onClick={() => setEditing('new')}>+ {t('loan.add')}</Button>} />

      {active.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <Card className="!p-3 sm:!p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('loan.monthlyTotal')}</p>
            {byCurrency(active, (l) => l.nextInstallment?.amount ?? 0).map(([cur, v]) => (
              <Money key={cur} amount={v} currency={cur} className="mt-1 block truncate text-base font-semibold sm:text-xl" />
            ))}
          </Card>
          <Card className="!p-3 sm:!p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('common.remaining')}</p>
            {byCurrency(active, (l) => l.remainingTotal).map(([cur, v]) => (
              <Money key={cur} amount={v} currency={cur} className="mt-1 block truncate text-base font-semibold text-red-600 dark:text-red-400 sm:text-xl" />
            ))}
          </Card>
        </div>
      )}

      <Card title={t('loan.active')}>
        {loans.data && active.length === 0 ? <Empty>{t('loan.none')}</Empty> : <LoanList loans={active} onOpen={setOpenId} />}
      </Card>
      {done.length > 0 && (
        <Card title={t('loan.done')}>
          <LoanList loans={done} onOpen={setOpenId} />
        </Card>
      )}

      {editing && (
        <LoanForm
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loans.refresh();
          }}
        />
      )}
      {openId && (
        <LoanDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={loans.refresh}
          onEdit={(loan) => {
            setOpenId(null);
            setEditing(loan);
          }}
        />
      )}
    </div>
  );
}

function LoanList({ loans, onOpen }: { loans: Loan[]; onOpen: (id: string) => void }) {
  const { t, locale } = useT();
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {loans.map((l) => (
        <li key={l.id}>
          <button onClick={() => onOpen(l.id)} className="w-full py-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {[l.lender, t('loan.progress', { paid: l.paidCount, count: l.installmentCount })].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {l.nextInstallment ? (
                  <>
                    <Money amount={l.nextInstallment.amount} currency={l.currency} className="block font-semibold" />
                    <span className={cx('block text-xs', l.overdueCount ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>
                      {l.overdueCount ? `${t('common.overdue')} · ` : ''}
                      {formatDate(l.nextInstallment.dueDate, locale)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-emerald-700 dark:text-emerald-400">✓ {t('loan.finished')}</span>
                )}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-1.5 rounded-full bg-teal-600" style={{ width: `${(l.paidCount / l.installmentCount) * 100}%` }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LoanDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (loan: Loan) => void }) {
  const { t, locale } = useT();
  const { accounts, currencies, reload } = useData();
  const format = useMoney();
  const loan = useResource<Loan>(`/loans/${id}`);
  const l = loan.data;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const [showPaid, setShowPaid] = useState(false);

  if (!l) return null;
  // Long-running loans have many paid installments; only the last few are shown unless asked.
  const hiddenPaid = showPaid ? 0 : Math.max(0, l.paidCount - 2);
  const visible = (l.installments ?? []).filter((i) => !i.paidDate || i.number > hiddenPaid);
  const payable = accounts.filter((a) => a.currency === l.currency && (!a.archived || a.id === l.accountId));
  const payFrom = accountId ?? l.accountId ?? payable[0]?.id ?? '';
  const dec = decimalsOf(currencies, l.currency);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      loan.refresh();
      onChanged();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  const pay = (n: number) => run(() => api.post(`/loans/${id}/installments/${n}/pay`, { accountId: payFrom || undefined, date }));
  const unpay = (n: number) => run(() => api.post(`/loans/${id}/installments/${n}/unpay`));
  const editAmount = (n: number, current: number) => {
    const value = window.prompt(t('loan.editAmount'), toInput(current, dec, locale));
    if (value == null) return;
    const amount = toMinor(value, dec);
    if (!amount || amount <= 0) return setError(t('tx.invalidAmount'));
    run(() => api.put(`/loans/${id}/installments/${n}`, { amount }));
  };
  async function remove() {
    if (!confirm(t('common.confirmDelete'))) return;
    await run(() => api.del(`/loans/${id}`));
    onClose();
  }

  const stats: [string, number][] = [
    [t('loan.principal'), l.principal],
    [t('loan.totalRepayment'), l.totalRepayment],
    [t('loan.interestCost'), l.totalRepayment - l.principal],
    [t('common.paid'), l.paidTotal],
    [t('common.remaining'), l.remainingTotal],
  ];

  return (
    <Modal title={l.name} onClose={onClose}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="font-semibold tabular-nums">{format(value, l.currency)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('loan.ends')}</dt>
            <dd className="font-semibold">{formatDate(l.lastDueDate, locale)}</dd>
          </div>
        </dl>

        {!l.finished && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <Field label={t('loan.account')}>
              <Select value={payFrom} onChange={(e) => setAccountId(e.target.value)}>
                {payable.length === 0 && <option value="">{t('common.none')}</option>}
                {payable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('loan.payDate')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        )}
        <ErrorText>{error}</ErrorText>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('loan.schedule')}</h3>
            {l.paidCount > 2 && (
              <button className="text-xs text-teal-700 dark:text-teal-300" onClick={() => setShowPaid(!showPaid)}>
                {showPaid ? t('loan.hidePaid') : t('loan.showPaid', { n: hiddenPaid })}
              </button>
            )}
          </div>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {visible.map((i) => {
              const overdue = !i.paidDate && i.dueDate < today();
              return (
                <li key={i.id} className={cx('flex items-center gap-2 py-2', i.paidDate && 'text-slate-400 dark:text-slate-500')}>
                  <span className="w-12 shrink-0 tabular-nums">
                    {i.number}/{l.installmentCount}
                  </span>
                  <span className={cx('flex-1', overdue && 'font-medium text-red-600 dark:text-red-400')}>
                    {formatDate(i.dueDate, locale)}
                    {i.paidDate && i.paidDate !== i.dueDate ? <span className="block text-xs">✓ {formatDate(i.paidDate, locale)}</span> : null}
                  </span>
                  {i.paidDate ? (
                    <span className="tabular-nums">{format(i.amount, l.currency)}</span>
                  ) : (
                    <button className="tabular-nums underline decoration-dotted underline-offset-4" title={t('loan.editAmount')} onClick={() => editAmount(i.number, i.amount)}>
                      {format(i.amount, l.currency)}
                    </button>
                  )}
                  {i.paidDate ? (
                    <Button variant="ghost" className="!min-h-8 w-20 !px-2 text-xs" onClick={() => unpay(i.number)} title={t('common.undo')}>
                      ✓ {t('common.undo')}
                    </Button>
                  ) : (
                    <Button variant="secondary" className="!min-h-8 w-20 !px-2 text-xs" onClick={() => pay(i.number)}>
                      {t('common.pay')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex gap-2">
          <Button variant="danger" onClick={remove}>
            {t('common.delete')}
          </Button>
          <Button variant="secondary" className="ml-auto" onClick={() => onEdit(l)}>
            {t('common.edit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LoanForm({ initial, onClose, onSaved }: { initial?: Loan; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useT();
  const { accounts, categories, currencies, members, settings } = useData();
  const [name, setName] = useState(initial?.name ?? '');
  const [lender, setLender] = useState(initial?.lender ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? settings.baseCurrency);
  const dec = decimalsOf(currencies, currency);
  const [principal, setPrincipal] = useState(initial ? toInput(initial.principal, dec, locale) : '');
  const [installment, setInstallment] = useState(initial ? toInput(initial.installmentAmount, dec, locale) : '');
  const [count, setCount] = useState(initial?.installmentCount.toString() ?? '12');
  const [firstDueDate, setFirstDueDate] = useState(initial?.firstDueDate ?? today());
  const [paidInstallments, setPaidInstallments] = useState('0');
  const payable = accounts.filter((a) => a.currency === currency && !a.archived);
  const [accountId, setAccountId] = useState(initial ? (initial.accountId ?? '') : (payable[0]?.id ?? ''));
  const expenseCategories = categories.filter((c) => c.kind === 'expense' && (!c.archived || c.id === initial?.categoryId));
  const loanCategory = expenseCategories.find((c) => /kredi|loan/i.test(c.name));
  const [categoryId, setCategoryId] = useState(initial ? (initial.categoryId ?? '') : (loanCategory?.id ?? ''));
  const [memberId, setMemberId] = useState(initial?.memberId ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const refs = { name, lender, note, accountId: accountId || null, categoryId: categoryId || null, memberId: memberId || null };
    try {
      if (initial) {
        await api.put(`/loans/${initial.id}`, refs);
      } else {
        const p = toMinor(principal, dec);
        const i = toMinor(installment, dec);
        if (!p || p <= 0 || !i || i <= 0) return setError(t('tx.invalidAmount'));
        await api.post('/loans', {
          ...refs,
          currency,
          principal: p,
          installmentAmount: i,
          installmentCount: Number(count),
          firstDueDate,
          paidInstallments: Number(paidInstallments) || 0,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  return (
    <Modal title={initial ? t('loan.edit') : t('loan.add')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={100} />
          </Field>
          <Field label={t('loan.lender')}>
            <Input value={lender} onChange={(e) => setLender(e.target.value)} maxLength={100} />
          </Field>
        </div>
        {!initial && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('loan.principal')}>
                <Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} required />
              </Field>
              <Field label={t('common.currency')}>
                <Select
                  value={currency}
                  onChange={(e) => {
                    setCurrency(e.target.value);
                    setAccountId(accounts.find((a) => a.currency === e.target.value && !a.archived)?.id ?? '');
                  }}
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('loan.installmentAmount')}>
                <Input inputMode="decimal" value={installment} onChange={(e) => setInstallment(e.target.value)} required />
              </Field>
              <Field label={t('loan.installmentCount')}>
                <Input type="number" min={1} max={600} value={count} onChange={(e) => setCount(e.target.value)} required />
              </Field>
              <Field label={t('loan.firstDueDate')}>
                <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} required />
              </Field>
              <Field label={t('loan.paidInstallments')}>
                <Input type="number" min={0} max={Number(count) || 0} value={paidInstallments} onChange={(e) => setPaidInstallments(e.target.value)} />
              </Field>
            </div>
            <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">{t('loan.paidInstallmentsHelp')}</p>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('loan.account')}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {payable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('loan.category')}>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {members.length > 0 && (
          <Field label={t('common.member')}>
            <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {members
                .filter((m) => !m.archived || m.id === initial?.memberId)
                .map((m) => (
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
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
