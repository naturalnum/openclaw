# 技能中心、安全中心与盒子接口改动（简版）

## 1. 接口汇总

| 系统     | 类型 | 接口                                                 | 改动                                    |
| -------- | ---- | ---------------------------------------------------- | --------------------------------------- |
| 技能中心 | 修改 | `POST /api/admin/skills/{slug}/{version}/approve`    | 审核后加密并向各安全中心同步技能。      |
| 安全中心 | 修改 | `POST /api/resource/ai-skill/sync/syncAiSkill`       | 重复同步改为幂等成功。                  |
| 安全中心 | 新增 | `GET /api/open/v1/skillsList`                        | 兼容 Agent 现有技能中心列表接口。       |
| 安全中心 | 新增 | `POST /api/resource/ai-skill/{skillId}/installation` | 按 `action` 更新安装状态。              |
| 盒子     | 新增 | `POST /api/v1/download`                              | 根据 `skillId` 下载、解密并返回技能包。 |
| 盒子     | 新增 | `POST /api/box/v1/skills/{skillId}/installation`     | 接收 Agent 安装/卸载状态并转报。        |

安全中心现有 `POST /api/resource/ai-skill/page` 保持不变，新增的 `/api/open/v1/skillsList` 内部复用其查询能力。当前版本继续使用 `skillId`，暂不增加 `fileId`。

## 3.1 技能（Skills）管理

### 2.3.1 技能列表

#### 接口信息

| 类型         | 内容说明                                                        |
| ------------ | --------------------------------------------------------------- |
| 请求方式     | **`GET`**                                                       |
| 请求方法     | **`/api/open/v1/skillsList`**                                   |
| Content-Type | `application/json`                                              |
| 接口说明     | **兼容 Agent 现有技能中心列表接口，内部调用安全中心分页查询。** |

只有同时兼容路径、请求方式、入参和响应结构，Agent 的技能列表逻辑才不需要修改。

#### 请求参数

| 安全中心原字段        | 是否必填 | 类型      | 技能中心兼容字段 | 说明                                                  |
| --------------------- | -------- | --------- | ---------------- | ----------------------------------------------------- |
| `current`             | 是       | `integer` | **`page`**       | **重命名，当前页，从 `1` 开始。**                     |
| `size`                | 是       | `integer` | **`limit`**      | **重命名，每页数量；Agent 当前使用 `100`。**          |
| `skillName/skillCode` | 否       | `string`  | **`q`**          | **合并为综合搜索，匹配名称、编码、作者和标签。**      |
| `skillType`           | 否       | `string`  | **`category`**   | **重命名，技能分类 ID。**                             |
| 无                    | 否       | `string`  | **`sort`**       | **新增：`comprehensive`、`downloads` 或 `updated`。** |

安全中心内部映射后，仍然使用 `current/size/skillName/skillCode/skillType` 执行原分页查询。

#### 请求示例

```http
GET /api/open/v1/skillsList?q=review&category=development&sort=comprehensive&page=1&limit=100
```

#### 响应参数

兼容接口直接返回技能中心结构，不再包装安全中心的 `code/message/success/data` 外层。

| 安全中心原字段 | 是否必填 | 类型      | 技能中心兼容字段            | 说明                                         |
| -------------- | -------- | --------- | --------------------------- | -------------------------------------------- |
| 无             | 是       | `array`   | **`categories`**            | **新增，技能分类列表。**                     |
| `data.records` | 是       | `array`   | **`skills`**                | **重命名并移动到响应顶层。**                 |
| `data.pages`   | 条件必填 | `integer` | **`pagination.totalPages`** | **存在多页数据时必填，Agent 据此继续拉取。** |

#### `skills` 技能字段

| 安全中心原字段 | 是否必填 | 类型       | 技能中心兼容字段  | Agent 是否使用 | 说明                                     |
| -------------- | -------- | ---------- | ----------------- | -------------- | ---------------------------------------- |
| `skillId`      | 是       | `string`   | **`slug`**        | 是             | **重命名，值仍使用安全中心 `skillId`。** |
| `skillName`    | 是       | `string`   | **`displayName`** | 是             | **重命名，技能显示名称。**               |
| `summary`      | 是       | `string`   | `summary`         | 是             | 保持不变。                               |
| `skillType`    | 是       | `string`   | **`category`**    | 是             | **重命名，技能分类 ID。**                |
| 无             | 否       | `string[]` | **`tags`**        | 是             | **新增，默认返回空数组。**               |
| `version`      | 是       | `string`   | `version`         | 是             | 保持不变。                               |
| 无             | 是       | `integer`  | **`downloads`**   | 是             | **新增，累计下载次数，默认 `0`。**       |
| 无             | 是       | `integer`  | **`installs`**    | 是             | **新增，当前安装数量，默认 `0`。**       |
| 无             | 是       | `integer`  | **`updatedAt`**   | 是             | **新增，技能更新时间戳。**               |
| `author`       | 是       | `string`   | `author`          | 是             | 保持不变。                               |

`skillCode` 可以作为扩展字段继续返回，但当前 Agent 技能列表不依赖该字段。

#### `categories` 分类字段

| 安全中心原字段 | 是否必填 | 类型     | 技能中心兼容字段 | 说明                 |
| -------------- | -------- | -------- | ---------------- | -------------------- |
| 无             | 是       | `string` | **`id`**         | **新增，分类 ID。**  |
| 无             | 是       | `string` | **`name`**       | **新增，分类名称。** |

#### 响应示例

```json
{
  "categories": [
    {
      "id": "development",
      "name": "开发工具"
    }
  ],
  "skills": [
    {
      "slug": "skill-image-detect",
      "displayName": "图像目标检测",
      "skillCode": "image-detect",
      "summary": "skill todo",
      "category": "development",
      "tags": ["image", "detect"],
      "version": "1.0.3",
      "downloads": 10,
      "installs": 3,
      "updatedAt": 1784822400000,
      "author": "zhangsan"
    }
  ],
  "pagination": {
    "totalPages": 1
  }
}
```

## 3. 安全中心安装状态接口

```http
POST /api/resource/ai-skill/{skillId}/installation
```

请求体：

```json
{
  "action": "install",
  "version": "1.0.0",
  "source": "agent"
}
```

- `action`：必填，`install` 表示安装成功、数量加一；`uninstall` 表示卸载成功、数量减一。
- `version`：可选，技能版本。
- `source`：可选，调用来源。

成功返回：

```json
{
  "success": true
}
```

该接口由盒子调用。盒子在内部维护用户、盒子身份、本地安装状态和幂等记录。

要求：

- 只允许认证后的盒子调用。
- 盒子仅在本地安装状态真实发生变化时转报，重复安装或重复卸载不重复计数。
- 安全中心不得将安装数量减为负数。
- 上报失败由盒子记录并重试，不影响 Agent 已完成的本地安装或卸载。

## 4. 盒子下载解密接口

```http
POST /api/v1/download
Content-Type: application/json
```

请求只包含技能标识：

```json
{
  "skillId": "skill-image-detect"
}
```

处理流程：

1. 根据 `skillId` 从安全中心获取对应密文文件信息。
2. 下载并校验密文文件。
3. 调用硬件解密服务。
4. 将解密后的技能包以文件流返回 Agent。

成功响应：

```http
Content-Type: application/gzip
Content-Disposition: attachment; filename="skill.tar.gz"

{decrypted skill package stream}
```

响应可使用 ZIP、TAR 或 TGZ，但包内只能包含一个技能根目录；`Content-Type` 和文件名必须与实际格式一致，`Content-Length` 只能返回一次。文件地址、文件校验和硬件解密参数仅在盒子内部处理，不暴露给 Agent。

## 5. 盒子安装状态接口

```http
POST /api/box/v1/skills/{skillId}/installation
```

请求体：

```json
{
  "action": "install",
  "version": "1.0.0",
  "source": "agent"
}
```

其中 `action` 必填，`version/source` 可选。

盒子处理：

1. 从当前登录会话识别用户，并结合盒子身份维护本地安装状态。
2. 只有状态发生变化时才调用安全中心安装状态接口。
3. 上报失败时保存待重试记录，避免重复计数或漏计。

成功返回：

```json
{
  "success": true
}
```

## 6. Agent 改造范围说明

- Agent 配置中的 `skills.registry.baseUrl` 指向安全中心的技能列表服务。
- `skills.registry.boxBaseUrl` 指向盒子端下载解密和安装状态服务；两者允许使用不同的 IP 或域名。
- 技能列表服务启用 OAuth2 Client Credentials 时，Agent 先调用 `/api/system/oauth2/token` 获取 Token，再使用 `Authorization: Bearer {access_token}` 查询列表；该 Token 不发送给盒子端。
- 采用安全中心 `GET /api/open/v1/skillsList` 兼容路由后，Agent 的技能列表查询不需要修改。
- 下载解密链路由 Agent 将技能列表的 `slug` 作为 `skillId` 传给盒子，不再依赖技能列表中的文件扩展字段。
- 安装或卸载成功后，Agent 使用 `skillId` 调用盒子安装状态接口，并通过 `action` 区分操作。
- `version/source` 可选；用户、盒子身份和幂等信息由盒子维护。
