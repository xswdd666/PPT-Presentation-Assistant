import type {
  AnalysisRun,
  PageAnalysis,
  AnalysisSnapshot,
  AnalysisGeneration,
  ReplyGeneration,
  ReviewThread,
} from "@deck-rehearsal/contracts";
export interface WorkItem {
  id: string;
  kind: "reply" | "analysis";
  fingerprint: string;
  requestKey: string;
  generation: ReplyGeneration | AnalysisGeneration;
  leaseUntil?: number;
  token?: string;
  userReplyId?: string;
}
export interface WorkerData {
  pageCache?: Record<string, PageAnalysis>;
  snapshots: Record<string, AnalysisSnapshot>;
  threads: Record<string, { projectId: string; thread: ReviewThread }>;
  jobs: Record<string, WorkItem>;
  analysis: Record<string, AnalysisRun>;
}
export const emptyWorkerData = (): WorkerData => ({
  snapshots: {},
  threads: {},
  jobs: {},
  analysis: {},
});
/** Transactions must be atomic across workers, rollback on throw, and return detached values. */
export interface WorkerStore {
  transaction<T>(work: (draft: WorkerData) => T): Promise<T>;
  read(): Promise<WorkerData>;
}
export class MemoryWorkerStore implements WorkerStore {
  private data = emptyWorkerData();
  async transaction<T>(work: (draft: WorkerData) => T): Promise<T> {
    const draft = structuredClone(this.data),
      result = work(draft);
    this.data = draft;
    return await Promise.resolve(structuredClone(result));
  }
  read() {
    return Promise.resolve(structuredClone(this.data));
  }
}

export type { AnalysisGeneration } from "@deck-rehearsal/contracts";
