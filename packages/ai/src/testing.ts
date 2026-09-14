import type {
  AnalysisSnapshot,
  ReviewAnalysisModel,
  ReviewComment,
  ReviewThreadInput,
  RewriteModelInput,
  ScriptRewriteModelInput,
} from "@deck-rehearsal/contracts";
export const validBody =
  "本页结论与支撑证据之间还缺少清晰的对应关系，听众难以判断结果是否可靠，建议补充数据来源、统计口径与限制条件，并把证据直接放在对应结论旁边。";
export const validReply =
  "建议先明确这项结论对应的统计范围，再补充数据来源和适用条件，让听众能够核对当前页面中的证据。";
export function fixture(count = 3): AnalysisSnapshot {
  const slides = Array.from({ length: count }, (_, index) => ({
    id: `s${String(index + 1)}`,
    sourceStableId: `stable${String(index + 1)}`,
    deckVersionId: "v1",
    index,
    hidden: false,
    notes: `备注${String(index + 1)}`,
    visualSummary: "标题在上，证据在下",
    elements: [
      {
        id: `e${String(index + 1)}`,
        slideId: `s${String(index + 1)}`,
        kind: "body" as const,
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        text: `页面${String(index + 1)}的结论`,
        editable: true,
        contentHash: `text-${String(index + 1)}`,
      },
    ],
  }));
  return {
    context: {
      projectId: "p1",
      deckVersionId: "v1",
      topic: "季度复盘",
      scenario: "work_report",
      audience: "项目负责人",
      durationMinutes: 10,
      facts: [],
      updatedAt: "2026-09-14T00:00:00Z",
    },
    slides,
    documents: Object.fromEntries(
      slides.map((s) => [
        s.id,
        {
          slideId: s.id,
          revision: 1,
          text: `讲稿${s.id}的结论`,
          marks: [{ start: 0, end: 2, kind: "bold" }],
          annotations: [
            {
              id: "note",
              start: 3,
              end: 5,
              text: "强调此处",
              author: "user",
              createdAt: "2026-09-14T00:00:00Z",
            },
          ],
          updatedAt: "2026-09-14T00:00:00Z",
        },
      ]),
    ),
  };
}
export function comment(): ReviewComment {
  return {
    id: "c1",
    issueId: "i1",
    reviewerId: "olivia",
    deckVersionId: "v1",
    headline: "证据",
    body: validBody,
    evidence: "本页未注明数据来源",
    impact: "听众无法核验",
    suggestedAction: "补充来源",
    confidence: 0.8,
    relatedSlideIds: ["s2"],
    createdAt: "2026-09-14T00:00:00Z",
  };
}
export class MockReviewModel implements ReviewAnalysisModel {
  analyzed: string[] = [];
  replies: ReviewThreadInput[] = [];
  rewrites: RewriteModelInput[] = [];
  scripts: ScriptRewriteModelInput[] = [];
  async analyzePage({
    slide,
  }: Parameters<ReviewAnalysisModel["analyzePage"]>[0]) {
    await Promise.resolve();
    this.analyzed.push(slide.id);
    return {
      slideId: slide.id,
      summary: slide.elements[0]?.text ?? "摘要",
      findings: [
        {
          dimension: "evidence" as const,
          rootCause: "缺少来源",
          evidence: "本页未注明数据来源",
          suggestedAction: "补充来源",
        },
      ],
    };
  }
  async synthesize(input: Parameters<ReviewAnalysisModel["synthesize"]>[0]) {
    await Promise.resolve();
    return {
      goal: "说明季度成果",
      expectedAudienceResponse: "确认下一步计划",
      narrativeSummary: input.slides.map((s) => s.id).join("→"),
      reviewers: input.reviewers.map((id) => ({
        id,
        reason: "对应当前场景风险",
      })),
      comments: input.reviewers.map((reviewerId, index) => ({
        reviewerId,
        slideId: input.slides[index % input.slides.length]?.id ?? "",
        body: validBody,
        evidence: "缺少来源",
        impact: "无法核验",
        suggestedAction: "补充来源",
        rootCause: "证据不足",
      })),
    };
  }
  async reply(input: ReviewThreadInput) {
    await Promise.resolve();
    this.replies.push(structuredClone(input));
    return { body: validReply };
  }
  async rewrite(input: RewriteModelInput) {
    await Promise.resolve();
    this.rewrites.push(structuredClone(input));
    return {
      replacementText: input.selection.selectedText + "（明确）",
      rationale: "突出结论",
      factsPreserved: true,
      confidence: 0.8,
    };
  }
  async rewriteScript(input: ScriptRewriteModelInput) {
    await Promise.resolve();
    this.scripts.push(structuredClone(input));
    return {
      replacementText: input.selection.selectedText + "（强调）",
      rationale: "口语表达",
      factsPreserved: true,
      confidence: 0.8,
    };
  }
}

export function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}
