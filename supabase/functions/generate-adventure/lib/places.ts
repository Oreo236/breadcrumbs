import type { CategoryQuery, PlaceCandidate } from "./types.ts";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.formattedAddress",
  "places.rating",
  "places.priceLevel",
  "places.types",
  "places.currentOpeningHours.openNow",
  "places.businessStatus",
].join(",");

const PRICE_LEVEL_MAP: Record<string, number | null> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
  PRICE_LEVEL_UNSPECIFIED: null,
};

type TextSearchResponse = {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
    formattedAddress?: string;
    rating?: number;
    priceLevel?: string;
    types?: string[];
    currentOpeningHours?: { openNow?: boolean };
    businessStatus?: string;
  }>;
};

async function searchOneQuery(
  category: string,
  query: string,
  maxResults: number,
  center: { lat: number; lng: number },
  radiusMeters: number,
  apiKey: string
): Promise<PlaceCandidate[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: Math.max(maxResults * 3, 10), // overfetch, then cap per-category below
      // RELEVANCE (the default) can rank a popular/well-known place ahead of something genuinely
      // around the corner - for a walking MicroQuest we want the literal closest match, not the
      // most famous one, so DISTANCE ranking is required for locationBias to behave as intended.
      rankPreference: "DISTANCE",
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters,
        },
      },
    }),
  });

  if (!res.ok) {
    console.error(`Places search failed for "${query}": ${res.status} ${await res.text()}`);
    return [];
  }

  const data: TextSearchResponse = await res.json();

  // DISTANCE ranking sorts matches by proximity, not quality of match - with max_results as low
  // as 1 (common for a single-category query) that can keep a loosely-matching but slightly
  // closer place (e.g. a waterfall tagged "nature") while discarding the actual best-named match
  // for the query (e.g. a real botanical garden a few hundred meters further). Always keep at
  // least a few raw results per category so the planning LLM - which is much better at judging
  // which result actually fits the query - has real options to choose from, not just whichever
  // happened to be nearest.
  const keepCount = Math.max(maxResults, 3);

  return (data.places ?? [])
    .filter((p) => p.businessStatus === undefined || p.businessStatus === "OPERATIONAL")
    .filter((p) => p.currentOpeningHours?.openNow !== false)
    .filter((p) => p.location && p.displayName)
    .slice(0, keepCount)
    .map((p) => ({
      place_id: p.id,
      name: p.displayName!.text,
      category,
      lat: p.location!.latitude,
      lng: p.location!.longitude,
      address: p.formattedAddress ?? null,
      rating: p.rating ?? null,
      price_level: p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null,
      types: p.types ?? [],
    }));
}

export async function searchCandidates(
  queries: CategoryQuery[],
  center: { lat: number; lng: number },
  radiusKm: number
): Promise<PlaceCandidate[]> {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const radiusMeters = Math.round(radiusKm * 1000);
  const results = await Promise.all(
    queries.map((q) => searchOneQuery(q.category, q.query, q.max_results, center, radiusMeters, apiKey))
  );

  const seen = new Map<string, PlaceCandidate>();
  for (const candidate of results.flat()) {
    if (!seen.has(candidate.place_id)) {
      seen.set(candidate.place_id, candidate);
    }
  }

  return Array.from(seen.values()).slice(0, 30);
}
