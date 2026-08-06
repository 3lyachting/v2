import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Check, X, Anchor, Mail, Home, Loader2 } from "lucide-react";

type PaymentConfirmation = {
  reservationId: number;
  paid: boolean;
  statutPaiement: string;
  amountPaidCents: number;
  amountPaidLabel: string;
  destination: string | null;
  dateDebut?: string;
  dateFin?: string;
  clientFirstName: string | null;
};

function formatPeriod(start?: string, end?: string) {
  if (!start) return null;
  const a = new Date(start).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  if (!end) return a;
  const b = new Date(end).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return a === b ? a : `${a} → ${b}`;
}

export function ReservationSucces() {
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const reservationId = params.get("reservation_id");
  const sessionId = params.get("session_id");

  const [stripeDetails, setStripeDetails] = useState<any>(null);
  const [confirmation, setConfirmation] = useState<PaymentConfirmation | null>(null);
  const [polling, setPolling] = useState(Boolean(reservationId));
  const [pollAttempts, setPollAttempts] = useState(0);

  useEffect(() => {
    if (sessionId) {
      fetch(`/api/stripe/session/${sessionId}`)
        .then((r) => r.json())
        .then(setStripeDetails)
        .catch(console.error);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!reservationId) {
      setPolling(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12; // ~24s — le webhook Mollie arrive parfois juste après le redirect

    const tick = async () => {
      attempts += 1;
      if (!cancelled) setPollAttempts(attempts);
      try {
        const res = await fetch(`/api/mollie/payment-confirmation/${reservationId}`);
        if (res.ok) {
          const data = (await res.json()) as PaymentConfirmation;
          if (!cancelled) setConfirmation(data);
          if (data.paid) {
            if (!cancelled) setPolling(false);
            return;
          }
        }
      } catch {
        // ignore, on réessaie
      }
      if (attempts >= maxAttempts) {
        if (!cancelled) setPolling(false);
        return;
      }
      window.setTimeout(tick, 2000);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  const paidConfirmed = Boolean(confirmation?.paid) || Boolean(stripeDetails);
  const amountLabel =
    confirmation?.amountPaidLabel && confirmation.amountPaidCents > 0
      ? confirmation.amountPaidLabel
      : stripeDetails?.amountTotal
        ? `${(stripeDetails.amountTotal / 100).toLocaleString("fr-FR")} €`
        : null;

  return (
    <div className="min-h-screen bg-[oklch(0.08_0.04_220)] text-white flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <div className="w-20 h-20 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center mx-auto mb-6">
          {polling && !paidConfirmed ? (
            <Loader2 className="w-10 h-10 text-green-400 animate-spin" />
          ) : (
            <Check className="w-10 h-10 text-green-400" />
          )}
        </div>

        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "Syne, sans-serif" }}>
          {paidConfirmed ? "Paiement confirmé !" : polling ? "Confirmation en cours…" : "Merci !"}
        </h1>
        <p className="text-white/60 mb-8">
          {paidConfirmed
            ? "Votre paiement a bien été reçu. Un email de confirmation vous a été envoyé."
            : polling
              ? "Nous vérifions la réception de votre paiement auprès de la banque…"
              : "Si vous venez de payer, la confirmation peut prendre quelques instants. Un email vous sera envoyé dès validation."}
          {reservationId ? (
            <>
              <br />
              <span className="text-white/80 font-medium">Dossier #{reservationId}</span>
            </>
          ) : null}
        </p>

        {(confirmation || stripeDetails) && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 text-left space-y-3">
            {confirmation?.clientFirstName && (
              <div className="flex justify-between gap-4">
                <span className="text-white/60 text-sm">Client</span>
                <span className="font-medium text-sm">{confirmation.clientFirstName}</span>
              </div>
            )}
            {stripeDetails?.customerEmail && (
              <div className="flex justify-between gap-4">
                <span className="text-white/60 text-sm">Email</span>
                <span className="font-medium text-sm">{stripeDetails.customerEmail}</span>
              </div>
            )}
            {amountLabel && (
              <div className="flex justify-between gap-4">
                <span className="text-white/60 text-sm">Montant reçu</span>
                <span className="font-bold text-[oklch(0.82_0.1_85)]">{amountLabel}</span>
              </div>
            )}
            {confirmation?.destination && (
              <div className="flex justify-between gap-4">
                <span className="text-white/60 text-sm">Destination</span>
                <span className="font-medium text-sm text-right">{confirmation.destination}</span>
              </div>
            )}
            {formatPeriod(confirmation?.dateDebut, confirmation?.dateFin) && (
              <div className="flex justify-between gap-4">
                <span className="text-white/60 text-sm">Période</span>
                <span className="font-medium text-sm text-right">
                  {formatPeriod(confirmation?.dateDebut, confirmation?.dateFin)}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="text-white/60 text-sm">Statut</span>
              <span className={`text-sm font-medium ${paidConfirmed ? "text-green-400" : "text-amber-300"}`}>
                {paidConfirmed ? "Payé" : polling ? `Vérification (${pollAttempts})…` : "En attente de confirmation"}
              </span>
            </div>
          </div>
        )}

        <div className="bg-[oklch(0.82_0.1_85)]/10 border border-[oklch(0.82_0.1_85)]/30 rounded-2xl p-6 mb-6">
          <Mail className="w-5 h-5 text-[oklch(0.82_0.1_85)] mx-auto mb-3" />
          <p className="text-sm text-white/80">
            {paidConfirmed
              ? "Un email de confirmation a été envoyé à l'adresse utilisée pour la réservation."
              : "Dès que le paiement est validé, un email de confirmation part automatiquement."}
            <br />
            Capitaine Victor ou un membre de l'équipage vous recontactera si besoin pour la suite.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => setLocation("/espace-client")}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[oklch(0.72_0.11_85)] text-[oklch(0.15_0.05_220)] hover:bg-[oklch(0.62_0.11_85)] transition-colors font-bold"
          >
            Mon espace client
          </button>
          <button
            onClick={() => setLocation("/")}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/20"
          >
            <Home className="w-4 h-4" />
            Retour à l'accueil
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReservationAnnule() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[oklch(0.08_0.04_220)] text-white flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <div className="w-20 h-20 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mx-auto mb-6">
          <X className="w-10 h-10 text-red-400" />
        </div>

        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: "Syne, sans-serif" }}>
          Paiement annulé
        </h1>
        <p className="text-white/60 mb-8">
          Votre paiement a été annulé. Aucun montant n'a été débité.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[oklch(0.72_0.11_85)] text-[oklch(0.15_0.05_220)] hover:bg-[oklch(0.62_0.11_85)] transition-colors font-bold"
          >
            <Anchor className="w-4 h-4" />
            Réessayer
          </button>
          <button
            onClick={() => setLocation("/")}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors border border-white/20"
          >
            <Home className="w-4 h-4" />
            Retour à l'accueil
          </button>
        </div>
      </div>
    </div>
  );
}
