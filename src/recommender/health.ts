import { RANKING } from "../config.ts";
import type { CircleStats } from "../types.ts";

const DAY_MS = 86_400_000;

export interface StatsInput {
  member_count: number;
  max_members: number | null;
  last_activity_at: string;
  feed_posts_30d: number;
  chat_messages_30d: number;
}

export interface PostEngagement {
  created_at: string;
  reaction_count: number;
  comment_count: number;
  save_count: number;
}

/** log-scale a count into 0..1, saturating at `ref`. Diminishing returns: 20 vs 10 posts matters less than 2 vs 1. */
export function logScale(value: number, ref: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(ref));
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Derive a Circle's health/availability signals as of `asOf`.
 * Pure function: the seed step persists the result to circle_stats.
 */
export function computeCircleStats(circle: StatsInput, posts: PostEngagement[], asOf: Date): CircleStats {
  const { health, inactive } = RANKING;
  const now = asOf.getTime();

  const daysSinceActivity = Math.max(0, (now - Date.parse(circle.last_activity_at)) / DAY_MS);

  const windowStart = now - 30 * DAY_MS;
  const recentPosts = posts.filter((p) => {
    const t = Date.parse(p.created_at);
    return t >= windowStart && t <= now;
  });
  const engagement30d = recentPosts.reduce(
    (sum, p) => sum + p.reaction_count + p.comment_count + p.save_count,
    0,
  );
  const avgEngagement = recentPosts.length ? engagement30d / recentPosts.length : 0;

  const spotsLeft = circle.max_members === null ? null : Math.max(0, circle.max_members - circle.member_count);
  const isFull = spotsLeft === 0;

  const isInactive =
    daysSinceActivity > inactive.maxDaysSinceActivity ||
    (circle.feed_posts_30d === 0 && circle.chat_messages_30d < inactive.minChatIfNoPosts);

  const w = health.weights;
  const healthScore =
    w.posts * logScale(circle.feed_posts_30d, health.postsRef) +
    w.chat * logScale(circle.chat_messages_30d, health.chatRef) +
    w.recency * Math.exp(-daysSinceActivity / health.recencyDecayDays) +
    w.engagement * logScale(avgEngagement, health.engagementPerPostRef);

  return {
    days_since_activity: round(daysSinceActivity),
    engagement_30d: engagement30d,
    avg_engagement_per_post: round(avgEngagement),
    spots_left: spotsLeft,
    is_full: isFull,
    is_inactive: isInactive,
    health_score: round(Math.min(1, Math.max(0, healthScore))),
  };
}
