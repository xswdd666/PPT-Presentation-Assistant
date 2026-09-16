import type { PageAnalysis } from "./ai.js";
import type {
  DeckContext,
  ReviewComment,
  Slide,
  TextSelection,
} from "./types.js";
export type GenerationState = "queued" | "generating" | "completed" | "failed";
export interface ReviewReply {
  id: string;
  commentId: string;
  author: "user" | "reviewer";
  reviewerId: string;
  body: string;
  deckVersionId: string;
  createdAt: string;
  basis: string;
}
export interface ReviewThread {
  comment: ReviewComment;
  replies: ReviewReply[];
  generation: GenerationState;
  error?: string;
}
export interface ReviewThreadInput {
  thread: ReviewThread;
  /** All messages in this reviewer's isolated project-version conversation. */
  reviewerComments: ReviewComment[];
  reviewerReplies: ReviewReply[];
  pageAnalyses?: PageAnalysis[];
  context: DeckContext;
  slides: Slide[];
}
export interface ScriptMark {
  start: number;
  end: number;
  kind: "bold" | "underline" | "color" | "highlight";
  value?: string;
}
export interface ScriptAnnotation {
  id: string;
  start: number;
  end: number;
  text: string;
  author: string;
  createdAt: string;
  invalid?: boolean;
}
export interface ScriptDocument {
  slideId: string;
  revision: number;
  text: string;
  marks: ScriptMark[];
  annotations: ScriptAnnotation[];
  updatedAt: string;
}
export interface SelectionRewrite {
  id: string;
  target: "ppt" | "script";
  selection: TextSelection;
  scriptRevision?: number;
  replacementText: string;
  rationale: string;
  diff: { type: "equal" | "delete" | "insert"; text: string }[];
}
export interface ReviewGateway {
  listComments(projectId: string): Promise<ReviewComment[]>;
  getThread(projectId: string, commentId: string): Promise<ReviewThread>;
  reply(input: {
    projectId: string;
    commentId: string;
    body: string;
    deckVersionId: string;
    idempotencyKey: string;
  }): Promise<ReviewThread>;
}
