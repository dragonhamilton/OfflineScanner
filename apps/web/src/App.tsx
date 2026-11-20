import { useState } from 'react';
import type { Book, BookStatus, Photo } from '@scanner/shared';
import { api, type ExportScope } from './api';
import BookDetail from './components/BookDetail';
import BookList from './components/BookList';
import CaptureView from './components/CaptureView';
import DebugPanel from './components/DebugPanel';
import { useBooks, type BookQuery } from './hooks/useBooks';

type View = { kind: 'scan' } | { kind: 'review'; photo: Photo } | { kind: 'library' };

export default function App() {
  const [view, setView] = useState<View>({ kind: 'scan' });

  return (
    <div className="app">
      <header className="app-header">
        <h1>OfflineScanner</h1>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView({ kind: 'scan' })} aria-pressed={view.kind === 'scan'}>Scan</button>
          <button onClick={() => setView({ kind: 'library' })} aria-pressed={view.kind === 'library'}>Library</button>
        </nav>
      </header>

      {view.kind === 'scan' && <CaptureView onScanned={photo => setView({ kind: 'review', photo })} />}
      {view.kind === 'review' && <Review key={view.photo.id} photo={view.photo} onRescan={() => setView({ kind: 'scan' })} />}
      {view.kind === 'library' && <Library />}
    </div>
  );
}

/** Review the spines of one photo. */
function Review({ photo, onRescan }: { photo: Photo; onRescan: () => void }) {
  const [showDebug, setShowDebug] = useState(false);
  const list = useBooks({ photoId: photo.id });
  const toReview = list.books.filter(b => b.status === 'unreviewed').length;

  return (
    <>
      <Workspace
        list={list}
        heading={`${list.books.length} spines · ${toReview} to review`}
        toolbar={
          <>
            <button onClick={() => setShowDebug(true)}>Debug</button>
            <button onClick={onRescan}>New scan</button>
          </>
        }
      />
      {showDebug && <DebugPanel photo={photo} books={list.books} onClose={() => setShowDebug(false)} />}
    </>
  );
}

const FILTERS: { label: string; status?: BookStatus }[] = [
  { label: 'All' },
  { label: 'To review', status: 'unreviewed' },
  { label: 'Confirmed', status: 'confirmed' },
  { label: 'Skipped', status: 'skipped' },
];

/** Every book, filtered by status, with export links. */
function Library() {
  const [status, setStatus] = useState<BookStatus | undefined>(undefined);
  const query: BookQuery = { status };
  const list = useBooks(query);
  const scope: ExportScope = status ?? 'all';

  async function addBook() {
    const book = await api.addBook({});
    list.replace(book);
    return book.id;
  }

  return (
    <Workspace
      list={list}
      heading={`${list.books.length} books`}
      onAdd={addBook}
      toolbar={
        <>
          <select value={status ?? ''} onChange={e => setStatus((e.target.value || undefined) as BookStatus | undefined)} aria-label="Filter by status">
            {FILTERS.map(f => <option key={f.label} value={f.status ?? ''}>{f.label}</option>)}
          </select>
          <span style={{ color: '#888', fontSize: 12 }}>Export:</span>
          <a className="button" href={api.exportUrl('csv', scope)} download>CSV</a>
          <a className="button" href={api.exportUrl('json', scope)} download>JSON</a>
          <a className="button" href={api.exportUrl('zip', scope)} download>ZIP with images</a>
        </>
      }
    />
  );
}

/** Book list on the left, the selected book on the right. */
function Workspace({
  list,
  heading,
  toolbar,
  onAdd,
}: {
  list: ReturnType<typeof useBooks>;
  heading: string;
  toolbar?: React.ReactNode;
  onAdd?: () => Promise<string>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.books.find(b => b.id === selectedId) ?? null;

  // After confirming or skipping, jump to the next book that still needs review.
  function selectNext(from: Book) {
    const i = list.books.findIndex(b => b.id === from.id);
    const next = [...list.books.slice(i + 1), ...list.books.slice(0, i)].find(b => b.status === 'unreviewed');
    setSelectedId(next?.id ?? null);
  }

  return (
    <div className="review-layout">
      <BookList
        books={list.books}
        heading={list.error ? `Error: ${list.error}` : heading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        toolbar={
          <>
            {toolbar}
            {onAdd && <button onClick={async () => setSelectedId(await onAdd())}>+ Add book</button>}
          </>
        }
      />
      {selected ? (
        <BookDetail
          key={selected.id}
          book={selected}
          onChanged={list.replace}
          onDeleted={id => { list.remove(id); setSelectedId(null); }}
          onDone={() => selectNext(selected)}
        />
      ) : (
        <p style={{ padding: 20, color: '#777' }}>Select a book to review it.</p>
      )}
    </div>
  );
}
