type LatLng = { lat: number; lng: number };

function toWaypoint(point: LatLng) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

// Best-effort walking polyline + total real walking time through the ordered stops (the full
// multi-leg trip, not just distance from the start to each stop independently - two stops can
// each be individually close to the start while being far from each other). Returns nulls on any
// failure so the caller can fall back to drawing straight lines / skip the total-time check.
export async function getWalkingRoute(
  stopsInOrder: LatLng[]
): Promise<{ polyline: string | null; totalMinutes: number | null }> {
  if (stopsInOrder.length < 2) return { polyline: null, totalMinutes: 0 };

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return { polyline: null, totalMinutes: null };

  const origin = stopsInOrder[0];
  const destination = stopsInOrder[stopsInOrder.length - 1];
  const intermediates = stopsInOrder.slice(1, -1);

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline,routes.duration",
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
      return { polyline: null, totalMinutes: null };
    }

    const data = await res.json();
    const route = data.routes?.[0];
    const polyline: string | null = route?.polyline?.encodedPolyline ?? null;
    const durationStr: string | undefined = route?.duration;
    const totalMinutes = durationStr ? parseInt(durationStr.replace("s", ""), 10) / 60 : null;
    return { polyline, totalMinutes: totalMinutes != null && !Number.isNaN(totalMinutes) ? totalMinutes : null };
  } catch (e) {
    console.error("Routes API request threw", e);
    return { polyline: null, totalMinutes: null };
  }
}

type RouteMatrixElement = {
  originIndex?: number;
  destinationIndex: number;
  duration?: string; // e.g. "742s"
  condition?: string; // "ROUTE_EXISTS" | "ROUTE_NOT_FOUND"
};

// Real pairwise walking minutes between every point and every other point (an NxN matrix,
// points[i] -> points[j], with the diagonal 0). Straight-line distance is a bad proxy for which
// candidates are mutually walkable - terrain (gorges, one-way bridges, no direct path) can make
// two points that look close on a map take far longer to walk between than their straight-line
// distance suggests. Returns an all-null matrix on failure so callers can skip clustering.
export async function getWalkingTimeMatrixMinutes(points: LatLng[]): Promise<(number | null)[][]> {
  const n = points.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => new Array<number | null>(n).fill(null));
  if (n === 0) return matrix;
  for (let i = 0; i < n; i++) matrix[i][i] = 0;
  if (n < 2) return matrix;

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return matrix;

  try {
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition",
      },
      body: JSON.stringify({
        origins: points.map((p) => ({ waypoint: toWaypoint(p) })),
        destinations: points.map((p) => ({ waypoint: toWaypoint(p) })),
        travelMode: "WALK",
      }),
    });

    if (!res.ok) {
      console.error(`Route matrix (NxN) failed: ${res.status} ${await res.text()}`);
      return matrix;
    }

    const elements: RouteMatrixElement[] = await res.json();
    for (const el of elements) {
      if (el.condition !== "ROUTE_EXISTS" || !el.duration || el.originIndex == null) continue;
      const seconds = parseInt(el.duration.replace("s", ""), 10);
      if (!Number.isNaN(seconds)) {
        matrix[el.originIndex][el.destinationIndex] = seconds / 60;
      }
    }
    return matrix;
  } catch (e) {
    console.error("Route matrix (NxN) request threw", e);
    return matrix;
  }
}

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
