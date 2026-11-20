import type { Book, BookPatch, BookStatus, OcrLine, Photo } from '@scanner/shared';
import type { Pool } from './db/pool.ts';
import { Storage } from './storage.ts';

interface PhotoRow {
  id: string;
  file_name: string;
  original_name: string;
  width: number;
  height: number;
  created_at: Date;
}

interface BookRow {
  id: string;
  photo_id: string | null;
  position: number | null;
  image_file: string | null;
  width_px: number | null;
  height_px: number | null;
  color: string | null;
  raw_ocr: string;
  ocr_lines: OcrLine[];
  ocr_confidence: number | null;
  title: string;
  author: string;
  publisher: string;
  notes: string;
  status: BookStatus;
  created_at: Date;
  updated_at: Date;
}

export interface PhotoRecord extends Photo {
  fileName: string;
}

export interface BookRecord extends Book {
  imageFile: string | null;
}

function toPhoto(r: PhotoRow): PhotoRecord {
  return {
    id: r.id,
    fileName: r.file_name,
    imageUrl: Storage.photoUrl(r.file_name),
    originalName: r.original_name,
    width: r.width,
    height: r.height,
    createdAt: r.created_at.toISOString(),
  };
}

function toBook(r: BookRow): BookRecord {
  return {
    id: r.id,
    photoId: r.photo_id,
    position: r.position,
    imageFile: r.image_file,
    imageUrl: r.image_file ? Storage.spineUrl(r.image_file) : null,
    widthPx: r.width_px,
    heightPx: r.height_px,
    color: r.color,
    rawOcr: r.raw_ocr,
    ocrLines: r.ocr_lines,
    ocrConfidence: r.ocr_confidence,
    title: r.title,
    author: r.author,
    publisher: r.publisher,
    notes: r.notes,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Strip server-only fields before sending a book to the client. */
export function publicBook(record: BookRecord): Book {
  const { imageFile: _imageFile, ...book } = record;
  return book;
}

export function publicPhoto(record: PhotoRecord): Photo {
  const { fileName: _fileName, ...photo } = record;
  return photo;
}

export interface NewSpine {
  photoId: string;
  position: number;
  imageFile: string;
  widthPx: number;
  heightPx: number;
  color: string;
}

export class Repo {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async insertPhoto(p: { id: string; fileName: string; originalName: string; width: number; height: number }): Promise<PhotoRecord> {
    const { rows } = await this.pool.query<PhotoRow>(
      `INSERT INTO photos (id, file_name, original_name, width, height)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [p.id, p.fileName, p.originalName, p.width, p.height],
    );
    return toPhoto(rows[0]);
  }

  async getPhoto(id: string): Promise<PhotoRecord | null> {
    const { rows } = await this.pool.query<PhotoRow>('SELECT * FROM photos WHERE id = $1', [id]);
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  async listBooks(filter: { photoId?: string; status?: BookStatus } = {}): Promise<BookRecord[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.photoId) { args.push(filter.photoId); where.push(`photo_id = $${args.length}`); }
    if (filter.status) { args.push(filter.status); where.push(`status = $${args.length}`); }
    const { rows } = await this.pool.query<BookRow>(
      `SELECT * FROM books ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at, position NULLS LAST`,
      args,
    );
    return rows.map(toBook);
  }

  async getBook(id: string): Promise<BookRecord | null> {
    const { rows } = await this.pool.query<BookRow>('SELECT * FROM books WHERE id = $1', [id]);
    return rows[0] ? toBook(rows[0]) : null;
  }

  /**
   * Replace the unreviewed spines of a photo with a new slicing run.
   * Confirmed and skipped books stay. Returns the image files of removed rows.
   */
  async replaceUnreviewedSpines(photoId: string, spines: NewSpine[]): Promise<{ removedFiles: string[]; books: BookRecord[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query<{ image_file: string | null }>(
        `DELETE FROM books WHERE photo_id = $1 AND status = 'unreviewed' RETURNING image_file`,
        [photoId],
      );
      const books: BookRecord[] = [];
      for (const s of spines) {
        const { rows } = await client.query<BookRow>(
          `INSERT INTO books (photo_id, position, image_file, width_px, height_px, color)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [s.photoId, s.position, s.imageFile, s.widthPx, s.heightPx, s.color],
        );
        books.push(toBook(rows[0]));
      }
      await client.query('COMMIT');
      return {
        removedFiles: removed.rows.map(r => r.image_file).filter((f): f is string => !!f),
        books,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async insertManualBook(patch: BookPatch): Promise<BookRecord> {
    const { rows } = await this.pool.query<BookRow>(
      `INSERT INTO books (title, author, publisher, notes, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [patch.title ?? '', patch.author ?? '', patch.publisher ?? '', patch.notes ?? '', patch.status ?? 'unreviewed'],
    );
    return toBook(rows[0]);
  }

  async updateBook(id: string, patch: BookPatch): Promise<BookRecord | null> {
    const cols = (['title', 'author', 'publisher', 'notes', 'status'] as const).filter(k => patch[k] !== undefined);
    if (cols.length === 0) return this.getBook(id);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    const { rows } = await this.pool.query<BookRow>(
      `UPDATE books SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map(c => patch[c])],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  async updateOcr(
    id: string,
    ocr: { rawOcr: string; lines: OcrLine[]; confidence: number },
    fields: { title: string; author: string; publisher: string },
    overwrite: boolean,
  ): Promise<BookRecord | null> {
    // Without overwrite, only fill fields the reviewer hasn't typed into yet.
    const pick = (col: string, i: number) =>
      overwrite ? `${col} = $${i}` : `${col} = CASE WHEN ${col} = '' THEN $${i} ELSE ${col} END`;
    const { rows } = await this.pool.query<BookRow>(
      `UPDATE books SET raw_ocr = $2, ocr_lines = $3, ocr_confidence = $4,
         ${pick('title', 5)}, ${pick('author', 6)}, ${pick('publisher', 7)}, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, ocr.rawOcr, JSON.stringify(ocr.lines), ocr.confidence, fields.title, fields.author, fields.publisher],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  async updateSpineImage(id: string, img: { imageFile: string; widthPx: number; heightPx: number; color: string }): Promise<BookRecord | null> {
    const { rows } = await this.pool.query<BookRow>(
      `UPDATE books SET image_file = $2, width_px = $3, height_px = $4, color = $5, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, img.imageFile, img.widthPx, img.heightPx, img.color],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  async deleteBook(id: string): Promise<BookRecord | null> {
    const { rows } = await this.pool.query<BookRow>('DELETE FROM books WHERE id = $1 RETURNING *', [id]);
    return rows[0] ? toBook(rows[0]) : null;
  }
}
