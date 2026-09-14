import type { PageAnalysis } from "@deck-rehearsal/contracts";
import type { AnalysisCache } from "@deck-rehearsal/ai/runtime";
import type { WorkerStore } from "./store.js";
export class StoreAnalysisCache implements AnalysisCache {
  constructor(private readonly store: WorkerStore) {}
  async get(key: string) {
    return (await this.store.read()).pageCache?.[key];
  }
  async set(key: string, value: PageAnalysis) {
    await this.store.transaction((d) => {
      d.pageCache ??= {};
      d.pageCache[key] = structuredClone(value);
    });
  }
}
