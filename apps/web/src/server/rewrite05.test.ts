function present<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("Missing fixture");
  return v;
}
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "rewrite05-"));
  dirs.push(dir);
  const model = new JsonModelGateway({
    apiKey: "",
    model: "test",
    baseUrl: "https://unused.invalid",
  });
  const service = new WorkspaceService(dir, model);
  const project = await service.create(
    {
      name: "test",
      ownerId: "test",
      scenario: "work_report",
      audience: "团队",
      durationMinutes: 10,
    },
    "create",
  );
  await service.upload(project.id, "test.pptx", await makeFixture(3), "upload");
  const snapshot = await service.snapshot(project.id);
  const slide = present(snapshot.slides[1]);
  const element = present(slide.elements.find((e) => e.editable && e.text));
  const selection = {
    deckVersionId: slide.deckVersionId,
    slideId: slide.id,
    elementId: element.id,
    startOffset: 0,
    endOffset: 2,
    selectedText: present(element.text).slice(0, 2),
  };
  return { service, model, project, snapshot, slide, element, selection, dir };
}
it("PPT suggestion has adjacent context, zero decision writes on rejection, atomic concurrent acceptance, warning and real export", async () => {
  const { service, model, project, snapshot, selection, element, slide } =
    await setup();
  const rewrite = vi.spyOn(model, "rewrite").mockResolvedValue({
    replacementText: "清晰表达".repeat(80),
    rationale: "test",
    factsPreserved: true,
    confidence: 1,
  });
  const proposal = await service.suggest(project.id, "ppt", selection);
  expect(rewrite.mock.calls[0]?.[0]).toMatchObject({
    previousSlide: { id: present(snapshot.slides[0]).id },
    nextSlide: { id: present(snapshot.slides[2]).id },
    context: { audience: "团队" },
    selection,
  });
  const before = await service.store.read(); // Declining requires no service call.
  expect((await service.snapshot(project.id)).versions).toEqual(
    snapshot.versions,
  );
  expect(await service.download(project.id, selection.deckVersionId)).toEqual(
    await service.storage.get(present(snapshot.version).storageKey),
  );
  expect(await service.store.read()).toEqual(before);
  const results = await Promise.all([
    service.accept(project.id, proposal.id, proposal.id),
    service.accept(project.id, proposal.id, proposal.id),
  ]);
  expect(results[0]).toEqual(results[1]);
  const next = await service.snapshot(project.id);
  expect(next.versions).toHaveLength(2);
  expect(next.warnings.length).toBeGreaterThan(0);
  expect(
    present(next.slides[1]).elements.find((e) => e.id === element.id)?.text,
  ).toBe(proposal.replacementText + present(element.text).slice(2));
  const detail = await service.versionDetail(
    project.id,
    present(next.version).id,
  );
  expect(detail.operations[0]?.type).toBe("replace_text");
  const parsed = await service.pptx.parse(
    await service.download(project.id, present(next.version).id),
    "export",
  );
  expect(
    parsed.slides
      .find((s) => s.id === slide.id)
      ?.elements.find((e) => e.id === element.id)?.text,
  ).toContain(proposal.replacementText);
  await service.restore(
    project.id,
    present(snapshot.version).id,
    present(next.version).id,
    "restore",
  );
  const restored = await service.snapshot(project.id);
  expect(restored.versions).toHaveLength(3);
  expect(
    await service.download(project.id, present(restored.version).id),
  ).toEqual(await service.download(project.id, present(snapshot.version).id));
});
it("generation releases the writer lock and a concurrent version change invalidates its result", async () => {
  const { service, model, project, selection, slide } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const spy = vi.spyOn(model, "rewrite").mockImplementation(async () => {
    await gate;
    return {
      replacementText: "new",
      rationale: "",
      factsPreserved: true,
      confidence: 1,
    };
  });
  const generating = service.suggest(project.id, "ppt", selection);
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  await service.change(
    project.id,
    selection.deckVersionId,
    [{ type: "set_slide_hidden", slideId: slide.id, hidden: true }],
    "change",
  );
  release();
  await expect(generating).rejects.toMatchObject({ status: 409 });
  expect(Object.keys((await service.store.read()).suggestions)).toHaveLength(0);
});
it("script acceptance validates revision, preserves unrelated formatting, remaps annotations, persists without PPT versions", async () => {
  const { service, model, project, selection, slide, dir } = await setup();
  const initial = present(
    (await service.snapshot(project.id)).documents[slide.id],
  );
  const doc = await service.saveDocument(project.id, {
    ...initial,
    text: "先讲结论，再说依据",
    marks: [{ start: 0, end: 9, kind: "bold" }],
    annotations: [
      {
        id: "a",
        start: 7,
        end: 9,
        text: "来源",
        author: "我",
        createdAt: "now",
      },
    ],
  });
  vi.spyOn(model, "rewriteScript").mockResolvedValue({
    replacementText: "核心结论",
    rationale: "test",
    factsPreserved: true,
    confidence: 1,
  });
  const selected = {
    ...selection,
    elementId: "script",
    startOffset: 2,
    endOffset: 4,
    selectedText: "结论",
  };
  const proposal = await service.suggest(
    project.id,
    "script",
    selected,
    present(doc).revision,
  );
  await service.accept(project.id, proposal.id, "accept");
  const fresh = await new WorkspaceService(dir, model).snapshot(project.id);
  expect(fresh.versions).toHaveLength(1);
  expect(fresh.documents[slide.id]?.text).toBe("先讲核心结论，再说依据");
  expect(fresh.documents[slide.id]?.marks).toEqual([
    { start: 0, end: 11, kind: "bold" },
  ]);
  expect(fresh.documents[slide.id]?.annotations[0]?.start).toBe(9);
  const stale = await service.suggest(project.id, "script", {
    ...selected,
    endOffset: 6,
    selectedText: "核心结论",
  });
  await service.saveDocument(project.id, {
    ...present(fresh.documents[slide.id]),
    text: "新的用户正文",
    marks: [],
    annotations: [],
  });
  await expect(
    service.accept(project.id, stale.id, "stale"),
  ).rejects.toMatchObject({ status: 409 });
});
it("empty script is generated as a reviewable suggestion, and retrying export preserves versions", async () => {
  const { service, model, project, selection, slide } = await setup();
  const doc = present((await service.snapshot(project.id)).documents[slide.id]);
  await service.saveDocument(project.id, { ...doc, text: "" });
  vi.spyOn(model, "rewriteScript").mockResolvedValue({
    replacementText: "本页先讲核心结论。",
    rationale: "test",
    factsPreserved: true,
    confidence: 1,
  });
  const suggestion = await service.suggest(project.id, "script", {
    ...selection,
    elementId: "script",
    startOffset: 0,
    endOffset: 0,
    selectedText: "",
  });
  expect((await service.snapshot(project.id)).documents[slide.id]?.text).toBe(
    "",
  );
  await service.accept(project.id, suggestion.id, "accept-empty");
  expect((await service.snapshot(project.id)).documents[slide.id]?.text).toBe(
    "本页先讲核心结论。",
  );
  const get = vi.spyOn(service.storage, "get");
  get.mockRejectedValueOnce(new Error("读取失败"));
  await expect(
    service.download(project.id, selection.deckVersionId),
  ).rejects.toThrow("读取失败");
  expect(
    (await service.download(project.id, selection.deckVersionId)).length,
  ).toBeGreaterThan(0);
  expect((await service.snapshot(project.id)).versions).toHaveLength(1);
});
