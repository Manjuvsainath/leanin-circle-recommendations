import { buildApp } from "./app.ts";
import { openSeededDatabase } from "./bootstrap.ts";
import { PATHS } from "./config.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const { db, seeded } = openSeededDatabase();
if (seeded) {
  console.log(`Seeded ${PATHS.database} (as of ${seeded.asOf.toISOString()})`);
}

const app = buildApp(db, { logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port, host });
  console.log(`\nTry: curl http://${host}:${port}/users/7/recommendations\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
