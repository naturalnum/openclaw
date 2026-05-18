# URL Access Guard Plugin — 网址访问防护插件

## 一、功能介绍

### 1.1 概述

`url-access-guard-plugin` 是一款防御性安全插件，用于控制 AI 智能体在执行任务时对外部网址的访问权限。当智能体调用网络请求类工具（如 `web_fetch`、`web_search`、`curl` 等）时，本插件会在请求发出前进行拦截，根据配置的黑名单或白名单规则决定是否允许该次访问。

### 1.2 核心能力

| 能力          | 说明                                             |
| ------------- | ------------------------------------------------ |
| 黑名单过滤    | 阻止智能体访问已知恶意、内网、敏感域名           |
| 白名单过滤    | 仅允许智能体访问预先批准的域名                   |
| 通配符匹配    | 支持 `*` 通配符进行域名模式匹配                  |
| 内网防护      | 默认阻止 SSRF 攻击（访问 localhost、私有 IP 段） |
| 命令 URL 提取 | 从 curl/wget 等 shell 命令中提取并检查 URL       |

### 1.3 工作原理

```
用户请求 → 智能体决定调用网络工具 → [before_tool_call 钩子拦截]
    ↓
提取工具参数中的 URL → 解析 hostname → 匹配黑/白名单规则
    ↓
通过 → 放行执行    ✗ 不通过 → 阻断并返回原因
```

### 1.4 拦截的工具类型

本插件监控以下工具的调用：

- `web_fetch` — 网页内容抓取
- `web_search` — 网络搜索
- `fetch` — 通用 HTTP 请求
- `http_request` — HTTP 请求
- `curl` — 命令行 HTTP 工具

### 1.5 默认黑名单（内置）

插件内置以下默认黑名单，防止 SSRF（服务端请求伪造）攻击：

| 类别          | 地址                                |
| ------------- | ----------------------------------- |
| 回环地址      | `localhost`, `127.0.0.1`, `0.0.0.0` |
| 内部域名      | `*.internal`, `*.local`             |
| 链路本地      | `169.254.*`                         |
| 私有网段 A 类 | `10.*`                              |
| 私有网段 B 类 | `172.16.*` ~ `172.31.*`             |
| 私有网段 C 类 | `192.168.*`                         |

---

## 二、使用手册

### 2.1 安装与启用

在 `openclaw.json` 配置文件中添加插件：

```json
{
  "plugins": {
    "allow": ["url-access-guard-plugin"],
    "entries": {
      "url-access-guard-plugin": {
        "enabled": true
      }
    }
  }
}
```

仅启用即可获得默认内网防护能力，无需额外配置。

### 2.2 配置参数说明

| 参数        | 类型                           | 默认值        | 说明                                       |
| ----------- | ------------------------------ | ------------- | ------------------------------------------ |
| `mode`      | `"blocklist"` \| `"allowlist"` | `"blocklist"` | 过滤模式                                   |
| `blocklist` | `string[]`                     | `[]`          | 额外阻止的域名模式列表（与内置列表合并）   |
| `allowlist` | `string[]`                     | `[]`          | 允许访问的域名模式列表（仅白名单模式生效） |

### 2.3 通配符匹配规则

| 模式            | 匹配示例                             | 说明                  |
| --------------- | ------------------------------------ | --------------------- |
| `example.com`   | `example.com`, `sub.example.com`     | 精确匹配 + 子域名匹配 |
| `*.example.com` | `api.example.com`, `cdn.example.com` | 匹配所有子域名        |
| `192.168.*`     | `192.168.1.1`, `192.168.0.100`       | IP 段通配             |
| `*.internal`    | `api.internal`, `db.internal`        | 后缀通配              |

### 2.4 使用场景

#### 场景一：黑名单模式 — 阻止已知恶意网站

```json
{
  "plugins": {
    "allow": ["url-access-guard-plugin"],
    "entries": {
      "url-access-guard-plugin": {
        "enabled": true,
        "config": {
          "mode": "blocklist",
          "blocklist": [
            "*.malware-site.com",
            "phishing.example.org",
            "*.darkweb.io",
            "data-exfil.attacker.net"
          ]
        }
      }
    }
  }
}
```

效果：

- 内置的内网地址全部被阻止
- 额外阻止配置中列出的恶意域名
- 其余所有外网域名均可正常访问

#### 场景二：白名单模式 — 仅允许访问指定网站

```json
{
  "plugins": {
    "allow": ["url-access-guard-plugin"],
    "entries": {
      "url-access-guard-plugin": {
        "enabled": true,
        "config": {
          "mode": "allowlist",
          "allowlist": [
            "*.github.com",
            "*.stackoverflow.com",
            "docs.python.org",
            "*.npmjs.com",
            "*.mozilla.org"
          ]
        }
      }
    }
  }
}
```

效果：

- 智能体仅能访问白名单中的域名
- 任何未在白名单中的域名一律拒绝
- 适用于高安全等级环境

#### 场景三：企业内部部署 — 仅允许访问内部资源

```json
{
  "config": {
    "mode": "allowlist",
    "allowlist": [
      "*.mycompany.com",
      "*.mycompany.internal",
      "jira.mycompany.com",
      "confluence.mycompany.com",
      "gitlab.mycompany.com"
    ]
  }
}
```

### 2.5 日志输出

插件拦截时会输出告警日志：

```
[url-access-guard-plugin] blocking tool=web_fetch reason="blocked URL access to 192.168.1.100 (matches blocklist pattern: 192.168.*)"
```

```
[url-access-guard-plugin] blocking tool=web_search reason="blocked URL access to evil.com (not in allowlist)"
```

### 2.6 注意事项

1. **黑名单模式下**，用户配置的 `blocklist` 与内置默认列表合并，不会覆盖内置规则
2. **白名单模式下**，`blocklist` 字段不生效，仅 `allowlist` 决定访问权限
3. 插件仅拦截 URL 相关工具，不影响本地文件读写、代码执行等其他工具
4. URL 解析失败（非法 URL）的情况不会被拦截，会正常放行
5. 模式匹配不区分大小写

---

## 三、安全价值

| 防护场景     | 说明                               |
| ------------ | ---------------------------------- |
| SSRF 防护    | 防止智能体被诱导访问内网服务       |
| 数据泄露防护 | 阻止智能体向恶意外部服务器发送数据 |
| 供应链攻击   | 阻止从不可信源下载恶意代码         |
| 合规管控     | 限制智能体仅访问合规审批域名       |
