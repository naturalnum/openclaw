**配置项是**
blockedHosts: 按主机名/IP 拦，比如 10.0.0.8
blockedUrlPrefixes: 按 URL 前缀拦，比如 https://forbidden.internal/，以这个域名为例，插件会自动追加规则，同步拦截http协议以及该域名对应的主机ip。
blockedCommands: 要检查的 shell 网络命令列表

**openclaw.json配置**

{
"plugins": {
"allow": ["network-guard-plugin"],
"entries": {
"network-guard-plugin": {
"enabled": true,
"config": {
"blockedHosts": ["10.86.188.84","10.86.188.126"],
"blockedUrlPrefixes": ["https://ai.sgcc.com.cn/"],
"blockedCommands": ["curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "telnet"]
}
}
}
}
}
