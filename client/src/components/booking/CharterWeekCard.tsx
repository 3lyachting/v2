import type { BookingWeek } from "./bookingTypes";
import { STATUS_LABELS_FR, canBookWeek, formatDateRangeFr, formatEuro, getAvailability } from "./bookingUtils";

interface CharterWeekCardProps {
  week: BookingWeek;
  selected: boolean;
  onSelect: (week: BookingWeek) => void;
}

export function CharterWeekCard({ week, selected, onSelect }: CharterWeekCardProps) {
  const { cabinsRemaining, peopleRemaining, privateAllowed } = getAvailability(week);
  const disabled = !canBookWeek(week);

  return (
    <article className={`charter-week-card ${selected ? "is-selected" : ""}`} aria-label={`Semaine ${formatDateRangeFr(week.startDate, week.endDate)}`}>
      <div className="charter-week-card__head">
        <p className="charter-week-card__dates">{formatDateRangeFr(week.startDate, week.endDate)}</p>
        <span className={`charter-status charter-status--${week.status}`}>{STATUS_LABELS_FR[week.status]}</span>
      </div>

      <div className="charter-week-card__prices">
        <div>
          <p className="charter-muted">Privatisation</p>
          <p className="charter-price">{formatEuro(week.pricePrivate)}</p>
        </div>
        <div>
          <p className="charter-muted">Par personne</p>
          <p className="charter-price">{formatEuro(week.pricePerPerson)}</p>
        </div>
      </div>

      <div className="charter-week-card__metrics">
        <span>{cabinsRemaining}/{week.totalCabins} cabines libres</span>
        <span>{peopleRemaining}/{week.totalPeople} places libres</span>
      </div>

      {!privateAllowed && (
        <p className="charter-week-card__notice" role="status">
          Privatisation indisponible: des cabines sont déjà réservées.
        </p>
      )}

      <button
        type="button"
        className="charter-btn charter-btn--primary"
        onClick={() => onSelect(week)}
        disabled={disabled}
        aria-disabled={disabled}
      >
        {disabled ? "Semaine indisponible" : "Voir et demander"}
      </button>
    </article>
  );
}
