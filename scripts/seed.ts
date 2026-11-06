// Rebuild db/circles.db from data/*.json (idempotent: the schema drops and recreates tables).
//   npm run seed
//   AS_OF=2026-09-21T00:00:00Z npm run seed   # pin "now" explicitly
import { seedFromDisk } from "../src/bootstrap.ts";
import { PATHS } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";

const db = openDatabase(PATHS.database);
const summary = seedFromDisk(db);
db.close();

console.log(`Seeded ${PATHS.database}`);
console.log(`  as_of: ${summary.asOf.toISOString()}`);
for (const [table, n] of Object.entries(summary.counts)) console.log(`  ${table}: ${n}`);
for (const w of summary.warnings) console.warn(`  warning: ${w}`);
