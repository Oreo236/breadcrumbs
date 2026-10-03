# Breadcrumbs — Build Brief

> This is the single source of truth for what we're building and how.

---

## 1. Context

- **Builder:** Solo developer, building with Claude as a pair programmer.
- **Deadline:** **Due Sunday, October 4, 2026 at 8:00 AM (Eastern).** That is a hard deadline. Nothing after 8:00 AM counts, so plan backwards from it (see the Deadline Plan in Section 9).
- **Judging:** Judges will try the app themselves on their own phones, anywhere. Everything in the core loop must work live with real data. No fake screens, no hardcoded locations, no canned AI responses.

## 2. The Product

**Breadcrumbs is a social navigation app that creates personalized adventures based on your time, budget, destination, and interests, then turns the places you visit and photos you take with friends into a shared map of your memories.**

Tagline: *Every adventure leaves a trail.*

### Core loop

**Discover → Navigate → Capture → Remember**

1. **Discover:** User describes constraints ("3 hours, $20, bookstores and food"). The app generates an adventure: an ordered route of real places ("Breadcrumbs").
2. **Navigate:** User sees the route on a map and follows it stop by stop.
3. **Capture:** At some stops, the group gets a photo challenge. Completing it "drops" the Breadcrumb. Any member can add photos to any Breadcrumb.
4. **Remember:** The finished adventure becomes a shared album, viewable stop by stop, and appears as a pin on each member's personal memory map.

### Terminology

- **Adventure:** One trip/route.
- **Stop:** A place on the route.
- **Breadcrumb:** A stop that has been "dropped" (challenge completed or photos added). It acts as a photo container.
- **Memory map:** A user's profile, which is a map of all adventures they've been part of.

## 3. Scope

### In scope (MVP, must work live for judges)

- [ ] Anonymous sign-in with a display name (no email required, so judges get in instantly)
- [ ] Adventure generation from a free-text prompt plus optional structured inputs
- [ ] Route map with trail line and numbered stops
- [ ] Stop detail with description, challenge, and "Directions" button (opens Apple/Google Maps)
- [ ] Take or pick a photo to drop a Breadcrumb
- [ ] Multiple members per adventure via join code / QR code
- [ ] Any member can add photos to any stop
- [ ] Mark adventure complete, which turns it into an album
- [ ] Album view: step through stops chronologically with photos, photo count, and contributor count
- [ ] Memory map: all of a user's adventures as pins; tap to open album

### Out of scope (do not build unless MVP is done and polished)

- Inviting people after a trip with camera-roll EXIF matching
- Realtime live sync (use pull-to-refresh / refetch on focus)
- Turn-by-turn navigation (deep-link to native maps instead)
- Public discovery, ratings, achievements, annual recaps
- Push notifications

## 4. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | Everywhere |
| App | Expo (React Native) + Expo Router | Must run in **Expo Go**. No custom native modules |
| Maps | `react-native-maps` | Use the **default provider** (Apple Maps on iOS, Google on Android) so it works in Expo Go |
| Location | `expo-location` | |
| Camera/photos | `expo-image-picker` | `launchCameraAsync` + `launchImageLibraryAsync` |
| QR | `react-native-qrcode-svg` (display), `expo-camera` (scan) | |
| Backend | Supabase | Auth (anonymous), Postgres, Storage, Edge Functions |
| Places | Google Places API (New): Text Search | Called only from Edge Functions |
| Routing | Google Routes API (walking polyline) | Optional. Fallback: straight lines between stops |
| AI | Anthropic API | Called only from Edge Functions. Model set via env var |

### Secrets

- **App (`.env`, public):** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **Edge Functions (Supabase secrets, private):** `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- **Never** put Google or Anthropic keys in the app.

## 5. Data Model (Postgres)

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at timestamptz default now()
);

create type adventure_status as enum ('planned', 'active', 'completed');

create table adventures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  title text not null,
  summary text,
  prompt text not null,
  constraints jsonb not null default '{}',   -- time_minutes, budget, interests, destination
  start_lat double precision not null,
  start_lng double precision not null,
  route_polyline text,                        -- encoded polyline, nullable
  status adventure_status not null default 'planned',
  join_code text unique not null,             -- 6 chars, uppercase, no ambiguous chars
  created_at timestamptz default now(),
  completed_at timestamptz
);

create table adventure_members (
  adventure_id uuid references adventures(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'member',        -- 'owner' | 'member'
  joined_at timestamptz default now(),
  primary key (adventure_id, user_id)
);

create table stops (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures(id) on delete cascade,
  order_index int not null,
  name text not null,
  google_place_id text,
  lat double precision not null,
  lng double precision not null,
  address text,
  description text,
  est_minutes int,
  est_cost numeric,
  challenge text,                              -- null = no challenge at this stop
  dropped_at timestamptz,
  dropped_by uuid references profiles(id)
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures(id) on delete cascade,
  stop_id uuid not null references stops(id) on delete cascade,
  user_id uuid not null references profiles(id),
  storage_path text not null,
  created_at timestamptz default now()
);
```

### Security (RLS)

- Enable RLS on all tables.
- A user can read an adventure, its stops, members, and photos **only if they are a member**.
- Members can insert photos where `user_id = auth.uid()`.
- Members can update `stops.dropped_at/dropped_by`.
- Only the owner can update the adventure (status, title).
- Joining happens through an RPC `join_adventure(code text)` declared `security definer` that looks up the code and inserts membership.
- Storage bucket `photos` (private). Path format: `{adventure_id}/{stop_id}/{uuid}.jpg`. Policy: members of `adventure_id` can read and upload. Use signed URLs for display.

## 6. Adventure Generation (Edge Function: `generate-adventure`)

This is the riskiest and most important feature. Build it first.

### Input

```ts
{
  prompt: string;                           // free text, e.g. "3 hours, $20, bookstores and food, surprise me"
  start: { lat: number; lng: number };
  destination?: { lat: number; lng: number } | null;
  time_minutes?: number;                    // optional; AI can infer from prompt
  budget?: number;
  interests?: string[];
}
```

### Pipeline

1. **Interpret (LLM call 1):** Turn the prompt into structured constraints plus 3–5 Google Places text-search queries (e.g., "independent bookstore", "scenic viewpoint", "cheap dumplings"). Return strict JSON.
2. **Search (Places API):** Run each query with a location bias around `start` (or along the start→destination corridor). Radius is scaled by time available (e.g., walking: ~1.5 km for 1 hr, up to ~4 km for 3+ hrs). Collect up to ~30 unique candidates with `place_id`, name, coords, rating, price level, types, and open-now status.
3. **Filter in code:** Drop closed places, duplicates, and anything too far to fit the time budget.
4. **Plan (LLM call 2):** Give the LLM **only** the filtered candidates. It picks 3–6 stops, orders them into a sensible walking route, writes a title, a summary, a one-line description per stop, estimated minutes and cost, and a photo challenge for about half the stops. Return strict JSON.
5. **Validate in code:** Every chosen `place_id` must exist in the candidate list (reject hallucinations). Total time and cost must roughly fit the constraints. If validation fails, retry once with the error message, then return a clear error.
6. **Route (optional):** Call the Routes API for a walking polyline through the stops. On failure, store null and the app draws straight lines.
7. **Save:** Insert the adventure (with generated `join_code`), the owner membership, and stops. Return the adventure ID.

### Prompt rules for the LLM

- Output JSON only, matching the schema. No markdown fences (strip them anyway before parsing).
- Never invent places. Only use the provided candidates.
- Challenges are short, playful, and doable by anyone: "Capture something in motion," "Get everyone in one photo," "Find the oldest-looking thing here."
- Respect the budget. Prefer variety across stop types.

### Guardrails

- **Rate limit:** Max ~10 generations per user per hour (count rows in `adventures`).
- **Timeout:** Show progress in the app. The function should finish in under ~25 seconds.
- **Cost:** Set a Google Cloud budget alert. Cap Places results per query.

## 7. App Screens (Expo Router)

```
app/
  _layout.tsx               // auth gate: anonymous sign-in + name prompt on first launch
  (tabs)/
    _layout.tsx
    index.tsx               // Home: "Plan an adventure" + list of my adventures
    map.tsx                 // Memory map: all my adventures as pins
    join.tsx                // Enter code or scan QR
  new.tsx                   // Prompt input + optional chips (time, budget, interests) + "Use my location" / pick city
  adventure/[id]/
    index.tsx               // Route map, stop list, invite (show code + QR), "Finish adventure"
    stop/[stopId].tsx       // Stop detail: description, challenge, Directions, add photos, photo grid
    album.tsx               // Completed recap: crumb trail map, swipe through stops chronologically
```

### UI notes

- Map trail: small dots along the polyline (the "crumbs") and larger numbered markers for stops. Dropped Breadcrumbs are visually filled in, while undropped ones are outlined.
- Album card per stop: "Breadcrumb #3 — Ithaca Falls / 'Capture something in motion.' / 📸 14 photos · 👥 4 friends."
- Every async action needs a loading state and a friendly error state with retry.

## 8. Judge-Proofing (no hardcoding)

- **Works anywhere:** Use device location. If permission is denied, let the user type a city or address (geocode via Places in the Edge Function). Never assume a city.
- **Instant access:** Anonymous auth with just a name. No email verification.
- **Try collaboration live:** A judge can join my adventure (or I can join theirs) via join code/QR in seconds.
- **Graceful failure:** If the AI or Places fails, show "Couldn't build that one. Try loosening your constraints," never a crash or blank screen.
- **Empty states:** A new user's memory map shows a friendly prompt to start their first adventure, not an empty broken map.
- **Demo seeding is separate:** A `scripts/seed-demo.ts` script may create past adventures **for my account only** by running the real generation pipeline and uploading real photos. It is never bundled in the app and never affects judges' accounts.
- **Distribution:** Judges run it via Expo Go by scanning a QR code (`npx expo start --tunnel` or an EAS Update link). Test on both iOS and Android before judging.

## 9. Build Order (milestones)

### Deadline Plan (hard stop: Sunday 8:00 AM ET)

Claude must treat the time as scarce:

- **Always know the time.** Ask the current time at the start of each session and say how many hours remain.
- **Protect the demo.** A working core loop beats extra features. If we fall behind, cut from the bottom of the priority order below, never from the top.
- **Submit early.** Aim to be fully submitted by **7:00 AM**, leaving an hour of buffer for upload problems, Expo/QR issues, or a last-minute bug.
- **No big risky changes after 5:00 AM.** Only fixes and polish.
- Sleep matters. A few hours of rest is better than debugging at 4 AM. Flag it if pushing too late with diminishing returns.

**Target schedule (adjust if we slip):**

| Clock time | Goal |
|---|---|
| Sat 11:00 AM - 1:00 PM | Milestones 0-1: repo, brand direction (keep research short), Expo + Supabase + auth running |
| Sat 1:00 PM - 6:00 PM | Milestones 2-4: generation works end to end, new adventure screen, route map |
| Sat 6:00 PM - 11:00 PM | Milestones 5-7: photos, join/collab, finish + album |
| Sat 11:00 PM - 2:00 AM | Milestone 8-9: memory map, hardening, test on two phones |
| Sun 2:00 AM - 5:00 AM | Rest (at least ~3 hours) or buffer if behind |
| Sun 5:00 AM - 7:00 AM | Milestone 10: polish, mascot/icon, seed demo account, backup demo video, tag `demo-ready` |
| Sun 7:00 AM | **Submit.** Confirm links and the QR code work |
| Sun 8:00 AM | **Deadline** |

**If time is short, cut in this order (last item first):**
1. Keep: generate adventure, route map, photos + drop Breadcrumb, album, join code
2. Cut next: memory map polish and animations
3. Cut next: route polyline (use straight lines), QR scanning (keep the typed join code)
4. Cut first: brand research depth (pick one direction quickly), Lottie/Skia extras

Check off as completed. Each milestone should end in a working, testable state.

0. [x] **Repo + brand research:** Git repo on GitHub with `.gitignore` and `.env.example`; visual research summary (Section 11); pick a logo direction; `theme.ts` with palette and fonts.
1. [~] **Setup:** Expo app with Router and tabs runs in Expo Go; Supabase project; tables + RLS; anonymous auth + name prompt. Code done, **blocked**: Supabase project reports anonymous sign-ins disabled despite dashboard toggle being on — needs re-check.
2. [~] **Generation:** `generate-adventure` Edge Function works via curl with real Places + AI; saves to DB. Code done, auth/validation paths smoke-tested locally via `deno run`; full pipeline (Places + Haiku + save) not yet exercised end-to-end — needs a real user JWT once anon auth works.
3. [~] **New adventure screen:** Prompt → loading → navigates to the adventure. Built, not yet tested live (blocked on M1/M2 above).
4. [~] **Route screen:** Map with trail + stops; stop list; Directions deep link. Built, not yet tested live.
5. [~] **Stop + photos:** Challenge display, camera/library upload to Storage, photo grid, drop Breadcrumb. Built, not yet tested live.
6. [ ] **Collaboration:** Join code + QR; second account can view and add photos. QR display + join-by-code built; QR *scanning* not built (typed code only, per the cut list).
7. [~] **Finish + album:** Complete adventure; album recap screen. Built, not yet tested live.
8. [~] **Memory map:** Profile map with adventure pins → album. Built, not yet tested live.
9. [ ] **Hardening:** Location fallback, error states, empty states, rate limit, test on two phones.
10. [ ] **Polish + demo:** Apply final mascot/logo, app icon/splash, favicon, animations, seed account, record a backup demo video. Tag `demo-ready`.

## 10. Git Workflow (work like a real developer)

### Setup (milestone 0)

- `git init`, add a proper `.gitignore` (`node_modules/`, `.env`, `.env.*`, `.expo/`, `dist/`, `*.log`, `supabase/.temp/`) **before the first commit**.
- Create a GitHub repo and push the initial commit right away.
- Commit a `.env.example` listing every variable name (no values) so the project can be rebuilt from scratch.
- Never commit secrets. If one leaks, rotate the key immediately; deleting the commit is not enough.

### Commit rules

- **Commit after every meaningful unit of work:** a working screen, a completed fix, a schema change, a new function. Don't batch a whole milestone into one commit.
- **Push at least once per hour**, and also after every finished milestone and every bug fix. If an hour passes without a push, say so and push work-in-progress to a branch.
- Use **Conventional Commits** with a short, specific message:
  - `feat: add adventure generation edge function`
  - `fix: handle denied location permission on new adventure screen`
  - `chore: add .env.example`
  - `style: apply brand colors to tab bar`
  - `docs: update progress log`
- Never commit code that doesn't run. If the app is broken, fix it or stash it first.
- Keep `main` always demo-able. For risky work (generation pipeline, RLS changes), use a short-lived branch such as `feat/generate-adventure`, then merge when it works.
- **Tag milestones:** `git tag m2-generation-works && git push --tags`. If something breaks late, there is a known-good point to return to.
- **Final 2 hours:** Freeze `main`. Only bug fixes. Tag `demo-ready` once it is tested on two phones.

---

## 11. Brand & Visual Identity

The app should feel warm, playful, and a little silly, like something a friend made, not a corporate travel app. The vibe is **cute, crunchy, and cozy**.

### Logo direction

- The logo is **a breadcrumb character**: a round, crumbly golden blob with a face, drawn as **simple, clean SVG** so it scales from app icon to splash screen.
- Shape: slightly irregular rounded blob (not a perfect circle), with a few small crumb flecks around or trailing behind it.
- The crumb leaves **a trail of tiny crumbs** behind it, tying to the tagline *Every adventure leaves a trail* and mirroring the map trail.
- Wordmark: lowercase **"breadcrumbs"** in a soft, rounded, friendly typeface.
- Produce: app icon (1024x1024), splash screen, in-app header mark, a small **map pin version** (the crumb face as the Breadcrumb marker), and a favicon.

### Mascot expressions (reuse across the app)

| Moment | Expression |
|---|---|
| Home / default | Content smile |
| Generating an adventure | Eyes looking around / thinking |
| Challenge unlocked | Excited, sparkle eyes |
| Breadcrumb dropped | Happy, cheeks glowing |
| Error / no results | Slightly sad, with a friendly retry message |
| Empty memory map | Curious, waiting for its first trail |

### Palette

| Role | Color |
|---|---|
| Primary (golden crust) | `#E8A33D` |
| Deep toast (accents, text on light) | `#B5651D` |
| Crumb cream (backgrounds) | `#FFF4DE` |
| Blush (highlights, dropped Breadcrumbs) | `#F4A39A` |
| Ink (text) | `#2B1B12` |

Define these once as design tokens in `theme.ts` and never hardcode colors in components.

### Typography and UI feel

- Rounded, friendly display font for headings (Nunito, Baloo 2, Fredoka, or Quicksand via `expo-google-fonts`) paired with a clean readable body font.
- Rounded corners everywhere, soft shadows, generous spacing.
- Buttons are chunky and tappable. Cards feel like little stickers.
- Light motion adds charm: a gentle bounce when a Breadcrumb drops, crumbs sprinkling on success, a wiggle on the mascot. Keep animations quick and don't block the user.
- Custom map styling: warm, muted map colors so the golden route trail and crumb pins stand out.

---

## 12. Libraries (approved list)

All of these work in **Expo Go**. Install with `npx expo install <package>` so versions match the Expo SDK.

### Core (see Section 4)

`expo-router`, `react-native-maps`, `expo-location`, `expo-image-picker`, `expo-camera`, `react-native-qrcode-svg`, `@supabase/supabase-js`

### Polish and feel

| Library | Use it for | Priority |
|---|---|---|
| `react-native-reanimated` | Smooth animations (bundled with Expo) | High |
| `moti` | Simple animation syntax on top of Reanimated | High |
| `lottie-react-native` | Ready-made animations (confetti, sparkles). **Check each file's license** | High |
| `expo-haptics` | Small vibration on key moments | High |
| `react-native-svg` | Render the SVG mascot, logo, and map-pin crumb | High |
| `expo-image` | Fast, cached photo grids in albums | Medium |
| `@gorhom/bottom-sheet` | Slide-up stop details over the map | Medium |
| `expo-linear-gradient` | Warm golden gradients for cards and buttons | Medium |
| `expo-google-fonts/*` | The chosen rounded font | Medium |
| `@shopify/react-native-skia` | Custom effects | Low (only if time allows) |

### Avoid unless everything else is done

- **three.js** (`expo-gl`, `@react-three/fiber`): heavy, fiddly in Expo Go, big time sink.
- Anything that needs a **custom dev build** (native modules outside Expo Go). Judges must be able to open the app by scanning a QR code.

### Rules

- **Ask before adding any dependency outside this list.**
- Prefer fewer libraries.
- Animations must be quick, never block the user, and respect "reduce motion" settings where easy.
- After installing anything, confirm the app still runs in Expo Go, then commit (`chore: add <package>`).

---

## 13. How to Work With Me (instructions for Claude)

- Work one milestone at a time. Don't jump ahead. Keep the Sunday 8:00 AM deadline in mind and flag when behind schedule.
- Give complete files with their full paths, not fragments, unless the change is tiny.
- Include exact terminal commands for installs, migrations, deploys, and secrets.
- Prefer Expo-compatible packages (`npx expo install`) that work in Expo Go. Ask before adding any dependency outside the approved list in Section 12.
- Keep it simple. This is a hackathon: readable over clever, no premature abstraction.
- When an error is pasted, diagnose the root cause before suggesting changes.
- Flag anything that would break for judges (hardcoded values, missing error handling, keys in the client).
- Act like a developer: commit small and often, push at least hourly, and follow Section 10 without being reminded.
- Keep the brand (Section 11) consistent: use theme tokens and the mascot, never ad-hoc colors.
- At the end of each session, update the Progress Log below so the next session can pick up where we left off.

## 14. Progress Log

| Time | Milestone | Status / Notes | Last push |
|---|---|---|---|
| Sat 11:00 AM | M0 started | Repo scaffolded with Expo Router tabs template; brand direction picked | pending |
| Sat 11:20 AM | M0/M1 | Supabase schema + RLS migration, anonymous auth gate, theme tokens. Fixed a git mishap (scaffold copy briefly overwrote `.git`; recovered, no data lost). | 767fd38 |
| Sat ~12:30-1:30 PM | M1 testing blocked | Supabase project created, migration applied, keys in `.env`. Expo dev server only reachable via tunnel mode (phone's hotspot-to-laptop link is point-to-point NAT, not a real LAN) — tunnel itself flaky. Then found **Supabase reports anonymous sign-ins disabled** server-side even though the dashboard toggle was switched on — blocks live testing of the auth gate. Needs re-check next session. | 767fd38 |
| Sat ~1:30-3:00 PM | M2-M5, M7, M8 built (untested) | User stepped away ~1-2h. Built `generate-adventure` edge function (Haiku 4.5 + structured outputs, Places Text Search, optional Routes polyline, place_id hallucination guard + 1 retry, rate limit); New Adventure screen; Route screen (map/trail/stops/invite QR/finish); Stop screen (challenge, Directions, camera/library upload, drop Breadcrumb); Album screen; Memory Map with real pins. Smoke-tested the function's auth/validation branches locally via `deno run` (real Supabase project, fake/missing JWTs) — passed. Could not test the full generation pipeline or any screen live: blocked on the anonymous-auth issue above. `tsc` and `expo-doctor` clean throughout. | 3367f55 |

**Next session should start by:** (1) re-checking the Supabase anonymous-sign-ins toggle (it reported disabled via the API even after being switched on in the dashboard — may need a page refresh/save retry, or could be an org-level setting overriding it), (2) getting the phone on a real network for Expo Go testing, (3) only then testing M1-M8 live for the first time.

@AGENTS.md
