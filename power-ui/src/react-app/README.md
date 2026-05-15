# React app (`src/react-app/`)

Parallel **Vite + React + Tailwind + Ant Design** shell for incremental migration away from Lit.

## Compare with legacy UI

| | Legacy (Lit) | This directory |
|---|----------------|------------------|
| **Dev URL** | `/` or `/index.html` | `/react.html` |
| **Entry** | `src/main.ts` → `src/app.ts` | `src/react-app/main.tsx` |

Run `pnpm power-ui:dev` from the repo root (or `pnpm nStart` with the gateway stack), then open both URLs on port **5174**.

## Build

`pnpm power-ui:build` emits both `index.html` (Lit) and `react.html` (React) into `dist/power-ui/`.

## Next steps

Port vertical slices (Logs → Skills → …) as React routes under `src/react-app/`, reusing `src/adapters/` and extracted domain logic from `src/compat/` without importing Lit.
