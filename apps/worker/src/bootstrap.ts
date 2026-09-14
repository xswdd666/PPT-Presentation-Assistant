import { resolve } from "node:path";
import {
  AnalysisPipeline,
  createModelGatewayFromEnv,
  hash,
} from "@deck-rehearsal/ai/runtime";
import { FileWorkerStore } from "./file-store.js";
import { StoreAnalysisCache } from "./cache.js";
import { ReviewWorker } from "./review-worker.js";
export function createLocalWorker(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const store = new FileWorkerStore(path),
    model = createModelGatewayFromEnv(env);
  const pipeline = new AnalysisPipeline(
    model,
    new StoreAnalysisCache(store),
    hash([env.MODEL_BASE_URL, env.MODEL_NAME]),
  );
  return new ReviewWorker(store, model, pipeline);
}
export function defaultWorkerPath() {
  return resolve(
    process.env.AI_WORKER_STATE_PATH ?? "../../.local-data/ai-worker.json",
  );
}
