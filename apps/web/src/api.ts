// HTTP client for the Fastify server. Replaces the Electron app's window.api (IPC).
import type { Book, BookPatch, BookStatus, CropRegion, Photo, SliceResponse, UploadPhotoResponse } from '@scanner/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(detail.error ?? `${method} ${url} failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type ExportScope = BookStatus | 'all';

export const api = {
  uploadPhoto(file: Blob, name: string) {
    const form = new FormData();
    form.append('photo', file, name);
    return request<UploadPhotoResponse>('POST', '/api/photos', form);
  },
  getPhoto: (id: string) => request<Photo>('GET', `/api/photos/${id}`),
  sliceSpines: (photoId: string, spineCount: number) =>
    request<SliceResponse>('POST', `/api/photos/${photoId}/slice`, { spineCount }),

  listBooks(query: { photoId?: string; status?: BookStatus } = {}) {
    const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
    return request<Book[]>('GET', `/api/books${params.size ? `?${params}` : ''}`);
  },
  addBook: (patch: BookPatch) => request<Book>('POST', '/api/books', patch),
  updateBook: (id: string, patch: BookPatch) => request<Book>('PATCH', `/api/books/${id}`, patch),
  deleteBook: (id: string) => request<void>('DELETE', `/api/books/${id}`),
  readSpine: (id: string, overwrite = false) => request<Book>('POST', `/api/books/${id}/ocr`, { overwrite }),
  cropSpine: (id: string, region: CropRegion) => request<Book>('POST', `/api/books/${id}/crop`, region),

  exportUrl: (format: 'csv' | 'json' | 'zip', scope: ExportScope = 'confirmed') =>
    `/api/export/${format === 'zip' ? 'library.zip' : `books.${format}`}?status=${scope}`,
};
