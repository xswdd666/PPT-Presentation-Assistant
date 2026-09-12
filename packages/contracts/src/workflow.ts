import type {
  AnalysisJob,
  ChangeOperation,
  ChangeSet,
  DeckVersion,
  DeckVersionId,
  JobId,
  Project,
  ProjectId,
  ReviewComment,
  ReviewIssue,
  RewriteProposal,
  Script,
  ScriptStyle,
  Scenario,
  SourceFile,
  SourceFileId,
  TextSelection,
} from "./types.js";

export interface ProjectWorkflow {
  createProject(input: {
    ownerId: string;
    name: string;
    scenario: Scenario;
    customScenario?: string;
    audience: string;
    durationMinutes: number;
    concerns?: string;
  }): Promise<Project>;
  completeUpload(input: {
    projectId: ProjectId;
    originalName: string;
    storageKey: string;
    sizeBytes: number;
  }): Promise<{ sourceFile: SourceFile; version: DeckVersion }>;
  startAnalysis(
    projectId: ProjectId,
  ): Promise<{ job: AnalysisJob; queueJobId: JobId }>;
  addComment(
    input: Omit<ReviewComment, "id" | "issueId" | "createdAt"> & {
      issue: Omit<ReviewIssue, "id" | "createdAt">;
    },
  ): Promise<{ issue: ReviewIssue; comment: ReviewComment }>;
  requestRewrite(input: {
    projectId: ProjectId;
    selection: TextSelection;
  }): Promise<RewriteProposal>;
  acceptRewrite(proposalId: string): Promise<ChangeSet>;
  rejectRewrite(proposalId: string): Promise<RewriteProposal>;
  updateChanges(
    projectId: ProjectId,
    operations: ChangeOperation[],
  ): Promise<ChangeSet>;
  commitVersion(projectId: ProjectId, summary: string): Promise<DeckVersion>;
  generateScript(projectId: ProjectId, style: ScriptStyle): Promise<Script>;
  createDownload(
    projectId: ProjectId,
  ): Promise<{ url: string; expiresInSeconds: number }>;
  markUploadCompleted(sourceFileId: SourceFileId): Promise<SourceFile>;
  getCurrentVersion(projectId: ProjectId): Promise<DeckVersionId>;
}
