import { Router } from "express";
import type { PlaceDetailsResult, PlacesSearchResult } from "../_core/map";

const router = Router();

const DEFAULT_BUSINESS_QUERY = "Sabine Sailing La Ciotat";
const DEFAULT_PLACE_URL =
  "https://www.google.com/maps/search/?api=1&query=Sabine+Sailing+La+Ciotat";

router.get("/", async (_req, res) => {
  try {
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({
        error: "GOOGLE_MAPS_API_KEY manquante. Activez la cle API pour recuperer les avis Google en direct.",
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

    let placeId = process.env.GOOGLE_PLACE_ID || "";

    if (!placeId) {
      const search = await callGooglePlaces<PlacesSearchResult>("textsearch", {
        query: DEFAULT_BUSINESS_QUERY,
        language: "fr",
      });
      if (search.status !== "OK" || !search.results?.length) {
        return res.status(404).json({
          error:
            "Aucune fiche Google Business trouvee pour Sabine Sailing. Renseignez GOOGLE_PLACE_ID avec votre vrai Place ID.",
        });
      }
      placeId = search.results?.[0]?.place_id || "";
    }

    if (!placeId) {
      return res.status(400).json({
        error: "GOOGLE_PLACE_ID manquant. Impossible de charger les vrais avis Google.",
      });
    }

    const details = await callGooglePlaces<PlaceDetailsResult>("details", {
      place_id: placeId,
      fields: "place_id,name,rating,user_ratings_total,reviews,url",
      language: "fr",
    });
    if (details.status !== "OK" || !details.result) {
      return res.status(502).json({
        error: "Google Place Details indisponible pour cette fiche. Verifiez GOOGLE_PLACE_ID.",
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
    return res.status(500).json({ error: message });
  }
});

export default router;
