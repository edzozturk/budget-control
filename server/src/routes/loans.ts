import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { currencies, loanInstallments, loans, transactions } from '../db/schema.js';
import { addMonths, todayIso } from '../lib/dates.js';
import { currencyCode, HttpError, idParam, isoDate, notFound } from '../lib/http.js';
import { getAccount } from './accounts.js';
import { getCategory } from './categories.js';
import { getMember } from './members.js';

const positive = z.number().int().positive();
const optionalId = z.string().uuid().nullish();

const loanInput = z.object({
  name: z.string().trim().min(1).max(100),
  lender: z.string().trim().max(100).default(''),
  currency: currencyCode,
  principal: positive,
  installmentAmount: positive,
  installmentCount: z.number().int().min(1).max(600),
  firstDueDate: isoDate,
  // For loans that started before tracking: the first N installments are marked paid (no transactions created).
  paidInstallments: z.number().int().min(0).default(0),
  accountId: optionalId,
  categoryId: optionalId,
  memberId: optionalId,
  note: z.string().max(1000).default(''),
});

const loanUpdate = loanInput
  .pick({ name: true, lender: true, accountId: true, categoryId: true, memberId: true, note: true })
  .partial();

const installmentUpdate = z.object({ dueDate: isoDate.optional(), amount: positive.optional() });
const payInput = z.object({ date: isoDate.optional(), accountId: z.string().uuid().optional() });
const installmentParams = z.object({ id: z.string().uuid(), number: z.coerce.number().int().min(1) });

type LoanRow = typeof loans.$inferSelect;
type InstallmentRow = typeof loanInstallments.$inferSelect;

function checkRefs(db: Db, workspaceId: string, input: { accountId?: string | null; categoryId?: string | null; memberId?: string | null }) {
  if (input.accountId) getAccount(db, workspaceId, input.accountId);
  if (input.categoryId && getCategory(db, workspaceId, input.categoryId).kind !== 'expense') {
    throw new HttpError(400, 'category_kind_mismatch');
  }
  if (input.memberId) getMember(db, workspaceId, input.memberId);
}

function getLoan(db: Db, workspaceId: string, id: string) {
  const loan = db
    .select()
    .from(loans)
    .where(and(eq(loans.id, id), eq(loans.workspaceId, workspaceId)))
    .get();
  if (!loan) throw notFound('Loan');
  return loan;
}

function describe(loan: LoanRow, schedule: InstallmentRow[], today = todayIso()) {
  const paid = schedule.filter((i) => i.paidDate);
  const unpaid = schedule.filter((i) => !i.paidDate);
  const next = unpaid[0] ?? null;
  return {
    ...loan,
    paidCount: paid.length,
    paidTotal: paid.reduce((s, i) => s + i.amount, 0),
    remainingTotal: unpaid.reduce((s, i) => s + i.amount, 0),
    totalRepayment: schedule.reduce((s, i) => s + i.amount, 0),
    nextInstallment: next,
    overdueCount: unpaid.filter((i) => i.dueDate < today).length,
    lastDueDate: schedule.at(-1)?.dueDate ?? loan.firstDueDate,
    finished: unpaid.length === 0,
  };
}

function scheduleOf(db: Db, loanIds: string[]) {
  if (loanIds.length === 0) return new Map<string, InstallmentRow[]>();
  const rows = db
    .select()
    .from(loanInstallments)
    .where(inArray(loanInstallments.loanId, loanIds))
    .orderBy(asc(loanInstallments.number))
    .all();
  const map = new Map<string, InstallmentRow[]>();
  for (const r of rows) map.set(r.loanId, [...(map.get(r.loanId) ?? []), r]);
  return map;
}

export async function loanRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/loans', async (req) => {
    const rows = vault.db.select().from(loans).where(eq(loans.workspaceId, req.workspaceId)).orderBy(asc(loans.firstDueDate)).all();
    const schedules = scheduleOf(
      vault.db,
      rows.map((l) => l.id),
    );
    return rows.map((l) => describe(l, schedules.get(l.id) ?? []));
  });

  app.get('/loans/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const loan = getLoan(vault.db, req.workspaceId, id);
    const schedule = scheduleOf(vault.db, [id]).get(id) ?? [];
    return { ...describe(loan, schedule), installments: schedule };
  });

  app.post('/loans', async (req, reply) => {
    const { paidInstallments, ...body } = loanInput.parse(req.body);
    if (paidInstallments > body.installmentCount) throw new HttpError(400, 'too_many_paid');
    if (!vault.db.select().from(currencies).where(eq(currencies.code, body.currency)).get()) {
      throw new HttpError(400, 'unknown_currency');
    }
    checkRefs(vault.db, req.workspaceId, body);
    const id = randomUUID();
    vault.db.transaction((tx) => {
      tx.insert(loans)
        .values({ id, workspaceId: req.workspaceId, ...body })
        .run();
      tx.insert(loanInstallments)
        .values(
          Array.from({ length: body.installmentCount }, (_, i) => {
            const dueDate = addMonths(body.firstDueDate, i);
            return {
              id: randomUUID(),
              loanId: id,
              number: i + 1,
              dueDate,
              amount: body.installmentAmount,
              paidDate: i < paidInstallments ? dueDate : null,
            };
          }),
        )
        .run();
    });
    reply.code(201);
    const schedule = scheduleOf(vault.db, [id]).get(id) ?? [];
    return { ...describe(getLoan(vault.db, req.workspaceId, id), schedule), installments: schedule };
  });

  app.put('/loans/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    getLoan(vault.db, req.workspaceId, id);
    const body = loanUpdate.parse(req.body);
    checkRefs(vault.db, req.workspaceId, body);
    vault.db
      .update(loans)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(loans.id, id))
      .run();
    const schedule = scheduleOf(vault.db, [id]).get(id) ?? [];
    return { ...describe(getLoan(vault.db, req.workspaceId, id), schedule), installments: schedule };
  });

  // Deleting a loan keeps the expense transactions of installments already paid.
  app.delete('/loans/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getLoan(vault.db, req.workspaceId, id);
    vault.db.transaction((tx) => {
      tx.delete(loanInstallments).where(eq(loanInstallments.loanId, id)).run();
      tx.delete(loans).where(eq(loans.id, id)).run();
    });
    reply.code(204);
  });

  const getInstallment = (loanId: string, number: number) => {
    const row = vault.db
      .select()
      .from(loanInstallments)
      .where(and(eq(loanInstallments.loanId, loanId), eq(loanInstallments.number, number)))
      .get();
    if (!row) throw notFound('Installment');
    return row;
  };

  app.put('/loans/:id/installments/:number', async (req) => {
    const { id, number } = installmentParams.parse(req.params);
    getLoan(vault.db, req.workspaceId, id);
    const inst = getInstallment(id, number);
    const body = installmentUpdate.parse(req.body);
    if (inst.paidDate && body.amount && body.amount !== inst.amount) throw new HttpError(409, 'installment_paid');
    return vault.db.update(loanInstallments).set(body).where(eq(loanInstallments.id, inst.id)).returning().get();
  });

  // Pays one installment: records an expense on the paying account and marks it paid.
  app.post('/loans/:id/installments/:number/pay', async (req) => {
    const { id, number } = installmentParams.parse(req.params);
    const loan = getLoan(vault.db, req.workspaceId, id);
    const inst = getInstallment(id, number);
    if (inst.paidDate) throw new HttpError(409, 'already_paid');
    const body = payInput.parse(req.body ?? {});
    const accountId = body.accountId ?? loan.accountId;
    if (!accountId) throw new HttpError(400, 'account_required');
    const account = getAccount(vault.db, req.workspaceId, accountId);
    if (account.currency !== loan.currency) throw new HttpError(400, 'currency_mismatch');
    const date = body.date ?? todayIso();
    return vault.db.transaction((tx) => {
      const t = tx
        .insert(transactions)
        .values({
          id: randomUUID(),
          workspaceId: req.workspaceId,
          kind: 'expense',
          date,
          accountId,
          amount: inst.amount,
          categoryId: loan.categoryId,
          memberId: loan.memberId,
          note: `${loan.name} ${inst.number}/${loan.installmentCount}`,
        })
        .returning()
        .get();
      return tx
        .update(loanInstallments)
        .set({ paidDate: date, transactionId: t.id })
        .where(eq(loanInstallments.id, inst.id))
        .returning()
        .get();
    });
  });

  // Undo a payment: removes the transaction it created.
  app.post('/loans/:id/installments/:number/unpay', async (req) => {
    const { id, number } = installmentParams.parse(req.params);
    getLoan(vault.db, req.workspaceId, id);
    const inst = getInstallment(id, number);
    return vault.db.transaction((tx) => {
      if (inst.transactionId) tx.delete(transactions).where(eq(transactions.id, inst.transactionId)).run();
      return tx
        .update(loanInstallments)
        .set({ paidDate: null, transactionId: null })
        .where(eq(loanInstallments.id, inst.id))
        .returning()
        .get();
    });
  });
}
