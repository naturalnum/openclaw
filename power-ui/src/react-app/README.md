# React app (`src/react-app/`)

Parallel **Vite + React + Tailwind + Ant Design** shell for incremental migration away from Lit.

## Compare with legacy UI

|             | Legacy (Lit)                 | This directory           |
| ----------- | ---------------------------- | ------------------------ |
| **Dev URL** | `/lit.html`                  | `/` (default)            |
| **Entry**   | `src/main.ts` → `src/app.ts` | `src/react-app/main.tsx` |

Run `pnpm power-ui:dev` from the repo root (or `pnpm nStart` with the gateway stack). Default: **5174/** (React). Legacy Lit: **5174/lit.html**.

## Build

`pnpm power-ui:build` emits `index.html` (React, served at gateway root) and `lit.html` (legacy) into `dist/power-ui/`. `react.html` redirects to `/` for old bookmarks.

## Next steps

Port vertical slices (Logs → Skills → …) as React routes under `src/react-app/`, reusing `src/adapters/` and extracted domain logic from `src/compat/` without importing Lit.
