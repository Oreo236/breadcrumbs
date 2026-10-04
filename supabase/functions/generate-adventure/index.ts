import { createClient } from "npm:@supabase/supabase-js@2";
import { interpretPrompt, planAdventure } from "./lib/anthropic.ts";
import { searchCandidates } from "./lib/places.ts";
import { getWalkingDurationsMinutes, getWalkingPolyline } from "./lib/routes.ts";
import { generateJoinCode } from "./lib/joinCode.ts";
import { distanceKm } from "./lib/geo.ts";
import type { GenerateAdventureInput, Plan } from "./lib/types.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_GENERATIONS_PER_HOUR = 10;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const FOOD_CATEGORY_WORDS = ["food", "restaurant", "cafe", "café", "dining", "cuisine", "eat", "dessert", "drink", "bar"];

function isFoodCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return FOOD_CATEGORY_WORDS.some((word) => lower.includes(word));
}

function isValidInput(body: unknown): body is GenerateAdventureInput {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.prompt !== "string" || b.prompt.trim().length === 0) return false;
  if (!b.start || typeof b.start !== "object") return false;
  const start = b.start as Record<string, unknown>;
  return typeof start.lat === "number" && typeof start.lng === "number";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }

  let input: GenerateAdventureInput;
  try {
    const body = await req.json();
    if (!isValidInput(body)) {
      return jsonResponse({ error: "prompt and start {lat, lng} are required" }, 400);
    }
    input = body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // Rate limit: max N generations per user per hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("adventures")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id)
    .gte("created_at", oneHourAgo);

  if (countError) {
    console.error("Rate limit check failed", countError);
  } else if ((count ?? 0) >= MAX_GENERATIONS_PER_HOUR) {
    return jsonResponse(
      { error: "You've hit the hourly limit for new adventures. Try again in a bit." },
      429
    );
  }

  try {
    const interpretation = await interpretPrompt({
      prompt: input.prompt,
      time_minutes: input.time_minutes,
      budget: input.budget,
      interests: input.interests,
    });

    const center = input.destination
      ? {
          lat: (input.start.lat + input.destination.lat) / 2,
          lng: (input.start.lng + input.destination.lng) / 2,
        }
      : input.start;

    // locationBias is a soft ranking hint, not a hard radius restriction - for an unusual or rare
    // query (e.g. "public art installation") Google can return its single best global match
    // instead of nothing, which looks like a real candidate but can be thousands of km away.
    // Always run a broad, almost-always-locally-populated search alongside the LLM's categorized
    // queries (rather than only when the categorized search comes back completely empty) so a
    // single bad/rare query can't crowd out genuinely close common places.
    const [categorized, broad] = await Promise.all([
      searchCandidates(interpretation.queries, center, interpretation.radius_km),
      searchCandidates(
        [
          { category: "general", query: "point of interest", max_results: 5 },
          { category: "general", query: "park", max_results: 3 },
          { category: "general", query: "cafe", max_results: 3 },
        ],
        center,
        interpretation.radius_km * 3
      ),
    ]);
    const candidatesById = new Map(categorized.map((c) => [c.place_id, c]));
    for (const c of broad) {
      if (!candidatesById.has(c.place_id)) candidatesById.set(c.place_id, c);
    }
    const candidates = Array.from(candidatesById.values());

    if (candidates.length === 0) {
      return jsonResponse(
        { error: "Couldn't find anything nearby. Try loosening your constraints." },
        422
      );
    }

    const withDistance = candidates
      .map((c) => ({ candidate: c, distance: distanceKm(center, { lat: c.lat, lng: c.lng }) }))
      .sort((a, b) => a.distance - b.distance);

    const maxDistanceKm = interpretation.radius_km * 1.5;
    const withinRadius = withDistance.filter((c) => c.distance <= maxDistanceKm).map((c) => c.candidate);

    const CLOSEST_FALLBACK_COUNT = 5;
    const distanceFilteredCandidates =
      withinRadius.length > 0 ? withinRadius : withDistance.slice(0, CLOSEST_FALLBACK_COUNT).map((c) => c.candidate);

    // Real walking time, not straight-line distance - a candidate can be close as the crow flies
    // but much farther on foot (detours, no direct path, a river in between, etc).
    const walkMinutes = await getWalkingDurationsMinutes(
      input.start,
      distanceFilteredCandidates.map((c) => ({ lat: c.lat, lng: c.lng }))
    );
    const candidatesWithWalkTime = distanceFilteredCandidates.map((c, i) => ({
      ...c,
      walk_minutes_from_start: walkMinutes[i],
    }));

    // Budget: reserve time per planned stop for the actual visit/photo, the rest is travel budget.
    // Without an explicit end point, getting back to the start counts against that budget too.
    // Short MicroQuests get a smaller per-stop reservation - "10 minutes" implies a quick glance
    // and a photo, not an 8-minute stay that eats the whole budget before any walking happens.
    const ACTIVITY_MINUTES_PER_STOP = interpretation.time_minutes <= 20 ? 3 : 8;
    const travelBudgetMinutes = Math.max(
      interpretation.time_minutes - interpretation.target_stop_count * ACTIVITY_MINUTES_PER_STOP,
      2
    );
    // +15% tolerance - Google's walking estimate varies with routing/rounding, and a candidate
    // that misses an exact cutoff by a few seconds shouldn't be treated as infeasible.
    const maxOneWayMinutes = (input.destination ? travelBudgetMinutes : travelBudgetMinutes / 2) * 1.15;

    const withinTimeBudget = candidatesWithWalkTime.filter(
      (c) => c.walk_minutes_from_start == null || c.walk_minutes_from_start <= maxOneWayMinutes
    );

    // If nothing fits, the closest-by-walk-time fallback below is a reasonable rescue for a
    // near-miss (e.g. 15% over budget due to routing quirks) but must not be allowed to reach
    // arbitrarily far - otherwise a sparse area (e.g. no cafes/parks within an academic quad)
    // silently produces a plan that blows past the user's stated time, like sending a "10 minute
    // walk" request 48 minutes away to the nearest park Google knows about.
    const BEST_EFFORT_TOLERANCE = 2.5;
    const closestByWalkTime = [...candidatesWithWalkTime].sort(
      (a, b) => (a.walk_minutes_from_start ?? Infinity) - (b.walk_minutes_from_start ?? Infinity)
    );
    const bestEffortFeasible =
      closestByWalkTime.length > 0 &&
      (closestByWalkTime[0].walk_minutes_from_start ?? Infinity) <= maxOneWayMinutes * BEST_EFFORT_TOLERANCE;

    const filteredCandidates =
      withinTimeBudget.length > 0
        ? withinTimeBudget
        : bestEffortFeasible
          ? closestByWalkTime.slice(0, CLOSEST_FALLBACK_COUNT)
          : [];

    if (filteredCandidates.length === 0) {
      return jsonResponse(
        {
          error:
            "Couldn't find anything within that time budget nearby. Try a longer time limit or a different starting point.",
        },
        422
      );
    }

    const candidateIds = new Set(filteredCandidates.map((c) => c.place_id));
    const categoryByPlaceId = new Map(filteredCandidates.map((c) => [c.place_id, c.category]));
    const FOOD_STOP_CAP = 2;

    function validatePlan(candidatePlan: Plan): string | null {
      const invalidIds = candidatePlan.stops.filter((s) => !candidateIds.has(s.place_id));
      if (invalidIds.length > 0) {
        return `You used place_id(s) that weren't in the candidates list: ${invalidIds
          .map((s) => s.place_id)
          .join(", ")}. Only use place_id values from the candidates given to you.`;
      }
      const foodStopCount = candidatePlan.stops.filter((s) =>
        isFoodCategory(categoryByPlaceId.get(s.place_id) ?? "")
      ).length;
      if (foodStopCount > FOOD_STOP_CAP) {
        return `Your plan had ${foodStopCount} food/drink stops, which is too many (max ${FOOD_STOP_CAP}). Keep at most ${FOOD_STOP_CAP} and vary the other stops across different categories.`;
      }
      return null;
    }

    let plan: Plan | null = null;
    let retryNote: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidatePlan = await planAdventure({
        prompt: input.prompt,
        interpretation,
        candidates: filteredCandidates,
        retryNote,
      });

      const issue = validatePlan(candidatePlan);
      if (!issue) {
        plan = candidatePlan;
        break;
      }
      console.warn(`Plan attempt ${attempt} invalid: ${issue}`);
      retryNote = issue;
    }

    if (!plan) {
      return jsonResponse(
        { error: "Couldn't build a valid route from the places we found. Try a different prompt." },
        422
      );
    }

    const stopsInOrder = [...plan.stops].sort((a, b) => a.order_index - b.order_index);
    const stopsWithPlaces = stopsInOrder.map((stop) => ({
      stop,
      place: filteredCandidates.find((c) => c.place_id === stop.place_id)!,
    }));

    const routeWaypoints = [
      input.start,
      ...stopsWithPlaces.map(({ place }) => ({ lat: place.lat, lng: place.lng })),
      ...(input.destination ? [input.destination] : []),
    ];
    const polyline = await getWalkingPolyline(routeWaypoints);

    // Insert the adventure, retrying the join code on the rare collision.
    let adventureId: string | null = null;
    for (let attempt = 0; attempt < 5 && !adventureId; attempt++) {
      const { data: inserted, error: insertError } = await supabase
        .from("adventures")
        .insert({
          owner_id: user.id,
          title: plan.title,
          summary: plan.summary,
          prompt: input.prompt,
          constraints: {
            time_minutes: interpretation.time_minutes,
            budget: interpretation.budget,
            interests: interpretation.interests,
          },
          start_lat: input.start.lat,
          start_lng: input.start.lng,
          route_polyline: polyline,
          status: "planned",
          join_code: generateJoinCode(),
        })
        .select("id")
        .single();

      if (!insertError) {
        adventureId = inserted.id;
      } else if (insertError.code !== "23505") {
        // Not a unique-violation on join_code - bail out.
        throw insertError;
      }
    }

    if (!adventureId) {
      throw new Error("Failed to allocate a unique join code");
    }

    const { error: memberError } = await supabase
      .from("adventure_members")
      .insert({ adventure_id: adventureId, user_id: user.id, role: "owner" });
    if (memberError) throw memberError;

    const { error: stopsError } = await supabase.from("stops").insert(
      stopsWithPlaces.map(({ stop, place }) => ({
        adventure_id: adventureId,
        order_index: stop.order_index,
        name: place.name,
        google_place_id: place.place_id,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        description: stop.description,
        est_minutes: stop.est_minutes,
        est_cost: stop.est_cost,
        challenge: stop.challenge,
      }))
    );
    if (stopsError) throw stopsError;

    return jsonResponse({ adventure_id: adventureId });
  } catch (e) {
    console.error("generate-adventure failed", e);
    return jsonResponse(
      { error: "Couldn't build that one. Try loosening your constraints." },
      500
    );
  }
});
