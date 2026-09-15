import { resolve } from "node:path";
import { configuredService, workspaceRoot } from "./http.js";
try {
  process.loadEnvFile(resolve(workspaceRoot, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const service = configuredService(
  process.env.DATA_DIR ?? resolve(workspaceRoot, ".local-data"),
);
const shutdown = new AbortController();
process.once("SIGINT", () => {
  shutdown.abort();
});
process.once("SIGTERM", () => {
  shutdown.abort();
});
const once = process.argv.includes("--once");
if (process.argv.includes("--migrate")) {
  await service.store.transaction(() => undefined);
  process.stdout.write("Workspace schema v2 ready.\n");
} else
  do {
    try {
      await service.processNext();
    } catch {
      process.stderr.write("Worker storage unavailable; retrying.\n");
      if (once) process.exitCode = 1;
    }
    if (!once && !shutdown.signal.aborted)
      await new Promise((done) => setTimeout(done, 1000));
  } while (!once && !shutdown.signal.aborted);
