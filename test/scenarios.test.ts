// The four planted scenarios from the assignment (see data/README.md, "Named records").
import { describe, expect, it } from "vitest";
import { circleIds, createRepo, recsFor } from "./helpers.ts";

const repo = createRepo();
const circlesById = new Map(repo.getCircles().map((c) => [c.id, c]));

describe("obvious matches — user 7 (leadership-skills, public-speaking)", () => {
  const r = recsFor(repo, 7);

  it("ranks Women Who Lead (#5) and Speak Up Circle (#6) as the top two", () => {
    expect(r.strategy).toBe("personalized");
    expect(circleIds(r).slice(0, 2).sort((a, b) => a - b)).toEqual([5, 6]);
  });

  it("explains each top pick in terms of her stated interests", () => {
    const [first, second] = r.recommendations;
    expect(first?.reasons[0]?.code).toBe("interest_match");
    expect(second?.reasons[0]?.code).toBe("interest_match");
    const speakUp = r.recommendations.find((x) => x.circle.id === 6);
    expect(speakUp?.explanation).toMatch(/public speaking and leadership skills/);
  });
});

describe("duplicate Circles — user 15 (negotiation, confidence)", () => {
  const r = recsFor(repo, 15);
  const DUPES = [10, 11, 12];

  it("returns exactly one of the near-identical Negotiation Circles", () => {
    const shown = circleIds(r).filter((id) => DUPES.includes(id));
    expect(shown).toHaveLength(1);
  });

  it("keeps the other two reachable as similar_circles on that pick", () => {
    const pick = r.recommendations.find((x) => DUPES.includes(x.circle.id));
    const rest = DUPES.filter((id) => id !== pick?.circle.id);
    expect(pick?.similar_circles.map((c) => c.id).sort((a, b) => a - b)).toEqual(rest);
  });

  it("still covers her second interest (confidence) near the top", () => {
    expect(circleIds(r).slice(0, 2)).toContain(13); // Confident Voices: confidence + negotiation
  });
});

describe("full / inactive Circles — user 23 (getting-promoted)", () => {
  const r = recsFor(repo, 23, { debug: true });

  it("never recommends the full (#20) or inactive (#21) Circle, even as a similar Circle", () => {
    const everywhere = r.recommendations.flatMap((x) => [x.circle.id, ...x.similar_circles.map((c) => c.id)]);
    expect(everywhere).not.toContain(20);
    expect(everywhere).not.toContain(21);
  });

  it("ranks the healthy alternative, Level Up Collective (#22), first — even though it's request-to-join", () => {
    expect(circleIds(r)[0]).toBe(22);
    expect(r.recommendations[0]?.reasons.find((x) => x.code === "availability")?.text).toMatch(/^Request to join/);
  });

  it("records why #20 and #21 were excluded (debug)", () => {
    const excluded = new Map(r.debug?.excluded.map((e) => [e.circle_id, e.reasons]));
    expect(excluded.get(20)).toContain("full");
    expect(excluded.get(21)).toContain("inactive");
  });
});

describe("cold start — user 42 (no interests, memberships or profile)", () => {
  const r = recsFor(repo, 42);

  it("uses the cold-start strategy and nudges her to add interests", () => {
    expect(r.strategy).toBe("cold_start");
    expect(r.next_step).toBeTruthy();
    expect(r.recommendations).toHaveLength(5);
  });

  it("recommends only very active Circles", () => {
    for (const rec of r.recommendations) {
      expect(circlesById.get(rec.circle.id)?.feed_posts_30d).toBeGreaterThanOrEqual(8);
    }
  });

  it("spreads picks across different topics", () => {
    const topics = r.recommendations.map((x) => x.circle.topic?.slug ?? `none:${x.circle.id}`);
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("never claims an interest match it doesn't have", () => {
    for (const rec of r.recommendations) {
      expect(rec.reasons[0]?.code).toBe("popular");
      expect(rec.explanation).not.toMatch(/your interest|you're already in/);
    }
  });
});
