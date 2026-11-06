import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { createSeededDb } from "./helpers.ts";

const db = createSeededDb();
const app = buildApp(db);
afterAll(async () => {
  await app.close();
  db.close();
});

const get = (url: string) => app.inject({ method: "GET", url });

describe("GET /users/:id/recommendations", () => {
  it("returns a ranked list with explanations", async () => {
    const res = await get("/users/7/recommendations");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ user_id: 7, strategy: "personalized", as_of: "2026-09-21T00:00:00.000Z" });
    expect(body.recommendations).toHaveLength(5);
    expect(body.recommendations[0]).toMatchObject({
      rank: 1,
      circle: { id: expect.any(Number), name: expect.any(String) },
      explanation: expect.any(String),
      reasons: expect.any(Array),
      similar_circles: expect.any(Array),
    });
  });

  it("hides scores and debug info unless asked", async () => {
    const plain = (await get("/users/7/recommendations")).json();
    expect(plain.debug).toBeUndefined();
    expect(plain.recommendations[0].score).toBeUndefined();

    const debug = (await get("/users/7/recommendations?debug=true")).json();
    expect(debug.debug.excluded.length).toBeGreaterThan(0);
    expect(debug.recommendations[0].score.total).toEqual(expect.any(Number));
  });

  it("respects limit", async () => {
    const body = (await get("/users/15/recommendations?limit=3")).json();
    expect(body.recommendations).toHaveLength(3);
  });

  it("only exposes leaders' first name and job title", async () => {
    const body = (await get("/users/7/recommendations")).json();
    for (const rec of body.recommendations) {
      for (const leader of rec.circle.leaders) expect(Object.keys(leader).sort()).toEqual(["first_name", "job_title"]);
    }
  });

  it("404s for an unknown member", async () => {
    const res = await get("/users/9999/recommendations");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it.each(["/users/abc/recommendations", "/users/7/recommendations?limit=0", "/users/7/recommendations?limit=11"])(
    "400s for invalid input: %s",
    async (url) => {
      expect((await get(url)).statusCode).toBe(400);
    },
  );
});

describe("GET /health", () => {
  it("reports ok and the dataset's as-of date", async () => {
    const res = await get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", as_of: "2026-09-21T00:00:00.000Z" });
  });
});
