import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fail } from "@deck-rehearsal/ai/runtime";
import { emptyWorkerData, type WorkerData, type WorkerStore } from "./store.js";
/** Local durable adapter. DB deployments should implement the same transaction port. */
export class FileWorkerStore implements WorkerStore {
  constructor(private readonly path: string) {}
  async read(): Promise<WorkerData> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as WorkerData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptyWorkerData();
      throw error;
    }
  }
  async transaction<T>(work: (draft: WorkerData) => T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`;
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        fail("thread_busy", "后台存储正在更新，请重试");
      throw error;
    }
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const draft = await this.read(),
        result = work(draft);
      await writeFile(temp, JSON.stringify(draft), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temp, this.path);
      return structuredClone(result);
    } finally {
      await unlink(temp).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rmdir(lock);
    }
  }
}
