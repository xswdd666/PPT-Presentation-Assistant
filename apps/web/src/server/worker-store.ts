import type {
  LocalWorkspaceData,
  LocalWorkspaceStore,
} from "@deck-rehearsal/db";
import type { WorkerData, WorkerStore } from "@deck-rehearsal/worker";
import { emptyWorkerData } from "@deck-rehearsal/worker";
import { queueManuscript } from "./manuscript.js";

export type IntegratedData = LocalWorkspaceData & {
  aiWorker?: WorkerData;
  aiLinks?: Record<string, { jobId: string; attempt: number }>;
};

/** Queue, replies, progress and workspace publish in one atomic snapshot. */
export class WorkspaceWorkerStore implements WorkerStore {
  constructor(private readonly workspace: LocalWorkspaceStore) {}

  private hydrate(d: IntegratedData): WorkerData {
    const ai = (d.aiWorker ??= emptyWorkerData());
    for (const project of Object.values(d.projects)) {
      const versionId = project.currentVersionId ?? "";
      const context = d.contexts[versionId];
      const slides = d.slides[versionId];
      if (context && slides?.length)
        ai.snapshots[project.id] = structuredClone({
          context,
          slides,
          documents: d.documents[project.id] ?? {},
        });
    }
    for (const [id, thread] of Object.entries(d.threads)) {
      const projectId = d.versions[thread.comment.deckVersionId]?.projectId;
      if (projectId)
        ai.threads[id] = { projectId, thread: structuredClone(thread) };
    }
    for (const [id, link] of Object.entries(d.aiLinks ?? {})) {
      const item = ai.jobs[id];
      if (!item || !["queued", "generating"].includes(item.generation.state))
        continue;
      const state = d.uploadStates[item.generation.projectId];
      if (state?.attempt !== link.attempt || state.stage === "cancelled") {
        item.generation.state = "failed";
        item.generation.error = {
          code: "version_conflict",
          message: "分析已取消或被新的请求替代",
          retryable: false,
          recovery: "refresh",
        };
        delete item.token;
      }
    }
    return ai;
  }

  async read() {
    return this.hydrate(await this.workspace.read());
  }

  async transaction<T>(work: (draft: WorkerData) => T): Promise<T> {
    return this.workspace.transaction((raw) => {
      const d = raw as IntegratedData;
      const ai = this.hydrate(d);
      const oldIds = new Set(Object.keys(ai.jobs));
      const result = work(ai);
      const links = (d.aiLinks ??= {});
      for (const item of Object.values(ai.jobs)) {
        const generation = item.generation;
        if (item.kind !== "analysis") continue;
        const state = d.uploadStates[generation.projectId];
        if (!oldIds.has(item.id) && state?.analysisRequested) {
          const job = Object.values(d.jobs).find(
            (j) =>
              j.projectId === generation.projectId &&
              j.deckVersionId === generation.deckVersionId &&
              !["completed", "failed"].includes(j.stage),
          );
          if (job) links[item.id] = { jobId: job.id, attempt: state.attempt };
        }
        const link = links[item.id];
        const job = link && d.jobs[link.jobId];
        if (
          !link ||
          !job ||
          !state ||
          state.attempt !== link.attempt ||
          ["completed", "failed", "cancelled"].includes(state.stage)
        )
          continue;
        job.processedSlides =
          "processedSlides" in generation ? generation.processedSlides : 0;
        job.updatedAt = new Date().toISOString();
        state.updatedAt = job.updatedAt;
        if (generation.state === "failed") {
          job.stage = "failed";
          job.failureReason = generation.error?.message ?? "分析失败，请重试";
          state.stage = "failed";
          state.error = {
            code: generation.error?.code ?? "analysis_failed",
            message: job.failureReason,
            retryable:
              generation.error?.retryable === true ||
              generation.error?.code === "not_configured",
            recovery:
              generation.error?.recovery === "configure"
                ? "configure"
                : "retry",
          };
        } else if (generation.state === "completed") {
          const output = ai.analysis[item.id];
          if (!output) throw new Error("Analysis result missing");
          d.contexts[generation.deckVersionId] = structuredClone(
            output.context,
          );
          d.routes[generation.projectId] = output.reviewers;
          for (const [field, value] of [
            ["goal", output.context.goal],
            ["response", output.context.expectedAudienceResponse],
          ] as const) {
            if (value?.source === "ai_suggested")
              state[field].suggestion = value.value;
            state[field].updatedAt = job.updatedAt;
          }
          state.revision++;
          state.stage = "completed";
          delete state.error;
          job.failedSlideIds = output.failedSlides.map((page) => page.slideId);
          job.stage = "completed";
          job.processedSlides = job.totalSlides;
          queueManuscript(d, generation.projectId);
        } else {
          state.stage =
            generation.state === "queued"
              ? "queued"
              : job.processedSlides >= job.totalSlides
                ? "generating_review"
                : "analyzing";
          job.stage =
            generation.state === "queued"
              ? "upload_completed"
              : "global_analysis";
        }
      }
      for (const { thread } of Object.values(ai.threads)) {
        for (const reply of thread.replies) {
          if (reply.author !== "reviewer") continue;
          const version = d.versions[reply.deckVersionId];
          const pages = (d.slides[reply.deckVersionId] ?? []).filter((slide) =>
            thread.comment.relatedSlideIds.includes(slide.id),
          );
          if (version)
            reply.basis = `基于第 ${pages.map((slide) => slide.index).join("、")} 页与版本 V${String(version.versionNumber)}`;
        }
        d.threads[thread.comment.id] = structuredClone(thread);
        d.comments[thread.comment.id] = structuredClone(thread.comment);
      }
      return structuredClone(result);
    });
  }
}
