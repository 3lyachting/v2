import type { BookingRequest, BookingWeek } from "./bookingTypes";
import { CharterBookingPanel } from "./CharterBookingPanel";

interface CharterRequestModalProps {
  open: boolean;
  week: BookingWeek | null;
  onClose: () => void;
  onSubmit: (request: Omit<BookingRequest, "id" | "createdAt" | "status">) => Promise<void>;
  submitting?: boolean;
  submitError?: string | null;
}

export function CharterRequestModal({ open, week, onClose, onSubmit, submitting = false, submitError = null }: CharterRequestModalProps) {
  if (!open) return null;

  return (
    <div className="charter-modal-backdrop" role="dialog" aria-modal="true" aria-label="Demande de réservation">
      <div className="charter-modal">
        <button type="button" className="charter-modal-close" onClick={onClose} aria-label="Fermer la fenêtre">
          Fermer
        </button>
        <CharterBookingPanel week={week} onSubmit={onSubmit} submitting={submitting} submitError={submitError} />
      </div>
    </div>
  );
}
