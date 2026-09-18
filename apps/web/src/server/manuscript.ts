import { randomUUID } from "node:crypto";
import type {
  LocalWorkspaceData,
  LocalWorkspaceStore,
  ScriptGeneration,
} from "@deck-rehearsal/db";
import type { ModelGateway } from "@deck-rehearsal/contracts";
import { hash, safeFailure } from "@deck-rehearsal/ai/runtime";

export function manuscriptStatus(job: ScriptGeneration): ScriptGeneration {
  return {
    projectId: job.projectId,
    deckVersionId: job.deckVersionId,
    state: job.state,
    processedSlides: job.processedSlides,
    totalSlides: job.totalSlides,
    ...(job.error ? { error: job.error } : {}),
  };
}

/** Queue independently from analysis. A failed manuscript never discards parsed pages/reviews. */
export function queueManuscript(
  d: LocalWorkspaceData,
  projectId: string,
  retry = false,
) {
  const versionId = d.projects[projectId]?.currentVersionId;
  if (!versionId || !d.contexts[versionId] || !d.slides[versionId]?.length)
    throw new Error("请先上传并解析 PPT");
  const jobs = (d.scriptGenerations ??= {});
  const old = jobs[projectId];
  if (old?.deckVersionId === versionId) {
    if (retry && old.state === "failed") {
      old.state = "queued";
      delete old.error;
    }
    return old;
  }
  return (jobs[projectId] = {
    projectId,
    deckVersionId: versionId,
    state: "queued",
    processedSlides: 0,
    totalSlides: d.slides[versionId].length,
    pages: [],
  });
}

export class ManuscriptGenerator {
  constructor(
    private readonly store: LocalWorkspaceStore,
    private readonly model: Pick<ModelGateway, "createScript">,
  ) {}

  async runNext() {
    const claim = await this.store.transaction((d) => {
      const job = Object.values(d.scriptGenerations ?? {}).find(
        (j) =>
          j.state === "queued" ||
          (j.state === "generating" && (j.leaseUntil ?? 0) < Date.now()),
      );
      if (!job) return undefined;
      job.state = "generating";
      job.token = randomUUID();
      job.leaseUntil = Date.now() + 360000;
      return structuredClone(job);
    });
    if (!claim) return;
    const { projectId, deckVersionId, token } = claim;
    try {
      const initial = await this.store.read();
      const context = initial.contexts[deckVersionId];
      const slides = [...(initial.slides[deckVersionId] ?? [])].sort(
        (a, b) => a.index - b.index,
      );
      if (
        !context ||
        initial.projects[projectId]?.currentVersionId !== deckVersionId
      )
        throw new Error("版本已变化，请重新生成讲稿");
      const pending = slides.filter(
        (s) => !claim.pages.some((p) => p.slideId === s.id),
      );
      // Small batches avoid truncating 60-page JSON; every batch sees the entire deck.
      for (let offset = 0; offset < pending.length; offset += 4) {
        const batch = pending.slice(offset, offset + 4);
        const latest = await this.store.read();
        const job = latest.scriptGenerations?.[projectId];
        if (!job || job.token !== token) return;
        const current = () =>
          latest.projects[projectId]?.currentVersionId === deckVersionId &&
          hash(latest.contexts[deckVersionId]) === hash(context);
        if (!current()) throw new Error("汇报背景或版本已变化，请重新生成讲稿");
        const previousId =
          slides[slides.findIndex((s) => s.id === batch[0]?.id) - 1]?.id;
        const previousNarration = previousId
          ? latest.documents[projectId]?.[previousId]?.text ||
            job.pages.find((p) => p.slideId === previousId)?.narration ||
            ""
          : "";
        const result = await this.model.createScript({
          context,
          slides,
          style: "natural",
          targetSlideIds: batch.map((s) => s.id),
          previousNarration,
        });
        if (
          result.pages.length !== batch.length ||
          new Set(result.pages.map((p) => p.slideId)).size !== batch.length ||
          result.pages.some(
            (p) =>
              !batch.some((s) => s.id === p.slideId) ||
              !p.narration.trim() ||
              p.narration.length > 800,
          )
        )
          throw new Error("讲稿返回的页面或字数不符合要求，请重试");
        await this.store.transaction((d) => {
          const target = d.scriptGenerations?.[projectId];
          if (!target || target.token !== token) return;
          if (
            d.projects[projectId]?.currentVersionId !== deckVersionId ||
            hash(d.contexts[deckVersionId]) !== hash(context)
          )
            throw new Error("汇报背景或版本已变化，请重新生成讲稿");
          target.pages.push(...result.pages);
          target.processedSlides = target.pages.length;
          target.leaseUntil = Date.now() + 360000;
          const documents = (d.documents[projectId] ??= {});
          for (const page of result.pages) {
            const doc = documents[page.slideId];
            // Revision 0 is original PPT notes, not user work. Never overwrite edited text or annotations.
            if (
              doc &&
              (doc.revision !== 0 || doc.marks.length || doc.annotations.length)
            )
              continue;
            documents[page.slideId] = {
              slideId: page.slideId,
              revision: (doc?.revision ?? 0) + 1,
              text: page.narration.trim(),
              marks: [],
              annotations: [],
              updatedAt: new Date().toISOString(),
            };
          }
        });
      }
      await this.store.transaction((d) => {
        const target = d.scriptGenerations?.[projectId];
        if (!target || target.token !== token) return;
        target.state = "completed";
        delete target.token;
        delete target.leaseUntil;
        delete target.error;
      });
    } catch (error) {
      await this.store.transaction((d) => {
        const target = d.scriptGenerations?.[projectId];
        if (!target || target.token !== token) return;
        target.state = "failed";
        target.error = safeFailure(error).message;
        delete target.token;
        delete target.leaseUntil;
      });
    }
  }
}
