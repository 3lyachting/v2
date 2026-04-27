import { useLocation } from "wouter";

export default function CalendarRebuild() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="max-w-xl text-center bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">Calendrier en reconstruction</h1>
        <p className="text-slate-600 mb-6">
          Le module reservation/calendrier est temporairement retire pour reconstruction.
        </p>
        <button
          onClick={() => setLocation("/")}
          className="px-5 py-2.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
        >
          Retour a l'accueil
        </button>
      </div>
    </div>
  );
}
