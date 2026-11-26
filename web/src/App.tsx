import { useCallback, useEffect, useState } from 'react';
import { cx } from './components/ui';
import { api, LOCKED_EVENT, type Status } from './lib/api';
import { DataProvider, useData } from './lib/data';
import { LocaleContext, makeT } from './lib/i18n';
import { Accounts } from './pages/Accounts';
import { Categories } from './pages/Categories';
import { Dashboard } from './pages/Dashboard';
import { LockScreen } from './pages/LockScreen';
import { SettingsPage } from './pages/SettingsPage';
import { Transactions } from './pages/Transactions';

const PAGES = ['dashboard', 'transactions', 'accounts', 'categories', 'settings'] as const;
type Page = (typeof PAGES)[number];

const ICONS: Record<Page, string> = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  transactions: 'M4 6h16M4 12h16M4 18h10',
  accounts: 'M3 7h18v12H3zM3 11h18M7 15h3',
  categories: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
};

function pageFromHash(): Page {
  const h = window.location.hash.replace('#/', '') as Page;
  return PAGES.includes(h) ? h : 'dashboard';
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    api
      .get<Status>('/status')
      .then((s) => {
        setStatus(s);
        document.title = s.appName;
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(LOCKED_EVENT, refresh);
    return () => window.removeEventListener(LOCKED_EVENT, refresh);
  }, [refresh]);

  if (error) return <p className="p-8 text-center">Server unreachable.</p>;
  if (!status) return null;
  if (!status.unlocked) return <LockScreen status={status} onUnlocked={refresh} />;

  return (
    <DataProvider fallback={null}>
      <Shell status={status} onLock={refresh} />
    </DataProvider>
  );
}

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

function Shell({ status, onLock }: { status: Status; onLock: () => void }) {
  const { settings } = useData();
  const t = makeT(settings.locale);
  const [page, setPage] = useState<Page>(pageFromHash);
  useTheme(settings.theme);

  useEffect(() => {
    document.documentElement.lang = settings.locale;
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [settings.locale]);

  const navigate = (p: string) => {
    window.location.hash = `#/${p}`;
  };

  async function lock() {
    await api.post('/lock');
    onLock();
  }

  const label = (p: Page) => t(`nav.${p}`);

  return (
    <LocaleContext.Provider value={settings.locale}>
      <div className="min-h-dvh lg:flex">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <div className="mb-6 flex items-center gap-2 px-2">
            <img src="/favicon.svg" alt="" className="size-8" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{status.appName}</p>
              <p className="truncate text-xs text-slate-500">{settings.workspaceName}</p>
            </div>
          </div>
          <nav className="space-y-1">
            {PAGES.map((p) => (
              <a
                key={p}
                href={`#/${p}`}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  page === p ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <Icon d={ICONS[p]} />
                {label(p)}
              </a>
            ))}
          </nav>
          <button onClick={lock} className="mt-auto rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            🔒 {t('nav.lock')}
          </button>
        </aside>

        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="font-semibold">{status.appName}</span>
          </div>
          <button onClick={lock} className="rounded-lg p-2 text-sm text-slate-500" aria-label={t('nav.lock')}>
            🔒
          </button>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          {page === 'dashboard' && <Dashboard navigate={navigate} />}
          {page === 'transactions' && <Transactions />}
          {page === 'accounts' && <Accounts />}
          {page === 'categories' && <Categories />}
          {page === 'settings' && <SettingsPage appName={status.appName} version={status.version} />}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 lg:hidden">
          {PAGES.map((p) => (
            <a
              key={p}
              href={`#/${p}`}
              className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px]', page === p ? 'text-teal-700 dark:text-teal-300' : 'text-slate-500')}
            >
              <Icon d={ICONS[p]} />
              <span className="max-w-full truncate px-1">{label(p)}</span>
            </a>
          ))}
        </nav>
      </div>
    </LocaleContext.Provider>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
