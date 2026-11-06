import { RANKING } from "../config.ts";
import type {
  Circle,
  CircleSummary,
  ExclusionReason,
  Member,
  Membership,
  Recommendation,
  RecommendationResult,
  Topic,
} from "../types.ts";
import { diversifyByTopic } from "./diversity.ts";
import { explain, nextStep, topicLabel } from "./explain.ts";
import {
  buildInterestProfile,
  chooseStrategy,
  combineScores,
  coveredTopics,
  exclusionReasons,
  scoreFit,
  scoreRelevance,
  type RelevanceResult,
} from "./scoring.ts";

export interface RecommendInput {
  member: Member;
  statedInterests: string[];
  memberships: Membership[];
  circles: Circle[];
  topics: Map<string, Topic>;
  asOf: Date;
}

export interface RecommendOptions {
  limit?: number;
  debug?: boolean;
}

interface Scored {
  circle: Circle;
  total: number;
  relevance: RelevanceResult;
  health: number;
  fit: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Pipeline: interest profile -> hard filters -> score (relevance, health, fit) -> sort
 *           -> collapse near-duplicates by topic -> top N -> explanations.
 * Pure function over plain data, so it's trivially unit-testable and storage-agnostic.
 */
export function recommend(input: RecommendInput, options: RecommendOptions = {}): RecommendationResult {
  const limit = Math.min(Math.max(1, options.limit ?? RANKING.defaultLimit), RANKING.maxLimit);
  const { member, statedInterests, memberships, circles, topics } = input;

  const profile = buildInterestProfile(statedInterests, memberships);
  const strategy = chooseStrategy(statedInterests, profile);
  const joined = new Set(memberships.map((m) => m.circle_id));
  const covered = coveredTopics(memberships, new Map(circles.map((c) => [c.id, c])));

  const excluded: { circle_id: number; name: string; reasons: ExclusionReason[] }[] = [];
  const scored: Scored[] = [];

  for (const circle of circles) {
    const reasons = exclusionReasons(circle, joined, covered);
    if (reasons.length > 0) {
      excluded.push({ circle_id: circle.id, name: circle.name, reasons });
      continue;
    }
    const relevance = scoreRelevance(circle, profile);
    const health = circle.stats.health_score;
    const fit = scoreFit(circle, member);
    scored.push({ circle, relevance, health, fit, total: combineScores(strategy, relevance.score, health, fit) });
  }

  // Deterministic order: score, then health, then id.
  scored.sort((a, b) => b.total - a.total || b.health - a.health || a.circle.id - b.circle.id);

  const recommendations: Recommendation[] = diversifyByTopic(scored)
    .slice(0, limit)
    .map(({ item, similar }, i) => {
      const { explanation, reasons } = explain(item.circle, item.relevance, topics);
      const rec: Recommendation = {
        rank: i + 1,
        circle: summarize(item.circle, topics),
        explanation,
        reasons,
        similar_circles: similar.map((c) => ({ id: c.id, name: c.name })),
      };
      if (options.debug) {
        rec.score = {
          total: round(item.total),
          relevance: round(item.relevance.score),
          health: round(item.health),
          fit: round(item.fit),
        };
      }
      return rec;
    });

  const result: RecommendationResult = {
    user_id: member.id,
    strategy,
    as_of: input.asOf.toISOString(),
    recommendations,
  };
  const step = nextStep(strategy);
  if (step) result.next_step = step;
  if (options.debug) {
    result.debug = {
      interest_profile: [...profile.values()].map(({ topic, weight, source }) => ({ topic, weight, source })),
      excluded,
    };
  }
  return result;
}

function summarize(circle: Circle, topics: Map<string, Topic>): CircleSummary {
  return {
    id: circle.id,
    name: circle.name,
    slug: circle.slug,
    description: circle.description,
    cover_image_url: circle.cover_image_url,
    topic: circle.topic ? { slug: circle.topic, label: topicLabel(topics, circle.topic) } : null,
    format: circle.format,
    join_policy: circle.join_policy,
    member_count: circle.member_count,
    max_members: circle.max_members,
    spots_left: circle.stats.spots_left,
    last_activity_at: circle.last_activity_at,
    leaders: circle.leaders,
  };
}
