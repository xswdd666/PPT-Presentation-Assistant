# ADR 0004: One transaction boundary for the local integrated worker

Status: accepted for the local development slice.

Task 02 supplied an independent worker file while tasks 03–05 saved workspace data elsewhere. Copying snapshots and results between those files would require a recoverable two-phase protocol and could lose updates between a version save and a worker completion.

The integrated runtime stores WorkerData and its local analysis-job links alongside the existing workspace in schema v2. WorkspaceWorkerStore implements the existing WorkerStore port. It derives each AI snapshot from the canonical current version, context and script documents, then commits queued replies, worker state and published workspace results together. Model calls remain outside transactions. Analysis cancellation invalidates the previous attempt's lease token; completion still checks the current snapshot.

LocalWorkspaceStore now uses a cross-process directory lock and atomic rename. A pair of independent OS processes is tested for lost updates and rollback. An abandoned lock is not automatically removed: operators stop writers and back up the directory before recovery.

This makes Web plus an independent Worker viable on one machine. It is not a distributed database, authentication system, encrypted object store or PostgreSQL migration. Those adapters remain separate production work. Existing application threads are read from workspace.json; standalone historical ai-worker.json experiment data is deliberately not guessed or imported.
