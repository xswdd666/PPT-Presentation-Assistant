# ADR 0002: Drizzle ORM with PostgreSQL

- Status: accepted
- Date: 2026-09-12

## Context

Deck Rehearsal needs immutable deck-version history, transactional change-set
commits, queryable review state and PostgreSQL deployment. Domain packages must not
depend on an ORM or database driver.

## Decision

Use PostgreSQL as the system of record and Drizzle ORM in `packages/db`. The schema
uses explicit tables for projects, files, immutable versions, slides, elements,
context, reviews, rewrites, change sets, scripts and analysis jobs. Structured
provider-independent payloads use JSONB where their shape is already owned by
`packages/contracts`.

Repository implementations expose the shared `WorkflowRepository` port. A unit of
work must transactionally commit a new version, mark its parent superseded, commit
the change set and update the project's current-version pointer. Migration
generation and a concrete connection pool belong to the integration stage, when a
deployment topology is selected.

## Consequences

- Feature packages do not import Drizzle.
- IDs remain application-generated strings so provider adapters share stable IDs.
- Version rows are never updated in place except for processing status transitions.
- Tests use the in-memory repository unless they explicitly exercise PostgreSQL.
