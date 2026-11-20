import archiver from 'archiver';
import type { FastifyInstance } from 'fastify';
import type { BookStatus } from '@scanner/shared';
import type { AppContext } from '../context.ts';
import { exportImageName, exportRows, toCsv } from '../export.ts';
import { publicBook } from '../repo.ts';

type Scope = BookStatus | 'all';

const scopeQuery = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['confirmed', 'unreviewed', 'skipped', 'all'], default: 'confirmed' } },
} as const;

/**
 * Downloads of the library. By default only confirmed books are exported.
 * The zip holds books.csv, books.json and every spine image, so it can be
 * moved to a machine with internet and imported into Notion or elsewhere.
 */
export async function exportRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo, storage } = ctx;

  async function load(scope: Scope) {
    return repo.listBooks(scope === 'all' ? {} : { status: scope });
  }

  app.get<{ Querystring: { status: Scope } }>('/api/export/books.csv', { schema: { querystring: scopeQuery } }, async (req, reply) => {
    const books = (await load(req.query.status)).map(publicBook);
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="books.csv"');
    return toCsv(exportRows(books));
  });

  app.get<{ Querystring: { status: Scope } }>('/api/export/books.json', { schema: { querystring: scopeQuery } }, async (req, reply) => {
    const books = (await load(req.query.status)).map(publicBook);
    reply.header('content-disposition', 'attachment; filename="books.json"');
    return exportRows(books);
  });

  app.get<{ Querystring: { status: Scope } }>('/api/export/library.zip', { schema: { querystring: scopeQuery } }, async (req, reply) => {
    const records = await load(req.query.status);
    const names = new Map<string, string>();
    records.forEach((b, i) => { if (b.imageFile) names.set(b.id, exportImageName(b, i)); });
    const rows = exportRows(records.map(publicBook), names);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.append(toCsv(rows), { name: 'books.csv' });
    zip.append(JSON.stringify(rows, null, 2), { name: 'books.json' });
    for (const b of records) {
      if (b.imageFile) zip.file(storage.spinePath(b.imageFile), { name: names.get(b.id)! });
    }
    void zip.finalize();

    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="library.zip"');
    return reply.send(zip);
  });
}
