import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PATHS = {
  root: ROOT,
  data: path.join(ROOT, "data"),
  schema: path.join(ROOT, "db", "schema.sql"),
  database: process.env.DB_PATH ?? path.join(ROOT, "db", "circles.db"),
};

/**
 * Every ranking knob lives here so the heuristics are easy to read, defend and tune.
 * All component scores are normalized to 0..1 before weighting.
 */
export const RANKING = {
  /** Final score = sum(weight * component). */
  weights: {
    // Member has stated or inferred interests: relevance leads, health keeps us honest.
    personalized: { relevance: 0.55, health: 0.3, fit: 0.15 },
    // Nothing to personalize on: recommend the healthiest, easiest-to-join Circles.
    coldStart: { relevance: 0, health: 0.7, fit: 0.3 },
  },

  relevance: {
    /** How strongly a Circle matches one interest: primary topic counts more than a tag. */
    primaryTopic: 0.7,
    tag: 0.3,
    /**
     * Interest weights by source. Inferred = primary topics of Circles the member already joined.
     * Inferred is deliberately weak: what a member *told* us must win. At 0.25, the best inferred
     * match (topic + tag = 0.25) still loses to a mere tag mention of a stated interest (0.3).
     */
    statedWeight: 1.0,
    inferredWeight: 0.25,
    /** relevance = bestMatchShare * best single-interest match + (1 - share) * interest coverage. */
    bestMatchShare: 0.8,
  },

  health: {
    weights: { posts: 0.4, chat: 0.25, recency: 0.2, engagement: 0.15 },
    /** Values at/above these references score 1.0 (log-scaled below them). */
    postsRef: 20,
    chatRef: 200,
    engagementPerPostRef: 25,
    /** Recency score = exp(-days / decayDays). */
    recencyDecayDays: 14,
  },

  /** A Circle is inactive if nothing has happened for a while, or the feed is dead and chat is near-silent. */
  inactive: {
    maxDaysSinceActivity: 45,
    minChatIfNoPosts: 5,
  },

  fit: {
    weights: { join: 0.5, capacity: 0.3, format: 0.2 },
    openPolicy: 1.0,
    requestPolicy: 0.7, // still recommendable (the healthy getting-promoted Circle is request-to-join)
    fewSpotsThreshold: 2, // <= this many spots left: likely to fill before a request is approved
    fewSpotsScore: 0.6,
    // Circles have no location field, so we can't confirm an in-person Circle is nearby.
    inPersonKnownLocation: 0.75,
    inPersonUnknownLocation: 0.5,
  },

  /** Health score at/above which a Circle is described as "one of the most active". */
  veryActiveHealth: 0.75,
  /** Posts in 30 days at/above which we say "very active". */
  veryActivePosts: 8,
  maxSimilarCircles: 3,
  defaultLimit: 5,
  maxLimit: 10,
} as const;
