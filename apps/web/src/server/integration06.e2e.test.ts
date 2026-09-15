import { it, expect, vi } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { MockReviewModel, requireValue } from "@deck-rehearsal/ai/testing";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { IntegratedWorkspaceService } from "./integrated-service.js";
import { createApplication } from "./http.js";

async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await writeFile(
    `artifacts/integration06/${name}-axe.json`,
    JSON.stringify(result, null, 2),
  );
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function visual(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const actual = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    style: "time { visibility: hidden !important; }",
  });
  await writeFile(`artifacts/integration06/${name}.png`, actual);
  const path = resolve(`tests/visual/${process.platform}/${name}.png`);
  if (process.env.UPDATE_VISUAL === "1") {
    await mkdir(resolve(`tests/visual/${process.platform}`), {
      recursive: true,
    });
    await writeFile(path, actual);
    return;
  }
  const baseline = PNG.sync.read(await readFile(path)),
    current = PNG.sync.read(actual);
  expect([current.width, current.height]).toEqual([
    baseline.width,
    baseline.height,
  ]);
  const diff = new PNG({ width: current.width, height: current.height });
  const count = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    current.width,
    current.height,
    { threshold: 0.15 },
  );
  await writeFile(
    `artifacts/integration06/${name}-diff.png`,
    PNG.sync.write(diff),
  );
  expect(count / (current.width * current.height)).toBeLessThan(0.005);
}
it("06 browser: upload → worker → page 6 thread → diff → annotations → actual PPTX, keyboard/a11y/visual", async () => {
  const directory = await mkdtemp(join(tmpdir(), "integration06-browser-"));
  const model = new MockReviewModel();
  const synthesis = model.synthesize.bind(model);
  vi.spyOn(model, "synthesize").mockImplementation(async (input) => {
    const result = await synthesis(input);
    return {
      ...result,
      comments: result.comments.map((c) => ({
        ...c,
        slideId: requireValue(input.slides.at(-1)).id,
      })),
    };
  });
  const service = new IntegratedWorkspaceService(
    directory,
    new JsonModelGateway({
      apiKey: "",
      model: "",
      baseUrl: "https://unused.invalid",
    }),
    model,
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
  const fonts = await build({
    entryPoints: [
      resolve(
        "apps/web/node_modules/@fontsource-variable/noto-sans-sc/index.css",
      ),
    ],
    bundle: true,
    write: false,
    loader: { ".woff2": "dataurl" },
  });
  const server = createApplication(service, {
    js: bundle.outputFiles[0]?.text ?? "",
    css:
      (fonts.outputFiles[0]?.text ?? "") +
      (await readFile("apps/web/src/client/styles.css", "utf8")) +
      ':root { font-family: "Noto Sans SC Variable", sans-serif; }',
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1024 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("artifacts/integration06", { recursive: true });
  try {
    await page.goto(base + "/projects/new");
    await page.getByLabel("汇报主题").fill("季度成果评审");
    await page.getByLabel("真实听众").fill("项目评审组");
    await page.getByRole("button", { name: "创建并上传 PPTX →" }).click();
    await ui(page.getByLabel("选择 PPTX 文件")).toBeAttached();
    await page.getByLabel("选择 PPTX 文件").setInputFiles({
      name: "real-6.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from(await makeFixture(6)),
    });
    await page.getByRole("button", { name: "上传文稿", exact: true }).click();
    await ui(page.getByText("已解析 6 页", { exact: false })).toBeVisible();
    const projectId = requireValue(/projects\/([^/]+)/.exec(page.url())?.[1]);
    await page
      .getByRole("button", { name: "开始 AI 分析", exact: true })
      .click();
    await ui(
      page.getByRole("button", { name: "取消分析", exact: true }),
    ).toBeVisible();
    await service.processNext();
    await ui(page).toHaveURL(/\/review(?:\?|$)/, { timeout: 15000 });
    await page
      .getByRole("button", { name: /定位第 6 页/ })
      .first()
      .click();
    await ui(page).toHaveURL(/slide=/);
    await ui(page.locator(".canvas-actions")).toContainText("6 / 6");
    await page
      .getByRole("button", { name: "回复 ↗", exact: true })
      .first()
      .click();
    await ui(page.locator(".reply-form textarea")).toBeVisible();
    await page.locator(".reply-form textarea").fill("请说明这页的统计口径");
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await ui(page.locator(".reply.user")).toHaveCount(1);
    // Queued state survives refresh; another service instance consumes durable work.
    await page.reload();
    await new IntegratedWorkspaceService(
      directory,
      new JsonModelGateway({ apiKey: "", model: "", baseUrl: "" }),
      model,
    ).processNext();
    await ui(page.locator(".reply.reviewer")).toHaveCount(1, {
      timeout: 10000,
    });
    await ui(page.locator(".reply.reviewer small")).toContainText(
      "第 6 页与版本 V1",
    );
    await audit(page, "thread-desktop");
    await page.locator(".thread-scroll").evaluate((node) => {
      node.scrollTop = 0;
    });
    await visual(page, "thread-1440");
    await page.getByRole("button", { name: "← 评论详情" }).click();
    const splitter = page.getByRole("separator", { name: "调整评审面板宽度" });
    await splitter.focus();
    await splitter.press("ArrowLeft");
    await splitter.press("Enter");
    await ui(splitter).toHaveAttribute("aria-valuenow", "360");
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      if (viewport.width === 390) {
        await page
          .getByRole("button", { name: "评审与导航", exact: true })
          .click();
        await ui(page.locator(".review-panel")).toBeVisible();
      }
      await audit(page, `review-${String(viewport.width)}`);
      await visual(page, `review-${String(viewport.width)}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (viewport.width === 390) await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 1024 });
    const target = page.locator(".selectable-text").first();
    await target.focus();
    await target.press("Enter");
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await page.getByRole("button", { name: "不接受", exact: true }).click();
    expect((await service.snapshot(projectId)).versions).toHaveLength(1);
    await target.focus();
    await target.press("Enter");
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await ui(page.getByRole("dialog")).toHaveCount(0);
    await vi.waitFor(async () =>
      expect((await service.snapshot(projectId)).versions).toHaveLength(2),
    );
    const editor = page.getByRole("textbox", { name: "本页汇报稿正文" });
    await editor.fill("先讲清楚结论，再说明依据");
    await editor.evaluate((node) => {
      const r = document.createRange();
      r.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "加粗", exact: true }).click();
    await page.getByLabel("标注内容", { exact: true }).fill("补充来源");
    await page.getByRole("button", { name: "添加标注", exact: true }).click();
    await vi.waitFor(async () =>
      expect(
        Object.values((await service.snapshot(projectId)).documents).some(
          (d) => d.annotations.length > 0,
        ),
      ).toBe(true),
    );
    await page.reload();
    await ui(page.locator(".annotation")).toContainText("补充来源");
    const beforeReject = (await service.snapshot(projectId)).documents;
    await editor.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "改写选区" }).click();
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await page.getByRole("button", { name: "不接受", exact: true }).click();
    expect((await service.snapshot(projectId)).documents).toEqual(beforeReject);
    await page.getByRole("button", { name: "版本", exact: true }).click();
    await ui(page.getByRole("button", { name: /^导出 V/ })).toBeVisible();
    await audit(page, "versions");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /^导出 V/ }).click();
    const downloaded = await downloading;
    const actual = await readFile(requireValue(await downloaded.path()));
    await writeFile("artifacts/integration06/exported-v2.pptx", actual);
    const parsed = await service.pptx.parse(actual, "downloaded");
    expect(parsed.slides).toHaveLength(6);
    expect(
      parsed.slides.at(-1)?.elements.some((e) => e.text?.includes("（明确）")),
    ).toBe(true);
    const large = await service.create(
      {
        name: "60 页性能验收",
        ownerId: "test",
        scenario: "work_report",
        audience: "评审组",
        durationMinutes: 15,
      },
      "large",
    );
    const fixture = await makeFixture(60);
    let mark = performance.now();
    await service.upload(large.id, "large.pptx", fixture, "large-upload");
    const uploadMs = performance.now() - mark;
    await service.analyze(large.id, "", "", "large-analysis");
    mark = performance.now();
    await service.processNext();
    const analysisMs = performance.now() - mark;
    mark = performance.now();
    await page.goto(`${base}/projects/${large.id}/review`);
    await ui(page.locator(".selectable-text").first()).toBeVisible();
    const firstScreenMs = performance.now() - mark;
    mark = performance.now();
    await page
      .getByRole("button", { name: /定位第 60 页/ })
      .first()
      .click();
    await ui(page.locator(".canvas-actions")).toContainText("60 / 60");
    const locateLastMs = performance.now() - mark;
    expect(await page.locator(".thumbnail").count()).toBeGreaterThan(0);
    expect(await page.locator(".thumbnail").count()).toBeLessThan(60);
    await writeFile(
      "artifacts/integration06/browser-performance.json",
      JSON.stringify(
        {
          pages: 60,
          uploadMs,
          analysisMs,
          firstScreenMs,
          locateLastMs,
          externalModel: false,
        },
        null,
        2,
      ),
    );
    expect(errors).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
