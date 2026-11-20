// Spine detection and image helpers.
// autoSliceSpines and its helpers are ported unchanged from the Electron app
// (Scanner/src/main/image-processing.ts); the rest is new for the offline version.
import path from 'node:path';
import sharp from 'sharp';
import type { CropRegion } from '@scanner/shared';

const WALL_STDDEV_THRESHOLD = 15;
/** Longest side of a stored shelf photo. Bigger photos are scaled down. */
const MAX_PHOTO_DIMENSION = 4000;

// sharp/libvips defaults to one thread per CPU; leave room for Postgres and OCR.
sharp.concurrency(2);

export interface SpineSlice {
  path: string;
  widthPx: number;
  heightPx: number;
}

/** Re-encode an uploaded image as an upright JPEG, applying EXIF rotation. */
export async function normalizePhoto(input: Buffer, outputPath: string): Promise<{ width: number; height: number }> {
  const info = await sharp(input)
    .rotate()
    .resize({ width: MAX_PHOTO_DIMENSION, height: MAX_PHOTO_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
  return { width: info.width, height: info.height };
}

/** Crop a region out of an image into a new JPEG. */
export async function cropImage(inputPath: string, region: CropRegion, outputPath: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(inputPath).metadata();
  const left = clamp(Math.round(region.x), 0, meta.width! - 1);
  const top = clamp(Math.round(region.y), 0, meta.height! - 1);
  const width = clamp(Math.round(region.width), 1, meta.width! - left);
  const height = clamp(Math.round(region.height), 1, meta.height! - top);
  const info = await sharp(inputPath).extract({ left, top, width, height }).jpeg({ quality: 90 }).toFile(outputPath);
  return { width: info.width, height: info.height };
}

/** Dominant colour of an image as '#rrggbb'. */
export async function dominantColor(imagePath: string): Promise<string> {
  const { dominant } = await sharp(imagePath).stats();
  return '#' + [dominant.r, dominant.g, dominant.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Prepare a spine crop for OCR: rotate so the text runs left to right,
 * convert to greyscale, stretch the contrast and make sure letters are
 * tall enough for the OCR engine.
 */
export async function prepareForOcr(imagePath: string, rotation: 0 | 90 | 270): Promise<Buffer> {
  const rotated = await sharp(imagePath).rotate(rotation).toBuffer({ resolveWithObject: true });
  const MIN_HEIGHT = 160;
  const MAX_WIDTH = 4000;
  let pipeline = sharp(rotated.data).grayscale().normalise();
  const { width, height } = rotated.info;
  if (height < MIN_HEIGHT) {
    const scale = Math.min(MIN_HEIGHT / height, MAX_WIDTH / width);
    if (scale > 1) pipeline = pipeline.resize(Math.round(width * scale), Math.round(height * scale));
  }
  return pipeline.png().toBuffer();
}

/**
 * Estimate how many spines are in a shelf photo by counting the dark gaps
 * between books. The Electron app got this number from Claude; here it is
 * only a starting value that the user can correct before slicing.
 */
export async function estimateSpineCount(imagePath: string): Promise<number> {
  const ANALYSIS_HEIGHT = 200;
  const { data, info } = await sharp(imagePath)
    .resize({ height: ANALYSIS_HEIGHT })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;

  const colMean = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < ANALYSIS_HEIGHT; y++) sum += data[y * width + x];
    colMean[x] = sum / ANALYSIS_HEIGHT;
  }
  const smoothed = smoothArray(colMean, Math.max(1, Math.floor(width / 300)));

  // A gap is a local minimum noticeably darker than the brightest point
  // within roughly one narrow spine width on both sides.
  const MIN_PROMINENCE = 10;
  const reach = Math.max(3, Math.floor(width / 60));
  const candidates: { pos: number; depth: number }[] = [];
  for (let i = 1; i < width - 1; i++) {
    if (!(smoothed[i] < smoothed[i - 1] && smoothed[i] <= smoothed[i + 1])) continue;
    let leftMax = 0, rightMax = 0;
    for (let j = Math.max(0, i - reach); j < i; j++) leftMax = Math.max(leftMax, smoothed[j]);
    for (let j = i + 1; j <= Math.min(width - 1, i + reach); j++) rightMax = Math.max(rightMax, smoothed[j]);
    const depth = Math.min(leftMax, rightMax) - smoothed[i];
    if (depth >= MIN_PROMINENCE) candidates.push({ pos: i, depth });
  }

  // Keep the deepest gap when two are closer than a plausible spine width.
  const minSpacing = Math.max(2, Math.floor(width / 80));
  candidates.sort((a, b) => b.depth - a.depth);
  const gaps: number[] = [];
  for (const c of candidates) {
    if (!gaps.some(g => Math.abs(g - c.pos) < minSpacing)) gaps.push(c.pos);
  }
  return clamp(gaps.length + 1, 1, 80);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Smooth an array with a simple moving average
function smoothArray(arr: Float32Array, windowSize: number): Float32Array {
  const result = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
      sum += arr[j];
      count++;
    }
    result[i] = sum / count;
  }
  return result;
}

// Find the N strongest peaks with a minimum spacing between them
function findTopNPeaks(arr: Float32Array, n: number, minSpacing: number): number[] {
  const peaks: { pos: number; val: number }[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) {
      peaks.push({ pos: i, val: arr[i] });
    }
  }
  peaks.sort((a, b) => b.val - a.val);
  const selected: number[] = [];
  for (const peak of peaks) {
    if (selected.length >= n) break;
    if (!selected.some(p => Math.abs(p - peak.pos) < minSpacing)) {
      selected.push(peak.pos);
    }
  }
  return selected;
}

// Find the N darkest valleys (local minima) with a minimum spacing between them.
// These correspond to the dark shadow gaps between book spines.
function findDeepestValleys(arr: Float32Array, n: number, minSpacing: number): number[] {
  const valleys: { pos: number; val: number }[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] < arr[i - 1] && arr[i] <= arr[i + 1]) {
      valleys.push({ pos: i, val: arr[i] });
    }
  }
  valleys.sort((a, b) => a.val - b.val); // darkest first
  const selected: number[] = [];
  for (const v of valleys) {
    if (selected.length >= n) break;
    if (!selected.some(p => Math.abs(p - v.pos) < minSpacing)) {
      selected.push(v.pos);
    }
  }
  return selected;
}

// Compute pixel std-dev for a rectangular region of an image (for wall detection)
async function computeSliceStdDev(imagePath: string, left: number, width: number, height: number): Promise<number> {
  const { data } = await sharp(imagePath)
    .extract({ left, top: 0, width, height })
    .resize({ width: 60, height: 120, fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = data.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += data[i];
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (data[i] - mean) ** 2;
  return Math.sqrt(variance / n);
}

// Find the darkest column within a search window in a row band.
// Used to locate the centre of the inter-book shadow gap at the top and bottom
// of the image for lean detection.
function findDarkestColumnAtRowBand(
  data: Buffer,
  analysisWidth: number,
  rowStart: number,
  rowEnd: number,
  searchCenter: number,
  searchRadius: number
): number {
  const lo = Math.max(0, searchCenter - searchRadius);
  const hi = Math.min(analysisWidth - 1, searchCenter + searchRadius);
  let minVal = Infinity, minPos = searchCenter;
  for (let x = lo; x <= hi; x++) {
    let sum = 0;
    for (let y = rowStart; y < rowEnd; y++) sum += data[y * analysisWidth + x];
    if (sum < minVal) { minVal = sum; minPos = x; }
  }
  return minPos;
}

// Solve Ax = b using Gaussian elimination with partial pivoting
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-10) throw new Error('Singular matrix in homography computation');
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// Compute the homography H that maps the destination rectangle (0,0)→(dstW,dstH)
// back to the source quadrilateral [tl, tr, br, bl].
// Used for inverse warping: for each destination pixel, find the source pixel.
function computeInverseHomography(
  srcCorners: [[number, number], [number, number], [number, number], [number, number]],
  dstW: number,
  dstH: number
): number[] {
  const dstCorners: [number, number][] = [[0, 0], [dstW, 0], [dstW, dstH], [0, dstH]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [xd, yd] = dstCorners[i];
    const [xs, ys] = srcCorners[i];
    A.push([xd, yd, 1, 0, 0, 0, -xd * xs, -yd * xs]);
    b.push(xs);
    A.push([0, 0, 0, xd, yd, 1, -xd * ys, -yd * ys]);
    b.push(ys);
  }
  const h = gaussianElimination(A, b);
  return [...h, 1]; // h[0..7], h[8]=1 (normalized)
}

// Bilinear sample from a raw pixel buffer at fractional coordinates
function bilinearSample(
  data: Buffer, width: number, height: number, channels: number,
  x: number, y: number
): number[] {
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(y)));
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const result = new Array(channels);
  for (let c = 0; c < channels; c++) {
    const p00 = data[(y0 * width + x0) * channels + c];
    const p01 = data[(y0 * width + x1) * channels + c];
    const p10 = data[(y1 * width + x0) * channels + c];
    const p11 = data[(y1 * width + x1) * channels + c];
    result[c] = (1 - fy) * ((1 - fx) * p00 + fx * p01) + fy * ((1 - fx) * p10 + fx * p11);
  }
  return result;
}

type Corners = {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
};

// Perspective-warp a quadrilateral from the source image into a rectangle
async function warpSpineFromBuffer(
  srcData: Buffer,
  srcW: number,
  srcH: number,
  channels: number,
  corners: Corners,
  outputPath: string
): Promise<void> {

  const outW = Math.round(((corners.tr[0] - corners.tl[0]) + (corners.br[0] - corners.bl[0])) / 2);
  const outH = srcH;
  if (outW <= 0) throw new Error(`Invalid spine width: ${outW}`);

  const H = computeInverseHomography([corners.tl, corners.tr, corners.br, corners.bl], outW, outH);
  const output = Buffer.alloc(outW * outH * channels);

  for (let yd = 0; yd < outH; yd++) {
    for (let xd = 0; xd < outW; xd++) {
      const w = H[6] * xd + H[7] * yd + H[8];
      const xs = (H[0] * xd + H[1] * yd + H[2]) / w;
      const ys = (H[3] * xd + H[4] * yd + H[5]) / w;
      if (xs >= 0 && xs < srcW && ys >= 0 && ys < srcH) {
        const pixels = bilinearSample(srcData, srcW, srcH, channels, xs, ys);
        for (let c = 0; c < channels; c++) {
          output[(yd * outW + xd) * channels + c] = Math.round(pixels[c]);
        }
      }
    }
  }

  await sharp(output, { raw: { width: outW, height: outH, channels: channels as 1 | 2 | 3 | 4 } })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

// Detect spine boundaries by finding columns with the strongest horizontal gradient.
// For each internal boundary, the x-position is found independently in the top and
// bottom bands of the image, capturing any lean in the spine.
// Slices that appear to be featureless wall/shelf sections are returned as null.
export async function autoSliceSpines(
  imagePath: string,
  spineCount: number,
  outputDir: string
): Promise<(SpineSlice | null)[]> {
  // Downsample for fast pixel analysis
  const ANALYSIS_HEIGHT = 200;
  const { data: analysisData, info: analysisInfo } = await sharp(imagePath)
    .resize({ height: ANALYSIS_HEIGHT, fit: 'contain' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const analysisWidth = analysisInfo.width;

  // Primary: find boundaries as dark valleys (the shadow gaps between books).
  // Each gap is a single well-defined minimum — no double-peak ambiguity.
  const colMean = new Float32Array(analysisWidth);
  for (let x = 0; x < analysisWidth; x++) {
    let sum = 0;
    for (let y = 0; y < ANALYSIS_HEIGHT; y++) sum += analysisData[y * analysisWidth + x];
    colMean[x] = sum / ANALYSIS_HEIGHT;
  }
  const valleySmooth = Math.max(3, Math.floor(analysisWidth / (spineCount * 4)));
  const smoothedMean = smoothArray(colMean, valleySmooth);
  const minSpacing = Math.floor(analysisWidth / (spineCount * 2));
  let globalBoundaries = findDeepestValleys(smoothedMean, spineCount - 1, minSpacing);

  // Fallback: gradient peaks if valley detection didn't find enough boundaries
  // (e.g. tightly packed books with no visible gap shadow).
  if (globalBoundaries.length < spineCount - 1) {
    const gradient = new Float32Array(analysisWidth);
    for (let x = 1; x < analysisWidth; x++) {
      let sum = 0;
      for (let y = 0; y < ANALYSIS_HEIGHT; y++) {
        sum += Math.abs(analysisData[y * analysisWidth + x] - analysisData[y * analysisWidth + x - 1]);
      }
      gradient[x] = sum;
    }
    const gradSmooth = Math.max(5, Math.floor(analysisWidth / (spineCount * 2)));
    const smoothedGrad = smoothArray(gradient, gradSmooth);
    globalBoundaries = findTopNPeaks(smoothedGrad, spineCount - 1, Math.floor(analysisWidth / spineCount));
  }

  const fullMeta = await sharp(imagePath).metadata();
  const fullWidth = fullMeta.width!;
  const fullHeight = fullMeta.height!;
  const scale = fullWidth / analysisWidth;

  // Top and bottom bands for lean detection (top/bottom quarter of analysis image).
  // Search radius is kept to 1/6 of expected spine width so adjacent boundary
  // searches cannot overlap and converge on the same gradient peak.
  const topBandEnd = Math.floor(ANALYSIS_HEIGHT / 4);
  const bottomBandStart = Math.floor(ANALYSIS_HEIGHT * 3 / 4);
  const searchRadius = Math.max(2, Math.floor(analysisWidth / (spineCount * 6)));

  // For each internal boundary, find x-position separately in top and bottom bands
  let internalBoundaries: { top: number; bottom: number }[];

  if (globalBoundaries.length === spineCount - 1) {
    const sorted = [...globalBoundaries].sort((a, b) => a - b);
    internalBoundaries = sorted.map(globalPos => ({
      top: Math.round(findDarkestColumnAtRowBand(analysisData, analysisWidth, 0, topBandEnd, globalPos, searchRadius) * scale),
      bottom: Math.round(findDarkestColumnAtRowBand(analysisData, analysisWidth, bottomBandStart, ANALYSIS_HEIGHT, globalPos, searchRadius) * scale),
    }));
  } else {
    // Fallback: equal-width vertical cuts (no lean)
    const sliceWidth = Math.floor(fullWidth / spineCount);
    internalBoundaries = Array.from({ length: spineCount - 1 }, (_, i) => {
      const x = (i + 1) * sliceWidth;
      return { top: x, bottom: x };
    });
  }

  // All N+1 boundaries — image edges are always perfectly vertical
  const boundaries = [
    { top: 0, bottom: 0 },
    ...internalBoundaries,
    { top: fullWidth, bottom: fullWidth },
  ];

  // Load full-res source image once for all warp operations
  const { data: srcData, info: srcInfo } = await sharp(imagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const slices: (SpineSlice | null)[] = [];

  for (let i = 0; i < spineCount; i++) {
    const left = boundaries[i];
    const right = boundaries[i + 1];

    // Bounding box of the (possibly slanted) parallelogram for wall detection
    const bboxLeft = Math.min(left.top, left.bottom);
    const bboxRight = Math.max(right.top, right.bottom);
    const bboxWidth = bboxRight - bboxLeft;

    if (bboxWidth <= 0) {
      slices.push(null);
      continue;
    }

    const stdDev = await computeSliceStdDev(imagePath, bboxLeft, bboxWidth, fullHeight);
    if (stdDev < WALL_STDDEV_THRESHOLD) {
      slices.push(null);
      continue;
    }

    const outputPath = path.join(outputDir, `spine_${String(i + 1).padStart(3, '0')}.jpg`);

    // A valid quadrilateral requires the right edge to be strictly right of the
    // left edge at both top and bottom. If the lean detection produced crossed or
    // coincident boundaries (two searches landing on the same peak), fall back to
    // a plain rectangular crop using the bounding box.
    const isValidQuad = right.top > left.top && right.bottom > left.bottom;

    if (isValidQuad) {
      const corners: Corners = {
        tl: [left.top, 0],
        tr: [right.top, 0],
        br: [right.bottom, fullHeight],
        bl: [left.bottom, fullHeight],
      };
      await warpSpineFromBuffer(srcData, srcInfo.width, srcInfo.height, srcInfo.channels, corners, outputPath);
    } else {
      await sharp(imagePath)
        .extract({ left: bboxLeft, top: 0, width: bboxWidth, height: fullHeight })
        .jpeg({ quality: 90 })
        .toFile(outputPath);
    }

    const outMeta = await sharp(outputPath).metadata();
    slices.push({ path: outputPath, widthPx: outMeta.width!, heightPx: outMeta.height! });
  }

  return slices;
}
