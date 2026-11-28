import { useState } from 'react';
import { Money } from '../components/Money';
import { Button, ErrorText, Field, Input, Modal, Select } from '../components/ui';
import { api, ApiError, upload, type Account, type Bank, type BankCustomer, type Passbook } from '../lib/api';
import { useData } from '../lib/data';
import { useT } from '../lib/i18n';
import { maskTail } from '../lib/iban';
import { formatDate } from '../lib/money';

// --- Customer numbers: one per bank and holder -------------------------------------------------

export function CustomerNumbers({ bank, customers, onClose }: { bank: Bank; customers: BankCustomer[]; onClose: () => void }) {
  const { t } = useT();
  const { members } = useData();
  const holders: { id: string | null; name: string }[] = [{ id: null, name: t('account.household') }, ...members.filter((m) => !m.archived).map((m) => ({ id: m.id, name: m.name }))];
  const initial = (id: string | null) => customers.find((c) => c.bankCode === bank.code && c.memberId === id)?.customerNumber ?? '';
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(holders.map((h) => [h.id ?? '', initial(h.id)])));
  const [error, setError] = useState('');

  async function save() {
    try {
      for (const h of holders) {
        const value = values[h.id ?? ''].trim();
        if (value !== initial(h.id)) await api.put('/bank-customers', { bankCode: bank.code, memberId: h.id, customerNumber: value });
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  return (
    <Modal title={`${bank.name} · ${t('account.customerNumber')}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('account.customerHelp')}</p>
        {holders.map((h) => (
          <Field key={h.id ?? '-'} label={h.name}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              value={values[h.id ?? '']}
              onChange={(e) => setValues({ ...values, [h.id ?? '']: e.target.value })}
            />
          </Field>
        ))}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Accounts from passbook PDFs ---------------------------------------------------------------

interface Row {
  file: string;
  passbook?: Passbook;
  existing?: Account;
  error?: string;
  name: string;
  memberId: string;
  useBalance: boolean;
  include: boolean;
}

const titleCase = (s: string) => s.toLocaleLowerCase('tr').replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toLocaleUpperCase('tr'));

export function PassbookImport({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const { accounts, members, reload } = useData();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function read(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setDone('');
    const out: Row[] = [];
    for (const file of Array.from(files)) {
      try {
        const r = await upload<{ passbook: Passbook; existingAccountId: string | null; memberId: string | null }>('/imports/passbook', file);
        const p = r.passbook;
        const existing = accounts.find((a) => a.id === r.existingAccountId);
        out.push({
          file: file.name,
          passbook: p,
          existing,
          name: existing?.name ?? [p.bankName, t(`accountType.${p.type}`), p.branchName ? titleCase(p.branchName) : null].filter(Boolean).join(' '),
          memberId: existing?.ownerMemberId ?? r.memberId ?? '',
          useBalance: !existing && p.balance != null,
          include: true,
        });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : '';
        out.push({
          file: file.name,
          error: ['passbook_unknown', 'pdf_encrypted', 'pdf_no_text'].includes(code) ? t(`import.error.${code}` as 'import.error.passbook_unknown') : t('common.error'),
          name: '',
          memberId: '',
          useBalance: false,
          include: false,
        });
      }
    }
    setRows(out);
    setBusy(false);
  }

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setError('');
    let created = 0;
    let updated = 0;
    try {
      for (const r of rows) {
        const p = r.passbook;
        if (!p || !r.include) continue;
        const details = {
          bankCode: p.bankCode,
          branchName: p.branchName ? titleCase(p.branchName) : null,
          branchCode: p.branchCode,
          accountNumber: p.accountNumber,
          iban: p.iban,
          openedOn: p.openedOn,
          termEnd: p.termEnd,
          interestRate: p.interestRate,
        };
        if (r.existing) {
          // Fill in what the account is missing; never overwrite what was entered by hand.
          const a = r.existing;
          const patch = Object.fromEntries(Object.entries(details).filter(([k, v]) => v != null && a[k as keyof Account] == null));
          await api.put(`/accounts/${a.id}`, { ...patch, name: r.name, ownerMemberId: r.memberId || null });
          updated++;
        } else {
          await api.post('/accounts', {
            ...details,
            name: r.name,
            type: p.type,
            currency: p.currency,
            ownerMemberId: r.memberId || null,
            openingBalance: r.useBalance && p.balance != null ? p.balance : 0,
          });
          created++;
        }
      }
      await reload();
      setRows([]);
      setDone(t('passbook.done', { created, updated }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('passbook.title')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('passbook.intro')}</p>
        <Input type="file" accept=".pdf" multiple className="py-1.5" disabled={busy} onChange={(e) => read(e.target.files)} />
        {done && <p className="text-sm text-emerald-700 dark:text-emerald-400">✓ {done}</p>}
        {rows.map((r, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{r.file}</p>
            {r.error ? (
              <ErrorText>{r.error}</ErrorText>
            ) : (
              r.passbook && (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="size-4 accent-teal-600" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                    {r.existing ? t('passbook.update', { account: r.existing.name }) : t('passbook.create')}
                  </label>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {[
                      r.passbook.bankName,
                      t(`accountType.${r.passbook.type}`),
                      r.passbook.branchName && `${titleCase(r.passbook.branchName)}${r.passbook.branchCode ? ` (${r.passbook.branchCode})` : ''}`,
                      r.passbook.iban ? `IBAN ${maskTail(r.passbook.iban)}` : r.passbook.accountNumber && maskTail(r.passbook.accountNumber),
                      r.passbook.openedOn && `${t('account.openedOn')} ${formatDate(r.passbook.openedOn, locale)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('common.name')}>
                      <Input value={r.name} maxLength={100} onChange={(e) => update(i, { name: e.target.value })} />
                    </Field>
                    <Field label={t('account.owner')}>
                      <Select value={r.memberId} onChange={(e) => update(i, { memberId: e.target.value })}>
                        <option value="">{t('account.ownerNone')}</option>
                        {members
                          .filter((m) => !m.archived)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  </div>
                  {!r.existing && r.passbook.balance != null && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-teal-600"
                        checked={r.useBalance}
                        onChange={(e) => update(i, { useBalance: e.target.checked })}
                      />
                      <span>
                        {t('passbook.useBalance')} <Money amount={r.passbook.balance} currency={r.passbook.currency} />
                        {r.passbook.balanceDate && ` (${formatDate(r.passbook.balanceDate, locale)})`}
                      </span>
                    </label>
                  )}
                </>
              )
            )}
          </div>
        ))}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button type="button" disabled={busy || !rows.some((r) => r.include && !r.error && r.name.trim())} onClick={save}>
            {t('passbook.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
