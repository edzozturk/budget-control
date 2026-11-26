import { useEffect, useState, type FormEvent } from 'react';
import { Money, useMoney } from '../components/Money';
import { Button, Card, cx, Empty, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Account, type CardStatement, type StatementStatus } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';
import { decimalsOf, formatDate, toInput, toMinor } from '../lib/money';
import { today } from '../lib/period';

const STATUS_STYLE: Record<StatementStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  minimum_paid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  open: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function StatusBadge({ status }: { status: StatementStatus }) {
  const { t } = useT();
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>{t(`card.status.${status}`)}</span>;
}

export function Cards() {
  const { t } = useT();
  const { accounts } = useData();
  const statements = useResource<CardStatement[]>('/card-statements');
  const [editing, setEditing] = useState<{ card: Account; statement?: CardStatement } | null>(null);
  const [paying, setPaying] = useState<CardStatement | null>(null);
  const cards = accounts.filter((a) => a.type === 'credit_card' && !a.archived);
  const overdrafts = accounts.filter((a) => a.type === 'overdraft' && !a.archived);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.cards')} />
      {cards.length === 0 && (
        <Card>
          <Empty>{t('card.none')}</Empty>
        </Card>
      )}
      {cards.map((card) => (
        <CardPanel
          key={card.id}
          card={card}
          statements={(statements.data ?? []).filter((s) => s.accountId === card.id)}
          onAdd={() => setEditing({ card })}
          onEdit={(statement) => setEditing({ card, statement })}
          onPay={setPaying}
        />
      ))}

      {overdrafts.length > 0 && (
        <Card title={t('card.overdrafts')}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {overdrafts.map((a) => (
              <li key={a.id} className="py-3">
                <LimitBar account={a} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <StatementForm
          card={editing.card}
          initial={editing.statement}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            statements.refresh();
          }}
        />
      )}
      {paying && (
        <PayStatement
          statement={paying}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            statements.refresh();
          }}
        />
      )}
    </div>
  );
}

// Used amount against the limit. A negative balance is debt on a card or overdraft.
function LimitBar({ account }: { account: Account }) {
  const { t } = useT();
  const format = useMoney();
  const debt = Math.max(0, -account.balance);
  const limit = account.creditLimit ?? 0;
  const pct = limit ? Math.min(100, (debt / limit) * 100) : 0;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {account.name}
            {account.last4 && <span className="ml-1 text-sm font-normal text-slate-500">•••• {account.last4}</span>}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {[
              account.interestRate != null ? `%${account.interestRate}` : null,
              account.statementDay ? `${t('account.statementDay')}: ${account.statementDay}` : null,
              account.dueDay ? `${t('account.dueDay')}: ${account.dueDay}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xs text-slate-500 dark:text-slate-400">{t('account.debt')}</span>
          <Money amount={debt} currency={account.currency} className="font-semibold text-red-600 dark:text-red-400" />
        </span>
      </div>
      {limit > 0 && (
        <>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={cx('h-1.5 rounded-full', pct > 90 ? 'bg-red-600' : pct > 70 ? 'bg-amber-500' : 'bg-teal-600')} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {t('account.available')}: {format(limit - debt, account.currency)}
            </span>
            <span>
              {t('account.creditLimit')}: {format(limit, account.currency)}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function CardPanel({
  card,
  statements,
  onAdd,
  onEdit,
  onPay,
}: {
  card: Account;
  statements: CardStatement[];
  onAdd: () => void;
  onEdit: (s: CardStatement) => void;
  onPay: (s: CardStatement) => void;
}) {
  const { t, locale } = useT();
  const format = useMoney();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? statements : statements.slice(0, 4);

  return (
    <Card>
      <LimitBar account={card} />
      <div className="mt-4 mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('card.statements')}</h3>
        <Button variant="secondary" className="!min-h-8 text-xs" onClick={onAdd}>
          + {t('card.addStatement')}
        </Button>
      </div>
      {statements.length === 0 ? (
        <p className="py-2 text-sm text-slate-500 dark:text-slate-400">{t('card.noStatements')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <button className="min-w-0 flex-1 text-left" onClick={() => onEdit(s)}>
                <span className="block">
                  {t('card.dueDate')}: <span className="font-medium">{formatDate(s.dueDate, locale)}</span>
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {format(s.amount, card.currency)}
                  {s.minimumPayment ? ` · ${t('card.minimum')} ${format(s.minimumPayment, card.currency)}` : ''}
                  {s.paidAmount ? ` · ${t('card.paidAmount')} ${format(s.paidAmount, card.currency)}` : ''}
                </span>
              </button>
              <StatusBadge status={s.status} />
              {s.remaining > 0 && (
                <Button className="!min-h-8 !px-3 text-xs" onClick={() => onPay(s)}>
                  {t('common.pay')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {statements.length > 4 && (
        <button className="mt-1 text-xs text-teal-700 dark:text-teal-300" onClick={() => setShowAll(!showAll)}>
          {showAll ? '−' : `+${statements.length - 4}`}
        </button>
      )}
    </Card>
  );
}

function StatementForm({ card, initial, onClose, onSaved }: { card: Account; initial?: CardStatement; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useT();
  const { currencies } = useData();
  const dec = decimalsOf(currencies, card.currency);
  const money = (v?: number) => (v ? toInput(v, dec, locale) : '');
  const [statementDate, setStatementDate] = useState(initial?.statementDate ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [amount, setAmount] = useState(money(initial?.amount));
  const [minimum, setMinimum] = useState(money(initial?.minimumPayment));
  const [interest, setInterest] = useState(money(initial?.interest));
  const [paid, setPaid] = useState(money(initial?.paidAmount));
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');

  // New statements start from the card's cut-off and due days.
  useEffect(() => {
    if (initial) return;
    api.get<{ statementDate: string; dueDate: string }>(`/cards/${card.id}/next-statement`).then((d) => {
      setStatementDate((v) => v || d.statementDate);
      setDueDate((v) => v || d.dueDate);
    });
  }, [card.id, initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const parse = (v: string) => (v.trim() ? toMinor(v, dec) : 0);
    const values = { amount: parse(amount), minimumPayment: parse(minimum), interest: parse(interest), paidAmount: parse(paid) };
    if (Object.values(values).some((v) => v === null || v < 0)) return setError(t('tx.invalidAmount'));
    const body = { statementDate, dueDate, note, ...values };
    try {
      if (initial) await api.put(`/card-statements/${initial.id}`, body);
      else await api.post('/card-statements', { accountId: card.id, ...body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  async function remove() {
    if (!initial || !confirm(t('common.confirmDelete'))) return;
    await api.del(`/card-statements/${initial.id}`);
    onSaved();
  }

  return (
    <Modal title={`${initial ? t('card.editStatement') : t('card.addStatement')} · ${card.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('card.statementDate')}>
            <Input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} required />
          </Field>
          <Field label={t('card.dueDate')}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </Field>
          <Field label={`${t('card.amount')} (${card.currency})`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus required />
          </Field>
          <Field label={t('card.minimum')}>
            <Input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
          </Field>
          <Field label={t('card.interest')}>
            <Input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
          </Field>
          {initial && (
            <Field label={t('card.paidAmount')}>
              <Input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
          )}
        </div>
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
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function PayStatement({ statement, onClose, onSaved }: { statement: CardStatement; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useT();
  const { accounts, currencies, settings, reload } = useData();
  const card = accounts.find((a) => a.id === statement.accountId)!;
  const sources = accounts
    .filter((a) => !a.archived && a.id !== card.id && a.type !== 'credit_card')
    .sort((a, b) => Number(b.currency === card.currency) - Number(a.currency === card.currency) || Number(b.currency === settings.baseCurrency) - Number(a.currency === settings.baseCurrency));
  const dec = decimalsOf(currencies, card.currency);
  const [fromAccountId, setFromAccountId] = useState(sources[0]?.id ?? '');
  const from = accounts.find((a) => a.id === fromAccountId);
  const fromDec = decimalsOf(currencies, from?.currency ?? card.currency);
  const [amount, setAmount] = useState(toInput(statement.remaining, dec, locale));
  const [fromAmount, setFromAmount] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const format = useMoney();
  const minimumLeft = Math.max(0, statement.minimumPayment - statement.paidAmount);
  const cross = from && from.currency !== card.currency;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const minor = toMinor(amount, dec);
    if (!minor || minor <= 0) return setError(t('tx.invalidAmount'));
    const fromMinor = cross ? toMinor(fromAmount, fromDec) : undefined;
    if (cross && (!fromMinor || fromMinor <= 0)) return setError(t('tx.invalidAmount'));
    try {
      await api.post(`/card-statements/${statement.id}/pay`, { fromAccountId, amount: minor, fromAmount: fromMinor ?? undefined, date });
      await reload();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  return (
    <Modal title={`${t('card.payStatement')} · ${card.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('card.dueDate')}: {formatDate(statement.dueDate, locale)} · {t('common.remaining')}: {format(statement.remaining, card.currency)}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="!min-h-8 text-xs" onClick={() => setAmount(toInput(statement.remaining, dec, locale))}>
            {t('card.payFull')}
          </Button>
          {minimumLeft > 0 && (
            <Button type="button" variant="secondary" className="!min-h-8 text-xs" onClick={() => setAmount(toInput(minimumLeft, dec, locale))}>
              {t('card.payMinimum')} · {format(minimumLeft, card.currency)}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('tx.amount')} (${card.currency})`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label={t('tx.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label={t('card.fromAccount')}>
          <Select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            {sources.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        {cross && (
          <Field label={`${t('card.fromAmount')} (${from.currency})`}>
            <Input inputMode="decimal" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} required />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!fromAccountId}>
            {t('common.pay')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
