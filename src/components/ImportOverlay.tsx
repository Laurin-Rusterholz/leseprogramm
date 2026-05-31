import { IconBook, IconSparkles } from './Icons';

export function ImportOverlay({
  title,
  stage,
  detail,
  progress,
  ai,
  onCancel,
}: {
  title: string;
  stage: string;
  detail?: string;
  /** 0..1 oder null für unbestimmt */
  progress: number | null;
  ai?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="import-overlay">
      <div className="import-card">
        <div className="big-icon">{ai ? <IconSparkles /> : <IconBook />}</div>
        <h3>{title}</h3>
        <div className="stage">{stage}</div>
        <div className={`progress ${progress === null ? 'indet' : ''}`}>
          <i style={{ width: progress === null ? undefined : `${Math.round(progress * 100)}%` }} />
        </div>
        {detail && (
          <div className="stage" style={{ fontSize: '0.82rem', marginTop: 10 }}>
            {detail}
          </div>
        )}
        {onCancel && (
          <button className="btn small" style={{ marginTop: 22 }} onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </div>
  );
}
