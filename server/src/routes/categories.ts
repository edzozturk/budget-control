import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { CATEGORY_KINDS, categories, transactions } from '../db/schema.js';
import { HttpError, idParam, notFound } from '../lib/http.js';

const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(CATEGORY_KINDS),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#64748b'),
  archived: z.boolean().default(false),
});

export function getCategory(db: Db, workspaceId: string, id: string) {
  const category = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.workspaceId, workspaceId)))
    .get();
  if (!category) throw notFound('Category');
  return category;
}

export async function categoryRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/categories', async (req) =>
    vault.db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, req.workspaceId))
      .orderBy(categories.kind, categories.archived, categories.name)
      .all(),
  );

  app.post('/categories', async (req, reply) => {
    const body = categoryInput.parse(req.body);
    const category = vault.db
      .insert(categories)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
    reply.code(201);
    return category;
  });

  app.put('/categories/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = categoryInput.partial().parse(req.body);
    const current = getCategory(vault.db, req.workspaceId, id);
    if (body.kind && body.kind !== current.kind) {
      const used = vault.db.select({ id: transactions.id }).from(transactions).where(eq(transactions.categoryId, id)).get();
      if (used) throw new HttpError(409, 'kind_locked', 'Category has transactions; its kind cannot change');
    }
    return vault.db
      .update(categories)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(categories.id, id))
      .returning()
      .get();
  });

  app.delete('/categories/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getCategory(vault.db, req.workspaceId, id);
    const used = vault.db.select({ id: transactions.id }).from(transactions).where(eq(transactions.categoryId, id)).get();
    if (used) throw new HttpError(409, 'in_use', 'Category has transactions; archive it instead');
    vault.db.delete(categories).where(eq(categories.id, id)).run();
    reply.code(204);
  });
}
