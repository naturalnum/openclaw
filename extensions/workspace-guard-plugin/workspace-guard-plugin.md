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
"workspace-guard-plugin": {
"enabled": true,
"config": {
"readonlyPaths": [
"skills",
"extensions",
".agents/skills",
".openclaw/extensions"
]
}
}
}
}

----------------------------拦截规则--------------------------------
1） 所有写操作只能发生在当前 workspace 内。
它会先确定当前 workspace：

优先用运行时 ctx.workspaceDir
没有的话，用当前 agent 的 workspace
再没有就退回 agents.defaults.workspace
然后凡是写到 workspace 外的路径，都会拦截。

2） workspace 内可以再配置一组只读路径。
配置项是 readonlyPaths，支持：

相对路径：相对当前 workspace
绝对路径：直接按绝对路径保护
默认只读目录是：

skills
extensions
.agents/skills
.openclaw/extensions
命中这些目录后，不管路径是在 workspace 内还是绝对路径，都会被当成只读，禁止写和删。

3） 它拦两类工具入口。
文件工具：

write
edit
apply_patch
Shell 工具：

exec
bash
其中：

write / edit 会检查目标路径
apply_patch 会检查 patch 里 \*\*\* Add/Update/Delete File: 指向的文件
exec / bash 会分析命令里的变更路径
4） 它专门拦高风险的 shell 删除/清空操作。
当前明确覆盖了这些模式：

rm -rf /etc 这类删 workspace 外路径
rm -rf _
rm -rf ./_ && rm -rf .[!.]\*
find . -delete
find . -exec rm ...
git clean -f...
rsync --delete
echo xxx > file、>> file 这类重定向写文件
git clone ... target-dir 这类会落地新目录的命令
