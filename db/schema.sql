-- Circle recommendations schema (SQLite; written to port to Postgres with minimal changes).
--
-- Design notes
--   * Source-of-truth tables mirror the domain: topics, users, circles, memberships, posts.
--   * JSON arrays in the seed (user topic_interests, circle tags) are normalized into join
--     tables so they can be indexed and queried from both directions.
--   * circle_stats is a DERIVED table (health, capacity, inactivity) computed by the seed step.
--     In production this would be a materialized view / table refreshed by a background job,
--     so the request path never recomputes activity aggregates.
--   * Timestamps are ISO-8601 TEXT (SQLite has no native timestamp type; ISO strings sort correctly).

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS dataset_meta;
DROP TABLE IF EXISTS circle_stats;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS circle_tags;
DROP TABLE IF EXISTS circles;
DROP TABLE IF EXISTS user_topic_interests;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS topics;

CREATE TABLE topics (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,          -- stable key used across the app
  label TEXT NOT NULL                  -- display name used in member-facing explanations
);

CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  has_photo            INTEGER NOT NULL CHECK (has_photo IN (0, 1)),
  bio                  TEXT,
  job_title            TEXT,
  company              TEXT,
  industry             TEXT,
  location             TEXT,
  joined_at            TEXT NOT NULL,
  profile_completeness REAL NOT NULL CHECK (profile_completeness BETWEEN 0 AND 1)
);

-- A member's stated interests (normalized from users.topic_interests).
CREATE TABLE user_topic_interests (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id),
  PRIMARY KEY (user_id, topic_id)
) WITHOUT ROWID;
-- Reverse lookup ("who cares about negotiation?") for audience sizing / notifications.
CREATE INDEX idx_user_topic_interests_topic ON user_topic_interests(topic_id);

CREATE TABLE circles (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  topic_id          INTEGER REFERENCES topics(id),   -- nullable: some Circles have no topic
  cover_image_url   TEXT,
  format            TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'hybrid')),
  access            TEXT NOT NULL CHECK (access IN ('public', 'unlisted')),
  join_policy       TEXT NOT NULL CHECK (join_policy IN ('open', 'request')),
  max_members       INTEGER CHECK (max_members IS NULL OR max_members > 0),  -- NULL = uncapped
  member_count      INTEGER NOT NULL DEFAULT 0,      -- denormalized; kept in sync on join/leave
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  feed_posts_30d    INTEGER NOT NULL DEFAULT 0,
  chat_messages_30d INTEGER NOT NULL DEFAULT 0       -- aggregate only; no chat text stored
);
-- Candidate retrieval by topic ("Circles about the member's interests").
CREATE INDEX idx_circles_topic ON circles(topic_id);

-- Free-form, topic-ish tags. Kept as TEXT (not an FK) because tags are not guaranteed to be
-- taxonomy slugs; the composite PK also de-duplicates repeated tags in the seed data.
CREATE TABLE circle_tags (
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (circle_id, tag)
) WITHOUT ROWID;
CREATE INDEX idx_circle_tags_tag ON circle_tags(tag);

-- Leaders are members with role = 'leader'. PK (user_id, circle_id) serves "my Circles";
-- the secondary index serves "members/leaders of this Circle".
CREATE TABLE memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('member', 'leader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)
) WITHOUT ROWID;
CREATE INDEX idx_memberships_circle_role ON memberships(circle_id, role);

-- Circle feed posts (from activity.json). Used for engagement quality, not just volume.
CREATE TABLE posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  save_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
-- Range scans of a Circle's recent posts (engagement over the last 30 days).
CREATE INDEX idx_posts_circle_created ON posts(circle_id, created_at);

-- Derived per-Circle signals, recomputed by the seed step (a batch job in production).
CREATE TABLE circle_stats (
  circle_id               INTEGER PRIMARY KEY REFERENCES circles(id) ON DELETE CASCADE,
  computed_at             TEXT NOT NULL,     -- the "as of" time the stats describe
  days_since_activity     REAL NOT NULL,
  engagement_30d          INTEGER NOT NULL,  -- reactions + comments + saves on posts in last 30d
  avg_engagement_per_post REAL NOT NULL,
  spots_left              INTEGER,           -- NULL = uncapped
  is_full                 INTEGER NOT NULL CHECK (is_full IN (0, 1)),
  is_inactive             INTEGER NOT NULL CHECK (is_inactive IN (0, 1)),
  health_score            REAL NOT NULL CHECK (health_score BETWEEN 0 AND 1)
);
-- Partial index over only the Circles that can be recommended, ordered by health:
-- cheap "most active joinable Circles" lookups for cold-start / fallback lists.
CREATE INDEX idx_circle_stats_recommendable
  ON circle_stats(health_score DESC)
  WHERE is_full = 0 AND is_inactive = 0;

CREATE TABLE dataset_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
