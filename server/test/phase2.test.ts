import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { addMonths, nextDayOfMonth } from '../src/lib/dates.js';

let dir: string;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'budget-'));
  cookie = '';
  app = await buildApp(loadConfig({ DATA_DIR: dir, WEB_DIST: path.join(dir, 'no-web') }));
  await call('POST', '/api/setup', { password: 'correct horse', locale: 'tr', baseCurrency: 'TRY' });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('dates', () => {
  it('adds months clamping to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-05-10', 0, 28)).toBe('2026-05-28');
    expect(nextDayOfMonth('2026-10-17', 20)).toBe('2026-10-20');
    expect(nextDayOfMonth('2026-10-17', 5)).toBe('2026-11-05');
  });
});

describe('loans', () => {
  it('builds a schedule, pays and un-pays installments', async () => {
    const bank = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY', openingBalance: 10000000 })).body;
    const created = await call('POST', '/api/loans', {
      name: 'İhtiyaç kredisi',
      lender: 'Banka',
      currency: 'TRY',
      principal: 10000000,
      installmentAmount: 1000000,
      installmentCount: 12,
      firstDueDate: '2026-01-31',
      paidInstallments: 3,
      accountId: bank.id,
    });
    expect(created.status).toBe(201);
    const loan = created.body;
    expect(loan.installments).toHaveLength(12);
    expect(loan.installments[1].dueDate).toBe('2026-02-28');
    expect(loan.paidCount).toBe(3);
    expect(loan.remainingTotal).toBe(9 * 1000000);
    expect(loan.nextInstallment.number).toBe(4);
    expect(loan.lastDueDate).toBe('2026-12-31');

    const paid = await call('POST', `/api/loans/${loan.id}/installments/4/pay`, { date: '2026-04-30' });
    expect(paid.body.paidDate).toBe('2026-04-30');
    expect((await call('POST', `/api/loans/${loan.id}/installments/4/pay`, {})).status).toBe(409);

    let accounts = (await call('GET', '/api/accounts')).body;
    expect(accounts[0].balance).toBe(10000000 - 1000000);
    const txs = (await call('GET', '/api/transactions')).body;
    expect(txs.items[0].note).toBe('İhtiyaç kredisi 4/12');

    await call('POST', `/api/loans/${loan.id}/installments/4/unpay`);
    accounts = (await call('GET', '/api/accounts')).body;
    expect(accounts[0].balance).toBe(10000000);
    expect((await call('GET', `/api/loans/${loan.id}`)).body.paidCount).toBe(3);

    // Changing an unpaid installment's amount (e.g. variable-rate loans).
    const edited = await call('PUT', `/api/loans/${loan.id}/installments/12`, { amount: 1200000 });
    expect(edited.body.amount).toBe(1200000);
    expect((await call('GET', `/api/loans/${loan.id}`)).body.remainingTotal).toBe(8 * 1000000 + 1200000);

    expect((await call('DELETE', `/api/loans/${loan.id}`)).status).toBe(204);
    expect((await call('GET', '/api/loans')).body).toHaveLength(0);
  });

  it('requires a paying account in the loan currency', async () => {
    const usd = (await call('POST', '/api/accounts', { name: 'USD', type: 'bank', currency: 'USD' })).body;
    const loan = (
      await call('POST', '/api/loans', {
        name: 'Kredi',
        currency: 'TRY',
        principal: 100000,
        installmentAmount: 10000,
        installmentCount: 10,
        firstDueDate: '2026-01-15',
      })
    ).body;
    expect((await call('POST', `/api/loans/${loan.id}/installments/1/pay`, {})).body.error).toBe('account_required');
    expect((await call('POST', `/api/loans/${loan.id}/installments/1/pay`, { accountId: usd.id })).body.error).toBe('currency_mismatch');
  });
});

describe('credit cards', () => {
  it('records statements, partial and full payments as transfers', async () => {
    const bank = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY', openingBalance: 5000000 })).body;
    const card = (
      await call('POST', '/api/accounts', {
        name: 'Bonus',
        type: 'credit_card',
        currency: 'TRY',
        creditLimit: 10000000,
        interestRate: 4.25,
        statementDay: 20,
        dueDay: 30,
        last4: '1234',
      })
    ).body;
    expect(card).toMatchObject({ statementDay: 20, dueDay: 30, last4: '1234', creditLimit: 10000000 });
    expect((await call('POST', '/api/accounts', { name: 'X', type: 'credit_card', currency: 'TRY', last4: '1234 5678' })).status).toBe(400);

    const next = (await call('GET', `/api/cards/${card.id}/next-statement`)).body;
    expect(next.statementDate.endsWith('-20')).toBe(true);
    expect(next.dueDate.endsWith('-30')).toBe(true);

    const st = (
      await call('POST', '/api/card-statements', {
        accountId: card.id,
        statementDate: '2026-10-20',
        dueDate: '2026-10-30',
        amount: 2000000,
        minimumPayment: 400000,
      })
    ).body;
    expect(st).toMatchObject({ remaining: 2000000 });

    const partial = (await call('POST', `/api/card-statements/${st.id}/pay`, { fromAccountId: bank.id, amount: 500000, date: '2026-10-25' })).body;
    expect(partial).toMatchObject({ paidAmount: 500000, remaining: 1500000, status: 'minimum_paid' });
    const full = (await call('POST', `/api/card-statements/${st.id}/pay`, { fromAccountId: bank.id, amount: 1500000, date: '2026-10-28' })).body;
    expect(full.status).toBe('paid');

    const accounts = (await call('GET', '/api/accounts')).body as { id: string; balance: number }[];
    expect(accounts.find((a) => a.id === bank.id)!.balance).toBe(3000000);
    expect(accounts.find((a) => a.id === card.id)!.balance).toBe(2000000);
  });
});

describe('upcoming and members', () => {
  it('lists overdue and upcoming installments and statements', async () => {
    const card = (await call('POST', '/api/accounts', { name: 'Kart', type: 'credit_card', currency: 'TRY', statementDay: 1 })).body;
    await call('POST', '/api/loans', {
      name: 'Kredi',
      currency: 'TRY',
      principal: 300000,
      installmentAmount: 100000,
      installmentCount: 3,
      firstDueDate: '2020-01-10',
    });
    await call('POST', '/api/card-statements', { accountId: card.id, statementDate: '2020-01-01', dueDate: '2020-01-11', amount: 5000 });
    const up = (await call('GET', '/api/upcoming?days=30')).body;
    expect(up.items.map((i: { type: string }) => i.type)).toEqual(['loan', 'card', 'loan', 'loan']);
    expect(up.items.every((i: { overdue: boolean }) => i.overdue)).toBe(true);
    expect(up.missingStatements).toHaveLength(1);
  });

  it('tags transactions with family members and filters by them', async () => {
    const ege = (await call('POST', '/api/members', { name: 'Ege', color: '#2563eb' })).body;
    const acc = (await call('POST', '/api/accounts', { name: 'Nakit', type: 'cash', currency: 'TRY' })).body;
    await call('POST', '/api/transactions', { kind: 'expense', date: '2026-10-01', accountId: acc.id, amount: 1000, memberId: ege.id });
    await call('POST', '/api/transactions', { kind: 'expense', date: '2026-10-02', accountId: acc.id, amount: 2000 });
    expect((await call('GET', `/api/transactions?memberId=${ege.id}`)).body.total).toBe(1);
    expect((await call('DELETE', `/api/members/${ege.id}`)).status).toBe(409);
    expect((await call('PUT', `/api/members/${ege.id}`, { archived: true })).body.archived).toBe(true);
  });
});
