import fs from "node:fs";
import { PATHS } from "./config.ts";
import { isSeeded, openDatabase, type DB } from "./db.ts";
import { loadDataset, seedDatabase, type SeedSummary } from "./seed.ts";

/** Seed `db` from the JSON files in data/. */
export function seedFromDisk(db: DB, dataDir = PATHS.data): SeedSummary {
  return seedDatabase(db, fs.readFileSync(PATHS.schema, "utf8"), loadDataset(dataDir));
}

/** Open the database file, seeding it first if it's new/empty. */
export function openSeededDatabase(file = PATHS.database): { db: DB; seeded: SeedSummary | null } {
  const db = openDatabase(file);
  const seeded = isSeeded(db) ? null : seedFromDisk(db);
  return { db, seeded };
}
