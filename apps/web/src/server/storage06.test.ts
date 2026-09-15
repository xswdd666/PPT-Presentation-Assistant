import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalWorkspaceStore } from "@deck-rehearsal/db";
const run = promisify(execFile);
it("06 empty/legacy migration and separate OS processes preserve atomic writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "integration06-db-"));
  try {
    const store = new LocalWorkspaceStore(dir);
    expect((await store.read()).schemaVersion).toBe(2);
    await writeFile(
      join(dir, "workspace.json"),
      JSON.stringify({
        projects: {},
        requests: { counter: { fingerprint: "counter", result: 0 } },
      }),
    );
    expect((await store.read()).uploadStates).toEqual({});
    const script = join(dir, "writer.mjs");
    await writeFile(
      script,
      `import { LocalWorkspaceStore } from ${JSON.stringify(pathToFileURL(resolve("packages/db/src/local-store.ts")).href)};
      const store = new LocalWorkspaceStore(process.argv[2]);
      for (let i=0;i<12;i++) await store.transaction(async (d) => {
        const count=d.requests.counter.result;
        await new Promise(r=>setTimeout(r,5));
        d.requests.counter.result=count+1;
      });`,
    );
    const args = [
      "--import",
      pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      script,
      dir,
    ];
    await Promise.all([
      run(process.execPath, args),
      run(process.execPath, args),
    ]);
    expect((await store.read()).requests.counter?.result).toBe(24);
    const before = await readFile(join(dir, "workspace.json"), "utf8");
    await expect(
      store.transaction((d) => {
        d.requests.counter = { fingerprint: "bad", result: 99 };
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await readFile(join(dir, "workspace.json"), "utf8")).toBe(before);
    await writeFile(join(dir, "workspace.json"), '{"schemaVersion":999}');
    await expect(store.read()).rejects.toThrow("不支持的数据库版本");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
