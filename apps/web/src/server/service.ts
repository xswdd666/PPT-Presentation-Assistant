import { replaceDocumentRange } from "../client/script-document.js";
import { textDiff } from "../features/slide-rewrite/diff.js";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type {
  WorkspaceData,
  SlideRenderer,
  WorkflowRepository,
  TextSelection,
  ScriptDocument,
  ChangeOperation,
  SelectionRewrite,
  ChangeSet,
  Slide,
} from "@deck-rehearsal/contracts";
import { DefaultProjectWorkflow } from "@deck-rehearsal/domain";
import {
  LocalObjectStorage,
  LocalWorkspaceStore,
  newUploadState,
} from "@deck-rehearsal/db";
import { OpenXmlPptxProcessor, inspectLayout } from "@deck-rehearsal/pptx";
import type { JsonModelGateway } from "@deck-rehearsal/ai";
import type {
  LocalWorkspaceData,
  UploadState,
  UploadSnapshot,
  UploadFailure,
} from "@deck-rehearsal/db";
const activeWorkers = new Set<string>();
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invalid_input",
    readonly retryable = false,
  ) {
    super(message);
  }
}
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new ServiceError(message, 404);
  return value;
}
export class WorkspaceService {
  readonly pptx = new OpenXmlPptxProcessor();
  readonly storage: LocalObjectStorage;
  readonly store: LocalWorkspaceStore;
  private working = false;
  constructor(
    directory: string,
    readonly model: JsonModelGateway,
    readonly renderer?: SlideRenderer,
  ) {
    this.storage = new LocalObjectStorage(`${directory}/objects`);
    this.store = new LocalWorkspaceStore(directory);
  }
  private workflow(repository: WorkflowRepository) {
    return new DefaultProjectWorkflow({
      repository,
      storage: this.storage,
      pptx: this.pptx,
      model: this.model,
      clock: { now },
      ids: { next: id },
      queue: { enqueue: () => Promise.resolve(id("queue")) },
    });
  }
  async snapshot(projectId: string): Promise<UploadSnapshot> {
    const d = await this.store.read();
    const project = required(d.projects[projectId], "项目不存在");
    const version = d.versions[project.currentVersionId ?? ""];
    const context = d.contexts[project.currentVersionId ?? ""];
    const job = Object.values(d.jobs)
      .filter((j) => j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const draft = d.changeSets[projectId];
    const activeDraft =
      draft?.status === "draft" && draft.baseVersionId === version?.id
        ? draft
        : undefined;
    return {
      project,
      uploadState: this.uploadState(d, projectId),
      ...(version ? { version } : {}),
      ...(context ? { context } : {}),
      ...(job ? { job } : {}),
      versions: Object.values(d.versions)
        .filter((v) => v.projectId === projectId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
      ...(activeDraft ? { draft: structuredClone(activeDraft) } : {}),
      slides: this.previewSlides(
        d.slides[version?.id ?? ""] ?? [],
        activeDraft,
      ),
      comments: Object.values(d.comments)
        .filter((c) => d.versions[c.deckVersionId]?.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      documents: d.documents[projectId] ?? {},
      warnings: d.warnings[version?.id ?? ""] ?? [],
      reviewers: d.routes[projectId] ?? [],
    };
  }
  private previewSlides(slides: Slide[], draft?: ChangeSet) {
    const preview = structuredClone(slides);
    for (const operation of draft?.operations ?? []) {
      if (operation.type !== "replace_text") continue;
      const element = preview
        .find((slide) => slide.id === operation.selection.slideId)
        ?.elements.find(
          (candidate) => candidate.id === operation.selection.elementId,
        );
      const { startOffset, endOffset, selectedText } = operation.selection;
      if (
        !element?.text ||
        element.text.slice(startOffset, endOffset) !== selectedText
      )
        continue;
      element.text =
        element.text.slice(0, startOffset) +
        operation.replacementText +
        element.text.slice(endOffset);
    }
    return preview;
  }
  async create(
    input: Parameters<DefaultProjectWorkflow["createProject"]>[0],
    key: string,
  ) {
    return this.once("create", key, input, async (d, r) => {
      const project = await this.workflow(r).createProject(input);
      d.documents[project.id] = {};
      d.uploadStates[project.id] = newUploadState();
      return project;
    });
  }
  async deleteProject(projectId: string, key: string) {
    const result = await this.once(
      `delete-project:${projectId}`,
      key,
      { projectId },
      (d) => {
        required(d.projects[projectId], "项目不存在");
        const versions = Object.values(d.versions).filter(
          (version) => version.projectId === projectId,
        );
        const versionIds = new Set(versions.map((version) => version.id));
        const sources = Object.values(d.sources).filter(
          (source) => source.projectId === projectId,
        );
        const commentIds = new Set(
          Object.values(d.comments)
            .filter((comment) => versionIds.has(comment.deckVersionId))
            .map((comment) => comment.id),
        );
        const storageKeys = [...sources, ...versions].map(
          (item) => item.storageKey,
        );
        for (const [id, source] of Object.entries(d.sources))
          if (source.projectId === projectId)
            Reflect.deleteProperty(d.sources, id);
        for (const [id, version] of Object.entries(d.versions))
          if (version.projectId === projectId)
            Reflect.deleteProperty(d.versions, id);
        for (const versionId of versionIds) {
          Reflect.deleteProperty(d.slides, versionId);
          Reflect.deleteProperty(d.contexts, versionId);
          Reflect.deleteProperty(d.warnings, versionId);
        }
        for (const [id, job] of Object.entries(d.jobs))
          if (job.projectId === projectId) Reflect.deleteProperty(d.jobs, id);
        for (const [id, comment] of Object.entries(d.comments))
          if (versionIds.has(comment.deckVersionId))
            Reflect.deleteProperty(d.comments, id);
        for (const [id, issue] of Object.entries(d.issues))
          if (commentIds.has(issue.id) || versionIds.has(issue.deckVersionId))
            Reflect.deleteProperty(d.issues, id);
        for (const [id, rewrite] of Object.entries(d.rewrites))
          if (rewrite.projectId === projectId)
            Reflect.deleteProperty(d.rewrites, id);
        for (const [id, suggestion] of Object.entries(d.suggestions))
          if (versionIds.has(suggestion.selection.deckVersionId))
            Reflect.deleteProperty(d.suggestions, id);
        for (const [id, changeSet] of Object.entries(d.changeSets))
          if (id === projectId || changeSet.projectId === projectId)
            Reflect.deleteProperty(d.changeSets, id);
        for (const [id, script] of Object.entries(d.scripts))
          if (script.projectId === projectId)
            Reflect.deleteProperty(d.scripts, id);
        for (const [id, thread] of Object.entries(d.threads))
          if (
            commentIds.has(id) ||
            versionIds.has(thread.comment.deckVersionId)
          )
            Reflect.deleteProperty(d.threads, id);
        Reflect.deleteProperty(d.documents, projectId);
        Reflect.deleteProperty(d.uploadStates, projectId);
        Reflect.deleteProperty(d.routes, projectId);
        Reflect.deleteProperty(d.projects, projectId);
        for (const requestId of Object.keys(d.requests))
          if (requestId.includes(projectId))
            Reflect.deleteProperty(d.requests, requestId);
        const integrated = d as LocalWorkspaceData & {
          aiWorker?: {
            snapshots: Record<string, unknown>;
            threads: Record<string, { projectId: string }>;
            jobs: Record<string, { generation: { projectId: string } }>;
            analysis: Record<string, { context: { projectId: string } }>;
          };
          aiLinks?: Record<string, unknown>;
        };
        if (integrated.aiWorker) {
          Reflect.deleteProperty(integrated.aiWorker.snapshots, projectId);
          for (const [id, item] of Object.entries(integrated.aiWorker.threads))
            if (item.projectId === projectId)
              Reflect.deleteProperty(integrated.aiWorker.threads, id);
          for (const [id, item] of Object.entries(integrated.aiWorker.jobs))
            if (item.generation.projectId === projectId) {
              Reflect.deleteProperty(integrated.aiWorker.jobs, id);
              if (integrated.aiLinks)
                Reflect.deleteProperty(integrated.aiLinks, id);
            }
          for (const [id, item] of Object.entries(integrated.aiWorker.analysis))
            if (item.context.projectId === projectId)
              Reflect.deleteProperty(integrated.aiWorker.analysis, id);
        }
        return { storageKeys: [...new Set(storageKeys)] };
      },
    );
    await Promise.all(
      result.storageKeys.map((storageKey) => this.storage.delete(storageKey)),
    );
  }
  private async once<T>(
    scope: string,
    key: string,
    input: unknown,
    action: (d: LocalWorkspaceData, r: WorkflowRepository) => Promise<T> | T,
  ): Promise<T> {
    if (!key || key.length > 200) throw new ServiceError("需要有效的幂等键");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return this.store.transaction(async (d, r) => {
      const entry = d.requests[`${scope}:${key}`];
      if (entry) {
        if (entry.fingerprint !== fingerprint)
          throw new ServiceError("重复请求的内容已改变，请重新提交", 409);
        return entry.result as T;
      }
      const result = await action(d, r);
      d.requests[`${scope}:${key}`] = { fingerprint, result };
      return result;
    });
  }
  private uploadState(d: LocalWorkspaceData, projectId: string): UploadState {
    const project = required(d.projects[projectId], "项目不存在");
    if (!d.uploadStates[projectId]) {
      const state = newUploadState();
      const context = d.contexts[project.currentVersionId ?? ""];
      for (const [field, value] of [
        ["goal", context?.goal],
        ["response", context?.expectedAudienceResponse],
      ] as const) {
        if (value)
          state[field] = {
            updatedAt: context?.updatedAt ?? now(),
            ...(value.source === "ai_suggested"
              ? { suggestion: value.value }
              : { confirmed: value.value }),
          };
      }
      const job = Object.values(d.jobs)
        .filter((j) => j.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      state.stage = job
        ? job.stage === "completed"
          ? "completed"
          : job.stage === "failed"
            ? "failed"
            : "queued"
        : project.currentVersionId
          ? "ready"
          : "waiting_upload";
      state.analysisRequested = Boolean(job);
      if (job?.stage === "failed")
        state.error = this.failure(new Error(job.failureReason ?? "分析失败"));
      d.uploadStates[projectId] = state;
    }
    return d.uploadStates[projectId];
  }
  private failure(error: unknown): UploadFailure {
    const message = error instanceof Error ? error.message : "处理失败，请重试";
    if (error instanceof ServiceError)
      return {
        code: error.code,
        message,
        retryable: error.retryable,
        recovery: error.status === 409 ? "refresh" : "upload",
      };
    if (/配置|MODEL_API_KEY|MODEL_NAME/.test(message))
      return {
        code: "model_not_configured",
        message: "尚未配置模型服务，请完成配置后重试分析。",
        retryable: true,
        recovery: "configure",
      };
    return {
      code: "analysis_failed",
      message:
        "分析服务暂时不可用，请重试；如持续失败，请检查模型或渲染服务配置。",
      retryable: true,
      recovery: "retry",
    };
  }
  private syncTargets(d: LocalWorkspaceData, projectId: string) {
    const state = this.uploadState(d, projectId);
    const context = d.contexts[d.projects[projectId]?.currentVersionId ?? ""];
    if (!context) return;
    const sourced = (value: UploadState["goal"]) =>
      value.confirmed === ""
        ? undefined
        : value.confirmed !== undefined
          ? { value: value.confirmed, source: "user_confirmed" as const }
          : value.suggestion
            ? { value: value.suggestion, source: "ai_suggested" as const }
            : undefined;
    const goal = sourced(state.goal),
      response = sourced(state.response);
    if (goal) context.goal = goal;
    else delete context.goal;
    if (response) context.expectedAudienceResponse = response;
    else delete context.expectedAudienceResponse;
    context.updatedAt = now();
  }
  async saveTargets(
    projectId: string,
    goal: string,
    response: string,
    revision: number,
    acceptSuggestions = false,
  ) {
    return this.store.transaction((d) => {
      const state = this.uploadState(d, projectId);
      if (revision !== state.revision)
        throw new ServiceError(
          "目标已在其他页面更新，请刷新后重试",
          409,
          "target_conflict",
        );
      if (
        state.analysisRequested &&
        !["failed", "cancelled", "completed"].includes(state.stage)
      )
        throw new ServiceError(
          "分析正在进行，请先取消再修改目标",
          409,
          "analysis_busy",
        );
      for (const [field, value] of [
        ["goal", goal],
        ["response", response],
      ] as const) {
        if (
          !acceptSuggestions &&
          state[field].confirmed === undefined &&
          value.trim() === state[field].suggestion
        )
          continue;
        state[field].confirmed = value.trim();
        state[field].updatedAt = now();
      }
      state.revision++;
      state.updatedAt = now();
      required(d.projects[projectId], "项目不存在").updatedAt = now();
      this.syncTargets(d, projectId);
      return state;
    });
  }
  async prepareUpload(projectId: string, key: string) {
    if (!key || key.length > 200) throw new ServiceError("需要有效的幂等键");
    return this.store.transaction((d) => {
      const state = this.uploadState(d, projectId);
      if (!d.projects[projectId]?.currentVersionId) {
        state.stage = "uploading";
        state.uploadKey = key;
        state.updatedAt = now();
        delete state.error;
      }
      return state;
    });
  }
  async uploadFailed(projectId: string, key: string, error: unknown) {
    await this.store.transaction((d) => {
      const state = this.uploadState(d, projectId);
      if (
        !d.projects[projectId]?.currentVersionId &&
        (!state.uploadKey || state.uploadKey === key)
      ) {
        state.stage = "failed";
        state.error =
          error instanceof ServiceError
            ? this.failure(error)
            : {
                code: "upload_interrupted",
                message: "上传中断，请重新选择文件上传。",
                retryable: true,
                recovery: "upload",
              };
        state.updatedAt = now();
      }
    });
  }
  async upload(projectId: string, name: string, file: Uint8Array, key: string) {
    try {
      if (!name.toLowerCase().endsWith(".pptx"))
        throw new ServiceError(
          "仅支持 PPTX 文件",
          415,
          "unsupported_file_type",
        );
      if (!file.length || file.length > 50 * 1024 * 1024)
        throw new ServiceError(
          "文件必须在 1 字节到 50 MB 之间",
          413,
          "file_size_exceeded",
        );
      await this.store.transaction((d) => {
        const state = this.uploadState(d, projectId);
        if (!d.projects[projectId]?.currentVersionId) {
          state.stage = "parsing";
          state.updatedAt = now();
        }
      });
      let parsed;
      try {
        parsed = await this.pptx.parse(file, "validation");
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件损坏";
        throw new ServiceError(
          message,
          422,
          /60/.test(message) ? "page_limit_exceeded" : "invalid_pptx",
        );
      }
      return await this.once(
        "upload:" + projectId,
        key,
        { name, hash: createHash("sha256").update(file).digest("hex") },
        async (d, r) => {
          const project = required(d.projects[projectId], "项目不存在");
          if (project.currentVersionId)
            throw new ServiceError(
              "原始文件已上传，请新建项目上传其他文件",
              409,
              "source_immutable",
            );
          const storageKey =
            "projects/" + projectId + "/" + id("source") + ".pptx";
          await this.storage.put(storageKey, file);
          const workflow = this.workflow(r);
          const result = await workflow.completeUpload({
            projectId,
            originalName: name,
            storageKey,
            sizeBytes: file.length,
          });
          const slides = parsed.slides.map((s) => ({
            ...s,
            deckVersionId: result.version.id,
          }));
          await r.saveSlides(result.version.id, slides);
          d.warnings[result.version.id] = inspectLayout(slides);
          d.documents[projectId] = Object.fromEntries(
            slides.map((s) => [
              s.id,
              {
                slideId: s.id,
                revision: 0,
                text: s.notes ?? "",
                marks: [],
                annotations: [],
                updatedAt: now(),
              },
            ]),
          );
          this.syncTargets(d, projectId);
          const state = this.uploadState(d, projectId);
          state.stage = "ready";
          state.updatedAt = now();
          delete state.error;
          // Persist one pending job; model processing begins only after explicit analyze.
          const { job } = await workflow.startAnalysis(projectId);
          return { ...result, job };
        },
      );
    } catch (error) {
      await this.uploadFailed(projectId, key, error);
      throw error;
    }
  }
  async analyze(
    projectId: string,
    goal: string,
    response: string,
    key: string,
  ) {
    return this.once(
      "analyze:" + projectId,
      key,
      { goal, response },
      async (d, r) => {
        const workflow = this.workflow(r);
        const versionId = await workflow.getCurrentVersion(projectId);
        const state = this.uploadState(d, projectId);
        const existing = Object.values(d.jobs).find(
          (j) =>
            j.projectId === projectId &&
            j.stage !== "failed" &&
            j.stage !== "completed",
        );
        if (existing && state.analysisRequested)
          throw new ServiceError(
            "分析正在进行，请等待完成后更新目标",
            409,
            "analysis_busy",
          );
        for (const [field, value] of [
          ["goal", goal],
          ["response", response],
        ] as const) {
          if (value.trim() && value.trim() !== state[field].suggestion)
            state[field].confirmed = value.trim();
          else if (!value.trim()) {
            delete state[field].confirmed;
            delete state[field].suggestion;
          }
          state[field].updatedAt = now();
        }
        this.syncTargets(d, projectId);
        state.analysisRequested = true;
        state.stage = "queued";
        state.attempt++;
        state.revision++;
        state.updatedAt = now();
        delete state.error;
        required(d.projects[projectId], "项目不存在").updatedAt = now();
        if (existing?.deckVersionId === versionId)
          return { job: existing, queueJobId: existing.id };
        return workflow.startAnalysis(projectId);
      },
    );
  }
  async cancelAnalysis(projectId: string) {
    return this.store.transaction((d) => {
      const state = this.uploadState(d, projectId);
      const job = Object.values(d.jobs).find(
        (j) =>
          j.projectId === projectId &&
          !["completed", "failed"].includes(j.stage),
      );
      if (!job)
        throw new ServiceError("没有可取消的分析", 409, "not_cancellable");
      job.stage = "failed";
      job.failureReason = "用户已取消分析";
      job.updatedAt = now();
      state.stage = "cancelled";
      state.attempt++;
      state.updatedAt = now();
      delete state.error;
      return state;
    });
  }
  async retryAnalysis(projectId: string, jobId: string, key: string) {
    return this.once("retry:" + projectId, key, { jobId }, (d) => {
      const state = this.uploadState(d, projectId);
      const job = required(d.jobs[jobId], "任务不存在");
      if (job.projectId !== projectId)
        throw new ServiceError("任务不存在", 404);
      if (job.deckVersionId !== d.projects[projectId]?.currentVersionId)
        throw new ServiceError(
          "版本已变化，请重新分析",
          409,
          "version_conflict",
        );
      const latest = Object.values(d.jobs)
        .filter((j) => j.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (
        latest?.id !== jobId ||
        job.stage !== "failed" ||
        (state.stage !== "cancelled" && !state.error?.retryable)
      )
        throw new ServiceError("该任务不能重试", 409, "not_retryable");
      if (
        Object.values(d.jobs).some(
          (j) =>
            j.projectId === projectId &&
            !["failed", "completed"].includes(j.stage),
        )
      )
        throw new ServiceError("已有分析正在运行", 409, "analysis_busy");
      job.stage = "upload_completed";
      delete job.failureReason;
      job.updatedAt = now();
      state.stage = "queued";
      state.analysisRequested = true;
      state.attempt++;
      state.updatedAt = now();
      delete state.error;
      this.syncTargets(d, projectId);
      return { job, queueJobId: job.id };
    });
  }

  async processNext() {
    const workerKey = resolve(this.store.directory);
    if (this.working || activeWorkers.has(workerKey)) return;
    this.working = true;
    activeWorkers.add(workerKey);
    try {
      const data = await this.store.read();
      const job = Object.values(data.jobs).find(
        (j) =>
          j.stage !== "failed" &&
          j.stage !== "completed" &&
          this.uploadState(data, j.projectId).analysisRequested,
      );
      if (!job) return;
      const attempt = this.uploadState(data, job.projectId).attempt;
      const current = (d: LocalWorkspaceData) =>
        this.uploadState(d, job.projectId).attempt === attempt &&
        d.jobs[job.id]?.stage !== "failed";
      try {
        await this.store.transaction(async (d) => {
          const active = required(d.jobs[job.id], "任务不存在");
          if (!current(d)) return;
          this.uploadState(d, job.projectId).stage = "parsing";
          active.stage = "parsing";
          active.updatedAt = now();
          await Promise.resolve();
        });
        const context = required(
          data.contexts[job.deckVersionId],
          "缺少上下文",
        );
        const slides = data.slides[job.deckVersionId] ?? [];
        const version = required(
          data.versions[job.deckVersionId],
          "版本不存在",
        );
        // Verify persisted source on the worker path, outside the HTTP lifecycle.
        await this.pptx.parse(
          await this.storage.get(version.storageKey),
          version.id,
        );
        if (this.renderer) {
          await this.store.transaction((d) => {
            if (!current(d)) return;
            required(d.jobs[job.id], "任务不存在").stage = "rendering";
            this.uploadState(d, job.projectId).stage = "rendering";
          });
          for (const slide of slides) {
            if (!current(await this.store.read())) return;
            if (!slide.renderStorageKey) {
              const image = await this.renderer.render(slide);
              const storageKey =
                "projects/" +
                job.projectId +
                "/renders/" +
                id("render") +
                ".png";
              await this.storage.put(storageKey, image);
              await this.store.transaction((d) => {
                if (!current(d)) return;
                const saved = d.slides[job.deckVersionId]?.find(
                  (s) => s.id === slide.id,
                );
                if (saved) saved.renderStorageKey = storageKey;
                required(d.jobs[job.id], "任务不存在").processedSlides++;
                required(d.jobs[job.id], "任务不存在").updatedAt = now();
              });
            }
          }
        }
        if (!current(await this.store.read())) return;
        await this.store.transaction((d) => {
          if (!current(d)) return;
          required(d.jobs[job.id], "任务不存在").stage = "global_analysis";
          required(d.jobs[job.id], "任务不存在").processedSlides = 0;
          required(d.jobs[job.id], "任务不存在").updatedAt = now();
          this.uploadState(d, job.projectId).stage = "analyzing";
        });
        const result = await this.model.analyze(context, slides);
        if (!current(await this.store.read())) return;
        await this.store.transaction((d) => {
          if (!current(d)) return;
          required(d.jobs[job.id], "任务不存在").stage = "comment_generation";
          required(d.jobs[job.id], "任务不存在").updatedAt = now();
          this.uploadState(d, job.projectId).stage = "generating_review";
        });
        await this.store.transaction(async (d, r) => {
          if (!current(d)) return;
          if (d.projects[job.projectId]?.currentVersionId !== job.deckVersionId)
            throw new ServiceError(
              "版本已变化，请重新分析",
              409,
              "version_conflict",
            );
          const workflow = this.workflow(r);
          const updated = required(d.contexts[job.deckVersionId], "缺少上下文");
          const state = this.uploadState(d, job.projectId);
          if (state.goal.confirmed === "") delete state.goal.confirmed;
          if (state.response.confirmed === "") delete state.response.confirmed;
          state.goal.suggestion = result.goal;
          state.response.suggestion = result.expectedAudienceResponse;
          state.goal.updatedAt = now();
          state.response.updatedAt = now();
          state.revision++;
          updated.goal ??= { value: result.goal, source: "ai_suggested" };
          updated.expectedAudienceResponse ??= {
            value: result.expectedAudienceResponse,
            source: "ai_suggested",
          };
          this.syncTargets(d, job.projectId);
          updated.narrativeSummary = result.narrativeSummary;
          updated.updatedAt = now();
          for (const old of Object.values(d.comments).filter(
            (c) => c.deckVersionId === job.deckVersionId,
          )) {
            Reflect.deleteProperty(d.comments, old.id);
            Reflect.deleteProperty(d.threads, old.id);
            Reflect.deleteProperty(d.issues, old.issueId);
          }
          for (const c of result.comments) {
            const { comment } = await workflow.addComment({
              reviewerId: c.reviewerId,
              deckVersionId: job.deckVersionId,
              headline: "页面评审",
              body: c.body,
              evidence: c.evidence,
              impact: c.impact,
              suggestedAction: c.suggestedAction,
              confidence: 0.7,
              relatedSlideIds: [c.slideId],
              issue: {
                projectId: job.projectId,
                deckVersionId: job.deckVersionId,
                title: "页面评审",
                rootCause: c.evidence,
                severity: "medium",
                status: "open",
                relatedSlideIds: [c.slideId],
              },
            });
            d.threads[comment.id] = {
              comment,
              replies: [],
              generation: "completed",
            };
          }
          d.routes[job.projectId] = result.reviewers;
          state.stage = "completed";
          state.updatedAt = now();
          required(d.projects[job.projectId], "项目不存在").updatedAt = now();
          d.jobs[job.id] = {
            ...job,
            stage: "completed",
            processedSlides: slides.length,
            totalSlides: slides.length,
            updatedAt: now(),
          };
        });
      } catch (error) {
        await this.store.transaction(async (d) => {
          if (!current(d)) return;
          const state = this.uploadState(d, job.projectId);
          state.stage = "failed";
          state.error = this.failure(error);
          state.updatedAt = now();
          d.jobs[job.id] = {
            ...job,
            stage: "failed",
            failureReason: state.error.message,
            updatedAt: now(),
          };
          await Promise.resolve();
        });
      }
    } finally {
      this.working = false;
      activeWorkers.delete(workerKey);
    }
  }
  async thread(projectId: string, commentId: string) {
    const d = await this.store.read();
    const thread = required(d.threads[commentId], "评论不存在");
    if (d.versions[thread.comment.deckVersionId]?.projectId !== projectId)
      throw new ServiceError("评论不属于当前项目", 404);
    return thread;
  }
  async reply(
    projectId: string,
    commentId: string,
    body: string,
    versionId: string,
    key: string,
  ) {
    return this.once(
      `reply:${projectId}:${commentId}`,
      key,
      { body, versionId },
      async (d) => {
        this.assertVersion(d, projectId, versionId);
        const thread = required(d.threads[commentId], "评论不存在");
        if (d.versions[thread.comment.deckVersionId]?.projectId !== projectId)
          throw new ServiceError("评论不存在", 404);
        thread.replies.push({
          id: id("reply"),
          commentId,
          author: "user",
          reviewerId: thread.comment.reviewerId,
          body,
          deckVersionId: versionId,
          createdAt: now(),
          basis: "用户补充",
        });
        const reviewerThreads = Object.values(d.threads).filter(
          (item) =>
            d.versions[item.comment.deckVersionId]?.projectId === projectId &&
            item.comment.reviewerId === thread.comment.reviewerId,
        );
        const result = await this.model.reply({
          thread,
          reviewerComments: reviewerThreads
            .map((item) => item.comment)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          reviewerReplies: reviewerThreads
            .flatMap((item) => item.replies)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          context: required(d.contexts[versionId], "缺少上下文"),
          slides: d.slides[versionId] ?? [],
        });
        thread.replies.push({
          id: id("reply"),
          commentId,
          author: "reviewer",
          reviewerId: thread.comment.reviewerId,
          body: result.body,
          deckVersionId: versionId,
          createdAt: now(),
          basis: `基于当前版本 V${String(d.versions[versionId]?.versionNumber)} 及关联页面`,
        });
        return thread;
      },
    );
  }
  private assertVersion(
    d: WorkspaceData,
    projectId: string,
    versionId: string,
  ) {
    if (
      required(d.projects[projectId], "项目不存在").currentVersionId !==
      versionId
    )
      throw new ServiceError("版本已变化，请基于当前版本重新生成", 409);
  }
  async suggest(
    projectId: string,
    target: "ppt" | "script",
    selection: TextSelection,
    expectedRevision?: number,
  ) {
    const d = await this.store.read();
    this.assertVersion(d, projectId, selection.deckVersionId);
    const slides = d.slides[selection.deckVersionId] ?? [];
    const index = slides.findIndex((s) => s.id === selection.slideId);
    const currentSlide = required(slides[index], "页面不存在");
    const context = required(d.contexts[selection.deckVersionId], "缺少上下文");
    const document = d.documents[projectId]?.[selection.slideId];
    const element = currentSlide.elements.find(
      (e) => e.id === selection.elementId,
    );
    const text =
      target === "ppt"
        ? required(element?.text, "文字不存在")
        : required(document, "讲稿不存在").text;
    const emptyScript =
      target === "script" &&
      text === "" &&
      selection.startOffset === 0 &&
      selection.endOffset === 0 &&
      selection.selectedText === "";
    if (target === "ppt" && !element?.editable)
      throw new ServiceError(element?.readOnlyReason ?? "该对象不可编辑");
    if (
      !emptyScript &&
      (selection.startOffset < 0 ||
        selection.endOffset <= selection.startOffset ||
        selection.endOffset > text.length ||
        text.slice(selection.startOffset, selection.endOffset) !==
          selection.selectedText)
    )
      throw new ServiceError("选区原文已变化，请重新选择", 409);
    if (
      target === "script" &&
      expectedRevision !== undefined &&
      expectedRevision !== document?.revision
    )
      throw new ServiceError("讲稿已更新，请重新生成", 409);
    const result =
      target === "ppt"
        ? await this.model.rewrite({
            selection,
            elementText: text,
            currentSlide,
            context,
            ...(slides[index - 1] ? { previousSlide: slides[index - 1] } : {}),
            ...(slides[index + 1] ? { nextSlide: slides[index + 1] } : {}),
          })
        : await this.model.rewriteScript({
            selection,
            context,
            currentSlide,
            currentScript: document,
            ...(emptyScript
              ? {
                  intent:
                    "本页讲稿为空。请根据本页与相邻页已有事实补写本页讲稿，作为建议供用户确认。",
                }
              : {}),
            scriptRevision: document?.revision,
            previousSlide: slides[index - 1],
            nextSlide: slides[index + 1],
            previousScript:
              d.documents[projectId]?.[slides[index - 1]?.id ?? ""],
            nextScript: d.documents[projectId]?.[slides[index + 1]?.id ?? ""],
          });
    const proposal: SelectionRewrite = {
      id: id("suggestion"),
      target,
      selection,
      replacementText: result.replacementText,
      rationale: result.rationale,
      ...(target === "script"
        ? { scriptRevision: required(document, "讲稿不存在").revision }
        : {}),
      diff: textDiff(selection.selectedText, result.replacementText),
    };
    return this.store.transaction((latest) => {
      this.assertVersion(latest, projectId, selection.deckVersionId);
      if (
        target === "script" &&
        latest.documents[projectId]?.[selection.slideId]?.revision !==
          document?.revision
      )
        throw new ServiceError("讲稿已更新，请重新生成", 409);
      latest.suggestions[proposal.id] = proposal;
      return proposal;
    });
  }
  async accept(
    projectId: string,
    suggestionId: string,
    key: string,
    editedReplacementText?: string,
  ) {
    return this.once(
      `accept:${projectId}`,
      key,
      { suggestionId, editedReplacementText },
      async (d, r) => {
        const suggestion = required(
          d.suggestions[suggestionId],
          "建议不存在或已经接受",
        );
        this.assertVersion(d, projectId, suggestion.selection.deckVersionId);
        if (suggestion.target === "ppt") {
          const preview = this.previewSlides(
            d.slides[suggestion.selection.deckVersionId] ?? [],
            d.changeSets[projectId],
          );
          const text = preview
            .find((slide) => slide.id === suggestion.selection.slideId)
            ?.elements.find(
              (element) => element.id === suggestion.selection.elementId,
            )?.text;
          const { startOffset, endOffset, selectedText } = suggestion.selection;
          if (!text || text.slice(startOffset, endOffset) !== selectedText)
            throw new ServiceError("选区原文已变化，请重新生成", 409);
        }
        const replacementText =
          editedReplacementText ?? suggestion.replacementText;
        if (!replacementText.trim()) throw new ServiceError("修改建议不能为空");
        if (suggestion.target === "ppt") {
          const workflow = this.workflow(r);
          await workflow.updateChanges(projectId, [
            {
              type: "replace_text",
              selection: suggestion.selection,
              replacementText,
            },
          ]);
        } else {
          const doc = required(
            d.documents[projectId]?.[suggestion.selection.slideId],
            "讲稿不存在",
          );
          if (doc.revision !== suggestion.scriptRevision)
            throw new ServiceError("讲稿已更新，请重新生成", 409);
          const { startOffset: start, endOffset: end } = suggestion.selection;
          if (doc.text.slice(start, end) !== suggestion.selection.selectedText)
            throw new ServiceError("讲稿原文已变化，请重新生成", 409);
          Object.assign(
            doc,
            replaceDocumentRange(doc, start, end, replacementText),
          );
          doc.revision++;
          doc.updatedAt = now();
        }
        Reflect.deleteProperty(d.suggestions, suggestionId);
        if (suggestion.target === "ppt")
          for (const [id, candidate] of Object.entries(d.suggestions))
            if (
              candidate.target === "ppt" &&
              candidate.selection.deckVersionId ===
                suggestion.selection.deckVersionId
            )
              Reflect.deleteProperty(d.suggestions, id);
        return {
          accepted: true,
          ...(suggestion.target === "ppt"
            ? { draft: structuredClone(d.changeSets[projectId]) }
            : {}),
        };
      },
    );
  }
  async undoDraft(projectId: string, key: string) {
    return this.once(`undo-draft:${projectId}`, key, {}, (d) => {
      const project = required(d.projects[projectId], "项目不存在");
      const draft = required(d.changeSets[projectId], "没有可撤销的草稿");
      if (
        draft.status !== "draft" ||
        draft.baseVersionId !== project.currentVersionId
      )
        throw new ServiceError("草稿已基于旧版本，无法撤销", 409);
      if (!draft.operations.length) throw new ServiceError("没有可撤销的草稿");
      draft.operations.pop();
      draft.updatedAt = now();
      return structuredClone(draft);
    });
  }
  async commitDraft(projectId: string, versionId: string, key: string) {
    return this.once(
      `commit-draft:${projectId}`,
      key,
      { versionId },
      async (d, r) => {
        this.assertVersion(d, projectId, versionId);
        const draft = required(d.changeSets[projectId], "没有待提交的草稿");
        if (draft.status !== "draft" || !draft.operations.length)
          throw new ServiceError("没有待提交的草稿");
        const before = structuredClone(d.slides[versionId] ?? []);
        const version = await this.workflow(r).commitVersion(
          projectId,
          "提交文字修改草稿",
        );
        d.changeSets[version.id] = structuredClone(
          required(d.changeSets[projectId], "缺少变更记录"),
        );
        d.warnings[version.id] = inspectLayout(
          d.slides[version.id] ?? [],
          before,
        );
        return version;
      },
    );
  }
  async saveDocument(projectId: string, document: ScriptDocument) {
    return this.store.transaction(async (d) => {
      const documents = required(d.documents[projectId], "项目不存在");
      const old = required(documents[document.slideId], "页面不存在");
      if (old.revision !== document.revision)
        throw new ServiceError("讲稿已被更新，请刷新后重试", 409);
      documents[document.slideId] = {
        ...document,
        revision: document.revision + 1,
        updatedAt: now(),
      };
      return await Promise.resolve(documents[document.slideId]);
    });
  }
  async change(
    projectId: string,
    versionId: string,
    operations: ChangeOperation[],
    key: string,
  ) {
    return this.once(
      `change:${projectId}`,
      key,
      { versionId, operations },
      async (d, r) => {
        this.assertVersion(d, projectId, versionId);
        const workflow = this.workflow(r);
        await workflow.updateChanges(projectId, operations);
        const version = await workflow.commitVersion(projectId, "调整页面结构");
        d.changeSets[version.id] = structuredClone(
          required(d.changeSets[projectId], "缺少变更记录"),
        );
        d.warnings[version.id] = inspectLayout(
          d.slides[version.id] ?? [],
          d.slides[versionId],
        );
        return version;
      },
    );
  }
  async restore(
    projectId: string,
    versionId: string,
    currentVersionId: string,
    key: string,
  ) {
    return this.once(
      `restore:${projectId}`,
      key,
      { versionId, currentVersionId },
      async (d) => {
        this.assertVersion(d, projectId, currentVersionId);
        const old = required(d.versions[versionId], "版本不存在");
        if (old.projectId !== projectId)
          throw new ServiceError("版本不存在", 404);
        const current = required(
          d.versions[currentVersionId],
          "当前版本不存在",
        );
        const version = {
          ...old,
          id: id("version"),
          parentVersionId: currentVersionId,
          versionNumber: current.versionNumber + 1,
          status: "current" as const,
          changeSummary: `恢复 V${String(old.versionNumber)}`,
          createdAt: now(),
        };
        version.storageKey = `projects/${projectId}/versions/${version.id}.pptx`;
        await this.storage.put(
          version.storageKey,
          await this.storage.get(old.storageKey),
        );
        current.status = "superseded";
        d.versions[version.id] = version;
        d.slides[version.id] = (d.slides[versionId] ?? []).map((s) => ({
          ...s,
          deckVersionId: version.id,
        }));
        const context = required(d.contexts[currentVersionId], "缺少背景");
        d.contexts[version.id] = {
          ...context,
          deckVersionId: version.id,
          updatedAt: now(),
        };
        required(d.projects[projectId], "项目不存在").currentVersionId =
          version.id;
        d.warnings[version.id] = d.warnings[versionId] ?? [];
        return version;
      },
    );
  }
  async versionDetail(projectId: string, versionId: string) {
    const d = await this.store.read();
    const version = required(d.versions[versionId], "版本不存在");
    if (version.projectId !== projectId)
      throw new ServiceError("版本不存在", 404);
    return {
      version,
      slides: d.slides[versionId] ?? [],
      warnings: d.warnings[versionId] ?? [],
      operations: d.changeSets[versionId]?.operations ?? [],
    };
  }
  async download(projectId: string, versionId: string) {
    const d = await this.store.read();
    const version = required(d.versions[versionId], "版本不存在");
    if (version.projectId !== projectId)
      throw new ServiceError("版本不存在", 404);
    return this.storage.get(version.storageKey);
  }
}
