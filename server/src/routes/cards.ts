import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { cardStatements, transactions } from '../db/schema.js';
import { addMonths, todayIso } from '../lib/dates.js';
import { HttpError, idParam, isoDate, notFound } from '../lib/http.js';
import { getAccount } from './accounts.js';

const nonNegative = z.number().int().min(0);

const statementInput = z.object({
  accountId: z.string().uuid(),
  statementDate: isoDate,
  dueDate: isoDate,
  amount: nonNegative,
  minimumPayment: nonNegative.default(0),
  interest: nonNegative.default(0),
  paidAmount: nonNegative.default(0),
  note: z.string().max(1000).default(''),
});

const payInput = z.object({
  fromAccountId: z.string().uuid(),
  amount: z.number().int().positive(),
  // Amount leaving the paying account, when its currency differs from the card's.
  fromAmount: z.number().int().positive().optional(),
  date: isoDate.optional(),
});

function getCard(db: Db, workspaceId: string, id: string) {
  const account = getAccount(db, workspaceId, id);
  if (account.type !== 'credit_card') throw new HttpError(400, 'not_a_card');
  return account;
}

function getStatement(db: Db, workspaceId: string, id: string) {
  const row = db
    .select()
    .from(cardStatements)
    .where(and(eq(cardStatements.id, id), eq(cardStatements.workspaceId, workspaceId)))
    .get();
  if (!row) throw notFound('Statement');
  return row;
}

export function statementStatus(s: typeof cardStatements.$inferSelect, today = todayIso()) {
  const remaining = Math.max(0, s.amount - s.paidAmount);
  const status =
    remaining === 0 ? 'paid' : s.paidAmount >= s.minimumPayment && s.paidAmount > 0 ? 'minimum_paid' : s.dueDate < today ? 'overdue' : 'open';
  return { ...s, remaining, status };
}

// Credit card statements (ekstre): amount due, minimum, interest and payments made.
export async function cardRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/card-statements', async (req) => {
    const q = z.object({ accountId: z.string().uuid().optional() }).parse(req.query);
    const where = q.accountId
      ? and(eq(cardStatements.workspaceId, req.workspaceId), eq(cardStatements.accountId, q.accountId))
      : eq(cardStatements.workspaceId, req.workspaceId);
    return vault.db
      .select()
      .from(cardStatements)
      .where(where)
      .orderBy(desc(cardStatements.dueDate))
      .all()
      .map((s) => statementStatus(s));
  });

  // Suggested dates for the next statement of a card, from its cut-off and due days.
  app.get('/cards/:id/next-statement', async (req) => {
    const { id } = idParam.parse(req.params);
    const card = getCard(vault.db, req.workspaceId, id);
    const last = vault.db
      .select()
      .from(cardStatements)
      .where(eq(cardStatements.accountId, id))
      .orderBy(desc(cardStatements.statementDate))
      .get();
    const today = todayIso();
    const base = last ? addMonths(last.statementDate, 1) : today;
    const statementDate = card.statementDay ? addMonths(base, 0, card.statementDay) : base;
    let dueDate = card.dueDay ? addMonths(statementDate, 0, card.dueDay) : addMonths(statementDate, 0);
    if (dueDate <= statementDate) dueDate = addMonths(dueDate, 1, card.dueDay ?? undefined);
    return { statementDate, dueDate };
  });

  app.post('/card-statements', async (req, reply) => {
    const body = statementInput.parse(req.body);
    getCard(vault.db, req.workspaceId, body.accountId);
    if (body.dueDate < body.statementDate) throw new HttpError(400, 'due_before_statement');
    reply.code(201);
    const row = vault.db
      .insert(cardStatements)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
    return statementStatus(row);
  });

  app.put('/card-statements/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    getStatement(vault.db, req.workspaceId, id);
    const body = statementInput.omit({ accountId: true }).partial().parse(req.body);
    const row = vault.db
      .update(cardStatements)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(cardStatements.id, id))
      .returning()
      .get();
    return statementStatus(row);
  });

  app.delete('/card-statements/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getStatement(vault.db, req.workspaceId, id);
    vault.db.delete(cardStatements).where(eq(cardStatements.id, id)).run();
    reply.code(204);
  });

  // Pays (part of) a statement: a transfer from the paying account to the card.
  app.post('/card-statements/:id/pay', async (req) => {
    const { id } = idParam.parse(req.params);
    const statement = getStatement(vault.db, req.workspaceId, id);
    const card = getCard(vault.db, req.workspaceId, statement.accountId);
    const body = payInput.parse(req.body);
    const from = getAccount(vault.db, req.workspaceId, body.fromAccountId);
    if (from.id === card.id) throw new HttpError(400, 'transfer_same_account');
    if (from.currency !== card.currency && !body.fromAmount) throw new HttpError(400, 'transfer_amount_required');
    return vault.db.transaction((tx) => {
      tx.insert(transactions)
        .values({
          id: randomUUID(),
          workspaceId: req.workspaceId,
          kind: 'transfer',
          date: body.date ?? todayIso(),
          accountId: from.id,
          amount: from.currency === card.currency ? body.amount : body.fromAmount!,
          toAccountId: card.id,
          toAmount: body.amount,
          note: `${card.name} ${statement.statementDate}`,
        })
        .run();
      const row = tx
        .update(cardStatements)
        .set({ paidAmount: statement.paidAmount + body.amount, updatedAt: new Date().toISOString() })
        .where(eq(cardStatements.id, id))
        .returning()
        .get();
      return statementStatus(row);
    });
  });
}
