import { seedFromDisk } from "../src/bootstrap.ts";
import { openDatabase, type DB } from "../src/db.ts";
import { Repository } from "../src/repository.ts";
import { getRecommendationsForMember } from "../src/service.ts";
import type { RecommendationResult } from "../src/types.ts";
import type { RecommendOptions } from "../src/recommender/recommend.ts";

/** Fresh in-memory database seeded from data/*.json. */
export function createSeededDb(): DB {
  const db = openDatabase(":memory:");
  seedFromDisk(db);
  return db;
}

export function createRepo(): Repository {
  return new Repository(createSeededDb());
}

export function recsFor(repo: Repository, userId: number, options?: RecommendOptions): RecommendationResult {
  const result = getRecommendationsForMember(repo, userId, options);
  if (!result) throw new Error(`user ${userId} not found`);
  return result;
}

export const circleIds = (r: RecommendationResult) => r.recommendations.map((x) => x.circle.id);
