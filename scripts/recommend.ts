// Print recommendations for one or more members without starting the server.
//   npm run recommend -- 7 15 23 42
//   npm run recommend -- 23 --debug
import { openSeededDatabase } from "../src/bootstrap.ts";
import { Repository } from "../src/repository.ts";
import { getRecommendationsForMember } from "../src/service.ts";

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (ids.length === 0) ids.push(7, 15, 23, 42);

const { db } = openSeededDatabase();
const repo = new Repository(db);

for (const id of ids) {
  const result = getRecommendationsForMember(repo, id, { debug });
  if (!result) {
    console.log(`\nUser ${id}: not found`);
    continue;
  }
  const interests = repo.getStatedInterests(id);
  const circles = repo.getMemberships(id).map((m) => `#${m.circle_id}`);
  console.log(
    `\nUser ${id} — strategy: ${result.strategy} | interests: [${interests.join(", ")}] | in: [${circles.join(", ")}]`,
  );
  for (const r of result.recommendations) {
    const score = r.score
      ? `  (total ${r.score.total} = rel ${r.score.relevance} / health ${r.score.health} / fit ${r.score.fit})`
      : "";
    console.log(`  ${r.rank}. #${r.circle.id} ${r.circle.name}${score}`);
    console.log(`     ${r.explanation}`);
    console.log(`     ${r.reasons.slice(2).map((x) => x.text).join(" | ")}`);
    if (r.similar_circles.length) {
      console.log(`     Similar: ${r.similar_circles.map((c) => `#${c.id} ${c.name}`).join(", ")}`);
    }
  }
  if (result.next_step) console.log(`  → ${result.next_step}`);
  if (debug && result.debug) {
    const notJoined = result.debug.excluded.filter((e) => !e.reasons.includes("already_member"));
    console.log(`  Excluded: ${notJoined.map((e) => `#${e.circle_id} (${e.reasons.join("+")})`).join(", ")}`);
  }
}
db.close();
