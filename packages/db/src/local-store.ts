import {
  mkdir,
  readFile,
  rename,
  writeFile,
  rmdir,
  unlink,
} from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ObjectStorage,
  WorkflowRepository,
  WorkspaceData,
} from "@deck-rehearsal/contracts";
import type { LocalWorkspaceData } from "./upload-state.js";
const transactions = new Map<string, Promise<unknown>>();
export function emptyWorkspace(): LocalWorkspaceData {
  return {
    schemaVersion: 2,
    uploadStates: {},
    projects: {},
    sources: {},
    versions: {},
    slides: {},
    contexts: {},
    jobs: {},
    issues: {},
    comments: {},
    rewrites: {},
    changeSets: {},
    scripts: {},
    documents: {},
    threads: {},
    suggestions: {},
    warnings: {},
    requests: {},
    routes: {},
  };
}
/** Atomic local snapshots with a cross-process directory lock. Stop writers before recovering an abandoned lock. */
export class LocalWorkspaceStore {
  constructor(readonly directory: string) {}
  async read(): Promise<LocalWorkspaceData> {
    try {
      const data = JSON.parse(
        await readFile(resolve(this.directory, "workspace.json"), "utf8"),
      ) as WorkspaceData & Partial<Pick<LocalWorkspaceData, "uploadStates">>;
      const version = (data as { schemaVersion?: number }).schemaVersion;
      if (version !== undefined && version !== 1 && version !== 2)
        throw new Error("不支持的数据库版本，请使用兼容的应用或恢复备份");
      return {
        ...emptyWorkspace(),
        ...data,
        schemaVersion: 2,
        uploadStates: data.uploadStates ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptyWorkspace();
      throw error;
    }
  }
  transaction<T>(
    work: (
      data: LocalWorkspaceData,
      repository: WorkflowRepository,
    ) => Promise<T> | T,
  ): Promise<T> {
    const directory = resolve(this.directory);
    const task = (transactions.get(directory) ?? Promise.resolve()).then(
      async () => {
        await mkdir(directory, { recursive: true });
        const lock = resolve(directory, "workspace.lock");
        const deadline = Date.now() + 15000;
        for (;;) {
          try {
            await mkdir(lock);
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            if (Date.now() >= deadline)
              throw new Error(
                "工作区正在更新，请稍后重试；持续失败时检查存储锁",
              );
            await new Promise((done) => setTimeout(done, 20));
          }
        }
        const temp = resolve(directory, `${randomUUID()}.tmp`);
        try {
          const data = await this.read();
          const result = await work(data, repositoryFor(data));
          await writeFile(temp, JSON.stringify(data), {
            flag: "wx",
            mode: 0o600,
          });
          await rename(temp, resolve(directory, "workspace.json"));
          return structuredClone(result);
        } finally {
          await unlink(temp)
            .catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            })
            .finally(() => rmdir(lock));
        }
      },
    );
    const tail = task.catch(() => undefined);
    transactions.set(directory, tail);
    void tail.then(() => {
      if (transactions.get(directory) === tail) transactions.delete(directory);
    });
    return task;
  }
}
export function repositoryFor(d: WorkspaceData): WorkflowRepository {
  const save = <T>(map: Record<string, T>, key: string, value: T) => {
    map[key] = structuredClone(value);
    return Promise.resolve();
  };
  const get = <T>(map: Record<string, T>, key: string) =>
    Promise.resolve(structuredClone(map[key]));
  return {
    saveProject: (v) => save(d.projects, v.id, v),
    getProject: (id) => get(d.projects, id),
    saveSourceFile: (v) => {
      const old = d.sources[v.id];
      if (
        old &&
        (old.storageKey !== v.storageKey ||
          old.projectId !== v.projectId ||
          old.sizeBytes !== v.sizeBytes ||
          old.originalName !== v.originalName)
      )
        throw new Error("原始文件引用不可覆盖");
      return save(d.sources, v.id, v);
    },
    getSourceFile: (id) => get(d.sources, id),
    saveVersion: (v) => {
      const old = d.versions[v.id];
      if (
        old &&
        (old.storageKey !== v.storageKey ||
          old.sourceFileId !== v.sourceFileId ||
          old.projectId !== v.projectId ||
          old.parentVersionId !== v.parentVersionId ||
          old.versionNumber !== v.versionNumber)
      )
        throw new Error("历史版本文件引用不可覆盖");
      return save(d.versions, v.id, v);
    },
    getVersion: (id) => get(d.versions, id),
    listVersions: (id) =>
      Promise.resolve(
        Object.values(d.versions)
          .filter((v) => v.projectId === id)
          .sort((a, b) => a.versionNumber - b.versionNumber),
      ),
    saveSlides: (id, v) => save(d.slides, id, v),
    getSlides: (id) => Promise.resolve(structuredClone(d.slides[id] ?? [])),
    saveContext: (v) => save(d.contexts, v.deckVersionId, v),
    getContext: (id) => get(d.contexts, id),
    saveAnalysisJob: (v) => save(d.jobs, v.id, v),
    saveIssue: (v) => save(d.issues, v.id, v),
    saveComment: (v) => save(d.comments, v.id, v),
    saveRewrite: (v) => save(d.rewrites, v.id, v),
    getRewrite: (id) => get(d.rewrites, id),
    saveChangeSet: (v) => save(d.changeSets, v.projectId, v),
    getChangeSet: (id) => get(d.changeSets, id),
    saveScript: (v) => save(d.scripts, v.id, v),
  };
}
export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly directory: string) {}
  private path(key: string) {
    const root = resolve(this.directory);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error("无效文件路径");
    return path;
  }
  async put(key: string, content: Uint8Array) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: "wx" });
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
  createSignedDownloadUrl(): Promise<string> {
    return Promise.reject(new Error("本地文件通过版本下载接口访问"));
  }
}
