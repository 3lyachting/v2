import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type SelectionMode = "single" | "range";

const BRAND_DEEP = "#00384A";
const BRAND_SAND = "#D8C19E";

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateDiffDays(startIso: string, endIso: string) {
  const start = fromIso(startIso).getTime();
  const end = fromIso(endIso).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

export default function AirbnbCalendarMvp({ isEnglish = false }: { isEnglish?: boolean }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("range");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const today = new Date();

  const monthLabel = month.toLocaleDateString(isEnglish ? "en-US" : "fr-FR", {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => {
    const firstDayIndex = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const numberOfDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: Date[] = [];

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), i - firstDayIndex + 1));
    }
    for (let i = 1; i <= numberOfDays; i++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), i));
    }
    while (cells.length < 42) {
      const next = cells.length - (firstDayIndex + numberOfDays) + 1;
      cells.push(new Date(month.getFullYear(), month.getMonth() + 1, next));
    }
    return cells;
  }, [month]);

  const inRange = (iso: string) => {
    if (!startDate || !endDate) return false;
    return iso >= startDate && iso <= endDate;
  };

  const handleSelectDate = (date: Date) => {
    const iso = toIso(date);
    if (selectionMode === "single") {
      setStartDate(iso);
      setEndDate(iso);
      return;
    }
    if (!startDate || (startDate && endDate)) {
      setStartDate(iso);
      setEndDate(null);
      return;
    }
    if (iso < startDate) {
      setEndDate(startDate);
      setStartDate(iso);
      return;
    }
    setEndDate(iso);
  };

  const nights = startDate && endDate ? dateDiffDays(startDate, endDate) : 0;
  const panelTitle = isEnglish ? "Stay details" : "Détails du séjour";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-3xl border border-[#d7e3e8] bg-white p-5 shadow-[0_12px_30px_rgba(7,38,50,0.09)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-[#d7e3e8] bg-[#f4f8fa] p-1">
            <button
              type="button"
              onClick={() => setSelectionMode("single")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectionMode === "single" ? "text-white" : "text-slate-700"}`}
              style={selectionMode === "single" ? { backgroundColor: BRAND_DEEP } : {}}
            >
              {isEnglish ? "Single date" : "Date unique"}
            </button>
            <button
              type="button"
              onClick={() => setSelectionMode("range")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectionMode === "range" ? "text-white" : "text-slate-700"}`}
              style={selectionMode === "range" ? { backgroundColor: BRAND_DEEP } : {}}
            >
              {isEnglish ? "Date range" : "Plage de dates"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-full border border-slate-200 p-2 hover:bg-slate-50">
              <ChevronLeft className="h-4 w-4 text-slate-600" />
            </button>
            <div className="min-w-40 text-center text-sm font-semibold capitalize text-slate-800">{monthLabel}</div>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-full border border-slate-200 p-2 hover:bg-slate-50">
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </button>
          </div>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {(isEnglish ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]).map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((date) => {
            const iso = toIso(date);
            const isCurrentMonth = date.getMonth() === month.getMonth();
            const isStart = !!startDate && iso === startDate;
            const isEnd = !!endDate && iso === endDate;
            const isSelectedRange = inRange(iso);
            const isTodayDate = isSameDay(date, today);

            return (
              <button
                key={iso}
                type="button"
                onClick={() => handleSelectDate(date)}
                className={`relative aspect-square rounded-xl border text-sm transition ${
                  isCurrentMonth ? "border-slate-200 bg-white text-slate-800 hover:border-slate-300" : "border-slate-100 bg-slate-50 text-slate-400"
                } ${isSelectedRange ? "border-transparent" : ""}`}
                style={
                  isStart || isEnd
                    ? { backgroundColor: BRAND_DEEP, color: "white" }
                    : isSelectedRange
                      ? { backgroundColor: `${BRAND_SAND}80`, color: "#1f2937" }
                      : isTodayDate
                        ? { borderColor: BRAND_DEEP }
                        : {}
                }
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-3xl border border-[#d7e3e8] bg-[linear-gradient(180deg,#ffffff,#f4f8fa)] p-5 shadow-[0_12px_30px_rgba(7,38,50,0.08)]">
        <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
          {panelTitle}
        </h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Arrival" : "Arrivée"}</p>
            <p className="mt-1 font-semibold text-slate-900">{startDate ?? (isEnglish ? "Not selected" : "Non sélectionnée")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Departure" : "Départ"}</p>
            <p className="mt-1 font-semibold text-slate-900">{endDate ?? (isEnglish ? "Not selected" : "Non sélectionnée")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{isEnglish ? "Duration" : "Durée"}</p>
            <p className="mt-1 font-semibold text-slate-900">
              {nights > 0 ? `${nights} ${isEnglish ? "day(s)" : "jour(s)"}` : isEnglish ? "Choose your dates" : "Choisissez vos dates"}
            </p>
          </div>
          <p className="pt-2 text-xs text-slate-600">
            {isEnglish
              ? "MVP mode: visual date selection only. Booking rules and API will be connected next."
              : "Mode MVP: sélection visuelle uniquement. Les règles métier et l'API booking seront branchées à l'étape suivante."}
          </p>
        </div>
      </aside>
    </div>
  );
}
