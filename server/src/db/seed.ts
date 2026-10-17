import { randomUUID } from 'node:crypto';
import type { Db } from './index.js';
import { categories, currencies, settings, workspaces } from './schema.js';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings.js';

export const CURRENCIES = [
  { code: 'TRY', name: 'Türk Lirası', symbol: '₺', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', decimals: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
];

type CategorySeed = { kind: 'income' | 'expense'; color: string; name: Record<'tr' | 'en', string> };

const DEFAULT_CATEGORIES: CategorySeed[] = [
  { kind: 'income', color: '#16a34a', name: { tr: 'Maaş', en: 'Salary' } },
  { kind: 'income', color: '#0d9488', name: { tr: 'Serbest gelir', en: 'Freelance' } },
  { kind: 'income', color: '#0891b2', name: { tr: 'Kira geliri', en: 'Rental income' } },
  { kind: 'income', color: '#65a30d', name: { tr: 'Yatırım geliri', en: 'Investment income' } },
  { kind: 'income', color: '#84cc16', name: { tr: 'Diğer gelir', en: 'Other income' } },
  { kind: 'expense', color: '#dc2626', name: { tr: 'Kira', en: 'Rent' } },
  { kind: 'expense', color: '#ea580c', name: { tr: 'Market', en: 'Groceries' } },
  { kind: 'expense', color: '#d97706', name: { tr: 'Faturalar', en: 'Utilities' } },
  { kind: 'expense', color: '#ca8a04', name: { tr: 'Ulaşım', en: 'Transport' } },
  { kind: 'expense', color: '#db2777', name: { tr: 'Yeme içme', en: 'Dining out' } },
  { kind: 'expense', color: '#9333ea', name: { tr: 'Abonelikler', en: 'Subscriptions' } },
  { kind: 'expense', color: '#2563eb', name: { tr: 'Sağlık', en: 'Health' } },
  { kind: 'expense', color: '#4f46e5', name: { tr: 'Eğitim', en: 'Education' } },
  { kind: 'expense', color: '#c026d3', name: { tr: 'Giyim', en: 'Clothing' } },
  { kind: 'expense', color: '#0284c7', name: { tr: 'Eğlence', en: 'Entertainment' } },
  { kind: 'expense', color: '#64748b', name: { tr: 'Diğer gider', en: 'Other expense' } },
];

export function seedCurrencies(db: Db) {
  db.insert(currencies).values(CURRENCIES).onConflictDoNothing().run();
}

export function createWorkspace(db: Db, input: { name: string } & Pick<Settings, 'locale' | 'baseCurrency'>) {
  const id = randomUUID();
  db.transaction((tx) => {
    tx.insert(workspaces).values({ id, name: input.name }).run();
    const initial: Settings = { ...DEFAULT_SETTINGS, locale: input.locale, baseCurrency: input.baseCurrency };
    tx.insert(settings)
      .values(Object.entries(initial).map(([key, value]) => ({ workspaceId: id, key, value: JSON.stringify(value) })))
      .run();
    tx.insert(categories)
      .values(
        DEFAULT_CATEGORIES.map((c) => ({
          id: randomUUID(),
          workspaceId: id,
          kind: c.kind,
          color: c.color,
          name: c.name[input.locale],
        })),
      )
      .run();
  });
  return id;
}
