import type { CoachData, CoachStore } from "@deck-rehearsal/contracts";
import type { LocalWorkspaceStore } from "@deck-rehearsal/db";

export class WorkspaceCoachStore implements CoachStore {
  constructor(private readonly workspace: LocalWorkspaceStore) {}
  async read(): Promise<CoachData> {
    const data = await this.workspace.read();
    return {
      coachRuns: data.coachRuns,
      coachRunByProject: data.coachRunByProject,
    };
  }
  transaction<T>(work: (data: CoachData) => T | Promise<T>): Promise<T> {
    return this.workspace.transaction((data) => work(data));
  }
  async currentVersion(projectId: string) {
    return (await this.workspace.read()).projects[projectId]?.currentVersionId;
  }
}
