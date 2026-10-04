import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { z } from "npm:zod@4.6.5";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/zod";
import type { Interpretation, Plan, PlaceCandidate } from "./types.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5";

const CategoryQuerySchema = z.object({
  category: z.string(),
  query: z.string(),
  max_results: z.number().int().min(1).max(3),
});

const InterpretationSchema = z.object({
  time_minutes: z.number().int().min(5).max(480),
  budget: z.number().min(0).nullable(),
  interests: z.array(z.string()).min(1).max(6),
  target_stop_count: z.number().int().min(1).max(6),
  queries: z.array(CategoryQuerySchema).min(1).max(6),
  radius_km: z.number().min(0.2).max(10),
});

const PlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  stops: z
    .array(
      z.object({
        place_id: z.string(),
        order_index: z.number().int().min(0),
        description: z.string(),
        est_minutes: z.number().int().min(0),
        est_cost: z.number().min(0),
        challenge: z.string().nullable(),
      })
    )
    .min(1)
    .max(6),
});

export async function interpretPrompt(input: {
  prompt: string;
  time_minutes?: number;
  budget?: number;
  interests?: string[];
}): Promise<Interpretation> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You turn a free-text adventure request into structured constraints and a small set of " +
      "categorized Google Places text-search queries. Infer missing details reasonably (e.g. 'a " +
      "quick trip' is ~30 minutes).\n\n" +
      "target_stop_count scales with time_minutes - this is a MicroQuest system, not always a " +
      "multi-stop trip:\n" +
      "- 5-15 minutes -> 1 stop\n" +
      "- 16-45 minutes -> 2-3 stops\n" +
      "- 46-90 minutes -> 3-4 stops\n" +
      "- 90+ minutes -> 4-6 stops\n\n" +
      "queries: each entry is one category (e.g. 'food', 'nature', 'shopping', 'culture', " +
      "'landmark', 'activity', 'dessert') with ONE specific Google Places query (e.g. 'independent " +
      "bookstore', 'scenic viewpoint', 'cheap dumplings' - never generic terms like 'things to do') " +
      "and max_results. Produce AT MOST 5 queries total (never more - 5 is a hard limit), using as " +
      "many different categories as fit within that limit - aim for the full 5 whenever " +
      "target_stop_count is 4 or more, since a thin candidate pool means a real walking-time check " +
      "later may leave too few options to actually build the trip. max_results is usually 1, but use " +
      "2 on a non-food category when target_stop_count is high and candidates may be sparse. Never " +
      "produce more than one 'food' category query even if the user asks to eat, since one good " +
      "candidate is enough and the planner will add a dessert/drink/activity around it if time " +
      "allows.\n\n" +
      "radius_km should scale with time_minutes for a walking trip: as low as 0.2-0.4km for a " +
      "10-minute MicroQuest, ~1.5km for 60 minutes, up to ~4km for 180+ minutes.\n\n" +
      "Google's location bias is a soft ranking hint, not a hard radius - an unusual or rare query " +
      "(e.g. 'hidden gem mural', 'quirky local attraction') often returns its best match from far " +
      "outside a small radius because nothing common matches nearby. For short MicroQuests " +
      "(time_minutes under ~30) prefer common, concrete terms that are likely to exist within a few " +
      "hundred meters of anywhere (e.g. 'park', 'coffee shop', 'public art', 'historic building', " +
      "'garden') over flowery or rare phrasing - common terms find the CLOSE option, rare phrasing " +
      "finds the BEST option regardless of distance.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          prompt: input.prompt,
          known_time_minutes: input.time_minutes ?? null,
          known_budget: input.budget ?? null,
          known_interests: input.interests ?? null,
        }),
      },
    ],
    output_config: { format: zodOutputFormat(InterpretationSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Failed to interpret prompt");
  }
  return response.parsed_output;
}

export async function planAdventure(input: {
  prompt: string;
  interpretation: Interpretation;
  candidates: PlaceCandidate[];
  retryNote?: string;
}): Promise<Plan> {
  const maxStops = Math.min(input.interpretation.target_stop_count, input.candidates.length);

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system:
      "You design a short walking adventure from a fixed list of real places. Rules:\n" +
      "- Only use place_id values from the candidates list given to you. Never invent a place_id.\n" +
      `- Pick up to ${maxStops} stop(s) - never more than the number of candidates given, and never ` +
      "more than one stop whose category is 'food' or a close synonym (e.g. restaurant, cafe, " +
      "dessert) unless there are fewer than 2 non-food candidates available. A single great stop " +
      "with a photo challenge is a perfectly good short adventure - don't pad it with filler stops.\n" +
      "- Order stops into a sensible walking route (minimize backtracking).\n" +
      "- Write a fun, upbeat title and a 1-2 sentence summary for the whole adventure.\n" +
      "- Write a one-line description per stop in a warm, playful voice.\n" +
      "- Add a short, playful photo challenge (doable by any group, e.g. 'Capture something in motion', " +
      "'Get everyone in one photo', 'Find the oldest-looking thing here') to about half the stops " +
      "(always to the stop if there's only one); set challenge to null for the rest.\n" +
      "- est_minutes and est_cost per stop should roughly sum to the user's time_minutes and budget. " +
      "Each candidate has walk_minutes_from_start - the REAL walking time Google measured from the " +
      "user's starting point, not a guess. Use it: the total of est_minutes plus the walking time " +
      "between stops must fit inside time_minutes (remember the user has to walk back to the start " +
      "too, unless an end point was given). Already-filtered candidates are time-feasible, but " +
      "prefer the ones with lower walk_minutes_from_start when time is tight.\n" +
      "- Prefer variety across stop categories over repeating the same one.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          original_prompt: input.prompt,
          constraints: input.interpretation,
          candidates: input.candidates,
          ...(input.retryNote ? { retry_note: input.retryNote } : {}),
        }),
      },
    ],
    output_config: { format: zodOutputFormat(PlanSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Failed to plan adventure");
  }
  return response.parsed_output;
}
