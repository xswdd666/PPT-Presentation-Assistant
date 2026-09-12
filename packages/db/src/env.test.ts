import { describe, expect, it } from "vitest";
import { parseDatabaseEnvironment } from "./env.js";

describe("database environment", () => {
  it("validates required infrastructure settings", () => {
    const environment = parseDatabaseEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://deck:deck@localhost:5432/deck_rehearsal",
      OBJECT_STORAGE_BUCKET: "test-bucket",
    });

    expect(environment.JOB_QUEUE_NAME).toBe("deck-rehearsal");
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseDatabaseEnvironment({
        DATABASE_URL: "mysql://localhost/deck",
        OBJECT_STORAGE_BUCKET: "test-bucket",
      }),
    ).toThrow();
  });
});
