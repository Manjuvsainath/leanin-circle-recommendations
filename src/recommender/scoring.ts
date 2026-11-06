import { RANKING } from "../config.ts";
import type { Circle, ExclusionReason, Member, Membership, Strategy } from "../types.ts";

// ---- interest profile -------------------------------------------------------

export interface InterestSignal {
  topic: string;
  weight: number;
  source: "stated" | "inferred";
  /** For inferred interests: the Circle the member is already in that implies this topic. */
  viaCircle?: string;
}

/**
 * What the member cares about, as weighted topics.
 * Stated interests are strongest. The topics of Circles they've already joined are a weaker,
 * inferred signal (they chose those Circles), which also covers members with no stated interests.
 */
export function buildInterestProfile(stated: string[], memberships: Membership[]): Map<string, InterestSignal> {
  const profile = new Map<string, InterestSignal>();
  for (const topic of stated) {
    profile.set(topic, { topic, weight: RANKING.relevance.statedWeight, source: "stated" });
  }
  for (const m of memberships) {
    if (m.topic && !profile.has(m.topic)) {
      profile.set(m.topic, {
        topic: m.topic,
        weight: RANKING.relevance.inferredWeight,
        source: "inferred",
        viaCircle: m.circle_name,
      });
    }
  }
  return profile;
}

export function chooseStrategy(stated: string[], profile: Map<string, InterestSignal>): Strategy {
  if (stated.length > 0) return "personalized";
  if (profile.size > 0) return "inferred";
  return "cold_start";
}

// ---- eligibility (hard filters) ----------------------------------------------

/**
 * Circles we never recommend. These are hard filters rather than penalties because each one is a
 * broken promise to the member: you can't join a full Circle, an unlisted Circle isn't meant to be
 * discovered, and joining a dead Circle is the worst possible first experience.
 *
 * The duplicate rule also applies to Circles she's already in: if she belongs to an *active* Circle
 * on a topic, another Circle on that same topic is redundant (e.g. already in one of three
 * near-identical Negotiation Circles). If her Circle on that topic has gone quiet or is the only
 * one she has, an active alternative on that topic is still worth showing.
 */
export function coveredTopics(memberships: Membership[], circlesById: Map<number, Circle>): Set<string> {
  const covered = new Set<string>();
  for (const m of memberships) {
    const c = circlesById.get(m.circle_id);
    if (c?.topic && !c.stats.is_inactive) covered.add(c.topic);
  }
  return covered;
}

export function exclusionReasons(
  circle: Circle,
  joinedCircleIds: Set<number>,
  topicsCovered: Set<string> = new Set(),
): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (joinedCircleIds.has(circle.id)) reasons.push("already_member");
  else if (circle.topic && topicsCovered.has(circle.topic)) reasons.push("topic_already_covered");
  if (circle.access === "unlisted") reasons.push("unlisted");
  if (circle.stats.is_full) reasons.push("full");
  if (circle.stats.is_inactive) reasons.push("inactive");
  return reasons;
}

// ---- relevance ---------------------------------------------------------------

export interface InterestMatch {
  signal: InterestSignal;
  via: "topic" | "tag";
  strength: number;
}

export interface RelevanceResult {
  score: number;
  best: InterestMatch | null;
  /** Every interest this Circle touches (topic or tag), strongest first. */
  matches: InterestMatch[];
}

/**
 * relevance = 0.8 * (strength of the best single-interest match)
 *           + 0.2 * (share of the member's interest weight this Circle covers)
 *
 * A match on the Circle's primary topic is worth more than a tag mention, and a Circle whose tags
 * reinforce its topic is a more focused match than one whose tags point elsewhere.
 */
export function scoreRelevance(circle: Circle, profile: Map<string, InterestSignal>): RelevanceResult {
  const r = RANKING.relevance;
  const matches: InterestMatch[] = [];
  let totalWeight = 0;
  let coveredWeight = 0;

  for (const signal of profile.values()) {
    totalWeight += signal.weight;
    const onTopic = circle.topic === signal.topic;
    const inTags = circle.tags.includes(signal.topic);
    if (!onTopic && !inTags) continue;
    coveredWeight += signal.weight;
    matches.push({
      signal,
      via: onTopic ? "topic" : "tag",
      strength: signal.weight * ((onTopic ? r.primaryTopic : 0) + (inTags ? r.tag : 0)),
    });
  }

  // Strongest first; on ties prefer stated over inferred, then topic over tag.
  matches.sort(
    (a, b) =>
      b.strength - a.strength ||
      Number(b.signal.source === "stated") - Number(a.signal.source === "stated") ||
      Number(b.via === "topic") - Number(a.via === "topic"),
  );
  const best = matches[0] ?? null;
  if (!best || totalWeight === 0) return { score: 0, best: null, matches: [] };

  const coverage = coveredWeight / totalWeight;
  const score = r.bestMatchShare * best.strength + (1 - r.bestMatchShare) * coverage;
  return { score: Math.min(1, score), best, matches };
}

// ---- fit (how easy/realistic it is to actually join and participate) ----------

export function scoreFit(circle: Circle, member: Member): number {
  const f = RANKING.fit;

  const join = circle.join_policy === "open" ? f.openPolicy : f.requestPolicy;

  const spots = circle.stats.spots_left;
  const capacity = spots === null || spots > f.fewSpotsThreshold ? 1 : f.fewSpotsScore;

  const format =
    circle.format === "in_person" ? (member.location ? f.inPersonKnownLocation : f.inPersonUnknownLocation) : 1;

  return f.weights.join * join + f.weights.capacity * capacity + f.weights.format * format;
}

// ---- total ---------------------------------------------------------------------

export function combineScores(strategy: Strategy, relevance: number, health: number, fit: number): number {
  const w = strategy === "cold_start" ? RANKING.weights.coldStart : RANKING.weights.personalized;
  return w.relevance * relevance + w.health * health + w.fit * fit;
}
