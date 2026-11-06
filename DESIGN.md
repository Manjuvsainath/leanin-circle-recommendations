# Circle Recommendations - Design Notes

## Overview

This is a small TypeScript API using Fastify and SQLite. `GET /users/:id/recommendations` returns a
ranked list of Circles for a member (5 by default, max 10), and each Circle comes with a short
explanation of why it was picked.

The recommender itself is a pure function that works on plain data (`src/recommender/`). All the SQL
is in a repository layer. I did it this way so I could test the ranking without a database, and so
the storage could change later without touching the ranking code.

## How the ranking works

**1. Interest profile**

I start with the interests the member listed herself, at weight 1.0. I also add the topics of the
Circles she has already joined, but only at 0.25. I kept that weight low deliberately. If she tells us
what she wants, that should win over what we guess from her memberships.

**2. Hard filters**

I remove Circles that are full, inactive (no activity in 45 days, or no posts and very little chat),
unlisted, already joined, or on the same topic as an active Circle she's already in.

I used filters here instead of score penalties because none of these should show up at all. A full
Circle can't be joined, and a new member landing in a dead Circle is a bad first experience.

**3. Scoring**

```
score = 0.55 * relevance + 0.30 * health + 0.15 * fit
```

- Relevance: a match on the Circle's primary topic counts more than a match on a tag. Circles that
  cover more than one of her interests get a small bonus.
- Health: posts and chat (log-scaled, so a very busy Circle doesn't take over), recency of the last
  activity, and engagement per post.
- Fit: open vs. request-to-join, spots left, and format. In-person Circles score a bit lower because
  there's no location in the data, so I can't tell if one is near her.

If a member has no interests at all, relevance is meaningless, so I use `0.70 * health + 0.30 * fit`
instead. She just gets the most active Circles that are easy to join.

**4. De-duplication**

Only the best Circle per topic stays in the list. The rest are returned under `similar_circles` so
they can still be found.

**5. Explanations**

Explanations are built from templates using the same signals that went into the score. For example:
"Matches your interests in public speaking and leadership skills. Very active: 8 posts in the past
month."

**Fields I didn't use**

- `has_photo`, `profile_completeness` and `bio` describe the member, but don't say anything about which
  Circle would suit her.
- `company` and `industry` - there's nothing on the Circle side to match them against.
- Leader profiles are returned (first name and title only) but aren't part of the score.

## Tradeoffs

- I used hand-picked weights rather than a trained model. There's no data on joins or retention to
  train on yet, and fixed weights are easier to explain. They're all in `src/config.ts`.
- Explanations come from templates, not an LLM. Templates can't make up facts, they're easy to test,
  and they don't cost anything per request. If the wording needs to feel warmer later, an LLM could
  rewrite them, as long as it only gets these same reasons as input.
- "Now" is the date of the dataset (2026-09-21), not the current date. Using the real date would make
  every Circle look inactive and they'd all get filtered out.
- One Circle per topic is a pretty blunt rule. It handles the duplicate in the dataset, but it would
  also hide a second Circle on the same topic that's actually different. With more time I'd compare
  names, descriptions and members to find real duplicates.
- SQLite with scoring in memory means setup is just `npm install`. Loading every Circle per request is
  fine with 40 Circles, but obviously wouldn't work with 170,000.

## At production scale

- Retrieve candidates first instead of scoring everything: use the topic indexes to get a few hundred
  Circles (her topics, related tags, and a cached list of the most active ones) and score only those.
- Precompute health. `circle_stats` could be updated from activity events or a scheduled job (for
  example a Postgres materialized view). Each member's list could be cached and cleared when she joins
  a Circle or changes her interests.
- Start logging impressions, joins, and whether members are still active after 30 days. Use that to
  tune the weights offline and then with A/B tests. A "not interested" button would help too.
- Add a location to Circles (or geocode the leader's location) so in-person Circles can be matched by
  distance instead of just getting a lower score.
- Ranking on health favors Circles that are already established, so new Circles would struggle to get
  members. I'd keep one slot for new or small Circles so their leaders get a fair start.
- Better matching later on: text embeddings for Circle descriptions and member bios, and signals like
  "members of your Circles also joined...".

## If I had more time

- Better wording when an inferred interest comes from a Circle that's gone quiet, something like "Your
  Circle X has gone quiet. Here's an active one on the same topic."
- Map bios to topics for members who didn't list any interests.
- Use request-to-join approval rates as part of fit.

## How I used AI

I used an AI coding assistant mainly for boilerplate: the Fastify server and route setup, the SQLite
schema and seed script, the repository layer, the TypeScript/Vitest config, and the initial test
setup. I also used it to help clean up the wording in the README and this doc.

The ranking design was mine - which signals to use or skip, filters vs. penalties, the weights, the
cold-start fallback, and the one-per-topic de-duplication. I went through the generated code and
changed it where it didn't do what I wanted.

The thing that helped most was a test that runs recommendations for every user in the dataset. Going
through that output, I found two problems:

1. Inferred interests were outranking stated ones. User 100 asked for career-break Circles but got a
   leadership Circle at the top, because of a Circle she was already in. I dropped the inferred weight
   from 0.5 to 0.25, so now even the best inferred match scores below a plain tag match on something
   she actually asked for.
2. User 46 was already in a Negotiation Circle and was getting recommended a nearly identical one.
   That's why I added the filter for topics already covered by an active Circle she's in.

Neither of these was a bug in the code. They were problems with the rules, and I only noticed them
by reading through the actual results.
