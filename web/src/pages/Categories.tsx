import { useState, type FormEvent } from 'react';
import { TagSelect } from '../components/TagSelect';
import { Button, Card, cx, Dot, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Category, type CategoryKind, type CategoryRule } from '../lib/api';
import { useData, useResource } from '../lib/data';
import { useT } from '../lib/i18n';

export function Categories() {
  const { t } = useT();
  const { categories } = useData();
  const [editing, setEditing] = useState<Category | CategoryKind | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.categories')} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(['expense', 'income'] as const).map((kind) => (
          <Card key={kind} title={t(`kind.${kind}`)} action={<Button variant="secondary" onClick={() => setEditing(kind)}>+ {t('common.add')}</Button>}>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setEditing(c)} className={cx('flex w-full items-center gap-3 py-2.5 text-left text-sm', c.archived && 'opacity-50')}>
                      <Dot color={c.color} />
                      <span className="flex-1">{c.name}</span>
                      {c.archived && <span className="text-xs text-slate-500">{t('common.archived')}</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
      <Rules />
      {editing && (
        <CategoryForm
          initial={typeof editing === 'string' ? undefined : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryForm({ initial, kind: initialKind, onClose }: { initial?: Category; kind: CategoryKind; onClose: () => void }) {
  const { t } = useT();
  const { reload } = useData();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(initialKind);
  const [color, setColor] = useState(initial?.color ?? '#0f766e');
  const [error, setError] = useState('');

  async function save(e: FormEvent, patch: Partial<Category> = {}) {
    e.preventDefault();
    try {
      const body = { name, kind, color, ...patch };
      if (initial) await api.put(`/categories/${initial.id}`, body);
      else await api.post('/categories', body);
      await reload();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  async function remove() {
    if (!initial || !confirm(t('common.confirmDelete'))) return;
    try {
      await api.del(`/categories/${initial.id}`);
      await reload();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'in_use' ? t('common.inUse') : t('common.error'));
    }
  }

  return (
    <Modal title={initial ? t('category.edit') : t('category.add')} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('category.kind')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              <option value="expense">{t('kind.expense')}</option>
              <option value="income">{t('kind.income')}</option>
            </Select>
          </Field>
          <Field label={t('category.color')}>
            <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="p-1" />
          </Field>
        </div>
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

function Rules() {
  const { t } = useT();
  const { accounts, categories, members, costCenters, reload } = useData();
  const rules = useResource<CategoryRule[]>('/category-rules');
  const [pattern, setPattern] = useState('');
  const [target, setTarget] = useState('');
  const [memberId, setMemberId] = useState('');
  const [costCenterId, setCostCenterId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const describe = (r: CategoryRule) =>
    [
      r.categoryId && categories.find((c) => c.id === r.categoryId)?.name,
      r.transferAccountId && t('import.transferTo', { name: accounts.find((a) => a.id === r.transferAccountId)?.name ?? '?' }),
      r.memberId && members.find((m) => m.id === r.memberId)?.name,
      r.costCenterId && costCenters.find((c) => c.id === r.costCenterId)?.name,
    ]
      .filter(Boolean)
      .join(' · ');

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/category-rules', {
        pattern,
        categoryId: target.startsWith('cat:') ? target.slice(4) : null,
        transferAccountId: target.startsWith('acc:') ? target.slice(4) : null,
        memberId: memberId || null,
        costCenterId,
      });
      setPattern('');
      rules.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  }

  async function presets() {
    const { added } = await api.post<{ added: number }>('/category-rules/presets');
    setMessage(t('rules.presetsAdded', { n: added }));
    rules.refresh();
    await reload();
  }

  async function apply() {
    const { updated } = await api.post<{ updated: number }>('/category-rules/apply');
    setMessage(t('rules.applied', { n: updated }));
  }

  return (
    <Card title={t('rules.title')}>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t('rules.help')}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="secondary" className="!min-h-8 text-xs" onClick={presets}>
          {t('rules.presets')}
        </Button>
        <Button variant="secondary" className="!min-h-8 text-xs" onClick={apply}>
          {t('rules.apply')}
        </Button>
      </div>
      {rules.data?.length === 0 && <p className="py-2 text-sm text-slate-500">{t('rules.none')}</p>}
      <ul className="mb-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {rules.data?.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">“{r.pattern}”</span>
              <span className="text-slate-500"> → {describe(r)}</span>
            </span>
            <Button
              variant="ghost"
              className="!min-h-8 !px-2 text-xs text-red-600"
              onClick={async () => {
                await api.del(`/category-rules/${r.id}`);
                rules.refresh();
              }}
            >
              {t('common.delete')}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('rules.pattern')} required minLength={2} maxLength={200} />
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t('rules.target')}…</option>
          {categories
            .filter((c) => !c.archived)
            .map((c) => (
              <option key={c.id} value={`cat:${c.id}`}>
                {t(`kind.${c.kind}`)}: {c.name}
              </option>
            ))}
          {accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={`acc:${a.id}`}>
                {t('import.transferTo', { name: a.name })}
              </option>
            ))}
        </Select>
        <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">{t('common.member')}: {t('common.none')}</option>
          {members
            .filter((m) => !m.archived)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </Select>
        <TagSelect label={t('costCenter.short')} items={costCenters} value={costCenterId} onChange={setCostCenterId} className="" />
        <Button type="submit" variant="secondary" disabled={!target && !memberId && !costCenterId}>
          + {t('rules.add')}
        </Button>
      </form>
      {message && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
