import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Conventions (kept portable so the same model can move to PostgreSQL):
// - ids are UUID strings
// - money is an integer in the currency's minor unit (kuruş, cent); see currencies.decimals
// - dates are ISO strings: 'YYYY-MM-DD' for business dates, full ISO for timestamps
// - every user-owned row carries workspace_id so one install can serve many customers

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
};

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ...timestamps,
});

export const settings = sqliteTable(
  'settings',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);

export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  decimals: integer('decimals').notNull().default(2),
});

export const ACCOUNT_TYPES = ['bank', 'cash', 'credit_card', 'savings', 'other'] as const;

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    openingBalance: integer('opening_balance').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index('accounts_workspace_idx').on(t.workspaceId)],
);

export const CATEGORY_KINDS = ['income', 'expense'] as const;

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: CATEGORY_KINDS }).notNull(),
    color: text('color').notNull().default('#64748b'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index('categories_workspace_idx').on(t.workspaceId)],
);

export const TRANSACTION_KINDS = ['income', 'expense', 'transfer'] as const;

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    kind: text('kind', { enum: TRANSACTION_KINDS }).notNull(),
    date: text('date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    // Always positive, in the account's currency. The kind decides the sign.
    amount: integer('amount').notNull(),
    categoryId: text('category_id').references(() => categories.id),
    // Transfers only: the receiving account and the amount it receives (its own currency).
    toAccountId: text('to_account_id').references(() => accounts.id),
    toAmount: integer('to_amount'),
    note: text('note').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    index('transactions_workspace_date_idx').on(t.workspaceId, t.date),
    index('transactions_account_idx').on(t.accountId),
    index('transactions_to_account_idx').on(t.toAccountId),
    index('transactions_category_idx').on(t.categoryId),
  ],
);
