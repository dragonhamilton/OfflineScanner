import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Files live under DATA_DIR:
 *   photos/<photoId>.jpg            uploaded shelf photos (normalised to JPEG)
 *   spines/<photoId>/<batch>/...    spine crops, one folder per slicing run
 *   tmp/                            scratch files for OCR
 * The database stores paths relative to photos/ and spines/.
 */
export class Storage {
  readonly photosDir: string;
  readonly spinesDir: string;
  readonly tmpDir: string;

  constructor(readonly dataDir: string) {
    this.photosDir = path.join(dataDir, 'photos');
    this.spinesDir = path.join(dataDir, 'spines');
    this.tmpDir = path.join(dataDir, 'tmp');
  }

  async init(): Promise<void> {
    await Promise.all([this.photosDir, this.spinesDir, this.tmpDir].map(d => fs.mkdir(d, { recursive: true })));
  }

  photoPath(fileName: string): string {
    return path.join(this.photosDir, fileName);
  }

  spinePath(relative: string): string {
    return path.join(this.spinesDir, relative);
  }

  /** Relative path (inside spines/) of a spine file. */
  spineRelative(absolute: string): string {
    return path.relative(this.spinesDir, absolute).split(path.sep).join('/');
  }

  static photoUrl(fileName: string): string {
    return `/files/photos/${encodeURI(fileName)}`;
  }

  static spineUrl(relative: string): string {
    return `/files/spines/${encodeURI(relative)}`;
  }
}
