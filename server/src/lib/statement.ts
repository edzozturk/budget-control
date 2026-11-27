import ExcelJS from 'exceljs';
import { z } from 'zod';
import { PdfError, parsePdf } from './pdf.js';

// Bank and card statements arrive as CSV, Excel (.xlsx), PDF or the HTML tables some banks save as .xls.
// They are read into a grid of cells; the user (or a remembered mapping) says which columns hold what.

export type Cell = string | number | null;

export class StatementError extends Error {
  constructor(public code: 'unsupported_format' | 'empty_file' | PdfError['code']) {
    super(code);
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function decodeText(buf: Buffer) {
  const text = buf.toString('utf8');
  // Invalid UTF-8 means a legacy Turkish code page (Excel's default CSV export on Windows).
  const decoded = text.includes('�') ? new TextDecoder('windows-1254').decode(buf) : text;
  return decoded.replace(/^﻿/, '');
}

export function parseCsv(text: string): Cell[][] {
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delimiter = [';', '\t', ',', '|'].reduce((best, d) => (firstLines.split(d).length > firstLines.split(best).length ? d : best), ',');
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) rows.push([...row, field.trim()]);
  return rows.filter((r) => r.some((v) => v !== ''));
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Some banks' ".xls" downloads are really HTML tables.
export function parseHtmlTable(html: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map((td) =>
      decodeEntities(td.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
    );
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

async function parseXlsx(buf: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  // The sheet with the most rows is the transaction list (others are often summaries).
  const sheet = wb.worksheets.reduce((a, b) => (b.actualRowCount > a.actualRowCount ? b : a));
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells: Cell[] = [];
    for (let i = 1; i <= r.cellCount; i++) {
      let v = r.getCell(i).value as unknown;
      if (v && typeof v === 'object' && 'result' in v) v = (v as { result: unknown }).result;
      if (v && typeof v === 'object' && 'richText' in v) v = (v as { richText: { text: string }[] }).richText.map((p) => p.text).join('');
      if (v && typeof v === 'object' && 'text' in v) v = (v as { text: string }).text;
      cells.push(v instanceof Date ? isoOf(v) : typeof v === 'number' ? v : v == null ? null : String(v).trim());
    }
    if (cells.some((c) => c !== null && c !== '')) rows.push(cells);
  });
  return rows;
}

export async function parseStatementFile(buf: Buffer): Promise<Cell[][]> {
  if (buf.length === 0) throw new StatementError('empty_file');
  let rows: Cell[][];
  if (buf[0] === 0x50 && buf[1] === 0x4b) rows = await parseXlsx(buf);
  else if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new StatementError('unsupported_format'); // legacy binary .xls
  else if (buf.subarray(0, 1024).includes('%PDF-')) {
    try {
      rows = await parsePdf(buf);
    } catch (err) {
      throw err instanceof PdfError ? new StatementError(err.code) : err;
    }
  } else {
    const text = decodeText(buf);
    rows = /^\s*</.test(text) && /<table/i.test(text) ? parseHtmlTable(text) : parseCsv(text);
  }
  if (rows.length === 0) throw new StatementError('empty_file');
  return rows;
}

// --- Reading values ------------------------------------------------------------------------

export function parseDate(cell: Cell): string | null {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    // Excel serial date (days since 1899-12-30).
    if (cell < 20000 || cell > 80000) return null;
    return isoOf(new Date(Math.round((cell - 25569) * 86400000)));
  }
  const s = cell.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(year, +m[2], +m[1]);
  }
  return null;
}

function valid(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && y > 1990 && y < 2100 ? isoOf(date) : null;
}

// Parses "1.234,56", "-1.234,56 TL", "1,234.56", "(12,50)", "12,50-", "+300" into minor units.
export function parseAmount(cell: Cell, decimals: number): number | null {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Math.round(cell * 10 ** decimals);
  let s = cell.replace(/\s/g, '').replace(/[^\d.,()+-]/g, '');
  if (!/\d/.test(s)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator unless it groups thousands ("1,234,567").
    normalized = /^\d{1,3}(,\d{3})+$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1 && s.split('.').length > 2) {
    normalized = s.replace(/\./g, '');
  } else {
    normalized = s;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Math.round(Number(normalized) * 10 ** decimals);
  return negative ? -value : value;
}

// --- Mapping columns -------------------------------------------------------------------------

export const mappingSchema = z.object({
  headerRow: z.number().int().min(-1), // -1: no header row
  dateCol: z.number().int().min(0),
  descriptionCols: z.array(z.number().int().min(0)).min(1),
  // Either one signed amount column, or separate money-out (debit) and money-in (credit) columns.
  amountCol: z.number().int().min(0).nullable(),
  debitCol: z.number().int().min(0).nullable(),
  creditCol: z.number().int().min(0).nullable(),
  // Card statements list spending as positive numbers: invert so spending is money out.
  invert: z.boolean(),
});
export type Mapping = z.infer<typeof mappingSchema>;

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');

const HEADER_HINTS = {
  date: ['islem tarihi', 'tarih', 'date', 'valor'],
  description: ['aciklama', 'islem aciklamasi', 'description', 'detay', 'islem', 'isyeri', 'merchant'],
  amount: ['islem tutari', 'tutar', 'amount', 'tutar (tl)'],
  debit: ['borc', 'debit', 'cikis', 'giden'],
  credit: ['alacak', 'credit', 'giris', 'gelen'],
};

const findCol = (headers: string[], hints: string[], exclude: number[] = []) => {
  for (const hint of hints) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && (h === hint || h.startsWith(hint)));
    if (i > -1) return i;
  }
  for (const hint of hints) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && h.includes(hint));
    if (i > -1) return i;
  }
  return -1;
};

const isHeaderRow = (r: Cell[]) => {
  const h = r.map((c) => fold(String(c ?? '')));
  return findCol(h, HEADER_HINTS.date) > -1 && [HEADER_HINTS.amount, HEADER_HINTS.debit, HEADER_HINTS.credit].some((hints) => findCol(h, hints) > -1);
};

// Best guess at the mapping: the first row that reads like a header ("Tarih ... Tutar") with dated
// rows just under it, else the last row before the first run of dated rows.
export function guessMapping(rows: Cell[][], invert: boolean): Mapping {
  const dated = (r: Cell[] | undefined) => !!r?.some((c) => parseDate(c));
  // A carried-over balance line ("DEVREDEN BAKİYE") may sit between the header and the first movement.
  let firstData = rows.findIndex((r, i) => isHeaderRow(r) && rows.slice(i + 1, i + 4).some(dated)) + 1;
  if (firstData === 0) firstData = rows.findIndex((r, i) => dated(r) && rows.slice(i, i + 3).every(dated));
  if (firstData < 0) firstData = 0;
  const headerRow = firstData - 1;
  const sample = rows[firstData] ?? [];
  const headers = headerRow >= 0 ? rows[headerRow].map((h) => fold(String(h ?? ''))) : [];

  let dateCol = findCol(headers, HEADER_HINTS.date);
  if (dateCol < 0) dateCol = Math.max(0, sample.findIndex((c) => parseDate(c)));
  let descCol = findCol(headers, HEADER_HINTS.description, [dateCol]);
  if (descCol < 0) {
    // The longest text column.
    const lengths = sample.map((c, i) => (i !== dateCol && typeof c === 'string' && parseAmount(c, 2) === null ? c.length : -1));
    descCol = Math.max(0, lengths.indexOf(Math.max(...lengths)));
  }
  // Some banks (QNB) put part of the description in a channel column; read it too.
  const channelCol = findCol(headers, ['kanal', 'channel'], [dateCol, descCol]);
  const used = [dateCol, descCol, ...(channelCol > -1 ? [channelCol] : [])];
  const debitCol = findCol(headers, HEADER_HINTS.debit, used);
  const creditCol = findCol(headers, HEADER_HINTS.credit, used);
  let amountCol = findCol(headers, HEADER_HINTS.amount, used);
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) {
    amountCol = sample.findIndex((c, i) => !used.includes(i) && parseAmount(c, 2) !== null && !parseDate(c));
  }
  const split = amountCol < 0 && debitCol > -1 && creditCol > -1;
  return {
    headerRow,
    dateCol,
    descriptionCols: channelCol > -1 ? [descCol, channelCol] : [descCol],
    amountCol: split ? null : Math.max(0, amountCol),
    debitCol: split ? debitCol : null,
    creditCol: split ? creditCol : null,
    invert,
  };
}

export interface StatementLine {
  row: number;
  date: string;
  description: string;
  // Signed, minor units: positive is money into the account, negative is money out.
  amount: number;
}

export function readLines(rows: Cell[][], m: Mapping, decimals: number): StatementLine[] {
  const lines: StatementLine[] = [];
  rows.forEach((r, row) => {
    if (row <= m.headerRow) return;
    const date = parseDate(r[m.dateCol] ?? null);
    if (!date) return;
    let amount: number | null;
    if (m.amountCol != null) amount = parseAmount(r[m.amountCol] ?? null, decimals);
    else {
      const out = parseAmount(r[m.debitCol!] ?? null, decimals);
      const inn = parseAmount(r[m.creditCol!] ?? null, decimals);
      amount = out == null && inn == null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (amount == null || amount === 0) return;
    if (m.invert) amount = -amount;
    const description = m.descriptionCols
      .map((c) => r[c])
      .filter((v) => v != null && v !== '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    lines.push({ row, date, description, amount });
  });
  return lines;
}

// Identifies a statement line across imports: same day, amount and description.
export function lineKey(line: Pick<StatementLine, 'date' | 'amount' | 'description'>, occurrence: number) {
  return `${line.date}|${line.amount}|${fold(line.description).replace(/[^a-z0-9]/g, '')}|${occurrence}`;
}

export { fold as foldText };
