import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currencies, workspaces } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { readSettings, settingsSchema, writeSettings } from '../lib/settings.js';

export async function settingsRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.get('/settings', async (req) => {
    const ws = vault.db.select().from(workspaces).where(eq(workspaces.id, req.workspaceId)).get();
    return { workspaceName: ws?.name ?? '', ...readSettings(vault.db, req.workspaceId) };
  });

  app.put('/settings', async (req) => {
    const body = settingsSchema
      .partial()
      .extend({ workspaceName: z.string().trim().min(1).max(100).optional() })
      .parse(req.body);
    const { workspaceName, ...patch } = body;
    if (patch.baseCurrency) {
      const known = vault.db.select().from(currencies).where(eq(currencies.code, patch.baseCurrency)).get();
      if (!known) throw new HttpError(400, 'unknown_currency');
    }
    if (workspaceName) {
      vault.db.update(workspaces).set({ name: workspaceName }).where(eq(workspaces.id, req.workspaceId)).run();
    }
    writeSettings(vault.db, req.workspaceId, patch);
    const ws = vault.db.select().from(workspaces).where(eq(workspaces.id, req.workspaceId)).get();
    return { workspaceName: ws?.name ?? '', ...readSettings(vault.db, req.workspaceId) };
  });

  app.get('/currencies', async () => vault.db.select().from(currencies).orderBy(currencies.code).all());
}
