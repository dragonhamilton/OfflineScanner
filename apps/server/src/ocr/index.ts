import type { OcrLine } from '@scanner/shared';
import { prepareForOcr } from '../image-processing.ts';
import type { OcrEngine } from './types.ts';
import { createTesseractEngine } from './tesseract.ts';
import { createRapidOcrEngine } from './rapidocr.ts';
import type { OcrEngineName } from '../env.ts';

export type { OcrEngine } from './types.ts';

export interface SpineReading {
  lines: OcrLine[];
  rawText: string;
  /** Mean line confidence weighted by text length, 0–1. */
  confidence: number;
  rotation: 0 | 90 | 270;
}

export async function createOcrEngine(name: OcrEngineName, opts: { repoRoot: string; tmpDir: string }): Promise<OcrEngine> {
  return name === 'rapidocr' ? createRapidOcrEngine(opts.repoRoot, opts.tmpDir) : createTesseractEngine();
}

function score(lines: OcrLine[]): { score: number; confidence: number } {
  let chars = 0, weighted = 0;
  for (const l of lines) {
    const n = l.text.replace(/\s/g, '').length;
    chars += n;
    weighted += n * l.confidence;
  }
  return { score: weighted, confidence: chars ? weighted / chars : 0 };
}

/**
 * Read a spine. Text on a standing spine runs vertically, usually top to
 * bottom (rotate 270° to read it) and sometimes bottom to top (90°); wide
 * spines may have horizontal text (0°). Try each and keep the best reading.
 */
export async function readSpine(engine: OcrEngine, spinePath: string): Promise<SpineReading> {
  let best: SpineReading | null = null;
  let bestScore = -1;

  for (const rotation of [270, 90, 0] as const) {
    const image = await prepareForOcr(spinePath, rotation);
    const lines = await engine.recognize(image);
    const s = score(lines);
    if (s.score > bestScore) {
      bestScore = s.score;
      best = { lines, rawText: lines.map(l => l.text).join('\n'), confidence: s.confidence, rotation };
    }
    // Good enough: skip the remaining rotations.
    if (s.confidence >= 0.85 && s.score >= 5) break;
  }
  return best!;
}
