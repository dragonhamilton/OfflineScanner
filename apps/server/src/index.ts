import { buildApp } from './app.ts';
import type { AppContext } from './context.ts';
import { runMigrations } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { env, repoRoot } from './env.ts';
import { createOcrEngine, type OcrEngine } from './ocr/index.ts';
import { Repo } from './repo.ts';
import { Storage } from './storage.ts';

const pool = createPool(env.databaseUrl);
const storage = new Storage(env.dataDir);
await storage.init();
await runMigrations(pool);

let ocr: Promise<OcrEngine> | null = null;
const ctx: AppContext = {
  repo: new Repo(pool),
  storage,
  getOcr() {
    ocr ??= createOcrEngine(env.ocrEngine, { repoRoot, tmpDir: storage.tmpDir }).catch(err => {
      ocr = null; // allow a retry on the next request
      throw err;
    });
    return ocr;
  },
};

const app = await buildApp({ ctx, ocrEngineName: env.ocrEngine, webDist: env.webDist });
await app.listen({ host: env.host, port: env.port });

async function shutdown() {
  await app.close();
  if (ocr) await (await ocr).close().catch(() => undefined);
  await pool.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
