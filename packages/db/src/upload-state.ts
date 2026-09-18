import type {
  ScriptPage,
  WorkspaceData,
  WorkspaceSnapshot,
} from "@deck-rehearsal/contracts";

/** Local persistence extension; shared analysis contracts remain owned by task 02. */
export interface TargetValue {
  suggestion?: string;
  confirmed?: string;
  updatedAt: string;
}
export interface UploadFailure {
  code: string;
  message: string;
  retryable: boolean;
  recovery: "retry" | "upload" | "configure" | "refresh";
}
export interface UploadState {
  stage:
    | "waiting_upload"
    | "uploading"
    | "parsing"
    | "ready"
    | "queued"
    | "rendering"
    | "analyzing"
    | "generating_review"
    | "completed"
    | "failed"
    | "cancelled";
  goal: TargetValue;
  response: TargetValue;
  revision: number;
  attempt: number;
  analysisRequested: boolean;
  updatedAt: string;
  error?: UploadFailure;
  uploadKey?: string;
}
export interface LocalWorkspaceData extends WorkspaceData {
  schemaVersion?: 2;
  uploadStates: Record<string, UploadState>;
  scriptGenerations?: Record<
    string,
    ScriptGeneration & {
      pages: ScriptPage[];
      token?: string;
      leaseUntil?: number;
    }
  >;
}
export interface ScriptGeneration {
  projectId: string;
  deckVersionId: string;
  state: "queued" | "generating" | "completed" | "failed";
  processedSlides: number;
  totalSlides: number;
  error?: string;
}
export type UploadSnapshot = WorkspaceSnapshot & {
  uploadState: UploadState;
  scriptGeneration?: ScriptGeneration;
};
export function newUploadState(): UploadState {
  const updatedAt = new Date().toISOString();
  return {
    stage: "waiting_upload",
    goal: { updatedAt },
    response: { updatedAt },
    revision: 0,
    attempt: 0,
    analysisRequested: false,
    updatedAt,
  };
}
