import { useEffect, useState } from "react";
import { NotebookPen, Save } from "lucide-react";
import { apiUrl } from "@/lib/apiBase";

export default function BackofficeNotes({ canMutate = true }: { canMutate?: boolean }) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setMessage(null);
        const res = await fetch(apiUrl("/api/backoffice-notes"), { credentials: "include" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || "Chargement impossible");
        setNotes(typeof payload?.notes === "string" ? payload.notes : "");
      } catch (e: unknown) {
        setMessage(e instanceof Error ? e.message : "Erreur chargement notes");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch(apiUrl("/api/backoffice-notes"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notes }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Sauvegarde impossible");
      setMessage("Notes sauvegardées.");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Erreur sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <NotebookPen className="h-6 w-6 text-blue-900" />
          Notes partagées
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Bloc-notes commun du backoffice. Les administrateurs peuvent modifier le contenu, les comptes consultatifs
          peuvent le lire.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={loading ? "Chargement..." : "Écris tes notes ici..."}
          disabled={loading || !canMutate}
          className="h-[62vh] min-h-[420px] w-full rounded-xl border border-slate-300 p-4 text-sm text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-50"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">{message || " "}</p>
          {canMutate ? (
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? "Sauvegarde..." : "Sauvegarder"}
            </button>
          ) : (
            <p className="text-xs text-amber-700">Accès consultatif: modification désactivée.</p>
          )}
        </div>
      </div>
    </section>
  );
}
