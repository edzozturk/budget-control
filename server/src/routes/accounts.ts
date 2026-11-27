import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { ACCOUNT_TYPES, accounts, currencies, importLines, imports, transactions } from '../db/schema.js';
import { BANKS, ibanBankCode, normalizeIban, validIban } from '../lib/banks.js';
import { currencyCode, HttpError, idParam, isoDate, minorAmount, notFound, parsePatch } from '../lib/http.js';
import { getMember } from './members.js';

const accountInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyCode,
  openingBalance: minorAmount.default(0),
  archived: z.boolean().default(false),
  creditLimit: z.number().int().min(0).nullish(),
  interestRate: z.number().min(0).max(100).nullish(),
  statementDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  last4: z
    .string()
    .regex(/^\d{4}$/, 'Only the last 4 digits')
    .nullish(),
  bankCode: z
    .string()
    .regex(/^\d{5}$/)
    .nullish(),
  branchName: optionalText(100),
  branchCode: optionalText(20),
  accountNumber: optionalText(40),
  accountSuffix: optionalText(20),
  iban: z
    .string()
    .transform(normalizeIban)
    .refine((v) => v === '' || validIban(v), 'Invalid IBAN')
    .transform((v) => v || null)
    .nullish(),
  customerNumber: optionalText(40),
  ownerMemberId: z.string().uuid().nullish(),
  joint: z.boolean().optional(),
  openedOn: isoDate.nullish(),
  closedOn: isoDate.nullish(),
  interestDay: z.number().int().min(1).max(31).nullish(),
  termStart: isoDate.nullish(),
  termEnd: isoDate.nullish(),
  autoRenew: z.boolean().optional(),
  note: optionalText(1000),
});

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();
}

// Balance = opening balance + income - expense - transfers out + transfers in.
function balances(db: Db, workspaceId: string) {
  const rows = db.all<{ id: string; balance: number }>(sql`
    SELECT a.id,
      a.opening_balance
      + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
                  FROM transactions t WHERE t.account_id = a.id), 0)
      + COALESCE((SELECT SUM(t.to_amount) FROM transactions t
                  WHERE t.to_account_id = a.id AND t.kind = 'transfer'), 0) AS balance
    FROM accounts a WHERE a.workspace_id = ${workspaceId}`);
  return new Map(rows.map((r) => [r.id, r.balance]));
}

export function getAccount(db: Db, workspaceId: string, id: string) {
  const account = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId)))
    .get();
  if (!account) throw notFound('Account');
  return account;
}

export async function accountRoutes(app: FastifyInstance) {
  const { vault } = app;

  const assertCurrency = (code: string) => {
    if (!vault.db.select().from(currencies).where(eq(currencies.code, code)).get()) {
      throw new HttpError(400, 'unknown_currency');
    }
  };

  const withBalance = (workspaceId: string, account: typeof accounts.$inferSelect) => ({
    ...account,
    balance: balances(vault.db, workspaceId).get(account.id) ?? account.openingBalance,
  });

  // The bank's side of an account: the IBAN names the bank, the member must be in this workspace.
  const checkDetails = (workspaceId: string, body: Partial<z.infer<typeof accountInput>>) => {
    if (body.iban && !body.bankCode) body.bankCode = ibanBankCode(body.iban) ?? body.bankCode;
    if (body.ownerMemberId) getMember(vault.db, workspaceId, body.ownerMemberId);
    if (body.closedOn && body.archived === undefined) body.archived = true;
  };

  app.get('/banks', async () => BANKS.map(({ code, name }) => ({ code, name })));

  app.get('/accounts', async (req) => {
    const bal = balances(vault.db, req.workspaceId);
    return vault.db
      .select()
      .from(accounts)
      .where(eq(accounts.workspaceId, req.workspaceId))
      .orderBy(accounts.archived, accounts.name)
      .all()
      .map((a) => ({ ...a, balance: bal.get(a.id) ?? a.openingBalance }));
  });

  app.post('/accounts', async (req, reply) => {
    const body = accountInput.parse(req.body);
    assertCurrency(body.currency);
    checkDetails(req.workspaceId, body);
    const account = vault.db
      .insert(accounts)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
    reply.code(201);
    return withBalance(req.workspaceId, account);
  });

  app.put('/accounts/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = parsePatch(accountInput, req.body);
    const current = getAccount(vault.db, req.workspaceId, id);
    checkDetails(req.workspaceId, body);
    if (body.currency && body.currency !== current.currency) {
      assertCurrency(body.currency);
      const used = vault.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)))
        .get();
      if (used) throw new HttpError(409, 'currency_locked', 'Account has transactions; its currency cannot change');
    }
    const account = vault.db
      .update(accounts)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .returning()
      .get();
    return withBalance(req.workspaceId, account);
  });

  app.delete('/accounts/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getAccount(vault.db, req.workspaceId, id);
    const used = vault.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)))
      .get();
    if (used) throw new HttpError(409, 'in_use', 'Account has transactions; archive it instead');
    vault.db.transaction((tx) => {
      tx.delete(importLines).where(eq(importLines.accountId, id)).run();
      tx.delete(imports).where(eq(imports.accountId, id)).run();
      tx.delete(accounts).where(eq(accounts.id, id)).run();
    });
    reply.code(204);
  });
}
