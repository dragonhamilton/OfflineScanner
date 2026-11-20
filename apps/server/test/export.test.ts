import { describe, expect, it } from 'vitest';
import type { Book } from '@scanner/shared';
import { exportImageName, exportRows, toCsv } from '../src/export.ts';

const book: Book = {
  id: '00000000-0000-4000-8000-000000000001',
  photoId: null,
  position: 3,
  imageUrl: '/files/spines/x/1/spine_003.jpg',
  widthPx: 120,
  heightPx: 900,
  color: '#aa3322',
  rawOcr: 'THE "BEST"\nBOOK, EVER',
  ocrLines: [],
  ocrConfidence: 0.876,
  title: 'The "Best" Book, Ever',
  author: 'A. Writer',
  publisher: '',
  notes: '',
  status: 'confirmed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('export', () => {
  it('quotes CSV cells that need it', () => {
    const csv = toCsv(exportRows([book]));
    const [header, row] = csv.trimEnd().split('\r\n');
    expect(header.startsWith('title,author,publisher')).toBe(true);
    expect(row.startsWith('"The ""Best"" Book, Ever",A. Writer,,')).toBe(true);
    expect(csv).toContain('"THE ""BEST""\nBOOK, EVER"');
    expect(row).toContain(',0.88,');
  });

  it('names zip images by position and title', () => {
    expect(exportImageName(book, 0)).toBe('spines/0001-the-best-book-ever.jpg');
    expect(exportImageName({ ...book, title: '' }, 41)).toBe('spines/0042-untitled.jpg');
  });
});
