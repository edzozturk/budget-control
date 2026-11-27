import { useMemo, useState, type FormEvent } from 'react';
import { Money } from '../components/Money';
import { TagSelect } from '../components/TagSelect';
import { Button, Card, cx, Empty, ErrorText, Field, Input, PageHeader, Select } from '../components/ui';
import { api, ApiError, upload, type Cell, type ImportBatch, type ImportLine, type ImportMapping } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';
import { formatDate } from '../lib/money';
import { patternMatches } from '../lib/text';

interface Parsed {
  rows: Cell[][];
  mapping: ImportMapping;
  savedMapping: boolean;
}

type EditableLine = ImportLine & { include: boolean };

export function Import() {
  const { t } = useT();
  const { accounts, reload } = useData();
  const active = accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState(active[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  // Changing the key clears the file input, so the same file can be chosen again.
  const [fileKey, setFileKey] = useState(0);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [lines, setLines] = useState<EditableLine[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useResource<ImportBatch[]>(accountId ? `/imports?accountId=${accountId}` : null);

  const reset = () => {
    setParsed(null);
    setMapping(null);
    setLines(null);
    setError('');
  };

  const explain = (err: unknown) =>
    err instanceof ApiError && ['unsupported_format', 'empty_file', 'unreadable_file', 'too_many_rows', 'pdf_encrypted', 'pdf_no_text'].includes(err.code)
      ? t(`import.error.${err.code}` as 'import.error.empty_file')
      : err instanceof ApiError
        ? err.message
        : t('common.error');

  async function read(e: FormEvent) {
    e.preventDefault();
    if (!file || !accountId) return;
    reset();
    setMessage('');
    setBusy(true);
    try {
      const result = await upload<Parsed>(`/imports/parse?accountId=${accountId}`, file);
      setParsed(result);
      setMapping(result.mapping);
      await preview(result.rows, result.mapping);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function preview(rows = parsed?.rows, m = mapping) {
    if (!rows || !m) return;
    setError('');
    try {
      const result = await api.post<{ lines: ImportLine[] }>('/imports/preview', { accountId, rows, mapping: m });
      setLines(result.lines.map((l) => ({ ...l, include: l.status !== 'duplicate' })));
    } catch (err) {
      setError(explain(err));
    }
  }

  async function commit() {
    if (!lines || !mapping) return;
    setBusy(true);
    try {
      const result = await api.post<{ createdCount: number; matchedCount: number }>('/imports', { accountId, fileName: file?.name ?? '', mapping, lines });
      setMessage(t('import.done', { created: result.createdCount, matched: result.matchedCount }));
      reset();
      setFile(null);
      setFileKey((k) => k + 1);
      history.refresh();
      await reload();
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('import.title')} />
      <Card>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{t('import.intro')}</p>
        <form onSubmit={read} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t('import.account')}>
            <Select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                reset();
              }}
            >
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({t(`accountType.${a.type}`)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('import.file')}>
            <Input
              key={fileKey}
              type="file"
              accept=".csv,.txt,.xlsx,.xls,.htm,.html,.pdf"
              className="py-1.5"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
            />
          </Field>
          <Button type="submit" disabled={!file || !accountId || busy}>
            {t('import.read')}
          </Button>
        </form>
        {message && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">✓ {message}</p>}
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>

      {parsed && mapping && (
        <MappingCard
          rows={parsed.rows}
          mapping={mapping}
          saved={parsed.savedMapping}
          onChange={(m) => {
            setMapping(m);
            preview(parsed.rows, m);
          }}
        />
      )}

      {lines && <LinesCard accountId={accountId} lines={lines} setLines={setLines} onCommit={commit} busy={busy} />}

      {!!history.data?.length && <HistoryCard batches={history.data} onUndone={history.refresh} />}
    </div>
  );
}

function MappingCard({ rows, mapping, saved, onChange }: { rows: Cell[][]; mapping: ImportMapping; saved: boolean; onChange: (m: ImportMapping) => void }) {
  const { t } = useT();
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const header = mapping.headerRow >= 0 ? rows[mapping.headerRow] : [];
  const label = (i: number) => {
    const h = header[i];
    return h != null && h !== '' ? `${String(h)}` : t('import.column', { n: i + 1 });
  };
  const columns = Array.from({ length: width }, (_, i) => i);
  const sample = rows.slice(mapping.headerRow + 1, mapping.headerRow + 6);
  const split = mapping.amountCol == null;
  const set = (patch: Partial<ImportMapping>) => onChange({ ...mapping, ...patch });
  const colSelect = (value: number | null, change: (v: number) => void) => (
    <Select value={value ?? 0} onChange={(e) => change(Number(e.target.value))}>
      {columns.map((i) => (
        <option key={i} value={i}>
          {label(i)}
        </option>
      ))}
    </Select>
  );

  return (
    <Card title={t('import.columns')}>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{saved ? t('import.savedMapping') : t('import.columnsHelp')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t('import.headerRow')}>
          <Select value={mapping.headerRow} onChange={(e) => set({ headerRow: Number(e.target.value) })}>
            <option value={-1}>{t('import.noHeader')}</option>
            {rows.slice(0, 30).map((r, i) => (
              <option key={i} value={i}>
                {i + 1}: {r.filter((c) => c != null && c !== '').join(' | ').slice(0, 40)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('import.dateCol')}>{colSelect(mapping.dateCol, (v) => set({ dateCol: v }))}</Field>
        <Field label={t('import.amountMode')}>
          <Select
            value={split ? 'split' : 'single'}
            onChange={(e) =>
              e.target.value === 'split'
                ? set({ amountCol: null, debitCol: mapping.debitCol ?? 0, creditCol: mapping.creditCol ?? 0 })
                : set({ amountCol: mapping.debitCol ?? 0, debitCol: null, creditCol: null })
            }
          >
            <option value="single">{t('import.amountSingle')}</option>
            <option value="split">{t('import.amountSplit')}</option>
          </Select>
        </Field>
        {split ? (
          <>
            <Field label={t('import.debitCol')}>{colSelect(mapping.debitCol, (v) => set({ debitCol: v }))}</Field>
            <Field label={t('import.creditCol')}>{colSelect(mapping.creditCol, (v) => set({ creditCol: v }))}</Field>
          </>
        ) : (
          <Field label={t('import.amountCol')}>{colSelect(mapping.amountCol, (v) => set({ amountCol: v }))}</Field>
        )}
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('import.descriptionCols')}</span>
        <div className="flex flex-wrap gap-2">
          {columns.map((i) => {
            const on = mapping.descriptionCols.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const next = on ? mapping.descriptionCols.filter((c) => c !== i) : [...mapping.descriptionCols, i].sort((a, b) => a - b);
                  if (next.length) set({ descriptionCols: next });
                }}
                className={cx(
                  'rounded-full px-3 py-1 text-xs ring-1',
                  on ? 'bg-teal-700 text-white ring-teal-700' : 'text-slate-600 ring-slate-300 dark:text-slate-300 dark:ring-slate-600',
                )}
              >
                {label(i)}
              </button>
            );
          })}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mapping.invert} onChange={(e) => set({ invert: e.target.checked })} className="size-4" />
        {t('import.invert')}
      </label>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              {columns.map((i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">
                  {label(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.map((r, ri) => (
              <tr key={ri} className="border-t border-slate-100 dark:border-slate-800">
                {columns.map((i) => (
                  <td key={i} className="max-w-48 truncate whitespace-nowrap px-2 py-1">
                    {r[i] == null ? '' : String(r[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// One select for where a line goes: a category of the right kind, or a transfer to another account.
function targetValue(l: ImportLine) {
  return l.transferAccountId ? `acc:${l.transferAccountId}` : l.categoryId ? `cat:${l.categoryId}` : '';
}

function LinesCard({
  accountId,
  lines,
  setLines,
  onCommit,
  busy,
}: {
  accountId: string;
  lines: EditableLine[];
  setLines: (l: EditableLine[]) => void;
  onCommit: () => void;
  busy: boolean;
}) {
  const { t, locale } = useT();
  const { accounts, categories, members, costCenters } = useData();
  const account = accounts.find((a) => a.id === accountId)!;
  const [filter, setFilter] = useState<'all' | 'uncategorized'>('all');
  const [error, setError] = useState('');
  const counts = useMemo(
    () => ({
      new: lines.filter((l) => l.status === 'new').length,
      matched: lines.filter((l) => l.status === 'matched').length,
      duplicate: lines.filter((l) => l.status === 'duplicate').length,
    }),
    [lines],
  );
  const included = lines.filter((l) => l.include && l.status !== 'duplicate').length;
  const others = accounts.filter((a) => !a.archived && a.id !== accountId && a.currency === account.currency);
  const shown = lines.filter((l) => filter === 'all' || (l.status === 'new' && !l.categoryId && !l.transferAccountId));

  const update = (key: string, patch: Partial<EditableLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setTarget = (l: EditableLine, value: string) =>
    update(l.key, value.startsWith('acc:') ? { transferAccountId: value.slice(4), categoryId: null } : { categoryId: value.slice(4) || null, transferAccountId: null });

  async function makeRule(l: EditableLine) {
    const pattern = window.prompt(t('import.rulePrompt'), l.description.split(/\s+/).slice(0, 2).join(' '));
    if (!pattern?.trim()) return;
    setError('');
    try {
      await api.post('/category-rules', { pattern, categoryId: l.categoryId, memberId: l.memberId, costCenterId: l.costCenterId, transferAccountId: l.transferAccountId });
      // Apply the new rule to the other new lines in this preview.
      setLines(
        lines.map((x) =>
          x.status === 'new' && patternMatches(pattern, x.description) && Math.sign(x.amount) === Math.sign(l.amount)
            ? { ...x, categoryId: l.categoryId, memberId: l.memberId ?? x.memberId, costCenterId: l.costCenterId ?? x.costCenterId, transferAccountId: l.transferAccountId }
            : x,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  return (
    <Card
      title={t('import.lines', counts)}
      action={
        <Select value={filter} onChange={(e) => setFilter(e.target.value as 'all')} className="!w-auto">
          <option value="all">{t('import.filter.all')}</option>
          <option value="uncategorized">{t('import.filter.uncategorized')}</option>
        </Select>
      }
    >
      {lines.length === 0 ? (
        <Empty>{t('import.noLines')}</Empty>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((l) => {
            const kind = l.amount < 0 ? 'expense' : 'income';
            return (
              <li key={l.key} className={cx('py-2', (!l.include || l.status === 'duplicate') && 'opacity-50')}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={l.include && l.status !== 'duplicate'}
                    disabled={l.status === 'duplicate'}
                    onChange={(e) => update(l.key, { include: e.target.checked })}
                    aria-label={l.description}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium">{l.description || '—'}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {formatDate(l.date, locale)} · {t(`import.status.${l.status}`)}
                        </span>
                      </span>
                      <Money amount={l.amount} currency={account.currency} signed className="shrink-0 text-sm font-semibold" />
                    </div>
                    {l.status === 'new' && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                        <Select value={targetValue(l)} onChange={(e) => setTarget(l, e.target.value)} className="!min-h-9 max-sm:col-span-2">
                          <option value="">{t('dashboard.uncategorized')}</option>
                          {categories
                            .filter((c) => c.kind === kind && !c.archived)
                            .map((c) => (
                              <option key={c.id} value={`cat:${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                          {others.map((a) => (
                            <option key={a.id} value={`acc:${a.id}`}>
                              {t('import.transferTo', { name: a.name })}
                            </option>
                          ))}
                        </Select>
                        <TagSelect label={t('common.member')} items={members} value={l.memberId} onChange={(memberId) => update(l.key, { memberId })} />
                        <TagSelect label={t('costCenter.short')} items={costCenters} value={l.costCenterId} onChange={(costCenterId) => update(l.key, { costCenterId })} />
                        <Button
                          variant="ghost"
                          className="!min-h-9 !px-2 text-xs max-sm:col-span-2 max-sm:justify-self-end"
                          disabled={!l.categoryId && !l.memberId && !l.costCenterId && !l.transferAccountId}
                          onClick={() => makeRule(l)}
                        >
                          {t('import.makeRule')}
                        </Button>
                      </div>
                    )}
                    {l.status === 'matched' && <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">{t('import.matchedHelp')}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
      {included > 0 && (
        <div className="sticky bottom-16 mt-3 flex justify-end lg:bottom-2">
          <Button onClick={onCommit} disabled={busy} className="shadow-lg">
            {t('import.commit', { n: included })}
          </Button>
        </div>
      )}
    </Card>
  );
}

function HistoryCard({ batches, onUndone }: { batches: ImportBatch[]; onUndone: () => void }) {
  const { t, locale } = useT();
  const { reload } = useData();

  async function undo(id: string) {
    if (!confirm(t('import.undoConfirm'))) return;
    await api.del(`/imports/${id}`);
    await reload();
    onUndone();
  }

  return (
    <Card title={t('import.history')}>
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {batches.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{b.fileName || '—'}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {b.fromDate && b.toDate ? `${formatDate(b.fromDate, locale)} – ${formatDate(b.toDate, locale)} · ` : ''}
                {t('import.done', { created: b.createdCount, matched: b.matchedCount })}
              </span>
            </span>
            <Button variant="ghost" className="!min-h-8 !px-2 text-xs" onClick={() => undo(b.id)}>
              {t('import.undo')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
