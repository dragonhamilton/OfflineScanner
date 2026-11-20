import type { Book, Photo } from '@scanner/shared';

interface Props {
  photo: Photo;
  books: Book[];
  onClose: () => void;
}

/** The source photo next to every spine cut from it, to check the slicing. */
export default function DebugPanel({ photo, books, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-label="Slicing debug view"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#2a2a2a', borderBottom: '1px solid #3a3a3a' }}>
        <span style={{ fontWeight: 600 }}>Debug: slicing</span>
        <button onClick={onClose}>Close</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <section>
          <h2 className="section-label">Source photo ({photo.width}×{photo.height})</h2>
          <img src={photo.imageUrl} alt="Source" style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 6, border: '1px solid #444', objectFit: 'contain' }} />
        </section>

        <section>
          <h2 className="section-label">Spines ({books.length})</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {books.map(book => (
              <figure key={book.id} className="debug-spine">
                <span style={{ fontSize: 11, color: '#666' }}>#{book.position ?? '–'}</span>
                {book.imageUrl
                  ? <img src={book.imageUrl} alt={`Spine ${book.position}`} style={{ maxWidth: 140, maxHeight: 240, borderRadius: 4, border: '1px solid #444', objectFit: 'contain' }} />
                  : <div style={{ width: 80, height: 160, background: '#333', borderRadius: 4 }} />}
                <figcaption style={{ fontSize: 11, color: '#aaa', textAlign: 'center', wordBreak: 'break-word', maxWidth: 140 }}>
                  {book.title || book.rawOcr || '(no text)'}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
