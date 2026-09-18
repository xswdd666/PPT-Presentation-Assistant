/** Local preview repair only: does not call AI or change PPTX files. */
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalObjectStorage, LocalWorkspaceStore } from "@deck-rehearsal/db";
import { OpenXmlPptxProcessor } from "@deck-rehearsal/pptx";
import type { IntegratedData } from "./worker-store.js";
async function main() {
  const directory = resolve(process.argv[2] ?? ".local-data");
  const store = new LocalWorkspaceStore(directory);
  const objects = new LocalObjectStorage(resolve(directory, "objects"));
  const parser = new OpenXmlPptxProcessor();
  const backup = resolve(
    directory,
    `workspace.preview-backup-${String(Date.now())}.json`,
  );
  await store.transaction(async (data) => {
    if (
      Object.values((data as IntegratedData).aiWorker?.jobs ?? {}).some(
        (job) => job.generation.state === "generating",
      )
    )
      throw new Error("AI task is active; retry after it completes.");
    await copyFile(resolve(directory, "workspace.json"), backup);
    let pages = 0;
    for (const version of Object.values(data.versions)) {
      const existing = data.slides[version.id];
      if (!existing?.length) continue;
      const parsed = await parser.parse(
        await objects.get(version.storageKey),
        version.id,
      );
      for (const slide of parsed.slides) {
        const saved = existing.find((item) => item.id === slide.id);
        if (!saved) continue;
        saved.elements = slide.elements;
        if (slide.width !== undefined) saved.width = slide.width;
        if (slide.height !== undefined) saved.height = slide.height;
        pages++;
      }
    }
    console.log(
      `Updated local preview geometry and typography for ${String(pages)} pages. AI history/cache unchanged.`,
    );
  });
  console.log(`Backup: ${backup}`);
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Preview refresh failed",
  );
  process.exitCode = 1;
});
