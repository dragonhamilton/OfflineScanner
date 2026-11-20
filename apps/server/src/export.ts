import type { Book } from '@scanner/shared';

export const EXPORT_COLUMNS = [
  'title',
  'author',
  'publisher',
  'notes',
  'status',
  'position',
  'color',
  'widthPx',
  'heightPx',
  'ocrConfidence',
  'rawOcr',
  'spineImage',
  'id',
  'photoId',
  'createdAt',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** File name used for a spine image inside the export zip. */
export function exportImageName(book: Book, index: number): string {
  const slug = (book.title || 'untitled')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `spines/${String(index + 1).padStart(4, '0')}-${slug || 'untitled'}.jpg`;
}

export function exportRows(books: Book[], imageNames?: Map<string, string>) {
  return books.map(b => ({
    title: b.title,
    author: b.author,
    publisher: b.publisher,
    notes: b.notes,
    status: b.status,
    position: b.position,
    color: b.color,
    widthPx: b.widthPx,
    heightPx: b.heightPx,
    ocrConfidence: b.ocrConfidence === null ? null : Math.round(b.ocrConfidence * 100) / 100,
    rawOcr: b.rawOcr,
    spineImage: imageNames?.get(b.id) ?? b.imageUrl ?? '',
    id: b.id,
    photoId: b.photoId,
    createdAt: b.createdAt,
  }));
}

export function toCsv(rows: ReturnType<typeof exportRows>): string {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const row of rows) lines.push(EXPORT_COLUMNS.map(c => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
