import { describe, expect, it } from "vitest";
import type {
  CoachAction,
  CoachModel,
  CoachRun,
  CoachStore,
  CoachToolRegistry,
} from "@deck-rehearsal/contracts";
import { CoachAgentRuntime } from "./coach-runtime.js";

class MemoryCoachStore implements CoachStore {
  data: {
    coachRuns: Record<string, CoachRun>;
    coachRunByProject: Record<string, string>;
  } = { coachRuns: {}, coachRunByProject: {} };
  read() {
    return Promise.resolve(structuredClone(this.data));
  }
  async transaction<T>(work: (data: typeof this.data) => T | Promise<T>) {
    const result = await work(this.data);
    return structuredClone(result);
  }
  currentVersion(projectId: string) {
    return Promise.resolve(projectId === "p1" ? "v1" : undefined);
  }
}

describe("CoachAgentRuntime", () => {
  it("creates a durable run and advances exactly one visible action per tick", async () => {
    const actions: CoachAction[] = [
      {
        type: "set_plan",
        items: [
          { id: "p1", title: "检查结构", criterion: "重点明确" },
          { id: "p2", title: "核对证据", criterion: "有页面依据" },
          { id: "p3", title: "形成提案", criterion: "可逐项审批" },
        ],
      },
      { type: "complete", summary: "检查完成" },
    ];
    const model: CoachModel = {
      next: () => Promise.resolve(requireAction(actions.shift())),
    };
    const tools: CoachToolRegistry = {
      execute: () => Promise.resolve({ kind: "summary", summary: "unused" }),
    };
    const store = new MemoryCoachStore();
    const runtime = new CoachAgentRuntime(store, model, tools, {
      now: () => 1,
    });
    const created = await runtime.start({
      projectId: "p1",
      baseVersionId: "v1",
      objective: "让老师理解设计逻辑",
      idempotencyKey: "start-1",
    });
    expect(created.state).toBe("queued");
    expect(created.steps).toHaveLength(0);
    expect(await runtime.runNext()).toBe(true);
    const planned = await runtime.get(created.id);
    expect(planned.state).toBe("running");
    expect(planned.plan).toHaveLength(3);
    expect(planned.steps).toHaveLength(1);
    expect(await runtime.runNext()).toBe(true);
    const completed = await runtime.get(created.id);
    expect(completed.state).toBe("completed");
    expect(completed.summary).toBe("检查完成");
    expect(completed.steps).toHaveLength(2);
  });

  it("reuses a completed observation when the model repeats a callId", async () => {
    const actions: CoachAction[] = [
      {
        type: "set_plan",
        items: [
          { id: "p1", title: "检查结构", criterion: "重点明确" },
          { id: "p2", title: "核对证据", criterion: "有页面依据" },
          { id: "p3", title: "形成提案", criterion: "可逐项审批" },
        ],
      },
      {
        type: "call_tool",
        callId: "deck-once",
        tool: "inspect_deck",
        input: { includeScripts: false },
        reason: "先查看目录",
      },
      {
        type: "call_tool",
        callId: "deck-once",
        tool: "inspect_deck",
        input: { includeScripts: false },
        reason: "恢复上次读取",
      },
    ];
    let executions = 0;
    const runtime = new CoachAgentRuntime(
      new MemoryCoachStore(),
      { next: () => Promise.resolve(requireAction(actions.shift())) },
      {
        execute: () => {
          executions++;
          return Promise.resolve({ kind: "deck", summary: "12 页" });
        },
      },
      { now: () => 2 },
    );
    const run = await runtime.start({
      projectId: "p1",
      baseVersionId: "v1",
      objective: "改进汇报",
      idempotencyKey: "start-2",
    });
    await runtime.runNext();
    await runtime.runNext();
    await runtime.runNext();
    const restored = await runtime.get(run.id);
    expect(executions).toBe(1);
    expect(restored.toolCalls).toBe(1);
    expect(restored.steps.at(-1)?.observation?.summary).toBe("12 页");
  });

  it("does not complete while a write proposal is still pending", async () => {
    const actions: CoachAction[] = [
      {
        type: "set_plan",
        items: [
          { id: "p1", title: "检查结构", criterion: "重点明确" },
          { id: "p2", title: "核对证据", criterion: "有页面依据" },
          { id: "p3", title: "形成提案", criterion: "可逐项审批" },
        ],
      },
      { type: "complete", summary: "不应跳过审批" },
    ];
    const store = new MemoryCoachStore();
    const runtime = new CoachAgentRuntime(
      store,
      { next: () => Promise.resolve(requireAction(actions.shift())) },
      {
        execute: () => Promise.resolve({ kind: "summary", summary: "unused" }),
      },
    );
    const run = await runtime.start({
      projectId: "p1",
      baseVersionId: "v1",
      objective: "改进汇报",
      idempotencyKey: "pending-proposal",
    });
    await runtime.runNext();
    store.data.coachRuns[run.id]?.proposals.push({
      id: "proposal-1",
      suggestionId: "suggestion-1",
      target: "script",
      title: "精简讲稿",
      instruction: "删去重复内容",
      evidenceSlideIds: ["slide-1"],
      expectedBenefit: "节省时间",
      state: "pending",
    });
    await runtime.runNext();
    expect((await runtime.get(run.id)).state).toBe("failed");
  });
});
function requireAction(action: CoachAction | undefined): CoachAction {
  if (!action) throw new Error("missing action");
  return action;
}
