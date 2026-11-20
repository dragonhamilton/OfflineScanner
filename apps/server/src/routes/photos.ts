import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SliceResponse, UploadPhotoResponse } from '@scanner/shared';
import { HttpError, notFound, type AppContext } from '../context.ts';
import { autoSliceSpines, dominantColor, estimateSpineCount, normalizePhoto } from '../image-processing.ts';
import { publicBook, publicPhoto, type NewSpine } from '../repo.ts';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export async function photoRoutes(app: FastifyInstance, ctx: AppContext) {
  const { repo, storage } = ctx;

  // Upload a shelf photo (multipart field "photo").
  app.post('/api/photos', async (req): Promise<UploadPhotoResponse> => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'no file uploaded');
    const input = await file.toBuffer();

    const id = randomUUID();
    const fileName = `${id}.jpg`;
    let size: { width: number; height: number };
    try {
      size = await normalizePhoto(input, storage.photoPath(fileName));
    } catch {
      throw new HttpError(400, 'the upload is not an image sharp can read');
    }

    const photo = await repo.insertPhoto({ id, fileName, originalName: file.filename ?? '', ...size });
    const estimatedSpineCount = await estimateSpineCount(storage.photoPath(fileName));
    return { photo: publicPhoto(photo), estimatedSpineCount };
  });

  app.get<{ Params: { id: string } }>('/api/photos/:id', { schema: { params: idParams } }, async req => {
    const photo = await repo.getPhoto(req.params.id);
    if (!photo) throw notFound('photo');
    return publicPhoto(photo);
  });

  // Slice a photo into spines. Replaces earlier unreviewed spines of the same photo.
  app.post<{ Params: { id: string }; Body: { spineCount: number } }>(
    '/api/photos/:id/slice',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['spineCount'],
          properties: { spineCount: { type: 'integer', minimum: 1, maximum: 150 } },
        },
      },
    },
    async (req): Promise<SliceResponse> => {
      const photo = await repo.getPhoto(req.params.id);
      if (!photo) throw notFound('photo');

      const batchDir = path.join(storage.spinesDir, photo.id, String(Date.now()));
      await fs.mkdir(batchDir, { recursive: true });
      const slices = await autoSliceSpines(storage.photoPath(photo.fileName), req.body.spineCount, batchDir);

      const spines: NewSpine[] = [];
      for (const [i, slice] of slices.entries()) {
        if (!slice) continue;
        spines.push({
          photoId: photo.id,
          position: i + 1,
          imageFile: storage.spineRelative(slice.path),
          widthPx: slice.widthPx,
          heightPx: slice.heightPx,
          color: await dominantColor(slice.path),
        });
      }

      const { removedFiles, books } = await repo.replaceUnreviewedSpines(photo.id, spines);
      await Promise.all(removedFiles.map(f => fs.rm(storage.spinePath(f), { force: true })));
      return { books: books.map(publicBook), skippedSlices: slices.length - spines.length };
    },
  );
}
