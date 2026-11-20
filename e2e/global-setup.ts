import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SHELF_FIXTURE = path.join(import.meta.dirname, 'fixtures/generated/shelf.jpg');

/** Draws the synthetic 8-book shelf used by the tests (no binary files in git). */
export default function globalSetup() {
  fs.mkdirSync(path.dirname(SHELF_FIXTURE), { recursive: true });
  execFileSync('pnpm', ['--filter', '@scanner/server', 'exec', 'tsx', 'test/synthetic-shelf.ts', SHELF_FIXTURE], {
    stdio: 'inherit',
  });
}
