import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accounts, cardStatements, loanInstallments, loans } from '../db/schema.js';
import { addDays, addMonths, nextDayOfMonth, todayIso } from '../lib/dates.js';
import { statementStatus } from './cards.js';

// Payments coming due (and overdue): loan installments, unpaid card statements,
// and cards whose latest statement has not been entered yet.
export async function upcomingRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/upcoming', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(366).default(45) }).parse(req.query);
    const today = todayIso();
    const until = addDays(today, days);

    const installments = vault.db
      .select({ inst: loanInstallments, loan: loans })
      .from(loanInstallments)
      .innerJoin(loans, eq(loans.id, loanInstallments.loanId))
      .where(and(eq(loans.workspaceId, req.workspaceId), isNull(loanInstallments.paidDate), lte(loanInstallments.dueDate, until)))
      .orderBy(asc(loanInstallments.dueDate))
      .all()
      .map(({ inst, loan }) => ({
        type: 'loan' as const,
        id: inst.id,
        loanId: loan.id,
        name: loan.name,
        number: inst.number,
        count: loan.installmentCount,
        dueDate: inst.dueDate,
        amount: inst.amount,
        currency: loan.currency,
        overdue: inst.dueDate < today,
      }));

    const cards = vault.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.workspaceId, req.workspaceId), eq(accounts.type, 'credit_card'), eq(accounts.archived, false)))
      .all();
    const cardById = new Map(cards.map((c) => [c.id, c]));

    const statements = vault.db
      .select()
      .from(cardStatements)
      .where(eq(cardStatements.workspaceId, req.workspaceId))
      .orderBy(asc(cardStatements.dueDate))
      .all();

    const open = statements
      .map((s) => statementStatus(s, today))
      .filter((s) => s.remaining > 0 && s.dueDate <= until && cardById.has(s.accountId))
      .map((s) => ({
        type: 'card' as const,
        id: s.id,
        accountId: s.accountId,
        name: cardById.get(s.accountId)!.name,
        dueDate: s.dueDate,
        amount: s.remaining,
        minimumPayment: Math.max(0, s.minimumPayment - s.paidAmount),
        currency: cardById.get(s.accountId)!.currency,
        status: s.status,
        overdue: s.dueDate < today,
      }));

    // A card is missing a statement when its most recent cut-off day has passed with no statement on or after it.
    const missing = cards
      .filter((c) => c.statementDay)
      .flatMap((c) => {
        const next = nextDayOfMonth(today, c.statementDay!);
        const lastCutoff = next === today ? today : addMonths(next, -1, c.statementDay!);
        const has = statements.some((s) => s.accountId === c.id && s.statementDate >= addDays(lastCutoff, -3));
        return has ? [] : [{ type: 'card_missing' as const, id: c.id, accountId: c.id, name: c.name, statementDate: lastCutoff }];
      });

    return {
      today,
      until,
      items: [...installments, ...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      missingStatements: missing,
    };
  });
}
