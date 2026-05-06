import { useCallback, useEffect, useState } from "react";

type AdminRow = Record<string, unknown> & {
  source?: string;
  kind?: string;
  email?: string | null;
  label?: string;
  role?: string;
  name?: string | null;
  createdAt?: string | Date;
};

type CustomerRow = {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  authMethod: string;
  hasPassword: boolean;
  createdAt: string | Date;
};

async function readApiError(res: Response, fallback: string) {
  try {
    const payload = await res.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

function formatDate(v: string | Date | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export default function BackofficeAccountsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [message, setMessage] = useState("");
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [migrationDetail, setMigrationDetail] = useState<string | null>(null);

  const [boEmail, setBoEmail] = useState("");
  const [boPassword, setBoPassword] = useState("");
  const [boRole, setBoRole] = useState<"admin" | "viewer">("admin");

  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cFirst, setCFirst] = useState("");
  const [cLast, setCLast] = useState("");
  const [cPhone, setCPhone] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setMigrationNeeded(false);
      setMigrationDetail(null);
      const res = await fetch("/api/backoffice-users/overview", { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Chargement impossible");
      setAdmins(Array.isArray(payload.admins) ? payload.admins : []);
      setCustomers(Array.isArray(payload.customers) ? payload.customers : []);
      setMigrationNeeded(payload.backofficeLocalAccountsReady === false);
      setMigrationDetail(
        typeof payload.backofficeLocalAccountsError === "string" ? payload.backofficeLocalAccountsError : null,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Comptes administrateurs et clients</h2>
        <p className="mt-1 text-sm text-slate-600">
          Vue d’ensemble des accès backoffice (fichier .env, OAuth, comptes créés ici) et des comptes espace client.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}
      {migrationNeeded && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">
            Le serveur n’arrive pas à lire la table <code className="rounded bg-amber-100 px-1">backoffice_local_accounts</code>{" "}
            (ou elle n’existe pas sur <strong>la même</strong> base que <code className="rounded bg-amber-100 px-1">DATABASE_URL</code>).
          </p>
          {migrationDetail && (
            <p className="mt-2 font-mono text-xs text-amber-950/90 break-words">Détail : {migrationDetail}</p>
          )}
          <p className="mt-2">
            Si vous avez déjà exécuté le SQL dans Supabase : ouvrez le projet dont la chaîne de connexion est dans le{" "}
            <code className="rounded bg-amber-100 px-1">.env</code> du serveur (Settings → Database), pas un autre projet.
          </p>
          <p className="mt-2">
            Sinon : <code className="rounded bg-amber-100 px-1">git pull</code>,{" "}
            <code className="rounded bg-amber-100 px-1">npm run db:migrate</code>, redémarrage de l’app.
          </p>
        </div>
      )}
      {message && <p className="text-sm text-slate-600">{message}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Comptes backoffice</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Chargement…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Rôle / détail</th>
                  <th className="py-2 pr-3">Création</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-slate-500">
                      Aucun compte listé.
                    </td>
                  </tr>
                )}
                {admins.map((a, i) => (
                  <tr key={`${String(a.source)}-${String(a.email)}-${i}`} className="border-b border-slate-100">
                    <td className="py-2 pr-3 text-slate-700">{a.label || a.source || "—"}</td>
                    <td className="py-2 pr-3 font-medium text-slate-900">{a.email || "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {a.kind === "admin"
                        ? "Administrateur"
                        : a.kind === "viewer"
                          ? "Consultation"
                          : a.role === "viewer"
                            ? "Consultation (base)"
                            : a.role === "admin"
                              ? "Administrateur (base)"
                              : a.name
                                ? String(a.name)
                                : a.openId
                                  ? `openId: ${String(a.openId).slice(0, 12)}…`
                                  : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{formatDate(a.createdAt as string | Date | undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 border-t border-slate-100 pt-6">
          <h4 className="text-sm font-bold text-slate-900">Créer un compte backoffice</h4>
          <p className="mt-1 text-xs text-slate-500">
            Connexion sur la même page que votre compte principal. Les comptes « consultation » ne peuvent pas modifier
            les données (comme le compte .env viewer).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="email"
              value={boEmail}
              onChange={(e) => setBoEmail(e.target.value)}
              placeholder="Email"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={boPassword}
              onChange={(e) => setBoPassword(e.target.value)}
              placeholder="Mot de passe (8+ car.)"
              autoComplete="new-password"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={boRole}
              onChange={(e) => setBoRole(e.target.value as "admin" | "viewer")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="admin">Administrateur complet</option>
              <option value="viewer">Consultation seule</option>
            </select>
            <button
              type="button"
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950"
              onClick={async () => {
                setMessage("");
                try {
                  const res = await fetch("/api/backoffice-users/local-backoffice-account", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ email: boEmail, password: boPassword, role: boRole }),
                  });
                  if (!res.ok) throw new Error(await readApiError(res, "Création impossible"));
                  setMessage("Compte backoffice créé.");
                  setBoEmail("");
                  setBoPassword("");
                  await load();
                } catch (e: unknown) {
                  setMessage(e instanceof Error ? e.message : "Erreur");
                }
              }}
            >
              Créer le compte
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Comptes espace client</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Chargement…</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Nom</th>
                  <th className="py-2 pr-3">Tél.</th>
                  <th className="py-2 pr-3">Auth</th>
                  <th className="py-2 pr-3">Création</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-500">
                      Aucun client enregistré.
                    </td>
                  </tr>
                )}
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{c.email}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{c.phone || "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {c.authMethod === "password" ? "Mot de passe" : "Lien magique"}
                      {c.hasPassword ? "" : c.authMethod === "magic_link" ? " (pas de mdp)" : ""}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 border-t border-slate-100 pt-6">
          <h4 className="text-sm font-bold text-slate-900">Créer un compte client</h4>
          <p className="mt-1 text-xs text-slate-500">
            Sans mot de passe : le client utilisera un lien magique depuis la page espace client. Avec mot de passe : connexion
            directe (minimum 8 caractères).
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              type="email"
              value={cEmail}
              onChange={(e) => setCEmail(e.target.value)}
              placeholder="Email *"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={cPassword}
              onChange={(e) => setCPassword(e.target.value)}
              placeholder="Mot de passe (optionnel)"
              autoComplete="new-password"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={cFirst}
              onChange={(e) => setCFirst(e.target.value)}
              placeholder="Prénom"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={cLast}
              onChange={(e) => setCLast(e.target.value)}
              placeholder="Nom"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
              placeholder="Téléphone"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950"
              onClick={async () => {
                setMessage("");
                try {
                  const res = await fetch("/api/backoffice-users/customer", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                      email: cEmail,
                      password: cPassword.trim() || undefined,
                      firstName: cFirst || undefined,
                      lastName: cLast || undefined,
                      phone: cPhone || undefined,
                    }),
                  });
                  const payload = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(payload?.error || "Création impossible");
                  setMessage(
                    payload?.hint
                      ? `Client créé. ${payload.hint}`
                      : "Client créé avec mot de passe.",
                  );
                  setCEmail("");
                  setCPassword("");
                  setCFirst("");
                  setCLast("");
                  setCPhone("");
                  await load();
                } catch (e: unknown) {
                  setMessage(e instanceof Error ? e.message : "Erreur");
                }
              }}
            >
              Créer le client
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
