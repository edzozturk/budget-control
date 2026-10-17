import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { currencyCode, HttpError, SESSION_COOKIE } from '../lib/http.js';

const password = z.string().min(8, 'Password must be at least 8 characters').max(256);

export async function authRoutes(app: FastifyInstance) {
  const { vault, config } = app;

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.COOKIE_SECURE,
    });

  app.get('/status', async (req) => ({
    appName: config.APP_NAME,
    version: process.env.npm_package_version ?? '0.1.0',
    initialized: vault.initialized,
    unlocked: vault.touch(req.cookies[SESSION_COOKIE]) !== null,
    defaults: { locale: config.DEFAULT_LOCALE, currency: config.DEFAULT_CURRENCY },
  }));

  app.post('/setup', async (req, reply) => {
    const body = z
      .object({
        password,
        workspaceName: z.string().trim().min(1).max(100).default('My budget'),
        locale: z.enum(['tr', 'en']).default(config.DEFAULT_LOCALE),
        baseCurrency: currencyCode.default(config.DEFAULT_CURRENCY),
      })
      .parse(req.body);
    if (vault.initialized) throw new HttpError(409, 'already_initialized');
    const token = vault.setup(body);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/unlock', async (req, reply) => {
    const body = z.object({ password: z.string().min(1) }).parse(req.body);
    if (!vault.initialized) throw new HttpError(409, 'not_initialized');
    const token = await vault.unlock(body.password);
    setCookie(reply, token);
    return { ok: true };
  });

  app.post('/lock', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) vault.endSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/change-password', { preHandler: app.requireSession }, async (req) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(req.body);
    vault.changePassword(body.currentPassword, body.newPassword);
    return { ok: true };
  });
}
