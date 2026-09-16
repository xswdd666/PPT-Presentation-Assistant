import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixture,
  comment,
  MockReviewModel,
  validReply,
  requireValue,
} from "@deck-rehearsal/ai/testing";
import { fail } from "@deck-rehearsal/ai/runtime";
import { ReviewWorker } from "./review-worker.js";
import { MemoryWorkerStore } from "./store.js";
import { FileWorkerStore } from "./file-store.js";
async function setup() {
  const store = new MemoryWorkerStore(),
    model = new MockReviewModel(),
    worker = new ReviewWorker(store, model);
  await worker.putSnapshot(fixture());
  await store.transaction((d) => {
    d.threads.c1 = {
      projectId: "p1",
      thread: { comment: comment(), replies: [], generation: "completed" },
    };
  });
  return { store, model, worker };
}
const request = {
  projectId: "p1",
  commentId: "c1",
  body: "请解释这一页的证据问题",
  deckVersionId: "v1",
  idempotencyKey: "key1",
};
describe("thread workflow", () => {
  it("shares history within one reviewer and excludes every other reviewer", async () => {
    const { worker, model, store } = await setup();
    await store.transaction((d) => {
      const sameReviewer = {
        ...comment(),
        id: "c2",
        issueId: "i2",
        createdAt: "2026-09-14T00:01:00Z",
      };
      const otherReviewer = {
        ...comment(),
        id: "c3",
        issueId: "i3",
        reviewerId: "jack" as const,
        createdAt: "2026-09-14T00:02:00Z",
      };
      d.threads.c2 = {
        projectId: "p1",
        thread: {
          comment: sameReviewer,
          generation: "completed",
          replies: [
            {
              id: "r2",
              commentId: "c2",
              author: "user",
              reviewerId: "olivia",
              body: "同一评审人的历史",
              deckVersionId: "v1",
              createdAt: "2026-09-14T00:03:00Z",
              basis: "用户补充",
            },
          ],
        },
      };
      d.threads.c3 = {
        projectId: "p1",
        thread: {
          comment: otherReviewer,
          generation: "completed",
          replies: [
            {
              id: "r3",
              commentId: "c3",
              author: "user",
              reviewerId: "jack",
              body: "其他评审人的秘密",
              deckVersionId: "v1",
              createdAt: "2026-09-14T00:04:00Z",
              basis: "用户补充",
            },
          ],
        },
      };
    });
    await worker.submitReply(request);
    await expect(
      worker.submitReply({
        ...request,
        commentId: "c2",
        idempotencyKey: "same-reviewer-busy",
      }),
    ).rejects.toMatchObject({ failure: { code: "thread_busy" } });
    await worker.runNext();
    const input = requireValue(model.replies[0]);
    expect(input.reviewerComments.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(input.reviewerReplies.map((item) => item.body)).toContain(
      "同一评审人的历史",
    );
    expect(JSON.stringify(input)).not.toContain("其他评审人的秘密");
    expect(input.slides).toHaveLength(3);
  });

  it("echoes user immediately, deduplicates concurrent submits, then completes in same role", async () => {
    const { worker, model } = await setup();
    const [a, b] = await Promise.all([
      worker.submitReply(request),
      worker.submitReply(request),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.state).toBe("queued");
    expect((await worker.getThread("p1", "c1")).replies).toHaveLength(1);
    const [ran1, ran2] = await Promise.all([
      worker.runNext(),
      worker.runNext(),
    ]);
    expect([ran1, ran2].filter(Boolean)).toHaveLength(1);
    const result = await worker.getReplyResult("p1", a.id);
    expect(result.generation.state).toBe("completed");
    expect(result.thread.replies).toHaveLength(2);
    expect(result.thread.replies[1]).toMatchObject({
      author: "reviewer",
      reviewerId: "olivia",
      commentId: "c1",
      deckVersionId: "v1",
    });
    expect(result.thread.replies[1]?.basis).toContain("第 2 页");
    expect(model.replies[0]?.thread.replies).toHaveLength(1);
    expect((await worker.submitReply(request)).id).toBe(a.id);
    expect((await worker.getThread("p1", "c1")).replies).toHaveLength(2);
  });
  it("uses complete multi-round thread and current version after a version change", async () => {
    const { worker, model } = await setup();
    await worker.submitReply(request);
    await worker.runNext();
    const snapshot = fixture();
    snapshot.context.deckVersionId = "v2";
    snapshot.slides.forEach((s) => (s.deckVersionId = "v2"));
    requireValue(snapshot.slides[1]).notes = "新版本补充的来源";
    await worker.putSnapshot(snapshot);
    await worker.submitReply({
      ...request,
      deckVersionId: "v2",
      idempotencyKey: "key2",
    });
    await worker.runNext();
    expect(model.replies[1]?.thread.replies).toHaveLength(3);
    expect(model.replies[1]?.context.deckVersionId).toBe("v2");
    expect(model.replies[1]?.slides[1]?.notes).toBe("新版本补充的来源");
    expect(await worker.listComments("p1")).toHaveLength(1);
  });
  it("retries failure without duplicating user reply", async () => {
    const { worker, model } = await setup();
    let failOnce = true;
    model.reply = async () => {
      await Promise.resolve();
      if (failOnce) {
        failOnce = false;
        fail("timeout", "请求超时");
      }
      return { body: validReply };
    };
    const job = await worker.submitReply(request);
    await worker.runNext();
    expect(
      (await worker.getReplyResult("p1", job.id)).generation.error?.retryable,
    ).toBe(true);
    await worker.retryReply("p1", job.id);
    await worker.runNext();
    expect((await worker.getThread("p1", "c1")).replies).toHaveLength(2);
  });
  it("rejects stale input, conflicting keys, busy thread and cross-project reads", async () => {
    const { worker } = await setup();
    await expect(
      worker.submitReply({ ...request, deckVersionId: "old" }),
    ).rejects.toMatchObject({ failure: { code: "version_conflict" } });
    await worker.submitReply(request);
    await expect(
      worker.submitReply({ ...request, body: "不同内容" }),
    ).rejects.toMatchObject({ failure: { code: "idempotency_conflict" } });
    await expect(
      worker.submitReply({ ...request, idempotencyKey: "key2" }),
    ).rejects.toMatchObject({ failure: { code: "thread_busy" } });
    await expect(worker.getThread("other", "c1")).rejects.toMatchObject({
      failure: { code: "not_found" },
    });
  });
  it("discards stale result when PPT changes during model generation", async () => {
    const { worker, model } = await setup();
    model.reply = async () => {
      await Promise.resolve();
      const snapshot = fixture();
      snapshot.context.deckVersionId = "v2";
      snapshot.slides.forEach((s) => (s.deckVersionId = "v2"));
      await worker.putSnapshot(snapshot);
      return { body: validReply };
    };
    const job = await worker.submitReply(request);
    await worker.runNext();
    const result = await worker.getReplyResult("p1", job.id);
    expect(result.generation.error).toMatchObject({
      code: "version_conflict",
      recovery: "refresh",
    });
    expect(result.thread.replies).toHaveLength(1);
  });
  it("rejects invalid mock model output at the worker boundary", async () => {
    const { worker, model } = await setup();
    model.reply = () => Promise.resolve({ body: "字".repeat(101) });
    const job = await worker.submitReply(request);
    await worker.runNext();
    expect(
      (await worker.getReplyResult("p1", job.id)).generation.error?.code,
    ).toBe("invalid_output");
  });
  it("recovers an expired lease without allowing the old worker to append twice", async () => {
    const { store, model } = await setup();
    let now = 1000,
      release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    model.reply = async () => {
      await Promise.resolve();
      if (first) {
        first = false;
        await wait;
      }
      return { body: validReply };
    };
    const worker = new ReviewWorker(store, model, undefined, () => now);
    const job = await worker.submitReply(request);
    const run = worker.runNext();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    now += 360001;
    await worker.runNext();
    release();
    await run;
    expect(
      (await worker.getReplyResult("p1", job.id)).thread.replies,
    ).toHaveLength(2);
  });
});
describe("analysis worker and storage", () => {
  it("publishes timeline once, reports progress, and reuses unchanged pages", async () => {
    const { worker, model } = await setup();
    const job = await worker.submitAnalysis("p1", "v1", "a");
    expect((await worker.submitAnalysis("p1", "v1", "a")).id).toBe(job.id);
    await worker.runNext();
    const result = await worker.getAnalysisResult("p1", job.id);
    expect(result.generation).toMatchObject({
      state: "completed",
      processedSlides: 3,
    });
    expect(result.result?.context.goal?.source).toBe("ai_suggested");
    await worker.submitAnalysis("p1", "v1", "b");
    await worker.runNext();
    expect(model.analyzed).toHaveLength(3);
  });
  it("does not publish analysis based on a changed context", async () => {
    const { worker, model } = await setup(),
      original = model.synthesize.bind(model);
    model.synthesize = async (input) => {
      const snapshot = fixture();
      snapshot.context.audience = "新的听众";
      await worker.putSnapshot(snapshot);
      return original(input);
    };
    const job = await worker.submitAnalysis("p1", "v1", "a");
    await worker.runNext();
    const result = await worker.getAnalysisResult("p1", job.id);
    expect(result.generation.error?.code).toBe("version_conflict");
    expect(result.result).toBeUndefined();
  });
  it("persists queue through worker recreation and rolls back failed transactions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deck-worker-test-"));
    try {
      const path = join(dir, "state.json"),
        store = new FileWorkerStore(path),
        worker = new ReviewWorker(store, new MockReviewModel());
      await worker.putSnapshot(fixture());
      const job = await worker.submitAnalysis("p1", "v1", "persisted");
      const fresh = new ReviewWorker(
        new FileWorkerStore(path),
        new MockReviewModel(),
      );
      await fresh.runNext();
      expect(
        (await fresh.getAnalysisResult("p1", job.id)).generation.state,
      ).toBe("completed");
      await expect(
        store.transaction((d) => {
          d.snapshots = {};
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect((await store.read()).snapshots.p1).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("durable page cache survives a worker restart", async () => {
  const { AnalysisPipeline } = await import("@deck-rehearsal/ai/runtime");
  const { StoreAnalysisCache } = await import("./cache.js");
  const dir = await mkdtemp(join(tmpdir(), "deck-cache-test-"));
  try {
    const path = join(dir, "state.json"),
      store = new FileWorkerStore(path),
      model = new MockReviewModel();
    const worker = new ReviewWorker(
      store,
      model,
      new AnalysisPipeline(model, new StoreAnalysisCache(store), "test-model"),
    );
    await worker.putSnapshot(fixture());
    await worker.submitAnalysis("p1", "v1", "first");
    await worker.runNext();
    const reopened = new FileWorkerStore(path),
      nextModel = new MockReviewModel(),
      next = new ReviewWorker(
        reopened,
        nextModel,
        new AnalysisPipeline(
          nextModel,
          new StoreAnalysisCache(reopened),
          "test-model",
        ),
      );
    const job = await next.submitAnalysis("p1", "v1", "second");
    await next.runNext();
    expect(nextModel.analyzed).toEqual([]);
    expect(
      (await next.getAnalysisResult("p1", job.id)).result?.reusedSlideIds,
    ).toHaveLength(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("retries failed analysis using successful page cache", async () => {
  const { worker, model } = await setup();
  let broken = true;
  const original = model.synthesize.bind(model);
  model.synthesize = async (input) => {
    if (broken) fail("timeout", "超时");
    return original(input);
  };
  const job = await worker.submitAnalysis("p1", "v1", "retry-analysis");
  await worker.runNext();
  expect((await worker.getAnalysisResult("p1", job.id)).generation.state).toBe(
    "failed",
  );
  broken = false;
  await worker.retryAnalysis("p1", job.id);
  await worker.runNext();
  expect((await worker.getAnalysisResult("p1", job.id)).generation.state).toBe(
    "completed",
  );
  expect(model.analyzed).toHaveLength(3);
});
