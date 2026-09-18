import type { AiFailure } from "./ai.js";
import type { TextSelection } from "./types.js";

export type CoachRunState =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "stale"
  | "cancelled";
export type CoachToolName =
  | "inspect_deck"
  | "inspect_slide"
  | "summarize_reviews"
  | "ask_reviewer"
  | "check_narrative"
  | "propose_ppt_rewrite"
  | "propose_script_rewrite";
export interface CoachPlanItem {
  id: string;
  title: string;
  criterion: string;
  status?: "pending" | "running" | "completed";
}
export type CoachAction =
  | { type: "set_plan"; items: CoachPlanItem[] }
  | {
      type: "call_tool";
      callId: string;
      tool: CoachToolName;
      input: unknown;
      reason: string;
    }
  | { type: "request_approval"; proposalIds: string[]; message: string }
  | { type: "complete"; summary: string };
export interface CoachObservation {
  kind: string;
  summary: string;
  slideIds?: string[];
  data?: unknown;
  proposalId?: string;
}
export interface CoachProposal {
  id: string;
  suggestionId?: string;
  target: "ppt" | "script" | "manual_action";
  title: string;
  instruction: string;
  evidenceSlideIds: string[];
  expectedBenefit: string;
  state: "pending" | "accepted" | "rejected" | "stale";
  selection?: TextSelection;
  scriptRevision?: number;
  decisionAt?: string;
}
export interface CoachStep {
  id: string;
  sequence: number;
  action: CoachAction;
  observation?: CoachObservation;
  status: "started" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
}
export interface CoachRun {
  id: string;
  projectId: string;
  baseVersionId: string;
  objective: string;
  state: CoachRunState;
  plan: CoachPlanItem[];
  currentStep: number;
  maxSteps: number;
  modelCalls: number;
  toolCalls: number;
  steps: CoachStep[];
  proposals: CoachProposal[];
  summary?: string;
  error?: AiFailure;
  token?: string;
  leaseUntil?: number;
  startKey?: string;
  lastDecision?: { proposalId: string; decision: "accepted" | "rejected" };
  createdAt: string;
  updatedAt: string;
}
export interface StartCoachRun {
  projectId: string;
  baseVersionId: string;
  objective: string;
  idempotencyKey: string;
}
export interface DecideCoachProposal {
  runId: string;
  proposalId: string;
  decision: "accepted" | "rejected";
  idempotencyKey: string;
}
export interface CoachTurnInput {
  objective: string;
  contextSummary: string;
  plan: CoachPlanItem[];
  completedSteps: { action: CoachAction; observation?: CoachObservation }[];
  pendingProposals: CoachProposal[];
  budgets: { stepsLeft: number; modelCallsLeft: number; toolCallsLeft: number };
  availableTools: CoachToolName[];
  lastDecision?: CoachRun["lastDecision"];
}
export interface CoachModel {
  next(input: CoachTurnInput): Promise<CoachAction>;
}
export interface CoachToolContext {
  run: CoachRun;
}
export interface CoachToolCall {
  callId: string;
  tool: CoachToolName;
  input: unknown;
  reason: string;
}
export interface CoachToolRegistry {
  execute(
    call: CoachToolCall,
    context: CoachToolContext,
  ): Promise<CoachObservation>;
}
export interface CoachData {
  coachRuns: Record<string, CoachRun>;
  coachRunByProject: Record<string, string>;
}
export interface CoachStore {
  read(): Promise<CoachData>;
  transaction<T>(work: (data: CoachData) => T | Promise<T>): Promise<T>;
  currentVersion(projectId: string): Promise<string | undefined>;
}
