import { useEffect, useMemo, useState } from "react";

type SeasonPricingProduct = "med" | "caraibes" | "journee" | "transat";

type ProductSeasonPricing = {
  highSeasonPerPassenger: number | null;
  lowSeasonPerPassenger: number | null;
};

type SeasonPricingConfig = Record<SeasonPricingProduct, ProductSeasonPricing>;

const DEFAULT_PRICING: SeasonPricingConfig = {
  med: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  caraibes: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  journee: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
  transat: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null },
};

const PRODUCT_LABELS: Record<SeasonPricingProduct, string> = {
  med: "Croisière Méditerranée",
  caraibes: "Croisière Caraïbes",
  journee: "Journée La Ciotat",
  transat: "Transatlantique",
};

export default function SeasonPricingManager() {
  const [pricing, setPricing] = useState<SeasonPricingConfig>(DEFAULT_PRICING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/backoffice-ops/season-pricing");
        if (!res.ok) throw new Error("Impossible de charger les tarifs saisonniers.");
        const payload = await res.json();
        setPricing({ ...DEFAULT_PRICING, ...(payload || {}) });
      } catch (error: any) {
        setMessage(error?.message || "Erreur chargement tarifs saisonniers.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const productKeys = useMemo(() => Object.keys(PRODUCT_LABELS) as SeasonPricingProduct[], []);

  const updatePrice = (product: SeasonPricingProduct, field: keyof ProductSeasonPricing, raw: string) => {
    const normalized = raw.trim() === "" ? null : Math.max(0, Math.round(Number(raw) || 0));
    setPricing((prev) => ({
      ...prev,
      [product]: {
        ...prev[product],
        [field]: normalized,
      },
    }));
  };

  const save = async () => {
    try {
      setSaving(true);
      setMessage("");
      const res = await fetch("/api/backoffice-ops/season-pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricing),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Sauvegarde impossible.");
      }
      setMessage("Tarifs saisonniers enregistrés.");
    } catch (error: any) {
      setMessage(error?.message || "Erreur sauvegarde.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-900">Tarifs saisonniers</h2>
        <p className="text-slate-600 mt-1">
          Prix par passager. Haute saison: juillet-août, du 15/12 au 08/01, et tout février (28/29).
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Chargement...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3 border-b border-slate-100 pb-3 text-xs uppercase tracking-wide text-slate-500">
            <div>Produit</div>
            <div>Haute saison (€ / passager)</div>
            <div>Basse saison (€ / passager)</div>
          </div>

          <div className="space-y-3 pt-3">
            {productKeys.map((product) => (
              <div key={product} className="grid grid-cols-[1.3fr_1fr_1fr] gap-3 items-center">
                <div className="text-sm font-semibold text-slate-800">{PRODUCT_LABELS[product]}</div>
                <input
                  type="number"
                  min={0}
                  value={pricing[product]?.highSeasonPerPassenger ?? ""}
                  onChange={(e) => updatePrice(product, "highSeasonPerPassenger", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Ex: 1750"
                />
                <input
                  type="number"
                  min={0}
                  value={pricing[product]?.lowSeasonPerPassenger ?? ""}
                  onChange={(e) => updatePrice(product, "lowSeasonPerPassenger", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Ex: 1400"
                />
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {message && <p className="text-sm text-slate-600">{message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
