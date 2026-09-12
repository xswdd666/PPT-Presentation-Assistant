# Development

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL for database-backed adapters (not required by the in-memory tests)

## Commands

```bash
pnpm install
pnpm dev:web
pnpm dev:worker
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm test:e2e
pnpm check
```

Copy `.env.example` to `.env` for local database-backed development. Never commit
real credentials or presentation content.

## Package boundaries

- `packages/contracts`: shared DTOs, states, ports and workflow interface.
- `packages/domain`: vendor-neutral workflow rules and in-memory test adapters.
- `packages/db`: PostgreSQL schema and repository adapters.
- `packages/pptx`: PPTX provider adapters (stage B).
- `packages/ai`: model provider adapters and analysis jobs (stage B).
- `apps/web`: HTTP/UI composition root.
- `apps/worker`: asynchronous job composition root.
