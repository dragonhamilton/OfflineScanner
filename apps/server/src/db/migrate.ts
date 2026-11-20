import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from './pool.ts';
import { createPool } from './pool.ts';
import { env } from '../env.ts';

/** Applies db/migrations/*.sql in name order, each once, each in a transaction. */
export async function runMigrations(pool: Pool, dir = env.migrationsDir, log = console.log): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(r => r.name));
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`applied migration ${file}`);
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

// CLI: pnpm db:migrate
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool(env.databaseUrl);
  runMigrations(pool)
    .then(ran => console.log(ran.length ? `done (${ran.length} applied)` : 'database is up to date'))
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
