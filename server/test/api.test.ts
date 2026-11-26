import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let dir: string;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

async function start() {
  app = await buildApp(loadConfig({ DATA_DIR: dir, WEB_DIST: path.join(dir, 'no-web') }));
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'budget-'));
  cookie = '';
  await start();
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const setup = () => call('POST', '/api/setup', { password: 'correct horse', locale: 'tr', baseCurrency: 'TRY' });

describe('vault', () => {
  it('creates an encrypted database and unlocks only with the right password', async () => {
    expect((await call('GET', '/api/status')).body).toMatchObject({ initialized: false, unlocked: false });
    expect((await setup()).status).toBe(200);
    expect((await call('GET', '/api/status')).body).toMatchObject({ initialized: true, unlocked: true });

    // File must not be a plain SQLite database.
    const header = readFileSync(path.join(dir, 'budget.db')).subarray(0, 16).toString('latin1');
    expect(header).not.toContain('SQLite format 3');

    await call('POST', '/api/lock');
    expect((await call('GET', '/api/accounts')).status).toBe(401);
    expect((await call('POST', '/api/unlock', { password: 'wrong password' })).body).toEqual({ error: 'wrong_password' });
    expect((await call('POST', '/api/unlock', { password: 'correct horse' })).status).toBe(200);
    expect((await call('GET', '/api/accounts')).status).toBe(200);
  });

  it('survives a restart and supports changing the password', async () => {
    await setup();
    await call('POST', '/api/change-password', { currentPassword: 'correct horse', newPassword: 'battery staple' });
    await app.close();
    cookie = '';
    await start();
    expect((await call('POST', '/api/unlock', { password: 'correct horse' })).status).toBe(401);
    expect((await call('POST', '/api/unlock', { password: 'battery staple' })).status).toBe(200);
    const categories = (await call('GET', '/api/categories')).body;
    expect(categories.some((c: { name: string }) => c.name === 'Market')).toBe(true);
  });

  it('rejects short passwords and a second setup', async () => {
    expect((await call('POST', '/api/setup', { password: 'short' })).status).toBe(400);
    await setup();
    expect((await setup()).status).toBe(409);
  });
});

describe('budget data', () => {
  beforeEach(async () => {
    await setup();
  });

  it('tracks balances across income, expense and cross-currency transfers', async () => {
    const tl = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY', openingBalance: 100000 }))
      .body;
    const usd = (await call('POST', '/api/accounts', { name: 'Dolar', type: 'savings', currency: 'USD' })).body;
    const cats = (await call('GET', '/api/categories')).body as { id: string; kind: string; name: string }[];
    const salary = cats.find((c) => c.name === 'Maaş')!;
    const market = cats.find((c) => c.name === 'Market')!;

    expect(
      (await call('POST', '/api/transactions', { kind: 'income', date: '2026-10-01', accountId: tl.id, amount: 5000000, categoryId: salary.id }))
        .status,
    ).toBe(201);
    await call('POST', '/api/transactions', { kind: 'expense', date: '2026-10-03', accountId: tl.id, amount: 125050, categoryId: market.id, note: 'Haftalık market' });
    await call('POST', '/api/transactions', { kind: 'transfer', date: '2026-10-05', accountId: tl.id, amount: 1000000, toAccountId: usd.id, toAmount: 23500 });

    const accounts = (await call('GET', '/api/accounts')).body as { id: string; balance: number }[];
    expect(accounts.find((a) => a.id === tl.id)!.balance).toBe(100000 + 5000000 - 125050 - 1000000);
    expect(accounts.find((a) => a.id === usd.id)!.balance).toBe(23500);

    const summary = (await call('GET', '/api/summary?from=2026-10-01&to=2026-10-31')).body;
    expect(summary.totals.TRY).toEqual({ income: 5000000, expense: 125050, net: 5000000 - 125050 });

    const search = (await call('GET', '/api/transactions?q=market')).body;
    expect(search.total).toBe(1);

    // Mismatched category kind and missing cross-currency amount are rejected.
    expect(
      (await call('POST', '/api/transactions', { kind: 'expense', date: '2026-10-06', accountId: tl.id, amount: 100, categoryId: salary.id })).body
        .error,
    ).toBe('category_kind_mismatch');
    expect(
      (await call('POST', '/api/transactions', { kind: 'transfer', date: '2026-10-06', accountId: tl.id, amount: 100, toAccountId: usd.id })).body
        .error,
    ).toBe('transfer_amount_required');

    // Accounts and categories in use cannot be deleted.
    expect((await call('DELETE', `/api/accounts/${tl.id}`)).status).toBe(409);
    expect((await call('DELETE', `/api/categories/${market.id}`)).status).toBe(409);
  });

  it('updates and deletes transactions', async () => {
    const acc = (await call('POST', '/api/accounts', { name: 'Nakit', type: 'cash', currency: 'TRY' })).body;
    const tx = (await call('POST', '/api/transactions', { kind: 'expense', date: '2026-10-10', accountId: acc.id, amount: 5000 })).body;
    expect((await call('PUT', `/api/transactions/${tx.id}`, { amount: 7500 })).body.amount).toBe(7500);
    expect((await call('GET', '/api/accounts')).body[0].balance).toBe(-7500);
    expect((await call('DELETE', `/api/transactions/${tx.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/accounts/${acc.id}`)).status).toBe(204);
  });

  it('reads and writes settings', async () => {
    expect((await call('GET', '/api/settings')).body).toMatchObject({ locale: 'tr', baseCurrency: 'TRY', monthStartDay: 1 });
    const updated = (await call('PUT', '/api/settings', { monthStartDay: 15, baseCurrency: 'EUR', workspaceName: 'Ev' })).body;
    expect(updated).toMatchObject({ monthStartDay: 15, baseCurrency: 'EUR', workspaceName: 'Ev' });
    expect((await call('PUT', '/api/settings', { baseCurrency: 'XXX' })).status).toBe(400);
  });
});
