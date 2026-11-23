// Case- and accent-insensitive form of Turkish text, matching the server's rule matching.
export const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i');
