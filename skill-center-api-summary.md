# 技能中心接口汇总

## 1. 文档范围

本文档汇总当前 Agent 技能页面已经接入的技能中心接口，包括：

- Agent 调用技能中心的 HTTP 接口。
- Power UI 调用 Agent Gateway 的 WebSocket RPC。
- 用户身份、技能目录和数据落盘边界。
- 当前尚未接入的技能中心能力。

当前配置示例：

```json
{
  "skills": {
    "registry": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:3000",
      "boxBaseUrl": "http://127.0.0.1:3100",
      "oauth": {
        "clientId": "agent-client",
        "clientSecret": "${POWER_AGENT_SKILL_CENTER_CLIENT_SECRET}",
        "scope": "read write"
      },
      "timeoutMs": 10000
    }
  }
}
```

说明：

- `enabled` 为 `false` 时关闭远程技能中心。
- `baseUrl` 是技能中心地址，仅用于查询技能列表；为空时仅展示当前用户已经安装或本地上传的技能。
- `boxBaseUrl` 是盒子端地址，用于下载解密以及安装、卸载数量上报；未配置时兼容旧版本，回退使用 `baseUrl`。
- `oauth` 为可选的 OAuth2 Client Credentials 配置；启用后只保护技能列表请求，不会把 Token 发送给盒子端。
- `oauth.tokenUrl` 可选，默认使用 `{baseUrl}/api/system/oauth2/token`；`clientSecret` 支持明文或 OpenClaw SecretRef。
- `timeoutMs` 未配置时默认使用 `10000` 毫秒，最小值为 `1000` 毫秒。

## 2. Agent 调用技能中心的 HTTP 接口

### 2.1 获取访问 Token

启用 `skills.registry.oauth` 时，Agent 先调用：

```http
POST /api/system/oauth2/token
Content-Type: application/json
```

```json
{
  "grantType": "client_credentials",
  "clientId": "agent-client",
  "clientSecret": "<由技能中心分配>",
  "scope": "read write"
}
```

Agent 从响应 `data.access_token` 取得 Token，并根据 `data.expires_in` 缓存和提前刷新。Client Secret 和 Access Token 不写入日志。

### 2.2 查询技能目录

```http
GET /api/open/v1/skillsList
Authorization: Bearer {access_token}
```

请求参数：

| 参数       | 类型    | 必填 | 说明                                            |
| ---------- | ------- | ---- | ----------------------------------------------- |
| `q`        | string  | 否   | 按技能名称、标识、作者或标签搜索。              |
| `category` | string  | 否   | 分类 ID。未传表示全部分类。                     |
| `sort`     | string  | 否   | `comprehensive`、`downloads` 或 `updated`。     |
| `page`     | integer | 是   | 当前页，从 `1` 开始。                           |
| `limit`    | integer | 是   | 每页数量。Agent 当前固定按 `100` 拉取远程目录。 |

技能中心响应格式：

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "categories": [
    {
      "id": "development",
      "name": "开发工具",
      "icon": "</>",
      "bgColor": "#f3f4f6",
      "textColor": "#111827"
    }
  ],
  "skills": [
    {
      "slug": "peer-review",
      "displayName": "Peer Review",
      "summary": "按照同行评审流程审阅研究材料。",
      "category": "development",
      "tags": ["review", "research"],
      "version": "1.0.0",
      "downloads": 10,
      "installs": 8,
      "stars": 2,
      "updatedAt": 1784678400000,
      "author": "SkillCenter"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 1,
    "totalPages": 1
  }
}
```

Agent 侧处理逻辑：

1. 按 `limit=100` 逐页拉取技能中心全部匹配数据。
2. 读取当前登录用户的本地技能。
3. 按 `slug` 合并远程技能与本地安装状态。
4. 应用“全部、已安装、未安装”过滤条件。
5. 再按 Power UI 当前分页大小返回，默认每页 `12` 条。
6. 远程技能中心不可用时，仍返回当前用户的本地技能，并同时返回远程请求错误。

### 2.3 下载技能包

```http
POST /api/v1/download
Content-Type: application/json
```

请求体：

```json
{
  "skillId": "peer-review"
}
```

`skillId` 为技能唯一标识，其值来自技能列表的 `slug` 字段。Agent 不再从技能列表读取或向下载接口传递文件地址、大小、文件名、签名和 MD5；盒子根据 `skillId` 定位密文、完成校验及解密。

响应要求：

- 响应体为单个技能包，支持 ZIP、TAR 或 TGZ；包内只能有一个技能根目录。
- `Content-Type` 和 `Content-Disposition` 文件名应与实际压缩格式一致。
- `Content-Length` 只能返回一次。
- 建议通过 `Content-Disposition` 返回文件名，例如：

```http
Content-Type: application/zip
Content-Disposition: attachment; filename="peer-review-1.0.0.zip"
```

Agent 会优先读取 `Content-Disposition` 中的文件名；未提供时使用：

```text
{slug}-{version|latest}.zip
```

### 2.4 上报安装事件

```http
POST /api/v1/skills/{slug}/install-event
Content-Type: application/json
```

请求体：

```json
{
  "action": "install",
  "version": "1.0.0",
  "source": "openclaw-registry"
}
```

响应格式：

```json
{
  "installs": 9
}
```

说明：

- 从技能中心下载安装时，`source` 为 `openclaw-registry`。
- 客户端类型还预留了 `upload`，但当前本地 ZIP 导入流程不会调用此接口。
- 技能包安装成功后才上报安装事件。
- 技能卸载成功后以 `action: "uninstall"` 上报。
- 安装事件上报失败不会回滚或阻止已经完成的本地安装。

## 3. Power UI 调用 Agent Gateway 的 RPC

以下接口通过 Gateway WebSocket 调用，不是技能中心对外 HTTP 接口。

### 3.1 查询技能列表

```text
skills.registry.list
```

请求参数：

```json
{
  "userSessionToken": "当前用户会话令牌",
  "q": "peer",
  "category": "development",
  "sort": "comprehensive",
  "page": 1,
  "limit": 12,
  "installFilter": "all"
}
```

其中：

- `category` 不传表示全部分类。
- `installFilter` 支持 `all`、`installed`、`not_installed`。
- `userSessionToken` 由前端请求适配器自动加入，不需要页面组件手工传入。

响应格式：

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "categories": [],
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 0,
    "totalPages": 1
  }
}
```

每个 `items` 项除了远程目录字段，还包含当前用户的安装状态：

```json
{
  "installState": {
    "installed": true,
    "installedVersion": "1.0.0",
    "latestVersion": "1.0.0",
    "managed": true,
    "canUninstall": true,
    "source": "openclaw-registry"
  }
}
```

### 3.2 安装技能中心技能

```text
skills.registry.install
```

请求参数：

```json
{
  "userSessionToken": "当前用户会话令牌",
  "slug": "peer-review",
  "version": "1.0.0"
}
```

执行流程：

1. 校验本地用户会话。
2. 从技能中心下载 ZIP 技能包。
3. 校验并解压到当前用户技能目录。
4. 上报安装事件。
5. 返回安装结果和安装状态。

### 3.3 导入本地技能包

```text
skills.registry.installArchive
```

请求参数：

```json
{
  "userSessionToken": "当前用户会话令牌",
  "fileName": "peer-review-1.0.0.zip",
  "archiveBase64": "ZIP 文件的 Base64 内容",
  "overwrite": false
}
```

说明：

- Power UI 当前只允许导入 `.zip` 文件。
- 技能包直接上传给 Agent Gateway 并安装到当前用户目录。
- 该流程不调用技能中心下载接口，也不调用安装事件接口。
- 本地导入技能的 `source` 为 `directory`，`managed` 为 `false`。

### 3.4 卸载技能

```text
skills.registry.uninstall
```

请求参数：

```json
{
  "userSessionToken": "当前用户会话令牌",
  "slug": "peer-review"
}
```

说明：

- 只删除当前登录用户目录下对应的技能。
- 卸载成功后会向技能中心上报 `action: "uninstall"`。
- 不会影响其他用户安装的同名技能。

## 4. 用户隔离与数据目录

所有技能操作都必须带有效的 `userSessionToken`。Gateway 根据会话解析用户身份，并将技能安装到：

```text
data/users/{用户ID}/skills/{技能slug}/
```

数据隔离原则：

- 每个用户拥有独立技能目录。
- 技能列表只合并当前用户的本地技能。
- 安装、上传和卸载只作用于当前用户。
- 应用程序更新只替换 `app` 和启动脚本时，`data` 目录不会被覆盖，因此用户技能不会因升级丢失。

## 5. 鉴权与网络边界

当前存在两层调用：

```text
浏览器 Power UI
    │ userSessionToken
    ▼
Agent Gateway WebSocket RPC
    │ 当前未携带用户令牌或技能中心 API Key
    ▼
SkillCenter HTTP API
```

当前行为：

- `userSessionToken` 只用于 Power UI 到 Agent Gateway 的本地用户鉴权。
- Agent 请求技能中心时没有发送 `Authorization`、Cookie 或用户身份头。
- 技能中心当前接口需要允许 Agent 所在机器直接访问。
- 如果技能中心以后要求登录、API Key、签名或用户级授权，需要新增服务端凭证配置和请求头传递机制，不能把本地用户令牌直接暴露给技能中心。
- Agent 对技能中心 URL 使用远程访问安全策略，并设置请求超时。

## 6. 当前没有接入的技能中心能力

以下能力目前尚未接入：

1. 技能详情接口。
2. 历史版本列表与指定版本升级界面。
3. 自动检测更新或批量更新。
4. 收藏、评分、评论和点赞。
5. 技能中心账号登录和用户同步。
6. 技能中心 API Key 或签名鉴权。
7. 卸载事件上报。
8. 本地 ZIP 上传事件上报。
9. 发布者、审核和后台管理接口。
10. Agent 向技能中心上传或发布技能。

## 7. 当前页面的补充行为

- “打开技能中心”按钮只打开配置或目录响应中的 `baseUrl`，不调用额外接口。
- “全部”分类会清除当前分类，并将安装过滤恢复为 `all`。
- 分类、搜索、排序和安装状态过滤都会回到第 `1` 页重新加载。
- 远程请求失败时，已安装的本地技能仍可展示和卸载。
- 旧的 `skills.status`、`skills.update` 接口不属于当前 React 技能页面的主要调用链。

## 8. 联调建议

技能中心至少需要验证以下场景：

1. 目录为空、单页和多页数据。
2. 搜索、分类与三种排序方式。
3. 下载最新版本和指定版本。
4. ZIP 文件名包含中文、空格和版本号。
5. 下载接口返回 `404`、`500`、超时或非 ZIP 内容。
6. 安装事件正常返回、返回异常和服务不可用。
7. 同一技能重复安装及不同版本覆盖策略。
8. 两个用户安装、卸载同名技能时互不影响。
9. 技能中心不可用时仍能展示本地技能。
10. 应用升级后 `data/users/{用户ID}/skills` 内容保持不变。

## 9. 相关实现文件

- `src/skills-registry/client.ts`：技能中心 HTTP 客户端。
- `src/gateway/server-methods/skills-registry.ts`：Gateway RPC 处理和用户目录解析。
- `src/gateway/protocol/schema/skills-registry.ts`：RPC 请求与响应协议。
- `power-ui/src/compat/skills-market-controller.ts`：Power UI 技能页面状态与 RPC 调用。
