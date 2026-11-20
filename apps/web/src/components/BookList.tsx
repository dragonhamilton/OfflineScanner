import type { Book } from '@scanner/shared';

interface Props {
  books: Book[];
  heading: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar?: React.ReactNode;
}

function ConfidenceDot({ score }: { score: number | null }) {
  if (score === null) return <span className="confidence-dot confidence-none" title="Not read yet" />;
  const cls = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  return <span className={`confidence-dot confidence-${cls}`} title={`OCR confidence ${Math.round(score * 100)}%`} />;
}

const STATUS_LABEL: Record<Book['status'], string> = {
  unreviewed: 'To review',
  confirmed: 'Confirmed',
  skipped: 'Skipped',
};

export default function BookList({ books, heading, selectedId, onSelect, toolbar }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #3a3a3a' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #3a3a3a', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, color: '#aaa' }}>{heading}</span>
        {toolbar}
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#2a2a2a', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', width: 28 }} />
              <th style={{ padding: '8px 12px', width: 44 }}>#</th>
              <th style={{ padding: '8px 12px' }}>Title</th>
              <th style={{ padding: '8px 12px' }}>Author</th>
              <th style={{ padding: '8px 12px' }}>Status</th>
              <th style={{ padding: '8px 12px', width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {books.map(book => (
              <tr
                key={book.id}
                onClick={() => onSelect(book.id)}
                aria-selected={selectedId === book.id}
                style={{
                  background: selectedId === book.id ? '#2d3f4f' : 'transparent',
                  borderBottom: '1px solid #2a2a2a',
                  cursor: 'pointer',
                }}
              >
                <td style={{ padding: '8px 12px' }}>
                  <span className="swatch" style={{ background: book.color ?? 'transparent' }} />
                </td>
                <td style={{ padding: '8px 12px', color: '#888' }}>{book.position ?? '–'}</td>
                <td style={{ padding: '8px 12px', color: book.title ? '#e0e0e0' : '#888' }}>
                  {book.title || book.rawOcr.split('\n')[0] || '(untitled)'}
                </td>
                <td style={{ padding: '8px 12px', color: '#bbb' }}>{book.author}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span className={`status status-${book.status}`}>{STATUS_LABEL[book.status]}</span>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <ConfidenceDot score={book.ocrConfidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {books.length === 0 && <p style={{ padding: 16, color: '#777' }}>No books here yet.</p>}
      </div>
    </div>
  );
}
