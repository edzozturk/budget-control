import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildPdf } from './pdfFixture.js';
import { linesToRows } from '../src/lib/pdf.js';
import { guessMapping, parseAmount, parseCsv, parseDate, parseHtmlTable, parseStatementFile, readLines } from '../src/lib/statement.js';

describe('statement parsing', () => {
  it('reads amounts in Turkish and English formats', () => {
    expect(parseAmount('1.234,56', 2)).toBe(123456);
    expect(parseAmount('-1.234,56 TL', 2)).toBe(-123456);
    expect(parseAmount('1,234.56', 2)).toBe(123456);
    expect(parseAmount('(12,50)', 2)).toBe(-1250);
    expect(parseAmount('12,50-', 2)).toBe(-1250);
    expect(parseAmount('+300', 2)).toBe(30000);
    expect(parseAmount('1.000.000', 2)).toBe(100000000);
    expect(parseAmount(-45.5, 2)).toBe(-4550);
    expect(parseAmount('abc', 2)).toBeNull();
  });

  it('reads dates', () => {
    expect(parseDate('05.11.2026')).toBe('2026-11-05');
    expect(parseDate('5/1/26')).toBe('2026-01-05');
    expect(parseDate('2026-11-05 10:22')).toBe('2026-11-05');
    expect(parseDate(46331)).toBe('2026-11-05');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('Açıklama')).toBeNull();
  });

  it('reads a semicolon CSV in the Windows Turkish code page with a preamble', async () => {
    const text = 'Hesap Hareketleri;;;\nIBAN;TR00;;\n\nTarih;Açıklama;Tutar;Bakiye\n01.11.2026;MİGROS ŞİŞLİ;-450,25;10.000,00\n02.11.2026;"MAAŞ; KASIM";85.000,00;95.000,00\n03.11.2026;ELEKTRİK;-1.200,00;93.800,00\n';
    const buf = Buffer.from(encode1254(text));
    const rows = await parseStatementFile(buf);
    expect(rows[3]).toEqual(['01.11.2026', 'MİGROS ŞİŞLİ', '-450,25', '10.000,00']);
    expect(rows[4][1]).toBe('MAAŞ; KASIM');
    const mapping = guessMapping(rows, false);
    expect(mapping).toMatchObject({ headerRow: 2, dateCol: 0, descriptionCols: [1], amountCol: 2 });
    expect(readLines(rows, mapping, 2).map((l) => l.amount)).toEqual([-45025, 8500000, -120000]);
  });

  it('reads separate debit and credit columns and HTML tables', () => {
    const rows = parseHtmlTable(
      '<table><tr><th>İşlem Tarihi</th><th>Açıklama</th><th>Borç</th><th>Alacak</th></tr><tr><td>01.11.2026</td><td>Kira &amp; aidat</td><td>20.000,00</td><td></td></tr><tr><td>02.11.2026</td><td>Maaş</td><td></td><td>80.000,00</td></tr><tr><td>03.11.2026</td><td>Su</td><td>300,00</td><td></td></tr></table>',
    );
    const mapping = guessMapping(rows, false);
    expect(mapping).toMatchObject({ amountCol: null, debitCol: 2, creditCol: 3 });
    expect(readLines(rows, mapping, 2)).toMatchObject([
      { description: 'Kira & aidat', amount: -2000000 },
      { description: 'Maaş', amount: 8000000 },
      { description: 'Su', amount: -30000 },
    ]);
  });

  it('reads a bank PDF laid out in columns, with wrapped descriptions and a new page header', async () => {
    // Shaped like Garanti's internet banking export: right-aligned amounts, a preamble, page footers.
    const header = (y: number): [number, number, string][] => [
      [31, y, 'Tarih'],
      [88, y, 'Aciklama'],
      [315, y, 'Etiket'],
      [460, y, 'Tutar'],
      [541, y, 'Bakiye'],
    ];
    const pdf = buildPdf([
      [
        [30, 733, 'Sayin MUSTERI, 01/10/2026 - 31/10/2026 tarihleri arasindaki hesap hareketleri'],
        [30, 706, 'Hesap Numarasi'],
        [109, 706, ': 000 - 0000000'],
        ...header(613),
        [31, 597, '27.10.2026'],
        [88, 597, 'ORNEK KISI--HVL-CEP SUBE'],
        [315, 597, 'Para Transferi'],
        [434, 597, '+80.000,00 TL'],
        [535, 597, '770,75 TL'],
        // A description on two lines, with the date and amounts between them.
        [31, 578, '20.10.2026'],
        [88, 582.6, 'ORNEK KISI tarafindan aktarilan-'],
        [88, 573, 'FAST-0000000000'],
        [315, 578, 'Para Transferi'],
        [447, 581.5, '-500,00 TL'],
        [525, 581.5, '-79.229,25 TL'],
        [30, 63, 'Ornek Bankasi A.S.'],
        [544, 62, '1 / 2'],
      ],
      [
        // Page two: same header, different column positions.
        [25, 732, 'Tarih'],
        [80, 732, 'Aciklama'],
        [300, 732, 'Etiket'],
        [450, 732, 'Tutar'],
        [530, 732, 'Bakiye'],
        [25, 716, '05.10.2026'],
        [80, 716, 'HGS Bakiye Yukleme'],
        [300, 716, 'Ulasim'],
        [434, 716, '-1.540,00 TL'],
        [510, 716, '-78.729,25 TL'],
      ],
    ]);
    const rows = await parseStatementFile(pdf);
    const mapping = guessMapping(rows, false);
    expect(rows[mapping.headerRow]).toEqual(['Tarih', 'Aciklama', 'Etiket', 'Tutar', 'Bakiye']);
    expect(mapping).toMatchObject({ dateCol: 0, descriptionCols: [1], amountCol: 3 });
    expect(readLines(rows, mapping, 2)).toMatchObject([
      { date: '2026-10-27', description: 'ORNEK KISI--HVL-CEP SUBE', amount: 8000000 },
      { date: '2026-10-20', description: 'ORNEK KISI tarafindan aktarilan- FAST-0000000000', amount: -50000 },
      { date: '2026-10-05', description: 'HGS Bakiye Yukleme', amount: -154000 },
    ]);
  });

  it('keeps lines outside the table as plain rows', () => {
    const item = (x0: number, y: number, text: string) => ({ x0, x1: x0 + text.length * 4, y, text });
    expect(linesToRows([[item(30, 700, 'Ekstre'), item(30, 650, 'Tarih'), item(90, 650, 'Islem'), item(400, 650, 'Tutar'), item(30, 630, '01.11.2026'), item(90, 630, 'Market'), item(400, 630, '-12,50'), item(30, 60, 'Sayfa 1')]])).toEqual([
      ['Ekstre'],
      ['Tarih', 'Islem', 'Tutar'],
      ['01.11.2026', 'Market', '-12,50'],
      ['Sayfa 1'],
    ]);
  });

  it('reads xlsx files with real dates and numbers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ekstre');
    ws.addRow(['Kart Ekstresi']);
    ws.addRow(['Tarih', 'İşlem', 'Tutar']);
    ws.addRow([new Date(Date.UTC(2026, 10, 3)), 'NETFLIX', 229.99]);
    ws.addRow([new Date(Date.UTC(2026, 10, 4)), 'A101', 87.5]);
    ws.addRow([new Date(Date.UTC(2026, 10, 6)), 'ÖDEME TEŞEKKÜRLER', -5000]);
    const rows = await parseStatementFile(Buffer.from(await wb.xlsx.writeBuffer()));
    const mapping = guessMapping(rows, true);
    expect(readLines(rows, mapping, 2)).toMatchObject([
      { date: '2026-11-03', description: 'NETFLIX', amount: -22999 },
      { date: '2026-11-04', amount: -8750 },
      { amount: 500000 },
    ]);
  });

  it('parses quoted CSV fields with newlines and escaped quotes', () => {
    expect(parseCsv('a,"b ""x""\nc",d\n1,2,3')).toEqual([
      ['a', 'b "x"\nc', 'd'],
      ['1', '2', '3'],
    ]);
  });
});

// Encodes the few Turkish letters used above into Windows-1254.
function encode1254(text: string) {
  const map: Record<string, number> = { ş: 0xfe, Ş: 0xde, ğ: 0xf0, Ğ: 0xd0, ı: 0xfd, İ: 0xdd, ç: 0xe7, Ç: 0xc7, ö: 0xf6, Ö: 0xd6, ü: 0xfc, Ü: 0xdc };
  return Uint8Array.from([...text].map((c) => map[c] ?? c.charCodeAt(0)));
}

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

describe('importing statements', () => {
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

  const statement = [
    'Tarih;Açıklama;Tutar',
    '01.11.2026;MIGROS SANAL MARKET;-450,25',
    '01.11.2026;MIGROS SANAL MARKET;-450,25',
    '02.11.2026;NADIDE OZTURK HAVALE;-5.000,00',
    '03.11.2026;KREDI KARTI ODEMESI;-2.000,00',
    '05.11.2026;KONUT KREDISI TAKSIT;-21.500,00',
  ].join('\n');

  it('previews, imports once, matches hand-entered rows and undoes', async () => {
    const bank = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY', openingBalance: 10000000 })).body;
    const card = (await call('POST', '/api/accounts', { name: 'Kart', type: 'credit_card', currency: 'TRY' })).body;
    const nadide = (await call('POST', '/api/members', { name: 'Nadide' })).body;
    const categories = (await call('GET', '/api/categories')).body as { id: string; name: string }[];
    const market = categories.find((c) => c.name === 'Market')!;
    const other = categories.find((c) => c.name === 'Diğer gider')!;
    await call('POST', '/api/category-rules', { pattern: 'migros', categoryId: market.id });
    await call('POST', '/api/category-rules', { pattern: 'nadide', categoryId: other.id, memberId: nadide.id });
    await call('POST', '/api/category-rules', { pattern: 'kredi karti odemesi', transferAccountId: card.id });
    // Paid in the app before the statement arrived: the statement line must match it, not duplicate it.
    const manual = (await call('POST', '/api/transactions', { kind: 'expense', date: '2026-11-04', accountId: bank.id, amount: 2150000 })).body;

    const parsed = (await call('POST', `/api/imports/parse?accountId=${bank.id}`, Buffer.from(statement), 'application/octet-stream')).body;
    expect(parsed.rows).toHaveLength(6);
    const preview = (await call('POST', '/api/imports/preview', { accountId: bank.id, rows: parsed.rows, mapping: parsed.mapping })).body;
    expect(preview.lines.map((l: { status: string }) => l.status)).toEqual(['new', 'new', 'new', 'new', 'matched']);
    expect(preview.lines[0].categoryId).toBe(market.id);
    expect(preview.lines[0].key).not.toBe(preview.lines[1].key);
    expect(preview.lines[2]).toMatchObject({ categoryId: other.id, memberId: nadide.id });
    expect(preview.lines[3].transferAccountId).toBe(card.id);
    expect(preview.lines[4].matchedTransactionId).toBe(manual.id);

    const lines = preview.lines.map((l: object) => ({ ...l, include: true }));
    const done = await call('POST', '/api/imports', { accountId: bank.id, fileName: 'kasim.csv', mapping: parsed.mapping, lines });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ createdCount: 4, matchedCount: 1, fromDate: '2026-11-01', toDate: '2026-11-05' });

    const accounts = (await call('GET', '/api/accounts')).body as { id: string; balance: number; importMapping: string }[];
    expect(accounts.find((a) => a.id === bank.id)!.balance).toBe(10000000 - 45025 * 2 - 500000 - 200000 - 2150000);
    expect(accounts.find((a) => a.id === card.id)!.balance).toBe(200000);
    expect(JSON.parse(accounts.find((a) => a.id === bank.id)!.importMapping).amountCol).toBe(2);

    // The same file again: everything is already there.
    const again = (await call('POST', '/api/imports/preview', { accountId: bank.id, rows: parsed.rows, mapping: parsed.mapping })).body;
    expect(again.lines.every((l: { status: string }) => l.status === 'duplicate')).toBe(true);
    const twice = await call('POST', '/api/imports', { accountId: bank.id, mapping: parsed.mapping, lines });
    expect(twice.body).toMatchObject({ createdCount: 0, skippedCount: 5 });

    // The card statement shows the payment coming in; it matches the transfer created above.
    const cardPreview = (
      await call('POST', '/api/imports/preview', {
        accountId: card.id,
        rows: [['Tarih', 'İşlem', 'Tutar'], ['03.11.2026', 'ÖDEME', '-2.000,00'], ['04.11.2026', 'NETFLIX', '229,99']],
        mapping: { headerRow: 0, dateCol: 0, descriptionCols: [1], amountCol: 2, debitCol: null, creditCol: null, invert: true },
      })
    ).body;
    expect(cardPreview.lines.map((l: { status: string }) => l.status)).toEqual(['matched', 'new']);

    const history = (await call('GET', `/api/imports?accountId=${bank.id}`)).body;
    expect(history).toHaveLength(2);
    expect((await call('DELETE', `/api/imports/${history.at(-1).id}`)).status).toBe(204);
    expect((await call('GET', '/api/transactions')).body.total).toBe(1);
    const reopened = (await call('POST', '/api/imports/preview', { accountId: bank.id, rows: parsed.rows, mapping: parsed.mapping })).body;
    expect(reopened.lines.map((l: { status: string }) => l.status)).toEqual(['new', 'new', 'new', 'new', 'matched']);
  });

  it('rejects broken PDFs and applies rules to existing transactions', async () => {
    const bank = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY' })).body;
    const pdf = await call('POST', `/api/imports/parse?accountId=${bank.id}`, Buffer.from('%PDF-1.4'), 'application/octet-stream');
    expect(pdf.body.error).toBe('unreadable_file');
    const blank = await call('POST', `/api/imports/parse?accountId=${bank.id}`, buildPdf([[]]), 'application/octet-stream');
    expect(blank.body.error).toBe('pdf_no_text');

    const market = ((await call('GET', '/api/categories')).body as { id: string; name: string }[]).find((c) => c.name === 'Market')!;
    await call('POST', '/api/transactions', { kind: 'expense', date: '2026-11-01', accountId: bank.id, amount: 100, note: 'Şok Market Kadıköy' });
    await call('POST', '/api/category-rules', { pattern: 'ŞOK MARKET', categoryId: market.id });
    expect((await call('POST', '/api/category-rules/apply')).body.updated).toBe(1);
    expect((await call('GET', '/api/transactions')).body.items[0].categoryId).toBe(market.id);
    expect((await call('POST', '/api/category-rules', { pattern: 'xx' })).status).toBe(400);
  });
});

describe('cost centres, reports and utility rules', () => {
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

  it('tags imported lines with a cost centre and reports them per month', async () => {
    const bank = (await call('POST', '/api/accounts', { name: 'Banka', type: 'bank', currency: 'TRY' })).body;
    const italy = (await call('POST', '/api/cost-centers', { name: 'İtalya evi' })).body;
    const ege = (await call('POST', '/api/members', { name: 'Ege' })).body;
    expect((await call('POST', '/api/category-rules', { pattern: 'EGE OZTURK', memberId: ege.id, costCenterId: italy.id })).status).toBe(201);
    expect((await call('POST', '/api/category-rules/presets')).body.added).toBeGreaterThan(20);
    expect((await call('POST', '/api/category-rules/presets')).body.added).toBe(0);

    const rows = [
      ['Tarih', 'Açıklama', 'Tutar'],
      ['01.10.2026', 'EGE OZTURK HAVALE', '-30.000,00'],
      ['02.11.2026', 'EGE OZTURK HAVALE', '-25.000,00'],
      ['03.11.2026', 'ENERJISA ISTANBUL', '-1.250,00'],
      ['04.11.2026', 'BASKI MERKEZI', '-100,00'],
    ];
    const mapping = { headerRow: 0, dateCol: 0, descriptionCols: [1], amountCol: 2, debitCol: null, creditCol: null, invert: false };
    const preview = (await call('POST', '/api/imports/preview', { accountId: bank.id, rows, mapping })).body;
    expect(preview.lines[0]).toMatchObject({ memberId: ege.id, costCenterId: italy.id });
    expect(preview.lines[2].categoryId).not.toBeNull();
    expect(preview.lines[3].categoryId).toBeNull(); // "ASKI" must not match "BASKI"
    await call('POST', '/api/imports', { accountId: bank.id, mapping, lines: preview.lines.map((l: object) => ({ ...l, include: true })) });

    expect((await call('GET', `/api/transactions?costCenterId=${italy.id}`)).body.total).toBe(2);
    const report = (await call('GET', '/api/reports/breakdown?by=costCenter&from=2026-01-01&to=2026-12-31')).body;
    const italyRows = report.rows.filter((r: { groupId: string }) => r.groupId === italy.id);
    expect(italyRows.map((r: { month: string; total: number }) => [r.month, r.total])).toEqual([
      ['2026-10', 3000000],
      ['2026-11', 2500000],
    ]);
    const byMember = (await call('GET', '/api/reports/breakdown?by=member&from=2026-11-01&to=2026-11-30')).body;
    expect(byMember.rows.find((r: { groupId: string }) => r.groupId === ege.id).total).toBe(2500000);

    expect((await call('DELETE', `/api/cost-centers/${italy.id}`)).status).toBe(409);
  });
});
