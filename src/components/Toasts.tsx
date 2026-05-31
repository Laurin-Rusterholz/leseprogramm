import { IconClose } from './Icons';

export type ToastType = 'info' | 'error' | 'success';
export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export function Toasts({ items, onClose }: { items: ToastItem[]; onClose: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.message}</span>
          <button className="close" onClick={() => onClose(t.id)} aria-label="Schließen">
            <IconClose width={16} height={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
