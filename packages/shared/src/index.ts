// Types shared by the server and the web client.

export type BookStatus = 'unreviewed' | 'confirmed' | 'skipped';
export const BOOK_STATUSES: readonly BookStatus[] = ['unreviewed', 'confirmed', 'skipped'];

/** One line of text found by OCR on a spine. */
export interface OcrLine {
  text: string;
  /** Letter height in pixels, after the spine was rotated so text reads left to right. */
  height: number;
  /** Order along the spine, 0 = first line in reading order (top of the book). */
  order: number;
  /** 0–1 */
  confidence: number;
}

export interface Photo {
  id: string;
  imageUrl: string;
  originalName: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface UploadPhotoResponse {
  photo: Photo;
  estimatedSpineCount: number;
}

/** A book is one spine found in a photo (or one added by hand). */
export interface Book {
  id: string;
  photoId: string | null;
  /** Left-to-right position in the source photo, starting at 1. */
  position: number | null;
  imageUrl: string | null;
  widthPx: number | null;
  heightPx: number | null;
  /** Dominant spine colour, e.g. "#a83c2f". */
  color: string | null;
  rawOcr: string;
  ocrLines: OcrLine[];
  /** 0–1, null until OCR has run. */
  ocrConfidence: number | null;
  title: string;
  author: string;
  publisher: string;
  notes: string;
  status: BookStatus;
  createdAt: string;
  updatedAt: string;
}

export type BookPatch = Partial<Pick<Book, 'title' | 'author' | 'publisher' | 'notes' | 'status'>>;

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SliceResponse {
  books: Book[];
  /** Slices that looked like bare wall or shelf and were dropped. */
  skippedSlices: number;
}
