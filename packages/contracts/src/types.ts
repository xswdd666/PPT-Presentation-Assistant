export type ProjectId = string;
export type SourceFileId = string;
export type DeckVersionId = string;
export type SlideId = string;
export type SlideElementId = string;
export type ReviewerId = string;
export type ReviewIssueId = string;
export type ReviewCommentId = string;
export type RewriteProposalId = string;
export type ChangeSetId = string;
export type ScriptId = string;
export type JobId = string;
export type IsoDateTime = string;

export const SCENARIOS = [
  "work_report",
  "solution_review",
  "product_launch",
  "project_report",
  "performance_review",
  "resource_request",
  "course_presentation",
  "thesis_defense",
  "academic_talk",
  "research_report",
  "startup_pitch",
  "public_speaking",
  "proposal_presentation",
  "other",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const REVIEWER_ROLES = [
  "jack",
  "emma",
  "ryan",
  "olivia",
  "mia",
  "leo",
  "sophie",
] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

export const ANALYSIS_STAGES = [
  "upload_completed",
  "parsing",
  "rendering",
  "visual_understanding",
  "global_analysis",
  "routing",
  "comment_generation",
  "completed",
  "failed",
] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export type IssueStatus =
  | "open"
  | "accepted"
  | "ignored"
  | "needs_review"
  | "resolved"
  | "persists"
  | "invalid";
export type DeckVersionStatus =
  "processing" | "current" | "superseded" | "failed";
export type RewriteStatus = "proposed" | "accepted" | "rejected" | "failed";
export type ChangeSetStatus = "draft" | "committed" | "abandoned";
export type ScriptStatus =
  "queued" | "generating" | "completed" | "failed" | "stale";
export type TargetSource = "user_input" | "ai_suggested" | "user_confirmed";
export type Severity = "low" | "medium" | "high" | "critical";
export type ScriptStyle = "natural" | "formal" | "student_defense" | "academic";
export type SlidePurpose =
  | "context"
  | "problem"
  | "evidence"
  | "solution"
  | "result"
  | "call_to_action"
  | "transition"
  | "other";

export interface SourcedText {
  value: string;
  source: TargetSource;
}

export interface Project {
  id: ProjectId;
  ownerId: string;
  name: string;
  scenario: Scenario;
  customScenario?: string;
  audience: string;
  durationMinutes: number;
  concerns?: string;
  currentVersionId?: DeckVersionId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface SourceFile {
  id: SourceFileId;
  projectId: ProjectId;
  originalName: string;
  mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  storageKey: string;
  sizeBytes: number;
  status: "uploading" | "uploaded" | "invalid" | "deleted";
  createdAt: IsoDateTime;
}

export interface DeckVersion {
  id: DeckVersionId;
  projectId: ProjectId;
  sourceFileId: SourceFileId;
  parentVersionId?: DeckVersionId;
  versionNumber: number;
  status: DeckVersionStatus;
  storageKey: string;
  changeSummary: string;
  createdAt: IsoDateTime;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideElement {
  id: SlideElementId;
  slideId: SlideId;
  kind: "title" | "body" | "notes" | "image" | "chart" | "other";
  bounds: ElementBounds;
  text?: string;
  editable: boolean;
  contentHash: string;
  readOnlyReason?: string;
  fontSize?: number;
  color?: string;
  bold?: boolean;
}

export interface Slide {
  id: SlideId;
  deckVersionId: DeckVersionId;
  sourceStableId: string;
  width?: number;
  height?: number;
  contentHash?: string;
  index: number;
  hidden: boolean;
  purpose?: SlidePurpose;
  notes?: string;
  visualSummary?: string;
  renderStorageKey?: string;
  elements: SlideElement[];
}

export interface DeckContext {
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  topic: string;
  scenario: Scenario;
  audience: string;
  durationMinutes: number;
  goal?: SourcedText;
  expectedAudienceResponse?: SourcedText;
  narrativeSummary?: string;
  facts: string[];
  updatedAt: IsoDateTime;
}

export interface Reviewer {
  id: ReviewerId;
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  role: ReviewerRole;
  displayName: string;
  aiDisclosure: "AI simulated reviewer";
  rubric: string[];
  routeReason: string;
  relatedSlideIds: SlideId[];
  confidence: number;
  enabled: boolean;
}

export interface ReviewIssue {
  id: ReviewIssueId;
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  title: string;
  rootCause: string;
  severity: Severity;
  status: IssueStatus;
  relatedSlideIds: SlideId[];
  ignoredReason?: string;
  createdAt: IsoDateTime;
}

export interface IssueCluster {
  id: string;
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  rootCause: string;
  issueIds: ReviewIssueId[];
  primaryIssueId: ReviewIssueId;
}

export interface ReviewComment {
  id: ReviewCommentId;
  issueId: ReviewIssueId;
  reviewerId: ReviewerId;
  deckVersionId: DeckVersionId;
  headline: string;
  body: string;
  evidence: string;
  impact: string;
  suggestedAction: string;
  confidence: number;
  relatedSlideIds: SlideId[];
  createdAt: IsoDateTime;
}

export interface TextSelection {
  deckVersionId: DeckVersionId;
  slideId: SlideId;
  elementId: SlideElementId;
  startOffset: number;
  endOffset: number;
  selectedText: string;
}

export interface RewriteProposal {
  id: RewriteProposalId;
  projectId: ProjectId;
  selection: TextSelection;
  replacementText: string;
  rationale: string;
  factsPreserved: boolean;
  confidence: number;
  status: RewriteStatus;
  createdAt: IsoDateTime;
}

export type ChangeOperation =
  | {
      type: "replace_text";
      proposalId?: RewriteProposalId;
      selection: TextSelection;
      replacementText: string;
    }
  | { type: "update_notes"; slideId: SlideId; notes: string }
  | { type: "reorder_slides"; slideIds: SlideId[] }
  | { type: "set_slide_hidden"; slideId: SlideId; hidden: boolean };

export interface ChangeSet {
  id: ChangeSetId;
  projectId: ProjectId;
  baseVersionId: DeckVersionId;
  status: ChangeSetStatus;
  operations: ChangeOperation[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ScriptPage {
  slideId: SlideId;
  purpose: string;
  keyMessage: string;
  speakingOrder: string[];
  narration: string;
  transitionIn?: string;
  transitionOut?: string;
  durationSeconds: number;
  optionalContent: string[];
  likelyQuestions: string[];
}

export interface Script {
  id: ScriptId;
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  style: ScriptStyle;
  status: ScriptStatus;
  pages: ScriptPage[];
  totalDurationSeconds: number;
  compressionAdvice?: string;
  createdAt: IsoDateTime;
}

export interface AnalysisJob {
  id: JobId;
  projectId: ProjectId;
  deckVersionId: DeckVersionId;
  stage: AnalysisStage;
  processedSlides: number;
  totalSlides: number;
  failedSlideIds: SlideId[];
  failureReason?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface LayoutWarning {
  slideId: SlideId;
  kind: "overflow" | "overlap" | "layout_shift";
  elementId?: string;
  pageIndex?: number;
  message: string;
  severity: Severity;
}
