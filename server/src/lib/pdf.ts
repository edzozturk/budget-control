import type { Cell } from './statement.js';

// Bank PDFs (Garanti's internet banking export, for one) are text laid out in columns, not tables.
// The text is read with its positions. Below a header line ("Tarih ... Tutar ...") each piece of text
// goes to the column under that header and to the row of the nearest date, so descriptions that
// wrap onto several lines stay on one row. Lines outside the table become one row each.

export class PdfError extends Error {
  constructor(public code: 'pdf_encrypted' | 'pdf_no_text' | 'unreadable_file') {
    super(code);
  }
}

interface Item {
  x0: number;
  x1: number;
  y: number;
  text: string;
}

interface Column {
  name: string;
  x0: number;
  x1: number;
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .trim();

const DATE_HEADERS = ['tarih', 'islem tarihi', 'date'];
const AMOUNT_HEADERS = ['tutar', 'borc', 'alacak', 'amount', 'bakiye'];

function isHeader(line: Item[]) {
  const words = line.map((i) => fold(i.text));
  return words.some((w) => DATE_HEADERS.some((h) => w.startsWith(h))) && words.some((w) => AMOUNT_HEADERS.some((h) => w.includes(h))) && line.length >= 3;
}

// Left-aligned text starts where its header starts, right-aligned amounts end where theirs ends;
// otherwise the header the text overlaps most, then the nearest one.
function columnOf(item: Item, cols: Column[]) {
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  let i = cols.findIndex((c) => near(item.x0, c.x0));
  if (i < 0) i = cols.findIndex((c) => near(item.x1, c.x1));
  if (i > -1) return i;
  let best = 0;
  let bestScore = -Infinity;
  cols.forEach((c, idx) => {
    const overlap = Math.min(item.x1, c.x1) - Math.max(item.x0, c.x0);
    if (overlap > bestScore) {
      bestScore = overlap;
      best = idx;
    }
  });
  return best;
}

function groupLines(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0].y - it.y) <= 2) line.push(it);
    else lines.push([it]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

const DATE_TEXT = /^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/;
const join = (items: Item[]) =>
  [...items]
    .sort((a, b) => b.y - a.y || a.x0 - b.x0)
    .map((i) => i.text.trim())
    .join(' ');

export function linesToRows(pages: Item[][]): Cell[][] {
  const rows: Cell[][] = [];
  let header: Column[] | null = null; // the first table header; later pages map onto its columns
  for (const items of pages) {
    const lines = groupLines(items);
    const at = lines.findIndex(isHeader);
    if (at < 0) {
      rows.push(...lines.map((l) => l.map((i) => i.text.trim())));
      continue;
    }
    const cols = lines[at].map((i) => ({ name: i.text.trim(), x0: i.x0, x1: i.x1 }));
    rows.push(...lines.slice(0, at).map((l) => l.map((i) => i.text.trim())));
    if (!header) {
      header = cols;
      rows.push(cols.map((c) => c.name));
    }
    const target = cols.map((c, i) => {
      const t = header!.findIndex((h) => fold(h.name) === fold(c.name));
      return t > -1 ? t : Math.min(i, header!.length - 1);
    });

    // A row is anchored on its date. A wrapped description puts lines above and below the date,
    // so every other item joins the row whose date is nearest vertically.
    const body = lines.slice(at + 1).flat();
    const placed = body.map((it) => ({ it, col: target[columnOf(it, cols)] }));
    const anchors = placed.filter((p) => p.col === 0 && DATE_TEXT.test(p.it.text)).map((p) => p.it);
    const groups = new Map<Item, typeof placed>(anchors.map((a) => [a, []]));
    const loose: Item[] = [];
    for (const p of placed) {
      let best: Item | null = null;
      for (const a of anchors) if (!best || Math.abs(a.y - p.it.y) < Math.abs(best.y - p.it.y)) best = a;
      if (best && Math.abs(best.y - p.it.y) <= 10) groups.get(best)!.push(p);
      else loose.push(p.it);
    }
    const out: { y: number; cells: Cell[] }[] = [];
    for (const [anchor, members] of groups) {
      const cells: Cell[] = header.map((_, col) => join(members.filter((m) => m.col === col).map((m) => m.it)));
      out.push({ y: anchor.y, cells });
    }
    for (const line of groupLines(loose)) out.push({ y: line[0].y, cells: line.map((i) => i.text.trim()) });
    rows.push(...out.sort((a, b) => b.y - a.y).map((r) => r.cells));
  }
  return rows;
}

export async function parsePdf(buf: Buffer): Promise<Cell[][]> {
  return linesToRows(await readPdfItems(buf));
}

// The text of each page with its position (PDF units, y grows upwards).
export async function readPdfItems(buf: Buffer): Promise<Item[][]> {
  // unpdf ships a self-contained pdf.js build: no native modules, so nothing for Windows to lock.
  const { getDocumentProxy } = await import('unpdf');
  let doc;
  try {
    doc = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  } catch (err) {
    if ((err as { name?: string }).name === 'PasswordException') throw new PdfError('pdf_encrypted');
    throw err;
  }
  const pages: Item[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [, , , , x, y] = it.transform as number[];
      items.push({ x0: x, x1: x + it.width, y, text: it.str });
    }
    pages.push(items);
  }
  if (pages.every((p) => p.length === 0)) throw new PdfError('pdf_no_text');
  return pages;
}

export type { Item as PdfTextItem };
