import { useEffect, useState } from "react";
import { Calendar, CreditCard, FileText, Link2, LogOut, Wrench } from "lucide-react";
import ConfigIcal from "@/components/ConfigIcal";
import BackofficeOps from "@/components/BackofficeOps";
import InventoryManager from "@/components/InventoryManager";
import SeasonPricingManager from "@/components/SeasonPricingManager";
import logoSabine from "/logo-sabine.png";

type AdminTab = "calendar_reset" | "finances_reset" | "pricing" | "documents" | "maintenance" | "config";

export default function Admin() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authOk, setAuthOk] = useState(false);
  const [tab, setTab] = useState<AdminTab>("calendar_reset");

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

        {tab === "calendar_reset" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Module calendrier en reset</h2>
            <p className="mt-2 text-sm text-slate-600">
              L&apos;ancien systeme reservation/calendrier backoffice a ete volontairement neutralise pour repartir de zero.
            </p>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Etape en cours: reconstruction d&apos;un nouveau socle calendrier MVP (UI d&apos;abord, regles metier ensuite).
            </p>
          </div>
        )}

        {tab === "finances_reset" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Finances indisponibles temporairement</h2>
            <p className="mt-2 text-sm text-slate-600">
              Les indicateurs financiers dependant de l&apos;ancien module reservation sont desactives pendant la reconstruction.
            </p>
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
