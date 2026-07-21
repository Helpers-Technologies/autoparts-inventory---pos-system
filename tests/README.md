# Tests

Automation suite for AutoParts Inventory & Sales System.

## Layout

```
tests/
├── unit/          # pure functions, no IPC, no DOM (vitest, node env)
│   ├── lib/       # src/lib/* helpers
│   └── store/     # src/store/_pure.ts pure helpers extracted from AppContext
├── component/     # React component tests (vitest, jsdom env) — Wave 2
├── integration/   # AppContext actions + IPC handlers against real SQLCipher DB — Wave 2
└── e2e/           # Playwright Electron — Wave 2
```

## Naming

- Unit/component/integration: `<subject>.test.ts(x)` — Vitest default.
- E2E: `<journey>.spec.ts` — Playwright default.
- Each test gets a stable case ID in a JSDoc tag (`@tcid TC-LIB-CODES-001`) so the
  catalog and CI reports stay aligned.

## Running

```bash
npm test              # vitest run (unit + component + integration)
npm run test:watch    # vitest watch mode
npm run test:coverage # with v8 coverage report
```

## Conventions

- One behavior per test. Multiple `expect`s are fine if they describe one outcome
  (state + side-effect + UI + event).
- No `setTimeout`, `sleep`, or `waitForTimeout` calls. Use `vi.useFakeTimers` for
  time-dependent code.
- Builders, not fixture JSON, for unit/integration. Files reserved for E2E seeds.
- Property tests via `fast-check` for money/quantity arithmetic.
