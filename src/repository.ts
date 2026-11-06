import type { DB } from "./db.ts";
import type { Circle, CircleAccess, CircleFormat, JoinPolicy, Leader, Member, Membership, Topic } from "./types.ts";

interface CircleRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  topic: string | null;
  format: CircleFormat;
  access: CircleAccess;
  join_policy: JoinPolicy;
  max_members: number | null;
  member_count: number;
  last_activity_at: string;
  feed_posts_30d: number;
  chat_messages_30d: number;
  days_since_activity: number;
  engagement_30d: number;
  avg_engagement_per_post: number;
  spots_left: number | null;
  is_full: number;
  is_inactive: number;
  health_score: number;
}

/** All SQL lives here; the recommender itself only sees plain objects. */
export class Repository {
  private readonly stmts;

  constructor(db: DB) {
    this.stmts = {
      asOf: db.prepare("SELECT value FROM dataset_meta WHERE key = 'as_of'"),
      member: db.prepare(`
        SELECT id, first_name, job_title, industry, location, profile_completeness, joined_at
        FROM users WHERE id = ?`),
      userIds: db.prepare("SELECT id FROM users ORDER BY id"),
      interests: db.prepare(`
        SELECT t.slug FROM user_topic_interests i JOIN topics t ON t.id = i.topic_id
        WHERE i.user_id = ? ORDER BY t.id`),
      memberships: db.prepare(`
        SELECT m.circle_id, c.name AS circle_name, t.slug AS topic, m.role
        FROM memberships m
        JOIN circles c ON c.id = m.circle_id
        LEFT JOIN topics t ON t.id = c.topic_id
        WHERE m.user_id = ? ORDER BY m.joined_at`),
      topics: db.prepare("SELECT id, slug, label FROM topics ORDER BY id"),
      circles: db.prepare(`
        SELECT c.id, c.name, c.slug, c.description, c.cover_image_url, t.slug AS topic, c.format,
               c.access, c.join_policy, c.max_members, c.member_count, c.last_activity_at,
               c.feed_posts_30d, c.chat_messages_30d,
               s.days_since_activity, s.engagement_30d, s.avg_engagement_per_post, s.spots_left,
               s.is_full, s.is_inactive, s.health_score
        FROM circles c
        JOIN circle_stats s ON s.circle_id = c.id
        LEFT JOIN topics t ON t.id = c.topic_id
        ORDER BY c.id`),
      tags: db.prepare("SELECT circle_id, tag FROM circle_tags ORDER BY circle_id, tag"),
      leaders: db.prepare(`
        SELECT m.circle_id, u.first_name, u.job_title
        FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.role = 'leader' ORDER BY m.circle_id, m.joined_at`),
    };
  }

  getAsOf(): Date {
    const row = this.stmts.asOf.get() as { value: string } | undefined;
    if (!row) throw new Error("Database is not seeded (missing dataset_meta.as_of). Run `npm run seed`.");
    return new Date(row.value);
  }

  getMember(id: number): Member | undefined {
    return this.stmts.member.get(id) as Member | undefined;
  }

  listUserIds(): number[] {
    return (this.stmts.userIds.all() as { id: number }[]).map((r) => r.id);
  }

  getStatedInterests(userId: number): string[] {
    return (this.stmts.interests.all(userId) as { slug: string }[]).map((r) => r.slug);
  }

  getMemberships(userId: number): Membership[] {
    return this.stmts.memberships.all(userId) as Membership[];
  }

  getTopics(): Map<string, Topic> {
    return new Map((this.stmts.topics.all() as Topic[]).map((t) => [t.slug, t]));
  }

  /**
   * Every Circle with its derived stats, tags and leaders. Fine for a few thousand Circles;
   * at production scale this becomes candidate retrieval by topic + a cached "popular" list.
   */
  getCircles(): Circle[] {
    const tagsByCircle = new Map<number, string[]>();
    for (const { circle_id, tag } of this.stmts.tags.all() as { circle_id: number; tag: string }[]) {
      const list = tagsByCircle.get(circle_id) ?? [];
      list.push(tag);
      tagsByCircle.set(circle_id, list);
    }
    const leadersByCircle = new Map<number, Leader[]>();
    for (const row of this.stmts.leaders.all() as (Leader & { circle_id: number })[]) {
      const list = leadersByCircle.get(row.circle_id) ?? [];
      list.push({ first_name: row.first_name, job_title: row.job_title });
      leadersByCircle.set(row.circle_id, list);
    }

    return (this.stmts.circles.all() as CircleRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      cover_image_url: r.cover_image_url,
      topic: r.topic,
      tags: tagsByCircle.get(r.id) ?? [],
      format: r.format,
      access: r.access,
      join_policy: r.join_policy,
      max_members: r.max_members,
      member_count: r.member_count,
      last_activity_at: r.last_activity_at,
      feed_posts_30d: r.feed_posts_30d,
      chat_messages_30d: r.chat_messages_30d,
      stats: {
        days_since_activity: r.days_since_activity,
        engagement_30d: r.engagement_30d,
        avg_engagement_per_post: r.avg_engagement_per_post,
        spots_left: r.spots_left,
        is_full: r.is_full === 1,
        is_inactive: r.is_inactive === 1,
        health_score: r.health_score,
      },
      leaders: leadersByCircle.get(r.id) ?? [],
    }));
  }
}
