import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { detectStatementOwner, ibanBankCode, validIban } from '../src/lib/banks.js';

// A valid Turkish IBAN for a bank code and a made-up account number (synthetic, never a real one).
function makeIban(bankCode: string, account: string) {
  const bban = `${bankCode}0${account.padStart(16, '0')}`;
  const digits = `${bban}2927` + '00'; // "TR" = 29 27, check digits 00
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return `TR${String(98 - rest).padStart(2, '0')}${bban}`;
}

describe('IBANs and banks', () => {
  it('checks IBANs and reads the bank code', () => {
    const iban = makeIban('00062', '123');
    expect(validIban(iban)).toBe(true);
    expect(validIban(iban.slice(0, -1) + ((Number(iban.at(-1)) + 1) % 10))).toBe(false);
    expect(validIban(iban.slice(0, -1))).toBe(false);
    expect(validIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanBankCode(iban.replace(/(.{4})/g, '$1 '))).toBe('00062');
  });

  it('finds the IBAN or the bank in statement text', () => {
    const iban = makeIban('00111', '42');
    const spaced = iban.replace(/(.{4})/g, '$1 ').trim();
    expect(detectStatementOwner(`Hesap Hareketleri Iban : ${spaced} Ad Soyad`)).toEqual({ ibans: [iban], bankCode: '00111' });
    expect(detectStatementOwner('T. Garanti Bankası A.Ş. Hesap Hareketleri').bankCode).toBe('00062');
    expect(detectStatementOwner('TÜRKİYE İŞ BANKASI A.Ş.').bankCode).toBe('00064');
    expect(detectStatementOwner('Ziraat Katılım Bankası').bankCode).toBe('00209');
    expect(detectStatementOwner('Market alışverişi').bankCode).toBeNull();
  });
});

let dir: string;
let app: FastifyInstance;
let cookie = '';

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, contentType?: string) {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  if (contentType) headers['content-type'] = contentType;
  const res = await app.inject({ method, url, payload: payload as string, headers });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

describe('account details', () => {
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

  it('stores bank details, takes the bank from the IBAN and lists term ends as upcoming', async () => {
    expect((await call('GET', '/api/banks')).body).toContainEqual({ code: '00111', name: 'QNB' });
    const member = (await call('POST', '/api/members', { name: 'Ege' })).body;
    const iban = makeIban('00111', '987654');
    const res = await call('POST', '/api/accounts', {
      name: 'QNB Ek Hesap',
      type: 'overdraft',
      currency: 'TRY',
      iban: iban.replace(/(.{4})/g, '$1 ').toLowerCase(),
      branchName: ' Mecidiyeköy ',
      branchCode: '123',
      accountNumber: '987654',
      customerNumber: '',
      ownerMemberId: member.id,
      joint: true,
      creditLimit: 10000000,
      interestRate: 4.25,
      interestDay: 28,
      openedOn: '2020-05-01',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ iban, bankCode: '00111', branchName: 'Mecidiyeköy', customerNumber: null, ownerMemberId: member.id, joint: true, interestDay: 28 });

    expect((await call('POST', '/api/accounts', { name: 'X', type: 'bank', currency: 'TRY', iban: 'TR00 0000 0000 0000 0000 0000 00' })).status).toBe(400);
    expect((await call('POST', '/api/accounts', { name: 'X', type: 'bank', currency: 'TRY', ownerMemberId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);

    // Closing an account archives it; deleting the owner leaves the account without one.
    const closed = (await call('PUT', `/api/accounts/${res.body.id}`, { closedOn: '2026-11-01' })).body;
    expect(closed).toMatchObject({ archived: true, closedOn: '2026-11-01' });
    // An update changes only the fields sent (defaults such as archived=false are not re-applied).
    const renamed = (await call('PUT', `/api/accounts/${res.body.id}`, { name: 'QNB KMH' })).body;
    expect(renamed).toMatchObject({ name: 'QNB KMH', iban, joint: true, archived: true, creditLimit: 10000000 });
    expect((await call('DELETE', `/api/members/${member.id}`)).status).toBe(204);
    expect((await call('GET', '/api/accounts')).body[0].ownerMemberId).toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    await call('POST', '/api/accounts', { name: 'Vadeli', type: 'term_deposit', currency: 'TRY', termStart: today, termEnd: soon, autoRenew: true, interestRate: 40 });
    const upcoming = (await call('GET', '/api/upcoming')).body;
    expect(upcoming.items).toContainEqual(expect.objectContaining({ type: 'term_end', name: 'Vadeli', dueDate: soon, autoRenew: true }));
  });

  it('suggests the account a statement belongs to', async () => {
    const garantiIban = makeIban('00062', '111');
    const garanti = (await call('POST', '/api/accounts', { name: 'Garanti', type: 'bank', currency: 'TRY', iban: garantiIban })).body;
    const qnb = (await call('POST', '/api/accounts', { name: 'QNB', type: 'bank', currency: 'TRY', bankCode: '00111' })).body;
    const file = (iban: string) => Buffer.from(`Hesap Hareketleri;;\nIBAN;${iban};\nTarih;Açıklama;Tutar\n01.11.2026;MARKET;-10,00\n02.11.2026;MAAŞ;100,00\n`);

    const right = (await call('POST', `/api/imports/parse?accountId=${garanti.id}`, file(garantiIban), 'application/octet-stream')).body;
    expect(right.owner).toMatchObject({ bankCode: '00062', suggestedAccountId: null, otherBank: false });

    const wrong = (await call('POST', `/api/imports/parse?accountId=${qnb.id}`, file(garantiIban), 'application/octet-stream')).body;
    expect(wrong.owner).toMatchObject({ bankCode: '00062', bankName: 'Garanti BBVA', suggestedAccountId: garanti.id, otherBank: true });

    // A QNB IBAN that is not saved on any account still points at the only QNB account.
    const unknown = (await call('POST', `/api/imports/parse?accountId=${garanti.id}`, file(makeIban('00111', '5')), 'application/octet-stream')).body;
    expect(unknown.owner).toMatchObject({ bankCode: '00111', suggestedAccountId: qnb.id, otherBank: true });
  });
});
