import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Anchor, ArrowLeft, Calendar, Check, Send, Shield, Users } from "lucide-react";
import { inferSlotType, isTransatType } from "@shared/slotRules";
import { computeReservedUnits } from "@shared/charterCapacity";

type FormuleKey = "croisiere_mediterranee" | "transatlantique" | "croisiere_caraibes" | "journee_privee";
type TypeReservation = "bateau_entier" | "cabine" | "place";
type Statut = "disponible" | "reserve" | "option" | "ferme";

type Disponibilite = {
  id: number;
  debut: string;
  fin: string;
  statut: Statut;
  planningType?: "charter" | "technical_stop" | "maintenance" | "blocked";
  tarif: number | null;
  tarifCabine?: number | null;
  tarifJourPersonne?: number | null;
  tarifJourPriva?: number | null;
  destination: string;
  note?: string | null;
  capaciteTotale?: number;
  cabinesReservees?: number;
};

type IcalEvent = {
  debut: string;
  fin: string;
  statut: Statut;
  destination: string;
};

type SeasonPricingProduct = "med" | "transat" | "caraibes" | "journee";

type ProductSeasonPricing = {
  highSeasonPerPassenger: number | null;
  lowSeasonPerPassenger: number | null;
  highSeasonPrivate: number | null;
  lowSeasonPrivate: number | null;
};

type SeasonPricingConfig = Record<SeasonPricingProduct, ProductSeasonPricing>;

const FORMULES: Record<FormuleKey, { label: string; maxPers: number; description: string; defaultDuration: number }> = {
  croisiere_mediterranee: { label: "Croisières Méditerranée", maxPers: 8, description: "Croisières Med (jours flexibles + semaines été)", defaultDuration: 7 },
  transatlantique: { label: "Transatlantique", maxPers: 8, description: "Traversées océaniques", defaultDuration: 10 },
  croisiere_caraibes: { label: "Croisières Caraïbes", maxPers: 8, description: "Grenadines au départ de Fort-de-France", defaultDuration: 7 },
  journee_privee: { label: "Journée privative", maxPers: 12, description: "La Ciotat - Cassis (plage de l'Arène) - retour", defaultDuration: 1 },
};

const FORMULE_BY_PRODUCT: Record<string, FormuleKey> = {
  med: "croisiere_mediterranee",
  caraibes: "croisiere_caraibes",
  journee: "journee_privee",
  transat: "transatlantique",
};

const DEFAULT_SEASON_PRICING: SeasonPricingConfig = {
  med: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  transat: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  caraibes: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
  journee: { highSeasonPerPassenger: null, lowSeasonPerPassenger: null, highSeasonPrivate: null, lowSeasonPrivate: null },
};

const toIsoDay = (d: Date) => d.toISOString().split("T")[0];
const addDays = (isoDay: string, days: number) => {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDay(d);
};

const monthLabel = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const utcDay = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`).getUTCDay();
const daysBetweenInclusive = (startIso: string, endIso: string) => {
  const start = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const end = new Date(`${endIso}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
};

function isHighSeasonDate(dateInput: string | Date) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return false;
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (month === 7 || month === 8) return true;
  if (month === 12 && day >= 15) return true;
  if (month === 1 && day <= 8) return true;
  if (month === 2) return true;
  return false;
}

function toSeasonPricingProduct(formule: FormuleKey): SeasonPricingProduct {
  if (formule === "croisiere_mediterranee") return "med";
  if (formule === "croisiere_caraibes") return "caraibes";
  if (formule === "journee_privee") return "journee";
  return "transat";
}

type BookingRule = {
  name: string;
  minDuration: number;
  maxDuration: number;
  fixedDuration?: number;
  saturdayStartOnly?: boolean;
};
const ruleForDay = (isoDay: string): BookingRule => {
  const month = Number(isoDay.slice(5, 7));
  if (month === 4 || month === 5) {
    return { name: "avril-mai-privatif-journee", minDuration: 1, maxDuration: 1, fixedDuration: 1 };
  }
  if (month === 6 || month === 7 || month === 8) {
    return {
      name: "juin-aout-samedi",
      minDuration: 8,
      maxDuration: 8,
      fixedDuration: 8,
      saturdayStartOnly: true,
    };
  }
  return {
    name: "hebdo-samedi",
    minDuration: 8,
    maxDuration: 8,
    fixedDuration: 8,
    saturdayStartOnly: true,
  };
};

export default function Reservation() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successContact, setSuccessContact] = useState({ nom: "", email: "" });
  const [successAccountMsg, setSuccessAccountMsg] = useState("");
  const BRAND_DEEP = "#00384A";
  const BRAND_SAND = "#D8C19E";
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [formuleKey, setFormuleKey] = useState<FormuleKey>("croisiere_mediterranee");
  const [typeReservation, setTypeReservation] = useState<TypeReservation>("bateau_entier");
  const [durationDays, setDurationDays] = useState(7);
  const [selectedStartDay, setSelectedStartDay] = useState<string>("");
  /** Fin de période imposée par l'URL (calendrier = une seule période charterSlots). */
  const [prefilledEndIso, setPrefilledEndIso] = useState<string | null>(null);
  const [disponibilites, setDisponibilites] = useState<Disponibilite[]>([]);
  const [icalEvents, setIcalEvents] = useState<IcalEvent[]>([]);
  const [seasonPricing, setSeasonPricing] = useState<SeasonPricingConfig>(DEFAULT_SEASON_PRICING);

  const [form, setForm] = useState({
    nomClient: "",
    prenomClient: "",
    emailClient: "",
    telClient: "",
    nbPersonnes: 2,
    nbCabines: 1,
    message: "",
    acceptCgv: false,
  });

  const formule = FORMULES[formuleKey];
  const isTransat = formuleKey === "transatlantique";
  const isJournee = formuleKey === "journee_privee";
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);

  useEffect(() => {
    setDurationDays(FORMULES[formuleKey].defaultDuration);
    if (isTransat) {
      setTypeReservation("place");
      setForm(prev => ({ ...prev, nbCabines: 1, nbPersonnes: 1 }));
    } else if (isJournee) {
      setTypeReservation("bateau_entier");
      setForm(prev => ({ ...prev, nbCabines: 4 }));
    }
  }, [formuleKey, isTransat, isJournee]);

  useEffect(() => {
    const dateDebut = searchParams.get("dateDebut");
    const dateFin = searchParams.get("dateFin");
    const typeFromUrl = searchParams.get("typeReservation");
    const formuleFromUrl = searchParams.get("formule");
    const produitFromUrl = searchParams.get("produit");
    const nbPersonnesFromUrl = searchParams.get("nbPersonnes");

    if (produitFromUrl && FORMULE_BY_PRODUCT[produitFromUrl]) {
      setFormuleKey(FORMULE_BY_PRODUCT[produitFromUrl]);
    } else if (formuleFromUrl && (Object.keys(FORMULES) as FormuleKey[]).includes(formuleFromUrl as FormuleKey)) {
      setFormuleKey(formuleFromUrl as FormuleKey);
    } else if (formuleFromUrl === "journee") {
      setFormuleKey("journee_privee");
    }
    if (typeFromUrl === "bateau_entier" || typeFromUrl === "cabine" || typeFromUrl === "place") {
      setTypeReservation(typeFromUrl);
    }
    if (nbPersonnesFromUrl) {
      const parsed = parseInt(nbPersonnesFromUrl, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        setForm((prev) => ({ ...prev, nbPersonnes: parsed }));
      }
    }

    if (dateDebut) {
      setSelectedStartDay(dateDebut);
    }
    if (dateFin) {
      setPrefilledEndIso(dateFin);
    } else {
      setPrefilledEndIso(null);
    }
    if (dateDebut && dateFin) {
      const duration = daysBetweenInclusive(dateDebut, dateFin);
      setDurationDays(duration);
      // Arrivée depuis le calendrier = aller directement à l'étape finale
      setStep(4);
    }
  }, [searchParams]);

  const activeRule = useMemo(() => ruleForDay(selectedStartDay || toIsoDay(new Date())), [selectedStartDay]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoadingData(true);
        const cacheBust = `t=${Date.now()}`;
        const [dispoRes, icalRes, seasonRes] = await Promise.all([
          fetch(`/api/disponibilites?${cacheBust}`, { cache: "no-store" }),
          fetch(`/api/ical/events?${cacheBust}`, { cache: "no-store" }),
          fetch("/api/backoffice-ops/season-pricing", { cache: "no-store" }),
        ]);
        const dispoData = await dispoRes.json();
        if (!dispoRes.ok) throw new Error(dispoData.error || "Erreur chargement disponibilites");
        setDisponibilites(Array.isArray(dispoData) ? dispoData : []);
        const icalData = icalRes.ok ? await icalRes.json() : [];
        setIcalEvents(Array.isArray(icalData) ? icalData : []);
        const seasonData = seasonRes.ok ? await seasonRes.json() : {};
        setSeasonPricing({ ...DEFAULT_SEASON_PRICING, ...(seasonData || {}) });
      } catch (err: any) {
        setError(err.message || "Erreur de chargement");
      } finally {
        setLoadingData(false);
      }
    };
    void fetchData();
  }, []);

  const blockedDays = useMemo(() => {
    const set = new Set<string>();
    for (const d of disponibilites) {
      const planningBlocked = d.planningType === "technical_stop" || d.planningType === "maintenance" || d.planningType === "blocked";
      const statusBlocked = d.statut !== "disponible";
      if (!planningBlocked && !statusBlocked) continue;
      let cursor = toIsoDay(new Date(d.debut));
      const end = toIsoDay(new Date(d.fin));
      while (cursor <= end) {
        set.add(cursor);
        cursor = addDays(cursor, 1);
      }
    }
    for (const ev of icalEvents) {
      if (ev.statut === "disponible") continue;
      const start = toIsoDay(new Date(ev.debut));
      let end = toIsoDay(new Date(ev.fin));
      const endDate = new Date(ev.fin);
      if (endDate.getUTCHours() === 0 && endDate.getUTCMinutes() === 0 && endDate.getUTCSeconds() === 0) {
        end = addDays(end, -1);
      }
      let cursor = start;
      while (cursor <= end) {
        set.add(cursor);
        cursor = addDays(cursor, 1);
      }
    }
    return set;
  }, [icalEvents, disponibilites]);

  const availableStartDays = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 0; i < 365; i++) {
      const iso = toIsoDay(new Date(start.getTime() + i * 86400000));
      const rule = ruleForDay(iso);
      if (rule?.saturdayStartOnly && utcDay(iso) !== 6) continue;
      const effectiveDuration = rule?.fixedDuration || durationDays;
      let canReserve = true;
      for (let j = 0; j < effectiveDuration; j++) {
        if (blockedDays.has(addDays(iso, j))) {
          canReserve = false;
          break;
        }
      }
      if (canReserve) days.push(iso);
    }
    return days;
  }, [blockedDays, durationDays]);

  const groupedDays = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const day of availableStartDays) {
      const k = monthLabel(day);
      if (!groups[k]) groups[k] = [];
      groups[k].push(day);
    }
    return groups;
  }, [availableStartDays]);

  const selectedStart = selectedStartDay || availableStartDays[0] || "";
  const selectedRule = selectedStart ? ruleForDay(selectedStart) : null;
  const selectedMonth = selectedStart ? Number(selectedStart.slice(5, 7)) : null;
  const isAprilMaySelection = selectedMonth === 4 || selectedMonth === 5;
  const isSummerSelection = selectedMonth === 6 || selectedMonth === 7 || selectedMonth === 8;
  const effectiveDuration = selectedRule?.fixedDuration || durationDays;
  const selectedEnd =
    prefilledEndIso && selectedStart && prefilledEndIso >= selectedStart
      ? prefilledEndIso
      : selectedStart
        ? addDays(selectedStart, effectiveDuration - 1)
        : "";

  useEffect(() => {
    if (!selectedRule) return;
    if (selectedRule.fixedDuration && selectedRule.fixedDuration !== durationDays) {
      setDurationDays(selectedRule.fixedDuration);
    }
  }, [selectedRule, durationDays]);

  useEffect(() => {
    if (isAprilMaySelection && typeReservation !== "bateau_entier") {
      setTypeReservation("bateau_entier");
    }
  }, [isAprilMaySelection, typeReservation]);

  const pricingDispo = useMemo(
    () => {
      if (!selectedStart) return null;
      const exact = disponibilites.find((d) => {
        const dStart = toIsoDay(new Date(d.debut));
        return dStart === selectedStart;
      });
      if (exact) return exact;
      const containing = disponibilites.find((d) => {
          const dStart = toIsoDay(new Date(d.debut));
          const dEnd = toIsoDay(new Date(d.fin));
          // Comparaison stricte sur la fin pour éviter de matcher la semaine précédente sur samedi de rotation.
          if (!(selectedStart >= dStart && selectedStart < dEnd)) return false;
          // Evite d'accrocher des reliquats transat hors fenêtre commerciale.
          const slotType = inferSlotType(d as any);
          if (String(d.destination || "").toLowerCase().includes("transat") && !isTransatType(slotType)) {
            return false;
          }
          return true;
        });
      return containing || null;
    },
    [disponibilites, selectedStart]
  );

  const destination = pricingDispo?.destination || "Méditerranée";
  const pricingSlotType = pricingDispo ? inferSlotType(pricingDispo as any) : "other";
  const isTransatSelection = isTransatType(pricingSlotType);
  const urlMontantTotalEur = Number(searchParams.get("montant") || "");
  const weeklyCabineEur = pricingDispo?.tarifCabine ?? 3900;
  const weeklyPrivaEur = pricingDispo?.tarif ?? 15000;
  const dayTripPrivaEur = pricingDispo?.tarifJourPriva ?? 1000;
  const seasonProduct = toSeasonPricingProduct(formuleKey);
  const seasonPrivateEur = selectedStart
    ? isHighSeasonDate(selectedStart)
      ? seasonPricing[seasonProduct]?.highSeasonPrivate
      : seasonPricing[seasonProduct]?.lowSeasonPrivate
    : null;
  const effectivePrivatePriceEur = seasonPrivateEur ?? (isJournee ? dayTripPrivaEur : weeklyPrivaEur);
  const disponibiliteTotalUnits = pricingDispo?.capaciteTotale ?? 4;
  const disponibiliteReservedUnits = pricingDispo?.cabinesReservees ?? 0;
  const disponibiliteFreeUnits = Math.max(0, disponibiliteTotalUnits - disponibiliteReservedUnits);
  const maxPersonnesByAvailability =
    typeReservation === "bateau_entier"
      ? formule.maxPers
      : typeReservation === "cabine"
        ? disponibiliteFreeUnits * 2
        : disponibiliteFreeUnits;
  const maxPersonnesSelectable = Math.max(1, Math.min(formule.maxPers, maxPersonnesByAvailability || formule.maxPers));
  const requiredCabins = computeReservedUnits({
    typeReservation: "cabine",
    nbPersonnes: form.nbPersonnes,
  });
  const safePersons = Math.max(1, form.nbPersonnes || 1);
  const prefilledTotalCents =
    Number.isFinite(urlMontantTotalEur) && urlMontantTotalEur > 0 ? Math.round(urlMontantTotalEur * 100) : null;
  const selectedWeeklyPrice =
    isTransatSelection
      ? 3000
      : isJournee
        ? seasonPrivateEur ?? dayTripPrivaEur
      : typeReservation === "bateau_entier"
        ? seasonPrivateEur ?? weeklyPrivaEur
        : weeklyCabineEur;
  const montantTotalCalcule =
    isTransatSelection
      ? selectedWeeklyPrice * safePersons * 100
      : typeReservation === "bateau_entier"
      ? selectedWeeklyPrice * 100
      : typeReservation === "cabine"
        ? selectedWeeklyPrice * requiredCabins * 100
        : selectedWeeklyPrice * 100;
  const hasCalendarPrefill = Boolean(searchParams.get("dateDebut") && searchParams.get("dateFin"));
  const showPrefilledEstimate = Boolean(hasCalendarPrefill && prefilledTotalCents !== null && step === 4);
  const montantTotal = showPrefilledEstimate && prefilledTotalCents != null ? prefilledTotalCents : montantTotalCalcule;

  useEffect(() => {
    if (!isTransatSelection) return;
    if (typeReservation !== "place") setTypeReservation("place");
    setForm((prev) => ({
      ...prev,
      nbCabines: Math.max(1, Math.min(4, prev.nbPersonnes || 1)),
      nbPersonnes: Math.max(1, Math.min(4, prev.nbPersonnes || 1)),
    }));
  }, [isTransatSelection, typeReservation]);

  useEffect(() => {
    if (!isTransatSelection) return;
    setForm((prev) => ({ ...prev, nbCabines: Math.max(1, Math.min(4, prev.nbPersonnes || 1)) }));
  }, [isTransatSelection, form.nbPersonnes]);

  useEffect(() => {
    if (isTransatSelection || typeReservation !== "cabine") return;
    setForm((prev) => ({
      ...prev,
      nbCabines: computeReservedUnits({ typeReservation: "cabine", nbPersonnes: prev.nbPersonnes }),
    }));
  }, [isTransatSelection, typeReservation, form.nbPersonnes]);

  const canSubmit = Boolean(
    selectedStart &&
    form.nomClient.trim() &&
    form.prenomClient.trim() &&
    form.emailClient.trim() &&
    form.nbPersonnes >= 1 &&
    form.nbPersonnes <= maxPersonnesSelectable &&
    form.acceptCgv
  );

  useEffect(() => {
    if (form.nbPersonnes > maxPersonnesSelectable) {
      setForm((prev) => ({ ...prev, nbPersonnes: maxPersonnesSelectable }));
    }
  }, [form.nbPersonnes, maxPersonnesSelectable]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStart || !selectedEnd) return;
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams(window.location.search);
      const charterSlotIdRaw = sp.get("charterSlotId");
      const charterProduct = sp.get("produit");
      const charterSlotId =
        charterSlotIdRaw && /^\d+$/.test(charterSlotIdRaw.trim()) ? parseInt(charterSlotIdRaw.trim(), 10) : null;
      const payload: Record<string, unknown> = {
        nomClient: form.nomClient,
        prenomClient: form.prenomClient,
        emailClient: form.emailClient,
        telClient: form.telClient,
        nbPersonnes: form.nbPersonnes,
        typeReservation,
        nbCabines: computeReservedUnits({
          typeReservation,
          nbPersonnes: form.nbPersonnes,
          nbCabines: typeReservation === "bateau_entier" ? 4 : form.nbCabines,
        }),
        message: form.message,
        destination,
        formule: formuleKey,
        disponibiliteId: charterSlotId ? null : pricingDispo?.id || null,
        montantTotal,
        dateDebut: `${selectedStart}T00:00:00.000Z`,
        dateFin: `${selectedEnd}T00:00:00.000Z`,
      };
      if (charterSlotId) {
        payload.charterSlotId = charterSlotId;
        if (charterProduct) payload.charterProduct = charterProduct;
      }
      const res = await fetch("/api/reservations/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'envoi");
      setSuccessContact({ nom: form.nomClient, email: form.emailClient });
      setSuccessAccountMsg("Compte client cree. Votre mot de passe vous a ete envoye par email.");
      setSuccess(true);
      setTimeout(() => setLocation("/"), 3000);
    } catch (err: any) {
      setError(err.message || "Erreur");
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#f5f1e8] text-slate-900 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "Syne, sans-serif" }}>Demande envoyee !</h1>
          <p className="text-slate-600 mb-6">Merci {successContact.nom}. Confirmation envoyee a {successContact.email}.</p>
          <p className="text-slate-600 text-sm">{successAccountMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f1e8] text-slate-900">
      <header className="border-b py-4 px-6" style={{ borderColor: "#d6c8b1", backgroundColor: "#f8f4eb" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button onClick={() => setLocation("/")} className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">Retour</span>
          </button>
          <div className="flex items-center gap-2" style={{ color: BRAND_DEEP }}><Anchor className="w-4 h-4" /><span className="font-bold">Sabine Sailing</span></div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-2" style={{ fontFamily: "Syne, sans-serif" }}>Reserver votre croisiere</h1>
        <p className="text-slate-600 mb-8">Choisissez un type, une duree, puis un depart. Les periodes a depart samedi sont imposees automatiquement.</p>
        {selectedStartDay && step === 4 && (
          <div className="mb-6 rounded-xl border px-4 py-3 text-sm text-slate-700" style={{ borderColor: "#d6c8b1", backgroundColor: "#efe5d6" }}>
            Période préremplie depuis le calendrier. Vous pouvez envoyer votre demande directement.
            {showPrefilledEstimate && (
              <span className="block mt-1 font-semibold" style={{ color: BRAND_DEEP }}>
                Estimation reprise du calendrier: {(montantTotal / 100).toLocaleString("fr-FR")} EUR
              </span>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr_360px] gap-8">
          <div className="space-y-6">
            {step === 1 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-xl font-bold mb-4">Choisissez votre produit</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {(Object.keys(FORMULES) as FormuleKey[]).map(key => (
                    <button
                      key={key}
                      onClick={() => setFormuleKey(key)}
                      className={`text-left rounded-xl border-2 p-4 ${formuleKey === key ? "" : "border-slate-200"}`}
                      style={formuleKey === key ? { borderColor: BRAND_SAND, backgroundColor: "#f9f3ea" } : {}}
                    >
                      <p className="font-bold">{FORMULES[key].label}</p>
                      <p className="text-slate-600 text-sm mt-1">{FORMULES[key].description}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-6 flex justify-end"><button onClick={() => setStep(2)} className="px-5 py-2.5 rounded-xl text-white font-bold" style={{ backgroundColor: BRAND_DEEP }}>Continuer</button></div>
              </div>
            )}

            {step === 2 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-xl font-bold mb-4">Type et duree</h2>
                <div className="grid md:grid-cols-2 gap-4 mb-5">
                  <button
                    onClick={() => setTypeReservation("bateau_entier")}
                    className={`text-left rounded-xl border-2 p-4 ${typeReservation === "bateau_entier" ? "" : "border-slate-200"}`}
                    style={typeReservation === "bateau_entier" ? { borderColor: BRAND_SAND, backgroundColor: "#f9f3ea" } : {}}
                  >
                    <p className="font-bold">Privatif</p>
                  </button>
                  {!isJournee && !isAprilMaySelection && !isTransatSelection && (
                    <button
                      onClick={() => setTypeReservation(isTransat ? "place" : "cabine")}
                      className={`text-left rounded-xl border-2 p-4 ${typeReservation !== "bateau_entier" ? "" : "border-slate-200"}`}
                      style={typeReservation !== "bateau_entier" ? { borderColor: BRAND_SAND, backgroundColor: "#f9f3ea" } : {}}
                    >
                      <p className="font-bold">{isTransat ? "A la place" : "A la cabine / personne"}</p>
                    </button>
                  )}
                </div>
                {isTransatSelection && (
                  <p className="text-xs text-slate-600 mb-3">Transat: sélection automatique de toute la traversée, 3000€/personne, capacité 4 places.</p>
                )}
                {isAprilMaySelection && (
                  <p className="text-xs text-slate-600 mb-3">Avril/Mai: privatif unique 950€/jour, départ La Ciotat.</p>
                )}
                {isSummerSelection && (
                  <p className="text-xs text-slate-600 mb-3">Juin/Juillet/Août: réservation samedi → samedi, cabine (1..4) ou privatif.</p>
                )}

                <label className="text-sm text-slate-600">
                  Duree (jours): {activeRule?.fixedDuration || durationDays}
                  {activeRule?.saturdayStartOnly ? " · départ samedi uniquement" : ""}
                </label>
                <input
                  type="range"
                  min={activeRule?.minDuration || 1}
                  max={activeRule?.maxDuration || 21}
                  value={activeRule?.fixedDuration || durationDays}
                  onChange={e => setDurationDays(parseInt(e.target.value, 10))}
                  disabled={Boolean(activeRule?.fixedDuration)}
                  className="w-full mt-2"
                />

                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => setStep(1)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700">Retour</button>
                  <button onClick={() => setStep(3)} className="px-5 py-2.5 rounded-xl text-white font-bold" style={{ backgroundColor: BRAND_DEEP }}>Choisir un depart</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><Calendar className="w-5 h-5" />Jours de depart libres</h2>
                <p className="text-slate-600 text-sm mb-4">Les jours en arret technique/maintenance sont bloques. Certaines periodes imposent un depart le samedi.</p>
                {loadingData ? <p className="text-slate-600 text-sm">Chargement...</p> : (
                  <div className="space-y-4 max-h-[420px] overflow-auto pr-1">
                    {Object.entries(groupedDays).slice(0, 6).map(([month, days]) => (
                      <div key={month}>
                        <h3 className="text-xs uppercase text-slate-500 mb-2">{month}</h3>
                        <div className="flex flex-wrap gap-2">
                          {days.slice(0, 40).map(day => {
                            const rule = ruleForDay(day);
                            return (
                            <button
                              key={day}
                              onClick={() => setSelectedStartDay(day)}
                              className={`px-3 py-2 rounded-lg border text-sm ${selectedStartDay === day ? "" : "border-slate-300"}`}
                              style={selectedStartDay === day ? { borderColor: BRAND_SAND, backgroundColor: "#f9f3ea" } : {}}
                            >
                              {new Date(`${day}T00:00:00.000Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                              {rule?.saturdayStartOnly && <span className="ml-1 text-[10px] text-slate-500">sam</span>}
                            </button>
                          )})}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-6 flex items-center justify-between">
                  <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700">Retour</button>
                  <button onClick={() => setStep(4)} disabled={!selectedStart} className="px-5 py-2.5 rounded-xl text-white font-bold disabled:opacity-50" style={{ backgroundColor: BRAND_DEEP }}>Continuer</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><Users className="w-5 h-5" />Vos coordonnees</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <input required value={form.nomClient} onChange={e => setForm(prev => ({ ...prev, nomClient: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Nom *" />
                  <input required value={form.prenomClient} onChange={e => setForm(prev => ({ ...prev, prenomClient: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Prénom *" />
                  <input value={form.telClient} onChange={e => setForm(prev => ({ ...prev, telClient: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Telephone" />
                  <input required type="email" value={form.emailClient} onChange={e => setForm(prev => ({ ...prev, emailClient: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm" placeholder="Email (création du compte) *" />
                  <div className="w-full">
                    <label className="text-xs text-slate-600">Nombre de personnes</label>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, nbPersonnes: Math.max(1, (prev.nbPersonnes || 1) - 1) }))}
                        disabled={form.nbPersonnes <= 1}
                        className="h-10 w-10 rounded-xl border border-slate-300 bg-slate-100 disabled:opacity-40"
                      >
                        -
                      </button>
                      <input
                        required
                        type="number"
                        min={1}
                        max={maxPersonnesSelectable}
                        value={form.nbPersonnes}
                        onChange={e => {
                          const next = parseInt(e.target.value || "1", 10);
                          const safe = Number.isFinite(next) ? Math.max(1, Math.min(maxPersonnesSelectable, next)) : 1;
                          setForm(prev => ({ ...prev, nbPersonnes: safe }));
                        }}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-center"
                        placeholder="Nombre de personnes"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            nbPersonnes: Math.min(maxPersonnesSelectable, (prev.nbPersonnes || 1) + 1),
                          }))
                        }
                        disabled={form.nbPersonnes >= maxPersonnesSelectable}
                        className="h-10 w-10 rounded-xl border border-slate-300 bg-slate-100 disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Maximum autorisé sur cette période: {maxPersonnesSelectable} personne{maxPersonnesSelectable > 1 ? "s" : ""}.
                    </p>
                  </div>
                </div>
                <textarea rows={3} value={form.message} onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm resize-none" placeholder="Message (optionnel)" />
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.acceptCgv}
                    onChange={(e) => setForm((prev) => ({ ...prev, acceptCgv: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    J'accepte les CGV et conditions de réservation.
                    {" "}
                    <a href="/docs/contrat-charter-v2.pdf" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: BRAND_DEEP }}>
                      Lire les CGV
                    </a>
                  </span>
                </label>
                {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{error}</div>}
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => setStep(3)} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700">Retour</button>
                  <button type="submit" disabled={loading || !canSubmit} className="px-6 py-2.5 rounded-xl text-white font-bold disabled:opacity-50 flex items-center gap-2" style={{ backgroundColor: BRAND_DEEP }}>
                    {loading ? "Envoi..." : "S'inscrire et envoyer ma demande"} <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-slate-500 text-xs"><Shield className="w-3.5 h-3.5" /><span>Vos donnees sont securisees. Reponse sous 24h.</span></div>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 h-fit lg:sticky lg:top-6">
            <h2 className="text-xl font-bold mb-4">Votre reservation</h2>
            <div className="space-y-3 text-sm">
              <div><p className="text-slate-500 text-xs uppercase">Produit</p><p className="font-bold">{formule.label}</p></div>
              <div><p className="text-slate-500 text-xs uppercase">Type</p><p className="font-bold">{typeReservation === "bateau_entier" ? "Privatif" : "Par personne"}</p></div>
              <div><p className="text-slate-500 text-xs uppercase">Periode</p><p className="font-bold">{selectedStart || "—"} {selectedEnd ? `-> ${selectedEnd}` : ""}</p></div>
              <div><p className="text-slate-500 text-xs uppercase">Disponibilité</p><p className="font-bold">{pricingDispo ? (disponibiliteFreeUnits > 0 || typeReservation === "bateau_entier" ? "Disponible" : "Complet") : "À confirmer"}</p></div>
              <div><p className="text-slate-500 text-xs uppercase">Destination</p><p className="font-bold">{destination}</p></div>
              {typeReservation !== "bateau_entier" && (
                <div><p className="text-slate-500 text-xs uppercase">Cabines restantes</p><p className="font-bold">{disponibiliteFreeUnits}</p></div>
              )}
              {selectedRule && <div><p className="text-slate-500 text-xs uppercase">Regle planning</p><p className="font-bold text-xs">{selectedRule.name}</p></div>}
              <div className="flex items-center gap-2"><Users className="w-4 h-4 text-slate-500" /><span>{form.nbPersonnes} personne{form.nbPersonnes > 1 ? "s" : ""}</span></div>
            </div>
            <div className="my-6 h-px bg-slate-200" />
            <div className="flex justify-between text-xl font-bold">
              <span>Estimation</span>
              <span style={{ color: BRAND_DEEP }}>{(montantTotal / 100).toLocaleString("fr-FR")} EUR</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {isTransatSelection
                ? `3000€/personne · traversée complète · ${safePersons} place(s)`
                : isAprilMaySelection
                ? `${effectivePrivatePriceEur}€/journée · privatif unique · départ La Ciotat`
                : isJournee
                ? `${effectivePrivatePriceEur}€/journée tout inclus · bateau entier`
                : typeReservation === "bateau_entier"
                ? `${effectivePrivatePriceEur}€/semaine bateau entier`
                : typeReservation === "cabine"
                  ? `${weeklyCabineEur}€/semaine cabine double × ${requiredCabins} cabine(s)`
                  : `${selectedWeeklyPrice}€/semaine`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
