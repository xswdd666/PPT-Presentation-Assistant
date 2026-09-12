# ADR 0001: TypeScript pnpm monorepo

- Status: accepted
- Date: 2026-09-12

## Decision

Use a pnpm workspace with strict TypeScript and ESM packages. Applications live in
`apps/*`; reusable contracts and adapters live in `packages/*`. Root commands own
formatting, linting, type checking and tests so later work does not need to alter
shared tooling.

The initial web application is deliberately a small HTTP process and the worker is
a small process. Feature tasks may add framework-specific code inside their owned
application without changing the shared package boundaries.

## Consequences

- All cross-package DTOs and ports must be imported from `packages/contracts`.
- Production adapters may depend on vendor SDKs; domain code may not.
- The repository requires Node.js 24 or newer and pnpm 11.
