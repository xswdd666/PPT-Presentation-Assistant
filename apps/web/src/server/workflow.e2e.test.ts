function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";
import type { AddressInfo } from "node:net";
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "deck-rehearsal-test-"));
  directories.push(dir);
  const model = new JsonModelGateway({
    apiKey: "",
    baseUrl: "https://model.invalid",
    model: "test",
  });
  const service = new WorkspaceService(dir, model);
  const project = await service.create(
    {
      ownerId: "test",
      name: "季度复盘",
      scenario: "work_report",
      audience: "产品团队",
      durationMinutes: 15,
    },
    "create",
  );
  return { service, model, project, dir };
}
describe("persistent real-file workflow", () => {
  it("uploads, analyzes, replies, rewrites, annotates, restores and exports", async () => {
    const { service, model, project, dir } = await setup();
    const file = await makeFixture(3);
    const uploaded = await service.upload(
      project.id,
      "review.pptx",
      file,
      "upload",
    );
    expect(
      await service.upload(project.id, "review.pptx", file, "upload"),
    ).toEqual(uploaded);
    const initial = await service.snapshot(project.id);
    const slide = present(initial.slides[1]);
    const element = present(
      slide.elements.find((e) => e.text?.includes("本季度")),
    );
    vi.spyOn(model, "analyze").mockResolvedValue({
      goal: "说明增长原因",
      expectedAudienceResponse: "确定下一阶段方向",
      narrativeSummary: "复盘与验证",
      reviewers: [
        { id: "jack", reason: "决策" },
        { id: "olivia", reason: "证据" },
        { id: "sophie", reason: "理解" },
      ],
      comments: ["jack", "olivia", "sophie"].map((reviewerId) => ({
        reviewerId,
        slideId: slide.id,
        body: "这一页已经给出了增长结论，但听众仍然需要知道指标口径以及变化发生的时间范围。建议补充对比基准和数据来源，再解释下一步如何验证，帮助团队判断结论是否可靠。",
        evidence: "转化率提升20%",
        impact: "缺少基准",
        suggestedAction: "补充对比口径",
      })),
    });
    await service.analyze(project.id, "用户确认的目标", "", "analysis");
    await service.processNext();
    let snapshot = await service.snapshot(project.id);
    expect(snapshot.job?.stage).toBe("completed");
    expect(snapshot.context?.goal?.value).toBe("用户确认的目标");
    expect(snapshot.context?.expectedAudienceResponse?.source).toBe(
      "ai_suggested",
    );
    expect(snapshot.comments).toHaveLength(3);
    const reply = vi.spyOn(model, "reply").mockResolvedValue({
      body: "请把这项指标对应的时间区间补充在页面上，并说明对比对象，这样听众才能理解增长的依据。",
    });
    const comment = present(snapshot.comments[0]);
    const thread = await service.reply(
      project.id,
      comment.id,
      "怎样补充？",
      uploaded.version.id,
      "reply",
    );
    await service.reply(
      project.id,
      comment.id,
      "怎样补充？",
      uploaded.version.id,
      "reply",
    );
    expect(thread.replies).toHaveLength(2);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]?.[0].thread.replies[0]?.body).toBe("怎样补充？");
    reply.mockRejectedValueOnce(new Error("模型超时"));
    await expect(
      service.reply(
        project.id,
        comment.id,
        "继续说明",
        uploaded.version.id,
        "retry-reply",
      ),
    ).rejects.toThrow("模型超时");
    expect((await service.thread(project.id, comment.id)).replies).toHaveLength(
      2,
    );
    await service.reply(
      project.id,
      comment.id,
      "继续说明",
      uploaded.version.id,
      "retry-reply",
    );
    expect((await service.thread(project.id, comment.id)).replies).toHaveLength(
      4,
    );
    const rewrite = vi.spyOn(model, "rewrite").mockResolvedValue({
      replacementText: "本期",
      rationale: "更简洁",
      factsPreserved: true,
      confidence: 0.9,
    });
    const selection = {
      deckVersionId: uploaded.version.id,
      slideId: slide.id,
      elementId: element.id,
      startOffset: 0,
      endOffset: 3,
      selectedText: "本季度",
    };
    const suggestion = await service.suggest(project.id, "ppt", selection);
    expect((await service.snapshot(project.id)).versions).toHaveLength(1);
    expect(await service.download(project.id, uploaded.version.id)).toEqual(
      file,
    );
    expect(rewrite.mock.calls[0]?.[0].previousSlide?.id).toBe(
      initial.slides[0]?.id,
    );
    expect(rewrite.mock.calls[0]?.[0].nextSlide?.id).toBe(
      initial.slides[2]?.id,
    );
    const stale = await service.suggest(project.id, "ppt", selection);
    await service.accept(project.id, suggestion.id, "accept");
    await service.accept(project.id, suggestion.id, "accept");
    snapshot = await service.snapshot(project.id);
    expect(snapshot.versions).toHaveLength(2);
    expect(
      snapshot.slides[1]?.elements.find((e) => e.id === element.id)?.text,
    ).toContain("本期");
    expect(snapshot.warnings.length).toBeGreaterThan(0);
    await expect(service.accept(project.id, stale.id, "stale")).rejects.toThrow(
      "版本已变化",
    );
    expect(await service.download(project.id, uploaded.version.id)).toEqual(
      file,
    );
    const document = present(snapshot.documents[slide.id]);
    await service.saveDocument(project.id, {
      ...document,
      text: "讲清楚结论，再说依据",
      marks: [{ start: 0, end: 3, kind: "bold" }],
      annotations: [
        {
          id: "a",
          start: 0,
          end: 3,
          text: "放慢语速",
          author: "我",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const restarted = new WorkspaceService(dir, model);
    expect(
      (await restarted.snapshot(project.id)).documents[slide.id]?.annotations,
    ).toHaveLength(1);
    const restored = await service.restore(
      project.id,
      uploaded.version.id,
      present(snapshot.version).id,
      "restore",
    );
    expect(restored.versionNumber).toBe(3);
    expect(await service.download(project.id, restored.id)).toEqual(file);
  });
  it("rolls back failed replies, prevents key reuse and retains recoverable analysis failures", async () => {
    const { service, project } = await setup();
    await expect(
      service.upload(project.id, "bad.pdf", new Uint8Array([1]), "bad"),
    ).rejects.toThrow("PPTX");
    expect((await service.snapshot(project.id)).versions).toHaveLength(0);
    await service.upload(project.id, "ok.pptx", await makeFixture(1), "ok");
    await service.analyze(project.id, "", "", "analysis");
    await service.processNext();
    expect((await service.snapshot(project.id)).job?.failureReason).toContain(
      "尚未配置模型",
    );
    await expect(
      service.create(
        {
          ownerId: "test",
          name: "different",
          scenario: "work_report",
          audience: "团队",
          durationMinutes: 15,
        },
        "create",
      ),
    ).rejects.toThrow("重复请求");
  });
  it("serves direct routes and rejects cross-site writes through HTTP", async () => {
    const { service, project } = await setup();
    const server = createApplication(service);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      expect(
        (await fetch(`${base}/projects/${project.id}/review?comment=test`))
          .status,
      ).toBe(200);
      expect(
        await (await fetch(`${base}/api/projects/${project.id}`)).json(),
      ).toMatchObject({ project: { id: project.id } });
      const rejected = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: {
          origin: "https://unrelated.invalid",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(rejected.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
