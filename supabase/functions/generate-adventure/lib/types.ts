export type GenerateAdventureInput = {
  prompt: string;
  start: { lat: number; lng: number };
  destination?: { lat: number; lng: number } | null;
  time_minutes?: number;
  budget?: number;
  interests?: string[];
};

export type CategoryQuery = {
  category: string;
  query: string;
  max_results: number;
};

export type Interpretation = {
  time_minutes: number;
  budget: number | null;
  interests: string[];
  target_stop_count: number;
  queries: CategoryQuery[];
  radius_km: number;
};

export type PlaceCandidate = {
  place_id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  address: string | null;
  rating: number | null;
  price_level: number | null;
  types: string[];
  walk_minutes_from_start?: number | null;
};

export type PlannedStop = {
  place_id: string;
  order_index: number;
  description: string;
  est_minutes: number;
  est_cost: number;
  challenge: string | null;
};

export type Plan = {
  title: string;
  summary: string;
  stops: PlannedStop[];
};
