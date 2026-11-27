import { useState, type FormEvent, type ReactNode } from 'react';
import { Money } from '../components/Money';
import { Button, Card, cx, Empty, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Account, type AccountType, type Bank } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { formatIban, ibanBankCode, maskTail, validIban } from '../lib/iban';
import { useT } from '../lib/i18n';
import { decimalsOf, toInput, toMinor } from '../lib/money';

const TYPES: AccountType[] = ['bank', 'overdraft', 'term_deposit', 'fx', 'gold', 'investment', 'savings', 'credit_card', 'cash', 'other'];
const BANK_TYPES: AccountType[] = ['bank', 'overdraft', 'term_deposit', 'fx', 'gold', 'investment', 'savings', 'credit_card'];

export function Accounts() {
  const { t } = useT();
  const { accounts, members } = useData();
  const banks = useResource<Bank[]>('/banks').data ?? [];
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const closedCount = accounts.filter((a) => a.archived).length;
  const visible = accounts.filter((a) => showClosed || !a.archived);
  // Grouped by bank, in the order of the bank list; accounts without a bank last.
  const groups = new Map<string, Account[]>();
  for (const a of visible) groups.set(a.bankCode ?? '', [...(groups.get(a.bankCode ?? '') ?? []), a]);
  const bankName = (code: string) => (code ? (banks.find((b) => b.code === code)?.name ?? code) : t('account.noBank'));
  const order = [...groups.keys()].sort((a, b) => Number(a === '') - Number(b === '') || bankName(a).localeCompare(bankName(b), 'tr'));

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.accounts')} action={<Button onClick={() => setEditing('new')}>+ {t('account.add')}</Button>} />
      {accounts.length === 0 ? (
        <Card>
          <Empty>{t('dashboard.noAccounts')}</Empty>
        </Card>
      ) : (
        order.map((code) => (
          <Card key={code || '-'} title={order.length > 1 || code ? bankName(code) : undefined}>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.get(code)!.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setEditing(a)} className={cx('flex w-full items-center justify-between gap-3 py-3 text-left', a.archived && 'opacity-50')}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {[
                          t(`accountType.${a.type}`),
                          a.currency,
                          a.branchName,
                          a.iban ? `IBAN ${maskTail(a.iban)}` : a.accountNumber ? maskTail(a.accountNumber) : null,
                          a.last4 ? `•••• ${a.last4}` : null,
                          members.find((m) => m.id === a.ownerMemberId)?.name,
                          a.joint ? t('account.joint') : null,
                          a.type === 'term_deposit' && a.termEnd ? `${t('account.termEnd')} ${a.termEnd.split('-').reverse().join('.')}` : null,
                          a.archived ? t('common.archived') : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Money amount={a.balance} currency={a.currency} className="font-semibold" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {closedCount > 0 && (
        <button className="text-sm text-teal-700 underline dark:text-teal-300" onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? t('account.hide') : t('account.showClosed', { count: String(closedCount) })}
        </button>
      )}
      {editing && <AccountForm initial={editing === 'new' ? undefined : editing} banks={banks} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountForm({ initial, banks, onClose }: { initial?: Account; banks: Bank[]; onClose: () => void }) {
  const { t, locale } = useT();
  const { currencies, settings, members, reload } = useData();
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
  const [bankCode, setBankCode] = useState(initial?.bankCode ?? '');
  const [iban, setIban] = useState(initial?.iban ? formatIban(initial.iban) : '');
  const [revealed, setRevealed] = useState(!initial?.iban && !initial?.accountNumber);
  const [branchName, setBranchName] = useState(initial?.branchName ?? '');
  const [branchCode, setBranchCode] = useState(initial?.branchCode ?? '');
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '');
  const [accountSuffix, setAccountSuffix] = useState(initial?.accountSuffix ?? '');
  const [customerNumber, setCustomerNumber] = useState(initial?.customerNumber ?? '');
  const [ownerMemberId, setOwnerMemberId] = useState(initial?.ownerMemberId ?? '');
  const [joint, setJoint] = useState(initial?.joint ?? false);
  const [openedOn, setOpenedOn] = useState(initial?.openedOn ?? '');
  const [closedOn, setClosedOn] = useState(initial?.closedOn ?? '');
  const [interestDay, setInterestDay] = useState(initial?.interestDay?.toString() ?? '');
  const [termStart, setTermStart] = useState(initial?.termStart ?? '');
  const [termEnd, setTermEnd] = useState(initial?.termEnd ?? '');
  const [autoRenew, setAutoRenew] = useState(initial?.autoRenew ?? false);
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');
  const isCard = type === 'credit_card';
  const isTerm = type === 'term_deposit';
  const hasLimit = isCard || type === 'overdraft';
  const hasRate = hasLimit || isTerm;
  const atBank = BANK_TYPES.includes(type);
  const ibanCode = ibanBankCode(iban);
  const ibanError = iban.trim() !== '' && !validIban(iban);

  function changeIban(value: string) {
    setIban(value);
    const code = ibanBankCode(value);
    if (code && validIban(value) && banks.some((b) => b.code === code)) setBankCode(code);
  }

  async function save(e: FormEvent, patch: Partial<Account> = {}) {
    e.preventDefault();
    const openingBalance = opening.trim() ? toMinor(opening, dec) : 0;
    if (openingBalance === null) return setError(t('tx.invalidAmount'));
    const creditLimit = hasLimit && limit.trim() ? toMinor(limit, dec) : null;
    if (hasLimit && limit.trim() && creditLimit === null) return setError(t('tx.invalidAmount'));
    const interestRate = hasRate && rate.trim() ? Number(rate.replace(',', '.')) : null;
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
      bankCode: atBank && bankCode ? bankCode : null,
      iban: atBank && !isCard ? iban : null,
      branchName: atBank ? branchName : null,
      branchCode: atBank ? branchCode : null,
      accountNumber: atBank && !isCard ? accountNumber : null,
      accountSuffix: atBank && !isCard ? accountSuffix : null,
      customerNumber: atBank ? customerNumber : null,
      ownerMemberId: ownerMemberId || null,
      joint,
      openedOn: openedOn || null,
      closedOn: closedOn || null,
      // A closing date closes the account; clearing it reopens one closed that way.
      archived: closedOn ? true : initial?.closedOn ? false : (initial?.archived ?? false),
      interestDay: type === 'overdraft' && interestDay ? Number(interestDay) : null,
      termStart: isTerm ? termStart || null : null,
      termEnd: isTerm ? termEnd || null : null,
      autoRenew: isTerm && autoRenew,
      note,
      ...patch,
    };
    if (ibanError) return setError(t('account.ibanInvalid'));
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
        {hasRate && (
          <div className="grid grid-cols-2 gap-3">
            {hasLimit && (
              <Field label={t('account.creditLimit')}>
                <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Field>
            )}
            <Field label={isTerm ? t('account.annualRate') : t('account.interestRate')}>
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            {type === 'overdraft' && (
              <Field label={t('account.interestDay')}>
                <Input type="number" min={1} max={31} value={interestDay} onChange={(e) => setInterestDay(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        {isTerm && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('account.termStart')}>
                <Input type="date" value={termStart} onChange={(e) => setTermStart(e.target.value)} />
              </Field>
              <Field label={t('account.termEnd')}>
                <Input type="date" value={termEnd} min={termStart || undefined} onChange={(e) => setTermEnd(e.target.value)} />
              </Field>
            </div>
            <Check label={t('account.autoRenew')} checked={autoRenew} onChange={setAutoRenew} />
          </>
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
        {atBank && (
          <Section title={t('account.bankSection')}>
            <Field label={t('account.bank')}>
              <Select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                <option value="">{t('account.bankOther')}</option>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!isCard && (
              <Field
                label={t('account.iban')}
                help={
                  ibanError
                    ? t('account.ibanInvalid')
                    : ibanCode && bankCode && ibanCode !== bankCode
                      ? t('account.ibanBank', { bank: banks.find((b) => b.code === ibanCode)?.name ?? ibanCode })
                      : undefined
                }
              >
                <Secret revealed={revealed} onReveal={() => setRevealed(true)} masked={maskTail(formatIban(iban))}>
                  <Input
                    value={iban}
                    onChange={(e) => changeIban(e.target.value)}
                    onBlur={() => !ibanError && iban && setIban(formatIban(iban))}
                    placeholder="TR00 0000 0000 0000 0000 0000 00"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={ibanError}
                    className={cx(ibanError && '!border-red-500')}
                  />
                </Secret>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('account.branchName')}>
                <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} maxLength={100} />
              </Field>
              <Field label={t('account.branchCode')}>
                <Input inputMode="numeric" value={branchCode} onChange={(e) => setBranchCode(e.target.value)} maxLength={20} />
              </Field>
              {!isCard && (
                <>
                  <Field label={t('account.accountNumber')}>
                    <Secret revealed={revealed} onReveal={() => setRevealed(true)} masked={maskTail(accountNumber)}>
                      <Input inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={40} autoComplete="off" />
                    </Secret>
                  </Field>
                  <Field label={t('account.accountSuffix')}>
                    <Input inputMode="numeric" value={accountSuffix} onChange={(e) => setAccountSuffix(e.target.value)} maxLength={20} />
                  </Field>
                </>
              )}
              <Field label={t('account.customerNumber')}>
                <Input inputMode="numeric" value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} maxLength={40} autoComplete="off" />
              </Field>
            </div>
          </Section>
        )}
        <Section title={t('account.ownerSection')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('account.owner')}>
              <Select value={ownerMemberId} onChange={(e) => setOwnerMemberId(e.target.value)}>
                <option value="">{t('account.ownerNone')}</option>
                {members
                  .filter((m) => !m.archived || m.id === ownerMemberId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex items-end pb-2">
              <Check label={t('account.joint')} checked={joint} onChange={setJoint} />
            </div>
            <Field label={t('account.openedOn')}>
              <Input type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
            </Field>
            <Field label={t('account.closedOn')}>
              <Input type="date" value={closedOn} min={openedOn || undefined} onChange={(e) => setClosedOn(e.target.value)} />
            </Field>
          </div>
          {closedOn && <p className="text-xs text-slate-500 dark:text-slate-400">{t('account.closedHelp')}</p>}
          <Field label={t('account.note')}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
            />
          </Field>
        </Section>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
      <legend className="pr-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</legend>
      {children}
    </fieldset>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-teal-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// IBAN and account number stay masked on screen until asked for.
function Secret({ revealed, onReveal, masked, children }: { revealed: boolean; onReveal: () => void; masked: string; children: ReactNode }) {
  const { t } = useT();
  if (revealed || !masked) return <>{children}</>;
  return (
    <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 dark:border-slate-700">
      <span className="font-mono text-sm tracking-wide">{masked}</span>
      <button type="button" className="text-sm text-teal-700 underline dark:text-teal-300" onClick={onReveal}>
        {t('account.show')}
      </button>
    </div>
  );
}
