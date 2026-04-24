import { Router } from "express";
import type { PlaceDetailsResult, PlacesSearchResult } from "../_core/map";

const router = Router();

const DEFAULT_BUSINESS_QUERY = "Sabine Sailing La Ciotat";
const DEFAULT_PLACE_URL =
  "https://www.google.com/maps/search/?api=1&query=Sabine+Sailing+La+Ciotat";
const FALLBACK_REVIEWS = [
  {
    authorName: "Thierry Leydet",
    rating: 5,
    text: "Un capitaine a la hauteur, un hote attentif, un confort a bord comme a la maison. Des balades a la voile magiques.",
    time: 0,
  },
  {
    authorName: "Florence Ile le",
    rating: 5,
    text: "Une semaine de reve sur le Sabine en Corse et Sardaigne. Victor est un vrai pro experimente et tres sympa.",
    time: 0,
  },
  {
    authorName: "Benjamin Aburbe",
    rating: 5,
    text: "Superbe visite de criques magnifiques en Corse avec Sabine Sailing. Une tres belle ambiance et des souvenirs incroyables.",
    time: 0,
  },
  {
    authorName: "Corentin Marteau",
    rating: 5,
    text: "Deux semaines incroyables entre Girolata et La Maddalena. Une experience inoubliable, je recommande a 100%.",
    time: 0,
  },
];

router.get("/", async (_req, res) => {
  try {
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
    if (!apiKey) {
      return res.json({
        placeId: process.env.GOOGLE_PLACE_ID || "",
        name: "Sabine Sailing",
        rating: 5,
        userRatingsTotal: FALLBACK_REVIEWS.length,
        url: DEFAULT_PLACE_URL,
        reviews: FALLBACK_REVIEWS,
        source: "fallback_manual",
        note: "GOOGLE_MAPS_API_KEY manquante",
      });
    }

    const callGooglePlaces = async <T>(
      endpoint: "textsearch" | "details",
      params: Record<string, string>
    ): Promise<T> => {
      const url = new URL(`https://maps.googleapis.com/maps/api/place/${endpoint}/json`);
      url.searchParams.set("key", apiKey);
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Google Places API request failed (${response.status})`);
      }
      return (await response.json()) as T;
    };

    const resolvePlaceIdFromSearch = async (): Promise<string> => {
      const search = await callGooglePlaces<PlacesSearchResult>("textsearch", {
        query: DEFAULT_BUSINESS_QUERY,
        language: "fr",
      });
      if (search.status !== "OK" || !search.results?.length) {
        return "";
      }
      return search.results?.[0]?.place_id || "";
    };

    let placeId = (process.env.GOOGLE_PLACE_ID || "").trim();
    if (!placeId) {
      placeId = await resolvePlaceIdFromSearch();
      if (!placeId) {
        return res.status(404).json({
          error:
            "Aucune fiche Google Business trouvee pour Sabine Sailing. Verifiez la fiche ou renseignez GOOGLE_PLACE_ID.",
        });
      }
    }

    if (!placeId) {
      return res.status(400).json({
        error: "GOOGLE_PLACE_ID manquant. Impossible de charger les vrais avis Google.",
      });
    }

    let details = await callGooglePlaces<PlaceDetailsResult>("details", {
      place_id: placeId,
      fields: "place_id,name,rating,user_ratings_total,reviews,url",
      language: "fr",
    });

    // If configured PLACE_ID is stale/wrong, recover automatically from text search.
    if (details.status !== "OK" || !details.result) {
      const searchedPlaceId = await resolvePlaceIdFromSearch();
      if (searchedPlaceId && searchedPlaceId !== placeId) {
        placeId = searchedPlaceId;
        details = await callGooglePlaces<PlaceDetailsResult>("details", {
          place_id: placeId,
          fields: "place_id,name,rating,user_ratings_total,reviews,url",
          language: "fr",
        });
      }
    }

    if (details.status !== "OK" || !details.result) {
      return res.json({
        placeId: process.env.GOOGLE_PLACE_ID || "",
        name: "Sabine Sailing",
        rating: 5,
        userRatingsTotal: FALLBACK_REVIEWS.length,
        url: DEFAULT_PLACE_URL,
        reviews: FALLBACK_REVIEWS,
        source: "fallback_manual",
        note: "Google Place Details indisponible",
      });
    }

    const place = details.result;
    const placeUrl = (place as { url?: string }).url;
    const reviews = (place.reviews || []).map(review => ({
      authorName: review.author_name,
      rating: review.rating,
      text: review.text,
      time: review.time,
    }));

    return res.json({
      placeId: place.place_id,
      name: place.name,
      rating: place.rating || 0,
      userRatingsTotal: place.user_ratings_total || 0,
      url:
        placeUrl ||
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || DEFAULT_BUSINESS_QUERY)}`,
      reviews,
      source: "google",
    });
  } catch (error: any) {
    const message = error?.message || "Failed to fetch Google reviews";
    return res.json({
      placeId: process.env.GOOGLE_PLACE_ID || "",
      name: "Sabine Sailing",
      rating: 5,
      userRatingsTotal: FALLBACK_REVIEWS.length,
      url: DEFAULT_PLACE_URL,
      reviews: FALLBACK_REVIEWS,
      source: "fallback_manual",
      note: message,
    });
  }
});

export default router;
