import { recommend, type RecommendOptions } from "./recommender/recommend.ts";
import type { Repository } from "./repository.ts";
import type { RecommendationResult } from "./types.ts";

/** Load everything the recommender needs for one member. Returns null for an unknown member. */
export function getRecommendationsForMember(
  repo: Repository,
  userId: number,
  options: RecommendOptions = {},
): RecommendationResult | null {
  const member = repo.getMember(userId);
  if (!member) return null;
  return recommend(
    {
      member,
      statedInterests: repo.getStatedInterests(userId),
      memberships: repo.getMemberships(userId),
      circles: repo.getCircles(),
      topics: repo.getTopics(),
      asOf: repo.getAsOf(),
    },
    options,
  );
}
