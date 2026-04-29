import { useEffect, useState } from "react";
import { Calendar, CreditCard, FileText, Link2, LogOut, Wrench } from "lucide-react";
import ConfigIcal from "@/components/ConfigIcal";
import BackofficeOps from "@/components/BackofficeOps";
import InventoryManager from "@/components/InventoryManager";
import SeasonPricingManager from "@/components/SeasonPricingManager";
import CharterSlotManager from "@/components/CharterSlotManager";
import logoSabine from "/logo-sabine.png";

type AdminTab = "calendar_reset" | "finances_reset" | "pricing" | "documents" | "maintenance" | "config";

type ReservationLite = {
  id: number;
  montantTotal: number;
  statutPaiement?: string;
};

type OriginSummary = Record<string, { count: number; revenueCents: number; source: "local" | "clicknboat_api" }>;

export default function Admin() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [tab, setTab] = useState<AdminTab>("calendar_reset");
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeReservations, setFinanceReservations] = useState<ReservationLite[]>([]);
  const [originsSummary, setOriginsSummary] = useState<OriginSummary | null>(null);

  const redirectToLogin = () => {
    window.location.href = "/admin/login";
  };

  useEffect(() => {
    const verifyAdminSession = async () => {
      try {
        const response = await fetch("/api/admin-auth/me", { credentials: "include" });
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("application/json")) {
          redirectToLogin();
          return;
        }
        const payload = await response.json().catch(() => null);
        if (payload?.role !== "admin") {
          redirectToLogin();
          return;
        }
        setAuthOk(true);
      } catch {
        redirectToLogin();
      } finally {
        setAuthChecked(true);
      }
    };
    void verifyAdminSession();
  }, []);

  useEffect(() => {
    if (!authOk || tab !== "finances_reset") return;
    const loadFinances = async () => {
      try {
        setFinanceLoading(true);
        setFinanceError(null);
        const [allRes, summaryRes] = await Promise.all([
          fetch("/api/reservations", { credentials: "include" }),
          fetch("/api/reservations/origins-summary", { credentials: "include" }),
        ]);
        const all = await allRes.json().catch(() => []);
        const summary = await summaryRes.json().catch(() => ({}));
        if (!allRes.ok) throw new Error(all?.error || "Impossible de charger les réservations.");
        if (!summaryRes.ok) throw new Error(summary?.error || "Impossible de charger les origines.");
        setFinanceReservations(Array.isArray(all) ? all : []);
        setOriginsSummary(summary?.origins || null);
      } catch (e: any) {
        setFinanceError(e?.message || "Erreur chargement finances.");
    } finally {
        setFinanceLoading(false);
      }
    };
    void loadFinances();
  }, [authOk, tab]);

  const handleLogout = async () => {
    try {
      await fetch("/api/admin-auth/logout", {
          method: "POST",
        credentials: "include",
      });
    } finally {
      setAuthOk(false);
      redirectToLogin();
    }
  };

  if (!authChecked || !authOk) return null;

        return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <img src={logoSabine} alt="Sabine" className="h-8" />
            <div className="h-6 w-px bg-slate-200" />
            <h1 className="text-lg font-bold text-slate-900">Backoffice</h1>
        </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-rose-600">
            <LogOut className="h-4 w-4" />
            Deconnexion
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex w-fit flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {[
            { id: "calendar_reset" as const, label: "Calendrier", icon: Calendar },
            { id: "finances_reset" as const, label: "Finances", icon: CreditCard },
            { id: "pricing" as const, label: "Tarifs saison", icon: CreditCard },
            { id: "documents" as const, label: "Documents", icon: FileText },
            { id: "maintenance" as const, label: "Maintenance", icon: Wrench },
            { id: "config" as const, label: "Configuration", icon: Link2 },
          ].map((item) => (
          <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                tab === item.id ? "bg-blue-900 text-white shadow-md" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
          </button>
          ))}
        </div>

        {tab === "calendar_reset" && <CharterSlotManager />}

        {tab === "finances_reset" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-bold text-slate-900">Indicateurs financiers</h2>
              <p className="mt-2 text-sm text-slate-600">Synthèse basée sur les réservations enregistrées.</p>
              {financeError && <p className="mt-3 text-sm text-rose-700">{financeError}</p>}
              </div>
            {financeLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Chargement...</div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Réservations</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{financeReservations.length}</p>
            </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-slate-500">CA brut</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">
                      {(financeReservations.reduce((acc, r) => acc + Number(r.montantTotal || 0), 0) / 100).toLocaleString("fr-FR")} €
                    </p>
              </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Panier moyen</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">
                      {financeReservations.length
                        ? (
                            financeReservations.reduce((acc, r) => acc + Number(r.montantTotal || 0), 0) /
                            financeReservations.length /
                            100
                          ).toLocaleString("fr-FR")
                        : "0"}{" "}
                      €
                    </p>
              </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900">Origines des réservations</h3>
                  {!originsSummary ? (
                    <p className="mt-2 text-sm text-slate-500">Aucune donnée.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                            <th className="py-2 pr-2">Origine</th>
                            <th className="py-2 pr-2">Réservations</th>
                            <th className="py-2 pr-2">CA</th>
                            <th className="py-2 pr-2">Source</th>
                    </tr>
                  </thead>
                        <tbody>
                          {Object.entries(originsSummary).map(([k, v]) => (
                            <tr key={k} className="border-b border-slate-100">
                              <td className="py-2 pr-2 font-medium text-slate-800">{k}</td>
                              <td className="py-2 pr-2 text-slate-700">{v.count}</td>
                              <td className="py-2 pr-2 text-slate-700">{(Number(v.revenueCents || 0) / 100).toLocaleString("fr-FR")} €</td>
                              <td className="py-2 pr-2 text-slate-500">{v.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
              </>
            )}
          </div>
        )}

        {tab === "config" && <ConfigIcal />}
        {tab === "maintenance" && <BackofficeOps mode="maintenance" />}
        {tab === "pricing" && <SeasonPricingManager />}
        {tab === "documents" && <InventoryManager />}
      </main>
    </div>
  );
}
