# OpenClaw Docker 本地镜像 — 启动与配置说明

## 容器内文件路径

| 文件     | 容器路径                        | 说明                                      |
| -------- | ------------------------------- | ----------------------------------------- |
| 主配置   | `/root/.openclaw/openclaw.json` | 网关、模型、渠道等所有配置                |
| 环境变量 | `/app/default.env`              | API Key、Token 等敏感配置，启动时自动加载 |

> 镜像已内置这两个文件的默认值（来自 `default_config/`）。挂载宿主机文件可覆盖默认值，无需重新构建镜像。

---

## 启动命令

### 最简启动（使用镜像内置默认配置）

```bash
docker run \
  -p 18789:18789 \
  openclaw:local
```

### 挂载外部配置文件（推荐生产/开发使用）

```bash
docker run \
  -p 18789:18789 \
  -v "$HOME/.openclaw/openclaw.json:/root/.openclaw/openclaw.json:ro" \
  -v "$(pwd)/default_config/.env:/app/default.env:ro" \
  openclaw:local
```

### 使用 `--env-file` 传入环境变量（优先级高于 default.env）

```bash
docker run \
  -p 18789:18789 \
  -v "$HOME/.openclaw/openclaw.json:/root/.openclaw/openclaw.json:ro" \
  --env-file ./my.env \
  openclaw:local
```

### 使用 `-e` 单独覆盖某个变量

```bash
docker run \
  -p 18789:18789 \
  -e OPENAI_API_KEY=sk-xxx \
  -e OPENCLAW_GATEWAY_TOKEN=your-token \
  openclaw:local
```

### 后台运行（持久化数据目录）

```bash
docker run -d \
  --name openclaw-gateway \
  --restart unless-stopped \
  -p 18789:18789 \
  -v "$HOME/.openclaw:/root/.openclaw" \
  --env-file ./my.env \
  openclaw:local
```

> `-v "$HOME/.openclaw:/root/.openclaw"` 挂载整个状态目录，会话、凭证等数据持久化到宿主机。

---

## 环境变量优先级（高 → 低）

1. `docker run -e KEY=VALUE`（单变量覆盖）
2. `docker run --env-file my.env`
3. `/app/default.env`（容器启动时 `set -a && . /app/default.env` 加载）
4. `openclaw.json` 中的 `env` 块

> 已存在的非空进程环境变量不会被 dotenv/config 覆盖。

---

## 配置文件说明

### openclaw.json（`/root/.openclaw/openclaw.json`）

主配置文件，JSON 格式，控制网关行为、模型、渠道等。

| 字段路径                        | 示例值                   | 说明                            |
| ------------------------------- | ------------------------ | ------------------------------- |
| `gateway.port`                  | `18789`                  | 监听端口                        |
| `gateway.bind`                  | `loopback` / `lan`       | 绑定地址；Docker 内需改为 `lan` |
| `gateway.mode`                  | `local`                  | 运行模式                        |
| `gateway.auth.mode`             | `token` / `none`         | 认证方式                        |
| `gateway.auth.token`            | `"your-token"`           | 网关访问令牌                    |
| `models.providers`              | `{ "bailian": { ... } }` | 模型提供商配置                  |
| `agents.defaults.model.primary` | `"bailian/qwen3.5-plus"` | 默认模型                        |
| `skills.registry.baseUrl`       | `"http://host:3000"`     | Clawhub 注册中心地址            |

> **注意**：`gateway.bind` 默认是 `loopback`（127.0.0.1），Docker 容器内须改为 `lan` 或 `0.0.0.0`，否则宿主机无法通过 `-p 18789:18789` 访问。

修改 bind 示例：

```json
{
  "gateway": {
    "bind": "lan",
    "port": 18789
  }
}
```

或通过命令行参数覆盖（无需修改配置文件）：

```bash
docker run -p 18789:18789 openclaw:local \
  sh -c "set -a && . /app/default.env && set +a && node openclaw.mjs gateway --bind lan --allow-unconfigured"
```

---

### .env / default.env（`/app/default.env`）

环境变量文件，Shell 格式（`KEY=VALUE`），主要用于存放 API Key 等敏感信息。

```bash
# 网关认证令牌（绑定非本地地址时强烈建议设置）
OPENCLAW_GATEWAY_TOKEN=your-long-random-token

# 模型提供商 API Key（至少设置一个）
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...

# 渠道 Token
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
DISCORD_BOT_TOKEN=...

# 工作区根目录（挂载宿主机目录时修改）
OPENCLAW_WORKSPACE_ROOT=/root/.openclaw/workspace/
```

生成随机 Token：

```bash
openssl rand -hex 32
```

---

## 快速上手流程

```bash
# 1. 复制默认配置到本地
cp default_config/.env my.env
cp default_config/openclaw.json my-openclaw.json

# 2. 编辑 my.env，填入 API Key 和 Token
#    编辑 my-openclaw.json，将 gateway.bind 改为 "lan"

# 3. 构建本地镜像（首次或代码更新后）
./scripts/build-docker-local.sh

# 4. 启动容器
docker run \
  -p 18789:18789 \
  -v "$(pwd)/my-openclaw.json:/root/.openclaw/openclaw.json:ro" \
  --env-file ./my.env \
  openclaw:local
```
