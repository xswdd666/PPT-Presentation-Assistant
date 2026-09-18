import type {
  ModelGateway,
  ReviewAnalysisModel,
  TextSelection,
} from "@deck-rehearsal/contracts";
import type { JsonModelGateway } from "@deck-rehearsal/ai";
import {
  AnalysisPipeline,
  LocalRewriteService,
  hash,
} from "@deck-rehearsal/ai/runtime";
import { ReviewWorker, StoreAnalysisCache } from "@deck-rehearsal/worker";
import { WorkspaceService, ServiceError } from "./service.js";
import type { IntegratedData } from "./worker-store.js";
import { WorkspaceWorkerStore } from "./worker-store.js";
import { ManuscriptGenerator } from "./manuscript.js";

/** Production assembly: real PPTX/domain/storage plus task 02's durable AI worker. */
export class IntegratedWorkspaceService extends WorkspaceService {
  readonly worker: ReviewWorker;
  private readonly rewrites: LocalRewriteService;
  private running = false;
  constructor(
    directory: string,
    model: JsonModelGateway,
    ai: ReviewAnalysisModel & Partial<Pick<ModelGateway, "createScript">>,
    namespace = "default",
  ) {
    super(directory, model);
    if (ai.createScript)
      this.manuscripts = new ManuscriptGenerator(this.store, {
        createScript: ai.createScript.bind(ai),
      });
    const store = new WorkspaceWorkerStore(this.store);
    this.worker = new ReviewWorker(
      store,
      ai,
      new AnalysisPipeline(ai, new StoreAnalysisCache(store), namespace),
    );
    this.rewrites = new LocalRewriteService(
      {
        getSnapshot: async (projectId) => {
          const snapshot = await this.snapshot(projectId);
          if (!snapshot.context)
            throw new ServiceError("项目尚未准备好改写", 409);
          return {
            context: snapshot.context,
            slides: snapshot.slides,
            documents: snapshot.documents,
          };
        },
      },
      ai,
    );
  }
  override async snapshot(projectId: string) {
    return { ...(await super.snapshot(projectId)), asyncReviews: true };
  }
  override async processNext() {
    if (this.running) return;
    this.running = true;
    try {
      let d: IntegratedData = await this.store.read();
      // A previously authorized analysis follows version/background changes using the page cache.
      for (const project of Object.values(d.projects)) {
        const state = d.uploadStates[project.id];
        const context = d.contexts[project.currentVersionId ?? ""];
        const completed = Object.values(d.aiWorker?.analysis ?? {})
          .filter((r) => r.context.projectId === project.id)
          .at(-1);
        if (
          state?.analysisRequested &&
          state.stage === "completed" &&
          context &&
          completed &&
          hash(context) !== hash(completed.context)
        )
          await super.analyze(
            project.id,
            context.goal?.value ?? "",
            context.expectedAudienceResponse?.value ?? "",
            hash(["incremental", context]),
          );
      }
      d = await this.store.read();
      const pending = Object.values(d.jobs).filter(
        (job) =>
          !["completed", "failed"].includes(job.stage) &&
          d.uploadStates[job.projectId]?.analysisRequested,
      );
      for (const job of pending) {
        const attempt = d.uploadStates[job.projectId]?.attempt;
        if (
          Object.values(d.aiLinks ?? {}).some(
            (link) => link.jobId === job.id && link.attempt === attempt,
          )
        )
          continue;
        try {
          const snapshot = await this.worker.getSnapshot(job.projectId);
          // Upload has already persisted parsed slides. Retrying AI must not parse the PPTX again.
          const version = d.versions[job.deckVersionId];
          if (!version) throw new ServiceError("版本不存在", 404);
          if (!snapshot.slides.length)
            throw new ServiceError("已解析页面缺失，请重新上传文件", 409);
          const key = hash([job.id, d.uploadStates[job.projectId]?.attempt]);
          if (snapshot.context.deckVersionId !== job.deckVersionId) {
            await this.store.transaction((latest) => {
              const current = latest.jobs[job.id];
              const state = latest.uploadStates[job.projectId];
              if (current && state) {
                current.stage = "failed";
                current.failureReason = "版本已变化，请重新分析";
                state.stage = "failed";
                state.error = {
                  code: "version_conflict",
                  message: current.failureReason,
                  retryable: false,
                  recovery: "refresh",
                };
              }
            });
            continue;
          }
          await this.worker.submitAnalysis(
            job.projectId,
            job.deckVersionId,
            key,
          );
        } catch {
          // A competing dispatcher may have created the same job while we parsed.
          const latest = (await this.store.read()) as IntegratedData;
          if (
            Object.values(latest.aiLinks ?? {}).some(
              (link) => link.jobId === job.id && link.attempt === attempt,
            )
          )
            continue;
          await this.store.transaction((state) => {
            const upload = state.uploadStates[job.projectId];
            const current = state.jobs[job.id];
            if (!upload || !current || upload.attempt !== attempt) return;
            current.stage = "failed";
            current.failureReason = "解析或分析调度失败，请重试";
            upload.stage = "failed";
            upload.error = {
              code: "dispatch_failed",
              message: current.failureReason,
              retryable: true,
              recovery: "retry",
            };
          });
        }
      }
      await this.worker.runNext();
      await this.manuscripts.runNext();
    } finally {
      this.running = false;
    }
  }
  override async thread(projectId: string, commentId: string) {
    const thread = await this.worker.getThread(projectId, commentId);
    const d = (await this.store.read()) as IntegratedData;
    const latest = Object.values(d.aiWorker?.jobs ?? {})
      .filter(
        (job) =>
          job.kind === "reply" &&
          job.generation.projectId === projectId &&
          "commentId" in job.generation &&
          job.generation.commentId === commentId,
      )
      .at(-1);
    return { ...thread, ...(latest ? { generationId: latest.id } : {}) };
  }
  override async reply(
    projectId: string,
    commentId: string,
    body: string,
    versionId: string,
    key: string,
  ) {
    await this.worker.submitReply({
      projectId,
      commentId,
      body,
      deckVersionId: versionId,
      idempotencyKey: key,
    });
    return this.worker.getThread(projectId, commentId);
  }
  override async suggest(
    projectId: string,
    target: "ppt" | "script",
    selection: TextSelection,
    revision?: number,
  ) {
    const snapshot = await this.snapshot(projectId);
    const proposal = await this.rewrites.suggest(
      target === "ppt"
        ? { projectId, target, selection }
        : {
            projectId,
            target,
            selection,
            scriptRevision:
              revision ?? snapshot.documents[selection.slideId]?.revision ?? 0,
          },
    );
    return this.store.transaction((d) => {
      if (
        d.projects[projectId]?.currentVersionId !== selection.deckVersionId ||
        (target === "script" &&
          d.documents[projectId]?.[selection.slideId]?.revision !==
            proposal.scriptRevision)
      )
        throw new ServiceError(
          "版本或讲稿已变化，请重新生成",
          409,
          "version_conflict",
        );
      const version = d.versions[selection.deckVersionId];
      const slide = d.slides[selection.deckVersionId]?.find(
        (s) => s.id === selection.slideId,
      );
      proposal.basis = `基于第 ${String(slide?.index ?? "—")} 页与版本 V${String(version?.versionNumber ?? "—")}`;
      d.suggestions[proposal.id] = proposal;
      return proposal;
    });
  }
}
