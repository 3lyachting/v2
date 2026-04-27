import { useMemo, useState } from "react";
import type { BookingRequest, BookingStatus, BookingWeek } from "./bookingTypes";
import { applyAcceptedRequest, formatDateRangeFr } from "./bookingUtils";

interface AdminBookingPanelProps {
  weeks: BookingWeek[];
  requests: BookingRequest[];
  onWeeksChange: (weeks: BookingWeek[]) => void;
  onRequestsChange: (requests: BookingRequest[]) => void;
}

const statusOptions: BookingStatus[] = ["available", "option", "partial", "reserved", "private", "blocked"];

export function AdminBookingPanel({ weeks, requests, onWeeksChange, onRequestsChange }: AdminBookingPanelProps) {
  const [draft, setDraft] = useState<BookingWeek>({
    id: "wk-new",
    startDate: "2026-08-01",
    endDate: "2026-08-08",
    status: "available",
    pricePrivate: 16000,
    pricePerPerson: 2000,
    totalCabins: 4,
    totalPeople: 8,
    bookedCabins: 0,
    bookedPeople: 0,
    clientName: "",
    internalNote: "",
  });

  const sortedRequests = useMemo(() => [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [requests]);

  const upsertWeek = () => {
    const existing = weeks.find((week) => week.id === draft.id);
    if (existing) {
      onWeeksChange(weeks.map((week) => (week.id === draft.id ? draft : week)));
      return;
    }
    onWeeksChange([...weeks, draft]);
  };

  return (
    <section className="charter-admin">
      <h3>Backoffice calendrier</h3>

      <div className="charter-admin-grid">
        <div>
          <h4>Semaines</h4>
          <ul className="charter-admin-list">
            {weeks.map((week) => (
              <li key={week.id}>
                <button type="button" onClick={() => setDraft(week)}>{formatDateRangeFr(week.startDate, week.endDate)} · {week.status}</button>
                <button type="button" onClick={() => onWeeksChange(weeks.filter((item) => item.id !== week.id))}>Supprimer</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4>Ajouter / modifier une semaine</h4>
          <div className="charter-admin-form">
            <label><span>ID</span><input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label>
            <label><span>Début</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
            <label><span>Fin</span><input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
            <label><span>Statut</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as BookingStatus })}>{statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <label><span>Prix privatisation</span><input type="number" value={draft.pricePrivate} onChange={(event) => setDraft({ ...draft, pricePrivate: Number(event.target.value) })} /></label>
            <label><span>Prix/pers.</span><input type="number" value={draft.pricePerPerson} onChange={(event) => setDraft({ ...draft, pricePerPerson: Number(event.target.value) })} /></label>
            <label><span>Cabines réservées</span><input type="number" value={draft.bookedCabins} onChange={(event) => setDraft({ ...draft, bookedCabins: Number(event.target.value) })} /></label>
            <label><span>Passagers réservés</span><input type="number" value={draft.bookedPeople} onChange={(event) => setDraft({ ...draft, bookedPeople: Number(event.target.value) })} /></label>
            <label><span>Client</span><input value={draft.clientName || ""} onChange={(event) => setDraft({ ...draft, clientName: event.target.value })} /></label>
            <label><span>Note interne</span><input value={draft.internalNote || ""} onChange={(event) => setDraft({ ...draft, internalNote: event.target.value })} /></label>
          </div>
          <button type="button" className="charter-btn charter-btn--primary" onClick={upsertWeek}>Enregistrer la semaine</button>
        </div>
      </div>

      <div className="charter-admin-requests">
        <h4>Demandes mockées</h4>
        {sortedRequests.map((request) => (
          <article key={request.id}>
            <p><strong>{request.fullName}</strong> · {request.mode} · {request.peopleCount} pers.</p>
            <p>{request.message}</p>
            <p>Statut: {request.status}</p>
            {request.status === "pending" && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    onRequestsChange(requests.map((item) => (item.id === request.id ? { ...item, status: "accepted" } : item)));
                    const week = weeks.find((item) => item.id === request.weekId);
                    if (!week) return;
                    const nextWeek = applyAcceptedRequest(week, request);
                    onWeeksChange(weeks.map((item) => (item.id === week.id ? nextWeek : item)));
                  }}
                >
                  Accepter
                </button>
                <button type="button" onClick={() => onRequestsChange(requests.map((item) => (item.id === request.id ? { ...item, status: "rejected" } : item)))}>
                  Refuser
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
