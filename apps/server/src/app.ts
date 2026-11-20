import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { HttpError, type AppContext } from './context.ts';
import { bookRoutes } from './routes/books.ts';
import { exportRoutes } from './routes/export.ts';
import { photoRoutes } from './routes/photos.ts';

export interface AppOptions {
  ctx: AppContext;
  ocrEngineName: string;
  /** Built web client to serve at "/", if it exists. */
  webDist?: string;
  logger?: boolean;
}

export async function buildApp({ ctx, ocrEngineName, webDist, logger = true }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });

  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : err.validation ? 400 : (err.statusCode ?? 500);
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  // Photos and spine crops.
  await app.register(fastifyStatic, {
    root: ctx.storage.dataDir,
    prefix: '/files/',
    allowedPath: p => p.startsWith('/photos/') || p.startsWith('/spines/'),
    maxAge: '1d',
    immutable: true,
  });

  app.get('/api/health', async () => {
    await ctx.repo.ping();
    return { ok: true, ocrEngine: ocrEngineName };
  });

  await photoRoutes(app, ctx);
  await bookRoutes(app, ctx);
  await exportRoutes(app, ctx);

  // Built client (pnpm build). In development Vite serves it instead.
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: false, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/files/')) {
        return reply.type('text/html').send(fs.createReadStream(path.join(webDist, 'index.html')));
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}
