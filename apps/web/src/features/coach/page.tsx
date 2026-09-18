import { useEffect, useRef, useState } from "react";
import type { CoachRun } from "@deck-rehearsal/contracts";
import { coachGateway } from "./gateway.js";

const active = new Set(["queued", "planning", "running"]);
export function CoachPage({
  projectId,
  defaultObjective,
  onError,
  onLocate,
}: {
  projectId: string;
  defaultObjective: string;
  onError: (message: string) => void;
  onLocate: (slideId: string) => void;
}) {
  const [objective, setObjective] = useState(defaultObjective);
  const [run, setRun] = useState<CoachRun>();
  const [busy, setBusy] = useState(false);
  const startKey = useRef(crypto.randomUUID());
  async function load() {
    try {
      setRun(await coachGateway.current(projectId));
    } catch (error) {
      if ((error as { status?: number }).status !== 404) onError(String(error));
    }
  }
  useEffect(() => {
    void load();
  }, [projectId]);
  useEffect(() => {
    if (!run || !active.has(run.state)) return;
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.state]);
  async function start() {
    if (busy || !objective.trim()) return;
    setBusy(true);
    try {
      setRun(
        await coachGateway.start(projectId, objective.trim(), startKey.current),
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function decide(proposalId: string, decision: "accepted" | "rejected") {
    if (!run || busy) return;
    setBusy(true);
    try {
      setRun(
        await coachGateway.decide(projectId, run.id, proposalId, decision),
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const evidence = (ids: string[]) =>
    ids.map((id) => (
      <button className="coach-evidence" key={id} onClick={() => onLocate(id)}>
        {id}
      </button>
    ));
  return (
    <div className="coach-page">
      <header className="coach-hero">
        <span className="eyebrow">COACH AGENT</span>
        <h1>汇报教练</h1>
        <p>先规划、再取证，所有修改都停在逐项审批。</p>
        <label>
          本次目标
          <textarea
            value={objective}
            maxLength={5000}
            onChange={(event) => setObjective(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || active.has(run?.state ?? "")}
          onClick={() => void start()}
        >
          {run ? "基于当前版本创建新 Run" : "开始教练分析"}
        </button>
      </header>
      {run && (
        <>
          <div className={`coach-state state-${run.state}`} role="status">
            状态：{run.state} · 步骤 {run.currentStep}/{run.maxSteps}
          </div>
          {run.state === "stale" && (
            <p className="coach-warning">
              版本已变化，此 Run 已停止。请基于当前版本创建新 Run。
            </p>
          )}
          {run.state === "failed" && (
            <div className="coach-warning">
              <span>{run.error?.message ?? "执行失败，已保留完成步骤"}</span>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void coachGateway
                    .retry(projectId, run.id)
                    .then(setRun)
                    .catch((error: unknown) => onError(String(error)))
                }
              >
                原地重试
              </button>
            </div>
          )}
          <section className="coach-section">
            <h2>计划</h2>
            <ol className="coach-plan">
              {run.plan.map((item, index) => (
                <li key={item.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.criterion}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="coach-section">
            <h2>时间线</h2>
            <div className="coach-timeline">
              {run.steps.map((step) => (
                <article key={step.id}>
                  <span className="coach-dot" />
                  <div>
                    <small>
                      STEP {step.sequence} · {step.status}
                    </small>
                    <strong>
                      {step.action.type === "call_tool"
                        ? step.action.tool
                        : step.action.type}
                    </strong>
                    {step.action.type === "call_tool" && (
                      <p>{step.action.reason}</p>
                    )}
                    {step.observation && (
                      <>
                        <p>{step.observation.summary}</p>
                        <div>{evidence(step.observation.slideIds ?? [])}</div>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="coach-section">
            <h2>改进提案</h2>
            {run.proposals.length === 0 ? (
              <p className="muted">取证完成后，提案会出现在这里。</p>
            ) : (
              <div className="coach-proposals">
                {run.proposals.map((proposal) => (
                  <article key={proposal.id}>
                    <div>
                      <small>
                        {proposal.target} · {proposal.state}
                      </small>
                      <h3>{proposal.title}</h3>
                      <p>{proposal.instruction}</p>
                      <p>{proposal.expectedBenefit}</p>
                      <div>{evidence(proposal.evidenceSlideIds)}</div>
                    </div>
                    {proposal.state === "pending" && (
                      <footer>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => void decide(proposal.id, "rejected")}
                        >
                          不接受
                        </button>
                        <button
                          className="button primary"
                          disabled={busy || !proposal.suggestionId}
                          onClick={() => void decide(proposal.id, "accepted")}
                        >
                          接受
                        </button>
                      </footer>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          {run.summary && (
            <section className="coach-section">
              <h2>总结</h2>
              <p>{run.summary}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
