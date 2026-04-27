import { useMemo, useState } from "react";
import type { BookingMode, BookingRangeSelection, BookingRequest } from "./bookingTypes";
import { calculateEstimatedRangeTotal, formatDateRangeFr, formatEuro, getAvailability, validateBookingRules } from "./bookingUtils";

interface CharterBookingPanelProps {
  selection: BookingRangeSelection | null;
  onSubmit: (request: Omit<BookingRequest, "id" | "createdAt" | "status">) => Promise<void>;
  submitting?: boolean;
  submitError?: string | null;
}

const initialForm = { fullName: "", email: "", phone: "", message: "", peopleCount: 1 as number };

export function CharterBookingPanel({ selection, onSubmit, submitting = false, submitError = null }: CharterBookingPanelProps) {
  const [mode, setMode] = useState<BookingMode>("private");
  const [form, setForm] = useState(initialForm);
  const [localSuccess, setLocalSuccess] = useState(false);

  const total = useMemo(() => {
    if (!selection) return 0;
    return calculateEstimatedRangeTotal(selection, mode, form.peopleCount);
  }, [form.peopleCount, mode, selection]);

  if (!selection) {
    return <div className="charter-panel-empty">Selectionnez une date de depart puis une date de retour pour afficher votre devis.</div>;
  }

  const minAvailability = selection.days.reduce(
    (acc, day) => {
      const dayAvailability = getAvailability(day);
      return {
        cabinsRemaining: Math.min(acc.cabinsRemaining, dayAvailability.cabinsRemaining),
        peopleRemaining: Math.min(acc.peopleRemaining, dayAvailability.peopleRemaining),
        privateAllowed: acc.privateAllowed && dayAvailability.privateAllowed,
      };
    },
    { cabinsRemaining: Number.POSITIVE_INFINITY, peopleRemaining: Number.POSITIVE_INFINITY, privateAllowed: true },
  );
  const maxPeopleForRangeRaw = selection.days.reduce((acc, day) => Math.min(acc, day.totalPeople), Number.POSITIVE_INFINITY);
  const maxPeopleForRange = Number.isFinite(maxPeopleForRangeRaw) ? maxPeopleForRangeRaw : 8;
  const daysRuleError = selection.days.map((day) => validateBookingRules(day, mode, form.peopleCount)).find(Boolean) || null;
  const rangeRuleError =
    mode === "private" && !minAvailability.privateAllowed
      ? "La privatisation est indisponible sur au moins un jour de la plage."
      : mode === "cabin" && form.peopleCount > minAvailability.peopleRemaining
        ? "Nombre de passagers supérieur aux places restantes sur la plage sélectionnée."
        : null;
  const ruleError = daysRuleError || rangeRuleError;
  const canSubmit = !ruleError && form.fullName && form.email;

  return (
    <div className="charter-panel">
      <h3>Votre sélection</h3>
      <p className="charter-muted">{formatDateRangeFr(selection.startDate, selection.endDate)}</p>
      <p className="charter-muted">
        {selection.billingDays} jour{selection.billingDays > 1 ? "s" : ""} facturé{selection.billingDays > 1 ? "s" : ""}
      </p>

      <div className="charter-mode-switch" role="radiogroup" aria-label="Choix du mode de réservation">
        <button type="button" className={`charter-chip ${mode === "private" ? "is-active" : ""}`} onClick={() => setMode("private")}>
          Privatisation
        </button>
        <button type="button" className={`charter-chip ${mode === "cabin" ? "is-active" : ""}`} onClick={() => setMode("cabin")}>
          Cabine
        </button>
      </div>

      {!minAvailability.privateAllowed && mode === "private" && (
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
          const syntheticWeekId = `${selection.startDate}_${selection.endDate}`;
          await onSubmit({
            weekId: syntheticWeekId,
            disponibiliteId: selection.disponibiliteId,
            mode,
            peopleCount: mode === "private" ? maxPeopleForRange : form.peopleCount,
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
