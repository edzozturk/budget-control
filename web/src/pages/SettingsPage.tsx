import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Field, Input, PageHeader, Select } from '../components/ui';
import { api, ApiError, type Locale, type Settings } from '../lib/api';
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
