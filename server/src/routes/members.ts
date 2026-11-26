import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { loans, members, transactions } from '../db/schema.js';
import { HttpError, idParam, notFound } from '../lib/http.js';

const memberInput = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#64748b'),
  archived: z.boolean().default(false),
});

export function getMember(db: Db, workspaceId: string, id: string) {
  const member = db
    .select()
    .from(members)
    .where(and(eq(members.id, id), eq(members.workspaceId, workspaceId)))
    .get();
  if (!member) throw notFound('Member');
  return member;
}

// Family members (or anyone a transaction belongs to), for per-person reports.
export async function memberRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/members', async (req) =>
    vault.db.select().from(members).where(eq(members.workspaceId, req.workspaceId)).orderBy(members.archived, members.name).all(),
  );

  app.post('/members', async (req, reply) => {
    const body = memberInput.parse(req.body);
    reply.code(201);
    return vault.db
      .insert(members)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
  });

  app.put('/members/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    getMember(vault.db, req.workspaceId, id);
    const body = memberInput.partial().parse(req.body);
    return vault.db
      .update(members)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(members.id, id))
      .returning()
      .get();
  });

  app.delete('/members/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getMember(vault.db, req.workspaceId, id);
    const used =
      vault.db.select({ id: transactions.id }).from(transactions).where(eq(transactions.memberId, id)).get() ??
      vault.db.select({ id: loans.id }).from(loans).where(eq(loans.memberId, id)).get();
    if (used) throw new HttpError(409, 'in_use', 'Member is in use; archive instead');
    vault.db.delete(members).where(eq(members.id, id)).run();
    reply.code(204);
  });
}
