import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { TRANSACTION_KINDS, transactions } from '../db/schema.js';
import { HttpError, idParam, isoDate, notFound } from '../lib/http.js';
import { getAccount } from './accounts.js';
import { getCategory } from './categories.js';
import { getMember } from './members.js';

const positive = z.number().int().positive();

const transactionInput = z.object({
  kind: z.enum(TRANSACTION_KINDS),
  date: isoDate,
  accountId: z.string().uuid(),
  amount: positive,
  categoryId: z.string().uuid().nullish(),
  toAccountId: z.string().uuid().nullish(),
  toAmount: positive.nullish(),
  note: z.string().max(1000).default(''),
  memberId: z.string().uuid().nullish(),
});

type TransactionInput = z.infer<typeof transactionInput>;

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  kind: z.enum(TRANSACTION_KINDS).optional(),
  memberId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Checks references belong to the workspace and the shape fits the kind.
function normalize(db: Db, workspaceId: string, input: TransactionInput) {
  const account = getAccount(db, workspaceId, input.accountId);
  if (input.memberId) getMember(db, workspaceId, input.memberId);
  input = { ...input, memberId: input.memberId ?? null };
  if (input.kind === 'transfer') {
    if (!input.toAccountId) throw new HttpError(400, 'transfer_target_required');
    if (input.toAccountId === input.accountId) throw new HttpError(400, 'transfer_same_account');
    const target = getAccount(db, workspaceId, input.toAccountId);
    let toAmount = input.toAmount ?? null;
    if (toAmount == null) {
      if (target.currency !== account.currency) throw new HttpError(400, 'transfer_amount_required');
      toAmount = input.amount;
    }
    return { ...input, categoryId: null, toAccountId: target.id, toAmount };
  }
  if (input.categoryId) {
    const category = getCategory(db, workspaceId, input.categoryId);
    if (category.kind !== input.kind) throw new HttpError(400, 'category_kind_mismatch');
  }
  return { ...input, categoryId: input.categoryId ?? null, toAccountId: null, toAmount: null };
}

function getTransaction(db: Db, workspaceId: string, id: string) {
  const tx = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
    .get();
  if (!tx) throw notFound('Transaction');
  return tx;
}

export async function transactionRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/transactions', async (req) => {
    const q = listQuery.parse(req.query);
    const filters: (SQL | undefined)[] = [eq(transactions.workspaceId, req.workspaceId)];
    if (q.from) filters.push(gte(transactions.date, q.from));
    if (q.to) filters.push(lte(transactions.date, q.to));
    if (q.accountId) filters.push(or(eq(transactions.accountId, q.accountId), eq(transactions.toAccountId, q.accountId)));
    if (q.categoryId) filters.push(eq(transactions.categoryId, q.categoryId));
    if (q.kind) filters.push(eq(transactions.kind, q.kind));
    if (q.memberId) filters.push(eq(transactions.memberId, q.memberId));
    if (q.q) filters.push(like(transactions.note, `%${q.q.replace(/[%_]/g, '')}%`));
    const where = and(...filters);

    const items = vault.db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all();
    const total = vault.db.select({ n: sql<number>`count(*)` }).from(transactions).where(where).get()?.n ?? 0;
    return { items, total };
  });

  app.post('/transactions', async (req, reply) => {
    const body = normalize(vault.db, req.workspaceId, transactionInput.parse(req.body));
    const tx = vault.db
      .insert(transactions)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
    reply.code(201);
    return tx;
  });

  app.put('/transactions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const current = getTransaction(vault.db, req.workspaceId, id);
    const merged = transactionInput.parse({ ...current, ...(req.body as object) });
    const body = normalize(vault.db, req.workspaceId, merged);
    return vault.db
      .update(transactions)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(transactions.id, id))
      .returning()
      .get();
  });

  app.delete('/transactions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getTransaction(vault.db, req.workspaceId, id);
    vault.db.delete(transactions).where(eq(transactions.id, id)).run();
    reply.code(204);
  });
}
