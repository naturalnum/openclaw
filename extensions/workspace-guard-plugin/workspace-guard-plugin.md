两层防护体系

**软防护：让工具操作限定在工作目录(openclaw.json）**
"tools": {
"fs": {
"workspaceOnly": true
},
"elevated": {
"enabled": false
}
}

**硬防护：启用拦截插件**
_启用插件（openclaw.json）_
"plugins": {
"allow": ["workspace-guard-plugin"],
"entries": {
"workspace-guard-plugin": { "enabled": true }
}
}
_所有写操作和删除操作只允许落在当前 workspace 内_
_workspace外的所有文件和目录一律视为只读，写/删都会被拦_
_获取当前系统的worspace工作目录，workspace内以下目录保持只读_
skills/...
extensions/...
.agents/skills/...
.openclaw/extensions/...
