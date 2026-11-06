import Fastify, { type FastifyInstance } from "fastify";
import { RANKING } from "./config.ts";
import type { DB } from "./db.ts";
import { Repository } from "./repository.ts";
import { getRecommendationsForMember } from "./service.ts";

interface RecommendationsRoute {
  Params: { id: number };
  Querystring: { limit: number; debug: boolean };
}

export function buildApp(db: DB, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const repo = new Repository(db);

  app.get("/health", async () => ({ status: "ok", as_of: repo.getAsOf().toISOString() }));

  app.get<RecommendationsRoute>(
    "/users/:id/recommendations",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", minimum: 1 } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: RANKING.maxLimit, default: RANKING.defaultLimit },
            debug: { type: "boolean", default: false },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { limit, debug } = request.query;
      const result = getRecommendationsForMember(repo, id, { limit, debug });
      if (!result) {
        return reply.code(404).send({ error: "not_found", message: `No member with id ${id}` });
      }
      return result;
    },
  );

  return app;
}
