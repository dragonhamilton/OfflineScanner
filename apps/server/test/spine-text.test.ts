import { describe, expect, it } from 'vitest';
import type { OcrLine } from '@scanner/shared';
import { cleanText, guessFields } from '../src/spine-text.ts';

const line = (text: string, height: number, order: number, confidence = 0.9): OcrLine => ({ text, height, order, confidence });

describe('guessFields', () => {
  it('takes the biggest text as the title, the next as author, a short last line as publisher', () => {
    expect(
      guessFields([
        line('Ursula K. Le Guin', 30, 0),
        line('THE DISPOSSESSED', 60, 1),
        line('Gollancz', 22, 2),
      ]),
    ).toEqual({ title: 'THE DISPOSSESSED', author: 'Ursula K. Le Guin', publisher: 'Gollancz' });
  });

  it('joins title lines of similar size', () => {
    const f = guessFields([line('A WIZARD', 50, 0), line('OF EARTHSEA', 48, 1), line('Le Guin', 25, 2)]);
    expect(f.title).toBe('A WIZARD OF EARTHSEA');
    expect(f.author).toBe('Le Guin');
    expect(f.publisher).toBe('');
  });

  it('ignores low-confidence and non-letter noise', () => {
    const f = guessFields([line('|||', 80, 0), line('Dune', 40, 1), line('xx', 70, 2, 0.1)]);
    expect(f.title).toBe('Dune');
  });

  it('returns empty fields when nothing is readable', () => {
    expect(guessFields([])).toEqual({ title: '', author: '', publisher: '' });
  });
});

describe('cleanText', () => {
  it('collapses whitespace and strips stray edge punctuation', () => {
    expect(cleanText('  —The   Hobbit|  ')).toBe('The Hobbit');
    expect(cleanText('Why?')).toBe('Why?');
  });
});
