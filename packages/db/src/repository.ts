import type { WorkflowRepository } from "@deck-rehearsal/contracts";
import type { databaseSchema } from "./schema.js";

/**
 * Boundary implemented by the PostgreSQL adapter in the integration stage.
 * Domain and feature packages depend on WorkflowRepository, never on Drizzle.
 */
export interface PostgresRepositoryAdapter extends WorkflowRepository {
  readonly dialect: "postgresql";
  readonly schema: typeof databaseSchema;
  transaction<TResult>(
    work: (repository: WorkflowRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
