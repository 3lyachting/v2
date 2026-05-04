import { useCallback, useEffect, useState } from "react";
import {
  Link2,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Calendar,
  ClipboardCopy,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { apiUrl } from "@/lib/apiBase";

const BRAND = "#00384A";

type VerifyResult =
  | { ok: true; count: number; samples: Array<{ titre: string; debut: string; fin: string; destination: string }> }
  | { ok: false; error: string; count?: number };

async function readEventsPayload(res: Response): Promise<{ events: unknown[]; error: string | null }> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: string }).error) : `HTTP ${res.status}`;
    return { events: [], error: msg };
  }
  if (Array.isArray(data)) {
    return { events: data, error: null };
  }
  if (data && typeof data === "object" && "error" in data) {
    return { events: [], error: String((data as { error: string }).error) };
  }
  return { events: [], error: null };
}

export default function ConfigIcal() {
  const [icalUrl, setIcalUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState("");
  const [verifyDetail, setVerifyDetail] = useState<VerifyResult | null>(null);

  const fetchOpts = useCallback(
    () =>
      ({
        credentials: "include" as const,
        headers: { "Content-Type": "application/json" },
      }) satisfies RequestInit,
    []
  );

  const loadState = useCallback(async () => {
    setEventsError(null);
    try {
      const [configRes, eventsRes] = await Promise.all([
        fetch(apiUrl("/api/ical/config"), { credentials: "include" }),
        fetch(apiUrl("/api/ical/events"), { credentials: "include" }),
      ]);
      const configData = await configRes.json().catch(() => ({}));
      const { events, error } = await readEventsPayload(eventsRes);

      if (configData?.url) setIcalUrl(String(configData.url));
      if (configData?.exportUrl) setExportUrl(String(configData.exportUrl));

      if (error) {
        setEventsCount(null);
        setEventsError(error);
      } else {
        setEventsCount(events.length);
      }
    } catch {
      setEventsError("Impossible de joindre l’API (réseau ou session expirée).");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadState();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setVerifyDetail(null);
    try {
      const res = await fetch(apiUrl("/api/ical/config"), {
        ...fetchOpts(),
        method: "PUT",
        body: JSON.stringify({ url: icalUrl.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Erreur lors de la sauvegarde");
      }
      setMessage({
        type: "success",
        text: "URL enregistrée. Utilisez « Tester la connexion », puis « Rafraîchir le cache » pour mettre à jour le site.",
      });
      await loadState();
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setMessage(null);
    setVerifyDetail(null);
    try {
      const res = await fetch(apiUrl("/api/ical/verify"), {
        ...fetchOpts(),
        method: "POST",
        body: JSON.stringify({ url: icalUrl.trim() || undefined }),
      });
      const data = (await res.json()) as VerifyResult;
      if (data && typeof data === "object" && "ok" in data && data.ok) {
        const ok = data as Extract<VerifyResult, { ok: true }>;
        setVerifyDetail(ok);
        setMessage({
          type: "success",
          text:
            ok.count === 0
              ? "Connexion OK, mais aucun événement dans la fenêtre (-120 j → +2 ans). Vérifiez que l’agenda contient des créneaux ou des récurrences."
              : `Connexion OK — ${ok.count} événement(s) lisible(s) depuis ce flux.`,
        });
      } else {
        const bad = data as Extract<VerifyResult, { ok: false }>;
        setVerifyDetail(bad);
        setMessage({ type: "error", text: bad.error || "Échec du test" });
      }
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Erreur réseau" });
    } finally {
      setTesting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await fetch(apiUrl("/api/ical/refresh"), { ...fetchOpts(), method: "POST" });
      const evRes = await fetch(apiUrl("/api/ical/events"), { credentials: "include" });
      const { events, error } = await readEventsPayload(evRes);
      if (error) {
        setEventsCount(null);
        setEventsError(error);
        throw new Error(error);
      }
      setEventsError(null);
      setEventsCount(events.length);
      setLastSync(new Date().toISOString());
      setMessage({
        type: "success",
        text: `Cache rechargé : ${events.length} événement(s) servant aux écrans réservation / dispo.`,
      });
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Erreur synchronisation" });
    } finally {
      setRefreshing(false);
    }
  };

  const copyExport = async () => {
    if (!exportUrl) return;
    try {
      await navigator.clipboard.writeText(exportUrl.startsWith("http") ? exportUrl : `${window.location.origin}${exportUrl}`);
      setMessage({ type: "success", text: "Lien d’export copié dans le presse-papiers." });
    } catch {
      setMessage({ type: "error", text: "Copie impossible — sélectionnez le champ et copiez manuellement." });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-600">
        <Loader2 className="h-10 w-10 animate-spin" style={{ color: BRAND }} />
        <p className="mt-4 text-sm font-medium">Chargement de la configuration…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <header>
        <h2 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-[var(--brand)]" style={{ ["--brand" as string]: BRAND }}>
            <Link2 className="h-6 w-6" style={{ color: BRAND }} />
          </span>
          Agenda externe (Google) — flux iCal
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
          Le site télécharge périodiquement votre fichier <strong>.ics</strong> pour afficher des créneaux occupés ou des indications sur la page
          réservation. Le flux doit être une <strong>URL secrète</strong> fournie par Google (ou tout serveur compatible WebCAL/iCal).
        </p>
      </header>

      <section className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/60 p-6 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-900">
          <Calendar className="h-5 w-5" style={{ color: BRAND }} />
          Obtenir l’URL dans Google Agenda
        </h3>
        <ol className="list-inside list-decimal space-y-2 text-sm leading-relaxed text-slate-700">
          <li>
            Ouvrez{" "}
            <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="font-semibold underline decoration-slate-400 underline-offset-2" style={{ color: BRAND }}>
              calendar.google.com
              <ExternalLink className="mb-0.5 ml-0.5 inline h-3 w-3" />
            </a>
          </li>
          <li>
            Choisissez l’agenda concerné → menu ⋮ → <strong>Paramètres et partage</strong>
          </li>
          <li>
            Section <strong>Accès aux agendas</strong> → copier le lien sous <strong>Adresse secrète au format iCal</strong> (pas le lien « intégrer » HTML).
          </li>
          <li>L’URL ressemble à : …/calendar/ical/…/basic.ics ou …/private-…/basic.ics</li>
        </ol>
        <p className="mt-4 rounded-lg border border-amber-300/60 bg-white/70 px-3 py-2 text-xs text-amber-950">
          Ne publiez jamais cette URL : elle permet de lire les titres et horaires des événements de cet agenda.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label htmlFor="ical-url" className="block text-sm font-semibold text-slate-800">
          URL du flux iCal (.ics)
        </label>
        <input
          id="ical-url"
          type="url"
          autoComplete="off"
          spellCheck={false}
          value={icalUrl}
          onChange={(e) => setIcalUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm outline-none ring-offset-2 focus:border-transparent focus:ring-2 focus:ring-[#00384A]/40"
        />

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !icalUrl.trim()}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-45"
            style={{ backgroundColor: BRAND }}
          >
            <Save className="h-4 w-4" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>

          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testing || !icalUrl.trim()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4 text-violet-600" />}
            Tester la connexion
          </button>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing || !icalUrl.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Rafraîchissement…" : "Vider le cache & recharger"}
          </button>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          <strong>Tester</strong> télécharge une fois le flux et affiche un extrait (sans passer par le cache 5 min).
          <strong> Enregistrer</strong> puis <strong>Vider le cache</strong> applique l’URL aux visiteurs du site.
        </p>

        {message && (
          <div
            className={`mt-5 flex gap-3 rounded-xl border p-4 text-sm ${
              message.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-rose-200 bg-rose-50 text-rose-950"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            )}
            <p className="leading-relaxed">{message.text}</p>
          </div>
        )}

        {verifyDetail?.ok && verifyDetail.samples.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <p className="bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">Aperçu (max. 10)</p>
            <ul className="divide-y divide-slate-100">
              {verifyDetail.samples.map((s, i) => (
                <li key={`${s.debut}-${i}`} className="px-4 py-3 text-sm">
                  <span className="font-semibold text-slate-900">{s.titre || "(Sans titre)"}</span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {new Date(s.debut).toLocaleString("fr-FR")} → {new Date(s.fin).toLocaleString("fr-FR")}
                  </span>
                  <span className="text-xs text-slate-500">{s.destination}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-bold text-slate-900">État côté site</h3>
        <p className="mt-1 text-sm text-slate-600">Données renvoyées par <code className="rounded bg-slate-100 px-1">GET /api/ical/events</code> (cache 5 minutes).</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dernier rafraîchissement manuel</dt>
            <dd className="mt-1 font-medium text-slate-900">{lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "—"}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Événements visibles API</dt>
            <dd className="mt-1 font-medium text-slate-900">{eventsCount !== null ? eventsCount : eventsError ? "Erreur" : "—"}</dd>
          </div>
        </dl>
        {eventsError && (
          <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{eventsError}</span>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-bold text-slate-900">Export planning interne (.ics)</h3>
        <p className="mt-2 text-sm text-slate-600">
          URL à coller dans un autre outil pour lire le planning bloquant (options, réservations, fermetures, arrêts techniques,
          maintenance, etc.) — hors créneaux charter encore « disponibles ». Pour un abonnement Google Agenda, l’URL doit être en{" "}
          <strong>HTTPS</strong> joignable depuis Internet ; en prod derrière un proxy, définissez la variable{" "}
          <code className="rounded bg-slate-100 px-1">PUBLIC_BASE_URL</code> (ex. <code className="rounded bg-slate-100 px-1">https://votre-domaine.fr</code>) pour que le lien copié soit correct.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            readOnly
            value={exportUrl ? (exportUrl.startsWith("http") ? exportUrl : `${typeof window !== "undefined" ? window.location.origin : ""}${exportUrl}`) : ""}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-800"
          />
          <button
            type="button"
            onClick={() => void copyExport()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <ClipboardCopy className="h-4 w-4" />
            Copier
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6">
        <h3 className="font-bold text-slate-900">Dépannage</h3>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-slate-700">
          <li>
            <strong>401 / 403</strong> : régénérez le lien secret dans Google ; un ancien lien cesse de fonctionner si vous révoquez l’accès.
          </li>
          <li>
            <strong>0 événement</strong> alors que l’agenda est plein : les récurrences sont développées sur environ <strong>2 ans</strong> à partir d’aujourd’hui ; des événements très anciens hors fenêtre peuvent être ignorés.
          </li>
          <li>
            <strong>Site en dev</strong> : utilisez <code className="rounded bg-white px-1">pnpm dev</code> sur le port où l’API répond (souvent 3000), sinon{" "}
            <code className="rounded bg-white px-1">/api/ical</code> ne joindra pas le serveur Node.
          </li>
        </ul>
      </section>
    </div>
  );
}
