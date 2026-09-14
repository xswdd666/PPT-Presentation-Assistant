import { createHash, randomUUID } from "node:crypto";
import type {
  AnalysisOutput,
  AnalysisRun,
  AnalysisSnapshot,
  DeckContext,
  PageAnalysis,
  ReviewAnalysisModel,
  ReviewerRole,
  Scenario,
  Slide,
} from "@deck-rehearsal/contracts";
import {
  AiError,
  analysisSchema,
  pageAnalysisSchema,
  fail,
  safeFailure,
  SCHEMA_VERSION,
  PROMPT_VERSION,
  normalized,
} from "./schemas.js";
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function routeReviewers(scenario: Scenario): ReviewerRole[] {
  switch (scenario) {
    case "work_report":
    case "project_report":
      return ["jack", "olivia", "leo"];
    case "performance_review":
      return ["jack", "olivia", "sophie"];
    case "proposal_presentation":
    case "resource_request":
    case "startup_pitch":
      return ["jack", "ryan", "leo", "sophie"];
    case "solution_review":
      return ["olivia", "mia", "leo"];
    case "product_launch":
      return ["ryan", "mia", "emma", "sophie"];
    default:
      return ["olivia", "mia", "sophie"];
  }
}
export function checkSnapshot(
  snapshot: AnalysisSnapshot,
  versionId = snapshot.context.deckVersionId,
) {
  if (snapshot.context.deckVersionId !== versionId)
    fail("version_conflict", "版本已变化，请刷新后重新生成");
  if (
    !snapshot.slides.length ||
    snapshot.slides.length > 60 ||
    new Set(snapshot.slides.map((s) => s.id)).size !== snapshot.slides.length ||
    snapshot.slides.some((s) => s.deckVersionId !== versionId)
  )
    fail("invalid_input", "页面数据缺失、重复或版本不一致");
}
export interface AnalysisCache {
  get(key: string): Promise<PageAnalysis | undefined>;
  set(key: string, value: PageAnalysis): Promise<void>;
}
export class MemoryAnalysisCache implements AnalysisCache {
  private entries = new Map<string, PageAnalysis>();
  get(key: string) {
    return Promise.resolve(structuredClone(this.entries.get(key)));
  }
  set(key: string, value: PageAnalysis) {
    this.entries.set(key, structuredClone(value));
    return Promise.resolve();
  }
}
export function pageCacheKey(
  projectId: string,
  slide: Slide,
  namespace: string,
) {
  // Content, not index/version/storage location. Keep stable ID and tenant isolation.
  const {
    id,
    sourceStableId,
    elements,
    notes,
    visualSummary,
    width,
    height,
    contentHash,
  } = slide;
  return hash({
    projectId,
    namespace,
    SCHEMA_VERSION,
    PROMPT_VERSION,
    id,
    sourceStableId,
    elements,
    notes,
    visualSummary,
    width,
    height,
    contentHash,
  });
}
export function validateAnalysis(
  raw: unknown,
  slides: Slide[],
  roles?: ReviewerRole[],
): AnalysisOutput {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) fail("invalid_output", "模型分析结果不符合 Schema");
  const result = parsed.data;
  const selected = new Set<string>(result.reviewers.map((r) => r.id));
  if (
    selected.size !== result.reviewers.length ||
    (roles &&
      (roles.length !== selected.size ||
        roles.some((r) => !selected.has(r)))) ||
    result.comments.some(
      (c) =>
        !selected.has(c.reviewerId) || !slides.some((s) => s.id === c.slideId),
    )
  )
    fail("invalid_output", "模型返回无效角色或页面引用");
  return {
    ...result,
    comments: result.comments.map(({ rootCause, ...c }) => ({
      ...c,
      ...(rootCause ? { rootCause } : {}),
    })),
  };
}
export function clusterComments(comments: AnalysisOutput["comments"]) {
  const groups = new Map<string, AnalysisOutput["comments"][number]>();
  for (const comment of comments) {
    // Same page, root cause AND remedy. Preserve distinct actions and page references.
    const key = hash([
      comment.slideId,
      normalized(comment.rootCause ?? comment.evidence),
      normalized(comment.suggestedAction),
    ]);
    const existing = groups.get(key);
    if (!existing) groups.set(key, { ...comment });
    else if (!existing.impact.includes(comment.impact))
      existing.impact += `；${comment.impact}`;
  }
  return [...groups.values()];
}
export class AnalysisPipeline {
  constructor(
    private readonly model: ReviewAnalysisModel,
    private readonly cache: AnalysisCache = new MemoryAnalysisCache(),
    private readonly namespace = "default",
    private readonly now = () => new Date().toISOString(),
  ) {}
  async run(
    snapshot: AnalysisSnapshot,
    progress?: (processed: number, total: number) => Promise<void>,
  ): Promise<AnalysisRun> {
    snapshot = structuredClone(snapshot);
    checkSnapshot(snapshot);
    const slides = [...snapshot.slides].sort((a, b) => a.index - b.index);
    const pages: PageAnalysis[] = [],
      reusedSlideIds: string[] = [],
      failedSlides: AnalysisRun["failedSlides"] = [];
    for (const slide of slides) {
      try {
        const key = pageCacheKey(
          snapshot.context.projectId,
          slide,
          this.namespace,
        );
        const cached = await this.cache.get(key);
        const parsed = pageAnalysisSchema.safeParse(
          cached ?? (await this.model.analyzePage({ slide })),
        );
        if (!parsed.success || parsed.data.slideId !== slide.id)
          fail("invalid_output", "单页分析返回无效页面引用");
        pages.push(parsed.data);
        if (cached) reusedSlideIds.push(slide.id);
        else await this.cache.set(key, parsed.data);
      } catch (error) {
        failedSlides.push({ slideId: slide.id, error: safeFailure(error) });
      }
      await progress?.(pages.length + failedSlides.length, slides.length);
    }
    if (!pages.length) {
      const failure = failedSlides[0]?.error;
      if (failure) throw new AiError(failure);
      fail("model_unavailable", "所有页面分析失败，请重试");
    }
    const reviewers = routeReviewers(snapshot.context.scenario);
    const result = validateAnalysis(
      await this.model.synthesize({
        context: snapshot.context,
        pages,
        slides,
        reviewers,
      }),
      slides,
      reviewers,
    );
    const sourced = (current: DeckContext["goal"], suggestion: string) =>
      current?.value.trim()
        ? current
        : { value: suggestion, source: "ai_suggested" as const };
    const context: DeckContext = {
      ...snapshot.context,
      goal: sourced(snapshot.context.goal, result.goal),
      expectedAudienceResponse: sourced(
        snapshot.context.expectedAudienceResponse,
        result.expectedAudienceResponse,
      ),
      narrativeSummary: result.narrativeSummary,
      updatedAt: this.now(),
    };
    return {
      context,
      pages,
      reviewers: result.reviewers,
      reusedSlideIds,
      failedSlides,
      comments: clusterComments(result.comments).map((c, sequence) => ({
        id: `comment_${String(sequence).padStart(3, "0")}_${randomUUID()}`,
        issueId: `issue_${randomUUID()}`,
        reviewerId: c.reviewerId,
        deckVersionId: context.deckVersionId,
        headline: c.rootCause ?? c.suggestedAction,
        body: c.body,
        evidence: c.evidence,
        impact: c.impact,
        suggestedAction: c.suggestedAction,
        confidence: 0.7,
        relatedSlideIds: [c.slideId],
        createdAt: this.now(),
      })),
    };
  }
}
