import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { BOOK_STATUSES, type BookPatch, type BookStatus, type CropRegion } from '@scanner/shared';
import { HttpError, notFound, type AppContext } from '../context.ts';
import { cropImage, dominantColor } from '../image-processing.ts';
import { readSpine } from '../ocr/index.ts';
import { publicBook } from '../repo.ts';
import { guessFields } from '../spine-text.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const patchBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 1000 },
    author: { type: 'string', maxLength: 1000 },
    publisher: { type: 'string', maxLength: 1000 },
    notes: { type: 'string', maxLength: 10000 },
    status: { type: 'string', enum: [...BOOK_STATUSES] },
  },
} as const;

export async function bookRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo, storage } = ctx;

  app.get<{ Querystring: { photoId?: string; status?: BookStatus } }>(
    '/api/books',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            photoId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: [...BOOK_STATUSES] },
          },
        },
      },
    },
    async req => (await repo.listBooks(req.query)).map(publicBook),
  );

  // Add a book by hand (no photo).
  app.post<{ Body: BookPatch }>('/api/books', { schema: { body: patchBody } }, async (req, reply) => {
    reply.code(201);
    return publicBook(await repo.insertManualBook(req.body));
  });

  app.get<{ Params: { id: string } }>('/api/books/:id', { schema: { params: idParams } }, async req => {
    const book = await repo.getBook(req.params.id);
    if (!book) throw notFound('book');
    return publicBook(book);
  });

  app.patch<{ Params: { id: string }; Body: BookPatch }>(
    '/api/books/:id',
    { schema: { params: idParams, body: patchBody } },
    async req => {
      const book = await repo.updateBook(req.params.id, req.body);
      if (!book) throw notFound('book');
      return publicBook(book);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/books/:id', { schema: { params: idParams } }, async (req, reply) => {
    const book = await repo.deleteBook(req.params.id);
    if (!book) throw notFound('book');
    if (book.imageFile) await fs.rm(storage.spinePath(book.imageFile), { force: true });
    reply.code(204);
  });

  // Read the spine with OCR and fill in title/author/publisher.
  // Fields the reviewer already filled are kept unless overwrite is true.
  app.post<{ Params: { id: string }; Body: { overwrite?: boolean } | undefined }>(
    '/api/books/:id/ocr',
    {
      schema: {
        params: idParams,
        body: { type: ['object', 'null'], properties: { overwrite: { type: 'boolean' } } },
      },
    },
    async req => {
      const book = await repo.getBook(req.params.id);
      if (!book) throw notFound('book');
      if (!book.imageFile) throw new HttpError(409, 'this book has no spine image to read');

      const reading = await readSpine(await ctx.getOcr(), storage.spinePath(book.imageFile));
      const updated = await repo.updateOcr(
        book.id,
        { rawOcr: reading.rawText, lines: reading.lines, confidence: reading.confidence },
        guessFields(reading.lines),
        req.body?.overwrite ?? false,
      );
      return publicBook(updated!);
    },
  );

  // Crop the current spine image (coordinates are in that image's pixels).
  app.post<{ Params: { id: string }; Body: CropRegion }>(
    '/api/books/:id/crop',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['x', 'y', 'width', 'height'],
          properties: {
            x: { type: 'number', minimum: 0 },
            y: { type: 'number', minimum: 0 },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
          },
        },
      },
    },
    async req => {
      const book = await repo.getBook(req.params.id);
      if (!book) throw notFound('book');
      if (!book.imageFile) throw new HttpError(409, 'this book has no spine image to crop');

      const source = storage.spinePath(book.imageFile);
      const target = source.replace(/(_crop\d+)?\.jpg$/, `_crop${Date.now()}.jpg`);
      const size = await cropImage(source, req.body, target);
      const updated = await repo.updateSpineImage(book.id, {
        imageFile: storage.spineRelative(target),
        widthPx: size.width,
        heightPx: size.height,
        color: await dominantColor(target),
      });
      // Keep the original slice; remove earlier crops.
      if (path.basename(source).includes('_crop')) await fs.rm(source, { force: true });
      return publicBook(updated!);
    },
  );
}
