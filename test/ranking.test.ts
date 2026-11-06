// Unit tests for the pure ranking building blocks.
import { describe, expect, it } from "vitest";
import { diversifyByTopic } from "../src/recommender/diversity.ts";
import { joinList, relativeDays } from "../src/recommender/explain.ts";
import { computeCircleStats, logScale } from "../src/recommender/health.ts";
import {
  buildInterestProfile,
  coveredTopics,
  exclusionReasons,
  scoreRelevance,
} from "../src/recommender/scoring.ts";
import type { Circle } from "../src/types.ts";

const AS_OF = new Date("2026-09-21T00:00:00Z");
const daysAgo = (d: number) => new Date(AS_OF.getTime() - d * 86_400_000).toISOString();

const baseStats = {
  member_count: 10,
  max_members: 20 as number | null,
  last_activity_at: daysAgo(1),
  feed_posts_30d: 10,
  chat_messages_30d: 100,
};

function circle(overrides: Partial<Circle> & { id: number }): Circle {
  return {
    name: `Circle ${overrides.id}`,
    slug: `circle-${overrides.id}`,
    description: null,
    cover_image_url: null,
    topic: null,
    tags: [],
    format: "virtual",
    access: "public",
    join_policy: "open",
    max_members: null,
    member_count: 10,
    last_activity_at: daysAgo(1),
    feed_posts_30d: 10,
    chat_messages_30d: 100,
    stats: computeCircleStats(baseStats, [], AS_OF),
    leaders: [],
    ...overrides,
  };
}

describe("computeCircleStats", () => {
  it("marks a Circle at capacity as full", () => {
    const s = computeCircleStats({ ...baseStats, member_count: 15, max_members: 15 }, [], AS_OF);
    expect(s.is_full).toBe(true);
    expect(s.spots_left).toBe(0);
  });

  it("treats max_members = null as uncapped", () => {
    const s = computeCircleStats({ ...baseStats, max_members: null }, [], AS_OF);
    expect(s.is_full).toBe(false);
    expect(s.spots_left).toBeNull();
  });

  it("marks a Circle inactive after a long silence", () => {
    expect(computeCircleStats({ ...baseStats, last_activity_at: daysAgo(60) }, [], AS_OF).is_inactive).toBe(true);
  });

  it("marks a Circle inactive when the feed is empty and chat is near-silent", () => {
    const s = computeCircleStats({ ...baseStats, feed_posts_30d: 0, chat_messages_30d: 2 }, [], AS_OF);
    expect(s.is_inactive).toBe(true);
  });

  it("measures time against the dataset's as-of date, not the wall clock", () => {
    const later = new Date(AS_OF.getTime() + 90 * 86_400_000);
    expect(computeCircleStats(baseStats, [], AS_OF).is_inactive).toBe(false);
    expect(computeCircleStats(baseStats, [], later).is_inactive).toBe(true);
  });

  it("scores busier, fresher Circles as healthier", () => {
    const quiet = computeCircleStats({ ...baseStats, feed_posts_30d: 2, last_activity_at: daysAgo(15) }, [], AS_OF);
    const busy = computeCircleStats(baseStats, [], AS_OF);
    expect(busy.health_score).toBeGreaterThan(quiet.health_score);
  });

  it("only counts engagement on posts from the last 30 days", () => {
    const post = (d: number) => ({ created_at: daysAgo(d), reaction_count: 10, comment_count: 5, save_count: 1 });
    const s = computeCircleStats(baseStats, [post(3), post(90)], AS_OF);
    expect(s.engagement_30d).toBe(16);
    expect(s.avg_engagement_per_post).toBe(16);
  });

  it("log-scales counts with a ceiling", () => {
    expect(logScale(0, 20)).toBe(0);
    expect(logScale(20, 20)).toBe(1);
    expect(logScale(500, 20)).toBe(1);
  });
});

describe("scoreRelevance", () => {
  const profile = buildInterestProfile(["negotiation"], [
    { circle_id: 99, circle_name: "Team Leads", topic: "managing-a-team", role: "member" },
  ]);

  it("values a primary-topic match over a tag mention", () => {
    const onTopic = scoreRelevance(circle({ id: 1, topic: "negotiation" }), profile);
    const tagOnly = scoreRelevance(circle({ id: 2, topic: "allyship", tags: ["negotiation"] }), profile);
    expect(onTopic.score).toBeGreaterThan(tagOnly.score);
  });

  it("values a topic reinforced by its tags over one whose tags point elsewhere", () => {
    const focused = scoreRelevance(circle({ id: 1, topic: "negotiation", tags: ["negotiation"] }), profile);
    const diffuse = scoreRelevance(circle({ id: 2, topic: "negotiation", tags: ["allyship"] }), profile);
    expect(focused.score).toBeGreaterThan(diffuse.score);
  });

  it("values stated interests over interests inferred from existing Circles", () => {
    const stated = scoreRelevance(circle({ id: 1, topic: "negotiation" }), profile);
    const inferred = scoreRelevance(circle({ id: 2, topic: "managing-a-team" }), profile);
    expect(stated.score).toBeGreaterThan(inferred.score);
    expect(inferred.best?.signal.viaCircle).toBe("Team Leads");
  });

  it("scores 0 when nothing matches", () => {
    expect(scoreRelevance(circle({ id: 1, topic: "allyship" }), profile).score).toBe(0);
  });
});

describe("exclusionReasons / coveredTopics", () => {
  const active = circle({ id: 12, topic: "negotiation" });
  const dead = circle({ id: 21, topic: "getting-promoted", stats: { ...active.stats, is_inactive: true } });
  const byId = new Map([active, dead].map((c) => [c.id, c]));
  const memberships = [
    { circle_id: 12, circle_name: "Negotiate Like a Leader", topic: "negotiation", role: "member" as const },
    { circle_id: 21, circle_name: "Career Climbers", topic: "getting-promoted", role: "member" as const },
  ];
  const covered = coveredTopics(memberships, byId);

  it("treats a topic as covered only by an active Circle she's in", () => {
    expect([...covered]).toEqual(["negotiation"]);
  });

  it("excludes a near-duplicate of an active Circle she's in, but not a replacement for a dead one", () => {
    const joined = new Set([12, 21]);
    expect(exclusionReasons(circle({ id: 11, topic: "negotiation" }), joined, covered)).toEqual([
      "topic_already_covered",
    ]);
    expect(exclusionReasons(circle({ id: 22, topic: "getting-promoted" }), joined, covered)).toEqual([]);
  });
});

describe("diversifyByTopic", () => {
  it("keeps the best Circle per topic and attaches the rest as similar", () => {
    const ranked = [
      { circle: circle({ id: 11, topic: "negotiation" }), total: 0.9 },
      { circle: circle({ id: 13, topic: "confidence" }), total: 0.8 },
      { circle: circle({ id: 10, topic: "negotiation" }), total: 0.7 },
      { circle: circle({ id: 27, topic: null }), total: 0.6 },
      { circle: circle({ id: 28, topic: null }), total: 0.5 },
    ];
    const picks = diversifyByTopic(ranked);
    expect(picks.map((p) => p.item.circle.id)).toEqual([11, 13, 27, 28]);
    expect(picks[0]?.similar.map((c) => c.id)).toEqual([10]);
  });
});

describe("explanation helpers", () => {
  it("joins lists naturally", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("describes recency in plain words", () => {
    expect(relativeDays(0.2)).toBe("today");
    expect(relativeDays(1.5)).toBe("yesterday");
    expect(relativeDays(5.7)).toBe("5 days ago");
  });
});
