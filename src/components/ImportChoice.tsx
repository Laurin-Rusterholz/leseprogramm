import { Modal } from './Modal';
import { IconSparkles, IconText } from './Icons';

export type ExtractMethod = 'ki' | 'text';

export function ImportChoice({
  fileName,
  count,
  hasKey,
  onChoose,
  onClose,
}: {
  fileName: string;
  count: number;
  hasKey: boolean;
  onChoose: (method: ExtractMethod) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={count > 1 ? `${count} PDFs importieren` : `„${fileName}“ importieren`} onClose={onClose}>
      <p className="hint" style={{ marginTop: -6 }}>
        Wie soll der Text gewonnen werden?
      </p>

      <button className="choice" onClick={() => onChoose('text')}>
        <span className="ic">
          <IconText />
        </span>
        <span className="txt">
          <b>
            Schnell (Textebene) <span className="tag">empfohlen</span>
          </b>
          <span>
            Nutzt die im PDF hinterlegte Textebene – sofort fertig und kostenlos. Für die meisten
            digitalen Bücher die richtige Wahl. Bei zu wenig Text wird automatisch die KI angeboten.
          </span>
        </span>
      </button>

      <button className="choice" onClick={() => onChoose('ki')} disabled={!hasKey}>
        <span className="ic">
          <IconSparkles />
        </span>
        <span className="txt">
          <b>Genau lesen (KI)</b>
          <span>
            Die KI liest jede Seite als Bild. Für gescannte oder schwierige PDFs, bei denen die
            Textebene unbrauchbar ist. Braucht einen Gemini-Schlüssel; dauert je nach Seitenzahl.
          </span>
        </span>
      </button>

      {!hasKey && (
        <p className="hint">
          Für „Genau lesen (KI)“ zuerst einen Gemini-Schlüssel in den Einstellungen hinterlegen.
        </p>
      )}
    </Modal>
  );
}
