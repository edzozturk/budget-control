import type { Currency, Locale } from './api';

const intlLocale = (locale: Locale) => (locale === 'tr' ? 'tr-TR' : 'en-US');

export function decimalsOf(currencies: Currency[], code: string) {
  return currencies.find((c) => c.code === code)?.decimals ?? 2;
}

// Parses what a user types ("1.250,50", "1250.5", "1250") into minor units.
export function toMinor(input: string, decimals: number): number | null {
  let s = input.trim().replace(/\s/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decimalSep = lastComma > lastDot ? ',' : '.';
  const thousandSep = decimalSep === ',' ? '.' : ',';
  // A single separator followed by exactly 3 digits is a thousands separator ("1.250").
  const parts = s.split(decimalSep);
  if (parts.length === 2 && parts[1].length === 3 && !s.includes(thousandSep) && decimals !== 3) {
    s = parts.join('');
  } else {
    s = s.split(thousandSep).join('').replace(decimalSep, '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 10 ** decimals);
}

export function fromMinor(minor: number, decimals: number) {
  return minor / 10 ** decimals;
}

export function formatMoney(minor: number, currency: string, decimals: number, locale: Locale) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(fromMinor(minor, decimals));
}

// Value for an amount input field, in the user's number style without grouping.
export function toInput(minor: number, decimals: number, locale: Locale) {
  const value = fromMinor(minor, decimals).toFixed(decimals);
  return locale === 'tr' ? value.replace('.', ',') : value;
}

export function formatDate(iso: string, locale: Locale) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(y, m - 1, d),
  );
}
