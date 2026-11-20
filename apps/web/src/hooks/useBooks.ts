import { useCallback, useEffect, useState } from 'react';
import type { Book, BookStatus } from '@scanner/shared';
import { api } from '../api';

export interface BookQuery {
  photoId?: string;
  status?: BookStatus;
}

/** Books from the server for one query, with helpers to keep the list in sync after edits. */
export function useBooks(query: BookQuery) {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { photoId, status } = query;

  const reload = useCallback(async () => {
    try {
      setBooks(await api.listBooks({ photoId, status }));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [photoId, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const replace = useCallback((book: Book) => {
    setBooks(prev => (prev.some(b => b.id === book.id) ? prev.map(b => (b.id === book.id ? book : b)) : [...prev, book]));
  }, []);

  const remove = useCallback((id: string) => {
    setBooks(prev => prev.filter(b => b.id !== id));
  }, []);

  return { books, error, reload, replace, remove };
}
