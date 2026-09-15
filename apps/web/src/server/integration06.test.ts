import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { MockReviewModel, requireValue } from "@deck-rehearsal/ai/testing";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { IntegratedWorkspaceService } from "./integrated-service.js";
import { createApplication } from "./http.js";
import type { IntegratedData } from "./worker-store.js";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup(pages = 6) {
  const dir = await mkdtemp(join(tmpdir(), "integration06-"));
  dirs.push(dir);
  const model = new MockReviewModel();
  const legacy = new JsonModelGateway({
    apiKey: "",
    baseUrl: "https://unused.invalid",
    model: "",
  });
  const service = new IntegratedWorkspaceService(dir, legacy, model);
  const project = await service.create(
    {
      name: "集成验收",
      ownerId: "test",
      scenario: "work_report",
      audience: "评审组",
      durationMinutes: 15,
    },
    "create",
  );
  const file = await makeFixture(pages);
  await service.upload(project.id, "real.pptx", file, "upload");
  return { dir, model, legacy, service, project, file };
}
async function analyze(service: IntegratedWorkspaceService, id: string) {
  await service.analyze(id, "确认的目标", "", "analysis");
  await service.processNext();
  expect((await service.snapshot(id)).uploadState.stage).toBe("completed");
}
it("06 real modules: analysis, durable replies, rejected/accepted edits, script annotations and export", async () => {
  const { service, model, legacy, project, file, dir } = await setup();
  await analyze(service, project.id);
  let view = await service.snapshot(project.id);
  expect(view.context?.goal).toEqual({
    value: "确认的目标",
    source: "user_confirmed",
  });
  expect(view.comments.length).toBeGreaterThan(0);
  const comment = requireValue(view.comments[0]);
  const input = {
    projectId: project.id,
    commentId: comment.id,
    body: "请说明证据",
    deckVersionId: requireValue(view.version).id,
    idempotencyKey: "reply",
  };
  const [a, b] = await Promise.all([
    service.worker.submitReply(input),
    service.worker.submitReply(input),
  ]);
  expect(a.id).toBe(b.id);
  expect((await service.thread(project.id, comment.id)).replies).toHaveLength(
    1,
  );
  const restarted = new IntegratedWorkspaceService(dir, legacy, model);
  await restarted.processNext();
  expect(
    (await restarted.worker.getReplyResult(project.id, a.id)).thread.replies,
  ).toHaveLength(2);
  const slide = requireValue(view.slides[1]);
  const element = requireValue(
    slide.elements.find((e) => e.text?.startsWith("本季度")),
  );
  const selection = {
    deckVersionId: requireValue(view.version).id,
    slideId: slide.id,
    elementId: element.id,
    startOffset: 0,
    endOffset: 3,
    selectedText: "本季度",
  };
  const proposal = await service.suggest(project.id, "ppt", selection);
  const stale = await service.suggest(project.id, "ppt", selection);
  const document = requireValue(view.documents[slide.id]);
  await service.suggest(
    project.id,
    "script",
    {
      ...selection,
      elementId: slide.id,
      selectedText: document.text.slice(0, 3),
    },
    document.revision,
  );
  // Undecided/rejected proposals do not touch a file, script or version.
  expect((await service.snapshot(project.id)).documents).toEqual(
    view.documents,
  );
  expect((await service.snapshot(project.id)).versions).toHaveLength(1);
  expect(await service.download(project.id, selection.deckVersionId)).toEqual(
    file,
  );
  expect(model.rewrites[0]?.previousSlide?.id).toBe(view.slides[0]?.id);
  expect(model.rewrites[0]?.nextSlide?.id).toBe(view.slides[2]?.id);
  await Promise.all([
    service.accept(project.id, proposal.id, proposal.id),
    service.accept(project.id, proposal.id, proposal.id),
  ]);
  await expect(service.accept(project.id, stale.id, stale.id)).rejects.toThrow(
    "版本已变化",
  );
  await service.saveDocument(project.id, {
    ...document,
    marks: [{ start: 0, end: 3, kind: "bold" }],
    annotations: [
      {
        id: "note",
        start: 0,
        end: 3,
        text: "强调",
        author: "我",
        createdAt: "2026-09-15T00:00:00Z",
      },
    ],
  });
  view = await restarted.snapshot(project.id);
  expect(view.versions).toHaveLength(2);
  expect(view.documents[slide.id]?.annotations).toHaveLength(1);
  const parsed = await service.pptx.parse(
    await service.download(project.id, requireValue(view.version).id),
    "export",
  );
  expect(
    parsed.slides[1]?.elements.find((e) => e.id === element.id)?.text,
  ).toContain("本季度（明确）");
  expect(await service.download(project.id, selection.deckVersionId)).toEqual(
    file,
  );
  await restarted.processNext();
  const data = (await service.store.read()) as IntegratedData;
  expect(
    Object.values(data.aiWorker?.analysis ?? {}).at(-1)?.reusedSlideIds,
  ).toHaveLength(5);
}, 30000);

it.each([1, 15, 30, 60])(
  "06 accepts %i real pages, completes analysis and exports",
  async (pages) => {
    const start = performance.now();
    const { service, project, file } = await setup(pages);
    const parsedMs = performance.now() - start;
    await analyze(service, project.id);
    const view = await service.snapshot(project.id);
    expect(view.slides).toHaveLength(pages);
    expect(view.job?.processedSlides).toBe(pages);
    expect(
      await service.download(project.id, requireValue(view.version).id),
    ).toEqual(file);
    if (pages === 60) {
      await mkdir("artifacts/integration06", { recursive: true });
      await writeFile(
        "artifacts/integration06/performance.json",
        JSON.stringify(
          {
            pages,
            fixtureAndUploadMs: parsedMs,
            uploadAndDeterministicAnalysisMs: performance.now() - start,
            externalModel: false,
          },
          null,
          2,
        ),
      );
      await service.change(
        project.id,
        requireValue(view.version).id,
        [
          {
            type: "reorder_slides",
            slideIds: view.slides.map((s) => s.id).reverse(),
          },
        ],
        "reorder",
      );
      await service.processNext();
      const data = (await service.store.read()) as IntegratedData;
      expect(
        Object.values(data.aiWorker?.analysis ?? {}).at(-1)?.reusedSlideIds,
      ).toHaveLength(60);
    }
  },
  30000,
);

it("06 analysis failure/cancel and reply retry retain one user turn and release write transactions", async () => {
  const { service, project, model } = await setup(1);
  vi.spyOn(model, "analyzePage").mockRejectedValueOnce(
    new Error("secret payload"),
  );
  await service.analyze(project.id, "", "", "analysis");
  await service.processNext();
  let view = await service.snapshot(project.id);
  expect(view.uploadState.stage).toBe("failed");
  expect(JSON.stringify(view)).not.toContain("secret payload");
  await service.retryAnalysis(project.id, requireValue(view.job).id, "retry");
  await service.processNext();
  view = await service.snapshot(project.id);
  expect(view.uploadState.stage).toBe("completed");
  const comment = requireValue(view.comments[0]);
  const generation = await service.worker.submitReply({
    projectId: project.id,
    commentId: comment.id,
    body: "继续",
    deckVersionId: requireValue(view.version).id,
    idempotencyKey: "reply",
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.spyOn(model, "reply").mockImplementationOnce(async () => {
    await gate;
    throw new Error("provider secret");
  });
  const work = service.processNext();
  await vi.waitFor(async () =>
    expect((await service.thread(project.id, comment.id)).generation).toBe(
      "generating",
    ),
  );
  const doc = requireValue(view.documents[requireValue(view.slides[0]).id]);
  await service.saveDocument(project.id, { ...doc, text: "并行保存" });
  release();
  await work;
  expect((await service.thread(project.id, comment.id)).replies).toHaveLength(
    1,
  );
  await service.worker.retryReply(project.id, generation.id);
  await service.processNext();
  expect((await service.thread(project.id, comment.id)).replies).toHaveLength(
    2,
  );
  await service.analyze(project.id, "新目标", "", "again");
  await service.cancelAnalysis(project.id);
  await service.processNext();
  expect((await service.snapshot(project.id)).uploadState.stage).toBe(
    "cancelled",
  );
}, 30000);

it("06 async HTTP returns 202, persists status, rejects cross-project access and sanitizes errors", async () => {
  const { service, project } = await setup();
  await analyze(service, project.id);
  const view = await service.snapshot(project.id),
    comment = requireValue(view.comments[0]);
  const logs: unknown[] = [];
  const server = createApplication(service, undefined, (entry) =>
    logs.push(entry),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  try {
    const response = await fetch(
      `${base}/api/projects/${project.id}/thread/${comment.id}/replies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "http-reply",
        },
        body: JSON.stringify({ body: "补充依据", versionId: view.version?.id }),
      },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const generation = (await response.json()) as { id: string };
    expect(
      (await fetch(`${base}/api/projects/other/replies/${generation.id}`))
        .status,
    ).toBe(404);
    await service.processNext();
    expect(
      await (
        await fetch(
          `${base}/api/projects/${project.id}/replies/${generation.id}`,
        )
      ).json(),
    ).toMatchObject({ generation: { state: "completed" } });
    vi.spyOn(service, "download").mockRejectedValueOnce(
      new Error("SECRET /private/file"),
    );
    const failure = await fetch(
      `${base}/api/projects/${project.id}/download/${requireValue(view.version).id}`,
    );
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("SECRET");
    expect(logs).toContainEqual(
      expect.objectContaining({
        requestId: response.headers.get("x-request-id"),
        statusCode: 202,
      }),
    );
    expect(JSON.stringify(logs)).not.toContain("补充依据");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}, 30000);
