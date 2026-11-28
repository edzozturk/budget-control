import { bankByCode, detectStatementOwner, ibanBankCode, validIban } from './banks.js';
import type { PdfTextItem } from './pdf.js';
import { parseAmount, parseDate } from './statement.js';

// An account passbook ("hesap cüzdanı") is a form: each label ("Hesabın Açılış Tarihi:") has its
// value on the same item after the colon or on the line just below it, in the same column.
// Field labels are matched loosely so other banks' passbooks can work with few or no changes;
// what differs per bank (such as deriving the IBAN) goes in BANK_RULES.

export interface PassbookAccount {
  bankCode: string;
  bankName: string;
  title: string;
  type: 'bank' | 'term_deposit' | 'fx' | 'gold' | 'overdraft' | 'savings';
  holderName: string | null;
  openedOn: string | null;
  branchName: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  iban: string | null;
  currency: string;
  balance: number | null; // minor units
  balanceDate: string | null;
  termEnd: string | null;
  interestRate: number | null;
}

export class PassbookError extends Error {
  constructor(public code: 'passbook_unknown') {
    super(code);
  }
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();

interface BankRule {
  // The IBAN from branch code and account number, for passbooks that do not print it.
  iban?: (branchCode: string, accountNumber: string) => string;
}

function ibanOf(bankCode: string, accountPart: string) {
  const bban = `${bankCode}0${accountPart}`;
  let rest = 0;
  for (const d of `${bban}292700`) rest = (rest * 10 + Number(d)) % 97;
  return `TR${String(98 - rest).padStart(2, '0')}${bban}`;
}

const BANK_RULES: Record<string, BankRule> = {
  // Garanti: 5-digit branch code and 11-digit account number after the bank code.
  '00062': { iban: (branch, account) => ibanOf('00062', branch.padStart(5, '0') + account.padStart(11, '0')) },
};

const TYPES: [RegExp, PassbookAccount['type']][] = [
  [/vadeli/, 'term_deposit'],
  [/altin/, 'gold'],
  [/doviz|yabanci para|\bdth\b/, 'fx'],
  [/kredili|kmh|ek hesap/, 'overdraft'],
  [/birikim/, 'savings'],
  [/vadesiz/, 'bank'],
];

const CURRENCIES: [RegExp, string][] = [
  [/\b(tl|try)\b/, 'TRY'],
  [/\b(usd|abd dolari)\b/, 'USD'],
  [/\b(eur|euro|avro)\b/, 'EUR'],
  [/\b(gbp|sterlin)\b/, 'GBP'],
];

// The value for a label: text after its colon, else the line just below, starting in its column.
function valueOf(items: PdfTextItem[], label: RegExp): string | null {
  const at = items.find((i) => label.test(fold(i.text)));
  if (!at) return null;
  const inline = at.text.split(':').slice(1).join(':').trim();
  if (inline) return inline;
  const below = items.filter((i) => i !== at && i.y < at.y - 2 && i.y > at.y - 30 && i.x0 > at.x0 - 6 && i.x0 < at.x0 + 60);
  if (below.length === 0) return null;
  const top = Math.max(...below.map((i) => i.y));
  const line = below.filter((i) => Math.abs(i.y - top) <= 2).sort((a, b) => a.x0 - b.x0);
  // A label line itself (the next form row) means this value was left empty.
  if (line.some((i) => i.text.trim().endsWith(':'))) return null;
  return line.map((i) => i.text.trim()).join(' ') || null;
}

export function readPassbook(pages: PdfTextItem[][]): PassbookAccount {
  const items = pages[0] ?? [];
  const all = pages.flat().map((i) => i.text).join(' ');
  const titleItem = items.find((i) => /hesap cuzdani/.test(fold(i.text)));
  if (!titleItem) throw new PassbookError('passbook_unknown');
  const title = titleItem.text.trim();

  const owner = detectStatementOwner(all);
  const bankCode = owner.bankCode;
  const bank = bankByCode(bankCode);
  if (!bankCode || !bank) throw new PassbookError('passbook_unknown');

  const holderName = valueOf(items, /^(adi soyadi|ad soyad|unvan|hesap sahibi)/);
  const opened = valueOf(items, /acilis tarihi/);
  const branch = valueOf(items, /sube adi|subesi|^sube\b/);
  const accountRaw = valueOf(items, /hesap (ve cuzdan )?(numarasi|no)/);
  const balanceRaw = valueOf(items, /bakiye:?$/);
  const balanceDate = valueOf(items, /bakiye tarihi/);
  const term = valueOf(items, /^vadesi?\b/);

  const branchMatch = branch?.match(/^(.*?)[\s/-]*(\d{2,5})$/);
  const branchName = branchMatch ? branchMatch[1].trim() || null : branch;
  const branchCode = branchMatch ? branchMatch[2] : null;
  const accountNumber = accountRaw?.match(/\d{5,}/)?.[0] ?? null;

  let iban = owner.ibans.find((i) => ibanBankCode(i) === bankCode) ?? null;
  const rule = BANK_RULES[bankCode];
  if (!iban && rule?.iban && branchCode && accountNumber) iban = rule.iban(branchCode, accountNumber);
  if (iban && !validIban(iban)) iban = null;
  if (!accountNumber && !iban) throw new PassbookError('passbook_unknown');

  const foldedTitle = fold(title);
  const type = TYPES.find(([re]) => re.test(foldedTitle))?.[1] ?? 'bank';
  const currency = CURRENCIES.find(([re]) => re.test(fold(balanceRaw ?? '')))?.[1] ?? 'TRY';
  const rate = term?.match(/%\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*%/);

  return {
    bankCode,
    bankName: bank.name,
    title,
    type,
    holderName,
    openedOn: parseDate(opened),
    branchName,
    branchCode,
    accountNumber,
    iban,
    currency,
    balance: balanceRaw ? parseAmount(balanceRaw, 2) : null,
    balanceDate: parseDate(balanceDate),
    termEnd: term ? parseDate(term.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/)?.[0] ?? null) : null,
    interestRate: rate ? Number((rate[1] ?? rate[2]).replace(',', '.')) : null,
  };
}
