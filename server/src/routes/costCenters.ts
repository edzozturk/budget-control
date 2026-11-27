import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { categoryRules, costCenters, transactions } from '../db/schema.js';
import { HttpError, idParam, notFound, parsePatch } from '../lib/http.js';

const costCenterInput = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#64748b'),
  archived: z.boolean().default(false),
});

export function getCostCenter(db: Db, workspaceId: string, id: string) {
  const row = db
    .select()
    .from(costCenters)
    .where(and(eq(costCenters.id, id), eq(costCenters.workspaceId, workspaceId)))
    .get();
  if (!row) throw notFound('Cost centre');
  return row;
}

// Cost centres group income and expenses reported on their own, such as a house abroad.
export async function costCenterRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/cost-centers', async (req) =>
    vault.db.select().from(costCenters).where(eq(costCenters.workspaceId, req.workspaceId)).orderBy(costCenters.archived, costCenters.name).all(),
  );

  app.post('/cost-centers', async (req, reply) => {
    const body = costCenterInput.parse(req.body);
    reply.code(201);
    return vault.db
      .insert(costCenters)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
  });

  app.put('/cost-centers/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    getCostCenter(vault.db, req.workspaceId, id);
    const body = parsePatch(costCenterInput, req.body);
    return vault.db
      .update(costCenters)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(costCenters.id, id))
      .returning()
      .get();
  });

  app.delete('/cost-centers/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getCostCenter(vault.db, req.workspaceId, id);
    if (vault.db.select({ id: transactions.id }).from(transactions).where(eq(transactions.costCenterId, id)).get()) {
      throw new HttpError(409, 'in_use', 'Cost centre is in use; archive instead');
    }
    vault.db.transaction((tx) => {
      tx.update(categoryRules).set({ costCenterId: null }).where(eq(categoryRules.costCenterId, id)).run();
      tx.delete(costCenters).where(eq(costCenters.id, id)).run();
    });
    reply.code(204);
  });
}
