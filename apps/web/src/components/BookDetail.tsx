import { useEffect, useState } from 'react';
import type { Book, BookPatch, CropRegion } from '@scanner/shared';
import { api } from '../api';
import SpineCropper from './SpineCropper';

interface Props {
  book: Book;
  onChanged: (book: Book) => void;
  onDeleted: (id: string) => void;
  /** Called after Confirm/Skip so the list can move to the next book. */
  onDone: () => void;
}

type Draft = Pick<Book, 'title' | 'author' | 'publisher' | 'notes'>;

const draftOf = (b: Book): Draft => ({ title: b.title, author: b.author, publisher: b.publisher, notes: b.notes });

export default function BookDetail({ book, onChanged, onDeleted, onDone }: Props) {
  const [draft, setDraft] = useState<Draft>(draftOf(book));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCropper, setShowCropper] = useState(false);

  useEffect(() => setDraft(draftOf(book)), [book]);

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some(k => draft[k] !== book[k]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = (patch: BookPatch = {}) =>
    run('save', async () => onChanged(await api.updateBook(book.id, { ...draft, ...patch })));

  const setStatus = (status: Book['status']) =>
    run(status, async () => {
      onChanged(await api.updateBook(book.id, { ...draft, status }));
      onDone();
    });

  const reread = () => run('ocr', async () => onChanged(await api.readSpine(book.id, true)));

  const crop = (region: CropRegion) =>
    run('crop', async () => {
      setShowCropper(false);
      await api.cropSpine(book.id, region);
      onChanged(await api.readSpine(book.id, true));
    });

  const remove = () =>
    run('delete', async () => {
      if (!confirm('Delete this book and its spine image?')) return;
      await api.deleteBook(book.id);
      onDeleted(book.id);
    });

  return (
    <div style={{ padding: 20, overflowY: 'auto', display: 'flex', gap: 20 }}>
      <div style={{ flexShrink: 0, width: 110 }}>
        {book.imageUrl ? (
          <>
            <img
              src={book.imageUrl}
              alt="Spine"
              style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 4, cursor: 'crosshair', border: '1px solid #444' }}
              onClick={() => setShowCropper(true)}
            />
            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Click to recrop</p>
          </>
        ) : (
          <span style={{ color: '#666', fontSize: 12 }}>Added by hand, no spine image</span>
        )}
      </div>

      <form
        style={{ flex: 1, minWidth: 0 }}
        onSubmit={e => { e.preventDefault(); void setStatus('confirmed'); }}
      >
        <h3 style={{ marginBottom: 16, color: '#aaa', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
          {book.position ? `Spine ${book.position}` : 'Book'}
        </h3>

        <Field label="Title">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} autoFocus />
        </Field>
        <Field label="Author">
          <input value={draft.author} onChange={e => setDraft({ ...draft, author: e.target.value })} />
        </Field>
        <Field label="Publisher">
          <input value={draft.publisher} onChange={e => setDraft({ ...draft, publisher: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea value={draft.notes} rows={3} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
        </Field>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="submit" className="primary" disabled={!!busy}>Confirm</button>
          <button type="button" onClick={() => setStatus('skipped')} disabled={!!busy}>Skip</button>
          <button type="button" onClick={() => save()} disabled={!!busy || !dirty}>Save</button>
          {book.imageUrl && (
            <button type="button" onClick={reread} disabled={!!busy}>{busy === 'ocr' ? 'Reading…' : 'Read again'}</button>
          )}
          <button type="button" onClick={remove} disabled={!!busy} className="danger">Delete</button>
        </div>
        {error && <p role="alert" style={{ color: '#f44336', marginBottom: 12 }}>{error}</p>}

        <Field label={`Text found on the spine${book.ocrConfidence !== null ? ` (${Math.round(book.ocrConfidence * 100)}% confidence)` : ''}`}>
          <pre className="ocr-text">{book.rawOcr || (book.ocrConfidence === null ? 'Not read yet' : 'No text found')}</pre>
        </Field>
        <p style={{ fontSize: 11, color: '#666' }}>
          {[book.widthPx && book.heightPx ? `${book.widthPx}×${book.heightPx}px` : null, book.color].filter(Boolean).join(' · ')}
        </p>
      </form>

      {showCropper && book.imageUrl && (
        <SpineCropper imageUrl={book.imageUrl} onCrop={crop} onClose={() => setShowCropper(false)} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
