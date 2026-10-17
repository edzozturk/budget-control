import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDate } from '../lib/http.js';

const query = z.object({ from: isoDate, to: isoDate });

// Income and expense totals for a period, per currency and per category.
// Amounts stay in their own currency; conversion to the base currency arrives with exchange rates.
export async function summaryRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/summary', async (req) => {
    const { from, to } = query.parse(req.query);
    const totals = vault.db.all<{ currency: string; kind: 'income' | 'expense'; total: number; count: number }>(sql`
      SELECT a.currency, t.kind, SUM(t.amount) AS total, COUNT(*) AS count
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.workspace_id = ${req.workspaceId} AND t.kind IN ('income', 'expense')
        AND t.date >= ${from} AND t.date <= ${to}
      GROUP BY a.currency, t.kind`);
    const byCategory = vault.db.all<{
      categoryId: string | null;
      currency: string;
      kind: 'income' | 'expense';
      total: number;
    }>(sql`
      SELECT t.category_id AS categoryId, a.currency, t.kind, SUM(t.amount) AS total
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.workspace_id = ${req.workspaceId} AND t.kind IN ('income', 'expense')
        AND t.date >= ${from} AND t.date <= ${to}
      GROUP BY t.category_id, a.currency, t.kind
      ORDER BY total DESC`);

    const perCurrency: Record<string, { income: number; expense: number; net: number }> = {};
    for (const row of totals) {
      const c = (perCurrency[row.currency] ??= { income: 0, expense: 0, net: 0 });
      c[row.kind] = row.total;
      c.net = c.income - c.expense;
    }
    return { from, to, totals: perCurrency, byCategory };
  });
}
