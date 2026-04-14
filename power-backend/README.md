# power-backend

Backend companion layer for `power-ui`.

Current scope:

- project creation orchestration
- session bootstrap/session-key strategy
- server-side workspace directory browsing for `power-ui`

Non-goals in the current phase:

- replacing OpenClaw core gateway methods
- modifying upstream `ui/`
- adding file/search/skills/automation features ahead of the core project/chat flow

## Gateway Integration

`power-backend` is organized as a standalone repo directory, but it integrates
with OpenClaw as a native plugin loaded by Gateway.

Current plugin methods:

- `power.fs.roots`
- `power.fs.listDirs`
- `power.fs.validateWorkspace`

Add this directory to `plugins.load.paths`, then restart Gateway.

Example:

```json
{
  "plugins": {
    "load": {
      "paths": ["/absolute/path/to/openclaw/power-backend"]
    },
    "entries": {
      "power-backend": {
        "enabled": true,
        "config": {
          "roots": ["/srv/projects", "/data/workspaces"]
        }
      }
    }
  }
}
```
