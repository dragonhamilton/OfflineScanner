import type { Repo } from './repo.ts';
import type { Storage } from './storage.ts';
import type { OcrEngine } from './ocr/index.ts';

/** What every route needs. Built once in app.ts. */
export interface AppContext {
  repo: Repo;
  storage: Storage;
  /** The OCR engine starts on first use (Tesseract takes a few seconds to load). */
  getOcr(): Promise<OcrEngine>;
}

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what} not found`);
}
