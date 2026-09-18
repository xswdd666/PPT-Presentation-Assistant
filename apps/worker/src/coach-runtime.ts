import { randomUUID } from "node:crypto";
import type {
  CoachAction,
  CoachData,
  CoachModel,
  CoachRun,
  CoachStore,
  CoachStep,
  CoachToolName,
  CoachToolRegistry,
  DecideCoachProposal,
  StartCoachRun,
} from "@deck-rehearsal/contracts";

const tools: CoachToolName[] = [
  "inspect_deck",
  "inspect_slide",
  "summarize_reviews",
  "ask_reviewer",
  "check_narrative",
  "propose_ppt_rewrite",
  "propose_script_rewrite",
];
const terminal = new Set([
  "completed",
  "failed",
  "stale",
  "cancelled",
  "waiting_approval",
]);

export class CoachAgentRuntime {
  constructor(
    private readonly store: CoachStore,
    private readonly model: CoachModel,
    private readonly registry: CoachToolRegistry,
    private readonly options: {
      now?: () => number;
      acceptProposal?: (
        run: CoachRun,
        proposalId: string,
        key: string,
      ) => Promise<void>;
    } = {},
  ) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private iso() {
    return new Date(this.now()).toISOString();
  }
  async start(input: StartCoachRun): Promise<CoachRun> {
    if (!input.objective.trim() || !input.idempotencyKey.trim())
      throw new Error("目标和幂等键不能为空");
    if (
      (await this.store.currentVersion(input.projectId)) !== input.baseVersionId
    )
      throw new Error("版本已变化");
    return this.store.transaction((data) => {
      const existing = Object.values(data.coachRuns).find(
        (run) =>
          run.projectId === input.projectId &&
          run.startKey === input.idempotencyKey,
      );
      if (existing) return existing;
      const at = this.iso();
      const run: CoachRun = {
        id: `coach_run_${randomUUID()}`,
        projectId: input.projectId,
        baseVersionId: input.baseVersionId,
        objective: input.objective.trim(),
        state: "queued",
        plan: [],
        currentStep: 0,
        maxSteps: 8,
        modelCalls: 0,
        toolCalls: 0,
        steps: [],
        proposals: [],
        startKey: input.idempotencyKey,
        createdAt: at,
        updatedAt: at,
      };
      data.coachRuns[run.id] = run;
      data.coachRunByProject[input.projectId] = run.id;
      return run;
    });
  }
  async get(runId: string): Promise<CoachRun> {
    const run = (await this.store.read()).coachRuns[runId];
    if (!run) throw new Error("教练任务不存在");
    return structuredClone(run);
  }
  async getCurrent(projectId: string): Promise<CoachRun | undefined> {
    const data = await this.store.read();
    const id = data.coachRunByProject[projectId];
    return id ? structuredClone(data.coachRuns[id]) : undefined;
  }
  async runNext(): Promise<boolean> {
    const token = randomUUID();
    const candidate = await this.store.transaction((data) => {
      const run = Object.values(data.coachRuns).find(
        (item) =>
          !terminal.has(item.state) &&
          (!item.token || (item.leaseUntil ?? 0) < this.now()),
      );
      if (!run) return undefined;
      if (
        run.currentStep >= run.maxSteps ||
        run.modelCalls >= 6 ||
        run.toolCalls >= 6
      ) {
        run.summary = "已达到本次教练分析预算，保留现有观察与提案。";
        run.state = run.proposals.some(
          (proposal) => proposal.state === "pending",
        )
          ? "waiting_approval"
          : "completed";
        run.updatedAt = this.iso();
        return { budgetStopped: true, run: structuredClone(run) };
      }
      run.token = token;
      run.leaseUntil = this.now() + 360000;
      run.state = run.steps.length ? "running" : "planning";
      return { budgetStopped: false, run: structuredClone(run) };
    });
    if (!candidate) return false;
    if (candidate.budgetStopped) return true;
    const claimed = candidate.run;
    if (
      (await this.store.currentVersion(claimed.projectId)) !==
      claimed.baseVersionId
    ) {
      await this.store.transaction((draft) => {
        const run = draft.coachRuns[claimed.id];
        if (run?.token === token) {
          run.state = "stale";
          delete run.token;
          delete run.leaseUntil;
          run.updatedAt = this.iso();
        }
      });
      return true;
    }
    try {
      const action = await this.model.next({
        objective: claimed.objective,
        contextSummary: "",
        plan: claimed.plan,
        completedSteps: claimed.steps
          .filter((step) => step.status === "completed")
          .map((step) => ({
            action: step.action,
            ...(step.observation ? { observation: step.observation } : {}),
          })),
        pendingProposals: claimed.proposals.filter(
          (proposal) => proposal.state === "pending",
        ),
        budgets: {
          stepsLeft: claimed.maxSteps - claimed.currentStep,
          modelCallsLeft: 6 - claimed.modelCalls,
          toolCallsLeft: 6 - claimed.toolCalls,
        },
        availableTools: tools,
        ...(claimed.lastDecision ? { lastDecision: claimed.lastDecision } : {}),
      });
      await this.applyAction(claimed.id, action, token);
    } catch (error) {
      await this.store.transaction((data) => {
        const run = data.coachRuns[claimed.id];
        if (!run || run.token !== token) return;
        const started = run.steps.findLast((step) => step.status === "started");
        if (started) started.status = "failed";
        run.state = "failed";
        run.error = {
          code: "invalid_output",
          message: error instanceof Error ? error.message : "教练执行失败",
          retryable: true,
          recovery: "retry",
        };
        delete run.token;
        delete run.leaseUntil;
        run.updatedAt = this.iso();
      });
    }
    return true;
  }
  private async applyAction(runId: string, action: CoachAction, token: string) {
    if (action.type === "call_tool") {
      const prepared = await this.store.transaction((data: CoachData) => {
        const run = data.coachRuns[runId];
        if (!run || run.token !== token) return undefined;
        if (!run.steps.length) throw new Error("首个动作必须设置计划");
        const previous = run.steps.find(
          (item) =>
            item.action.type === "call_tool" &&
            item.action.callId === action.callId &&
            item.status === "completed",
        );
        const at = this.iso();
        const step: CoachStep = {
          id: `coach_step_${randomUUID()}`,
          sequence: run.steps.length + 1,
          action,
          ...(previous?.observation
            ? { observation: previous.observation }
            : {}),
          status: previous ? "completed" : "started",
          createdAt: at,
          ...(previous ? { completedAt: at } : {}),
        };
        run.steps.push(step);
        run.currentStep++;
        run.modelCalls++;
        run.updatedAt = at;
        return previous
          ? { reused: true, stepId: step.id, run: structuredClone(run) }
          : { reused: false, stepId: step.id, run: structuredClone(run) };
      });
      if (!prepared) return;
      if (prepared.reused) {
        await this.store.transaction((data) => {
          const run = data.coachRuns[runId];
          if (run?.token === token) {
            delete run.token;
            delete run.leaseUntil;
          }
        });
        return;
      }
      const observation = await this.registry.execute(action, {
        run: prepared.run,
      });
      await this.store.transaction((data) => {
        const run = data.coachRuns[runId];
        const step = run?.steps.find((item) => item.id === prepared.stepId);
        if (!run || !step || step.status !== "started") return;
        step.observation = observation;
        step.status = "completed";
        step.completedAt = this.iso();
        run.toolCalls++;
        run.updatedAt = this.iso();
        const proposal = (
          observation.data as
            { proposal?: CoachRun["proposals"][number] } | undefined
        )?.proposal;
        if (proposal && !run.proposals.some((item) => item.id === proposal.id))
          run.proposals.push(proposal);
        delete run.token;
        delete run.leaseUntil;
      });
      return;
    }
    return this.store.transaction((data: CoachData) => {
      const run = data.coachRuns[runId];
      if (!run || run.token !== token) return;
      if (!run.steps.length && action.type !== "set_plan")
        throw new Error("首个动作必须设置计划");
      if (
        action.type === "set_plan" &&
        (run.steps.length || action.items.length < 3 || action.items.length > 5)
      )
        throw new Error("计划必须包含 3–5 项");
      if (
        action.type === "complete" &&
        run.proposals.some((proposal) => proposal.state === "pending")
      )
        throw new Error("存在未决提案，必须先请求用户审批");
      const at = this.iso();
      const step: CoachStep = {
        id: `coach_step_${randomUUID()}`,
        sequence: run.steps.length + 1,
        action,
        status: "completed",
        createdAt: at,
        completedAt: at,
      };
      run.steps.push(step);
      run.currentStep++;
      run.modelCalls++;
      run.updatedAt = at;
      if (action.type === "set_plan") {
        run.plan = action.items.map((item) => ({ ...item, status: "pending" }));
        run.state = "running";
      } else if (action.type === "complete") {
        run.summary = action.summary;
        run.state = "completed";
      } else run.state = "waiting_approval";
      delete run.token;
      delete run.leaseUntil;
    });
  }
  async decide(input: DecideCoachProposal): Promise<CoachRun> {
    const run = await this.get(input.runId);
    const proposal = run.proposals.find((item) => item.id === input.proposalId);
    if (!proposal) throw new Error("提案不存在");
    if (proposal.state !== "pending") return run;
    if (input.decision === "accepted") {
      if (!proposal.suggestionId || !this.options.acceptProposal)
        throw new Error("该提案需要手动处理");
      await this.options.acceptProposal(run, proposal.id, input.idempotencyKey);
    }
    await this.store.transaction((data) => {
      const latest = data.coachRuns[input.runId];
      const target = latest?.proposals.find(
        (item) => item.id === input.proposalId,
      );
      if (!latest || !target || target.state !== "pending") return;
      target.state = input.decision;
      target.decisionAt = this.iso();
      latest.lastDecision = {
        proposalId: input.proposalId,
        decision: input.decision,
      };
      latest.state = input.decision === "accepted" ? "stale" : "queued";
      latest.updatedAt = this.iso();
    });
    return this.get(input.runId);
  }
  async retry(runId: string) {
    await this.store.transaction((data) => {
      const run = data.coachRuns[runId];
      if (run?.state === "failed" && run.error?.retryable) {
        run.state = "queued";
        delete run.error;
        const failed = run.steps.findLast((step) => step.status === "failed");
        if (failed) run.steps.splice(run.steps.indexOf(failed), 1);
      }
    });
    return this.get(runId);
  }
  async cancel(runId: string) {
    await this.store.transaction((d) => {
      const run = d.coachRuns[runId];
      if (run) run.state = "cancelled";
    });
    return this.get(runId);
  }
}
