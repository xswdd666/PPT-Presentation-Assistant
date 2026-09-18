import { z } from "zod";
import type { AiFailure } from "@deck-rehearsal/contracts";
export const PROMPT_VERSION = "review-2026-09-14.1";
export const SCHEMA_VERSION = "ai-output-1.0.0";
export const displayLength = (value: string) =>
  [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(value)]
    .length;
export const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
export const text = z.string().trim().min(1).max(8000);
export const commentBodySchema = z
  .string()
  .transform(normalized)
  .refine((s) => displayLength(s) <= 100, "主评论最多 100 个显示字符");
export const replySchema = z.object({
  body: commentBodySchema,
});
export const roleSchema = z.enum([
  "jack",
  "olivia",
  "ryan",
  "mia",
  "emma",
  "leo",
  "sophie",
]);
export const analysisSchema = z.object({
  goal: text,
  expectedAudienceResponse: text,
  narrativeSummary: text,
  reviewers: z
    .array(z.object({ id: roleSchema, reason: text }))
    .min(3)
    .max(4),
  comments: z
    .array(
      z.object({
        reviewerId: roleSchema,
        slideId: text,
        body: commentBodySchema,
        evidence: text,
        impact: text,
        suggestedAction: text,
        rootCause: text.optional(),
      }),
    )
    .min(1)
    .max(60),
});
export type AnalysisResult = z.infer<typeof analysisSchema>;
export const pageAnalysisSchema = z.object({
  slideId: text,
  summary: text,
  findings: z
    .array(
      z.object({
        dimension: z.enum([
          "structure",
          "narrative",
          "evidence",
          "visual",
          "scenario_fit",
        ]),
        rootCause: text,
        evidence: text,
        suggestedAction: text,
      }),
    )
    .max(20),
});
export const rewriteSchema = z.object({
  replacementText: text,
  rationale: text,
  factsPreserved: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export const scriptSchema = z.object({
  pages: z.array(
    z.object({
      slideId: text,
      purpose: text,
      keyMessage: text,
      speakingOrder: z.array(text),
      narration: z.string().trim().min(1).max(800),
      // An opening or closing page may legitimately need no transition.
      transitionIn: z.string().trim().max(8000).nullish(),
      transitionOut: z.string().trim().max(8000).nullish(),
      durationSeconds: z.number().positive(),
      optionalContent: z.array(text),
      likelyQuestions: z.array(text),
    }),
  ),
  compressionAdvice: z.string().trim().max(8000).nullish(),
});
export class AiError extends Error {
  constructor(public readonly failure: AiFailure) {
    super(failure.message);
    this.name = "AiError";
  }
}
export function fail(code: AiFailure["code"], message: string): never {
  throw new AiError({
    code,
    message,
    retryable: [
      "invalid_output",
      "timeout",
      "rate_limited",
      "model_unavailable",
      "thread_busy",
    ].includes(code),
    recovery:
      code === "version_conflict"
        ? "refresh"
        : code === "not_configured"
          ? "configure"
          : ["invalid_input", "not_found", "idempotency_conflict"].includes(
                code,
              )
            ? "correct_input"
            : "retry",
  });
}
export function safeFailure(error: unknown): AiFailure {
  if (
    error instanceof TypeError &&
    error.cause &&
    typeof error.cause === "object" &&
    "code" in error.cause &&
    [
      "UND_ERR_CONNECT_TIMEOUT",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNRESET",
    ].includes(String(error.cause.code))
  ) {
    return {
      code: "model_unavailable",
      message:
        "无法连接模型服务（连接超时或网络不可达），请检查网络或代理后重试；已保存页面将复用",
      retryable: true,
      recovery: "retry",
    };
  }
  if (
    error instanceof Error &&
    "code" in error &&
    "syscall" in error &&
    ["EPERM", "EACCES", "EBUSY"].includes(String(error.code)) &&
    error.syscall === "rename"
  ) {
    return {
      code: "model_unavailable",
      message: "本地进度保存受阻，已保存的页面会保留，请稍后重试",
      retryable: true,
      recovery: "retry",
    };
  }
  return error instanceof AiError
    ? error.failure
    : {
        code: "model_unavailable",
        message: "AI 处理失败，请重试",
        retryable: true,
        recovery: "retry",
      };
}
export const OUTPUT_JSON_SCHEMAS = Object.fromEntries(
  Object.entries({
    analysis: analysisSchema,
    page: pageAnalysisSchema,
    reply: replySchema,
    rewrite: rewriteSchema,
    script: scriptSchema,
  }).map(([key, schema]) => [
    key,
    z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }),
  ]),
);
