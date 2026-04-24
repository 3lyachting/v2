import { Router } from "express";

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

    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    };

    type PlaceNewDetailsResponse = {
      id?: string;
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      googleMapsUri?: string;
      reviews?: Array<{
        authorAttribution?: { displayName?: string };
        rating?: number;
        text?: { text?: string };
        publishTime?: string;
      }>;
    };

    type PlaceNewSearchResponse = {
      places?: Array<{
        id?: string;
      }>;
    };

    const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(url, init);
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Google Places request failed (${response.status}): ${body.slice(0, 220)}`);
      }
      return JSON.parse(body) as T;
    };

    const searchPlaceIdNew = async (): Promise<string> => {
      const payload = await fetchJson<PlaceNewSearchResponse>(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            ...headers,
            "X-Goog-FieldMask": "places.id",
          },
          body: JSON.stringify({
            textQuery: DEFAULT_BUSINESS_QUERY,
            languageCode: "fr",
            maxResultCount: 1,
          }),
        }
      );
      return payload.places?.[0]?.id || "";
    };

    const getPlaceDetailsNew = async (placeId: string): Promise<PlaceNewDetailsResponse> => {
      return fetchJson<PlaceNewDetailsResponse>(`https://places.googleapis.com/v1/places/${placeId}`, {
        method: "GET",
        headers: {
          ...headers,
          "X-Goog-FieldMask":
            "id,displayName,rating,userRatingCount,googleMapsUri,reviews.authorAttribution,reviews.rating,reviews.text,reviews.publishTime",
        },
      });
    };

    const callGooglePlacesLegacy = async <T>(
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
        throw new Error(`Google Places legacy request failed (${response.status})`);
      }
      return (await response.json()) as T;
    };

    let placeId = (process.env.GOOGLE_PLACE_ID || "").trim();
    try {
      if (!placeId) {
        placeId = await searchPlaceIdNew();
      }

      if (placeId) {
        const detailsNew = await getPlaceDetailsNew(placeId);
        const reviewsNew = (detailsNew.reviews || []).map(review => {
          const publishEpoch = review.publishTime ? Math.floor(new Date(review.publishTime).getTime() / 1000) : 0;
          return {
            authorName: review.authorAttribution?.displayName || "Client Google",
            rating: review.rating || 0,
            text: review.text?.text || "",
            time: Number.isFinite(publishEpoch) ? publishEpoch : 0,
          };
        });

        if ((detailsNew.displayName?.text || "").trim()) {
          return res.json({
            placeId: detailsNew.id || placeId,
            name: detailsNew.displayName?.text || "Sabine Sailing",
            rating: detailsNew.rating || 0,
            userRatingsTotal: detailsNew.userRatingCount || 0,
            url:
              detailsNew.googleMapsUri ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                detailsNew.displayName?.text || DEFAULT_BUSINESS_QUERY
              )}`,
            reviews: reviewsNew,
            source: "google_places_new",
          });
        }
      }
    } catch {
      // If Places API (New) is not enabled yet, continue with legacy API.
    }

    // Legacy fallback for projects not yet migrated in Google Cloud.
    type LegacyTextSearchResponse = {
      status?: string;
      results?: Array<{ place_id?: string }>;
    };
    type LegacyDetailsResponse = {
      status?: string;
      result?: {
        place_id?: string;
        name?: string;
        rating?: number;
        user_ratings_total?: number;
        url?: string;
        reviews?: Array<{
          author_name?: string;
          rating?: number;
          text?: string;
          time?: number;
        }>;
      };
    };

    const resolvePlaceIdFromSearchLegacy = async (): Promise<string> => {
      const search = await callGooglePlacesLegacy<LegacyTextSearchResponse>("textsearch", {
        query: DEFAULT_BUSINESS_QUERY,
        language: "fr",
      });
      if (search.status !== "OK" || !search.results?.length) {
        return "";
      }
      return search.results?.[0]?.place_id || "";
    };

    if (!placeId) {
      placeId = await resolvePlaceIdFromSearchLegacy();
    }

    if (placeId) {
      let details = await callGooglePlacesLegacy<LegacyDetailsResponse>("details", {
        place_id: placeId,
        fields: "place_id,name,rating,user_ratings_total,reviews,url",
        language: "fr",
      });

      if (details.status !== "OK" || !details.result) {
        const searchedPlaceId = await resolvePlaceIdFromSearchLegacy();
        if (searchedPlaceId && searchedPlaceId !== placeId) {
          placeId = searchedPlaceId;
          details = await callGooglePlacesLegacy<LegacyDetailsResponse>("details", {
            place_id: placeId,
            fields: "place_id,name,rating,user_ratings_total,reviews,url",
            language: "fr",
          });
        }
      }

      if (details.status === "OK" && details.result) {
        const place = details.result;
        const reviews = (place.reviews || []).map(review => ({
          authorName: review.author_name || "Client Google",
          rating: review.rating || 0,
          text: review.text || "",
          time: review.time || 0,
        }));

        return res.json({
          placeId: place.place_id || placeId,
          name: place.name || "Sabine Sailing",
          rating: place.rating || 0,
          userRatingsTotal: place.user_ratings_total || 0,
          url:
            place.url ||
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              place.name || DEFAULT_BUSINESS_QUERY
            )}`,
          reviews,
          source: "google_places_legacy",
        });
      }
    }

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
