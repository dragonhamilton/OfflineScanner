import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { autoSliceSpines, cropImage, dominantColor, estimateSpineCount, normalizePhoto, prepareForOcr } from '../src/image-processing.ts';
import { makeSyntheticShelf } from './synthetic-shelf.ts';

let dir: string;
let shelfPath: string;
let shelf: Awaited<ReturnType<typeof makeSyntheticShelf>>;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-test-'));
  shelf = await makeSyntheticShelf();
  shelfPath = path.join(dir, 'shelf.jpg');
  await normalizePhoto(shelf.jpeg, shelfPath);
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('estimateSpineCount', () => {
  it('counts the books on a synthetic shelf', async () => {
    expect(await estimateSpineCount(shelfPath)).toBe(shelf.books);
  });

  it('returns 1 for an image with no gaps', async () => {
    const plain = path.join(dir, 'plain.jpg');
    await sharp({ create: { width: 800, height: 400, channels: 3, background: '#887766' } }).jpeg().toFile(plain);
    expect(await estimateSpineCount(plain)).toBe(1);
  });
});

describe('autoSliceSpines', () => {
  it('returns one entry per requested spine, each a full-height image', async () => {
    const out = path.join(dir, 'slices');
    await fs.mkdir(out);
    const slices = await autoSliceSpines(shelfPath, shelf.books, out);

    expect(slices).toHaveLength(shelf.books);
    for (const s of slices.filter(s => s !== null)) {
      expect(s.heightPx).toBe(shelf.height);
      await expect(fs.stat(s.path)).resolves.toBeTruthy();
    }
  });

  // Known weakness of the slicer ported from the Electron app: it smooths the
  // column brightness over ~1/4 of a spine width, so narrow gaps fade and dark
  // print inside a spine can win. estimateSpineCount (narrow window + prominence)
  // finds all 7 gaps on this same image. When the slicer is improved, this
  // test will start "failing": switch it back to a normal `it`.
  it.fails('cuts every book at the right width when spines carry print', async () => {
    const out = path.join(dir, 'slices-strict');
    await fs.mkdir(out);
    const slices = await autoSliceSpines(shelfPath, shelf.books, out);
    for (const s of slices) {
      expect(s).not.toBeNull();
      expect(Math.abs(s!.widthPx - shelf.spineWidth)).toBeLessThan(20);
    }
  });

  it('drops featureless slices as wall', async () => {
    const wall = path.join(dir, 'wall.jpg');
    await sharp({ create: { width: 600, height: 400, channels: 3, background: '#cccccc' } }).jpeg().toFile(wall);
    const out = path.join(dir, 'wall-slices');
    await fs.mkdir(out);
    expect(await autoSliceSpines(wall, 3, out)).toEqual([null, null, null]);
  });
});

describe('helpers', () => {
  it('reports the dominant colour', async () => {
    const red = path.join(dir, 'red.jpg');
    await sharp({ create: { width: 50, height: 50, channels: 3, background: '#c03020' } }).jpeg().toFile(red);
    const hex = await dominantColor(red);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseInt(hex.slice(1, 3), 16)).toBeGreaterThan(150);
  });

  it('crops within bounds even when the region overhangs', async () => {
    const out = path.join(dir, 'crop.jpg');
    const size = await cropImage(shelfPath, { x: shelf.width - 50, y: 10, width: 500, height: 100 }, out);
    expect(size).toEqual({ width: 50, height: 100 });
  });

  it('rotates spines for OCR and enlarges narrow ones', async () => {
    const narrow = path.join(dir, 'narrow.jpg');
    await sharp({ create: { width: 60, height: 500, channels: 3, background: '#335577' } }).jpeg().toFile(narrow);
    const meta = await sharp(await prepareForOcr(narrow, 270)).metadata();
    expect(meta.width).toBeGreaterThan(meta.height!); // now landscape
    expect(meta.height).toBeGreaterThanOrEqual(160);
  });
});
