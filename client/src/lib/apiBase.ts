/**
 * Base d’URL pour les requêtes API (hors router client).
 * Vide = même origine (recommandé). Pour un domaine d’API séparé avec CORS : VITE_API_ORIGIN.
 */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/+$/, "") ?? "";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_ORIGIN ? `${API_ORIGIN}${p}` : p;
}

/**
 * Gère la réponse fetch : JSON attendu, message clair si on reçoit du HTML (SPA, 404, etc.).
 */
export async function handleApiResponse<T>(res: Response): Promise<T> {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const data = (await res.json()) as (T & { error?: string }) | { error?: string };
    if (!res.ok) {
      const msg = (data as { error?: string }).error;
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return data as T;
  }
  const text = await res.text();
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<!") || head.startsWith("<html") || head.includes("doctype")) {
    throw new Error(
      import.meta.env.DEV
        ? "Réponse HTML à la place du JSON (l’URL /api n’atteint pas le serveur Node). Utilisez « pnpm dev » sur http://localhost:3000, ou lancez l’API en parallèle sur le port 3000 avec le proxy /api (voir vite.config.ts)."
        : "Réponse HTML à la place du JSON : vérifiez que /api est bien routé vers le serveur (pas seulement les fichiers statiques)."
    );
  }
  if (!res.ok) {
    throw new Error(text.slice(0, 500) || `HTTP ${res.status}`);
  }
  throw new Error("Réponse inattendue (pas de JSON).");
}
