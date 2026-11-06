import { RANKING } from "../config.ts";
import type { Circle } from "../types.ts";

export interface Ranked {
  circle: Circle;
  total: number;
}

export interface DiversifiedPick<T extends Ranked> {
  item: T;
  similar: Circle[];
}

/**
 * Collapse near-duplicate Circles so one topic can't flood the list.
 *
 * Input must be sorted best-first. We keep the best Circle per primary topic and attach the rest as
 * `similar` ("Also on Negotiation: ...") so members can still find them without seeing three
 * near-identical cards in a row. Circles with no topic are never collapsed (we can't tell what
 * they're about, so we can't call them duplicates).
 */
export function diversifyByTopic<T extends Ranked>(sorted: T[]): DiversifiedPick<T>[] {
  const picks: DiversifiedPick<T>[] = [];
  const byGroup = new Map<string, DiversifiedPick<T>>();

  for (const item of sorted) {
    const key = item.circle.topic ?? `circle:${item.circle.id}`;
    const existing = byGroup.get(key);
    if (existing) {
      if (existing.similar.length < RANKING.maxSimilarCircles) existing.similar.push(item.circle);
      continue;
    }
    const pick = { item, similar: [] };
    byGroup.set(key, pick);
    picks.push(pick);
  }
  return picks;
}
