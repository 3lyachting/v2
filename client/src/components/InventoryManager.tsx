import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, MousePointer2, Plus, Save, Trash2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const BOAT_PLAN_SRC = "/PLAN-SABINE-OK.jpg";
const BOAT_PLAN_FALLBACK = "/photos%20site/dji_fly_20260314_171456_155_1773505004694_photo_optimized.jpg";

type InventorySlot = { id: string; label: string; x: number; y: number };
type InventoryItem = { id: string; objectName: string; quantity: number; slotId: string; notes?: string };

function BoatPlanWithDot({
  x,
  y,
  className,
  imgClassName,
}: {
  x: number;
  y: number;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 ${className ?? ""}`}>
      <img
        src={BOAT_PLAN_SRC}
        alt="Plan bateau"
        className={imgClassName ?? "h-full w-full max-h-[280px] object-contain"}
        onError={(e) => {
          e.currentTarget.src = BOAT_PLAN_FALLBACK;
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600 shadow-md ring-2 ring-white"
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      </div>
    </div>
  );
}

export default function InventoryManager() {
  const [slots, setSlots] = useState<InventorySlot[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addSlotMode, setAddSlotMode] = useState(false);
  const [repositionSlotId, setRepositionSlotId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backoffice-ops/inventory", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Chargement impossible");
      setSlots(Array.isArray(data?.slots) ? data.slots : []);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSlots([]);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (nextSlots: InventorySlot[], nextItems: InventoryItem[]) => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/backoffice-ops/inventory", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: nextSlots, items: nextItems }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Échec sauvegarde");
      setSlots(data.slots ?? nextSlots);
      setItems(data.items ?? nextItems);
      setFeedback("Inventaire enregistré.");
    } catch (e: unknown) {
      setFeedback(e instanceof Error ? e.message : "Erreur de sauvegarde.");
    } finally {
      setSaving(false);
    }
  };

  const planClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (repositionSlotId) {
      const next = slots.map((s) => (s.id === repositionSlotId ? { ...s, x, y } : s));
      setSlots(next);
      setRepositionSlotId(null);
      void persist(next, items);
      return;
    }
    if (addSlotMode) {
      const id = `slot-${Date.now()}`;
      const label = `Rangement ${slots.length + 1}`;
      const created: InventorySlot = { id, label, x, y };
      const next = [...slots, created];
      setSlots(next);
      setSelectedSlotId(id);
      setAddSlotMode(false);
      void persist(next, items);
    }
  };

  const updateSlotLabel = (id: string, label: string) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  };

  const removeSlot = async (id: string) => {
    if (items.some((it) => it.slotId === id)) {
      setFeedback("Impossible de supprimer : des objets sont encore rattachés à ce rangement.");
      return;
    }
    const next = slots.filter((s) => s.id !== id);
    setSlots(next);
    if (selectedSlotId === id) setSelectedSlotId(null);
    await persist(next, items);
  };

  const addItemRow = () => {
    if (!slots.length) {
      setFeedback("Créez d’abord au moins un rangement sur le plan.");
      return;
    }
    const id = `item-${Date.now()}`;
    const next = [...items, { id, objectName: "", quantity: 1, slotId: slots[0].id, notes: "" }];
    setItems(next);
  };

  const updateItem = (id: string, patch: Partial<InventoryItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const saveItems = async () => {
    const invalid = items.some((it) => !it.objectName.trim() || !slotById.has(it.slotId));
    if (invalid) {
      setFeedback("Chaque ligne doit avoir un objet renseigné et une localisation valide.");
      return;
    }
    await persist(slots, items);
  };

  const overlayActive = addSlotMode || Boolean(repositionSlotId);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-blue-900">Inventaire bateau</h2>
        <p className="mt-1 text-slate-600">
          Définissez des <strong>rangements</strong> sur le plan, puis la <strong>liste</strong> (objet, quantité, localisation). Survolez une
          localisation dans le tableau pour voir le plan avec le repère rouge.
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAddSlotMode((v) => !v);
                setRepositionSlotId(null);
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm ${
                addSlotMode ? "bg-blue-900 text-white" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
              }`}
            >
              <Plus className="h-4 w-4" />
              {addSlotMode ? "Cliquez sur le plan…" : "Ajouter un rangement"}
            </button>
            {repositionSlotId && (
              <span className="text-sm font-medium text-amber-800">Cliquez sur le plan pour déplacer le rangement sélectionné.</span>
            )}
            {overlayActive && (
              <button
                type="button"
                className="text-sm text-slate-600 underline"
                onClick={() => {
                  setAddSlotMode(false);
                  setRepositionSlotId(null);
                }}
              >
                Annuler
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 min-h-[320px] sm:min-h-[400px] max-h-[70vh]">
              <img
                src={BOAT_PLAN_SRC}
                alt="Plan bateau Sabine"
                className="pointer-events-none h-full w-full object-cover opacity-40"
                onError={(e) => {
                  e.currentTarget.src = BOAT_PLAN_FALLBACK;
                }}
              />
              {slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.label}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedSlotId(s.id);
                  }}
                  className={`absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow ${
                    selectedSlotId === s.id ? "scale-125 border-white bg-blue-600" : "border-white bg-blue-400"
                  }`}
                  style={{ left: `${s.x}%`, top: `${s.y}%` }}
                />
              ))}
              {overlayActive && (
                <button
                  type="button"
                  onClick={planClick}
                  className="absolute inset-0 z-30 cursor-crosshair bg-blue-500/10"
                  aria-label="Placer ou déplacer un rangement"
                />
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Les pastilles bleues sont les rangements. Activez « Ajouter un rangement » puis cliquez sur le plan, ou sélectionnez un
              rangement dans la liste à droite puis « Repositionner ».
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Rangements</h3>
              <button
                type="button"
                disabled={saving || !slots.length}
                onClick={() => void persist(slots, items)}
                className="text-xs font-semibold text-blue-800 underline-offset-2 hover:underline disabled:opacity-40"
              >
                Enregistrer les noms
              </button>
            </div>
            <ul className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto">
              {slots.length === 0 && <li className="text-sm text-slate-500">Aucun — ajoutez-en sur le plan.</li>}
              {slots.map((s) => (
                <li
                  key={s.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
                    selectedSlotId === s.id ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-slate-50/80"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-blue-800" />
                    <input
                      value={s.label}
                      onChange={(e) => updateSlotLabel(s.id, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm font-medium"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        setSelectedSlotId(s.id);
                        setAddSlotMode(false);
                        setRepositionSlotId(s.id);
                      }}
                    >
                      <MousePointer2 className="mr-1 inline h-3 w-3" />
                      Repositionner
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      onClick={() => void removeSlot(s.id)}
                    >
                      <Trash2 className="mr-1 inline h-3 w-3" />
                      Supprimer
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">Liste inventaire</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addItemRow()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              Ligne
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveItems()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              Enregistrer la liste
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Objet</th>
                <th className="py-2 pr-3 w-28">Quantité</th>
                <th className="py-2 pr-3">Localisation</th>
                <th className="py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Aucune ligne — ajoutez des objets stockés dans vos rangements.
                  </td>
                </tr>
              )}
              {items.map((it) => {
                const slot = slotById.get(it.slotId);
                return (
                  <tr key={it.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 align-middle">
                      <input
                        value={it.objectName}
                        onChange={(e) => updateItem(it.id, { objectName: e.target.value })}
                        placeholder="Ex : Gilets de sauvetage"
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="py-2 pr-3 align-middle">
                      <input
                        type="number"
                        min={0}
                        value={it.quantity}
                        onChange={(e) => updateItem(it.id, { quantity: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                      />
                    </td>
                    <td className="py-2 pr-3 align-middle">
                      {slot ? (
                        <HoverCard openDelay={100} closeDelay={80}>
                          <HoverCardTrigger asChild>
                            <div className="max-w-[260px] cursor-default rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5">
                              <label className="sr-only">Localisation</label>
                              <select
                                value={it.slotId}
                                onChange={(e) => updateItem(it.id, { slotId: e.target.value })}
                                className="w-full cursor-pointer bg-transparent text-sm font-medium text-slate-900 outline-none"
                              >
                                {slots.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                              <p className="mt-0.5 text-[10px] text-slate-500">Survolez pour voir le repère sur le plan</p>
                            </div>
                          </HoverCardTrigger>
                          <HoverCardContent
                            side="left"
                            align="start"
                            className="w-auto max-w-[min(360px,92vw)] border-slate-200 p-3 shadow-lg"
                          >
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{slot.label}</p>
                            <BoatPlanWithDot x={slot.x} y={slot.y} className="w-[300px]" />
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <div className="max-w-[260px] rounded-lg border border-slate-200 px-2 py-1.5">
                          <select
                            value={it.slotId}
                            onChange={(e) => updateItem(it.id, { slotId: e.target.value })}
                            className="w-full text-sm font-medium text-slate-900"
                          >
                            {slots.length === 0 ? (
                              <option value="">— Aucun rangement —</option>
                            ) : (
                              slots.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))
                            )}
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="py-2 align-middle">
                      <button
                        type="button"
                        title="Supprimer la ligne"
                        className="rounded p-2 text-red-600 hover:bg-red-50"
                        onClick={() => {
                          const next = items.filter((i) => i.id !== it.id);
                          setItems(next);
                          void persist(slots, next);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {feedback && <p className="mt-3 text-sm font-medium text-slate-700">{feedback}</p>}
      </div>
    </div>
  );
}
