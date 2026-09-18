import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  CoachAction,
  CoachModel,
  CoachTurnInput,
} from "@deck-rehearsal/contracts";

const short = z.string().trim().min(1).max(1000);
const setPlanSchema = z.object({
  type: z.literal("set_plan"),
  items: z
    .array(z.object({ id: short, title: short, criterion: short }))
    .min(3)
    .max(5),
});
const call = {
  type: z.literal("call_tool"),
  callId: short,
  reason: short,
};
const selection = z.object({
  deckVersionId: short,
  slideId: short,
  elementId: short,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  selectedText: z.string().max(8000),
});
const toolActions = [
  z.object({
    ...call,
    tool: z.literal("inspect_deck"),
    input: z.object({ includeScripts: z.boolean() }),
  }),
  z.object({
    ...call,
    tool: z.literal("inspect_slide"),
    input: z.object({ slideId: short }),
  }),
  z.object({
    ...call,
    tool: z.literal("summarize_reviews"),
    input: z.object({ dimensions: z.array(short).optional() }),
  }),
  z.object({
    ...call,
    tool: z.literal("ask_reviewer"),
    input: z.object({
      reviewerId: short,
      question: short,
      relatedSlideIds: z.array(short),
    }),
  }),
  z.object({
    ...call,
    tool: z.literal("check_narrative"),
    input: z.object({
      focus: z.enum(["structure", "duration", "transitions", "evidence"]),
    }),
  }),
  z.object({
    ...call,
    tool: z.literal("propose_ppt_rewrite"),
    input: z.object({ selection, instruction: short }),
  }),
  z.object({
    ...call,
    tool: z.literal("propose_script_rewrite"),
    input: z.object({
      selection,
      scriptRevision: z.number().int().nonnegative(),
      instruction: short,
    }),
  }),
] as const;
export const coachActionSchema = z.union([
  setPlanSchema,
  ...toolActions,
  z.object({
    type: z.literal("request_approval"),
    proposalIds: z.array(short).min(1).max(5),
    message: short,
  }),
  z.object({ type: z.literal("complete"), summary: short }),
]);
interface StructuredGenerator {
  generate<T>(task: string, input: unknown, schema: z.ZodType<T>): Promise<T>;
}
const prompt = readFileSync(
  new URL("./prompts/coach.md", import.meta.url),
  "utf8",
);
export class CoachModelAdapter implements CoachModel {
  constructor(private readonly gateway: StructuredGenerator) {}
  async next(input: CoachTurnInput): Promise<CoachAction> {
    const action = await this.gateway.generate(
      prompt,
      input,
      input.completedSteps.length ? coachActionSchema : setPlanSchema,
    );
    if (
      action.type === "call_tool" &&
      !input.availableTools.includes(action.tool)
    )
      throw new Error("模型请求了不可用工具");
    return action;
  }
}
