import { RANKING } from "../config.ts";
import type { Circle, Reason, Strategy, Topic } from "../types.ts";
import type { RelevanceResult } from "./scoring.ts";

/**
 * Member-facing explanations, built from the signals that actually drove the score.
 * Deterministic templates (not LLM text): they can't invent facts, they're testable, and every
 * phrase maps back to a real field. No scores or internal jargon are ever shown to members.
 */

export function topicLabel(topics: Map<string, Topic>, slug: string): string {
  return topics.get(slug)?.label ?? slug.replace(/-/g, " ");
}

/** Lower-cased label for use mid-sentence ("Focused on public speaking"). */
const inSentence = (topics: Map<string, Topic>, slug: string) => topicLabel(topics, slug).toLowerCase();

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function relativeDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return `${Math.floor(days)} days ago`;
}

export function relevanceReason(circle: Circle, relevance: RelevanceResult, topics: Map<string, Topic>): Reason {
  const { best, matches } = relevance;

  if (best?.signal.source === "stated") {
    const label = inSentence(topics, best.signal.topic);
    const others = matches
      .filter((m) => m !== best && m.signal.source === "stated")
      .map((m) => inSentence(topics, m.signal.topic));
    if (others.length > 0) {
      return { code: "interest_match", text: `Matches your interests in ${joinList([label, ...others])}` };
    }
    return best.via === "topic"
      ? { code: "interest_match", text: `Focused on ${label}, one of your interests` }
      : { code: "interest_match", text: `Covers ${label}, one of your interests` };
  }

  if (best?.signal.source === "inferred") {
    const label = inSentence(topics, best.signal.topic);
    const via = best.signal.viaCircle ?? "a Circle you're in";
    return best.via === "topic"
      ? { code: "similar_to_your_circle", text: `Focused on ${label}, like ${via}, a Circle you're already in` }
      : { code: "similar_to_your_circle", text: `Also covers ${label}, like ${via}, a Circle you're already in` };
  }

  // No interest signal: be honest that this is a popularity/activity pick.
  return circle.stats.health_score >= RANKING.veryActiveHealth
    ? { code: "popular", text: "One of the most active Circles right now" }
    : { code: "popular", text: "An active Circle that's welcoming new members" };
}

export function activityReason(circle: Circle): Reason {
  const posts = circle.feed_posts_30d;
  const when = relativeDays(circle.stats.days_since_activity);
  if (posts >= RANKING.veryActivePosts) {
    return { code: "activity", text: `Very active: ${plural(posts, "post")} in the past month, last active ${when}` };
  }
  if (posts > 0) {
    return { code: "activity", text: `${plural(posts, "post")} in the past month, last active ${when}` };
  }
  return {
    code: "activity",
    text: `${plural(circle.chat_messages_30d, "group chat message")} in the past month, last active ${when}`,
  };
}

export function availabilityReason(circle: Circle): Reason {
  const spots = circle.stats.spots_left;
  const base = circle.join_policy === "open" ? "Open to join" : "Request to join";
  return { code: "availability", text: spots === null ? base : `${base} · ${plural(spots, "spot")} left` };
}

export function formatReason(circle: Circle): Reason {
  switch (circle.format) {
    case "virtual":
      return { code: "format", text: "Meets virtually, so you can join from anywhere" };
    case "hybrid":
      return { code: "format", text: "Hybrid: join online or in person" };
    case "in_person":
      return { code: "format", text: "Meets in person" };
  }
}

export interface Explanation {
  explanation: string;
  reasons: Reason[];
}

export function explain(circle: Circle, relevance: RelevanceResult, topics: Map<string, Topic>): Explanation {
  const why = relevanceReason(circle, relevance, topics);
  const activity = activityReason(circle);
  return {
    explanation: `${why.text}. ${activity.text}.`,
    reasons: [why, activity, availabilityReason(circle), formatReason(circle)],
  };
}

export function nextStep(strategy: Strategy): string | undefined {
  switch (strategy) {
    case "cold_start":
      return "Add a few topics you care about, like negotiation or leadership, and we'll tailor these picks to you.";
    case "inferred":
      return "Tell us which topics you care about and we'll tailor these picks even more closely.";
    case "personalized":
      return undefined;
  }
}
