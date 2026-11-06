import fs from "node:fs";
import path from "node:path";
import type { DB } from "./db.ts";
import { computeCircleStats, type PostEngagement } from "./recommender/health.ts";

// ---- raw seed shapes (as provided in data/*.json) ---------------------------

interface RawTopic {
  id: number;
  slug: string;
  label: string;
}
interface RawUser {
  id: number;
  first_name: string;
  last_name: string;
  has_photo: boolean;
  bio: string | null;
  job_title: string | null;
  company: string | null;
  industry: string | null;
  location: string | null;
  joined_at: string;
  topic_interests: string[];
  profile_completeness: number;
}
interface RawCircle {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  topic: string | null;
  tags: string[];
  cover_image_url: string | null;
  format: string;
  access: string;
  join_policy: string;
  max_members: number | null;
  member_count: number;
  created_at: string;
  last_activity_at: string;
  feed_posts_30d: number;
  chat_messages_30d: number;
}
interface RawMembership {
  user_id: number;
  circle_id: number;
  role: string;
  joined_at: string;
}
interface RawPost extends PostEngagement {
  id: number;
  circle_id: number;
  author_user_id: number;
  body: string;
}

export interface Dataset {
  topics: RawTopic[];
  users: RawUser[];
  circles: RawCircle[];
  memberships: RawMembership[];
  activity: RawPost[];
}

export function loadDataset(dataDir: string): Dataset {
  const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8")) as T;
  return {
    topics: read<RawTopic[]>("topics.json"),
    users: read<RawUser[]>("users.json"),
    circles: read<RawCircle[]>("circles.json"),
    memberships: read<RawMembership[]>("memberships.json"),
    activity: read<RawPost[]>("activity.json"),
  };
}

/**
 * The dataset is a snapshot. "Now" must be the snapshot time, not the wall clock, or every Circle
 * looks stale. Default: the latest timestamp in the data. Override with the AS_OF env var.
 */
export function deriveAsOf(data: Dataset): Date {
  const override = process.env.AS_OF;
  if (override) {
    const d = new Date(override);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid AS_OF: ${override}`);
    return d;
  }
  const timestamps = [
    ...data.circles.map((c) => Date.parse(c.last_activity_at)),
    ...data.activity.map((a) => Date.parse(a.created_at)),
  ];
  return new Date(Math.max(...timestamps));
}

export interface SeedSummary {
  asOf: Date;
  counts: Record<string, number>;
  warnings: string[];
}

export function seedDatabase(db: DB, schemaSql: string, data: Dataset, asOf = deriveAsOf(data)): SeedSummary {
  const warnings: string[] = [];
  db.exec(schemaSql);

  const topicIdBySlug = new Map(data.topics.map((t) => [t.slug, t.id]));
  const topicId = (slug: string, context: string): number => {
    const id = topicIdBySlug.get(slug);
    if (id === undefined) throw new Error(`Unknown topic slug "${slug}" in ${context}`);
    return id;
  };

  const insert = {
    topic: db.prepare("INSERT INTO topics (id, slug, label) VALUES (@id, @slug, @label)"),
    user: db.prepare(`
      INSERT INTO users (id, first_name, last_name, has_photo, bio, job_title, company, industry,
                         location, joined_at, profile_completeness)
      VALUES (@id, @first_name, @last_name, @has_photo, @bio, @job_title, @company, @industry,
              @location, @joined_at, @profile_completeness)`),
    interest: db.prepare("INSERT OR IGNORE INTO user_topic_interests (user_id, topic_id) VALUES (?, ?)"),
    circle: db.prepare(`
      INSERT INTO circles (id, slug, name, description, topic_id, cover_image_url, format, access,
                           join_policy, max_members, member_count, created_at, last_activity_at,
                           feed_posts_30d, chat_messages_30d)
      VALUES (@id, @slug, @name, @description, @topic_id, @cover_image_url, @format, @access,
              @join_policy, @max_members, @member_count, @created_at, @last_activity_at,
              @feed_posts_30d, @chat_messages_30d)`),
    tag: db.prepare("INSERT OR IGNORE INTO circle_tags (circle_id, tag) VALUES (?, ?)"),
    membership: db.prepare(
      "INSERT INTO memberships (user_id, circle_id, role, joined_at) VALUES (@user_id, @circle_id, @role, @joined_at)",
    ),
    post: db.prepare(`
      INSERT INTO posts (id, circle_id, author_user_id, body, reaction_count, comment_count, save_count, created_at)
      VALUES (@id, @circle_id, @author_user_id, @body, @reaction_count, @comment_count, @save_count, @created_at)`),
    stats: db.prepare(`
      INSERT INTO circle_stats (circle_id, computed_at, days_since_activity, engagement_30d,
                                avg_engagement_per_post, spots_left, is_full, is_inactive, health_score)
      VALUES (@circle_id, @computed_at, @days_since_activity, @engagement_30d, @avg_engagement_per_post,
              @spots_left, @is_full, @is_inactive, @health_score)`),
    meta: db.prepare("INSERT INTO dataset_meta (key, value) VALUES (?, ?)"),
  };

  const run = db.transaction(() => {
    for (const t of data.topics) insert.topic.run(t);

    for (const u of data.users) {
      const { topic_interests, ...row } = u;
      insert.user.run({ ...row, has_photo: u.has_photo ? 1 : 0 });
      for (const slug of topic_interests) insert.interest.run(u.id, topicId(slug, `user ${u.id}`));
    }

    for (const c of data.circles) {
      const { tags, topic, ...row } = c;
      insert.circle.run({ ...row, topic_id: topic === null ? null : topicId(topic, `circle ${c.id}`) });
      for (const tag of tags) insert.tag.run(c.id, tag);
    }

    for (const m of data.memberships) insert.membership.run(m);
    for (const p of data.activity) insert.post.run(p);

    // Sanity check the denormalized member_count against membership rows.
    const counts = new Map<number, number>();
    for (const m of data.memberships) counts.set(m.circle_id, (counts.get(m.circle_id) ?? 0) + 1);

    const postsByCircle = new Map<number, RawPost[]>();
    for (const p of data.activity) {
      const list = postsByCircle.get(p.circle_id) ?? [];
      list.push(p);
      postsByCircle.set(p.circle_id, list);
    }

    for (const c of data.circles) {
      if ((counts.get(c.id) ?? 0) !== c.member_count) {
        warnings.push(`circle ${c.id}: member_count ${c.member_count} != ${counts.get(c.id) ?? 0} membership rows`);
      }
      const s = computeCircleStats(c, postsByCircle.get(c.id) ?? [], asOf);
      insert.stats.run({
        circle_id: c.id,
        computed_at: asOf.toISOString(),
        ...s,
        is_full: s.is_full ? 1 : 0,
        is_inactive: s.is_inactive ? 1 : 0,
      });
    }

    insert.meta.run("as_of", asOf.toISOString());
    insert.meta.run("seeded_at", new Date().toISOString());
  });
  run();

  return {
    asOf,
    counts: {
      topics: data.topics.length,
      users: data.users.length,
      circles: data.circles.length,
      memberships: data.memberships.length,
      posts: data.activity.length,
    },
    warnings,
  };
}
