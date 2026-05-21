import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiUrl, handleApiResponse } from "@/lib/apiBase";

export type PendingReservationRequest = {
  id: number;
  nomClient: string;
  prenomClient: string | null;
  emailClient: string;
  dateDebut: string;
  dateFin: string;
  destination: string | null;
  formule: string | null;
  createdAt: string;
};

type PendingResponse = {
  count: number;
  items: PendingReservationRequest[];
};

const STORAGE_KEY = "sabine-admin-known-demand-ids";
const DEFAULT_POLL_MS = 45_000;

function readKnownIds(): Set<number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as number[];
    return new Set(Array.isArray(parsed) ? parsed.filter((n) => Number.isFinite(n)) : []);
  } catch {
    return new Set();
  }
}

function writeKnownIds(ids: Set<number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore quota */
  }
}

function formatClientName(r: PendingReservationRequest) {
  return [r.prenomClient, r.nomClient].filter(Boolean).join(" ").trim() || r.nomClient || "Client";
}

function formatStayDates(r: PendingReservationRequest) {
  const start = new Date(r.dateDebut).toLocaleDateString("fr-FR", { timeZone: "UTC" });
  const end = new Date(r.dateFin).toLocaleDateString("fr-FR", { timeZone: "UTC" });
  return start === end ? start : `${start} → ${end}`;
}

function showBrowserNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || !document.hidden) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "/logo-sabine.png" });
  } catch {
    /* ignore */
  }
}

async function ensureNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      /* user dismissed */
    }
  }
}

export function usePendingReservationAlerts(options: {
  enabled: boolean;
  pollIntervalMs?: number;
  onOpenRequest?: (id: number) => void;
}) {
  const { enabled, pollIntervalMs = DEFAULT_POLL_MS, onOpenRequest } = options;
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingItems, setPendingItems] = useState<PendingReservationRequest[]>([]);
  const knownIdsRef = useRef<Set<number>>(readKnownIds());
  const initializedRef = useRef(false);
  const onOpenRequestRef = useRef(onOpenRequest);
  onOpenRequestRef.current = onOpenRequest;

  const notifyNewRequests = useCallback((incoming: PendingReservationRequest[]) => {
    for (const r of incoming) {
      const name = formatClientName(r);
      const dates = formatStayDates(r);
      const dest = r.destination ? ` · ${r.destination}` : "";

      toast.info(`Nouvelle demande — ${name}`, {
        description: `${dates}${dest}`,
        duration: 12_000,
        action: onOpenRequestRef.current
          ? {
              label: "Traiter",
              onClick: () => onOpenRequestRef.current?.(r.id),
            }
          : undefined,
      });

      showBrowserNotification(
        `Nouvelle demande — ${name}`,
        `${dates}${dest}`,
        `sabine-resa-${r.id}`
      );
    }

    if (incoming.length > 1) {
      toast.message(`${incoming.length} nouvelles demandes à traiter`, {
        description: "Consultez l’onglet Calendrier pour les valider.",
        duration: 8_000,
      });
    }
  }, []);

  const poll = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(apiUrl("/api/reservations/pending-requests"), { credentials: "include" });
      const data = await handleApiResponse<PendingResponse>(res);
      const items = Array.isArray(data.items) ? data.items : [];
      setPendingCount(Number(data.count) || items.length);
      setPendingItems(items);

      const currentIds = new Set(items.map((i) => i.id));

      if (!initializedRef.current) {
        initializedRef.current = true;
        knownIdsRef.current = currentIds;
        writeKnownIds(currentIds);
        return;
      }

      const incoming = items.filter((i) => !knownIdsRef.current.has(i.id));
      if (incoming.length > 0) {
        void ensureNotificationPermission();
        notifyNewRequests(incoming);
        window.dispatchEvent(new CustomEvent("sabine:refresh-reservations"));
      }

      knownIdsRef.current = currentIds;
      writeKnownIds(currentIds);
    } catch {
      /* silencieux en arrière-plan */
    }
  }, [enabled, notifyNewRequests]);

  useEffect(() => {
    if (!enabled) return;
    void poll();
    const timer = window.setInterval(() => void poll(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, poll, pollIntervalMs]);

  const resetKnownIds = useCallback(() => {
    const ids = new Set(pendingItems.map((i) => i.id));
    knownIdsRef.current = ids;
    writeKnownIds(ids);
  }, [pendingItems]);

  return { pendingCount, pendingItems, refresh: poll, resetKnownIds };
}
