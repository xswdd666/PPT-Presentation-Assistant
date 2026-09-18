import type {
  AnalysisSnapshot,
  CoachObservation,
  CoachProposal,
  CoachRun,
  CoachToolCall,
  CoachToolContext,
  CoachToolRegistry,
  PageAnalysis,
  ReviewComment,
  TextSelection,
  VersionedRewrite,
} from "@deck-rehearsal/contracts";

export interface CoachToolSource {
  snapshot(projectId: string): Promise<AnalysisSnapshot>;
  analyses(projectId: string, versionId: string): Promise<PageAnalysis[]>;
  reviews(projectId: string, versionId: string): Promise<ReviewComment[]>;
  askReviewer(input: {
    projectId: string;
    versionId: string;
    reviewerId: string;
    question: string;
    relatedSlideIds: string[];
  }): Promise<string>;
  propose(input: {
    projectId: string;
    target: "ppt" | "script";
    selection: TextSelection;
    scriptRevision?: number;
    instruction: string;
  }): Promise<VersionedRewrite>;
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("工具输入无效");
  return value as Record<string, unknown>;
};
const string = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} 无效`);
  return value.trim();
};
const clipped = (value: string, max = 500) =>
  value.length > max ? `${value.slice(0, max)}…` : value;
const words = (value: string) =>
  value.trim()
    ? value
        .trim()
        .split(/\s+|(?=[\u3400-\u9fff])/u)
        .filter(Boolean).length
    : 0;

export class DefaultCoachToolRegistry implements CoachToolRegistry {
  constructor(private readonly source: CoachToolSource) {}
  async execute(
    call: CoachToolCall,
    context: CoachToolContext,
  ): Promise<CoachObservation> {
    const input = record(call.input);
    const run = context.run;
    const snapshot = await this.source.snapshot(run.projectId);
    if (snapshot.context.deckVersionId !== run.baseVersionId)
      throw new Error("版本已变化");
    if (call.tool === "inspect_deck")
      return this.inspectDeck(snapshot, input.includeScripts === true);
    if (call.tool === "inspect_slide")
      return this.inspectSlide(run, snapshot, input);
    if (call.tool === "summarize_reviews") return this.summarize(run, input);
    if (call.tool === "check_narrative")
      return this.checkNarrative(snapshot, input);
    if (call.tool === "ask_reviewer") {
      const reviewerId = string(input.reviewerId, "reviewerId");
      const question = clipped(string(input.question, "question"), 500);
      const relatedSlideIds = Array.isArray(input.relatedSlideIds)
        ? input.relatedSlideIds.map((id) => string(id, "slideId"))
        : [];
      if (
        relatedSlideIds.some(
          (id) => !snapshot.slides.some((slide) => slide.id === id),
        )
      )
        throw new Error("追问页面不存在");
      const answer = clipped(
        await this.source.askReviewer({
          projectId: run.projectId,
          versionId: run.baseVersionId,
          reviewerId,
          question,
          relatedSlideIds,
        }),
        100,
      );
      return {
        kind: "reviewer_answer",
        summary: answer,
        slideIds: relatedSlideIds,
        data: { reviewerId, answer },
      };
    }
    return this.propose(run, snapshot, call.tool, input);
  }
  private inspectDeck(
    snapshot: AnalysisSnapshot,
    includeScripts: boolean,
  ): CoachObservation {
    const ordered = [...snapshot.slides].sort((a, b) => a.index - b.index);
    const pages = ordered.map((slide) => {
      const script = snapshot.documents[slide.id]?.text ?? "";
      return {
        slideId: slide.id,
        page: slide.index + 1,
        title: clipped(
          slide.elements.find((e) => e.kind === "title")?.text ??
            slide.elements.map((e) => e.text ?? "").find(Boolean) ??
            "未命名页面",
          120,
        ),
        summary: clipped(slide.visualSummary ?? "", 160),
        scriptWords: words(script),
        ...(includeScripts ? { script: clipped(script, 240) } : {}),
      };
    });
    const totalWords = pages.reduce((sum, page) => sum + page.scriptWords, 0);
    return {
      kind: "deck",
      summary: `${String(pages.length)} 页，讲稿约 ${String(totalWords)} 字，预计 ${String(Math.max(1, Math.ceil(totalWords / 240)))} 分钟`,
      slideIds: pages.map((page) => page.slideId),
      data: {
        context: {
          topic: snapshot.context.topic,
          audience: snapshot.context.audience,
          durationMinutes: snapshot.context.durationMinutes,
          goal: snapshot.context.goal?.value,
          expectedAudienceResponse:
            snapshot.context.expectedAudienceResponse?.value,
        },
        pages,
      },
    };
  }
  private async inspectSlide(
    run: CoachRun,
    snapshot: AnalysisSnapshot,
    input: Record<string, unknown>,
  ): Promise<CoachObservation> {
    const slideId = string(input.slideId, "slideId");
    const slide = snapshot.slides.find(
      (item) => item.id === slideId && item.deckVersionId === run.baseVersionId,
    );
    if (!slide) throw new Error("页面不属于当前版本");
    const [analyses, reviews] = await Promise.all([
      this.source.analyses(run.projectId, run.baseVersionId),
      this.source.reviews(run.projectId, run.baseVersionId),
    ]);
    const text = slide.elements
      .map((element) => element.text ?? "")
      .filter(Boolean)
      .join("\n");
    return {
      kind: "slide",
      summary: `第 ${String(slide.index + 1)} 页：${clipped(text || "无可提取文字", 180)}`,
      slideIds: [slide.id],
      data: {
        page: slide.index + 1,
        text: clipped(text, 800),
        notes: clipped(slide.notes ?? "", 300),
        script: clipped(snapshot.documents[slide.id]?.text ?? "", 500),
        analysis: analyses.find((page) => page.slideId === slide.id),
        reviews: reviews
          .filter((review) => review.relatedSlideIds.includes(slide.id))
          .map((review) => ({
            reviewerId: review.reviewerId,
            body: clipped(review.body, 100),
            evidence: clipped(review.evidence, 180),
          })),
      },
    };
  }
  private async summarize(
    run: CoachRun,
    input: Record<string, unknown>,
  ): Promise<CoachObservation> {
    const requested = Array.isArray(input.dimensions)
      ? new Set(input.dimensions.map(String))
      : undefined;
    const reviews = (
      await this.source.reviews(run.projectId, run.baseVersionId)
    ).filter(
      (review) =>
        !requested ||
        requested.has(review.headline) ||
        requested.has(review.issueId),
    );
    const groups = new Map<string, ReviewComment[]>();
    for (const review of reviews) {
      const key = review.headline.trim() || "其他";
      groups.set(key, [...(groups.get(key) ?? []), review]);
    }
    const clusters = [...groups].map(([rootCause, items]) => ({
      rootCause,
      reviewers: [...new Set(items.map((item) => item.reviewerId))],
      slideIds: [...new Set(items.flatMap((item) => item.relatedSlideIds))],
      evidence: items.map((item) => clipped(item.evidence, 120)).slice(0, 3),
    }));
    return {
      kind: "review_summary",
      summary: `聚合 ${String(reviews.length)} 条意见为 ${String(clusters.length)} 个根因`,
      slideIds: [
        ...new Set(reviews.flatMap((review) => review.relatedSlideIds)),
      ],
      data: { clusters },
    };
  }
  private checkNarrative(
    snapshot: AnalysisSnapshot,
    input: Record<string, unknown>,
  ): CoachObservation {
    const focus = string(input.focus, "focus");
    if (!["structure", "duration", "transitions", "evidence"].includes(focus))
      throw new Error("focus 无效");
    const issues: {
      problem: string;
      slideIds: string[];
      evidence: string;
      severity: "low" | "medium" | "high";
    }[] = [];
    const scripts = snapshot.slides.map((slide) => ({
      slide,
      text: snapshot.documents[slide.id]?.text ?? "",
    }));
    if (focus === "duration") {
      const count = scripts.reduce((sum, item) => sum + words(item.text), 0),
        minutes = count / 240;
      if (minutes > snapshot.context.durationMinutes * 1.1)
        issues.push({
          problem: "讲稿可能超时",
          slideIds: scripts
            .sort((a, b) => words(b.text) - words(a.text))
            .slice(0, 3)
            .map((item) => item.slide.id),
          evidence: `约 ${String(Math.ceil(minutes))} 分钟，目标 ${String(snapshot.context.durationMinutes)} 分钟`,
          severity: "high",
        });
    }
    for (const item of scripts.filter((item) => !item.text.trim()))
      issues.push({
        problem: "页面缺少讲稿",
        slideIds: [item.slide.id],
        evidence: `第 ${String(item.slide.index + 1)} 页讲稿为空`,
        severity: "medium",
      });
    if (focus === "evidence")
      for (const item of snapshot.slides.filter(
        (slide) =>
          slide.purpose === "evidence" &&
          !slide.elements.some((element) => /\d/.test(element.text ?? "")),
      ))
        issues.push({
          problem: "证据页缺少可提取数字",
          slideIds: [item.id],
          evidence: `第 ${String(item.index + 1)} 页未提取到数字`,
          severity: "medium",
        });
    return {
      kind: "narrative_check",
      summary: issues.length
        ? `发现 ${String(issues.length)} 个${focus}问题`
        : `未发现明确的${focus}问题`,
      slideIds: [...new Set(issues.flatMap((issue) => issue.slideIds))],
      data: { focus, issues },
    };
  }
  private async propose(
    run: CoachRun,
    snapshot: AnalysisSnapshot,
    tool: "propose_ppt_rewrite" | "propose_script_rewrite",
    input: Record<string, unknown>,
  ): Promise<CoachObservation> {
    const instruction = string(input.instruction, "instruction");
    const selection = record(input.selection) as unknown as TextSelection;
    if (
      !selection.slideId ||
      selection.deckVersionId !== run.baseVersionId ||
      !snapshot.slides.some((slide) => slide.id === selection.slideId)
    ) {
      const proposal: CoachProposal = {
        id: `coach_proposal_${callSafeId()}`,
        target: "manual_action",
        title: "请手动定位改写位置",
        instruction,
        evidenceSlideIds: selection.slideId ? [selection.slideId] : [],
        expectedBenefit: "明确选区后可生成可审批的精确修改",
        state: "pending",
      };
      return {
        kind: "proposal",
        summary: proposal.title,
        slideIds: proposal.evidenceSlideIds,
        proposalId: proposal.id,
        data: { proposal },
      };
    }
    const target = tool === "propose_ppt_rewrite" ? "ppt" : "script";
    const scriptRevision =
      target === "script" ? Number(input.scriptRevision) : undefined;
    if (
      target === "script" &&
      (!Number.isInteger(scriptRevision) || (scriptRevision ?? -1) < 0)
    )
      throw new Error("scriptRevision 无效");
    const revision = scriptRevision as number;
    const rewrite = await this.source.propose({
      projectId: run.projectId,
      target,
      selection,
      ...(target === "script" ? { scriptRevision: revision } : {}),
      instruction,
    });
    const proposal: CoachProposal = {
      id: `coach_proposal_${callSafeId()}`,
      suggestionId: rewrite.id,
      target,
      title: target === "ppt" ? "PPT 文字改写" : "讲稿改写",
      instruction,
      evidenceSlideIds: [selection.slideId],
      expectedBenefit: rewrite.rationale,
      state: "pending",
      selection,
      ...(target === "script" ? { scriptRevision: revision } : {}),
    };
    return {
      kind: "proposal",
      summary: `${proposal.title}：${clipped(rewrite.rationale, 160)}`,
      slideIds: proposal.evidenceSlideIds,
      proposalId: proposal.id,
      data: {
        proposal,
        diff: rewrite.diff,
        originalText: rewrite.originalText,
        replacementText: rewrite.replacementText,
      },
    };
  }
}
function callSafeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
