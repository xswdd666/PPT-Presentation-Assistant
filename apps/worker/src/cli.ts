import { createLocalWorker, defaultWorkerPath } from "./bootstrap.js";
const worker = createLocalWorker(defaultWorkerPath());
const shutdown = new AbortController();
process.once("SIGINT", () => {
  shutdown.abort();
});
process.once("SIGTERM", () => {
  shutdown.abort();
});
const once = process.argv.includes("--once");
do {
  try {
    const ran = await worker.runNext();
    if (!ran && !once)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch {
    // Never log raw payloads, API keys, or provider exceptions.
    process.stderr.write("AI worker storage unavailable; retrying.\n");
    if (once) process.exitCode = 1;
    else await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} while (!once && !shutdown.signal.aborted);
