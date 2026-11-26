import { useState, type FormEvent } from 'react';
import { Button, Card, cx, Dot, ErrorText, Field, Input, Modal, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Category, type CategoryKind } from '../lib/api';
import { useData } from '../lib/data';
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
