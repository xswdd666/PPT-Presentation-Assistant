import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createApplication,
  configuredService,
  workspaceRoot,
} from "./server/http.js";
try {
  process.loadEnvFile(resolve(workspaceRoot, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const result = await build({
  entryPoints: [resolve(workspaceRoot, "apps/web/src/client/app.tsx")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const service = configuredService(
  process.env.DATA_DIR ?? resolve(workspaceRoot, ".local-data"),
);
export const webServer = createApplication(
  service,
  {
    js: result.outputFiles[0]?.text ?? "",
    css: await readFile(
      resolve(workspaceRoot, "apps/web/src/client/styles.css"),
      "utf8",
    ),
  },
  (entry) => console.info(JSON.stringify({ event: "http_request", ...entry })),
);
const interval =
  process.env.EMBEDDED_WORKER === "false"
    ? undefined
    : setInterval(() => {
        void service
          .processNext()
          .catch(() =>
            console.error(
              "Analysis worker failed; queued jobs remain recoverable.",
            ),
          );
      }, 1000);
webServer.on("close", () => {
  if (interval) clearInterval(interval);
});
webServer.listen(
  Number(process.env.WEB_PORT ?? 3000),
  process.env.WEB_HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Deck Rehearsal: http://127.0.0.1:${process.env.WEB_PORT ?? "3000"}/projects`,
    ),
);
