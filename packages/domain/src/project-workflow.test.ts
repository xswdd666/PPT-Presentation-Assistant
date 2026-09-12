import { describe, expect, it } from "vitest";
import type { Slide } from "@deck-rehearsal/contracts";
import {
  DefaultProjectWorkflow,
  DeterministicModelGateway,
  FixedClock,
  IncrementingIdGenerator,
  InMemoryJobQueue,
  InMemoryObjectStorage,
  InMemoryWorkflowRepository,
  PassthroughPptxProcessor,
} from "./index.js";

describe("project workflow", () => {
  it("runs the upload, analysis, review, rewrite, version, script and download seam", async () => {
    const ids = new IncrementingIdGenerator();
    const repository = new InMemoryWorkflowRepository();
    const storage = new InMemoryObjectStorage();
    const workflow = new DefaultProjectWorkflow({
      repository,
      storage,
      queue: new InMemoryJobQueue(ids),
      model: new DeterministicModelGateway(),
      pptx: new PassthroughPptxProcessor(),
      clock: new FixedClock(),
      ids,
    });
    const project = await workflow.createProject({
      ownerId: "user_1",
      name: "Q3 resource request",
      scenario: "resource_request",
      audience: "Executive committee",
      durationMinutes: 10,
    });
    await storage.put("uploads/source.pptx", new Uint8Array([80, 75, 3, 4]));
    const { version } = await workflow.completeUpload({
      projectId: project.id,
      originalName: "request.pptx",
      storageKey: "uploads/source.pptx",
      sizeBytes: 4,
    });
    const slide: Slide = {
      id: "slide_1",
      deckVersionId: version.id,
      sourceStableId: "pptx-slide-1",
      index: 0,
      hidden: false,
      purpose: "call_to_action",
      elements: [
        {
          id: "element_1",
          slideId: "slide_1",
          kind: "title",
          bounds: { x: 0, y: 0, width: 100, height: 20 },
          text: "Approve the team budget",
          editable: true,
          contentHash: "hash_1",
        },
      ],
    };
    await repository.saveSlides(version.id, [slide]);

    const analysis = await workflow.startAnalysis(project.id);
    expect(analysis.job.totalSlides).toBe(1);
    expect(analysis.queueJobId).toMatch(/^job_/);

    const commentBody =
      "The budget request lacks a measurable outcome, so leaders cannot compare its value with cost.";
    const review = await workflow.addComment({
      issue: {
        projectId: project.id,
        deckVersionId: version.id,
        title: "Decision value is unclear",
        rootCause: "missing outcome",
        severity: "high",
        status: "open",
        relatedSlideIds: [slide.id],
      },
      reviewerId: "reviewer_jack",
      deckVersionId: version.id,
      headline: "Connect spend to outcome",
      body: commentBody,
      evidence: "The title only asks for approval.",
      impact: "Decision makers cannot compare value and cost.",
      suggestedAction: "Add the expected measurable outcome.",
      confidence: 0.9,
      relatedSlideIds: [slide.id],
    });
    expect(review.issue.status).toBe("open");

    const proposal = await workflow.requestRewrite({
      projectId: project.id,
      selection: {
        deckVersionId: version.id,
        slideId: slide.id,
        elementId: "element_1",
        startOffset: 0,
        endOffset: 7,
        selectedText: "Approve",
      },
    });
    const changeSet = await workflow.acceptRewrite(proposal.id);
    expect(changeSet.operations).toHaveLength(1);
    expect(await workflow.getCurrentVersion(project.id)).toBe(version.id);

    const committed = await workflow.commitVersion(
      project.id,
      "Clarify the request",
    );
    expect(committed.parentVersionId).toBe(version.id);
    expect(committed.versionNumber).toBe(2);

    const script = await workflow.generateScript(project.id, "formal");
    expect(script.deckVersionId).toBe(committed.id);
    expect(script.pages).toHaveLength(1);

    const download = await workflow.createDownload(project.id);
    expect(download.expiresInSeconds).toBe(300);
    expect(download.url).toContain("https://storage.invalid/");
  });
});
