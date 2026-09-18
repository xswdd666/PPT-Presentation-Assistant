import type {
  AnalysisJob,
  ChangeOperation,
  ChangeSet,
  DeckContext,
  DeckVersion,
  DeckVersionId,
  IsoDateTime,
  JobId,
  LayoutWarning,
  Project,
  ProjectId,
  ReviewComment,
  ReviewIssue,
  RewriteProposal,
  Script,
  ScriptPage,
  ScriptStyle,
  Slide,
  SourceFile,
  SourceFileId,
  TextSelection,
} from "./types.js";

export interface ParsedDeck {
  slides: Slide[];
  pageCount: number;
}

export interface PptxProcessor {
  parse(file: Uint8Array, versionId: DeckVersionId): Promise<ParsedDeck>;
  applyChanges(
    file: Uint8Array,
    changes: ChangeOperation[],
  ): Promise<Uint8Array>;
}

export interface SlideRenderer {
  render(slide: Slide): Promise<Uint8Array>;
}

export interface LayoutInspector {
  inspect(before: Slide, after: Slide): Promise<LayoutWarning[]>;
}

export interface RewriteModelInput {
  selection: TextSelection;
  elementText: string;
  currentSlide: Slide;
  previousSlide?: Slide;
  nextSlide?: Slide;
  context: DeckContext;
}

export interface RewriteModelOutput {
  replacementText: string;
  rationale: string;
  factsPreserved: boolean;
  confidence: number;
}

export interface ModelGateway {
  rewrite(input: RewriteModelInput): Promise<RewriteModelOutput>;
  createScript(input: {
    context: DeckContext;
    slides: Slide[];
    style: ScriptStyle;
    /** Full deck stays in slides; only these pages are emitted in this batch. */
    targetSlideIds?: string[];
    previousNarration?: string;
  }): Promise<{ pages: ScriptPage[]; compressionAdvice?: string }>;
}

export interface ObjectStorage {
  put(key: string, content: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  createSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

export interface JobQueue {
  enqueue(name: string, payload: unknown): Promise<JobId>;
}

export interface Clock {
  now(): IsoDateTime;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface WorkflowRepository {
  saveProject(project: Project): Promise<void>;
  getProject(projectId: ProjectId): Promise<Project | undefined>;
  saveSourceFile(sourceFile: SourceFile): Promise<void>;
  getSourceFile(sourceFileId: SourceFileId): Promise<SourceFile | undefined>;
  saveVersion(version: DeckVersion): Promise<void>;
  getVersion(versionId: DeckVersionId): Promise<DeckVersion | undefined>;
  listVersions(projectId: ProjectId): Promise<DeckVersion[]>;
  saveSlides(versionId: DeckVersionId, slides: Slide[]): Promise<void>;
  getSlides(versionId: DeckVersionId): Promise<Slide[]>;
  saveContext(context: DeckContext): Promise<void>;
  getContext(versionId: DeckVersionId): Promise<DeckContext | undefined>;
  saveAnalysisJob(job: AnalysisJob): Promise<void>;
  saveIssue(issue: ReviewIssue): Promise<void>;
  saveComment(comment: ReviewComment): Promise<void>;
  saveRewrite(proposal: RewriteProposal): Promise<void>;
  getRewrite(id: string): Promise<RewriteProposal | undefined>;
  saveChangeSet(changeSet: ChangeSet): Promise<void>;
  getChangeSet(projectId: ProjectId): Promise<ChangeSet | undefined>;
  saveScript(script: Script): Promise<void>;
}
