import { useEffect, useMemo, useState } from "react";
import { Quote, Star } from "lucide-react";

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type GoogleReview = {
  authorName: string;
  rating: number;
  text: string;
  time: number;
};

type GoogleReviewsResponse = {
  placeId: string;
  name: string;
  rating: number;
  userRatingsTotal: number;
  url: string;
  reviews: GoogleReview[];
};

export default function AvisGoogle({ isEnglish = false }: { isEnglish?: boolean }) {
  const [data, setData] = useState<GoogleReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch("/api/google-reviews")
      .then(async response => {
        const body = (await response.json()) as GoogleReviewsResponse | { error: string };
        if (!response.ok) {
          throw new Error((body as { error?: string }).error || (isEnglish ? "Unable to load Google reviews" : "Impossible de charger les avis Google"));
        }
        if (mounted) {
          setData(body as GoogleReviewsResponse);
        }
      })
      .catch((err: Error) => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const totalReviews = Math.max(1, Number(data?.userRatingsTotal || 0) || (data?.reviews || []).length || 1);
    const sample = data?.reviews || [];
    const sampleComplete = sample.length > 0 && sample.length >= totalReviews;

    // Google ne renvoie qu'un extrait d'avis : on n'invente pas une répartition
    // à partir de 4 textes. Si la note globale est 5.0, on attribue le total aux 5★.
    if (!sampleComplete) {
      const rating = Number(data?.rating || 0);
      const fiveStarCount = rating >= 4.95 ? totalReviews : 0;
      return [5, 4, 3, 2, 1].map((stars) => ({
        stars,
        count: stars === 5 ? fiveStarCount : 0,
        percent: stars === 5 && fiveStarCount ? 100 : 0,
      }));
    }

    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const review of sample) {
      const key = Math.min(5, Math.max(1, Math.round(review.rating))) as 1 | 2 | 3 | 4 | 5;
      counts[key] += 1;
    }
    return [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: counts[stars as 1 | 2 | 3 | 4 | 5],
      percent: (counts[stars as 1 | 2 | 3 | 4 | 5] / totalReviews) * 100,
    }));
  }, [data]);

  const placeUrl =
    data?.url || "https://www.google.com/maps/search/?api=1&query=Sabine+Sailing+La+Ciotat";

  const displayedReviews = (data?.reviews || []).slice(0, 4);

  return (
    <section id="avis-google" className="editorial-section relative scroll-mt-24 overflow-hidden bg-[oklch(0.985_0.012_95)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, oklch(0.92 0.04 55 / 0.45), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 60%, oklch(0.94 0.03 220 / 0.35), transparent 50%)",
        }}
      />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Titre */}
        <div className="text-center mb-14 lg:mb-20">
          <span className="editorial-kicker">{isEnglish ? "Guest reviews" : "Avis clients"}</span>
          <h2 className="editorial-title editorial-title-centered mt-4 mb-4" style={{ fontFamily: "Cormorant Garamond, Times New Roman, serif" }}>
            {isEnglish ? "What our guests say" : "Ce que disent nos clients"}
          </h2>
          <p className="editorial-lead max-w-2xl">
            {isEnglish
              ? "Read verified feedback from guests who sailed aboard Sabine."
              : "Découvrez les témoignages de nos passagers et leur expérience à bord de Sabine"}
          </p>
        </div>

        {/* Note globale + Widget Google */}
        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-stretch">
          {/* Résumé des avis */}
          <div
            className="editorial-panel relative p-8 lg:p-9 border-0 shadow-[0_20px_50px_rgba(12,26,45,0.08)]"
            style={{
              background: "linear-gradient(165deg, #faf3ea 0%, #f0dcc4 48%, #e8cfa8 100%)",
            }}
          >
            <div className="absolute top-6 right-6 h-16 w-16 rounded-full bg-white/40 blur-2xl" aria-hidden />
            <div className="relative text-center">
              <div className="flex items-center justify-center gap-1.5 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className="w-6 h-6 drop-shadow-sm"
                    style={{ fill: "#B58E6E", color: "#B58E6E" }}
                  />
                ))}
              </div>
              <div
                className="text-[3.25rem] md:text-6xl font-extrabold tabular-nums leading-none text-[oklch(0.15_0.05_220)] mb-2 min-h-[3.25rem] flex items-center justify-center"
                style={{ fontFamily: "Cormorant Garamond, Times New Roman, serif" }}
              >
                {loading ? (
                  <span className="inline-flex gap-1.5 items-center justify-center py-1">
                    <span className="h-2 w-2 rounded-full bg-[#00384A]/25 animate-pulse" />
                    <span className="h-2 w-2 rounded-full bg-[#00384A]/25 animate-pulse [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-[#00384A]/25 animate-pulse [animation-delay:300ms]" />
                  </span>
                ) : data ? (
                  data.rating.toFixed(1)
                ) : (
                  "—"
                )}
              </div>
              <p className="text-[oklch(0.42_0.04_220)] text-sm mb-7 leading-snug">
                {loading
                  ? (isEnglish ? "Loading Google reviews..." : "Chargement des avis Google...")
                  : data
                    ? (isEnglish
                      ? `Based on ${data.userRatingsTotal} Google reviews`
                      : `Basé sur ${data.userRatingsTotal} avis Google`)
                    : (isEnglish ? "Google connection unavailable" : "Connexion Google indisponible")}
              </p>
              <a
                href={placeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-7 py-3.5 text-white rounded-full font-semibold text-sm shadow-[0_8px_24px_rgba(0,56,74,0.28)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,56,74,0.35)] active:translate-y-0"
                style={{ backgroundColor: "#00384A" }}
              >
                {isEnglish ? "See all Google reviews" : "Voir tous les avis Google"}
              </a>
            </div>

            {/* Stats */}
            <div className="relative mt-9 space-y-2.5 border-t border-[oklch(0.82_0.04_55)]/60 pt-7">
              {stats.map((stat) => (
                <div key={stat.stars} className="flex items-center gap-3">
                  <div className="flex items-center gap-0.5 w-[3.25rem] shrink-0 justify-start">
                    {[...Array(stat.stars)].map((_, i) => (
                      <Star key={i} className="w-3 h-3 shrink-0" style={{ fill: "#B58E6E", color: "#B58E6E" }} />
                    ))}
                  </div>
                  <div className="flex-1 h-2 bg-[oklch(0.9_0.03_220)] rounded-full overflow-hidden ring-1 ring-black/[0.04]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${stat.percent}%`, backgroundColor: "#00384A" }}
                    />
                  </div>
                  <span className="text-xs font-medium tabular-nums text-[oklch(0.42_0.04_220)] w-7 text-right shrink-0">
                    {stat.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Widget Google Reviews */}
          <div className="lg:col-span-2 flex">
            <div className="editorial-panel flex-1 overflow-hidden border-[oklch(0.88_0.02_220)] shadow-[0_20px_50px_rgba(12,26,45,0.06)]">
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-4 mb-8 pb-6 border-b border-[oklch(0.92_0.015_220)]">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="shrink-0 w-12 h-12 rounded-2xl bg-white shadow-[0_4px_14px_rgba(12,26,45,0.08)] ring-1 ring-black/[0.06] flex items-center justify-center">
                      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-semibold tracking-tight" style={{ color: "#00384A" }}>
                        Google Reviews
                      </p>
                      <p className="text-xs text-[oklch(0.48_0.03_240)] mt-0.5">
                        {data?.name ? `${data.name} · ` : ""}
                        {isEnglish ? "Verified guest feedback" : "Retours clients vérifiés"}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center rounded-full bg-[oklch(0.96_0.02_220)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[oklch(0.42_0.03_240)] ring-1 ring-black/[0.05]">
                    {isEnglish ? "Live" : "En direct"}
                  </span>
                </div>

                {/* Avis individuels */}
                <div className="grid sm:grid-cols-2 gap-4">
                  {loading &&
                    [0, 1, 2, 3].map((k) => (
                      <div
                        key={k}
                        className="rounded-2xl border border-[oklch(0.93_0.015_220)] bg-[oklch(0.99_0.008_220)] p-5 animate-pulse"
                      >
                        <div className="flex gap-3 mb-4">
                          <div className="h-11 w-11 rounded-full bg-[oklch(0.92_0.02_220)]" />
                          <div className="flex-1 space-y-2 pt-1">
                            <div className="h-3.5 w-24 rounded-md bg-[oklch(0.92_0.02_220)]" />
                            <div className="h-3 w-16 rounded-md bg-[oklch(0.94_0.015_220)]" />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="h-3 rounded bg-[oklch(0.94_0.015_220)]" />
                          <div className="h-3 rounded bg-[oklch(0.94_0.015_220)]" />
                          <div className="h-3 w-4/5 rounded bg-[oklch(0.96_0.01_220)]" />
                        </div>
                      </div>
                    ))}
                  {!loading && error && (
                    <div className="sm:col-span-2 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-6">
                      <p className="font-semibold text-slate-900 text-sm">
                        {isEnglish ? "Google reviews temporarily unavailable" : "Avis Google temporairement indisponibles"}
                      </p>
                      <p className="text-sm text-slate-600 leading-relaxed mt-2">
                        {isEnglish
                          ? "You can still read reviews on Google using the link below."
                          : "Vous pouvez consulter les avis directement sur Google via le lien ci-dessous."}
                      </p>
                    </div>
                  )}
                  {!loading && !error && displayedReviews.length === 0 && (
                    <div className="sm:col-span-2 rounded-2xl border border-[oklch(0.92_0.015_220)] bg-[oklch(0.995_0.008_220)] p-6 text-center">
                      <p className="font-semibold text-slate-900 text-sm">{isEnglish ? "No reviews to display" : "Aucun avis à afficher"}</p>
                      <p className="text-sm text-slate-600 leading-relaxed mt-2 max-w-md mx-auto">
                        {isEnglish
                          ? "Open our Google listing to read all Sabine Sailing reviews."
                          : "Ouvrez la fiche Google pour consulter tous les avis Sabine Sailing."}
                      </p>
                    </div>
                  )}
                  {!loading &&
                    displayedReviews.map((review, i) => (
                      <article
                        key={`${review.authorName}-${i}`}
                        className="group relative rounded-2xl border border-[oklch(0.91_0.018_220)] bg-gradient-to-b from-white to-[oklch(0.995_0.012_220)] p-5 shadow-[0_6px_22px_rgba(12,26,45,0.05)] transition-[box-shadow,transform,border-color] hover:border-[oklch(0.85_0.025_220)] hover:shadow-[0_14px_36px_rgba(12,26,45,0.09)] hover:-translate-y-0.5"
                      >
                        <Quote
                          className="absolute right-4 top-4 h-8 w-8 text-[#B58E6E]/15 pointer-events-none"
                          strokeWidth={1.25}
                          aria-hidden
                        />
                        <div className="flex gap-3 mb-3 pr-8">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wide text-white shadow-inner ring-2 ring-white"
                            style={{ background: "linear-gradient(145deg, #00384A, #0a5a72)" }}
                            aria-hidden
                          >
                            {authorInitials(review.authorName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-900 text-sm truncate">{review.authorName}</p>
                            <div className="flex items-center gap-1 mt-1">
                              {[...Array(Math.round(review.rating))].map((_, j) => (
                                <Star key={j} className="w-3.5 h-3.5" style={{ fill: "#B58E6E", color: "#B58E6E" }} />
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-[oklch(0.42_0.03_240)] leading-relaxed line-clamp-6">
                          {review.text || (isEnglish ? "No written comment." : "Avis Google sans commentaire texte.")}
                        </p>
                      </article>
                    ))}
                </div>

                {/* CTA */}
                <div className="mt-8 pt-6 border-t border-[oklch(0.92_0.015_220)] flex flex-wrap items-center justify-between gap-4">
                  <p className="text-xs text-[oklch(0.48_0.03_240)] max-w-sm">
                    {isEnglish
                      ? `Ratings and wording come from Google; we show a selection from ${data?.userRatingsTotal || "all"} reviews.`
                      : `Les notes et textes proviennent de Google ; nous affichons un extrait parmi ${data?.userRatingsTotal || "tous les"} avis.`}
                  </p>
                  <a
                    href={placeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:underline underline-offset-4 decoration-[#00384A]/30"
                    style={{ color: "#00384A" }}
                  >
                    {isEnglish ? "Read all reviews on Google" : "Lire tous les avis sur Google"}
                    <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Avantages */}
        <div className="mt-14 lg:mt-20 grid sm:grid-cols-3 gap-5 lg:gap-6">
          {[
            {
              icon: "✓",
              titre: isEnglish ? "Verified reviews" : "Avis vérifiés",
              desc: isEnglish
                ? "Every review comes from real guests who booked with us."
                : "Tous les avis proviennent de clients ayant réellement réservé avec nous",
            },
            {
              icon: "★",
              titre: isEnglish ? "Excellent rating" : "Note excellente",
              desc: data?.rating
                ? (isEnglish
                  ? `${data.rating.toFixed(1)} stars on average — happy sailors`
                  : `${data.rating.toFixed(1)} étoiles en moyenne : la satisfaction de nos passagers`)
                : (isEnglish
                  ? "Happy guests and authentic reviews on Google"
                  : "Des passagers satisfaits et des avis authentiques publiés sur Google"),
            },
            {
              icon: "🔗",
              titre: "Transparent",
              desc: isEnglish
                ? "Find full details on our official Google Business profile."
                : "Retrouvez tous les détails sur notre fiche Google Business",
            },
          ].map((item, i) => (
            <div
              key={i}
              className="editorial-panel rounded-2xl p-6 lg:p-7 border-[oklch(0.9_0.018_220)] bg-white/80 backdrop-blur-sm transition-shadow hover:shadow-[0_16px_40px_rgba(12,26,45,0.08)]"
            >
              <div className="text-2xl mb-3 opacity-90">{item.icon}</div>
              <h3 className="text-lg font-bold mb-2" style={{ fontFamily: "Cormorant Garamond, Times New Roman, serif", color: "#00384A" }}>
                {item.titre}
              </h3>
              <p className="text-sm text-[oklch(0.45_0.04_220)] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
