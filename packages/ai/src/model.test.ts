import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { JsonModelGateway, analysisSchema } from "./index.js";
afterEach(() => vi.unstubAllGlobals());
it("retries invalid model JSON without accepting an invalid result", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "bad" } }] }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"value":"valid"}' } }],
        }),
      ),
    );
  vi.stubGlobal("fetch", request);
  const gateway = new JsonModelGateway({
    apiKey: "test-only",
    baseUrl: "https://model.invalid/v1",
    model: "test",
  });
  expect(
    await gateway.generate("test", {}, z.object({ value: z.string() })),
  ).toEqual({ value: "valid" });
  expect(request).toHaveBeenCalledTimes(2);
});
it("rejects comments outside the display-character limit", () => {
  expect(
    analysisSchema.safeParse({
      goal: "a",
      expectedAudienceResponse: "b",
      narrativeSummary: "c",
      reviewers: [
        { id: "jack", reason: "a" },
        { id: "olivia", reason: "b" },
        { id: "sophie", reason: "c" },
      ],
      comments: [
        {
          reviewerId: "jack",
          slideId: "s",
          body: "太短",
          evidence: "a",
          impact: "b",
          suggestedAction: "c",
        },
      ],
    }).success,
  ).toBe(false);
});
