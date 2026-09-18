import { it, expect } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";
import { ManuscriptGenerator } from "./manuscript.js";

it("shows original thumbnail images, hydrates a clean editor, and allows reading/editing the full manuscript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "manuscript-ui-"));
  const service = new WorkspaceService(
    dir,
    new JsonModelGateway({ apiKey: "", model: "", baseUrl: "" }),
  );
  const project = await service.create(
    {
      name: "整份讲稿",
      ownerId: "test",
      scenario: "work_report",
      audience: "同事",
      durationMinutes: 10,
    },
    "create",
  );
  await service.upload(
    project.id,
    "deck.pptx",
    await makeFixture(2, true),
    "upload",
  );
  await service.store.transaction((d) => {
    for (const doc of Object.values(d.documents[project.id] ?? {}))
      doc.text = "";
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
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1480, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/projects/${project.id}/review`,
    );
    const editor = page.getByRole("textbox", { name: "本页汇报稿正文" });
    await ui(editor).toHaveText("");
    await ui(page.locator(".mini-slide img")).toHaveCount(2);
    await page
      .locator(".mini-slide img")
      .first()
      .evaluate((node) => (node as HTMLImageElement).decode());
    await page
      .getByRole("button", { name: "生成整份讲稿", exact: true })
      .click();
    await ui(page.getByText(/正在串联整份讲稿/)).toBeVisible();
    await new ManuscriptGenerator(service.store, {
      createScript: (input) =>
        Promise.resolve({
          pages: (input.targetSlideIds ?? []).map((slideId, index) => ({
            slideId,
            narration: `第${String(index + 1)}页完整正文，承接前文说明结论，再进入下一页。`,
            purpose: "说明",
            keyMessage: "结论",
            speakingOrder: ["结论"],
            durationSeconds: 30,
            optionalContent: [],
            likelyQuestions: [],
          })),
        }),
    }).runNext();
    await ui(editor).toContainText("第1页完整正文", { timeout: 8000 });
    await ui(page.getByText(/整份讲稿已就绪/)).toBeVisible();
    await page
      .getByRole("button", { name: "查看整份讲稿", exact: true })
      .click();
    await ui(page.locator(".full-manuscript article")).toHaveCount(2);
    await page.getByRole("button", { name: "编辑本页" }).nth(1).click();
    await ui(editor).toContainText("第2页完整正文");
    await editor.fill("用户修改后的第二页演讲稿");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await ui(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "通读整份讲稿" }).click();
    await ui(page.locator(".full-manuscript article").nth(1)).toContainText(
      "用户修改后的第二页演讲稿",
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
