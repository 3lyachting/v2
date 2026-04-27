import { useEffect, useState } from "react";
import { apiUrl, handleApiResponse } from "@/lib/apiBase";
import {
  CHARTER_PRODUCT_LABELS,
  CHARTER_PRODUCTS,
  type CharterProductCode,
} from "@shared/charterProduct";

const BRAND_DEEP = "#00384A";
const BRAND_SAND = "#D8C19E";

type SlotRow = {
  id: number;
  product: CharterProductCode;
  debut: string;
  fin: string;
  active: boolean;
  note: string | null;
  publicNote: string | null;
};

function toInputDateFromApi(iso: string) {
  return iso.slice(0, 10);
}

export default function CharterSlotManager() {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{
    product: CharterProductCode;
    debut: string;
    fin: string;
    active: boolean;
    note: string;
    publicNote: string;
  }>({
    product: "med",
    debut: "",
    fin: "",
    active: true,
    note: "",
    publicNote: "",
  });

  const load = async () => {
    try {
      setLoading(true);
      setMessage("");
      const res = await fetch(`${apiUrl("/api/charter-slots")}?includeInactive=1`, { credentials: "include" });
      const data = await handleApiResponse<SlotRow[]>(res);
      setRows(data.sort((a, b) => a.debut.localeCompare(b.debut) || a.product.localeCompare(b.product)));
    } catch (e: any) {
      setMessage(e?.message || "Erreur chargement.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setForm({ product: "med", debut: "", fin: "", active: true, note: "", publicNote: "" });
  };

  const startEdit = (r: SlotRow) => {
    setEditingId(r.id);
    setForm({
      product: r.product,
      debut: toInputDateFromApi(r.debut),
      fin: toInputDateFromApi(r.fin),
      active: r.active,
      note: r.note || "",
      publicNote: r.publicNote || "",
    });
  };

  const submit = async () => {
    try {
      setSaving(true);
      setMessage("");
      if (!form.debut || !form.fin) {
        setMessage("Renseignez le debut et la fin.");
        return;
      }
      const body = {
        product: form.product,
        debut: form.debut,
        fin: form.fin,
        active: form.active,
        note: form.note.trim() || null,
        publicNote: form.publicNote.trim() || null,
      };
      const res = await fetch(
        editingId ? apiUrl(`/api/charter-slots/${editingId}`) : apiUrl("/api/charter-slots"),
        {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
        }
      );
      await handleApiResponse(res);
      setMessage("Creneau enregistre.");
      setEditingId(null);
      setForm((f) => ({ ...f, debut: "", fin: "", note: "", publicNote: "" }));
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Supprimer ce creneau ?")) return;
    try {
      const res = await fetch(apiUrl(`/api/charter-slots/${id}`), { method: "DELETE", credentials: "include" });
      await handleApiResponse(res);
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Erreur suppression.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold" style={{ color: BRAND_DEEP }}>
          Créneaux & produits
        </h2>
        <p className="mt-1 text-slate-600">
          Un creneau = plage de dates (debut a fin) pour l&apos;un des quatre produits. Le site n&apos;affiche que les creneaux
          <span className="font-semibold"> actifs</span>.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
              {editingId ? "Modifier le creneau" : "Nouveau creneau"}
            </h3>
            <button type="button" onClick={startCreate} className="text-sm font-semibold text-slate-600 hover:underline">
              Vider
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Produit</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.product}
                onChange={(e) => setForm((f) => ({ ...f, product: e.target.value as CharterProductCode }))}
              >
                {CHARTER_PRODUCTS.map((p) => (
                  <option key={p} value={p}>
                    {CHARTER_PRODUCT_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Debut</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  value={form.debut}
                  onChange={(e) => setForm((f) => ({ ...f, debut: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Fin</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                  value={form.fin}
                  onChange={(e) => setForm((f) => ({ ...f, fin: e.target.value }))}
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Actif sur le site</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Note interne (optionnel)</span>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Texte public (optionnel)</span>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                value={form.publicNote}
                onChange={(e) => setForm((f) => ({ ...f, publicNote: e.target.value }))}
                placeholder="court message a afficher cote client (plus tard)"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND_DEEP, boxShadow: "0 10px 20px rgba(0,56,74,0.2)" }}
            >
              {saving ? "Enregistrement..." : editingId ? "Mettre a jour" : "Ajouter le creneau"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderColor: "#d7e3e8" }}>
          <h3 className="text-lg font-bold" style={{ color: BRAND_DEEP }}>
            Liste
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Chargement...</p>
          ) : rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Aucun creneau. Creez le premier a gauche.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-2">Produit</th>
                    <th className="py-2 pr-2">Dates</th>
                    <th className="py-2 pr-2">Actif</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-medium" style={{ color: BRAND_DEEP }}>
                        {CHARTER_PRODUCT_LABELS[r.product]}
                      </td>
                      <td className="py-2 pr-2 text-slate-700">
                        {toInputDateFromApi(r.debut)} <span className="text-slate-400">→</span> {toInputDateFromApi(r.fin)}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            color: r.active ? BRAND_DEEP : "#64748b",
                            backgroundColor: r.active ? `${BRAND_SAND}50` : "#f1f5f9",
                          }}
                        >
                          {r.active ? "oui" : "non"}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="mr-2 text-xs font-semibold text-slate-600 hover:underline"
                        >
                          Editer
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
