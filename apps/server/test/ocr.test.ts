import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createTesseractEngine } from '../src/ocr/tesseract.ts';
import type { OcrEngine } from '../src/ocr/types.ts';

let engine: OcrEngine | undefined;

afterAll(async () => {
  await engine?.close();
});

// Proves Tesseract loads its model from node_modules with no network,
// and that lines come back ordered with sizes and confidences.
describe('tesseract engine', () => {
  it('reads rendered text offline', async () => {
    engine = await createTesseractEngine();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200">
      <rect width="100%" height="100%" fill="white"/>
      <text x="30" y="120" font-family="sans-serif" font-size="80" fill="black">LIBRARY</text>
      <text x="520" y="110" font-family="sans-serif" font-size="40" fill="black">Scanner</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const lines = await engine.recognize(png);

    const text = lines.map(l => l.text).join(' ').toUpperCase();
    expect(text).toContain('LIBRARY');
    for (const l of lines) {
      expect(l.confidence).toBeGreaterThanOrEqual(0);
      expect(l.confidence).toBeLessThanOrEqual(1);
      expect(l.height).toBeGreaterThan(0);
    }
    expect(lines.map(l => l.order)).toEqual(lines.map((_, i) => i));
  }, 60_000);
});
