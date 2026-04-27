import { useMemo, useState } from "react";
import { bookingInitialRequests, bookingInitialWeeks } from "./bookingMockData";
import { AdminBookingPanel } from "./AdminBookingPanel";
import { CharterBookingPanel } from "./CharterBookingPanel";
import { CharterRequestModal } from "./CharterRequestModal";
import { CharterWeekCard } from "./CharterWeekCard";
import type { BookingRequest, BookingWeek } from "./bookingTypes";
import "./charter-calendar.css";

export default function CharterCalendar() {
  const [weeks, setWeeks] = useState<BookingWeek[]>(bookingInitialWeeks);
  const [requests, setRequests] = useState<BookingRequest[]>(bookingInitialRequests);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(weeks[0]?.id ?? null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  const selectedWeek = useMemo(() => weeks.find((week) => week.id === selectedWeekId) ?? null, [selectedWeekId, weeks]);

  const handleRequestSubmit = (request: Omit<BookingRequest, "id" | "createdAt" | "status">) => {
    const nextRequest: BookingRequest = {
      ...request,
      id: `req-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setRequests((prev) => [nextRequest, ...prev]);
    setMobileOpen(false);
  };

  return (
    <section className="charter-calendar" aria-label="Calendrier de réservation premium">
      <header className="charter-calendar__header">
        <span className="editorial-kicker">Calendrier premium</span>
        <h2>Réservation samedi → samedi</h2>
        <p>Charter haut de gamme: privatisation du catamaran ou réservation cabine, avec suivi des disponibilités en direct.</p>
      </header>

      <div className="charter-layout">
        <div className="charter-weeks">
          {weeks.map((week) => (
            <CharterWeekCard
              key={week.id}
              week={week}
              selected={week.id === selectedWeekId}
              onSelect={(value) => {
                setSelectedWeekId(value.id);
                setMobileOpen(true);
              }}
            />
          ))}
        </div>

        <aside className="charter-sidebar" aria-label="Panneau de demande">
          <CharterBookingPanel week={selectedWeek} onSubmit={handleRequestSubmit} />
        </aside>
      </div>

      <div className="charter-mobile-cta">
        <button
          type="button"
          className="charter-btn charter-btn--primary"
          onClick={() => setMobileOpen(true)}
          disabled={!selectedWeek}
        >
          Ouvrir la demande mobile
        </button>
      </div>

      <CharterRequestModal open={mobileOpen} week={selectedWeek} onClose={() => setMobileOpen(false)} onSubmit={handleRequestSubmit} />

      <div className="charter-admin-toggle">
        <button type="button" className="charter-btn charter-btn--ghost" onClick={() => setShowAdmin((value) => !value)}>
          {showAdmin ? "Masquer le backoffice" : "Afficher le backoffice mock"}
        </button>
      </div>

      {showAdmin && (
        <AdminBookingPanel
          weeks={weeks}
          requests={requests}
          onWeeksChange={setWeeks}
          onRequestsChange={setRequests}
        />
      )}
    </section>
  );
}
