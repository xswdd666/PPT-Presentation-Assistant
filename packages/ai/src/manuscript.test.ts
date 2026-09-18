import { afterEach, expect, it, vi } from "vitest";
import { scriptSchema } from "./schemas.js";
import { ReviewModelGateway } from "./gateway.js";
import { fixture } from "./testing.js";
afterEach(() => vi.unstubAllGlobals());
const page = {
  slideId: "s1",
  purpose: "开场",
  keyMessage: "汇报目标",
  speakingOrder: ["主题", "目标"],
  narration: "大家好，今天汇报项目进展。先看整体情况。",
  transitionIn: "",
  transitionOut: null,
  durationSeconds: 30,
  optionalContent: [],
  likelyQuestions: [],
};
it("accepts absent transition metadata while still requiring complete narration", () => {
  expect(
    scriptSchema.safeParse({ pages: [page], compressionAdvice: "" }).success,
  ).toBe(true);
  expect(
    scriptSchema.safeParse({ pages: [{ ...page, narration: "" }] }).success,
  ).toBe(false);
  expect(
    scriptSchema.safeParse({
      pages: [{ ...page, narration: "字".repeat(801) }],
    }).success,
  ).toBe(false);
});
it("sends the entire deck and previous narration while validating only the requested batch", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ pages: [page] }) } },
          ],
        }),
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", transport);
  const model = new ReviewModelGateway({
    apiKey: "fixture",
    baseUrl: "https://unused.invalid",
    model: "fixture",
  });
  const input = fixture(5);
  const result = await model.createScript({
    context: input.context,
    slides: input.slides,
    targetSlideIds: ["s1"],
    previousNarration: "前页已写好的衔接",
    style: "natural",
  });
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0]?.transitionIn).toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(1);
  const body = transport.mock.calls[0]?.[1]?.body;
  expect(body).toContain("页面5的结论");
  expect(body).toContain("前页已写好的衔接");
  expect(body).toContain("完整口语稿");
});
