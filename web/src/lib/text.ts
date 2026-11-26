// Case- and accent-insensitive form of Turkish text, matching the server's rule matching.
export const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');

// A rule pattern matches at the start of a word, like the server's patternMatches.
export function patternMatches(pattern: string, description: string) {
  const needle = fold(pattern).trim();
  const text = fold(description);
  for (let i = text.indexOf(needle); i > -1; i = text.indexOf(needle, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(text[i - 1])) return true;
  }
  return false;
}
