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

      <button className="choice" onClick={() => onChoose('ki')} disabled={!hasKey}>
        <span className="ic">
          <IconSparkles />
        </span>
        <span className="txt">
          <b>
            Genau lesen (KI) <span className="tag">empfohlen</span>
          </b>
          <span>
            Die KI liest jede Seite als Bild. Am zuverlässigsten – auch bei schwierigen Schriften
            oder gescannten PDFs. Braucht einen Gemini-Schlüssel; dauert je nach Seitenzahl etwas.
          </span>
        </span>
      </button>

      <button className="choice" onClick={() => onChoose('text')}>
        <span className="ic" style={{ background: 'var(--paper-3)', color: 'var(--ink-soft)' }}>
          <IconText />
        </span>
        <span className="txt">
          <b>Schnell (Textebene)</b>
          <span>
            Nutzt die im PDF hinterlegte Textebene. Sofort fertig – bei manchen PDFs aber
            unvollständig (z. B. wenn nur Überschriften erkannt werden).
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
