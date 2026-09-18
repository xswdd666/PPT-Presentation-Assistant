import { describe, expect, it } from "vitest";
import { CoachModelAdapter } from "./coach-agent.js";

const turn = {
  objective: "改进汇报",
  contextSummary: "12 页",
  plan: [],
  completedSteps: [
    {
      action: {
        type: "set_plan" as const,
        items: [
          { id: "a", title: "A", criterion: "A" },
          { id: "b", title: "B", criterion: "B" },
          { id: "c", title: "C", criterion: "C" },
        ],
      },
    },
  ],
  pendingProposals: [],
  budgets: { stepsLeft: 8, modelCallsLeft: 6, toolCallsLeft: 6 },
  availableTools: ["inspect_deck" as const],
};

describe("CoachModelAdapter", () => {
  it("accepts one schema-valid action and rejects an unknown tool", async () => {
    const valid = new CoachModelAdapter({
      generate: (_task, _input, schema) =>
        Promise.resolve(
          schema.parse({
            type: "call_tool",
            callId: "c1",
            tool: "inspect_deck",
            input: { includeScripts: true },
            reason: "读取目录",
          }),
        ),
    });
    await expect(valid.next(turn)).resolves.toMatchObject({
      type: "call_tool",
      tool: "inspect_deck",
    });
    const invalid = new CoachModelAdapter({
      generate: (_task, _input, schema) =>
        Promise.resolve(
          schema.parse({
            type: "call_tool",
            callId: "c2",
            tool: "delete_file",
            input: {},
            reason: "不允许",
          }),
        ),
    });
    await expect(invalid.next(turn)).rejects.toThrow();
  });
});
