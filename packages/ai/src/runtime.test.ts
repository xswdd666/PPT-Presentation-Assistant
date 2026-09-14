import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  AnalysisPipeline,
  MemoryAnalysisCache,
  clusterComments,
  routeReviewers,
  validateAnalysis,
} from "./pipeline.js";
import { commentBodySchema, OUTPUT_JSON_SCHEMAS, fail } from "./schemas.js";
import { ReviewModelGateway } from "./gateway.js";
import { LocalRewriteService, textDiff } from "./rewrites.js";
import {
  fixture,
  MockReviewModel,
  validBody,
  requireValue,
} from "./testing.js";
afterEach(() => vi.unstubAllGlobals());
describe("analysis workflow", () => {
  it.each([
    "work_report",
    "performance_review",
    "proposal_presentation",
    "solution_review",
    "product_launch",
  ] as const)("routes %s and emits valid bound comments", async (scenario) => {
    const snapshot = fixture();
    snapshot.context.scenario = scenario;
    const result = await new AnalysisPipeline(new MockReviewModel()).run(
      snapshot,
    );
    expect(result.reviewers.map((r) => r.id)).toEqual(routeReviewers(scenario));
    expect(result.reviewers.length).toBeGreaterThanOrEqual(3);
    expect(result.reviewers.length).toBeLessThanOrEqual(4);
    expect(result.context.goal?.source).toBe("ai_suggested");
    expect(result.context.expectedAudienceResponse?.source).toBe(
      "ai_suggested",
    );
    for (const c of result.comments) {
      expect(commentBodySchema.safeParse(c.body).success).toBe(true);
      expect(snapshot.slides.map((s) => s.id)).toContain(c.relatedSlideIds[0]);
    }
  });
  it("reuses 59/60 pages on edit and all 60 on reordering; preserves user targets", async () => {
    const model = new MockReviewModel(),
      cache = new MemoryAnalysisCache(),
      pipeline = new AnalysisPipeline(model, cache),
      snapshot = fixture(60);
    await pipeline.run(snapshot);
    requireValue(requireValue(snapshot.slides[5]).elements[0]).text =
      "修改后的证据";
    snapshot.context.goal = {
      value: "用户明确的目标",
      source: "user_confirmed",
    };
    snapshot.context.expectedAudienceResponse = {
      value: "用户选择",
      source: "user_input",
    };
    const edit = await pipeline.run(snapshot);
    expect(edit.reusedSlideIds).toHaveLength(59);
    expect(model.analyzed).toHaveLength(61);
    expect(edit.context.goal).toEqual(snapshot.context.goal);
    expect(edit.context.expectedAudienceResponse).toEqual(
      snapshot.context.expectedAudienceResponse,
    );
    snapshot.context.deckVersionId = "v2";
    snapshot.slides.reverse().forEach((s, i) => {
      s.index = i;
      s.deckVersionId = "v2";
    });
    const reorder = await pipeline.run(snapshot);
    expect(reorder.reusedSlideIds).toHaveLength(60);
    expect(reorder.context.narrativeSummary?.startsWith("s60")).toBe(true);
    snapshot.context.projectId = "p2";
    expect((await pipeline.run(snapshot)).reusedSlideIds).toHaveLength(0);
  });
  it("isolates page failures and recovers just that page", async () => {
    const model = new MockReviewModel(),
      original = model.analyzePage.bind(model);
    let broken = true;
    model.analyzePage = async (input) => {
      if (input.slide.id === "s2" && broken) fail("timeout", "超时");
      return original(input);
    };
    const pipeline = new AnalysisPipeline(model),
      first = await pipeline.run(fixture());
    expect(first.failedSlides[0]?.error.code).toBe("timeout");
    broken = false;
    const second = await pipeline.run(fixture());
    expect(second.failedSlides).toEqual([]);
    expect(second.reusedSlideIds).toHaveLength(2);
  });
  it("clusters same page/root/action and preserves distinct actions", async () => {
    const raw = await new MockReviewModel().synthesize({
      context: fixture().context,
      pages: [],
      slides: fixture().slides,
      reviewers: ["jack", "olivia", "leo"],
    });
    const a = requireValue(raw.comments[0]);
    const grouped = clusterComments([
      a,
      { ...a, reviewerId: "olivia" },
      { ...a, suggestedAction: "提供对照组" },
    ]);
    expect(grouped).toHaveLength(2);
    expect(() =>
      validateAnalysis(
        { ...raw, comments: [{ ...a, slideId: "missing" }] },
        fixture().slides,
      ),
    ).toThrow();
  });
});
describe("schemas and transport", () => {
  it("exports serializable JSON schemas and enforces grapheme length", () => {
    expect(
      (
        JSON.parse(JSON.stringify(OUTPUT_JSON_SCHEMAS)) as Record<
          string,
          { type: string }
        >
      ).analysis?.type,
    ).toBe("object");
    expect(commentBodySchema.safeParse("中".repeat(49)).success).toBe(false);
    expect(commentBodySchema.safeParse("中".repeat(50)).success).toBe(true);
    expect(commentBodySchema.safeParse("中".repeat(101)).success).toBe(false);
    expect(commentBodySchema.safeParse("👨‍👩‍👧‍👦".repeat(50)).success).toBe(true);
    expect(commentBodySchema.parse(validBody)).toBe(validBody);
  });
  it.each(["timeout", "rate", "json", "schema", "reference", "network"])(
    "retries %s then succeeds",
    async (failure) => {
      const good = () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"value":"ok"}' } }],
          }),
        );
      const request = vi
        .fn()
        .mockImplementationOnce(() => {
          if (failure === "timeout")
            return Promise.reject(
              new DOMException("secret body", "TimeoutError"),
            );
          if (failure === "network")
            return Promise.reject(new TypeError("network secret"));
          if (failure === "rate")
            return Promise.resolve(new Response("", { status: 429 }));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content:
                        failure === "json"
                          ? "bad"
                          : failure === "schema"
                            ? "{}"
                            : '{"value":"wrong"}',
                    },
                  },
                ],
              }),
            ),
          );
        })
        .mockImplementation(good);
      vi.stubGlobal("fetch", request);
      const gateway = new ReviewModelGateway({
        apiKey: "test-key",
        baseUrl: "https://test.invalid",
        model: "test",
        retryDelayMs: 0,
      });
      const result = await gateway.generate(
        "test",
        {},
        z.object({ value: z.string() }),
        (r) => {
          if (r.value !== "ok") fail("invalid_output", "引用无效");
        },
      );
      expect(result.value).toBe("ok");
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it("returns sanitized structured failure after bounded retries", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new TypeError("secret-key and PPT full text"));
    vi.stubGlobal("fetch", request);
    const gateway = new ReviewModelGateway({
      apiKey: "test-key",
      baseUrl: "https://test.invalid",
      model: "test",
      retryDelayMs: 0,
    });
    await expect(
      gateway.generate("test", {}, z.object({})),
    ).rejects.toMatchObject({
      failure: { code: "model_unavailable", retryable: true },
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("does not retry configuration/auth errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", request);
    await expect(
      new ReviewModelGateway({
        apiKey: "test",
        baseUrl: "https://test.invalid",
        model: "test",
        retryDelayMs: 0,
      }).generate("test", {}, z.object({})),
    ).rejects.toMatchObject({
      failure: { code: "not_configured", retryable: false },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
describe("local rewrite proposals", () => {
  it.each(["ppt", "script"] as const)(
    "uses adjacent %s context without mutating documents",
    async (target) => {
      const snapshot = fixture(),
        original = structuredClone(snapshot),
        model = new MockReviewModel();
      const service = new LocalRewriteService(
        { getSnapshot: () => Promise.resolve(structuredClone(snapshot)) },
        model,
      );
      const selectedText = target === "ppt" ? "页面" : "讲稿";
      const proposal = await service.suggest({
        projectId: "p1",
        target,
        scriptRevision: 1,
        selection: {
          deckVersionId: "v1",
          slideId: "s2",
          elementId: "e2",
          startOffset: 0,
          endOffset: 2,
          selectedText,
        },
      });
      expect(proposal.basisVersionId).toBe("v1");
      expect(proposal.originalText).toBe(selectedText);
      expect(snapshot).toEqual(original);
      if (target === "ppt") {
        expect(model.rewrites[0]?.previousSlide?.id).toBe("s1");
        expect(model.rewrites[0]?.nextSlide?.id).toBe("s3");
      } else {
        expect(model.scripts[0]?.previousScript?.slideId).toBe("s1");
        expect(model.scripts[0]?.nextScript?.slideId).toBe("s3");
        expect(model.scripts[0]?.currentScript.marks).toEqual(
          original.documents.s2?.marks,
        );
      }
    },
  );
  it("rejects stale script revision after generation", async () => {
    const snapshot = fixture(),
      model = new MockReviewModel();
    model.rewriteScript = async () => {
      await Promise.resolve();
      requireValue(snapshot.documents.s2).revision++;
      return {
        replacementText: "说明",
        rationale: "简洁",
        factsPreserved: true,
        confidence: 1,
      };
    };
    await expect(
      new LocalRewriteService(
        { getSnapshot: () => Promise.resolve(structuredClone(snapshot)) },
        model,
      ).suggest({
        projectId: "p1",
        target: "script",
        scriptRevision: 1,
        selection: {
          deckVersionId: "v1",
          slideId: "s2",
          elementId: "script",
          startOffset: 0,
          endOffset: 2,
          selectedText: "讲稿",
        },
      }),
    ).rejects.toMatchObject({ failure: { code: "version_conflict" } });
  });
  it("diff reconstructs both inputs and keeps common text", () => {
    const diff = textDiff("我们实现了目标", "我们完成了目标");
    expect(
      diff
        .filter((d) => d.type !== "insert")
        .map((d) => d.text)
        .join(""),
    ).toBe("我们实现了目标");
    expect(
      diff
        .filter((d) => d.type !== "delete")
        .map((d) => d.text)
        .join(""),
    ).toBe("我们完成了目标");
    expect(diff[0]?.type).toBe("equal");
  });
});

it.each(["s1", "s3"])("handles rewrite at boundary %s", async (slideId) => {
  const snapshot = fixture(),
    model = new MockReviewModel();
  await new LocalRewriteService(
    { getSnapshot: () => Promise.resolve(structuredClone(snapshot)) },
    model,
  ).suggest({
    projectId: "p1",
    target: "ppt",
    selection: {
      deckVersionId: "v1",
      slideId,
      elementId: slideId.replace("s", "e"),
      startOffset: 0,
      endOffset: 2,
      selectedText: "页面",
    },
  });
  if (slideId === "s1")
    expect(model.rewrites[0]?.previousSlide).toBeUndefined();
  else expect(model.rewrites[0]?.nextSlide).toBeUndefined();
});
it("flags numeric drift and rejects an invalid selected range", async () => {
  const snapshot = fixture(),
    model = new MockReviewModel();
  requireValue(requireValue(snapshot.slides[0]).elements[0]).text = "增长20%";
  model.rewrite = () =>
    Promise.resolve({
      replacementText: "增长30%",
      rationale: "修改",
      factsPreserved: true,
      confidence: 1,
    });
  const service = new LocalRewriteService(
      { getSnapshot: () => Promise.resolve(structuredClone(snapshot)) },
      model,
    ),
    selection = {
      deckVersionId: "v1",
      slideId: "s1",
      elementId: "e1",
      startOffset: 0,
      endOffset: 5,
      selectedText: "增长20%",
    };
  expect(
    (await service.suggest({ projectId: "p1", target: "ppt", selection }))
      .factsPreserved,
  ).toBe(false);
  await expect(
    service.suggest({
      projectId: "p1",
      target: "ppt",
      selection: { ...selection, startOffset: -1 },
    }),
  ).rejects.toMatchObject({ failure: { code: "version_conflict" } });
});
it("never logs raw deck text or secrets on model errors", async () => {
  const log = vi.spyOn(console, "log"),
    error = vi.spyOn(console, "error");
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("PRIVATE_PPT SECRET_KEY")),
    );
    const gateway = new ReviewModelGateway({
      apiKey: "SECRET_KEY",
      baseUrl: "https://test.invalid",
      model: "test",
      retryDelayMs: 0,
    });
    const failure = await gateway
      .generate("test", { ppt: "PRIVATE_PPT" }, z.object({}))
      .catch((e: unknown) => e);
    expect(String(failure)).not.toMatch(/PRIVATE_PPT|SECRET_KEY/);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
