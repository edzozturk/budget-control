// Same checks as the server (server/src/lib/banks.ts), for instant feedback in forms.
export const normalizeIban = (iban: string) => iban.replace(/[\s-]/g, '').toUpperCase();

export function validIban(raw: string) {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('TR') && !/^TR\d{24}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export const ibanBankCode = (raw: string) => {
  const iban = normalizeIban(raw);
  return /^TR\d{24}$/.test(iban) ? iban.slice(4, 9) : null;
};

// "TR12 0006 2000 ..." in groups of four.
export const formatIban = (iban: string) => normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();

// Shows only the last four characters until revealed.
export const maskTail = (value: string) => (value.length <= 4 ? value : `•••• ${value.slice(-4)}`);
