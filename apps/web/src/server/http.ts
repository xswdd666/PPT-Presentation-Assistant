import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AiError, createModelGatewayFromEnv } from "@deck-rehearsal/ai/runtime";
import { IntegratedWorkspaceService } from "./integrated-service.js";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { SCENARIOS } from "@deck-rehearsal/contracts";
import { JsonModelGateway } from "@deck-rehearsal/ai";
import { ServiceError, type WorkspaceService } from "./service.js";
const selection = z.object({
  deckVersionId: z.string(),
  slideId: z.string(),
  elementId: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  selectedText: z.string().max(8000),
});
const documentSchema = z
  .object({
    slideId: z.string(),
    revision: z.number().int().nonnegative(),
    text: z.string().max(100000),
    updatedAt: z.string(),
    marks: z
      .array(
        z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          kind: z.enum(["bold", "underline", "color", "highlight"]),
          value: z
            .string()
            .regex(/^#[a-fA-F0-9]{6}$/)
            .optional(),
        }),
      )
      .max(10000),
    annotations: z
      .array(
        z.object({
          id: z.string(),
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          text: z.string().max(2000),
          author: z.string(),
          createdAt: z.string(),
          invalid: z.boolean().optional(),
        }),
      )
      .max(1000),
  })
  .refine(
    (d) =>
      d.marks.every((m) => m.start < m.end && m.end <= d.text.length) &&
      d.annotations.every(
        (a) => a.invalid || (a.start < a.end && a.end <= d.text.length),
      ),
    "标记范围无效",
  );
const operation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_slide_hidden"),
    slideId: z.string(),
    hidden: z.boolean(),
  }),
  z.object({
    type: z.literal("reorder_slides"),
    slideIds: z.array(z.string()).min(1).max(60),
  }),
]);
async function bytes(request: IncomingMessage, max: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += b.length;
    if (size > max)
      throw new ServiceError("请求超过大小限制", 413, "file_size_exceeded");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function json(request: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse(
      (await bytes(request, 2 * 1024 * 1024)).toString("utf8"),
    ) as unknown;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("请求 JSON 格式无效");
  }
}
export function createApplication(
  service: WorkspaceService,
  assets: { js: string; css: string } = { js: "", css: "" },
  log?: (entry: {
    requestId: string;
    statusCode: number;
    durationMs: number;
  }) => void,
) {
  return createServer((request, response) => {
    const started = performance.now();
    const requestId = randomUUID();
    response.once("finish", () =>
      log?.({
        requestId,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    response.setHeader("x-request-id", requestId);
    const send = (value: unknown, status = 200) => {
      response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";
      if (!["GET", "HEAD"].includes(method)) {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host)
          throw new ServiceError("不允许跨站写入", 403);
      }
      if (url.pathname === "/health")
        return send({ service: "web", status: "ok" });
      if (url.pathname === "/api/projects" && method === "GET")
        return send(
          Object.values((await service.store.read()).projects).sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
        );
      if (url.pathname === "/api/project-summaries" && method === "GET") {
        const projects = Object.values((await service.store.read()).projects);
        return send(
          await Promise.all(
            projects
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map(async (p) => {
                const snapshot = await service.snapshot(p.id);
                return {
                  ...p,
                  uploadState: snapshot.uploadState,
                  versionNumber: snapshot.version?.versionNumber ?? 0,
                };
              }),
          ),
        );
      }
      const key =
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : "";
      if (url.pathname === "/api/projects" && method === "POST") {
        const input = z
          .object({
            name: z.string().trim().min(1).max(200),
            scenario: z.enum(SCENARIOS),
            audience: z.string().trim().min(1).max(2000),
            durationMinutes: z.number().int().min(1).max(480),
            customScenario: z.string().max(1000).optional(),
          })
          .parse(await json(request));
        return send(
          await service.create(
            {
              name: input.name,
              scenario: input.scenario,
              audience: input.audience,
              durationMinutes: input.durationMinutes,
              ...(input.customScenario
                ? { customScenario: input.customScenario }
                : {}),
              ownerId: "local-user",
            },
            key,
          ),
          201,
        );
      }
      const match = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      if (match) {
        const projectId = match[1] ?? "";
        const action = match[2] ?? "";
        if (method === "GET" && !action)
          return send(await service.snapshot(projectId));
        if (method === "DELETE" && !action) {
          await service.deleteProject(projectId, key);
          response.writeHead(204);
          response.end();
          return;
        }
        if (method === "POST" && action === "upload-session")
          return send(await service.prepareUpload(projectId, key));
        if (method === "PUT" && action === "targets") {
          const b = z
            .object({
              goal: z.string().max(5000),
              response: z.string().max(5000),
              revision: z.number().int().nonnegative(),
              acceptSuggestions: z.boolean().default(false),
            })
            .parse(await json(request));
          return send(
            await service.saveTargets(
              projectId,
              b.goal,
              b.response,
              b.revision,
              b.acceptSuggestions,
            ),
          );
        }
        if (method === "POST" && action === "cancel")
          return send(await service.cancelAnalysis(projectId));
        if (method === "POST" && action === "retry") {
          const b = z
            .object({ jobId: z.string().min(1) })
            .parse(await json(request));
          return send(
            await service.retryAnalysis(projectId, b.jobId, key),
            202,
          );
        }
        if (method === "POST" && action === "upload") {
          try {
            const mime = request.headers["content-type"]?.split(";")[0];
            if (
              mime !==
                "application/vnd.openxmlformats-officedocument.presentationml.presentation" &&
              mime !== "application/octet-stream"
            )
              throw new ServiceError(
                "不支持的文件类型",
                415,
                "unsupported_mime",
              );
            return send(
              await service.upload(
                projectId,
                url.searchParams.get("name") ?? "",
                await bytes(request, 50 * 1024 * 1024),
                key,
              ),
              201,
            );
          } catch (error) {
            await service.uploadFailed(projectId, key, error);
            throw error;
          }
        }
        if (method === "POST" && action === "analyze") {
          const b = z
            .object({
              goal: z.string().max(5000).default(""),
              response: z.string().max(5000).default(""),
            })
            .parse(await json(request));
          return send(
            await service.analyze(projectId, b.goal, b.response, key),
            202,
          );
        }
        if (method === "POST" && action === "suggest") {
          const b = z
            .object({
              target: z.enum(["ppt", "script"]),
              selection,
              scriptRevision: z.number().int().nonnegative().optional(),
            })
            .parse(await json(request));
          return send(
            await service.suggest(
              projectId,
              b.target,
              b.selection,
              b.scriptRevision,
            ),
          );
        }
        if (method === "POST" && action === "accept") {
          const b = z
            .object({
              suggestionId: z.string(),
              replacementText: z.string().max(8000).optional(),
            })
            .parse(await json(request));
          return send(
            await service.accept(
              projectId,
              b.suggestionId,
              key,
              b.replacementText,
            ),
          );
        }
        if (method === "POST" && action === "draft/undo")
          return send(await service.undoDraft(projectId, key));
        if (method === "POST" && action === "draft/commit") {
          const b = z
            .object({ versionId: z.string() })
            .parse(await json(request));
          return send(await service.commitDraft(projectId, b.versionId, key));
        }
        if (method === "POST" && action === "script-generation")
          return send(await service.generateManuscript(projectId));
        if (method === "PUT" && action === "script")
          return send(
            await service.saveDocument(
              projectId,
              documentSchema
                .transform((d) => ({
                  ...d,
                  marks: d.marks.map(({ value, ...m }) => ({
                    ...m,
                    ...(value ? { value } : {}),
                  })),
                  annotations: d.annotations.map(({ invalid, ...a }) => ({
                    ...a,
                    ...(invalid !== undefined ? { invalid } : {}),
                  })),
                }))
                .parse(await json(request)),
            ),
          );
        if (method === "POST" && action === "changes") {
          const b = z
            .object({
              versionId: z.string(),
              operations: z.array(operation).min(1).max(60),
            })
            .parse(await json(request));
          return send(
            await service.change(projectId, b.versionId, b.operations, key),
          );
        }
        if (method === "POST" && action === "restore") {
          const b = z
            .object({ versionId: z.string(), currentVersionId: z.string() })
            .parse(await json(request));
          return send(
            await service.restore(
              projectId,
              b.versionId,
              b.currentVersionId,
              key,
            ),
          );
        }
        if (service instanceof IntegratedWorkspaceService) {
          const replyMatch = /^replies\/([^/]+)(\/retry)?$/.exec(action);
          if (replyMatch && method === "GET" && !replyMatch[2])
            return send(
              await service.worker.getReplyResult(
                projectId,
                replyMatch[1] ?? "",
              ),
            );
          if (replyMatch && method === "POST" && replyMatch[2])
            return send(
              await service.worker.retryReply(projectId, replyMatch[1] ?? ""),
              202,
            );
          if (
            method === "POST" &&
            action.startsWith("thread/") &&
            action.endsWith("/replies")
          ) {
            const b = z
              .object({
                body: z.string().trim().min(1).max(4000),
                versionId: z.string(),
              })
              .parse(await json(request));
            return send(
              await service.worker.submitReply({
                projectId,
                commentId: action.slice(7, -8),
                body: b.body,
                deckVersionId: b.versionId,
                idempotencyKey: key,
              }),
              202,
            );
          }
        }
        if (method === "GET" && action.startsWith("thread/"))
          return send(await service.thread(projectId, action.slice(7)));
        if (method === "POST" && action.startsWith("thread/")) {
          const b = z
            .object({
              body: z.string().trim().min(1).max(4000),
              versionId: z.string(),
            })
            .parse(await json(request));
          return send(
            await service.reply(
              projectId,
              action.slice(7),
              b.body,
              b.versionId,
              key,
            ),
          );
        }
        if (method === "GET" && action.startsWith("image/")) {
          const parts = action.split("/");
          if (parts.length !== 4) throw new ServiceError("图片路径无效", 400);
          try {
            const file = await service.download(projectId, parts[1] ?? "");
            const media = await service.pptx.image(
              file,
              parts[2] ?? "",
              parts[3] ?? "",
            );
            response.writeHead(200, {
              "content-type": media.type,
              "cache-control": "private, max-age=86400, immutable",
              "x-content-type-options": "nosniff",
            });
            response.end(media.content);
            return;
          } catch (error) {
            if (error instanceof ServiceError) throw error;
            throw new ServiceError("图片不存在或格式暂不支持", 404);
          }
        }
        if (method === "GET" && action.startsWith("version/"))
          return send(await service.versionDetail(projectId, action.slice(8)));
        if (method === "GET" && action.startsWith("download/")) {
          const content = await service.download(projectId, action.slice(9));
          response.writeHead(200, {
            "content-type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "content-disposition": 'attachment; filename="deck-rehearsal.pptx"',
          });
          response.end(content);
          return;
        }
        throw new ServiceError("接口不存在", 404);
      }
      if (url.pathname.startsWith("/api/"))
        throw new ServiceError("接口不存在", 404);
      if (method !== "GET") throw new ServiceError("不支持该操作", 405);
      if (url.pathname === "/app.js" || url.pathname === "/app.css") {
        response.writeHead(200, {
          "content-type": url.pathname.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
        });
        response.end(
          url.pathname.endsWith(".js")
            ? assets.js
            : assets.css +
                "\n" +
                (await readFile(
                  resolve(
                    workspaceRoot,
                    "apps/web/src/client/interactions.css",
                  ),
                  "utf8",
                )) +
                "\n" +
                (await readFile(
                  resolve(
                    workspaceRoot,
                    "apps/web/src/client/upload-playground.css",
                  ),
                  "utf8",
                )) +
                "\n" +
                (await readFile(
                  resolve(
                    workspaceRoot,
                    "apps/web/src/client/sketch-progress.css",
                  ),
                  "utf8",
                )),
        );
        return;
      }
      if (
        /^\/assets\/(?:avatars\/[a-z-]+\.png|fonts\/(?:files\/)?[a-z0-9-]+\.(?:woff2|css))$/.test(
          url.pathname,
        )
      ) {
        const asset = await readFile(
          resolve(workspaceRoot, "apps/web/public", url.pathname.slice(1)),
        ).catch(() => undefined);
        if (!asset) throw new ServiceError("资源不存在", 404);
        response.writeHead(200, {
          "content-type": url.pathname.endsWith(".png")
            ? "image/png"
            : url.pathname.endsWith(".css")
              ? "text/css"
              : "font/woff2",
          "cache-control": "public, max-age=3600",
        });
        response.end(asset);
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      response.end(
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>汇报预演室 · Deck Rehearsal</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      );
    })().catch((error: unknown) => {
      send(
        {
          requestId,
          code:
            error instanceof ServiceError
              ? error.code
              : error instanceof AiError
                ? error.failure.code
                : error instanceof z.ZodError
                  ? "invalid_input"
                  : "internal_error",
          retryable:
            error instanceof ServiceError
              ? error.retryable
              : error instanceof AiError
                ? error.failure.retryable
                : true,
          error:
            error instanceof z.ZodError
              ? "输入格式无效，请检查字段"
              : error instanceof ServiceError || error instanceof AiError
                ? error.message
                : "操作失败，请重试并提供请求编号",
        },
        error instanceof ServiceError
          ? error.status
          : error instanceof AiError
            ? error.failure.code === "not_found"
              ? 404
              : [
                    "version_conflict",
                    "idempotency_conflict",
                    "thread_busy",
                  ].includes(error.failure.code)
                ? 409
                : error.failure.code === "invalid_input"
                  ? 400
                  : 503
            : error instanceof z.ZodError
              ? 400
              : 500,
      );
    });
  });
}
export const workspaceRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
export function configuredService(directory: string) {
  return new IntegratedWorkspaceService(
    directory,
    new JsonModelGateway({
      apiKey: process.env.MODEL_API_KEY ?? "",
      baseUrl: process.env.MODEL_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.MODEL_NAME ?? "",
    }),
    createModelGatewayFromEnv(),
    JSON.stringify([process.env.MODEL_BASE_URL, process.env.MODEL_NAME]),
  );
}
