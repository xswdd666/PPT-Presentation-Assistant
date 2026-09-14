import type {
  DeckContext,
  ReviewComment,
  ReviewerRole,
  Slide,
  TextSelection,
} from "./types.js";
import type {
  GenerationState,
  ReviewThread,
  ReviewThreadInput,
  ScriptDocument,
  SelectionRewrite,
} from "./review.js";
import type { RewriteModelInput, RewriteModelOutput } from "./ports.js";

export const AI_CONTRACT_VERSION = "1.0.0" as const;
export type AnalysisDimension =
  "structure" | "narrative" | "evidence" | "visual" | "scenario_fit";
export interface AiFailure {
  code:
    | "invalid_input"
    | "invalid_output"
    | "timeout"
    | "rate_limited"
    | "model_unavailable"
    | "not_configured"
    | "version_conflict"
    | "thread_busy"
    | "idempotency_conflict"
    | "not_found";
  message: string;
  retryable: boolean;
  recovery: "retry" | "refresh" | "configure" | "correct_input";
}
export interface PageAnalysis {
  slideId: string;
  summary: string;
  findings: {
    dimension: AnalysisDimension;
    rootCause: string;
    evidence: string;
    suggestedAction: string;
  }[];
}
export interface AnalysisOutput {
  goal: string;
  expectedAudienceResponse: string;
  narrativeSummary: string;
  reviewers: { id: ReviewerRole; reason: string }[];
  comments: {
    reviewerId: string;
    slideId: string;
    body: string;
    evidence: string;
    impact: string;
    suggestedAction: string;
    rootCause?: string;
  }[];
}
export interface AnalysisSnapshot {
  context: DeckContext;
  /** Ordered by current slide index; stable IDs survive reordering. */
  slides: Slide[];
  documents: Record<string, ScriptDocument>;
}
export interface ScriptRewriteModelInput {
  selection: TextSelection;
  scriptRevision: number;
  context: DeckContext;
  currentSlide: Slide;
  currentScript: ScriptDocument;
  previousScript?: ScriptDocument;
  nextScript?: ScriptDocument;
}
export interface ReviewAnalysisModel {
  analyzePage(input: { slide: Slide }): Promise<PageAnalysis>;
  synthesize(input: {
    context: DeckContext;
    pages: PageAnalysis[];
    slides: Slide[];
    reviewers: ReviewerRole[];
  }): Promise<AnalysisOutput>;
  reply(input: ReviewThreadInput): Promise<{ body: string }>;
  rewrite(input: RewriteModelInput): Promise<RewriteModelOutput>;
  rewriteScript(input: ScriptRewriteModelInput): Promise<RewriteModelOutput>;
}
export interface AnalysisRun {
  context: DeckContext;
  pages: PageAnalysis[];
  comments: ReviewComment[];
  reviewers: AnalysisOutput["reviewers"];
  reusedSlideIds: string[];
  failedSlides: { slideId: string; error: AiFailure }[];
}
export interface ReplyRequest {
  projectId: string;
  commentId: string;
  body: string;
  deckVersionId: string;
  idempotencyKey: string;
}
export interface ReplyGeneration {
  id: string;
  projectId: string;
  commentId: string;
  deckVersionId: string;
  state: GenerationState;
  error?: AiFailure;
}
export interface AsyncReviewGateway {
  /** Ascending createdAt then id, no business-status filters. */
  listComments(projectId: string): Promise<ReviewComment[]>;
  getThread(projectId: string, commentId: string): Promise<ReviewThread>;
  /** Atomically appends the user reply and queues AI generation. */
  submitReply(input: ReplyRequest): Promise<ReplyGeneration>;
  getReplyResult(
    projectId: string,
    generationId: string,
  ): Promise<{ generation: ReplyGeneration; thread: ReviewThread }>;
  retryReply(projectId: string, generationId: string): Promise<ReplyGeneration>;
}
export type LocalRewriteRequest = {
  projectId: string;
  selection: TextSelection;
} & ({ target: "ppt" } | { target: "script"; scriptRevision: number });
export interface VersionedRewrite extends SelectionRewrite {
  originalText: string;
  basisVersionId: string;
  basis: string;
  factsPreserved: boolean;
  confidence: number;
}
/** Offsets in selections, marks and annotations are UTF-16, end-exclusive.
 * ScriptDocument.text is the canonical text segment. Formatting/annotations are
 * separate ranges. Proposal generation never modifies these ranges or text.
 * Accepting a proposal must compare basisVersionId, originalText and scriptRevision.
 * Thread replies are append-ordered, with commentId as their parent comment.
 */
export interface AiSnapshotReader {
  getSnapshot(projectId: string): Promise<AnalysisSnapshot>;
}
