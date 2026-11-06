# Circle Recommendations - Design Notes

## What I built

A TypeScript API (Fastify + SQLite). `GET /users/:id/recommendations` returns up to 10 ranked Circles,
each with a short explanation for the member. The recommender is a pure function over plain data
(`src/recommender/`) and all SQL is in a repository layer, so the ranking can be tested without a database.

How the ranking works:

1. **Interest profile.** Interests she listed count 1.0. Topics of Circles she's already in count only
   0.25, because what she tells us should win over what we guess.
2. **Hard filters.** Remove Circles that are full, inactive (nothing in 45 days, or no posts and little
   chat), unlisted, already joined, or on a topic she already has an active Circle for. These are
   filters, not penalties: a full or dead Circle is a bad first experience no matter how well it matches.
3. **Score** = `0.55 * relevance + 0.30 * health + 0.15 * fit`. Relevance weighs a primary-topic match
   above a tag match. Health uses log-scaled posts and chat, recency and engagement per post. Fit covers
   open vs. request-to-join, spots left, and format (in-person scores lower since there's no location
   data). With no interests at all, I use `0.70 * health + 0.30 * fit`.
4. **De-duplicate.** Keep the best Circle per topic. The rest go under `similar_circles`.
5. **Explain.** Templates built from the same signals as the score, e.g. "Matches your interests in
   public speaking and leadership skills. Very active: 8 posts in the past month."

I didn't use `has_photo`, `profile_completeness`, `bio`, `company` or `industry`. They describe the member
but there's nothing on the Circle side to match them against.

## Tradeoffs

- Hand-picked weights instead of a model, since there's no join or retention data to learn from. All
  weights are in `src/config.ts`.
- Template explanations instead of an LLM. They can't make things up, they're testable and free.
- "Now" is the dataset date (2026-09-21). With the real date, every Circle would look inactive.
- One Circle per topic is blunt. It would also hide a genuinely different second Circle on that topic.
- Scoring every Circle in memory is fine for 40 Circles, not for 170,000.

## Production scale

- Pull a few hundred candidates through topic indexes plus a cached "most active" list, and score only those.
- Precompute Circle health from activity events or a scheduled job, and cache each member's list.
- Log impressions, joins and 30-day retention, then tune weights offline and with A/B tests.
- Add Circle locations so in-person Circles can be matched by distance.
- Save a slot for new or small Circles. Ranking on health alone makes it hard for new leaders to grow.

**With more time:** better duplicate detection (names, descriptions, members), mapping bios to topics
for members with no interests, and request approval rates as a fit signal.

## How I used AI

I used an AI assistant for boilerplate: the Fastify setup, SQLite schema and seed script, repository
layer, config and test scaffolding. It also helped clean up the wording in the docs. The ranking design
(signals, filters vs. penalties, weights, cold start, de-duplication) was mine, and I reviewed and changed
the generated code where needed.

The most useful thing was a test that runs every user in the dataset. Reading its output showed two
problems. User 100 asked for career-break Circles but got a leadership Circle first, because of a Circle
she'd already joined, so I cut the inferred weight from 0.5 to 0.25. User 46, already in a Negotiation
Circle, was being shown a near-identical one, which is why I added the "topic already covered" filter.
