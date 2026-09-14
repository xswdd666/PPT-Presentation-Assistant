import { randomUUID } from "node:crypto";
import type {
  AiSnapshotReader,
  AnalysisSnapshot,
  AsyncReviewGateway,
  AsyncAnalysisGateway,
  ReplyGeneration,
  ReplyRequest,
  ReviewAnalysisModel,
  ReviewThread,
} from "@deck-rehearsal/contracts";
import {
  AnalysisPipeline,
  checkSnapshot,
  fail,
  hash,
  replySchema,
  safeFailure,
} from "@deck-rehearsal/ai/runtime";
import type {
  AnalysisGeneration,
  WorkerData,
  WorkerStore,
  WorkItem,
} from "./store.js";
const active = (state: string) => state === "queued" || state === "generating";
function snapshotOf(d: WorkerData, projectId: string, versionId?: string) {
  const snapshot = d.snapshots[projectId];
  if (!snapshot || snapshot.context.projectId !== projectId)
    fail("not_found", "项目上下文不存在");
  checkSnapshot(snapshot, versionId ?? snapshot.context.deckVersionId);
  return snapshot;
}
function threadOf(
  d: WorkerData,
  projectId: string,
  commentId: string,
): ReviewThread {
  const entry = d.threads[commentId];
  if (!entry || entry.projectId !== projectId) fail("not_found", "评论不存在");
  return entry.thread;
}
function jobOf(d: WorkerData, projectId: string, id: string) {
  const job = d.jobs[id];
  if (!job || job.generation.projectId !== projectId)
    fail("not_found", "生成任务不存在");
  return job;
}
export class ReviewWorker
  implements AsyncReviewGateway, AsyncAnalysisGateway, AiSnapshotReader
{
  constructor(
    private readonly store: WorkerStore,
    private readonly model: ReviewAnalysisModel,
    private readonly pipeline = new AnalysisPipeline(model),
    private readonly now = () => Date.now(),
  ) {}
  async getSnapshot(projectId: string) {
    return snapshotOf(await this.store.read(), projectId);
  }
  /** Integration supplies a current snapshot whenever a version/background/script is saved. */
  async putSnapshot(snapshot: AnalysisSnapshot) {
    checkSnapshot(snapshot);
    await this.store.transaction((d) => {
      d.snapshots[snapshot.context.projectId] = structuredClone(snapshot);
    });
  }
  async listComments(projectId: string) {
    const d = await this.store.read();
    snapshotOf(d, projectId);
    return Object.values(d.threads)
      .filter((e) => e.projectId === projectId)
      .map((e) => e.thread.comment)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }
  async getThread(projectId: string, commentId: string) {
    return threadOf(await this.store.read(), projectId, commentId);
  }
  async submitReply(input: ReplyRequest): Promise<ReplyGeneration> {
    if (
      !input.body.trim() ||
      input.body.length > 8000 ||
      !input.idempotencyKey.trim()
    )
      fail("invalid_input", "回复内容或幂等键无效");
    return this.store.transaction((d) => {
      snapshotOf(d, input.projectId, input.deckVersionId);
      const requestKey = hash([
        "reply",
        input.projectId,
        input.commentId,
        input.idempotencyKey,
      ]);
      const fingerprint = hash([input.body.trim(), input.deckVersionId]);
      const previous = Object.values(d.jobs).find(
        (j) => j.requestKey === requestKey,
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          fail("idempotency_conflict", "幂等键已用于不同内容");
        return previous.generation as ReplyGeneration;
      }
      const thread = threadOf(d, input.projectId, input.commentId);
      if (
        Object.values(d.jobs).some(
          (j) =>
            j.kind === "reply" &&
            j.generation.projectId === input.projectId &&
            (j.generation as ReplyGeneration).commentId === input.commentId &&
            active(j.generation.state),
        )
      )
        fail("thread_busy", "该评论正在生成回复，请等待完成");
      const id = `reply_job_${randomUUID()}`;
      const generation: ReplyGeneration = {
        id,
        projectId: input.projectId,
        commentId: input.commentId,
        deckVersionId: input.deckVersionId,
        state: "queued",
      };
      const userReplyId = `user_${randomUUID()}`;
      thread.replies.push({
        id: userReplyId,
        commentId: input.commentId,
        author: "user",
        reviewerId: thread.comment.reviewerId,
        body: input.body.trim(),
        deckVersionId: input.deckVersionId,
        createdAt: new Date(this.now()).toISOString(),
        basis: "用户补充",
      });
      thread.generation = "queued";
      delete thread.error;
      d.jobs[id] = {
        id,
        kind: "reply",
        userReplyId,
        requestKey,
        fingerprint,
        generation,
      };
      return generation;
    });
  }
  async getReplyResult(projectId: string, generationId: string) {
    const d = await this.store.read(),
      job = jobOf(d, projectId, generationId);
    if (job.kind !== "reply") fail("not_found", "回复任务不存在");
    const generation = job.generation as ReplyGeneration;
    return { generation, thread: threadOf(d, projectId, generation.commentId) };
  }
  async retryReply(
    projectId: string,
    generationId: string,
  ): Promise<ReplyGeneration> {
    return this.store.transaction((d) => {
      const job = jobOf(d, projectId, generationId);
      if (job.kind !== "reply") fail("not_found", "回复任务不存在");
      const generation = job.generation as ReplyGeneration;
      snapshotOf(d, projectId, generation.deckVersionId);
      if (generation.state !== "failed") return generation;
      if (!generation.error?.retryable)
        fail("invalid_input", "该错误需要刷新或修改输入");
      const thread = threadOf(d, projectId, generation.commentId);
      const last = thread.replies.at(-1);
      // Retry only the latest failed turn: a newer user message needs its own generation.
      if (
        !last ||
        last.author !== "user" ||
        last.id !== job.userReplyId ||
        hash([last.body, generation.deckVersionId]) !== job.fingerprint ||
        Object.values(d.jobs).some(
          (j) =>
            j.id !== job.id &&
            j.kind === "reply" &&
            (j.generation as ReplyGeneration).commentId ===
              generation.commentId &&
            active(j.generation.state),
        )
      )
        fail("thread_busy", "线程已有更新，请刷新");
      generation.state = "queued";
      delete generation.error;
      thread.generation = "queued";
      delete thread.error;
      return generation;
    });
  }
  async submitAnalysis(
    projectId: string,
    deckVersionId: string,
    key: string,
  ): Promise<AnalysisGeneration> {
    if (!key.trim()) fail("invalid_input", "缺少幂等键");
    return this.store.transaction((d) => {
      const snapshot = snapshotOf(d, projectId, deckVersionId),
        fingerprint = hash(snapshot),
        requestKey = hash(["analysis", projectId, key]);
      const previous = Object.values(d.jobs).find(
        (j) => j.requestKey === requestKey,
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          fail("idempotency_conflict", "幂等键已用于不同上下文");
        return previous.generation as AnalysisGeneration;
      }
      if (
        Object.values(d.jobs).some(
          (j) =>
            j.kind === "analysis" &&
            j.generation.projectId === projectId &&
            active(j.generation.state),
        )
      )
        fail("thread_busy", "分析正在进行");
      const id = `analysis_job_${randomUUID()}`;
      const generation: AnalysisGeneration = {
        id,
        projectId,
        deckVersionId,
        state: "queued",
        processedSlides: 0,
        totalSlides: snapshot.slides.length,
      };
      d.jobs[id] = {
        id,
        kind: "analysis",
        requestKey,
        fingerprint,
        generation,
      };
      return generation;
    });
  }
  async getAnalysisResult(projectId: string, id: string) {
    const d = await this.store.read(),
      job = jobOf(d, projectId, id);
    if (job.kind !== "analysis") fail("not_found", "分析任务不存在");
    return {
      generation: job.generation as AnalysisGeneration,
      result: d.analysis[id],
    };
  }
  async retryAnalysis(projectId: string, id: string) {
    return this.store.transaction((d) => {
      const job = jobOf(d, projectId, id);
      if (job.kind !== "analysis") fail("not_found", "分析任务不存在");
      const snapshot = snapshotOf(d, projectId, job.generation.deckVersionId);
      if (hash(snapshot) !== job.fingerprint)
        fail("version_conflict", "分析上下文已变化");
      if (
        job.generation.state === "failed" &&
        job.generation.error?.retryable
      ) {
        job.generation.state = "queued";
        delete job.generation.error;
      }
      return job.generation as AnalysisGeneration;
    });
  }
  async runNext(): Promise<boolean> {
    const claimed = await this.store.transaction((d) => {
      const job = Object.values(d.jobs).find(
        (j) =>
          j.generation.state === "queued" ||
          (j.generation.state === "generating" &&
            (j.leaseUntil ?? 0) < this.now()),
      );
      if (!job) return undefined;
      job.generation.state = "generating";
      job.token = randomUUID();
      job.leaseUntil = this.now() + 360000;
      if (job.kind === "reply")
        threadOf(
          d,
          job.generation.projectId,
          (job.generation as ReplyGeneration).commentId,
        ).generation = "generating";
      return job;
    });
    if (!claimed) return false;
    try {
      if (claimed.kind === "reply") await this.generateReply(claimed);
      else await this.generateAnalysis(claimed);
    } catch (error) {
      await this.store.transaction((d) => {
        const job = d.jobs[claimed.id];
        if (!job || job.token !== claimed.token) return;
        job.generation.state = "failed";
        job.generation.error = safeFailure(error);
        if (job.kind === "reply") {
          const thread = threadOf(
            d,
            job.generation.projectId,
            (job.generation as ReplyGeneration).commentId,
          );
          thread.generation = "failed";
          thread.error = job.generation.error.message;
        }
      });
    }
    return true;
  }
  private async generateReply(job: WorkItem) {
    const generation = job.generation as ReplyGeneration,
      data = await this.store.read();
    const snapshot = snapshotOf(
        data,
        generation.projectId,
        generation.deckVersionId,
      ),
      before = hash(snapshot);
    const thread = threadOf(data, generation.projectId, generation.commentId);
    const slides = snapshot.slides.filter((s) =>
      thread.comment.relatedSlideIds.includes(s.id),
    );
    if (
      slides.length !== thread.comment.relatedSlideIds.length ||
      !slides.length
    )
      fail("version_conflict", "评论关联页面已不存在");
    const parsed = replySchema.safeParse(
      await this.model.reply({ thread, context: snapshot.context, slides }),
    );
    if (!parsed.success) fail("invalid_output", "回复长度或结构无效");
    await this.store.transaction((d) => {
      const current = d.jobs[job.id];
      if (!current || current.token !== job.token) return;
      const latest = snapshotOf(
        d,
        generation.projectId,
        generation.deckVersionId,
      );
      if (hash(latest) !== before)
        fail("version_conflict", "生成期间上下文已变化，请重新生成");
      const target = threadOf(d, generation.projectId, generation.commentId);
      target.replies.push({
        id: `ai_${randomUUID()}`,
        commentId: generation.commentId,
        author: "reviewer",
        reviewerId: target.comment.reviewerId,
        body: parsed.data.body,
        deckVersionId: generation.deckVersionId,
        createdAt: new Date(this.now()).toISOString(),
        basis: `基于第 ${slides.map((s) => s.index + 1).join("、")} 页与当前版本 ${generation.deckVersionId}`,
      });
      target.generation = "completed";
      delete target.error;
      current.generation.state = "completed";
      delete current.generation.error;
    });
  }
  private async generateAnalysis(job: WorkItem) {
    const generation = job.generation,
      snapshot = await this.getSnapshot(generation.projectId);
    checkSnapshot(snapshot, generation.deckVersionId);
    if (hash(snapshot) !== job.fingerprint)
      fail("version_conflict", "分析上下文已变化");
    const result = await this.pipeline.run(
      snapshot,
      async (processedSlides, totalSlides) => {
        await this.store.transaction((d) => {
          const current = d.jobs[job.id];
          if (current && current.token === job.token) {
            Object.assign(current.generation, { processedSlides, totalSlides });
            current.leaseUntil = this.now() + 360000;
          }
        });
      },
    );
    await this.store.transaction((d) => {
      const current = d.jobs[job.id];
      if (!current || current.token !== job.token) return;
      if (
        hash(snapshotOf(d, generation.projectId, generation.deckVersionId)) !==
        job.fingerprint
      )
        fail("version_conflict", "分析期间上下文已变化");
      d.analysis[job.id] = result;
      snapshotOf(d, generation.projectId).context = result.context;
      current.fingerprint = hash(d.snapshots[generation.projectId]);
      for (const comment of result.comments)
        d.threads[comment.id] = {
          projectId: generation.projectId,
          thread: { comment, replies: [], generation: "completed" },
        };
      current.generation.state = "completed";
      delete current.generation.error;
    });
  }
}
