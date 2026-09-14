# Task 02 shared contract checkpoint

`packages/contracts/src/ai.ts` extends the existing `review.ts` types without breaking current UI callers. Export from the contracts package. Version: 1.0.0.

- `ReviewComment`: existing version, role, relatedSlideIds, createdAt and evidence fields; normalized body must be 50–100 grapheme clusters.
- `ReviewThread`/`ReviewReply`: original comment plus append-ordered replies; getThread supplies polling of generation. `AsyncReviewGateway` adds queued submission, result polling and explicit failure retry.
- `ReviewThreadInput`: original comment and complete thread plus fresh context/slides. The context.deckVersionId is the current basis; the original comment may come from an older version.
- `LocalRewriteRequest` distinguishes PPT from script. `VersionedRewrite` carries original text, diff, basisVersionId, scriptRevision and factual-risk fields. Never apply on generation.
- `ScriptDocument`: canonical text segment plus separate bold/underline/color/highlight ranges and user annotations. Offsets are UTF-16 and end-exclusive.
- Generation states: queued, generating, completed, failed. No pending business status.

Example request:

```json
{
  "projectId": "p1",
  "commentId": "c1",
  "body": "请解释证据缺口",
  "deckVersionId": "v2",
  "idempotencyKey": "reply-1"
}
```

Example script request:

```json
{
  "projectId": "p1",
  "target": "script",
  "scriptRevision": 3,
  "selection": {
    "deckVersionId": "v2",
    "slideId": "s6",
    "elementId": "script",
    "startOffset": 0,
    "endOffset": 4,
    "selectedText": "本页结论"
  }
}
```

Example rich text:

```json
{
  "slideId": "s6",
  "revision": 3,
  "text": "本页结论",
  "marks": [{ "start": 0, "end": 4, "kind": "bold" }],
  "annotations": [
    {
      "id": "a1",
      "start": 0,
      "end": 4,
      "text": "强调结论",
      "author": "user",
      "createdAt": "2026-09-14T13:00:00Z"
    }
  ],
  "updatedAt": "2026-09-14T13:00:00Z"
}
```

04: consume AsyncReviewGateway for immediate user echo, poll getReplyResult, refresh on version_conflict, retryReply on recoverable failures. Preserve reply array order.
05: consume LocalRewriteRequest / VersionedRewrite; accepting is a separate command owned by the editor/version layer, with version and script revision checks.

Existing review.ts was already present in the shared worktree; included as the checkpoint dependency. Existing unrelated changes remain unstaged.
