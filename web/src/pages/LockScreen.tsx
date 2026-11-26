import { useState, type FormEvent } from 'react';
import { Button, ErrorText, Field, Input, Select } from '../components/ui';
import { api, ApiError, type Locale, type Status } from '../lib/api';
import { makeT } from '../lib/i18n';

export function LockScreen({ status, onUnlocked }: { status: Status; onUnlocked: () => void }) {
  const [locale, setLocale] = useState<Locale>(status.defaults.locale);
  const t = makeT(locale);
  const setup = !status.initialized;
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [workspaceName, setWorkspaceName] = useState(locale === 'tr' ? 'Bütçem' : 'My budget');
  const [currency, setCurrency] = useState(status.defaults.currency);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (setup) {
      if (password.length < 8) return setError(t('lock.tooShort'));
      if (password !== repeat) return setError(t('lock.mismatch'));
    }
    setBusy(true);
    try {
      if (setup) await api.post('/setup', { password, workspaceName, locale, baseCurrency: currency });
      else await api.post('/unlock', { password });
      onUnlocked();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'wrong_password' ? t('lock.wrong') : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{status.appName}</p>
            <h1 className="text-xl font-semibold">{setup ? t('lock.setupTitle') : t('lock.unlockTitle')}</h1>
          </div>
        </div>
        {setup && <p className="text-sm text-slate-600 dark:text-slate-300">{t('lock.setupIntro')}</p>}
        {setup && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settings.locale')}>
              <Select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t('settings.baseCurrency')}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {['TRY', 'USD', 'EUR', 'GBP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {setup && (
          <Field label={t('lock.workspaceName')}>
            <Input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required />
          </Field>
        )}
        <Field label={t('lock.password')}>
          <Input type="password" autoFocus autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {setup && (
          <Field label={t('lock.passwordRepeat')}>
            <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          {setup ? t('lock.create') : t('lock.unlock')}
        </Button>
      </form>
    </div>
  );
}
