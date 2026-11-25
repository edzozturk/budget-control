import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDate } from '../lib/http.js';

const query = z.object({ from: isoDate, to: isoDate, by: z.enum(['costCenter', 'member', 'category']) });

const GROUP_COLUMN = {
  costCenter: sql.raw('t.cost_center_id'),
  member: sql.raw('t.member_id'),
  category: sql.raw('t.category_id'),
};

// Income and expense per group (cost centre, person or category), month, category and currency.
export async function reportRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/reports/breakdown', async (req) => {
    const { from, to, by } = query.parse(req.query);
    const rows = vault.db.all<{ groupId: string | null; month: string; categoryId: string | null; currency: string; kind: 'income' | 'expense'; total: number }>(sql`
      SELECT ${GROUP_COLUMN[by]} AS groupId, substr(t.date, 1, 7) AS month, t.category_id AS categoryId,
             a.currency, t.kind, SUM(t.amount) AS total
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.workspace_id = ${req.workspaceId} AND t.kind IN ('income', 'expense')
        AND t.date >= ${from} AND t.date <= ${to}
      GROUP BY groupId, month, t.category_id, a.currency, t.kind
      ORDER BY month`);
    return { from, to, by, rows };
  });
}
