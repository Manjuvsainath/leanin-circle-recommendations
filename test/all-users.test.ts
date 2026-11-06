// "Your API should return sensible recommendations for every user in the dataset."
// Invariants checked for all 100 members.
import { describe, expect, it } from "vitest";
import { createRepo, recsFor } from "./helpers.ts";

const repo = createRepo();
const circlesById = new Map(repo.getCircles().map((c) => [c.id, c]));

describe.each(repo.listUserIds())("user %i", (userId) => {
  const result = recsFor(repo, userId);
  const joined = new Set(repo.getMemberships(userId).map((m) => m.circle_id));
  // Topics she already has an active Circle for.
  const covered = new Set(
    [...joined].map((id) => circlesById.get(id)!).filter((c) => c.topic && !c.stats.is_inactive).map((c) => c.topic),
  );
  const stated = repo.getStatedInterests(userId);
  const recs = result.recommendations;

  it("gets a full list", () => {
    expect(recs).toHaveLength(5);
    expect(recs.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is never shown a Circle she's in, or one that is full, inactive or unlisted", () => {
    for (const { circle, similar_circles } of recs) {
      for (const id of [circle.id, ...similar_circles.map((c) => c.id)]) {
        const c = circlesById.get(id)!;
        expect(joined.has(id), `already in #${id}`).toBe(false);
        expect(c.stats.is_full, `#${id} is full`).toBe(false);
        expect(c.stats.is_inactive, `#${id} is inactive`).toBe(false);
        expect(c.access, `#${id} is unlisted`).toBe("public");
      }
    }
  });

  it("sees at most one Circle per topic, and none duplicating an active Circle she's already in", () => {
    const topics = recs.filter((r) => r.circle.topic).map((r) => r.circle.topic!.slug);
    expect(new Set(topics).size).toBe(topics.length);
    for (const t of topics) expect(covered.has(t), `already has an active ${t} Circle`).toBe(false);
  });

  it("gets a clean, member-facing explanation for every pick", () => {
    for (const r of recs) {
      expect(r.explanation.length).toBeGreaterThan(20);
      expect(r.explanation).not.toMatch(/undefined|null|NaN|score/i);
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("gets a top pick that matches a stated interest, when any recommendable Circle does", () => {
    const matchesStated = (id: number) => {
      const c = circlesById.get(id)!;
      return stated.some((t) => c.topic === t || c.tags.includes(t));
    };
    const recommendable = [...circlesById.values()].filter(
      (c) =>
        !joined.has(c.id) &&
        !(c.topic && covered.has(c.topic)) &&
        c.access === "public" &&
        !c.stats.is_full &&
        !c.stats.is_inactive,
    );
    const available = recommendable.some((c) => matchesStated(c.id));
    if (!available) return; // e.g. she's already in every Circle on her topics
    expect(matchesStated(recs[0]!.circle.id), `top pick #${recs[0]!.circle.id} vs [${stated.join(", ")}]`).toBe(true);
  });
});
