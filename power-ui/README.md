# Power UI

Two entry points after `pnpm power-ui:build` (or `pnpm power-ui:dev`):

| Entry | Stack | Typical URL (dev) |
|-------|--------|-------------------|
| `index.html` | Lit (legacy workbench) | `http://localhost:5174/` |
| `react.html` | React + Tailwind + Ant Design (incremental migration) | `http://localhost:5174/react.html` |

See `src/react-app/README.md` for the React app layout and parity checklist.

## Dev: `Uncaught SyntaxError: Unexpected token 'export'`

Usually the browser is executing **ESM** (a file that starts with `import` / `export`) as a **classic** script, or a **wrong URL** returns JS/HTML instead of the Vite-transformed module.

1. Always use **`pnpm power-ui:dev`** (or `pnpm nStart`), not `file://` or a random static server on `dist/` unless MIME and paths are correct.
2. Hard-reload or clear site data; delete the Vite cache and restart:  
   `rm -rf power-ui/node_modules/.vite` then `pnpm power-ui:dev`.
3. In DevTools → **Network**, open the response for the red script URL: if you see raw `node_modules/...` source or HTML, the request path or proxy is wrong—fix base URL / gateway mount.
