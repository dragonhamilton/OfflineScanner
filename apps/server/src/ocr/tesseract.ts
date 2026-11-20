import { createRequire } from 'node:module';
import Tesseract from 'tesseract.js';
import type { OcrEngine } from './types.ts';
import { orderLines } from './types.ts';

const require = createRequire(import.meta.url);
// English model shipped as an npm package, so nothing is fetched from a CDN.
const engData = require('@tesseract.js-data/eng') as { langPath: string; gzip: boolean };

export async function createTesseractEngine(): Promise<OcrEngine> {
  const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    langPath: engData.langPath,
    gzip: engData.gzip,
    cacheMethod: 'none', // don't write eng.traineddata into the working directory
  });
  // Spines have a few scattered words, not a page of text.
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });

  return {
    name: 'tesseract',
    async recognize(image) {
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const lines = (data.blocks ?? [])
        .flatMap(b => b.paragraphs)
        .flatMap(p => p.lines)
        .filter(l => l.text.trim())
        .map(l => ({
          text: l.text.trim(),
          height: l.bbox.y1 - l.bbox.y0,
          confidence: l.confidence / 100,
          x: l.bbox.x0,
          y: l.bbox.y0,
        }));
      return orderLines(lines);
    },
    async close() {
      await worker.terminate();
    },
  };
}
