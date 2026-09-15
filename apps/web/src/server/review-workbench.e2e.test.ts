import { it, expect } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { ReviewComment, ReviewThread } from "@deck-rehearsal/contracts";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { makeFixture } from "@deck-rehearsal/pptx/testing";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";

it("04 workbench: deep links, virtual pages, splitters, reply lifecycle, focus restoration and narrow layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review04-"));
  const service = new WorkspaceService(
    directory,
    new JsonModelGateway({
      apiKey: "",
      model: "test",
      baseUrl: "https://unused.invalid",
    }),
  );
  const project = await service.create(
    {
      name: "评审工作台验收",
      ownerId: "local-user",
      scenario: "work_report",
      audience: "项目评审人",
      durationMinutes: 15,
    },
    "create04",
  );
  await service.upload(
    project.id,
    "review.pptx",
    await makeFixture(60),
    "upload04",
  );
  const snapshot = await service.snapshot(project.id);
  const version = snapshot.version;
  const sixth = snapshot.slides[5];
  if (!version || !sixth) throw new Error("Fixture has no sixth page");
  const comment: ReviewComment = {
    id: "comment-six",
    issueId: "issue-six",
    reviewerId: "olivia",
    deckVersionId: version.id,
    headline: "统计口径",
    body: "建议在图表下方补充新增用户与活跃用户的统计口径、时间范围和数据来源，避免与财务口径或其他报表不一致，并说明这些指标如何支撑本页的增长结论。",
    evidence: "第六页的统计图缺少指标定义。",
    impact: "听众难以比较数据。",
    suggestedAction: "补充统计口径。",
    confidence: 0.9,
    relatedSlideIds: [sixth.id],
    createdAt: "2026-09-15T01:00:00Z",
  };
  snapshot.comments = Array.from({ length: 12 }, (_, i) => ({
    ...comment,
    id: i === 5 ? comment.id : `comment-${String(i)}`,
  }));
  let thread: ReviewThread = { comment, replies: [], generation: "completed" };
  const bundle = await build({
    entryPoints: [resolve("apps/web/src/client/app.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const assets = {
    js: bundle.outputFiles[0]?.text ?? "",
    css: await readFile("apps/web/src/client/styles.css", "utf8"),
  };
  const server = createApplication(service, assets);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
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
  let status = 200;
  let failList = false;
  let projectReads = 0;
  let sendStatus = 200;
  let sends = 0;
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    projectReads++;
    const failed = failList && projectReads > 1;
    await new Promise((r) => setTimeout(r, 80));
    return route.fulfill({
      status: failed ? 500 : 200,
      json: failed ? { error: "读取失败" } : snapshot,
    });
  });
  await page.route(`**/api/projects/${project.id}/thread/*`, async (route) => {
    if (route.request().method() === "POST") {
      sends++;
      await new Promise((r) => setTimeout(r, 250));
      if (sendStatus !== 200)
        return route.fulfill({
          status: sendStatus,
          json: { error: "回复失败" },
        });
      const body = (route.request().postDataJSON() as { body: string }).body;
      thread = {
        ...thread,
        generation: "queued",
        replies: [
          ...thread.replies,
          {
            id: `user-${String(sends)}`,
            commentId: comment.id,
            author: "user",
            reviewerId: comment.reviewerId,
            body,
            deckVersionId: version.id,
            createdAt: comment.createdAt,
            basis: "用户补充",
          },
        ],
      };
      return route.fulfill({ json: thread });
    }
    if (status !== 200)
      return route.fulfill({ status, json: { error: "评论不可用" } });
    if (thread.generation === "queued")
      thread = { ...thread, generation: "generating" };
    else if (thread.generation === "generating")
      thread = {
        ...thread,
        generation: "completed",
        replies: [
          ...thread.replies,
          {
            id: "ai-reply",
            commentId: comment.id,
            author: "reviewer",
            reviewerId: comment.reviewerId,
            body: "建议明确新增用户是否包含试用用户，并在图表下注明。",
            deckVersionId: version.id,
            createdAt: comment.createdAt,
            basis: "基于第 6 页与当前版本",
          },
        ],
      };
    return route.fulfill({ json: thread });
  });
  try {
    await page.goto(`${base}/projects/${project.id}/review`);
    await ui(page.getByText("12 条评论")).toBeVisible();
    await ui(
      page.getByRole("button", { name: "评审", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(await page.locator(".thumbnail").count()).toBeLessThan(20);
    const split = page.getByRole("separator", { name: "调整评审面板宽度" });
    await split.focus();
    await page.keyboard.press("End");
    await ui(split).toHaveAttribute("aria-valuenow", "370");
    await page.keyboard.press("Enter");
    await ui(split).toHaveAttribute("aria-valuenow", "360");
    const horizontal = page.getByRole("separator", {
      name: "调整画布与讲稿高度",
    });
    await horizontal.focus();
    await page.keyboard.press("ArrowUp");
    await ui(horizontal).toHaveAttribute("aria-valuenow", "59");
    const sixthComment = page.locator("#comment-comment-six");
    await sixthComment.scrollIntoViewIfNeeded();
    await sixthComment
      .locator("..")
      .getByRole("button", { name: "⌖ 定位第 6 页" })
      .click();
    await ui(
      page.getByRole("button", { name: "第 6 页", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await sixthComment.scrollIntoViewIfNeeded();
    const before = await page
      .locator(".comment-list")
      .evaluate((el) => el.scrollTop);
    await sixthComment.click();
    await ui(page.getByRole("button", { name: "← 评论详情" })).toBeVisible();
    await page
      .getByRole("textbox", { name: "回复 谨慎的证据审阅者" })
      .fill("新增用户不包含试用用户，我应该怎样写清楚？");
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await ui(page.locator(".reply.user").last()).toContainText(
      "新增用户不包含试用用户",
    );
    await ui(
      page.getByText("基于第 6 页与当前版本", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "← 评论详情" }).click();
    await ui(sixthComment).toBeFocused();
    expect(
      await page.locator(".comment-list").evaluate((el) => el.scrollTop),
    ).toBeCloseTo(before, 0);
    await ui(horizontal).toHaveAttribute("aria-valuenow", "59");
    await page.goto(
      `${base}/projects/${project.id}/review?comment=${comment.id}`,
    );
    await ui(
      page.getByRole("button", { name: "第 6 页", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await ui(
      page.getByText("基于第 6 页与当前版本", { exact: true }),
    ).toBeVisible();
    await mkdir("artifacts/review04", { recursive: true });
    await page.screenshot({ path: "artifacts/review04/desktop-1440.png" });
    sendStatus = 409;
    await page.getByLabel("回复 谨慎的证据审阅者").fill("新的版本补充");
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await ui(page.getByRole("button", { name: "刷新当前版本" })).toBeVisible();
    await page.getByRole("button", { name: "刷新当前版本" }).click();
    await ui(page.getByLabel("回复 谨慎的证据审阅者")).toHaveValue(
      "新的版本补充",
    );
    sendStatus = 500;
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await ui(page.getByRole("button", { name: "重试回复" })).toBeVisible();
    sendStatus = 200;
    await page.getByRole("button", { name: "重试回复" }).click();
    await ui(page.getByLabel("回复 谨慎的证据审阅者")).toHaveValue("");
    for (const code of [403, 404, 500]) {
      status = code;
      await page.reload();
      await ui(
        page.getByRole("alert").filter({
          hasText:
            code === 403
              ? "没有权限"
              : code === 404
                ? "评论已失效"
                : "评论不可用",
        }),
      ).toBeVisible();
      status = 200;
      await page.getByRole("button", { name: "重试加载" }).click();
      await ui(page.getByLabel("回复 谨慎的证据审阅者")).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "评审与导航" }).click();
    await ui(page.getByLabel("回复 谨慎的证据审阅者")).toBeVisible();
    await page.screenshot({ path: "artifacts/review04/narrow-390.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "← 评论详情" }).click();
    await page.getByRole("button", { name: "上传", exact: true }).click();
    await ui(page).toHaveURL(/\/upload/);
    await page.getByRole("button", { name: "评审与导航" }).click();
    await page.getByRole("button", { name: "讲稿", exact: true }).click();
    await ui(page).toHaveURL(/\/script/);
    await page.getByRole("button", { name: "评审与导航" }).click();
    await page.getByRole("button", { name: "版本", exact: true }).click();
    await ui(page).toHaveURL(/\/versions/);
    await page.setViewportSize({ width: 1440, height: 1024 });
    snapshot.comments = [];
    await page.goto(`${base}/projects/${project.id}/review`);
    await ui(page.getByText("还没有评论", { exact: true })).toBeVisible();
    projectReads = 0;
    failList = true;
    await page.reload();
    await ui(
      page.getByRole("alert").filter({ hasText: "读取失败" }),
    ).toBeVisible();
    failList = false;
    await page.getByRole("button", { name: "重试加载" }).click();
    await ui(page.getByText("还没有评论", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "第 1 页", exact: true }).focus();
    await page.keyboard.press("End");
    await ui(
      page.getByRole("button", { name: "第 60 页", exact: true }),
    ).toBeFocused();
    expect(await page.locator(".thumbnail").count()).toBeLessThan(20);
    const asyncBundle = await build({
      stdin: {
        resolveDir: resolve("apps/web/src/client"),
        loader: "tsx",
        contents: [
          'import { createRoot } from "react-dom/client";',
          'import { Comments } from "../features/review-thread/comments.js";',
          "const data = " +
            JSON.stringify({ ...snapshot, comments: [comment] }) +
            ";",
          "let thread = " +
            JSON.stringify({ comment, replies: [], generation: "completed" }) +
            ";",
          "let generation = " +
            JSON.stringify({
              id: "async-generation",
              projectId: project.id,
              commentId: comment.id,
              deckVersionId: version.id,
              state: "completed",
            }) +
            ";",
          'const gateway = { listComments: async () => data.comments, getThread: async () => thread, submitReply: async input => { thread = {...thread, generation: "failed", error: "模型超时", replies: [{id:"user-async", commentId: input.commentId, author:"user", reviewerId:"olivia", body:input.body, deckVersionId:input.deckVersionId, createdAt:new Date().toISOString(), basis:"用户补充"}]}; generation.state="failed"; return generation; }, getReplyResult: async () => ({generation, thread}), retryReply: async () => { generation.state="completed"; thread={...thread,generation:"completed",error:undefined,replies:[...thread.replies,{...thread.replies[0],id:"ai-async",author:"reviewer",body:"已使用原生成任务重新回复。",basis:"基于第 6 页与当前版本"}]}; return generation; } };',
          'createRoot(document.getElementById("root")).render(<aside className="review-panel" style={{height:"100vh",width:360}}><Comments data={data} url={new URL(location.href)} gateway={gateway} navigate={() => {}} onLocate={() => {}} /></aside>);',
        ].join("\n"),
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
    });
    assets.js = asyncBundle.outputFiles[0]?.text ?? "";
    await page.goto(base + "/async-fixture?comment=" + comment.id);
    await page
      .getByLabel("回复 谨慎的证据审阅者")
      .fill("请沿用这次回复重试，不要重复发送。");
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await ui(page.getByRole("button", { name: "重试 AI 回复" })).toBeVisible();
    await page.reload();
    // The fixture restores the task identity from session storage; submit once after its in-memory reset.
    await page
      .getByLabel("回复 谨慎的证据审阅者")
      .fill("请沿用这次回复重试，不要重复发送。");
    await page.getByRole("button", { name: "发送回复 ↑" }).click();
    await page.getByRole("button", { name: "重试 AI 回复" }).click();
    await ui(
      page.getByText("已使用原生成任务重新回复。", { exact: true }),
    ).toBeVisible();
    await ui(page.locator(".reply.user")).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((r, reject) =>
      server.close((e) => (e ? reject(e) : r())),
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
