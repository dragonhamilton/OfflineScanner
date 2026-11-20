import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

/**
 * Draws a fake shelf: coloured spines separated by dark gaps, each spine
 * with a band of light/dark marks standing in for printed text.
 * Used by the unit tests and (via the CLI below) by the Playwright tests.
 */
export async function makeSyntheticShelf(opts: { books?: number; spineWidth?: number; gap?: number; height?: number } = {}) {
  const books = opts.books ?? 8;
  const spineWidth = opts.spineWidth ?? 145;
  const gap = opts.gap ?? 6;
  const height = opts.height ?? 600;
  const width = books * spineWidth + (books - 1) * gap;
  const data = Buffer.alloc(width * height * 3);

  const palette = [
    [176, 58, 46], [41, 98, 155], [214, 170, 60], [60, 130, 90],
    [120, 70, 140], [200, 200, 190], [90, 90, 95], [220, 120, 50],
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let b = 0; b < books; b++) {
    const x0 = b * (spineWidth + gap);
    const [r, g, bl] = palette[b % palette.length];
    for (let y = 0; y < height; y++) {
      for (let x = x0; x < x0 + spineWidth; x++) {
        // "text": marks in the middle of the spine
        const inText = y > height * 0.2 && y < height * 0.75 && x > x0 + spineWidth * 0.3 && x < x0 + spineWidth * 0.7;
        const mark = inText && Math.floor(y / 14) % 2 === 0 && rand() > 0.35;
        const i = (y * width + x) * 3;
        // dark print on light spines, light print on dark ones
        const ink = (r + g + bl) / 3 > 140 ? 30 : 240;
        data[i] = mark ? ink : r;
        data[i + 1] = mark ? ink : g;
        data[i + 2] = mark ? ink : bl;
      }
    }
    // dark gap after this book
    if (b < books - 1) {
      for (let y = 0; y < height; y++) {
        for (let x = x0 + spineWidth; x < x0 + spineWidth + gap; x++) {
          const i = (y * width + x) * 3;
          data[i] = data[i + 1] = data[i + 2] = 12;
        }
      }
    }
  }

  const jpeg = await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return { jpeg, width, height, books, spineWidth };
}

// CLI: tsx test/synthetic-shelf.ts <output.jpg>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) throw new Error('usage: synthetic-shelf.ts <output.jpg>');
  const { jpeg } = await makeSyntheticShelf();
  await sharp(jpeg).toFile(out);
  console.log(`wrote ${out}`);
}
