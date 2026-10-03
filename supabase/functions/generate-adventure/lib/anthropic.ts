import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { z } from "npm:zod@4.6.5";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/zod";
import type { Interpretation, Plan, PlaceCandidate } from "./types.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5";

const InterpretationSchema = z.object({
  time_minutes: z.number().int().min(15).max(480),
  budget: z.number().min(0).nullable(),
  interests: z.array(z.string()).min(1).max(6),
  search_queries: z.array(z.string()).min(3).max(5),
  radius_km: z.number().min(0.5).max(10),
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
    .min(3)
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
      "You turn a free-text adventure request into structured constraints and Google Places " +
      "text-search queries. Infer missing details reasonably (e.g. 'a quick trip' is ~60 minutes). " +
      "search_queries should be specific and varied (e.g. 'independent bookstore', 'scenic viewpoint', " +
      "'cheap dumplings'), not generic terms like 'things to do'. radius_km should scale with time_minutes " +
      "for a walking trip: ~1.5km for 60 minutes, up to ~4km for 180+ minutes.",
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
}): Promise<Plan> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system:
      "You design a short walking adventure from a fixed list of real places. Rules:\n" +
      "- Only use place_id values from the candidates list given to you. Never invent a place_id.\n" +
      "- Pick 3-6 stops and order them into a sensible walking route (minimize backtracking).\n" +
      "- Write a fun, upbeat title and a 1-2 sentence summary for the whole adventure.\n" +
      "- Write a one-line description per stop in a warm, playful voice.\n" +
      "- Add a short, playful photo challenge (doable by any group, e.g. 'Capture something in motion', " +
      "'Get everyone in one photo', 'Find the oldest-looking thing here') to about half the stops; set " +
      "challenge to null for the rest.\n" +
      "- est_minutes and est_cost per stop should roughly sum to the user's time_minutes and budget.\n" +
      "- Prefer variety across stop types over repeating the same category.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          original_prompt: input.prompt,
          constraints: input.interpretation,
          candidates: input.candidates,
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
