import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";

type Marker = {
  id: string;
  label: string;
  category: string;
  notes: string;
  x: number;
  y: number;
};

const CATEGORIES = [
  "Mécanique",
  "Électricité",
  "Plomberie",
  "Papiers bateau",
  "Armement sécurité",
  "Draps de rechange",
  "Cuves d'eau",
  "Cuves gasoil",
  "Pompes",
  "Tableaux électriques",
  "Autre",
];

export default function InventoryManager() {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedNotes, setSelectedNotes] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/backoffice-ops/inventory");
        const data = await res.json();
        setMarkers(Array.isArray(data?.markers) ? data.markers : []);
      } catch {
        setMarkers([]);
      }
    };
    void load();
  }, []);

  const selectedMarker = useMemo(
    () => (selectedId ? markers.find((m) => m.id === selectedId) || null : null),
    [markers, selectedId]
  );

  useEffect(() => {
    if (!selectedMarker) return;
    setSelectedCategory(selectedMarker.category || CATEGORIES[0]);
    setSelectedLabel(selectedMarker.label || "");
    setSelectedNotes(selectedMarker.notes || "");
  }, [selectedMarker]);

  const save = async (nextMarkers: Marker[]) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/backoffice-ops/inventory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markers: nextMarkers }),
      });
      if (!res.ok) throw new Error("Échec sauvegarde inventaire");
      setFeedback("Inventaire sauvegardé.");
    } catch (e: any) {
      setFeedback(e?.message || "Erreur de sauvegarde.");
    } finally {
      setSaving(false);
    }
  };

  const upsertSelected = async () => {
    if (!selectedLabel.trim()) {
      setFeedback("Le nom de l'élément est obligatoire.");
      return;
    }
    if (!selectedMarker) {
      setFeedback("Cliquez d'abord sur le plan pour placer l'élément.");
      return;
    }
    const updated = markers.map((m) =>
      m.id === selectedMarker.id
        ? { ...m, category: selectedCategory, label: selectedLabel.trim(), notes: selectedNotes.trim() }
        : m
    );
    setMarkers(updated);
    await save(updated);
  };

  const removeSelected = async () => {
    if (!selectedId) return;
    const updated = markers.filter((m) => m.id !== selectedId);
    setMarkers(updated);
    setSelectedId(null);
    setSelectedLabel("");
    setSelectedNotes("");
    await save(updated);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-blue-900">Inventaire bateau</h2>
        <p className="text-slate-600 mt-1">
          Cliquez sur le plan pour placer un élément (pièces, armement, tableaux, cuves, etc.), puis décrivez-le.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <img
              src="/PLAN-SABINE-OK.jpg"
              alt="Plan bateau Sabine"
              className="h-full w-full object-cover opacity-55"
              onError={(e) => {
                // Fallback visuel si le plan n'est pas encore copié dans public.
                e.currentTarget.src = "/photos%20site/dji_fly_20260314_171456_155_1773505004694_photo_optimized.jpg";
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                const id = `inv-${Date.now()}`;
                const created: Marker = {
                  id,
                  category: selectedCategory,
                  label: selectedLabel.trim() || "Nouvel élément",
                  notes: selectedNotes.trim(),
                  x,
                  y,
                };
                setMarkers((prev) => [...prev, created]);
                setSelectedId(id);
              }}
              className="absolute inset-0"
              aria-label="Placer un élément sur le plan"
            />

            {markers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                title={`${m.category} — ${m.label}`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 px-2 py-0.5 text-[10px] font-bold shadow ${
                  m.id === selectedId ? "bg-blue-900 text-white border-white" : "bg-white text-blue-900 border-blue-900"
                }`}
                style={{ left: `${m.x}%`, top: `${m.y}%` }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">Élément sélectionné</p>
          <div>
            <label className="text-xs text-slate-600">Catégorie</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600">Nom / pièce</label>
            <input
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Ex: Pompe eau douce bâbord"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600">Détails</label>
            <textarea
              value={selectedNotes}
              onChange={(e) => setSelectedNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[110px]"
              placeholder="Ex: sous banquette carré, kit joint + réf..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={upsertSelected}
              disabled={saving}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              Enregistrer
            </button>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selectedId || saving}
              className="inline-flex items-center justify-center rounded-lg border border-red-300 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
              title="Supprimer l'élément"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-slate-500 inline-flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" />
            Clique sur le plan pour ajouter un nouvel élément.
          </p>
          {feedback && <p className="text-xs font-medium text-slate-700">{feedback}</p>}
        </div>
      </div>
    </div>
  );
}
