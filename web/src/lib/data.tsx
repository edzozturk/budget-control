import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Account, type Category, type Currency, type Settings } from './api';

// Reference data most screens need, loaded once after unlock and refreshed on change.
interface AppData {
  settings: Settings;
  currencies: Currency[];
  accounts: Account[];
  categories: Category[];
  reload: () => Promise<void>;
  setSettings: (s: Settings) => void;
}

const DataContext = createContext<AppData | null>(null);

export function DataProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<Omit<AppData, 'reload' | 'setSettings'> | null>(null);

  const reload = useCallback(async () => {
    const [settings, currencies, accounts, categories] = await Promise.all([
      api.get<Settings>('/settings'),
      api.get<Currency[]>('/currencies'),
      api.get<Account[]>('/accounts'),
      api.get<Category[]>('/categories'),
    ]);
    setState({ settings, currencies, accounts, categories });
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  if (!state) return <>{fallback}</>;
  return (
    <DataContext.Provider value={{ ...state, reload, setSettings: (settings) => setState({ ...state, settings }) }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}

// Loads a resource and reloads it when `key` changes.
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    api
      .get<T>(url)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  return { data, error, refresh: () => setVersion((v) => v + 1) };
}
