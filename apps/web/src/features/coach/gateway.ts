import type { CoachRun } from "@deck-rehearsal/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw Object.assign(new Error(body.error ?? "教练请求失败"), {
      status: response.status,
    });
  return body as T;
}
const headers = (key: string = crypto.randomUUID()) => ({
  "content-type": "application/json",
  "idempotency-key": key,
});
export const coachGateway = {
  current: (projectId: string) =>
    request<CoachRun>(
      `/api/projects/${encodeURIComponent(projectId)}/coach-runs/current`,
    ),
  start: (projectId: string, objective: string, key: string) =>
    request<CoachRun>(
      `/api/projects/${encodeURIComponent(projectId)}/coach-runs`,
      {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify({ objective }),
      },
    ),
  decide: (
    projectId: string,
    runId: string,
    proposalId: string,
    decision: "accepted" | "rejected",
  ) =>
    request<CoachRun>(
      `/api/projects/${encodeURIComponent(projectId)}/coach-runs/${encodeURIComponent(runId)}/decisions`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ proposalId, decision }),
      },
    ),
  retry: (projectId: string, runId: string) =>
    request<CoachRun>(
      `/api/projects/${encodeURIComponent(projectId)}/coach-runs/${encodeURIComponent(runId)}/retry`,
      { method: "POST", headers: headers(), body: "{}" },
    ),
};
