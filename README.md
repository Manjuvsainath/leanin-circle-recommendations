# Circle Recommendations API

An API that returns a ranked list of Lean In Circles a member should join, with a short,
member-facing explanation for each pick.

- **Design doc (1 page):** [DESIGN.md](DESIGN.md)
- **Database schema:** [db/schema.sql](db/schema.sql), summarized [below](#database-schema)
- **Seed dataset:** [data/](data/) (unchanged from the take-home; see [data/README.md](data/README.md))

## Quick start

Requires **Node.js 20.19+** (Node 22/24 LTS recommended).

```bash
npm install
npm start                 # seeds db/circles.db on first run, then serves on http://127.0.0.1:3000
```

```bash
curl http://127.0.0.1:3000/users/7/recommendations
curl "http://127.0.0.1:3000/users/23/recommendations?limit=3&debug=true"
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs scenario, all-users, unit and API tests (Vitest) |
| `npm run recommend -- 7 15 23 42` | Prints recommendations in the terminal, no server needed (`--debug` shows score breakdowns and exclusions) |
| `npm run seed` | Rebuilds `db/circles.db` from `data/*.json` (idempotent) |
| `npm run typecheck` | TypeScript type check |
| `npm run dev` | Server with reload on file changes |

Environment variables (all optional): `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`db/circles.db`),
`AS_OF` (pin "now" when seeding; defaults to the latest timestamp in the dataset, see DESIGN.md).

> `better-sqlite3` is a native module. If you installed dependencies in WSL and want to run on
> Windows (or vice versa), run `npm install` again on that side.

## API

### `GET /users/:id/recommendations`

| Query param | Default | Notes |
| --- | --- | --- |
| `limit` | 5 | 1–10 |
| `debug` | false | Adds per-pick score breakdowns, the member's interest profile, and every excluded Circle with its reason |

Responses: `200` with the body below, `404` for an unknown member, `400` for invalid params.

```json
{
  "user_id": 15,
  "strategy": "personalized",
  "as_of": "2026-09-21T00:00:00.000Z",
  "recommendations": [
    {
      "rank": 1,
      "circle": {
        "id": 13,
        "name": "Confident Voices",
        "topic": { "slug": "confidence", "label": "Confidence" },
        "format": "in_person",
        "join_policy": "open",
        "member_count": 12,
        "max_members": 18,
        "spots_left": 6,
        "leaders": [{ "first_name": "Kira", "job_title": "Founder" }],
        "...": "slug, description, cover_image_url, last_activity_at"
      },
      "explanation": "Matches your interests in confidence and negotiation. Very active: 14 posts in the past month, last active yesterday.",
      "reasons": [
        { "code": "interest_match", "text": "Matches your interests in confidence and negotiation" },
        { "code": "activity", "text": "Very active: 14 posts in the past month, last active yesterday" },
        { "code": "availability", "text": "Open to join · 6 spots left" },
        { "code": "format", "text": "Meets in person" }
      ],
      "similar_circles": [{ "id": 37, "name": "The Confidence Lab" }]
    }
  ]
}
```

- `strategy` is `personalized` (stated interests), `inferred` (no stated interests; uses the Circles
  she's in) or `cold_start` (nothing to go on). The last two include a `next_step` nudge.
- `explanation` is ready to show as-is; `reasons` lets a client render the same facts as chips.
- `similar_circles` holds near-duplicates collapsed under this pick, so they stay one tap away
  without crowding the list.

### `GET /health`

Returns `{ "status": "ok", "as_of": "..." }`.

## Planted scenarios

All four are covered by `test/scenarios.test.ts`, and were also checked against the running server.

| Scenario | User | Result |
| --- | --- | --- |
| Obvious matches | 7 | #6 Speak Up Circle and #5 Women Who Lead rank 1–2. #6 is explained as matching *both* her interests |
| Duplicate Circles | 15 | One Negotiation Circle (#11) is shown; #10 and #12 appear as its `similar_circles` |
| Full / inactive | 23 | #20 (full) and #21 (inactive, unlisted) are excluded; #22 Level Up Collective ranks first even though it's request-to-join |
| Cold start | 42 | Five very active Circles on five different topics, labeled as popularity picks, plus a nudge to add interests |

`test/all-users.test.ts` also checks invariants for **all 100 members**:
- Every member gets a full list.
- No list includes a Circle she's already in, or one that's full, inactive or unlisted.
- No list has two Circles on the same topic, or a duplicate of an active Circle she's already in.
- Every pick has a clean explanation.
- The top pick matches a stated interest whenever any recommendable Circle does.

## Database schema

SQLite via `better-sqlite3`, written to port to Postgres with minimal changes. Full DDL with
comments: [db/schema.sql](db/schema.sql).

```
topics ──< user_topic_interests >── users ──< memberships >── circles ──< circle_tags
                                       │                          │
                                       └────────< posts >─────────┤
                                                                  └── circle_stats (1:1, derived)
```

| Table | Purpose | Keys / indexes worth calling out |
| --- | --- | --- |
| `topics` | Taxonomy | `slug UNIQUE`; labels feed explanations |
| `users` | Member profiles | |
| `user_topic_interests` | Stated interests, normalized from the JSON array | PK `(user_id, topic_id)` for "my interests"; index on `topic_id` for the reverse lookup ("who cares about negotiation") |
| `circles` | Circle profile and activity aggregates | Index on `topic_id` for candidate retrieval by topic; `max_members` is nullable (uncapped) |
| `circle_tags` | Free-form tags | PK `(circle_id, tag)` drops the seed's duplicate tags; index on `tag`. TEXT, not an FK, because tags aren't guaranteed to be taxonomy slugs |
| `memberships` | Who is in which Circle; leaders are `role='leader'` | PK `(user_id, circle_id)` for "my Circles"; `(circle_id, role)` for leaders and members of a Circle |
| `posts` | Feed activity (`activity.json`) | `(circle_id, created_at)` for range scans of recent posts when computing engagement |
| `circle_stats` | **Derived** health, capacity and inactivity per Circle | Partial index on `health_score` covering only joinable Circles (not full, not inactive), for fast "most active" fallback lists |
| `dataset_meta` | Snapshot `as_of` time | |

`circle_stats` is computed in the seed step so the request path never recomputes aggregates. In
production it would be a table refreshed by a background job.

## Project layout

```
src/
  server.ts, app.ts         Fastify server and routes (validation via JSON schema)
  service.ts                Loads one member's inputs from the repository and calls the recommender
  repository.ts             All SQL lives here
  seed.ts, bootstrap.ts     JSON → SQLite, derived stats, as-of handling
  config.ts                 Every ranking weight and threshold, in one place
  recommender/
    recommend.ts            Pipeline: profile → filters → score → sort → de-duplicate → explain
    scoring.ts              Interest profile, hard filters, relevance, fit
    health.ts               Circle activity/capacity signals
    diversity.ts            Near-duplicate collapsing
    explain.ts              Member-facing explanation templates
db/schema.sql               DDL with rationale comments
test/                       Scenarios, all-users invariants, unit tests, API tests
scripts/                    seed and recommend CLIs
```
