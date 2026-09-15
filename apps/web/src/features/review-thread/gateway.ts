import type {
  ReviewGateway,
  AsyncReviewGateway,
  WorkspaceSnapshot,
} from "@deck-rehearsal/contracts";
export class ReviewRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/projects/${path}`, init);
  const data: unknown = await response.json();
  if (!response.ok)
    throw new ReviewRequestError(
      (data as { error?: string }).error ?? "评审请求失败",
      response.status,
    );
  return data as T;
}
export const reviewGateway: ReviewGateway = {
  listComments: async (projectId) =>
    (await request<WorkspaceSnapshot>(encodeURIComponent(projectId))).comments,
  getThread: (projectId, commentId) =>
    request(
      `${encodeURIComponent(projectId)}/thread/${encodeURIComponent(commentId)}`,
    ),
  reply: (input) =>
    request(
      `${encodeURIComponent(input.projectId)}/thread/${encodeURIComponent(input.commentId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          body: input.body,
          versionId: input.deckVersionId,
        }),
      },
    ),
};

export const asyncReviewGateway: AsyncReviewGateway = {
  listComments: (id) => reviewGateway.listComments(id),
  getThread: (id, comment) => reviewGateway.getThread(id, comment),
  submitReply: (input) =>
    request(
      `${encodeURIComponent(input.projectId)}/thread/${encodeURIComponent(input.commentId)}/replies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          body: input.body,
          versionId: input.deckVersionId,
        }),
      },
    ),
  getReplyResult: (projectId, id) =>
    request(
      `${encodeURIComponent(projectId)}/replies/${encodeURIComponent(id)}`,
    ),
  retryReply: (projectId, id) =>
    request(
      `${encodeURIComponent(projectId)}/replies/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
    ),
};
