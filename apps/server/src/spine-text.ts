import type { OcrLine } from '@scanner/shared';

export interface SpineFields {
  title: string;
  author: string;
  publisher: string;
}

const MIN_CONFIDENCE = 0.3;

/** Collapse whitespace and trim stray punctuation OCR leaves at the ends. */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.!?)]+$/gu, '')
    .trim();
}

/**
 * Best guess at title, author and publisher from the text on a spine.
 * Only uses what is in the image:
 *  - the title is the text in the largest letters (lines close to that size are joined),
 *  - the author is the next-largest remaining line,
 *  - the publisher is a short line (≤ 3 words) at the end of the spine.
 * The reviewer corrects anything this gets wrong.
 */
export function guessFields(lines: OcrLine[]): SpineFields {
  const usable = lines
    .map(l => ({ ...l, text: cleanText(l.text) }))
    .filter(l => l.confidence >= MIN_CONFIDENCE && l.text.length >= 2 && /\p{L}/u.test(l.text))
    .sort((a, b) => a.order - b.order);

  if (usable.length === 0) return { title: '', author: '', publisher: '' };

  const maxHeight = Math.max(...usable.map(l => l.height));
  const titleLines = usable.filter(l => l.height >= maxHeight * 0.85);
  let rest = usable.filter(l => !titleLines.includes(l));

  let publisher = '';
  const lastTitleOrder = Math.max(...titleLines.map(l => l.order));
  if (rest.length >= 2) {
    const last = rest[rest.length - 1];
    if (last.order > lastTitleOrder && last.text.split(' ').length <= 3) {
      publisher = last.text;
      rest = rest.slice(0, -1);
    }
  }

  const author = rest.length
    ? rest.reduce((best, l) => (l.height > best.height ? l : best)).text
    : '';

  return {
    title: titleLines.map(l => l.text).join(' '),
    author,
    publisher,
  };
}
