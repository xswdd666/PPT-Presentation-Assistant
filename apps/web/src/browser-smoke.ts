import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  channel:
    process.env.PLAYWRIGHT_CHANNEL ??
    (process.platform === "win32" ? "msedge" : "chromium"),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:3000/projects");
await page.getByRole("button", { name: "＋ 新建预演项目" }).click();
await page.getByLabel("汇报主题").fill("第三季度产品增长复盘");
await page.getByLabel("真实听众").fill("产品团队与管理层");
await page.getByRole("button", { name: "创建并上传 PPTX →" }).click();
await page
  .locator("input[type=file]")
  .setInputFiles("../../tests/fixtures/pptx/demo-6.pptx");
await page.getByRole("button", { name: "上传文稿", exact: true }).click();
await page.getByText("已解析 6 页", { exact: false }).waitFor();
await page.getByRole("button", { name: "开始 AI 分析" }).click();
await page
  .getByText("评审已准备好", { exact: true })
  .waitFor({ timeout: 300000 });
await page.getByRole("button", { name: "进入评审 →" }).click();
await page
  .getByLabel("本页汇报稿正文")
  .fill("这一页先说结论，再说明数据依据。");
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.getByText("已保存", { exact: true }).waitFor();
await page.screenshot({ path: "../../artifacts/workbench-desktop.png" });
const url = page.url();
await page.reload();
await page.getByLabel("本页汇报稿正文").waitFor();
if (
  (await page.getByLabel("本页汇报稿正文").inputValue()) !==
  "这一页先说结论，再说明数据依据。"
)
  throw Error("script did not survive refresh");
await page.getByRole("button", { name: "版本", exact: true }).click();
await page.getByRole("button", { name: "隐藏", exact: true }).first().click();
await page.getByRole("heading", { name: "V2 当前版本" }).waitFor();
await page.goto(url);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "../../artifacts/workbench-mobile.png" });
await page.getByRole("button", { name: "评审与导航" }).click();
await page.getByRole("button", { name: "上传", exact: true }).click();
if (errors.length) throw Error(errors.join("\n"));
console.log(
  JSON.stringify({
    url,
    errors,
    desktop: "1440x1024",
    mobile: "390x844",
    result: "passed",
  }),
);
await browser.close();
