export type Locale = 'tr' | 'en';
export type AccountType = 'bank' | 'cash' | 'credit_card' | 'savings' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TransactionKind = 'income' | 'expense' | 'transfer';

export interface Status {
  appName: string;
  version: string;
  initialized: boolean;
  unlocked: boolean;
  defaults: { locale: Locale; currency: string };
}

export interface Settings {
  workspaceName: string;
  locale: Locale;
  baseCurrency: string;
  monthStartDay: number;
  budgetWarnPercent: number;
  theme: 'system' | 'light' | 'dark';
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  balance: number;
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  archived: boolean;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  date: string;
  accountId: string;
  amount: number;
  categoryId: string | null;
  toAccountId: string | null;
  toAmount: number | null;
  note: string;
}

export interface Summary {
  from: string;
  to: string;
  totals: Record<string, { income: number; expense: number; net: number }>;
  byCategory: { categoryId: string | null; currency: string; kind: CategoryKind; total: number }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

// Fired when the server reports the vault as locked (idle timeout or another tab locked it).
export const LOCKED_EVENT = 'budget:locked';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new Event(LOCKED_EVENT));
    throw new ApiError(res.status, data.error ?? 'error', data.message);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: (url: string) => request<void>('DELETE', url),
};

export function query(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}
