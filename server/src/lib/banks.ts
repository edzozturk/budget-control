// Turkish banks by their 5-digit EFT code, which is also digits 5-9 of a Turkish IBAN.
// `match` finds the bank's name in statement text (folded: lower case, no accents).

export interface Bank {
  code: string;
  name: string;
  match: RegExp;
}

export const BANKS: Bank[] = [
  { code: '00010', name: 'Ziraat Bankası', match: /\bziraat bankasi\b|\bziraat\b(?! katilim)/ },
  { code: '00012', name: 'Halkbank', match: /\bhalk ?bank/ },
  { code: '00015', name: 'Vakıfbank', match: /\bvakif ?bank|vakiflar bankasi/ },
  { code: '00032', name: 'TEB', match: /\bteb\b|turk ekonomi bankasi/ },
  { code: '00046', name: 'Akbank', match: /\bakbank\b/ },
  { code: '00059', name: 'Şekerbank', match: /\bsekerbank\b/ },
  { code: '00062', name: 'Garanti BBVA', match: /\bgaranti\b/ },
  { code: '00064', name: 'İş Bankası', match: /\bis bankasi\b|\bisbank\b/ },
  { code: '00067', name: 'Yapı Kredi', match: /\byapi (ve )?kredi\b/ },
  { code: '00099', name: 'ING', match: /\bing bank\b/ },
  { code: '00103', name: 'Fibabanka', match: /\bfibabanka\b/ },
  { code: '00111', name: 'QNB', match: /\bqnb\b|\bfinansbank\b|\benpara\b/ },
  { code: '00123', name: 'HSBC', match: /\bhsbc\b/ },
  { code: '00124', name: 'Alternatif Bank', match: /\balternatif ?bank/ },
  { code: '00125', name: 'Burgan Bank', match: /\bburgan\b/ },
  { code: '00134', name: 'Denizbank', match: /\bdeniz ?bank\b/ },
  { code: '00135', name: 'Anadolubank', match: /\banadolubank\b/ },
  { code: '00146', name: 'Odeabank', match: /\bodea ?bank\b/ },
  { code: '00203', name: 'Albaraka Türk', match: /\balbaraka\b/ },
  { code: '00205', name: 'Kuveyt Türk', match: /\bkuveyt turk\b/ },
  { code: '00206', name: 'Türkiye Finans', match: /\bturkiye finans\b/ },
  { code: '00209', name: 'Ziraat Katılım', match: /\bziraat katilim\b/ },
  { code: '00210', name: 'Vakıf Katılım', match: /\bvakif katilim\b/ },
];

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');

export const normalizeIban = (iban: string) => iban.replace(/[\s-]/g, '').toUpperCase();

// ISO 13616 check: move the first four characters to the end, letters to numbers, mod 97 = 1.
// Turkish IBANs are TR + 2 check digits + 5-digit bank code + 1 reserved digit + 16-digit account.
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

export const bankByCode = (code: string | null | undefined) => BANKS.find((b) => b.code === code) ?? null;

// IBANs and the bank named in a statement's text, for suggesting which account a file belongs to.
export function detectStatementOwner(text: string) {
  const ibans = [...text.toUpperCase().matchAll(/TR\d{2}(?:\s?\d{4}){5}\s?\d{2}/g)].map((m) => normalizeIban(m[0])).filter(validIban);
  const folded = fold(text);
  const bank = BANKS.find((b) => b.match.test(folded)) ?? null;
  return { ibans, bankCode: ibans.length ? ibanBankCode(ibans[0]) : (bank?.code ?? null) };
}
