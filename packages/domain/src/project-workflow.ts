import type {
  AnalysisJob,
  ChangeOperation,
  ChangeSet,
  Clock,
  DeckVersion,
  DeckVersionId,
  IdGenerator,
  JobQueue,
  ModelGateway,
  ObjectStorage,
  PptxProcessor,
  Project,
  ProjectId,
  ProjectWorkflow,
  ReviewComment,
  ReviewIssue,
  RewriteProposal,
  Script,
  ScriptStyle,
  SourceFile,
  SourceFileId,
  TextSelection,
  WorkflowRepository,
} from "@deck-rehearsal/contracts";
import { invariant } from "./errors.js";

const PPTX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const;
const DOWNLOAD_TTL_SECONDS = 300;

export interface ProjectWorkflowDependencies {
  repository: WorkflowRepository;
  storage: ObjectStorage;
  queue: JobQueue;
  model: ModelGateway;
  pptx: PptxProcessor;
  clock: Clock;
  ids: IdGenerator;
}

export class DefaultProjectWorkflow implements ProjectWorkflow {
  public constructor(
    private readonly dependencies: ProjectWorkflowDependencies,
  ) {}

  public async createProject(
    input: Parameters<ProjectWorkflow["createProject"]>[0],
  ): Promise<Project> {
    invariant(
      input.durationMinutes > 0,
      "invalid_duration",
      "Duration must be positive",
    );
    invariant(
      input.scenario !== "other" || Boolean(input.customScenario?.trim()),
      "custom_scenario_required",
      "A custom scenario is required when scenario is other",
    );
    const now = this.dependencies.clock.now();
    const project: Project = {
      ...input,
      id: this.dependencies.ids.next("project"),
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.repository.saveProject(project);
    return project;
  }

  public async completeUpload(
    input: Parameters<ProjectWorkflow["completeUpload"]>[0],
  ): Promise<{ sourceFile: SourceFile; version: DeckVersion }> {
    const project = await this.requireProject(input.projectId);
    invariant(
      input.originalName.toLowerCase().endsWith(".pptx"),
      "unsupported_file_type",
      "Only PPTX files are supported",
    );
    const now = this.dependencies.clock.now();
    const sourceFile: SourceFile = {
      id: this.dependencies.ids.next("source"),
      projectId: project.id,
      originalName: input.originalName,
      mediaType: PPTX_MEDIA_TYPE,
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      status: "uploaded",
      createdAt: now,
    };
    const version: DeckVersion = {
      id: this.dependencies.ids.next("version"),
      projectId: project.id,
      sourceFileId: sourceFile.id,
      versionNumber: 1,
      status: "current",
      storageKey: input.storageKey,
      changeSummary: "Original upload",
      createdAt: now,
    };
    await this.dependencies.repository.saveSourceFile(sourceFile);
    await this.dependencies.repository.saveVersion(version);
    await this.dependencies.repository.saveContext({
      projectId: project.id,
      deckVersionId: version.id,
      topic: project.name,
      scenario: project.scenario,
      audience: project.audience,
      durationMinutes: project.durationMinutes,
      facts: [],
      updatedAt: now,
    });
    await this.dependencies.repository.saveProject({
      ...project,
      currentVersionId: version.id,
      updatedAt: now,
    });
    return { sourceFile, version };
  }

  public async markUploadCompleted(
    sourceFileId: SourceFileId,
  ): Promise<SourceFile> {
    const source =
      await this.dependencies.repository.getSourceFile(sourceFileId);
    invariant(source, "source_file_not_found", "Source file was not found");
    const completed = { ...source, status: "uploaded" as const };
    await this.dependencies.repository.saveSourceFile(completed);
    return completed;
  }

  public async startAnalysis(
    projectId: ProjectId,
  ): Promise<{ job: AnalysisJob; queueJobId: string }> {
    const versionId = await this.getCurrentVersion(projectId);
    const slides = await this.dependencies.repository.getSlides(versionId);
    invariant(
      slides.length <= 60,
      "page_limit_exceeded",
      "PPTX cannot exceed 60 pages",
    );
    const now = this.dependencies.clock.now();
    const job: AnalysisJob = {
      id: this.dependencies.ids.next("analysis"),
      projectId,
      deckVersionId: versionId,
      stage: "upload_completed",
      processedSlides: 0,
      totalSlides: slides.length,
      failedSlideIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.repository.saveAnalysisJob(job);
    const queueJobId = await this.dependencies.queue.enqueue("analyze_deck", {
      analysisJobId: job.id,
      projectId,
      deckVersionId: versionId,
    });
    return { job, queueJobId };
  }

  public async addComment(
    input: Parameters<ProjectWorkflow["addComment"]>[0],
  ): Promise<{ issue: ReviewIssue; comment: ReviewComment }> {
    const now = this.dependencies.clock.now();
    const issue: ReviewIssue = {
      ...input.issue,
      id: this.dependencies.ids.next("issue"),
      createdAt: now,
    };
    const normalizedBody = input.body.trim().replace(/\s+/g, " ");
    const displayLength = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        normalizedBody,
      ),
    ).length;
    invariant(
      displayLength >= 50 && displayLength <= 100,
      "invalid_comment_length",
      "Published comments must contain 50 to 100 display characters",
    );
    const comment: ReviewComment = {
      id: this.dependencies.ids.next("comment"),
      issueId: issue.id,
      reviewerId: input.reviewerId,
      deckVersionId: input.deckVersionId,
      headline: input.headline,
      body: normalizedBody,
      evidence: input.evidence,
      impact: input.impact,
      suggestedAction: input.suggestedAction,
      confidence: input.confidence,
      relatedSlideIds: input.relatedSlideIds,
      createdAt: now,
    };
    await this.dependencies.repository.saveIssue(issue);
    await this.dependencies.repository.saveComment(comment);
    return { issue, comment };
  }

  public async requestRewrite(input: {
    projectId: ProjectId;
    selection: TextSelection;
  }): Promise<RewriteProposal> {
    const currentVersionId = await this.getCurrentVersion(input.projectId);
    invariant(
      input.selection.deckVersionId === currentVersionId,
      "stale_selection",
      "The text selection belongs to an older deck version",
    );
    const slides =
      await this.dependencies.repository.getSlides(currentVersionId);
    const index = slides.findIndex(
      (slide) => slide.id === input.selection.slideId,
    );
    invariant(index >= 0, "slide_not_found", "Selected slide was not found");
    const currentSlide = slides[index];
    invariant(currentSlide, "slide_not_found", "Selected slide was not found");
    const element = currentSlide.elements.find(
      (candidate) => candidate.id === input.selection.elementId,
    );
    invariant(
      element?.editable && element.text !== undefined,
      "selection_not_editable",
      "Selected element is not editable",
    );
    invariant(
      element.text.slice(
        input.selection.startOffset,
        input.selection.endOffset,
      ) === input.selection.selectedText,
      "stale_selection",
      "Selected text no longer matches the current element",
    );
    const context =
      await this.dependencies.repository.getContext(currentVersionId);
    invariant(context, "deck_context_not_found", "Deck context was not found");
    const adjacent = (offset: number) => slides[index + offset];
    const output = await this.dependencies.model.rewrite({
      selection: input.selection,
      elementText: element.text,
      currentSlide,
      ...(adjacent(-1) ? { previousSlide: adjacent(-1) } : {}),
      ...(adjacent(1) ? { nextSlide: adjacent(1) } : {}),
      context,
    });
    const proposal: RewriteProposal = {
      id: this.dependencies.ids.next("rewrite"),
      projectId: input.projectId,
      selection: input.selection,
      ...output,
      status: "proposed",
      createdAt: this.dependencies.clock.now(),
    };
    await this.dependencies.repository.saveRewrite(proposal);
    return proposal;
  }

  public async acceptRewrite(proposalId: string): Promise<ChangeSet> {
    const proposal = await this.requirePendingRewrite(proposalId);
    invariant(
      (await this.getCurrentVersion(proposal.projectId)) ===
        proposal.selection.deckVersionId,
      "version_conflict",
      "The proposal belongs to an older version",
    );
    const changeSet = await this.getOrCreateChangeSet(
      proposal.projectId,
      proposal.selection.deckVersionId,
    );
    const now = this.dependencies.clock.now();
    const updated: ChangeSet = {
      ...changeSet,
      operations: [
        ...changeSet.operations,
        {
          type: "replace_text",
          proposalId: proposal.id,
          selection: proposal.selection,
          replacementText: proposal.replacementText,
        },
      ],
      updatedAt: now,
    };
    await this.dependencies.repository.saveRewrite({
      ...proposal,
      status: "accepted",
    });
    await this.dependencies.repository.saveChangeSet(updated);
    return updated;
  }

  public async rejectRewrite(proposalId: string): Promise<RewriteProposal> {
    const proposal = await this.requirePendingRewrite(proposalId);
    const rejected: RewriteProposal = { ...proposal, status: "rejected" };
    await this.dependencies.repository.saveRewrite(rejected);
    return rejected;
  }

  public async updateChanges(
    projectId: ProjectId,
    operations: ChangeOperation[],
  ): Promise<ChangeSet> {
    const versionId = await this.getCurrentVersion(projectId);
    const current = await this.getOrCreateChangeSet(projectId, versionId);
    const updated = {
      ...current,
      operations: [...current.operations, ...operations],
      updatedAt: this.dependencies.clock.now(),
    };
    await this.dependencies.repository.saveChangeSet(updated);
    return updated;
  }

  public async commitVersion(
    projectId: ProjectId,
    summary: string,
  ): Promise<DeckVersion> {
    const project = await this.requireProject(projectId);
    const currentId = await this.getCurrentVersion(projectId);
    const current = await this.dependencies.repository.getVersion(currentId);
    invariant(current, "version_not_found", "Current version was not found");
    const changeSet =
      await this.dependencies.repository.getChangeSet(projectId);
    invariant(
      changeSet?.status === "draft",
      "changeset_not_found",
      "No draft changes exist",
    );
    invariant(
      changeSet.baseVersionId === current.id,
      "version_conflict",
      "Draft changes are based on an older version",
    );
    const source = await this.dependencies.storage.get(current.storageKey);
    const content = await this.dependencies.pptx.applyChanges(
      source,
      changeSet.operations,
    );
    const id = this.dependencies.ids.next("version");
    const storageKey = `projects/${projectId}/versions/${id}.pptx`;
    await this.dependencies.storage.put(storageKey, content);
    const version: DeckVersion = {
      id,
      projectId,
      sourceFileId: current.sourceFileId,
      parentVersionId: current.id,
      versionNumber: current.versionNumber + 1,
      status: "current",
      storageKey,
      changeSummary: summary,
      createdAt: this.dependencies.clock.now(),
    };
    await this.dependencies.repository.saveVersion({
      ...current,
      status: "superseded",
    });
    await this.dependencies.repository.saveVersion(version);
    const parsed = await this.dependencies.pptx.parse(content, version.id);
    await this.dependencies.repository.saveSlides(version.id, parsed.slides);
    const context = await this.dependencies.repository.getContext(current.id);
    if (context) {
      await this.dependencies.repository.saveContext({
        ...context,
        deckVersionId: version.id,
        updatedAt: this.dependencies.clock.now(),
      });
    }
    await this.dependencies.repository.saveChangeSet({
      ...changeSet,
      status: "committed",
      updatedAt: this.dependencies.clock.now(),
    });
    await this.dependencies.repository.saveProject({
      ...project,
      currentVersionId: version.id,
      updatedAt: this.dependencies.clock.now(),
    });
    return version;
  }

  public async generateScript(
    projectId: ProjectId,
    style: ScriptStyle,
  ): Promise<Script> {
    const versionId = await this.getCurrentVersion(projectId);
    const context = await this.dependencies.repository.getContext(versionId);
    invariant(context, "deck_context_not_found", "Deck context was not found");
    const slides = await this.dependencies.repository.getSlides(versionId);
    const result = await this.dependencies.model.createScript({
      context,
      slides,
      style,
    });
    const totalDurationSeconds = result.pages.reduce(
      (total, page) => total + page.durationSeconds,
      0,
    );
    const script: Script = {
      id: this.dependencies.ids.next("script"),
      projectId,
      deckVersionId: versionId,
      style,
      status: "completed",
      pages: result.pages,
      totalDurationSeconds,
      ...(result.compressionAdvice
        ? { compressionAdvice: result.compressionAdvice }
        : {}),
      createdAt: this.dependencies.clock.now(),
    };
    await this.dependencies.repository.saveScript(script);
    return script;
  }

  public async createDownload(
    projectId: ProjectId,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const versionId = await this.getCurrentVersion(projectId);
    const version = await this.dependencies.repository.getVersion(versionId);
    invariant(version, "version_not_found", "Current version was not found");
    return {
      url: await this.dependencies.storage.createSignedDownloadUrl(
        version.storageKey,
        DOWNLOAD_TTL_SECONDS,
      ),
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    };
  }

  public async getCurrentVersion(projectId: ProjectId): Promise<DeckVersionId> {
    const project = await this.requireProject(projectId);
    invariant(
      project.currentVersionId,
      "version_not_found",
      "Project has no deck version",
    );
    return project.currentVersionId;
  }

  private async requireProject(projectId: ProjectId): Promise<Project> {
    const project = await this.dependencies.repository.getProject(projectId);
    invariant(project, "project_not_found", "Project was not found");
    return project;
  }

  private async requirePendingRewrite(id: string): Promise<RewriteProposal> {
    const proposal = await this.dependencies.repository.getRewrite(id);
    invariant(proposal, "rewrite_not_found", "Rewrite proposal was not found");
    invariant(
      proposal.status === "proposed",
      "rewrite_already_decided",
      "Rewrite proposal is no longer awaiting a decision",
    );
    return proposal;
  }

  private async getOrCreateChangeSet(
    projectId: ProjectId,
    baseVersionId: DeckVersionId,
  ): Promise<ChangeSet> {
    const existing = await this.dependencies.repository.getChangeSet(projectId);
    if (existing?.status === "draft") {
      invariant(
        existing.baseVersionId === baseVersionId,
        "version_conflict",
        "Draft changes use an older version",
      );
      return existing;
    }
    const now = this.dependencies.clock.now();
    return {
      id: this.dependencies.ids.next("changeset"),
      projectId,
      baseVersionId,
      status: "draft",
      operations: [],
      createdAt: now,
      updatedAt: now,
    };
  }
}
