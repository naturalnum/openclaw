**只读保护路径**
skills/...
.agents/skills/...
.openclaw/extensions/...
/workspace/skills/...
/workspace/.agents/skills/...
/workspace/.openclaw/extensions/...

**其他拦截规则**
rm -rf /workspace

**openclaw.json增加配置**

_启用插件_
"plugins": {
"allow": ["workspace-guard-plugin"],
"entries": {
"workspace-guard-plugin": { "enabled": true }
}
}

_指定工具操作目录_
"tools": {
"fs": {
"workspaceOnly": true
},
"elevated": {
"enabled": false
}

_启动沙箱模式_
"agents": {
"defaults": {
//打开沙箱
"sandbox": {
"mode": "all",
"workspaceAccess": "rw"
}
}
