import { expect, it } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { CoachAction, CoachModel } from "@deck-rehearsal/contracts";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { MockReviewModel } from "@deck-rehearsal/ai/testing";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { IntegratedWorkspaceService } from "./integrated-service.js";
import { createApplication } from "./http.js";

it("runs and restores the coach plan, tools and summary in the browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coach-ui-"));
  const actions: CoachAction[] = [
    {
      type: "set_plan",
      items: [
        { id: "structure", title: "检查叙事结构", criterion: "重点与目标一致" },
        { id: "duration", title: "核对讲稿时长", criterion: "不超过限定时间" },
        { id: "proposal", title: "形成改进提案", criterion: "每项有页面依据" },
      ],
    },
    {
      type: "call_tool",
      callId: "deck",
      tool: "inspect_deck",
      input: { includeScripts: false },
      reason: "先了解全篇目录",
    },
    {
      type: "call_tool",
      callId: "duration",
      tool: "check_narrative",
      input: { focus: "duration" },
      reason: "检查限定时长",
    },
    { type: "complete", summary: "已完成结构和时长检查。" },
  ];
  const coach: CoachModel = {
    next: () => {
      const action = actions.shift();
      if (!action) throw new Error("missing coach action");
      return Promise.resolve(action);
    },
  };
  const service = new IntegratedWorkspaceService(
    dir,
    new JsonModelGateway({ apiKey: "", model: "", baseUrl: "" }),
    new MockReviewModel(),
    "coach-e2e",
    coach,
  );
  const project = await service.create(
    {
      name: "教练演示",
      ownerId: "test",
      scenario: "work_report",
      audience: "老师",
      durationMinutes: 10,
    },
    "create",
  );
  await service.upload(
    project.id,
    "deck.pptx",
    await makeFixture(3, true),
    "upload",
  );
  const bundle = await build({
    entryPoints: [resolve("apps/web/src/client/app.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const server = createApplication(service, {
    js: bundle.outputFiles[0]?.text ?? "",
    css: await readFile("apps/web/src/client/styles.css", "utf8"),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/projects/${project.id}/review`,
    );
    await page.getByRole("button", { name: "教练", exact: true }).click();
    await ui(page.getByRole("heading", { name: "汇报教练" })).toBeVisible();
    await page.getByRole("button", { name: "开始教练分析" }).click();
    await service.processNext();
    await page.reload();
    await ui(page.getByText("检查叙事结构")).toBeVisible();
    await service.processNext();
    await service.processNext();
    await service.processNext();
    await ui(page.getByText("已完成结构和时长检查。")).toBeVisible({
      timeout: 7000,
    });
    await ui(page.locator(".coach-timeline article")).toHaveCount(4);
    expect((await service.coach.getCurrent(project.id))?.state).toBe(
      "completed",
    );
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
