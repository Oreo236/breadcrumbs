type LatLng = { lat: number; lng: number };

function toWaypoint(point: LatLng) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

// Best-effort walking polyline through the ordered stops. Returns null on any
// failure so the caller can fall back to drawing straight lines between stops.
export async function getWalkingPolyline(stopsInOrder: LatLng[]): Promise<string | null> {
  if (stopsInOrder.length < 2) return null;

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return null;

  const origin = stopsInOrder[0];
  const destination = stopsInOrder[stopsInOrder.length - 1];
  const intermediates = stopsInOrder.slice(1, -1);

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        intermediates: intermediates.map(toWaypoint),
        travelMode: "WALK",
      }),
    });

    if (!res.ok) {
      console.error(`Routes API failed: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    return data.routes?.[0]?.polyline?.encodedPolyline ?? null;
  } catch (e) {
    console.error("Routes API request threw", e);
    return null;
  }
}

type RouteMatrixElement = {
  destinationIndex: number;
  duration?: string; // e.g. "742s"
  condition?: string; // "ROUTE_EXISTS" | "ROUTE_NOT_FOUND"
};

// Real one-way walking minutes from a single origin to each destination, in the same order as
// `destinations`. Returns null for any destination Google couldn't route to, and returns an
// all-null array (rather than throwing) if the whole request fails - callers should treat that
// as "skip the travel-time filter" rather than a hard error.
export async function getWalkingDurationsMinutes(
  origin: LatLng,
  destinations: LatLng[]
): Promise<(number | null)[]> {
  if (destinations.length === 0) return [];

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return destinations.map(() => null);

  try {
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: toWaypoint(origin) }],
        destinations: destinations.map((d) => ({ waypoint: toWaypoint(d) })),
        travelMode: "WALK",
      }),
    });

    if (!res.ok) {
      console.error(`Route matrix failed: ${res.status} ${await res.text()}`);
      return destinations.map(() => null);
    }

    const elements: RouteMatrixElement[] = await res.json();
    const minutesByIndex = new Array<number | null>(destinations.length).fill(null);
    for (const el of elements) {
      if (el.condition !== "ROUTE_EXISTS" || !el.duration) continue;
      const seconds = parseInt(el.duration.replace("s", ""), 10);
      if (!Number.isNaN(seconds)) {
        minutesByIndex[el.destinationIndex] = seconds / 60;
      }
    }
    return minutesByIndex;
  } catch (e) {
    console.error("Route matrix request threw", e);
    return destinations.map(() => null);
  }
}
