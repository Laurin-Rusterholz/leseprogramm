import type { BookMeta } from '../lib/types';
import { Uploader } from './Uploader';
import { IconTrash, IconList, IconText, IconSparkles } from './Icons';

function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  // im warmen Bereich bleiben (-30°…+50° um die Akzentfarbe)
  return ((h % 80) - 30);
}

function fmtNumber(n: number): string {
  return n.toLocaleString('de-CH');
}

export function Library({
  books,
  hasKey,
  onOpen,
  onDelete,
  onFiles,
}: {
  books: BookMeta[];
  hasKey: boolean;
  onOpen: (id: string) => void;
  onDelete: (book: BookMeta) => void;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div>
      <div className="hero">
        <h1>
          Lies in deinem <em>Tempo</em>.
        </h1>
        <p>
          Lade ein Buch als PDF hoch. Die KI gliedert es in Kapitel – dann liest du klassisch
          oder Wort für Wort im Fokus-Modus, ganz wie es dir gefällt.
        </p>
      </div>

      <Uploader onFiles={onFiles} />

      {!hasKey && (
        <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
          <IconSparkles width={15} height={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Für die KI-Kapitel hinterlege oben rechts einen Google-Gemini-Schlüssel. Ohne Schlüssel
          werden Kapitel automatisch geschätzt.
        </p>
      )}

      <div className="section-head">
        <h2>Deine Bibliothek</h2>
        <span className="count">{books.length === 0 ? 'noch leer' : `${books.length} Bücher`}</span>
      </div>

      {books.length === 0 ? (
        <div className="empty">Noch keine Bücher – lade dein erstes PDF hoch.</div>
      ) : (
        <div className="library">
          {books.map((b) => (
            <div
              key={b.id}
              className="book-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(b.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(b.id);
                }
              }}
            >
              <button
                type="button"
                className="del"
                aria-label="Buch löschen"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(b);
                }}
              >
                <IconTrash />
              </button>
              <div className="book-cover" style={{ filter: `hue-rotate(${hueFor(b.id)}deg)` }}>
                <span className="spine" />
                <span className="cover-title">{b.title}</span>
              </div>
              <div className="book-meta">
                <div className="bt">{b.title}</div>
                {b.author && <div className="ba">{b.author}</div>}
                <div className="bstats">
                  <span>
                    <IconList width={13} height={13} /> {b.chapterCount} Kap.
                  </span>
                  <span>
                    <IconText width={13} height={13} /> {fmtNumber(b.wordCount)} Wörter
                  </span>
                  {b.chapterSource === 'ki' && (
                    <span style={{ color: 'var(--accent)' }}>
                      <IconSparkles width={13} height={13} /> KI
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
