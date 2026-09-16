import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { JsonModelGateway, analysisSchema } from "./index.js";
import { ReviewModelGateway, createModelGatewayFromEnv } from "./gateway.js";
import { safeFailure, commentBodySchema } from "./schemas.js";
import { fixture } from "./testing.js";
import { routeReviewers } from "./pipeline.js";

it("runs one isolated prompt per reviewer with the shared deck", async () => {
  const snapshot = fixture();
  const input = {
    ...snapshot,
    pages: [],
    reviewers: routeReviewers(snapshot.context.scenario),
  };
  const bodies: string[] = [];
  const request = vi.fn((_url: string, init?: RequestInit) => {
    if (typeof init?.body === "string") bodies.push(init.body);
    const reviewerId = input.reviewers[bodies.length - 1];
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goal: "说明成果",
                  expectedAudienceResponse: "确认计划",
                  narrativeSummary: "完整叙事",
                  reviewer: { id: reviewerId, reason: "独立视角" },
                  comments: [
                    {
                      slideId: "s1",
                      body: "",
                      evidence: "标题",
                      impact: "不清晰",
                      suggestedAction: "补充结论",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", request);
  const gateway = new ReviewModelGateway({
    apiKey: "test",
    baseUrl: "https://test.invalid",
    model: "test",
    retryDelayMs: 0,
  });
  const result = await gateway.synthesize(input);
  expect(result.reviewers.map((item) => item.id)).toEqual(input.reviewers);
  expect(request).toHaveBeenCalledTimes(input.reviewers.length);
  expect(
    bodies.every(
      (body) => body.includes("deck") && body.includes("personaPrompt"),
    ),
  ).toBe(true);
  expect(new Set(bodies).size).toBe(input.reviewers.length);
});

it("accepts comments from zero through one hundred display characters", () => {
  expect(commentBodySchema.safeParse("").success).toBe(true);
  expect(commentBodySchema.safeParse("字".repeat(47)).success).toBe(true);
  expect(commentBodySchema.safeParse("字".repeat(100)).success).toBe(true);
  expect(commentBodySchema.safeParse("字".repeat(101)).success).toBe(false);
});

it("reports connection failures without exposing credentials or materials", () => {
  const failure = safeFailure(
    new TypeError("private request details", {
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    }),
  );
  expect(failure.message).toContain("无法连接模型服务");
  expect(JSON.stringify(failure)).not.toContain("private request details");
});
afterEach(() => vi.unstubAllGlobals());
it("uses Token Plan OpenAI-compatible chat completions with its configured model", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"value":"ok"}' } }],
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  const gateway = createModelGatewayFromEnv({
    MODEL_PROVIDER: "openai_compatible",
    MODEL_API_KEY: "sk-sp-test-only",
    MODEL_BASE_URL:
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    MODEL_NAME: "qwen3.6-flash",
  });
  await expect(
    gateway.generate("test", {}, z.object({ value: z.string() })),
  ).resolves.toEqual({ value: "ok" });
  const [url, init] = request.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  );
  if (typeof init.body !== "string") throw new Error("Expected JSON body");
  const body = z
    .object({
      model: z.string(),
      messages: z.array(z.object({ content: z.string() })).min(1),
      input: z.unknown().optional(),
    })
    .parse(JSON.parse(init.body));
  expect(body.model).toBe("qwen3.6-flash");
  expect(body.messages[0]?.content).toEqual(expect.any(String));
  expect(body.input).toBeUndefined();
  expect(init.headers).toMatchObject({
    authorization: "Bearer sk-sp-test-only",
  });
});
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
it("uses the DashScope multimodal endpoint for qwen3.6-flash", async () => {
  let requestBody = "";
  const request = vi.fn((_url: string, init?: RequestInit) => {
    if (typeof init?.body === "string") requestBody = init.body;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          output: {
            choices: [{ message: { content: [{ text: '{"value":"ok"}' }] } }],
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", request);
  const gateway = new ReviewModelGateway({
    apiKey: "test-only",
    baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1",
    model: "qwen3.6-flash",
    provider: "qwen_dashscope",
  });
  await expect(
    gateway.generate("test", {}, z.object({ value: z.string() })),
  ).resolves.toEqual({ value: "ok" });
  expect(request).toHaveBeenCalledWith(
    "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    expect.objectContaining({ method: "POST" }),
  );
  expect(requestBody).toContain('"response_format":{"type":"json_object"}');
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
