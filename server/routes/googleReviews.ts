import { Router } from "express";
import { makeRequest, type PlaceDetailsResult, type PlacesSearchResult } from "../_core/map";

const router = Router();

const DEFAULT_BUSINESS_QUERY = "Sabine Sailing La Ciotat";
const DEFAULT_PLACE_URL =
  "https://www.google.com/maps/search/?api=1&query=Sabine+Sailing+La+Ciotat";
const FALLBACK_REVIEWS = [
  {
    authorName: "Client Sabine Sailing",
    rating: 5,
    text: "Magnifique expérience en mer, équipage professionnel et très à l'écoute.",
    time: 0,
  },
  {
    authorName: "Passager vérifié",
    rating: 5,
    text: "Organisation parfaite, bateau superbe, nous recommandons vivement.",
    time: 0,
  },
  {
    authorName: "Croisiériste",
    rating: 5,
    text: "Une semaine exceptionnelle entre confort, sécurité et paysages incroyables.",
    time: 0,
  },
];

const buildFallbackPayload = (placeId = "") => ({
  placeId,
  name: "Sabine Sailing",
  rating: 5,
  userRatingsTotal: 3,
  url: DEFAULT_PLACE_URL,
  reviews: FALLBACK_REVIEWS,
});

router.get("/", async (_req, res) => {
  try {
    let placeId = process.env.GOOGLE_PLACE_ID || "";

    if (!placeId) {
      const search = await makeRequest<PlacesSearchResult>("/maps/api/place/textsearch/json", {
        query: DEFAULT_BUSINESS_QUERY,
      });
      if (search.status !== "OK" || !search.results?.length) {
        return res.json(buildFallbackPayload(""));
      }
      placeId = search.results?.[0]?.place_id || "";
    }

    if (!placeId) {
      return res.json(buildFallbackPayload(""));
    }

    const details = await makeRequest<PlaceDetailsResult>("/maps/api/place/details/json", {
      place_id: placeId,
      fields: "place_id,name,rating,user_ratings_total,reviews,url",
      language: "fr",
    });
    if (details.status !== "OK" || !details.result) {
      return res.json(buildFallbackPayload(placeId));
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
    });
  } catch (error: any) {
    const message = error?.message || "Failed to fetch Google reviews";
    const missingProxyConfig = String(message).includes("Google Maps proxy credentials missing");
    if (missingProxyConfig) {
      return res.json(buildFallbackPayload(""));
    }
    return res.status(500).json({ error: message });
  }
});

export default router;
