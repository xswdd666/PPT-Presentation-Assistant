import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelGateway } from "@deck-rehearsal/contracts";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { IntegratedWorkspaceService } from "./integrated-service.js";
import { MockReviewModel } from "@deck-rehearsal/ai/testing";
import { ManuscriptGenerator, queueManuscript } from "./manuscript.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "manuscript-"));
  dirs.push(dir);
  const service = new WorkspaceService(
    dir,
    new JsonModelGateway({ apiKey: "", model: "", baseUrl: "" }),
  );
  const project = await service.create(
    {
      name: "讲稿测试",
      ownerId: "test",
      scenario: "work_report",
      audience: "评审人",
      durationMinutes: 10,
    },
    "create",
  );
  await service.upload(project.id, "deck.pptx", await makeFixture(5), "upload");
  return { service, id: project.id };
}
const pagesFor = (input: Parameters<ModelGateway["createScript"]>[0]) => ({
  pages: (input.targetSlideIds ?? []).map((slideId) => ({
    slideId,
    purpose: "说明",
    keyMessage: "结论",
    speakingOrder: ["结论", "依据"],
    narration: `承接上一页的讨论，本页说明 ${String(input.slides.find((s) => s.id === slideId)?.index)} 的核心内容。下一页进一步解释。`,
    durationSeconds: 60,
    optionalContent: [],
    likelyQuestions: [],
  })),
});

it("automatically writes every page after analysis completes using the runtime model", async () => {
  const { service, id } = await setup();
  const createScript = vi.fn<ModelGateway["createScript"]>((input) =>
    Promise.resolve(pagesFor(input)),
  );
  const integrated = new IntegratedWorkspaceService(
    service.store.directory,
    service.model,
    Object.assign(new MockReviewModel(), { createScript }),
  );
  await integrated.analyze(id, "讲清项目价值", "获得反馈", "analysis");
  await integrated.processNext();
  const view = await integrated.snapshot(id);
  expect(view.uploadState.stage).toBe("completed");
  expect(view.scriptGeneration?.state).toBe("completed");
  expect(view.slides.every((s) => view.documents[s.id]?.revision === 1)).toBe(
    true,
  );
  expect(createScript).toHaveBeenCalledTimes(2);
});

it("generates the whole deck in batches with full context, resumes cached batches after restart, and preserves user edits", async () => {
  const { service, id } = await setup();
  const view = await service.snapshot(id);
  const first = view.slides[0];
  if (!first) throw new Error("Missing slide");
  let fail = true;
  const createScript = vi
    .fn<ModelGateway["createScript"]>()
    .mockImplementation(async (input) => {
      if (input.targetSlideIds?.length === 1 && fail)
        throw new Error("network failure");
      if (input.targetSlideIds?.length === 4) {
        const doc = (await service.snapshot(id)).documents[first.id];
        if (!doc) throw new Error("Missing doc");
        await service.saveDocument(id, {
          ...doc,
          text: "用户在生成期间修改的讲稿",
        });
      }
      return pagesFor(input);
    });
  await service.generateManuscript(id);
  await new ManuscriptGenerator(service.store, { createScript }).runNext();
  let saved = await service.snapshot(id);
  expect(saved.scriptGeneration).toMatchObject({
    state: "failed",
    processedSlides: 4,
  });
  expect(saved.documents[first.id]?.text).toBe("用户在生成期间修改的讲稿");
  expect(createScript.mock.calls[0]?.[0].slides).toHaveLength(5);
  expect(createScript.mock.calls[1]?.[0].previousNarration).toContain(
    "4 的核心内容",
  );
  fail = false;
  await service.generateManuscript(id);
  await new ManuscriptGenerator(service.store, { createScript }).runNext();
  saved = await service.snapshot(id);
  expect(saved.scriptGeneration).toMatchObject({
    state: "completed",
    processedSlides: 5,
  });
  expect(saved.slides.every((s) => saved.documents[s.id]?.text.trim())).toBe(
    true,
  );
  expect(createScript).toHaveBeenCalledTimes(3);
  await service.generateManuscript(id);
  await new ManuscriptGenerator(service.store, { createScript }).runNext();
  expect(createScript).toHaveBeenCalledTimes(3);
});

it("rejects missing/duplicate output without writing incomplete drafts", async () => {
  const { service, id } = await setup();
  const before = (await service.snapshot(id)).documents;
  await service.generateManuscript(id);
  await new ManuscriptGenerator(service.store, {
    createScript: () => Promise.resolve({ pages: [] }),
  }).runNext();
  const after = await service.snapshot(id);
  expect(after.scriptGeneration?.state).toBe("failed");
  expect(after.documents).toEqual(before);
});

it("does not publish generated text if the project was deleted during the model call", async () => {
  const { service, id } = await setup();
  await service.store.transaction((d) => queueManuscript(d, id));
  await new ManuscriptGenerator(service.store, {
    createScript: async (input) => {
      await service.store.transaction((d) => {
        Reflect.deleteProperty(d.projects, id);
        Reflect.deleteProperty(d.documents, id);
        if (d.scriptGenerations)
          Reflect.deleteProperty(d.scriptGenerations, id);
      });
      return pagesFor(input);
    },
  }).runNext();
  expect((await service.store.read()).documents[id]).toBeUndefined();
});
