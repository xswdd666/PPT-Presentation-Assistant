import type {
  AnalysisJob,
  ChangeSet,
  Clock,
  DeckContext,
  DeckVersion,
  DeckVersionId,
  IdGenerator,
  JobId,
  JobQueue,
  ModelGateway,
  ObjectStorage,
  Project,
  ProjectId,
  PptxProcessor,
  ReviewComment,
  ReviewIssue,
  RewriteProposal,
  Script,
  Slide,
  SourceFile,
  SourceFileId,
  WorkflowRepository,
} from "@deck-rehearsal/contracts";

export class InMemoryWorkflowRepository implements WorkflowRepository {
  public readonly projects = new Map<ProjectId, Project>();
  public readonly sourceFiles = new Map<SourceFileId, SourceFile>();
  public readonly versions = new Map<DeckVersionId, DeckVersion>();
  public readonly slides = new Map<DeckVersionId, Slide[]>();
  public readonly contexts = new Map<DeckVersionId, DeckContext>();
  public readonly analysisJobs = new Map<JobId, AnalysisJob>();
  public readonly issues = new Map<string, ReviewIssue>();
  public readonly comments = new Map<string, ReviewComment>();
  public readonly rewrites = new Map<string, RewriteProposal>();
  public readonly changeSets = new Map<ProjectId, ChangeSet>();
  public readonly scripts = new Map<string, Script>();

  public saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(project));
    return Promise.resolve();
  }

  public getProject(projectId: ProjectId): Promise<Project | undefined> {
    return Promise.resolve(this.clone(this.projects.get(projectId)));
  }

  public saveSourceFile(sourceFile: SourceFile): Promise<void> {
    this.sourceFiles.set(sourceFile.id, structuredClone(sourceFile));
    return Promise.resolve();
  }

  public getSourceFile(
    sourceFileId: SourceFileId,
  ): Promise<SourceFile | undefined> {
    return Promise.resolve(this.clone(this.sourceFiles.get(sourceFileId)));
  }

  public saveVersion(version: DeckVersion): Promise<void> {
    this.versions.set(version.id, structuredClone(version));
    return Promise.resolve();
  }

  public getVersion(
    versionId: DeckVersionId,
  ): Promise<DeckVersion | undefined> {
    return Promise.resolve(this.clone(this.versions.get(versionId)));
  }

  public listVersions(projectId: ProjectId): Promise<DeckVersion[]> {
    return Promise.resolve(
      [...this.versions.values()]
        .filter((version) => version.projectId === projectId)
        .sort((left, right) => left.versionNumber - right.versionNumber)
        .map((version) => structuredClone(version)),
    );
  }

  public saveSlides(versionId: DeckVersionId, slides: Slide[]): Promise<void> {
    this.slides.set(versionId, structuredClone(slides));
    return Promise.resolve();
  }

  public getSlides(versionId: DeckVersionId): Promise<Slide[]> {
    return Promise.resolve(structuredClone(this.slides.get(versionId) ?? []));
  }

  public saveContext(context: DeckContext): Promise<void> {
    this.contexts.set(context.deckVersionId, structuredClone(context));
    return Promise.resolve();
  }

  public getContext(
    versionId: DeckVersionId,
  ): Promise<DeckContext | undefined> {
    return Promise.resolve(this.clone(this.contexts.get(versionId)));
  }

  public saveAnalysisJob(job: AnalysisJob): Promise<void> {
    this.analysisJobs.set(job.id, structuredClone(job));
    return Promise.resolve();
  }

  public saveIssue(issue: ReviewIssue): Promise<void> {
    this.issues.set(issue.id, structuredClone(issue));
    return Promise.resolve();
  }

  public saveComment(comment: ReviewComment): Promise<void> {
    this.comments.set(comment.id, structuredClone(comment));
    return Promise.resolve();
  }

  public saveRewrite(proposal: RewriteProposal): Promise<void> {
    this.rewrites.set(proposal.id, structuredClone(proposal));
    return Promise.resolve();
  }

  public getRewrite(id: string): Promise<RewriteProposal | undefined> {
    return Promise.resolve(this.clone(this.rewrites.get(id)));
  }

  public saveChangeSet(changeSet: ChangeSet): Promise<void> {
    this.changeSets.set(changeSet.projectId, structuredClone(changeSet));
    return Promise.resolve();
  }

  public getChangeSet(projectId: ProjectId): Promise<ChangeSet | undefined> {
    return Promise.resolve(this.clone(this.changeSets.get(projectId)));
  }

  public saveScript(script: Script): Promise<void> {
    this.scripts.set(script.id, structuredClone(script));
    return Promise.resolve();
  }

  private clone<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : structuredClone(value);
  }
}

export class InMemoryObjectStorage implements ObjectStorage {
  public readonly objects = new Map<string, Uint8Array>();

  public put(key: string, content: Uint8Array): Promise<void> {
    this.objects.set(key, content.slice());
    return Promise.resolve();
  }

  public get(key: string): Promise<Uint8Array> {
    const content = this.objects.get(key);
    if (!content) {
      return Promise.reject(new Error(`Object not found: ${key}`));
    }
    return Promise.resolve(content.slice());
  }

  public createSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return Promise.resolve(
      `https://storage.invalid/${encodeURIComponent(key)}?expires=${String(expiresInSeconds)}`,
    );
  }
}

export class InMemoryJobQueue implements JobQueue {
  public readonly jobs: Array<{ id: JobId; name: string; payload: unknown }> =
    [];

  public constructor(private readonly ids: IdGenerator) {}

  public enqueue(name: string, payload: unknown): Promise<JobId> {
    const id = this.ids.next("job");
    this.jobs.push({ id, name, payload: structuredClone(payload) });
    return Promise.resolve(id);
  }
}

export class IncrementingIdGenerator implements IdGenerator {
  private value = 0;

  public next(prefix: string): string {
    this.value += 1;
    return `${prefix}_${String(this.value)}`;
  }
}

export class FixedClock implements Clock {
  public constructor(private readonly value = "2026-09-12T00:00:00.000Z") {}

  public now(): string {
    return this.value;
  }
}

export class PassthroughPptxProcessor implements PptxProcessor {
  public parse() {
    return Promise.resolve({ slides: [], pageCount: 0 });
  }

  public applyChanges(file: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(file.slice());
  }
}

export class DeterministicModelGateway implements ModelGateway {
  public rewrite(input: Parameters<ModelGateway["rewrite"]>[0]) {
    return Promise.resolve({
      replacementText: `${input.selection.selectedText}（更清晰）`,
      rationale: "Improve clarity without changing facts.",
      factsPreserved: true,
      confidence: 0.95,
    });
  }

  public createScript(input: Parameters<ModelGateway["createScript"]>[0]) {
    const seconds = Math.floor(
      (input.context.durationMinutes * 60) / Math.max(input.slides.length, 1),
    );
    return Promise.resolve({
      pages: input.slides.map((slide) => ({
        slideId: slide.id,
        purpose: slide.purpose ?? "other",
        keyMessage: slide.elements
          .map((element) => element.text ?? "")
          .join(" ")
          .trim(),
        speakingOrder: ["state the conclusion", "explain the evidence"],
        narration: "Explain the slide using only the supplied deck context.",
        durationSeconds: seconds,
        optionalContent: [],
        likelyQuestions: [],
      })),
    });
  }
}
