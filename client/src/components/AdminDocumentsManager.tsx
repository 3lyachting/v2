import { useCallback, useEffect, useState } from "react";
import { FileText, Pencil, Ship, Trash2, UserCircle2, Users } from "lucide-react";

type DocCategory = "boat" | "crew" | "passenger";

type BoatDoc = {
  id: number;
  docType: string;
  originalName: string;
  expiresAt?: string | null;
};

const DEFAULT_TYPES: Record<DocCategory, { value: string; label: string }[]> = {
  boat: [
    { value: "assurance", label: "Assurance" },
    { value: "immatriculation", label: "Immatriculation" },
    { value: "controle", label: "Contrôle / visite" },
    { value: "plan_bateau", label: "Plan du bateau" },
    { value: "piece_rechange", label: "Pièce / notice" },
  ],
  crew: [
    { value: "contrat_equipage", label: "Contrat / convention" },
    { value: "certificat_medical", label: "Certificat médical" },
    { value: "certificat_competence", label: "Certificat / CQP / brevet" },
    { value: "formation_securite", label: "Formation sécurité" },
    { value: "piece_identite", label: "Pièce d’identité" },
  ],
  passenger: [
    { value: "liste_passagers", label: "Liste passagers / manifeste" },
    { value: "passeports", label: "Passeports / visas" },
    { value: "assurance_voyage", label: "Assurance voyage" },
    { value: "fiche_sanitaire", label: "Fiche sanitaire" },
    { value: "autre_passager", label: "Autre" },
  ],
};

async function readApiError(res: Response, fallback: string) {
  try {
    const payload = await res.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

function DocSection({
  category,
  title,
  description,
  icon: Icon,
  canMutate,
}: {
  category: DocCategory;
  title: string;
  description: string;
  icon: typeof Ship;
  canMutate: boolean;
}) {
  const [docs, setDocs] = useState<BoatDoc[]>([]);
  const [message, setMessage] = useState("");
  const [docForm, setDocForm] = useState({ docType: DEFAULT_TYPES[category][0].value, expiresAt: "" });
  const [docTypeOptions, setDocTypeOptions] = useState(DEFAULT_TYPES[category]);
  const [showAddDocType, setShowAddDocType] = useState(false);
  const [newDocTypeLabel, setNewDocTypeLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin-documents/${category}`, { credentials: "include" });
      if (res.ok) setDocs(await res.json());
    } catch {
      /* ignore */
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-blue-900">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
      </div>

      {canMutate && (
        <div className="mb-5 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={docForm.docType}
                  onChange={(e) => setDocForm((s) => ({ ...s, docType: e.target.value }))}
                  className="min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {docTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddDocType((v) => !v)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-50"
                >
                  + Type
                </button>
              </div>
              {showAddDocType && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newDocTypeLabel}
                    onChange={(e) => setNewDocTypeLabel(e.target.value)}
                    placeholder="Libellé du type de document"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const label = newDocTypeLabel.trim();
                      if (!label) return;
                      const value = label
                        .toLowerCase()
                        .normalize("NFD")
                        .replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_+|_+$/g, "");
                      if (!value) return;
                      if (!docTypeOptions.some((opt) => opt.value === value)) {
                        setDocTypeOptions((opts) => [...opts, { value, label }]);
                      }
                      setDocForm((s) => ({ ...s, docType: value }));
                      setNewDocTypeLabel("");
                      setShowAddDocType(false);
                    }}
                    className="rounded-lg bg-blue-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
            <input
              type="date"
              value={docForm.expiresAt}
              onChange={(e) => setDocForm((s) => ({ ...s, expiresAt: e.target.value }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <label className="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Téléverser
              <input
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const base64 = await new Promise<string>((resolve, reject) => {
                      const fr = new FileReader();
                      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
                      fr.onerror = reject;
                      fr.readAsDataURL(file);
                    });
                    const res = await fetch(`/api/admin-documents/${category}/upload`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({
                        docType: docForm.docType,
                        originalName: file.name,
                        mimeType: file.type || "application/octet-stream",
                        base64Data: base64,
                        expiresAt: docForm.expiresAt || null,
                      }),
                    });
                    if (!res.ok) throw new Error(await readApiError(res, "Upload impossible"));
                    setMessage("Document ajouté.");
                    await load();
                  } catch (err: unknown) {
                    setMessage(err instanceof Error ? err.message : "Erreur upload");
                  }
                }}
              />
            </label>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {docs.length === 0 && <li className="text-sm text-slate-500">Aucun fichier pour cette catégorie.</li>}
        {docs.map((d) => (
          <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-slate-100 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {editingId === d.id ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    autoFocus
                  />
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-blue-900 px-2 py-1 text-xs font-semibold text-white"
                      onClick={async () => {
                        const name = editName.trim();
                        if (!name) return;
                        try {
                          const res = await fetch(`/api/admin-documents/${category}/${d.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ originalName: name }),
                          });
                          if (!res.ok) throw new Error(await readApiError(res, "Renommage impossible"));
                          setEditingId(null);
                          setMessage("Nom mis à jour.");
                          await load();
                        } catch (err: unknown) {
                          setMessage(err instanceof Error ? err.message : "Erreur renommage");
                        }
                      }}
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                      onClick={() => setEditingId(null)}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="truncate font-medium text-slate-900">{d.originalName}</p>
                  <p className="text-xs text-slate-600">{d.docType}</p>
                  {d.expiresAt && (
                    <p className="text-xs text-slate-500">Expiration : {new Date(d.expiresAt).toLocaleDateString("fr-FR")}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {canMutate && editingId !== d.id && (
                <>
                  <button
                    type="button"
                    title="Renommer"
                    onClick={() => {
                      setEditingId(d.id);
                      setEditName(d.originalName);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Renommer
                  </button>
                  <button
                    type="button"
                    title="Supprimer"
                    onClick={async () => {
                      if (!window.confirm(`Supprimer définitivement « ${d.originalName} » ?`)) return;
                      try {
                        const res = await fetch(`/api/admin-documents/${category}/${d.id}`, {
                          method: "DELETE",
                          credentials: "include",
                        });
                        if (!res.ok) throw new Error(await readApiError(res, "Suppression impossible"));
                        setMessage("Document supprimé.");
                        await load();
                      } catch (err: unknown) {
                        setMessage(err instanceof Error ? err.message : "Erreur suppression");
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/admin-documents/${category}/${d.id}/preview-url`, { credentials: "include" });
                    const payload = await res.json().catch(() => ({}));
                    if (!res.ok || !payload?.previewUrl) {
                      throw new Error(payload?.error || "Impossible d’ouvrir l’aperçu");
                    }
                    window.open(payload.previewUrl, "_blank", "noopener,noreferrer");
                  } catch (err: unknown) {
                    setMessage(err instanceof Error ? err.message : "Erreur aperçu");
                  }
                }}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100"
              >
                Aperçu
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
    </section>
  );
}

export default function AdminDocumentsManager({ canMutate = true }: { canMutate?: boolean }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="flex items-center gap-2 text-3xl font-bold text-blue-900">
          <FileText className="h-8 w-8" />
          Documents
        </h2>
        <p className="mt-1 text-slate-600">
          Fichiers administratifs et de bord : un volet pour le <strong>bateau</strong>, un pour l’<strong>équipage</strong>, un pour les{" "}
          <strong>passagers</strong> (listes, assurances, etc.).
        </p>
        {!canMutate && (
          <p className="mt-2 text-sm text-amber-800">
            Accès consultatif : vous pouvez consulter les documents, pas les modifier ni les supprimer.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-1">
        <DocSection
          category="boat"
          title="Documents bateau"
          description="Assurance, immatriculation, contrôles, plans, notices techniques…"
          icon={Ship}
          canMutate={canMutate}
        />
        <DocSection
          category="crew"
          title="Documents équipage"
          description="Contrats, certificats, formations, pièces d’identité professionnelles…"
          icon={UserCircle2}
          canMutate={canMutate}
        />
        <DocSection
          category="passenger"
          title="Documents passagers"
          description="Manifestes, copies passeports / visas, assurances voyage, fiches sanitaires…"
          icon={Users}
          canMutate={canMutate}
        />
      </div>
    </div>
  );
}
