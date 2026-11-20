import type { OcrLine } from '@scanner/shared';

/** Text found in one image, without any rotation logic. */
export interface OcrEngine {
  readonly name: string;
  /** Recognise the text in an image (PNG/JPEG bytes). Lines come back in reading order. */
  recognize(image: Buffer): Promise<OcrLine[]>;
  close(): Promise<void>;
}

/** Sort lines left→right (then top→bottom) and number them. */
export function orderLines(lines: (Omit<OcrLine, 'order'> & { x: number; y: number })[]): OcrLine[] {
  return [...lines]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((l, order) => ({ text: l.text, height: l.height, confidence: l.confidence, order }));
}
