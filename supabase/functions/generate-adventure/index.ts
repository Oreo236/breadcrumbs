import { createClient } from "npm:@supabase/supabase-js@2";
import { interpretPrompt, planAdventure } from "./lib/anthropic.ts";
import { searchCandidates } from "./lib/places.ts";
import { getWalkingPolyline } from "./lib/routes.ts";
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

    const center = input.destination ?? input.start;
    const candidates = await searchCandidates(
      interpretation.search_queries,
      center,
      interpretation.radius_km
    );

    // Drop anything well outside the intended radius (location bias is a soft hint, not a hard filter).
    const maxDistanceKm = interpretation.radius_km * 1.5;
    const filteredCandidates = candidates.filter(
      (c) => distanceKm(center, { lat: c.lat, lng: c.lng }) <= maxDistanceKm
    );

    if (filteredCandidates.length < 3) {
      return jsonResponse(
        { error: "Couldn't find enough places nearby. Try loosening your constraints." },
        422
      );
    }

    const candidateIds = new Set(filteredCandidates.map((c) => c.place_id));

    let plan: Plan | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const candidatePlan = await planAdventure({
        prompt: input.prompt,
        interpretation,
        candidates: filteredCandidates,
      });

      const allValid = candidatePlan.stops.every((s) => candidateIds.has(s.place_id));
      if (allValid) {
        plan = candidatePlan;
        break;
      }
      console.warn(`Plan attempt ${attempt} contained invalid place_id(s), retrying`);
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

    const polyline = await getWalkingPolyline(
      stopsWithPlaces.map(({ place }) => ({ lat: place.lat, lng: place.lng }))
    );

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
