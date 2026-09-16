import type {
  AnalysisJob,
  ChangeSet,
  DeckContext,
  DeckVersion,
  Project,
  ReviewComment,
  ReviewIssue,
  RewriteProposal,
  Script,
  ScriptDocument,
  ReviewThread,
  SelectionRewrite,
  Slide,
  SourceFile,
  LayoutWarning,
} from "./index.js";
export interface WorkspaceData {
  projects: Record<string, Project>;
  sources: Record<string, SourceFile>;
  versions: Record<string, DeckVersion>;
  slides: Record<string, Slide[]>;
  contexts: Record<string, DeckContext>;
  jobs: Record<string, AnalysisJob>;
  issues: Record<string, ReviewIssue>;
  comments: Record<string, ReviewComment>;
  rewrites: Record<string, RewriteProposal>;
  changeSets: Record<string, ChangeSet>;
  scripts: Record<string, Script>;
  documents: Record<string, Record<string, ScriptDocument>>;
  threads: Record<string, ReviewThread>;
  suggestions: Record<string, SelectionRewrite>;
  warnings: Record<string, LayoutWarning[]>;
  requests: Record<string, { fingerprint: string; result: unknown }>;
  routes: Record<string, { id: string; reason: string }[]>;
}
export interface WorkspaceSnapshot {
  project: Project;
  version?: DeckVersion;
  versions: DeckVersion[];
  /** Unsubmitted PPT edits; slides in this snapshot include its preview. */
  draft?: ChangeSet;
  slides: Slide[];
  context?: DeckContext;
  job?: AnalysisJob;
  comments: ReviewComment[];
  documents: Record<string, ScriptDocument>;
  warnings: LayoutWarning[];
  reviewers: { id: string; reason: string }[];
}
