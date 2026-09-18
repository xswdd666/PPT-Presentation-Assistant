import { it, expect, vi } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";
it("05 browser: selection, zoom, cancel, diff, real acceptance, script formatting/persistence, comparison and export retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rewrite05-ui-"));
  const model = new JsonModelGateway({
    apiKey: "",
    model: "test",
    baseUrl: "https://unused.invalid",
  });
  const service = new WorkspaceService(directory, model);
  const project = await service.create(
    {
      name: "文字与讲稿验收",
      ownerId: "test",
      scenario: "work_report",
      audience: "团队",
      durationMinutes: 10,
    },
    "create",
  );
  await service.upload(project.id, "test.pptx", await makeFixture(3), "upload");
  vi.spyOn(model, "rewrite").mockResolvedValue({
    replacementText: "核心结论".repeat(45),
    rationale: "先讲清楚结论",
    factsPreserved: true,
    confidence: 1,
  });
  vi.spyOn(model, "rewriteScript").mockResolvedValue({
    replacementText: "核心结论",
    rationale: "简明表达",
    factsPreserved: true,
    confidence: 1,
  });
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1024 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/projects/${project.id}`;
  try {
    await page.goto(base + "/review");
    const target = page.locator(".selectable-text").first();
    await ui(target).toBeVisible();
    for (const zoom of ["75", "125", "100"]) {
      await page.getByLabel("画布缩放").selectOption(zoom);
      const rects = await page.locator(".slide-canvas").evaluate((node) => {
        const overlay = node.querySelector(".selectable-text"),
          text = node.querySelector(".slide-element.editable");
        if (!overlay || !text) throw new Error("Missing text");
        const a = overlay.getBoundingClientRect(),
          b = text.getBoundingClientRect();
        return [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height];
      });
      expect(rects.every((n) => Math.abs(n) < 0.1)).toBe(true);
    }
    await target.evaluate((node) => {
      const text = document
        .createTreeWalker(node, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text) throw new Error("Missing selection text");
      const r = document.createRange();
      r.setStart(text, 2);
      r.setEnd(text, 8);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await ui(page.getByRole("toolbar", { name: "选中文字操作" })).toContainText(
      "6 字",
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await target.focus();
    await target.press("Enter");
    await ui(page.getByRole("toolbar", { name: "选中文字操作" })).toBeVisible();
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await page.getByRole("button", { name: "不接受", exact: true }).click();
    expect((await service.snapshot(project.id)).versions).toHaveLength(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(
      "**/suggest",
      async (route) => {
        await gate;
        await route.continue();
      },
      { times: 1 },
    );
    await target.focus();
    await target.press("Enter");
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByText("正在生成建议…", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    const response = page.waitForResponse((r) => r.url().endsWith("/suggest"));
    release();
    await response;
    await ui(page.getByRole("dialog")).toHaveCount(0);
    expect((await service.snapshot(project.id)).versions).toHaveLength(1);
    await target.focus();
    await target.press("Enter");
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await mkdir("artifacts/rewrite05", { recursive: true });
    await page.screenshot({
      animations: "disabled",
      path: "artifacts/rewrite05/diff-desktop.png",
    });
    await page.getByRole("button", { name: "接受修改", exact: true }).click();
    await ui(page.getByRole("dialog")).toHaveCount(0);
    await ui(page.getByRole("button", { name: "提交为新版本" })).toBeVisible();
    await page.getByRole("button", { name: "提交为新版本" }).click();
    await ui(page.getByRole("button", { name: "提交为新版本" })).toHaveCount(0);
    expect((await service.snapshot(project.id)).versions).toHaveLength(2);
    const editor = page.getByRole("textbox", { name: "本页汇报稿正文" });
    await editor.fill("验收专用结论，再说依据");
    await editor.evaluate((node) => {
      const r = document.createRange();
      r.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "加粗", exact: true }).click();
    await ui(editor.locator('span[style*="font-weight"]')).toContainText(
      "验收专用结论",
    );
    await page.getByLabel("标注内容", { exact: true }).fill("注明来源");
    await page.getByRole("button", { name: "添加标注", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await ui(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.reload();
    await ui(editor).toHaveText("验收专用结论，再说依据");
    await ui(page.getByText("注明来源", { exact: false })).toBeVisible();
    // Offline edits survive a page reload and retry without a file version.
    await page.route("**/script", (route) => route.abort());
    await editor.fill("验收专用结论，再说依据与离线恢复");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await ui(page.getByText("保存失败 · 草稿保留在本机")).toBeVisible();
    await page.reload();
    await ui(editor).toHaveText("验收专用结论，再说依据与离线恢复");
    await page.unroute("**/script");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await ui(page.getByText("已保存", { exact: true })).toBeVisible();
    // A script proposal shares the Diff flow and changes no PPT version.
    await editor.evaluate((node) => {
      const r = document.createRange();
      r.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "改写选区" }).click();
    await page.getByRole("button", { name: "AI 改写" }).click();
    await ui(page.getByLabel("文字差异")).toBeVisible();
    await page.getByRole("button", { name: "不接受", exact: true }).click();
    expect((await service.snapshot(project.id)).versions).toHaveLength(2);
    await page.getByRole("button", { name: "讲稿", exact: true }).click();
    await ui(page.getByLabel("搜索讲稿")).toBeVisible();
    await page.getByLabel("搜索讲稿").fill("验收专用结论");
    await ui(
      page
        .getByRole("navigation", { name: "讲稿页面索引" })
        .getByRole("button"),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "版本", exact: true }).click();
    await page.getByLabel("查看与导出版本").selectOption({ index: 0 });
    await ui(page.getByText("V2 · 导出前检查")).toBeVisible();
    await ui(page.locator(".warnings")).toBeVisible();
    await ui(page.locator(".version-comparison")).toHaveCount(1);
    let failed = false;
    await page.route("**/download/**", async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "暂时无法读取" }),
        });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "导出 V2 PPTX" }).click();
    await ui(
      page.getByRole("alert").filter({ hasText: "导出失败" }),
    ).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 V2 PPTX" }).click();
    expect((await downloaded).suggestedFilename()).toBe("deck-V2.pptx");
    await page.screenshot({
      animations: "disabled",
      path: "artifacts/rewrite05/versions-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/script");
    await ui(editor).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: "artifacts/rewrite05/script-narrow.png",
    });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await rm(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
}, 60000);
