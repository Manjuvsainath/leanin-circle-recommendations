export type CircleFormat = "in_person" | "virtual" | "hybrid";
export type CircleAccess = "public" | "unlisted";
export type JoinPolicy = "open" | "request";
export type MembershipRole = "member" | "leader";

/** personalized = stated interests; inferred = only the Circles they're in; cold_start = nothing. */
export type Strategy = "personalized" | "inferred" | "cold_start";

export interface Topic {
  id: number;
  slug: string;
  label: string;
}

export interface Member {
  id: number;
  first_name: string;
  job_title: string | null;
  industry: string | null;
  location: string | null;
  profile_completeness: number;
  joined_at: string;
}

export interface Membership {
  circle_id: number;
  circle_name: string;
  topic: string | null;
  role: MembershipRole;
}

export interface CircleStats {
  days_since_activity: number;
  engagement_30d: number;
  avg_engagement_per_post: number;
  spots_left: number | null;
  is_full: boolean;
  is_inactive: boolean;
  health_score: number;
}

/** Only what's appropriate to show another member: first name and title, never contact details. */
export interface Leader {
  first_name: string;
  job_title: string | null;
}

export interface Circle {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  topic: string | null;
  tags: string[];
  format: CircleFormat;
  access: CircleAccess;
  join_policy: JoinPolicy;
  max_members: number | null;
  member_count: number;
  last_activity_at: string;
  feed_posts_30d: number;
  chat_messages_30d: number;
  stats: CircleStats;
  leaders: Leader[];
}

// ---- API response shapes ---------------------------------------------------

export type ReasonCode =
  | "interest_match"
  | "similar_to_your_circle"
  | "popular"
  | "activity"
  | "availability"
  | "format";

export interface Reason {
  code: ReasonCode;
  text: string;
}

export interface CircleSummary {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  topic: { slug: string; label: string } | null;
  format: CircleFormat;
  join_policy: JoinPolicy;
  member_count: number;
  max_members: number | null;
  spots_left: number | null;
  last_activity_at: string;
  leaders: Leader[];
}

export interface ScoreBreakdown {
  total: number;
  relevance: number;
  health: number;
  fit: number;
}

export interface Recommendation {
  rank: number;
  circle: CircleSummary;
  /** One or two member-facing sentences. */
  explanation: string;
  /** Structured reasons, in priority order, so clients can render chips/badges. */
  reasons: Reason[];
  /** Near-duplicate Circles (same topic) collapsed under this pick. */
  similar_circles: { id: number; name: string }[];
  score?: ScoreBreakdown;
}

export type ExclusionReason =
  | "already_member"
  | "topic_already_covered" // she's already in an active Circle with the same primary topic
  | "full"
  | "inactive"
  | "unlisted";

export interface RecommendationResult {
  user_id: number;
  strategy: Strategy;
  as_of: string;
  recommendations: Recommendation[];
  /** Nudge shown to members we couldn't personalize for. */
  next_step?: string;
  debug?: {
    interest_profile: { topic: string; weight: number; source: "stated" | "inferred" }[];
    excluded: { circle_id: number; name: string; reasons: ExclusionReason[] }[];
  };
}
