import { useState, type FormEvent } from 'react';
import { Button, Card, cx, ErrorText, Field, Input, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Locale, type Member, type Settings } from '../lib/api';
import { useData } from '../lib/data';
import { useT } from '../lib/i18n';

export function SettingsPage({ appName, version }: { appName: string; version: string }) {
  const { t } = useT();
  const { settings, currencies, setSettings } = useData();
  const [form, setForm] = useState(settings);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      setSettings(await api.put<Settings>('/settings', form));
      setMessage(t('settings.saved'));
    } catch {
      setError(t('common.error'));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.settings')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('settings.general')}>
          <form onSubmit={save} className="space-y-4">
            <Field label={t('settings.workspaceName')}>
              <Input value={form.workspaceName} onChange={(e) => set('workspaceName', e.target.value)} required maxLength={100} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.locale')}>
                <Select value={form.locale} onChange={(e) => set('locale', e.target.value as Locale)}>
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                </Select>
              </Field>
              <Field label={t('settings.baseCurrency')}>
                <Select value={form.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('settings.monthStartDay')} help={t('settings.monthStartDayHelp')}>
              <Input type="number" min={1} max={28} value={form.monthStartDay} onChange={(e) => set('monthStartDay', Number(e.target.value))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.budgetWarnPercent')}>
                <Input type="number" min={1} max={100} value={form.budgetWarnPercent} onChange={(e) => set('budgetWarnPercent', Number(e.target.value))} />
              </Field>
              <Field label={t('settings.theme')}>
                <Select value={form.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
                  {(['system', 'light', 'dark'] as const).map((th) => (
                    <option key={th} value={th}>
                      {t(`settings.theme.${th}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            <ErrorText>{error}</ErrorText>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </Card>
        <Members />
        <ChangePassword />
      </div>
      <p className="text-center text-xs text-slate-400">
        {appName} · v{version}
      </p>
    </div>
  );
}

function ChangePassword() {
  const { t } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    if (next.length < 8) return setError(t('lock.tooShort'));
    if (next !== repeat) return setError(t('lock.mismatch'));
    try {
      await api.post('/change-password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      setMessage(t('settings.passwordChanged'));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'wrong_password' ? t('lock.wrong') : t('common.error'));
    }
  }

  return (
    <Card title={t('settings.security')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('settings.currentPassword')}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label={t('settings.newPassword')}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label={t('lock.passwordRepeat')}>
          <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="secondary">
          {t('settings.changePassword')}
        </Button>
      </form>
    </Card>
  );
}

const MEMBER_COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#9333ea', '#0891b2'];

function Members() {
  const { t } = useT();
  const { members, reload } = useData();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'in_use' ? t('common.inUse') : t('common.error'));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(() => api.post('/members', { name, color: MEMBER_COLORS[members.length % MEMBER_COLORS.length] }));
    setName('');
  }

  return (
    <Card title={t('member.title')}>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{t('member.help')}</p>
      <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
        {members.map((m: Member) => (
          <li key={m.id} className={cx('flex items-center gap-2 py-2 text-sm', m.archived && 'opacity-50')}>
            <input
              type="color"
              value={m.color}
              aria-label={t('category.color')}
              onChange={(e) => run(() => api.put(`/members/${m.id}`, { color: e.target.value }))}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="flex-1">{m.name}</span>
            <Button variant="ghost" className="!min-h-8 !px-2 text-xs" onClick={() => run(() => api.put(`/members/${m.id}`, { archived: !m.archived }))}>
              {m.archived ? t('common.unarchive') : t('common.archive')}
            </Button>
            <Button
              variant="ghost"
              className="!min-h-8 !px-2 text-xs text-red-600"
              onClick={() => confirm(t('common.confirmDelete')) && run(() => api.del(`/members/${m.id}`))}
            >
              {t('common.delete')}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('common.name')} required maxLength={100} />
        <Button type="submit" variant="secondary" className="shrink-0">
          + {t('member.add')}
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
