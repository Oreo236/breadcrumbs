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
