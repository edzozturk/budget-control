import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { WrongPasswordError } from './db/index.js';
import { Vault } from './lib/vault.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { categoryRoutes } from './routes/categories.js';
import { loanRoutes } from './routes/loans.js';
import { memberRoutes } from './routes/members.js';
import { settingsRoutes } from './routes/settings.js';
import { summaryRoutes } from './routes/summary.js';
import { transactionRoutes } from './routes/transactions.js';
import { upcomingRoutes } from './routes/upcoming.js';
import { HttpError, SESSION_COOKIE } from './lib/http.js';

declare module 'fastify' {
  interface FastifyInstance {
    vault: Vault;
    config: Config;
    requireSession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    workspaceId: string;
  }
}

const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

export async function buildApp(config: Config, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  const vault = new Vault(config);

  app.decorate('vault', vault);
  app.decorate('config', config);
  app.decorateRequest('workspaceId', '');
  app.addHook('onClose', async () => vault.dispose());

  await app.register(cookie);

  app.decorate('requireSession', async (req: FastifyRequest, reply: FastifyReply) => {
    const session = vault.touch(req.cookies[SESSION_COOKIE]);
    if (!session) {
      reply.code(401).send({ error: 'locked' });
      return;
    }
    req.workspaceId = session.workspaceId;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    if (err instanceof WrongPasswordError) {
      return reply.code(401).send({ error: 'wrong_password' });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'internal' : 'bad_request', message: (err as Error).message });
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(async (secured) => {
        secured.addHook('preHandler', app.requireSession);
        await secured.register(settingsRoutes);
        await secured.register(accountRoutes);
        await secured.register(categoryRoutes);
        await secured.register(transactionRoutes);
        await secured.register(summaryRoutes);
        await secured.register(memberRoutes);
        await secured.register(loanRoutes);
        await secured.register(cardRoutes);
        await secured.register(upcomingRoutes);
      });
    },
    { prefix: '/api' },
  );

  // Serve the built web app from the same port, so a single process is the whole product.
  const webDist = path.resolve(config.WEB_DIST ?? DEFAULT_WEB_DIST);
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
