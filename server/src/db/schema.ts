import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// 'overdraft' is a bank overdraft account (KMH): its balance goes negative up to creditLimit.
export const ACCOUNT_TYPES = ['bank', 'cash', 'credit_card', 'overdraft', 'savings', 'other'] as const;

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
    // Credit cards and overdrafts: spending limit (minor units) and monthly interest rate (percent).
    creditLimit: integer('credit_limit'),
    interestRate: real('interest_rate'),
    // Credit cards: statement cut-off day, payment due day, last four digits (never the full number).
    statementDay: integer('statement_day'),
    dueDay: integer('due_day'),
    last4: text('last4'),
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
    // Family member the transaction belongs to (optional).
    memberId: text('member_id').references(() => members.id),
    ...timestamps,
  },
  (t) => [
    index('transactions_workspace_date_idx').on(t.workspaceId, t.date),
    index('transactions_account_idx').on(t.accountId),
    index('transactions_to_account_idx').on(t.toAccountId),
    index('transactions_category_idx').on(t.categoryId),
  ],
);

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index('members_workspace_idx').on(t.workspaceId)],
);

// A loan repaid in equal monthly installments. The schedule lives in loan_installments.
export const loans = sqliteTable(
  'loans',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    lender: text('lender').notNull().default(''),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    principal: integer('principal').notNull(),
    installmentAmount: integer('installment_amount').notNull(),
    installmentCount: integer('installment_count').notNull(),
    firstDueDate: text('first_due_date').notNull(),
    // Default account installments are paid from, and the expense category they are booked under.
    accountId: text('account_id').references(() => accounts.id),
    categoryId: text('category_id').references(() => categories.id),
    memberId: text('member_id').references(() => members.id),
    note: text('note').notNull().default(''),
    ...timestamps,
  },
  (t) => [index('loans_workspace_idx').on(t.workspaceId)],
);

export const loanInstallments = sqliteTable(
  'loan_installments',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    dueDate: text('due_date').notNull(),
    amount: integer('amount').notNull(),
    // Set when paid; the payment is also recorded as an expense transaction.
    paidDate: text('paid_date'),
    transactionId: text('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('loan_installments_loan_number_idx').on(t.loanId, t.number), index('loan_installments_due_idx').on(t.dueDate)],
);

// One credit card statement (ekstre): what is owed for a period and what has been paid.
export const cardStatements = sqliteTable(
  'card_statements',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    statementDate: text('statement_date').notNull(),
    dueDate: text('due_date').notNull(),
    amount: integer('amount').notNull(),
    minimumPayment: integer('minimum_payment').notNull().default(0),
    interest: integer('interest').notNull().default(0),
    paidAmount: integer('paid_amount').notNull().default(0),
    note: text('note').notNull().default(''),
    ...timestamps,
  },
  (t) => [index('card_statements_account_idx').on(t.accountId, t.dueDate)],
);
