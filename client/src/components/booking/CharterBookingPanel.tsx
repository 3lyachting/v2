import { useMemo, useState } from "react";
import type { BookingMode, BookingRequest, BookingWeek } from "./bookingTypes";
import { calculateEstimatedTotal, formatDateRangeFr, formatEuro, getAvailability, validateBookingRules } from "./bookingUtils";

interface CharterBookingPanelProps {
  week: BookingWeek | null;
  onSubmit: (request: Omit<BookingRequest, "id" | "createdAt" | "status">) => Promise<void>;
  submitting?: boolean;
  submitError?: string | null;
}

const initialForm = { fullName: "", email: "", phone: "", message: "", peopleCount: 1 as number };

export function CharterBookingPanel({ week, onSubmit, submitting = false, submitError = null }: CharterBookingPanelProps) {
  const [mode, setMode] = useState<BookingMode>("private");
  const [form, setForm] = useState(initialForm);
  const [localSuccess, setLocalSuccess] = useState(false);

  const total = useMemo(() => {
    if (!week) return 0;
    return calculateEstimatedTotal(week, mode, form.peopleCount);
  }, [form.peopleCount, mode, week]);

  if (!week) {
    return <div className="charter-panel-empty">Selectionnez une semaine pour afficher votre devis et faire une demande.</div>;
  }

  const availability = getAvailability(week);
  const ruleError = validateBookingRules(week, mode, form.peopleCount);
  const canSubmit = !ruleError && form.fullName && form.email;

  return (
    <div className="charter-panel">
      <h3>Votre sélection</h3>
      <p className="charter-muted">{formatDateRangeFr(week.startDate, week.endDate)}</p>

      <div className="charter-mode-switch" role="radiogroup" aria-label="Choix du mode de réservation">
        <button type="button" className={`charter-chip ${mode === "private" ? "is-active" : ""}`} onClick={() => setMode("private")}>
          Privatisation
        </button>
        <button type="button" className={`charter-chip ${mode === "cabin" ? "is-active" : ""}`} onClick={() => setMode("cabin")}>
          Cabine
        </button>
      </div>

      {!availability.privateAllowed && mode === "private" && (
        <p className="charter-error">Privatisation indisponible: des cabines sont déjà réservées.</p>
      )}

      {mode === "cabin" && (
        <label className="charter-field">
          <span>Nombre de passagers</span>
          <input
            type="number"
            min={1}
            max={8}
            value={form.peopleCount}
            onChange={(event) => setForm((prev) => ({ ...prev, peopleCount: Number(event.target.value) || 1 }))}
          />
        </label>
      )}

      <div className="charter-estimate">
        <span>Total estimé</span>
        <strong>{formatEuro(total)}</strong>
      </div>

      <form
        className="charter-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSubmit || submitting) return;
          await onSubmit({
            weekId: week.id,
            disponibiliteId: week.disponibiliteId,
            mode,
            peopleCount: mode === "private" ? week.totalPeople : form.peopleCount,
            fullName: form.fullName,
            email: form.email,
            phone: form.phone,
            message: form.message,
            estimatedTotal: total,
          });
          setLocalSuccess(true);
          setForm(initialForm);
        }}
      >
        <label className="charter-field">
          <span>Nom complet *</span>
          <input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} required />
        </label>
        <label className="charter-field">
          <span>Email *</span>
          <input type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} required />
        </label>
        <label className="charter-field">
          <span>Téléphone</span>
          <input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} />
        </label>
        <label className="charter-field">
          <span>Message</span>
          <textarea rows={3} value={form.message} onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))} />
        </label>

        {ruleError && <p className="charter-error">{ruleError}</p>}
        {submitError && <p className="charter-error">{submitError}</p>}
        {localSuccess && <p className="charter-success">Demande envoyée avec succès. Nous revenons vers vous rapidement.</p>}

        <button className="charter-btn charter-btn--primary" type="submit" disabled={!canSubmit || submitting}>
          {submitting ? "Envoi en cours..." : "Envoyer la demande"}
        </button>
      </form>
    </div>
  );
}
