import { it, expect, vi } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";

it("03 browser: empty, upload, saved targets, running, failure, retry and completion on narrow screen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upload03-browser-"));
  const model = new JsonModelGateway({
    apiKey: "",
    model: "test",
    baseUrl: "https://unused.invalid",
  });
  const service = new WorkspaceService(directory, model);
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
  const base =
    "http://127.0.0.1:" + String((server.address() as AddressInfo).port);
  const browser = await chromium.launch({
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : "chromium"),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(base + "/projects");
    await browserExpect(
      page.getByRole("button", { name: "新建第一个项目", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "新建第一个项目", exact: true })
      .click();
    await page.getByLabel("汇报主题").fill("研究答辩");
    await page.getByLabel("真实听众").fill("研究评委");
    await page.reload();
    await browserExpect(page.getByLabel("汇报主题")).toHaveValue("研究答辩");
    await page.getByRole("button", { name: "创建并上传 PPTX →" }).click();
    await browserExpect(
      page.getByRole("status").filter({ hasText: "等待上传" }),
    ).toBeVisible();
    const uploadUrl = page.url();
    const projectId = /projects\/([^/]+)/.exec(uploadUrl)?.[1] ?? "";
    let resumeUpload: () => void = () => {
      throw Error("not uploading");
    };
    await page.route("**/api/projects/*/upload?*", async (route) => {
      await new Promise<void>((r) => {
        resumeUpload = r;
      });
      await route.continue();
    });
    const file = await makeFixture(2);
    await page.getByLabel("选择 PPTX 文件").setInputFiles({
      name: "deck.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from(file),
    });
    await page.getByRole("button", { name: "上传文稿", exact: true }).focus();
    await page.keyboard.press("Enter");
    await browserExpect(
      page.getByRole("button", { name: "取消上传" }),
    ).toBeVisible();
    await vi.waitFor(() =>
      expect(resumeUpload.toString()).not.toContain("not uploading"),
    );
    resumeUpload();
    await browserExpect(
      page.getByText("已解析 2 页", { exact: false }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: /^汇报目标/ }).fill("说明方法价值");
    await browserExpect(
      page.getByText("目标已保存", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await browserExpect(
      page.getByRole("textbox", { name: /^汇报目标/ }),
    ).toHaveValue("说明方法价值");
    await page
      .getByRole("button", { name: "开始 AI 分析", exact: true })
      .click();
    await browserExpect(
      page.getByRole("button", { name: "取消分析", exact: true }),
    ).toBeVisible();
    let fail: (reason: Error) => void = () => {
      throw Error("not analyzing");
    };
    vi.spyOn(model, "analyze").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const work = service.processNext();
    await vi.waitFor(async () =>
      expect((await service.snapshot(projectId)).uploadState.stage).toBe(
        "analyzing",
      ),
    );
    await page.reload();
    await browserExpect(
      page.getByText("AI 分析中", { exact: true }),
    ).toBeVisible();
    fail(new Error("temporary outage"));
    await work;
    await browserExpect(
      page.getByRole("button", { name: "重试分析", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const previousId = (await service.snapshot(projectId)).job?.id;
    await page.getByRole("button", { name: "重试分析", exact: true }).click();
    await browserExpect(
      page.getByRole("button", { name: "取消分析", exact: true }),
    ).toBeVisible();
    vi.spyOn(model, "analyze").mockResolvedValue({
      goal: "说明研究",
      expectedAudienceResponse: "认可结论",
      narrativeSummary: "研究验证",
      reviewers: [],
      comments: [],
    });
    await service.processNext();
    await browserExpect(page).toHaveURL(/\/review(?:\?|$)/, { timeout: 10000 });
    expect((await service.snapshot(projectId)).job?.id).toBe(previousId);
    await page.goto(uploadUrl);
    await browserExpect(
      page.getByText("评审已准备好", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "接受 AI 建议", exact: true })
      .click();
    await browserExpect(
      page.getByText("目标已保存", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await browserExpect(
      page.getByRole("textbox", { name: /^期望听众回应/ }),
    ).toHaveValue("认可结论");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve("artifacts/03-upload-mobile.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: resolve("artifacts/03-upload-desktop.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await browser.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
