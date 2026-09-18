import { it } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { WorkspaceService } from "./service.js";
import { createApplication } from "./http.js";

it("projects landing omits explanatory and local-development copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "projects-copy-"));
  const assets = await build({
    entryPoints: [resolve("apps/web/src/client/app.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
  });
  const server = createApplication(
    new WorkspaceService(
      directory,
      new JsonModelGateway({
        apiKey: "",
        model: "test",
        baseUrl: "https://unused.invalid",
      }),
    ),
    {
      js: assets.outputFiles[0]?.text ?? "",
      css: await readFile(resolve("apps/web/src/client/styles.css"), "utf8"),
    },
    () => {},
  );
  const browser = await chromium.launch({
    channel: process.platform === "win32" ? "msedge" : "chromium",
    headless: true,
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const page = await browser.newPage();
    await page.goto(
      `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/projects`,
    );
    await ui(
      page.getByRole("heading", { name: "让好内容，被更好地理解。" }),
    ).toBeVisible();
    await ui(
      page.getByText("保留你的观点，和 AI 模拟听众一起打磨表达。", {
        exact: true,
      }),
    ).toHaveCount(0);
    await ui(page.getByText(/本地开发版/)).toHaveCount(0);
  } finally {
    await browser.close();
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
