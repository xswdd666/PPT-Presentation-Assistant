import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { LocalWorkspaceStore, repositoryFor } from "@deck-rehearsal/db";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";
import type { AddressInfo } from "node:net";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "upload03-"));
  directories.push(directory);
  const model = new JsonModelGateway({
    apiKey: "",
    model: "test",
    baseUrl: "https://unused.invalid",
  });
  const service = new WorkspaceService(directory, model);
  const input = {
    ownerId: "local-user",
    name: "答辩",
    scenario: "thesis_defense" as const,
    audience: "评委",
    durationMinutes: 15,
  };
  const project = await service.create(input, "create");
  return { directory, model, service, input, project };
}
const output = {
  goal: "阐明研究价值",
  expectedAudienceResponse: "认可研究结论",
  narrativeSummary: "研究与验证",
  reviewers: [],
  comments: [],
};
describe("03 persistent upload flow", () => {
  it.each([1, 15, 30, 60])(
    "accepts %i real PPTX pages and creates one dormant job",
    async (pages) => {
      const { service, project } = await setup();
      const file = await makeFixture(pages);
      const result = await service.upload(
        project.id,
        "deck.pptx",
        file,
        "upload",
      );
      expect(result.job.totalSlides).toBe(pages);
      await service.processNext();
      expect((await service.snapshot(project.id)).uploadState.stage).toBe(
        "ready",
      );
      const duplicate = await service.upload(
        project.id,
        "deck.pptx",
        file,
        "upload",
      );
      expect(duplicate).toEqual(result);
      expect(Object.keys((await service.store.read()).jobs)).toHaveLength(1);
    },
  );
  it("rejects invalid files without source, version or job records", async () => {
    const { service, project } = await setup();
    const valid = await makeFixture(1);
    for (const [name, file, code] of [
      ["bad.pdf", valid, "unsupported_file_type"],
      ["bad.pptx", new Uint8Array([1, 2, 3]), "invalid_pptx"],
      ["empty.pptx", new Uint8Array(), "file_size_exceeded"],
      ["big.pptx", new Uint8Array(50 * 1024 * 1024 + 1), "file_size_exceeded"],
      ["long.pptx", await makeFixture(61), "page_limit_exceeded"],
    ] as const) {
      await expect(
        service.upload(project.id, name, file, name),
      ).rejects.toMatchObject({ code });
      expect((await service.snapshot(project.id)).uploadState.error?.code).toBe(
        code,
      );
      const data = await service.store.read();
      expect(Object.keys(data.sources)).toHaveLength(0);
      expect(Object.keys(data.versions)).toHaveLength(0);
      expect(Object.keys(data.jobs)).toHaveLength(0);
    }
  });
  it("deduplicates concurrent creation/upload/start and protects immutable references", async () => {
    const { service, project, input, directory, model } = await setup();
    const second = new WorkspaceService(directory, model);
    expect(await second.create(input, "create")).toEqual(project);
    const file = await makeFixture(1);
    const [a, b] = await Promise.all([
      service.upload(project.id, "deck.pptx", file, "u"),
      second.upload(project.id, "deck.pptx", file, "u"),
    ]);
    expect(a).toEqual(b);
    const [j, k] = await Promise.all([
      service.analyze(project.id, "", "", "a"),
      second.analyze(project.id, "", "", "a"),
    ]);
    expect(j).toEqual(k);
    await expect(
      service.upload(project.id, "other.pptx", file, "u"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.upload(project.id, "other.pptx", file, "new"),
    ).rejects.toMatchObject({ code: "source_immutable" });
    const data = await service.store.read();
    expect(Object.keys(data.jobs)).toHaveLength(1);
    const r = repositoryFor(data);
    expect(() =>
      r.saveSourceFile({ ...a.sourceFile, storageKey: "changed" }),
    ).toThrow("不可覆盖");
    expect(() =>
      r.saveVersion({ ...a.version, storageKey: "changed" }),
    ).toThrow("不可覆盖");
    await expect(
      service.storage.put(a.sourceFile.storageKey, file),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await service.storage.get(a.sourceFile.storageKey)).toEqual(file);
  });
  it("persists optional targets before upload and keeps suggestions separate after confirmation", async () => {
    const { service, project, directory, model } = await setup();
    await service.saveTargets(project.id, "最新目标", "", 0);
    const restored = new WorkspaceService(directory, model);
    expect(
      (await restored.snapshot(project.id)).uploadState.goal.confirmed,
    ).toBe("最新目标");
    await service.upload(project.id, "deck.pptx", await makeFixture(1), "u");
    vi.spyOn(model, "analyze").mockResolvedValue(output);
    await service.analyze(project.id, "最新目标", "", "a");
    await restored.processNext();
    let snapshot = await service.snapshot(project.id);
    expect(snapshot.context?.goal).toEqual({
      value: "最新目标",
      source: "user_confirmed",
    });
    expect(snapshot.context?.expectedAudienceResponse?.source).toBe(
      "ai_suggested",
    );
    expect(snapshot.uploadState.goal.suggestion).toBe(output.goal);
    await service.saveTargets(
      project.id,
      "覆盖目标",
      output.expectedAudienceResponse,
      snapshot.uploadState.revision,
    );
    snapshot = await restored.snapshot(project.id);
    expect(snapshot.uploadState.goal.confirmed).toBe("覆盖目标");
    expect(snapshot.uploadState.goal.suggestion).toBe(output.goal);
    expect(snapshot.context?.expectedAudienceResponse?.source).toBe(
      "ai_suggested",
    );
    await service.saveTargets(
      project.id,
      "覆盖目标",
      output.expectedAudienceResponse,
      snapshot.uploadState.revision,
      true,
    );
    expect(
      (await restored.snapshot(project.id)).context?.expectedAudienceResponse
        ?.source,
    ).toBe("user_confirmed");
    await expect(
      service.saveTargets(project.id, "旧编辑", "", 0),
    ).rejects.toMatchObject({ code: "target_conflict" });
  });
  it("restores queued/slow jobs, rejects edits during analysis and retries the same failed job", async () => {
    const { service, project, directory, model } = await setup();
    await service.upload(project.id, "deck.pptx", await makeFixture(1), "u");
    const { job } = await service.analyze(project.id, "", "", "a");
    let release: (value: typeof output) => void = () => {
      throw Error("not started");
    };
    vi.spyOn(model, "analyze").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const work = service.processNext();
    await vi.waitFor(async () =>
      expect((await service.snapshot(project.id)).uploadState.stage).toBe(
        "analyzing",
      ),
    );
    const restored = new WorkspaceService(directory, model);
    expect((await restored.snapshot(project.id)).job?.id).toBe(job.id);
    await expect(
      service.saveTargets(project.id, "changed", "", 1),
    ).rejects.toMatchObject({ code: "analysis_busy" });
    await service.cancelAnalysis(project.id);
    const retried = await service.retryAnalysis(project.id, job.id, "retry");
    release(output);
    await work;
    expect((await restored.snapshot(project.id)).uploadState.stage).toBe(
      "queued",
    );
    expect(await service.retryAnalysis(project.id, job.id, "retry")).toEqual(
      retried,
    );
    vi.spyOn(model, "analyze").mockRejectedValueOnce(
      new Error("temporary failure"),
    );
    await restored.processNext();
    expect(
      (await service.snapshot(project.id)).uploadState.error,
    ).toMatchObject({ code: "analysis_failed", retryable: true });
    await service.retryAnalysis(project.id, job.id, "retry2");
    vi.spyOn(model, "analyze").mockResolvedValue(output);
    await service.processNext();
    expect((await restored.snapshot(project.id)).uploadState.stage).toBe(
      "completed",
    );
    expect(Object.keys((await restored.store.read()).jobs)).toHaveLength(1);
  });
  it("publishes renderer progress only while a renderer is actually running", async () => {
    const { service, project, directory, model } = await setup();
    await service.upload(project.id, "deck.pptx", await makeFixture(2), "u");
    await service.analyze(project.id, "", "", "a");
    let release: (value: Uint8Array) => void = () => {
      throw Error("not rendering");
    };
    const render = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Uint8Array>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(new Uint8Array([1]));
    vi.spyOn(model, "analyze").mockResolvedValue(output);
    const rendererService = new WorkspaceService(directory, model, { render });
    const work = rendererService.processNext();
    await vi.waitFor(async () =>
      expect((await service.snapshot(project.id)).uploadState.stage).toBe(
        "rendering",
      ),
    );
    expect((await service.snapshot(project.id)).job?.processedSlides).toBe(0);
    release(new Uint8Array([1]));
    await work;
    const snapshot = await service.snapshot(project.id);
    expect(snapshot.uploadState.stage).toBe("completed");
    expect(snapshot.slides.every((s) => s.renderStorageKey)).toBe(true);
  });
  it("loads existing snapshots without migration and serializes transactions across store instances", async () => {
    const { service, directory, project } = await setup();
    const data = JSON.parse(
      await readFile(join(directory, "workspace.json"), "utf8"),
    ) as Record<string, unknown>;
    delete data.uploadStates;
    await writeFile(join(directory, "workspace.json"), JSON.stringify(data));
    expect((await service.snapshot(project.id)).uploadState.stage).toBe(
      "waiting_upload",
    );
    const second = new LocalWorkspaceStore(directory);
    await Promise.all([
      service.store.transaction((d) => {
        d.routes.one = [];
      }),
      second.transaction((d) => {
        d.routes.two = [];
      }),
    ]);
    expect(Object.keys((await service.store.read()).routes)).toEqual([
      "one",
      "two",
    ]);
  });
  it("checks MIME at HTTP boundary and accepts blank target payload", async () => {
    const { service, project } = await setup();
    const server = createApplication(service);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url =
      "http://127.0.0.1:" +
      String((server.address() as AddressInfo).port) +
      "/api/projects/" +
      project.id;
    try {
      const response = await fetch(url + "/upload?name=file.pptx", {
        method: "POST",
        headers: { "content-type": "text/plain", "idempotency-key": "u" },
        body: "invalid",
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({
        code: "unsupported_mime",
        retryable: false,
      });
      await service.upload(project.id, "deck.pptx", await makeFixture(1), "u");
      const started = await fetch(url + "/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "a" },
        body: "{}",
      });
      expect(started.status).toBe(202);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
